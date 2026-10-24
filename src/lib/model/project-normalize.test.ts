import { describe, expect, it } from "vitest";
import type { FactoryProject } from "./types";
import { normalizeLoadedProject, normalizeLoadedProjectWithNotice } from "./project-normalize";

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
    fuelProfiles: [],
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

/**
 * The shape players saved from a search for what makes Distilled Water: the
 * dataset offered Distilled Water in every Water slot, so the pick filled the
 * Distillation Tower's Water slot with its own product, and the tower then
 * needed a drawer of Distilled Water to make Distilled Water. A Distillery
 * picked from the uses of Water stored Water itself.
 */
function createSelfLoopProject(): FactoryProject {
  const water = { kind: "fluid", id: "water", displayName: "Water" } as const;
  const distilled = { kind: "fluid", id: "ic2distilledwater", displayName: "Distilled Water" } as const;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "self-loop",
    name: "Self loop",
    recipes: [
      {
        id: "tower-distilled-water",
        name: "Distillation Tower: Distilled Water",
        machineType: "Distillation Tower",
        minimumTier: "MV",
        durationTicks: 32,
        eut: 120,
        inputs: [
          { ...water, amount: 1000, alternatives: [{ ...water, amount: 1 }, { ...distilled, amount: 1 }] },
        ],
        outputs: [{ ...distilled, amount: 1000 }],
      },
      {
        id: "distillery-distilled-water",
        name: "Distillery: Distilled Water",
        machineType: "Distillery",
        minimumTier: "ULV",
        durationTicks: 25,
        eut: 7,
        inputs: [
          { ...water, amount: 10, alternatives: [{ ...water, amount: 1 }, { ...distilled, amount: 1 }] },
        ],
        outputs: [{ ...distilled, amount: 10 }],
      },
      {
        id: "reactor",
        name: "Chemical Reactor: Something",
        machineType: "Chemical Reactor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ ...distilled, amount: 1000 }],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "tower",
        recipeId: "tower-distilled-water",
        machineCount: 1,
        parallel: 1,
        position: { x: 0, y: 0 },
        recipeInputOverrides: { "0": { ...distilled, amount: 1000 } },
      },
      {
        id: "distillery",
        recipeId: "distillery-distilled-water",
        machineCount: 1,
        parallel: 1,
        position: { x: 0, y: 400 },
        recipeInputOverrides: { "0": { ...water, amount: 1 } },
      },
      {
        id: "reactor",
        recipeId: "reactor",
        machineCount: 1,
        parallel: 1,
        position: { x: 400, y: 0 },
      },
    ],
    storages: [
      {
        id: "drawer",
        kind: "fluid",
        resourceId: "ic2distilledwater",
        displayName: "Distilled Water",
        position: { x: -400, y: 0 },
      },
    ],
    edges: [
      {
        id: "drawer-to-tower",
        source: "drawer",
        target: "tower",
        sourceHandle: "output:fluid:ic2distilledwater",
        targetHandle: "input:fluid:ic2distilledwater",
        resourceKind: "fluid",
        resourceId: "ic2distilledwater",
      },
      {
        id: "tower-to-reactor",
        source: "tower",
        target: "reactor",
        sourceHandle: "output:fluid:ic2distilledwater",
        targetHandle: "input:fluid:ic2distilledwater",
        resourceKind: "fluid",
        resourceId: "ic2distilledwater",
      },
    ],
    fuelProfiles: [],
  } as unknown as FactoryProject;
}

describe("a slot filled with its own recipe's product, on load", () => {
  it("puts the Distillation Tower back on Water", () => {
    const tower = normalizeLoadedProject(createSelfLoopProject()).nodes.find((node) => node.id === "tower");

    expect(tower?.recipeInputOverrides).toBeUndefined();
  });

  it("drops the Distilled Water wire into that slot and keeps the drawer and the tower's own output", () => {
    const normalized = normalizeLoadedProject(createSelfLoopProject());

    expect(normalized.edges.map((edge) => edge.id)).toEqual(["tower-to-reactor"]);
    expect(normalized.storages?.map((storage) => storage.id)).toEqual(["drawer"]);
  });

  it("keeps a slot set to its own resource", () => {
    const distillery = normalizeLoadedProject(createSelfLoopProject()).nodes.find(
      (node) => node.id === "distillery",
    );

    expect(distillery?.recipeInputOverrides?.["0"]).toEqual(expect.objectContaining({ id: "water" }));
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
      fuelProfiles: [],
    } as unknown as FactoryProject;
  }

  // The can node retired into the drawer pill's trash position (2026-08-23):
  // a loaded plan's cans become trash-mode drawers, and the wire survives by
  // pointing at the drawer instead.
  it("converts an item wire's can into a trash drawer", () => {
    const normalized = normalizeLoadedProject(createTrashProject("item"));

    expect(normalized.nodes.map((node) => node.id)).toEqual(["maker"]);
    expect(normalized.recipes.some((recipe) => recipe.machineType === "Trash Can")).toBe(false);
    const drawer = normalized.storages?.[0];
    expect(drawer?.drainMode).toBe("trash");
    expect(drawer?.kind).toBe("item");
    expect(drawer?.resourceId).toBe("waste");
    expect(normalized.edges).toHaveLength(1);
    expect(normalized.edges[0]?.target).toBe(drawer?.id);
  });

  it("converts a fluid wire's can into a trash tank", () => {
    const normalized = normalizeLoadedProject(createTrashProject("fluid"));

    const drawer = normalized.storages?.[0];
    expect(drawer?.drainMode).toBe("trash");
    expect(drawer?.kind).toBe("fluid");
    expect(normalized.edges[0]?.target).toBe(drawer?.id);
    expect(normalized.edges[0]?.targetHandle).toBe("input:fluid:waste");
  });

  it("splits a can drinking two resources into two trash drawers", () => {
    const base = createTrashProject("item");
    base.recipes.push({
      id: "maker2",
      name: "Maker 2",
      machineType: "Chemical Reactor",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [],
      outputs: [{ kind: "fluid", id: "sludge", amount: 1 }],
    } as (typeof base.recipes)[number]);
    base.nodes.push({
      id: "maker2",
      recipeId: "maker2",
      machineCount: 1,
      parallel: 1,
      position: { x: 0, y: 200 },
    } as (typeof base.nodes)[number]);
    base.edges.push({
      id: "to-can-2",
      source: "maker2",
      target: "can",
      resourceKind: "fluid",
      resourceId: "sludge",
    } as (typeof base.edges)[number]);

    const normalized = normalizeLoadedProject(base);

    expect(normalized.storages).toHaveLength(2);
    const targets = new Set(normalized.edges.map((edge) => edge.target));
    expect(targets.size).toBe(2);
    expect(normalized.storages?.every((storage) => storage.drainMode === "trash")).toBe(true);
    // The second drawer steps down a tile so the pair never stack.
    expect(normalized.storages?.[1]?.position.y).not.toBe(normalized.storages?.[0]?.position.y);
  });

  it("drops an unwired can outright", () => {
    const base = createTrashProject("item");
    base.edges = [];

    const normalized = normalizeLoadedProject(base);

    expect(normalized.nodes.map((node) => node.id)).toEqual(["maker"]);
    expect(normalized.storages ?? []).toHaveLength(0);
  });
});

describe("loose cell wires on load", () => {
  it("turns a cell wired into a fluid slot into a fluid tank between the two", () => {
    const project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "loose",
      name: "Loose",
      recipes: [
        {
          id: "fill",
          name: "Fill",
          machineType: "Bender",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [],
          outputs: [{ kind: "item", id: "water_cell", amount: 1 }],
        },
        {
          id: "drink",
          name: "Drink",
          machineType: "Bender",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 30,
          inputs: [{ kind: "fluid", id: "water", amount: 1000 }],
          outputs: [{ kind: "item", id: "sponge", amount: 1 }],
        },
      ],
      nodes: [
        { id: "maker", recipeId: "fill", machineCount: 1, parallel: 1, position: { x: 0, y: 0 } },
        { id: "taker", recipeId: "drink", machineCount: 1, parallel: 1, position: { x: 400, y: 0 } },
      ],
      storages: [],
      edges: [
        {
          id: "w",
          source: "maker",
          target: "taker",
          sourceHandle: "output:item:water_cell",
          targetHandle: "input:fluid:water",
          resourceKind: "item",
          resourceId: "water_cell",
          crossForm: { litresPerCell: 1000 },
        },
      ],
      fuelProfiles: [],
    } as unknown as FactoryProject;

    const { project: normalized, notice } = normalizeLoadedProjectWithNotice(project);
    const tank = normalized.nodes.find((node) => node.id === "cell-tank:w");
    expect(tank).toBeDefined();
    expect(normalized.edges.map((edge) => [edge.id, edge.source, edge.target, edge.crossForm])).toEqual([
      ["w", "maker", "cell-tank:w", undefined],
      ["w:tank", "cell-tank:w", "taker", undefined],
    ]);
    expect(notice?.details).toContain("1 cell wire now goes through a fluid tank.");
    // A parser keeps the wire for the landing to convert and say so.
    expect(normalizeLoadedProject(project, { keepMode: true }).edges[0]?.crossForm?.litresPerCell).toBe(1000);
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

describe("board windows on load", () => {
  it("snaps a board's frame to whole cells and keeps its open state", () => {
    const project = createCrossFormProject();
    project.pockets = [
      {
        id: "board",
        name: "Ragged board",
        position: { x: 13, y: 7 },
        expanded: true,
        size: { width: 493, height: 301 },
      },
    ];

    const normalized = normalizeLoadedProject(project);
    const board = normalized.pockets?.[0];
    expect(board?.expanded).toBe(true);
    expect(board?.position).toEqual({ x: 20, y: 0 });
    expect(board?.size).toEqual({ width: 500, height: 320 });
  });
});
