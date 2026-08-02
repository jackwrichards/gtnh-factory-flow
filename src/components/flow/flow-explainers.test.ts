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
  explainPlug,
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
    expect(formatSlotRateOrNull(0.5, "item")).toBe("0.50/s");
  });

  it("formats ask multipliers compactly, with real magnitudes up to four digits", () => {
    expect(formatTimes(32 / 5.143)).toBe("×6.2");
    expect(formatTimes(15.7)).toBe("×16");
    expect(formatTimes(235)).toBe("×235");
    expect(formatTimes(15000)).toBe("×9999+");
    expect(formatTimes(Number.POSITIVE_INFINITY)).toBe("×9999+");
  });
});

describe("explainPort — outputs", () => {
  it("keeps the maker's story green at full speed and points at the plug", () => {
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

    // The machine is doing everything it can — its story is a good one.
    // The hunger (and the +N fix) belongs to the plug's hover.
    expect(story.stateWord).toBe("DONE");
    expect(story.tone).toBe("green");
    expect(story.lines[0]).toContain("Full speed");
    expect(story.lines[0]).toContain("×6.2 more");
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
    expect(story.lines[0]).toBe("Bottleneck: gets 5.14 L/s of 32.0 L/s — machine at 16%.");
    expect(story.action?.text).toBe("→ Distillation Tower is maxed — add +6 there.");
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

    expect(story.stateWord).toBe("BOTTLENECK");
    expect(story.action?.text).toContain("Cracker at 45%");
    expect(story.action?.text).toContain("fix above it");
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
    expect(story.lines[0]).toBe("Not the limit — sulfuricgas is.");
    expect(story.action?.text).toContain("next bottleneck, at 80%");
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
    expect(story.lines[0]).toContain("Nothing wired");
    expect(story.action?.text).toContain("Wire a source");
  });
});

describe("explainPlug — the asker's side", () => {
  it("tells the hungry plug's story with the per-port fix", () => {
    const { proj, result } = sulfuricFixture();
    const verdict = deriveNodeVerdict(proj, result, "Tower");
    const rails = buildRailPorts(
      proj,
      result,
      "Tower",
      { inputs: [], outputs: [{ kind: "fluid", id: "sulfuricgas", amount: 1 }] } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPlug(proj, result, "Tower", rails.outputs[0]!)!;

    expect(rails.outputs[0]!.plug?.state).toBe("hungry");
    expect(rails.outputs[0]!.plug?.askerName).toBe("LCR");
    expect(story.stateWord).toBe("HUNGRY");
    expect(story.lines[0]).toBe("16% = asked 32.0 L/s, this puts in 5.14 L/s.");
    expect(story.action?.text).toBe("→ +6 machines here (or higher tier).");
    expect(story.lineRows?.rows[0]?.rate).toBe("asks 32.0 · gets 5.14");
  });

  it("reads blocked-upstream when the machine is starving itself", () => {
    const proj = project({
      recipes: towerRecipes,
      nodes: [machineNode("N"), machineNode("C", "lcr"), machineNode("S")],
      edges: [edge("eOut", "N", "C", "pe"), edge("eIn", "S", "N", "res")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.35,
          capableUtilization: 0.35,
          demandUtilization: 1,
          inputs: { "item:res": flow("item", "res", 10) },
          outputs: { "item:pe": flow("item", "pe", 60) },
        }),
      },
      {
        eOut: edgeResult({
          transferredPerSecond: 21,
          demandPerSecond: 21,
          nameplateDemandPerSecond: 60,
          constraint: "supply",
        }),
        eIn: edgeResult({ transferredPerSecond: 3.5, availablePerSecond: 3.5, constraint: "supply" }),
      },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(
      proj,
      result,
      "N",
      {
        inputs: [{ kind: "item", id: "res", amount: 1 }],
        outputs: [{ kind: "item", id: "pe", amount: 1 }],
      } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPlug(proj, result, "N", rails.outputs[0]!)!;

    expect(rails.outputs[0]!.plug?.state).toBe("blocked");
    expect(story.stateWord).toBe("BLOCKED UPSTREAM");
    expect(story.action?.text).toContain("fix its red input first");
  });

  it("keeps buffer-only plugs calm", () => {
    const proj = project({
      recipes: towerRecipes,
      storages: [
        { id: "T", kind: "item", resourceId: "pe", displayName: "PE Drawer" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eTank", "N", "T", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 1, outputs: { "item:pe": flow("item", "pe", 10) } }) },
      { eTank: edgeResult({ transferredPerSecond: 10, demandPerSecond: 10 }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(
      proj,
      result,
      "N",
      { inputs: [], outputs: [{ kind: "item", id: "pe", amount: 1 }] } as unknown as RecipeResources,
      verdict,
    );
    const story = explainPlug(proj, result, "N", rails.outputs[0]!)!;

    expect(rails.outputs[0]!.plug?.state).toBe("dump");
    expect(rails.outputs[0]!.plug?.askerName).toBe("PE Drawer (buffer)");
    expect(story.stateWord).toBe("DUMP");
    expect(story.lines[0]).toContain("Dead end");
  });
});

describe("per-port coupling (no worst-only gating)", () => {
  it("marks EVERY over-asked output, not just the node's worst", () => {
    const proj = project({
      recipes: towerRecipes,
      nodes: [machineNode("N"), machineNode("A", "lcr"), machineNode("B", "lcr")],
      edges: [edge("eA", "N", "A", "big"), edge("eB", "N", "B", "small")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          capableUtilization: 1,
          demandUtilization: 1,
          outputs: { "item:big": flow("item", "big", 10), "item:small": flow("item", "small", 2) },
        }),
      },
      {
        eA: edgeResult({
          transferredPerSecond: 10,
          demandPerSecond: 10,
          nameplateDemandPerSecond: 30,
          constraint: "supply",
        }),
        eB: edgeResult({
          transferredPerSecond: 2,
          demandPerSecond: 2,
          nameplateDemandPerSecond: 10,
          constraint: "supply",
        }),
      },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(
      proj,
      result,
      "N",
      {
        inputs: [],
        outputs: [
          { kind: "item", id: "big", amount: 1 },
          { kind: "item", id: "small", amount: 1 },
        ],
      } as unknown as RecipeResources,
      verdict,
    );

    // Both plugs hungry at once — couplings are independent.
    expect(rails.outputs.map((port) => port.plug?.state)).toEqual(["hungry", "hungry"]);

    // The NON-worst output's plug still tells its own hungry story with its
    // own per-port fix: short 8/s at 2/s per machine = +4.
    const smallStory = explainPlug(proj, result, "N", rails.outputs[1]!)!;
    expect(smallStory.stateWord).toBe("HUNGRY");
    expect(smallStory.action?.text).toBe("→ +4 machines here (or higher tier).");

    // The node-level verdict: worst by missing is "big" (20/s), but the one
    // +N that covers everything comes from "small" (+4 beats +2).
    expect(verdict.deficit?.displayName).toBe("big");
    expect(verdict.deficit?.machinesToAdd).toBe(4);
    expect(verdict.deficit?.hungryOutputs).toBe(2);
    expect(verdict.deficit?.pluggedOutputs).toBe(2);
  });
});

describe("buffer honesty on inputs", () => {
  it("never predicts a non-dry buffer as the next bottleneck", () => {
    const proj = project({
      recipes: towerRecipes,
      storages: [
        { id: "T", kind: "fluid", resourceId: "hydrogen", displayName: "Hydrogen" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("LCR", "lcr"), machineNode("Tower")],
      edges: [
        edge("eGas", "Tower", "LCR", "sulfuricgas", "fluid"),
        edge("eH", "T", "LCR", "hydrogen", "fluid"),
      ],
    });
    const result = throughput(
      {
        LCR: nodeResult({
          nodeId: "LCR",
          utilization: 0.004,
          capableUtilization: 0.004,
          demandUtilization: 0.004,
          inputs: {
            "fluid:sulfuricgas": flow("fluid", "sulfuricgas", 24000),
            "fluid:hydrogen": flow("fluid", "hydrogen", 4000),
          },
        }),
        Tower: nodeResult({
          nodeId: "Tower",
          utilization: 1,
          outputs: { "fluid:sulfuricgas": flow("fluid", "sulfuricgas", 102) },
        }),
      },
      {
        eGas: edgeResult({
          transferredPerSecond: 102,
          availablePerSecond: 102,
          constraint: "supply",
        }),
        // The buffer line's "available" is allocation garbage (17 of 4000) —
        // it must read as no-cap, not as a 0% ceiling.
        eH: edgeResult({ transferredPerSecond: 17, availablePerSecond: 17, constraint: "full" }),
      },
    );
    const verdict = deriveNodeVerdict(proj, result, "LCR");

    // The lie from the live board: "gets 102 of the needed 102, runs at 0%".
    // Starved machines measure need at FULL BLAST.
    expect(verdict.kind).toBe("starved");
    expect(verdict.binding?.resourceKey).toBe("fluid:sulfuricgas");
    expect(verdict.binding?.neededPerSecond).toBeCloseTo(24000, 3);
    expect(verdict.binding?.suppliedPerSecond).toBeCloseTo(102, 3);
    expect(verdict.binding?.upstream?.machinesToAdd).toBe(235);

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
    expect(rails.inputs[1]!.couldPerSecond).toBe(Number.POSITIVE_INFINITY);

    const hydrogenStory = explainPort(proj, result, "LCR", rails.inputs[1]!, verdict);
    expect(hydrogenStory.stateWord).toBe("NOT THE PROBLEM");
    expect(hydrogenStory.lines[0]).toContain("delivers on demand, never the cap");
    expect(hydrogenStory.action).toBeUndefined();
  });
});

describe("buildEdgeStory", () => {
  it("tells the bottleneck line's story from both ends", () => {
    const { proj, result } = sulfuricFixture();
    const story = buildEdgeStory(proj, result, ["eGas"]);

    expect(story?.stateWord).toBe("BOTTLENECK");
    expect(story?.carriesText).toBe("5.14 L/s");
    expect(story?.from.name).toBe("Distillation Tower");
    expect(story?.from.note).toBe("at full speed");
    expect(story?.to[0]?.name).toBe("LCR");
    expect(story?.to[0]?.text).toContain("wants 32.0 L/s, gets 5.14 L/s");
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

    expect(story?.to[0]?.text).toContain("its share of 32.0 L/s over 2 lines");
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
    expect(story?.lines[0]).toBe("Flows into the buffer at 3.00/s.");
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
    expect(story?.lines[0]).toBe("Delivers exactly what's asked: 4.00/s.");
    expect(story?.lines[1]).toContain("could send 10.0/s — 6.00/s spare");
    expect(story?.from.note).toContain("could send more if asked");
  });
});
