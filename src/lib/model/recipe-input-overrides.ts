import type { FactoryNode, Recipe, ResourceAmount, ResourceKind } from "./types";
import { isOreDictionaryResource } from "./resources";
import { applyVatInputs, isVatRecipe } from "@/lib/machines/bacterial-vat";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";

/**
 * The recipe's input amount, restated in the units of the substitute actually
 * being wired in.
 *
 * Substitutes within one kind are not always one for one: a slot wanting 72 L
 * of soldering alloy wants 144 L of tin, and the alternative's ratio says so.
 * Ore dictionary members carry 1 and so leave the amount exactly as it was.
 *
 * Kinds never mix (an item satisfies an item slot, a fluid a fluid slot), so a
 * differing kind is a wire that should not exist; the amount is left alone
 * rather than inventing a ratio.
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

/**
 * Whether putting `resource` in this slot makes the recipe consume what it makes. Some slots accept their own
 * product (an Industrial Chisel turns any glass into one variant, that variant included), but running the recipe
 * on it is a loop no plan wants. The slot's own resource is never a switch.
 */
export function switchesSlotToOwnProduct(
  recipe: Pick<Recipe, "outputs">,
  input: Pick<ResourceAmount, "kind" | "id">,
  resource: Pick<ResourceAmount, "kind" | "id">,
): boolean {
  if (resource.kind === input.kind && resource.id === input.id) {
    return false;
  }
  return recipe.outputs.some((output) => output.kind === resource.kind && output.id === resource.id);
}

/**
 * The recipe's inputs as this node takes them: the wired substitutes, then the machine's own scaling (the
 * Bacterial Vat's fill multiplier on its fluid, its radio hatch's burn).
 */
export function applyRecipeInputOverrides(
  recipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides"> & Partial<FactoryNode>,
): Recipe {
  const overridden = applyWiredOverrides(recipe, node);
  if (isVatRecipe(recipe)) {
    const stats = getOverclockedRecipeStats(recipe, node as FactoryNode);
    return applyVatInputs(overridden, node.machineConfigTiers, stats.durationTicks / 20);
  }
  return overridden;
}

function applyWiredOverrides(recipe: Recipe, node: Pick<FactoryNode, "recipeInputOverrides">): Recipe {
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
