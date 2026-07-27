import { describe, expect, it } from "vitest";
import type { FactoryNode, NodeThroughputResult, Recipe } from "@/lib/model/types";
import {
  buildMachineUsage,
  buildPowerByMachine,
  buildPowerByTier,
  computePowerTotals,
} from "./power-breakdown";

function makeNode(id: string, recipeId: string, machineCount: number): FactoryNode {
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

function makeNodeResult(id: string, euT: number, utilization = 1): NodeThroughputResult {
  return {
    nodeId: id,
    recipeId: `recipe_${id}`,
    recipeName: `Recipe ${id}`,
    enabled: true,
    operationRatePerSecond: 1,
    inputs: {},
    outputs: {},
    euT,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization,
    theoreticalMachinesRequired: 1,
    status: "balanced",
    warnings: [],
  };
}

function makeRecipe(id: string, machineType: string): Recipe {
  return {
    id,
    name: `${machineType} recipe`,
    machineType,
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [],
    outputs: [],
  };
}

describe("buildPowerByTier", () => {
  it("tiers by a single machine's draw, not the node's total", () => {
    // Ten LV machines are an LV load ten times over, not one HV load. Summing
    // before tiering is the mistake this guards.
    const tiers = buildPowerByTier(
      { nodes: [makeNode("a", "recipe_a", 10)] },
      { nodes: { a: makeNodeResult("a", 300) } },
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0].label).toBe("LV");
    expect(tiers[0].euT).toBe(300);
  });

  it("orders tiers low to high so the ordinal ramp reads in one direction", () => {
    const tiers = buildPowerByTier(
      {
        nodes: [
          makeNode("hv", "r", 1),
          makeNode("lv", "r", 1),
          makeNode("mv", "r", 1),
        ],
      },
      {
        nodes: {
          hv: makeNodeResult("hv", 400),
          lv: makeNodeResult("lv", 30),
          mv: makeNodeResult("mv", 100),
        },
      },
    );

    expect(tiers.map((slice) => slice.label)).toEqual(["LV", "MV", "HV"]);
  });

  it("merges nodes that land on the same tier and reports shares of the whole", () => {
    const tiers = buildPowerByTier(
      { nodes: [makeNode("a", "r", 1), makeNode("b", "r", 1)] },
      { nodes: { a: makeNodeResult("a", 30), b: makeNodeResult("b", 10) } },
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0].euT).toBe(40);
    expect(tiers[0].share).toBe(1);
  });

  it("ignores nodes drawing no power", () => {
    const tiers = buildPowerByTier(
      { nodes: [makeNode("a", "r", 1), makeNode("off", "r", 1)] },
      { nodes: { a: makeNodeResult("a", 30), off: makeNodeResult("off", 0) } },
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0].label).toBe("LV");
  });

  it("returns nothing for a plan drawing no power at all", () => {
    expect(
      buildPowerByTier(
        { nodes: [makeNode("a", "r", 1)] },
        { nodes: { a: makeNodeResult("a", 0) } },
      ),
    ).toEqual([]);
  });
});

describe("buildPowerByMachine", () => {
  const recipes = [
    makeRecipe("ebf", "Electric Blast Furnace"),
    makeRecipe("chem", "Chemical Reactor"),
  ];

  it("groups nodes by machine and ranks them biggest first", () => {
    const machines = buildPowerByMachine(
      {
        nodes: [makeNode("a", "chem", 1), makeNode("b", "ebf", 1), makeNode("c", "chem", 1)],
        recipes,
      },
      {
        nodes: {
          a: makeNodeResult("a", 100),
          b: makeNodeResult("b", 500),
          c: makeNodeResult("c", 100),
        },
      },
    );

    expect(machines.map((slice) => slice.label)).toEqual([
      "Electric Blast Furnace",
      "Chemical Reactor",
    ]);
    // Both Chemical Reactor nodes fold into one row.
    expect(machines[1].euT).toBe(200);
  });

  it("folds everything past the limit into a counted Other row", () => {
    // A distinct recipe, and so a distinct machine, per node — otherwise they
    // merge into one row and the fold never happens.
    const nodes = Array.from({ length: 8 }, (_, index) =>
      makeNode(`n${index}`, `recipe${index}`, 1),
    );
    const nodeResults: Record<string, NodeThroughputResult> = {};
    for (let index = 0; index < 8; index += 1) {
      nodeResults[`n${index}`] = makeNodeResult(`n${index}`, 100 - index);
    }

    const machines = buildPowerByMachine(
      {
        nodes,
        recipes: nodes.map((node, index) => makeRecipe(node.recipeId, `Machine ${index}`)),
      },
      { nodes: nodeResults },
      "peak",
      5,
    );

    expect(machines).toHaveLength(6);
    expect(machines[5].label).toBe("Other (3)");
    // Draws run 100 down to 93; the top five are kept and the last three fold.
    expect(machines[5].euT).toBe(95 + 94 + 93);
  });

  it("falls back to the recipe name when the machine type is unknown", () => {
    const machines = buildPowerByMachine(
      { nodes: [makeNode("a", "missing", 1)], recipes: [] },
      { nodes: { a: makeNodeResult("a", 100) } },
    );

    expect(machines[0].label).toBe("Recipe a");
  });

  it("shares sum to the whole", () => {
    const machines = buildPowerByMachine(
      { nodes: [makeNode("a", "chem", 1), makeNode("b", "ebf", 1)], recipes },
      { nodes: { a: makeNodeResult("a", 300), b: makeNodeResult("b", 100) } },
    );

    expect(machines.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });

  it("scales draws by utilization in actual mode", () => {
    const machines = buildPowerByMachine(
      { nodes: [makeNode("a", "chem", 1), makeNode("b", "ebf", 1)], recipes },
      {
        nodes: {
          a: makeNodeResult("a", 300, 0.5),
          b: makeNodeResult("b", 100, 1),
        },
      },
      "actual",
    );

    expect(machines.map((slice) => slice.euT)).toEqual([150, 100]);
  });
});

describe("actual mode", () => {
  it("keeps the tier from nameplate draw while scaling the summed EU/t", () => {
    // An HV machine idling at 10% is still an HV load — it does not become an
    // LV row just because its average draw dipped under the LV ceiling.
    const tiers = buildPowerByTier(
      { nodes: [makeNode("a", "r", 1)] },
      { nodes: { a: makeNodeResult("a", 400, 0.1) } },
      "actual",
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0].label).toBe("HV");
    expect(tiers[0].euT).toBeCloseTo(40);
  });

  it("drops machines that never run, but never scales above nameplate", () => {
    const tiers = buildPowerByTier(
      { nodes: [makeNode("idle", "r", 1), makeNode("over", "r", 1)] },
      {
        nodes: {
          idle: makeNodeResult("idle", 30, 0),
          // Overdemanded nodes can report utilization > 1; the draw caps at nameplate.
          over: makeNodeResult("over", 100, 2.5),
        },
      },
      "actual",
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0].euT).toBe(100);
  });
});

describe("computePowerTotals", () => {
  it("reports nameplate and utilization-scaled totals side by side", () => {
    const totals = computePowerTotals(
      { nodes: [makeNode("a", "r", 1), makeNode("b", "r", 1)] },
      { nodes: { a: makeNodeResult("a", 300, 0.5), b: makeNodeResult("b", 100, 1) } },
    );

    expect(totals.peakEuT).toBe(400);
    expect(totals.actualEuT).toBe(250);
  });
});

describe("buildMachineUsage", () => {
  const recipes = [
    makeRecipe("ebf", "Electric Blast Furnace"),
    makeRecipe("chem", "Chemical Reactor"),
  ];

  it("weights group utilization by draw, not by node count", () => {
    // Two chem reactors: 300 EU/t at 100% and 100 EU/t at 0%. A plain node
    // average would say 50%; weighted by draw the group runs at 75%.
    const usage = buildMachineUsage(
      { nodes: [makeNode("a", "chem", 1), makeNode("b", "chem", 1)], recipes },
      { nodes: { a: makeNodeResult("a", 300, 1), b: makeNodeResult("b", 100, 0) } },
    );

    expect(usage).toHaveLength(1);
    expect(usage[0].nodeCount).toBe(2);
    expect(usage[0].peakEuT).toBe(400);
    expect(usage[0].actualEuT).toBe(300);
    expect(usage[0].utilization).toBeCloseTo(0.75);
  });

  it("keeps fully idle machines in the roster and sorts by nameplate draw", () => {
    const usage = buildMachineUsage(
      { nodes: [makeNode("a", "chem", 1), makeNode("b", "ebf", 1)], recipes },
      { nodes: { a: makeNodeResult("a", 100, 0), b: makeNodeResult("b", 500, 0.6) } },
    );

    expect(usage.map((slice) => slice.label)).toEqual([
      "Electric Blast Furnace",
      "Chemical Reactor",
    ]);
    expect(usage[1].utilization).toBe(0);
    expect(usage[1].actualEuT).toBe(0);
  });
});
