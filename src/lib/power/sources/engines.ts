/**
 * The engine multiblocks: Large Combustion Engine, Extreme Combustion
 * Engine, Large Semifluid Generator, Large Rocket Engine and the Universal
 * Chemical Fuel Engine. Boost mechanics follow MTELargeCombustionEngine
 * (fuel x2, output x3, oxygen 40 L/s) and MTEUniversalChemicalFuelEngine
 * (eff = 1.5 e^(-C/ratio)).
 */
import { findFuel, fuelOptions, powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, items, liters, percent, stat } from "./helpers";

/**
 * mRuntime counts 0..1001 before it wraps (MTEMultiBlockBase.doRandomMaintenanceDamage),
 * so a `mRuntime % 72 == 0` gate fires 14 times per 1002 ticks, not once per 72.
 */
const GATE_72_PER_SECOND = (14 / 1002) * 20;

interface EngineSpec {
  id: string;
  name: string;
  unlock: string;
  blurb: string;
  fuels: typeof powerPlannerData.combustionFuels;
  baseOutput: number;
  boostedOutput: number;
  booster: string;
  boosterPerSecond: number;
  /** LCE only: fuels above this EU/L refuse to run without the boost. */
  unboostedFuelCap?: number;
  /**
   * LCE and ECE: a boosted fuel worth more than half the boosted output burns
   * one extra litre at random, weighted by the leftover fraction.
   */
  weightedExtraLitre?: boolean;
  defaultFuel?: string;
}

const ENGINE_SPECS: EngineSpec[] = [
  {
    id: "large-combustion-engine",
    name: "Large Combustion Engine",
    unlock: "EV",
    blurb: "Diesel fuels; oxygen boost triples it.",
    fuels: powerPlannerData.combustionFuels,
    baseOutput: 2048,
    boostedOutput: 6144,
    booster: "Oxygen",
    boosterPerSecond: 40,
    unboostedFuelCap: 2048,
    weightedExtraLitre: true,
    defaultFuel: "Diesel",
  },
  {
    id: "extreme-combustion-engine",
    name: "Extreme Combustion Engine",
    unlock: "IV",
    blurb: "Jet fuels and HOG; liquid oxygen boost.",
    fuels: powerPlannerData.eceFuels,
    baseOutput: 10900,
    boostedOutput: 32700,
    // Lubricant: the tooltip claims 8000 L/hr, but getAdditiveFactor() is 1,
    // the same gate as the LCE (MTEExtremeCombustionEngine).
    booster: "Liquid Oxygen",
    boosterPerSecond: 40,
    unboostedFuelCap: 10900,
    weightedExtraLitre: true,
  },
  {
    id: "large-semifluid-generator",
    name: "Large Semifluid Burner",
    unlock: "EV",
    blurb: "The engine for heavy oils.",
    fuels: powerPlannerData.semifluidFuels,
    // Boosted it meters fuel against 4096 and runs at 150% efficiency (MTELargeSemifluidGenerator).
    baseOutput: 2048,
    boostedOutput: 6144,
    booster: "Oxygen",
    boosterPerSecond: 80,
    defaultFuel: "Creosote Oil",
  },
];

function buildEngine(spec: EngineSpec): PowerSourceDefinition {
  return {
    id: spec.id,
    name: spec.name,
    group: "engines",
    unlock: spec.unlock,
    blurb: spec.blurb,
    settings: [
      {
        type: "select",
        id: "fuel",
        label: "Fuel",
        options: fuelOptions(spec.fuels),
        defaultKey: spec.defaultFuel ?? spec.fuels[0]?.name ?? "",
      },
      { type: "toggle", id: "boost", label: "Oxygen boost", defaultOn: false },
    ],
    compute(read): PowerModel {
      const fuel = findFuel(spec.fuels, read.select("fuel"));
      const boost = read.on("boost");
      const euPerLiter = fuel.euPerLiter ?? 0;
      const blocked =
        spec.unboostedFuelCap !== undefined && !boost && euPerLiter > spec.unboostedFuelCap;
      const output = blocked ? 0 : boost ? spec.boostedOutput : spec.baseOutput;
      // Whole litres per tick: floor(nominal / fuel value), against twice the
      // nominal when boosted (MTELargeCombustionEngine, MTEExtremeCombustionEngine,
      // MTELargeSemifluidGenerator). A fuel that does not divide it burns less.
      let fuelPerTick = 0;
      if (euPerLiter > 0 && output > 0) {
        fuelPerTick = Math.floor(((boost ? 2 : 1) * spec.baseOutput) / euPerLiter);
        const boostedFuelValue = Math.floor(euPerLiter * 1.5);
        if (boost && spec.weightedExtraLitre && boostedFuelValue * 2 > spec.boostedOutput) {
          const ratio = spec.boostedOutput / boostedFuelValue;
          fuelPerTick += ratio - Math.trunc(ratio);
        }
      }
      const effectiveEu = fuelPerTick > 0 ? output / fuelPerTick : 0;

      // 1 L of lubricant per gate, 2 L while boosted, in every engine class.
      const lubricantPerSecond = GATE_72_PER_SECOND * (boost ? 2 : 1);
      const inputs = [liters(fuel.name, fuelPerTick * 20), liters("Lubricant", lubricantPerSecond)];
      if (boost) {
        inputs.push(liters(spec.booster, spec.boosterPerSecond));
      }
      return {
        euPerTick: output,
        inputs,
        outputs: [],
        stats: [stat("EU per L", formatAmount(effectiveEu))],
        warnings: blocked
          ? [`${fuel.name} is over ${spec.unboostedFuelCap} EU/L and needs the oxygen boost.`]
          : undefined,
      };
    },
  };
}

/**
 * Large Rocket Engine (GT++ MTELargeRocketEngine). One burn feeds 21 ticks
 * (freeFuelTicks = 20) but setEUProduction spreads its energy over 20, so a
 * steady R L/s burns 1.05 R per burn: P = fuel EU/L x 1.05 R / 20. Output
 * falls off by cube roots past 30,000 and 80,000; liquid hydrogen boost
 * meters that falloff on a third of the fuel and triples the result, 3 f(P/3).
 * Air is euProduction/100 per tick; CO2 is consumed as the lubricant (1 L per
 * gate, 3 L boosted); the engine outputs no fluid.
 */
function rocketFalloff(energy: number): number {
  if (energy <= 30000) {
    return energy;
  }
  return energy * Math.cbrt(30000 / energy) * (energy >= 80000 ? Math.cbrt(80000 / energy) : 1);
}

const largeRocketEngine: PowerSourceDefinition = {
  id: "large-rocket-engine",
  name: "Large Rocket Engine",
  group: "engines",
  unlock: "IV",
  blurb: "Rocket fuel; falls off past its knees.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(powerPlannerData.rocketFuels),
      defaultKey: powerPlannerData.rocketFuels[0]?.name ?? "",
    },
    { type: "number", id: "throttle", label: "Fuel rate", min: 1, max: 4000, step: 1, defaultValue: 500, unit: "L/s" },
    { type: "toggle", id: "boost", label: "Liquid hydrogen boost", defaultOn: false },
  ],
  compute(read): PowerModel {
    const fuel = findFuel(powerPlannerData.rocketFuels, read.select("fuel"));
    const throttle = read.number("throttle");
    const boost = read.on("boost");
    // The table carries the tag's fuel value x3, as consumeFuel applies it.
    const euPerLiter = fuel.euPerLiter ?? 0;
    const perLiterPerSecond = (euPerLiter * 1.05) / 20;
    const power = throttle * perLiterPerSecond;
    const kneeFactor = boost ? 3 : 1;
    const knee1 = (30000 * kneeFactor) / perLiterPerSecond;
    const knee2 = (80000 * kneeFactor) / perLiterPerSecond;
    // euProduction is what the game meters air and hydrogen against;
    // getMaxEfficiency returns it, so the output is 16384 x euProduction / 10000.
    const euProduction = boost ? 3 * rocketFalloff(power / 3) : rocketFalloff(power);
    const euPerTick = Math.max(0, 1.6384 * euProduction);

    const inputs = [
      liters(fuel.name, throttle),
      // aAirToConsume = euProduction / 100 per tick.
      liters("Air", (euProduction / 100) * 20),
      // consumeCO2 at the mRuntime % 72 gate.
      liters("Carbon Dioxide", kneeFactor * GATE_72_PER_SECOND),
    ];
    if (boost) {
      // consumeLOH: 3 x euProduction / 1000 L once per 21-tick burn.
      inputs.push(liters("Liquid Hydrogen", ((3 * euProduction) / 1000) * (20 / 21)));
    }
    return {
      euPerTick,
      inputs,
      outputs: [],
      stats: [
        stat("EU per L", formatAmount(throttle > 0 ? euPerTick / (throttle / 20) : 0)),
        stat("Power knees", `${formatAmount(knee1)} / ${formatAmount(knee2)} L/s`),
      ],
    };
  },
};

/**
 * Universal Chemical Fuel Engine (Good Generator): burns almost any fuel
 * with Combustion Promoter; efficiency 1.5 x e^(-C / promoterRatio), C from
 * the fuel table.
 */
const universalChemicalFuelEngine: PowerSourceDefinition = {
  id: "universal-chemical-fuel-engine",
  name: "Universal Chemical Fuel Engine",
  group: "engines",
  unlock: "LuV",
  blurb: "Any fuel plus combustion promoter.",
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(powerPlannerData.ucfeFuels),
      defaultKey: "RP-1 (red)",
    },
    { type: "number", id: "flow", label: "Fuel rate", min: 1, max: 100000, step: 1, defaultValue: 500, unit: "L/s" },
    {
      type: "number",
      id: "promoterRatio",
      label: "Promoter per fuel",
      min: 0.01,
      max: 2,
      step: 0.01,
      defaultValue: 0.2,
    },
  ],
  compute(read): PowerModel {
    const fuel = findFuel(powerPlannerData.ucfeFuels, read.select("fuel"));
    const flow = read.number("flow");
    const ratio = read.number("promoterRatio");
    const coefficient = fuel.promoterCoefficient ?? 0.04;
    const efficiency = 1.5 * Math.exp(-coefficient / ratio);
    const euPerTick = (flow * (fuel.euPerLiter ?? 0) * efficiency) / 20;
    return {
      euPerTick,
      inputs: [liters(fuel.name, flow), liters("Combustion Promoter", flow * ratio)],
      outputs: [],
      stats: [stat("Efficiency", percent(efficiency))],
    };
  },
};

/**
 * Large Neutralization Engine (GT++): acids to EU at rate x density, a
 * hydroxide base multiplying the power at its own drink rate, robot arms
 * boosting toxic-residue decay at the cost of a loss chance. Residue is a
 * rare accumulation, not a steady flow, so it stays in the stats.
 */
const largeNeutralizationEngine: PowerSourceDefinition = {
  id: "large-neutralization-engine",
  name: "Large Neutralization Engine",
  group: "engines",
  unlock: "EV",
  blurb: "Neutralizes acids for power.",
  settings: [
    {
      type: "select",
      id: "structure",
      label: "Structure",
      options: powerPlannerData.lneStructureTiers.map((entry) => ({
        key: entry.name,
        label: entry.name,
      })),
      defaultKey: powerPlannerData.lneStructureTiers[0]?.name ?? "T1",
    },
    {
      type: "select",
      id: "fuel",
      label: "Acid",
      options: fuelOptions(powerPlannerData.chemFuels),
      defaultKey: "Molten Redstone",
    },
    // Per TICK, like the game's own fluid-use dial (maxFluidUse) and the
    // workbook's rate cell: mEUt = fuel value x litres per tick.
    { type: "number", id: "rate", label: "Acid rate", min: 1, max: 100_000, step: 1, defaultValue: 50, unit: "L/t" },
    {
      type: "select",
      id: "base",
      label: "Base",
      options: [
        { key: "None", label: "None" },
        ...powerPlannerData.lneBases.map((entry) => ({
          key: entry.name,
          label: `${entry.name} (x${entry.multiplier})`,
        })),
      ],
      defaultKey: "None",
    },
    { type: "number", id: "arms", label: "Robot arms", min: 0, max: 16, step: 1, defaultValue: 0 },
    {
      type: "select",
      id: "armTier",
      label: "Arm tier",
      options: powerPlannerData.lneRobotArms.map((entry) => ({
        key: entry.name,
        label: entry.name.replace(/^Amount \((.+)\)$/, "$1"),
      })),
      defaultKey: "Amount (HV)",
      enabledWhen: undefined,
    },
  ],
  compute(read): PowerModel {
    const structure =
      powerPlannerData.lneStructureTiers.find((entry) => entry.name === read.select("structure")) ??
      powerPlannerData.lneStructureTiers[0];
    const fuel = findFuel(powerPlannerData.chemFuels, read.select("fuel"));
    const rate = read.number("rate");
    const baseName = read.select("base");
    const base = powerPlannerData.lneBases.find((entry) => entry.name === baseName);
    const arms = Math.min(16, read.number("arms"));
    const armTier =
      powerPlannerData.lneRobotArms.find((entry) => entry.name === read.select("armTier"))?.tier ??
      2;
    const density = fuel.euPerLiter ?? 0;
    const multiplier = base?.multiplier ?? 1;
    const euPerTick = rate * density * multiplier;

    // MTELargeNeutralizationEngine, tier = ROBOT_ARMS index (LV 0): decay
    // boost sqrt(arms) x 1.2^tier (1.4 past IV); one arm lost when a roll of
    // 45 x (tier + 2) each minute lands under the arm count. Residue is the
    // workbook's floor/ceil of the ^12.5.
    const decayBoost =
      arms === 0 ? 1 : Math.sqrt(arms) * (armTier <= 4 ? 1.2 ** armTier : 1.4 ** armTier);
    const lossChance = arms / (45 * (armTier + 2));
    const residueCore = (0.05 * Math.pow(density, 0.8) * rate) / (structure.baseDecay * decayBoost);
    const residueMedian = Math.floor(Math.pow(residueCore, 12.5));
    const residueMax = Math.ceil(Math.pow(residueCore * 1.3, 12.5));
    // The random walk targets 0.7-1.3 uniformly, so residue arrives at an
    // average of exactly 0.05 x density^0.8 x rate per tick. Decay scales
    // with the stored amount (^0.08), so its ceiling is at a full tank:
    // baseDecay x armBoost x capacity^0.08. A positive net there means no
    // equilibrium fits inside the tank and the engine eventually explodes.
    const residuePerTick = 0.05 * Math.pow(density, 0.8) * rate;
    const decayAtFull =
      structure.baseDecay * decayBoost * Math.pow(structure.residueCapacity, 0.08);
    const netAtFull = residuePerTick - decayAtFull;

    const inputs = [liters(fuel.name, rate * 20)];
    if (base) {
      // useBooster: one hydroxide dust lasts boostTicks, then one tick to
      // reload, so a dust per boostTicks + 1.
      inputs.push(items(`${base.name} Dust`, 20 / (base.boostTicks + 1)));
    }
    return {
      euPerTick,
      inputs,
      outputs: [],
      stats: [
        stat("EU per L", formatAmount(density * multiplier)),
        stat("Toxic residue", `${formatAmount(residueMedian)} median / ${formatAmount(residueMax)} max`),
        stat("Avg residue", `${formatAmount(residuePerTick)}/t`),
        stat("At full tank", `${netAtFull > 0 ? "+" : ""}${formatAmount(netAtFull)}/t`),
        stat("Residue capacity", formatAmount(structure.residueCapacity)),
        ...(arms > 0
          ? [
              stat("Decay boost", `x${formatAmount(decayBoost)}`),
              stat("Avg lifespan", `${formatAmount(Math.floor(1 / lossChance))} min`),
            ]
          : []),
      ],
      warnings:
        netAtFull > 0
          ? ["Residue builds faster than it decays even at a full tank. The engine will explode."]
          : undefined,
    };
  },
};

export const engineSources: PowerSourceDefinition[] = [
  ...ENGINE_SPECS.map(buildEngine),
  largeRocketEngine,
  largeNeutralizationEngine,
  universalChemicalFuelEngine,
];
