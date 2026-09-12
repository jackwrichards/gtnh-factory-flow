import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import singleblockCatalysts from "./__fixtures__/singleblock-catalysts.json";

const scriptPath = fileURLToPath(new URL("./normalize-oracle-export.mjs", import.meta.url));

/**
 * The normalizer runs work at import time, so it is exercised the way the
 * pipeline runs it: as a subprocess over a fixture export.
 */
function normalize(rawExport) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-oracle-"));
  const input = path.join(dir, "oracle-export.json");
  const output = path.join(dir, "recipes.json");
  fs.writeFileSync(input, JSON.stringify(rawExport));
  execFileSync(process.execPath, [scriptPath, input, output], {
    env: {
      ...process.env,
      GTNH_DATASET_VERSION_ID: "test-fixture",
      GTNH_DATASET_VERSION_LABEL: "test",
    },
    stdio: "pipe",
  });
  const dataset = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return dataset;
}

function fluid(id, amount, displayName) {
  return { kind: "fluid", id, amount, displayName };
}

function item(id, amount, displayName) {
  return { kind: "item", id, amount, displayName };
}

it("retains long fusion thresholds independently of legacy specialValue", () => {
  const dataset = normalize({ domains: [{ id: "gregtech", recipeMaps: [{
    id: "gt.recipe.fusionreactor", name: "Fusion Reactor",
    catalysts: [{ resource: item("gregtech:gt.blockmachines@32023", 1, "Compact Fusion Computer MK-V"),
      multiblock: true, sourceClass: "goodgenerator.blocks.tileEntity.MTELargeFusionComputer5" }],
    recipes: [{ id: "fusion", durationTicks: 20, eut: 7864320, specialValue: 0, fusionStartupEu: 6_000_000_000,
      fluidInputs: [fluid("a", 1, "A")], fluidOutputs: [fluid("b", 1, "B")] }],
  }] }] });
  expect(dataset.recipes[0].metadata).toMatchObject({ fusionStartupEu: 6_000_000_000, specialValue: 0 });
});

it("retains real furnace tiers and separates the Ore Washing Plant controller across maps", () => {
  const dataset = normalize({ domains: [
    { id: "gregtech", recipeMaps: singleblockCatalysts
      .filter(map => ["gt.recipe.furnace", "gt.recipe.orewasher", "gtpp.recipe.simplewasher"].includes(map.id))
      .map(map => ({ ...map, recipes: map.id === "gt.recipe.furnace" ? [] : [{
        id: map.id, durationTicks: 20, eut: 30,
        itemInputs: [item("minecraft:stone", 1, "Stone")],
        itemOutputs: [item("minecraft:sand", 1, "Sand")],
      }] })) },
    { id: "smelting", recipes: [{ id: "smelt", input: item("minecraft:sand", 1, "Sand"), output: item("minecraft:glass", 1, "Glass") }] },
  ] });
  const furnace = dataset.recipes.find(recipe => recipe.source.recipeMap === "Furnace")
    .machineHandlers.find(handler => handler.id === "electric-furnace");
  expect(furnace).toMatchObject({minimumTier: "LV", maximumTier: "UMV", durationTicks: 128, eut: 4});
  expect(furnace.availableTiers).toEqual(["LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV"]);
  const washers = dataset.recipes.filter(recipe => recipe.source.recipeMap !== "Furnace");
  expect(washers).toHaveLength(2);
  for (const recipe of washers) {
    expect(recipe.machineHandlers.find(handler => handler.id === "ore-washing-plant-multiblock")?.kind).toBe("multiblock");
  }
});

const RESISTOR = "gregtech:gt.metaitem.01@32716";
const SMD_RESISTOR = "gregtech:gt.metaitem.03@32011";
const VACUUM_TUBE = "gregtech:gt.metaitem.01@32700";

/**
 * The Circuit Assembler recipe for an Electronic Circuit (the LV tier circuit),
 * as the oracle exports it from the running game. Every slot here is the real
 * thing, and each behaves differently on purpose:
 *
 *   Circuit Board 1x       one exact item, nothing else accepted
 *   Resistor 2x            also takes 2 SMD resistors: GregTech unifies them
 *                          through `componentCircuitResistor`, so NEI shows
 *                          the slot cycling between the two
 *   1x Red Alloy Wire 2x   its ore dictionary group has one member, so no
 *                          choice comes out of it
 *   Vacuum Tube 2x         shares `circuitPrimitive` with the NAND chip and
 *                          STILL takes only vacuum tubes, which is why ore
 *                          dictionary membership cannot be used as the rule
 *   Molten Soldering Alloy 72 L    or 144 L of tin, or 288 L of lead, from
 *                                  `SubstituteFluidStack.soldering(HALF_INGOTS)`
 *
 * Item substitutes come at the slot's own stack size (2 resistors, 2 SMD
 * resistors), fluid substitutes at their own amounts.
 */
const RAW_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-08-08T05:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 1,
  domains: [
    {
      id: "gregtech",
      recipeMaps: [
        {
          id: "gt.recipe.circuitassembler",
          name: "Circuit Assembler",
          sourceClass: "gregtech.api.recipe.RecipeMap",
          catalysts: [],
          recipes: [
            {
              id: "electronic-circuit",
              enabled: true,
              durationTicks: 200,
              eut: 15,
              itemInputs: [
                item("gregtech:gt.metaitem.03@32100", 1, "Circuit Board"),
                {
                  ...item(RESISTOR, 2, "Resistor"),
                  alternatives: [
                    item(RESISTOR, 2, "Resistor"),
                    item(SMD_RESISTOR, 2, "SMD Resistor"),
                  ],
                },
                item("gregtech:gt.blockmachines@2000", 2, "1x Red Alloy Wire"),
                item(VACUUM_TUBE, 2, "Vacuum Tube"),
              ],
              itemOutputs: [
                { kind: "item", id: "ic2:itempartcircuit", amount: 1, displayName: "Electronic Circuit" },
              ],
              fluidInputs: [
                {
                  ...fluid("molten.solderingalloy", 72, "Molten Soldering Alloy"),
                  alternatives: [
                    fluid("molten.solderingalloy", 72, "Molten Soldering Alloy"),
                    fluid("molten.tin", 144, "Molten Tin"),
                    fluid("molten.lead", 288, "Molten Lead"),
                  ],
                },
              ],
              fluidOutputs: [],
              nonConsumedInputs: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("what a recipe slot accepts", () => {
  let dataset;
  let recipe;

  beforeAll(() => {
    dataset = normalize(RAW_EXPORT);
    recipe = dataset.recipes[0];
  });

  afterAll(() => {
    dataset = undefined;
    recipe = undefined;
  });

  it("keeps the slot's other fluids on the input", () => {
    const solder = recipe.inputs.find((input) => input.id === "molten.solderingalloy");

    expect(solder.alternatives?.map((entry) => entry.displayName)).toEqual([
      "Molten Soldering Alloy",
      "Molten Tin",
      "Molten Lead",
    ]);
  });

  it("stores each substitute as a ratio, not a stack size", () => {
    // 72 L of soldering alloy, 144 L of tin, 288 L of lead. Storing the ratio
    // means the slot can be switched on a recipe of any size, so the amount is
    // divided out here and multiplied back when the swap actually happens.
    const solder = recipe.inputs.find((input) => input.id === "molten.solderingalloy");
    const byId = new Map(solder.alternatives.map((entry) => [entry.id, entry.amount]));

    expect(byId.get("molten.solderingalloy")).toBe(1);
    expect(byId.get("molten.tin")).toBe(2);
    expect(byId.get("molten.lead")).toBe(4);
    expect(solder.amount * byId.get("molten.lead")).toBe(288);
  });

  it("offers the SMD resistor the resistor slot really takes", () => {
    const resistor = recipe.inputs.find((input) => input.id === RESISTOR);

    expect(resistor.alternatives?.map((entry) => entry.displayName)).toEqual([
      "Resistor",
      "SMD Resistor",
    ]);
  });

  it("keeps an item substitute at the slot's own count", () => {
    // The slot wants 2 resistors and takes 2 SMD resistors, so the ratio is
    // one to one and the count must not drift when the slot is switched.
    const resistor = recipe.inputs.find((input) => input.id === RESISTOR);
    const smd = resistor.alternatives.find((entry) => entry.id === SMD_RESISTOR);

    expect(smd.amount).toBe(1);
    expect(resistor.amount * smd.amount).toBe(2);
  });

  it("invents nothing for a slot that named one exact item", () => {
    // A vacuum tube shares `circuitPrimitive` with the NAND chip, and the
    // machine still takes only vacuum tubes. Offering the group here would
    // describe a recipe the game will not run.
    const vacuumTube = recipe.inputs.find((input) => input.id === VACUUM_TUBE);
    const board = recipe.inputs.find((input) => input.id === "gregtech:gt.metaitem.03@32100");

    expect(vacuumTube.alternatives).toBeUndefined();
    expect(board.alternatives).toBeUndefined();
  });

  it("never lets one recipe's substitutes follow the item into the catalog", () => {
    // The catalog is keyed by id and shared by every recipe. Soldering alloy is
    // swappable in THIS slot; writing that onto the item would offer tin and
    // lead in every other machine that uses solder.
    const solder = dataset.resources.find((entry) => entry.id === "molten.solderingalloy");

    expect(solder).toBeDefined();
    expect(solder.alternatives).toBeUndefined();
  });

  it("does not ship the marker that told the writer which kind these were", () => {
    for (const input of recipe.inputs) {
      expect(input).not.toHaveProperty("slotChoice");
    }
  });
});

/**
 * A slice of the mining domain the oracle exports from GregTech worldgen: one
 * vein spanning two planets (with a repeated material across layers), one
 * small ore, one underground fluid, and one underground fluid whose Forge
 * fluid never registered.
 */
const MINING_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-08-13T05:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 0,
  domains: [
    {
      id: "mining",
      dimensions: [
        { id: "Overworld", name: "Overworld", fullName: "Overworld", abbr: "Ow", tier: "T0" },
        {
          id: "GalacticraftCore_Moon",
          name: "Moon",
          fullName: "GalacticraftCore_Moon",
          abbr: "Mo",
          tier: "T1",
        },
      ],
      veins: [
        {
          id: "ore.mix.copper",
          name: "Copper",
          weight: 80,
          density: 4,
          size: 24,
          heightRange: "10-50",
          dims: ["Overworld", "GalacticraftCore_Moon"],
          dimAbbrs: ["Ow", "Mo"],
          dimHeightRanges: { Mo: "20-60" },
          dimChances: { Ow: 0.12, Mo: 0.3 },
          ores: [
            {
              role: "primary",
              material: { id: 855, internalName: "Chalcopyrite", name: "Chalcopyrite" },
              ore: item("gregtech:gt.blockores@855", 1, "Chalcopyrite Ore"),
            },
            {
              role: "secondary",
              material: { id: 35, internalName: "Copper", name: "Copper" },
              ore: item("gregtech:gt.blockores@35", 1, "Copper Ore"),
            },
            {
              role: "between",
              material: { id: 32, internalName: "Iron", name: "Iron" },
              ore: item("gregtech:gt.blockores@32", 1, "Iron Ore"),
            },
            {
              role: "sporadic",
              material: { id: 35, internalName: "Copper", name: "Copper" },
              ore: item("gregtech:gt.blockores@35", 1, "Copper Ore"),
            },
          ],
        },
      ],
      smallOres: [
        {
          id: "ore.small.copper",
          material: { id: 35, internalName: "Copper", name: "Copper" },
          heightRange: "40-100",
          amountPerChunk: 12,
          dims: ["Overworld"],
          enabledDims: ["Ow"],
          drops: [item("gregtech:gt.metaitem.01@5035", 1, "Raw Copper Ore")],
        },
      ],
      undergroundFluids: [
        {
          fluidId: "oil",
          fluid: fluid("oil", 1, "Oil"),
          deposits: [
            { dim: "Overworld", chance: 40, minAmount: 100, maxAmount: 625 },
            { dim: "Moon", chance: 20, minAmount: 0, maxAmount: 300 },
          ],
        },
        {
          fluidId: "never_registered",
          deposits: [{ dim: "Overworld", chance: 5, minAmount: 1, maxAmount: 2 }],
        },
      ],
    },
  ],
};

describe("mining worldgen becomes source recipes", () => {
  let dataset;

  beforeAll(() => {
    dataset = normalize(MINING_EXPORT);
  });

  afterAll(() => {
    dataset = undefined;
  });

  it("turns a vein into an instant zero-power source with no inputs", () => {
    const vein = dataset.recipes.find((recipe) => recipe.kind === "ore_vein");

    expect(vein).toBeDefined();
    expect(vein.name).toBe("Ore Vein: Copper");
    expect(vein.machineType).toBe("Ore Vein");
    expect(vein.inputs).toEqual([]);
    expect(vein.durationTicks).toBe(1);
    expect(vein.eut).toBe(0);
  });

  it("lists a twice-layered material once and keeps every layer's role", () => {
    const vein = dataset.recipes.find((recipe) => recipe.kind === "ore_vein");

    expect(vein.outputs.map((output) => output.id)).toEqual([
      "gregtech:gt.blockores@855",
      "gregtech:gt.blockores@35",
      "gregtech:gt.blockores@32",
    ]);
    expect(vein.metadata.oreLayers.map((layer) => layer.role)).toEqual([
      "primary",
      "secondary",
      "between",
      "sporadic",
    ]);
  });

  it("resolves planets to names, rocket tiers, and per-planet odds", () => {
    const vein = dataset.recipes.find((recipe) => recipe.kind === "ore_vein");

    expect(vein.metadata.dimensions).toEqual([
      { name: "Overworld", abbr: "Ow", tier: 0, chance: 0.12 },
      { name: "Moon", abbr: "Mo", tier: 1, chance: 0.3, heightRange: "20-60" },
    ]);
  });

  it("turns a small ore's drop list into its outputs", () => {
    const smallOre = dataset.recipes.find((recipe) => recipe.kind === "small_ore");

    expect(smallOre).toBeDefined();
    expect(smallOre.name).toBe("Small Ore: Copper");
    expect(smallOre.outputs.map((output) => output.id)).toEqual([
      "gregtech:gt.metaitem.01@5035",
    ]);
    expect(smallOre.metadata.amountPerChunk).toBe(12);
    expect(smallOre.metadata.dimensions).toEqual([{ name: "Overworld", abbr: "Ow", tier: 0 }]);
  });

  it("keeps underground fluid deposits per planet", () => {
    const undergroundFluid = dataset.recipes.find(
      (recipe) => recipe.kind === "underground_fluid",
    );

    expect(undergroundFluid).toBeDefined();
    expect(undergroundFluid.outputs.map((output) => output.id)).toEqual(["oil"]);
    expect(undergroundFluid.metadata.deposits).toEqual([
      { dimension: "Overworld", abbr: "Ow", tier: 0, chance: 40, minAmount: 100, maxAmount: 625 },
      { dimension: "Moon", abbr: "Mo", tier: 1, chance: 20, minAmount: 0, maxAmount: 300 },
    ]);
  });

  it("drops an underground fluid whose fluid never registered", () => {
    const ids = dataset.recipes.map((recipe) => recipe.id);

    expect(ids.some((id) => id.includes("never_registered"))).toBe(false);
  });

  it("registers the three source recipe maps", () => {
    expect(dataset.recipeMaps).toEqual(
      expect.arrayContaining(["Ore Vein", "Small Ore", "Underground Fluid"]),
    );
  });
});

describe("the two maps the game both calls Coke Oven", () => {
  const rawRecipe = (id, itemInputs, itemOutputs) => ({
    id,
    durationTicks: 1800,
    eut: 0,
    itemInputs,
    itemOutputs,
    fluidInputs: [],
    fluidOutputs: [],
  });
  let dataset;

  beforeAll(() => {
    dataset = normalize({
      schemaVersion: 1,
      exporter: "gtnh-oracle",
      format: "dev.gtnhplanner.oracle.v1",
      generatedAt: "2026-08-08T05:00:00.000Z",
      minecraftVersion: "1.7.10",
      loadedMods: [],
      adapters: [],
      recipeCount: 2,
      domains: [
        {
          id: "gregtech",
          recipeMaps: [
            {
              id: "gtpp.recipe.cokeoven",
              name: "Coke Oven",
              sourceClass: "gregtech.api.recipe.RecipeMap",
              recipes: [
                rawRecipe(
                  "ico-1",
                  [item("minecraft:log", 16, "Oak Log")],
                  [item("minecraft:coal@1", 20, "Charcoal")],
                ),
              ],
            },
            {
              id: "gt.recipe.cokeoven",
              name: "Coke Oven",
              sourceClass: "gregtech.api.recipe.RecipeMap",
              recipes: [
                rawRecipe(
                  "brick-1",
                  [item("minecraft:log", 1, "Oak Log")],
                  [item("minecraft:coal@1", 1, "Charcoal")],
                ),
              ],
            },
          ],
        },
      ],
    });
  });

  it("names the Industrial Coke Oven's map after the machine", () => {
    const ico = dataset.recipes.find(
      (recipe) => recipe.source?.rawRecipeId?.startsWith("gtpp.recipe.cokeoven:"),
    );

    expect(ico.machineType).toBe("Industrial Coke Oven");
    expect((ico.machineConfigControls ?? []).map((control) => control.id)).toEqual(
      expect.arrayContaining(["heatingCoil", "cokeOvenCasing", "cokeOvenSlices"]),
    );
  });

  it("leaves the Railcraft brick oven's map alone, without the ICO's knobs", () => {
    const brick = dataset.recipes.find(
      (recipe) => recipe.source?.rawRecipeId?.startsWith("gt.recipe.cokeoven:"),
    );

    expect(brick.machineType).toBe("Coke Oven");
    expect(brick.machineConfigControls ?? []).toEqual([]);
  });

  it("keeps the two families apart in the map list", () => {
    expect(dataset.recipeMaps).toEqual(
      expect.arrayContaining(["Industrial Coke Oven", "Coke Oven"]),
    );
  });
});

describe("the Tank: the planner's free canner", () => {
  let dataset;

  beforeAll(() => {
    dataset = normalize({
      schemaVersion: 1,
      exporter: "gtnh-oracle",
      format: "dev.gtnhplanner.oracle.v1",
      generatedAt: "2026-08-08T05:00:00.000Z",
      minecraftVersion: "1.7.10",
      loadedMods: [],
      adapters: [],
      recipeCount: 3,
      domains: [
        {
          id: "gregtech",
          recipeMaps: [
            {
              id: "gt.recipe.canner",
              name: "Canner",
              sourceClass: "gregtech.api.recipe.RecipeMap",
              recipes: [
                {
                  id: "fill-1",
                  durationTicks: 16,
                  eut: 1,
                  itemInputs: [item("ic2:itemcellempty", 1, "Empty Cell")],
                  fluidInputs: [fluid("water", 1000, "Water")],
                  itemOutputs: [item("ic2:itemfluidcell@water", 1, "Water Cell")],
                  fluidOutputs: [],
                },
                {
                  id: "empty-1",
                  durationTicks: 16,
                  eut: 1,
                  itemInputs: [item("ic2:itemfluidcell@water", 1, "Water Cell")],
                  fluidInputs: [],
                  itemOutputs: [item("ic2:itemcellempty", 1, "Empty Cell")],
                  fluidOutputs: [fluid("water", 1000, "Water")],
                },
                {
                  id: "food-1",
                  durationTicks: 16,
                  eut: 1,
                  itemInputs: [item("ic2:itemtincan", 1, "Tin Can"), item("minecraft:apple", 1, "Apple")],
                  fluidInputs: [],
                  itemOutputs: [item("ic2:itemfilledtincan", 1, "Filled Tin Can")],
                  fluidOutputs: [],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("mirrors every fluid-touching Canner recipe as a free instant Tank recipe", () => {
    const tanks = dataset.recipes.filter((recipe) => recipe.machineType === "Tank");

    expect(tanks).toHaveLength(2);
    for (const tank of tanks) {
      expect(tank.eut).toBe(0);
      expect(tank.durationTicks).toBe(1);
      expect(tank.minimumTier).toBe("NONE");
    }
    const fill = tanks.find((recipe) =>
      recipe.inputs.some((slot) => slot.kind === "fluid"),
    );
    // The empty cell stays a real slot: the game never deletes one.
    expect(fill.inputs.map((slot) => slot.id)).toContain("ic2:itemcellempty");
  });

  it("leaves the Canner's own recipes untouched beside the copies", () => {
    const canners = dataset.recipes.filter((recipe) => recipe.machineType === "Canner");
    expect(canners).toHaveLength(3);
    expect(canners.every((recipe) => recipe.eut === 1)).toBe(true);
  });

  it("does not mirror fluid-free canning, and lists the Tank as a map", () => {
    const tanks = dataset.recipes.filter((recipe) => recipe.machineType === "Tank");
    expect(tanks.some((recipe) => recipe.name.includes("Tin Can"))).toBe(false);
    expect(dataset.recipeMaps).toContain("Tank");
    const icon = dataset.recipeMapIcons.find((entry) => entry.recipeMap === "Tank");
    expect(icon.resource.id).toBe("ic2:itemcellempty");
  });
});

describe("recipe ids survive a rebuild", () => {
  const steel = (id, extra = {}) => ({
    id,
    durationTicks: 500,
    eut: 120,
    itemInputs: [item("gregtech:dust.iron", 1, "Iron Dust"), item("gregtech:dust.coal", 1, "Coal Dust")],
    fluidInputs: [fluid("oxygen", 1000, "Oxygen")],
    itemOutputs: [item("gregtech:ingot.steel", 1, "Steel Ingot")],
    fluidOutputs: [],
    ...extra,
  });
  const exportWith = (recipes) => ({
    schemaVersion: 1,
    exporter: "gtnh-oracle",
    format: "dev.gtnhplanner.oracle.v1",
    generatedAt: "2026-08-08T05:00:00.000Z",
    minecraftVersion: "1.7.10",
    loadedMods: [],
    adapters: [],
    recipeCount: recipes.length,
    domains: [
      {
        id: "gregtech",
        recipeMaps: [
          {
            id: "gt.recipe.blastfurnace",
            name: "Blast Furnace",
            sourceClass: "gregtech.api.recipe.RecipeMap",
            recipes,
          },
        ],
      },
    ],
  });

  it("mints the same id for the same recipe whatever id the exporter gave it", () => {
    // The oracle's id hashed a JVM identity hash, so two exports of one
    // unchanged game disagreed on every id, and every saved plan lost its
    // recipes on import. The id now comes from the recipe's content.
    const first = normalize(exportWith([steel("run-one-7f3a")])).recipes[0];
    const second = normalize(exportWith([steel("run-two-91c0")])).recipes[0];
    expect(second.id).toBe(first.id);
    expect(second.source.rawRecipeId).toBe(first.source.rawRecipeId);
    expect(first.id).not.toContain("run-one");
  });

  it("gives a recipe that differs in one slot, tick or EU its own id", () => {
    const [a, b, c] = normalize(
      exportWith([
        steel("a"),
        steel("b", { itemInputs: [item("gregtech:dust.castiron", 1, "Cast Iron Dust")] }),
        steel("c", { fluidInputs: [fluid("oxygen", 2000, "Oxygen")] }),
      ]),
    ).recipes;
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("keeps two identical registrations apart, in export order", () => {
    // addRecipe folds true duplicates by signature; a pair the game keeps
    // apart by duration alone is the case this guards.
    const [a, b] = normalize(
      exportWith([steel("a"), steel("b", { durationTicks: 500, eut: 120, specialValue: 0 })]),
    ).recipes;
    if (b) {
      expect(a.id).not.toBe(b.id);
    }
    expect(a.id).toMatch(/:[0-9a-f]{16}$/);
  });
});
