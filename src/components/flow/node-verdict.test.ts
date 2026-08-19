import { describe, expect, it } from "vitest";
import type {
  EdgeThroughput,
  FactoryProject,
  NodeThroughputResult,
  ResourceFlow,
  ThroughputResult,
} from "@/lib/model/types";
import { buildLimitLadder, buildRailPorts, deriveNodeVerdict } from "./node-verdict";

// Unit tests for the verdict/rail derivation: solver numbers in, one honest
// state + cause + action out. Solver behaviour itself is covered elsewhere.

function flow(kind: "item" | "fluid", resourceId: string, amountPerSecond: number): ResourceFlow {
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
    id: "verdict-test",
    name: "verdict-test",
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

const edge = (id: string, source: string, target: string, resourceId = "res") => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
});

function throughput(
  nodes: Record<string, NodeThroughputResult>,
  edges: Record<string, EdgeThroughput>,
): ThroughputResult {
  return { nodes, edges, storages: {}, resources: {} } as unknown as ThroughputResult;
}

describe("deriveNodeVerdict", () => {
  it("reads starved with the binding input, shortfall, and upstream machine", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "PE", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "Cracker", machineType: "Steam Cracker", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S", "src"), machineNode("S2", "src")],
      edges: [edge("eEth", "S", "N", "eth"), edge("eOxy", "S2", "N", "oxy")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.18,
          capableUtilization: 0.18,
          demandUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144), "item:oxy": flow("item", "oxy", 1000) },
        }),
      },
      {
        eEth: edgeResult({ transferredPerSecond: 26, availablePerSecond: 26, constraint: "supply" }),
        eOxy: edgeResult({ transferredPerSecond: 180, availablePerSecond: 1000 }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("starved");
    expect(verdict.binding?.resourceKey).toBe("item:eth");
    expect(verdict.binding?.shortfallPerSecond).toBeCloseTo(118, 4);
    expect(verdict.binding?.upstreamName).toBe("Steam Cracker");
  });

  it("names a buffer and a self loop as the upstream culprit", () => {
    const base = {
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
    };
    const starvedResult = (edgeId: string) =>
      throughput(
        {
          N: nodeResult({
            utilization: 0.4,
            capableUtilization: 0.4,
            demandUtilization: 1,
            inputs: { "item:res": flow("item", "res", 10) },
          }),
        },
        { [edgeId]: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }) },
      );

    const viaBuffer = project({
      ...base,
      storages: [
        { id: "T", kind: "item", resourceId: "res", displayName: "Res Drawer" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eT", "T", "N")],
    });
    expect(deriveNodeVerdict(viaBuffer, starvedResult("eT"), "N").binding?.upstreamName).toBe(
      "Res Drawer (source)",
    );

    const viaSelf = project({
      ...base,
      nodes: [machineNode("N")],
      edges: [edge("eSelf", "N", "N")],
    });
    expect(deriveNodeVerdict(viaSelf, starvedResult("eSelf"), "N").binding?.upstreamName).toBe(
      "its own loop",
    );
  });

  // The bug: a shortage arriving through a buffer left the starved machine
  // with NO binding input at all. honestEdgeAvailablePerSecond defaults a
  // storage source to Infinity ("a tank grants whatever is asked"), and every
  // caller took the default — so the one wired input was disqualified as a
  // candidate, no chip went red, and its tooltip claimed another ingredient
  // was the limit when the only other one was hand-fed.
  it("crowns the input starved THROUGH a buffer, not a phantom ingredient", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "P", machineType: "Producer", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [
        { id: "B", kind: "item", resourceId: "res", displayName: "Res Buffer" },
        // The second ingredient's declared import. It used to be left bare and
        // called "hand-fed"; a bare slot is now UNWIRED and would outrank the
        // very thing this case is about, so the plan says where it comes from.
        // A SOURCE drawer never runs dry, so it still cannot be blamed - which
        // is exactly the role the bare port used to play here.
        { id: "H", kind: "item", resourceId: "hand", displayName: "Hand Source" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N"), machineNode("P", "src")],
      // P --800--> B --(asked 16000)--> N, and H --> N for the other input.
      edges: [edge("eIn", "P", "B"), edge("eOut", "B", "N"), edge("eHand", "H", "N", "hand")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.05,
          capableUtilization: 0.05,
          demandUtilization: 1,
          inputs: {
            "item:res": flow("item", "res", 16000),
            // Fed by a source drawer that never runs dry, so it must not be
            // blamed: the dry buffer on the OTHER input is the real ceiling.
            "item:hand": flow("item", "hand", 5),
          },
        }),
      },
      {
        eIn: edgeResult({ transferredPerSecond: 800, availablePerSecond: 800 }),
        eOut: edgeResult({
          transferredPerSecond: 800,
          demandPerSecond: 800,
          nameplateDemandPerSecond: 16000,
        }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("starved");
    // The buffer is dry — asks (16000) far exceed its inflow (800) — so its
    // line is a real ceiling of 800, and that is what sets the 5%.
    expect(verdict.binding?.resourceKey).toBe("item:res");
    expect(verdict.binding?.suppliedPerSecond).toBeCloseTo(800, 6);
    expect(verdict.binding?.neededPerSecond).toBeCloseTo(16000, 6);
    expect(verdict.binding?.shortfallPerSecond).toBeCloseTo(15200, 6);
    expect(verdict.binding?.tiedKeys).toBeUndefined();
  });

  it("still refuses to blame a buffer that is covering everyone", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "P", machineType: "Producer", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [
        { id: "B", kind: "item", resourceId: "res", displayName: "Res Buffer" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N"), machineNode("P", "src")],
      edges: [edge("eIn", "P", "B"), edge("eOut", "B", "N"), edge("eLim", "P", "N", "lim")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.4,
          capableUtilization: 0.4,
          demandUtilization: 1,
          inputs: { "item:res": flow("item", "res", 10), "item:lim": flow("item", "lim", 10) },
        }),
      },
      {
        // Inflow comfortably covers the ask: the buffer is not the ceiling.
        eIn: edgeResult({ transferredPerSecond: 100, availablePerSecond: 100 }),
        eOut: edgeResult({
          transferredPerSecond: 10,
          demandPerSecond: 10,
          nameplateDemandPerSecond: 10,
        }),
        eLim: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.binding?.resourceKey).toBe("item:lim");
  });

  it("reads bottleneck with the unmet ask and machines to add", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "PE", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N", "r", { machineCount: 4 }), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe"), edge("eIn", "C", "N", "eth")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          capableUtilization: 1,
          demandUtilization: 1,
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eOut: edgeResult({ transferredPerSecond: 216, demandPerSecond: 340 }),
        eIn: edgeResult({ transferredPerSecond: 144, demandPerSecond: 144 }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("bottleneck");
    expect(verdict.deficit?.missingPerSecond).toBeCloseTo(124, 4);
    // 216/s across 4 machines = 54/s each; 124 short needs 3 more.
    expect(verdict.deficit?.machinesToAdd).toBe(3);
  });

  it("un-greens a maxed producer whose consumer's ask converged away (the green tower)", () => {
    // The real-world regression: the solver's demandPerSecond converges down
    // to what was shipped, so the only honest hunger signal on a
    // supply-capped line is the nameplate ask. 5.143 L/s made, 32 wanted.
    const proj = project({
      recipes: [
        { id: "r", name: "Oil", machineType: "Distillation Tower", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "lcr", name: "Desulf", machineType: "LCR", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("Tower"), machineNode("LCR", "lcr")],
      edges: [edge("eGas", "Tower", "LCR", "sulfuricgas")],
    });
    const result = throughput(
      {
        Tower: nodeResult({
          nodeId: "Tower",
          utilization: 1,
          capableUtilization: 1,
          demandUtilization: 1,
          outputs: { "item:sulfuricgas": flow("item", "sulfuricgas", 5.143) },
        }),
      },
      {
        eGas: edgeResult({
          transferredPerSecond: 5.143,
          demandPerSecond: 5.143,
          nameplateDemandPerSecond: 32,
          constraint: "supply",
        }),
      },
    );

    const verdict = deriveNodeVerdict(proj, result, "Tower");
    expect(verdict.kind).toBe("bottleneck");
    expect(verdict.deficit?.missingPerSecond).toBeCloseTo(26.857, 3);
    expect(verdict.deficit?.machinesToAdd).toBe(6);

    const rails = buildRailPorts(
      proj,
      result,
      "Tower",
      { inputs: [], outputs: [{ kind: "item", id: "sulfuricgas", amount: 1 }] } as unknown as Pick<
        import("@/lib/model/types").Recipe,
        "inputs" | "outputs"
      >,
      verdict,
    );
    expect(rails.outputs[0]!.wantedPerSecond).toBeCloseTo(32, 4);
    expect(rails.outputs[0]!.couldPerSecond).toBeCloseTo(5.143, 4);
    // The chip stays the machine's story — green at full speed. The hunger
    // lives on the plug, in the asker's frame.
    expect(rails.outputs[0]!.tone).toBe("ok");
    expect(rails.outputs[0]!.badge).toBeUndefined();
    expect(rails.outputs[0]!.plug?.state).toBe("hungry");
    expect(rails.outputs[0]!.plug?.askPerSecond).toBeCloseTo(32, 4);
    expect(rails.outputs[0]!.plug?.timesShort).toBeCloseTo(32 / 5.143, 3);
  });

  it("does not beg upstream for a consumer throttled by its own downstream", () => {
    // constraint "demand": the nameplate want is big, but the consumer chose
    // to run slow — telling this producer to add machines would be a lie.
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 1, outputs: { "item:pe": flow("item", "pe", 5) } }) },
      {
        eOut: edgeResult({
          transferredPerSecond: 5,
          demandPerSecond: 5,
          nameplateDemandPerSecond: 32,
          constraint: "demand",
        }),
      },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("balanced");
  });

  it("carries the upstream culprit's own state for the chain pointer", () => {
    const base = {
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "Cracker", machineType: "Cracker", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S", "src")],
      edges: [edge("eIn", "S", "N", "res")],
    };
    const starvedNode = nodeResult({
      utilization: 0.4,
      capableUtilization: 0.4,
      demandUtilization: 1,
      inputs: { "item:res": flow("item", "res", 10) },
    });

    // Culprit running slow: point up the chain, never suggest +machines.
    const slowCulprit = deriveNodeVerdict(
      project(base),
      throughput(
        { N: starvedNode, S: nodeResult({ nodeId: "S", utilization: 0.45 }) },
        { eIn: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }) },
      ),
      "N",
    );
    expect(slowCulprit.binding?.suppliedPerSecond).toBeCloseTo(4, 6);
    expect(slowCulprit.binding?.neededPerSecond).toBeCloseTo(10, 6);
    expect(slowCulprit.binding?.upstream?.atFullSpeed).toBe(false);
    expect(slowCulprit.binding?.upstream?.pct).toBeCloseTo(45, 1);
    expect(slowCulprit.binding?.upstream?.machinesToAdd).toBeUndefined();

    // Culprit flat out: compute how many machines close the gap.
    const maxedCulprit = deriveNodeVerdict(
      project(base),
      throughput(
        {
          N: starvedNode,
          S: nodeResult({
            nodeId: "S",
            utilization: 1,
            outputs: { "item:res": flow("item", "res", 4) },
          }),
        },
        { eIn: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }) },
      ),
      "N",
    );
    expect(maxedCulprit.binding?.upstream?.atFullSpeed).toBe(true);
    // Short 6/s, each Cracker makes 4/s: +2.
    expect(maxedCulprit.binding?.upstream?.machinesToAdd).toBe(2);
  });

  it("ignores storage sinks when looking for downstream hunger", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [
        { id: "T", kind: "item", resourceId: "pe" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N")],
      edges: [edge("eTank", "N", "T", "pe")],
    });
    const result = throughput(
      { N: nodeResult({ utilization: 1, outputs: { "item:pe": flow("item", "pe", 10) } }) },
      { eTank: edgeResult({ transferredPerSecond: 4, demandPerSecond: 10 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("balanced");
  });

  it("reads demand-set with headroom when downstream asks for less", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.62,
          capableUtilization: 1,
          demandUtilization: 0.62,
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      { eOut: edgeResult({ transferredPerSecond: 134, demandPerSecond: 134 }) },
    );

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("demand-set");
    expect(verdict.headroomPct).toBeCloseTo(38, 1);
  });

  it("treats a capability/demand tie below full speed as starved", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S")],
      edges: [edge("eIn", "S", "N", "res")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.6,
          capableUtilization: 0.6,
          demandUtilization: 0.6,
          inputs: { "item:res": flow("item", "res", 10) },
        }),
      },
      { eIn: edgeResult({ transferredPerSecond: 6, availablePerSecond: 6 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("starved");
  });

  // The starved/blocked split: the SAME supply shortage, told twice. What
  // separates them is whether it costs anybody anything, which is the whole
  // reason one is worth a click and the other is not.
  const shortMachine = () =>
    project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
        { id: "src", name: "Maker", machineType: "Maker", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [{ id: "T", kind: "item", resourceId: "pe" }] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N"), machineNode("S", "src"), machineNode("C")],
    });

  const shortResult = (edges: Record<string, EdgeThroughput>) =>
    throughput(
      {
        N: nodeResult({
          utilization: 0.4,
          capableUtilization: 0.4,
          demandUtilization: 1,
          inputs: { "item:res": flow("item", "res", 10) },
          outputs: { "item:pe": flow("item", "pe", 100) },
        }),
      },
      { eIn: edgeResult({ transferredPerSecond: 4, availablePerSecond: 4, constraint: "supply" }), ...edges },
    );

  it("stays quiet when the shortage costs nobody anything (starved)", () => {
    // Short on its ingredient, but everything it makes goes to a drawer. The
    // tank takes whatever arrives, so not one asker is going without.
    const proj = shortMachine();
    proj.edges = [edge("eIn", "S", "N", "res"), edge("eTank", "N", "T", "pe")];
    const result = shortResult({ eTank: edgeResult({ transferredPerSecond: 40, demandPerSecond: 100 }) });

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("starved");
    expect(verdict.deficit).toBeUndefined();
    // The cause is still named — quiet is not silent.
    expect(verdict.binding?.resourceKey).toBe("item:res");
  });

  it("escalates the same shortage to blocked once someone goes without", () => {
    const proj = shortMachine();
    proj.edges = [edge("eIn", "S", "N", "res"), edge("eOut", "N", "C", "pe")];
    const result = shortResult({
      eOut: edgeResult({
        transferredPerSecond: 40,
        demandPerSecond: 40,
        nameplateDemandPerSecond: 100,
        constraint: "supply",
      }),
    });

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("blocked");
    expect(verdict.binding?.resourceKey).toBe("item:res");
    expect(verdict.deficit?.missingPerSecond).toBeCloseTo(60, 4);
  });

  it("counts a missed target output as somebody going without", () => {
    // No MACHINE is waiting on the output - it goes to a drain, which accepts
    // without asking - so the edge scan finds no hunger. But the player
    // dialled a target and is not getting it. Reading this as "starved,
    // nothing waiting" would go quiet on the one card being watched.
    // (The output is drained rather than left bare because a bare slot is
    // UNWIRED now, and that would answer a different question entirely.)
    const proj = shortMachine();
    proj.storages = [
      { id: "D", kind: "item", resourceId: "pe", displayName: "PE Drain" },
    ] as unknown as FactoryProject["storages"];
    proj.edges = [edge("eIn", "S", "N", "res"), edge("eDrain", "N", "D", "pe")];
    proj.nodes = [
      machineNode("N", "r", {
        targetOutput: { kind: "item", resourceId: "pe", amountPerSecond: 100 },
      }),
      machineNode("S", "src"),
    ];
    const result = shortResult({});

    const verdict = deriveNodeVerdict(proj, result, "N");
    expect(verdict.kind).toBe("blocked");
    // Makes 100/s at full blast but only runs at 40%, so 60/s never appears.
    expect(verdict.deficit?.missingPerSecond).toBeCloseTo(60, 4);
  });

  it("reads balanced, unwired, and off", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [
        machineNode("N"),
        machineNode("Lonely"),
        machineNode("Dead", "r", { enabled: false }),
        machineNode("C"),
      ],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({ utilization: 1 }),
        Lonely: nodeResult({ nodeId: "Lonely", utilization: 1 }),
        Dead: nodeResult({ nodeId: "Dead", utilization: 0 }),
      },
      { eOut: edgeResult({ transferredPerSecond: 10, demandPerSecond: 10 }) },
    );

    expect(deriveNodeVerdict(proj, result, "N").kind).toBe("balanced");
    expect(deriveNodeVerdict(proj, result, "Lonely").kind).toBe("unwired");
    expect(deriveNodeVerdict(proj, result, "Dead").kind).toBe("off");
  });
});

describe("buildLimitLadder", () => {
  it("sorts the rungs and marks the lowest as you-are-here (starved consumer)", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S"), machineNode("S2")],
      edges: [edge("eGas", "S", "N", "sulfuricgas"), edge("eH", "S2", "N", "hydrogen")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.16,
          capableUtilization: 0.16,
          demandUtilization: 1,
          inputs: {
            "item:sulfuricgas": flow("item", "sulfuricgas", 32),
            "item:hydrogen": flow("item", "hydrogen", 10),
          },
        }),
      },
      {
        eGas: edgeResult({ transferredPerSecond: 5.143, availablePerSecond: 5.143, constraint: "supply" }),
        eH: edgeResult({ transferredPerSecond: 1.6, availablePerSecond: 14 }),
      },
    );

    const ladder = buildLimitLadder(proj, result, "N");
    expect(ladder.map((rung) => rung.label)).toEqual([
      "sulfuricgas supply",
      "machine count",
      "hydrogen supply",
    ]);
    expect(ladder[0]!.pct).toBeCloseTo((5.143 / 32) * 100, 3);
    expect(ladder[0]!.now).toBe(true);
    expect(ladder[1]!.pct).toBe(100);
    expect(ladder[2]!.pct).toBeCloseTo(140, 3);
  });

  it("keeps the machine-count label on a 100% tie and skips buffer rungs", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      storages: [
        { id: "T", kind: "item", resourceId: "hyd" },
      ] as unknown as FactoryProject["storages"],
      nodes: [machineNode("N"), machineNode("S")],
      edges: [edge("eRes", "S", "N", "res"), edge("eHyd", "T", "N", "hyd")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          inputs: { "item:res": flow("item", "res", 10), "item:hyd": flow("item", "hyd", 4) },
        }),
      },
      {
        // Supply exactly matches the fleet: the tie must read "machine count".
        eRes: edgeResult({ transferredPerSecond: 10, availablePerSecond: 10 }),
        // Non-dry buffer: allocation garbage, never a rung.
        eHyd: edgeResult({ transferredPerSecond: 4, availablePerSecond: 0.02, constraint: "full" }),
      },
    );

    const ladder = buildLimitLadder(proj, result, "N");
    expect(ladder[0]!.label).toBe("machine count");
    expect(ladder.some((rung) => rung.label === "hyd supply")).toBe(false);
  });

  it("puts the finish line above a maxed producer (choke tower)", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "Oil", machineType: "Distillation Tower", minimumTier: "HV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("Tower"), machineNode("LCR"), machineNode("NSrc")],
      edges: [edge("eGas", "Tower", "LCR", "sulfuricgas"), edge("eNaph", "NSrc", "Tower", "naphtha")],
    });
    const result = throughput(
      {
        Tower: nodeResult({
          nodeId: "Tower",
          utilization: 1,
          capableUtilization: 1,
          demandUtilization: 1,
          inputs: { "item:naphtha": flow("item", "naphtha", 20) },
          outputs: { "item:sulfuricgas": flow("item", "sulfuricgas", 5.143) },
        }),
      },
      {
        eGas: edgeResult({
          transferredPerSecond: 5.143,
          demandPerSecond: 5.143,
          nameplateDemandPerSecond: 32,
          constraint: "supply",
        }),
        eNaph: edgeResult({ transferredPerSecond: 20, availablePerSecond: 36 }),
      },
    );

    const ladder = buildLimitLadder(proj, result, "Tower");
    expect(ladder.map((rung) => rung.label)).toEqual([
      "machine count",
      "naphtha supply",
      "downstream satisfied",
    ]);
    expect(ladder[0]!.now).toBe(true);
    expect(ladder[1]!.pct).toBeCloseTo(180, 3);
    expect(ladder[2]!.pct).toBeCloseTo((32 / 5.143) * 100, 1);
  });
});

describe("buildRailPorts", () => {
  const recipeResources = {
    inputs: [
      { kind: "item", id: "eth", amount: 1 },
      { kind: "item", id: "mold", amount: 1, consumed: false },
    ],
    outputs: [{ kind: "item", id: "pe", amount: 1 }],
  } as unknown as Pick<import("@/lib/model/types").Recipe, "inputs" | "outputs">;

  it("skips non-consumed inputs, pools flows, and flags unsupplied ports", () => {
    const proj = project({
      nodes: [machineNode("N"), machineNode("C")],
      edges: [edge("eOut", "N", "C", "pe")],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0.5,
          demandUtilization: 0.5,
          capableUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144), "item:mold": flow("item", "mold", 1) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      { eOut: edgeResult({ transferredPerSecond: 108, demandPerSecond: 108 }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(proj, result, "N", recipeResources, verdict);

    expect(rails.inputs.map((port) => port.resourceId)).toEqual(["eth"]);
    expect(rails.inputs[0]!.unsupplied).toBe(true);
    expect(rails.inputs[0]!.handleId).toBe("input:item:eth");
    expect(rails.outputs[0]!.currentPerSecond).toBeCloseTo(108, 6);
    // The card reads UNWIRED (the eth input has no line), not demand-set, so
    // its connected output carries no verdict tone of its own. `calm` belongs
    // to a card that is deliberately throttled, which this one is not.
    expect(rails.outputs[0]!.tone).toBe("ok");
  });

  it("marks the binding input and the hungry output", () => {
    const proj = project({
      recipes: [
        { id: "r", name: "M", machineType: "M", minimumTier: "ULV", durationTicks: 20, eut: 1, inputs: [], outputs: [] },
      ] as unknown as FactoryProject["recipes"],
      nodes: [machineNode("N"), machineNode("S"), machineNode("C")],
      edges: [edge("eIn", "S", "N", "eth"), edge("eOut", "N", "C", "pe")],
    });
    const starved = throughput(
      {
        N: nodeResult({
          utilization: 0.18,
          capableUtilization: 0.18,
          demandUtilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eIn: edgeResult({ transferredPerSecond: 26, availablePerSecond: 26, constraint: "supply" }),
        eOut: edgeResult({ transferredPerSecond: 39, demandPerSecond: 39 }),
      },
    );
    const starvedVerdict = deriveNodeVerdict(proj, starved, "N");
    const starvedRails = buildRailPorts(proj, starved, "N", recipeResources, starvedVerdict);
    expect(starvedRails.inputs[0]!.tone).toBe("bind");
    expect(starvedRails.inputs[0]!.badge?.kind).toBe("short");
    expect(starvedRails.inputs[0]!.fillFraction).toBeCloseTo(26 / 144, 4);

    const choke = throughput(
      {
        N: nodeResult({
          utilization: 1,
          inputs: { "item:eth": flow("item", "eth", 144) },
          outputs: { "item:pe": flow("item", "pe", 216) },
        }),
      },
      {
        eIn: edgeResult({ transferredPerSecond: 144, availablePerSecond: 144, demandPerSecond: 144 }),
        eOut: edgeResult({ transferredPerSecond: 216, demandPerSecond: 340 }),
      },
    );
    const chokeVerdict = deriveNodeVerdict(proj, choke, "N");
    const chokeRails = buildRailPorts(proj, choke, "N", recipeResources, chokeVerdict);
    expect(chokeRails.outputs[0]!.tone).toBe("ok");
    expect(chokeRails.outputs[0]!.plug?.state).toBe("hungry");
    expect(chokeRails.outputs[0]!.plug?.askPerSecond).toBeCloseTo(340, 4);
  });
});

