import { describe, expect, it } from "vitest";
import { applyInputConsumeChances } from "./input-chance";
import { applyRecipeInputOverrides } from "./recipe-input-overrides";
import { enrichPassiveProductionRecipe } from "./passive-production";
import type { Recipe } from "./types";

// GT5U RecipeLoaderIndustrialRockBreaker: Nether Leaves with inputChances(1000), so a run uses one up 10% of the time.
const netherLeaves = (): Recipe => ({
  id: "boldarnator-netherrack",
  name: "Boldarnator: Netherrack",
  machineType: "Boldarnator",
  minimumTier: "LV",
  durationTicks: 16,
  eut: 30,
  inputs: [
    { kind: "item", id: "thaumicbases:genleaves@2", amount: 1, displayName: "Nether Leaves" },
    { kind: "item", id: "gregtech:gt.integrated_circuit@6", amount: 1, consumed: false },
  ],
  outputs: [
    { kind: "item", id: "minecraft:netherrack", amount: 1, chance: 0.6 },
    { kind: "item", id: "minecraft:soul_sand", amount: 1, chance: 0.3 },
    { kind: "item", id: "minecraft:quartz_ore", amount: 1, chance: 0.1 },
  ],
  source: { recipeMap: "Boldarnator" },
});

describe("chanced inputs", () => {
  it("count the Boldarnator's leaves at a tenth a run", () => {
    const leaves = applyInputConsumeChances(netherLeaves()).inputs[0]!;
    expect(leaves).toMatchObject({ amount: 0.1, consumeChance: 0.1 });
  });

  it("apply once, however many times a recipe passes through", () => {
    const once = enrichPassiveProductionRecipe(netherLeaves());
    const twice = applyRecipeInputOverrides(enrichPassiveProductionRecipe(once), { recipeInputOverrides: undefined });
    expect(twice.inputs[0]!.amount).toBe(0.1);
  });

  it("repair a plan saved with the whole stack", () => {
    expect(applyRecipeInputOverrides(netherLeaves(), { recipeInputOverrides: undefined }).inputs[0]!.amount).toBe(0.1);
  });

  it("leave other machines and kept inputs alone", () => {
    const recipe = { ...netherLeaves(), machineType: "Rock Breaker", source: { recipeMap: "Rock Breaker" } };
    expect(applyInputConsumeChances(recipe)).toBe(recipe);
    expect(applyInputConsumeChances(netherLeaves()).inputs[1]!.amount).toBe(1);
  });
});
