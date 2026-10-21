import { describe, expect, it } from "vitest";
import {
  aggregateNetworks,
  unmetDemand,
  catalogueSchema,
  memberKey,
  removeNetwork,
  type PlanFlows,
  type PlanNetwork,
  type Sharing,
} from "./model";

const member = (designId: string) => ({ designId, name: designId, included: true });
const network = (id: string, parentId?: string): PlanNetwork => ({
  id,
  name: id,
  parentId,
  included: true,
  members: [],
  sharing: {},
});
const oxygen = (supply: number, demand: number): PlanFlows => ({
  materials: [
    { key: "fluid:oxygen", kind: "fluid", resourceId: "oxygen", label: "Oxygen", supply, demand },
  ],
  power: { used: 32, made: 0 },
});
const plans = (entries: Record<string, PlanFlows>) =>
  new Map(Object.entries(entries).map(([id, value]) => [memberKey(member(id)), value]));

describe("network material ledger", () => {
  it("isolates self-powered subnets from every ancestor's power without changing resource sharing", () => {
    const root = network("root");
    const middle = network("middle", "root");
    const child = {
      ...network("child", "middle"),
      selfPowered: true,
      members: [member("line")],
      sharing: { "fluid:oxygen": "export" as const },
    };
    middle.sharing["fluid:oxygen"] = "export";
    const catalogue = catalogueSchema.parse([root, middle, child]);
    expect(catalogue[2].selfPowered).toBe(true);
    const flows = plans({ line: { ...oxygen(10, 4), power: { used: 32, made: 128 } } });
    const result = aggregateNetworks(catalogue, flows);
    expect(result.get("child")!.power).toEqual({ used: 32, made: 128 });
    for (const id of ["middle", "root"]) {
      expect(result.get(id)!.power).toEqual({ used: 0, made: 0 });
      expect(result.get(id)!.resources[0].supply).toBe(6);
    }
    catalogue[2].selfPowered = false;
    const connected = aggregateNetworks(catalogue, flows);
    expect(connected.get("root")!.power).toEqual({ used: 32, made: 128 });
  });
  it("counts only selected ports, retains whole-plan power, and flags missing selections", () => {
    const plan = oxygen(10, 5);
    plan.ports = [
      { ...plan.materials[0], portKey: "maker-out", machine: "Maker", side: "out", demand: 0 },
      { ...plan.materials[0], portKey: "user-in", machine: "User", side: "in", supply: 0 },
    ];
    const root = {
      ...network("main"),
      members: [{ ...member("line"), portSelection: ["user-in", "removed-port"] }],
    };
    const result = aggregateNetworks([root], plans({ line: plan })).get("main")!;
    expect(result.resources[0]).toMatchObject({ supply: 0, demand: 5, shortage: 5 });
    expect(result.resources[0].contributions).toHaveLength(1);
    expect(result.power.used).toBe(32);
    expect(result.incomplete).toEqual(["line: selected ports are unavailable"]);
    root.members[0].portSelection = [];
    expect(aggregateNetworks([root], plans({ line: plan })).get("main")!.resources).toEqual([]);
  });
  it("reports the oxygen example and preserves gross imports and exports", () => {
    const root = { ...network("main"), members: [member("producer"), member("consumer")] };
    const result = aggregateNetworks(
      [root],
      plans({ producer: oxygen(10_000, 1_000), consumer: oxygen(1_000, 5_000) }),
    ).get("main")!;
    expect(result.resources[0]).toMatchObject({
      supply: 11_000,
      demand: 6_000,
      free: 5_000,
      shortage: 0,
    });
    expect(result.resources[0].contributions).toHaveLength(2);
    expect(result.power.used).toBe(64);
    const short = aggregateNetworks(
      [root],
      plans({ producer: oxygen(10_000, 0), consumer: oxygen(0, 12_000) }),
    ).get("main")!;
    expect(short.resources[0]).toMatchObject({ free: 0, shortage: 2_000 });
  });

  it.each<Sharing>(["internal", "import", "export", "both"])(
    "applies %s at a child boundary after local consumption",
    (sharing) => {
      const root = network("main");
      const child = {
        ...network("child", "main"),
        members: [member("line")],
        sharing: { "fluid:oxygen": sharing },
      };
      for (const [supply, demand] of [
        [10_000, 5_000],
        [5_000, 10_000],
      ]) {
        const result = aggregateNetworks([root, child], plans({ line: oxygen(supply, demand) }));
        expect(result.get("child")!.resources[0]).toMatchObject({
          fromParent: demand > supply && ["import", "both"].includes(sharing) ? 5_000 : 0,
          toParent: supply > demand && ["export", "both"].includes(sharing) ? 5_000 : 0,
        });
        const parent = result.get("main")!.resources[0];
        if (parent) expect(parent.supply + parent.demand).toBe(5_000);
        else
          expect(
            sharing === "internal" ||
              (sharing === "import" && supply > demand) ||
              (sharing === "export" && demand > supply),
          ).toBe(true);
        expect(result.get("main")!.power.used).toBe(32);
      }
    },
  );

  it("balances sibling exchanges and requires permission at every ancestor boundary", () => {
    const root = network("root");
    const middle = network("middle", "root");
    const producer = {
      ...network("producer", "middle"),
      members: [member("a")],
      sharing: { "fluid:oxygen": "export" as const },
    };
    const consumer = {
      ...network("consumer", "middle"),
      members: [member("b")],
      sharing: { "fluid:oxygen": "import" as const },
    };
    const entries = plans({ a: oxygen(10_000, 0), b: oxygen(0, 4_000) });
    let result = aggregateNetworks([root, middle, producer, consumer], entries);
    expect(result.get("middle")!.resources[0]).toMatchObject({
      supply: 10_000,
      demand: 4_000,
      free: 6_000,
    });
    expect(result.get("root")!.resources).toEqual([]);
    middle.sharing["fluid:oxygen"] = "export";
    result = aggregateNetworks([root, middle, producer, consumer], entries);
    expect(result.get("root")!.resources[0]).toMatchObject({
      supply: 6_000,
      demand: 0,
      free: 6_000,
    });
    expect(result.get("root")!.power.used).toBe(64);
    middle.included = false;
    result = aggregateNetworks([root, middle, producer, consumer], entries);
    expect(result.get("root")!.resources).toEqual([]);
    expect(result.get("root")!.power.used).toBe(0);
  });

  it("reports unavailable and stale members without presenting their totals as complete", () => {
    const root = {
      ...network("root"),
      members: [member("missing"), member("stale"), { ...member("off"), included: false }],
    };
    const result = aggregateNetworks(
      [root],
      plans({ stale: { ...oxygen(50, 0), stale: true } }),
    ).get("root")!;
    expect(result.incomplete).toHaveLength(2);
    expect(result.resources[0].free).toBe(50);
  });

  it("does not merge items and fluids or distinct resource ids", () => {
    const flow = oxygen(10, 0);
    flow.materials.push({
      ...flow.materials[0],
      key: "item:oxygen-cell",
      kind: "item",
      resourceId: "oxygen-cell",
      demand: 10,
      supply: 0,
    });
    expect(
      aggregateNetworks([{ ...network("root"), members: [member("a")] }], plans({ a: flow })).get(
        "root",
      )!.resources,
    ).toHaveLength(2);
  });
});

describe("network topology", () => {
  it("distinguishes covered imports from unallocated parent shortages through multiple levels", () => {
    const root = { ...network("root"), members: [member("producer")] };
    const middle = { ...network("middle", "root"), sharing: { "fluid:oxygen": "import" as const } };
    const child = {
      ...network("child", "middle"),
      members: [member("consumer")],
      sharing: { "fluid:oxygen": "import" as const },
    };
    const topology = [root, middle, child];
    let balances = aggregateNetworks(
      topology,
      plans({ producer: oxygen(10_000, 0), consumer: oxygen(0, 5_000) }),
    );
    expect(unmetDemand(topology, balances, "child", "fluid:oxygen")).toBe(0);
    balances = aggregateNetworks(
      topology,
      plans({ producer: oxygen(1_000, 0), consumer: oxygen(0, 5_000) }),
    );
    expect(unmetDemand(topology, balances, "root", "fluid:oxygen")).toBe(4_000);
    expect(unmetDemand(topology, balances, "child", "fluid:oxygen")).toBeUndefined();
    middle.sharing = {} as typeof middle.sharing;
    balances = aggregateNetworks(
      topology,
      plans({ producer: oxygen(10_000, 0), consumer: oxygen(0, 5_000) }),
    );
    expect(unmetDemand(topology, balances, "middle", "fluid:oxygen")).toBe(5_000);
    expect(unmetDemand(topology, balances, "child", "fluid:oxygen")).toBeUndefined();
    root.members = [];
    middle.members.push(member("producer"));
    middle.included = false;
    balances = aggregateNetworks(
      topology,
      plans({ producer: oxygen(10_000, 0), consumer: oxygen(0, 5_000) }),
    );
    expect(unmetDemand(topology, balances, "child", "fluid:oxygen")).toBe(0);
  });
  it("rejects duplicate membership, duplicate ids, missing parents and cycles", () => {
    const a = { ...network("a"), members: [member("line")] };
    expect(
      catalogueSchema.safeParse([a, { ...network("b"), members: [member("line")] }]).success,
    ).toBe(false);
    expect(catalogueSchema.safeParse([a, a]).success).toBe(false);
    expect(catalogueSchema.safeParse([network("a", "missing")]).success).toBe(false);
    expect(catalogueSchema.safeParse([network("a", "b"), network("b", "a")]).success).toBe(false);
    expect(catalogueSchema.safeParse([network("a", "a")]).success).toBe(false);
    expect(
      catalogueSchema.safeParse([
        a,
        { ...network("b"), members: [{ ...member("line"), ownerId: "someone" }] },
      ]).success,
    ).toBe(true);
  });
  it("releases members and promotes children when removing a network", () => {
    const root = network("root");
    const middle = { ...network("middle", "root"), members: [member("line")] };
    const child = network("child", "middle");
    expect(removeNetwork([root, middle, child], "middle")).toEqual([
      root,
      { ...child, parentId: "root" },
    ]);
    expect(removeNetwork([root, network("child", "root")], "root")).toEqual([network("child")]);
  });
});
