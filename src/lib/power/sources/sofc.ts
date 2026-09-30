/**
 * Solid-Oxide Fuel Cells (GT++): direct EU plus a steam byproduct worth
 * about as much again once turbined. Mk II only rewards fuels over
 * 1,000 EU/L (its efficiency is fuelEU/1000, floored at 1).
 */
import { findFuel, fuelOptions, powerPlannerData } from "../planner-data";
import type { PowerModel, PowerSourceDefinition } from "../types";
import { formatAmount, liters, percent, stat } from "./helpers";

interface SofcSpec {
  id: string;
  name: string;
  unlock: string;
  output: number;
  oxygenPerSecond: number;
  steamPerSecond: number;
  steamGrade: "Steam" | "SH Steam";
  scalesWithFuel: boolean;
}

const SPECS: SofcSpec[] = [
  {
    id: "solid-oxide-fuel-cell-1",
    name: "Solid-Oxide Fuel Cell Mk I",
    // Kekztech Crafting: HV hull, HV pumps, HV circuits.
    unlock: "HV",
    output: 2048,
    oxygenPerSecond: 100,
    steamPerSecond: 20_000,
    steamGrade: "Steam",
    scalesWithFuel: false,
  },
  {
    id: "solid-oxide-fuel-cell-2",
    name: "Solid-Oxide Fuel Cell Mk II",
    // Kekztech Crafting: IV hull and pumps, LuV circuits.
    unlock: "LuV",
    output: 24_576,
    oxygenPerSecond: 2000,
    steamPerSecond: 96_000,
    steamGrade: "SH Steam",
    scalesWithFuel: true,
  },
];

export const sofcSources: PowerSourceDefinition[] = SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  group: "engines",
  unlock: spec.unlock,
  blurb: `${formatAmount(spec.output)} EU/t plus ${formatAmount(spec.steamPerSecond)} L/s steam.`,
  settings: [
    {
      type: "select",
      id: "fuel",
      label: "Fuel",
      options: fuelOptions(powerPlannerData.gasFuels),
      defaultKey: "Benzene",
    },
  ],
  compute(read): PowerModel {
    const fuel = findFuel(powerPlannerData.gasFuels, read.select("fuel"));
    const euPerLiter = fuel.euPerLiter ?? 0;
    const efficiency = spec.scalesWithFuel && euPerLiter > 1000 ? euPerLiter / 1000 : 1;
    const fuelPerSecond =
      euPerLiter > 0 ? Math.floor((20 * spec.output) / (efficiency * euPerLiter)) : 0;
    return {
      euPerTick: spec.output,
      inputs: [liters(fuel.name, fuelPerSecond), liters("Oxygen", spec.oxygenPerSecond)],
      outputs: [liters(spec.steamGrade, spec.steamPerSecond)],
      stats: [stat("Efficiency", percent(efficiency))],
    };
  },
}));
