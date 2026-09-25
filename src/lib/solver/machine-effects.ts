import { getFusionStats } from "@/lib/machines/fusion";
import {
  getEecOutputMultiplier,
  getEecSettings,
  isEecRecipe,
} from "@/lib/machines/extreme-entity-crusher";
import {
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
  getRecipeSpecialValue,
} from "@/lib/model/recipe-rules";
import {
  BEE_APIARY_BASE_PRODUCTION_TERM,
  BEE_ENVIRONMENT_CONTROL_ID,
  BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
  BEE_INDUSTRIAL_SPEED_CONTROL_ID,
  CROPSNH_REFERENCE_ENVIRONMENT,
  MEGA_APIARY_BATCH_CYCLES,
  cropsNhEnvironmentFromTiers,
  cropsNhExpectedDrop,
  cropsNhGrowthRate,
  cropsNhGrowthSpeedMultiplier,
  cropsNhHarvestRoundMultiplier,
  cropsNhHarvestTicks,
  cropsNhHarvesterEnvironment,
  cropsNhHarvesterFromTiers,
  getBeeBaseProductionTerm,
  getBeeProductionTermModifier,
  getCropsNhStats,
  isBeeFrameSlotControlId,
  isBeeProductionRecipe,
} from "@/lib/model/passive-production";
import { getVoltageTierForEuT, getVoltageTierIndex, getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { getHeatDiscountMultiplier } from "./heat";
import { getEffectiveVoltageOrdinal, getNodeRunTier, getPowerPoolEuT } from "./power";
import {
  getMachineBehaviour,
  resolveCoefficient,
  type MachineContext,
} from "@/lib/machines/machine-table";
import type { FactoryNode, MachineTier, Recipe, RecipeOutput } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;

const TGS_BASE_OUTPUT_MULTIPLIER = 5;

/** What the machine table needs to read off a recipe. */
type MachineEffectRecipe = Pick<
  Recipe,
  "machineType" | "source" | "nei" | "machineConfigControls"
> &
  Partial<Pick<Recipe, "minimumTier" | "eut" | "metadata">>;

/** What it needs off the node the user configured. */
type MachineEffectNode = Pick<FactoryNode, "machineConfigTiers" | "coilTier"> &
  Partial<
    Pick<
      FactoryNode,
      | "overclockTier"
      | "machineHandlerId"
      | "energyHatches"
      | "energyHatchType"
      | "powerEuT"
      | "hatchVoltageTier"
      | "hatchAmps"
    >
  >;

/**
 * Reads the machine config tiers a node has selected as the zero-based indices
 * the curated machine table is written against.
 */
export function buildMachineContext(
  recipe: MachineEffectRecipe,
  node: MachineEffectNode,
): MachineContext {
  const controls = [
    ...getRecipeMachineConfigTierControls(recipe, node),
    ...(getRecipeCoilTierControl(recipe, node) ? [getRecipeCoilTierControl(recipe, node)!] : []),
  ];

  const find = (controlId: string) => controls.find((entry) => entry.id === controlId);

  return {
    tier: (controlId) => {
      const control = find(controlId);
      if (!control) {
        return 0;
      }
      // The position on the FULL ladder, as the table's formulas are written
      // against ("0 for cupronickel, 3 for TPV"): a control's tier list starts
      // at its minimum, so a per-recipe minimum (the NFR's field restriction
      // coils) must not renumber the rungs above it.
      return (
        (control.minimumIndex ?? 0) +
        Math.max(
          0,
          control.tiers.findIndex((entry) => entry.key === control.current.key),
        )
      );
    },
    value: (controlId) => {
      const control = find(controlId);
      if (!control) {
        return 0;
      }
      // Count knobs key their options by the number itself ("8"), or embed it
      // ("slice-3"). Either way the formulas want the count, not the position.
      const key = control.current.key;
      const parsed = Number(key);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      const trailing = /(\d+)$/.exec(key);
      if (trailing) {
        return Number(trailing[1]);
      }
      return Math.max(
        0,
        control.tiers.findIndex((entry) => entry.key === key),
      );
    },
    // What GTUtility.getTier(getMaxInputVoltage()) reports: the tier of the
    // SUMMED hatch voltage, so stacked hatches raise the ordinal the
    // "parallels per voltage tier" formulas scale on.
    voltageTier: getEffectiveVoltageOrdinal(recipe, node, getNodeRunTier(recipe as Recipe, node)),
    recipeVoltageTier: getVoltageTierIndex(getVoltageTierForEuT(Math.abs(recipe.eut ?? 0))),
    recipeSpecialValue: getRecipeSpecialValue(recipe),
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
  };
}

export function getMachineOutputMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls" | "metadata">,
  node: Pick<FactoryNode, "machineConfigTiers"> & Partial<Pick<FactoryNode, "machineHandlerId">>,
  output: RecipeOutput,
  tier: VoltageTier,
): number {
  if (isEecRecipe(recipe)) {
    return getEecOutputMultiplier(
      recipe as Partial<Pick<Recipe, "outputs">> & typeof recipe,
      output,
      getEecSettings(node.machineConfigTiers),
    );
  }
  const cropStats = getCropsNhStats(recipe);
  if (cropStats) {
    const setup = cropsNhHarvesterFromTiers(
      node.machineConfigTiers,
      node.machineHandlerId,
      cropStats.minSeedBedTier,
      cropStats.subSoil !== undefined,
    );
    // A machine-only crop grown in the world drops NOTHING on harvest (the
    // guide's rule: they grow and spread, but only a spade gets seeds out),
    // so a Crop Manager over one produces zero. Only the farm runs it.
    if (cropStats.machineOnly && setup.id !== "crop-industrial-farm") {
      return 0;
    }
    const env = cropsNhHarvesterEnvironment(
      setup,
      cropsNhEnvironmentFromTiers(node.machineConfigTiers),
    );
    if (cropsNhGrowthRate(cropStats, env) <= 0) {
      // Nutrient supply is 25+ under demand: the crop never grows (and risks
      // getting sick), so the farm produces nothing at all.
      return 0;
    }
    // Both harvesters multiply the drop ROUNDS, exactly where the crop's own
    // gain-driven rounds are computed, so this rides on the same ratio.
    const rounds = cropsNhHarvestRoundMultiplier(setup);
    const drop = cropStats.drops.find((entry) => entry.id === output.id);
    if (!drop) {
      return rounds;
    }
    const reference = cropsNhExpectedDrop(cropStats, CROPSNH_REFERENCE_ENVIRONMENT.gain, drop);
    const current = cropsNhExpectedDrop(cropStats, env.gain, drop);
    return (reference > 0 ? current / reference : 1) * rounds;
  }

  const configMultiplier = getRecipeMachineConfigTierControls(recipe, node)
    .filter(
      (control) =>
        !isTreeGrowthSimulatorToolControl(control.id) && !isBeeFrameSlotControlId(control.id),
    )
    .reduce((multiplier, control) => multiplier * (control.current.outputMultiplier ?? 1), 1);

  if (isBeeProductionRecipe(recipe)) {
    return (
      configMultiplier *
      getBeeClimateOutputMultiplier(recipe, node, output) *
      getBeeProductionTermOutputMultiplier(recipe, node, tier) *
      getBeeMegaApiaryBatchMultiplier(recipe, tier)
    );
  }

  if (!isTreeGrowthSimulatorRecipe(recipe)) {
    return configMultiplier;
  }

  const tierOrdinal = getVoltageTierIndex(tier) + 1;
  const tierMultiplier = (2 * tierOrdinal ** 2 - 2 * tierOrdinal + 5) / TGS_BASE_OUTPUT_MULTIPLIER;
  const toolMultiplier = getTreeGrowthSimulatorToolMultiplier(recipe, node, output);
  return configMultiplier * tierMultiplier * toolMultiplier;
}

function getBeeClimateOutputMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
  output: RecipeOutput,
) {
  if (hasBeeMegaApiaryRequirement(output) && !isMegaApiaryRecipe(recipe)) {
    return 0;
  }

  const climateControl = getRecipeMachineConfigTierControls(recipe, node).find(
    (control) => control.id === BEE_ENVIRONMENT_CONTROL_ID,
  );
  const climateKey = climateControl?.current.key;
  if (climateKey === "wrong") {
    return 0;
  }
  if (climateKey === "tolerated" && hasBeePreferredClimateRequirement(output)) {
    return 0;
  }
  return 1;
}

function hasBeePreferredClimateRequirement(output: RecipeOutput) {
  return output.tooltip?.some((line) => /needs preferred climate/i.test(line)) ?? false;
}

function hasBeeMegaApiaryRequirement(output: RecipeOutput) {
  return output.tooltip?.some((line) => /only be produced in mega apiary/i.test(line)) ?? false;
}

function isMegaApiaryRecipe(recipe: Pick<Recipe, "machineType">) {
  return isMegaApiaryMachineType(recipe.machineType);
}

function getBeeProductionTermOutputMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
  tier: VoltageTier,
) {
  const baseTerm = getBeeBaseProductionTerm(recipe.machineType);
  const controls = getRecipeMachineConfigTierControls(recipe, node);
  const hasUpgradedSpeed8 = controls.some(
    (control) =>
      control.id === BEE_INDUSTRIAL_SPEED_CONTROL_ID && control.current.key === "speed-8-upgraded",
  );
  const configModifier = controls.reduce((sum, control) => {
    if (hasUpgradedSpeed8 && control.id === BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID) {
      return sum;
    }
    return sum + getBeeProductionTermModifier(control.id, control.current.key);
  }, 0);
  const productionTerm =
    baseTerm + configModifier + getBeeMegaApiaryVoltageProductionModifier(recipe, tier);
  if (productionTerm <= 0) {
    return 0;
  }
  return Math.pow(productionTerm / BEE_APIARY_BASE_PRODUCTION_TERM, 0.52);
}

function getBeeMegaApiaryBatchMultiplier(recipe: Pick<Recipe, "machineType">, tier: VoltageTier) {
  if (!isMegaApiaryRecipe(recipe)) {
    return 1;
  }
  return MEGA_APIARY_BATCH_CYCLES * 4 ** getBeeMegaApiaryVoltageOffset(tier);
}

function getBeeMegaApiaryVoltageProductionModifier(
  recipe: Pick<Recipe, "machineType">,
  tier: VoltageTier,
) {
  if (!isMegaApiaryRecipe(recipe)) {
    return 0;
  }
  return getBeeMegaApiaryVoltageOffset(tier);
}

export function getBeeMegaApiaryVoltageOffset(tier: VoltageTier) {
  const offset = getVoltageTierIndex(tier) - getVoltageTierIndex("LuV");
  return Math.max(0, Math.min(3, offset));
}

export function getBeeMegaApiaryTierEutMultiplier(tier: VoltageTier) {
  return 4 ** getBeeMegaApiaryVoltageOffset(tier);
}

export function isMegaApiaryMachineType(machineType: string) {
  return normalizeRecipeMapName(machineType).includes("mega apiary");
}

export function applyMachineOutputMultipliers(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineConfigTiers">,
  tier: VoltageTier,
): Recipe {
  const outputs = recipe.outputs.map((output) => {
    const multiplier = getMachineOutputMultiplier(recipe, node, output, tier);
    return multiplier === 1 ? output : { ...output, amount: output.amount * multiplier };
  });

  return outputs.some((output, index) => output !== recipe.outputs[index])
    ? { ...recipe, outputs }
    : recipe;
}

function getTreeGrowthSimulatorToolMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
  output: RecipeOutput,
) {
  const category = getTreeGrowthSimulatorOutputCategory(output);
  if (!category) {
    return 1;
  }

  const normalizedCategory = category.toLowerCase();
  const controls = getRecipeMachineConfigTierControls(recipe, node);
  const slotControl = controls
    .filter((entry) => /^tgsToolSlot\d+$/.test(entry.id))
    .filter((entry) => getTreeGrowthSimulatorSlotCategory(entry.id) === normalizedCategory)
    .find((entry) => getTreeGrowthSimulatorToolCategory(entry.current.key) === normalizedCategory);
  const categoryControl = controls.find((entry) => entry.id === `tgs${category}Tool`);

  if (controls.some((entry) => /^tgsToolSlot\d+$/.test(entry.id))) {
    return slotControl?.current.outputMultiplier ?? 0;
  }

  return slotControl?.current.outputMultiplier ?? categoryControl?.current.outputMultiplier ?? 1;
}

export function getMachineParallelMultiplier(
  recipe: MachineEffectRecipe,
  node: MachineEffectNode,
): number {
  return Math.min(
    getMachineStructuralParallels(recipe, node),
    getPoweredParallelLimit(recipe, node),
  );
}

export function getMachineStructuralParallels(
  recipe: MachineEffectRecipe,
  node: MachineEffectNode,
): number {
  const fusion = getFusionStats(recipe);
  if (fusion) return fusion.parallels;
  // GT++ "Voltage Tier * n Parallels" scales with the tier the machine runs
  // at; the GT tier ordinal counts ULV as 0, LV as 1, and so on. Stacked
  // hatches raise it, because the game reads the tier of the SUMMED voltage.
  const tierOrdinal = Math.max(
    1,
    getEffectiveVoltageOrdinal(recipe, node, getNodeRunTier(recipe as Recipe, node)),
  );
  const behaviour = getMachineBehaviour(recipe.machineType);
  const structural = behaviour
    ? Math.max(
        1,
        Math.floor(resolveCoefficient(behaviour.parallels, buildMachineContext(recipe, node), 1)),
      )
    : getRecipeMachineConfigTierControls(recipe, node).reduce((multiplier, control) => {
        const fixed = control.current.parallelMultiplier ?? 1;
        const perTier = control.current.parallelPerVoltageTier;
        const base = control.current.parallelVoltageBase ?? 0;
        const scaled = Number.isFinite(perTier)
          ? Math.max(1, Math.floor(base + (perTier as number) * tierOrdinal))
          : 1;
        return multiplier * fixed * scaled;
      }, 1);

  return structural;
}

/**
 * How many parallels the supplied voltage can actually pay for.
 *
 * Parallels multiply EU/t one-for-one, so a machine only reaches its
 * structural parallel count when the energy hatch can carry the whole draw.
 * A chem plant with titanium pipe casings offers six parallels, but a 480
 * EU/t recipe on an HV hatch (512 EU/t) can only run one of them.
 */
function getPoweredParallelLimit(recipe: MachineEffectRecipe, node: MachineEffectNode): number {
  const runTier = getNodeRunTier(recipe as Recipe, node);
  const available = getPowerPoolEuT(recipe, node, runTier);
  if (!Number.isFinite(available)) {
    return Number.POSITIVE_INFINITY;
  }

  // Energy discounts land before parallels, so a discounted recipe fits more
  // of them into the same hatch. The heat discount counts too:
  // `ParallelHelper.determineParallel` folds it into `tRecipeEUt` before
  // dividing the available EU, so a hot blast furnace runs more parallels.
  const recipeEuT =
    Math.abs(recipe.eut ?? 0) *
    getMachineEutMultiplier(recipe, node) *
    getHeatDiscountMultiplier(
      recipe,
      node,
      runTier,
      getEffectiveVoltageOrdinal(recipe, node, runTier),
    );
  if (!(recipeEuT > 0)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, Math.floor(available / recipeEuT));
}

export function getMachineDurationMultiplier(
  recipe: MachineEffectRecipe,
  node: MachineEffectNode,
): number {
  const cropStats = getCropsNhStats(recipe);
  if (cropStats) {
    const setup = cropsNhHarvesterFromTiers(
      node.machineConfigTiers,
      node.machineHandlerId,
      cropStats.minSeedBedTier,
      cropStats.subSoil !== undefined,
    );
    const env = cropsNhHarvesterEnvironment(
      setup,
      cropsNhEnvironmentFromTiers(node.machineConfigTiers),
    );
    const ticks = cropsNhHarvestTicks(cropStats, env);
    const referenceTicks = cropsNhHarvestTicks(cropStats, CROPSNH_REFERENCE_ENVIRONMENT);
    if (!Number.isFinite(ticks) || referenceTicks <= 0) {
      // Non-growing crops are surfaced through a zero output multiplier;
      // keep the duration finite so the solver stays stable.
      return 1;
    }
    // An Industrial Farm cycle banks `progressPerCycle` of a harvest, so its
    // time per harvest is the crop stick's own divided by the growth speed
    // multiplier. A Crop Manager grows at the world's pace and divides by 1.
    return ticks / referenceTicks / cropsNhGrowthSpeedMultiplier(setup);
  }

  // The curated table states speed as a throughput multiplier, so a machine
  // that runs at 200% divides the duration by two.
  const behaviour = getMachineBehaviour(recipe.machineType);
  if (behaviour) {
    const speed = resolveCoefficient(behaviour.speed, buildMachineContext(recipe, node), 1);
    return speed > 0 ? 1 / speed : 1;
  }

  const coilControl = getRecipeCoilTierControl(recipe, node);
  const coilMultiplier = coilControl?.current.durationMultiplier ?? 1;
  const configMultiplier = getRecipeMachineConfigTierControls(recipe, node).reduce(
    (multiplier, control) => multiplier * (control.current.durationMultiplier ?? 1),
    1,
  );
  return coilMultiplier * configMultiplier;
}

export function getMachineEutMultiplier(
  recipe: MachineEffectRecipe,
  node: MachineEffectNode,
): number {
  const behaviour = getMachineBehaviour(recipe.machineType);
  if (behaviour) {
    return resolveCoefficient(behaviour.power, buildMachineContext(recipe, node), 1);
  }

  const coilControl = getRecipeCoilTierControl(recipe, node);
  const coilMultiplier = coilControl?.current.eutMultiplier ?? 1;
  const controls = getRecipeMachineConfigTierControls(recipe, node);
  const hasUpgradedSpeed8 = controls.some(
    (control) =>
      control.id === BEE_INDUSTRIAL_SPEED_CONTROL_ID && control.current.key === "speed-8-upgraded",
  );
  const configMultiplier = controls.reduce((multiplier, control) => {
    if (hasUpgradedSpeed8 && control.id === BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID) {
      return multiplier;
    }
    return multiplier * (control.current.eutMultiplier ?? 1);
  }, 1);
  return coilMultiplier * configMultiplier;
}

function getTreeGrowthSimulatorOutputCategory(output: RecipeOutput) {
  const slot = output.neiSlot;
  if (slot?.x === 108 && slot.y === 36) {
    return "Log";
  }
  if (slot?.x === 126 && slot.y === 36) {
    return "Sapling";
  }
  if (slot?.x === 108 && slot.y === 54) {
    return "Leaves";
  }
  if (slot?.x === 126 && slot.y === 54) {
    return "Fruit";
  }

  const label = `${output.displayName ?? ""} ${output.id}`.toLowerCase();
  if (label.includes("sapling")) {
    return "Sapling";
  }
  if (label.includes("leaves") || label.includes("leaf")) {
    return "Leaves";
  }
  if (label.includes("log") || label.includes("wood")) {
    return "Log";
  }
  return "Fruit";
}

function getTreeGrowthSimulatorToolCategory(key: string): string | undefined {
  const [category] = key.split(":");
  return category && category !== "none" ? category : undefined;
}

function isTreeGrowthSimulatorToolControl(controlId: string): boolean {
  return (
    /^tgsToolSlot\d+$/.test(controlId) || /^tgs(?:Log|Sapling|Leaves|Fruit)Tool$/.test(controlId)
  );
}

function getTreeGrowthSimulatorSlotCategory(controlId: string): string | undefined {
  switch (controlId) {
    case "tgsToolSlot1":
      return "log";
    case "tgsToolSlot2":
      return "sapling";
    case "tgsToolSlot3":
      return "leaves";
    case "tgsToolSlot4":
      return "fruit";
    default:
      return undefined;
  }
}

function isTreeGrowthSimulatorRecipe(recipe: Pick<Recipe, "machineType" | "source">): boolean {
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
