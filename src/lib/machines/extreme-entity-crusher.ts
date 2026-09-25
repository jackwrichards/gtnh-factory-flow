import type { MachineConfigControl, Recipe, RecipeOutput } from "@/lib/model/types";

/**
 * The Extreme Entity Crusher (kubatech MTEExtremeEntityCrusher and
 * MobHandlerLoader.MobEECRecipe, GT5U 5.09.54.20). One recipe per mob a
 * Powered Spawner can hold; the dataset's `metadata.eec` carries what this
 * file replays.
 *
 * A kill takes max(55, (int)(health / (9 + weapon damage) * 10)) ticks at
 * 1920 EU/t (eight times that for a mob that is always infernal). The
 * overclock is kubatech's own calculateOverclock: perfect, every tier the
 * hatches afford, the duration shifted right in whole ticks but never under
 * 20, and each step past that floor multiplying the kill's drops and XP by 4
 * instead ("infinite" overclocking). The durations this file hands the solver
 * are PER KILL, with that multiplier folded in.
 *
 * Infernal spawns (on unless the screwdriver turned them off, forced for the
 * always-infernal mobs) need 8 x 1920 EU/t of input: one kill in
 * `eliteRarity` then runs at 8x EU for `mods x health factor` times as long.
 * Their random enchanted gear drop is not listed. In ritual mode (linked to
 * a Well of Suffering) a kill takes a flat 400 ticks at a quarter of the
 * power, with no overclock and 5000 L of XP.
 */
export const EEC_MACHINE_TYPE = "Extreme Entity Crusher";

export const EEC_WEAPON_DAMAGE = "eecWeaponDamage";
export const EEC_LOOTING = "eecLooting";
export const EEC_INFERNAL = "eecInfernal";
export const EEC_MODE = "eecMode";
export const EEC_VOID = "eecVoid";

/** The machine's own constants, used when an old dataset does not carry them. */
const SPAWN_INTERVAL = 55;
const SPIKES_DAMAGE = 9;
const MAX_LOOTING = 4;
const MIN_TICKS = 20;
const XP_PER_KILL = 120;
const XP_PER_RITUAL = 5000;
const RITUAL_TICKS = 400;
const INFERNAL_DEFAULTS = {
  eliteRarity: 20,
  ultraRarity: 10,
  infernoRarity: 7,
  minEliteModifiers: 2,
  minUltraModifiers: 5,
  minInfernoModifiers: 8,
  mobModHealthFactor: 1.8,
};

export interface EecDrop {
  amount: number;
  /** Chance out of 10,000 with no Looting weapon, after the mob's modifiers. */
  c0: number;
  /** The same with a Looting weapon, when a modifier reads it (greed shards). */
  cL?: number;
  lootable?: boolean;
  /** Damaged or randomly enchanted: what the void switch throws away. */
  voidable?: boolean;
}

export interface EecOutputMeta {
  xp?: boolean;
  /** The Looting level the output's static amount was written at. */
  refLooting?: number;
  drops?: EecDrop[];
}

export interface EecMetadata {
  mob: string;
  maxHealth: number;
  baseEut: number;
  alwaysInfernal?: boolean;
  infernalityAllowed?: boolean;
  spawnInterval?: number;
  spikesDamage?: number;
  maxLooting?: number;
  infernal?: Partial<typeof INFERNAL_DEFAULTS>;
  outputs: EecOutputMeta[];
}

type EecRecipe = Partial<Pick<Recipe, "machineType" | "metadata">>;

export function getEecMetadata(recipe: EecRecipe): EecMetadata | undefined {
  if (recipe.machineType !== EEC_MACHINE_TYPE) return undefined;
  const eec = recipe.metadata?.eec as EecMetadata | undefined;
  if (!eec || typeof eec !== "object" || !Array.isArray(eec.outputs)) return undefined;
  if (!(typeof eec.maxHealth === "number" && eec.maxHealth > 0)) return undefined;
  return eec;
}

export function isEecRecipe(recipe: EecRecipe): boolean {
  return getEecMetadata(recipe) !== undefined;
}

export interface EecSettings {
  weaponDamage: number;
  looting: number;
  infernal: boolean;
  ritual: boolean;
  voidDamaged: boolean;
}

export function getEecSettings(settings: Record<string, string> | undefined): EecSettings {
  const weapon = Number(settings?.[EEC_WEAPON_DAMAGE] ?? 0);
  const looting = Number(settings?.[EEC_LOOTING] ?? 0);
  return {
    weaponDamage: Number.isFinite(weapon) && weapon > 0 ? weapon : 0,
    looting: Number.isFinite(looting) ? Math.max(0, Math.trunc(looting)) : 0,
    infernal: settings?.[EEC_INFERNAL] !== "off",
    ritual: settings?.[EEC_MODE] === "ritual",
    voidDamaged: settings?.[EEC_VOID] === "void",
  };
}

function option(id: string, key: string, label: string, detail: string) {
  return {
    key,
    label,
    resource: {
      kind: "item" as const,
      id: `factoryflow:machine_config/${id}_${key}`,
      amount: 1,
      displayName: label,
      tooltip: [detail],
      consumed: false,
    },
  };
}

/** Knobs the EEC's GUI and screwdriver offer, in the machine table's control shape. */
export const EEC_CONTROLS: MachineConfigControl[] = [
  {
    id: EEC_WEAPON_DAMAGE,
    label: "Weapon damage",
    minimumKey: "0",
    defaultKey: "0",
    numeric: { min: 0, max: 10000, step: 0.25 },
    tiers: [
      option(
        EEC_WEAPON_DAMAGE,
        "0",
        "Weapon damage",
        "The weapon's attack damage, plus 1.25 per level of Sharpness. The spikes add 9 on their own.",
      ),
    ],
  },
  {
    id: EEC_LOOTING,
    label: "Looting",
    minimumKey: "0",
    defaultKey: "0",
    tiers: [0, 1, 2, 3, 4].map((level) =>
      option(EEC_LOOTING, String(level), String(level), "The weapon's Looting level, capped at 4."),
    ),
  },
  {
    id: EEC_INFERNAL,
    label: "Infernal spawns",
    minimumKey: "on",
    defaultKey: "on",
    tiers: [
      option(EEC_INFERNAL, "on", "On", "With 15360 EU/t of input, 1 kill in 20 is infernal: 8x power and a longer kill."),
      option(EEC_INFERNAL, "off", "Off", "Shift-screwdriver: no infernal spawns, except mobs that are always infernal."),
    ],
  },
  {
    id: EEC_MODE,
    label: "Kill method",
    minimumKey: "spikes",
    defaultKey: "spikes",
    tiers: [
      option(EEC_MODE, "spikes", "Spikes", "Diamond spikes, with the weapon and overclocks."),
      option(EEC_MODE, "ritual", "Ritual", "Linked to a Well of Suffering: 400 ticks a kill, a quarter of the power, no overclock, 5000 L of XP."),
    ],
  },
  {
    id: EEC_VOID,
    label: "Damaged gear",
    minimumKey: "keep",
    defaultKey: "keep",
    tiers: [
      option(EEC_VOID, "keep", "Keep", "Damaged and enchanted drops come out with the rest."),
      option(EEC_VOID, "void", "Void", "Damaged and enchanted drops are thrown away."),
    ],
  },
];

/** GTUtility.log4 on a long: whole powers of four, 0 for anything under 4. */
function floorLog4(value: number): number {
  let steps = 0;
  for (let power = 4; power <= value; power *= 4) steps += 1;
  return steps;
}

/** GTUtility.log4ceil on an int: 0 for anything up to 1. */
function ceilLog4(value: number): number {
  let steps = 0;
  for (let power = 1; power < value; power *= 4) steps += 1;
  return steps;
}

interface Cycle {
  ticks: number;
  eut: number;
  /** Kills' worth of drops the cycle yields (past-floor overclocks multiply them). */
  kills: number;
  steps: number;
}

/** KubaTechGTMultiBlockBase.calculateOverclock, perfect, with infinite overclocking. */
export function eecOverclock(eut: number, ticks: number, maxInputEu: number): Cycle {
  const tiers = eut > 0 && Number.isFinite(maxInputEu) ? floorLog4(Math.floor(maxInputEu / eut)) : 0;
  if (tiers <= 0) return { ticks, eut, kills: 1, steps: 0 };
  const durationTiers = Math.min(tiers, ceilLog4(Math.floor(ticks / MIN_TICKS)));
  return {
    ticks: Math.max(MIN_TICKS, Math.floor(ticks / 4 ** durationTiers)),
    eut: eut * 4 ** tiers,
    kills: 4 ** (tiers - durationTiers),
    steps: tiers,
  };
}

/** MobEECRecipe.getProgressTimeForAttackDamage. */
export function eecKillTicks(meta: EecMetadata, weaponDamage: number): number {
  const damage = (meta.spikesDamage ?? SPIKES_DAMAGE) + weaponDamage;
  return Math.max(meta.spawnInterval ?? SPAWN_INTERVAL, Math.trunc((meta.maxHealth / damage) * 10));
}

/** How likely each kind of kill is: plain, then elite, ultra and inferno infernals. */
function killKinds(meta: EecMetadata, settings: EecSettings, maxInputEu: number) {
  const infernal = { ...INFERNAL_DEFAULTS, ...meta.infernal };
  const possible = meta.infernalityAllowed !== false && meta.baseEut * 8 <= maxInputEu;
  const chance = meta.alwaysInfernal ? 1 : settings.infernal ? 1 / infernal.eliteRarity : 0;
  if (!possible || chance === 0) return [{ probability: 1, mods: 0 }];
  const ultra = 1 / infernal.ultraRarity;
  const inferno = 1 / infernal.infernoRarity;
  return [
    { probability: 1 - chance, mods: 0 },
    { probability: chance * (1 - ultra), mods: infernal.minEliteModifiers },
    { probability: chance * ultra * (1 - inferno), mods: infernal.minUltraModifiers },
    { probability: chance * ultra * inferno, mods: infernal.minInfernoModifiers },
  ].filter((kind) => kind.probability > 0);
}

export interface EecStats {
  /** Ticks per kill's worth of drops, averaged over the kinds of kill. */
  durationTicks: number;
  /** EU/t averaged over time. */
  eut: number;
  /** Overclock steps of the likeliest kind of kill. */
  steps: number;
}

export function getEecStats(meta: EecMetadata, settings: EecSettings, maxInputEu: number): EecStats {
  const baseTicks = eecKillTicks(meta, settings.ritual ? 0 : settings.weaponDamage);
  const factor = Math.fround(meta.infernal?.mobModHealthFactor ?? INFERNAL_DEFAULTS.mobModHealthFactor);
  let ticks = 0;
  let energy = 0;
  let kills = 0;
  let steps = 0;
  let likeliest = 0;
  for (const kind of killKinds(meta, settings, maxInputEu)) {
    const eut = kind.mods > 0 ? meta.baseEut * 8 : meta.baseEut;
    // `mMaxProgresstime *= mods * factor`: int times float, float arithmetic.
    const killTicks = kind.mods > 0
      ? Math.trunc(Math.fround(baseTicks * Math.fround(kind.mods * factor)))
      : baseTicks;
    const cycle = settings.ritual
      ? { ticks: RITUAL_TICKS, eut: Math.floor(eut / 4), kills: 1, steps: 0 }
      : eecOverclock(eut, killTicks, maxInputEu);
    if (kind.probability > likeliest) {
      likeliest = kind.probability;
      steps = cycle.steps;
    }
    ticks += kind.probability * cycle.ticks;
    energy += kind.probability * cycle.ticks * cycle.eut;
    kills += kind.probability * cycle.kills;
  }
  return {
    durationTicks: kills > 0 ? ticks / kills : baseTicks,
    eut: ticks > 0 ? energy / ticks : meta.baseEut,
    steps,
  };
}

/** Expected items from one roll of a drop (MobEECRecipe.generateOutputs). */
export function eecExpectedItems(amount: number, chance: number, lootable: boolean, looting: number): number {
  if (!(chance > 0) || !(amount > 0)) return 0;
  let rolled = chance;
  let items = amount;
  if (lootable && looting > 0) {
    rolled += looting * 5000;
    if (rolled > 10000) {
      const div = Math.ceil(rolled / 10000);
      items *= div;
      rolled = Math.trunc(rolled / div);
    }
  }
  return items * (rolled >= 10000 ? 1 : rolled / 10000);
}

function expectedAt(drops: EecDrop[], looting: number, voidDamaged: boolean): number {
  let sum = 0;
  for (const drop of drops) {
    if (voidDamaged && drop.voidable) continue;
    const chance = looting > 0 ? (drop.cL ?? drop.c0) : drop.c0;
    sum += eecExpectedItems(drop.amount, chance, drop.lootable === true, looting);
  }
  return sum;
}

/**
 * How far this output's rate moves from what the dataset wrote: Looting, the
 * void switch, and the ritual's XP. The per-kill overclock multiplier is
 * already in the duration.
 */
export function getEecOutputMultiplier(
  recipe: Partial<Pick<Recipe, "outputs">> & EecRecipe,
  output: RecipeOutput,
  settings: EecSettings,
): number {
  const meta = getEecMetadata(recipe);
  if (!meta) return 1;
  const outputs = recipe.outputs ?? [];
  let index = outputs.indexOf(output);
  if (index < 0) index = outputs.findIndex((entry) => entry.kind === output.kind && entry.id === output.id);
  const entry = meta.outputs[index];
  if (!entry) return 1;
  if (entry.xp) return settings.ritual ? XP_PER_RITUAL / XP_PER_KILL : 1;
  const drops = entry.drops ?? [];
  const reference = expectedAt(drops, entry.refLooting ?? 0, false);
  if (!(reference > 0)) return 0;
  const looting = settings.ritual ? 0 : Math.min(settings.looting, meta.maxLooting ?? MAX_LOOTING);
  return expectedAt(drops, looting, settings.voidDamaged) / reference;
}
