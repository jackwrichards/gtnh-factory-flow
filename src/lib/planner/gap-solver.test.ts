import { describe, expect, it } from "vitest";
import { getResourceKey } from "@/lib/model/resources";
import type { PlannerResource, RecipeProducerLookup, SolverRecipe } from "./types";
import { solveGapFill } from "./gap-solver";

function recipe(partial: Partial<SolverRecipe> & Pick<SolverRecipe, "id" | "name">): SolverRecipe {
  return {
    machineType: "Machine",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [],
    outputs: [],
    ...partial,
  };
}

const fixtureRecipes: SolverRecipe[] = [
  recipe({
    id: "lcr-pe-oxygen",
    name: "LCR: Polyethylene (oxygen)",
    machineType: "Large Chemical Reactor",
    minimumTier: "HV",
    eut: 480,
    inputs: [
      { kind: "fluid", id: "ethylene", amount: 144, displayName: "Ethylene" },
      { kind: "fluid", id: "oxygen", amount: 1000, displayName: "Oxygen" },
    ],
    outputs: [{ kind: "fluid", id: "polyethylene", amount: 216, displayName: "Polyethylene" }],
  }),
  recipe({
    id: "lcr-pe-air",
    name: "LCR: Polyethylene (air)",
    machineType: "Large Chemical Reactor",
    minimumTier: "HV",
    eut: 480,
    inputs: [
      { kind: "fluid", id: "ethylene", amount: 144, displayName: "Ethylene" },
      { kind: "fluid", id: "air", amount: 4000, displayName: "Air" },
    ],
    outputs: [{ kind: "fluid", id: "polyethylene", amount: 144, displayName: "Polyethylene" }],
  }),
  recipe({
    id: "packer-pe",
    name: "Packager: Polyethylene",
    machineType: "Packager",
    inputs: [{ kind: "item", id: "pe-pellet", amount: 1 }],
    outputs: [{ kind: "fluid", id: "polyethylene", amount: 9999, displayName: "Polyethylene" }],
  }),
  recipe({
    id: "distillery-ethylene",
    name: "Distillery: Ethylene",
    machineType: "Distillery",
    minimumTier: "MV",
    eut: 120,
    inputs: [{ kind: "fluid", id: "ethanol", amount: 1000, displayName: "Ethanol" }],
    outputs: [{ kind: "fluid", id: "ethylene", amount: 300, displayName: "Ethylene" }],
  }),
  recipe({
    id: "cracker-ethylene",
    name: "Cracker: Ethylene",
    machineType: "Oil Cracking Unit",
    minimumTier: "HV",
    eut: 480,
    inputs: [{ kind: "fluid", id: "naphtha", amount: 1000, displayName: "Naphtha" }],
    outputs: [{ kind: "fluid", id: "ethylene", amount: 500, displayName: "Ethylene" }],
  }),
  recipe({
    id: "fermenter-ethanol",
    name: "Fermenter: Ethanol",
    machineType: "Fermenter",
    minimumTier: "LV",
    eut: 30,
    inputs: [{ kind: "fluid", id: "biomass", amount: 1000, displayName: "Biomass" }],
    outputs: [{ kind: "fluid", id: "ethanol", amount: 600, displayName: "Ethanol" }],
  }),
  recipe({
    id: "electrolyzer-water",
    name: "Electrolyzer: Water",
    machineType: "Electrolyzer",
    minimumTier: "LV",
    eut: 30,
    inputs: [{ kind: "fluid", id: "water", amount: 1000, displayName: "Water" }],
    outputs: [
      { kind: "fluid", id: "hydrogen", amount: 1000, displayName: "Hydrogen" },
      { kind: "fluid", id: "oxygen", amount: 500, displayName: "Oxygen" },
    ],
  }),
  recipe({
    id: "electrolyzer-salt",
    name: "Electrolyzer: Salt",
    machineType: "Electrolyzer",
    minimumTier: "LV",
    eut: 30,
    inputs: [{ kind: "item", id: "salt", amount: 2, displayName: "Salt" }],
    outputs: [
      { kind: "item", id: "sodium", amount: 1, displayName: "Sodium" },
      { kind: "fluid", id: "chlorine", amount: 250, displayName: "Chlorine", byproduct: true },
    ],
  }),
  recipe({
    id: "chem-x",
    name: "Chemical Reactor: X",
    machineType: "Chemical Reactor",
    minimumTier: "MV",
    eut: 120,
    inputs: [
      { kind: "item", id: "sodium", amount: 1, displayName: "Sodium" },
      { kind: "fluid", id: "chlorine", amount: 125, displayName: "Chlorine" },
    ],
    outputs: [{ kind: "item", id: "x", amount: 1, displayName: "X" }],
  }),
  recipe({
    id: "a-from-b",
    name: "Mixer: A",
    machineType: "Mixer",
    inputs: [{ kind: "fluid", id: "loop-b", amount: 100 }],
    outputs: [{ kind: "fluid", id: "loop-a", amount: 100 }],
  }),
  recipe({
    id: "b-from-a",
    name: "Mixer: B",
    machineType: "Mixer",
    inputs: [{ kind: "fluid", id: "loop-a", amount: 100 }],
    outputs: [{ kind: "fluid", id: "loop-b", amount: 100 }],
  }),
  recipe({
    id: "coke-oven-any-log",
    name: "Coke Oven: Charcoal",
    machineType: "Coke Oven",
    minimumTier: "ULV",
    eut: 0,
    inputs: [{ kind: "item", id: "minecraft:log@32767", amount: 16, displayName: "Oak Log" }],
    outputs: [{ kind: "item", id: "charcoal", amount: 20, displayName: "Charcoal" }],
  }),
  recipe({
    id: "assembler-gearbox-steel",
    name: "Assembler: Gearbox (steel)",
    machineType: "Assembler",
    minimumTier: "LV",
    inputs: [{ kind: "item", id: "steel-gear", amount: 4, displayName: "Steel Gear" }],
    outputs: [{ kind: "item", id: "gearbox", amount: 1, displayName: "Gearbox" }],
  }),
  recipe({
    id: "assembler-gearbox-bronze",
    name: "Assembler: Gearbox (bronze)",
    machineType: "Assembler",
    minimumTier: "UV",
    inputs: [{ kind: "item", id: "bronze-gear", amount: 4, displayName: "Bronze Gear" }],
    outputs: [{ kind: "item", id: "gearbox", amount: 1, displayName: "Gearbox" }],
  }),
  recipe({
    id: "smelter-steel-gear",
    name: "Smelter: Steel Gear",
    machineType: "Smelter",
    minimumTier: "LV",
    inputs: [{ kind: "item", id: "iron-ore", amount: 8, displayName: "Iron Ore" }],
    outputs: [{ kind: "item", id: "steel-gear", amount: 1, displayName: "Steel Gear" }],
  }),
];

function fixtureLookup(recipes: SolverRecipe[] = fixtureRecipes): RecipeProducerLookup {
  const byOutputKey = new Map<string, SolverRecipe[]>();
  for (const entry of recipes) {
    for (const output of entry.outputs) {
      const key = getResourceKey(output);
      byOutputKey.set(key, [...(byOutputKey.get(key) ?? []), entry]);
    }
  }

  return {
    getProducers: (resource) => byOutputKey.get(getResourceKey(resource)) ?? [],
  };
}

function supply(...ids: Array<[PlannerResource["kind"], string]>): PlannerResource[] {
  return ids.map(([kind, id]) => ({ kind, id, displayName: id }));
}

describe("solveGapFill", () => {
  it("closes polyethylene from biomass and water and gets the rates right", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: supply(["fluid", "biomass"], ["fluid", "water"]),
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(true);
    expect(plan?.steps.map((step) => step.recipe.id)).toEqual([
      "lcr-pe-oxygen",
      "distillery-ethylene",
      "fermenter-ethanol",
      "electrolyzer-water",
    ]);

    // 216 PE/s = 1 op/s at the root; 144 L/s ethylene → distillery at 0.48
    // op/s; 480 L/s ethanol → fermenter at 0.8 op/s; 1000 L/s oxygen → two
    // water electrolyzers.
    const [root, distillery, fermenter, electrolyzer] = plan!.steps;
    expect(root.operationsPerSecond).toBeCloseTo(1, 6);
    expect(distillery.operationsPerSecond).toBeCloseTo(0.48, 6);
    expect(fermenter.operationsPerSecond).toBeCloseTo(0.8, 6);
    expect(electrolyzer.operationsPerSecond).toBeCloseTo(2, 6);
    expect(electrolyzer.machineCount).toBe(2);

    const draws = new Map(
      plan!.stats.supplyDraws.map((draw) => [draw.id, draw.ratePerSecond]),
    );
    expect(draws.get("biomass")).toBeCloseTo(800, 5);
    expect(draws.get("water")).toBeCloseTo(2000, 5);
  });

  it("offers the alternative root as a second, honestly-unclosed plan", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: supply(["fluid", "biomass"], ["fluid", "water"]),
      },
      fixtureLookup(),
    );

    expect(result.plans).toHaveLength(2);
    const airPlan = result.plans[1];
    expect(airPlan?.closed).toBe(false);
    expect(airPlan?.missing.map((entry) => entry.id)).toEqual(["air"]);
  });

  it("never routes through degenerate maps like the packager", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: supply(["fluid", "biomass"], ["fluid", "water"]),
      },
      fixtureLookup(),
    );

    for (const plan of result.plans) {
      expect(plan.steps.every((step) => step.recipe.id !== "packer-pe")).toBe(true);
    }
  });

  it("terminates on a two-recipe cycle and reports the gap", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "loop-a", displayName: "A", amountPerSecond: 100 },
        supply: [],
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(false);
    expect(plan?.missing.map((entry) => entry.id)).toContain("loop-b");
  });

  it("reuses one producer step when its byproducts satisfy several inputs", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "item", id: "x", displayName: "X", amountPerSecond: 1 },
        supply: supply(["item", "salt"]),
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(true);
    expect(plan?.steps.map((step) => step.recipe.id)).toEqual(["chem-x", "electrolyzer-salt"]);

    const chemStep = plan!.steps[0];
    const sourceSteps = chemStep.inputs.map((input) =>
      input.source.type === "step" ? input.source.stepIndex : -1,
    );
    expect(sourceSteps).toEqual([1, 1]);

    // Sodium needs 1 op/s, chlorine only 0.5; the shared step runs at the max.
    expect(plan!.steps[1].operationsPerSecond).toBeCloseTo(1, 6);
    expect(plan!.stats.supplyDraws[0]?.ratePerSecond).toBeCloseTo(2, 6);
  });

  it("backtracks off a dead-end candidate onto one that closes", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "item", id: "gearbox", displayName: "Gearbox", amountPerSecond: 1 },
        supply: supply(["item", "bronze-gear"]),
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(true);
    expect(plan?.steps.map((step) => step.recipe.id)).toEqual(["assembler-gearbox-bronze"]);
  });

  it("prefers tapping production the plan already has", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: supply(["fluid", "water"]),
        existingOutputs: [
          {
            kind: "fluid",
            id: "ethylene",
            displayName: "Ethylene",
            nodeId: "node-existing-ethylene",
            availablePerSecond: 300,
          },
        ],
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(true);
    expect(plan?.steps.map((step) => step.recipe.id)).toEqual([
      "lcr-pe-oxygen",
      "electrolyzer-water",
    ]);
    expect(plan?.stats.existingDraws).toEqual([
      expect.objectContaining({ nodeId: "node-existing-ethylene", ratePerSecond: 144 }),
    ]);
  });

  it("offers a zero-step plan when the target is already produced in-plan", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 100 },
        supply: [],
        existingOutputs: [
          {
            kind: "fluid",
            id: "polyethylene",
            displayName: "Polyethylene",
            nodeId: "node-existing-pe",
            availablePerSecond: 400,
          },
        ],
      },
      fixtureLookup(),
    );

    const tapPlan = result.plans.find((plan) => plan.steps.length === 0);
    expect(tapPlan?.closed).toBe(true);
    expect(tapPlan?.stats.existingDraws[0]).toEqual(
      expect.objectContaining({ nodeId: "node-existing-pe", ratePerSecond: 100 }),
    );
  });

  it("satisfies wildcard-meta inputs from concrete stockpile entries", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "item", id: "charcoal", displayName: "Charcoal", amountPerSecond: 1 },
        supply: supply(["item", "minecraft:log@1"]),
      },
      fixtureLookup(),
    );

    const plan = result.plans[0];
    expect(plan?.closed).toBe(true);
    expect(plan?.steps.map((step) => step.recipe.id)).toEqual(["coke-oven-any-log"]);
    expect(plan?.stats.supplyDraws[0]).toEqual(
      expect.objectContaining({ id: "minecraft:log@1", ratePerSecond: 0.8 }),
    );
  });

  it("respects the tier cap", async () => {
    const result = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: supply(["fluid", "biomass"], ["fluid", "water"]),
        // LV cap: both LCR roots are HV.
        options: { maxTierIndex: 1 },
      },
      fixtureLookup(),
    );

    expect(result.plans).toHaveLength(0);
    expect(result.notes.some((note) => note.includes("No recipe"))).toBe(true);
  });
});
