/**
 * Curated machine behaviour: what each multiblock does to a recipe.
 *
 * A recipe export tells us the ingredients, the duration and the EU/t. It does
 * not tell us that titanium pipe casings give a chem plant six parallels, that
 * TPV coils run it at 200%, or that a large chemical reactor overclocks
 * perfectly. That behaviour lives in each multiblock's Java code, so it has to
 * be written down somewhere.
 *
 * We used to scrape it out of multiblock tooltips in the dataset pipeline.
 * Tooltips are prose, and the scraper produced values that were shaped right
 * and meant the wrong thing - most visibly a heat capacity stamped onto coils
 * for machines with no heat mechanic, which handed the chem plant, pyrolyse
 * oven, oil cracker and coke oven overclocks they never get in game.
 *
 * These numbers were first transcribed from ShadowTheAge's GTNH calculator
 * (https://github.com/ShadowTheAge/gtnh, MIT), then audited entry by entry
 * against the actual GT5-Unofficial source (cloned at
 * C:\Users\jack\gtnh-sources\GT5-Unofficial). Where the two disagree - GTNH
 * has rewritten several machines since the reference was written - the mod
 * source wins, the entry says so in a comment, and
 * `machine-table.test.ts` lists it under DIVERGES_FROM_REFERENCE. Two
 * indexing differences are worth knowing when comparing against the
 * reference:
 *
 *   - Their voltage tiers start at LV = 0; ours start at ULV = 0. Their
 *     `recipe.voltageTier + 1` is therefore our `ctx.voltageTier`.
 *   - Their `speed` is a throughput multiplier (2 = twice as fast). We divide
 *     duration by it, so a machine's duration multiplier is `1 / speed`.
 *
 * Machines absent from this table keep using the values the dataset carries,
 * so partial coverage is safe. Add entries as they are verified; do not guess.
 *
 * `machine-table.test.ts` checks every entry against
 * `__fixtures__/reference-coefficients.json`, which is the reference's own
 * definitions evaluated over a grid of tiers and choices. Regenerate it by
 * running the probe described in that test if the reference is ever updated.
 */
import type { MachineConfigControl } from "@/lib/model/types";

/**
 * How a machine spends each step of spare voltage, mirroring the reference's
 * `StandardOverclocker`.
 *
 * A step always costs the same voltage headroom. What differs is what it buys:
 *
 *   - A perfect step divides duration by `multiplier` and multiplies EU/t by
 *     the same, so total energy is unchanged. Usually 4.
 *   - A normal step halves duration and quadruples EU/t, so the recipe costs
 *     twice the energy. This is the GTNH default.
 *
 * Perfect steps are taken first, up to `maxPerfect`, then normal ones up to
 * `maxNormal`. `{ maxPerfect: 0, maxNormal: 0 }` is a machine that cannot
 * overclock at all.
 */
export interface OverclockRule {
  maxPerfect: number;
  maxNormal: number;
  /** Speed factor of a perfect step: what duration is divided by. */
  multiplier: number;
  /**
   * EU/t factor of a perfect step, when it differs from the speed factor. The
   * game's `OverclockCalculator` always charges `eutIncreasePerOC` (4 for
   * every non-fusion machine) regardless of what the step buys, so an arc
   * furnace electrode with a speed factor of 2 still pays 4x per step.
   * Defaults to `multiplier` for the classic perfect overclock.
   */
  euMultiplier?: number;
}

export const OVERCLOCK = {
  /** 2x speed for 4x EU/t on every step. */
  normal: (): OverclockRule => ({ maxPerfect: 0, maxNormal: Infinity, multiplier: 4 }),
  /** 4x speed for 4x EU/t, total energy unchanged. */
  perfect: (maxPerfect = Infinity, multiplier = 4): OverclockRule => ({
    maxPerfect,
    maxNormal: 0,
    multiplier,
  }),
  /** Perfect while they last, then normal. */
  perfectThenNormal: (maxPerfect = Infinity): OverclockRule => ({
    maxPerfect,
    maxNormal: Infinity,
    multiplier: 4,
  }),
  /** Duration divided by `speedFactor`, EU/t times 4, on every step. */
  custom: (speedFactor: number): OverclockRule => ({
    maxPerfect: Infinity,
    maxNormal: 0,
    multiplier: speedFactor,
    euMultiplier: 4,
  }),
  /** Extra voltage buys nothing. */
  none: (): OverclockRule => ({ maxPerfect: 0, maxNormal: 0, multiplier: 4 }),
} as const;

/**
 * Blast furnace family. Coil heat above the recipe's required heat buys perfect
 * overclocks, then normal ones. `overclock.ts` resolves this because only it
 * knows the recipe's heat requirement.
 */
export const HEAT_OVERCLOCK = "heat" as const;

export type OverclockSpec = OverclockRule | typeof HEAT_OVERCLOCK;

export interface MachineContext {
  /**
   * Zero-based index of the selected tier for one of our machine config
   * controls, e.g. `tier("heatingCoil")` is 0 for cupronickel and 3 for TPV.
   * Returns 0 when the recipe carries no such control.
   */
  tier: (controlId: string) => number;
  /**
   * The numeric value behind a count knob, e.g. `value("laserAmperage")` is
   * 256, not the position of 256 in the list. The reference states some
   * choices as raw counts with a minimum rather than as a tier ladder, and
   * their formulas read the count, so those must not use `tier`.
   */
  value: (controlId: string) => number;
  /**
   * Voltage tier ordinal of the tier the machine runs at, counting ULV as 0
   * and LV as 1. Equals the reference's `voltageTier + 1`.
   */
  voltageTier: number;
  /**
   * Voltage tier ordinal of the recipe's own EU/t draw, for the machines whose
   * discounts compare against the recipe rather than the hatch (the Mega Alloy
   * Blast Smelter). Optional because test harnesses predate it.
   */
  recipeVoltageTier?: number;
}

type Coefficient = number | ((ctx: MachineContext) => number);

export interface MachineBehaviour {
  /** Throughput multiplier: 2 means the recipe finishes in half the time. */
  speed?: Coefficient;
  /** EU/t multiplier applied before parallels. */
  power?: Coefficient;
  /** Parallels the structure offers, before the voltage has to pay for them. */
  parallels?: Coefficient;
  overclock: OverclockSpec | ((ctx: MachineContext) => OverclockSpec);
  /**
   * Marks a singleblock family. The table is otherwise multiblocks only, and
   * two things hang on the difference: a singleblock's overclocks are capped
   * by voltage tier as well as by power, and it cannot bank sub-tick speed as
   * parallels - it sits at the one-tick floor.
   */
  kind?: "single";
  /**
   * Amps the machine works with, giving it `tier voltage x amperage` EU/t to
   * count overclocks against. The arc furnaces are registered at 3A alongside
   * their 300% power usage, which is how a 90 EU/t draw still runs on an LV
   * machine.
   */
  amperage?: number;
  /**
   * How a HEAT_OVERCLOCK machine computes its machine heat, transcribed from
   * each machine's `setMachineHeat` call. See `heat.ts`.
   */
  heat?: {
    /** +100 K per voltage tier above MV (the blast furnaces and the Hearth). */
    voltageBonus?: boolean;
    /** Coil heat is counted this many times over (Zyngen: 2). */
    coilHeatMultiplier?: number;
    /** The 5% EU discount per 900 K of excess; default on, Zyngen opts out. */
    discount?: boolean;
  };
  /**
   * Knobs this machine offers that the dataset has no control for. Emitted in
   * the dataset's own control shape so the existing config UI renders them
   * with no changes, and merged over any control of the same id.
   */
  controls?: MachineConfigControl[];
  /**
   * Dataset control ids to drop for this machine, for knobs the scraper
   * invented that the machine does not have. The industrial mixing machine is
   * offered the fluid pipe casings (bronze to tungstensteel) when it actually
   * takes item pipe casings (tin to black plutonium), so showing both would be
   * worse than showing the wrong one.
   */
  hidesControls?: string[];
  /** Names this machine also goes by, including the reference's own name. */
  aliases?: string[];
  /** A known gap, carried over from the reference. */
  note?: string;
}

export function resolveCoefficient(
  coefficient: Coefficient | undefined,
  ctx: MachineContext,
  fallback: number,
): number {
  if (coefficient === undefined) {
    return fallback;
  }
  return typeof coefficient === "function" ? coefficient(ctx) : coefficient;
}

const COIL = "heatingCoil";
/**
 * The steam multiblocks' build tier control. Shared with power-report.ts,
 * which reads the selection to bill steam.
 */
export const STEAM_PRESSURE = "steamPressure";
const PIPE = "pipeCasing";
const SOLENOID = "solenoidCoil";
const ITEM_PIPE = "itemPipeCasing";
const ELECTRODE = "arcElectrode";
const SAWBLADE = "sawblade";
const UPGRADE_CHIP = "maceratorUpgrade";
const CONTAINMENT = "containmentBlockTier";
const ELECTROMAGNET = "electromagnet";

/**
 * Builds one of our machine config controls from a plain list of option
 * labels. The option's position IS the value the table's formulas read, so the
 * order here must match the reference's choice list exactly.
 *
 * Icons fall back to a generated id when there is no obvious block to show,
 * which the config UI renders as a labelled slot.
 */
function choiceControl(
  id: string,
  label: string,
  options: Array<string | { label: string; icon: string }>,
  defaultIndex = 0,
): MachineConfigControl {
  const tiers = options.map((option, index) => {
    const optionLabel = typeof option === "string" ? option : option.label;
    const icon =
      typeof option === "string" ? `factoryflow:machine_config/${slug(id)}_${index}` : option.icon;
    return {
      key: slug(optionLabel) || `option-${index}`,
      label: optionLabel,
      resource: {
        kind: "item" as const,
        id: icon,
        amount: 1,
        displayName: optionLabel,
        tooltip: [label],
        consumed: false,
      },
    };
  });

  return {
    id,
    label,
    minimumKey: tiers[0].key,
    defaultKey: tiers[defaultIndex]?.key ?? tiers[0].key,
    tiers,
  };
}

/**
 * A numeric knob the reference models as an unbounded count (slices, catalysts,
 * laser amperage). We offer a discrete ladder instead, because the config UI is
 * built from tier lists rather than free number entry.
 */
function countControl(
  id: string,
  label: string,
  values: number[],
  defaultIndex = 0,
): MachineConfigControl {
  return {
    id,
    label,
    minimumKey: String(values[0]),
    defaultKey: String(values[defaultIndex] ?? values[0]),
    tiers: values.map((value) => ({
      key: String(value),
      label: `${value}`,
      resource: {
        kind: "item" as const,
        id: `factoryflow:machine_config/${slug(id)}_${value}`,
        amount: 1,
        displayName: `${label}: ${value}`,
        tooltip: [label],
        consumed: false,
      },
    })),
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Item pipe casings, in the reference's order. */
const ITEM_PIPE_CONTROL = choiceControl(ITEM_PIPE, "Item Pipe Casing", [
  "Tin",
  "Brass",
  "Electrum",
  "Platinum",
  "Osmium",
  "Quantium",
  "Fluxed Electrum",
  "Black Plutonium",
]);

const CONTAINMENT_CONTROL = choiceControl(CONTAINMENT, "Containment Block", [
  "Neutronium",
  "Infinity",
  "Transcendent Metal",
  "SpaceTime",
  "Universum",
]);

const UPGRADE_CHIP_CONTROL = choiceControl(UPGRADE_CHIP, "Upgrade Chip", [
  "No Upgrade",
  "Maceration Upgrade Chip",
]);

/**
 * Industrial Arc Furnace electrodes, from kubatech's ArcFurnaceElectrode.java:
 * (speedModifier, parallelLimit, OCSpeedFactor, euModifier). Speed and the
 * overclock factor are SEPARATE there - every overclock step costs 4x EU/t but
 * divides duration by the electrode's own factor, so a Tungsten electrode's
 * overclocks buy no speed at all. Infinity's parallel limit is unlimited in
 * code (it doubles per completed run); the voltage cap is what really binds.
 */
const ELECTRODES = [
  { name: "Graphite", speed: 1, parallels: 4, oc: 2, power: 1 },
  { name: "Tantalum", speed: 1.2, parallels: 2, oc: 4, power: 1.2 },
  { name: "Molybdenum", speed: 0.9, parallels: 16, oc: 3, power: 0.8 },
  { name: "Tungsten", speed: 1, parallels: 128, oc: 1, power: 0.75 },
  { name: "Tungstensteel", speed: 0.8, parallels: 256, oc: 1, power: 0.5 },
  { name: "Graphene", speed: 2.5, parallels: 16, oc: 2, power: 1 },
  { name: "YBCO", speed: 1.2, parallels: 8, oc: 6, power: 1 },
  { name: "Netherite", speed: 2.2, parallels: 64, oc: 1.5, power: 1.25 },
  { name: "Tritanium", speed: 3, parallels: 48, oc: 2, power: 1.1 },
  { name: "Infinity", speed: 4.2, parallels: Number.POSITIVE_INFINITY, oc: 1, power: 1 },
  { name: "Hypogen", speed: 6.5, parallels: 256, oc: 1, power: 1.3 },
  { name: "Neutronium Nanite", speed: 5, parallels: 256, oc: 2, power: 2 },
  { name: "Transcendent Nanite", speed: 7.5, parallels: 512, oc: 4, power: 1.5 },
  { name: "Universium Nanite", speed: 10, parallels: 1024, oc: 8, power: 1 },
];

const SAWBLADES = [
  { name: "Tungsten Titanium Carbide", speed: 2.5, power: 0.9, parallels: 2 },
  { name: "Mysterious Crystal", speed: 3, power: 0.8, parallels: 3 },
  { name: "Neutronium", speed: 3.5, power: 0.7, parallels: 4 },
  { name: "Transcendent Metal", speed: 4.5, power: 0.6, parallels: 6 },
];

const ELECTROMAGNETS = [
  { name: "Iron Electromagnet", speed: 1.1, power: 0.8, parallels: 8 },
  { name: "Steel Electromagnet", speed: 1.25, power: 0.75, parallels: 24 },
  { name: "Neodymium Electromagnet", speed: 1.5, power: 0.7, parallels: 48 },
  { name: "Samarium Electromagnet", speed: 2, power: 0.6, parallels: 96 },
  { name: "Tengam Electromagnet", speed: 2.5, power: 0.5, parallels: 256 },
];

/** Reads a lookup row, clamped so an out-of-range selection cannot crash. */
function row<T>(table: T[], index: number): T {
  return table[Math.min(Math.max(0, index), table.length - 1)];
}

const ELECTRODE_CONTROL = choiceControl(
  ELECTRODE,
  "Electrode",
  ELECTRODES.map((entry) => entry.name),
);
const SAWBLADE_CONTROL = choiceControl(
  SAWBLADE,
  "Sawblade",
  SAWBLADES.map((entry) => entry.name),
);
const ELECTROMAGNET_CONTROL = choiceControl(
  ELECTROMAGNET,
  "Electromagnet",
  ELECTROMAGNETS.map((entry) => entry.name),
);
const COOLANT_CONTROL = choiceControl("fridgeCoolant", "Coolant", [
  "No Coolant",
  "Molten SpaceTime",
  "Spatially Enlarged Fluid",
  "Molten Eternity",
]);
/** Laser amperage is a raw count in the reference; parallels are its cube root. */
const LASER_AMPERAGE_CONTROL = countControl(
  "laserAmperage",
  "Laser Amperage",
  [1, 8, 27, 64, 125, 216, 512, 1000, 4096, 32768, 262144],
);
const PLASMA_MIXER_PARALLEL_CONTROL = countControl(
  "plasmaMixerParallels",
  "Parallels",
  [1, 2, 4, 8, 16, 32, 64, 128, 256],
);
/**
 * The fourteen heating coils and the heat each one gives the machine, for
 * machines whose coil the dataset does not offer as a knob. Keys match the
 * dataset's own coil control so a saved `coilTier` carries straight over.
 */
const HEATING_COIL_TIERS: Array<[key: string, label: string, heat: number, block: string]> = [
  ["cupronickel", "Cupronickel", 1801, "gregtech:gt.blockcasings5"],
  ["kanthal", "Kanthal", 2701, "gregtech:gt.blockcasings5@1"],
  ["nichrome", "Nichrome", 3601, "gregtech:gt.blockcasings5@2"],
  ["tpv", "TPV-Alloy", 4501, "gregtech:gt.blockcasings5@3"],
  ["hss_g", "HSS-G", 5401, "gregtech:gt.blockcasings5@4"],
  ["hss_s", "HSS-S", 6301, "gregtech:gt.blockcasings5@9"],
  ["naquadah", "Naquadah", 7201, "gregtech:gt.blockcasings5@5"],
  ["naquadah_alloy", "Naquadah Alloy", 8101, "gregtech:gt.blockcasings5@6"],
  ["trinium", "Trinium", 9001, "gregtech:gt.blockcasings5@10"],
  ["electrum_flux", "Electrum Flux", 9901, "gregtech:gt.blockcasings5@7"],
  ["awakened_draconium", "Awakened Draconium", 10801, "gregtech:gt.blockcasings5@8"],
  ["infinity", "Infinity", 11701, "gregtech:gt.blockcasings5@11"],
  ["hypogen", "Hypogen", 12601, "gregtech:gt.blockcasings5@12"],
  ["eternal", "Eternal", 13501, "gregtech:gt.blockcasings5@13"],
];

const HEATING_COIL_CONTROL: MachineConfigControl = {
  id: "heatingCoil",
  label: "Heating Coil",
  minimumKey: "cupronickel",
  defaultKey: "cupronickel",
  tiers: HEATING_COIL_TIERS.map(([key, label, heat, block]) => ({
    key,
    label,
    heat,
    resource: {
      kind: "item" as const,
      id: block,
      amount: 1,
      displayName: `${label} Coil Block`,
      tooltip: ["Heating coil tier", `Heat capacity: ${heat} K`],
      consumed: false,
    },
  })),
};

/**
 * The dataset's own coke oven knobs. Its slice options are keyed "slice-1"
 * upward rather than by number, so the count is the option's position plus one
 * and `value` would not read it.
 */
const COKE_CASING = "cokeOvenCasing";
const COKE_SLICES = "cokeOvenSlices";

const SPIN_MODE = "spinmatronMode";
const TURBINE_TIER = "sumTurbineTier";
const SPIN_FUEL = "spinmatronFuel";
const SPIN_MODE_CONTROL = choiceControl(SPIN_MODE, "Mode", ["Standard", "Light", "Heavy"]);
const SPIN_FUEL_CONTROL = choiceControl(SPIN_FUEL, "Fuel", [
  "Kerosene",
  "Biocatalysed Propulsion Fluid",
]);
const TURBINE_TIER_CONTROL = countControl(
  TURBINE_TIER,
  "Sum Turbine Tier",
  [1, 2, 3, 4, 6, 8, 12, 16, 24, 32],
);

/**
 * Bronze or steel build, for the steam multiblocks. The dataset scrapes a
 * control with this same id (and its own x0.5 duration effect) off the
 * "High-Pressure Doubles Speed and Steam Usage" tooltip line; declaring the
 * control here replaces that copy, so the scraped effect can never stack on
 * the table's coefficients. Keys and icon ids match the dataset's, so a saved
 * selection carries over unchanged.
 */
const STEAM_PRESSURE_CONTROL: MachineConfigControl = {
  id: STEAM_PRESSURE,
  label: "Pressure",
  minimumKey: "normal",
  defaultKey: "normal",
  tiers: [
    {
      key: "normal",
      label: "Normal Pressure",
      resource: {
        kind: "item",
        id: "factoryflow:machine_config/steam_pressure_normal",
        amount: 1,
        displayName: "Normal Pressure",
        tooltip: ["Bronze build", "Runs at 62.5% of the recipe's speed"],
      },
    },
    {
      key: "high",
      label: "High Pressure",
      resource: {
        kind: "item",
        id: "factoryflow:machine_config/steam_pressure_high",
        amount: 1,
        displayName: "High Pressure",
        tooltip: ["Steel build", "Twice the speed and twice the steam of bronze"],
      },
    },
  ],
};

/**
 * The eight bronze/steel steam multiblocks, transcribed from MTESteamMacerator
 * and its siblings in gregtech.common.tileentities.machines.multi.steam. One
 * ProcessingLogic serves all of them: no overclocking, 8 fixed parallels, and
 * `OverclockCalculator.ofNoOverclock(recipe).setEUtDiscount(1.25 * tierMachine)
 * .setDurationModifier(1.6 / tierMachine)` where tierMachine is 1 for a bronze
 * build and 2 for high pressure. As throughput that is 0.625x basic and 1.25x
 * high pressure. EU stays zeroed on these cards (they burn steam); the litres
 * are billed by getNodeSteamReport, not by a power coefficient here.
 */
const STEAM_MULTIBLOCK: MachineBehaviour = {
  overclock: OVERCLOCK.none(),
  parallels: 8,
  speed: (c) => 0.625 * (c.tier(STEAM_PRESSURE) + 1),
  controls: [STEAM_PRESSURE_CONTROL],
};

/** The reference's speeding pipe casing count starts at 4. */
const NEUTRON_PIPE_CONTROL = countControl(
  "speedingPipeCasing",
  "Speeding Pipe Casing",
  [4, 5, 6, 7, 8, 9, 10, 11, 12],
);

/**
 * Keyed by the machine name our dataset uses. `aliases` cover the reference's
 * name where it differs, plus any handler name the dataset also emits.
 */
const MACHINES: Record<string, MachineBehaviour> = {
  // -- Heat: the machines that overclock on coil heat -----------------------
  // Heat formulas below are transcribed from each machine's setMachineHeat
  // call in GT5-Unofficial, not from the reference, which models none of the
  // per-machine differences.
  "Blast Furnace": {
    overclock: HEAT_OVERCLOCK,
    heat: { voltageBonus: true },
    aliases: ["Electric Blast Furnace"],
  },
  "Mega Blast Furnace": {
    overclock: HEAT_OVERCLOCK,
    heat: { voltageBonus: true },
    parallels: 256,
  },
  Volcanus: {
    overclock: HEAT_OVERCLOCK,
    // MTEAdvEBF reads its coils raw: no voltage bonus.
    speed: 2.2,
    power: 0.9,
    parallels: 8,
    note: "Blazing pyrotheum is not counted.",
  },
  "Exothermic Hearth": {
    overclock: HEAT_OVERCLOCK,
    heat: { voltageBonus: true },
    // The parallel modifier ramps from 256 to 512 over continuous running
    // (faster with pyrotheum, but it gets there regardless), so steady state
    // is the doubled figure.
    parallels: 512,
    note: "Assumes fully ramped up; pyrotheum only speeds the ramp.",
  },

  // -- Perfect overclockers -------------------------------------------------
  "Large Chemical Reactor": { overclock: OVERCLOCK.perfect() },
  "Mega Chemical Reactor": { overclock: OVERCLOCK.perfect(), parallels: 256 },
  "Circuit Assembly Line": { overclock: OVERCLOCK.perfect() },
  Digester: { overclock: OVERCLOCK.perfect() },
  "Elemental Duplicator": {
    overclock: OVERCLOCK.perfect(),
    speed: 2,
    parallels: (c) => 8 * c.voltageTier,
  },
  "IsaMill Grinding Machine": { overclock: OVERCLOCK.perfect() },
  "Flotation Cell Regulator": { overclock: OVERCLOCK.perfect() },

  // -- Coil-driven, no heat mechanic ---------------------------------------
  "Chemical Plant": {
    overclock: OVERCLOCK.normal(),
    aliases: ["ExxonMobil Chemical Plant"],
    speed: (c) => c.tier(COIL) * 0.5 + 0.5,
    parallels: (c) => (c.tier(PIPE) + 1) * 2,
  },
  "Pyrolyse Oven": { overclock: OVERCLOCK.normal(), speed: (c) => (c.tier(COIL) + 1) * 0.5 },
  "Oil Cracker": {
    overclock: OVERCLOCK.normal(),
    aliases: ["Oil Cracking Unit"],
    power: (c) => 1 - Math.min(0.5, (c.tier(COIL) + 1) * 0.1),
  },
  "Mega Oil Cracker": {
    overclock: OVERCLOCK.normal(),
    parallels: 256,
    // Unlike the small cracker's additive, capped discount, the mega compounds
    // 10% per coil tier with no cap: MTEMegaOilCracker.getEuModifier.
    power: (c) => Math.pow(0.9, c.tier(COIL) + 1),
  },
  Zyngen: {
    // MTEIndustrialAlloySmelter: mLevel = coil tier + 1, so cupronickel is
    // level 1 - the reference (and our old transcription of it) was one coil
    // tier low on both formulas. Its coils also buy heat overclocks, one
    // perfect step per 900 K, with no EU discount; the reference misses this
    // entirely.
    overclock: HEAT_OVERCLOCK,
    heat: { coilHeatMultiplier: 2, discount: false },
    speed: (c) => 1 + (c.tier(COIL) + 1) * 0.05,
    parallels: (c) => c.voltageTier * (c.tier(COIL) + 1),
  },
  "Multi Smelter": {
    // MTEMultiFurnace: parallels double per coil tier from 8, and every
    // operation is a fixed 4 EU/t, 128 tick smelt.
    overclock: OVERCLOCK.normal(),
    parallels: (c) => 8 * Math.pow(2, c.tier(COIL)),
  },
  "Mega Alloy Blast Smelter": {
    overclock: OVERCLOCK.normal(),
    parallels: 256,
    // MTEMegaAlloyBlastSmelter: duration x (1 - 5% per coil tier above TPV),
    // stated here as throughput; and a compounding 5% EU discount per coil
    // tier above the RECIPE's own voltage tier, never a penalty.
    speed: (c) => 1 / (1 - 0.05 * Math.max(0, c.tier(COIL) - 3)),
    power: (c) =>
      Math.pow(0.95, Math.max(0, c.tier(COIL) + 1 - (c.recipeVoltageTier ?? c.voltageTier))),
    note: "Assumes a matching glass tier.",
  },
  "Large Fluid Extractor": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => 1.5 + c.tier(COIL) * 0.1,
    power: (c) => 0.8 * Math.pow(0.9, c.tier(COIL)),
    parallels: (c) => (c.tier(SOLENOID) + 2) * 8,
  },
  "Large Thermal Refinery": {
    overclock: OVERCLOCK.normal(),
    // MTEIndustrialThermalCentrifuge: 1/(2.5 + 0.05 x coil tier) duration,
    // 0.8 x 0.95^coilTier EU, 8 per voltage tier plus 2 per solenoid voltage
    // tier (MV solenoid = 2).
    speed: (c) => 2.5 + 0.05 * c.tier(COIL),
    power: (c) => 0.8 * Math.pow(0.95, c.tier(COIL)),
    parallels: (c) => c.voltageTier * 8 + (c.tier(SOLENOID) + 2) * 2,
  },

  // -- Flat multiblocks -----------------------------------------------------
  "Alloy Blast Smelter": { overclock: OVERCLOCK.normal() },
  "Big Barrel Brewery": {
    overclock: OVERCLOCK.normal(),
    speed: 1.5,
    parallels: (c) => c.voltageTier * 4,
  },
  Boldarnator: {
    overclock: OVERCLOCK.normal(),
    speed: 3,
    power: 0.75,
    parallels: (c) => c.voltageTier * 8,
  },
  "Bricked Blast Furnace": { overclock: OVERCLOCK.normal() },
  "COMET - Compact Cyclotron": { overclock: OVERCLOCK.normal() },
  "Cryogenic Freezer": {
    // The rewritten MTECryogenicFreezer: 3x speed, 16 flat parallels, and
    // 10 L/s of gelid cryotheum to keep it running (not counted).
    overclock: OVERCLOCK.normal(),
    speed: 3,
    power: 0.9,
    parallels: 16,
  },
  "Density^2": {
    overclock: OVERCLOCK.normal(),
    speed: 2,
    parallels: (c) => Math.floor(c.voltageTier / 2) + 1,
  },
  "Dissolution Tank": { overclock: OVERCLOCK.normal() },
  "Distillation Tower": { overclock: OVERCLOCK.normal() },
  // The reference's "Furnace" is the singleblock, and it carries no
  // coefficients worth having. Listing it here would only tell the sub-tick
  // check it is a multiblock, which it is not.
  "Implosion Compressor": { overclock: OVERCLOCK.normal() },
  "Industrial Centrifuge": {
    overclock: OVERCLOCK.normal(),
    speed: 3,
    power: 0.9,
    parallels: (c) => c.voltageTier * 8,
    note: "Assumes max speed.",
  },
  "Industrial Extrusion Machine": {
    overclock: OVERCLOCK.normal(),
    speed: 3.5,
    parallels: (c) => c.voltageTier * 6,
  },
  "Large Scale Auto-Assembler v1.01": {
    overclock: OVERCLOCK.normal(),
    speed: 3,
    parallels: (c) => c.voltageTier * 2,
  },
  "Mega Distillation Tower": {
    // Tower mode: 1.5x speed, 10% EU discount, 256 parallels. Distillery mode
    // (2x, half EU, up to 1024) is a different recipe map and not covered.
    overclock: OVERCLOCK.normal(),
    speed: 1.5,
    power: 0.9,
    parallels: 256,
  },
  "Molecular Transformer": { overclock: OVERCLOCK.normal() },
  "Nuclear Salt Processing Plant": {
    overclock: OVERCLOCK.normal(),
    speed: 2.5,
    parallels: (c) => c.voltageTier * 2,
  },
  "Ore Washing Plant": {
    overclock: OVERCLOCK.normal(),
    speed: 5,
    parallels: (c) => c.voltageTier * 4,
  },
  // The lanthanide beamline chambers bypass ProcessingLogic entirely: raw
  // recipe duration, EU pinned to the hatch tier, no overclocking.
  "Source Chamber": { overclock: OVERCLOCK.none(), note: "Beam energy is not modelled." },
  "Target Chamber": { overclock: OVERCLOCK.none(), note: "Beam energy is not modelled." },
  "Thermic Heating Device": {
    overclock: OVERCLOCK.normal(),
    speed: 2.2,
    power: 0.9,
    parallels: (c) => c.voltageTier * 8,
  },
  "TurboCan Pro": { overclock: OVERCLOCK.normal(), speed: 2, parallels: (c) => c.voltageTier * 8 },
  "Vacuum Freezer": { overclock: OVERCLOCK.normal() },
  "Zhuhai - Fishing Port": {
    overclock: OVERCLOCK.normal(),
    parallels: (c) => (c.voltageTier + 1) * 2,
  },

  // -- Machines whose knobs the dataset has no control for -----------------
  "Industrial Arc Furnace": {
    overclock: (c) => OVERCLOCK.custom(row(ELECTRODES, c.tier(ELECTRODE)).oc),
    speed: (c) => row(ELECTRODES, c.tier(ELECTRODE)).speed,
    power: (c) => row(ELECTRODES, c.tier(ELECTRODE)).power,
    parallels: (c) => row(ELECTRODES, c.tier(ELECTRODE)).parallels,
    controls: [ELECTRODE_CONTROL],
    note: "Electrode durability, startup and blast mode's 16x power are not counted.",
  },
  "Industrial Cutting Factory": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => row(SAWBLADES, c.tier(SAWBLADE)).speed,
    power: (c) => row(SAWBLADES, c.tier(SAWBLADE)).power,
    parallels: (c) => row(SAWBLADES, c.tier(SAWBLADE)).parallels * c.voltageTier,
    controls: [SAWBLADE_CONTROL],
  },
  "Magnetic Flux Exhibitor": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => row(ELECTROMAGNETS, c.tier(ELECTROMAGNET)).speed,
    power: (c) => row(ELECTROMAGNETS, c.tier(ELECTROMAGNET)).power,
    parallels: (c) => row(ELECTROMAGNETS, c.tier(ELECTROMAGNET)).parallels,
    controls: [ELECTROMAGNET_CONTROL],
  },
  "Industrial Autoclave": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => 1.25 + c.tier(COIL) * 0.25,
    power: (c) => (11 - c.tier(PIPE)) / 12,
    parallels: (c) => c.tier(ITEM_PIPE) * 12 + 12,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Electric Implosion Compressor": {
    overclock: OVERCLOCK.normal(),
    parallels: (c) => Math.pow(4, c.tier(CONTAINMENT)),
    controls: [CONTAINMENT_CONTROL],
  },
  "Dissection Apparatus": {
    overclock: OVERCLOCK.normal(),
    speed: 3,
    power: 0.85,
    parallels: (c) => (c.tier(ITEM_PIPE) + 1) * 8,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Industrial Sledgehammer": {
    // Rewritten as MTEIndustrialForgeHammer: the anvils are gone, parallels
    // are 6 x solenoid voltage tier x machine voltage tier (MV solenoid = 2).
    overclock: OVERCLOCK.normal(),
    speed: 2,
    parallels: (c) => c.voltageTier * (c.tier(SOLENOID) + 2) * 6,
  },
  "Industrial Precision Lathe": {
    // Rewritten as MTEMultiLathe: flat 4x speed and 0.8x EU, with 8 parallels
    // per pipe casing tier (bronze = 1).
    overclock: OVERCLOCK.normal(),
    speed: 4,
    power: 0.8,
    parallels: (c) => (c.tier(PIPE) + 1) * 8,
  },
  "Industrial Maceration Stack": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => (c.tier(UPGRADE_CHIP) === 1 ? 6.4 : 1.6),
    parallels: (c) => (c.tier(UPGRADE_CHIP) === 1 ? 8 : 2) * c.voltageTier,
    controls: [UPGRADE_CHIP_CONTROL],
  },
  "Industrial Mixing Machine": {
    overclock: OVERCLOCK.normal(),
    // MTEIndustrialMixer: 1 / (1 + itemPipeTier + 1) duration, tin pipe = 3x.
    speed: (c) => c.tier(ITEM_PIPE) + 3,
    parallels: (c) => c.voltageTier * 8,
    controls: [ITEM_PIPE_CONTROL],
    // The recipe map is what a node carries until a handler is chosen, and the
    // scraper gave it the fluid pipe casings. This machine takes item ones.
    aliases: ["Multiblock Mixer"],
    hidesControls: [PIPE],
  },
  /**
   * The Utupu-Tanuri, which our dataset lists under its recipe map.
   *
   * MTEIndustrialDehydrator: 220% speed, half the EU/t, a fixed four
   * parallels, plus the heat bonus off its coils - a 5% EU discount for every
   * 900 K over the recipe's requirement and a perfect overclock for every
   * 1800 K. Unlike the blast furnaces it reads its coils raw, with no 100 K
   * per voltage tier on top.
   *
   * The requirement is genuinely zero here. Dehydrator recipes are low
   * temperature and always start from 0 K, which is why all 88 of them report
   * a special value of 0 - that is the real number, not a gap in the export.
   * So the coil tier alone settles the bonus, and a coil picker answers it
   * exactly.
   *
   * This deliberately parts company with the reference, which cannot read the
   * requirement out of its own export and so asks the player for the finished
   * difference in 900 K steps, then spends it as a 5% SPEED bonus per step.
   * The mod source is explicit (setHeatOC + setHeatDiscount on raw coil
   * heat), so the coefficient check skips this machine.
   */
  "Multiblock Dehydrator": {
    aliases: ["Utupu-Tanuri"],
    overclock: HEAT_OVERCLOCK,
    speed: 2.2,
    power: 0.5,
    parallels: 4,
    controls: [HEATING_COIL_CONTROL],
  },
  "Industrial Wire Factory": {
    // MTEIndustrialWireMill: throughput is 0.5 x item pipe tier, so a tin
    // pipe actually runs at HALF speed and only electrum breaks even.
    overclock: OVERCLOCK.normal(),
    speed: (c) => 0.5 * (c.tier(ITEM_PIPE) + 1),
    power: 0.75,
    parallels: (c) => c.voltageTier * 4,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Amazon Warehousing Depot": {
    // MTEIndustrialPackager: throughput is item pipe tier + 1, tin included.
    overclock: OVERCLOCK.normal(),
    speed: (c) => c.tier(ITEM_PIPE) + 2,
    power: 0.75,
    parallels: (c) => c.voltageTier * 16,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Hyper-Intensity Laser Engraver": {
    overclock: OVERCLOCK.normal(),
    speed: 3.5,
    power: 0.8,
    parallels: (c) => Math.floor(Math.cbrt(c.value("laserAmperage"))),
    controls: [LASER_AMPERAGE_CONTROL],
  },
  "Transcendent Plasma Mixer": {
    overclock: OVERCLOCK.none(),
    power: 10,
    parallels: (c) => c.value("plasmaMixerParallels"),
    controls: [PLASMA_MIXER_PARALLEL_CONTROL],
  },
  "Neutron Activator": {
    overclock: OVERCLOCK.none(),
    speed: (c) => Math.pow(1 / 0.9, c.value("speedingPipeCasing") - 4),
    power: 0,
    controls: [NEUTRON_PIPE_CONTROL],
    note: "Power use is not counted.",
  },
  "Endothermic Fridge": {
    overclock: (c) => OVERCLOCK.perfectThenNormal(c.tier("fridgeCoolant")),
    // Its speed boost ramps from 1 to 1.5 while it runs (cryotheum only
    // speeds the ramp), so steady state is the full 1.5.
    speed: 1.5,
    parallels: 256,
    controls: [COOLANT_CONTROL],
    note: "Assumes fully ramped up. Coolant consumption is not counted.",
  },

  // -- Flat multiblocks, second batch --------------------------------------
  "Large Electric Compressor": {
    overclock: OVERCLOCK.normal(),
    speed: 2,
    power: 0.9,
    parallels: (c) => c.voltageTier * 2,
  },
  "Hot Isostatic Pressurization Unit": {
    overclock: OVERCLOCK.normal(),
    speed: 3.5,
    power: 0.75,
    parallels: (c) => c.voltageTier * 4,
    note: "Assumes it is not overheated.",
  },
  "Neutronium Compressor": { overclock: OVERCLOCK.normal(), parallels: 8 },
  "Bacterial Vat": {
    overclock: OVERCLOCK.normal(),
    note: "Assumes a perfect fill rate.",
  },
  "Research Station": { overclock: OVERCLOCK.normal(), aliases: ["Research station"] },

  // -- Machines our dataset names differently from the reference -----------
  "Multiblock Electrolyzer": {
    aliases: ["Industrial Electrolyzer"],
    overclock: OVERCLOCK.normal(),
    speed: 2.8,
    power: 0.9,
    parallels: (c) => c.voltageTier * 4,
  },
  "Large Sifter": {
    aliases: ["Large Sifter Control Block"],
    overclock: OVERCLOCK.normal(),
    speed: 5,
    power: 0.75,
    parallels: (c) => c.voltageTier * 4,
  },
  "Industrial Forming Press": {
    aliases: ["Industrial Material Press"],
    overclock: OVERCLOCK.normal(),
    speed: 6,
    parallels: (c) => c.voltageTier * 4,
  },
  "Coke Oven": {
    aliases: ["Industrial Coke Oven"],
    overclock: OVERCLOCK.normal(),
    // Coils are a 2% EU discount each, compounding, and nothing else:
    // MTEIndustrialCokeOven bills 0.98^(coil tier + 1), cupronickel included.
    power: (c) => 0.98 ** (c.tier(COIL) + 1),
    parallels: (c) => {
      const heatProof = c.tier(COKE_CASING) === 1;
      const base = heatProof ? 32 : 16;
      const perSlice = heatProof ? 16 : 8;
      return base + (c.value(COKE_SLICES) - 1) * perSlice;
    },
    note: "Eternal coils are needed for more than 15 slices.",
  },

  // -- Remaining machines whose formulas need no recipe metadata -----------
  "Pseudostable Black Hole Containment Field": {
    overclock: OVERCLOCK.normal(),
    speed: 5,
    power: 0.7,
    parallels: (c) => c.voltageTier * 8,
    note: "Parallels also depend on stability, which is not modelled.",
  },
  // -- Singleblocks the dataset's raw numbers get wrong ---------------------
  /**
   * The arc furnace family is the one basic-machine line registered with
   * `setMachineAmperage(3)` and `setMachineEUtMultiplier(3)`: it runs every
   * recipe at triple the written EU/t, working with 3 amps of its tier. The
   * exported recipes (and the oracle's runtime ladder, which used a plain
   * calculator) carry the raw numbers, so without this entry the planner
   * under-reports arc furnace power threefold. The Plasma Arc Furnace shares
   * the recipe map but is registered plain - it must NOT get this entry.
   */
  "Arc Furnace": {
    kind: "single",
    overclock: OVERCLOCK.normal(),
    power: 3,
    amperage: 3,
  },
  /** The UV+ tiers of the same family, renamed at registration. */
  "Short Circuit Heater": {
    kind: "single",
    overclock: OVERCLOCK.normal(),
    power: 3,
    amperage: 3,
  },

  // -- Steam multiblocks -----------------------------------------------------
  // All eight share STEAM_MULTIBLOCK's logic; see its comment. The dataset
  // bakes the tooltip's "125% Speed" into these handlers' durationTicks, which
  // is the HIGH PRESSURE build's throughput (the tooltip states it against the
  // 2x-slower bronze singleblock, 2 / 1.6 = 1.25), so every steam multiblock
  // showed twice its real speed. machineTableSeedsFromBase drops that bake and
  // these coefficients state the true physics against the recipe's own base.
  "Steam Grinder": STEAM_MULTIBLOCK,
  "Steam Squasher": STEAM_MULTIBLOCK,
  "Steam Separator": STEAM_MULTIBLOCK,
  "Steam Purifier": STEAM_MULTIBLOCK,
  "Steam Presser": STEAM_MULTIBLOCK,
  "Steam Blender": STEAM_MULTIBLOCK,
  "Steam Fuser": STEAM_MULTIBLOCK,
  "Steam Hearth": {
    // MTESteamFurnaceMulti, same logic as its seven siblings, but its map is
    // vanilla smelting: the dataset's base is the 200-tick vanilla smelt while
    // the machine runs GT's fixed 128t/4EU furnace recipe. 200 / (128 x 1.6)
    // = 0.9765625, so the shown duration lands on the game's own 204 ticks
    // basic and 102 high pressure.
    overclock: OVERCLOCK.none(),
    parallels: 8,
    speed: (c) => 0.9765625 * (c.tier(STEAM_PRESSURE) + 1),
    controls: [STEAM_PRESSURE_CONTROL],
  },

  "Spinmatron-2737": {
    overclock: OVERCLOCK.normal(),
    // MTESpinmatron: light mode runs at 4x (and demands hatches three tiers
    // over the recipe), standard and heavy at 3x; heavy pays 16x EU and
    // divides parallels by 32. Parallels floor at each step like the code.
    speed: (c) => (c.tier(SPIN_MODE) === 1 ? 4 : 3),
    power: (c) => 0.7 * (c.tier(SPIN_MODE) === 2 ? 16 : 1),
    parallels: (c) =>
      Math.max(
        1,
        Math.floor(
          Math.floor(c.value(TURBINE_TIER) * 4 * (c.tier(SPIN_FUEL) === 1 ? 1.25 : 1)) /
            (c.tier(SPIN_MODE) === 2 ? 32 : 1),
        ),
      ),
    controls: [SPIN_MODE_CONTROL, TURBINE_TIER_CONTROL, SPIN_FUEL_CONTROL],
  },
};

const BY_NAME = new Map<string, MachineBehaviour>();
for (const [name, behaviour] of Object.entries(MACHINES)) {
  BY_NAME.set(normalizeMachineName(name), behaviour);
  for (const alias of behaviour.aliases ?? []) {
    BY_NAME.set(normalizeMachineName(alias), behaviour);
  }
}

export function getMachineBehaviour(machineType: string | undefined): MachineBehaviour | undefined {
  return machineType ? BY_NAME.get(normalizeMachineName(machineType)) : undefined;
}

/**
 * True when the table states this machine's speed or power itself. The dataset
 * pipeline bakes its scraped multipliers into each handler's own
 * durationTicks/eut (a Volcanus handler carries the EBF recipe pre-multiplied
 * by x0.8 duration and x0.9 EU), so for machines the table covers those baked
 * stats must be ignored or the bonus applies twice: the table's coefficients
 * are stated against the recipe map's base numbers. Entries without speed or
 * power (the Multi Smelter, whose handler carries GT's ABSOLUTE 128t/4EU
 * furnace recipe) keep their handler stats.
 */
export function machineTableSeedsFromBase(machineType: string | undefined): boolean {
  const behaviour = getMachineBehaviour(machineType);
  return (
    behaviour !== undefined && (behaviour.speed !== undefined || behaviour.power !== undefined)
  );
}

/** Config knobs this machine contributes on top of whatever the dataset carries. */
export function getMachineTableControls(machineType: string | undefined): MachineConfigControl[] {
  return getMachineBehaviour(machineType)?.controls ?? [];
}

/** Dataset control ids this machine does not actually have. */
export function getMachineHiddenControlIds(machineType: string | undefined): string[] {
  return getMachineBehaviour(machineType)?.hidesControls ?? [];
}

/** Resolves the overclock rule, which for the heat machines depends on the recipe. */
export function resolveOverclockSpec(
  behaviour: MachineBehaviour | undefined,
  ctx: MachineContext,
): OverclockSpec | undefined {
  if (!behaviour) {
    return undefined;
  }
  return typeof behaviour.overclock === "function" ? behaviour.overclock(ctx) : behaviour.overclock;
}

/** Every machine name the table answers to, for coverage reporting in tests. */
export function machineTableNames(): string[] {
  return Object.keys(MACHINES);
}

export function normalizeMachineName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9^]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
