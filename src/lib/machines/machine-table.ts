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
 * These numbers are transcribed from ShadowTheAge's GTNH calculator
 * (https://github.com/ShadowTheAge/gtnh, MIT), whose `src/machines.ts` was
 * checked against the mod source machine by machine. Two indexing differences
 * are worth knowing when comparing the two files:
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
  /** Speed and EU/t factor of a perfect step. */
  multiplier: number;
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
const PIPE = "pipeCasing";
const SOLENOID = "solenoidCoil";
const ITEM_PIPE = "itemPipeCasing";
const ELECTRODE = "arcElectrode";
const SAWBLADE = "sawblade";
const ANVIL = "anvilTier";
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

const ANVIL_CONTROL = choiceControl(ANVIL, "Anvil", [
  "Vanilla",
  "Steel",
  "Dark Steel / Thaumium",
  "Void Metal",
]);

const UPGRADE_CHIP_CONTROL = choiceControl(UPGRADE_CHIP, "Upgrade Chip", [
  "No Upgrade",
  "Maceration Upgrade Chip",
]);

const ELASTIC_SINGULARITY_CONTROL = choiceControl(ELASTIC_SINGULARITY, "Elastic Singularity", [
  "No Singularity",
  "Elastic Singularity",
]);

/** Industrial Arc Furnace electrodes: speed, parallels, EU/t and overclock factor. */
const ELECTRODES = [
  { name: "Graphite", speed: 2, parallels: 4, oc: 2, power: 1 },
  { name: "Tantalum", speed: 4, parallels: 2, oc: 4, power: 1.2 },
  { name: "Molybdenum", speed: 3, parallels: 16, oc: 3, power: 0.8 },
  { name: "Tungsten", speed: 1, parallels: 128, oc: 1, power: 1.1 },
  { name: "Tungstensteel", speed: 1, parallels: 256, oc: 1, power: 1.2 },
  { name: "Graphene", speed: 2, parallels: 16, oc: 2, power: 1 },
  { name: "YBCO", speed: 6, parallels: 8, oc: 6, power: 0.8 },
  { name: "Netherite", speed: 1.5, parallels: 64, oc: 1.5, power: 1.3 },
  { name: "Tritanium", speed: 2, parallels: 48, oc: 2, power: 1.7 },
  { name: "Infinity", speed: 1, parallels: 1, oc: 1, power: 1 },
  { name: "Hypogen", speed: 1, parallels: 256, oc: 1, power: 1.5 },
  { name: "Neutronium Nanite", speed: 2, parallels: 64, oc: 2, power: 2 },
  { name: "Transcendent Nanite", speed: 4, parallels: 512, oc: 4, power: 2 },
  { name: "Universium Nanite", speed: 8, parallels: 1024, oc: 8, power: 2 },
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

const PRECISION_LATHE_PARALLELS = [1, 1, 2, 4, 8, 12, 16, 32];
const PRECISION_LATHE_SPEED = [0.75, 0.8, 0.9, 1, 1.5, 2, 3, 4];

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
  // -- Heat: the only three machines that overclock on coil heat ------------
  "Blast Furnace": { overclock: HEAT_OVERCLOCK, aliases: ["Electric Blast Furnace"] },
  Volcanus: {
    overclock: HEAT_OVERCLOCK,
    speed: 2.2,
    power: 0.9,
    parallels: 8,
    note: "Blazing pyrotheum is not counted.",
  },
  "Exothermic Hearth": { overclock: HEAT_OVERCLOCK, parallels: 256 },

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
    power: (c) => 1 - Math.min(0.5, (c.tier(COIL) + 1) * 0.1),
  },
  Zyngen: {
    overclock: OVERCLOCK.normal(),
    speed: (c) => 1 + c.tier(COIL) * 0.05,
    parallels: (c) => c.voltageTier * c.tier(COIL),
  },
  "Multi Smelter": {
    overclock: OVERCLOCK.normal(),
    parallels: (c) => 8 * Math.pow(2, c.tier(COIL)),
    note: "Parallel count needs testing.",
  },
  "Mega Alloy Blast Smelter": {
    overclock: OVERCLOCK.normal(),
    parallels: 256,
    speed: (c) => Math.max(1, 1 - 0.05 * (c.tier(COIL) - 3)),
    power: (c) => Math.pow(0.95, c.tier(COIL) - (c.voltageTier - 1)),
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
    speed: (c) => 2.5 * (1 + (c.tier(COIL) + 1) * 0.05),
    power: (c) => 0.8 * Math.pow(0.95, c.tier(COIL) + 1),
    parallels: (c) => c.voltageTier * 8 + (c.tier(SOLENOID) + 1) * 2,
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
  "Cryogenic Freezer": { overclock: OVERCLOCK.normal(), speed: 3, power: 0.9, parallels: 16 },
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
  "Mega Distillation Tower": { overclock: OVERCLOCK.normal(), parallels: 256 },
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
  "Source Chamber": { overclock: OVERCLOCK.normal() },
  "Target Chamber": { overclock: OVERCLOCK.normal() },
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
    overclock: (c) => OVERCLOCK.perfect(Infinity, row(ELECTRODES, c.tier(ELECTRODE)).oc),
    speed: (c) => row(ELECTRODES, c.tier(ELECTRODE)).speed,
    power: (c) => row(ELECTRODES, c.tier(ELECTRODE)).power,
    parallels: (c) => row(ELECTRODES, c.tier(ELECTRODE)).parallels,
    controls: [ELECTRODE_CONTROL],
    note: "Electrode special properties and startup are not counted.",
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
    overclock: OVERCLOCK.normal(),
    speed: 2,
    parallels: (c) => c.voltageTier * (c.tier(ANVIL) + 1) * 8,
    controls: [ANVIL_CONTROL],
  },
  "Industrial Precision Lathe": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => (row(PRECISION_LATHE_SPEED, c.tier(ITEM_PIPE)) + c.voltageTier) / 4,
    power: 0.8,
    parallels: (c) => row(PRECISION_LATHE_PARALLELS, c.tier(ITEM_PIPE)) + c.voltageTier * 2,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Industrial Maceration Stack": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => (c.tier(UPGRADE_CHIP) === 1 ? 6.4 : 1.6),
    parallels: (c) => (c.tier(UPGRADE_CHIP) === 1 ? 8 : 2) * c.voltageTier,
    controls: [UPGRADE_CHIP_CONTROL],
  },
  "Industrial Mixing Machine": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => 2 + c.tier(ITEM_PIPE),
    parallels: (c) => c.voltageTier * 8,
    controls: [ITEM_PIPE_CONTROL],
    // The recipe map is what a node carries until a handler is chosen, and the
    // scraper gave it the fluid pipe casings. This machine takes item ones.
    aliases: ["Multiblock Mixer"],
    hidesControls: [PIPE],
  },
    "L.A.T.E.X.": {
    overclock: OVERCLOCK.normal(),
    speed: 2,
    power: 0.85,
    parallels: (c) => (c.tier(ELASTIC_SINGULARITY) === 1 ? 16 : 8) * c.voltageTier,
    controls: [ELASTIC_SINGULARITY_CONTROL],
    aliases: ["Cable Coating"]
  },
  /**
   * The Utupu-Tanuri, which our dataset lists under its recipe map. Its coils
   * set the machine's heat, and every 900 K over what the recipe asks for is a
   * heat difference tier: two of them buy a perfect overclock, and each one is
   * worth 5% speed on top of the machine's base 220%.
   */
  /**
   * The Utupu-Tanuri, which our dataset lists under its recipe map.
   *
   * 220% speed, half the EU/t and a fixed four parallels, plus the ordinary
   * heat efficiency bonus off its coils: a 5% EU discount for every 900 K over
   * the recipe's requirement, and a perfect overclock for every 1800 K over.
   * That is the same mechanic the blast furnace runs on, so it uses the same
   * heat path rather than a bonus of its own.
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
   * The wiki is explicit that the bonus is an energy discount and perfect
   * overclocks, so the coefficient check skips this machine.
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
    overclock: OVERCLOCK.normal(),
    speed: (c) => 1 + 0.5 * (c.tier(ITEM_PIPE) + 1),
    power: 0.75,
    parallels: (c) => c.voltageTier * 4,
    controls: [ITEM_PIPE_CONTROL],
  },
  "Amazon Warehousing Depot": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => c.tier(ITEM_PIPE) + 1,
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
    parallels: 256,
    controls: [COOLANT_CONTROL],
    note: "Coolant consumption is not counted.",
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
    speed: 2.5,
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
    // Coils are a 2% EU discount each, compounding, and nothing else. The
    // dataset's own coil control is kept so the tier list and icons stay.
    power: (c) => 0.98 ** (c.tier(COIL) - 1),
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
  "Spinmatron-2737": {
    overclock: OVERCLOCK.normal(),
    speed: (c) => 3 * (c.tier(SPIN_MODE) === 1 ? 2 : 1),
    power: (c) => 0.7 * (c.tier(SPIN_MODE) === 2 ? 16 : 1),
    parallels: (c) =>
      Math.ceil(
        (c.value(TURBINE_TIER) * 4 * (c.tier(SPIN_FUEL) === 1 ? 1.25 : 1)) /
          (c.tier(SPIN_MODE) === 2 ? 32 : 1),
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
