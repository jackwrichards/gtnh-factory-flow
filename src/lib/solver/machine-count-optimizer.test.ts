import { describe, expect, it } from "vitest";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { optimizeMachineCountsForProject } from "./machine-count-optimizer";

/**
 * A machine can be wired into its own input, so the optimizer has to survive a
 * component that is a single node looping back on itself.
 *
 * It nearly did not. Self edges were dropped from the SCC adjacency before it
 * was built, which made the optimizer's own "does this component include
 * itself" test permanently false and switched every cyclic guard off for the
 * one shape they exist to catch. A lossy self loop then walked
 * requireNodeOutput round its own ring, multiplying demand by
 * inputRate/outputRate each pass, until the number overflowed.
 */

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
    id: "optimizer-test",
    name: "optimizer-test",
    storages: [],
    ...partial,
  } as FactoryProject;
}

const node = (id: string, recipeId: string, extra: Record<string, unknown> = {}) => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
  ...extra,
});

const selfEdge = (id: string, nodeId: string, resourceId: string) => ({
  id,
  source: nodeId,
  target: nodeId,
  resourceKind: "item" as const,
  resourceId,
});

describe("machine count optimizer: self loops", () => {
  // A demand seed is what makes the walk reachable at all, so the lossy case
  // has to carry one to be a real reproduction.
  const lossyLoop = () =>
    project({
      recipes: [
        // Eats 10 of its own product to make 5 back, plus something wanted.
        recipe(
          "lossy",
          [{ kind: "item", id: "item:sand", amount: 10 }],
          [
            { kind: "item", id: "item:sand", amount: 5 },
            { kind: "item", id: "item:glass", amount: 1 },
          ],
        ),
      ],
      nodes: [
        node("M", "lossy", {
          targetOutput: { kind: "item", resourceId: "item:glass", amountPerSecond: 100 },
        }),
      ],
      edges: [selfEdge("self", "M", "item:sand")],
    });

  it("terminates on a lossy self loop instead of diverging", { timeout: 10000 }, () => {
    const result = optimizeMachineCountsForProject(lossyLoop());
    const count = result.machineCounts.get("M");

    expect(Number.isFinite(count)).toBe(true);
    // The real guard: before the fix this ran away to an astronomical value
    // rather than settling anywhere sane.
    expect(count).toBeLessThan(1_000_000);
  });

  it("terminates on a self-sustaining self loop", { timeout: 10000 }, () => {
    const gainy = project({
      recipes: [
        recipe(
          "gainy",
          [{ kind: "item", id: "item:seed", amount: 1 }],
          [
            { kind: "item", id: "item:seed", amount: 2 },
            { kind: "item", id: "item:crop", amount: 1 },
          ],
        ),
      ],
      nodes: [
        node("G", "gainy", {
          targetOutput: { kind: "item", resourceId: "item:crop", amountPerSecond: 10 },
        }),
      ],
      edges: [selfEdge("self", "G", "item:seed")],
    });

    const result = optimizeMachineCountsForProject(gainy);
    const count = result.machineCounts.get("G");

    expect(Number.isFinite(count)).toBe(true);
    expect(count).toBeLessThan(1_000_000);
  });
});
