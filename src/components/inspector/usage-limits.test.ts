import { describe, expect, it } from "vitest";
import type {
  EdgeThroughput,
  FactoryEdge,
  FactoryNode,
  NodeThroughputResult,
  ResourceFlow,
} from "@/lib/model/types";
import { buildUsageLimitChain } from "./usage-limits";

function makeNode(id: string, machineCount = 1): FactoryNode {
  return {
    id,
    recipeId: `recipe_${id}`,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function makeFlow(resourceId: string, amountPerSecond: number, displayName?: string): ResourceFlow {
  return {
    key: `item:${resourceId}`,
    kind: "item",
    resourceId,
    displayName,
    amountPerSecond,
  };
}

function makeNodeResult(
  id: string,
  overrides: Partial<NodeThroughputResult> = {},
): NodeThroughputResult {
  return {
    nodeId: id,
    recipeId: `recipe_${id}`,
    recipeName: `Recipe ${id}`,
    enabled: true,
    operationRatePerSecond: 1,
    inputs: {},
    outputs: {},
    euT: 30,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization: 1,
    theoreticalMachinesRequired: 1,
    status: "balanced",
    warnings: [],
    ...overrides,
  };
}

function makeEdge(id: string, source: string, target: string, resourceId: string): FactoryEdge {
  return { id, source, target, resourceKind: "item", resourceId };
}

function makeEdgeResult(
  edgeId: string,
  resourceId: string,
  overrides: Partial<EdgeThroughput> = {},
): EdgeThroughput {
  return {
    edgeId,
    resource: makeFlow(resourceId, 0),
    demandPerSecond: 0,
    transferredPerSecond: 0,
    isLimited: false,
    nameplateDemandPerSecond: 0,
    sourceCapacityPerSecond: 0,
    constraint: "full",
    ...overrides,
  };
}

describe("buildUsageLimitChain", () => {
  it("puts a starving ingredient first, then demand", () => {
    // Smelter needs 10 ore/s but its supplier can only send 5/s; takers would
    // happily use 80% of its ingots.
    const chain = buildUsageLimitChain(
      {
        nodes: [makeNode("smelter")],
        edges: [
          makeEdge("in", "mine", "smelter", "ore"),
          makeEdge("out", "smelter", "assembler", "ingot"),
        ],
      },
      {
        nodes: {
          smelter: makeNodeResult("smelter", {
            utilization: 0.5,
            inputs: { "item:ore": makeFlow("ore", 10, "Iron Ore") },
            outputs: { "item:ingot": makeFlow("ingot", 10, "Iron Ingot") },
          }),
        },
        edges: {
          in: makeEdgeResult("in", "ore", {
            transferredPerSecond: 5,
            nameplateDemandPerSecond: 10,
            sourceCapacityPerSecond: 5,
            constraint: "supply",
          }),
          out: makeEdgeResult("out", "ingot", {
            transferredPerSecond: 5,
            nameplateDemandPerSecond: 8,
            sourceCapacityPerSecond: 10,
          }),
        },
      },
      "smelter",
    );

    expect(chain[0].kind).toBe("supply");
    expect(chain[0].label).toBe("Iron Ore supply");
    expect(chain[0].active).toBe(true);
    expect(chain[0].fraction).toBeCloseTo(0.5);
    expect(chain[1].kind).toBe("demand");
    expect(chain[1].label).toBe("Iron Ingot demand");
    expect(chain[1].fraction).toBeCloseTo(0.8);
  });

  it("blames demand when every ingredient flows freely", () => {
    const chain = buildUsageLimitChain(
      {
        nodes: [makeNode("smelter")],
        edges: [makeEdge("out", "smelter", "assembler", "ingot")],
      },
      {
        nodes: {
          smelter: makeNodeResult("smelter", {
            utilization: 0.3,
            outputs: { "item:ingot": makeFlow("ingot", 10, "Iron Ingot") },
          }),
        },
        edges: {
          out: makeEdgeResult("out", "ingot", {
            transferredPerSecond: 3,
            nameplateDemandPerSecond: 3,
            sourceCapacityPerSecond: 10,
          }),
        },
      },
      "smelter",
    );

    expect(chain[0].kind).toBe("demand");
    expect(chain[0].active).toBe(true);
    expect(chain[0].fraction).toBeCloseTo(0.3);
  });

  it("turns overdemand into a machine-count entry with the machines needed", () => {
    const chain = buildUsageLimitChain(
      {
        nodes: [makeNode("smelter", 2)],
        edges: [makeEdge("out", "smelter", "assembler", "ingot")],
      },
      {
        nodes: {
          smelter: makeNodeResult("smelter", {
            utilization: 2.5,
            status: "bottleneck",
            outputs: { "item:ingot": makeFlow("ingot", 10, "Iron Ingot") },
          }),
        },
        edges: {
          out: makeEdgeResult("out", "ingot", {
            transferredPerSecond: 10,
            nameplateDemandPerSecond: 25,
            sourceCapacityPerSecond: 10,
            constraint: "supply",
          }),
        },
      },
      "smelter",
    );

    expect(chain[0].kind).toBe("machines");
    expect(chain[0].active).toBe(true);
    // 2 machines at 250% demand: 5 machines cover it, so 3 more.
    expect(chain[0].detail).toContain("Add 3 more machines");
  });

  it("reports no takers when nothing is connected downstream", () => {
    const chain = buildUsageLimitChain(
      { nodes: [makeNode("smelter")], edges: [] },
      {
        nodes: {
          smelter: makeNodeResult("smelter", {
            outputs: { "item:ingot": makeFlow("ingot", 10, "Iron Ingot") },
          }),
        },
        edges: {},
      },
      "smelter",
    );

    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("no-demand");
    expect(chain[0].active).toBe(true);
  });

  it("marks storage-fed ingredients as never limiting", () => {
    const chain = buildUsageLimitChain(
      {
        nodes: [makeNode("smelter")],
        edges: [
          makeEdge("in", "drawer", "smelter", "ore"),
          makeEdge("out", "smelter", "assembler", "ingot"),
        ],
        storages: [],
      },
      {
        nodes: {
          smelter: makeNodeResult("smelter", {
            utilization: 1,
            inputs: { "item:ore": makeFlow("ore", 10, "Iron Ore") },
            outputs: { "item:ingot": makeFlow("ingot", 10, "Iron Ingot") },
          }),
        },
        edges: {
          in: makeEdgeResult("in", "ore", {
            transferredPerSecond: 10,
            nameplateDemandPerSecond: 10,
            sourceCapacityPerSecond: Number.POSITIVE_INFINITY,
          }),
          out: makeEdgeResult("out", "ingot", {
            transferredPerSecond: 10,
            nameplateDemandPerSecond: 10,
            sourceCapacityPerSecond: 10,
          }),
        },
      },
      "smelter",
    );

    const storageEntry = chain.find((entry) => entry.label === "Iron Ore supply");
    expect(storageEntry?.fraction).toBe(Number.POSITIVE_INFINITY);
    expect(storageEntry?.detail).toContain("storage");
    // The infinite entry sorts last, after real limits.
    expect(chain[chain.length - 1]).toBe(storageEntry);
  });

  it("returns nothing for disabled or missing nodes", () => {
    expect(
      buildUsageLimitChain(
        { nodes: [makeNode("off")], edges: [] },
        { nodes: { off: makeNodeResult("off", { enabled: false }) }, edges: {} },
        "off",
      ),
    ).toEqual([]);
    expect(buildUsageLimitChain({ nodes: [], edges: [] }, { nodes: {}, edges: {} }, "ghost")).toEqual(
      [],
    );
  });
});
