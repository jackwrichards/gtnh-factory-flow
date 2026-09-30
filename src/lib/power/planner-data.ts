/**
 * Typed access to the tables extracted from the Power Planner workbook
 * (tools/power-planner-extract.mjs -> data/power-planner-data.json) and the
 * fuel-name -> dataset-resource map (tools/power-resource-map.mjs).
 */
import rawData from "./data/power-planner-data.json";
import rawResourceMap from "./data/resource-map.json";
import rawMachineIcons from "./data/machine-icons.json";

export interface PowerFuelEntry {
  name: string;
  euPerLiter?: number;
  euPerItem?: number;
  burnTime?: number;
  eheMaxLps?: number;
  promoterCoefficient?: number;
}

export interface RotorClassData {
  efficiencyTight: Array<number | null>;
  efficiencyLoose: Array<number | null>;
  optimalTight: Array<number | null>;
  optimalLoose: Array<number | null>;
  euAtOptimalTight?: Array<number | null>;
}

export interface RotorEntry {
  name: string;
  unlock: string;
  durability: number;
  overflowTier: number;
  steam: RotorClassData;
  gas: RotorClassData;
  plasma: RotorClassData;
}

export interface HeatExchangerFluidRule {
  threshold: number;
  max: number;
  throttle: number;
  underRatio: number;
  overRatio: number;
}

export interface FusionRecipeEntry {
  name: string;
  minMark: number;
  euPerLiter: number;
  startupEu: number;
  input1: string | null;
  ratio1: number | null;
  input2: string | null;
  ratio2: number | null;
  decayOutput: string | null;
  outputLpsByMark: Array<number | null>;
  drainEutByMark: Array<number | null>;
  compactOutputLpsByMark: Array<number | null>;
  compactDrainEutByMark: Array<number | null>;
}

export const powerPlannerData = rawData as unknown as {
  steamGrades: PowerFuelEntry[];
  gasFuels: PowerFuelEntry[];
  gasFuelsXl: PowerFuelEntry[];
  plasmas: PowerFuelEntry[];
  combustionFuels: PowerFuelEntry[];
  eceFuels: PowerFuelEntry[];
  semifluidFuels: PowerFuelEntry[];
  ucfeFuels: PowerFuelEntry[];
  chemFuels: PowerFuelEntry[];
  frostFuels: PowerFuelEntry[];
  lneBases: Array<{ name: string; multiplier: number; boostTicks: number }>;
  lneStructureTiers: Array<{ name: string; residueCapacity: number; baseDecay: number }>;
  lneRobotArms: Array<{ name: string; tier: number }>;
  magicSolids: PowerFuelEntry[];
  naquadahRods: PowerFuelEntry[];
  rocketFuels: PowerFuelEntry[];
  lnrFuels: Array<{ name: string; euPerTick: number; secondsPerCell: number }>;
  lnrCoolants: Array<{ name: string; efficiency: number; litersPerSecond: number }>;
  lnrBoosters: Array<{ name: string; multiplier: number; litersPerSecond: number }>;
  lftrFuels: Array<{
    name: string;
    euPerLiter: number;
    powerLabel: string;
    uSalt: number;
    tSalt: number;
    tbSalt: number;
    uf6: number;
    uranium233PerSecond: number;
  }>;
  htgrPebbles: Array<{ name: string; base: number; mult: number; exp: number }>;
  boilerFuels: Record<string, PowerFuelEntry[]>;
  heatExchangers: Array<{ name: string; fluids: Record<string, HeatExchangerFluidRule> }>;
  fusionRecipes: FusionRecipeEntry[];
  rotors: RotorEntry[];
  rotorSizes: Array<{ name: string; durabilityMult: number }>;
  singleblockTiers: Array<{ tier: string; voltage: number; ampLoss: number }>;
  singleblockEfficiency: Record<string, Array<number | null>>;
  eohStars: Array<{
    name: string;
    tier: number;
    durationSeconds: number;
    baseSuccess: number;
    efficiency: number;
    euInput: number;
    euOutput: number;
    starMatter: number;
  }>;
};

export interface PowerResourceRef {
  kind: "item" | "fluid";
  id: string;
  displayName: string;
  iconPath?: string;
  dominantColor?: string;
}

const resourceMap = (rawResourceMap as { resources: Record<string, PowerResourceRef> }).resources;

/** Dataset resource for a spreadsheet fuel name; undefined = show as a stat. */
export function resolvePowerResource(name: string): PowerResourceRef | undefined {
  return resourceMap[name];
}

export interface PowerMachineIcon {
  id: string;
  displayName: string;
  iconPath?: string;
  dominantColor?: string;
}

const machineIcons = (rawMachineIcons as { machines: Record<string, PowerMachineIcon> }).machines;

/** The in-game machine item this source is drawn as (tools/power-machine-icons.mjs). */
export function getPowerMachineIcon(sourceId: string): PowerMachineIcon | undefined {
  return machineIcons[sourceId];
}

export function findFuel(table: PowerFuelEntry[], name: string): PowerFuelEntry {
  return table.find((entry) => entry.name === name) ?? table[0];
}

export function fuelOptions(table: PowerFuelEntry[]): Array<{ key: string; label: string }> {
  return table.map((entry) => ({ key: entry.name, label: entry.name }));
}

export const ROTOR_SIZE_NAMES = ["Small", "Normal", "Large", "Huge"] as const;

export function findRotor(name: string): RotorEntry {
  return powerPlannerData.rotors.find((entry) => entry.name === name) ?? powerPlannerData.rotors[0];
}

export function rotorDurability(rotor: RotorEntry, sizeIndex: number): number {
  const mult = powerPlannerData.rotorSizes[sizeIndex]?.durabilityMult ?? 1;
  return rotor.durability * mult;
}
