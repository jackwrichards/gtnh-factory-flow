import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "../model/types";
import { calculateThroughput, hasAnySolveNumbers } from "./throughput";
import { parseFactoryProjectJson, serializeFactoryProject } from "../import-export/factory-json";

function fixture(): FactoryProject {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, id: "target-rules", name: "Target rules", poolMode: true, solveMode: true, fuelProfiles: [], edges: [],
    recipes: [{ id: "r", name: "Co-products", machineType: "Test", durationTicks: 20, eut: 0, minimumTier: "NONE", inputs: [{ kind: "item", id: "ore", amount: 1 }], outputs: [{ kind: "item", id: "a", amount: 1 }, { kind: "item", id: "b", amount: 2 }] }],
    nodes: [{ id: "r", recipeId: "r", machineCount: 1, parallel: 1, overclockTier: "NONE", enabled: true, position: { x: 0, y: 0 } }],
    storages: [{ id: "a", kind: "item", resourceId: "a", poolSide: "drain", targetPerSecond: 1, position: { x: 0, y: 0 } },
      { id: "b", kind: "item", resourceId: "b", poolSide: "drain", targetPerSecond: 3, position: { x: 0, y: 0 } }] };
}

describe("Pool target rules", () => {
  it("preserves at-least behavior for existing plans", () => {
    const r = calculateThroughput(fixture());
    expect(r.nodes.r.theoreticalMachinesRequired).toBeCloseTo(1.5);
    expect(r.storages.a.producedPerSecond).toBeCloseTo(1.5);
  });
  it("enforces exact output without hiding surplus in the intermediate pool", () => {
    const p = fixture(); p.storages![0].poolTargetMode = "exact";
    const r = calculateThroughput(p);
    expect(r.storages.b.targetUnreachable).toBe(true);
    expect(r.storages.a.producedPerSecond).toBeCloseTo(1);
    expect(r.nodes.r.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(r.unconsumedOutputs.find(row => row.resourceId === "a")?.surplusPerSecond ?? 0).toBeCloseTo(1);
  });
  it("cannot bypass an exact goal through an additional byproduct drawer", () => {
    const p = fixture(); p.storages![0].poolTargetMode = "exact";
    p.storages!.push({ ...p.storages![0], id: "spare", drainMode: "byproduct", poolTargetMode: undefined, targetPerSecond: undefined });
    const r = calculateThroughput(p);
    expect(r.storages.b.targetUnreachable).toBe(true);
    expect(r.nodes.r.theoreticalMachinesRequired).toBeCloseTo(1);
  });
  it("keeps ignored rates saved but lets other products size the machines", () => {
    const p = fixture(); p.storages![1].poolTargetMode = "ignore";
    const r = calculateThroughput(p);
    expect(r.nodes.r.theoreticalMachinesRequired).toBeCloseTo(1);
    expect(r.storages.b.producedPerSecond).toBeCloseTo(2);
    expect(r.storages.b.targetUnreachable).not.toBe(true);
    expect(p.storages![1].targetPerSecond).toBe(3);
  });
  it("does not treat ignored targets as an active solve request", () => {
    const p = fixture(); for (const s of p.storages!) s.poolTargetMode = "ignore";
    expect(hasAnySolveNumbers(p)).toBe(false);
    expect(calculateThroughput(p).nodes.r.theoreticalMachinesRequired).toBe(0);
  });
  it("supports zero exact output, preventing unwanted co-production", () => {
    const p = fixture(); p.storages![0].poolTargetMode = "exact"; p.storages![0].targetPerSecond = 0;
    const r = calculateThroughput(p);
    expect(r.storages.a.targetUnreachable).not.toBe(true);
    expect(r.storages.b.targetUnreachable).toBe(true);
    expect(r.nodes.r.theoreticalMachinesRequired).toBe(0);
  });
  it("ignores a negative input goal without supplying free extra input", () => {
    const p = fixture(); p.storages!.push({ id: "ore", kind: "item", resourceId: "ore", poolSide: "drain", targetPerSecond: -100, poolTargetMode: "ignore", position: { x: 0, y: 0 } });
    const r = calculateThroughput(p);
    expect(r.nodes.r.theoreticalMachinesRequired).toBeCloseTo(1.5);
    expect(r.storages.ore.targetUnreachable).not.toBe(true);
  });
  it("reports an exact positive target with no producer", () => {
    const p = fixture(); p.nodes = []; p.storages![0].poolTargetMode = "exact";
    expect(calculateThroughput(p).storages.a.targetUnreachable).toBe(true);
  });
  it("reports an exact target that conflicts with a pinned machine count", () => {
    const p = fixture(); p.nodes[0].solvePin = 2; p.storages![0].poolTargetMode = "exact";
    const r = calculateThroughput(p);
    expect(r.storages.a.targetUnreachable).toBe(true);
    expect(r.bottlenecks.some(b => b.id === "solve-pins")).toBe(true);
  });
  it("keeps exact goals in their scoped group", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Line" }];
    p.nodes[0].productionGroupId = "line";
    p.storages![0].productionGroupId = "line"; p.storages![0].poolTargetMode = "exact";
    expect(calculateThroughput(p).storages.b.targetUnreachable).toBe(true);
  });
  it("round trips target rules and keeps them dormant in wired Solve", () => {
    const p = fixture(); p.storages![0].poolTargetMode = "exact"; p.storages![1].poolTargetMode = "ignore";
    const parsed = parseFactoryProjectJson(serializeFactoryProject(p));
    expect(parsed.storages!.map(s => s.poolTargetMode)).toEqual(["exact", "ignore"]);
    p.poolMode = false;
    p.storages!.push({ id: "ore", kind: "item", resourceId: "ore", position: { x: 0, y: 0 } });
    p.edges = [{ id: "in", source: "ore", target: "r", resourceKind: "item", resourceId: "ore" },
      ...["a", "b"].map(id => ({ id, source: "r", target: id, resourceKind: "item" as const, resourceId: id }))];
    expect(calculateThroughput(p).nodes.r.theoreticalMachinesRequired).toBeCloseTo(1.5);
  });
});
