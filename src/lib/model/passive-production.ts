import type {
  FactoryNode,
  MachineConfigControl,
  MachineConfigTierOption,
  MachineHandler,
  Recipe,
  ResourceAmount,
} from "./types";

export const CROP_STATS_CONTROL_ID = "cropStats";
export const CROP_HYDRATION_CONTROL_ID = "cropHydration";
export const CROP_NUTRIENTS_CONTROL_ID = "cropNutrients";
export const CROP_SOIL_CONTROL_ID = "cropSoil";
export const CROP_SOIL_DEPTH_CONTROL_ID = "cropSoilDepth";
export const CROP_AIR_QUALITY_CONTROL_ID = "cropAirQuality";

export const CROP_GROWTH_STAT_CONTROL_ID = "cropGrowthStat";
export const CROP_GAIN_STAT_CONTROL_ID = "cropGainStat";
export const CROP_WATER_CONTROL_ID = "cropWater";
export const CROP_FERTILIZER_CONTROL_ID = "cropFertilizer";
export const CROP_SKY_CONTROL_ID = "cropSky";
export const CROP_BIOME_CONTROL_ID = "cropBiome";

// Harvester controls. Which of these a card shows depends on the selected
// handler: an Industrial Farm simulates its own water, fertilizer and sky, so
// those three knobs are absent from it entirely.
export const CROP_MANAGER_TIER_CONTROL_ID = "cropManagerTier";
export const CROP_SEED_BED_TIER_CONTROL_ID = "cropSeedBedTier";
export const CROP_IF_GROWTH_UNIT_CONTROL_ID = "cropIfGrowthUnits";
export const CROP_IF_FERTILIZER_UNIT_CONTROL_ID = "cropIfFertilizerUnits";
export const CROP_IF_HARVEST_UNIT_CONTROL_ID = "cropIfHarvestUnits";
export const CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID = "cropIfEnvironmentUnits";
export const CROP_IF_OVERCLOCK_CONTROL_ID = "cropIfOverclocks";

export const CROP_HARVESTER_MANAGER_ID = "crop-manager";
export const CROP_HARVESTER_INDUSTRIAL_FARM_ID = "crop-industrial-farm";
/** Manager tier key for sticks nobody automates: you walk over and pick them. */
export const CROP_NO_MANAGER_KEY = "none";
const NO_MANAGER_TIER_INDEX = -1;

export const BEE_FRAME_SLOT_CONTROL_PREFIX = "beeFrameSlot";
export const BEE_ENVIRONMENT_CONTROL_ID = "beeEnvironment";
export const BEE_MAGIC_AURA_CONTROL_ID = "beeMagicAura";
export const BEE_ALVEARY_FRAME_HOUSING_CONTROL_ID = "beeAlvearyFrameHousing";
export const BEE_ALVEARY_STIMULATOR_CONTROL_ID = "beeAlvearyStimulator";
export const BEE_ALVEARY_SUPPORT_CONTROL_ID = "beeAlvearySupport";
export const BEE_INDUSTRIAL_SPEED_CONTROL_ID = "beeIndustrialSpeed";
export const BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID = "beeIndustrialProduction";
export const BEE_MEGA_ROYAL_JELLY_CONTROL_ID = "beeMegaRoyalJelly";
export const BEE_APIARY_BASE_PRODUCTION_TERM = 0.1;
const BEE_MAGIC_APIARY_BASE_PRODUCTION_TERM = 0.9;
const BEE_ALVEARY_BASE_PRODUCTION_TERM = 1;
const BEE_INDUSTRIAL_APIARY_BASE_PRODUCTION_TERM = 10;
export const BEE_MEGA_APIARY_BASE_PRODUCTION_TERM = 17.19926784 + 6;
export const MEGA_APIARY_BATCH_CYCLES = 6400 / 550;
const INDUSTRIAL_APIARY_BASE_EUT = 37;
const INDUSTRIAL_APIARY_ACCELERATION_AMP_EUT = [32, 128, 512, 2048, 8192, 32768, 131072, 524288];
const INDUSTRIAL_APIARY_PRODUCTION_EUT_MULTIPLIER = 1.4;

const CROP_CONTROL_IDS = new Set([
  CROP_STATS_CONTROL_ID,
  CROP_HYDRATION_CONTROL_ID,
  CROP_NUTRIENTS_CONTROL_ID,
  CROP_SOIL_CONTROL_ID,
  CROP_SOIL_DEPTH_CONTROL_ID,
  CROP_AIR_QUALITY_CONTROL_ID,
  CROP_GROWTH_STAT_CONTROL_ID,
  CROP_GAIN_STAT_CONTROL_ID,
  CROP_WATER_CONTROL_ID,
  CROP_FERTILIZER_CONTROL_ID,
  CROP_SKY_CONTROL_ID,
  CROP_BIOME_CONTROL_ID,
  CROP_MANAGER_TIER_CONTROL_ID,
  CROP_SEED_BED_TIER_CONTROL_ID,
  CROP_IF_GROWTH_UNIT_CONTROL_ID,
  CROP_IF_FERTILIZER_UNIT_CONTROL_ID,
  CROP_IF_HARVEST_UNIT_CONTROL_ID,
  CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID,
  CROP_IF_OVERCLOCK_CONTROL_ID,
]);

const BEE_CONTROL_IDS = new Set([
  BEE_ENVIRONMENT_CONTROL_ID,
  BEE_MAGIC_AURA_CONTROL_ID,
  BEE_ALVEARY_FRAME_HOUSING_CONTROL_ID,
  BEE_ALVEARY_STIMULATOR_CONTROL_ID,
  BEE_ALVEARY_SUPPORT_CONTROL_ID,
  BEE_INDUSTRIAL_SPEED_CONTROL_ID,
  BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
  BEE_MEGA_ROYAL_JELLY_CONTROL_ID,
]);

export interface CropStatsPreset {
  growth: number;
  gain: number;
  resistance: number;
}

interface Ic2CropSimulationProfile {
  tier: number;
  environmentScore: number;
  baselineStats: CropStatsPreset;
}

type PassiveProductionRecipeLabel = Pick<Recipe, "machineType" | "source"> & {
  name?: string;
  recipeMap?: string;
};

const IC2_STICKREED_PROFILE: Ic2CropSimulationProfile = {
  tier: 4,
  environmentScore: 120,
  baselineStats: { growth: 23, gain: 31, resistance: 0 },
};

const CROPNH_GENERIC_PROFILE: Ic2CropSimulationProfile = {
  tier: 1,
  environmentScore: 120,
  baselineStats: { growth: 31, gain: 31, resistance: 31 },
};

export interface CropsNhStats {
  tier: number;
  growthPoints: number;
  dropChance: number;
  growthCycleTicks: number;
  growthMultiplier: number;
  machineOnly?: boolean;
  drops: Array<{ id: string; stackSize: number; weight: number }>;
}

export interface CropsNhEnvironment {
  growth: number;
  gain: number;
  water: number;
  fertilizer: number;
  sky: boolean;
  biomeBonus: number;
}

/**
 * Reference point used by the dataset pipeline when baking baseline
 * duration/output values: perfect 31/31/31 seeds on a fully supplied farm.
 * Solver multipliers are computed relative to this environment.
 */
export const CROPSNH_REFERENCE_ENVIRONMENT: CropsNhEnvironment = {
  growth: 31,
  gain: 31,
  water: 100,
  fertilizer: 100,
  sky: true,
  biomeBonus: 28,
};

export function getCropsNhStats(
  recipe: Pick<Recipe, "metadata">,
): CropsNhStats | undefined {
  const meta = (recipe.metadata as { cropsNh?: Record<string, unknown> } | undefined)?.cropsNh;
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const tier = toPositiveNumber(meta.tier);
  const growthPoints = toPositiveNumber(meta.growthPoints);
  const dropChance = toPositiveNumber(meta.dropChance);
  if (!tier || !growthPoints || !dropChance) {
    return undefined;
  }
  const drops = Array.isArray(meta.drops)
    ? (meta.drops as Array<Record<string, unknown>>)
        .map((entry) => ({
          id: String(entry.id ?? ""),
          stackSize: toPositiveNumber(entry.stackSize) ?? 1,
          weight: toPositiveNumber(entry.weight) ?? 0,
        }))
        .filter((entry) => entry.id && entry.weight > 0)
    : [];
  return {
    tier,
    growthPoints,
    dropChance,
    growthCycleTicks: toPositiveNumber(meta.growthCycleTicks) ?? 256,
    growthMultiplier: toPositiveNumber(meta.growthMultiplier) ?? 1,
    machineOnly: meta.machineOnly === true ? true : undefined,
    drops,
  };
}

// The following mirror TileEntityCropSticks (verified against 2.9 bytecode):
// getNutrientsPerCycle, getGrowthRate, doGrowth and harvest.

export function cropsNhNutrientScore(env: CropsNhEnvironment): number {
  const waterBonus = Math.floor((Math.min(100, Math.max(0, env.water)) + 9) / 10);
  const fertilizerBonus = Math.floor((Math.min(100, Math.max(0, env.fertilizer)) + 9) / 10);
  return 5 + waterBonus + fertilizerBonus + (env.sky ? 2 : 0) + Math.max(0, env.biomeBonus);
}

export function cropsNhGrowthRate(stats: CropsNhStats, env: CropsNhEnvironment): number {
  const supply = cropsNhNutrientScore(env) * 5;
  const demand = stats.tier * 10;
  const base = 6 + Math.max(1, Math.min(31, env.growth));
  const rate =
    supply >= demand
      ? Math.trunc((base * (100 + supply - demand)) / 100)
      : Math.max(0, Math.trunc((base * (100 - (demand - supply) * 4)) / 100));
  return Math.trunc(rate * stats.growthMultiplier);
}

export function cropsNhHarvestTicks(stats: CropsNhStats, env: CropsNhEnvironment): number {
  const perCycle = cropsNhGrowthRate(stats, env);
  if (perCycle <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(stats.growthPoints / perCycle) * stats.growthCycleTicks;
}

export function cropsNhExpectedDrop(
  stats: CropsNhStats,
  gain: number,
  drop: { stackSize: number; weight: number },
): number {
  const clampedGain = Math.max(1, Math.min(31, gain));
  const rounds = stats.dropChance * 1.03 ** clampedGain;
  return rounds * (drop.weight / 10000) * (drop.stackSize + (clampedGain + 1) / 100);
}

const CROP_BIOME_BONUS_BY_KEY: Record<string, number> = {
  "two-tags": 28,
  "one-tag": 14,
  humid: 14,
  none: 0,
};

export function cropsNhEnvironmentFromTiers(
  tiers: Record<string, string | undefined> | undefined,
): CropsNhEnvironment {
  const reference = CROPSNH_REFERENCE_ENVIRONMENT;
  const growth = Number.parseInt(tiers?.[CROP_GROWTH_STAT_CONTROL_ID] ?? "", 10);
  const gain = Number.parseInt(tiers?.[CROP_GAIN_STAT_CONTROL_ID] ?? "", 10);
  const water = Number.parseInt(tiers?.[CROP_WATER_CONTROL_ID] ?? "", 10);
  const fertilizer = Number.parseInt(tiers?.[CROP_FERTILIZER_CONTROL_ID] ?? "", 10);
  const sky = tiers?.[CROP_SKY_CONTROL_ID];
  const biome = tiers?.[CROP_BIOME_CONTROL_ID];
  return {
    growth: Number.isFinite(growth) ? growth : reference.growth,
    gain: Number.isFinite(gain) ? gain : reference.gain,
    water: Number.isFinite(water) ? water : reference.water,
    fertilizer: Number.isFinite(fertilizer) ? fertilizer : reference.fertilizer,
    sky: sky === undefined ? reference.sky : sky === "yes",
    biomeBonus: biome === undefined ? reference.biomeBonus : (CROP_BIOME_BONUS_BY_KEY[biome] ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Harvesters
//
// CropsNH ships exactly two machines that harvest a crop: the Crop Manager
// (`MTECropManager`, a singleblock that works real crop sticks in the world)
// and the Industrial Farm (`MTEIndustrialFarm`, a multiblock that simulates
// the crop internally). Everything else with "Crop" in its name - Crop
// Breeder, Crop Gene Extractor, Crop Synthesizer, Seed Generator - breeds or
// duplicates seeds and never harvests. Every constant below is transcribed
// from those two classes plus `TileEntityCropSticks`; do not tune them by eye.
// ---------------------------------------------------------------------------

/** `MTECropManager.getHarvestBonusChance` = 0.05 * mTier, fed to `crop.harvest`. */
const CROP_MANAGER_HARVEST_BONUS_PER_TIER = 0.05;
/**
 * `MTECropManager.getVerticalRadius` = 2, so it reaches five layers of sticks
 * at every tier. This is the machine's capacity, not a question for the
 * player: a card says how many crop sticks it has and who picks them, and how
 * many machines that takes falls out of the two.
 */
export const CROP_MANAGER_LAYERS = 5;
/** `BlockSeedBed.HARVEST_ROUND_BONUS` = 0.2, applied as tier * bonus. */
const SEED_BED_HARVEST_ROUND_BONUS_PER_TIER = 0.2;
/** `BlockGrowthAccelerationUnit.GROWTH_SPEED_BONUS` = 1.0, additive per unit. */
const GROWTH_ACCELERATION_SPEED_BONUS = 1;
/** `BlockFertilizerUnit.GROWTH_SPEED_MULTIPLIER` / `.HARVEST_ROUND_BONUS` = 0.5. */
const FERTILIZER_UNIT_SPEED_MULTIPLIER = 0.5;
const FERTILIZER_UNIT_HARVEST_ROUND_BONUS = 0.5;
/** `BlockAdvancedHarvestingUnit.HARVEST_ROUND_MULTIPLIER` = 0.2, max 2 units. */
const ADVANCED_HARVESTING_ROUND_MULTIPLIER = 0.2;
const MAX_ADVANCED_HARVESTING_UNITS = 2;
/** `BlockEnvironmentalEnhancementUnit.MAX_UPGRADE_COUNT` = 2 biome cards. */
const MAX_ENVIRONMENTAL_UNITS = 2;
/** `BlockFertilizerUnit.MAX_UPGRADE_COUNT` = 1. */
const MAX_FERTILIZER_UNITS = 1;
/** `MTEIndustrialFarm.SIMULATED_WATER_STORAGE` / `..._FERTILIZER_...PROVIDED`. */
const INDUSTRIAL_FARM_SIMULATED_STORAGE = 200;
/** `TileEntityCropSticks.MAX_LIKED_BIOME_TAG_COUNT` = 2, each worth 14. */
const CROP_BIOME_BONUS_PER_TAG = 14;
/** `MTEIndustrialFarm`: MIN_CASING_TIER = MV, MAX_CASING_TIER = UXV. */
const SEED_BED_MIN_TIER_INDEX = 2;
const SEED_BED_MAX_TIER_INDEX = 13;
/** `MTECropManager` is registered LV through UV. */
const CROP_MANAGER_MIN_TIER_INDEX = 1;
const CROP_MANAGER_MAX_TIER_INDEX = 8;
/** The Overclocked Growth Acceleration Unit needs a ZPM seed bed or better. */
const OVERCLOCK_UNIT_MIN_TIER_INDEX = 7;
const MAX_OVERCLOCKS = 6;

const VOLTAGE_TIER_NAMES = [
  "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV", "UXV",
];

export type CropHarvesterId =
  | typeof CROP_HARVESTER_MANAGER_ID
  | typeof CROP_HARVESTER_INDUSTRIAL_FARM_ID;

export interface CropHarvesterSetup {
  id: CropHarvesterId;
  /**
   * Voltage ordinal of the machine or seed bed (ULV 0, LV 1, MV 2, ...), or
   * -1 on the crop stick side to mean nobody is automating it. Picking by
   * hand is a Crop Manager tier below LV, not a mode of its own: the crop
   * grows in the world either way and answers the same six knobs.
   */
  tierIndex: number;
  growthUnits: number;
  fertilizerUnits: number;
  harvestUnits: number;
  environmentUnits: number;
  overclocks: number;
}

/**
 * `MTECropManager.getHorizontalRadius` = 3 + 2 * tier, and the seed bed reuses
 * it: `BlockSeedBed.getCapacity` is that same square. So one Crop Manager
 * layer and one Industrial Farm both work (4 * tier + 7)^2 crops.
 */
export function cropsNhSquarePerTier(tierIndex: number): number {
  const radius = 3 + Math.max(0, 2 * tierIndex);
  const side = radius * 2 + 1;
  return side * side;
}

/** True when the crop grows on sticks with nothing automating the harvest. */
export function cropsNhIsHandPicked(setup: CropHarvesterSetup): boolean {
  return setup.id === CROP_HARVESTER_MANAGER_ID && setup.tierIndex < 0;
}

/** How many crops one machine of this setup works at once. */
export function cropsNhCropsPerMachine(setup: CropHarvesterSetup): number {
  if (cropsNhIsHandPicked(setup)) {
    return 1;
  }
  if (setup.id === CROP_HARVESTER_MANAGER_ID) {
    return cropsNhSquarePerTier(setup.tierIndex) * CROP_MANAGER_LAYERS;
  }
  return cropsNhSquarePerTier(setup.tierIndex);
}

/**
 * Machines a crop card actually builds. A crop card's `machineCount` is the
 * number of PLANTED CROPS, never a machine count: fifty oilberry sticks under
 * one LV Crop Manager are one machine, not fifty. Hand-picked crops build
 * nothing at all.
 */
export function cropsNhHarvesterMachineCount(
  setup: CropHarvesterSetup,
  cropCount: number,
): number {
  if (cropsNhIsHandPicked(setup) || !(cropCount > 0)) {
    return 0;
  }
  return Math.ceil(cropCount / cropsNhCropsPerMachine(setup));
}

/**
 * What a card contributes to a MACHINE count (the build list, a shared plan's
 * stat card, a pocket's face). An ordinary card is its machineCount; a crop
 * card counts the harvesters its planted crops fill instead, and the legacy
 * passive crops, which have no harvester behind them at all, count nothing.
 */
export function getNodeMachineBuildCount(
  recipe:
    | (Pick<Recipe, "machineType" | "source" | "metadata"> & { name?: string; recipeMap?: string })
    | undefined,
  node: Pick<FactoryNode, "machineCount"> &
    Partial<Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId">>,
): number {
  if (recipe && getCropsNhStats(recipe)) {
    return cropsNhHarvesterMachineCount(
      cropsNhHarvesterFromTiers(node.machineConfigTiers, node.machineHandlerId),
      Math.round(node.machineCount),
    );
  }
  if (recipe && isCropProductionRecipe(recipe)) {
    return 0;
  }
  return Math.max(0, Math.round(node.machineCount));
}

/** `MTEIndustrialFarm`: upgrade slots = clamp(tier - MIN_CASING_TIER + 1, 1, 12). */
export function cropsNhUpgradeSlots(tierIndex: number): number {
  return clampInt(tierIndex - SEED_BED_MIN_TIER_INDEX + 1, 1, 1 + SEED_BED_MAX_TIER_INDEX - SEED_BED_MIN_TIER_INDEX);
}

export function cropsNhHarvesterFromTiers(
  tiers: Record<string, string | undefined> | undefined,
  handlerId: string | undefined,
): CropHarvesterSetup {
  const id: CropHarvesterId =
    handlerId === CROP_HARVESTER_INDUSTRIAL_FARM_ID
      ? CROP_HARVESTER_INDUSTRIAL_FARM_ID
      : CROP_HARVESTER_MANAGER_ID;
  const read = (controlId: string, fallback: number) => {
    const parsed = Number.parseInt(tiers?.[controlId] ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  // An unset or "none" manager tier parses to nothing, which is exactly the
  // hand-picked default every card starts on.
  const tierIndex =
    id === CROP_HARVESTER_MANAGER_ID
      ? clampInt(
          read(CROP_MANAGER_TIER_CONTROL_ID, NO_MANAGER_TIER_INDEX),
          NO_MANAGER_TIER_INDEX,
          CROP_MANAGER_MAX_TIER_INDEX,
        )
      : clampInt(read(CROP_SEED_BED_TIER_CONTROL_ID, SEED_BED_MIN_TIER_INDEX), SEED_BED_MIN_TIER_INDEX, SEED_BED_MAX_TIER_INDEX);
  const slots = cropsNhUpgradeSlots(tierIndex);
  const fertilizerUnits = clampInt(read(CROP_IF_FERTILIZER_UNIT_CONTROL_ID, 0), 0, MAX_FERTILIZER_UNITS);
  const harvestUnits = clampInt(read(CROP_IF_HARVEST_UNIT_CONTROL_ID, 0), 0, MAX_ADVANCED_HARVESTING_UNITS);
  const environmentUnits = clampInt(read(CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID, 0), 0, MAX_ENVIRONMENTAL_UNITS);
  const overclocks =
    tierIndex >= OVERCLOCK_UNIT_MIN_TIER_INDEX
      ? clampInt(read(CROP_IF_OVERCLOCK_CONTROL_ID, 0), 0, MAX_OVERCLOCKS)
      : 0;
  // The Overclocked unit and plain Growth Acceleration units are mutually
  // exclusive (`SE_OCGAU_EXCLUSIVITY`), and every unit competes for the same
  // slots, so a card can never claim more upgrades than the structure allows.
  const requestedGrowth = overclocks > 0 ? 0 : clampInt(read(CROP_IF_GROWTH_UNIT_CONTROL_ID, 0), 0, slots);
  const usedByOthers = fertilizerUnits + harvestUnits + environmentUnits + (overclocks > 0 ? 1 : 0);
  return {
    id,
    tierIndex,
    growthUnits: Math.max(0, Math.min(requestedGrowth, slots - usedByOthers)),
    fertilizerUnits,
    harvestUnits,
    environmentUnits,
    overclocks,
  };
}

/**
 * The Industrial Farm does not read the world: `getNutrientScore` feeds
 * `getNutrientsPerCycle` a fixed water and fertilizer storage of 200 and
 * `SIMULATED_CAN_SEE_SKY = true`. Only the biome still varies, and each
 * Environmental Enhancement Unit adds a liked biome tag on top of it.
 */
export function cropsNhHarvesterEnvironment(
  setup: CropHarvesterSetup,
  base: CropsNhEnvironment,
): CropsNhEnvironment {
  if (setup.id !== CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
    return base;
  }
  return {
    ...base,
    water: INDUSTRIAL_FARM_SIMULATED_STORAGE,
    fertilizer: INDUSTRIAL_FARM_SIMULATED_STORAGE,
    sky: true,
    biomeBonus: Math.max(base.biomeBonus, setup.environmentUnits * CROP_BIOME_BONUS_PER_TAG),
  };
}

/**
 * `MTEIndustrialFarm.getGrowthSpeedMultiplier`. A crop stick and a Crop
 * Manager both grow at the world's own pace, so only the farm moves this.
 */
export function cropsNhGrowthSpeedMultiplier(setup: CropHarvesterSetup): number {
  if (setup.id !== CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
    return 1;
  }
  const additive = 1 + setup.growthUnits * GROWTH_ACCELERATION_SPEED_BONUS;
  return additive * (1 + setup.fertilizerUnits * FERTILIZER_UNIT_SPEED_MULTIPLIER) * 2 ** setup.overclocks;
}

/**
 * What multiplies the drop ROUNDS. The Crop Manager passes
 * `1 + 0.05 * tier` into `crop.harvest`; the farm builds the same number out
 * of its seed bed tier and units in `getHarvestRoundMultiplier`.
 */
export function cropsNhHarvestRoundMultiplier(setup: CropHarvesterSetup): number {
  if (cropsNhIsHandPicked(setup)) {
    return 1;
  }
  if (setup.id === CROP_HARVESTER_MANAGER_ID) {
    return 1 + CROP_MANAGER_HARVEST_BONUS_PER_TIER * setup.tierIndex;
  }
  const additive =
    1 +
    SEED_BED_HARVEST_ROUND_BONUS_PER_TIER * setup.tierIndex +
    setup.fertilizerUnits * FERTILIZER_UNIT_HARVEST_ROUND_BONUS;
  return additive * (1 + setup.harvestUnits * ADVANCED_HARVESTING_ROUND_MULTIPLIER);
}

/**
 * Continuous draw per crop. The farm runs on `BlockSeedBed.getBaseEUt`, which
 * is `GTValues.VP[tier]` (= V[tier] * 30 / 32), doubled per overclock, spread
 * over every seed in the bed. The Crop Manager instead spends
 * `maxEUInput() / 8` once per crop harvested, so its cost belongs to the
 * harvest rather than to the tick; `cropsNhManagerEuPerHarvest` reports that.
 */
export function cropsNhEutPerCrop(setup: CropHarvesterSetup): number {
  if (setup.id !== CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
    return 0;
  }
  const practicalVoltage = Math.floor((gtVoltage(setup.tierIndex) * 30) / 32);
  return (practicalVoltage * 2 ** setup.overclocks) / cropsNhSquarePerTier(setup.tierIndex);
}

export function cropsNhManagerEuPerHarvest(setup: CropHarvesterSetup): number {
  return setup.id === CROP_HARVESTER_MANAGER_ID && setup.tierIndex >= 0
    ? gtVoltage(setup.tierIndex) / 8
    : 0;
}

export function cropsNhHarvesterTierName(tierIndex: number): string {
  return VOLTAGE_TIER_NAMES[tierIndex] ?? "MAX";
}

function gtVoltage(tierIndex: number): number {
  return 8 * 4 ** Math.max(0, tierIndex);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function toPositiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

const SQRT_2_PI = Math.sqrt(2 * Math.PI);
const ic2DropMultiplierCache = new Map<string, number>();
const ic2GrowthCycleCache = new Map<string, number>();

export function enrichPassiveProductionRecipe(recipe: Recipe): Recipe {
  if (isCropProductionRecipe(recipe)) {
    return enrichCropProductionRecipe(recipe);
  }

  if (isBeeProductionRecipe(recipe)) {
    return enrichBeeProductionRecipe(recipe);
  }

  return recipe;
}

export function isCropProductionRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  if (label === "tree growth simulator") {
    return false;
  }

  return (
    /\bic2 crops?\b/.test(label) ||
    /\bcrops?nh\b/.test(label) ||
    /\bcrop production\b/.test(label) ||
    /\bcrop farm\b/.test(label)
  );
}

export function isIc2LegacyCropRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  return /\bic2 crops?\b/.test(label) && !/\bcropnh\b/.test(label);
}

export function isCropNhRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  return /\bcrops?nh\b/.test(label) || /\bcrop farm\b/.test(label);
}

export const CROP_FARM_RECIPE_MAP = "Crop Farm";
export const CROP_FARM_PLACEHOLDER_RECIPE_ID = "factoryflow:crop-farm:empty";

/** Crop farm sources spawn from the board toolbar, not the recipe book. */
export function isCropFarmRecipe(recipe: PassiveProductionRecipeLabel) {
  return /\bcrop farm\b/.test(passiveProductionLabel(recipe));
}

/**
 * The empty crop source dropped in by the board button: it has no crop yet,
 * so it produces nothing until one is picked on the node.
 */
export function createCropFarmPlaceholderRecipe(): Recipe {
  return {
    id: CROP_FARM_PLACEHOLDER_RECIPE_ID,
    name: "Crop Farm",
    kind: "crop_produce",
    category: "cropsnh-crop",
    machineType: CROP_FARM_RECIPE_MAP,
    minimumTier: "NONE",
    durationTicks: 256,
    eut: 0,
    inputs: [],
    outputs: [],
    notes: "Pick a crop to start producing.",
    source: { recipeMap: CROP_FARM_RECIPE_MAP },
  };
}

export function isBeeProductionRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  return (
    /\bbee produce\b/.test(label) ||
    /\bbee production\b/.test(label) ||
    /\bbee products?\b/.test(label) ||
    /\bapiary\b/.test(label) ||
    /\balveary\b/.test(label)
  );
}

export function isCropProductionConfigControl(controlId: string) {
  return CROP_CONTROL_IDS.has(controlId);
}

export function isBeeProductionConfigControl(controlId: string) {
  return BEE_CONTROL_IDS.has(controlId) || isBeeFrameSlotControlId(controlId);
}

export function isBeeFrameSlotControlId(controlId: string) {
  return new RegExp(`^${BEE_FRAME_SLOT_CONTROL_PREFIX}\\d+$`).test(controlId);
}

export function getBeeFrameProductionModifier(key: string) {
  switch (key) {
    case "forestry:untreated":
    case "forestry:impregnated":
    case "forestry:proven":
      return 1;
    case "extrabees:cocoa":
      return 0.5;
    case "extrabees:cage":
    case "extrabees:clay":
    case "magicbees:necrotic":
      return -0.25;
    case "extrabees:soul":
      return -0.75;
    case "magicbees:magic":
    case "magicbees:resilient":
      return 2;
    case "magicbees:gentle":
      return 0.4;
    case "magicbees:metabolic":
      return 0.2;
    case "magicbees:oblivion":
      return -9001;
    default:
      return 0;
  }
}

export function getBeeBaseProductionTerm(machineType: string) {
  const label = normalizeLabel(machineType);
  if (label.includes("mega apiary")) {
    return BEE_MEGA_APIARY_BASE_PRODUCTION_TERM;
  }
  if (label.includes("industrial apiary")) {
    return BEE_INDUSTRIAL_APIARY_BASE_PRODUCTION_TERM;
  }
  if (label.includes("magic apiary")) {
    return BEE_MAGIC_APIARY_BASE_PRODUCTION_TERM;
  }
  if (label.includes("alveary")) {
    return BEE_ALVEARY_BASE_PRODUCTION_TERM;
  }
  return BEE_APIARY_BASE_PRODUCTION_TERM;
}

export function isIndustrialApiaryMachineType(machineType: string) {
  return normalizeLabel(machineType).includes("industrial apiary");
}

export function getBeeProductionTermModifier(controlId: string, key: string) {
  if (isBeeFrameSlotControlId(controlId)) {
    return getBeeFrameProductionModifier(key);
  }

  switch (controlId) {
    case BEE_MAGIC_AURA_CONTROL_ID:
      return key === "production-aura" ? 0.9 : 0;
    case BEE_ALVEARY_FRAME_HOUSING_CONTROL_ID:
      return getAlvearyFrameHousingProductionModifier(key);
    case BEE_ALVEARY_STIMULATOR_CONTROL_ID:
      return getAlvearyStimulatorProductionModifier(key);
    case BEE_INDUSTRIAL_SPEED_CONTROL_ID:
      return getIndustrialApiarySpeedProductionModifier(key);
    case BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID:
      return getIndustrialApiaryProductionUpgradeModifier(key);
    default:
      return 0;
  }
}

export function getCropStatsPreset(value: string | undefined): CropStatsPreset | undefined {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(value ?? "");
  if (!match) {
    return undefined;
  }

  return {
    growth: Number.parseInt(match[1] ?? "0", 10),
    gain: Number.parseInt(match[2] ?? "0", 10),
    resistance: Number.parseInt(match[3] ?? "0", 10),
  };
}

function enrichCropProductionRecipe(recipe: Recipe): Recipe {
  const analyticStats = getCropsNhStats(recipe);
  if (!analyticStats && isCropFarmRecipe(recipe)) {
    // The empty crop-farm placeholder: no crop picked yet, nothing to tune.
    return {
      ...recipe,
      minimumTier: "NONE",
      eut: 0,
      machineHandlers: [],
    };
  }
  const controls = analyticStats
    ? cropsNhAnalyticControls("world")
    : cropProductionControls(recipe);
  const machineConfigControls = mergeMachineConfigControls(recipe.machineConfigControls, controls);
  const baseMachine = "Crop Manager";

  return {
    ...recipe,
    inputs: sanitizeCropProductionInputs(recipe.inputs),
    machineType: isPassiveBaseMachine(recipe.machineType) ? baseMachine : recipe.machineType,
    minimumTier: "NONE",
    eut: 0,
    // Only the analytic CropsNH cards get harvesters: the legacy IC2 crop
    // approximation has no Crop Manager or Industrial Farm behind it.
    machineHandlers: analyticStats ? cropHarvesterHandlers() : [],
    machineConfigControls,
    notes: withPassiveProductionNote(
      recipe.notes,
      analyticStats
        ? "Rates use the exact CropsNH growth and gain formulas from the game (256-tick cycles, nutrient supply vs Tier x 10 demand, dropChance x 1.03^Gain drop rounds). Machine count = number of planted crops. Resistance does not affect steady-state rates."
        : recipe.runtimeCalculation?.status === "computed"
          ? "Crop production uses GTNH runtime baseline data when a matching oracle variant exists; unmatched controls fall back to passive averages."
          : "Crop production controls are best-effort passive averages. Seed count multiplies output without adding power draw.",
    ),
  };
}

/**
 * The crop's own knobs. `mode: "farm"` drops water, fertilizer and sky access,
 * which an Industrial Farm simulates at a fixed 200/200/true and a player
 * therefore cannot change.
 */
function cropsNhAnalyticControls(mode: "world" | "farm" = "world"): MachineConfigControl[] {
  const statTiers = (controlId: string, statLabel: string) =>
    Array.from({ length: 31 }, (_unused, index) => {
      const value = index + 1;
      return option(
        String(value),
        String(value),
        `${controlId}_${value}`,
        `${statLabel} ${value}`,
      );
    });

  const worldOnly = new Set([
    CROP_WATER_CONTROL_ID,
    CROP_FERTILIZER_CONTROL_ID,
    CROP_SKY_CONTROL_ID,
  ]);
  const controls: MachineConfigControl[] = [
    {
      id: CROP_GROWTH_STAT_CONTROL_ID,
      label: "Growth",
      minimumKey: "1",
      defaultKey: "31",
      tiers: statTiers(CROP_GROWTH_STAT_CONTROL_ID, "Growth"),
    },
    {
      id: CROP_GAIN_STAT_CONTROL_ID,
      label: "Gain",
      minimumKey: "1",
      defaultKey: "31",
      tiers: statTiers(CROP_GAIN_STAT_CONTROL_ID, "Gain"),
    },
    selectControl({
      id: CROP_WATER_CONTROL_ID,
      label: "Water",
      defaultKey: "100",
      tiers: [
        option("0", "Dry", "crop_water_0", "No Water (+0)"),
        option("50", "Partial", "crop_water_50", "Water 50 (+5)"),
        option("100", "Full", "crop_water_100", "Water 100 (+10)"),
      ],
    }),
    selectControl({
      id: CROP_FERTILIZER_CONTROL_ID,
      label: "Fertilizer",
      defaultKey: "100",
      tiers: [
        option("0", "None", "crop_fertilizer_0", "No Fertilizer (+0)"),
        option("50", "Partial", "crop_fertilizer_50", "Fertilizer 50 (+5)"),
        option("100", "Full", "crop_fertilizer_100", "Fertilizer 100 (+10)"),
      ],
    }),
    selectControl({
      id: CROP_SKY_CONTROL_ID,
      label: "Sky Access",
      defaultKey: "yes",
      tiers: [
        option("no", "Covered", "crop_sky_no", "No Sky Access (+0)"),
        option("yes", "Open Sky", "crop_sky_yes", "Sky Access (+2)"),
      ],
    }),
    selectControl({
      id: CROP_BIOME_CONTROL_ID,
      label: "Biome",
      defaultKey: "two-tags",
      tiers: [
        option("none", "No Bonus", "crop_biome_none", "No Biome Bonus (+0)"),
        option("humid", "Humid", "crop_biome_humid", "80%+ Humidity Biome (+14)"),
        option("one-tag", "1 Tag", "crop_biome_one_tag", "One Preferred Biome Tag (+14)"),
        option("two-tags", "2 Tags", "crop_biome_two_tags", "Both Preferred Biome Tags (+28)"),
      ],
    }),
  ];

  return mode === "farm" ? controls.filter((control) => !worldOnly.has(control.id)) : controls;
}

/** Voltage tier options for a machine that exists between two GT tiers. */
function voltageTierControl({
  id,
  label,
  minTierIndex,
  maxTierIndex,
  defaultKey,
  noneLabel,
}: {
  id: string;
  label: string;
  minTierIndex: number;
  maxTierIndex: number;
  defaultKey: string;
  /** When given, the tier list opens with a "no machine at all" option. */
  noneLabel?: string;
}): MachineConfigControl {
  const tiers = [
    ...(noneLabel
      ? [option(CROP_NO_MANAGER_KEY, noneLabel, "crop_voltage_none", `${label}: ${noneLabel}`)]
      : []),
    ...Array.from({ length: maxTierIndex - minTierIndex + 1 }, (_unused, offset) => {
      const tierIndex = minTierIndex + offset;
      const name = cropsNhHarvesterTierName(tierIndex);
      return option(
        String(tierIndex),
        name,
        `crop_voltage_${name.toLowerCase()}`,
        `${label}: ${name}`,
      );
    }),
  ];
  return { id, label, minimumKey: tiers[0]!.key, defaultKey, tiers };
}

/** A plain 0..max counter, keyed by the number so `ctx.value` reads it back. */
function countControl({
  id,
  label,
  max,
  resourceId,
  describe,
}: {
  id: string;
  label: string;
  max: number;
  resourceId: string;
  describe: (count: number) => string;
}): MachineConfigControl {
  return {
    id,
    label,
    minimumKey: "0",
    defaultKey: "0",
    tiers: Array.from({ length: max + 1 }, (_unused, count) =>
      option(String(count), String(count), `${resourceId}_${count}`, describe(count)),
    ),
  };
}

/**
 * The two places a CropsNH crop can live: on crop sticks in the world, or
 * inside an Industrial Farm. Picking by hand is not a third place, it is the
 * stick side with no manager on it, so it is the first Manager Tier option
 * rather than a tab of its own. Sticks come first, so a card with nothing
 * chosen behaves exactly as it did before harvesters existed.
 */
function cropHarvesterHandlers(): MachineHandler[] {
  return [
    {
      id: CROP_HARVESTER_MANAGER_ID,
      label: "Crop Manager",
      machineType: "Crop Manager",
      minimumTier: "NONE",
      eut: 0,
      kind: "single",
      machineConfigControls: [
        ...cropsNhAnalyticControls("world"),
        voltageTierControl({
          id: CROP_MANAGER_TIER_CONTROL_ID,
          label: "Manager",
          minTierIndex: CROP_MANAGER_MIN_TIER_INDEX,
          maxTierIndex: CROP_MANAGER_MAX_TIER_INDEX,
          defaultKey: CROP_NO_MANAGER_KEY,
          noneLabel: "By Hand",
        }),
      ],
    },
    {
      id: CROP_HARVESTER_INDUSTRIAL_FARM_ID,
      label: "Industrial Farm",
      machineType: "Industrial Farm",
      minimumTier: "MV",
      eut: 0,
      kind: "multiblock",
      machineConfigControls: [
        ...cropsNhAnalyticControls("farm"),
        voltageTierControl({
          id: CROP_SEED_BED_TIER_CONTROL_ID,
          label: "Seed Bed",
          minTierIndex: SEED_BED_MIN_TIER_INDEX,
          maxTierIndex: SEED_BED_MAX_TIER_INDEX,
          defaultKey: String(SEED_BED_MIN_TIER_INDEX),
        }),
        countControl({
          id: CROP_IF_GROWTH_UNIT_CONTROL_ID,
          label: "Growth Units",
          max: 1 + SEED_BED_MAX_TIER_INDEX - SEED_BED_MIN_TIER_INDEX,
          resourceId: "crop_if_growth_unit",
          describe: (count) =>
            count === 0
              ? "No Growth Acceleration Units"
              : `${count} Growth Acceleration Unit${count > 1 ? "s" : ""} (+${count * 100}% speed)`,
        }),
        countControl({
          id: CROP_IF_FERTILIZER_UNIT_CONTROL_ID,
          label: "Fertilizer Unit",
          max: MAX_FERTILIZER_UNITS,
          resourceId: "crop_if_fertilizer_unit",
          describe: (count) =>
            count === 0 ? "No Fertilizer Unit" : "Fertilizer Unit (x1.5 speed, +0.5 drop rounds)",
        }),
        countControl({
          id: CROP_IF_HARVEST_UNIT_CONTROL_ID,
          label: "Harvest Units",
          max: MAX_ADVANCED_HARVESTING_UNITS,
          resourceId: "crop_if_harvest_unit",
          describe: (count) =>
            count === 0
              ? "No Advanced Harvesting Units"
              : `${count} Advanced Harvesting Unit${count > 1 ? "s" : ""} (x${1 + count * 0.2} drop rounds)`,
        }),
        countControl({
          id: CROP_IF_ENVIRONMENT_UNIT_CONTROL_ID,
          label: "Biome Cards",
          max: MAX_ENVIRONMENTAL_UNITS,
          resourceId: "crop_if_environment_unit",
          describe: (count) =>
            count === 0
              ? "No Environmental Enhancement Units"
              : `${count} Environmental Enhancement Unit${count > 1 ? "s" : ""} (+${count * 14} biome)`,
        }),
        countControl({
          id: CROP_IF_OVERCLOCK_CONTROL_ID,
          label: "Overclocks",
          max: MAX_OVERCLOCKS,
          resourceId: "crop_if_overclock",
          describe: (count) =>
            count === 0
              ? "No Overclocked Growth Acceleration Unit"
              : `Overclocked Growth Acceleration Unit at ${count} overclock${count > 1 ? "s" : ""} (x${2 ** count} speed)`,
        }),
      ],
    },
  ];
}

function enrichBeeProductionRecipe(recipe: Recipe): Recipe {
  const controls = apiaryProductionControls();

  return {
    ...recipe,
    inputs: sanitizeBeeProductionInputs(recipe.inputs),
    machineType: isPassiveBaseMachine(recipe.machineType) ? "Apiary" : recipe.machineType,
    minimumTier: recipe.minimumTier === "UNKNOWN" ? "NONE" : recipe.minimumTier,
    eut: recipe.eut > 0 ? recipe.eut : 0,
    machineHandlers: mergeMachineHandlers(recipe.machineHandlers, beeMachineHandlers()),
    machineConfigControls: mergeMachineConfigControls(recipe.machineConfigControls, controls),
    notes: withPassiveProductionNote(
      recipe.notes,
      recipe.runtimeCalculation?.status === "computed"
        ? "Bee production uses GTNH runtime baseline data when a matching oracle variant exists; unmatched controls fall back to Forestry production modifiers."
        : "Bee production controls are best-effort averages based on Forestry production chance modifiers.",
    ),
  };
}

function cropProductionControls(recipe: PassiveProductionRecipeLabel) {
  return [
    cropStatsControl(recipe),
    selectControl({
      id: CROP_HYDRATION_CONTROL_ID,
      label: "Hydration",
      defaultKey: "normal",
      tiers: [
        option("dry", "Dry", "crop_hydration_dry", "Dry", { durationMultiplier: 1.25 }),
        option("normal", "Normal", "crop_hydration_normal", "Normal"),
        option("hydrated", "Hydrated", "crop_hydration_hydrated", "Hydrated", {
          durationMultiplier: 0.92,
        }),
        option("constant", "Constant Water", "crop_hydration_constant", "Constant Water", {
          durationMultiplier: 0.85,
        }),
      ],
    }),
    selectControl({
      id: CROP_NUTRIENTS_CONTROL_ID,
      label: "Nutrients",
      defaultKey: "none",
      tiers: [
        option("none", "None", "crop_nutrients_none", "No Fertilizer"),
        option("fertilized", "Fertilized", "crop_nutrients_fertilized", "Fertilized", {
          durationMultiplier: 0.9,
        }),
        option(
          "constant",
          "Constant Fertilizer",
          "crop_nutrients_constant",
          "Constant Fertilizer",
          {
            durationMultiplier: 0.82,
          },
        ),
      ],
    }),
    selectControl({
      id: CROP_SOIL_CONTROL_ID,
      label: "Soil",
      defaultKey: "farmland",
      tiers: [
        option("dirt", "Dirt", "minecraft:dirt", "Dirt", { durationMultiplier: 1.15 }),
        option("farmland", "Farmland", "minecraft:farmland", "Farmland"),
        option(
          "hydrated-farmland",
          "Hydrated Farmland",
          "minecraft:farmland@7",
          "Hydrated Farmland",
          {
            durationMultiplier: 0.95,
          },
        ),
      ],
    }),
    selectControl({
      id: CROP_SOIL_DEPTH_CONTROL_ID,
      label: "Soil Depth",
      defaultKey: "1",
      tiers: [
        option("0", "0", "crop_depth_0", "Depth 0", { durationMultiplier: 1.12 }),
        option("1", "1", "crop_depth_1", "Depth 1"),
        option("2", "2", "crop_depth_2", "Depth 2", { durationMultiplier: 0.96 }),
        option("3-plus", "3+", "crop_depth_3_plus", "Depth 3+", { durationMultiplier: 0.92 }),
      ],
    }),
    selectControl({
      id: CROP_AIR_QUALITY_CONTROL_ID,
      label: "Air Quality",
      defaultKey: "normal",
      tiers: [
        option("poor", "Poor", "crop_air_poor", "Poor Air", { durationMultiplier: 1.2 }),
        option("normal", "Normal", "crop_air_normal", "Normal Air"),
        option("good", "Good", "crop_air_good", "Good Air", { durationMultiplier: 0.96 }),
        option("optimal", "Optimal", "crop_air_optimal", "Optimal Air", {
          durationMultiplier: 0.9,
        }),
      ],
    }),
  ];
}

function cropStatsControl(recipe: PassiveProductionRecipeLabel): MachineConfigControl {
  const tiers = isCropNhRecipe(recipe)
    ? [
        cropStatsOption({ growth: 1, gain: 1, resistance: 1 }, CROPNH_GENERIC_PROFILE),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }, CROPNH_GENERIC_PROFILE),
        cropStatsOption({ growth: 31, gain: 31, resistance: 31 }, CROPNH_GENERIC_PROFILE),
      ]
    : [
        cropStatsOption({ growth: 1, gain: 1, resistance: 1 }, IC2_STICKREED_PROFILE),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }, IC2_STICKREED_PROFILE),
      ];

  return {
    id: CROP_STATS_CONTROL_ID,
    label: "Crop Stats",
    minimumKey: tiers[0]?.key ?? "1-1-1",
    defaultKey: isCropNhRecipe(recipe) ? "31-31-31" : "23-31-0",
    tiers,
  };
}

function apiaryProductionControls(): MachineConfigControl[] {
  return [
    beeFrameSlotControl(1),
    beeFrameSlotControl(2),
    beeFrameSlotControl(3),
    beeEnvironmentControl(),
  ];
}

function sanitizeCropProductionInputs(inputs: Recipe["inputs"]): Recipe["inputs"] {
  return inputs.map((input) => {
    if (!isIc2CropSeedInput(input)) {
      return input;
    }

    return withoutTooltipLines(input, (line) => /^IC2:itemCropSeed(?:@|$)/i.test(line.trim()));
  });
}

function sanitizeBeeProductionInputs(inputs: Recipe["inputs"]): Recipe["inputs"] {
  return inputs.map((input) => {
    if (!input.id.startsWith("factoryflow:bee_species:")) {
      return input;
    }

    return { ...input, tooltip: undefined };
  });
}

function isIc2CropSeedInput(input: ResourceAmount) {
  return (
    /^IC2:itemCropSeed(?:@|$)/i.test(input.id) || input.id.startsWith("factoryflow:ic2_crop_seed:")
  );
}

function withoutTooltipLines(
  input: Recipe["inputs"][number],
  shouldRemove: (line: string) => boolean,
): Recipe["inputs"][number] {
  const tooltip = input.tooltip?.filter((line) => !shouldRemove(line));
  if (!tooltip || tooltip.length === input.tooltip?.length) {
    return input;
  }

  return { ...input, tooltip: tooltip.length > 0 ? tooltip : undefined };
}

function magicApiaryProductionControls(): MachineConfigControl[] {
  return [
    beeFrameSlotControl(1),
    beeFrameSlotControl(2),
    beeFrameSlotControl(3),
    selectControl({
      id: BEE_MAGIC_AURA_CONTROL_ID,
      label: "Aura",
      defaultKey: "none",
      tiers: [
        option("none", "No Aura", "bee_magic_aura_none", "No Production Aura"),
        option(
          "production-aura",
          "Production Aura",
          "MagicBees:visAuraProvider",
          "Production Aura Provider",
        ),
      ],
    }),
    beeEnvironmentControl(),
  ];
}

function alvearyProductionControls(): MachineConfigControl[] {
  return [
    selectControl({
      id: BEE_ALVEARY_FRAME_HOUSING_CONTROL_ID,
      label: "Frame Housings",
      defaultKey: "none",
      tiers: [
        option("none", "None", "bee_alveary_frame_none", "No Frame Housing"),
        option("proven", "1x Proven Frame", "ExtraBees:alveary@1", "Alveary Frame Housing"),
        option("magic", "1x Magic Frame", "ExtraBees:alveary@1", "Alveary Frame Housing"),
        option("four-proven", "4x Proven Frames", "ExtraBees:alveary@1", "Alveary Frame Housings"),
      ],
    }),
    selectControl({
      id: BEE_ALVEARY_STIMULATOR_CONTROL_ID,
      label: "Stimulators",
      defaultKey: "none",
      tiers: [
        option("none", "None", "bee_alveary_stimulator_none", "No Stimulator"),
        option("low-voltage", "1x Low Voltage", "ExtraBees:alveary@4", "Alveary Stimulator"),
        option("high-voltage", "1x High Voltage", "ExtraBees:alveary@4", "Alveary Stimulator"),
        option(
          "four-high-voltage",
          "4x High Voltage",
          "ExtraBees:alveary@4",
          "Alveary Stimulators",
        ),
      ],
    }),
    selectControl({
      id: BEE_ALVEARY_SUPPORT_CONTROL_ID,
      label: "Utility Blocks",
      defaultKey: "plain",
      tiers: [
        option("plain", "Plain", "Forestry:alveary", "Plain Alveary"),
        option("climate", "Climate", "Forestry:alveary@5", "Hygroregulator"),
        option("lighting-rain", "Light/Rain", "ExtraBees:alveary@2", "Rain Shield / Lighting"),
        option("sieve", "Sieve", "Forestry:alveary@7", "Alveary Sieve"),
      ],
    }),
    beeEnvironmentControl(),
  ];
}

function industrialApiaryControls(): MachineConfigControl[] {
  return [
    selectControl({
      id: BEE_INDUSTRIAL_SPEED_CONTROL_ID,
      label: "Acceleration",
      defaultKey: "none",
      tiers: [
        option("none", "0", "bee_industrial_speed_none", "No Acceleration Upgrade"),
        ...Array.from({ length: 8 }, (_unused, index) => {
          const speed = index + 1;
          const multiplier = 2 ** speed;
          return option(
            `speed-${speed}`,
            `x${multiplier}`,
            `gregtech:gt.metaitem.03@${32199 + speed}`,
            `Acceleration Upgrade x${multiplier}`,
            {
              durationMultiplier: 1 / multiplier,
              eutMultiplier: industrialApiaryAccelerationEutMultiplier(speed),
            },
          );
        }),
        option(
          "speed-8-upgraded",
          "Upgraded x256",
          "gregtech:gt.metaitem.03@32208",
          "Upgraded Acceleration Upgrade x256",
          {
            durationMultiplier: 1 / 256,
            eutMultiplier: industrialApiaryAccelerationEutMultiplier(8),
          },
        ),
      ],
    }),
    selectControl({
      id: BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
      label: "Production",
      defaultKey: "0",
      tiers: Array.from({ length: 9 }, (_unused, count) =>
        option(
          String(count),
          String(count),
          count === 0 ? "bee_industrial_production_none" : "gregtech:gt.metaitem.03@32209",
          count === 0
            ? "No Production Upgrades"
            : `${count} Production Upgrade${count > 1 ? "s" : ""}`,
          count === 0
            ? {}
            : { eutMultiplier: INDUSTRIAL_APIARY_PRODUCTION_EUT_MULTIPLIER ** count },
        ),
      ),
    }),
    beeEnvironmentControl(),
  ];
}

function megaApiaryControls(): MachineConfigControl[] {
  return [
    selectControl({
      id: BEE_MEGA_ROYAL_JELLY_CONTROL_ID,
      label: "Royal Jelly",
      defaultKey: "none",
      tiers: [
        option("none", "None", "bee_mega_jelly_none", "No Royal Jelly"),
        option("partial", "Partial", "Forestry:royalJelly", "Royal Jelly", {
          outputMultiplier: 2,
        }),
        option("full", "Full", "Forestry:royalJelly", "Royal Jelly", {
          outputMultiplier: 3,
        }),
      ],
    }),
  ];
}

function beeEnvironmentControl(): MachineConfigControl {
  return selectControl({
    id: BEE_ENVIRONMENT_CONTROL_ID,
    label: "Climate",
    defaultKey: "preferred",
    tiers: [
      option("wrong", "Wrong", "bee_environment_wrong", "Wrong Climate"),
      option("tolerated", "Tolerated", "bee_environment_tolerated", "Tolerated Climate"),
      option("preferred", "Preferred", "bee_environment_preferred", "Preferred Climate"),
      option("controlled", "Controlled", "bee_environment_controlled", "Controlled Climate"),
    ],
  });
}

function beeFrameSlotControl(slotIndex: number): MachineConfigControl {
  return selectControl({
    id: `${BEE_FRAME_SLOT_CONTROL_PREFIX}${slotIndex}`,
    label: `Frame ${slotIndex}`,
    defaultKey: "none",
    tiers: [
      option("none", "Empty", "bee_frame_empty", "Empty Frame Slot"),
      option("forestry:untreated", "Untreated", "Forestry:frameUntreated", "Untreated Frame"),
      option(
        "forestry:impregnated",
        "Impregnated",
        "Forestry:frameImpregnated",
        "Impregnated Frame",
      ),
      option("forestry:proven", "Proven", "Forestry:frameProven", "Proven Frame"),
      option("extrabees:cocoa", "Chocolate", "ExtraBees:hiveFrame.cocoa", "Chocolate Frame"),
      option("extrabees:cage", "Restraint", "ExtraBees:hiveFrame.cage", "Restraint Frame"),
      option("extrabees:soul", "Soul", "ExtraBees:hiveFrame.soul", "Soul Frame"),
      option("extrabees:clay", "Healing", "ExtraBees:hiveFrame.clay", "Healing Frame"),
      option("magicbees:magic", "Magic", "MagicBees:frameMagic", "Magic Frame"),
      option("magicbees:resilient", "Resilient", "MagicBees:frameResilient", "Resilient Frame"),
      option("magicbees:gentle", "Gentle", "MagicBees:frameGentle", "Gentle Frame"),
      option("magicbees:metabolic", "Metabolic", "MagicBees:frameMetabolic", "Metabolic Frame"),
      option("magicbees:necrotic", "Necrotic", "MagicBees:frameNecrotic", "Necrotic Frame"),
      option("magicbees:temporal", "Temporal", "MagicBees:frameTemporal", "Temporal Frame"),
      option("magicbees:oblivion", "Oblivion", "MagicBees:frameOblivion", "Oblivion Frame"),
    ],
  });
}

function beeMachineHandlers(): MachineHandler[] {
  return [
    {
      id: "magic-apiary",
      label: "Magic Apiary",
      machineType: "Magic Apiary",
      minimumTier: "NONE",
      eut: 0,
      kind: "single",
      machineConfigControls: magicApiaryProductionControls(),
    },
    {
      id: "alveary",
      label: "Alveary",
      machineType: "Alveary",
      minimumTier: "NONE",
      eut: 0,
      kind: "multiblock",
      machineConfigControls: alvearyProductionControls(),
    },
    {
      id: "industrial-apiary",
      label: "Industrial Apiary",
      machineType: "Industrial Apiary",
      minimumTier: "MV",
      eut: INDUSTRIAL_APIARY_BASE_EUT,
      kind: "automation",
      machineConfigControls: industrialApiaryControls(),
    },
    {
      id: "mega-apiary",
      label: "Mega Apiary",
      machineType: "Mega Apiary",
      minimumTier: "LuV",
      durationTicks: 100,
      eut: 8110,
      kind: "multiblock",
      machineConfigControls: megaApiaryControls(),
    },
  ];
}

function industrialApiaryAccelerationEutMultiplier(speed: number) {
  const addedEut = INDUSTRIAL_APIARY_ACCELERATION_AMP_EUT[speed - 1] ?? 0;
  return (INDUSTRIAL_APIARY_BASE_EUT + addedEut) / INDUSTRIAL_APIARY_BASE_EUT;
}

function getAlvearyFrameHousingProductionModifier(key: string) {
  switch (key) {
    case "proven":
      return getBeeFrameProductionModifier("forestry:proven");
    case "magic":
      return getBeeFrameProductionModifier("magicbees:magic");
    case "four-proven":
      return 4 * getBeeFrameProductionModifier("forestry:proven");
    default:
      return 0;
  }
}

function getAlvearyStimulatorProductionModifier(key: string) {
  switch (key) {
    case "low-voltage":
      return 0.5;
    case "high-voltage":
      return 1.5;
    case "four-high-voltage":
      return 6;
    default:
      return 0;
  }
}

function getIndustrialApiarySpeedProductionModifier(key: string) {
  if (key !== "speed-8-upgraded") {
    return 0;
  }
  return 17.19926784 + 8 - BEE_INDUSTRIAL_APIARY_BASE_PRODUCTION_TERM;
}

function getIndustrialApiaryProductionUpgradeModifier(key: string) {
  const count = Number.parseInt(key, 10);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const clampedCount = Math.max(0, Math.min(8, count));
  return 4 * 1.2 ** clampedCount + 8 - BEE_INDUSTRIAL_APIARY_BASE_PRODUCTION_TERM;
}

function cropStatsOption(
  stats: CropStatsPreset,
  profile: Ic2CropSimulationProfile,
): MachineConfigTierOption {
  const label = `${stats.growth}/${stats.gain}/${stats.resistance}`;
  const effect = ic2CropStatsEffect(stats, profile);
  return {
    key: `${stats.growth}-${stats.gain}-${stats.resistance}`,
    label,
    ...effect,
    resource: configResource(
      `crop_stats_${stats.growth}_${stats.gain}_${stats.resistance}`,
      label,
      [
        "Crop stat preset",
        `Growth: ${stats.growth}`,
        `Gain: ${stats.gain}`,
        `Resistance: ${stats.resistance}`,
      ],
    ),
  };
}

function ic2CropStatsEffect(
  stats: CropStatsPreset,
  profile: Ic2CropSimulationProfile,
): Pick<MachineConfigTierOption, "durationMultiplier" | "outputMultiplier"> {
  // Mirrors GTNH EIG's IC2 crop approximation: gain changes drop rounds, growth changes tick cycles.
  const baselineCycles = ic2AverageGrowthCycles(profile.baselineStats, profile);
  const cycles = ic2AverageGrowthCycles(stats, profile);
  const durationMultiplier = cycles > 0 && baselineCycles > 0 ? cycles / baselineCycles : 1;

  return {
    durationMultiplier: roundMultiplier(durationMultiplier),
    outputMultiplier: roundMultiplier(ic2ExpectedHarvestOutput(stats.gain, profile.tier)),
  };
}

function ic2ExpectedHarvestOutput(gain: number, tier: number) {
  const cacheKey = `${tier}:${gain}`;
  const cached = ic2DropMultiplierCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const baseDropGainChance = 0.95 ** tier;
  const dropRounds = ic2AverageDropRounds(baseDropGainChance * 1.03 ** gain);
  const stackIncrease = (gain + 1) / 100;
  const multiplier = dropRounds * (1 + stackIncrease);
  ic2DropMultiplierCache.set(cacheKey, multiplier);
  return multiplier;
}

function ic2AverageDropRounds(chance: number) {
  const min = -10;
  const max = 10;
  const steps = 10_000;
  const stepSize = (max - min) / steps;
  let sum = 0;

  for (let step = 1; step <= steps - 1; step += 1) {
    sum += weightedDropChance(min + step * stepSize, chance);
  }

  return stepSize * ((weightedDropChance(min, chance) + weightedDropChance(max, chance)) / 2 + sum);
}

function weightedDropChance(x: number, chance: number) {
  return Math.max(0, Math.round(x * chance * 0.6827 + chance)) * standardNormalDistribution(x);
}

function standardNormalDistribution(x: number) {
  return Math.exp(-0.5 * x * x) / SQRT_2_PI;
}

function ic2AverageGrowthCycles(stats: CropStatsPreset, profile: Ic2CropSimulationProfile) {
  const cacheKey = `${profile.tier}:${profile.environmentScore}:${stats.growth}:${stats.gain}:${stats.resistance}`;
  const cached = ic2GrowthCycleCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const growthSpeeds = Array.from({ length: 7 }, (_unused, roll) =>
    ic2AverageGrowthRate(stats, profile, roll),
  );
  if (growthSpeeds.some((speed) => speed < 0)) {
    ic2GrowthCycleCache.set(cacheKey, -1);
    return -1;
  }

  const nonZeroSpeeds = growthSpeeds.filter((speed) => speed > 0);
  const zeroRolls = growthSpeeds.length - nonZeroSpeeds.length;
  if (zeroRolls >= growthSpeeds.length) {
    ic2GrowthCycleCache.set(cacheKey, -1);
    return -1;
  }

  const stageGoal = profile.tier * 200;
  const stageGoals = [0, stageGoal, stageGoal, stageGoal];
  const startStageFrequency = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  const frequencySum = [...startStageFrequency.values()].reduce((sum, value) => sum + value, 0);
  const averageCyclesByStage = stageGoals.map((goal) => averageCyclesToGoal(nonZeroSpeeds, goal));
  const normalizedStageFrequencies = stageGoals.map(
    (_goal, stage) => ((startStageFrequency.get(stage) ?? 0) * stageGoals.length) / frequencySum,
  );
  const frequencyMultipliers = new Array(averageCyclesByStage.length).fill(1);

  convolveSignalInPlace(
    frequencyMultipliers,
    normalizedStageFrequencies,
    new Array(averageCyclesByStage.length).fill(0),
    0,
    frequencyMultipliers.length,
    0,
  );

  const average =
    averageCyclesByStage.reduce(
      (sum, value, index) => sum + value * (frequencyMultipliers[index] ?? 1),
      0,
    ) / averageCyclesByStage.length;
  const zeroRollAdjustedAverage =
    zeroRolls > 0 ? (average / nonZeroSpeeds.length) * growthSpeeds.length : average;

  ic2GrowthCycleCache.set(cacheKey, zeroRollAdjustedAverage);
  return zeroRollAdjustedAverage;
}

function ic2AverageGrowthRate(
  stats: CropStatsPreset,
  profile: Ic2CropSimulationProfile,
  rngRoll: number,
) {
  const base = 3 + rngRoll + stats.growth;
  const need = Math.max(0, (profile.tier - 1) * 4 + stats.growth + stats.gain + stats.resistance);
  const have = profile.environmentScore;

  if (have >= need) {
    return Math.trunc((base * (100 + (have - need))) / 100);
  }

  const penalty = (need - have) * 4;
  if (penalty > 100) {
    return stats.resistance >= 31 ? 0 : -1;
  }
  return Math.max(0, Math.trunc((base * (100 - penalty)) / 100));
}

function averageCyclesToGoal(speeds: number[], goal: number) {
  if (goal <= 0) {
    return 1;
  }

  const maxSpeed = speeds[speeds.length - 1] ?? 1;
  const goalCap = maxSpeed * 1000;
  let cappedGoal = goal;
  let multiplier = 1;

  if (goal > goalCap) {
    multiplier = goal / goalCap;
    cappedGoal = goalCap;
  }

  const signal = new Array(cappedGoal).fill(0);
  signal[0] = 1;
  const kernel = tabulate(speeds, 1 / speeds.length);
  const target = new Array(signal.length).fill(0);
  const min = speeds[0] ?? 0;
  const max = maxSpeed;
  let averageRolls = 1;
  let iteration = 0;
  let probability: number;

  do {
    probability = convolveSignalInPlace(signal, kernel, target, min, max, iteration);
    averageRolls += probability;
    iteration += 1;
  } while (probability >= 0.1 / cappedGoal);

  return averageRolls * multiplier;
}

function tabulate(values: number[], multiplier: number) {
  const max = Math.max(...values);
  const tabulated = new Array(max + 1).fill(0);
  for (const value of values) {
    tabulated[value] += multiplier;
  }
  return tabulated;
}

function convolveSignalInPlace(
  signal: number[],
  kernel: number[],
  target: number[],
  minValue: number,
  maxValue: number,
  iteration: number,
) {
  let sum = 0;
  const maxK = Math.min(signal.length, (iteration + 1) * maxValue + 1);
  const startAt = Math.min(signal.length, minValue * (iteration + 1));
  let k = Math.max(0, startAt - kernel.length);

  for (; k < startAt; k += 1) {
    target[k] = 0;
  }

  for (; k < maxK; k += 1) {
    target[k] = 0;
    for (let i = Math.max(0, k - kernel.length + 1); i <= k; i += 1) {
      const value = (signal[i] ?? 0) * (kernel[k - i] ?? 0);
      sum += value;
      target[k] = (target[k] ?? 0) + value;
    }
  }

  for (let index = 0; index < signal.length; index += 1) {
    signal[index] = target[index] ?? 0;
  }

  return sum;
}

function roundMultiplier(value: number) {
  return Math.round(value * 1000) / 1000;
}

function selectControl({
  id,
  label,
  defaultKey,
  tiers,
}: {
  id: string;
  label: string;
  defaultKey: string;
  tiers: MachineConfigTierOption[];
}): MachineConfigControl {
  return {
    id,
    label,
    minimumKey: tiers[0]?.key ?? defaultKey,
    defaultKey,
    tiers,
  };
}

function option(
  key: string,
  label: string,
  resourceId: string,
  resourceLabel: string,
  effect: Pick<
    MachineConfigTierOption,
    "durationMultiplier" | "eutMultiplier" | "outputMultiplier" | "parallelMultiplier"
  > = {},
): MachineConfigTierOption {
  return {
    key,
    label,
    ...effect,
    resource: configResource(resourceId, resourceLabel, [label]),
  };
}

function configResource(id: string, displayName: string, tooltip: string[] = []): ResourceAmount {
  return {
    kind: "item",
    id: id.includes(":") ? id : `factoryflow:${id}`,
    amount: 1,
    displayName,
    tooltip,
  };
}

function mergeMachineHandlers(
  existing: Recipe["machineHandlers"],
  incoming: MachineHandler[],
): MachineHandler[] {
  const handlersById = new Map<string, MachineHandler>();
  for (const handler of [...(existing ?? []), ...incoming]) {
    if (isManualHandler(handler)) {
      continue;
    }
    handlersById.set(handler.id, handler);
  }
  return [...handlersById.values()];
}

function mergeMachineConfigControls(
  existing: Recipe["machineConfigControls"],
  incoming: MachineConfigControl[],
): MachineConfigControl[] {
  const controlsById = new Map<string, MachineConfigControl>();
  for (const control of [...incoming, ...(existing ?? [])]) {
    controlsById.set(control.id, control);
  }
  return [...controlsById.values()];
}

function isManualHandler(handler: Pick<MachineHandler, "id" | "label" | "machineType">) {
  const label = normalizeLabel(`${handler.id} ${handler.label} ${handler.machineType}`);
  return /\bmanual\b/.test(label);
}

function isPassiveBaseMachine(machineType: string) {
  const label = normalizeLabel(machineType);
  return (
    label === "ic2 crop" ||
    label === "ic2 crops" ||
    label === "cropnh" ||
    label === "cropsnh" ||
    label === "cropsnh crop" ||
    label === "crop production" ||
    label === "bee produce" ||
    label === "bee production" ||
    label === "bee products"
  );
}

function withPassiveProductionNote(notes: string | undefined, note: string) {
  if (!notes) {
    return note;
  }
  return notes.includes(note) ? notes : `${notes}\n${note}`;
}

function passiveProductionLabel(recipe: PassiveProductionRecipeLabel) {
  return normalizeLabel(
    `${recipe.source?.recipeMap ?? recipe.recipeMap ?? ""} ${recipe.machineType}`,
  );
}

function normalizeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(recipes?|recipe map|map)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
