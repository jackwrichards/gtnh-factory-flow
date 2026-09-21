import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "../model/types";
import { calculateThroughput, hasAnySolveNumbers } from "./throughput";
import { parseFactoryProjectJson, serializeFactoryProject } from "../import-export/factory-json";

function fixture(input = -10, output?: number): FactoryProject {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, id: "signed", name: "Signed", poolMode: true, solveMode: true, fuelProfiles: [], edges: [],
    recipes: [{ id: "smelt", name: "Smelt", machineType: "Test", durationTicks: 20, eut: 0, minimumTier: "NONE", inputs: [{ kind: "item", id: "ore", amount: 2 }], outputs: [{ kind: "item", id: "ingot", amount: 1 }] }],
    nodes: [{ id: "smelt", recipeId: "smelt", machineCount: 1, parallel: 1, overclockTier: "NONE", enabled: true, position: { x: 0, y: 0 } }],
    storages: [{ id: "ore", kind: "item", resourceId: "ore", poolSide: "drain", targetPerSecond: input, position: { x: 0, y: 0 } },
      { id: "ingot", kind: "item", resourceId: "ingot", poolSide: "drain", targetPerSecond: output, position: { x: 0, y: 0 } }] };
}

describe("Pool input goals", () => {
  it("sizes machines from exact input consumption with no positive target", () => {
    const p = fixture(); const result = calculateThroughput(p);
    expect(hasAnySolveNumbers(p)).toBe(true);
    expect(result.nodes.smelt.theoreticalMachinesRequired).toBeCloseTo(5);
    expect(result.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(result.storages.ingot.producedPerSecond).toBeCloseTo(5);
    expect(result.storages.ore.targetUnreachable).not.toBe(true);
    expect(p.storages![0].poolSide).toBe("drain");
  });
  it("keeps input exact while allowing surplus above a positive output goal", () => {
    const r = calculateThroughput(fixture(-10, 2));
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(r.storages.ingot.producedPerSecond).toBeCloseTo(5);
  });
  it("reports an output goal beyond the available input and never tops it up through Ignore", () => {
    const p = fixture(-10, 20); p.poolResourceRules = { "item:ore": "import" };
    const r = calculateThroughput(p);
    expect(r.storages.ingot.targetUnreachable).toBe(true);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(r.storages.ingot.producedPerSecond).toBeCloseTo(5);
  });
  it("cannot satisfy an input goal by storing it without a consumer", () => {
    const p = fixture(); p.nodes = [];
    const r = calculateThroughput(p);
    expect(r.storages.ore.targetUnreachable).toBe(true);
    expect(r.storages.ore.consumedPerSecond).toBe(0);
  });
  it("keeps a scoped input goal inside its production group", () => {
    const p = fixture(); p.productionGroups = [{ id: "line", name: "Line" }];
    p.nodes[0].productionGroupId = "line"; p.storages![0].productionGroupId = "line";
    const r = calculateThroughput(p);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(r.nodes.smelt.theoreticalMachinesRequired).toBeCloseTo(5);
  });
  it("uses net fresh input rather than gross consumption when a recipe recycles it", () => {
    const p = fixture(); p.recipes[0].outputs.push({ kind: "item", id: "ore", amount: 1 });
    const r = calculateThroughput(p);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(r.nodes.smelt.theoreticalMachinesRequired).toBeCloseTo(10);
  });
  it("handles fluid input goals", () => {
    const p = fixture(-1000); p.recipes[0].inputs[0].kind = "fluid"; p.recipes[0].inputs[0].amount = 100;
    p.storages![0].kind = "fluid";
    const r = calculateThroughput(p);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(1000);
    expect(r.nodes.smelt.theoreticalMachinesRequired).toBeCloseTo(10);
  });
  it("reports incompatible input ratios without secretly importing the missing material", () => {
    const p = fixture(); p.recipes[0].inputs.push({ kind: "item", id: "flux", amount: 1 });
    p.storages!.push({ ...p.storages![0], id: "flux", resourceId: "flux", targetPerSecond: -8 });
    const r = calculateThroughput(p);
    expect(r.storages.flux.targetUnreachable).toBe(true);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
    expect(r.storages.flux.consumedPerSecond).toBeCloseTo(5);
  });
  it("retains a compatible exact machine pin", () => {
    const p = fixture(); p.nodes[0].solvePin = 5;
    const r = calculateThroughput(p);
    expect(r.storages.ore.targetUnreachable).not.toBe(true);
    expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
  });
  it("does not use a disabled consumer", () => {
    const p = fixture(); p.nodes[0].enabled = false;
    expect(calculateThroughput(p).storages.ore.targetUnreachable).toBe(true);
  });
  it("round trips signed targets and reports missing wires outside Pool", () => {
    const p = fixture(); const parsed = parseFactoryProjectJson(serializeFactoryProject(p));
    expect(parsed.storages![0].targetPerSecond).toBe(-10);
    p.poolMode = false;
    expect(hasAnySolveNumbers(p)).toBe(true);
    expect(calculateThroughput(p).storages.ore.targetUnreachable).toBe(true);
    expect(calculateThroughput(p).nodes.smelt.theoreticalMachinesRequired).toBe(0);
  });
});
