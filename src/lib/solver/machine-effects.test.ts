import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { enrichPassiveProductionRecipe } from "@/lib/model/passive-production";
import { getOverclockedRecipeStats } from "./overclock";
import {
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineOutputMultiplier,
  getMachineParallelMultiplier,
} from "./machine-effects";

describe("voltage-scaled parallels", () => {
  const recipeWithControl = (tier: Record<string, number>): Recipe => ({
    id: "test",
    name: "test",
    machineType: "Zhuhai - Fishing Port",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [],
    outputs: [{ kind: "item", id: "fish", amount: 1 }],
    machineConfigControls: [
      {
        id: "voltageParallel",
        label: "Parallels per Tier",
        minimumKey: "only",
        defaultKey: "only",
        tiers: [
          {
            key: "only",
            label: "only",
            ...tier,
            resource: { kind: "item", id: "x", amount: 1 },
          },
        ],
      },
    ],
  });

  it("scales linearly with the run tier", () => {
    const recipe = recipeWithControl({ parallelPerVoltageTier: 2 });
    expect(getMachineParallelMultiplier(recipe, { overclockTier: "LV" })).toBe(2);
    expect(getMachineParallelMultiplier(recipe, { overclockTier: "EV" })).toBe(8);
  });

  it("supports affine base with floor (Zhuhai and Density^2 forms)", () => {
    const zhuhai = recipeWithControl({ parallelPerVoltageTier: 2, parallelVoltageBase: 2 });
    expect(getMachineParallelMultiplier(zhuhai, { overclockTier: "LV" })).toBe(4);
    expect(getMachineParallelMultiplier(zhuhai, { overclockTier: "UV" })).toBe(18);

    const density = recipeWithControl({ parallelPerVoltageTier: 0.5, parallelVoltageBase: 1 });
    expect(getMachineParallelMultiplier(density, { overclockTier: "LV" })).toBe(1);
    expect(getMachineParallelMultiplier(density, { overclockTier: "MV" })).toBe(2);
    expect(getMachineParallelMultiplier(density, { overclockTier: "HV" })).toBe(2);
    expect(getMachineParallelMultiplier(density, { overclockTier: "EV" })).toBe(3);
  });
});

describe("CropsNH analytic crop math", () => {
  // Argentia in 2.9.0-beta-2: tier 7, 1400 growth points, dropChance 0.6983373.
  const argentia = (): Recipe =>
    enrichPassiveProductionRecipe({
      id: "cropsnh-crop-argentia",
      name: "Crop Farm: Argentia",
      machineType: "Crop Farm",
      minimumTier: "NONE",
      durationTicks: 3328,
      eut: 0,
      inputs: [],
      outputs: [
        { kind: "item", id: "cropsnh:materialleaf@26", amount: 2.29, displayName: "Argentia Leaf" },
      ],
      metadata: {
        cropsNh: {
          tier: 7,
          growthPoints: 1400,
          dropChance: 0.6983373,
          growthCycleTicks: 256,
          growthMultiplier: 1,
          drops: [{ id: "cropsnh:materialleaf@26", stackSize: 1, weight: 10000 }],
        },
      },
      source: { recipeMap: "Crop Farm" },
    });

  it("adds stat and environment controls with ideal defaults", () => {
    const recipe = argentia();
    expect(recipe.machineConfigControls?.map((control) => control.id)).toEqual([
      "cropGrowthStat",
      "cropGainStat",
      "cropWater",
      "cropFertilizer",
      "cropSky",
      "cropBiome",
    ]);
    expect(
      recipe.machineConfigControls?.every((control) => control.tiers.length > 0),
    ).toBe(true);
  });

  it("matches the in-game growth formula at the reference environment", () => {
    const recipe = argentia();
    // score 55 -> supply 275 vs demand 70; rate = trunc(37 * 305 / 100) = 112;
    // ceil(1400 / 112) = 13 cycles of 256 ticks -> multiplier 1 at defaults.
    expect(getMachineDurationMultiplier(recipe, { machineConfigTiers: {} })).toBe(1);
    expect(
      getMachineOutputMultiplier(recipe, { machineConfigTiers: {} }, recipe.outputs[0]!, "LV"),
    ).toBe(1);
  });

  it("slows down at low growth stats using integer cycle math", () => {
    const recipe = argentia();
    const node = { machineConfigTiers: { cropGrowthStat: "1" } };
    // Growth 1: rate = trunc(7 * 305 / 100) = 21; ceil(1400 / 21) = 67 cycles.
    expect(getMachineDurationMultiplier(recipe, node)).toBeCloseTo(67 / 13, 10);
  });

  it("scales yield by 1.03^gain drop rounds plus the bonus roll", () => {
    const recipe = argentia();
    const node = { machineConfigTiers: { cropGainStat: "1" } };
    const expected = (1.03 ** (1 - 31) * (1 + 0.02)) / (1 + 0.32);
    expect(
      getMachineOutputMultiplier(recipe, node, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(expected, 10);
  });

  it("produces nothing when nutrient supply is 25+ under demand", () => {
    const recipe = argentia();
    const node = {
      machineConfigTiers: {
        cropWater: "0",
        cropFertilizer: "0",
        cropSky: "no",
        cropBiome: "none",
      },
    };
    // score 7 -> supply 35 vs demand 70: penalty 140% kills growth entirely.
    expect(
      getMachineOutputMultiplier(recipe, node, recipe.outputs[0]!, "LV"),
    ).toBe(0);
    expect(getMachineDurationMultiplier(recipe, node)).toBe(1);
  });
});

describe("passive production machine effects", () => {
  it("applies IC2 crop stat presets as generic config multipliers", () => {
    const recipe = enrichPassiveProductionRecipe(testCropRecipe());
    const lowStatsNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "1-1-1" },
    };
    const gainNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "23-31-0" },
    };

    expect(getMachineDurationMultiplier(recipe, lowStatsNode)).toBeCloseTo(3.102);
    expect(getMachineOutputMultiplier(recipe, lowStatsNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      0.866,
    );
    expect(getMachineDurationMultiplier(recipe, gainNode)).toBe(1);
    expect(getMachineOutputMultiplier(recipe, gainNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      2.741,
    );
  });

  it("applies bee frame output through the Forestry production formula", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const emptyNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {},
    };
    const provenFramesNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {
        beeFrameSlot1: "forestry:proven",
        beeFrameSlot2: "forestry:proven",
        beeFrameSlot3: "forestry:proven",
      },
    };

    expect(getMachineOutputMultiplier(recipe, emptyNode, recipe.outputs[0]!, "LV")).toBe(1);
    expect(
      getMachineOutputMultiplier(recipe, provenFramesNode, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(Math.pow(31, 0.52));
  });

  it("applies bee climate requirements to specialty outputs", () => {
    const recipe = enrichPassiveProductionRecipe({
      ...testBeeRecipe(),
      outputs: [
        {
          kind: "item",
          id: "Forestry:beeCombs@0",
          amount: 1,
          displayName: "Honey Comb",
          tooltip: ["Product chance: 30%"],
        },
        {
          kind: "item",
          id: "GTPlusPlus:hydraComb",
          amount: 1,
          displayName: "Hydra Comb",
          tooltip: ["Specialty chance: 6%", "Needs preferred climate"],
        },
      ],
    });
    const toleratedNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeEnvironment: "tolerated" },
    };
    const wrongNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeEnvironment: "wrong" },
    };

    expect(getMachineOutputMultiplier(recipe, toleratedNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      1,
    );
    expect(getMachineOutputMultiplier(recipe, toleratedNode, recipe.outputs[1]!, "LV")).toBe(0);
    expect(getMachineOutputMultiplier(recipe, wrongNode, recipe.outputs[0]!, "LV")).toBe(0);
  });

  it("applies bee machine handler production terms", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId"> = {
      machineConfigTiers: {},
      machineHandlerId: "alveary",
    };
    const alvearyRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineOutputMultiplier(alvearyRecipe, node, recipe.outputs[0]!, "LV")).toBeCloseTo(
      Math.pow(10, 0.52),
    );
  });

  it("combines valid Industrial Apiary speed and production upgrades without voltage overclocking", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<
      FactoryNode,
      "machineConfigTiers" | "machineHandlerId" | "coilTier" | "overclockTier"
    > = {
      machineConfigTiers: { beeIndustrialSpeed: "speed-4", beeIndustrialProduction: "4" },
      machineHandlerId: "industrial-apiary",
      overclockTier: "HV",
    };
    const industrialRecipe = applyMachineHandlerToRecipe(recipe, node);
    const stats = getOverclockedRecipeStats(industrialRecipe, node);

    expect(industrialRecipe.machineConfigControls?.map((control) => control.id)).toEqual([
      "beeIndustrialSpeed",
      "beeIndustrialProduction",
      "beeEnvironment",
    ]);
    expect(getMachineDurationMultiplier(industrialRecipe, node)).toBeCloseTo(1 / 16);
    expect(stats.tier).toBe("MV");
    expect(stats.overclockSteps).toBe(0);
    expect(stats.durationTicks).toBeCloseTo(550 / 16);
    expect(stats.eut).toBeCloseTo((37 + 2048) * 1.4 ** 4);
    expect(getMachineEutMultiplier(industrialRecipe, node)).toBeCloseTo(
      ((37 + 2048) / 37) * 1.4 ** 4,
    );
    expect(
      getMachineOutputMultiplier(industrialRecipe, node, recipe.outputs[0]!, "MV"),
    ).toBeCloseTo(Math.pow((4 * 1.2 ** 4 + 8) / 0.1, 0.52));
  });

  it("does not combine Upgraded Acceleration x256 with production upgrades", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId" | "coilTier"> = {
      machineConfigTiers: { beeIndustrialSpeed: "speed-8-upgraded", beeIndustrialProduction: "8" },
      machineHandlerId: "industrial-apiary",
    };
    const industrialRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineDurationMultiplier(industrialRecipe, node)).toBeCloseTo(1 / 256);
    expect(getMachineEutMultiplier(industrialRecipe, node)).toBeCloseTo((37 + 524288) / 37);
    expect(
      getMachineOutputMultiplier(industrialRecipe, node, recipe.outputs[0]!, "MV"),
    ).toBeCloseTo(Math.pow((17.19926784 + 8) / 0.1, 0.52));
  });

  it("models Mega Apiary batching and voltage slot scaling", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<
      FactoryNode,
      "machineConfigTiers" | "machineHandlerId" | "coilTier" | "overclockTier"
    > = {
      machineConfigTiers: { beeMegaRoyalJelly: "full" },
      machineHandlerId: "mega-apiary",
      overclockTier: "ZPM",
    };
    const megaRecipe = applyMachineHandlerToRecipe(recipe, node);
    const stats = getOverclockedRecipeStats(megaRecipe, node);

    expect(megaRecipe.durationTicks).toBe(100);
    expect(stats.durationTicks).toBe(100);
    expect(stats.eut).toBe(8110 * 4);
    expect(getMachineOutputMultiplier(megaRecipe, node, recipe.outputs[0]!, "ZPM")).toBeCloseTo(
      (6400 / 550) * 4 * 3 * Math.pow((17.19926784 + 7) / 0.1, 0.52),
    );
  });
});

function testCropRecipe(): Recipe {
  return {
    id: "ic2-crop-stickle",
    name: "IC2 Crop: Stickreed",
    machineType: "IC2 Crop",
    minimumTier: "NONE",
    durationTicks: 1200,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "IC2:itemCropSeed@1",
        amount: 1,
        displayName: "Stickreed Seeds",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:itemHarz", amount: 1, displayName: "Sticky Resin" }],
    source: { recipeMap: "IC2 Crop" },
  };
}

function testBeeRecipe(): Recipe {
  return {
    id: "bee-explosive",
    name: "Bee Produce: Explosive Bee",
    machineType: "Bee Produce",
    minimumTier: "NONE",
    durationTicks: 550,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "factoryflow:bee_species:gregtech-explosive",
        amount: 1,
        displayName: "Explosive Bee",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:blockITNT", amount: 0.02, displayName: "Industrial TNT" }],
    source: { recipeMap: "Bee Produce" },
  };
}
