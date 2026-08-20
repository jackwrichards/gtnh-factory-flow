import { describe, expect, it } from "vitest";
import type { FactoryNode, FactoryProject, Recipe, ThroughputResult } from "@/lib/model/types";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import { computeCommunityPlanStats } from "./plan-stats";

function makeNode(overrides: Partial<FactoryNode>): FactoryNode {
  return {
    id: "node-1",
    recipeId: "recipe-1",
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeProject(nodes: FactoryNode[], recipes: Recipe[] = []): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "project-1",
    name: "Test plan",
    recipes,
    nodes,
    storages: [],
    edges: [],
  };
}

/** A CropsNH crop card: `machineCount` on its node means planted crops. */
function makeCropRecipe(id: string): Recipe {
  return {
    id,
    name: "Crop Farm: Oilberry",
    kind: "crop_produce",
    machineType: "Crop Manager",
    minimumTier: "NONE",
    durationTicks: 256,
    eut: 0,
    inputs: [],
    outputs: [],
    source: { recipeMap: "Crop Farm" },
    metadata: {
      cropsNh: {
        tier: 8,
        growthPoints: 2200,
        dropChance: 1,
        drops: [{ id: "item:oilberry", stackSize: 1, weight: 10000 }],
      },
    },
  };
}

function makeResult(overrides: Partial<ThroughputResult>): ThroughputResult {
  return {
    nodes: {},
    storages: {},
    resources: {},
    edges: {},
    totalEuT: 0,
    totalEuPerSecond: 0,
    bottlenecks: [],
    externalInputs: [],
    unconsumedOutputs: [],
    generatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("computeCommunityPlanStats", () => {
  it("sums machines and finds the highest voltage tier across enabled nodes", () => {
    const project = makeProject([
      makeNode({ id: "a", machineCount: 3, overclockTier: "LV" }),
      makeNode({ id: "b", machineCount: 2, overclockTier: "EV" }),
      makeNode({ id: "c", machineCount: 4, overclockTier: "HV", enabled: false }),
    ]);

    const stats = computeCommunityPlanStats(project, makeResult({ totalEuT: 1234 }));

    expect(stats.machineCount).toBe(5);
    expect(stats.highestTier).toBe("EV");
    expect(stats.highestTierIndex).toBeGreaterThan(0);
    expect(stats.nodeCount).toBe(3);
    expect(stats.totalEuT).toBe(1234);
  });

  it("counts crop cards by the harvesters their crops fill, not by seeds", () => {
    const project = makeProject(
      [
        // 50 oilberries under an LV Crop Manager (605 sticks per layer x 5):
        // one machine to build, not fifty.
        makeNode({
          id: "managed",
          recipeId: "crop-1",
          machineCount: 50,
          overclockTier: "NONE",
          machineHandlerId: "crop-manager",
          machineConfigTiers: { cropManagerTier: "1" },
        }),
        // Hand-picked sticks build nothing at all.
        makeNode({
          id: "by-hand",
          recipeId: "crop-1",
          machineCount: 20,
          overclockTier: "NONE",
        }),
        // An ordinary machine card still counts as itself.
        makeNode({ id: "machine", recipeId: "recipe-1", machineCount: 3 }),
      ],
      [makeCropRecipe("crop-1")],
    );

    const stats = computeCommunityPlanStats(project, makeResult({}));

    expect(stats.machineCount).toBe(4);
  });

  it("ignores unknown tier strings instead of crashing", () => {
    const project = makeProject([makeNode({ overclockTier: "Coil: Nichrome" })]);

    const stats = computeCommunityPlanStats(project, makeResult({}));

    expect(stats.highestTier).toBeUndefined();
    expect(stats.highestTierIndex).toBe(-1);
  });

  it("maps external inputs to needs and surpluses to outputs, sorted by rate", () => {
    const balance = {
      kind: "item" as const,
      producedPerSecond: 0,
      consumedPerSecond: 0,
      netPerSecond: 0,
      surplusPerSecond: 0,
      deficitPerSecond: 0,
      importedPerSecond: 0,
      productPerSecond: 0,
      byproductPerSecond: 0,
      bufferFillPerSecond: 0,
    };
    const result = makeResult({
      externalInputs: [
        { ...balance, key: "item:iron", resourceId: "iron", consumedPerSecond: 2 },
        { ...balance, key: "item:copper", resourceId: "copper", consumedPerSecond: 8 },
        { ...balance, key: "item:noop", resourceId: "noop" },
      ],
      unconsumedOutputs: [
        { ...balance, key: "item:steel", resourceId: "steel", surplusPerSecond: 4 },
      ],
    });

    const stats = computeCommunityPlanStats(makeProject([]), result);

    expect(stats.needs.map((need) => need.resourceId)).toEqual(["copper", "iron"]);
    expect(stats.outputs).toHaveLength(1);
    expect(stats.outputs[0]).toMatchObject({ resourceId: "steel", ratePerSecond: 4 });
  });
});
