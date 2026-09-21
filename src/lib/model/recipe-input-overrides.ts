import type { FactoryNode, Recipe, ResourceAmount, ResourceKind } from "./types";
import { isOreDictionaryResource } from "./resources";

/**
 * The recipe's input amount, restated in the units of the substitute actually
 * being wired in.
 *
 * Substitutes within one kind are not always one for one: a slot wanting 72 L
 * of soldering alloy wants 144 L of tin, and the alternative's ratio says so.
 * Ore dictionary members carry 1 and so leave the amount exactly as it was.
 *
 * Kinds never mix any more — an item satisfies an item slot and a fluid a fluid
 * slot — so a differing kind is not a conversion, it is a wire that should not
 * have been drawn. It leaves the amount alone rather than inventing a ratio.
 */
export function inputOverrideAmount(
  input: Pick<ResourceAmount, "kind" | "id" | "displayName" | "amount" | "alternatives">,
  targetKind: ResourceKind,
  alternative?: { amount?: number; kind?: ResourceKind },
): number {
  if (input.kind !== targetKind) {
    return input.amount;
  }

  const perUnit = alternative?.amount;
  const hasRatio = perUnit !== undefined && Number.isFinite(perUnit) && perUnit > 0;
  return hasRatio && alternative?.kind === targetKind ? input.amount * perUnit : input.amount;
}

export function applyRecipeInputOverrides(
  recipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
): Recipe {
  if (!node.recipeInputOverrides) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    if (!override) {
      return input;
    }
    // Legacy category wires saved the group itself as a choice, hiding its members.
    if (isOreDictionaryResource(input) && override.kind === input.kind && override.id === input.id) {
      return input;
    }
    changed = true;
    return {
      ...input,
      ...override,
      amount: override.amount ?? input.amount,
      optional: input.optional,
      consumed: input.consumed,
      neiSlot: input.neiSlot,
      alternatives: undefined,
    };
  });

  return changed ? { ...recipe, inputs } : recipe;
}
