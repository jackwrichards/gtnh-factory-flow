import { describe, expect, it } from "vitest";
import { buildMachineList, formatMachineListCount } from "./machine-list";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "./types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { closeBoundaries } from "@/lib/solver/close-boundaries";

const light: Recipe = {
  id: "light",
  name: "Copper Plate",
  machineType: "Bender",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 8,
  inputs: [{ kind: "item", id: "copper", amount: 1 }],
  outputs: [{ kind: "item", id: "plate", displayName: "Copper Plate", amount: 1 }],
};
const heavy: Recipe = {
  ...light,
  id: "heavy",
  name: "Dense Copper Plate",
  eut: 24,
  outputs: [{ kind: "item", id: "dense", displayName: "Dense Copper Plate", amount: 1 }],
};
function project(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "machine-list",
    name: "Machine list",
    fuelProfiles: [],
    recipes: [light, heavy],
    edges: [],
    nodes: ["light", "light", "heavy"].map((recipeId, index) => ({
      id: `n${index}`,
      recipeId,
      machineCount: [2, 3, 4][index]!,
      parallel: 1,
      enabled: true,
      overclockTier: "LV",
      position: { x: index * 400, y: 0 },
    })),
  };
}

describe("the machine list follows each board card", () => {
  it("keeps identical machines/recipes separate and scales each card's own draw", () => {
    const p = closeBoundaries(project());
    const lines = buildMachineList(p, calculateThroughput(p));
    expect(lines).toHaveLength(3);
    expect(lines.find((line) => line.nodeId === "n0")).toMatchObject({
      count: 2,
      euT: 16,
      avgEuT: 16,
    });
    expect(lines.find((line) => line.nodeId === "n1")).toMatchObject({
      count: 3,
      euT: 24,
      avgEuT: 24,
    });
    expect(lines.find((line) => line.nodeId === "n2")).toMatchObject({
      count: 4,
      euT: 96,
      avgEuT: 96,
    });
    expect(lines.reduce((sum, line) => sum + line.count, 0)).toBe(9);
  });

  it.each([false, true])(
    "uses fractional solved counts below and above the stored count (pool=%s)",
    (poolMode) => {
      const p = closeBoundaries({ ...project(), solveMode: true, poolMode });
      [0.125, 6.25, 101.375].forEach((count, index) => {
        p.nodes[index]!.solvePin = count;
      });
      const result = calculateThroughput(p);
      const lines = buildMachineList(p, result);
      for (const [index, count] of [0.125, 6.25, 101.375].entries()) {
        const line = lines.find((entry) => entry.nodeId === `n${index}`)!;
        expect(line.count).toBeCloseTo(count);
        expect(line.euT).toBeCloseTo(count * (index === 2 ? 24 : 8));
        expect(line.avgEuT).toBeCloseTo(line.euT!);
        expect(line.avgEuT).toBeCloseTo(result.nodes[line.nodeId]!.euT);
      }
      expect(lines.reduce((sum, line) => sum + line.euT!, 0)).toBeCloseTo(result.totalEuT);
    },
  );

  it("retains zero-demand cards at zero and does not bill retained nameplate results", () => {
    const p = closeBoundaries({ ...project(), solveMode: true });
    const lines = buildMachineList(p, calculateThroughput(p));
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.count === 0 && line.euT === 0 && line.avgEuT === 0)).toBe(
      true,
    );
  });

  it("does not count parallel operations as more machines", () => {
    const p = closeBoundaries(project());
    p.nodes[0]!.parallel = 4;
    const line = buildMachineList(p, calculateThroughput(p)).find(
      (entry) => entry.nodeId === "n0",
    )!;
    expect(line.count).toBe(2);
    expect(line.euT).toBe(64);
  });

  it("keeps shared recipes on one card and weights their different draws correctly", () => {
    const p = project();
    p.nodes = [{ ...p.nodes[0]!, extraRecipes: [{ recipeId: "heavy" }] }];
    const result = calculateThroughput(p);
    // A shared card spends 25% on 8 EU/t and 75% on 24 EU/t.
    result.nodes.n0!.utilization = 0.25;
    result.nodes["n0#r1"]!.utilization = 0.75;
    expect(buildMachineList(p, result)).toEqual([
      expect.objectContaining({ count: 2, euT: 48, avgEuT: 40 }),
    ]);
    p.solveMode = true;
    result.nodes.n0!.theoreticalMachinesRequired = 0.25;
    result.nodes["n0#r1"]!.theoreticalMachinesRequired = 0.5;
    result.nodes.n0!.utilization = result.nodes["n0#r1"]!.utilization = 1;
    expect(buildMachineList(p, result)).toEqual([
      expect.objectContaining({ count: 0.75, euT: 18, avgEuT: 14 }),
    ]);
  });

  it("weights generation and steam by solved counts too", () => {
    const p = project();
    p.solveMode = true;
    p.recipes = [
      { ...light, id: "power", eut: 0, power: { sourceId: "test", euPerTick: 32, stats: [] } },
      { ...light, id: "steam", machineType: "Steam Grinder" },
    ];
    p.nodes = [
      { ...p.nodes[0]!, recipeId: "power" },
      { ...p.nodes[1]!, recipeId: "steam" },
    ];
    const result = calculateThroughput(p);
    result.nodes.n0!.theoreticalMachinesRequired = 2.5;
    result.nodes.n1!.theoreticalMachinesRequired = 0.125;
    const lines = buildMachineList(p, result);
    expect(lines.find((entry) => entry.nodeId === "n0")).toMatchObject({
      count: 2.5,
      madeEuT: 80,
      avgMadeEuT: 80,
    });
    const steam = lines.find((entry) => entry.nodeId === "n1")!;
    expect(steam.count).toBe(0.125);
    expect(steam.steamLs).toBeGreaterThan(0);
    expect(steam.avgSteamLs).toBe(steam.steamLs);
    expect(steam.euT).toBeUndefined();
  });

  it("keeps fractional counts above 100 and never displays a positive sliver as zero", () => {
    expect(formatMachineListCount(101.375)).toBe("101.375");
    expect(formatMachineListCount(0.00001)).toBe("0.00001");
    expect(formatMachineListCount(0.0000001)).toBe("<0.000001");
    expect(formatMachineListCount(0)).toBe("0");
  });
});

describe("power card tiers in the machine list", () => {
  it("never reads a heat exchanger's pipe tier as a voltage", async () => {
    // Player crash report, 2026-09-25: an LHE stores `tier: "1"` (its pipe
    // tier), and the MACHINES panel looked "1" up in the voltage colours.
    const { buildPowerRecipe } = await import("@/lib/power/power-recipe");
    const lheSettings = { fluid: "Hot Coolant", intake: "1000", tier: "1" };
    const turbineSettings = { tier: "EV" };
    const lhe = buildPowerRecipe("large-heat-exchanger", lheSettings, "r-lhe")!;
    const turbine = buildPowerRecipe("steam-turbine", turbineSettings, "r-turbine")!;
    const p: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-tiers",
      name: "Power tiers",
      fuelProfiles: [],
      recipes: [lhe, turbine],
      edges: [],
      nodes: [
        { id: "lhe", recipeId: "r-lhe", machineCount: 100, parallel: 1, enabled: true, overclockTier: "EV", position: { x: 0, y: 0 }, machineConfigTiers: lheSettings },
        { id: "turbine", recipeId: "r-turbine", machineCount: 1, parallel: 1, enabled: true, overclockTier: "EV", position: { x: 400, y: 0 }, machineConfigTiers: turbineSettings },
      ],
    };
    const lines = buildMachineList(p, calculateThroughput(p));
    expect(lines.find((line) => line.nodeId === "lhe")?.tier).toBeUndefined();
    expect(lines.find((line) => line.nodeId === "turbine")?.tier).toBe("EV");
  });
});
