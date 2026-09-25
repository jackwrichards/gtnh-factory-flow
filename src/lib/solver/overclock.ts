import { hasAmperageOverclock } from "./power-input-rules";
import { getFusionStats } from "@/lib/machines/fusion";
import { getEecMetadata, getEecSettings, getEecStats } from "@/lib/machines/extreme-entity-crusher";
import {
  getRecipeMinimumVoltageTier,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
} from "@/lib/model/tiers";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { getHeatOverclockStats } from "./heat";
import { getEffectiveVoltageOrdinal, getNodePowerAmps, getNodeRunTier, isMultiblockRecipe } from "./power";
import {
  buildMachineContext,
  getBeeMegaApiaryTierEutMultiplier,
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
  isMegaApiaryMachineType,
} from "./machine-effects";
import {
  getMachineBehaviour,
  HEAT_OVERCLOCK,
  OVERCLOCK,
  resolveOverclockSpec,
  type OverclockRule,
} from "@/lib/machines/machine-table";

import { getCropsNhStats, isIndustrialApiaryMachineType } from "@/lib/model/passive-production";
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
      | "metadata"
    >
  >;

export interface OverclockedRecipeStats {
  tier: VoltageTier;
  minimumTier: VoltageTier;
  overclockSteps: number;
  /**
   * How many of the steps are perfect (machine or heat) overclocks, taken
   * FIRST; the rest are normal steps. Runtime-ladder machines report 0: the
   * game's export never says which kind its ladder took.
   */
  perfectOverclockSteps: number;
  /** A perfect step's duration divisor. A normal step always halves. */
  perfectSpeedFactor: number;
  /** A perfect step's EU/t multiplier. A normal step always pays 4×. */
  perfectEuFactor: number;
  durationTicks: number;
  eut: number;
}

/** The step shape every non-curated branch reports: plain ×4/÷2 counting. */
const PLAIN_OVERCLOCK_STEPS = {
  perfectOverclockSteps: 0,
  perfectSpeedFactor: 4,
  perfectEuFactor: 4,
} as const;

export function getOverclockedRecipeStats(
  recipe: OverclockRecipeInput,
  node: Pick<
    FactoryNode,
    "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers"
  > &
    Partial<
      Pick<
        FactoryNode,
        "energyHatches" | "energyHatchType" | "powerEuT" | "hatchVoltageTier" | "hatchAmps" | "powerInputMode"
      >
    >,
): OverclockedRecipeStats {
  // A power card's rates are the model's own (src/lib/power): no handler
  // stats, no overclock ladder, no steam rebilling - the recipe as written.
  if ((recipe as Recipe).power) {
    return {
      tier: getRecipeMinimumVoltageTier(recipe),
      minimumTier: getRecipeMinimumVoltageTier(recipe),
      overclockSteps: 0,
      ...PLAIN_OVERCLOCK_STEPS,
      durationTicks: recipe.durationTicks,
      eut: recipe.eut,
    };
  }
  const effectiveRecipe = recipe.machineType
    ? applyMachineHandlerToRecipe(recipe as Recipe, node)
    : recipe;
  const minimumTier = getRecipeMinimumVoltageTier(effectiveRecipe);
  const fusion = getFusionStats(effectiveRecipe);
  if (fusion) {
    return {
      tier: fusion.tier, minimumTier,
      overclockSteps: fusion.steps, perfectOverclockSteps: fusion.steps,
      perfectSpeedFactor: fusion.factor, perfectEuFactor: fusion.factor,
      durationTicks: quantiseDurationToTicks(fusion.durationTicks, true), eut: fusion.eut,
    };
  }
  // A multiblock's pick stands even below the recipe's minimum - an
  // underpowered build is shown as one (power-report.ts names the state),
  // never silently promoted. A singleblock is floored at the minimum, because
  // a lower machine does not exist to be built.
  const tier = getNodeRunTier(effectiveRecipe, node);
  const eec = getEecMetadata(effectiveRecipe);
  if (eec) {
    // kubatech's own overclock, infernals and ritual; the duration returned
    // is per kill, with the past-floor output multiplier folded in.
    const stats = getEecStats(
      eec,
      getEecSettings(node.machineConfigTiers),
      getVoltageTierMaxEuT(tier) * getNodePowerAmps(effectiveRecipe, node),
    );
    return {
      tier,
      minimumTier,
      overclockSteps: stats.steps,
      perfectOverclockSteps: stats.steps,
      perfectSpeedFactor: 4,
      perfectEuFactor: 4,
      durationTicks: stats.durationTicks,
      eut: stats.eut,
    };
  }
  const overclockSteps = Math.max(0, getVoltageTierIndex(tier) - getVoltageTierIndex(minimumTier));
  const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
  if (runtimeVariant) {
    const runtimeTier = resolveRuntimeTier(runtimeVariant, tier);
    return {
      tier: runtimeTier,
      minimumTier,
      overclockSteps: runtimeOverclockSteps(runtimeTier, minimumTier),
      ...PLAIN_OVERCLOCK_STEPS,
      durationTicks: runtimeVariant.durationTicks,
      eut: runtimeVariant.eut,
    };
  }
  if (isFixedTimeTierDrivenOutputRecipe(effectiveRecipe)) {
    return {
      tier,
      minimumTier,
      overclockSteps,
      ...PLAIN_OVERCLOCK_STEPS,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut,
    };
  }
  if (getCropsNhStats(effectiveRecipe)) {
    // A crop grows at the world's pace: voltage buys nothing on a crop card,
    // so a 0 EU recipe must not "afford" free overclock steps. The crop's own
    // knobs (environment, harvester) move the duration through the machine
    // duration multiplier instead.
    return {
      tier,
      minimumTier,
      overclockSteps: 0,
      ...PLAIN_OVERCLOCK_STEPS,
      durationTicks: Math.max(
        1,
        effectiveRecipe.durationTicks *
          getMachineDurationMultiplier(effectiveRecipe as Recipe, node),
      ),
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
      ...PLAIN_OVERCLOCK_STEPS,
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
      ...PLAIN_OVERCLOCK_STEPS,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut * eutMultiplier,
    };
  }

  const durationMultiplier = effectiveRecipe.machineType
    ? getMachineDurationMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  const eutMultiplier = effectiveRecipe.machineType
    ? getMachineEutMultiplier(effectiveRecipe as Recipe, node)
    : 1;

  // The heat discount is independent of how many steps end up taken, and the
  // parallel budget needs it first: ParallelHelper folds it into the draw.
  const effectiveVoltageOrdinal = getEffectiveVoltageOrdinal(effectiveRecipe, node, tier);
  const heatDiscountMultiplier = getHeatOverclockStats(
    effectiveRecipe,
    node,
    tier,
    0,
    effectiveVoltageOrdinal,
  ).heatDiscountMultiplier;

  // Parallels are spent before overclocks: they multiply EU/t one-for-one, so
  // only the voltage headroom left over after every parallel is paid for can
  // buy an overclock. A chem plant running six parallels of a 480 EU/t recipe
  // draws 2880 EU/t, which already fills an IV hatch - no overclock, however
  // far above the recipe's HV minimum the machine is powered.
  const parallels = effectiveRecipe.machineType
    ? getMachineParallelMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  const parallelEuT =
    Math.abs(effectiveRecipe.eut) * eutMultiplier * heatDiscountMultiplier * parallels;

  // Overclocks counted the way OverclockCalculator counts them: whole
  // power-of-four steps of the machine's power over the recipe's draw, and
  // nothing else - a multiblock overclocks on amperage, so stacked hatches
  // buy steps past the hatches' own tier. The machine's power is its tier
  // voltage times its working amps (hatch count for a multiblock, the
  // machine's own amperage for a singleblock - the arc furnaces work with 3),
  // and a recipe drawing under 32 EU/t is billed as 32: "Treat ULV as LV for
  // overclocking".
  const subTickCapable = canSubTick(effectiveRecipe);
  const machinePower = getVoltageTierMaxEuT(tier) * getNodePowerAmps(effectiveRecipe, node);
  const recipePower = Math.max(Math.ceil(parallelEuT), 32);
  let affordableSteps = Number.isFinite(machinePower)
    ? floorLog4(Math.floor(machinePower / recipePower))
    : Number.POSITIVE_INFINITY;

  // A singleblock is additionally capped by voltage tier, measured against the
  // recipe's RAW EU/t - `OverclockCalculator` skips this limit for multiblocks
  // because they overclock on amperage. For 1A machines the two limits agree,
  // so this only bites machines like the arc furnace whose amps outrun their
  // voltage tier.
  if (
    (!subTickCapable || !hasAmperageOverclock(effectiveRecipe.machineType)) &&
    Number.isFinite(machinePower)
  ) {
    const machineVoltageTier = Math.max(
      ceilLog4((subTickCapable ? getVoltageTierMaxEuT(tier) : machinePower) / 8),
      1,
    );
    const recipeVoltageTier = Math.max(ceilLog4(Math.abs(effectiveRecipe.eut) / 8), 1);
    affordableSteps = Math.min(affordableSteps, machineVoltageTier - recipeVoltageTier);
  }

  const affordable = Math.max(0, affordableSteps);
  // How many of the affordable steps heat pays for, now that the count is
  // settled; the rest are the machine's ordinary steps.
  const heatOverclock = getHeatOverclockStats(
    effectiveRecipe,
    node,
    tier,
    affordable,
    effectiveVoltageOrdinal,
  );
  const rule = resolveOverclockRule(effectiveRecipe, node, heatOverclock.heatOverclockSteps);

  // Perfect steps are taken first, then normal ones. A perfect step divides
  // duration by the rule's multiplier and usually raises EU/t by the same,
  // but rules may charge a different EU factor per step (arc electrodes are
  // billed 4x however much speed the step buys); a normal step halves
  // duration for 4x EU/t.
  const perfectSteps = Math.min(rule.maxPerfect, affordable);
  const normalSteps = Math.min(rule.maxNormal, affordable - perfectSteps);
  const steps = perfectSteps + normalSteps;

  return {
    tier,
    minimumTier,
    overclockSteps: steps,
    perfectOverclockSteps: perfectSteps,
    perfectSpeedFactor: rule.multiplier,
    perfectEuFactor: rule.euMultiplier ?? rule.multiplier,
    durationTicks: (getMachineBehaviour(effectiveRecipe.machineType)?.quantiseDuration ?? quantiseDurationToTicks)(
      (effectiveRecipe.durationTicks / rule.multiplier ** perfectSteps / 2 ** normalSteps) *
        durationMultiplier,
      subTickCapable,
    ),
    eut:
      effectiveRecipe.eut *
      heatOverclock.heatDiscountMultiplier *
      eutMultiplier *
      (rule.euMultiplier ?? rule.multiplier) ** perfectSteps *
      4 ** normalSteps,
  };
}

/** Whole power-of-four steps that fit in `ratio`: 0 for anything under 4. */
function floorLog4(ratio: number): number {
  let steps = 0;
  for (let power = 4; power <= ratio; power *= 4) {
    steps += 1;
  }
  return steps;
}

/** Smallest `n` with `4^n >= ratio`, the game's `log4ceil`. */
function ceilLog4(ratio: number): number {
  let steps = 0;
  let power = 1;
  while (power < ratio) {
    steps += 1;
    power *= 4;
  }
  return steps;
}

/**
 * A recipe runs in whole ticks, and the leftover is not wasted the same way by
 * every machine.
 *
 * Above one tick, GT truncates: a recipe computed at 18.75 ticks runs in 18,
 * which quietly favours the player. Everything truncates, singleblock or not.
 *
 * Below one tick, a machine cannot run a recipe faster than the game's clock.
 * A multiblock spends the leftover on extra parallels instead: ParallelHelper
 * multiplies its parallels by `calculateMultiplierUnderOneTick`, which is
 * `ceil(1 / duration)`, so 0.625 ticks runs TWO recipes a tick (not 1.6) and
 * 0.156 runs seven. Rounding the duration DOWN to the nearest natural
 * fraction (1/2, 1/7) reproduces that once the parallels are multiplied in.
 * A singleblock has no parallels to spend it on, so it sits at one tick and
 * the rest is simply lost.
 */
export function quantiseDurationToTicks(durationTicks: number, subTickCapable: boolean): number {
  if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
    return 1;
  }
  if (durationTicks > 1) {
    return Math.floor(durationTicks);
  }
  return subTickCapable ? 1 / Math.ceil(1 / durationTicks) : 1;
}

/**
 * Whether this machine converts sub-tick speed into parallels.
 *
 * A handler exported with the recipe knows its own kind, so it decides. When
 * the recipe carries no handlers at all, `getRecipeMachineHandlers` invents one
 * and stamps it `single` as a placeholder; that is not evidence, so fall back
 * to the curated table, whose entries are multiblocks unless marked
 * `kind: "single"` (the arc furnace family). Anything unrecognised stays at
 * the one-tick floor rather than suddenly claiming more output.
 */
function canSubTick(effectiveRecipe: OverclockRecipeInput): boolean {
  return isMultiblockRecipe(effectiveRecipe);
}

/**
 * Which overclock rule applies: the curated table's, the heat machines' rule
 * derived from coil heat, or the dataset's perfect-overclock flag for machines
 * the table does not cover yet.
 */
function resolveOverclockRule(
  recipe: OverclockRecipeInput,
  node: Pick<FactoryNode, "machineConfigTiers" | "coilTier" | "overclockTier">,
  heatOverclockSteps: number,
): OverclockRule {
  const behaviour = getMachineBehaviour(recipe.machineType);
  const spec = behaviour
    ? resolveOverclockSpec(behaviour, buildMachineContext(recipe as Recipe, node))
    : undefined;

  if (spec === HEAT_OVERCLOCK) {
    // Coil heat above the recipe's requirement buys perfect steps, then normal.
    return OVERCLOCK.perfectThenNormal(heatOverclockSteps);
  }
  if (spec) {
    return spec;
  }
  return recipe.machineProfile?.perfectOverclock ? OVERCLOCK.perfect() : OVERCLOCK.normal();
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
