import {
  applyMachineHandlerToRecipe,
  getSelectedMachineHandler,
  GT_FURNACE_RECIPE_EUT,
  isHighPressureSteamHandler,
  isSmeltingRecipeMap,
  isSteamMachineHandler,
} from "@/lib/model/recipe-rules";
import { STEAM_PRESSURE } from "@/lib/machines/machine-table";
import {
  getRecipeMinimumVoltageTier,
  getVoltageTierForEuT,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
  resolveVoltageTier,
} from "@/lib/model/tiers";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";
import { getHeatDiscountMultiplier } from "./heat";
import {
  buildMachineContext,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
} from "./machine-effects";
import { getOverclockedRecipeStats } from "./overclock";
import {
  getEffectiveVoltageOrdinal,
  getNodeEnergyHatches,
  getNodePowerAmps,
  getNodeRunTier,
  isMultiblockRecipe,
} from "./power";
import { getCropsNhStats, isIndustrialApiaryMachineType } from "@/lib/model/passive-production";
import { selectRuntimeCalculationVariant } from "./runtime-calculation";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type PowerReportNode = Pick<
  FactoryNode,
  "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers"
> &
  Partial<Pick<FactoryNode, "energyHatches">>;

/**
 * Whether the build can start at all, straight from the game's checks. There
 * is no slow mode in GT: a machine either runs what the report says or sits
 * idle, so these are the only three states.
 */
export type NodePowerState = "ok" | "under-powered" | "over-tier";

export interface NodePowerReport {
  state: NodePowerState;
  /** The tier the user picked (or the recipe's minimum by default). */
  tier: VoltageTier;
  minimumTier: VoltageTier;
  /** Hatch count on a multiblock; 1 and meaningless on a singleblock. */
  hatches: number;
  isMultiblock: boolean;
  /** Working amps: hatch amps on a multiblock, machine amperage otherwise. */
  amps: number;
  /** Total EU/t the build can drink: tier voltage x amps. */
  poolEuT: number;
  /** One parallel's modified draw, what ParallelHelper checks the pool against. */
  singleDrawEuT: number;
  /** Parallels actually running (structure capped by the pool). */
  parallels: number;
  /** The machine's draw while running: overclocked EU/t x parallels. */
  drawEuT: number;
  overclockSteps: number;
  /** Of which perfect (machine/heat) steps, taken first. See overclock.ts. */
  perfectOverclockSteps: number;
  /** A perfect step's duration divisor and EU/t multiplier. */
  perfectSpeedFactor: number;
  perfectEuFactor: number;
  /** drawEuT / poolEuT, for the usage figure. 0 when the pool is unbounded. */
  usage: number;
}

/**
 * Recipes whose card has no meaningful power section: nothing electric moves
 * through crops, bees, or zero-EU manual work.
 */
export function hasPowerReport(recipe: Recipe): boolean {
  if (!(Math.abs(recipe.eut) > 0) || recipe.durationTicks <= 0) {
    return false;
  }
  if (getCropsNhStats(recipe) || isIndustrialApiaryMachineType(recipe.machineType)) {
    return false;
  }
  return true;
}

export function getNodePowerReport(recipe: Recipe, node: PowerReportNode): NodePowerReport {
  const effectiveRecipe = recipe.machineType ? applyMachineHandlerToRecipe(recipe, node) : recipe;
  const minimumTier = getRecipeMinimumVoltageTier(effectiveRecipe);
  const tier = getNodeRunTier(effectiveRecipe, node);
  const isMultiblock = isMultiblockRecipe(effectiveRecipe);
  const hatches = getNodeEnergyHatches(effectiveRecipe, node);
  const amps = getNodePowerAmps(effectiveRecipe, node);
  const poolEuT = getVoltageTierMaxEuT(tier) * amps;

  const rawEuT = Math.abs(effectiveRecipe.eut);
  const eutMultiplier = getMachineEutMultiplier(effectiveRecipe, node);
  const heatDiscount = getHeatDiscountMultiplier(
    effectiveRecipe,
    node,
    tier,
    getEffectiveVoltageOrdinal(effectiveRecipe, node, tier),
  );
  const singleDrawEuT = Math.ceil(rawEuT * eutMultiplier * heatDiscount);

  const stats = getOverclockedRecipeStats(recipe, node);
  const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
  const parallels = runtimeVariant?.parallel ?? getMachineParallelMultiplier(effectiveRecipe, node);
  const drawEuT = Math.abs(stats.eut) * parallels;

  return {
    state: getPowerState(effectiveRecipe, tier, minimumTier, isMultiblock, poolEuT, singleDrawEuT),
    tier,
    minimumTier,
    hatches,
    isMultiblock,
    amps,
    poolEuT,
    singleDrawEuT,
    parallels,
    drawEuT,
    overclockSteps: stats.overclockSteps,
    perfectOverclockSteps: stats.perfectOverclockSteps,
    perfectSpeedFactor: stats.perfectSpeedFactor,
    perfectEuFactor: stats.perfectEuFactor,
    usage: Number.isFinite(poolEuT) && poolEuT > 0 ? drawEuT / poolEuT : 0,
  };
}

function getPowerState(
  effectiveRecipe: Recipe,
  tier: VoltageTier,
  minimumTier: VoltageTier,
  isMultiblock: boolean,
  poolEuT: number,
  singleDrawEuT: number,
): NodePowerState {
  const rawEuT = Math.abs(effectiveRecipe.eut);
  if (!(rawEuT > 0) || !Number.isFinite(poolEuT)) {
    return "ok";
  }

  // A structural minimum above the recipe's own power draw (an assembly line
  // gated to a tier, a casing requirement) cannot be bought with amps.
  const powerTier = getVoltageTierForEuT(rawEuT);
  const declaredMinimum = resolveVoltageTier(effectiveRecipe.minimumTier, powerTier);
  if (
    getVoltageTierIndex(declaredMinimum) > getVoltageTierIndex(powerTier) &&
    getVoltageTierIndex(tier) < getVoltageTierIndex(declaredMinimum)
  ) {
    return "over-tier";
  }

  if (isMultiblock) {
    // `OverclockCalculator.getAllowedTierSkip`: a recipe more than one tier
    // above the hatch voltage never runs, however many amps are stacked.
    if (rawEuT > getVoltageTierMaxEuT(tier) * 4) {
      return "over-tier";
    }
    // `ParallelHelper.determineParallel`: the pool must carry one whole
    // parallel of the modified draw or the machine reports insufficient power.
    if (singleDrawEuT > poolEuT) {
      return "under-powered";
    }
    return "ok";
  }

  // A singleblock has no hatches to add: a recipe over its machine's power
  // simply belongs to a higher-tier machine.
  if (singleDrawEuT > poolEuT) {
    return "over-tier";
  }
  return "ok";
}

export interface NodeSteamReport {
  /** L/t one machine burns at full speed, parallels included. */
  drawSteamPerTick: number;
  /** One parallel's L/t. */
  singleDrawSteamPerTick: number;
  parallels: number;
  isMultiblock: boolean;
  highPressure: boolean;
}

/**
 * What a steam machine burns. Steam never reaches the EU model (the handler
 * zeroes eut so no phantom power is billed); the litres follow each machine's
 * own rule, from the GT5-Unofficial source:
 *
 * - A singleblock converts 2 L per EU: a bronze machine runs the recipe's EU
 *   as written at twice the duration, a high pressure one at twice the EU and
 *   the recipe's own duration (SteamOverclockDescriber, (1,2) and (2,1)).
 * - A steam multiblock consumes 1 L per EU of its calculated draw
 *   (MTESteamMultiBlockBase.onRunningTick at full efficiency), and the draw is
 *   recipe EU x 1.25 x tierMachine per parallel, tierMachine 2 on a high
 *   pressure build.
 *
 * Smelting bills GT's fixed 4 EU/t furnace recipe; the dataset's vanilla map
 * says 0 EU (see GT_FURNACE_RECIPE_EUT).
 */
export function getNodeSteamReport(
  recipe: Recipe,
  node: PowerReportNode,
): NodeSteamReport | undefined {
  if (!recipe.machineType) {
    return undefined;
  }
  const handler = getSelectedMachineHandler(recipe, node);
  if (!isSteamMachineHandler(handler)) {
    return undefined;
  }
  const baseEut =
    Math.abs(recipe.eut) > 0
      ? Math.abs(recipe.eut)
      : isSmeltingRecipeMap(recipe)
        ? GT_FURNACE_RECIPE_EUT
        : 0;
  if (!(baseEut > 0) || recipe.durationTicks <= 0) {
    return undefined;
  }

  const effectiveRecipe = applyMachineHandlerToRecipe(recipe, node);
  if (effectiveRecipe.machineProfile?.kind === "multiblock") {
    const pressureTier = buildMachineContext(effectiveRecipe, node).tier(STEAM_PRESSURE) + 1;
    const parallels = getMachineParallelMultiplier(effectiveRecipe, node);
    const single = baseEut * 1.25 * pressureTier;
    return {
      drawSteamPerTick: Math.ceil(single * parallels),
      singleDrawSteamPerTick: single,
      parallels,
      isMultiblock: true,
      highPressure: pressureTier === 2,
    };
  }

  const highPressure = isHighPressureSteamHandler(handler);
  const single = baseEut * (highPressure ? 2 : 1) * 2;
  return {
    drawSteamPerTick: Math.ceil(single),
    singleDrawSteamPerTick: single,
    parallels: 1,
    isMultiblock: false,
    highPressure,
  };
}

/** True when the report says the machine cannot start at all. */
export function isPowerStalled(report: NodePowerReport): boolean {
  return report.state !== "ok";
}

/** One-line reason for a stalled build, used by node warnings. */
export function describePowerStall(report: NodePowerReport): string | undefined {
  if (report.state === "under-powered") {
    return (
      `Underpowered: the recipe draws ${report.singleDrawEuT} EU/t but ` +
      `${report.hatches}x ${report.tier} ${report.hatches === 1 ? "hatch supplies" : "hatches supply"} ` +
      `${report.poolEuT} EU/t. Add hatches or raise the tier.`
    );
  }
  if (report.state === "over-tier") {
    return (
      `Won't run at ${report.tier}: this recipe needs at least ` +
      `${report.minimumTier}${report.isMultiblock ? " hatches (amps cannot skip more than one tier)" : ""}.`
    );
  }
  return undefined;
}
