import type { Recipe, RecipeInput } from "./types";

/**
 * GT's input chance (GTRecipe.mInputChances): the slot must be filled to start, and a run uses the stack up only this
 * often. A slot with one carries `consumeChance` and an `amount` that is already the average a run (stack x chance),
 * so every rate reads it as it is and the marker keeps this from applying twice.
 *
 * Exports before the oracle wrote the chance dropped it. The pack's only chanced inputs are the Boldarnator's leaves
 * (GT5U RecipeLoaderIndustrialRockBreaker, `inputChances(1000)`), filled in here by map, item and stack size.
 */
const KNOWN_INPUT_CHANCES: Record<string, Array<{ id: string; amount: number; chance: number }>> = {
  Boldarnator: [
    { id: "thaumicbases:genleaves@2", amount: 1, chance: 0.1 },
    { id: "thaumicbases:genleaves@3", amount: 1, chance: 0.1 },
  ],
};

export function applyInputConsumeChances<T extends Pick<Recipe, "inputs" | "machineType" | "source">>(recipe: T): T {
  const known = KNOWN_INPUT_CHANCES[recipe.source?.recipeMap ?? recipe.machineType];
  if (!known) {
    return recipe;
  }
  let changed = false;
  const inputs = recipe.inputs.map((input): RecipeInput => {
    if (input.consumeChance !== undefined || input.consumed === false) {
      return input;
    }
    const entry = known.find((candidate) => candidate.id === input.id && candidate.amount === input.amount);
    if (!entry) {
      return input;
    }
    changed = true;
    return { ...input, amount: input.amount * entry.chance, consumeChance: entry.chance };
  });
  return changed ? { ...recipe, inputs } : recipe;
}
