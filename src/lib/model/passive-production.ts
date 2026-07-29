import type {
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
  const controls = analyticStats
    ? cropsNhAnalyticControls()
    : cropProductionControls(recipe);
  const machineConfigControls = mergeMachineConfigControls(recipe.machineConfigControls, controls);
  const baseMachine = "Crop Manager";

  return {
    ...recipe,
    inputs: sanitizeCropProductionInputs(recipe.inputs),
    machineType: isPassiveBaseMachine(recipe.machineType) ? baseMachine : recipe.machineType,
    minimumTier: "NONE",
    eut: 0,
    machineHandlers: [],
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

function cropsNhAnalyticControls(): MachineConfigControl[] {
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

  return [
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
        option("0", "Dry", "crop_water_0", "No Water (+1)"),
        option("50", "Partial", "crop_water_50", "Water 50 (+5)"),
        option("100", "Full", "crop_water_100", "Water 100 (+10)"),
      ],
    }),
    selectControl({
      id: CROP_FERTILIZER_CONTROL_ID,
      label: "Fertilizer",
      defaultKey: "100",
      tiers: [
        option("0", "None", "crop_fertilizer_0", "No Fertilizer (+1)"),
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
