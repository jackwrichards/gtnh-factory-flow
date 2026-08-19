import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Sketch mode (`assumeBoundaries`): the solve assumes the plan's boundary.
 * Every bare input is supplied for free and every bare output exported, via
 * virtual drawers that never reach the board. Anything the player DID wire
 * keeps exactly its wired behaviour.
 */

const RECIPES = [
  {
    id: "smelt",
    name: "smelt",
    machineType: "Furnace",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "item" as const, id: "ore", amount: 2 }],
    outputs: [{ kind: "item" as const, id: "ingot", amount: 1 }],
  },
  {
    id: "press",
    name: "press",
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "item" as const, id: "ingot", amount: 1 }],
    outputs: [{ kind: "item" as const, id: "plate", amount: 1 }],
  },
];

function board(assume: boolean): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "sketch",
    name: "sketch",
    assumeBoundaries: assume || undefined,
    recipes: RECIPES,
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
        id: "presser",
        recipeId: "press",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      {
        id: "mid",
        source: "smelter",
        target: "presser",
        resourceKind: "item",
        resourceId: "ingot",
      },
    ],
  } as FactoryProject;
}

describe("sketch mode: the plan assumes its own boundary", () => {
  it("a half-wired chain reads zero until the boundary is drawn", () => {
    const result = calculateThroughput(board(false), { generatedAt: "fixed" });
    expect(result.nodes["smelter"].utilization).toBeCloseTo(0);
    expect(result.nodes["presser"].utilization).toBeCloseTo(0);
  });

  it("the same chain runs flat out with the boundary assumed", () => {
    const result = calculateThroughput(board(true), { generatedAt: "fixed" });
    expect(result.nodes["smelter"].utilization).toBeCloseTo(1);
    expect(result.nodes["presser"].utilization).toBeCloseTo(1);
    // The wire the player drew still carries the real flow.
    expect(result.edges["mid"].transferredPerSecond).toBeCloseTo(1);
  });
});
