import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { computePocketSummaries } from "./pocket-summary";

/**
 * Two chained machines inside one pocket: ore in, plate out, the ingot
 * wired between them. The card's ports come from a members-only scoped
 * solve, and since the plan closed at both ends (v1.44.0) that sub-plan
 * starves at every severed wire unless its boundary is healed first — so
 * a pocket used to draw no ports at all until the sketch toggle happened
 * to close the boundary for it.
 */
function makeChainPocketProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "pocket-chain-project",
    name: "Pocket chain test",
    recipes: [
      {
        id: "smelt",
        name: "Smelt",
        machineType: "Electric Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_ore", amount: 1 }],
        outputs: [{ kind: "item", id: "iron_ingot", amount: 1 }],
      },
      {
        id: "press",
        name: "Press",
        machineType: "Bending Machine",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_ingot", amount: 1 }],
        outputs: [{ kind: "item", id: "iron_plate", amount: 1 }],
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
        pocketId: "pocket-1",
      },
      {
        id: "presser",
        recipeId: "press",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 300, y: 0 },
        pocketId: "pocket-1",
      },
    ],
    edges: [
      {
        id: "e-ingot",
        source: "smelter",
        target: "presser",
        resourceKind: "item",
        resourceId: "iron_ingot",
      },
    ],
    storages: [],
    annotations: [],
    pockets: [{ id: "pocket-1", name: "Plates", position: { x: 0, y: 0 } }],
  };
}

describe("computePocketSummaries", () => {
  it("gives the card its ports without sketch mode", () => {
    const project = makeChainPocketProject();
    expect(project.assumeBoundaries).toBeUndefined();

    const summary = computePocketSummaries(project, project.pockets ?? []).get("pocket-1");
    expect(summary).toBeDefined();

    expect(summary!.inputs.map((port) => port.resourceId)).toEqual(["iron_ore"]);
    expect(summary!.inputs[0]!.ratePerSecond).toBeCloseTo(1);
    expect(summary!.outputs.map((port) => port.resourceId)).toEqual(["iron_plate"]);
    expect(summary!.outputs[0]!.ratePerSecond).toBeCloseTo(1);

    expect(summary!.machineCount).toBe(2);
    expect(summary!.memberCount).toBe(2);
  });

  it("answers the same with the sketch toggle on", () => {
    const strict = makeChainPocketProject();
    const sketched = { ...makeChainPocketProject(), assumeBoundaries: true };

    const strictSummary = computePocketSummaries(strict, strict.pockets ?? []).get("pocket-1");
    const sketchedSummary = computePocketSummaries(sketched, sketched.pockets ?? []).get(
      "pocket-1",
    );

    expect(strictSummary).toEqual(sketchedSummary);
  });
});
