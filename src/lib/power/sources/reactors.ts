/**
 * Reactors and free-energy machines: THTR, HTGR, LFTR, the IC2 fluid
 * reactor presets, DEHP and the Solar Tower. Formulas from
 * docs/power-planner-math.md; where the workbook leaves a cost out (IC2
 * rods), the card says so instead of pretending.
 */
import { powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, items, lifespanHours, liters, percent, stat } from "./helpers";

const thtr: PowerSourceDefinition = {
  id: "thtr",
  name: "Thorium High Temperature Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Thorium pebbles to hot coolant.",
  settings: [
    {
      type: "number",
      id: "fill",
      label: "Pebble fill",
      min: 100_000,
      max: 675_000,
      step: 1000,
      defaultValue: 675_000,
    },
  ],
  compute(read): PowerModel {
    const fill = read.number("fill");
    const efficiency = Math.min(1, 0.01 + Math.pow((fill - 100_000) / 57_500, 2) / 100);
    // MTEThoriumHighTempReactor.checkProcessing: one 648,000-tick (9 hour)
    // operation burns floor(fill x 0.5% x eff) TRISO pebbles and hands them
    // back burned, a pebble ball per 64 and the rest loose. Coolant is drawn
    // every tick at (int)(4800 x eff) L.
    const pebbleCost = Math.floor(fill * 0.005 * efficiency);
    const operationSeconds = 648_000 / 20;
    const hotCoolantPerSecond = Math.floor(4800 * efficiency) * 20;
    return {
      // MTEThoriumHighTempReactor draws a flat RECIPE_IV/2 regardless of
      // fill; only the coolant line scales with efficiency.
      euPerTick: -3840,
      inputs: [
        liters("Coolant", hotCoolantPerSecond),
        items("TRISO pebble", pebbleCost / operationSeconds),
      ],
      outputs: [
        liters("Hot Coolant", hotCoolantPerSecond),
        items("Burned Out TRISO pebble ball", Math.floor(pebbleCost / 64) / operationSeconds),
        items("Burned Out TRISO pebble", (pebbleCost % 64) / operationSeconds),
      ],
      stats: [
        stat("Efficiency", percent(efficiency)),
        stat("Pebbles per cycle", formatAmount(pebbleCost)),
        stat("Cycle", "9h"),
        stat("Hot coolant", `${formatAmount(hotCoolantPerSecond / 20)} L/t`),
        // Primed once, never burned: emptying mode hands it all back.
        stat("Helium charge", "730,000 L, kept"),
      ],
    };
  },
};

/** kubatech's HTGR constants (MTEHighTempGasCooledReactor). */
const HTGR_MAX_BALLS = 10_000;
const HTGR_HELIUM = 512_000;
/** Pebbles burned per operation per ball: (pi - 3) / 100, the source's own digits. */
const HTGR_BURN_PER_BALL = 0.00141592653589793;
const HTGR_COOLANT_SPEEDUP = 0.07 / 20;
const HTGR_WATER_SPEEDUP = 0.03 / 20;

/**
 * One HTGR operation at a steady full helium charge and a fill topped up
 * every tick, as MTEHighTempGasCooledReactor runs it with its hatches kept
 * supplied.
 */
export function htgrOperation(pebble: { base: number; mult: number; exp: number }, fill: number) {
  const x = fill / HTGR_MAX_BALLS;
  const efficiency = 0.1 + (1 - Math.pow(1 - x, 3)) * 0.9;
  const burned = fill * HTGR_BURN_PER_BALL * efficiency;
  // Per-ball contributions are defined at a full reactor, so a partial fill
  // weakens the multiplier and exponent - but the fuel base is an average,
  // and the ball count itself multiplies the coolant line below.
  const fuelMultiplier = 1 + (pebble.mult - 1) * x;
  const fuelExponent = 1 + (pebble.exp - 1) * x;
  const energyMultiplier = pebble.base * Math.pow(fuelMultiplier, fuelExponent);
  // checkProcessing burns the pebbles before it sizes the draw.
  const remaining = Math.max(0, fill - burned);
  const coolantPerTick = Math.floor(energyMultiplier * 0.5 * remaining);
  const waterPerTick = Math.floor(energyMultiplier * 0.1 * remaining);
  // Every supplied tick adds whole ticks of progress on top of the one the
  // base machine adds: 7% of the operation per second for full coolant and
  // 3% for full water.
  const maxProgress = Math.floor((1 / (fuelExponent * fuelExponent)) * (2000 + 18_000 * efficiency));
  // onRunningTick's own expression order (drained share 1, full charge).
  const speedup = (rate: number) => Math.trunc((maxProgress * rate * 1 * HTGR_HELIUM) / HTGR_HELIUM);
  const perTick = 1 + speedup(HTGR_COOLANT_SPEEDUP) + speedup(HTGR_WATER_SPEEDUP);
  const cycleTicks = Math.max(1, Math.ceil(maxProgress / perTick));
  // Each operation loses 0.05% of the charge, (int) truncated; the hatch
  // tops it back up before the next one.
  const heliumLost = HTGR_HELIUM - Math.trunc(HTGR_HELIUM * (1 - 0.0005));
  return { efficiency, burned, energyMultiplier, coolantPerTick, waterPerTick, cycleTicks, heliumLost };
}

/** The dataset's names for one HTGR fuel: "Uranium-235" is "(Uranium 235)". */
function htgrFuelName(pebble: string, burned: boolean): string {
  return `${burned ? "Burned Out TRISO Fuel" : "TRISO Fuel"} (${pebble.replace("-", " ")})`;
}

const htgr: PowerSourceDefinition = {
  id: "htgr",
  name: "High Temperature Gas-cooled Reactor",
  group: "reactors",
  unlock: "IV",
  blurb: "TRISO pebbles to coolant and steam.",
  settings: [
    {
      type: "select",
      id: "pebble",
      label: "TRISO pebble",
      options: powerPlannerData.htgrPebbles.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.htgrPebbles[0]?.name ?? "",
    },
    { type: "number", id: "fill", label: "Pebble fill", min: 1, max: 10_000, step: 100, defaultValue: 10_000 },
  ],
  compute(read): PowerModel {
    const pebble =
      powerPlannerData.htgrPebbles.find((entry) => entry.name === read.select("pebble")) ??
      powerPlannerData.htgrPebbles[0];
    const fill = read.number("fill");
    const run = htgrOperation(pebble, fill);
    const cycleSeconds = run.cycleTicks / 20;
    // COOLANT_PER_BALL 0.5 and WATER_PER_BALL 0.1 are per-TICK litres at
    // full helium; steam is water x160.
    return {
      // RECIPE_IV x 0.2 with a full helium charge (the pump penalty is 0).
      euPerTick: -1536,
      inputs: [
        liters("Coolant", run.coolantPerTick * 20),
        liters("Distilled Water", run.waterPerTick * 20),
        items(htgrFuelName(pebble.name, false), run.burned / cycleSeconds),
        liters("Helium", run.heliumLost / cycleSeconds),
      ],
      outputs: [
        liters("Hot Coolant", run.coolantPerTick * 20),
        liters("Steam", run.waterPerTick * 160 * 20),
        items(htgrFuelName(pebble.name, true), run.burned / cycleSeconds),
      ],
      stats: [
        stat("Efficiency", percent(run.efficiency)),
        stat("Output multiplier", formatAmount(run.energyMultiplier)),
        stat("Pebbles per cycle", formatAmount(run.burned)),
        stat("Cycle", `${formatAmount(cycleSeconds)}s`),
        stat("Helium charge", "512,000 L"),
      ],
    };
  },
};

const LFTR_URANIUM_233_PER_SECOND = (20 * 5.5) / 300;

const lftr: PowerSourceDefinition = {
  id: "lftr",
  name: "Liquid Fluoride Thorium Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Burns fuel salts for direct EU.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: powerPlannerData.lftrFuels.map((entry) => ({ key: entry.name, label: entry.name })),
      defaultKey: powerPlannerData.lftrFuels[0]?.name ?? "",
    },
  ],
  compute(read): PowerModel {
    const fuel =
      powerPlannerData.lftrFuels.find((entry) => entry.name === read.select("fuel")) ??
      powerPlannerData.lftrFuels[0];
    // RecipeLoaderLFTR burns 100 L in 100 seconds (1 L/s). Its output
    // metadata x4 in MTENuclearReactor agrees with EU/L divided by 20.
    // Use that numeric value: parsing the display label missed mixed-case LuV.
    const euPerTick = fuel.euPerLiter / 20;
    const inputs = [liters(fuel.name, 1), liters("Li2BeF4", 2)];
    const outputs = [
      liters("U-Salt", fuel.uSalt / 100),
      liters("T-Salt", fuel.tSalt / 100),
      liters("TB-Salt", fuel.tbSalt / 100),
      liters("UF6", fuel.uf6 / 100),
      // MTENuclearReactor.onRunningTick, once warmed up: a 1-in-300 chance
      // every tick of 1-10 L, so 20 x 5.5 / 300 L/s whatever the fuel (the
      // workbook rounded it to 0.33).
      liters("Uranium-233", LFTR_URANIUM_233_PER_SECOND),
    ].filter((flow) => flow.perSecond > 0);
    // The recipes also drink the carrier salt: 200 L Li2BeF4 per 100 s
    // alongside 100 L of fuel salt (RecipeLoaderLFTR).
    return {
      euPerTick,
      inputs,
      outputs,
      stats: [stat("EU per L", formatAmount(fuel.euPerLiter))],
    };
  },
};

const IC2_DESIGNS = [
  { key: "design-1", label: "Design 1 (1,150 L/s)", rate: 1150 },
  { key: "design-2", label: "Design 2 (1,380 L/s)", rate: 1380 },
  { key: "design-3", label: "Design 3 (1,340 L/s)", rate: 1340 },
];

const ic2FluidReactor: PowerSourceDefinition = {
  id: "ic2-fluid-reactor",
  name: "Nuclear Reactor (fluid mode)",
  group: "reactors",
  unlock: "EV",
  blurb: "A preset rod layout heating coolant.",
  settings: [
    {
      type: "select",
      id: "design",
      label: "Reactor design",
      options: [...IC2_DESIGNS.map(({ key, label }) => ({ key, label })), { key: "custom", label: "Custom rate" }],
      defaultKey: "design-2",
    },
    {
      type: "number",
      id: "customRate",
      label: "Hot coolant rate",
      min: 1,
      max: 100_000,
      step: 10,
      defaultValue: 1380,
      unit: "L/s",
      enabledWhen: { settingId: "design", equals: "custom" },
    },
  ],
  compute(read): PowerModel {
    const design = IC2_DESIGNS.find((entry) => entry.key === read.select("design"));
    const rate = design?.rate ?? read.number("customRate");
    return {
      euPerTick: 0,
      inputs: [liters("Coolant", rate)],
      outputs: [liters("Hot Coolant", rate)],
      stats: [stat("Hot coolant", `${formatAmount(rate)} L/s`)],
      warnings: ["Uranium rod costs are not modeled; the community planner skips them too."],
    };
  },
};

/**
 * The Vacuum Reactor: the workbook's `4. Vac Nuke` sheet, an EU-mode IC2
 * reactor on its one fixed layout - 40 fuel rods and 14 coolant cells in
 * the 6x9 chamber - whose cells are swapped out and recooled instead of
 * melting. The card does only what the reactor does: it burns rods to
 * their depleted forms, and it turns cold coolant cells into hot ones at
 * the rate the layout heats them. Recooling is the Vacuum Freezer's own
 * recipe in the dataset (hot cell in, cold cell out, 120 EU/t), so the
 * freezer is a machine you place and wire back into the reactor, exactly
 * the block the sheet draws beside it.
 *
 * Every rod stat below is transcribed from GT5U LoaderGTBlockFluid
 * (ItemRadioactiveCellIC: cells, durability, sEnergy, sHeat, mox, heat
 * bonus) and the maths from ItemRadioactiveCellIC.processChamber; the
 * sheet agrees with the source on all of it except the MOX bonus, which it
 * flattens to x2.475 for every MOX-type rod while the game multiplies by
 * `1 + heatBonus x heat%` with a per-rod bonus (MOX 1.5, HD Plutonium 6,
 * Excited Plutonium 2, Naquadria 1.5). The source wins there.
 *
 * Per rod: pulses p = 1 + cells/2 (single 1, dual 2, quad 3, Core 17).
 * With n rod neighbours it pulses p + n times per cell, each pulse worth
 * sEnergy x 25 EU (IC2's x5 times the pack's nuclear = 5.0), and sheds
 * (p+n)(p+n+1) x sHeat x cells / 2 heat a second into the coolant cells
 * beside it. The layout has 4 rods with one rod neighbour, 14 with two and
 * 22 with three.
 */
const NUKE_EU_PER_ENERGY = 25;
const LAYOUT_RODS_BY_NEIGHBOURS: ReadonlyArray<readonly [neighbours: number, rods: number]> = [
  [1, 4],
  [2, 14],
  [3, 22],
];
const LAYOUT_ROD_COUNT = 40;
const LAYOUT_CELL_COUNT = 14;

interface RodFamily {
  /** The dataset's name inside the parentheses. */
  material: string;
  /** Seconds a rod lasts (IC2 damages it once a second). */
  durability: number;
  /** ItemRadioactiveCellIC sEnergy. */
  energy: number;
  /** ItemRadioactiveCellIC sHeat. */
  heat: number;
  /** ItemRadioactiveCellIC heat bonus; MOX-type rods only. */
  moxBonus?: number;
}

const ROD_FAMILIES: RodFamily[] = [
  { material: "Thorium", durability: 50_000, energy: 0.4, heat: 1 },
  { material: "Uranium", durability: 20_000, energy: 2, heat: 4 },
  { material: "MOX", durability: 10_000, energy: 2, heat: 4, moxBonus: 1.5 },
  { material: "High Density Uranium", durability: 70_000, energy: 4, heat: 4 },
  { material: "High Density Plutonium", durability: 70_000, energy: 2, heat: 4, moxBonus: 6 },
  { material: "Excited Uranium", durability: 6_000, energy: 48, heat: 64 },
  { material: "Excited Plutonium", durability: 10_000, energy: 64, heat: 64, moxBonus: 2 },
  { material: "Naquadah", durability: 100_000, energy: 4, heat: 4 },
  { material: "Naquadria", durability: 100_000, energy: 4, heat: 4, moxBonus: 1.5 },
  { material: "Tiberium", durability: 50_000, energy: 2, heat: 2 },
];

export interface VacuumFuel {
  key: string;
  label: string;
  rod: string;
  depleted: string;
  cells: number;
  durability: number;
  energy: number;
  heat: number;
  moxBonus?: number;
}

const ROD_SIZES = [
  { cells: 1, prefix: "", word: "Single" },
  { cells: 2, prefix: "Dual ", word: "Dual" },
  { cells: 4, prefix: "Quad ", word: "Quad" },
];

export const VACUUM_FUELS: VacuumFuel[] = [
  ...ROD_FAMILIES.flatMap((family) =>
    ROD_SIZES.map(({ cells, prefix, word }) => ({
      key: `${family.material.toLowerCase().replace(/\s+/g, "-")}-${cells}`,
      label: `${family.material} (${word})`,
      rod: `${prefix}Fuel Rod (${family.material})`,
      depleted: `${prefix}Fuel Rod (Depleted ${family.material})`,
      cells,
      durability: family.durability,
      energy: family.energy,
      heat: family.heat,
      moxBonus: family.moxBonus,
    })),
  ),
  {
    key: "the-core",
    label: "The Core",
    rod: "The Core",
    depleted: "The Core (Depleted)",
    cells: 32,
    durability: 100_000,
    energy: 8,
    heat: 4,
  },
  // The quad naquadah rod sheds a quarter of its siblings' heat (sHeat 1F
  // in the loader where the single and dual say 4F); not a typo.
].map((fuel) => (fuel.key === "naquadah-4" ? { ...fuel, heat: 1 } : fuel));

/**
 * Coolant cells by heat capacity (ItemCoolantCellIC and IC2's own three).
 * The dataset keeps one item for a cell hot or cold, so the reactor's cell
 * output and input are the same resource, at the same rate.
 */
export const VACUUM_COOLANTS = [
  { key: "coolant-10k", name: "10k Coolant Cell", durability: 10_000 },
  { key: "coolant-30k", name: "30k Coolant Cell", durability: 30_000 },
  { key: "coolant-60k", name: "60k Coolant Cell", durability: 60_000 },
  { key: "he-60k", name: "60k He Coolant Cell", durability: 60_000 },
  { key: "he-180k", name: "180k He Coolant Cell", durability: 180_000 },
  { key: "he-360k", name: "360k He Coolant Cell", durability: 360_000 },
  { key: "nak-60k", name: "60k NaK Coolant Cell", durability: 60_000 },
  { key: "nak-180k", name: "180k NaK Coolant Cell", durability: 180_000 },
  { key: "nak-360k", name: "360k NaK Coolant Cell", durability: 360_000 },
  { key: "sp-180k", name: "180k Sp Coolant Cell", durability: 180_000 },
  { key: "sp-360k", name: "360k Sp Coolant Cell", durability: 360_000 },
  { key: "sp-540k", name: "540k Sp Coolant Cell", durability: 540_000 },
  { key: "sp-1080k", name: "1080k Sp Coolant Cell", durability: 1_080_000 },
  { key: "neutronium-1g", name: "1G Neutronium Heat Capacitor", durability: 1_000_000_000 },
];

/** The reactor's EU/t and the heat its cells take, on the fixed layout. */
export function vacuumReactorRun(fuel: VacuumFuel, coreTempPercent: number) {
  const pulses = 1 + Math.floor(fuel.cells / 2);
  const euPerPulse = fuel.energy * NUKE_EU_PER_ENERGY;
  const moxMultiplier = fuel.moxBonus ? 1 + fuel.moxBonus * (coreTempPercent / 100) : 1;
  const baseHeat = (fuel.heat * fuel.cells) / 2;
  const heatFor = (neighbours: number) =>
    baseHeat * (pulses + neighbours) * (pulses + neighbours + 1);
  let euPerTick = 0;
  let totalHeat = 0;
  for (const [neighbours, rods] of LAYOUT_RODS_BY_NEIGHBOURS) {
    euPerTick += rods * fuel.cells * (pulses + neighbours) * euPerPulse;
    totalHeat += rods * heatFor(neighbours);
  }
  return {
    euPerTick: euPerTick * moxMultiplier,
    moxMultiplier,
    /**
     * Heat a second into the average cell, the hottest (four three-neighbour
     * rods pouring everything into it) and the coolest (half of a one-
     * neighbour rod plus a two-neighbour rod), per the sheet's heat map.
     */
    cellHeat: {
      average: totalHeat / LAYOUT_CELL_COUNT,
      max: 4 * heatFor(3),
      min: 0.5 * heatFor(1) + heatFor(2),
    },
  };
}

const vacuumReactor: PowerSourceDefinition = {
  id: "vacuum-reactor",
  name: "Vacuum Reactor",
  group: "reactors",
  unlock: "EV",
  blurb: "Actively cooled nuke. Wire a freezer to recool its cells.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel rod (x40)",
      options: VACUUM_FUELS.map(({ key, label }) => ({ key, label })),
      defaultKey: "uranium-4",
    },
    {
      type: "select",
      id: "coolant",
      label: "Coolant cell (x14)",
      options: VACUUM_COOLANTS.map(({ key, name }) => ({ key, label: name })),
      defaultKey: "he-360k",
    },
    {
      type: "number",
      id: "coreTemp",
      label: "Core temp",
      min: 0,
      max: 99,
      step: 1,
      defaultValue: 98,
      unit: "%",
    },
  ],
  compute(read): PowerModel {
    const fuel = VACUUM_FUELS.find((entry) => entry.key === read.select("fuel")) ?? VACUUM_FUELS[0];
    const coolant =
      VACUUM_COOLANTS.find((entry) => entry.key === read.select("coolant")) ?? VACUUM_COOLANTS[0];
    const coreTemp = read.number("coreTemp");
    const run = vacuumReactorRun(fuel, coreTemp);
    const rodsPerSecond = LAYOUT_ROD_COUNT / fuel.durability;
    const cellLifeMin = coolant.durability / run.cellHeat.max;
    const cellLifeAverage = coolant.durability / run.cellHeat.average;
    // The sheet's cells-to-recool: 14 cells, each swapped once per average
    // lifespan.
    const cellsPerSecond = LAYOUT_CELL_COUNT / cellLifeAverage;

    const warnings: string[] = [];
    if (run.cellHeat.max > coolant.durability) {
      warnings.push(
        `${coolant.name} bursts: the hottest cell takes ${formatAmount(run.cellHeat.max)} heat a second and holds ${formatAmount(coolant.durability)}. Pick a bigger cell.`,
      );
    }
    if (fuel.moxBonus) {
      warnings.push(
        `Core temp ${formatAmount(coreTemp)}% multiplies the output by ${formatAmount(run.moxMultiplier)}. The reactor melts at 100%.`,
      );
    }
    return {
      euPerTick: run.euPerTick,
      inputs: [items(fuel.rod, rodsPerSecond), items(coolant.name, cellsPerSecond)],
      outputs: [items(fuel.depleted, rodsPerSecond), items(coolant.name, cellsPerSecond)],
      stats: [
        stat("Rod lifespan", lifespanHours(fuel.durability)),
        stat(
          "Cell heat",
          `${formatAmount(run.cellHeat.average)}/s avg, ${formatAmount(run.cellHeat.max)}/s max`,
        ),
        stat(
          "Coolant lifespan",
          `${formatAmount(cellLifeMin)} s min, ${formatAmount(cellLifeAverage)} s avg`,
        ),
        stat("Cells to recool", `${formatAmount(cellsPerSecond * 60)} a minute`),
      ],
      warnings,
    };
  },
};

const dehp: PowerSourceDefinition = {
  id: "dehp",
  name: "Deep Earth Heating Pump",
  group: "reactors",
  unlock: "EV",
  blurb: "Geothermal steam or hot coolant.",
  settings: [
    {
      type: "select",
      id: "mode",
      label: "Mode",
      options: [
        { key: "steam", label: "Direct steam" },
        { key: "coolant", label: "Coolant heating" },
      ],
      defaultKey: "steam",
    },
  ],
  compute(read): PowerModel {
    if (read.select("mode") === "coolant") {
      const perSecond = 192 * 20;
      return {
        euPerTick: -480,
        inputs: [liters("Coolant", perSecond)],
        outputs: [liters("Hot Coolant", perSecond)],
        stats: [stat("Hot coolant", "192 L/t")],
      };
    }
    const steamPerTick = 25_600;
    // MTEDeepEarthHeatingPump: waterConsume = (25600 + 160) / 160 = 161 L/t,
    // one more than the clean ratio - the game's own integer arithmetic.
    return {
      euPerTick: -480,
      inputs: [liters("Distilled Water", 161 * 20)],
      outputs: [liters("SH Steam", steamPerTick * 20)],
      stats: [stat("Steam", `${formatAmount(steamPerTick)} L/t superheated`)],
    };
  },
};

const SOLAR_TOWER_RINGS = [
  { rings: 1, hotSalt: 38.6 },
  { rings: 2, hotSalt: 104.6 },
  { rings: 3, hotSalt: 217.4 },
  { rings: 4, hotSalt: 431 },
  { rings: 5, hotSalt: 883 },
];

const solarTower: PowerSourceDefinition = {
  id: "solar-tower",
  name: "Solar Tower",
  group: "passive",
  unlock: "EV",
  blurb: "Heliostats heat solar salt. No fuel.",
  settings: [
    {
      type: "select",
      id: "rings",
      label: "Heliostat rings",
      options: SOLAR_TOWER_RINGS.map((entry) => ({
        key: String(entry.rings),
        label: `${entry.rings} ${entry.rings === 1 ? "ring" : "rings"}`,
      })),
      defaultKey: "5",
    },
  ],
  compute(read): PowerModel {
    const rings = Number(read.select("rings"));
    const entry = SOLAR_TOWER_RINGS.find((row) => row.rings === rings) ?? SOLAR_TOWER_RINGS[4];
    const heliostats = (28 + 8 * rings) * rings;
    return {
      euPerTick: 0,
      inputs: [liters("Cold Solar Salt", entry.hotSalt)],
      outputs: [liters("Hot Solar Salt", entry.hotSalt)],
      stats: [
        stat("Heliostats", String(heliostats)),
        stat("Hot salt", `${formatAmount(entry.hotSalt)} L/s`),
      ],
    };
  },
};

/**
 * MTESolarGenerator outputs V[tier] EU/t (1 for ULV): the panel's tier
 * name and its voltage line up, so an LV panel makes a full 32 EU/t.
 */
const SOLAR_PANEL_TIERS = [
  { key: "ULV", label: "Solar Panel (1 EU/t)", eut: 1 },
  { key: "LV", label: "LV Solar Panel (32 EU/t)", eut: 32 },
  { key: "MV", label: "MV Solar Panel (128 EU/t)", eut: 128 },
  { key: "HV", label: "HV Solar Panel (512 EU/t)", eut: 512 },
  { key: "EV", label: "EV Solar Panel (2,048 EU/t)", eut: 2048 },
  { key: "IV", label: "IV Solar Panel (8,192 EU/t)", eut: 8192 },
  { key: "LuV", label: "LuV Solar Panel (32,768 EU/t)", eut: 32768 },
  { key: "ZPM", label: "ZPM Solar Panel (131,072 EU/t)", eut: 131072 },
  { key: "UV", label: "UV Solar Panel (524,288 EU/t)", eut: 524288 },
];

const solarPanel: PowerSourceDefinition = {
  id: "solar-panel",
  name: "Solar Panel",
  group: "passive",
  unlock: "MV",
  blurb: "Flat daytime EU from sunlight.",
  settings: [
    {
      type: "select",
      id: "panel",
      label: "Panel",
      options: SOLAR_PANEL_TIERS.map(({ key, label }) => ({ key, label })),
      defaultKey: "LV",
    },
    { type: "number", id: "duty", label: "Duty", min: 1, max: 100, step: 1, defaultValue: 100, unit: "%" },
  ],
  compute(read): PowerModel {
    const panel = SOLAR_PANEL_TIERS.find((entry) => entry.key === read.select("panel")) ?? SOLAR_PANEL_TIERS[1];
    const duty = read.number("duty") / 100;
    return {
      euPerTick: panel.eut * duty,
      inputs: [],
      outputs: [],
      stats: [stat("Daytime output", `${formatAmount(panel.eut)} EU/t`)],
    };
  },
};

export const reactorSources: PowerSourceDefinition[] = [
  thtr,
  htgr,
  lftr,
  ic2FluidReactor,
  vacuumReactor,
  dehp,
];
export const passiveSources: PowerSourceDefinition[] = [solarTower, solarPanel];
