import { describe, expect, it } from "vitest";
import type { FactoryNode, NodeThroughputResult, Recipe } from "@/lib/model/types";
import { buildUsageCells, type UsageIconResource } from "./usage-grid";

function makeNode(id: string, recipeId: string, machineCount = 1): FactoryNode {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function makeNodeResult(
  id: string,
  utilization: number,
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
    utilization,
    theoreticalMachinesRequired: 1,
    status: "balanced",
    warnings: [],
    ...overrides,
  };
}

function makeRecipe(id: string, machineType: string, recipeMap?: string): Recipe {
  return {
    id,
    name: `${machineType} recipe`,
    machineType,
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [],
    outputs: [{ kind: "item", id: "out", amount: 1, displayName: "Output" }],
    source: recipeMap ? { recipeMap } : undefined,
  };
}

describe("buildUsageCells", () => {
  it("emits one cell per node, busiest first", () => {
    const cells = buildUsageCells(
      {
        nodes: [makeNode("slow", "chem"), makeNode("busy", "chem")],
        recipes: [makeRecipe("chem", "Chemical Reactor")],
      },
      {
        nodes: {
          slow: makeNodeResult("slow", 0.2),
          busy: makeNodeResult("busy", 1),
        },
      },
    );

    // Two nodes of the same machine stay two cells — each points at one
    // canvas node, so they must never merge.
    expect(cells.map((cell) => cell.nodeId)).toEqual(["busy", "slow"]);
    expect(cells.map((cell) => cell.label)).toEqual([
      "Chemical Reactor",
      "Chemical Reactor",
    ]);
  });

  it("skips disabled and missing-recipe nodes", () => {
    const cells = buildUsageCells(
      {
        nodes: [makeNode("on", "chem"), makeNode("off", "chem"), makeNode("gone", "nope")],
        recipes: [makeRecipe("chem", "Chemical Reactor")],
      },
      {
        nodes: {
          on: makeNodeResult("on", 0.5),
          off: makeNodeResult("off", 0, { enabled: false, status: "disabled" }),
          gone: makeNodeResult("gone", 0, { status: "missing-recipe" }),
        },
      },
    );

    expect(cells.map((cell) => cell.nodeId)).toEqual(["on"]);
  });

  it("prefers the dataset's machine icon and falls back to the first output", () => {
    const machineIcon: UsageIconResource = {
      kind: "item",
      id: "machine.ebf",
      amount: 1,
      displayName: "Electric Blast Furnace",
    };
    const icons = new Map([["gt.recipe.blastfurnace", machineIcon]]);

    const cells = buildUsageCells(
      {
        nodes: [makeNode("a", "ebf"), makeNode("b", "chem")],
        recipes: [
          makeRecipe("ebf", "Electric Blast Furnace", "gt.recipe.blastfurnace"),
          makeRecipe("chem", "Chemical Reactor"),
        ],
      },
      { nodes: { a: makeNodeResult("a", 1), b: makeNodeResult("b", 1) } },
      icons,
    );

    expect(cells.find((cell) => cell.nodeId === "a")?.icon?.id).toBe("machine.ebf");
    expect(cells.find((cell) => cell.nodeId === "b")?.icon?.id).toBe("out");
  });

  it("keeps overdemand above 100% and floors bad values at zero", () => {
    const cells = buildUsageCells(
      {
        nodes: [makeNode("over", "chem"), makeNode("nan", "chem")],
        recipes: [makeRecipe("chem", "Chemical Reactor")],
      },
      {
        nodes: {
          over: makeNodeResult("over", 2.5, { status: "bottleneck" }),
          nan: makeNodeResult("nan", Number.NaN),
        },
      },
    );

    expect(cells[0].utilization).toBe(2.5);
    expect(cells[0].status).toBe("bottleneck");
    expect(cells[1].utilization).toBe(0);
  });
});
