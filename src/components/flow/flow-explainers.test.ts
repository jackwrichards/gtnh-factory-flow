import { describe, expect, it } from "vitest";
import type {
  EdgeThroughput,
  FactoryProject,
  NodeThroughputResult,
  ResourceFlow,
  ThroughputResult,
} from "@/lib/model/types";
import { buildRailPorts, deriveNodeVerdict } from "./node-verdict";
import {
  buildEdgeStory,
  explainPort,
  formatSlotRateOrNull,
  formatTimes,
} from "./flow-explainers";

// The plain-English stories: solver numbers in, everyday sentences out.
// Fixtures mirror node-verdict.test.ts.

function flow(
  kind: "item" | "fluid",
  resourceId: string,
  amountPerSecond: number,
): ResourceFlow {
  return {
    key: `${kind}:${resourceId}`,
    kind,
    resourceId,
    displayName: resourceId,
    amountPerSecond,
  } as ResourceFlow;
}

function nodeResult(partial: Partial<NodeThroughputResult>): NodeThroughputResult {
  return {
    nodeId: "N",
    recipeId: "r",
    recipeName: "r",
    inputs: {},
    outputs: {},
    euT: 0,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 1,
    utilization: 1,
    theoreticalMachinesRequired: 1,
    status: "balanced",
    warnings: [],
    ...partial,
  } as NodeThroughputResult;
}

function edgeResult(partial: Partial<EdgeThroughput>): EdgeThroughput {
  return {
    transferredPerSecond: 0,
    demandPerSecond: 0,
    isLimited: false,
    constraint: "full",
    ...partial,
  } as EdgeThroughput;
}

function project(partial: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: 1,
    id: "explainer-test",
    name: "explainer-test",
    fuelProfiles: [],
    storages: [],
    recipes: [],
    nodes: [],
    edges: [],
    ...partial,
  } as unknown as FactoryProject;
}

const machineNode = (id: string, recipeId = "r", extra: Record<string, unknown> = {}) => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
  ...extra,
});

const edge = (
  id: string,
  source: string,
  target: string,
  resourceId = "res",
  resourceKind: "item" | "fluid" = "item",
) => ({ id, source, target, resourceKind, resourceId });

function throughput(
  nodes: Record<string, NodeThroughputResult>,
  edges: Record<string, EdgeThroughput>,
): ThroughputResult {
  return { nodes, edges, storages: {}, resources: {} } as unknown as ThroughputResult;
}

const towerRecipes = [
  { id: "r", name: "Oil", machineType: "Distillation Tower", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
  { id: "lcr", name: "Desulf", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
] as unknown as FactoryProject["recipes"];

type RecipeResources = Pick<import("@/lib/model/types").Recipe, "inputs" | "outputs">;

/** The real sulfuric-gas board: tower flat out at 5.143, LCR needs 32. */
function sulfuricFixture() {
  const proj = project({
    recipes: towerRecipes,
    nodes: [machineNode("Tower"), machineNode("LCR", "lcr")],
    edges: [edge("eGas", "Tower", "LCR", "sulfuricgas", "fluid")],
  });
  const result = throughput(
    {
      Tower: nodeResult({
        nodeId: "Tower",
        utilization: 1,
        capableUtilization: 1,
        demandUtilization: 1,
        outputs: { "fluid:sulfuricgas": flow("fluid", "sulfuricgas", 5.143) },
      }),
      LCR: nodeResult({
        nodeId: "LCR",
        utilization: 0.16,
        capableUtilization: 0.16,
        demandUtilization: 1,
        inputs: { "fluid:sulfuricgas": flow("fluid", "sulfuricgas", 32) },
      }),
    },
    {
      eGas: edgeResult({
        transferredPerSecond: 5.143,
        demandPerSecond: 5.143,
        nameplateDemandPerSecond: 32,
        availablePerSecond: 5.143,
        constraint: "supply",
      }),
    },
  );
  return { proj, result };
}

describe("format helpers", () => {
  it("suppresses numbers below the display noise floor", () => {
    expect(formatSlotRateOrNull(0.0002, "fluid")).toBeNull();
    expect(formatSlotRateOrNull(0, "item")).toBeNull();
    expect(formatSlotRateOrNull(0.5, "item")).toBe("0,50/s");
  });

  it("formats ask multipliers compactly", () => {
    expect(formatTimes(32 / 5.143)).toBe("×6,2");
    expect(formatTimes(15.7)).toBe("×16");
    expect(formatTimes(300)).toBe("×99+");
  });
});

describe("explainPort — outputs", () => {
  it("tells the can't-keep-up story with the +N fix", () => {
    const { proj, result } = sulfuricFixture();
    const verdict = deriveNodeVerdict(proj, result, "Tower");
    const rails = buildRailPorts(
      proj,
      result,
      "Tower",
      { inputs: [], outputs: [{ kind: "fluid", id: "sulfuricgas", amount: 1 }] } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPort(proj, result, "Tower", rails.outputs[0]!, verdict);

    expect(story.stateWord).toBe("CAN'T KEEP UP");
    expect(story.tone).toBe("amber");
    expect(story.lines[0]).toContain("already at full speed");
    expect(story.lines[0]).toContain("5,14 L/s");
    expect(story.lines[1]).toContain("32,0 L/s");
    expect(story.lines[1]).toContain("×6,2 more");
    expect(story.action?.text).toBe("→ Add +6 of this machine, or use a higher tier.");
    expect(story.rows.some((row) => row.k === "Wanted by 1 machine")).toBe(true);
  });
});

describe("explainPort — inputs", () => {
  it("names the maxed maker and the +N fix on the bottleneck input", () => {
    const { proj, result } = sulfuricFixture();
    const verdict = deriveNodeVerdict(proj, result, "LCR");
    const rails = buildRailPorts(
      proj,
      result,
      "LCR",
      { inputs: [{ kind: "fluid", id: "sulfuricgas", amount: 1 }], outputs: [] } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPort(proj, result, "LCR", rails.inputs[0]!, verdict);

    expect(story.stateWord).toBe("BOTTLENECK");
    expect(story.lines[0]).toContain("5,14 L/s of the needed 32,0 L/s");
    expect(story.lines[0]).toContain("runs at 16%");
    expect(story.lines[1]).toBe("The Distillation Tower making it is already at full speed.");
    expect(story.action?.text).toBe("→ Add +6 Distillation Tower.");
    expect(story.rows.some((row) => row.k === "Missing" && row.v === "26,9 L/s")).toBe(true);
  });

  it("points one step further up when the maker is starving too", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "Cracker", machineType: "Cracker", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S", "src")],
      edges: [edge("eIn", "S", "N", "res")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.3,
          capableUtilization: 0.3,
          demandUtilization: 1,
          inputs: { "item:res": flow("item", "res", 10) },
        }),
        S: nodeResult({ nodeId: "S", utilization: 0.45 }),
      },
      { eIn: edgeResult({ transferredPerSecond: 3, availablePerSecond: 3, constraint: "supply" }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(
      proj,
      result,
      "N",
      { inputs: [{ kind: "item", id: "res", amount: 1 }], outputs: [] } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPort(proj, result, "N", rails.inputs[0]!, verdict);

    expect(story.stateWord).toBe("BOTTLENECK — DEEPER");
    expect(story.lines[1]).toContain("runs at just 45%");
    expect(story.lines[1]).toContain("missing ingredients too");
    expect(story.action?.text).toContain("one step further up");
  });

  it("clears the innocent input and warns about the next bottleneck", () => {
    const proj = project({
      recipes: towerRecipes,
      nodes: [machineNode("LCR", "lcr"), machineNode("Tower"), machineNode("H2")],
      edges: [
        edge("eGas", "Tower", "LCR", "sulfuricgas", "fluid"),
        edge("eH", "H2", "LCR", "hydrogen", "fluid"),
      ],
    });
    const result = throughput(
      {
        LCR: nodeResult({
          nodeId: "LCR",
          utilization: 0.16,
          capableUtilization: 0.16,
          demandUtilization: 1,
          inputs: {
            "fluid:sulfuricgas": flow("fluid", "sulfuricgas", 32),
            "fluid:hydrogen": flow("fluid", "hydrogen", 10),
          },
        }),
        Tower: nodeResult({ nodeId: "Tower", utilization: 1 }),
      },
      {
        eGas: edgeResult({
          transferredPerSecond: 5.143,
          availablePerSecond: 5.143,
          constraint: "supply",
        }),
        eH: edgeResult({ transferredPerSecond: 1.6, availablePerSecond: 8 }),
      },
    );
    const verdict = deriveNodeVerdict(proj, result, "LCR");
    const rails = buildRailPorts(
      proj,
      result,
      "LCR",
      {
        inputs: [
          { kind: "fluid", id: "sulfuricgas", amount: 1 },
          { kind: "fluid", id: "hydrogen", amount: 1 },
        ],
        outputs: [],
      } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPort(proj, result, "LCR", rails.inputs[1]!, verdict);

    expect(story.stateWord).toBe("NOT THE PROBLEM");
    expect(story.lines[0]).toContain("sulfuricgas is the real bottleneck");
    expect(story.lines[1]).toContain("up to 80%");
    expect(story.action?.text).toContain("the next bottleneck, at 80%");
  });

  it("explains hand-fed inputs without riddles", () => {
    const proj = project({
      recipes: towerRecipes,
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          inputs: { "item:eth": flow("item", "eth", 10) },
          outputs: { "item:pe": flow("item", "pe", 5) },
        }),
      },
      { eOut: edgeResult({ transferredPerSecond: 5, demandPerSecond: 5 }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(
      proj,
      result,
      "N",
      {
        inputs: [{ kind: "item", id: "eth", amount: 1 }],
        outputs: [{ kind: "item", id: "pe", amount: 1 }],
      } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPort(proj, result, "N", rails.inputs[0]!, verdict);

    expect(story.stateWord).toBe("HAND-FED");
    expect(story.lines[0]).toBe("Nothing is connected here.");
    expect(story.lines[1]).toContain("drop this ingredient in by hand");
    expect(story.action?.text).toContain("Connect a real source");
  });
});

describe("buildEdgeStory", () => {
  it("tells the bottleneck line's story from both ends", () => {
    const { proj, result } = sulfuricFixture();
    const story = buildEdgeStory(proj, result, ["eGas"]);

    expect(story?.stateWord).toBe("BOTTLENECK");
    expect(story?.carriesText).toBe("5,14 L/s");
    expect(story?.from.name).toBe("Distillation Tower");
    expect(story?.from.note).toBe("at full speed");
    expect(story?.to[0]?.name).toBe("LCR");
    expect(story?.to[0]?.text).toContain("wants 32,0 L/s, gets 5,14 L/s");
    expect(story?.lines[0]).toContain("covers only 16% of what the LCR wants");
    expect(story?.action?.text).toBe("→ Add +6 Distillation Tower.");
  });

  it("notes each pooled line's share of the receiver's need", () => {
    const proj = project({
      recipes: towerRecipes,
      nodes: [machineNode("N", "lcr"), machineNode("S1"), machineNode("S2")],
      edges: [
        edge("e1", "S1", "N", "res", "fluid"),
        edge("e2", "S2", "N", "res", "fluid"),
      ],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.5,
          inputs: { "fluid:res": flow("fluid", "res", 32) },
        }),
        S1: nodeResult({ nodeId: "S1", utilization: 1 }),
      },
      {
        e1: edgeResult({
          transferredPerSecond: 4,
          nameplateDemandPerSecond: 20,
          constraint: "supply",
        }),
        e2: edgeResult({ transferredPerSecond: 12, demandPerSecond: 12 }),
      },
    );
    const story = buildEdgeStory(proj, result, ["e1"]);

    expect(story?.to[0]?.text).toContain("its share of 32,0 L/s over 2 lines");
  });

  it("keeps buffer lines dead simple", () => {
    const proj = project({
      recipes: towerRecipes,
      storages: [
        { id: "T", kind: "item", resourceId: "pe", displayName: "PE Drawer" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eTank", "N", "T", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 1 }) },
      { eTank: edgeResult({ transferredPerSecond: 3, demandPerSecond: 3 }) },
    );
    const story = buildEdgeStory(proj, result, ["eTank"]);

    expect(story?.stateWord).toBe("TO BUFFER");
    expect(story?.to[0]?.name).toBe("PE Drawer (buffer)");
    expect(story?.lines[0]).toBe("Flows into the buffer at 3,00/s.");
  });

  it("reports spare capacity on a satisfied single-outlet line", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 0.4, demandUtilization: 0.4, capableUtilization: 1 }) },
      {
        eOut: edgeResult({
          transferredPerSecond: 4,
          demandPerSecond: 4,
          sourceCapacityPerSecond: 10,
          constraint: "demand",
        }),
      },
    );
    const story = buildEdgeStory(proj, result, ["eOut"]);

    expect(story?.stateWord).toBe("OK");
    expect(story?.lines[0]).toBe("Delivers exactly what's asked: 4,00/s.");
    expect(story?.lines[1]).toContain("could send 10,0/s — 6,00/s spare");
    expect(story?.from.note).toContain("could send more if asked");
  });
});
