import { describe, expect, it } from "vitest";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

// Acceptance suite for the allocation rework (community report 2026-08-02):
// starvation with idle supply, conservation breaks on split outputs, and
// board-size-dependent answers for lossy loops.

function recipe(id: string, inputs: Recipe["inputs"], outputs: Recipe["outputs"]): Recipe {
  return {
    id,
    name: id,
    machineType: "Test Machine",
    minimumTier: "ULV",
    durationTicks: 20, // one operation per second
    eut: 1,
    inputs,
    outputs,
  };
}

function project(partial: Pick<FactoryProject, "recipes" | "nodes" | "edges">): FactoryProject {
  return {
    schemaVersion: 1,
    id: "allocation-test",
    name: "allocation-test",
    fuelProfiles: [],
    storages: [],
    ...partial,
  } as FactoryProject;
}

const node = (id: string, recipeId: string) => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
});

const edge = (id: string, source: string, target: string, resourceId = "item:res") => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
});

describe("solver allocation", () => {
  it("pools unequal sources: a strong supplier covers a weak one's shortfall", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("src-slow", [], [{ kind: "item", id: "item:res", amount: 2 }]),
          recipe("src-fast", [], [{ kind: "item", id: "item:res", amount: 20 }]),
          recipe(
            "consumer",
            [{ kind: "item", id: "item:res", amount: 10 }],
            [{ kind: "item", id: "item:out", amount: 1 }],
          ),
        ],
        nodes: [node("A", "src-slow"), node("B", "src-fast"), node("C", "consumer")],
        edges: [edge("eA", "A", "C"), edge("eB", "B", "C")],
      }),
    );

    // 22/s available for a 10/s need: the consumer must run flat out.
    expect(result.nodes["C"]!.utilization).toBeCloseTo(1, 6);
    expect(result.edges["eA"]!.transferredPerSecond).toBeCloseTo(2, 6);
    expect(result.edges["eB"]!.transferredPerSecond).toBeCloseTo(8, 6);
  });

  it("conserves a split output: edge transfers sum to what the producer makes", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("producer", [], [{ kind: "item", id: "item:res", amount: 10 }]),
          recipe(
            "consumer",
            [{ kind: "item", id: "item:res", amount: 8 }],
            [{ kind: "item", id: "item:out", amount: 1 }],
          ),
        ],
        nodes: [node("P", "producer"), node("C1", "consumer"), node("C2", "consumer")],
        edges: [edge("e1", "P", "C1"), edge("e2", "P", "C2")],
      }),
    );

    const total =
      result.edges["e1"]!.transferredPerSecond + result.edges["e2"]!.transferredPerSecond;
    expect(total).toBeLessThanOrEqual(10 + 1e-5);
    expect(total).toBeCloseTo(10, 4);
    // Fair split: both consumers throttle to 5/8ths, nobody pretends to be full.
    expect(result.nodes["C1"]!.utilization).toBeCloseTo(0.625, 4);
    expect(result.nodes["C2"]!.utilization).toBeCloseTo(0.625, 4);
  });

  // Generous timeout: the 300-filler board legitimately needs ~1000 passes to
  // decay the loop, and suite-parallel workers share cores.
  it("gives a lossy loop the same answer regardless of unrelated board size", { timeout: 30000 }, () => {
    const build = (extraNodes: number) => {
      const recipes = [
        recipe(
          "recipe-a",
          [{ kind: "item", id: "item:x", amount: 10 }],
          [{ kind: "item", id: "item:y", amount: 10 }],
        ),
        recipe(
          "recipe-b",
          [{ kind: "item", id: "item:y", amount: 10 }],
          [{ kind: "item", id: "item:x", amount: 9.9 }],
        ),
        recipe("filler", [], [{ kind: "item", id: "item:misc", amount: 1 }]),
      ];
      const nodes = [node("A", "recipe-a"), node("B", "recipe-b")];
      for (let index = 0; index < extraNodes; index += 1) {
        nodes.push(node(`F${index}`, "filler"));
      }
      return project({
        recipes,
        nodes,
        edges: [edge("eAB", "A", "B", "item:y"), edge("eBA", "B", "A", "item:x")],
      });
    };

    const small = calculateThroughput(build(0));
    const large = calculateThroughput(build(300));

    // An unfed 1%-lossy loop truthfully winds down to (near) zero...
    expect(small.nodes["A"]!.utilization).toBeLessThan(0.01);
    // ...and unrelated nodes elsewhere must not change the answer.
    expect(Math.abs(small.nodes["A"]!.utilization - large.nodes["A"]!.utilization)).toBeLessThan(
      0.01,
    );
  });

  it("sand loop: unfed reads zero, fed externally reads full", () => {
    const sandLoop = (fed: boolean) =>
      project({
        recipes: [
          recipe(
            "sand-eater",
            [{ kind: "item", id: "item:sand", amount: 10 }],
            [
              { kind: "item", id: "item:sand", amount: 5 },
              { kind: "item", id: "item:glass", amount: 1 },
            ],
          ),
          recipe("sand-source", [], [{ kind: "item", id: "item:sand", amount: 5 }]),
        ],
        nodes: fed
          ? [node("M", "sand-eater"), node("S", "sand-source")]
          : [node("M", "sand-eater")],
        edges: fed
          ? [edge("self", "M", "M", "item:sand"), edge("ext", "S", "M", "item:sand")]
          : [edge("self", "M", "M", "item:sand")],
      });

    const unfed = calculateThroughput(sandLoop(false));
    expect(unfed.nodes["M"]!.utilization).toBeLessThan(0.01);

    const fed = calculateThroughput(sandLoop(true));
    expect(fed.nodes["M"]!.utilization).toBeCloseTo(1, 4);
    expect(fed.edges["self"]!.transferredPerSecond).toBeCloseTo(5, 4);
    expect(fed.edges["ext"]!.transferredPerSecond).toBeCloseTo(5, 4);
  });

  it("a trickle source beside a big one is not reported as starving anyone", () => {
    // Jack's repro: machine needs 0.8/s, sources make 0.05/s and 1.6/s. The
    // old per-edge-count nameplate made the trickle line read "starved, 13%
    // of the 0.4/s it owes" while the machine ran at 100%.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("trickle", [], [{ kind: "item", id: "item:res", amount: 0.05 }]),
          recipe("firehose", [], [{ kind: "item", id: "item:res", amount: 1.6 }]),
          recipe(
            "machine",
            [{ kind: "item", id: "item:res", amount: 0.8 }],
            [{ kind: "item", id: "item:out", amount: 1 }],
          ),
        ],
        nodes: [node("T", "trickle"), node("F", "firehose"), node("M", "machine")],
        edges: [edge("eT", "T", "M"), edge("eF", "F", "M")],
      }),
    );

    expect(result.nodes["M"]!.utilization).toBeCloseTo(1, 4);
    const trickleEdge = result.edges["eT"]!;
    expect(trickleEdge.transferredPerSecond).toBeCloseTo(0.05, 6);
    // The line carries everything asked of it; nothing is missing, so its
    // nameplate ask equals its delivery and it must not classify as starved.
    expect(trickleEdge.nameplateDemandPerSecond).toBeCloseTo(0.05, 4);
    expect(trickleEdge.constraint).toBe("full");
    expect(result.edges["eF"]!.transferredPerSecond).toBeCloseTo(0.75, 4);
  });

  it("balanced loop stays at full speed", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe(
            "recipe-a",
            [{ kind: "item", id: "item:x", amount: 10 }],
            [{ kind: "item", id: "item:y", amount: 10 }],
          ),
          recipe(
            "recipe-b",
            [{ kind: "item", id: "item:y", amount: 10 }],
            [{ kind: "item", id: "item:x", amount: 10 }],
          ),
        ],
        nodes: [node("A", "recipe-a"), node("B", "recipe-b")],
        edges: [edge("eAB", "A", "B", "item:y"), edge("eBA", "B", "A", "item:x")],
      }),
    );

    expect(result.nodes["A"]!.utilization).toBeCloseTo(1, 4);
    expect(result.nodes["B"]!.utilization).toBeCloseTo(1, 4);
  });

  it("simple chain still reads 100% everywhere", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("src", [], [{ kind: "item", id: "item:res", amount: 10 }]),
          recipe(
            "mid",
            [{ kind: "item", id: "item:res", amount: 10 }],
            [{ kind: "item", id: "item:mid", amount: 10 }],
          ),
          recipe(
            "end",
            [{ kind: "item", id: "item:mid", amount: 10 }],
            [{ kind: "item", id: "item:out", amount: 1 }],
          ),
        ],
        nodes: [node("S", "src"), node("M", "mid"), node("E", "end")],
        edges: [edge("e1", "S", "M", "item:res"), edge("e2", "M", "E", "item:mid")],
      }),
    );

    expect(result.nodes["S"]!.utilization).toBeCloseTo(1, 6);
    expect(result.nodes["M"]!.utilization).toBeCloseTo(1, 6);
    expect(result.nodes["E"]!.utilization).toBeCloseTo(1, 6);
  });
});
