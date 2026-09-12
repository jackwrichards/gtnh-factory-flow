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
  // A real tier, not an infinity marker: GTValues.V[14] is
  // Integer.MAX_VALUE - 7, and the wireless energy hatch family reaches it.
  { tier: "MAX", maxEuT: 2147483640 },
];

export const GT_OVERCLOCK_TIERS = GT_VOLTAGE_TIERS;

export function getVoltageTierForEuT(euT: number): Exclude<MachineTier, "DEMO"> {
  if (!Number.isFinite(euT) || euT <= 0) {
    return "ULV";
  }

  const absEuT = Math.abs(euT);
  return GT_VOLTAGE_TIERS.find((entry) => absEuT <= entry.maxEuT)?.tier ?? "MAX";
}

/**
 * The highest tier whose voltage fits INSIDE a power budget: the hatch tier
 * a typed EU/t reads as (6,000 EU/t is EV hatches carrying 2.93 amps, never
 * an IV hatch fed short). Floors at ULV.
 */
export function getVoltageTierWithinEuT(euT: number): Exclude<MachineTier, "DEMO"> {
  if (!Number.isFinite(euT) || euT <= 0) {
    return "ULV";
  }
  let tier: Exclude<MachineTier, "DEMO"> = "ULV";
  for (const entry of GT_VOLTAGE_TIERS) {
    if (entry.maxEuT <= euT) {
      tier = entry.tier;
    }
  }
  return tier;
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

  return defaultTier;
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
  recipe: Pick<Recipe, "eut" | "minimumTier"> & Partial<Pick<Recipe, "maximumTier" | "availableTiers">>,
  requestedTier: string | undefined,
): Exclude<MachineTier, "DEMO"> {
  const minimumTier = getRecipeMinimumVoltageTier(recipe);
  const requested = resolveVoltageTier(requestedTier, minimumTier);
  const available = getRecipeAvailableVoltageTiers(recipe);
  if (available) {
    const eligible = available.filter((tier) => getVoltageTierIndex(tier) >= getVoltageTierIndex(minimumTier));
    // A saved tier in a gap falls back to the real machine below it. If that
    // cannot run the recipe, choose the first registered machine that can.
    return eligible.findLast((tier) => getVoltageTierIndex(tier) <= getVoltageTierIndex(requested))
      ?? eligible[0] ?? available[available.length - 1];
  }
  if (getVoltageTierIndex(requested) < getVoltageTierIndex(minimumTier)) {
    return minimumTier;
  }
  // No machine above the family's last one: a plan that stored a higher
  // tier runs the highest block that exists.
  const maximum = getRecipeMaximumVoltageTier(recipe);
  return maximum && getVoltageTierIndex(requested) > getVoltageTierIndex(maximum) ? maximum : requested;
}

/** The registered singleblock ladder, in voltage order; absent on legacy data. */
export function getRecipeAvailableVoltageTiers(
  recipe: Partial<Pick<Recipe, "availableTiers">>,
): Exclude<MachineTier, "DEMO">[] | undefined {
  const tiers = GT_VOLTAGE_TIERS.filter((entry) => recipe.availableTiers?.includes(entry.tier))
    .map((entry) => entry.tier);
  return tiers.length ? tiers : undefined;
}

/** The family's highest real machine, when the recipe's handler names one. */
export function getRecipeMaximumVoltageTier(
  recipe: Partial<Pick<Recipe, "maximumTier">>,
): Exclude<MachineTier, "DEMO"> | undefined {
  const value = recipe.maximumTier;
  return value ? GT_VOLTAGE_TIERS.find((entry) => entry.tier === value)?.tier : undefined;
}
