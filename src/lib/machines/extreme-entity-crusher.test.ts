import { describe, expect, it } from "vitest";
import {
  EEC_CONTROLS,
  EEC_INFERNAL,
  EEC_LOOTING,
  EEC_MACHINE_TYPE,
  EEC_MODE,
  EEC_VOID,
  EEC_WEAPON_DAMAGE,
  type EecMetadata,
  eecExpectedItems,
  eecKillTicks,
  eecOverclock,
  getEecOutputMultiplier,
  getEecSettings,
  getEecStats,
} from "./extreme-entity-crusher";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { getMachineOutputMultiplier } from "@/lib/solver/machine-effects";
import { getAdjacentMachineConfigTier, getRecipeMachineConfigTierControls } from "@/lib/model/recipe-rules";
import type { Recipe } from "@/lib/model/types";

// Transcribed from kubatech MTEExtremeEntityCrusher / MobHandlerLoader and
// KubaTechGTMultiBlockBase.calculateOverclock at GT5U 5.09.54.20.

function zombie(overrides: Partial<EecMetadata> = {}): Recipe {
  const eec: EecMetadata = {
    mob: "Zombie",
    maxHealth: 20,
    baseEut: 1920,
    spawnInterval: 55,
    spikesDamage: 9,
    maxLooting: 4,
    outputs: [
      { drops: [{ amount: 1, c0: 10000, lootable: true }] },
      { drops: [{ amount: 1, c0: 83 }] },
      { drops: [{ amount: 1, c0: 3, voidable: true }, { amount: 1, c0: 10, voidable: true }] },
      { refLooting: 1, drops: [{ amount: 1, c0: 0, cL: 500 }] },
      { xp: true },
    ],
    ...overrides,
  };
  return {
    id: "eec:zombie",
    name: "Extreme Entity Crusher: Zombie",
    kind: "gregtech_machine",
    machineType: EEC_MACHINE_TYPE,
    minimumTier: "EV",
    durationTicks: 55,
    eut: eec.alwaysInfernal ? 15360 : 1920,
    inputs: [{ kind: "item", id: "factoryflow:eec_mob:zombie", amount: 1, consumed: false }],
    outputs: [
      { kind: "item", id: "minecraft:rotten_flesh", amount: 1 },
      { kind: "item", id: "minecraft:iron_ingot", amount: 1, chance: 0.0083 },
      { kind: "item", id: "minecraft:iron_sword", amount: 0.0013 },
      { kind: "item", id: "ForbiddenMagic:NetherShard@5", amount: 0.05 },
      { kind: "fluid", id: "xpjuice", amount: 120 },
    ],
    metadata: { eec },
  } as Recipe;
}

const meta = (recipe: Recipe) => recipe.metadata!.eec as EecMetadata;

describe("Extreme Entity Crusher", () => {
  it("kills in max(55, health / (9 + weapon) x 10) ticks", () => {
    expect(eecKillTicks(meta(zombie()), 0)).toBe(55);
    expect(eecKillTicks({ ...meta(zombie()), maxHealth: 500 }, 0)).toBe(555);
    expect(eecKillTicks({ ...meta(zombie()), maxHealth: 500 }, 11)).toBe(250);
    // Truncated like the game's int cast: 300 / 13.25 x 10 = 226.4.
    expect(eecKillTicks({ ...meta(zombie()), maxHealth: 300 }, 4.25)).toBe(226);
  });

  it("overclocks perfectly to a 20-tick floor, then multiplies the kill", () => {
    // One EV hatch reads 2 A, 4096 EU/t: under 4x the draw, no step.
    expect(eecOverclock(1920, 55, 4096)).toEqual({ ticks: 55, eut: 1920, kills: 1, steps: 0 });
    // One step: 55 >> 2 = 13, held at 20. Four times the power for 2.75x the speed.
    expect(eecOverclock(1920, 55, 8192)).toEqual({ ticks: 20, eut: 7680, kills: 1, steps: 1 });
    // A second step has no duration left to cut, so the kill yields 4x.
    expect(eecOverclock(1920, 55, 32768)).toEqual({ ticks: 20, eut: 30720, kills: 4, steps: 2 });
    // 100 ticks: log4ceil(100 / 20 = 5) = 2 duration steps before the floor.
    expect(eecOverclock(1920, 100, 32768)).toEqual({ ticks: 20, eut: 30720, kills: 1, steps: 2 });
    expect(eecOverclock(1920, 100, 8192)).toEqual({ ticks: 25, eut: 7680, kills: 1, steps: 1 });
  });

  it("hands the solver a per-kill duration with the multiplier folded in", () => {
    const stats = getEecStats(meta(zombie()), getEecSettings({ [EEC_INFERNAL]: "off" }), 32768);
    expect(stats).toEqual({ durationTicks: 5, eut: 30720, steps: 2 });
  });

  it("averages infernal kills in once the hatches carry 8 x 1920 EU/t", () => {
    const settings = getEecSettings({});
    // Below 15360 EU/t no kill can be infernal.
    expect(getEecStats(meta(zombie()), settings, 8192)).toEqual({ durationTicks: 20, eut: 7680, steps: 1 });
    // At 15360: an ordinary kill takes one step (20 ticks at 7680); an elite
    // infernal runs 15360 EU/t with no step for (int)(55 x (2 x 1.8f)) ticks,
    // in FLOAT arithmetic: 197.999995 rounds to 198.0f before the cast.
    // Ultra has 5 modifiers, inferno 8.
    const p = 1 / 20;
    const kinds = [
      { p: 1 - p, ticks: 20, eut: 7680 },
      { p: p * 0.9, ticks: 198, eut: 15360 },
      { p: p * 0.1 * (6 / 7), ticks: Math.trunc(Math.fround(55 * Math.fround(5 * Math.fround(1.8)))), eut: 15360 },
      { p: p * 0.1 * (1 / 7), ticks: Math.trunc(Math.fround(55 * Math.fround(8 * Math.fround(1.8)))), eut: 15360 },
    ];
    const ticks = kinds.reduce((sum, kind) => sum + kind.p * kind.ticks, 0);
    const energy = kinds.reduce((sum, kind) => sum + kind.p * kind.ticks * kind.eut, 0);
    const stats = getEecStats(meta(zombie()), settings, 15360);
    expect(stats.durationTicks).toBeCloseTo(ticks, 9);
    expect(stats.eut).toBeCloseTo(energy / ticks, 6);
    // The screwdriver switch turns them off.
    expect(getEecStats(meta(zombie()), getEecSettings({ [EEC_INFERNAL]: "off" }), 15360).durationTicks).toBe(20);
    // An always-infernal mob ignores the switch: every kill is at least elite.
    const blaze = meta(zombie({ alwaysInfernal: true }));
    const always = getEecStats(blaze, getEecSettings({ [EEC_INFERNAL]: "off" }), 15360);
    expect(always.durationTicks).toBeGreaterThan(197);
  });

  it("runs the ritual at 400 ticks and a quarter of the power, with no overclock", () => {
    const stats = getEecStats(meta(zombie()), getEecSettings({ [EEC_MODE]: "ritual", [EEC_INFERNAL]: "off" }), 32768);
    expect(stats).toEqual({ durationTicks: 400, eut: 480, steps: 0 });
  });

  it("adds Looting the way generateOutputs does", () => {
    // +5000 per level; past 10000 the chance splits into whole extra items.
    expect(eecExpectedItems(1, 10000, true, 1)).toBe(1.5);
    expect(eecExpectedItems(1, 10000, true, 3)).toBeCloseTo(3 * 0.8333, 9);
    expect(eecExpectedItems(1, 5000, true, 1)).toBe(1);
    expect(eecExpectedItems(1, 83, false, 4)).toBeCloseTo(0.0083, 9);
    const recipe = zombie();
    const looting = (level: number, extra: Record<string, string> = {}) =>
      recipe.outputs.map((output) =>
        getEecOutputMultiplier(recipe, output, getEecSettings({ [EEC_LOOTING]: String(level), ...extra })),
      );
    expect(looting(0)).toEqual([1, 1, 1, 0, 1]);
    // Greed shards only drop with a Looting weapon at all.
    expect(looting(1)).toEqual([1.5, 1, 1, 1, 1]);
    // Looting is capped at 4; the ritual never swings a weapon.
    expect(looting(9)[0]).toBe(looting(4)[0]);
    expect(looting(3, { [EEC_MODE]: "ritual" })).toEqual([1, 1, 1, 0, 5000 / 120]);
    // The void switch throws the damaged and enchanted gear away.
    expect(looting(0, { [EEC_VOID]: "void" })[2]).toBe(0);
  });

  it("routes a card through its own machine math", () => {
    const recipe = zombie();
    const node = {
      overclockTier: "IV" as const,
      hatchVoltageTier: "IV" as const,
      hatchAmps: 4,
      machineConfigTiers: { [EEC_INFERNAL]: "off", [EEC_LOOTING]: "2" },
    };
    const stats = getOverclockedRecipeStats(recipe, node);
    expect(stats.durationTicks).toBe(5);
    expect(stats.eut).toBe(30720);
    expect(getMachineOutputMultiplier(recipe, node, recipe.outputs[0], stats.tier)).toBe(2);
  });

  it("offers the GUI's knobs, weapon damage in Sharpness quarters", () => {
    const controls = getRecipeMachineConfigTierControls(zombie(), {
      machineConfigTiers: { [EEC_WEAPON_DAMAGE]: "13.3" },
    });
    expect(controls.map((control) => control.id)).toEqual(EEC_CONTROLS.map((control) => control.id));
    const weapon = controls.find((control) => control.id === EEC_WEAPON_DAMAGE)!;
    expect(weapon.current.key).toBe("13.25");
    expect(getAdjacentMachineConfigTier(weapon, 1)).toBe("13.5");
    expect(getAdjacentMachineConfigTier({ ...weapon, current: { ...weapon.current, key: "0" } }, -1)).toBe("0");
  });
});
