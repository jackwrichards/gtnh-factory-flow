import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { getNodePowerReport, getNodeSteamReport } from "./power-report";
import { getOverclockedRecipeStats } from "./overclock";
import { calculateThroughput } from "./throughput";

/** A synthetic LCR recipe: the table marks the machine a multiblock. */
function lcrRecipe(eut: number, minimumTier: string): Recipe {
  return {
    id: `lcr-${eut}`,
    name: "LCR test",
    machineType: "Large Chemical Reactor",
    minimumTier,
    durationTicks: 400,
    eut,
    inputs: [],
    outputs: [],
  } as unknown as Recipe;
}

describe("energy hatches", () => {
  it("lets two MV hatches run an HV recipe at full recipe speed", () => {
    // The classic just-hit-HV build: 2 hatches work at 2 amps each, so the
    // pool is 128 x 4 = 512 EU/t - enough for the 480 EU/t draw, one tier
    // above the hatches (the game allows exactly one tier of skip).
    const report = getNodePowerReport(lcrRecipe(480, "HV"), {
      overclockTier: "MV",
      energyHatches: 2,
    });

    expect(report.state).toBe("ok");
    expect(report.amps).toBe(4);
    expect(report.poolEuT).toBe(512);
    expect(report.overclockSteps).toBe(0);
  });

  it("calls one MV hatch on that same recipe underpowered", () => {
    const report = getNodePowerReport(lcrRecipe(480, "HV"), {
      overclockTier: "MV",
      energyHatches: 1,
    });

    expect(report.state).toBe("under-powered");
    expect(report.poolEuT).toBe(128);
  });

  it("refuses a recipe more than one tier above the hatches, whatever the amps", () => {
    const report = getNodePowerReport(lcrRecipe(1920, "EV"), {
      overclockTier: "MV",
      energyHatches: 16,
    });

    expect(report.state).toBe("over-tier");
  });

  it("buys overclocks with amps past the hatches' own tier", () => {
    // Two HV hatches carry 2048 EU/t: an MV recipe overclocks TWICE, one step
    // more than the hatch tier alone would suggest - amperage overclocking,
    // straight from OverclockCalculator. Both steps are the LCR's perfect
    // kind: duration over sixteen for sixteen times the EU/t.
    const stats = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
      energyHatches: 2,
    });

    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBe(400 / 16);
    expect(stats.eut).toBe(120 * 16);
  });

  it("keeps single hatches identical to the old model", () => {
    const withField = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
      energyHatches: 1,
    });
    const without = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
    });

    expect(withField).toEqual(without);
    expect(withField.overclockSteps).toBe(1);
  });

  it("stalls a wired underpowered node at 0% without hiding its shape", () => {
    // The card must stay a machine at zero, not a blank: nameplate rates keep
    // the ports and wires drawn while the equilibrium pins the node still.
    const recipe = {
      id: "stall-lcr",
      name: "LCR stall test",
      machineType: "Large Chemical Reactor",
      minimumTier: "HV",
      durationTicks: 20,
      eut: 480,
      inputs: [{ kind: "fluid", id: "ethylene", amount: 100 }],
      outputs: [{ kind: "fluid", id: "polyethylene", amount: 150 }],
    } as unknown as Recipe;
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-stall",
      name: "Power stall",
      recipes: [recipe],
      nodes: [
        {
          id: "reactor",
          recipeId: "stall-lcr",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          energyHatches: 1,
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        { id: "in-tank", kind: "fluid", resourceId: "ethylene", position: { x: -160, y: 0 } },
        { id: "out-tank", kind: "fluid", resourceId: "polyethylene", position: { x: 160, y: 0 } },
      ],
      edges: [
        {
          id: "feed",
          source: "in-tank",
          target: "reactor",
          resourceKind: "fluid",
          resourceId: "ethylene",
        },
        {
          id: "ship",
          source: "reactor",
          target: "out-tank",
          resourceKind: "fluid",
          resourceId: "polyethylene",
        },
      ],
      fuelProfiles: [],
    };

    const stalled = calculateThroughput(project);
    const reactor = stalled.nodes.reactor;
    expect(reactor.powerStalled).toBe(true);
    // Nameplate shape survives - one op per second, 100 L in, 150 L out.
    expect(reactor.inputs["fluid:ethylene"].amountPerSecond).toBeCloseTo(100);
    expect(reactor.outputs["fluid:polyethylene"].amountPerSecond).toBeCloseTo(150);
    // But nothing actually moves.
    expect(reactor.utilization).toBeCloseTo(0);
    expect(stalled.edges.ship.transferredPerSecond).toBeCloseTo(0);
    expect(reactor.warnings.some((warning) => warning.includes("Underpowered"))).toBe(true);

    // The same build with a second hatch runs.
    const powered = calculateThroughput({
      ...project,
      nodes: [{ ...project.nodes[0], energyHatches: 2 }],
    });
    expect(powered.nodes.reactor.powerStalled).toBe(false);
    expect(powered.nodes.reactor.utilization).toBeGreaterThan(0.99);
    expect(powered.edges.ship.transferredPerSecond).toBeCloseTo(150);
  });

  it("ignores hatch counts on a singleblock and floors its tier at the minimum", () => {
    // Legacy plans store below-minimum tiers on singleblocks ("ULV" canners);
    // those always meant the minimum, and no lower machine exists to build.
    const single = {
      id: "canner",
      name: "Canner test",
      machineType: "Canner Test Machine",
      minimumTier: "LV",
      durationTicks: 16,
      eut: 1,
      inputs: [],
      outputs: [],
    } as unknown as Recipe;

    const report = getNodePowerReport(single, {
      overclockTier: "ULV",
      energyHatches: 8,
    });

    expect(report.isMultiblock).toBe(false);
    expect(report.tier).toBe("LV");
    expect(report.amps).toBe(1);
    expect(report.state).toBe("ok");
  });
});

/**
 * The steam line, shaped exactly like the 2.9.0-beta-2 dataset ships it: the
 * macerator map's 300-tick, 2 EU/t recipe with the singleblock steam handlers
 * (which export no stats of their own) and the Steam Grinder multiblock
 * (whose exported durationTicks bakes the tooltip's wrong "125% Speed").
 */
function maceratorRecipe(): Recipe {
  return {
    id: "macerate-test",
    name: "Macerate test",
    machineType: "Macerator",
    minimumTier: "ULV",
    durationTicks: 300,
    eut: 2,
    inputs: [],
    outputs: [],
    machineHandlers: [
      { id: "macerator", label: "Macerator", kind: "single", machineType: "Macerator", minimumTier: "ULV" },
      { id: "steam-macerator", label: "Steam Macerator", kind: "single", machineType: "Steam Macerator", minimumTier: "ULV" },
      { id: "high-pressure-steam-macerator", label: "High Pressure Steam Macerator", kind: "single", machineType: "High Pressure Steam Macerator", minimumTier: "ULV" },
      { id: "steam-grinder", label: "Steam Grinder", kind: "multiblock", machineType: "Steam Grinder", minimumTier: "ULV", durationTicks: 240 },
    ],
  } as unknown as Recipe;
}

describe("steam machines", () => {
  it("runs the bronze steam multiblock at 1.6x the recipe and bills its steam", () => {
    // MTESteamMacerator: duration x 1.6 / tierMachine, 8 parallels, and the
    // draw is recipe EU x 1.25 x tierMachine at 1 L per EU. The dataset's
    // baked 240-tick handler duration (the high pressure figure) must not
    // leak through - that bake is what showed every steam multi at twice its
    // real speed.
    const recipe = maceratorRecipe();
    const node = { overclockTier: "LV", machineHandlerId: "steam-grinder", machineConfigTiers: {} };

    expect(getOverclockedRecipeStats(recipe, node).durationTicks).toBe(480);
    const steam = getNodeSteamReport(recipe, node);
    expect(steam?.drawSteamPerTick).toBe(20); // 2 EU x 1.25 x 8 parallels
    expect(steam?.parallels).toBe(8);
    expect(steam?.isMultiblock).toBe(true);
    expect(steam?.highPressure).toBe(false);
  });

  it("doubles the multiblock's speed and steam on a high pressure build", () => {
    const recipe = maceratorRecipe();
    const node = {
      overclockTier: "LV",
      machineHandlerId: "steam-grinder",
      machineConfigTiers: { steamPressure: "high" },
    };

    expect(getOverclockedRecipeStats(recipe, node).durationTicks).toBe(240);
    const steam = getNodeSteamReport(recipe, node);
    expect(steam?.drawSteamPerTick).toBe(40);
    expect(steam?.highPressure).toBe(true);
  });

  it("runs steam singleblocks at bronze 2x / high pressure 1x with 2 L per EU", () => {
    // SteamOverclockDescriber: bronze is (x1 EU, x2 duration), steel is
    // (x2 EU, x1 duration), both converting 2 L per EU. Their handlers export
    // no durations, which is why they used to show the LV recipe's speed.
    const recipe = maceratorRecipe();
    const bronze = { overclockTier: "LV", machineHandlerId: "steam-macerator", machineConfigTiers: {} };
    const high = { overclockTier: "LV", machineHandlerId: "high-pressure-steam-macerator", machineConfigTiers: {} };

    expect(getOverclockedRecipeStats(recipe, bronze).durationTicks).toBe(600);
    expect(getOverclockedRecipeStats(recipe, high).durationTicks).toBe(300);
    expect(getNodeSteamReport(recipe, bronze)?.drawSteamPerTick).toBe(4);
    expect(getNodeSteamReport(recipe, high)?.drawSteamPerTick).toBe(8);
  });

  it("seeds smelting from GT's fixed 128t/4EU furnace recipe", () => {
    // The dataset exports smelting off the vanilla map (200 ticks, 0 EU); the
    // steam furnaces and the Steam Hearth actually run GT's furnace recipe.
    const recipe = {
      id: "smelt-test",
      name: "Smelt test",
      machineType: "Furnace",
      minimumTier: "NONE",
      durationTicks: 200,
      eut: 0,
      inputs: [],
      outputs: [],
      machineHandlers: [
        { id: "furnace", label: "Furnace", kind: "single", machineType: "Furnace", minimumTier: "NONE" },
        { id: "steam-furnace", label: "Steam Furnace", kind: "single", machineType: "Steam Furnace", minimumTier: "NONE" },
        { id: "steam-hearth", label: "Steam Hearth", kind: "multiblock", machineType: "Steam Hearth", minimumTier: "NONE", durationTicks: 160 },
      ],
    } as unknown as Recipe;

    // Bronze steam furnace: 128 x 2 = 256 ticks, 4 EU x 2 L = 8 L/t.
    const single = { overclockTier: "LV", machineHandlerId: "steam-furnace", machineConfigTiers: {} };
    expect(getOverclockedRecipeStats(recipe, single).durationTicks).toBe(256);
    expect(getNodeSteamReport(recipe, single)?.drawSteamPerTick).toBe(8);

    // Steam Hearth: 128 x 1.6 = 204.8 -> 204 whole ticks; 4 EU x 1.25 x 8.
    const hearth = { overclockTier: "LV", machineHandlerId: "steam-hearth", machineConfigTiers: {} };
    expect(getOverclockedRecipeStats(recipe, hearth).durationTicks).toBe(204);
    expect(getNodeSteamReport(recipe, hearth)?.drawSteamPerTick).toBe(40);
  });

  it("gives no steam report to the electric handler on the same recipe", () => {
    expect(
      getNodeSteamReport(maceratorRecipe(), { overclockTier: "LV", machineHandlerId: "macerator", machineConfigTiers: {} }),
    ).toBeUndefined();
  });
});

describe("curated table vs baked handler stats", () => {
  it("seeds table-covered handlers from the base recipe, not the baked one", () => {
    // The dataset bakes scraped multipliers into handler stats: the Volcanus
    // handler on a 3000t/120EU blast recipe carries 1364t/108EU (x0.8 / x0.9
    // pre-applied). The table also states speed 2.2 and power 0.9, so reading
    // both applied the bonus twice - 620 ticks instead of the game's 1363.
    const recipe = {
      id: "blast-test",
      name: "Blast test",
      machineType: "Blast Furnace",
      minimumTier: "MV",
      durationTicks: 3000,
      eut: 120,
      inputs: [],
      outputs: [],
      machineHandlers: [
        { id: "blast-furnace", label: "Blast Furnace", kind: "multiblock", machineType: "Blast Furnace", minimumTier: "MV" },
        { id: "volcanus", label: "Volcanus", kind: "multiblock", machineType: "Volcanus", minimumTier: "MV", durationTicks: 1364, eut: 108 },
      ],
    } as unknown as Recipe;

    const stats = getOverclockedRecipeStats(recipe, {
      overclockTier: "MV",
      machineHandlerId: "volcanus",
      machineConfigTiers: {},
    });

    // 3000 / 2.2 truncated to whole ticks, once.
    expect(stats.durationTicks).toBe(1363);
    // 120 x 0.9, once.
    expect(Math.round(stats.eut)).toBe(108);
  });
});
