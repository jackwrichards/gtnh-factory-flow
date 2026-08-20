import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";
import { calculateSelectionFlow } from "./selection-flow";

/**
 * Two machines in a line: the smelter turns ore into ingots, the bender turns
 * ingots into plates. Plan-wide, ingots are internal. That is the whole point
 * of scoping - which group a resource lands in depends on where you draw the
 * box.
 */
// A LEGAL plan: ore comes from a source drawer and plate goes to a drain one,
// because a plan that leaves those bare is a plan that reads zero now. Both
// still show up in the books as a need and an output - drawers add nothing to
// those - which is what makes "select everything and it matches the plan"
// meaningful rather than a comparison of two zeroes.
function makeChainProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "selection-flow-project",
    name: "Selection flow test",
    recipes: [
      {
        id: "smelt",
        name: "Smelt",
        machineType: "Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "ore", amount: 1 }],
        outputs: [{ kind: "item", id: "ingot", amount: 1 }],
      },
      {
        id: "bend",
        name: "Bend",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "ingot", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "smelter",
        recipeId: "smelt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
      {
        id: "bender",
        recipeId: "bend",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 200, y: 0 },
      },
    ],
    storages: [
      { id: "ore-source", kind: "item", resourceId: "ore", position: { x: -200, y: 0 } },
      { id: "plate-drain", kind: "item", resourceId: "plate", position: { x: 400, y: 0 } },
    ],
    edges: [
      {
        id: "source-to-smelter",
        source: "ore-source",
        target: "smelter",
        resourceKind: "item",
        resourceId: "ore",
      },
      {
        id: "smelter-to-bender",
        source: "smelter",
        target: "bender",
        resourceKind: "item",
        resourceId: "ingot",
      },
      {
        id: "bender-to-drain",
        source: "bender",
        target: "plate-drain",
        resourceKind: "item",
        resourceId: "plate",
      },
    ],
  };
}

const keys = (balances: { resourceId: string }[]) => balances.map((balance) => balance.resourceId);

describe("calculateSelectionFlow", () => {
  it("falls back to the plan when nothing is selected", () => {
    expect(calculateSelectionFlow(makeChainProject(), [])).toBeUndefined();
  });

  it("reads an upstream feed as a need when only the consumer is selected", () => {
    const project = makeChainProject();
    const result = calculateThroughput(project, { generatedAt: "fixed" });

    // Plan-wide the ingot is made and eaten in-plan, so it is internal.
    expect(keys(result.externalInputs)).toEqual(["ore"]);
    expect(keys(result.unconsumedOutputs)).toEqual(["plate"]);

    const selection = calculateSelectionFlow(project, ["bender"]);

    // Scoped to the bender alone, its supplier is outside the box: the ingot
    // becomes something that has to arrive from elsewhere.
    expect(keys(selection!.externalInputs)).toEqual(["ingot"]);
    expect(keys(selection!.unconsumedOutputs)).toEqual(["plate"]);
    expect(keys(selection!.internal)).toEqual([]);
    expect(selection!.machineCount).toBe(1);
  });

  it("reads the same resource as an output when only the producer is selected", () => {
    const selection = calculateSelectionFlow(makeChainProject(), ["smelter"]);

    expect(keys(selection!.externalInputs)).toEqual(["ore"]);
    expect(keys(selection!.unconsumedOutputs)).toEqual(["ingot"]);
  });

  it("keeps a resource internal when both ends of the wire are selected", () => {
    const selection = calculateSelectionFlow(makeChainProject(), ["smelter", "bender"]);

    expect(keys(selection!.externalInputs)).toEqual(["ore"]);
    expect(keys(selection!.unconsumedOutputs)).toEqual(["plate"]);
    expect(keys(selection!.internal)).toEqual(["ingot"]);
  });

  it("matches the plan exactly when everything is selected", () => {
    const project = makeChainProject();
    const result = calculateThroughput(project, { generatedAt: "fixed" });

    const selection = calculateSelectionFlow(project, ["smelter", "bender"]);

    expect(selection!.resources).toEqual(result.resources);
    expect(selection!.externalInputs).toEqual(result.externalInputs);
    expect(selection!.unconsumedOutputs).toEqual(result.unconsumedOutputs);
    expect(selection!.machineCount).toBe(2);
  });

  it("counts a pocket card as everything inside it", () => {
    const project = makeChainProject();
    project.pockets = [
      { id: "pocket-1", name: "Plates", position: { x: 0, y: 0 } },
    ] as FactoryProject["pockets"];
    project.nodes = project.nodes.map((node) => ({ ...node, pocketId: "pocket-1" }));

    const selection = calculateSelectionFlow(project, ["pocket-1"]);

    expect(selection!.machineCount).toBe(2);
    expect(keys(selection!.externalInputs)).toEqual(["ore"]);
    expect(keys(selection!.unconsumedOutputs)).toEqual(["plate"]);
  });

  it("ignores a selection holding no machines", () => {
    const project = makeChainProject();
    project.annotations = [
      {
        id: "note-1",
        kind: "text",
        text: "hi",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
      },
    ];

    expect(calculateSelectionFlow(project, ["note-1"])).toBeUndefined();
  });

  it("runs the selection at full tilt, ignoring a throttle outside the box", () => {
    const project = makeChainProject();
    // Half a smelter feeds the bender half the ingots it wants, so the board
    // shows the bender at 50%.
    project.nodes[0].machineCount = 0.5;
    const result = calculateThroughput(project, { generatedAt: "fixed" });
    expect(result.nodes.bender.utilization).toBeCloseTo(0.5);

    const selection = calculateSelectionFlow(project, ["bender"]);

    // With the smelter outside the box that throttle is gone: the panel
    // answers what the bender would need to run properly, not what it is
    // scraping by on today.
    expect(selection!.externalInputs[0]?.deficitPerSecond).toBeCloseTo(1);
    expect(selection!.unconsumedOutputs[0]?.surplusPerSecond).toBeCloseTo(1);
  });

  it("drops wires with only one foot inside the selection", () => {
    const project = makeChainProject();
    const selection = calculateSelectionFlow(project, ["bender"]);

    // The severed feed is the whole mechanism: had the wire survived, the
    // ingot would still read as supplied rather than needed.
    expect(selection!.resources["item:ingot"].producedPerSecond).toBe(0);
    expect(selection!.resources["item:ingot"].consumedPerSecond).toBeCloseTo(1);
  });
});
