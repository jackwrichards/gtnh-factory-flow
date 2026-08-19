import { describe, expect, it } from "vitest";
import type { FactoryProject } from "./types";
import { normalizeLoadedProject } from "./project-normalize";

const PROJECT_SCHEMA_VERSION = 1;

/**
 * A plan built while a filled cell could stand in for its fluid: a Dehydrator
 * making Oxygen Cells, wired to a TANK of Oxygen, with the consumer's cell slot
 * renamed to the fluid and its amount inflated to litres.
 */
function createCrossFormProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "cross-form",
    name: "Cross form",
    recipes: [
      {
        id: "cell-source",
        name: "Oxygen Cell Source",
        machineType: "Dehydrator",
        minimumTier: "LV",
        durationTicks: 196,
        eut: 16,
        inputs: [{ kind: "item", id: "empty_cell", amount: 14, displayName: "Empty Cell" }],
        outputs: [{ kind: "item", id: "oxygen_cell", amount: 14, displayName: "Oxygen Cell" }],
      },
      {
        id: "cell-consumer",
        name: "Cell Consumer",
        machineType: "Chemical Reactor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "oxygen_cell", amount: 2, displayName: "Oxygen Cell" }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "source",
        recipeId: "cell-source",
        machineCount: 1,
        parallel: 1,
        position: { x: 0, y: 0 },
      },
      {
        id: "consumer",
        recipeId: "cell-consumer",
        machineCount: 1,
        parallel: 1,
        position: { x: 400, y: 0 },
        recipeInputOverrides: {
          "0": { kind: "fluid", id: "oxygen", amount: 2000, displayName: "Oxygen" },
        },
      },
    ],
    storages: [
      {
        id: "tank",
        kind: "fluid",
        resourceId: "oxygen",
        displayName: "Oxygen",
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "source-to-tank",
        source: "source",
        target: "tank",
        resourceKind: "fluid",
        resourceId: "oxygen",
      },
      {
        id: "source-to-consumer",
        source: "source",
        target: "consumer",
        resourceKind: "item",
        resourceId: "oxygen_cell",
      },
    ],
  } as unknown as FactoryProject;
}

describe("dropping cross-form connections on load", () => {
  it("drops a wire that crosses a cell and its fluid, and keeps the honest one", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    // The Dehydrator makes an ITEM. It never fed that Oxygen tank without a
    // Canner, so the wire goes and the chain reads short by exactly that much.
    expect(normalized.edges.map((edge) => edge.id)).toEqual(["source-to-consumer"]);
  });

  it("drops a slot override that renamed a cell slot into its fluid", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    // The override also carried 2000, converted at a guessed 1000 L per cell.
    // Leaving it would keep that guess in the numbers.
    expect(normalized.nodes.find((node) => node.id === "consumer")?.recipeInputOverrides).toEqual(
      {},
    );
  });

  it("leaves the tank on the board rather than deleting someone's card", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    expect(normalized.storages?.map((storage) => storage.id)).toEqual(["tank"]);
  });

  it("returns a plan with nothing to repair unchanged", () => {
    const clean = createCrossFormProject();
    clean.edges = clean.edges.filter((edge) => edge.id === "source-to-consumer");
    clean.nodes = clean.nodes.map((node) => ({ ...node, recipeInputOverrides: undefined }));

    const normalized = normalizeLoadedProject(clean);
    expect(normalized.edges).toHaveLength(1);
    expect(
      normalized.nodes.find((node) => node.id === "consumer")?.recipeInputOverrides,
    ).toBeUndefined();
  });
});

describe("wires into a trash can survive a reload", () => {
  /** A plate maker with its output piped into a can, saved and loaded back. */
  function createTrashProject(kind: "item" | "fluid"): FactoryProject {
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "trash",
      name: "Trash",
      recipes: [
        {
          id: "maker",
          name: "Maker",
          machineType: "Chemical Reactor",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind, id: "waste", amount: 1 }],
        },
        {
          id: "trash-recipe",
          name: "Trash Can",
          kind: "custom",
          category: "trash",
          machineType: "Trash Can",
          minimumTier: "NONE",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [],
        },
      ],
      nodes: [
        { id: "maker", recipeId: "maker", machineCount: 1, parallel: 1, position: { x: 0, y: 0 } },
        { id: "can", recipeId: "trash-recipe", machineCount: 1, parallel: 1, position: { x: 400, y: 0 } },
      ],
      storages: [],
      edges: [
        { id: "to-can", source: "maker", target: "can", resourceKind: kind, resourceId: "waste" },
      ],
    } as unknown as FactoryProject;
  }

  // A can has no slots at all, so the "does this end have a slot of that kind"
  // test answered no for every wire into one and quietly deleted it on load.
  // Emptiness is what a can IS, not evidence of a broken wire.
  it("keeps an item wire into a can", () => {
    const normalized = normalizeLoadedProject(createTrashProject("item"));
    expect(normalized.edges.map((edge) => edge.id)).toEqual(["to-can"]);
  });

  it("keeps a fluid wire into a can", () => {
    const normalized = normalizeLoadedProject(createTrashProject("fluid"));
    expect(normalized.edges.map((edge) => edge.id)).toEqual(["to-can"]);
  });
});

describe("dropping doubled wires on load", () => {
  it("keeps one wire when the same two rows were wired twice", () => {
    const doubled = createCrossFormProject();
    doubled.edges = [
      {
        id: "auto-connected",
        source: "source",
        target: "consumer",
        sourceHandle: "output:item:oxygen_cell:0",
        targetHandle: "input:item:oxygen_cell:0",
        resourceKind: "item",
        resourceId: "oxygen_cell",
        label: "Oxygen Cell",
      },
      {
        id: "hand-drawn",
        source: "source",
        target: "consumer",
        sourceHandle: "output:item:oxygen_cell",
        targetHandle: "input:item:oxygen_cell",
        resourceKind: "item",
        resourceId: "oxygen_cell",
        label: "Oxygen Cell",
      },
    ];

    const normalized = normalizeLoadedProject(doubled);
    expect(normalized.edges.map((edge) => edge.id)).toEqual(["auto-connected"]);
  });
});

describe("dropping pre-generator fuel settings on load", () => {
  // The fuel estimate is gone: power is a resource on the board, not a
  // per-project guess. Plans saved with the old fields still load - the
  // fields are simply not there anymore.
  it("drops a pre-generator plan's fuel setting on load", () => {
    const raw = {
      ...createCrossFormProject(),
      fuelProfiles: [
        {
          id: "biodiesel",
          name: "Biodiesel",
          fuelFluidId: "biodiesel",
          euPerLiter: 12800,
          notes: "GTNH generator fuel value.",
        },
      ],
      selectedFuelProfileId: "biodiesel",
    };

    const loaded = normalizeLoadedProject(raw as never);
    expect("fuelProfiles" in loaded).toBe(false);
    expect("selectedFuelProfileId" in loaded).toBe(false);
  });
});
