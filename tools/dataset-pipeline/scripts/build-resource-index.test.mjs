import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const normalizeScript = fileURLToPath(new URL("./normalize-oracle-export.mjs", import.meta.url));
const resourceIndexScript = fileURLToPath(new URL("./build-resource-index.mjs", import.meta.url));

/** Both scripts work at import time, so they run as the pipeline runs them: normalize, then index. */
function normalizeAndIndex(rawExport) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resource-index-"));
  const input = path.join(dir, "oracle-export.json");
  const output = path.join(dir, "recipes.json");
  fs.writeFileSync(input, JSON.stringify(rawExport));
  const env = { ...process.env, GTNH_DATASET_VERSION_ID: "test-fixture", GTNH_DATASET_VERSION_LABEL: "test" };
  execFileSync(process.execPath, [normalizeScript, input, output], { env, stdio: "pipe" });
  execFileSync(process.execPath, [resourceIndexScript, output], { env, stdio: "pipe" });
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

const ASH = "gregtech:gt.metaitem.01@2815";

/**
 * Two GTNH recipes that both take plain Water. The Chemical Reactor's
 * Fertilizer recipe registers Distilled Water as a substitute for its Water
 * (`mAltFluidInputs`); the Distillery's Water to Distilled Water recipe takes
 * Water and nothing else. The Fertilizer's ash slot is an ore dictionary group,
 * which IS a property of the item and belongs in the index.
 */
const RAW_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-10-16T12:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 2,
  domains: [
    {
      id: "gregtech",
      recipeMaps: [
        {
          id: "gt.recipe.chemicalreactor",
          name: "Chemical Reactor",
          sourceClass: "gregtech.api.recipe.RecipeMap",
          catalysts: [],
          recipes: [
            {
              id: "fertilizer",
              enabled: true,
              durationTicks: 200,
              eut: 30,
              itemInputs: [
                item("gregtech:gt.metaitem.01@2823", 1, "Calcite Dust"),
                {
                  kind: "oreDictionary",
                  names: ["dustAsh"],
                  amount: 3,
                  alternatives: [item(ASH, 3, "Ashes"), item("forestry:ash", 3, "Ash")],
                },
              ],
              itemOutputs: [item("cropsnh:fertilizer", 1, "Fertilizer")],
              fluidInputs: [
                {
                  ...fluid("water", 1000, "Water"),
                  alternatives: [fluid("water", 1000, "Water"), fluid("ic2distilledwater", 1000, "Distilled Water")],
                },
              ],
              fluidOutputs: [],
              nonConsumedInputs: [],
            },
          ],
        },
        {
          id: "gt.recipe.distillery",
          name: "Distillery",
          sourceClass: "gregtech.api.recipe.RecipeMap",
          catalysts: [],
          recipes: [
            {
              id: "distilled-water",
              enabled: true,
              durationTicks: 25,
              eut: 7,
              itemInputs: [],
              itemOutputs: [],
              fluidInputs: [fluid("water", 10, "Water")],
              fluidOutputs: [fluid("ic2distilledwater", 10, "Distilled Water")],
              nonConsumedInputs: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("the resource index keeps a slot's substitutes on its recipe", () => {
  let dataset;

  beforeAll(() => {
    dataset = normalizeAndIndex(RAW_EXPORT);
  });

  afterAll(() => {
    dataset = undefined;
  });

  const recipeFor = (output) =>
    dataset.recipes.find((recipe) => recipe.outputs.some((entry) => entry.id === output));
  const indexed = (kind, id) =>
    dataset.resourceIndex.find((entry) => entry.kind === kind && entry.id === id);

  it("gives Water no alternatives, so no Water slot is served Distilled Water", () => {
    // The server hands every slot without choices of its own the index entry's
    // (hydrateResource). Water carrying the Fertilizer slot's Distilled Water
    // made the Distillery read Distilled Water to Distilled Water.
    expect(indexed("fluid", "water")).toBeDefined();
    expect(indexed("fluid", "water").alternatives).toBeUndefined();
  });

  it("keeps the Distillery on Water alone", () => {
    const distillery = recipeFor("ic2distilledwater");

    expect(distillery.inputs.map((input) => [input.id, input.alternatives])).toEqual([
      ["water", undefined],
    ]);
  });

  it("still lets the Fertilizer slot take Distilled Water", () => {
    const water = recipeFor("cropsnh:fertilizer").inputs.find((input) => input.id === "water");

    expect(water.alternatives?.map((entry) => entry.id)).toEqual(["water", "ic2distilledwater"]);
  });

  it("keeps an ore dictionary group's members, which belong to the item", () => {
    expect(indexed("item", "oredict:dustAsh")?.alternatives?.map((entry) => entry.id)).toEqual([
      ASH,
      "forestry:ash",
    ]);
  });
});
