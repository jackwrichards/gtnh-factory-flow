import { describe, expect, it } from "vitest";
import { factoryProjectSchema } from "@/lib/model/schemas";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import { getResourceKey } from "@/lib/model/resources";
import { calculateThroughput } from "@/lib/solver/throughput";
import type { GapFillPlan, RecipeProducerLookup } from "./types";
import { solveGapFill } from "./gap-solver";
import {
  GAP_FILL_COLUMN_PITCH,
  materializeGapFillPlan,
  REQUEST_DEMAND_HANDLE,
  STOCKPILE_SUPPLY_HANDLE,
} from "./materialize";

const recipes: Recipe[] = [
  {
    id: "lcr-pe-oxygen",
    name: "LCR: Polyethylene",
    machineType: "Large Chemical Reactor",
    minimumTier: "HV",
    durationTicks: 20,
    eut: 480,
    inputs: [
      { kind: "fluid", id: "ethylene", amount: 144, displayName: "Ethylene" },
      { kind: "fluid", id: "oxygen", amount: 1000, displayName: "Oxygen" },
    ],
    outputs: [{ kind: "fluid", id: "polyethylene", amount: 216, displayName: "Polyethylene" }],
  },
  {
    id: "distillery-ethylene",
    name: "Distillery: Ethylene",
    machineType: "Distillery",
    minimumTier: "MV",
    durationTicks: 20,
    eut: 120,
    inputs: [{ kind: "fluid", id: "ethanol", amount: 1000, displayName: "Ethanol" }],
    outputs: [{ kind: "fluid", id: "ethylene", amount: 300, displayName: "Ethylene" }],
  },
  {
    id: "fermenter-ethanol",
    name: "Fermenter: Ethanol",
    machineType: "Fermenter",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "fluid", id: "biomass", amount: 1000, displayName: "Biomass" }],
    outputs: [{ kind: "fluid", id: "ethanol", amount: 600, displayName: "Ethanol" }],
  },
  {
    id: "electrolyzer-water",
    name: "Electrolyzer: Water",
    machineType: "Electrolyzer",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "fluid", id: "water", amount: 1000, displayName: "Water" }],
    outputs: [
      { kind: "fluid", id: "hydrogen", amount: 1000, displayName: "Hydrogen" },
      { kind: "fluid", id: "oxygen", amount: 500, displayName: "Oxygen" },
    ],
  },
  {
    id: "coke-oven-log",
    name: "Coke Oven: Charcoal",
    machineType: "Coke Oven",
    minimumTier: "ULV",
    durationTicks: 20,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "oredict:logWood",
        amount: 1,
        displayName: "Any Log",
        alternatives: [{ kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" }],
      },
    ],
    outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 1, displayName: "Charcoal" }],
  },
];

function lookup(): RecipeProducerLookup {
  const byOutputKey = new Map<string, Recipe[]>();
  for (const entry of recipes) {
    for (const output of entry.outputs) {
      const key = getResourceKey(output);
      byOutputKey.set(key, [...(byOutputKey.get(key) ?? []), entry]);
    }
  }

  return { getProducers: (resource) => byOutputKey.get(getResourceKey(resource)) ?? [] };
}

function projectWithGoal(overrides: Partial<FactoryProject> = {}): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "materialize-test",
    name: "Materialize test",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    stockpiles: [
      {
        id: "stockpile-1",
        resources: [
          { kind: "fluid", id: "biomass", displayName: "Biomass" },
          { kind: "fluid", id: "water", displayName: "Water" },
          { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" },
        ],
        position: { x: -600, y: 0 },
      },
    ],
    requests: [
      {
        id: "request-pe",
        kind: "fluid",
        resourceId: "polyethylene",
        displayName: "Polyethylene",
        amountPerSecond: 216,
        position: { x: 600, y: 0 },
      },
    ],
    ...overrides,
  };
}

describe("materializeGapFillPlan", () => {
  it("materializes a solved plan into a closed, running factory", async () => {
    const project = projectWithGoal();
    const solved = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 216 },
        supply: project.stockpiles![0].resources.map((resource) => ({
          ...resource,
          stockpileId: "stockpile-1",
        })),
      },
      lookup(),
    );

    const plan = solved.plans[0] as GapFillPlan<Recipe>;
    expect(plan.closed).toBe(true);

    const materialized = materializeGapFillPlan(project, "stockpile-1", "request-pe", plan);
    expect(materialized.newNodeIds).toHaveLength(4);

    // The verification loop this feature stands on: the real solver agrees
    // that nothing is missing once the plan lands on the canvas.
    const throughput = calculateThroughput(materialized.project);
    expect(throughput.externalInputs).toHaveLength(0);
    expect(
      throughput.unconsumedOutputs.map((balance) => balance.key),
    ).toContain("fluid:polyethylene");

    // Root feeds the request and runs balanced at the requested rate.
    const rootResult = throughput.nodes[materialized.rootNodeId!];
    expect(rootResult?.requiredRatePerSecond).toBeCloseTo(216, 5);
    expect(rootResult?.status).toBe("balanced");

    // The oxygen electrolyzer needs two machines for 1000 L/s.
    const electrolyzerNode = materialized.project.nodes.find(
      (node) => node.recipeId === "electrolyzer-water",
    );
    expect(electrolyzerNode?.machineCount).toBe(2);

    // Supply edges anchor on the stockpile handle; the goal edge on the request.
    const supplyEdges = materialized.project.edges.filter(
      (edge) => edge.source === "stockpile-1",
    );
    expect(supplyEdges).toHaveLength(2);
    expect(supplyEdges.every((edge) => edge.sourceHandle === STOCKPILE_SUPPLY_HANDLE)).toBe(true);
    const requestEdge = materialized.project.edges.find((edge) => edge.target === "request-pe");
    expect(requestEdge?.targetHandle).toBe(REQUEST_DEMAND_HANDLE);
    expect(requestEdge?.source).toBe(materialized.rootNodeId);

    // Layered layout: root one column left of the request, leaves further out.
    const requestX = 600;
    const rootNode = materialized.project.nodes.find(
      (node) => node.id === materialized.rootNodeId,
    );
    expect(rootNode?.position.x).toBe(requestX - GAP_FILL_COLUMN_PITCH);
    const fermenterNode = materialized.project.nodes.find(
      (node) => node.recipeId === "fermenter-ethanol",
    );
    expect(fermenterNode?.position.x).toBe(requestX - 3 * GAP_FILL_COLUMN_PITCH);

    // The whole thing still fits the persisted-project schema.
    expect(() => factoryProjectSchema.parse(materialized.project)).not.toThrow();
  });

  it("pins concrete oredict members chosen from the stockpile", async () => {
    const project = projectWithGoal({
      requests: [
        {
          id: "request-charcoal",
          kind: "item",
          resourceId: "minecraft:coal@1",
          displayName: "Charcoal",
          amountPerSecond: 1,
          position: { x: 600, y: 0 },
        },
      ],
    });
    const solved = await solveGapFill(
      {
        target: { kind: "item", id: "minecraft:coal@1", displayName: "Charcoal", amountPerSecond: 1 },
        supply: project.stockpiles![0].resources.map((resource) => ({
          ...resource,
          stockpileId: "stockpile-1",
        })),
      },
      lookup(),
    );

    const plan = solved.plans[0] as GapFillPlan<Recipe>;
    expect(plan.closed).toBe(true);

    const materialized = materializeGapFillPlan(project, "stockpile-1", "request-charcoal", plan);
    const cokeNode = materialized.project.nodes.find((node) => node.recipeId === "coke-oven-log");
    expect(cokeNode?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({ kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" }),
    );

    const throughput = calculateThroughput(materialized.project);
    expect(throughput.externalInputs).toHaveLength(0);
  });

  it("wires a zero-step tap plan straight from the existing producer", async () => {
    const creativePe: Recipe = {
      id: "creative-pe",
      name: "Creative: Polyethylene",
      machineType: "Creative Tank",
      minimumTier: "ULV",
      durationTicks: 20,
      eut: 0,
      inputs: [],
      outputs: [{ kind: "fluid", id: "polyethylene", amount: 400, displayName: "Polyethylene" }],
    };
    const project = projectWithGoal({
      recipes: [creativePe],
      nodes: [
        {
          id: "node-existing",
          recipeId: creativePe.id,
          machineCount: 1,
          parallel: 1,
          overclockTier: "ULV",
          enabled: true,
          position: { x: 0, y: -300 },
        },
      ],
      requests: [
        {
          id: "request-pe",
          kind: "fluid",
          resourceId: "polyethylene",
          displayName: "Polyethylene",
          amountPerSecond: 100,
          position: { x: 600, y: 0 },
        },
      ],
    });

    const solved = await solveGapFill(
      {
        target: { kind: "fluid", id: "polyethylene", displayName: "Polyethylene", amountPerSecond: 100 },
        supply: [],
        existingOutputs: [
          {
            kind: "fluid",
            id: "polyethylene",
            displayName: "Polyethylene",
            nodeId: "node-existing",
            availablePerSecond: 400,
          },
        ],
      },
      lookup(),
    );

    const tapPlan = solved.plans.find((plan) => plan.steps.length === 0) as GapFillPlan<Recipe>;
    expect(tapPlan).toBeDefined();

    const materialized = materializeGapFillPlan(project, "stockpile-1", "request-pe", tapPlan);
    expect(materialized.newNodeIds).toHaveLength(0);
    expect(materialized.touchedExistingNodeIds).toEqual(["node-existing"]);

    const edge = materialized.project.edges.find((entry) => entry.target === "request-pe");
    expect(edge?.source).toBe("node-existing");

    const throughput = calculateThroughput(materialized.project);
    expect(throughput.edges[edge!.id]?.transferredPerSecond).toBeCloseTo(100, 5);
  });
});
