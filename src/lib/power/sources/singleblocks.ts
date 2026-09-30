/**
 * Singleblock generators (MTEBasicGenerator and its subclasses): 1 amp of
 * their tier while running, with a per-family per-tier efficiency ladder.
 * Every 1 A packet drains V plus GT's output loss (BaseMetaTileEntity), so
 * the burn rate prices V + loss.
 *
 * MTEBasicGenerator.onPostTick burns every 10 ticks: fluid in whole liters
 * at floor(fuel value x efficiency% / 100) EU each, at most the tank's
 * capacity per burn; items one per burn at fuel value x 10 x efficiency% EU.
 * A fuel too thin for its tank, or an item too small for its tier, derates
 * the output instead of running at V.
 */
import {
  findFuel,
  fuelOptions,
  powerPlannerData,
  resolvePowerResource,
  type PowerFuelEntry,
} from "../planner-data";
import type { PowerFlowLine, PowerModel, PowerSourceDefinition, PowerStatLine } from "../types";
import {
  familyTierOptions,
  formatAmount,
  items,
  liters,
  percent,
  stat,
  tierPower,
} from "./helpers";

interface SingleblockSpec {
  id: string;
  name: string;
  family: string;
  unlock: string;
  blurb: string;
  fuels: PowerFuelEntry[] | "steam" | "naquadah";
  /** Solid fuels burn whole items; the sheet prices them per hour. */
  solid?: boolean;
  /** The fuel players actually run, so a fresh card starts sane. */
  defaultFuel?: string;
  /** Liters the machine's tank holds at a GT tier (the class's getCapacity()). */
  capacity?: (gtTier: number) => number;
  /** The table's EU per L over the machine's own fuel map value. */
  fuelValueDivisor?: number;
  /** Items getEmptyContainer hands back per item burned. */
  byproducts?: Record<string, { name: string; count: number }>;
  /**
   * MTEMagicalEnergyAbsorber overrides onPostTick without the base burn, so
   * none of the burn rules below describe it; the card keeps the sheet's model.
   */
  sheetModel?: boolean;
}

/** MTEBasicGenerator.getCapacity(). */
const BASE_TANK_LITERS = 16_000;
/** One burn every 10 ticks (MTEBasicGenerator.onPostTick). */
const BURNS_PER_SECOND = 2;

/**
 * The magic fuel map's recipe outputs, which the converter hands back per
 * item (FuelLoader's Blood Magic slates, FuelRecipes' enchanted golden
 * apple, GTItemIterator's liveroots).
 */
const MAGIC_BYPRODUCTS: Record<string, { name: string; count: number }> = {
  "Reinforced Slate": { name: "Blank Slate", count: 1 },
  "Imbued Slate": { name: "Reinforced Slate", count: 1 },
  "Demonic Slate": { name: "Imbued Slate", count: 1 },
  "Ethereal Slate": { name: "Demonic Slate", count: 1 },
  "Ench. Golden Apple": { name: "Apple", count: 1 },
  Liveroots: { name: "Stick", count: 4 },
};

const SPECS: SingleblockSpec[] = [
  {
    id: "steam-turbine",
    name: "Steam Turbine",
    family: "steamTurbine",
    unlock: "LV",
    blurb: "Turns 7, 8 or 9 L of steam into 3 EU (LV, MV, HV).",
    fuels: "steam",
    // MTESteamTurbine.getCapacity()
    capacity: (gtTier) => 24_000 * gtTier,
  },
  {
    id: "gas-turbine",
    name: "Gas Turbine",
    family: "gasTurbine",
    unlock: "LV",
    blurb: "Burns benzene and the other gas fuels.",
    fuels: powerPlannerData.gasFuels,
    defaultFuel: "Benzene",
  },
  {
    id: "combustion-generator",
    name: "Combustion Generator",
    family: "combustion",
    unlock: "LV",
    blurb: "Burns the diesel-line fuels.",
    fuels: powerPlannerData.combustionFuels,
    defaultFuel: "Diesel",
  },
  {
    id: "semifluid-generator",
    name: "Semifluid Generator",
    family: "semifluid",
    unlock: "LV",
    blurb: "Burns heavy oils and semifluids.",
    fuels: powerPlannerData.semifluidFuels,
    defaultFuel: "Creosote Oil",
  },
  {
    id: "acid-generator",
    name: "Acid Generator",
    family: "chem",
    unlock: "LV",
    blurb: "Burns the acid-line fluids.",
    fuels: powerPlannerData.chemFuels,
    defaultFuel: "Sulfuric Acid",
  },
  {
    id: "geothermal-engine",
    name: "Geothermal Engine",
    family: "frost",
    unlock: "EV",
    blurb: "Burns lava, cryotheum and pyrotheum.",
    fuels: powerPlannerData.frostFuels,
    defaultFuel: "Lava",
    // MTEGeothermalGenerator.getCapacity()
    capacity: (gtTier) => 5_000 * gtTier,
  },
  {
    id: "rocket-fuel-generator",
    name: "Rocket Fuel Generator",
    family: "rocket",
    unlock: "EV",
    blurb: "Burns mixed rocket fuels.",
    fuels: powerPlannerData.rocketFuels,
    // MTERocketFuelGeneratorBase.getCapacity()
    capacity: () => 32_000,
    // The table carries the Large Rocket Engine's figures, which triple the
    // fuel map value (MTELargeRocketEngine); MTERocketFuelGenerator burns
    // the map value itself (RecipeLoaderRocketFuels: 512 for RP-1).
    fuelValueDivisor: 3,
  },
  {
    id: "plasma-generator",
    name: "Plasma Generator",
    family: "plasma",
    // Mark I's crafting recipe takes a LuV hull (MTERecipeLoader).
    unlock: "LuV",
    blurb: "Burns plasma from fusion.",
    fuels: powerPlannerData.plasmas,
    defaultFuel: "Helium Plasma",
  },
  {
    id: "naquadah-reactor",
    name: "Naquadah Reactor",
    family: "naquadah",
    unlock: "EV",
    blurb: "Depletes naquadah and tiberium rods.",
    fuels: "naquadah",
    solid: true,
  },
  {
    id: "magic-energy-converter",
    name: "Magic Energy Converter",
    family: "magicConverter",
    unlock: "LV",
    blurb: "Consumes magical items for power.",
    fuels: powerPlannerData.magicSolids,
    solid: true,
    defaultFuel: "Quicksilver",
    byproducts: MAGIC_BYPRODUCTS,
  },
  {
    id: "magic-energy-absorber",
    name: "Magic Energy Absorber",
    family: "magicAbsorber",
    unlock: "LV",
    blurb: "Consumes magical items for power.",
    fuels: powerPlannerData.magicSolids,
    solid: true,
    sheetModel: true,
  },
];

/**
 * Each Naquadah Reactor mark reads its own fuel map
 * (MTENaquadahReactor.getRecipeMap): the mark's naquadah or naquadria part
 * (FuelLoader, which hands back the plain naquadah part) and one tiberium
 * form (bartworks AdditionalRecipes, nothing handed back).
 */
const NAQUADAH_MARKS: Record<string, { naquadah: string; spent: string; tiberium: string }> = {
  EV: {
    naquadah: "Enriched Naquadah Bolt (EV)",
    spent: "Naquadah Bolt",
    tiberium: "Tiberium Bolt (EV)",
  },
  IV: {
    naquadah: "Enriched Naquadah Rod (IV)",
    spent: "Naquadah Rod",
    tiberium: "Tiberium Rod (IV)",
  },
  LuV: {
    naquadah: "Long Enriched Naquadah Rod (LuV)",
    spent: "Long Naquadah Rod",
    tiberium: "Long Tiberium Rod (LuV)",
  },
  ZPM: { naquadah: "Naquadria Bolt (ZPM)", spent: "Naquadah Bolt", tiberium: "Tiberium Rod (ZPM)" },
  UV: { naquadah: "Naquadria Rod (UV)", spent: "Naquadah Rod", tiberium: "Long Tiberium Rod (UV)" },
};

const NAQUADAH_FUEL_OPTIONS = [
  { key: "naquadah", label: "Naquadah/Naquadria" },
  { key: "tiberium", label: "Tiberium" },
];

/** Stored plans name the rod itself; each rod reads as its form. */
const NAQUADAH_LEGACY_KEYS: Record<string, string> = Object.fromEntries(
  Object.values(NAQUADAH_MARKS).flatMap((mark) => [
    [mark.naquadah, "naquadah"],
    [mark.tiberium, "tiberium"],
  ]),
);

/** GT tier index (LV = 1) of a tier voltage. */
function gtTierOf(voltage: number): number {
  return Math.round(Math.log2(voltage / 8) / 2);
}

/** GTUtility.getTier then BaseMetaTileEntity's loss: 2^(tier - 1) EU per packet, at least 1. */
function packetLoss(voltage: number): number {
  const tier = voltage <= 8 ? 0 : Math.floor((Math.ceil(Math.log2(voltage)) - 2) / 2);
  return 2 ** Math.max(0, tier - 1);
}

function eu(value: number): string {
  return formatAmount(Math.round(value));
}

/**
 * A fluid burn: per 10-tick burn the machine needs 10 packets of EU, but
 * can only drain what its tank holds; past that it runs below V.
 */
function fluidModel(
  fuelName: string,
  voltage: number,
  ampLoss: number,
  euPerLiter: number,
  tankLiters: number,
  stats: PowerStatLine[],
): PowerModel {
  if (!(euPerLiter > 0)) {
    return {
      euPerTick: 0,
      inputs: [],
      outputs: [],
      stats,
      warnings: ["Makes 0 EU per L at this tier, so the generator will not burn it."],
    };
  }
  const packet = voltage + ampLoss;
  const litersPerBurn = (packet * 10) / euPerLiter;
  if (litersPerBurn <= tankLiters) {
    return {
      euPerTick: voltage,
      inputs: [liters(fuelName, litersPerBurn * BURNS_PER_SECOND)],
      outputs: [],
      stats,
    };
  }
  const euPerTick = ((tankLiters * euPerLiter) / 10) * (voltage / packet);
  return {
    euPerTick,
    inputs: [liters(fuelName, tankLiters * BURNS_PER_SECOND)],
    outputs: [],
    stats,
    warnings: [
      `Burns at most ${formatAmount(tankLiters)} L per 10 ticks (the tank), so it runs at ${eu(euPerTick)} EU/t, not ${eu(voltage)}.`,
    ],
  };
}

/** An item burn: one item per 10-tick burn, so thin items derate the output. */
function itemModel(
  fuelName: string,
  voltage: number,
  ampLoss: number,
  euPerItem: number,
  efficiencyStat: PowerStatLine,
  byproduct: { name: string; count: number } | undefined,
): PowerModel {
  const packet = voltage + ampLoss;
  const needed = euPerItem > 0 ? (packet * 20) / euPerItem : 0;
  const capped = needed > BURNS_PER_SECOND;
  const perSecond = capped ? BURNS_PER_SECOND : needed;
  const euPerTick = capped ? ((BURNS_PER_SECOND * euPerItem) / 20) * (voltage / packet) : voltage;
  const outputs: PowerFlowLine[] =
    byproduct && resolvePowerResource(byproduct.name) && perSecond > 0
      ? [items(byproduct.name, perSecond * byproduct.count)]
      : [];
  return {
    euPerTick,
    inputs: [items(fuelName, perSecond)],
    outputs,
    stats: [
      efficiencyStat,
      stat("Fuel per hour", formatAmount(perSecond * 3600)),
      stat("EU per item", formatAmount(euPerItem)),
    ],
    warnings: capped
      ? [
          `Burns at most 1 item per 10 ticks, so it runs at ${eu(euPerTick)} EU/t, not ${eu(voltage)}.`,
        ]
      : undefined,
  };
}

function buildSingleblock(spec: SingleblockSpec): PowerSourceDefinition {
  const tiers = familyTierOptions(spec.family);
  const settings: PowerSourceDefinition["settings"] = [
    {
      type: "select",
      id: "tier",
      label: "Tier",
      options: tiers.options,
      defaultKey: tiers.options[0]?.key ?? "LV",
    },
  ];
  if (spec.fuels === "naquadah") {
    // The mark (tier) picks the rod; this knob picks its naquadah or tiberium form.
    settings.push({
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: NAQUADAH_FUEL_OPTIONS,
      defaultKey: "naquadah",
      legacyKeys: NAQUADAH_LEGACY_KEYS,
    });
  } else if (spec.fuels !== "steam") {
    settings.push({
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(spec.fuels),
      defaultKey: spec.defaultFuel ?? spec.fuels[0]?.name ?? "",
    });
  }

  return {
    id: spec.id,
    name: spec.name,
    group: "burners",
    unlock: spec.unlock,
    blurb: spec.blurb,
    settings,
    compute(read): PowerModel {
      const tier = read.select("tier");
      const { voltage, ampLoss } = tierPower(tier);
      const gtTier = gtTierOf(voltage);
      const tankLiters = spec.capacity?.(gtTier) ?? BASE_TANK_LITERS;

      if (spec.fuels === "steam") {
        // MTESteamTurbine: 3 EU from every (6 + tier) L of steam.
        const litersPerOperation = 6 + gtTier;
        const euPerLiter = 3 / litersPerOperation;
        return fluidModel("Steam", voltage, ampLoss, euPerLiter, tankLiters, [
          stat("Efficiency", percent(6 / litersPerOperation)),
          stat("EU per L", formatAmount(euPerLiter)),
        ]);
      }

      // getEfficiency() is a whole percent.
      const efficiencyPercent = Math.round(tiers.efficiencyFor(tier) * 100);
      const efficiencyStat = stat("Efficiency", percent(efficiencyPercent / 100));

      if (spec.fuels === "naquadah") {
        const mark = NAQUADAH_MARKS[tier] ?? NAQUADAH_MARKS.EV;
        const tiberium = read.select("fuel") === "tiberium";
        const rod = findFuel(
          powerPlannerData.naquadahRods,
          tiberium ? mark.tiberium : mark.naquadah,
        );
        const euPerItem = ((rod.euPerItem ?? 0) * efficiencyPercent) / 100;
        return itemModel(
          rod.name,
          voltage,
          ampLoss,
          euPerItem,
          efficiencyStat,
          tiberium ? undefined : { name: mark.spent, count: 1 },
        );
      }

      const fuel = findFuel(spec.fuels, read.select("fuel"));
      // The geothermal engine mixes forms: the lavas are fluids, the theum
      // dusts items - decided per fuel, not per machine.
      const solidFuel =
        spec.solid || (fuel.euPerItem !== undefined && fuel.euPerLiter === undefined);

      if (spec.sheetModel) {
        const euPerItem = fuel.euPerItem ?? 0;
        const efficiency = tiers.efficiencyFor(tier);
        // The workbook prices solids per hour: (V+loss)/EU/eff x 20 x 3600.
        const perHour =
          euPerItem > 0 ? ((voltage + ampLoss) / (euPerItem * efficiency)) * 20 * 3600 : 0;
        return {
          euPerTick: voltage,
          inputs: [items(fuel.name, perHour / 3600)],
          outputs: [],
          stats: [
            stat("Efficiency", percent(efficiency)),
            stat("Fuel per hour", formatAmount(perHour)),
            stat("EU per item", formatAmount(euPerItem * efficiency)),
          ],
        };
      }

      if (solidFuel) {
        // Item tables carry fuel value x 1000; the burn is fuel value x 10 x efficiency%.
        const euPerItem = ((fuel.euPerItem ?? 0) * efficiencyPercent) / 100;
        return itemModel(
          fuel.name,
          voltage,
          ampLoss,
          euPerItem,
          efficiencyStat,
          spec.byproducts?.[fuel.name],
        );
      }

      const fuelValue = (fuel.euPerLiter ?? 0) / (spec.fuelValueDivisor ?? 1);
      const euPerLiter = Math.floor((fuelValue * efficiencyPercent) / 100);
      return fluidModel(fuel.name, voltage, ampLoss, euPerLiter, tankLiters, [
        efficiencyStat,
        stat("EU per L", formatAmount(euPerLiter)),
      ]);
    },
  };
}

/**
 * GT++ RTG (MTERTGenerator): a pellet holds its recipe's days of EU at the
 * recipe voltage (20 x 86400 x days ticks), capped at Integer.MAX_VALUE EU,
 * and each tick's 1 A packet also pays GT's output loss. Voltages are
 * TierEU.RECIPE values; days are MathUtils.roundToClosestInt of the recipe's
 * figure (87.7 gives 87, 2.6 gives 2).
 */
const RTG_PELLETS = [
  { key: "am241", name: "Am Pellet", isotope: "Am-241", euPerTick: 15, days: 216 },
  { key: "sr90", name: "Sr Pellet", isotope: "Sr-90", euPerTick: 30, days: 29 },
  { key: "pu238", name: "Pu Pellet", isotope: "Pu-238", euPerTick: 60, days: 87 },
  { key: "po210", name: "Po Pellet", isotope: "Po-210", euPerTick: 480, days: 1 },
  {
    key: "ic2",
    name: "Pellets of RTG Fuel",
    isotope: "Pellets of RTG Fuel",
    euPerTick: 7,
    days: 2,
  },
].map((pellet) => {
  const euPerPellet = Math.min(20 * 86_400 * pellet.days * pellet.euPerTick, 2 ** 31 - 1);
  const seconds = euPerPellet / (pellet.euPerTick + packetLoss(pellet.euPerTick)) / 20;
  const realDays = seconds / 86_400;
  return {
    ...pellet,
    euPerPellet,
    seconds,
    label: `${pellet.isotope} (${pellet.euPerTick} EU/t, ${formatAmount(realDays)} days)`,
    runs: `${formatAmount(realDays)} real ${realDays === 1 ? "day" : "days"}`,
  };
});

const rtg: PowerSourceDefinition = {
  id: "rtg",
  name: "Radioisotope Thermoelectric Generator",
  group: "burners",
  // Its assembler recipe runs at IV (GT++ RecipesMachines).
  unlock: "IV",
  blurb: "Pellets decay into steady EU for real days.",
  settings: [
    {
      type: "select",
      id: "pellet",
      label: "Pellet",
      options: RTG_PELLETS.map(({ key, label }) => ({ key, label })),
      defaultKey: "pu238",
    },
  ],
  compute(read): PowerModel {
    const pellet = RTG_PELLETS.find((row) => row.key === read.select("pellet")) ?? RTG_PELLETS[2];
    return {
      euPerTick: pellet.euPerTick,
      inputs: [items(pellet.name, 1 / pellet.seconds)],
      outputs: [],
      stats: [
        stat("One pellet runs", pellet.runs),
        stat("EU per pellet", formatAmount(pellet.euPerPellet)),
        stat("Pollution", "None"),
      ],
    };
  },
};

export const singleblockSources: PowerSourceDefinition[] = [...SPECS.map(buildSingleblock), rtg];
