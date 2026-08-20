import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "./types";
import { getPocketResourceForHandle, resolvePocketMemberIds } from "./pocket-connections";

/**
 * One machine in a pocket, drinking an ORE DICTIONARY form of carbon dust.
 *
 * The card's ports and the drag layer derive from different places: ports come
 * from a scoped solve plus every wire crossing the boundary, so a port can be
 * keyed by the CONCRETE form a wire was stored against, while the member's
 * recipe names the oredict form. That gap used to kill the drag before it
 * started - the port drew fine and refused to be picked up.
 */
function makeOredictPocketProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "pocket-oredict-project",
    name: "Pocket oredict test",
    recipes: [
      {
        id: "mix",
        name: "Mix",
        machineType: "Mixer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [
          {
            kind: "item",
            id: "oredict:dustCarbon",
            amount: 1,
            alternatives: [
              { kind: "item", id: "carbon_dust" },
              { kind: "item", id: "charcoal_dust" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "mixture", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "mixer",
        recipeId: "mix",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
        pocketId: "pocket-1",
      },
    ],
    edges: [],
    storages: [],
    annotations: [],
    pockets: [{ id: "pocket-1", name: "Carbon line", position: { x: 0, y: 0 } }],
  };
}

describe("pocket port resolution", () => {
  it("resolves a port keyed by the exact resource a member names", () => {
    const project = makeOredictPocketProject();

    const resource = getPocketResourceForHandle(project, "pocket-1", "input", {
      kind: "item",
      id: "oredict:dustCarbon",
    });

    expect(resource.id).toBe("oredict:dustCarbon");
    expect(
      resolvePocketMemberIds(project, "pocket-1", "input", {
        kind: "item",
        id: "oredict:dustCarbon",
      }),
    ).toEqual(["mixer"]);
  });

  it("resolves a port keyed by a concrete form the member accepts as an alternative", () => {
    const project = makeOredictPocketProject();

    const resource = getPocketResourceForHandle(project, "pocket-1", "input", {
      kind: "item",
      id: "carbon_dust",
    });

    // The PORT's identity wins: the handle and the card already agree on it,
    // so the drag must carry the concrete form rather than silently becoming
    // the oredict entry.
    expect(resource.kind).toBe("item");
    expect(resource.id).toBe("carbon_dust");

    // ...and it still finds the member standing behind that port, which is
    // what a drop (or a drag into the void, which spawns a buffer) needs.
    expect(
      resolvePocketMemberIds(project, "pocket-1", "input", {
        kind: "item",
        id: "carbon_dust",
      }),
    ).toEqual(["mixer"]);
  });

  it("never answers nothing for a port, even one no member names", () => {
    const project = makeOredictPocketProject();

    const resource = getPocketResourceForHandle(project, "pocket-1", "input", {
      kind: "item",
      id: "unknown_dust",
    });

    expect(resource.kind).toBe("item");
    expect(resource.id).toBe("unknown_dust");
  });

  it("keeps a genuinely different form on its own port", () => {
    const project = makeOredictPocketProject();
    // A second member drinking a concrete form that is NOT one of the first
    // member's alternatives must not be swept into the oredict port.
    project.recipes.push({
      id: "grind",
      name: "Grind",
      machineType: "Macerator",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [{ kind: "item", id: "graphite", amount: 1 }],
      outputs: [{ kind: "item", id: "graphite_dust", amount: 1 }],
    });
    project.nodes.push({
      id: "macerator",
      recipeId: "grind",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 200, y: 0 },
      pocketId: "pocket-1",
    });

    expect(
      resolvePocketMemberIds(project, "pocket-1", "input", {
        kind: "item",
        id: "graphite",
      }),
    ).toEqual(["macerator"]);
    expect(
      resolvePocketMemberIds(project, "pocket-1", "input", {
        kind: "item",
        id: "carbon_dust",
      }),
    ).toEqual(["mixer"]);
  });
});
