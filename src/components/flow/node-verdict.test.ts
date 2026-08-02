import { describe, expect, it } from "vitest";
import type {
  EdgeThroughput,
  FactoryProject,
  NodeThroughputResult,
  ResourceFlow,
  ThroughputResult,
} from "@/lib/model/types";
import { buildRailPorts, deriveNodeVerdict, splitRailOverflow } from "./node-verdict";

// Unit tests for the verdict/rail derivation: solver numbers in, one honest
// state + cause + action out. Solver behaviour itself is covered elsewhere.

function flow(kind: "item" | "fluid", resourceId: string, amountPerSecond: number): ResourceFlow {
  return {
    key: `${kind}:${resourceId}`,
    kind,
    resourceId,
    displayName: resourceId,
    amountPerSecond,
  } as ResourceFlow;
}

function nodeResult(partial: Partial<NodeThroughputResult>): NodeThroughputResult {
  return {
    nodeId: "N",
    recipeId: "r",
    recipeName: "r",
    inputs: {},
    outputs: {},
    euT: 0,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 1,
    utilization: 1,
    theoreticalMachinesRequired: 1,
    status: "balanced",
    warnings: [],
    ...partial,
  } as NodeThroughputResult;
}

function edgeResult(partial: Partial<EdgeThroughput>): EdgeThroughput {
  return {
    transferredPerSecond: 0,
    demandPerSecond: 0,
    isLimited: false,
    constraint: "full",
    ...partial,
  } as EdgeThroughput;
}

function project(partial: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: 1,
    id: "verdict-test",
    name: "verdict-test",
    fuelProfiles: [],
    storages: [],
    recipes: [],
    nodes: [],
    edges: [],
    ...partial,
  } as unknown as FactoryProject;
}

const machineNode = (id: string, recipeId = "r", extra: Record<string, unknown> = {}) => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
  ...extra,
});

const edge = (id: string, source: string, target: string, resourceId = "res") => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
});

function throughput(
  nodes: Record<string, NodeThroughputResult>,
  edges: Record<string, EdgeThroughput>,
): ThroughputResult {
  return { nodes, edges, storages: {}, resources: {} } as unknown as ThroughputResult;
}

describe("deriveNodeVerdict", () => {
  it("reads starved with the binding input, shortfall, and upstream machine", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "PE", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "Cracker", machineType: "Steam Cracker", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S", "src"), machineNode("S2", "src")],
      edges: [edge("eEth", "S", "N", "eth"), edge("eOxy", "S2", "N", "oxy")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.18,
          capableUtilization: 0.18,
          demandUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144), "item:oxy": flow("item", "oxy", 1000) },
        }),
      },
      {
        eEth: edgeResult({ transferredPerSecond: 26, availablePerSecond: 26, constraint: "supply" }),
        eOxy: edgeResult({ transferredPerSecond: 180, availablePerSecond: 1000 }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("starved");
    expect(verdict.binding?.resourceKey).toBe("item:eth");
    expect(verdict.binding?.shortfallPerSecond).toBeCloseTo(118, 4);
    expect(verdict.binding?.upstreamName).toBe("Steam Cracker");
  });

  it("names a buffer and a self loop as the upstream culprit", () => {
    const base = {
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
    };
    const starvedResult = (edgeId: string) =>
      throughput(
        {
          N: nodeResult({
            utilization: 0.4,
            capableUtilization: 0.4,
            demandUtilization: 1,
            inputs: { "item:res": flow("item", "res", 10) },
          }),
        },
        { [edgeId]: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }) },
      );

    const viaBuffer = project({
      ...base,
      storages: [
        { id: "T", kind: "item", resourceId: "res", displayName: "Res Drawer" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eT", "T", "N")],
    });
    expect(deriveNodeVerdict(viaBuffer, starvedResult("eT"), "N").binding?.upstreamName).toBe(
      "Res Drawer (buffer)",
    );

    const viaSelf = project({
      ...base,
      nodes: [machineNode("N")],
      edges: [edge("eSelf", "N", "N")],
    });
    expect(deriveNodeVerdict(viaSelf, starvedResult("eSelf"), "N").binding?.upstreamName).toBe(
      "its own loop",
    );
  });

  it("reads choke with the unmet ask and machines to add", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "PE", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N", "r", { machineCount: 4 }), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe"), edge("eIn", "C", "N", "eth")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          capableUtilization: 1,
          demandUtilization: 1,
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eOut: edgeResult({ transferredPerSecond: 216, demandPerSecond: 340 }),
        eIn: edgeResult({ transferredPerSecond: 144, demandPerSecond: 144 }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("choke");
    expect(verdict.deficit?.missingPerSecond).toBeCloseTo(124, 4);
    // 216/s across 4 machines = 54/s each; 124 short needs 3 more.
    expect(verdict.deficit?.machinesToAdd).toBe(3);
  });

  it("ignores storage sinks when looking for downstream hunger", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [
        { id: "T", kind: "item", resourceId: "pe" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eTank", "N", "T", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 1, outputs: { "item:pe": flow("item", "pe", 10) } }) },
      { eTank: edgeResult({ transferredPerSecond: 4, demandPerSecond: 10 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("balanced");
  });

  it("reads demand-set with headroom when downstream asks for less", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.62,
          capableUtilization: 1,
          demandUtilization: 0.62,
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      { eOut: edgeResult({ transferredPerSecond: 134, demandPerSecond: 134 }) },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("demand-set");
    expect(verdict.headroomPct).toBeCloseTo(38, 1);
  });

  it("treats a capability/demand tie below full speed as starved", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S")],
      edges: [edge("eIn", "S", "N", "res")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.6,
          capableUtilization: 0.6,
          demandUtilization: 0.6,
          inputs: { "item:res": flow("item", "res", 10) },
        }),
      },
      { eIn: edgeResult({ transferredPerSecond: 6, availablePerSecond: 6 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("starved");
  });

  it("reads balanced, unwired, and off", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [
        machineNode("N"),
        machineNode("Lonely"),
        machineNode("Dead", "r", { enabled: false }),
        machineNode("C"),
      ],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({ utilization: 1 }),
        Lonely: nodeResult({ nodeId: "Lonely", utilization: 1 }),
        Dead: nodeResult({ nodeId: "Dead", utilization: 0 }),
      },
      { eOut: edgeResult({ transferredPerSecond: 10, demandPerSecond: 10 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("balanced");
    expect(deriveNodeVerdict(proj, result, "Lonely").kind).toBe("unwired");
    expect(deriveNodeVerdict(proj, result, "Dead").kind).toBe("off");
  });
});

describe("buildRailPorts", () => {
  const recipeResources = {
    inputs: [
      { kind: "item", id: "eth", amount: 1 },
      { kind: "item", id: "mold", amount: 1, consumed: false },
    ],
    outputs: [{ kind: "item", id: "pe", amount: 1 }],
  } as unknown as Pick<import("@/lib/model/types").Recipe, "inputs" | "outputs">;

  it("skips non-consumed inputs, pools flows, and flags hand-fed ports", () => {
    const proj = project({
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.5,
          demandUtilization: 0.5,
          capableUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144), "item:mold": flow("item", "mold", 1) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      { eOut: edgeResult({ transferredPerSecond: 108, demandPerSecond: 108 }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(proj, result, "N", recipeResources, verdict);

    expect(rails.inputs.map((port) => port.resourceId)).toEqual(["eth"]);
    expect(rails.inputs[0]!.handFed).toBe(true);
    expect(rails.inputs[0]!.handleId).toBe("input:item:eth");
    expect(rails.outputs[0]!.currentPerSecond).toBeCloseTo(108, 6);
    expect(rails.outputs[0]!.tone).toBe("calm");
  });

  it("marks the binding input and the hungry output", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S"), machineNode("C")],
      edges: [edge("eIn", "S", "N", "eth"), edge("eOut", "N", "C", "pe")],
    });
    const starved = throughput(
      {
        N: nodeResult({
          utilization: 0.18,
          capableUtilization: 0.18,
          demandUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eIn: edgeResult({ transferredPerSecond: 26, availablePerSecond: 26, constraint: "supply" }),
        eOut: edgeResult({ transferredPerSecond: 39, demandPerSecond: 39 }),
      },
    );
    const starvedVerdict = deriveNodeVerdict(proj, starved, "N");
    const starvedRails = buildRailPorts(proj, starved, "N", recipeResources, starvedVerdict);
    expect(starvedRails.inputs[0]!.tone).toBe("bind");
    expect(starvedRails.inputs[0]!.badge?.kind).toBe("short");
    expect(starvedRails.inputs[0]!.fillFraction).toBeCloseTo(26 / 144, 4);

    const choke = throughput(
      {
        N: nodeResult({
          utilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eIn: edgeResult({ transferredPerSecond: 144, availablePerSecond: 144, demandPerSecond: 144 }),
        eOut: edgeResult({ transferredPerSecond: 216, demandPerSecond: 340 }),
      },
    );
    const chokeVerdict = deriveNodeVerdict(proj, choke, "N");
    const chokeRails = buildRailPorts(proj, choke, "N", recipeResources, chokeVerdict);
    expect(chokeRails.outputs[0]!.tone).toBe("hot");
    expect(chokeRails.outputs[0]!.badge?.perSecond).toBeCloseTo(340, 4);
  });
});

describe("splitRailOverflow", () => {
  it("always keeps connected ports visible and caps the rest", () => {
    const port = (id: string, connected: boolean) =>
      ({
        side: "output",
        key: `item:${id}`,
        kind: "item",
        resourceId: id,
        displayName: id,
        handleId: `output:item:${id}`,
        connected,
        handFed: false,
        currentPerSecond: 0,
        nameplatePerSecond: 0,
        fillFraction: 0,
        tone: "ok",
        showNameplate: false,
      }) as import("./node-verdict").RailPort;

    const ports = [
      port("a", false),
      port("b", true),
      port("c", false),
      port("d", false),
      port("e", true),
      port("f", false),
    ];
    const { visible, hidden } = splitRailOverflow(ports, false, 4);
    expect(visible.map((entry) => entry.resourceId)).toEqual(["a", "b", "c", "e"]);
    expect(hidden.map((entry) => entry.resourceId)).toEqual(["d", "f"]);

    expect(splitRailOverflow(ports, true, 4).hidden).toHaveLength(0);
  });
});
