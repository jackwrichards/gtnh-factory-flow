import { describe, expect, it } from "vitest";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";
import { optimizeMachineCountsForProject } from "./machine-count-optimizer";

const electrolyzer: Recipe = {
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
};

const cokeOven: Recipe = {
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
};

function baseProject(overrides: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "stockpile-request-test",
    name: "Stockpile/request test",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...overrides,
  };
}

function electrolyzerProject(overrides: Partial<FactoryProject> = {}): FactoryProject {
  return baseProject({
    recipes: [electrolyzer],
    nodes: [
      {
        id: "node-electrolyzer",
        recipeId: electrolyzer.id,
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ],
    ...overrides,
  });
}

describe("stockpile supply", () => {
  it("keeps an unfed input on the needs list", () => {
    const result = calculateThroughput(electrolyzerProject());

    expect(result.externalInputs.map((balance) => balance.key)).toContain("fluid:water");
  });

  it("closes a need when the input is fed from a stockpile", () => {
    const result = calculateThroughput(
      electrolyzerProject({
        stockpiles: [
          {
            id: "stockpile-1",
            resources: [{ kind: "fluid", id: "water", displayName: "Water" }],
            position: { x: -400, y: 0 },
          },
        ],
        edges: [
          {
            id: "edge-water",
            source: "stockpile-1",
            target: "node-electrolyzer",
            resourceKind: "fluid",
            resourceId: "water",
            label: "Water",
          },
        ],
      }),
    );

    expect(result.externalInputs.map((balance) => balance.key)).not.toContain("fluid:water");
    expect(result.edges["edge-water"]?.transferredPerSecond).toBeCloseTo(1000, 5);
    expect(result.edges["edge-water"]?.constraint).toBe("full");
  });

  it("books stockpile supply under an oredict input's own key", () => {
    const result = calculateThroughput(
      baseProject({
        recipes: [cokeOven],
        nodes: [
          {
            id: "node-coke",
            recipeId: cokeOven.id,
            machineCount: 1,
            parallel: 1,
            overclockTier: "ULV",
            enabled: true,
            position: { x: 0, y: 0 },
          },
        ],
        stockpiles: [
          {
            id: "stockpile-1",
            resources: [{ kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" }],
            position: { x: -400, y: 0 },
          },
        ],
        edges: [
          {
            id: "edge-log",
            source: "stockpile-1",
            target: "node-coke",
            resourceKind: "item",
            resourceId: "minecraft:log@1",
            label: "Spruce Log",
          },
        ],
      }),
    );

    expect(result.externalInputs).toHaveLength(0);
  });
});

describe("request demand", () => {
  function requestedProject(amountPerSecond: number): FactoryProject {
    return electrolyzerProject({
      nodes: [
        {
          id: "node-electrolyzer",
          recipeId: electrolyzer.id,
          machineCount: 4,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      requests: [
        {
          id: "request-oxygen",
          kind: "fluid",
          resourceId: "oxygen",
          displayName: "Oxygen",
          amountPerSecond,
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        {
          id: "edge-oxygen",
          source: "node-electrolyzer",
          target: "request-oxygen",
          resourceKind: "fluid",
          resourceId: "oxygen",
          label: "Oxygen",
        },
      ],
    });
  }

  it("drives the producer at the requested rate without consuming the product", () => {
    // 4 machines produce 2000 L/s oxygen at full tilt; the request asks 500.
    const result = calculateThroughput(requestedProject(500));
    const node = result.nodes["node-electrolyzer"];

    expect(node?.requiredRatePerSecond).toBeCloseTo(500, 5);
    expect(node?.utilization).toBeCloseTo(0.25, 5);
    expect(result.edges["edge-oxygen"]?.transferredPerSecond).toBeCloseTo(500, 5);
    // The request is a goal, not a consumer: the product stays a visible output.
    expect(result.unconsumedOutputs.map((balance) => balance.key)).toContain("fluid:oxygen");
  });

  it("flags a starved request as supply-capped", () => {
    // 4 machines cap out at 2000 L/s; the request asks 3000.
    const result = calculateThroughput(requestedProject(3000));
    const edge = result.edges["edge-oxygen"];

    expect(edge?.transferredPerSecond).toBeCloseTo(2000, 5);
    expect(edge?.constraint).toBe("supply");
    expect(result.nodes["node-electrolyzer"]?.status).toBe("bottleneck");
  });

  it("seeds the machine-count optimizer from the request rate", () => {
    // One machine yields 500 L/s oxygen; a 1500 L/s request needs three.
    const optimized = optimizeMachineCountsForProject(requestedProject(1500));

    expect(optimized.machineCounts.get("node-electrolyzer")).toBe(3);
  });
});
