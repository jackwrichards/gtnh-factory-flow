import {
  getRecipeMaximumVoltageTier,
  getRunVoltageTier,
  getVoltageTierIndex,
  GT_VOLTAGE_TIERS,
} from "@/lib/model/tiers";
import { getMachineBehaviour } from "@/lib/machines/machine-table";
import { isFusionRecipe } from "@/lib/machines/fusion";
import type {
  FactoryNode,
  MachineTier,
  Recipe,
  RecipeOutput,
  RuntimeCalculationVariant,
} from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * Runtime variants come from the game's own `OverclockCalculator`, which is
 * exactly what it says: the overclock math for ONE recipe run. It never saw
 * `GTParallelHelper`, so every variant in the dataset reports `parallel: 1`,
 * and its duration bottoms out at a single tick.
 *
 * For a singleblock that is the whole truth. For a multiblock it is most of
 * the answer missing its most important half: a Boldarnator's exported ladder
 * runs 16, 8, 4, 2, 1, 1, 1 ticks, so the planner showed cobble stalling at
 * 20/s from IV upward while the parallel count on the card kept climbing.
 *
 * So a machine we have verified in the curated table is calculated by our own
 * engine instead, which knows its parallels, spends the voltage on them before
 * overclocking, and banks sub-tick speed the way the machine does. Everything
 * else still uses the runtime data, which remains the best source we have.
 */
export function prefersCuratedMachineMath(recipe: { machineType?: string }): boolean {
  return isFusionRecipe(recipe) || getMachineBehaviour(recipe.machineType) !== undefined;
}

export function selectRuntimeCalculationVariant(
  recipe: Pick<Recipe, "runtimeCalculation"> &
    Partial<Pick<Recipe, "machineType" | "machineProfile" | "maximumTier" | "availableTiers" | "minimumTier" | "eut">>,
  node: Pick<
    FactoryNode,
    "machineHandlerId" | "overclockTier" | "coilTier" | "machineConfigTiers"
  > &
    Partial<Pick<FactoryNode, "hatchVoltageTier" | "hatchAmps">>,
): RuntimeCalculationVariant | undefined {
  // The oracle's generic ladder never called FusionOverclockDescriber.
  if (isFusionRecipe(recipe)) return undefined;
  // Exported variants never saw the user's power pool or parallel helper.
  // Explicitly supplied multiblocks must use the live power calculation.
  if (
    node.hatchVoltageTier &&
    recipe.machineProfile?.kind === "multiblock"
  )
    return undefined;
  if (node.hatchVoltageTier) node = { ...node, overclockTier: node.hatchVoltageTier };
  // The generic runtime calculator exports voltage steps beyond the last
  // registered singleblock. Use the same physical-machine cap as our solver,
  // including when an old plan still stores MAX on a family ending at UMV.
  const maximum = getRecipeMaximumVoltageTier(recipe);
  if (
    (maximum || recipe.availableTiers?.length) &&
    recipe.machineProfile?.kind !== "multiblock"
  ) {
    node = { ...node, overclockTier: getRunVoltageTier({ ...recipe, minimumTier: recipe.minimumTier ?? "ULV", eut: recipe.eut ?? 0 }, node.overclockTier) };
  }
  const variants = recipe.runtimeCalculation?.variants ?? [];
  if (recipe.runtimeCalculation?.status !== "computed" || variants.length === 0) {
    return undefined;
  }
  if (prefersCuratedMachineMath(recipe)) {
    return undefined;
  }

  const matching = variants
    .map((variant) => ({ variant, score: runtimeVariantScore(variant, node) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  return matching[0]?.variant;
}

export function getRuntimeCalculationOutputs(
  recipe: Pick<Recipe, "runtimeCalculation" | "outputs"> & { machineType?: string },
  node: Pick<FactoryNode, "machineHandlerId" | "overclockTier" | "coilTier" | "machineConfigTiers">,
): RecipeOutput[] | undefined {
  const variant = selectRuntimeCalculationVariant(recipe, node);
  if (!variant?.outputs?.length) {
    return undefined;
  }

  return variant.outputs.map((runtimeOutput) => {
    const existing = recipe.outputs.find(
      (output) => output.kind === runtimeOutput.kind && output.id === runtimeOutput.id,
    );
    return {
      ...existing,
      kind: runtimeOutput.kind,
      id: runtimeOutput.id,
      amount: runtimeOutput.amount,
      chance: runtimeOutput.chance ?? existing?.chance,
      displayName: existing?.displayName,
      iconPath: existing?.iconPath,
      iconAtlas: existing?.iconAtlas,
      dominantColor: existing?.dominantColor,
      modId: existing?.modId,
      tooltip: existing?.tooltip,
      neiSlot: existing?.neiSlot,
      alternatives: existing?.alternatives,
      byproduct: existing?.byproduct,
    };
  });
}

export function runtimeCalculationWarning(
  recipe: Pick<Recipe, "runtimeCalculation" | "name"> & { machineType?: string },
  node: Pick<FactoryNode, "machineHandlerId" | "overclockTier" | "coilTier" | "machineConfigTiers">,
): string | undefined {
  if (isFusionRecipe(recipe)) return undefined;
  const runtimeCalculation = recipe.runtimeCalculation;
  if (!runtimeCalculation?.oracleEligible || !runtimeCalculation.strict) {
    return undefined;
  }
  if (selectRuntimeCalculationVariant(recipe, node)) {
    return undefined;
  }
  return `${recipe.name} has no matching GTNH runtime calculation for this machine configuration.`;
}

export function resolveRuntimeTier(
  variant: RuntimeCalculationVariant,
  fallback: VoltageTier,
): VoltageTier {
  return resolveVoltageTier(variant.overclockTier, fallback);
}

function runtimeVariantScore(
  variant: RuntimeCalculationVariant,
  node: Pick<FactoryNode, "machineHandlerId" | "overclockTier" | "coilTier" | "machineConfigTiers">,
): number {
  let score = 0;
  if (variant.machineHandlerId) {
    if (variant.machineHandlerId !== node.machineHandlerId) {
      return -1;
    }
    score += 16;
  }
  if (variant.overclockTier) {
    if (isVoltageTier(node.overclockTier) && variant.overclockTier !== node.overclockTier) {
      return -1;
    }
    score += isVoltageTier(node.overclockTier) ? 8 : 1;
  }
  if (variant.coilTier) {
    if (variant.coilTier !== node.coilTier) {
      return -1;
    }
    score += 4;
  }
  const variantConfig = variant.machineConfigTiers;
  const selectedConfig = node.machineConfigTiers ?? {};
  if (!variantConfig && Object.keys(selectedConfig).length > 0) {
    return -1;
  }
  if (variantConfig) {
    for (const controlId of Object.keys(selectedConfig)) {
      if (!Object.prototype.hasOwnProperty.call(variantConfig, controlId)) {
        return -1;
      }
    }
  }
  for (const [controlId, key] of Object.entries(variantConfig ?? {})) {
    const selectedKey = node.machineConfigTiers?.[controlId];
    if (selectedKey !== undefined && selectedKey !== key) {
      return -1;
    }
    score += selectedKey === key ? 2 : 1;
  }
  return score;
}

function resolveVoltageTier(value: string | undefined, defaultTier: VoltageTier): VoltageTier {
  return GT_VOLTAGE_TIERS.find((entry) => entry.tier === value)?.tier ?? defaultTier;
}

function isVoltageTier(value: string | undefined): boolean {
  return GT_VOLTAGE_TIERS.some((entry) => entry.tier === value);
}

export function runtimeOverclockSteps(tier: VoltageTier, minimumTier: VoltageTier): number {
  return Math.max(0, getVoltageTierIndex(tier) - getVoltageTierIndex(minimumTier));
}
