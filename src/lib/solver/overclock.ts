import {
  getHighestFiniteVoltageTier,
  getRecipePowerTier,
  getVoltageTierIndex,
  GT_OVERCLOCK_TIERS,
} from "@/lib/model/tiers";
import {
  applyMachineHandlerToRecipe,
  getRecipeCoilTierControl,
  getRecipeSpecialValue,
} from "@/lib/model/recipe-rules";
import {
  getBeeMegaApiaryTierEutMultiplier,
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  isMegaApiaryMachineType,
} from "./machine-effects";
import { isIndustrialApiaryMachineType } from "@/lib/model/passive-production";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";
import {
  resolveRuntimeTier,
  runtimeOverclockSteps,
  selectRuntimeCalculationVariant,
} from "./runtime-calculation";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type OverclockRecipeInput = Pick<Recipe, "durationTicks" | "eut" | "minimumTier"> &
  Partial<
    Pick<
      Recipe,
      | "machineType"
      | "source"
      | "nei"
      | "machineHandlers"
      | "machineProfile"
      | "machineConfigControls"
      | "runtimeCalculation"
    >
  >;

export interface OverclockedRecipeStats {
  tier: VoltageTier;
  minimumTier: VoltageTier;
  overclockSteps: number;
  durationTicks: number;
  eut: number;
}

export function getOverclockedRecipeStats(
  recipe: OverclockRecipeInput,
  node: Pick<FactoryNode, "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers">,
): OverclockedRecipeStats {
  const effectiveRecipe = recipe.machineType
    ? applyMachineHandlerToRecipe(recipe as Recipe, node)
    : recipe;
  const minimumTier = getRecipeMinimumVoltageTier(effectiveRecipe);
  const requestedTier = resolveVoltageTier(node.overclockTier, minimumTier);
  const tier =
    getVoltageTierIndex(requestedTier) < getVoltageTierIndex(minimumTier)
      ? minimumTier
      : requestedTier;
  const overclockSteps = Math.max(0, getVoltageTierIndex(tier) - getVoltageTierIndex(minimumTier));
  const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
  if (runtimeVariant) {
    const runtimeTier = resolveRuntimeTier(runtimeVariant, tier);
    return {
      tier: runtimeTier,
      minimumTier,
      overclockSteps: runtimeOverclockSteps(runtimeTier, minimumTier),
      durationTicks: runtimeVariant.durationTicks,
      eut: runtimeVariant.eut,
    };
  }
  if (isFixedTimeTierDrivenOutputRecipe(effectiveRecipe)) {
    return {
      tier,
      minimumTier,
      overclockSteps,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut,
    };
  }
  if (effectiveRecipe.machineType && isIndustrialApiaryMachineType(effectiveRecipe.machineType)) {
    const durationMultiplier = getMachineDurationMultiplier(effectiveRecipe as Recipe, node);
    const eutMultiplier = getMachineEutMultiplier(effectiveRecipe as Recipe, node);
    return {
      tier: minimumTier,
      minimumTier,
      overclockSteps: 0,
      durationTicks: Math.max(1, effectiveRecipe.durationTicks * durationMultiplier),
      eut: effectiveRecipe.eut * eutMultiplier,
    };
  }
  if (effectiveRecipe.machineType && isMegaApiaryMachineType(effectiveRecipe.machineType)) {
    const eutMultiplier =
      getMachineEutMultiplier(effectiveRecipe as Recipe, node) *
      getBeeMegaApiaryTierEutMultiplier(tier);
    return {
      tier,
      minimumTier,
      overclockSteps,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut * eutMultiplier,
    };
  }

  const heatOverclock = getHeatOverclockStats(effectiveRecipe, node, tier, overclockSteps);
  const durationMultiplier = effectiveRecipe.machineType
    ? getMachineDurationMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  const eutMultiplier = effectiveRecipe.machineType
    ? getMachineEutMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  // Machines that state perfect overclocks in their tooltip quarter the
  // duration on every step instead of halving it.
  const perfectSteps = effectiveRecipe.machineProfile?.perfectOverclock
    ? heatOverclock.regularOverclockSteps
    : 0;

  return {
    tier,
    minimumTier,
    overclockSteps,
    durationTicks: Math.max(
      1,
      (effectiveRecipe.durationTicks /
        4 ** (heatOverclock.heatOverclockSteps + perfectSteps) /
        2 ** (heatOverclock.regularOverclockSteps - perfectSteps)) *
        durationMultiplier,
    ),
    eut:
      effectiveRecipe.eut *
      heatOverclock.heatDiscountMultiplier *
      eutMultiplier *
      4 ** overclockSteps,
  };
}

function getHeatOverclockStats(
  recipe: OverclockRecipeInput,
  node: Pick<FactoryNode, "coilTier">,
  tier: VoltageTier,
  overclockSteps: number,
) {
  const specialValue = getRecipeSpecialValue(recipe);
  const coilControl = recipe.machineType
    ? getRecipeCoilTierControl(
        {
          machineType: recipe.machineType,
          source: recipe.source,
          nei: recipe.nei,
          machineConfigControls: recipe.machineConfigControls,
        },
        node,
      )
    : undefined;
  if (specialValue === undefined || !coilControl || !coilControl.current.heat) {
    return {
      heatOverclockSteps: 0,
      regularOverclockSteps: overclockSteps,
      heatDiscountMultiplier: 1,
    };
  }

  const machineHeat = coilControl.current.heat + 100 * (getVoltageTierIndex(tier) - 2);
  const heatExcess = Math.max(0, machineHeat - specialValue);
  const heatOverclockSteps = Math.min(overclockSteps, Math.floor(heatExcess / 1800));

  return {
    heatOverclockSteps,
    regularOverclockSteps: overclockSteps - heatOverclockSteps,
    heatDiscountMultiplier: 0.95 ** Math.floor(heatExcess / 900),
  };
}

function getRecipeMinimumVoltageTier(recipe: Pick<Recipe, "eut" | "minimumTier">): VoltageTier {
  const declaredMinimum = resolveVoltageTier(recipe.minimumTier, getRecipePowerTier(recipe));
  const powerTier = getRecipePowerTier(recipe);

  return getVoltageTierIndex(declaredMinimum) >= getVoltageTierIndex(powerTier)
    ? declaredMinimum
    : powerTier;
}

function isFixedTimeTierDrivenOutputRecipe(
  recipe: Pick<Recipe, "source"> & { machineType?: string },
) {
  if (!recipe.machineType) {
    return false;
  }
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeRecipeMapName(recipeMap) === "tree growth simulator";
}

function normalizeRecipeMapName(recipeMap: string): string {
  return recipeMap
    .trim()
    .toLowerCase()
    .replace(/\brecipes?\b/g, "")
    .replace(/\brecipe\s+map\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveVoltageTier(value: string, defaultTier: VoltageTier): VoltageTier {
  const tier = GT_OVERCLOCK_TIERS.find((entry) => entry.tier === value)?.tier;
  if (tier) {
    return tier;
  }

  if (value === "MAX") {
    return getHighestFiniteVoltageTier();
  }

  return defaultTier === "MAX" ? getHighestFiniteVoltageTier() : defaultTier;
}
