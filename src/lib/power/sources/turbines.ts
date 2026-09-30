/**
 * Large and XL Turbo turbines, each following its fluidIntoPower in GT5U
 * (MTELargeTurbine* and MTEXLTurbine*): the fuel EU of the flow, scaled by
 *
 *   1 - |flow - opt| / (opt x penalty)
 *
 * (penalty 1 below optimal, per-class above it), then by the rotor
 * efficiency, truncating after each step in float like the Java. Per-class
 * caps, weak-rotor branches and lifespans are in docs/power-planner-math.md.
 * Steam and gas flows are litres per TICK (the game's own tooltip unit);
 * plasma flows are litres per second.
 */
import {
  findFuel,
  findRotor,
  fuelOptions,
  powerPlannerData,
  resolvePowerResource,
  ROTOR_SIZE_NAMES,
  rotorDurability,
  type RotorClassData,
  type RotorEntry,
} from "../planner-data";
import type { PowerFlowLine, PowerModel, PowerSourceDefinition, PowerSetting } from "../types";
import { formatAmount, lifespanHours, liters, percent, stat } from "./helpers";

type TurbineClass = "steam" | "gas" | "plasma";

interface TurbineSpec {
  id: string;
  name: string;
  unlock: string;
  blurb: string;
  turbineClass: TurbineClass;
  xl: boolean;
  /** Steam machines: the grade burned, or "select" for the XL's grade knob. */
  steamGrade?: string | "select";
  /** For "select": which grades this XL machine accepts (plain + dense). */
  steamGradeOptions?: string[];
}

const STEAM_EXHAUST: Record<string, string | undefined> = {
  "SC Steam": "SH Steam",
  "SH Steam": "Steam",
  "Dense SC Steam": "Dense SH Steam",
  "Dense SH Steam": "Dense Steam",
};

/**
 * The de-powered fluid a plasma turbine returns, 1 L per 1 L of plasma.
 * MTELargeTurbinePlasma strips the "plasma." fluid-name prefix and takes
 * the plain fluid if the registry has one, else the molten form - so every
 * plasma exhausts, not only the fusion-made ones. The fusion table's decay
 * column wins where it exists (same rule, already spelled out); the rest
 * mirror the registry fallback against our own resource map.
 */
function plasmaExhaust(plasmaName: string): string | undefined {
  const recipe = powerPlannerData.fusionRecipes.find((entry) => entry.name === plasmaName);
  if (recipe?.decayOutput) {
    return recipe.decayOutput !== "None" ? recipe.decayOutput : undefined;
  }
  const base = plasmaName.replace(/ Plasma$/, "");
  if (base === plasmaName) {
    return undefined;
  }
  if (resolvePowerResource(base)) {
    return base;
  }
  const molten = `Molten ${base}`;
  if (resolvePowerResource(molten)) {
    return molten;
  }
  // Neither form is a registered fluid: the game consumes the plasma and
  // outputs nothing (the null-check around addOutputPartial).
  return undefined;
}

function classData(rotor: RotorEntry, turbineClass: TurbineClass): RotorClassData {
  return rotor[turbineClass];
}

function pickLadder(values: Array<number | null>, sizeIndex: number): number {
  const value = values[sizeIndex];
  return typeof value === "number" ? value : 0;
}

/** The turbines compute in Java float; every step below rounds like it. */
const f32 = Math.fround;

/** getBaseDamage of ToolTurbineSmall, Normal, Large and Huge. */
const ROTOR_BASE_DAMAGE = [0, 2.5, 5, 7.5];

/**
 * TurbineStatCalculator.getBaseEfficiency in float, 0.5 + (0.5 + base damage
 * + tool quality) x 0.1, rebuilt from the ladder's decimal value so products
 * and the SC's int cast see the game's exact float.
 */
function javaBaseEfficiency(tightEfficiency: number, sizeIndex: number): number {
  const baseDamage = ROTOR_BASE_DAMAGE[sizeIndex] ?? 0;
  const quality = Math.round((tightEfficiency - 0.5) / 0.1 - 0.5 - baseDamage);
  return f32(0.5 + f32(f32(0.5 + f32(baseDamage + quality)) * f32(0.1)));
}

/** GTUtility/MathUtils.safeInt clamp outputs and flows at the top voltage. */
const INT_CAP = 2_147_483_640;

/** An integer amount times a float factor, truncated: `tEU *= efficiency` in the Java. */
function scale(amount: number, factor: number): number {
  return Math.min(INT_CAP, Math.trunc(f32(f32(amount) * f32(factor))));
}

/**
 * getOverflowEfficiency: the linear loss off optimal. Below optimal every
 * class loses 1:1; above it the loss divides by the class's overflow divisor
 * (1 for SC steam and every XL, so both sides cost the same).
 */
function flowEfficiency(flow: number, optimal: number, overDivisor: number): number {
  if (flow > optimal) {
    return f32(1 - f32((flow - optimal) / f32(f32(optimal) * overDivisor)));
  }
  return f32(1 - Math.abs(f32(f32(f32(flow) - f32(optimal)) / f32(optimal))));
}

/**
 * Rotor wear per damage roll (getDamageToComponent), averaged over its dice.
 * Steam and HP: a loose rotor skips 1 roll in 4. SC (MTELargeTurbineSCSteam):
 * 2 tight, a coin flip of 0 or 1 loose. MTEXLTurbineGas skips 1 in 4 in
 * either fitting. Gas and plasma otherwise take 1.
 */
function damagePerRoll(spec: TurbineSpec, fuelName: string, tight: boolean): number {
  if (spec.turbineClass === "gas") {
    return spec.xl ? 0.75 : 1;
  }
  if (spec.turbineClass === "plasma") {
    return 1;
  }
  if (!spec.xl && fuelName === "SC Steam") {
    return tight ? 2 : 0.5;
  }
  return tight ? 1 : 0.75;
}

/**
 * Seconds until one rotor breaks. A damage roll comes every 1002 ticks
 * (mRuntime++ > 1000) and lands half the time, for min(EU/5, EU^0.6)
 * truncated (MTEMultiBlockBase.doRandomMaintenanceDamage; the exponent is the
 * float damageFactorHigh, so exact powers like 243^0.6 land on 27). The XL
 * rolls each of its rotors on a fifth of its output (MTEXLTurbineBase.damageTurbine).
 */
function rotorLifespanSeconds(
  xl: boolean,
  euPerTick: number,
  durability: number,
  perRoll: number,
): number {
  const eu = xl ? Math.floor(euPerTick / 5) : euPerTick;
  const linear = xl ? eu / 5 : Math.floor(eu / 5);
  const damage = Math.floor(Math.min(linear, Math.pow(eu, f32(0.6)))) * perRoll;
  return damage > 0 ? ((durability / damage) * 2 * 1002) / 20 : Infinity;
}

/** One turbine's operating point, flows in the card's own unit. */
interface TurbineRun {
  optimal: number;
  flow: number;
  maxFlow: number;
  euPerTick: number;
  /** XL dense steam: the steam-equivalent litres per tick actually used. */
  steamPerTick?: number;
  efficiency: number;
  warning?: string;
}

const idle = (optimal: number, efficiency: number, warning: string): TurbineRun => ({
  optimal,
  flow: 0,
  maxFlow: 0,
  euPerTick: 0,
  efficiency,
  warning,
});

/**
 * MTELargeTurbineSteam / HPSteam / SCSteam. `realOpt` is the rotor's steam
 * flow (tight or loose) in L/t. Steam pays 0.5 EU/L, SH and SC 1 EU/L.
 */
function largeSteamRun(
  grade: string,
  realOpt: number,
  overflowTier: number,
  eff: number,
  baseEfficiency: number,
  wanted: number | undefined,
): TurbineRun {
  const opt = f32(realOpt);
  if (grade === "SC Steam") {
    // useLegacyEfficiencyScaling: the base efficiency is cast to int, and 0
    // stops the machine, so rotors under 100% never run here.
    if (Math.trunc(f32(baseEfficiency)) <= 0) {
      return idle(
        Math.floor(opt),
        eff,
        "Rotor base efficiency is under 100%, so the SC turbine will not run it.",
      );
    }
    const maxFlow = Math.min(INT_CAP, Math.floor(opt * 1.25));
    const optimal = Math.min(Math.floor(opt), maxFlow);
    const flow = Math.min(wanted ?? optimal, maxFlow);
    const euPerTick =
      flow === opt
        ? scale(flow, eff)
        : Math.max(1, scale(f32(f32(flow) * flowEfficiency(flow, opt, 1)), eff));
    return { optimal, flow, maxFlow, euPerTick, efficiency: eff };
  }
  const sh = grade === "SH Steam";
  const optimal = Math.floor(opt);
  const maxFlow = Math.min(INT_CAP, Math.floor(opt * (f32(0.5 * overflowTier) + (sh ? 1.5 : 1))));
  const flow = Math.min(wanted ?? optimal, maxFlow);
  const euFrom = (steam: number) =>
    sh ? scale(steam, eff) : Math.trunc(f32(f32(f32(steam) * f32(eff)) * 0.5));
  const euPerTick =
    flow === optimal
      ? euFrom(flow)
      : Math.max(
          1,
          euFrom(scale(flow, flowEfficiency(flow, optimal, overflowTier + (sh ? 2 : 1)))),
        );
  return { optimal, flow, maxFlow, euPerTick, efficiency: eff };
}

/**
 * MTEXLTurbineSteam / HPSteam / SCSteam: sixteen rotors' flow, a 1.25x cap
 * and the same loss either side of optimal, measured on the unrounded
 * optimum. Dense steam is 1000 steam-equivalent litres per litre: the turbine
 * takes whole dense litres (up to ceil(cap / 1000)) but uses only up to the
 * cap.
 */
function xlSteamRun(
  grade: string,
  rotorFlow: number,
  eff: number,
  wanted: number | undefined,
): TurbineRun {
  const dense = grade.startsWith("Dense");
  const plain = grade === "Steam" || grade === "Dense Steam";
  const steamOpt = f32(16 * f32(rotorFlow));
  const steamCap = Math.min(INT_CAP, Math.floor(steamOpt * 1.25));
  const euFor = (steam: number): number => {
    const raw = plain ? Math.trunc(f32(f32(steam) * 0.5)) : steam;
    if (steam === steamOpt) {
      return scale(raw, eff);
    }
    return Math.max(1, scale(scale(raw, flowEfficiency(steam, steamOpt, 1)), eff));
  };
  if (!dense) {
    const optimal = Math.min(Math.floor(steamOpt), steamCap);
    const flow = Math.min(wanted ?? optimal, steamCap);
    return { optimal, flow, maxFlow: steamCap, euPerTick: euFor(flow), efficiency: eff };
  }
  const steamFor = (litres: number) => Math.min(litres * 1000, steamCap);
  const below = Math.floor(steamOpt / 1000);
  const above = Math.ceil(steamOpt / 1000);
  // The whole-litre feed that makes the most EU: usually the one above, since
  // overshooting the optimum costs far less than falling short.
  const optimal = below >= 1 && euFor(steamFor(below)) >= euFor(steamFor(above)) ? below : above;
  const maxFlow = Math.ceil(steamCap / 1000);
  const flow = Math.min(wanted ?? optimal, maxFlow);
  const steamPerTick = steamFor(flow);
  return { optimal, flow, maxFlow, euPerTick: euFor(steamPerTick), steamPerTick, efficiency: eff };
}

/**
 * MTELargeTurbineGas and MTEXLTurbineGas. A rotor whose tight optimal EU/t
 * is under one litre of the fuel burns 1 L/t and makes exactly that, in
 * either fitting; the XL makes one rotor's worth, not sixteen. On the Large,
 * an optimum that truncates to 0 L/t makes nothing.
 */
function gasRun(
  xl: boolean,
  fuelEu: number,
  rotorFlow: number,
  tightRotorFlow: number,
  eff: number,
  baseEfficiency: number,
  overflowTier: number,
  wanted: number | undefined,
): TurbineRun {
  const rotorEuPerTick = f32(f32(tightRotorFlow) * f32(baseEfficiency));
  if (rotorEuPerTick < fuelEu) {
    const euPerTick = Math.trunc(rotorEuPerTick);
    return {
      optimal: 1,
      flow: 1,
      maxFlow: 1,
      euPerTick,
      efficiency: baseEfficiency,
      warning: `Rotor too weak for this fuel: it burns 1 L/t for ${xl ? "one rotor's " : ""}${formatAmount(euPerTick)} EU/t.`,
    };
  }
  const perRotor = f32(f32(rotorFlow) / fuelEu);
  const optimal = Math.min(INT_CAP, Math.trunc(xl ? f32(16 * perRotor) : perRotor));
  if (optimal <= 0) {
    return idle(
      0,
      eff,
      "Optimal flow rounds down to 0 L/t on this fuel, so the turbine makes no power.",
    );
  }
  const maxFlow = Math.min(
    INT_CAP,
    Math.trunc(f32(f32(optimal) * f32(xl ? 1.25 : 1.5 * overflowTier))),
  );
  const flow = Math.min(wanted ?? optimal, maxFlow);
  let raw = Math.min(INT_CAP, flow * fuelEu);
  if (flow !== optimal) {
    raw = scale(raw, flowEfficiency(flow, optimal, xl ? 1 : overflowTier * 3 - 1));
  }
  return { optimal, flow, maxFlow, euPerTick: scale(raw, eff), efficiency: eff };
}

/**
 * MTELargeTurbinePlasma rounds its optimum up (Math.ceil); MTEXLTurbinePlasma
 * truncates it, so a weak rotor on a dense plasma can take nothing. The XL
 * also derates plasmas weaker than one rotor's optimal EU/t:
 * min(1, (fuelEU x 0.005)^2 / euAtOptimal).
 */
function plasmaRun(
  xl: boolean,
  fuelEu: number,
  rotorFlow: number,
  eff: number,
  euAtOptimal: number,
  overflowTier: number,
  wanted: number | undefined,
): TurbineRun {
  const flowF = f32(rotorFlow);
  const optimal = Math.min(
    INT_CAP,
    xl ? Math.trunc(f32(f32(16 * flowF) * 20) / fuelEu) : Math.ceil((flowF * 20) / fuelEu),
  );
  // euPerTurbine is MathUtils.roundToClosestInt of one rotor's tight optimal EU/t.
  const euPerTurbine = Math.trunc(Math.round(euAtOptimal * 2) / 2);
  const derated = xl && euPerTurbine > 0;
  let derate = 1;
  if (derated) {
    const magic = f32(fuelEu * f32(0.005));
    derate = Math.min(1, f32(f32(magic * magic) / euPerTurbine));
  }
  if (optimal <= 0) {
    return idle(
      0,
      eff * derate,
      "Optimal flow rounds down to 0 L/s on this plasma, so the turbine makes no power.",
    );
  }
  const maxFlow = Math.min(
    INT_CAP,
    Math.trunc(f32(f32(optimal) * (xl ? f32(1.25) : f32(f32(1.5 * overflowTier) + 1)))),
  );
  const flow = Math.min(wanted ?? optimal, maxFlow);
  let raw = Math.min(INT_CAP, Math.trunc((fuelEu / 20) * flow));
  if (flow !== optimal) {
    raw = xl
      ? Math.trunc(raw * (1 - Math.abs(f32((flow - optimal) / f32(optimal)))))
      : scale(raw, flowEfficiency(flow, optimal, overflowTier * 3 + 1));
  }
  // The derate multiplies in float even at 1, so large outputs round like the Java's.
  const euPerTick = derated ? scale(scale(raw, eff), derate) : scale(raw, eff);
  return { optimal, flow, maxFlow, euPerTick, efficiency: eff * derate };
}

const SPECS: TurbineSpec[] = [
  {
    id: "large-steam-turbine",
    name: "Large Steam Turbine",
    unlock: "HV",
    blurb: "Steam in, EU out; the rotor decides.",
    turbineClass: "steam",
    xl: false,
    steamGrade: "Steam",
  },
  {
    id: "large-hp-steam-turbine",
    name: "Large HP Steam Turbine",
    unlock: "EV",
    blurb: "SH steam in; exhausts plain steam.",
    turbineClass: "steam",
    xl: false,
    steamGrade: "SH Steam",
  },
  {
    id: "large-sc-steam-turbine",
    name: "Large SC Steam Turbine",
    // GoodGenerator's assembler recipe: IV hull, LuV circuits.
    unlock: "LuV",
    blurb: "SC steam in; exhausts SH steam.",
    turbineClass: "steam",
    xl: false,
    steamGrade: "SC Steam",
  },
  {
    id: "xl-turbo-steam-turbine",
    name: "XL Turbo Steam Turbine",
    // The XL unlocks follow their controller's assembler recipe
    // (RecipesMachinesCustom): EV, IV, LuV, ZPM and ZPM circuits and power.
    unlock: "EV",
    blurb: "Sixteen steam turbines; dense too.",
    turbineClass: "steam",
    xl: true,
    steamGrade: "select",
    steamGradeOptions: ["Steam", "Dense Steam"],
  },
  {
    id: "xl-turbo-hp-steam-turbine",
    name: "XL Turbo HP Steam Turbine",
    unlock: "IV",
    blurb: "Sixteen HP turbines; exhausts steam.",
    turbineClass: "steam",
    xl: true,
    steamGrade: "select",
    steamGradeOptions: ["SH Steam", "Dense SH Steam"],
  },
  {
    id: "xl-turbo-sc-steam-turbine",
    name: "XL Turbo SC Steam Turbine",
    unlock: "ZPM",
    blurb: "Sixteen SC turbines; exhausts SH.",
    turbineClass: "steam",
    xl: true,
    steamGrade: "select",
    steamGradeOptions: ["SC Steam", "Dense SC Steam"],
  },
  {
    id: "large-gas-turbine",
    name: "Large Gas Turbine",
    unlock: "EV",
    blurb: "Gas fuels at rotor efficiency.",
    turbineClass: "gas",
    xl: false,
  },
  {
    id: "xl-turbo-gas-turbine",
    name: "XL Turbo Gas Turbine",
    unlock: "LuV",
    blurb: "Sixteen gas turbines in one.",
    turbineClass: "gas",
    xl: true,
  },
  {
    id: "large-plasma-generator",
    name: "Large Plasma Generator",
    unlock: "LuV",
    blurb: "Plasma to EU and its cooled gas.",
    turbineClass: "plasma",
    xl: false,
  },
  {
    id: "xl-turbo-plasma-turbine",
    name: "XL Turbo Plasma Turbine",
    unlock: "ZPM",
    blurb: "Sixteen plasma turbines in one.",
    turbineClass: "plasma",
    xl: true,
  },
];

function buildTurbine(spec: TurbineSpec): PowerSourceDefinition {
  const settings: PowerSetting[] = [
    {
      type: "select",
      id: "rotor",
      label: "Rotor",
      options: powerPlannerData.rotors.map((rotor) => ({
        key: rotor.name,
        label: `${rotor.name} (${rotor.unlock})`,
      })),
      defaultKey: spec.xl ? "HSS-E" : "Carbon",
    },
    {
      type: "select",
      id: "size",
      label: "Rotor size",
      options: ROTOR_SIZE_NAMES.map((name) => ({ key: name, label: name })),
      defaultKey: spec.xl ? "Huge" : "Normal",
    },
    {
      type: "select",
      id: "fitting",
      label: "Fitting",
      options: [
        { key: "tight", label: "Tight" },
        { key: "loose", label: "Loose" },
      ],
      defaultKey: "tight",
    },
  ];
  if (spec.steamGrade === "select") {
    const grades = fuelOptions(powerPlannerData.steamGrades).filter(
      (option) => spec.steamGradeOptions?.includes(option.key) ?? true,
    );
    settings.push({
      type: "select",
      id: "grade",
      label: "Steam type",
      options: grades,
      defaultKey: grades[0]?.key ?? "Steam",
    });
  } else if (spec.turbineClass === "gas") {
    settings.push({
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(spec.xl ? powerPlannerData.gasFuelsXl : powerPlannerData.gasFuels),
      // The XL hard-refuses benzene in the game (and Fox's XL fuel table
      // matches), so its default is the sheet's own pick.
      defaultKey: spec.xl ? "Nitrobenzene" : "Benzene",
    });
  } else if (spec.turbineClass === "plasma") {
    settings.push({
      type: "select",
      id: "fuel",
      label: "Plasma",
      options: fuelOptions(powerPlannerData.plasmas),
      defaultKey: "Helium Plasma",
    });
  }
  settings.push(
    {
      type: "select",
      id: "flowMode",
      label: "Flow",
      options: [
        { key: "optimal", label: "Optimal" },
        { key: "custom", label: "Custom" },
      ],
      defaultKey: "optimal",
    },
    {
      type: "number",
      id: "customFlow",
      label: "Custom flow",
      min: 1,
      max: 100_000_000,
      step: 1,
      defaultValue: 100,
      unit: spec.turbineClass === "plasma" ? "L/s" : "L/t",
      enabledWhen: { settingId: "flowMode", equals: "custom" },
    },
  );

  return {
    id: spec.id,
    name: spec.name,
    group: "turbines",
    unlock: spec.unlock,
    blurb: spec.blurb,
    settings,
    compute(read): PowerModel {
      const rotor = findRotor(read.select("rotor"));
      const sizeIndex = Math.max(0, ROTOR_SIZE_NAMES.indexOf(read.select("size") as never));
      const tight = read.select("fitting") !== "loose";
      const data = classData(rotor, spec.turbineClass);
      const overflowTier = rotor.overflowTier;

      let fuelName: string;
      let fuelEu: number;
      if (spec.turbineClass === "steam") {
        fuelName =
          spec.steamGrade === "select" ? read.select("grade") : (spec.steamGrade as string);
        fuelEu = findFuel(powerPlannerData.steamGrades, fuelName).euPerLiter ?? 0.5;
      } else {
        fuelName = read.select("fuel");
        const table =
          spec.turbineClass === "gas"
            ? spec.xl
              ? powerPlannerData.gasFuelsXl
              : powerPlannerData.gasFuels
            : powerPlannerData.plasmas;
        fuelEu = findFuel(table, fuelName).euPerLiter ?? 0;
      }

      // The tight value is getBaseEfficiency, which the SC and gas checks read in either fitting.
      const baseEfficiency = javaBaseEfficiency(
        pickLadder(data.efficiencyTight, sizeIndex),
        sizeIndex,
      );
      const efficiency = tight ? baseEfficiency : pickLadder(data.efficiencyLoose, sizeIndex);
      const rotorFlow = pickLadder(tight ? data.optimalTight : data.optimalLoose, sizeIndex);
      const dense = fuelName.startsWith("Dense");
      const wanted = read.select("flowMode") === "custom" ? read.number("customFlow") : undefined;

      let run: TurbineRun;
      if (spec.turbineClass === "steam") {
        // Every steam grade runs the rotor's steam flow (SC included: MTELargeTurbineSCSteam
        // uses getOptimalSteamFlow like HP); the XL is x16.
        run = spec.xl
          ? xlSteamRun(fuelName, rotorFlow, efficiency, wanted)
          : largeSteamRun(fuelName, rotorFlow, overflowTier, efficiency, baseEfficiency, wanted);
      } else if (spec.turbineClass === "gas") {
        run = gasRun(
          spec.xl,
          fuelEu,
          rotorFlow,
          pickLadder(data.optimalTight, sizeIndex),
          efficiency,
          baseEfficiency,
          overflowTier,
          wanted,
        );
      } else {
        run = plasmaRun(
          spec.xl,
          fuelEu,
          rotorFlow,
          efficiency,
          pickLadder(data.euAtOptimalTight ?? [], sizeIndex),
          overflowTier,
          wanted,
        );
      }
      const { euPerTick, flow, maxFlow } = run;

      const lifespanSeconds = rotorLifespanSeconds(
        spec.xl,
        euPerTick,
        rotorDurability(rotor, sizeIndex),
        damagePerRoll(spec, fuelName, tight),
      );

      const flowPerSecond = spec.turbineClass === "plasma" ? flow : flow * 20;
      const inputs: PowerFlowLine[] = [liters(fuelName, flowPerSecond)];
      const outputs: PowerFlowLine[] = [];
      if (flow > 0 && spec.turbineClass === "steam") {
        const exhaust = STEAM_EXHAUST[fuelName];
        if (exhaust) {
          // HP and SC return one litre of the next grade down per litre taken
          // (dense litres for dense steam, even past the cap).
          outputs.push(liters(exhaust, flowPerSecond));
        } else {
          // Plain steam condenses: MTELargeTurbineSteam returns distilled
          // water at 1 L per 160 L of steam. The XL's dense-steam path uses
          // its own 160.1 divisor on the steam-equivalent litres it used -
          // the game's constant, not a typo.
          const steamEquivalent = dense ? (run.steamPerTick ?? 0) * 20 : flowPerSecond;
          outputs.push(liters("Distilled Water", steamEquivalent / (dense ? 160.1 : 160)));
        }
      } else if (flow > 0 && spec.turbineClass === "plasma") {
        const exhaust = plasmaExhaust(fuelName);
        if (exhaust) {
          outputs.push(liters(exhaust, flowPerSecond));
        }
      }

      const warnings: string[] = [];
      if (run.warning) {
        warnings.push(run.warning);
      } else if (wanted !== undefined && wanted > maxFlow) {
        warnings.push(
          `Flow is capped at ${formatAmount(maxFlow)}; the turbine will not take more.`,
        );
      }

      return {
        euPerTick,
        inputs,
        outputs,
        stats: [
          stat("Efficiency", percent(run.efficiency)),
          stat(
            "Optimal flow",
            `${formatAmount(run.optimal)} ${spec.turbineClass === "plasma" ? "L/s" : "L/t"}`,
          ),
          stat("Rotor lifespan", lifespanHours(lifespanSeconds)),
        ],
        warnings: warnings.length ? warnings : undefined,
      };
    },
  };
}

export const turbineSources: PowerSourceDefinition[] = SPECS.map(buildTurbine);
