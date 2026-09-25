/**
 * Large and XL Turbo turbines, all running the workbook's one formula:
 *
 *   EU/t = max(1, floor(eff x fuelEU x flow x (1 - |flow-opt| / (opt x penalty))))
 *
 * with per-class caps, over-optimal penalties and lifespans (see
 * docs/power-planner-math.md). Steam and gas flows are litres per TICK (the
 * game's own tooltip unit); plasma flows are litres per second.
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
        fuelName = spec.steamGrade === "select" ? read.select("grade") : (spec.steamGrade as string);
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

      let efficiency = pickLadder(tight ? data.efficiencyTight : data.efficiencyLoose, sizeIndex);
      const optLookup = pickLadder(tight ? data.optimalTight : data.optimalLoose, sizeIndex);
      const dense = fuelName.startsWith("Dense");

      // Optimal flow per class, in the class's native unit.
      let optimal: number;
      if (spec.turbineClass === "steam") {
        // SC steam runs the rotor's optimal x16; dense steam divides by 1000.
        const scFactor = fuelName.endsWith("SC Steam") ? 16 : 1;
        optimal = Math.max(1, optLookup * scFactor * (spec.xl ? 16 : 1) * (dense ? 1 / 1000 : 1));
        optimal = Math.floor(optimal);
      } else if (spec.turbineClass === "gas") {
        optimal = Math.floor(Math.max(1, (optLookup * (spec.xl ? 16 : 1)) / fuelEu));
      } else {
        optimal = Math.ceil(Math.max(1, ((optLookup * (spec.xl ? 16 : 1)) / fuelEu) * 20));
      }

      // The XL plasma turbine derates on weak plasmas.
      if (spec.xl && spec.turbineClass === "plasma") {
        const euAtOptimal = pickLadder(data.euAtOptimalTight ?? [], sizeIndex) || 1;
        efficiency *= Math.min(1, Math.pow(fuelEu * 0.005, 2) / euAtOptimal);
      }

      let maxFlow: number;
      let penaltyDiv: number;
      if (spec.xl) {
        maxFlow = Math.floor(optimal * 1.25);
        penaltyDiv = 1;
      } else if (spec.turbineClass === "steam") {
        if (fuelName === "SC Steam") {
          maxFlow = Math.floor(optimal * 1.25);
          penaltyDiv = 1;
        } else if (fuelName === "SH Steam") {
          maxFlow = Math.floor(optimal * (0.5 * overflowTier + 1.5));
          penaltyDiv = overflowTier + 2;
        } else {
          maxFlow = Math.floor(optimal * (0.5 * overflowTier + 1));
          penaltyDiv = overflowTier + 1;
        }
      } else if (spec.turbineClass === "gas") {
        maxFlow = Math.floor(optimal * (1.5 * overflowTier));
        penaltyDiv = 3 * overflowTier - 1;
      } else {
        maxFlow = Math.ceil(optimal * (1.5 * overflowTier + 1));
        penaltyDiv = 3 * overflowTier + 1;
      }

      const wanted = read.select("flowMode") === "custom" ? read.number("customFlow") : optimal;
      const flow = Math.min(wanted, maxFlow);
      const over = flow > optimal;
      const perTickEu = spec.turbineClass === "plasma" ? fuelEu / 20 : fuelEu;
      const euPerTick = Math.max(
        1,
        Math.floor(
          efficiency * perTickEu * flow * (1 - Math.abs(flow - optimal) / (optimal * (over ? penaltyDiv : 1))),
        ),
      );

      // Lifespan: damage rate min(EU/5, EU^0.6), XL divisors 25 and /5.
      const durability = rotorDurability(rotor, sizeIndex);
      let lifespanSeconds: number;
      if (spec.xl) {
        lifespanSeconds =
          Math.ceil((durability / Math.min(euPerTick / 25, Math.pow(euPerTick / 5, 0.6))) * 50) *
          (tight ? 1 : 1.25);
      } else {
        const base = Math.ceil((durability / Math.min(euPerTick / 5, Math.pow(euPerTick, 0.6))) * 50);
        const scFactor = fuelName === "SC Steam" ? (tight ? 0.5 : 2) : 1;
        const looseFactor = spec.turbineClass === "gas" ? 1 : tight ? 1 : 1.25;
        lifespanSeconds = (spec.turbineClass === "plasma" ? base : 2 * base) * looseFactor * scFactor;
      }

      const flowPerSecond = spec.turbineClass === "plasma" ? flow : flow * 20;
      const inputs: PowerFlowLine[] = [liters(fuelName, flowPerSecond)];
      const outputs: PowerFlowLine[] = [];
      if (spec.turbineClass === "steam") {
        const exhaust = STEAM_EXHAUST[fuelName];
        if (exhaust) {
          outputs.push(liters(exhaust, flowPerSecond));
        } else {
          // Plain steam condenses: MTELargeTurbineSteam returns distilled
          // water at 1 L per 160 L of steam. The XL's dense-steam path uses
          // its own 160.1 divisor on the steam-equivalent litres - the
          // game's constant, not a typo.
          const steamEquivalent = dense ? flowPerSecond * 1000 : flowPerSecond;
          outputs.push(liters("Distilled Water", steamEquivalent / (dense ? 160.1 : 160)));
        }
      } else if (spec.turbineClass === "plasma") {
        const exhaust = plasmaExhaust(fuelName);
        if (exhaust) {
          outputs.push(liters(exhaust, flowPerSecond));
        }
      }

      return {
        euPerTick,
        inputs,
        outputs,
        stats: [
          stat("Efficiency", percent(efficiency)),
          stat(
            "Optimal flow",
            `${formatAmount(optimal)} ${spec.turbineClass === "plasma" ? "L/s" : "L/t"}`,
          ),
          stat("Rotor lifespan", lifespanHours(lifespanSeconds)),
        ],
        warnings:
          wanted > maxFlow
            ? [`Flow is capped at ${formatAmount(maxFlow)}; the turbine will not take more.`]
            : undefined,
      };
    },
  };
}

export const turbineSources: PowerSourceDefinition[] = SPECS.map(buildTurbine);
