import type { MachineTier, Recipe } from "./types";

export const GT_VOLTAGE_TIERS: Array<{ tier: Exclude<MachineTier, "DEMO">; maxEuT: number }> = [
  { tier: "ULV", maxEuT: 8 },
  { tier: "LV", maxEuT: 32 },
  { tier: "MV", maxEuT: 128 },
  { tier: "HV", maxEuT: 512 },
  { tier: "EV", maxEuT: 2048 },
  { tier: "IV", maxEuT: 8192 },
  { tier: "LuV", maxEuT: 32768 },
  { tier: "ZPM", maxEuT: 131072 },
  { tier: "UV", maxEuT: 524288 },
  { tier: "UHV", maxEuT: 2097152 },
  { tier: "UEV", maxEuT: 8388608 },
  { tier: "UIV", maxEuT: 33554432 },
  { tier: "UMV", maxEuT: 134217728 },
  { tier: "UXV", maxEuT: 536870912 },
  { tier: "MAX", maxEuT: Number.POSITIVE_INFINITY },
];

export const GT_OVERCLOCK_TIERS = GT_VOLTAGE_TIERS.filter((entry) => Number.isFinite(entry.maxEuT));

export function getHighestFiniteVoltageTier(): Exclude<MachineTier, "DEMO"> {
  return GT_OVERCLOCK_TIERS[GT_OVERCLOCK_TIERS.length - 1]?.tier ?? "UXV";
}

export function getVoltageTierForEuT(euT: number): Exclude<MachineTier, "DEMO"> {
  if (!Number.isFinite(euT) || euT <= 0) {
    return "ULV";
  }

  const absEuT = Math.abs(euT);
  return GT_VOLTAGE_TIERS.find((entry) => absEuT <= entry.maxEuT)?.tier ?? "MAX";
}

export function getRecipePowerTier(recipe: Pick<Recipe, "eut">): Exclude<MachineTier, "DEMO"> {
  return getVoltageTierForEuT(recipe.eut);
}

export function getVoltageTierIndex(tier: Exclude<MachineTier, "DEMO">): number {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

export function isVoltageTierAbove(
  tier: Exclude<MachineTier, "DEMO">,
  maxTier: Exclude<MachineTier, "DEMO">,
): boolean {
  return getVoltageTierIndex(tier) > getVoltageTierIndex(maxTier);
}

/** EU/t a single energy hatch of this tier delivers - the machine's power budget. */
export function getVoltageTierMaxEuT(tier: Exclude<MachineTier, "DEMO">): number {
  return GT_VOLTAGE_TIERS.find((entry) => entry.tier === tier)?.maxEuT ?? Number.POSITIVE_INFINITY;
}

export function resolveVoltageTier(
  value: string | undefined,
  defaultTier: Exclude<MachineTier, "DEMO">,
): Exclude<MachineTier, "DEMO"> {
  const tier = GT_OVERCLOCK_TIERS.find((entry) => entry.tier === value)?.tier;
  if (tier) {
    return tier;
  }

  // The 536M EU/t tier spent a while misnamed "OpV" (a GTCEu name; GTNH calls
  // it UXV). Plans saved back then still say it, and it must keep its voltage.
  if (value === "OpV") {
    return "UXV";
  }

  if (value === "MAX") {
    return getHighestFiniteVoltageTier();
  }

  return defaultTier === "MAX" ? getHighestFiniteVoltageTier() : defaultTier;
}

/** The lowest voltage that can run this recipe at all: its structural gate or its EU/t draw. */
export function getRecipeMinimumVoltageTier(
  recipe: Pick<Recipe, "eut" | "minimumTier">,
): Exclude<MachineTier, "DEMO"> {
  const powerTier = getRecipePowerTier(recipe);
  const declaredMinimum = resolveVoltageTier(recipe.minimumTier, powerTier);

  return getVoltageTierIndex(declaredMinimum) >= getVoltageTierIndex(powerTier)
    ? declaredMinimum
    : powerTier;
}

/**
 * The voltage the machine actually runs at: the requested tier, floored at the
 * recipe's minimum. This is the SINGLEBLOCK rule - a machine below its
 * recipe's tier does not exist to be built, and legacy plans lean on the
 * clamp. Multiblocks go through `getNodeRunTier` in solver/power.ts instead,
 * which honours an under-tiered hatch choice and lets power-report call it.
 */
export function getRunVoltageTier(
  recipe: Pick<Recipe, "eut" | "minimumTier">,
  requestedTier: string | undefined,
): Exclude<MachineTier, "DEMO"> {
  const minimumTier = getRecipeMinimumVoltageTier(recipe);
  const requested = resolveVoltageTier(requestedTier, minimumTier);

  return getVoltageTierIndex(requested) < getVoltageTierIndex(minimumTier) ? minimumTier : requested;
}
