import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "../model/types";
import { calculateThroughput } from "./throughput";
import { parseFactoryProjectJson, serializeFactoryProject } from "../import-export/factory-json";

function fixture(poolMode: boolean): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "rates",
    name: "Rates",
    poolMode,
    solveMode: true,
    fuelProfiles: [],
    recipes: [
      {
        id: "smelt",
        name: "Smelt",
        machineType: "Test",
        durationTicks: 20,
        eut: 0,
        minimumTier: "NONE",
        inputs: [{ kind: "item", id: "ore", amount: 2 }],
        outputs: [{ kind: "item", id: "ingot", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "smelt",
        recipeId: "smelt",
        machineCount: 1,
        enabled: true,
        parallel: 1,
        overclockTier: "NONE",
        position: { x: 160, y: 0 },
      },
    ],
    storages: [
      {
        id: "ore",
        kind: "item",
        resourceId: "ore",
        position: { x: 0, y: 0 },
        targetPerSecond: -10,
        targetMode: "exact",
      },
      { id: "ingot", kind: "item", resourceId: "ingot", position: { x: 320, y: 0 } },
    ],
    edges: [
      { id: "in", source: "ore", target: "smelt", resourceKind: "item", resourceId: "ore" },
      { id: "out", source: "smelt", target: "ingot", resourceKind: "item", resourceId: "ingot" },
    ],
  };
}
for (const pool of [false, true])
  describe(pool ? "Pool shared rates" : "Wired Solve shared rates", () => {
    it("sizes machinery from a source alone", () => {
      const p = fixture(pool);
      const r = calculateThroughput(p);
      expect(r.nodes.smelt.theoreticalMachinesRequired).toBeCloseTo(5);
      expect(r.storages.ore.consumedPerSecond).toBeCloseTo(10);
      expect(r.storages.ingot.producedPerSecond).toBeCloseTo(5);
    });
    it("allows unused supply under an input ceiling", () => {
      const p = fixture(pool);
      p.storages![0].targetMode = "at-most";
      p.storages![1].targetPerSecond = 3;
      const r = calculateThroughput(p);
      expect(r.storages.ore.consumedPerSecond).toBeCloseTo(6);
      expect(r.storages.ingot.producedPerSecond).toBeCloseTo(3);
      expect(r.storages.ingot.targetUnreachable).not.toBe(true);
    });
    it("caps output without hiding surplus in Pool", () => {
      const p = fixture(pool);
      p.storages![1].targetMode = "at-most";
      p.storages![1].targetPerSecond = 3;
      const r = calculateThroughput(p);
      expect(r.storages.ingot.producedPerSecond).toBe(0);
      expect(r.storages.ore.consumedPerSecond).toBe(0);
      expect(r.storages.ore.targetUnreachable).toBe(true);
    });
    it("permits zero output ceilings", () => {
      const p = fixture(pool);
      p.storages![1].targetMode = "at-most";
      p.storages![1].targetPerSecond = 0;
      const r = calculateThroughput(p);
      expect(r.storages.ingot.producedPerSecond).toBe(0);
      expect(r.storages.ore.consumedPerSecond).toBe(0);
      expect(r.storages.ore.targetUnreachable).toBe(true);
    });
    it("does not turn a ceiling into a production demand", () => {
      const p = fixture(pool);
      p.storages![0].targetMode = "at-most";
      expect(calculateThroughput(p).nodes.smelt.theoreticalMachinesRequired).toBe(0);
    });
    it("enforces zero input and never tops up through a Pool supply override", () => {
      const p = fixture(pool);
      p.storages![0].targetPerSecond = 0;
      p.storages![0].targetMode = "at-most";
      p.storages![1].targetPerSecond = 3;
      p.poolResourceRules = { "item:ore": "import" };
      const r = calculateThroughput(p);
      expect(r.storages.ore.consumedPerSecond).toBe(0);
      expect(r.storages.ingot.targetUnreachable).toBe(true);
    });
    it("allows input above a minimum", () => {
      const p = fixture(pool);
      p.storages![0].targetMode = "at-least";
      p.storages![1].targetPerSecond = 8;
      const r = calculateThroughput(p);
      expect(r.storages.ore.consumedPerSecond).toBeCloseTo(16);
      expect(r.storages.ingot.targetUnreachable).not.toBe(true);
    });
    it("ignores a source rate while keeping the source available", () => {
      const p = fixture(pool);
      p.storages![0].targetMode = "ignore";
      p.storages![1].targetPerSecond = 8;
      const r = calculateThroughput(p);
      expect(r.storages.ore.consumedPerSecond).toBeCloseTo(16);
      expect(r.storages.ore.targetUnreachable).not.toBe(true);
      expect(p.storages![0].targetPerSecond).toBe(-10);
    });
    it("reports a conflicting exact output and input", () => {
      const p = fixture(pool);
      p.storages![1].targetPerSecond = 3;
      p.storages![1].targetMode = "exact";
      const r = calculateThroughput(p);
      expect(r.storages.ore.targetUnreachable).toBe(true);
      expect(r.storages.ingot.producedPerSecond).toBeCloseTo(3);
    });
    it("ignores an output target", () => {
      const p = fixture(pool);
      p.storages![0].targetPerSecond = undefined;
      p.storages![1].targetPerSecond = 100;
      p.storages![1].targetMode = "ignore";
      expect(calculateThroughput(p).nodes.smelt.theoreticalMachinesRequired).toBe(0);
    });
    it("keeps limits during conflicting machine-pin diagnostics", () => {
      const p = fixture(pool);
      p.storages![0].targetMode = "at-most";
      p.nodes[0].solvePin = 6;
      const r = calculateThroughput(p);
      expect(r.bottlenecks.some((b) => b.id === "solve-pins")).toBe(true);
      expect(r.storages.ore.consumedPerSecond).toBeLessThanOrEqual(10);
    });
  });
it("preserves rates, rules and wires through JSON and mode switches; Build does not enforce targets", () => {
  const p = fixture(false);
  p.storages![0].targetMode = "at-most";
  p.storages![1].targetPerSecond = 3;
  const loaded = parseFactoryProjectJson(serializeFactoryProject(p));
  for (const poolMode of [true, false]) {
    loaded.poolMode = poolMode;
    expect(calculateThroughput(loaded).storages.ore.consumedPerSecond).toBeCloseTo(6);
    expect(loaded.edges).toEqual(p.edges);
  }
  loaded.solveMode = false;
  loaded.storages![0].targetPerSecond = 0;
  expect(calculateThroughput(loaded).storages.ore.consumedPerSecond).toBeCloseTo(2);
});
