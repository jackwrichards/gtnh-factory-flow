import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

/**
 * A slice of the generators domain the oracle exports from the live power
 * machines. Values are synthetic, chosen so every shaping rule is pinned:
 *
 *   Gas Turbine           per-fuel values on the fuel, an over-cap fuel
 *                         clamped to the LV grid (fuel and energy together),
 *                         a cell fuel with an empty container out
 *   Solar Generator       fuelless, entry-level period/eu; the in-game LV
 *                         unit's maxEUOutput() is overridden to 1, so an
 *                         LV machine feeds energy:ulv
 *   RTG                   one pellet per 24000-tick day, the entry's tier
 *                         follows the fuel's own output voltage - a slow
 *                         fuel (5 EU/t) sits below the LV floor and feeds
 *                         the ULV grid, where tier 0 is a real ordinal
 *   Large Fusion MK-IV    a combined burn: entry-level eu, two fuels (the
 *                         book carries their counts in `amount`), a plasma
 *                         byproduct in extraOutputs
 *   Nuclear Reactor       a fission entry flagged as the mSpecialValue
 *                         fallback
 *   UCFE                  a promoter fluid riding in as an extra input; the
 *                         entry's tier follows the fuel's 2048 EU/t (EV),
 *                         not the machine's own tier
 *   Boiler                an ordinary fuel + water -> steam production
 *                         recipe, no energy, no generator metadata
 *   Broken Generator      no usable catalysts: dropped with a warning
 */
const GENERATORS_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-08-18T05:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 0,
  domains: [
    {
      id: "generators",
      machines: [
        {
          id: "gas_turbine",
          name: "Gas Turbine",
          sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2301", 1, "LV Gas Turbine"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
              tier: 1,
            },
            {
              resource: item("gregtech:gt.blockmachines@2302", 1, "MV Gas Turbine"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
              tier: 2,
            },
          ],
          entries: [
            {
              tier: 1,
              fuels: [
                {
                  kind: "fluid",
                  id: "benzene",
                  amount: 1,
                  displayName: "Benzene",
                  periodTicks: 10,
                  consumedPerOperation: 4,
                  euPerOperation: 512,
                  maxEuT: 32,
                  containerOut: item("gregtech:gt.metaitem.unified@7000", 1, "Empty Cell"),
                },
              ],
            },
          ],
        },
        {
          id: "solar_generator",
          name: "Solar Generator",
          sourceClass: "gregtech.api.metatileentity.basic.MTESolarGenerator",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2030", 1, "LV Solar Generator"),
              sourceClass: "gregtech.api.metatileentity.basic.MTESolarGenerator",
              tier: 1,
            },
          ],
          entries: [
            { tier: 1, periodTicks: 20, maxEuT: 1, euPerOperation: 20, fuelless: true, fuels: [] },
          ],
        },
        {
          id: "rtg",
          name: "RTG",
          sourceClass: "gtplusplus.api.metatileentity.MTERTGenerator",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2900", 1, "RTG"),
              sourceClass: "gtplusplus.api.metatileentity.MTERTGenerator",
              tier: 1,
            },
          ],
          entries: [
            {
              tier: 1,
              fuels: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32766",
                  amount: 1,
                  displayName: "Uranium-235 Pellet",
                  periodTicks: 24000,
                  consumedPerOperation: 1,
                  euPerOperation: 288000,
                  maxEuT: 32,
                },
              ],
            },
            {
              tier: 0,
              fuels: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32770",
                  amount: 1,
                  displayName: "Plutonium-238 Pellet",
                  periodTicks: 24000,
                  consumedPerOperation: 1,
                  euPerOperation: 120000,
                  maxEuT: 5,
                },
              ],
            },
          ],
        },
        {
          id: "large_fusion_computer",
          name: "Large Fusion Computer",
          sourceClass: "goodgenerator.power.machine.MTELargeFusionComputer",
          catalysts: [
            {
              resource: item("goodgenerator:goodgenerator@104", 1, "Large Fusion Computer MK-IV"),
              sourceClass: "goodgenerator.power.machine.MTELargeFusionComputer",
              tier: 12,
            },
          ],
          entries: [
            {
              tier: 12,
              periodTicks: 100,
              maxEuT: 134217728,
              euPerOperation: 2500000,
              fuels: [
                fluid("deuterium", 4, "Deuterium"),
                fluid("tritium", 4, "Tritium"),
              ],
              extraOutputs: [item("gregtech:gt.metaitem.02@32400", 1, "Plasma Cell")],
            },
          ],
        },
        {
          id: "nuclear_reactor",
          name: "Nuclear Reactor",
          sourceClass: "gtplusplus.api.metatileentity.MTENuclearReactor",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2901", 1, "Nuclear Reactor"),
              sourceClass: "gtplusplus.api.metatileentity.MTENuclearReactor",
              tier: 8,
            },
          ],
          entries: [
            {
              tier: 8,
              source: "fission-fallback",
              fuels: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32768",
                  amount: 1,
                  displayName: "Uranium-235 Fuel Rod",
                  periodTicks: 10,
                  consumedPerOperation: 1,
                  euPerOperation: 102400,
                  maxEuT: 524288,
                },
              ],
            },
          ],
        },
        {
          id: "universal_chemical_fuel_engine",
          name: "Universal Chemical Fuel Engine",
          sourceClass: "goodgenerator.power.machine.MTEUniversalChemicalFuelEngineLegacy",
          catalysts: [
            {
              resource: item("goodgenerator:goodgenerator@64", 1, "Universal Chemical Fuel Engine"),
              sourceClass: "goodgenerator.power.machine.MTEUniversalChemicalFuelEngineLegacy",
              tier: 5,
            },
          ],
          entries: [
            {
              tier: 4,
              promoter: {
                kind: "fluid",
                id: "combustion_promoter",
                amount: 1,
                displayName: "Combustion Promoter",
                litersPerLiterFuel: 1,
              },
              fuels: [
                {
                  kind: "fluid",
                  id: "rocket_fuel",
                  amount: 1,
                  displayName: "Rocket Fuel",
                  periodTicks: 20,
                  consumedPerOperation: 2,
                  euPerOperation: 5120,
                  maxEuT: 2048,
                },
              ],
            },
          ],
        },
        {
          id: "boiler",
          name: "Boiler",
          sourceClass: "gregtech.api.metatileentity.basic.MTEBoiler",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2010", 1, "Bronze Boiler"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEBoiler",
              tier: 0,
            },
          ],
          entries: [
            {
              kind: "boiler",
              tier: 0,
              periodTicks: 10,
              steamPerOperation: 10,
              waterPerOperation: 10,
              measurementTicks: 2000,
              steam: fluid("steam", 1, "Steam"),
              water: fluid("water", 1, "Water"),
              fuels: [{ kind: "fluid", id: "crude_oil", amount: 1, displayName: "Crude Oil", consumedPerOperation: 0.5 }],
            },
          ],
        },
        {
          id: "broken_generator",
          name: "Broken Generator",
          sourceClass: "nowhere.MTEBrokenGenerator",
          catalysts: [],
          entries: [{ tier: 1, fuels: [] }],
        },
      ],
    },
  ],
};

describe("generators domain becomes recipes", () => {
  let dataset;

  beforeAll(() => {
    dataset = normalize(GENERATORS_EXPORT);
  });

  afterAll(() => {
    dataset = undefined;
  });

  it("turns a (machine, tier, fuel) entry into a zero-draw generator recipe", () => {
    const recipe = dataset.recipes.find((entry) => entry.id.endsWith("gas-turbine:lv-benzene"));

    expect(recipe).toBeDefined();
    expect(recipe.eut).toBe(0);
    expect(recipe.durationTicks).toBe(10);
    expect(recipe.minimumTier).toBe("LV");
    expect(recipe.machineType).toBe("Gas Turbine");
    expect(recipe.name).toBe("Gas Turbine: Benzene");
    // 512 EU per 10 ticks of benzene, but the LV grid takes 32 EU/t x 10 =
    // 320: the burn is clamped to what the grid accepts, fuel and energy
    // together (4 L x 320/512 = 2.5 L).
    expect(recipe.inputs).toEqual([
      { kind: "fluid", id: "benzene", amount: 2.5, displayName: "Benzene" },
    ]);
    expect(recipe.outputs.map((output) => [output.kind, output.id, output.amount])).toEqual([
      ["energy", "lv", 320],
      ["item", "gregtech:gt.metaitem.unified@7000", 1],
    ]);
    expect(recipe.metadata.generator).toEqual({
      machine: "Gas Turbine",
      tier: "LV",
      maxEuT: 32,
      periodTicks: 10,
      euPerOperation: 512,
      source: "oracle",
    });
  });

  it("lists the tiered variants as machine handler options", () => {
    const recipe = dataset.recipes.find((entry) => entry.id.endsWith("gas-turbine:lv-benzene"));

    expect(
      recipe.machineHandlers.map((handler) => [handler.label, handler.minimumTier, handler.id]),
    ).toEqual([
      ["LV Gas Turbine", "LV", "gas-turbine-lv"],
      ["MV Gas Turbine", "MV", "gas-turbine-mv"],
    ]);
  });

  it("derives the energy id from the live maxEUOutput, not the machine tier", () => {
    // The LV solar's maxEUOutput() is 1 (the game's own override), so an LV
    // machine feeds the ULV grid.
    const solar = dataset.recipes.find((entry) => entry.id.endsWith("solar-generator:lv-none"));

    expect(solar).toBeDefined();
    expect(solar.name).toBe("Solar Generator");
    expect(solar.minimumTier).toBe("LV");
    expect(solar.inputs).toEqual([]);
    expect(solar.durationTicks).toBe(20);
    expect(solar.outputs).toEqual([{ kind: "energy", id: "ulv", amount: 20, displayName: "Energy (ULV)" }]);
    expect(solar.machineHandlers).toBeUndefined();
  });

  it("burns one RTG pellet per 24000-tick day", () => {
    const rtg = dataset.recipes.find((entry) => entry.id.endsWith("rtg:lv-gregtech-gt-metaitem-01-32766"));

    expect(rtg).toBeDefined();
    expect(rtg.durationTicks).toBe(24000);
    expect(rtg.inputs).toEqual([
      { kind: "item", id: "gregtech:gt.metaitem.01@32766", amount: 1, displayName: "Uranium-235 Pellet" },
    ]);
    expect(rtg.outputs).toEqual([{ kind: "energy", id: "lv", amount: 288000, displayName: "Energy (LV)" }]);
  });

  it("feeds a slow RTG fuel to the ULV grid, where tier 0 is a real ordinal", () => {
    const pu238 = dataset.recipes.find((entry) =>
      entry.id.endsWith("rtg:ulv-gregtech-gt-metaitem-01-32770"),
    );

    expect(pu238).toBeDefined();
    expect(pu238.durationTicks).toBe(24000);
    expect(pu238.inputs).toEqual([
      { kind: "item", id: "gregtech:gt.metaitem.01@32770", amount: 1, displayName: "Plutonium-238 Pellet" },
    ]);
    // 120000 EU per day is 5 EU/t: below the LV floor, so the burn feeds
    // the ULV grid rather than the machine's own LV tier.
    expect(pu238.outputs).toEqual([
      { kind: "energy", id: "ulv", amount: 120000, displayName: "Energy (ULV)" },
    ]);
  });

  it("keeps a combined fusion burn as one recipe with both fuels and the plasma byproduct", () => {
    const fusion = dataset.recipes.find((entry) => entry.id.endsWith("large-fusion-computer:uxv-deuterium-tritium"));

    expect(fusion).toBeDefined();
    expect(fusion.durationTicks).toBe(100);
    expect(fusion.minimumTier).toBe("UXV");
    expect(fusion.name).toBe("Large Fusion Computer: Deuterium + Tritium");
    expect(fusion.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["deuterium", 4],
      ["tritium", 4],
    ]);
    expect(fusion.outputs.map((output) => [output.kind, output.id, output.amount])).toEqual([
      ["energy", "uxv", 2500000],
      ["item", "gregtech:gt.metaitem.02@32400", 1],
    ]);
  });

  it("flags the fission fallback in the entry's metadata", () => {
    const fission = dataset.recipes.find((entry) => entry.id.endsWith("nuclear-reactor:uv-gregtech-gt-metaitem-01-32768"));

    expect(fission).toBeDefined();
    expect(fission.durationTicks).toBe(10);
    expect(fission.outputs).toEqual([{ kind: "energy", id: "uv", amount: 102400, displayName: "Energy (UV)" }]);
    expect(fission.metadata.generator.source).toBe("fission-fallback");
  });

  it("scales the UCFE promoter to the (clamped) fuel input", () => {
    const ucfe = dataset.recipes.find((entry) => entry.id.endsWith("universal-chemical-fuel-engine:ev-rocket-fuel"));

    expect(ucfe).toBeDefined();
    expect(ucfe.durationTicks).toBe(20);
    expect(ucfe.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["rocket_fuel", 2],
      ["combustion_promoter", 2],
    ]);
    expect(ucfe.outputs).toEqual([{ kind: "energy", id: "ev", amount: 5120, displayName: "Energy (EV)" }]);
  });

  it("shapes boiler entries as ordinary production recipes", () => {
    const boiler = dataset.recipes.find((entry) => entry.id.endsWith("boiler:boiler-crude-oil"));

    expect(boiler).toBeDefined();
    expect(boiler.name).toBe("Boiler: Crude Oil");
    expect(boiler.eut).toBe(0);
    expect(boiler.durationTicks).toBe(10);
    expect(boiler.minimumTier).toBe("ULV");
    expect(boiler.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["water", 10],
      ["crude_oil", 0.5],
    ]);
    expect(boiler.outputs).toEqual([{ kind: "fluid", id: "steam", amount: 10, displayName: "Steam" }]);
    expect(boiler.metadata?.generator).toBeUndefined();
  });

  it("drops a machine without usable catalysts and says so in the report", () => {
    expect(dataset.recipes.filter((entry) => entry.machineType === "Broken Generator")).toEqual([]);
    expect(dataset.generators.warnings).toEqual([
      "generators: Broken Generator exported no usable catalysts; machine dropped",
    ]);
    expect(dataset.generators.machines.map((machine) => machine.id)).not.toContain("broken_generator");
    expect(dataset.generators.machines.map((machine) => [machine.id, machine.entryCount])).toEqual([
      ["gas_turbine", 1],
      ["solar_generator", 1],
      ["rtg", 2],
      ["large_fusion_computer", 1],
      ["nuclear_reactor", 1],
      ["universal_chemical_fuel_engine", 1],
      ["boiler", 1],
    ]);
  });

  it("adds the energy resources to the catalog without icons", () => {
    const energy = dataset.resources
      .filter((entry) => entry.kind === "energy")
      .map((entry) => [entry.id, entry.displayName, entry.iconPath])
      .sort();

    expect(energy).toEqual([
      ["ev", "Energy (EV)", undefined],
      ["lv", "Energy (LV)", undefined],
      ["ulv", "Energy (ULV)", undefined],
      ["uv", "Energy (UV)", undefined],
      ["uxv", "Energy (UXV)", undefined],
    ]);
  });

  it("registers every generator machine as a recipe map", () => {
    expect(dataset.recipeMaps).toEqual(
      expect.arrayContaining([
        "Gas Turbine",
        "Solar Generator",
        "RTG",
        "Large Fusion Computer",
        "Nuclear Reactor",
        "Universal Chemical Fuel Engine",
        "Boiler",
      ]),
    );
  });
});
