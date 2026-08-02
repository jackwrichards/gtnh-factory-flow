import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import { parseDatasetManifestJson, parseRecipeDatasetJson } from "./dataset-json";
import { parseFactoryProjectJson, serializeFactoryProject } from "./factory-json";

describe("factory JSON import/export", () => {
  it("round-trips the biodiesel demo through the public schema", () => {
    const project = loadBiodieselDemoProject();
    const json = serializeFactoryProject(project);
    const parsed = parseFactoryProjectJson(json);

    expect(parsed.name).toBe(project.name);
    expect(parsed.recipes).toHaveLength(7);
    expect(parsed.nodes).toHaveLength(7);
    expect(parsed.metadata?.isDemo).toBe(true);
  });

  it("reports invalid JSON and invalid factory data", () => {
    expect(() => parseFactoryProjectJson("{")).toThrow(/Invalid JSON/);
    expect(() =>
      parseFactoryProjectJson(
        JSON.stringify({
          schemaVersion: 1,
          id: "bad",
          name: "",
          recipes: [],
          nodes: [],
          edges: [],
          fuelProfiles: [],
        }),
      ),
    ).toThrow(/Invalid factory project/);
  });

  it("accepts recipes with zero outputs (unpicked crop-farm placeholder)", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "crop-placeholder",
        name: "Crop placeholder plan",
        recipes: [
          {
            id: "factoryflow:crop-farm:empty",
            name: "Crop Farm",
            machineType: "Crop Farm",
            minimumTier: "ULV",
            durationTicks: 256,
            eut: 0,
            inputs: [],
            outputs: [],
          },
        ],
        nodes: [
          {
            id: "node-crop",
            recipeId: "factoryflow:crop-farm:empty",
            machineCount: 1,
            parallel: 1,
            overclockTier: "ULV",
            enabled: true,
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.recipes[0]?.outputs).toEqual([]);
  });

  it("normalizes hidden fractional recipe parallelism to one operation", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "fractional-parallel",
        name: "Fractional parallel",
        recipes: [],
        nodes: [
          {
            id: "node-1",
            recipeId: "recipe-1",
            machineCount: 1,
            parallel: 0.01,
            overclockTier: "HV",
            enabled: true,
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.nodes[0]?.parallel).toBe(1);
  });

  it("accepts zero output machine config tiers for disabled production states", () => {
    const project = parseFactoryProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "zero-output-control",
        name: "Zero output control",
        recipes: [
          {
            id: "bee-recipe",
            name: "Bee Produce: Test Bee",
            machineType: "Apiary",
            minimumTier: "NONE",
            durationTicks: 550,
            eut: 0,
            inputs: [{ kind: "item", id: "factoryflow:bee_species:test", amount: 1 }],
            outputs: [{ kind: "item", id: "test:comb", amount: 1 }],
            machineConfigControls: [
              {
                id: "beeEnvironment",
                label: "Climate",
                minimumKey: "wrong",
                defaultKey: "preferred",
                tiers: [
                  {
                    key: "wrong",
                    label: "Wrong",
                    outputMultiplier: 0,
                    resource: {
                      kind: "item",
                      id: "factoryflow:bee_environment_wrong",
                      amount: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
        nodes: [],
        edges: [],
        fuelProfiles: [],
      }),
    );

    expect(project.recipes[0]?.machineConfigControls?.[0]?.tiers[0]?.outputMultiplier).toBe(0);
  });

  it("validates normalized recipe datasets", () => {
    const dataset = parseRecipeDatasetJson(
      JSON.stringify({
        schemaVersion: 1,
        datasetVersionId: "gtnh-test",
        gtnhVersion: "test",
        sourceInfo: {
          sourceId: "nesql",
          generatedAt: "2026-05-19T00:00:00.000Z",
        },
        resources: [
          {
            id: "item:gregtech:test",
            kind: "item",
            displayName: "Test Dust",
          },
        ],
        recipes: [
          {
            id: "recipe-test",
            name: "Test Dust",
            machineType: "Macerator",
            minimumTier: "LV",
            durationTicks: 200,
            eut: 30,
            inputs: [{ kind: "item", id: "ore:test", amount: 1 }],
            outputs: [{ kind: "item", id: "item:gregtech:test", amount: 2 }],
            source: {
              datasetVersionId: "gtnh-test",
              recipeMap: "macerator",
              exporter: "nesql",
            },
          },
        ],
        oreDictionary: {},
        recipeMaps: ["macerator"],
        generatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );

    expect(dataset.sourceInfo.sourceId).toBe("nesql");
    expect(dataset.recipes[0]?.source?.recipeMap).toBe("macerator");
  });

  it("validates dataset manifests with version metadata", () => {
    const manifest = parseDatasetManifestJson(
      JSON.stringify({
        schemaVersion: 1,
        latestStableVersion: "gtnh-2.7.4",
        versions: [
          {
            id: "gtnh-2.7.4",
            gtnhVersion: "2.7.4",
            channel: "stable",
            publishedAt: "2026-05-19T00:00:00.000Z",
            manifestPath: "/datasets/gtnh/datasets.manifest.json",
            recipeDatasetPath: "/datasets/gtnh/2.7.4/recipes.json",
            sourceInfo: {
              sourceId: "nesql",
              generatedAt: "2026-05-19T00:00:00.000Z",
            },
          },
        ],
      }),
    );

    expect(manifest.latestStableVersion).toBe("gtnh-2.7.4");
    expect(manifest.versions[0]?.recipeDatasetPath).toBe("/datasets/gtnh/2.7.4/recipes.json");
  });
});
