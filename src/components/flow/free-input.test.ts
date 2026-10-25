import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { isBeeSpeciesInput, isFreeRecipeInput, isRecipeInputConsumed } from "@/lib/model";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildRailPorts, deriveNodeVerdict, findUnwiredNodeIds } from "./node-verdict";

/**
 * "IT'S FREE! Place Lava on Side": the Rock Breaker's placeholder input.
 * The game wants lava touching the machine, not a stack fed in, so the slot
 * is never supplied, never wired and never a bare-slot mark - but the card
 * still draws it so the player knows to set the lava down.
 */
const FREE = "gregtech:gt.metaitem.02@32765";

function project(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "free-input-exam",
    name: "free-input-exam",
    recipes: [
      {
        id: "rockbreak",
        name: "Rock Breaker: Cobblestone",
        machineType: "Rock Breaker",
        minimumTier: "LV",
        durationTicks: 16,
        eut: 30,
        inputs: [
          { kind: "item", id: FREE, amount: 1, displayName: "IT'S FREE! Place Lava on Side" },
        ],
        outputs: [{ kind: "item", id: "minecraft:cobblestone", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "rb",
        recipeId: "rockbreak",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ],
    storages: [{ id: "d", kind: "item", resourceId: "minecraft:cobblestone", position: { x: 0, y: 0 } }],
    edges: [
      { id: "e1", source: "rb", target: "d", resourceKind: "item", resourceId: "minecraft:cobblestone" },
    ],
    fuelProfiles: [],
  } as FactoryProject;
}

describe("free-in-the-game inputs", () => {
  it("are never consumed", () => {
    expect(isFreeRecipeInput({ kind: "item", id: FREE })).toBe(true);
    expect(isFreeRecipeInput({ kind: "fluid", id: FREE })).toBe(false);
    expect(isRecipeInputConsumed({ kind: "item", id: FREE })).toBe(false);
    expect(isRecipeInputConsumed({ kind: "item", id: "minecraft:cobblestone" })).toBe(true);
  });

  it("let the machine run with nothing wired to the slot", () => {
    const proj = project();
    const result = calculateThroughput(proj, { generatedAt: "fixed" });
    expect(result.nodes["rb"]!.utilization).toBeCloseTo(1, 4);
    expect(Object.keys(result.nodes["rb"]!.inputs)).toEqual([]);
    expect(findUnwiredNodeIds(proj, result)).toEqual([]);
    expect(deriveNodeVerdict(proj, result, "rb").kind).toBe("balanced");
  });

  it("still sit on the card as an inert greyed row", () => {
    const proj = project();
    const result = calculateThroughput(proj, { generatedAt: "fixed" });
    const verdict = deriveNodeVerdict(proj, result, "rb");
    const rails = buildRailPorts(proj, result, "rb", proj.recipes[0]!, verdict);
    expect(rails.inputs).toHaveLength(1);
    const port = rails.inputs[0]!;
    expect(port.free).toBe(true);
    expect(port.displayName).toBe("IT'S FREE! Place Lava on Side");
    expect(port.unsupplied).toBe(false);
    expect(port.nameplatePerSecond).toBe(0);
    expect(port.currentPerSecond).toBe(0);
    expect(rails.outputs).toHaveLength(1);
  });
});

describe("a bee card's species", () => {
  const SALT = "factoryflow:bee_species:gregtech-bee-speciessalt";

  function beeProject(): FactoryProject {
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "bee-row-exam",
      name: "bee-row-exam",
      recipes: [
        {
          id: "salt",
          name: "Salt Bee",
          kind: "bee_produce",
          category: "forestry-bee",
          machineType: "Apiary",
          minimumTier: "NONE",
          durationTicks: 550,
          eut: 0,
          inputs: [{ kind: "item", id: SALT, amount: 1, displayName: "Salt Bee", consumed: false }],
          outputs: [{ kind: "item", id: "gregtech:gt.comb@salt", amount: 1 }],
          source: { recipeMap: "Bee Produce" },
        },
      ],
      nodes: [
        {
          id: "bee",
          recipeId: "salt",
          machineCount: 1,
          parallel: 1,
          overclockTier: "NONE",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [{ id: "d", kind: "item", resourceId: "gregtech:gt.comb@salt", position: { x: 0, y: 0 } }],
      edges: [{ id: "e1", source: "bee", target: "d", resourceKind: "item", resourceId: "gregtech:gt.comb@salt" }],
      fuelProfiles: [],
    } as FactoryProject;
  }

  it("is drawn as an inert row naming the bee, with nothing to wire", () => {
    expect(isBeeSpeciesInput({ kind: "item", id: SALT })).toBe(true);
    expect(isFreeRecipeInput({ kind: "item", id: SALT })).toBe(false);
    const proj = beeProject();
    const result = calculateThroughput(proj, { generatedAt: "fixed" });
    const rails = buildRailPorts(proj, result, "bee", proj.recipes[0]!, deriveNodeVerdict(proj, result, "bee"));
    expect(rails.inputs).toHaveLength(1);
    const port = rails.inputs[0]!;
    expect(port.free).toBe(true);
    expect(port.displayName).toBe("Salt Bee");
    expect(port.unsupplied).toBe(false);
    expect(port.nameplatePerSecond).toBe(0);
    expect(findUnwiredNodeIds(proj, result)).toEqual([]);
  });
});
