import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "../model/types";
import { calculateThroughput } from "./throughput";
import { expandPool, getPoolGroupResources } from "./pool-mode";
import { normalizeProductionGroups } from "../model/production-groups";
import { parseFactoryProjectJson, serializeFactoryProject } from "../import-export/factory-json";

const recipe = (id: string, inputs: [string, number][], outputs: [string, number][]): Recipe => ({
  id,
  name: id,
  machineType: id,
  durationTicks: 20,
  eut: 30,
  minimumTier: "LV",
  inputs: inputs.map(([id, amount]) => ({ kind: "item", id, amount })),
  outputs: outputs.map(([id, amount]) => ({ kind: "item", id, amount })),
});
function fixture(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "groups",
    name: "Groups",
    solveMode: true,
    poolMode: true,
    productionGroups: [{ id: "line", name: "Line" }],
    fuelProfiles: [],
    edges: [],
    recipes: [
      recipe("producer", [["raw", 1]], [["x", 2]]),
      recipe("inside", [["x", 1]], [["y", 1]]),
      recipe("outside", [["x", 1]], [["z", 1]]),
    ],
    nodes: ["producer", "inside", "outside"].map((id) => ({
      id,
      recipeId: id,
      machineCount: 1,
      parallel: 1,
      enabled: true,
      overclockTier: "LV",
      productionGroupId: id === "outside" ? undefined : "line",
      position: { x: 0, y: 0 },
    })),
    storages: ["y", "z"].map((resourceId) => ({
      id: resourceId,
      kind: "item",
      resourceId,
      poolSide: "drain",
      targetPerSecond: 1,
      position: { x: 0, y: 0 },
    })),
  };
}
const count = (result: ReturnType<typeof calculateThroughput>, id: string) =>
  result.nodes[id].theoreticalMachinesRequired;

describe("production scopes", () => {
  it("keeps a child's intermediate local while importing the outside consumer's input", () => {
    const p = fixture();
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(0.5);
    expect(result.externalInputs.find((r) => r.resourceId === "x")?.deficitPerSecond).toBeCloseTo(
      1,
    );
    const rows = getPoolGroupResources(p, result);
    expect(rows.find((r) => r.groupId === "line" && r.key === "item:x")).toMatchObject({
      route: "local",
      made: 1,
      used: 1,
    });
    expect(rows.find((r) => !r.groupId && r.key === "item:x")).toMatchObject({ made: 0, used: 1 });
  });
  it("Share with parent restores the flat common pool", () => {
    const p = fixture();
    p.productionGroups![0].resourceRules = { "item:x": "share" };
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(1);
    expect(result.externalInputs.some((r) => r.resourceId === "x")).toBe(false);
  });
  it("sharing from a child still balances at its parent", () => {
    const p = fixture();
    p.productionGroups = [
      { id: "parent", name: "Parent" },
      { id: "line", name: "Line", parentId: "parent", resourceRules: { "item:x": "share" } },
    ];
    p.nodes[2].productionGroupId = "parent";
    p.poolResourceRules = { "item:x": "import" };
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(1);
    expect(result.externalInputs.some((r) => r.resourceId === "x")).toBe(false);
  });
  it("a parent's rule cannot undo an existing local child match", () => {
    const p = fixture();
    p.poolResourceRules = { "item:x": "import" };
    expect(count(calculateThroughput(p), "producer")).toBeCloseTo(0.5);
  });
  it("Outside supply permits a pinned producer's shortfall without leaking to another scope", () => {
    const p = fixture();
    p.nodes[0].solvePin = 0.25;
    let result = calculateThroughput(p);
    expect(result.storages.y.targetUnreachable).toBe(true);
    p.productionGroups![0].resourceRules = { "item:x": "import" };
    result = calculateThroughput({ ...p });
    expect(result.storages.y.targetUnreachable).not.toBe(true);
    expect(count(result, "producer")).toBeCloseTo(0.25);
    expect(result.externalInputs.find((r) => r.resourceId === "x")?.deficitPerSecond).toBeCloseTo(
      1.5,
    );
  });
  it("balances a pinned producer through its local consumer without sharing outside", () => {
    const p = fixture();
    p.nodes[0].solvePin = 1;
    const result = calculateThroughput(p);
    expect(result.storages["pool:group:line:item:x"].netPerSecond).toBeCloseTo(0);
    expect(count(result, "inside")).toBeCloseTo(2);
    expect(result.storages.y.producedPerSecond).toBeCloseTo(2);
    expect(result.externalInputs.find((r) => r.resourceId === "x")?.deficitPerSecond).toBeCloseTo(
      1,
    );
  });
  it("can target an intermediate inside its group", () => {
    const p = fixture();
    p.storages!.push({
      id: "x-product",
      kind: "item",
      resourceId: "x",
      poolSide: "drain",
      productionGroupId: "line",
      targetPerSecond: 2,
      position: { x: 0, y: 0 },
    });
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(1.5);
    expect(result.storages["x-product"].producedPerSecond).toBeCloseTo(2);
  });
  it("keeps every recipe of a shared physical machine in its owner's scope", () => {
    const p = fixture();
    p.nodes[1].extraRecipes = [{ recipeId: "outside" }];
    p.nodes.pop();
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(1);
    expect(result.nodes["inside#r1"].theoreticalMachinesRequired).toBeCloseTo(1);
    expect(result.externalInputs.some((r) => r.resourceId === "x")).toBe(false);
  });
  it("creates cell bridges in the local group and keeps them out of the result", () => {
    const p = fixture();
    p.recipes[0].outputs = [
      {
        kind: "item",
        id: "water-cell",
        displayName: "Water Cell",
        amount: 1,
        alternatives: [{ kind: "fluid", id: "water", amount: 1000, displayName: "Water" }],
      },
    ];
    p.recipes[1].inputs = [{ kind: "fluid", id: "water", amount: 500 }];
    p.recipes[2].inputs = [{ kind: "fluid", id: "water", amount: 500 }];
    p.poolCellRatios = { "water-cell": 1000 };
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(0.5);
    expect(
      result.externalInputs.find((r) => r.resourceId === "water")?.deficitPerSecond,
    ).toBeCloseTo(500);
    expect(Object.keys(result.nodes).some((id) => id.startsWith("pool-tank:"))).toBe(false);
  });
  it("can import at the factory even when unpinned producers exist", () => {
    const p = fixture();
    p.productionGroups = [];
    p.nodes = p.nodes.map((n) => ({ ...n, productionGroupId: undefined }));
    p.poolResourceRules = { "item:x": "import" };
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(0);
    expect(result.externalInputs.find((r) => r.resourceId === "x")?.deficitPerSecond).toBeCloseTo(
      2,
    );
  });
  it("solves the same intermediate target independently in two groups", () => {
    const p = fixture();
    p.productionGroups!.push({ id: "second", name: "Second" });
    p.nodes = [p.nodes[0], { ...p.nodes[0], id: "producer-second", productionGroupId: "second" }];
    p.storages = [2, 6].map((targetPerSecond, i) => ({
      id: "target" + i,
      kind: "item",
      resourceId: "x",
      poolSide: "drain",
      targetPerSecond,
      productionGroupId: i ? "second" : "line",
      position: { x: 0, y: 0 },
    }));
    const result = calculateThroughput(p);
    expect(count(result, "producer")).toBeCloseTo(1);
    expect(count(result, "producer-second")).toBeCloseTo(3);
    expect(result.storages.target0.producedPerSecond).toBeCloseTo(2);
    expect(result.storages.target1.producedPerSecond).toBeCloseTo(6);
  });
  it("does not import electricity even with a hand-edited outside rule", () => {
    const p = fixture();
    p.recipes[1].inputs = [{ kind: "power", id: "eu", amount: 100 }];
    p.productionGroups![0].resourceRules = { "power:eu": "import" };
    expect(calculateThroughput(p).storages.y.targetUnreachable).toBe(true);
  });
  it("preserves scopes/rules through JSON and repairs broken parents and memberships", () => {
    const p = fixture();
    p.productionGroups![0].resourceRules = { "item:x": "share" };
    const restored = parseFactoryProjectJson(serializeFactoryProject(p));
    expect(restored.productionGroups).toEqual(p.productionGroups);
    expect(count(calculateThroughput(restored), "producer")).toBeCloseTo(1);
    p.productionGroups = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
      { id: "a", name: "Duplicate" },
    ];
    const repaired = normalizeProductionGroups(p);
    expect(repaired.productionGroups).toHaveLength(2);
    expect(repaired.productionGroups!.every((g) => !g.parentId)).toBe(true);
    expect(repaired.nodes.every((n) => !n.productionGroupId)).toBe(true);
    expect(normalizeProductionGroups(repaired)).toBe(repaired);
    expect(expandPool(expandPool(p).project).project).toBe(expandPool(p).project);
  });
  it("does not change Build or wired Solve behavior", () => {
    const p = fixture();
    p.poolMode = false;
    const grouped = calculateThroughput(p);
    const flat = calculateThroughput({ ...p, productionGroups: undefined });
    expect(grouped).toEqual(flat);
  });
});
