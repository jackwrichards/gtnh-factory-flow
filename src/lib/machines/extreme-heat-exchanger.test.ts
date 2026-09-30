import { describe, expect, it } from "vitest";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type FactoryStorage,
  type Recipe,
} from "@/lib/model/types";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { calculateThroughput } from "@/lib/solver/throughput";

/**
 * MTEExtremeHeatExchanger runs a fixed 20-tick cycle and drains up to the
 * recipe's hot fluid once per cycle, so the recipe's amounts are per second.
 * The dataset's recipes say one tick (the Java recipe has no duration), and
 * their runtime ladder repeats it; neither may set the machine's pace.
 */

// The 2.9 dataset's Helium Plasma recipe as exported: one tick, 0 EU, and a
// runtime variant that repeats the tick.
const heliumPlasma: Recipe = {
  id: "ehe-helium-plasma",
  name: "Extreme Heat Exchanger: Dense Supercritical Steam",
  machineType: "Extreme Heat Exchanger",
  minimumTier: "ULV",
  durationTicks: 1,
  eut: 0,
  specialValue: 1,
  inputs: [
    { kind: "fluid", id: "plasma.helium", amount: 500 },
    { kind: "fluid", id: "ic2distilledwater", amount: 230_400 },
  ],
  outputs: [
    { kind: "fluid", id: "densesupercriticalsteam", amount: 36_864 },
    { kind: "fluid", id: "helium", amount: 500 },
  ],
  source: { recipeMap: "Extreme Heat Exchanger" },
  metadata: { recipeMapId: "gg.recipe.extreme_heat_exchanger", specialValue: 1 },
  runtimeCalculation: {
    sourceKind: "gregtech-overclock-calculator",
    status: "computed",
    oracleEligible: true,
    strict: true,
    variants: [
      { id: "tier-ulv", overclockTier: "ULV", durationTicks: 1, eut: 0, parallel: 1 },
      { id: "tier-lv", overclockTier: "LV", durationTicks: 1, eut: 0, parallel: 1 },
      { id: "tier-iv", overclockTier: "IV", durationTicks: 1, eut: 0, parallel: 1 },
    ],
  },
} as Recipe;

function node(machineCount = 1, overclockTier = "LV") {
  return {
    id: "ehe",
    recipeId: heliumPlasma.id,
    machineCount,
    parallel: 1,
    overclockTier,
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string, extra?: Partial<FactoryStorage>): FactoryStorage {
  return { id, kind: "fluid", resourceId, position: { x: 0, y: 0 }, ...extra };
}

function wire(source: string, target: string, resourceId: string) {
  return { id: `${source}-${target}`, source, target, resourceKind: "fluid" as const, resourceId };
}

/** Helium plasma and water in, dense steam and helium out, all on drawers. */
function heliumBoard(over: Partial<FactoryProject>, heliumTarget?: number): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "ehe-board",
    name: "ehe-board",
    recipes: [heliumPlasma],
    nodes: [node()],
    storages: [
      drawer("plasma", "plasma.helium"),
      drawer("water", "ic2distilledwater"),
      drawer("steam", "densesupercriticalsteam"),
      drawer("helium", "helium", heliumTarget === undefined ? undefined : { targetPerSecond: heliumTarget }),
    ],
    edges: [
      wire("plasma", "ehe", "plasma.helium"),
      wire("water", "ehe", "ic2distilledwater"),
      wire("ehe", "steam", "densesupercriticalsteam"),
      wire("ehe", "helium", "helium"),
    ],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

const HOUR = 3600;

describe("Extreme Heat Exchanger", () => {
  it.each([1, 20, 200])("runs a %i-tick recipe on its 20-tick cycle", (durationTicks) => {
    const recipe = { ...heliumPlasma, durationTicks };
    expect(applyMachineHandlerToRecipe(recipe, { machineHandlerId: undefined }).durationTicks).toBe(20);
    for (const tier of ["ULV", "LV", "IV", "MAX"]) {
      const stats = getOverclockedRecipeStats(recipe, node(1, tier));
      expect(stats.durationTicks).toBe(20);
      expect(stats.overclockSteps).toBe(0);
      expect(stats.eut).toBe(0);
    }
  });

  it("takes 20 machines for 36M L/hr of helium plasma", () => {
    // The player's board: 36M L/hr of plasma read as one machine at 100%.
    const result = calculateThroughput(
      heliumBoard({ solveMode: true }, 36_000_000 / HOUR),
      { generatedAt: "fixed" },
    );
    const ehe = result.nodes["ehe"]!;
    expect(ehe.theoreticalMachinesRequired).toBeCloseTo(20, 6);
    expect(ehe.inputs["fluid:plasma.helium"]!.amountPerSecond * HOUR).toBeCloseTo(36_000_000, 0);
    // 230,400 L/s of water a machine: 16.59G L/hr for the twenty.
    expect(ehe.inputs["fluid:ic2distilledwater"]!.amountPerSecond).toBeCloseTo(4_608_000, 0);
    expect(ehe.outputs["fluid:densesupercriticalsteam"]!.amountPerSecond).toBeCloseTo(737_280, 0);
    expect(ehe.outputs["fluid:helium"]!.amountPerSecond * HOUR).toBeCloseTo(36_000_000, 0);
  });

  it("drains 500 L/s of helium plasma per built machine", () => {
    const one = calculateThroughput(heliumBoard({}), { generatedAt: "fixed" }).nodes["ehe"]!;
    expect(one.operationRatePerSecond).toBe(1);
    expect(one.inputs["fluid:plasma.helium"]!.amountPerSecond).toBe(500);
    expect(one.inputs["fluid:ic2distilledwater"]!.amountPerSecond).toBe(230_400);
    expect(one.outputs["fluid:densesupercriticalsteam"]!.amountPerSecond).toBe(36_864);

    const twenty = calculateThroughput(
      heliumBoard({ nodes: [node(20)] }),
      { generatedAt: "fixed" },
    ).nodes["ehe"]!;
    expect(twenty.inputs["fluid:plasma.helium"]!.amountPerSecond).toBe(10_000);
  });
});
