import type { Recipe, ResourceAmount } from "./types";

/**
 * The custom rate node: a source/sink you dial by hand. Supply mode makes a
 * chosen resource at a fixed rate for requesters; request mode is the
 * negative — a constant drain that asks for the resource. Modeled as a
 * synthetic one-second recipe (amount per craft == rate per second), so the
 * solver treats it like any other machine with no special cases.
 */
export const CUSTOM_RATE_MACHINE_TYPE = "Custom Rate";
export const CUSTOM_RATE_DURATION_TICKS = 20;
/** The placeholder's universal wire-here ports adopt whatever connects. */
export const CUSTOM_RATE_ANY_RESOURCE_ID = "custom-any";

export type CustomRateMode = "supply" | "request";

export function isCustomRateRecipe(
  recipe: Pick<Recipe, "machineType"> | undefined,
): boolean {
  return recipe?.machineType === CUSTOM_RATE_MACHINE_TYPE;
}

export function getCustomRateSlot(
  recipe: Pick<Recipe, "inputs" | "outputs">,
): { resource: ResourceAmount; mode: CustomRateMode } | undefined {
  if (recipe.outputs[0]) {
    return { resource: recipe.outputs[0], mode: "supply" };
  }
  if (recipe.inputs[0]) {
    return { resource: recipe.inputs[0], mode: "request" };
  }
  return undefined;
}

export function createCustomRatePlaceholderRecipe(id: string): Recipe {
  return {
    id,
    name: "Custom Rate",
    kind: "custom",
    category: "custom-rate",
    machineType: CUSTOM_RATE_MACHINE_TYPE,
    minimumTier: "NONE",
    durationTicks: CUSTOM_RATE_DURATION_TICKS,
    eut: 0,
    inputs: [],
    outputs: [],
    notes: "Wire any port to this — it adopts that resource.",
    source: { recipeMap: "custom-rate" },
  };
}

/**
 * The recipe with its single slot set: `perSecond` is the amount per craft
 * because the craft takes exactly one second.
 */
export function withCustomRateSlot(
  recipe: Recipe,
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  >,
  mode: CustomRateMode,
  perSecond: number,
): Recipe {
  const slot: ResourceAmount = {
    kind: resource.kind,
    id: resource.id,
    amount: Math.max(0, perSecond),
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor,
    tooltip: resource.tooltip,
  };
  return {
    ...recipe,
    name: `Custom Rate: ${resource.displayName ?? resource.id}`,
    inputs: mode === "request" ? [slot] : [],
    outputs: mode === "supply" ? [slot] : [],
  };
}
