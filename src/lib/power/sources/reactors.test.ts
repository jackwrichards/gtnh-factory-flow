import { describe, expect, it } from "vitest";
import { getPowerSource } from "../registry";
import { buildPowerSettingsReader, type PowerModel } from "../types";
import { htgrOperation } from "./reactors";

/**
 * Reactor and endgame cards where the pack's Java (GT5U 5.09.54.20) and the
 * workbook disagree; each expectation names the class it follows.
 */
function compute(sourceId: string, settings: Record<string, string> = {}): PowerModel {
  const source = getPowerSource(sourceId);
  if (!source) {
    throw new Error(`No power source ${sourceId}`);
  }
  return source.compute(buildPowerSettingsReader(source, settings));
}

const flow = (lines: PowerModel["inputs"], name: string) => lines.find((line) => line.name === name)?.perSecond;

describe("Eye of Harmony", () => {
  it("spreads a craft's net EU over its duration in seconds", () => {
    // EyeOfHarmonyRecipeStorage.timeCalculator: T0 runs 18,000 s. The
    // workbook's own net power cell (14. EOH Q10) is -64,360,304,863 EU/t.
    const model = compute("eye-of-harmony", { star: "T0 Overworld" });
    expect(model.euPerTick / -64_360_304_863).toBeCloseTo(1, 5);
    expect(model.stats.find((line) => line.label === "Cycle")?.value).toBe("5h");
  });

  it("consumes 1e9 x (tier + 1) L of hydrogen and helium a craft", () => {
    const overworld = compute("eye-of-harmony", { star: "T0 Overworld" });
    expect(flow(overworld.inputs, "Hydrogen")).toBeCloseTo(1e9 / 18_000, 6);
    expect(flow(overworld.inputs, "Helium")).toBeCloseTo(1e9 / 18_000, 6);
    // The Deep Dark runs at rocket tier 9: 1e10 L over 371,898 s.
    const deepDark = compute("eye-of-harmony", { star: "T10 Deep Dark" });
    expect(flow(deepDark.inputs, "Hydrogen")).toBeCloseTo(1e10 / 371_898, 6);
  });
});

describe("LFTR", () => {
  it("leaves TB Salt from LFTR Fuel 2", () => {
    // RecipeLoaderLFTR: LiFBeF2ZrF4UF4 -> 50 L U Salt, 100 L LiFBeF2ThF4 (TB Salt).
    const model = compute("lftr", { fuel: "LFTR Fuel 2" });
    expect(flow(model.outputs, "TB-Salt")).toBe(1);
    expect(flow(model.outputs, "T-Salt")).toBeUndefined();
    expect(flow(model.outputs, "U-Salt")).toBe(0.5);
  });
});

describe("Large Naquadah Reactor", () => {
  it("draws liquid air, coolant and booster ceil(d/20) times a recipe", () => {
    // MTELargeNaquadahReactor draws when progress % 20 == 0: Mk-II's
    // 70-tick recipe draws 4 times in 3.5 s.
    const mk2 = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-II",
      coolant: "Cryotheum",
      booster: "Molten Caesium",
    });
    expect(flow(mk2.inputs, "Liquid Air")).toBeCloseTo((2400 * 4) / 3.5, 9);
    expect(flow(mk2.inputs, "Cryotheum")).toBeCloseTo((1000 * 4) / 3.5, 9);
    expect(flow(mk2.inputs, "Molten Caesium")).toBeCloseTo((180 * 4) / 3.5, 9);
    // The fuel is still 1 L per boost level per recipe.
    expect(flow(mk2.inputs, "Naq Fuel Mk-II")).toBeCloseTo(2 / 3.5, 9);
    // Plutonium: 150 ticks, 8 draws in 7.5 s.
    const plutonium = compute("large-naquadah-reactor", { fuel: "Plutonium Fuel (Excited)" });
    expect(flow(plutonium.inputs, "Liquid Air")).toBeCloseTo(2560, 9);
    // Whole-second recipes draw once a second.
    const mk1 = compute("large-naquadah-reactor", { fuel: "Naq Fuel Mk-I" });
    expect(flow(mk1.inputs, "Liquid Air")).toBe(2400);
  });
});

describe("Antimatter", () => {
  it("feeds the growth with Protomatter and burns it with the UMV catalyst", () => {
    // AntimatterForge depletes Protomatter equal to the antimatter it adds;
    // the workbook's gain at 657,600 L is 396.11 L/s (13. Antimatter K6).
    const model = compute("antimatter", { amount: "657600" });
    expect(flow(model.inputs, "Protomatter")).toBeCloseTo(396.1129138, 5);
    expect(flow(model.inputs, "Molten Superconductor Base UMV")).toBeCloseTo(396.1129138, 5);
  });
});

describe("HTGR", () => {
  it("will not run below 100 balls", () => {
    // MTEHighTempGasCooledReactor.MIN_CAPACITY is 1% of 10,000.
    const fill = getPowerSource("htgr")?.settings.find((setting) => setting.id === "fill");
    expect(fill?.type === "number" && fill.min).toBe(100);
  });

  it("adds no speedup for a draw that truncates to 0 L/t", () => {
    // Tungsten at 150 balls draws 3 L/t of coolant and 0 of water, so only
    // the coolant speedup (16 a tick) runs: ceil(4,586 / 17) = 270 ticks.
    const run = htgrOperation({ base: 0.05, mult: 0.8, exp: 0.5 }, 150);
    expect(run.coolantPerTick).toBe(3);
    expect(run.waterPerTick).toBe(0);
    expect(run.cycleTicks).toBe(270);
    // A full glowstone reactor keeps both speedups: 202 ticks.
    expect(htgrOperation({ base: 2, mult: 1.2, exp: 1.1 }, 10_000).cycleTicks).toBe(202);
  });
});

describe("unlock chips", () => {
  it.each([
    // THTR and HTGR are crafted with circuitUltimate (ZPM) circuits.
    ["thtr", "ZPM"],
    ["htgr", "ZPM"],
    // The LFTR is crafted around an IV Machine Hull.
    ["lftr", "IV"],
    // bartworks assembles the DEHP at RECIPE_IV.
    ["dehp", "IV"],
    // goodgenerator's assembly line recipe runs at RECIPE_UV.
    ["large-naquadah-reactor", "UV"],
    // The Antimatter Forge's assembly line recipe runs at RECIPE_UMV.
    ["antimatter", "UMV"],
  ])("puts %s at %s, the tier of its controller recipe", (id, tier) => {
    expect(getPowerSource(id)?.unlock).toBe(tier);
  });
});
