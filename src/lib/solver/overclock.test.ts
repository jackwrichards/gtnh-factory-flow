import { describe, expect, it } from "vitest";
import { getOverclockedRecipeStats } from "./overclock";
import { getMachineParallelMultiplier } from "./machine-effects";
import type { MachineConfigControl } from "@/lib/model/types";

const TICKS_PER_SECOND = 20;

/** Coil blocks that only carry a heat capacity: the blast furnace family. */
function heatCoilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    tiers: [
      { key: "cupronickel", label: "Cupronickel", heat: 1801, resource: coilResource() },
      { key: "naquadah", label: "Naquadah", heat: 7201, resource: coilResource() },
    ],
  };
}

/** Coil blocks that buy speed and carry a heat capacity only incidentally. */
function speedCoilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    defaultKey: "kanthal",
    tiers: [
      {
        key: "cupronickel",
        label: "Cupronickel",
        heat: 1801,
        durationMultiplier: 2,
        resource: coilResource(),
      },
      {
        key: "kanthal",
        label: "Kanthal",
        heat: 2701,
        durationMultiplier: 1,
        resource: coilResource(),
      },
      {
        key: "nichrome",
        label: "Nichrome",
        heat: 3601,
        durationMultiplier: 2 / 3,
        resource: coilResource(),
      },
      {
        key: "tpv",
        label: "TPV-Alloy",
        heat: 4501,
        durationMultiplier: 0.5,
        resource: coilResource(),
      },
    ],
  };
}

function pipeCasingControl(): MachineConfigControl {
  return {
    id: "pipeCasing",
    label: "Pipe Casing",
    minimumKey: "bronze",
    tiers: [
      { key: "bronze", label: "Bronze", parallelMultiplier: 2, resource: coilResource() },
      { key: "steel", label: "Steel", parallelMultiplier: 4, resource: coilResource() },
      { key: "titanium", label: "Titanium", parallelMultiplier: 6, resource: coilResource() },
    ],
  };
}

function coilResource() {
  return { kind: "item" as const, id: "gregtech:gt.blockcasings5", amount: 1, consumed: false };
}

/**
 * Nitrobenzene in the ExxonMobil Chemical Plant, exactly as the dataset carries
 * it: 5000 L out of 5000 L benzene every 600 ticks at 480 EU/t, gated to HV by
 * titanium machine casings. "Special value: 4" is that casing tier, not heat.
 */
const NITROBENZENE = {
  machineType: "Chemical Plant",
  minimumTier: "HV",
  durationTicks: 600,
  eut: 480,
  nei: { additionalInfo: ["Special value: 4"] },
  machineConfigControls: [pipeCasingControl(), speedCoilControl()],
};

describe("GT overclocking", () => {
  it("treats MAX as a filter/display tier instead of an extra overclock voltage", () => {
    const stats = getOverclockedRecipeStats(
      {
        minimumTier: "MV",
        durationTicks: 80,
        eut: 120,
        machineType: "Alloy Blast Smelter",
      },
      {
        overclockTier: "MAX",
      },
    );

    expect(stats.tier).toBe("UXV");
    expect(stats.overclockSteps).toBe(11);
    expect(stats.eut).toBe(120 * 4 ** 11);
  });

  it("spends the voltage budget on parallels before overclocks", () => {
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };
    const stats = getOverclockedRecipeStats(NITROBENZENE, node);
    const parallels = getMachineParallelMultiplier(NITROBENZENE, node);

    // Six parallels of a 480 EU/t recipe already draw 2880 EU/t, which fills an
    // IV hatch. No headroom is left, so the recipe never overclocks.
    expect(parallels).toBe(6);
    expect(stats.overclockSteps).toBe(0);
    expect(stats.eut).toBe(480);
    // TPV-Alloy coils run the chem plant at 200% speed: 600 ticks becomes 300.
    expect(stats.durationTicks).toBe(300);

    const nitrobenzenePerSecond = (5000 * parallels * TICKS_PER_SECOND) / stats.durationTicks;
    expect(nitrobenzenePerSecond).toBe(2000);
  });

  it("buys an overclock once the hatch can carry the parallels and the step", () => {
    const stats = getOverclockedRecipeStats(NITROBENZENE, {
      overclockTier: "LuV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    });

    // 2880 EU/t of parallels leaves room for one 4x step inside LuV's 32768.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(150);
    expect(stats.eut).toBe(480 * 4);
  });

  it("limits parallels to what the energy hatch can actually pay for", () => {
    const node = {
      overclockTier: "HV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // An HV hatch carries 512 EU/t, so it can only power one 480 EU/t parallel
    // of the six the titanium pipe casings offer.
    expect(getMachineParallelMultiplier(NITROBENZENE, node)).toBe(1);
    expect(getOverclockedRecipeStats(NITROBENZENE, node).overclockSteps).toBe(0);
  });

  it("does not grant heat overclocks to coils that buy speed instead of heat", () => {
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Pyrolyse Oven",
        minimumTier: "MV",
        durationTicks: 1280,
        eut: 96,
        nei: { additionalInfo: ["Special value: 0"] },
        machineConfigControls: [speedCoilControl()],
      },
      { overclockTier: "EV", coilTier: "nichrome" },
    );

    // Two imperfect overclocks halve the duration twice; nichrome coils then
    // run the oven at 150% speed. A heat overclock would have quartered a step.
    expect(stats.overclockSteps).toBe(2);
    // 1280 ticks over four, then 150% coil speed, is 213.33; the game runs 213.
    expect(stats.durationTicks).toBe(Math.floor((1280 / 4) * (2 / 3)));
    expect(stats.eut).toBe(96 * 16);
  });

  it("does not grant heat overclocks to another machine running a blast furnace recipe", () => {
    // The Industrial Arc Furnace takes blast furnace recipes, heat requirement
    // and all, but overclocks on its electrodes. Only the machine decides.
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Industrial Arc Furnace",
        source: { recipeMap: "Blast Furnace" },
        minimumTier: "MV",
        durationTicks: 1000,
        eut: 120,
        nei: { additionalInfo: ["Special value: 1500"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "EV", coilTier: "naquadah" },
    );

    // Graphite electrodes: no machine speed, 4 parallels, and each overclock
    // step halves duration for the full 4x EU/t - not the quartering a heat
    // overclock would have given. Four parallels of 120 EU/t fill an HV
    // hatch, leaving one step of EV headroom.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(1000 / 2);
    expect(stats.eut).toBe(120 * 4);
    // No heat discount was applied: that is the blast furnace's, not this one's.
    expect(stats.eut % 1).toBe(0);
  });

  it("truncates a fractional duration to whole ticks, which favours the player", () => {
    // 600 ticks at 200% coil speed is 300; five overclocks would be 9.375, and
    // the game runs that in 9.
    const stats = getOverclockedRecipeStats(NITROBENZENE, {
      overclockTier: "UV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    });

    expect(Number.isInteger(stats.durationTicks)).toBe(true);
    expect(stats.durationTicks).toBe(Math.floor(300 / 2 ** stats.overclockSteps));
  });

  it("lets a multiblock run under one tick, spending the rest on parallels", () => {
    // A one-tick recipe cannot go faster than the clock, so a multiblock turns
    // the leftover speed into parallels. Modelling it as a fractional duration
    // gives the same throughput, so the duration must not be floored at 1.
    const oneTick = {
      machineType: "Large Chemical Reactor",
      machineProfile: {
        machineType: "Large Chemical Reactor",
        minimumTier: "MV",
        kind: "multiblock" as const,
      },
      minimumTier: "MV",
      durationTicks: 1,
      eut: 120,
    };

    const stats = getOverclockedRecipeStats(oneTick, { overclockTier: "EV" });

    // Two perfect steps: 1 tick becomes a sixteenth of one.
    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBeCloseTo(1 / 16, 10);
    expect(stats.eut).toBe(120 * 16);
  });

  it("holds a singleblock at one tick, where the leftover speed is lost", () => {
    const oneTick = {
      machineType: "Macerator",
      machineProfile: { machineType: "Macerator", minimumTier: "MV", kind: "single" as const },
      minimumTier: "MV",
      durationTicks: 1,
      eut: 120,
    };

    const stats = getOverclockedRecipeStats(oneTick, { overclockTier: "EV" });

    // The power is still drawn: a singleblock overclocks and wastes the speed.
    expect(stats.durationTicks).toBe(1);
    expect(stats.eut).toBe(120 * 16);
  });

  it("treats a machine it cannot identify as a singleblock", () => {
    const stats = getOverclockedRecipeStats(
      { machineType: "Some Unknown Machine", minimumTier: "MV", durationTicks: 1, eut: 120 },
      { overclockTier: "EV" },
    );

    expect(stats.durationTicks).toBe(1);
  });

  it("pays the dehydrator its coil heat bonus against a zero requirement", () => {
    // Dehydrator recipes start from 0 K, so the whole of a coil's heat counts.
    // Nichrome is 3601 K: four 5% discounts and two perfect overclocks.
    const dehydrator = {
      machineType: "Multiblock Dehydrator",
      minimumTier: "LuV",
      durationTicks: 400,
      eut: 1920,
      nei: { additionalInfo: ["Special value: 0"] },
    };

    const stats = getOverclockedRecipeStats(dehydrator, {
      overclockTier: "LuV",
      coilTier: "nichrome",
    });

    // The discounted, halved draw times four parallels leaves room for one
    // step inside the LuV hatch - counted from POWER, the way the game
    // counts, not from the declared tier. Nichrome's heat pays for it as a
    // perfect step: duration over four, then the 220% speed, floors at 45.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(Math.floor(400 / 4 / 2.2));
    // The Utupu-Tanuri reads its coils raw - no 100 K per voltage tier, that
    // bonus belongs to the blast furnaces. Nichrome's 3601 K over the 0 K
    // requirement is floor(3601/900) = 4 discounts on top of the flat half,
    // and the perfect step pays its 4x EU/t.
    expect(stats.eut).toBeCloseTo(1920 * 0.5 * 0.95 ** 4 * 4, 6);
  });

  it("clamps a sub-LV recipe to 32 EU/t when counting overclocks", () => {
    // OverclockCalculator: max(ceil(recipePower), 32) - "Treat ULV as LV for
    // overclocking". A 2 EU/t recipe on an MV machine gets ONE step, measured
    // against 32 EU/t, not the two its own tier distance would suggest.
    const stats = getOverclockedRecipeStats(
      { minimumTier: "ULV", durationTicks: 300, eut: 2 },
      { overclockTier: "MV" },
    );

    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(150);
    expect(stats.eut).toBe(8);
  });

  it("bills the arc furnace family triple, on triple amps", () => {
    // The one basic-machine line registered with setMachineEUtMultiplier(3)
    // and setMachineAmperage(3). The written 30 EU/t really draws 90.
    const recipe = {
      machineType: "Arc Furnace",
      minimumTier: "LV" as const,
      durationTicks: 122,
      eut: 30,
    };

    // On an LV machine: 3 amps carry the 90 EU/t draw, but 96/90 buys no step.
    const atLv = getOverclockedRecipeStats(recipe, { overclockTier: "LV" });
    expect(atLv.overclockSteps).toBe(0);
    expect(atLv.durationTicks).toBe(122);
    expect(atLv.eut).toBe(90);

    // On MV: one step fits both the power ratio and the voltage-tier cap.
    const atMv = getOverclockedRecipeStats(recipe, { overclockTier: "MV" });
    expect(atMv.overclockSteps).toBe(1);
    expect(atMv.durationTicks).toBe(61);
    expect(atMv.eut).toBe(360);
  });

  it("gives Zyngen its coil heat overclocks, with no EU discount", () => {
    // MTEIndustrialAlloySmelter counts its coils double against an 1800 K
    // step, so every 900 K of coil is one perfect overclock - and it never
    // calls setHeatDiscount, so the EU/t stays an exact power of four.
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Zyngen",
        minimumTier: "LV",
        durationTicks: 400,
        eut: 16,
        nei: { additionalInfo: ["Special value: 0"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "MV", coilTier: "cupronickel" },
    );

    // Two parallels of 16 EU/t leave one MV step, taken as a perfect one on
    // cupronickel's 3602 K of doubled coil heat. 400/4 at 105% speed is 95.23.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(95);
    expect(stats.eut).toBe(64);
  });

  it("reads Volcanus coils raw, without the blast furnace's voltage bonus", () => {
    // Naquadah coils on a 6400 K recipe are 801 K of excess: no discount, no
    // heat step. The EBF at LuV would have added 400 K and crossed 900.
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Volcanus",
        minimumTier: "HV",
        durationTicks: 600,
        eut: 480,
        nei: { additionalInfo: ["Special value: 6400"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "LuV", coilTier: "naquadah" },
    );

    // Eight parallels at 432 EU/t leave one normal step at LuV; the EU/t
    // carries the 0.9 power modifier and no 0.95 heat factor.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(Math.floor(600 / 2 / 2.2));
    expect(stats.eut).toBeCloseTo(480 * 0.9 * 4, 9);
  });

  it("lets the heat discount pay for extra parallels", () => {
    // ParallelHelper folds the heat discount into tRecipeEUt before dividing
    // the hatch: 300 EU/t at 0.9 is 270, one parallel on HV's 512 - but six
    // 5% discounts from naquadah coils bring it to 198.5, which fits two.
    const parallels = getMachineParallelMultiplier(
      {
        machineType: "Volcanus",
        minimumTier: "HV",
        eut: 300,
        nei: { additionalInfo: ["Special value: 1500"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "HV", coilTier: "naquadah", machineConfigTiers: {} },
    );

    expect(parallels).toBe(2);
  });

  it("still grants heat overclocks to the blast furnace family", () => {
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Blast Furnace",
        minimumTier: "MV",
        durationTicks: 1000,
        eut: 120,
        nei: { additionalInfo: ["Special value: 1500"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "EV", coilTier: "naquadah" },
    );

    // Naquadah coils sit 5901 K over the recipe's 1500 K, which is worth two
    // 4x steps and a 0.95^6 EU discount.
    expect(stats.overclockSteps).toBe(2);
    // 62.5 ticks truncates to 62.
    expect(stats.durationTicks).toBe(62);
    expect(stats.eut).toBeCloseTo(120 * 0.95 ** 6 * 16, 6);
  });
});
