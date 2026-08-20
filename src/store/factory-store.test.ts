import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetManifest, RecipeSummary } from "@/lib/datasets";
import { getRecipeDatasetRecipe, queryRecipeDatasetRecipes } from "@/lib/datasets/browser-loader";
import { PROJECT_SCHEMA_VERSION, type FactoryNode, type FactoryProject, type Recipe } from "@/lib/model/types";
import { makeResourceHandleId } from "@/components/flow/resource-handles";
import { calculateThroughput } from "@/lib/solver";
import {
  captureBoardSelection,
  collectPocketConvergenceWarnings,
  pickPowerRecipe,
  useFactoryStore,
} from "./factory-store";

vi.mock("@/lib/datasets/browser-loader", () => ({
  getRecipeDatasetRecipe: vi.fn(),
  queryRecipeDatasetRecipes: vi.fn(),
}));

describe("factory resource links", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject(createLinkTestProject());
  });

  it("connects matching item recipe slots with explicit handles", () => {
    useFactoryStore.getState().connectNodes("item-source", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({
        source: "item-source",
        target: "item-target",
        sourceHandle: "output:item:dust:0",
        targetHandle: "input:item:dust:0",
        resourceKind: "item",
        resourceId: "dust",
      }),
    ]);
  });

  it("connects concrete item outputs to ore dictionary inputs", () => {
    useFactoryStore.getState().connectNodes("stick-source", "stick-oredict-target", {
      kind: "item",
      id: "minecraft:stick@0",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:stick@0" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "oredict:stickWood" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "stick-source",
        target: "stick-oredict-target",
        sourceHandle: "output:item:minecraft%3Astick%400:0",
        targetHandle: "input:item:oredict%3AstickWood:0",
        resourceKind: "item",
        resourceId: "minecraft:stick@0",
      }),
    );
  });

  it("stores the concrete connected resource on an ore dictionary input node", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "connected-oredict-override-test",
      name: "Connected oredict override test",
      recipes: [
        {
          id: "tgs",
          name: "Tree Growth Simulator",
          machineType: "Tree Growth Simulator",
          minimumTier: "LV",
          durationTicks: 100,
          eut: 0,
          inputs: [],
          outputs: [
            {
              kind: "item",
              id: "minecraft:log@1",
              amount: 16,
              displayName: "Spruce Log",
              iconPath: "/items/spruce-log.png",
            },
          ],
        },
        {
          id: "coke",
          name: "Coke Oven",
          machineType: "Coke Oven",
          minimumTier: "MV",
          durationTicks: 256,
          eut: 96,
          inputs: [
            {
              kind: "item",
              id: "oredict:logWood",
              amount: 16,
              displayName: "Ore Dictionary: logWood",
              alternatives: [
                {
                  kind: "item",
                  id: "minecraft:log@0",
                  displayName: "Oak Log",
                  iconPath: "/items/oak-log.png",
                },
                {
                  kind: "item",
                  id: "minecraft:log@1",
                  displayName: "Spruce Log",
                  iconPath: "/items/old-spruce-log.png",
                },
              ],
            },
          ],
          outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
        },
      ],
      nodes: [
        {
          id: "tgs-node",
          recipeId: "tgs",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "coke-node",
          recipeId: "coke",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 400, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().connectNodes("tgs-node", "coke-node", {
      kind: "item",
      id: "minecraft:log@1",
      displayName: "Spruce Log",
      iconPath: "/items/spruce-log.png",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:log@1" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "oredict:logWood" }, 0),
    });

    expect(useFactoryStore.getState().project.nodes[1]?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        iconPath: "/items/spruce-log.png",
        alternatives: undefined,
      }),
    );
  });

  it("connects explicit concrete handles even when the source recipe output is contextual", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "contextual-output-link-test",
      name: "Contextual output link test",
      recipes: [
        {
          id: "tgs",
          name: "Tree Growth Simulator",
          machineType: "Tree Growth Simulator",
          minimumTier: "LV",
          durationTicks: 100,
          eut: 0,
          inputs: [],
          outputs: [
            {
              kind: "item",
              id: "oredict:logWood",
              amount: 16,
              displayName: "Ore Dictionary: logWood",
              alternatives: [{ kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" }],
            },
          ],
        },
        {
          id: "coke",
          name: "Coke Oven",
          machineType: "Coke Oven",
          minimumTier: "MV",
          durationTicks: 256,
          eut: 96,
          inputs: [
            {
              kind: "item",
              id: "oredict:logWood",
              amount: 16,
              displayName: "Ore Dictionary: logWood",
              alternatives: [{ kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" }],
            },
          ],
          outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
        },
      ],
      nodes: [
        {
          id: "tgs-node",
          recipeId: "tgs",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
        {
          id: "coke-node",
          recipeId: "coke",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          recipeInputOverrides: {
            "0": {
              kind: "item",
              id: "minecraft:log@1",
              amount: 16,
              displayName: "Spruce Log",
            },
          },
          enabled: true,
          position: { x: 400, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().connectNodes("tgs-node", "coke-node", {
      kind: "item",
      id: "minecraft:log@1",
      displayName: "Spruce Log",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:log@1" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "minecraft:log@1" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "tgs-node",
        target: "coke-node",
        resourceKind: "item",
        resourceId: "minecraft:log@1",
        sourceHandle: "output:item:minecraft%3Alog%401:0",
        targetHandle: "input:item:minecraft%3Alog%401:0",
      }),
    );

    useFactoryStore.getState().updateNode("tgs-node", {
      machineConfigTiers: { tgsToolSlot1: "saw" },
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "tgs-node",
        target: "coke-node",
        resourceKind: "item",
        resourceId: "minecraft:log@1",
      }),
    );
  });

  it("connects tool outputs to matching ore dictionary tool inputs", () => {
    useFactoryStore.getState().connectNodes("screwdriver-source", "screwdriver-oredict-target", {
      kind: "item",
      id: "gregtech:screwdriver.lv@0",
      sourceHandle: makeResourceHandleId(
        "output",
        { kind: "item", id: "gregtech:screwdriver.lv@0" },
        0,
      ),
      targetHandle: makeResourceHandleId(
        "input",
        { kind: "item", id: "oredict:craftingToolScrewdriver" },
        0,
      ),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "screwdriver-source",
        target: "screwdriver-oredict-target",
        sourceHandle: "output:item:gregtech%3Ascrewdriver.lv%400:0",
        targetHandle: "input:item:oredict%3AcraftingToolScrewdriver:0",
        resourceKind: "item",
        resourceId: "gregtech:screwdriver.lv@0",
      }),
    );
  });

  it("connects concrete item drawers to ore dictionary inputs", () => {
    useFactoryStore.getState().connectNodes("stick-drawer", "stick-oredict-target", {
      kind: "item",
      id: "minecraft:stick@0",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "minecraft:stick@0" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "oredict:stickWood" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "stick-drawer",
        target: "stick-oredict-target",
        resourceKind: "item",
        resourceId: "minecraft:stick@0",
      }),
    );
  });

  it("connects matching fluid recipe slots with explicit handles", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "fluid-target", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "fluid-target",
        sourceHandle: "output:fluid:water:0",
        targetHandle: "input:fluid:water:0",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("refuses mismatched item and fluid resources", () => {
    useFactoryStore.getState().connectNodes("item-source", "fluid-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("connects recipe outputs into matching drawers or tanks", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "water-tank",
        targetHandle: "input:fluid:water",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("connects matching drawers or tanks into recipe inputs", () => {
    useFactoryStore.getState().connectNodes("dust-drawer", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "dust-drawer",
        target: "item-target",
        sourceHandle: "output:item:dust",
        resourceKind: "item",
        resourceId: "dust",
      }),
    );
  });

  it("connects a drawer into a drawer of the same resource", () => {
    const base = useFactoryStore.getState().project;
    useFactoryStore.getState().setProject({
      ...base,
      storages: [
        ...(base.storages ?? []),
        {
          id: "dust-drawer-2",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust 2",
          position: { x: 300, y: 0 },
        },
      ],
    });

    useFactoryStore.getState().connectNodes("dust-drawer", "dust-drawer-2", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "dust-drawer",
        target: "dust-drawer-2",
        resourceKind: "item",
        resourceId: "dust",
      }),
    );

    // The same gesture again is the undo: one wire between two rows, toggled.
    useFactoryStore.getState().connectNodes("dust-drawer", "dust-drawer-2", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
    });
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("refuses a drawer wired to a drawer of a different resource, or to itself", () => {
    useFactoryStore.getState().connectNodes("dust-drawer", "mold-drawer", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "mold" }),
    });
    useFactoryStore.getState().connectNodes("dust-drawer", "dust-drawer", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
    });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("spawns a wired feeder drawer off a drawer, the make-up source", () => {
    const store = useFactoryStore.getState();
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "dust-drawer",
      "input",
      { x: 320, y: 200 },
      makeResourceHandleId("input", { kind: "item", id: "dust" }),
    );

    const project = useFactoryStore.getState().project;
    const feeder = (project.storages ?? []).find((entry) => entry.id !== "dust-drawer");
    expect(feeder).toBeDefined();
    expect(project.edges).toEqual([
      expect.objectContaining({ source: feeder?.id, target: "dust-drawer" }),
    ]);
  });

  it("keeps a drawer-to-drawer wire through the edge validity prune", () => {
    const base = useFactoryStore.getState().project;
    useFactoryStore.getState().setProject({
      ...base,
      storages: [
        ...(base.storages ?? []),
        {
          id: "dust-drawer-2",
          kind: "item",
          resourceId: "dust",
          displayName: "Dust 2",
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        {
          id: "drawer-feed",
          source: "dust-drawer",
          target: "dust-drawer-2",
          resourceKind: "item",
          resourceId: "dust",
        },
      ],
    });

    // updateNode runs the invalid-edge prune; the drawer wire must survive it.
    useFactoryStore.getState().updateNode("item-source", { machineCount: 2 });

    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({ source: "dust-drawer", target: "dust-drawer-2" }),
    ]);
  });

  it("does not create multiple storage cards from the same recipe slot", () => {
    const store = useFactoryStore.getState();
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 320, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 420, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );

    const dustStorages =
      useFactoryStore
        .getState()
        .project.storages?.filter((storage) => storage.resourceId === "dust") ?? [];
    const createdDustStorages = dustStorages.filter((storage) => storage.id !== "dust-drawer");

    expect(createdDustStorages).toHaveLength(1);
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);
    expect(useFactoryStore.getState().project.edges[0]?.target).toBe(createdDustStorages[0]?.id);
  });

  it("allows separate storage cards for the same resource on different recipe slots", () => {
    const store = useFactoryStore.getState();
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-source",
      "output",
      { x: 320, y: 20 },
      makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    );
    store.addStorageForConnection(
      { kind: "item", id: "dust", displayName: "Dust" },
      "item-target",
      "input",
      { x: 420, y: 20 },
      makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    );

    const createdDustStorages =
      useFactoryStore
        .getState()
        .project.storages?.filter((storage) => storage.resourceId === "dust")
        .filter((storage) => storage.id !== "dust-drawer") ?? [];

    expect(createdDustStorages).toHaveLength(2);
    expect(useFactoryStore.getState().project.edges).toHaveLength(2);
  });

  it("creates a drawer of cells, not a tank, when dragging a filled cell input", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "filled-cell-storage-test",
      name: "Filled cell storage test",
      recipes: [
        {
          id: "cell-consumer",
          name: "Cell Consumer",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [
            {
              kind: "item",
              id: "gregtech:gt.metaitem.99@143",
              amount: 2,
              displayName: "Molten Magmatter Cell",
              alternatives: [
                {
                  kind: "fluid",
                  id: "molten.magmatter",
                  displayName: "Molten Magmatter",
                  amount: 144,
                },
              ],
            },
          ],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [makeNode("cell-consumer-node", "cell-consumer", 0)],
      storages: [],
      edges: [],
    });

    useFactoryStore.getState().addStorageForConnection(
      {
        kind: "item",
        id: "gregtech:gt.metaitem.99@143",
        amount: 2,
        displayName: "Molten Magmatter Cell",
        alternatives: [
          {
            kind: "fluid",
            id: "molten.magmatter",
            displayName: "Molten Magmatter",
            amount: 144,
          },
        ],
      },
      "cell-consumer-node",
      "input",
      { x: 320, y: 20 },
      makeResourceHandleId("input", { kind: "item", id: "gregtech:gt.metaitem.99@143" }, 0),
    );

    // The buffer holds what the slot holds. It used to be rewritten into the
    // fluid, which turned an item slot into a tank reading litres and quietly
    // dropped the Canner that crossing the two forms really takes.
    const state = useFactoryStore.getState();
    expect(state.project.storages?.[0]).toEqual(
      expect.objectContaining({
        kind: "item",
        resourceId: "gregtech:gt.metaitem.99@143",
        displayName: "Molten Magmatter Cell",
      }),
    );
    expect(state.project.edges[0]).toEqual(
      expect.objectContaining({
        source: state.project.storages?.[0]?.id,
        target: "cell-consumer-node",
        resourceKind: "item",
        resourceId: "gregtech:gt.metaitem.99@143",
        targetHandle: "input:item:gregtech%3Agt.metaitem.99%40143:0",
      }),
    );
    // Same kind in, same kind out: the requirement is left exactly as written,
    // never multiplied by a guessed 1000 L per cell.
    const override = state.project.nodes[0]?.recipeInputOverrides?.["0"];
    expect(override?.kind ?? "item").toBe("item");
    expect(override?.amount ?? 2).toBe(2);
  });

  it("connects a new drawer to an overridden concrete recipe input", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "overridden-input-storage-link",
      name: "Overridden input storage link",
      recipes: [
        {
          id: "pyro",
          name: "Pyrolyse Oven: Charcoal",
          machineType: "Pyrolyse Oven",
          minimumTier: "MV",
          durationTicks: 320,
          eut: 96,
          inputs: [
            {
              kind: "item",
              id: "minecraft:log@32767",
              amount: 16,
              displayName: "Oak Log",
            },
          ],
          outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
        },
      ],
      nodes: [
        {
          id: "pyro-node",
          recipeId: "pyro",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          recipeInputOverrides: {
            "0": {
              kind: "item",
              id: "minecraft:log@1",
              amount: 16,
              displayName: "Spruce Log",
            },
          },
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [],
      edges: [],
    });

    useFactoryStore
      .getState()
      .addStorageForConnection(
        { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" },
        "pyro-node",
        "input",
        { x: 220, y: 0 },
        makeResourceHandleId("input", { kind: "item", id: "minecraft:log@1" }, 0),
      );

    const project = useFactoryStore.getState().project;
    expect(project.storages).toEqual([
      expect.objectContaining({
        kind: "item",
        resourceId: "minecraft:log@1",
        displayName: "Spruce Log",
      }),
    ]);
    expect(project.edges).toEqual([
      expect.objectContaining({
        source: project.storages?.[0]?.id,
        target: "pyro-node",
        sourceHandle: "output:item:minecraft%3Alog%401",
        targetHandle: "input:item:minecraft%3Alog%401:0",
        resourceKind: "item",
        resourceId: "minecraft:log@1",
        label: "Spruce Log",
      }),
    ]);
  });

  it("does not connect storage to non-consumed recipe inputs", () => {
    useFactoryStore.getState().connectNodes("mold-drawer", "nc-target", {
      kind: "item",
      id: "mold",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "mold" }),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "mold" }, 0),
    });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("connects pending fluid slots regardless of click order", () => {
    const store = useFactoryStore.getState();
    store.selectResourceConnectionSlot({
      nodeId: "fluid-target",
      side: "input",
      kind: "fluid",
      resourceId: "water",
      displayName: "Water",
      handleId: makeResourceHandleId("input", { kind: "fluid", id: "water" }, 0),
    });
    useFactoryStore.getState().selectResourceConnectionSlot({
      nodeId: "fluid-source",
      side: "output",
      kind: "fluid",
      resourceId: "water",
      displayName: "Water",
      handleId: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
    });

    expect(useFactoryStore.getState().project.edges[0]).toEqual(
      expect.objectContaining({
        source: "fluid-source",
        target: "fluid-target",
        resourceKind: "fluid",
        resourceId: "water",
      }),
    );
  });

  it("removes an existing resource edge when the same slots are linked again", () => {
    const firstSlot = {
      nodeId: "item-source",
      side: "output" as const,
      kind: "item" as const,
      resourceId: "dust",
      displayName: "Dust",
      handleId: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
    };
    const secondSlot = {
      nodeId: "item-target",
      side: "input" as const,
      kind: "item" as const,
      resourceId: "dust",
      displayName: "Dust",
      handleId: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    };

    useFactoryStore.getState().selectResourceConnectionSlot(firstSlot);
    useFactoryStore.getState().selectResourceConnectionSlot(secondSlot);
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);

    useFactoryStore.getState().selectResourceConnectionSlot(firstSlot);
    useFactoryStore.getState().selectResourceConnectionSlot(secondSlot);
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("never draws a second wire between the same two port rows", () => {
    // What auto-connect and plan imports write: handles carrying the recipe's
    // slot index. A card draws one row per resource, so a hand-drawn wire onto
    // the same rows is that same wire and toggles it off rather than stacking a
    // copy on top of it.
    useFactoryStore.getState().connectNodes("item-source", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);

    const dragOntoTheSameRows = () =>
      useFactoryStore.getState().connectNodes("item-source", "item-target", {
        kind: "item",
        id: "dust",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
      });

    dragOntoTheSameRows();
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);

    dragOntoTheSameRows();
    dragOntoTheSameRows();
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("auto-connects a repeated resource once, not once per slot pair", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "repeated-slot-test",
      name: "Repeated slot test",
      recipes: [
        {
          id: "double-out-recipe",
          name: "Double out",
          machineType: "Source",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [],
          outputs: [
            { kind: "item", id: "dust", amount: 1 },
            { kind: "item", id: "dust", amount: 2 },
          ],
        },
        {
          id: "double-in-recipe",
          name: "Double in",
          machineType: "Target",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 1,
          inputs: [
            { kind: "item", id: "dust", amount: 1 },
            { kind: "item", id: "dust", amount: 2 },
          ],
          outputs: [{ kind: "item", id: "plate", amount: 1 }],
        },
      ],
      nodes: [
        {
          id: "double-out",
          recipeId: "double-out-recipe",
          machineCount: 1,
          parallel: 1,
          enabled: true,
          overclockTier: "LV",
          position: { x: 0, y: 0 },
        },
        {
          id: "double-in",
          recipeId: "double-in-recipe",
          machineCount: 1,
          parallel: 1,
          enabled: true,
          overclockTier: "LV",
          position: { x: 400, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().autoConnectNode("double-in");

    // Two output slots against two input slots pair up four ways; the cards draw
    // one output row and one input row, so that is one wire.
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);
  });

  describe("custom rate cards", () => {
    /** A fresh unadopted card, plus the wire the board would hand it. */
    const wireSupplyIntoTarget = (customNodeId: string) =>
      useFactoryStore.getState().connectCustomRate(
        customNodeId,
        "output",
        {
          nodeId: "item-target",
          handleId: makeResourceHandleId("input", { kind: "item", id: "dust" }),
        },
        { kind: "item", id: "dust", displayName: "Dust" },
      );

    const addCard = () => {
      useFactoryStore.getState().addCustomRateNode();
      const nodes = useFactoryStore.getState().project.nodes;
      return nodes[nodes.length - 1]!.id;
    };

    it("wires a supplying card once however many times the same port is offered", () => {
      const card = addCard();

      wireSupplyIntoTarget(card);
      expect(useFactoryStore.getState().project.edges).toHaveLength(1);

      wireSupplyIntoTarget(card);
      wireSupplyIntoTarget(card);
      wireSupplyIntoTarget(card);
      expect(useFactoryStore.getState().project.edges).toHaveLength(1);
    });

    it("wires a requesting card once however many times the same port is offered", () => {
      const card = addCard();
      const request = () =>
        useFactoryStore.getState().connectCustomRate(
          card,
          "input",
          {
            nodeId: "item-source",
            handleId: makeResourceHandleId("output", { kind: "item", id: "dust" }),
          },
          { kind: "item", id: "dust", displayName: "Dust" },
        );

      request();
      expect(useFactoryStore.getState().project.edges).toHaveLength(1);

      request();
      request();
      expect(useFactoryStore.getState().project.edges).toHaveLength(1);
    });

    it("still lets one card supply two different machines", () => {
      const card = addCard();

      wireSupplyIntoTarget(card);
      useFactoryStore.getState().connectCustomRate(
        card,
        "output",
        {
          nodeId: "fluid-target",
          handleId: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
        },
        { kind: "fluid", id: "water", displayName: "Water" },
      );

      // The second machine wants a different resource, so the card lets go of
      // dust and adopts water: one wire, to the machine that asked last.
      expect(useFactoryStore.getState().project.edges).toEqual([
        expect.objectContaining({ source: card, target: "fluid-target", resourceId: "water" }),
      ]);

      // Now the same resource to a second taker: that is a second real wire.
      useFactoryStore.getState().connectCustomRate(
        card,
        "output",
        {
          nodeId: "water-tank",
          handleId: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
        },
        { kind: "fluid", id: "water", displayName: "Water" },
      );
      expect(
        useFactoryStore
          .getState()
          .project.edges.map((edge) => `${edge.source}->${edge.target}`)
          .sort(),
      ).toEqual([`${card}->fluid-target`, `${card}->water-tank`]);
    });

    it("drops the old wire when the card is handed a different resource", () => {
      const card = addCard();

      wireSupplyIntoTarget(card);
      useFactoryStore.getState().connectCustomRate(
        card,
        "input",
        {
          nodeId: "item-source",
          handleId: makeResourceHandleId("output", { kind: "item", id: "dust" }),
        },
        { kind: "item", id: "dust", displayName: "Dust" },
      );

      // Flipping the card from supply to request turns the line around rather
      // than leaving both directions wired.
      expect(useFactoryStore.getState().project.edges).toEqual([
        expect.objectContaining({ source: "item-source", target: card, resourceId: "dust" }),
      ]);
    });
  });

  it("removes an orphan drawer or tank when its last edge is deleted", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });
    const edgeId = useFactoryStore.getState().project.edges[0]?.id;
    expect(useFactoryStore.getState().project.storages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );

    useFactoryStore.getState().deleteEdge(edgeId);

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
    expect(useFactoryStore.getState().project.storages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );
  });

  it("undoes and redoes structural project edits", () => {
    useFactoryStore.getState().connectNodes("item-source", "item-target", {
      kind: "item",
      id: "dust",
      sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
    });
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);

    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().project.edges).toHaveLength(0);

    useFactoryStore.getState().redo();
    expect(useFactoryStore.getState().project.edges).toHaveLength(1);
  });

  it("clears redo history after a new edit", () => {
    useFactoryStore.getState().updateNode("item-source", { machineCount: 4 });
    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().redoHistory).toHaveLength(1);

    useFactoryStore.getState().updateNode("item-source", { overclockTier: "HV" });

    expect(useFactoryStore.getState().redoHistory).toHaveLength(0);
    expect(
      useFactoryStore.getState().project.nodes.find((node) => node.id === "item-source")
        ?.overclockTier,
    ).toBe("HV");
  });

  it("removes storage links when a node is changed to a recipe that no longer references it", () => {
    useFactoryStore.getState().connectNodes("fluid-source", "water-tank", {
      kind: "fluid",
      id: "water",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "water" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "water" }),
    });

    useFactoryStore.getState().updateNode("fluid-source", { recipeId: "item-source-recipe" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
    expect(useFactoryStore.getState().project.storages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "water-tank" })]),
    );
  });

  it("links a sodium to NaK coolant fluid chain without creating storage", () => {
    useFactoryStore.getState().setProject(createNakCoolantProject());

    useFactoryStore.getState().connectNodes("fluid-heater", "distillery", {
      kind: "fluid",
      id: "liquid_sodium",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "liquid_sodium" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "liquid_sodium" }, 1),
    });
    useFactoryStore.getState().connectNodes("distillery", "fluid-canner", {
      kind: "fluid",
      id: "sodium_potassium",
      sourceHandle: makeResourceHandleId("output", { kind: "fluid", id: "sodium_potassium" }, 0),
      targetHandle: makeResourceHandleId("input", { kind: "fluid", id: "sodium_potassium" }, 1),
    });

    expect(useFactoryStore.getState().project.storages).toHaveLength(0);
    expect(useFactoryStore.getState().project.edges).toEqual([
      expect.objectContaining({
        source: "fluid-heater",
        target: "distillery",
        resourceKind: "fluid",
        resourceId: "liquid_sodium",
      }),
      expect.objectContaining({
        source: "distillery",
        target: "fluid-canner",
        resourceKind: "fluid",
        resourceId: "sodium_potassium",
      }),
    ]);
  });
});

describe("project recipe refresh", () => {
  it("replaces stale machine handlers from the loaded dataset recipe", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "refresh-test",
      name: "Refresh test",
      recipes: [
        {
          id: "fluid-extractor-recipe",
          name: "Fluid Extractor: Charcoal",
          machineType: "Fluid Extractor",
          minimumTier: "LV",
          durationTicks: 30,
          eut: 16,
          inputs: [{ kind: "item", id: "minecraft:coal@1", amount: 1 }],
          outputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
          machineHandlers: [
            {
              id: "nei-catalyst-basic-fluid-extractor",
              label: "Basic Fluid Extractor",
              machineType: "Basic Fluid Extractor",
              minimumTier: "LV",
              kind: "single",
            },
          ],
        },
      ],
      nodes: [
        {
          id: "node-1",
          recipeId: "fluid-extractor-recipe",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          machineHandlerId: "nei-catalyst-basic-fluid-extractor",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().refreshProjectRecipes([
      {
        id: "fluid-extractor-recipe",
        name: "Fluid Extractor: Charcoal",
        machineType: "Fluid Extractor",
        minimumTier: "LV",
        durationTicks: 30,
        eut: 16,
        inputs: [{ kind: "item", id: "minecraft:coal@1", amount: 1 }],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
      },
    ]);

    expect(useFactoryStore.getState().project.recipes[0]?.machineHandlers).toBeUndefined();
    expect(useFactoryStore.getState().project.nodes[0]?.machineHandlerId).toBeUndefined();
  });

  it("moves a legacy concrete ore dictionary input from the recipe to the node", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "refresh-context-test",
      name: "Refresh context test",
      recipes: [
        {
          id: "coke-oven-log",
          name: "Coke Oven: Charcoal",
          machineType: "Coke Oven",
          minimumTier: "MV",
          durationTicks: 256,
          eut: 96,
          inputs: [
            {
              kind: "item",
              id: "minecraft:log@1",
              amount: 16,
              displayName: "Spruce Log",
            },
          ],
          outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
        },
      ],
      nodes: [
        {
          id: "node-1",
          recipeId: "coke-oven-log",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().refreshProjectRecipes([
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "oredict:logWood",
            amount: 16,
            displayName: "Oak Log",
            alternatives: [{ kind: "item", id: "minecraft:log@1" }],
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
    ]);

    expect(useFactoryStore.getState().project.recipes[0]?.inputs[0]).toEqual(
      expect.objectContaining({
        id: "oredict:logWood",
        alternatives: [{ kind: "item", id: "minecraft:log@1" }],
      }),
    );
    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });

  it("keeps the shared recipe generic when adding a concrete uses node", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "add-context-test",
      name: "Add context test",
      recipes: [],
      nodes: [],
      edges: [],
    });

    useFactoryStore.getState().addNodeForRecipeObject(
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "oredict:logWood",
            amount: 16,
            displayName: "Ore Dictionary: logWood",
            alternatives: [
              { kind: "item", id: "minecraft:log@0", displayName: "Oak Log" },
              { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
      { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log", mode: "uses" },
    );

    expect(useFactoryStore.getState().project.recipes[0]?.inputs[0]).toEqual(
      expect.objectContaining({
        id: "oredict:logWood",
        displayName: "Ore Dictionary: logWood",
      }),
    );
    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });

  it("stores concrete input context even when the browser mode is not uses", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "add-context-mode-test",
      name: "Add context mode test",
      recipes: [],
      nodes: [],
      edges: [],
    });

    useFactoryStore.getState().addNodeForRecipeObject(
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "oredict:logWood",
            amount: 16,
            displayName: "Ore Dictionary: logWood",
            alternatives: [
              { kind: "item", id: "minecraft:log@0", displayName: "Oak Log" },
              { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
      { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log", mode: "recipes" },
    );

    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });

  it("stores concrete uses inputs on connected recipe nodes", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "connected-context-test",
      name: "Connected context test",
      recipes: [
        {
          id: "drawer-source",
          name: "Drawer",
          machineType: "Drawer",
          minimumTier: "NONE",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "minecraft:log@1", amount: 1, displayName: "Spruce Log" }],
        },
      ],
      nodes: [
        {
          id: "source-node",
          recipeId: "drawer-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "NONE",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().addConnectedNodeForRecipeObject(
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "minecraft:log@1",
            amount: 16,
            displayName: "Spruce Log",
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
      "source-node",
      { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log", mode: "uses" },
    );

    const node = useFactoryStore
      .getState()
      .project.nodes.find((entry) => entry.recipeId === "coke-oven-log");

    expect(node?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });

  it("stores concrete uses inputs when the recipe input is an ore dictionary alternative", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "connected-oredict-context-test",
      name: "Connected oredict context test",
      recipes: [
        {
          id: "drawer-source",
          name: "Drawer",
          machineType: "Drawer",
          minimumTier: "NONE",
          durationTicks: 20,
          eut: 0,
          inputs: [],
          outputs: [{ kind: "item", id: "minecraft:log@1", amount: 1, displayName: "Spruce Log" }],
        },
      ],
      nodes: [
        {
          id: "source-node",
          recipeId: "drawer-source",
          machineCount: 1,
          parallel: 1,
          overclockTier: "NONE",
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    useFactoryStore.getState().addConnectedNodeForRecipeObject(
      {
        id: "coke-oven-log",
        name: "Coke Oven: Charcoal",
        machineType: "Coke Oven",
        minimumTier: "MV",
        durationTicks: 256,
        eut: 96,
        inputs: [
          {
            kind: "item",
            id: "oredict:logWood",
            amount: 16,
            displayName: "Ore Dictionary: logWood",
            alternatives: [
              { kind: "item", id: "minecraft:log@0", displayName: "Oak Log" },
              { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "minecraft:coal@1", amount: 20 }],
      },
      "source-node",
      { kind: "item", id: "minecraft:log@1", displayName: "Spruce Log", mode: "uses" },
    );

    const node = useFactoryStore
      .getState()
      .project.nodes.find((entry) => entry.recipeId === "coke-oven-log");

    expect(node?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        kind: "item",
        id: "minecraft:log@1",
        displayName: "Spruce Log",
        alternatives: undefined,
      }),
    );
  });
});

describe("factory machine count optimization", () => {
  it("propagates suggested machine counts through connected recipe chains", () => {
    useFactoryStore.getState().setProject(createRatioOptimizationProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dust-source", machineCount: 10 }),
        expect.objectContaining({ id: "plate-target", machineCount: 10 }),
      ]),
    );
  });

  it("normalizes every optimized machine count to an integer", () => {
    const project = createRatioOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "dust-source" ? { ...node, machineCount: 1.6 } : node,
      ),
      edges: [],
    });

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.every((node) => Number.isInteger(node.machineCount)),
    ).toBe(true);
  });

  it("rounds optimized machine counts up to keep logistical surplus", () => {
    const project = createRatioOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "plate-target"
          ? {
              ...node,
              targetOutput: {
                kind: "item",
                resourceId: "plate",
                amountPerSecond: 1.4,
              },
            }
          : node,
      ),
    });

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dust-source", machineCount: 2 }),
        expect.objectContaining({ id: "plate-target", machineCount: 2 }),
      ]),
    );
    expect(useFactoryStore.getState().lastResult.externalInputs).toHaveLength(0);
  });

  it("does not amplify cyclic recipe chains across optimization passes", () => {
    useFactoryStore.getState().setProject(createCyclicRatioProject());

    useFactoryStore.getState().optimizeMachineCounts();

    const machineCounts = useFactoryStore.getState().project.nodes.map((node) => node.machineCount);

    expect(machineCounts.every((machineCount) => Number.isInteger(machineCount))).toBe(true);
    expect(Math.max(...machineCounts)).toBeLessThanOrEqual(2);
  });

  it("balances stable direct recipe cycles without an explicit target", () => {
    useFactoryStore.getState().setProject(createStableDirectCycleOptimizationProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cycle-ingot-to-nuggets", machineCount: 1 }),
        expect.objectContaining({ id: "cycle-nuggets-to-ingot", machineCount: 2 }),
      ]),
    );
  });

  it("does not amplify cycles connected through separate buses for the same resource", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    const machineCounts = useFactoryStore.getState().project.nodes.map((node) => node.machineCount);

    expect(machineCounts.every((machineCount) => Number.isInteger(machineCount))).toBe(true);
    expect(Math.max(...machineCounts)).toBeLessThanOrEqual(2);
  });

  it("keeps cyclic SCC optimization bounded from external demand", () => {
    const project = createSmallCyclicBottleneckProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "small-cycle-source"
          ? { ...node, machineCount: 50 }
          : { ...node, machineCount: 51 },
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("small-cycle-source");

    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCount("small-cycle-source");

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(
      Math.max(...useFactoryStore.getState().project.nodes.map((node) => node.machineCount)),
    ).toBeLessThanOrEqual(51);
  });

  it("sizes internal suppliers in catalyst loops from downstream demand", () => {
    useFactoryStore.getState().setProject(createCatalystLoopOptimizationProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "loop-compressor", machineCount: 5 }),
        expect.objectContaining({ id: "loop-centrifuge", machineCount: 1 }),
        expect.objectContaining({ id: "loop-canner", machineCount: 1 }),
        expect.objectContaining({ id: "loop-terminal", machineCount: 1 }),
      ]),
    );
  });

  it("keeps global optimization idempotent across repeated clicks", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
  });

  it("ignores placeholder machine counts during global optimization", () => {
    const project = createAcyclicStorageBusProject();
    const placeholderProject = {
      ...project,
      nodes: project.nodes.map((node) => ({
        ...node,
        machineCount: node.id === "bus-source" ? 999 : 37,
      })),
    };

    useFactoryStore.getState().setProject(project);
    useFactoryStore.getState().optimizeMachineCounts();
    const baselineCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().setProject(placeholderProject);
    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(baselineCounts);
  });

  it("does not count pure storage sinks as extra ratio demand", () => {
    useFactoryStore.getState().setProject(createRecipeChainWithStorageSinkProject());

    useFactoryStore.getState().optimizeMachineCounts();
    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sink-source", machineCount: 10 }),
        expect.objectContaining({ id: "sink-target", machineCount: 10 }),
      ]),
    );
  });

  it("does not let surplus storage sinks pin single-node optimization to the current count", () => {
    const project = createRecipeChainWithStorageSinkProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "sink-source"
          ? { ...node, machineCount: 3 }
          : {
              ...node,
              targetOutput: {
                kind: "item",
                resourceId: "plate",
                amountPerSecond: 1,
              },
            },
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("sink-source");

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sink-source", machineCount: 1 })]),
    );
  });

  it("uses the split share when storage and another edge feed the same input", () => {
    const project = createSplitStorageInputOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "storage-source" ? { ...node, machineCount: 10 } : node,
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("storage-source");

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "storage-source", machineCount: 1 })]),
    );
  });

  it("optimizes a multi-output producer when one output is split through storage", () => {
    const project = createMultiOutputSplitInputOptimizationProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "source" ? { ...node, machineCount: 41 } : node,
      ),
    });

    useFactoryStore.getState().optimizeMachineCount("source");

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "source", machineCount: 1 })]),
    );
  });

  it("sizes upstream inputs from downstream storage demand instead of storage surplus", () => {
    const project = createSurplusStorageConsumerInputProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "input-source" ? { ...node, machineCount: 100 } : node,
      ),
      targetRate: {
        kind: "fluid",
        resourceId: "benzene",
        amountPerSecond: 1,
      },
    });

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "input-source", machineCount: 1 }),
        expect.objectContaining({ id: "storage-producer", machineCount: 1 }),
      ]),
    );
  });

  it("scales terminal consumers to consume produced output when no explicit target exists", () => {
    useFactoryStore.getState().setProject(createImplicitTerminalStorageDemandProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "implicit-source", machineCount: 1 }),
        expect.objectContaining({ id: "implicit-consumer", machineCount: 10 }),
      ]),
    );
  });

  it("uses rounded storage producer capacity for implicit terminal ratios", () => {
    const project = createImplicitRoundedStorageProducerProject();
    useFactoryStore.getState().setProject({
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "storage-consumer"
          ? {
              ...node,
              machineCount: 100,
            }
          : node,
      ),
    });

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);
    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "storage-producer", machineCount: 1 }),
        expect.objectContaining({ id: "storage-consumer", machineCount: 3 }),
      ]),
    );
  });

  it("scales producers to fill one configured parallel terminal consumer", () => {
    useFactoryStore.getState().setProject(createImplicitParallelTerminalStorageDemandProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "parallel-source", machineCount: 256 }),
        expect.objectContaining({ id: "parallel-consumer", machineCount: 1 }),
      ]),
    );
  });

  it("stabilizes rounded implicit source output in one click", () => {
    useFactoryStore.getState().setProject(createImplicitRoundedSourceProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rounded-source", machineCount: 4 }),
        expect.objectContaining({ id: "rounded-producer", machineCount: 20 }),
        expect.objectContaining({ id: "rounded-indirect", machineCount: 20 }),
        expect.objectContaining({ id: "rounded-terminal", machineCount: 1 }),
      ]),
    );
  });

  it("combines direct and indirect storage output for implicit terminal demand", () => {
    useFactoryStore.getState().setProject(createImplicitDirectAndIndirectStorageOutputProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "implicit-coke", machineCount: 1 }),
        expect.objectContaining({ id: "implicit-extractor", machineCount: 3 }),
        expect.objectContaining({ id: "implicit-distillation", machineCount: 5 }),
      ]),
    );
  });

  it("combines direct and indirect storage output when optimizing a shared producer", () => {
    useFactoryStore.getState().setProject(createDirectAndIndirectStorageOutputProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "coke-oven", machineCount: 1 }),
        expect.objectContaining({ id: "fluid-extractor", machineCount: 1 }),
        expect.objectContaining({ id: "distillation-tower", machineCount: 1 }),
      ]),
    );
  });

  it("uses the global solver result for single-node optimization", () => {
    const project = createDirectAndIndirectStorageOutputProject();
    useFactoryStore.getState().setProject(project);
    useFactoryStore.getState().optimizeMachineCounts();
    const globalCokeCount = useFactoryStore
      .getState()
      .project.nodes.find((node) => node.id === "coke-oven")?.machineCount;

    useFactoryStore.getState().setProject(project);
    useFactoryStore.getState().optimizeMachineCount("coke-oven");

    expect(
      useFactoryStore.getState().project.nodes.find((node) => node.id === "coke-oven")
        ?.machineCount,
    ).toBe(globalCokeCount);
  });

  it("does not amplify an externally seeded recipe cycle", () => {
    useFactoryStore.getState().setProject(createAmplifyingCycleProject());

    useFactoryStore.getState().optimizeMachineCounts();
    const firstCounts = useFactoryStore
      .getState()
      .project.nodes.map((node) => [node.id, node.machineCount]);

    useFactoryStore.getState().optimizeMachineCounts();

    expect(
      useFactoryStore.getState().project.nodes.map((node) => [node.id, node.machineCount]),
    ).toEqual(firstCounts);
    expect(
      Math.max(...useFactoryStore.getState().project.nodes.map((node) => node.machineCount)),
    ).toBeLessThanOrEqual(10);
  });

  it("keeps single-node optimization idempotent across repeated clicks", () => {
    useFactoryStore.getState().setProject(createStorageBusCycleProject());

    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");
    const firstCount = useFactoryStore
      .getState()
      .project.nodes.find((node) => node.id === "bus-cycle-b")?.machineCount;

    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");
    useFactoryStore.getState().optimizeMachineCount("bus-cycle-b");

    expect(
      useFactoryStore.getState().project.nodes.find((node) => node.id === "bus-cycle-b")
        ?.machineCount,
    ).toBe(firstCount);
  });

  it("still propagates ratios through separate buses when there is no feedback loop", () => {
    useFactoryStore.getState().setProject(createAcyclicStorageBusProject());

    useFactoryStore.getState().optimizeMachineCounts();

    expect(useFactoryStore.getState().project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "bus-source", machineCount: 10 }),
        expect.objectContaining({ id: "bus-target", machineCount: 10 }),
      ]),
    );
  });
});

function createLinkTestProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "link-test",
    name: "Link test",
    recipes: [
      {
        id: "item-source-recipe",
        name: "Item source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
      {
        id: "item-target-recipe",
        name: "Item target",
        machineType: "Target",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
      {
        id: "fluid-source-recipe",
        name: "Fluid source",
        machineType: "Pump",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "fluid", id: "water", amount: 1000 }],
      },
      {
        id: "fluid-target-recipe",
        name: "Fluid target",
        machineType: "Canner",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "water", amount: 1000 }],
        outputs: [{ kind: "item", id: "cell", amount: 1 }],
      },
      {
        id: "nc-target-recipe",
        name: "Non consumed target",
        machineType: "Extruder",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "mold", amount: 1, consumed: false }],
        outputs: [{ kind: "item", id: "gear", amount: 1 }],
      },
      {
        id: "stick-source-recipe",
        name: "Stick source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "minecraft:stick@0", amount: 1, displayName: "Stick" }],
      },
      {
        id: "stick-oredict-target-recipe",
        name: "Ore dictionary target",
        machineType: "Crafting",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [
          {
            kind: "item",
            id: "oredict:stickWood",
            amount: 1,
            displayName: "Stick",
            alternatives: [
              { kind: "item", id: "minecraft:stick@0", displayName: "Stick" },
              { kind: "item", id: "other:stick@0", displayName: "Other Stick" },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "crafted", amount: 1 }],
      },
      {
        id: "screwdriver-source-recipe",
        name: "Screwdriver source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [
          {
            kind: "item",
            id: "gregtech:screwdriver.lv@0",
            amount: 1,
            displayName: "Screwdriver (LV)",
          },
        ],
      },
      {
        id: "screwdriver-oredict-target-recipe",
        name: "Ore dictionary tool target",
        machineType: "Crafting",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [
          {
            kind: "item",
            id: "oredict:craftingToolScrewdriver",
            amount: 1,
            displayName: "Screwdriver",
            alternatives: [
              {
                kind: "item",
                id: "gregtech:screwdriver.lv@0",
                displayName: "Screwdriver (LV)",
              },
              {
                kind: "item",
                id: "gregtech:screwdriver.mv@0",
                displayName: "Screwdriver (MV)",
              },
            ],
          },
        ],
        outputs: [{ kind: "item", id: "tool-crafted", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("item-source", "item-source-recipe", 0),
      makeNode("item-target", "item-target-recipe", 200),
      makeNode("fluid-source", "fluid-source-recipe", 0, 140),
      makeNode("fluid-target", "fluid-target-recipe", 200, 140),
      makeNode("nc-target", "nc-target-recipe", 200, 280),
      makeNode("stick-source", "stick-source-recipe", 0, 420),
      makeNode("stick-oredict-target", "stick-oredict-target-recipe", 200, 420),
      makeNode("screwdriver-source", "screwdriver-source-recipe", 0, 560),
      makeNode("screwdriver-oredict-target", "screwdriver-oredict-target-recipe", 200, 560),
    ],
    storages: [
      {
        id: "dust-drawer",
        kind: "item",
        resourceId: "dust",
        displayName: "Dust",
        position: { x: 100, y: 0 },
      },
      {
        id: "mold-drawer",
        kind: "item",
        resourceId: "mold",
        displayName: "Mold",
        position: { x: 100, y: 280 },
      },
      {
        id: "water-tank",
        kind: "fluid",
        resourceId: "water",
        displayName: "Water",
        position: { x: 100, y: 140 },
      },
      {
        id: "stick-drawer",
        kind: "item",
        resourceId: "minecraft:stick@0",
        displayName: "Stick",
        position: { x: 100, y: 420 },
      },
    ],
    edges: [],
  };
}

function createRatioOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "ratio-optimization",
    name: "Ratio optimization",
    recipes: [
      {
        id: "dust-source-recipe",
        name: "Dust source",
        machineType: "Macerator",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
      {
        id: "plate-target-recipe",
        name: "Plate target",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("dust-source", "dust-source-recipe", 0),
      {
        ...makeNode("plate-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [],
    edges: [
      {
        id: "dust-edge",
        source: "dust-source",
        target: "plate-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function createCyclicRatioProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "cycle-ratio",
    name: "Cycle ratio",
    recipes: [
      {
        id: "cycle-a-recipe",
        name: "Cycle A",
        machineType: "A",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "y", amount: 2 }],
        outputs: [{ kind: "item", id: "x", amount: 1 }],
      },
      {
        id: "cycle-b-recipe",
        name: "Cycle B",
        machineType: "B",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "x", amount: 2 }],
        outputs: [{ kind: "item", id: "y", amount: 1 }],
      },
    ],
    nodes: [
      {
        ...makeNode("cycle-a", "cycle-a-recipe", 0),
        targetOutput: {
          kind: "item",
          resourceId: "x",
          amountPerSecond: 2,
        },
      },
      makeNode("cycle-b", "cycle-b-recipe", 240),
    ],
    storages: [],
    edges: [
      {
        id: "x-edge",
        source: "cycle-a",
        target: "cycle-b",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }, 0),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "y-edge",
        source: "cycle-b",
        target: "cycle-a",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }, 0),
        resourceKind: "item",
        resourceId: "y",
      },
    ],
  };
}

function createStableDirectCycleOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "stable-direct-cycle-optimization",
    name: "Stable direct cycle optimization",
    recipes: [
      {
        id: "ingot-to-nuggets-recipe",
        name: "Ingot to Nuggets",
        machineType: "Alloy Smelter",
        minimumTier: "ULV",
        durationTicks: 100,
        eut: 1,
        inputs: [{ kind: "item", id: "ingot", amount: 1 }],
        outputs: [{ kind: "item", id: "nugget", amount: 9 }],
      },
      {
        id: "nuggets-to-ingot-recipe",
        name: "Nuggets to Ingot",
        machineType: "Alloy Smelter",
        minimumTier: "ULV",
        durationTicks: 200,
        eut: 1,
        inputs: [{ kind: "item", id: "nugget", amount: 9 }],
        outputs: [{ kind: "item", id: "ingot", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("cycle-ingot-to-nuggets", "ingot-to-nuggets-recipe", 0),
      makeNode("cycle-nuggets-to-ingot", "nuggets-to-ingot-recipe", 240),
    ],
    storages: [],
    edges: [
      {
        id: "cycle-nugget-edge",
        source: "cycle-ingot-to-nuggets",
        target: "cycle-nuggets-to-ingot",
        resourceKind: "item",
        resourceId: "nugget",
      },
      {
        id: "cycle-ingot-edge",
        source: "cycle-nuggets-to-ingot",
        target: "cycle-ingot-to-nuggets",
        resourceKind: "item",
        resourceId: "ingot",
      },
    ],
  };
}

function createStorageBusCycleProject(): FactoryProject {
  return {
    ...createCyclicRatioProject(),
    id: "storage-bus-cycle-ratio",
    nodes: [
      {
        ...makeNode("bus-cycle-a", "cycle-a-recipe", 0),
        targetOutput: {
          kind: "item",
          resourceId: "x",
          amountPerSecond: 2,
        },
      },
      makeNode("bus-cycle-b", "cycle-b-recipe", 240),
    ],
    storages: [
      { id: "x-out", kind: "item", resourceId: "x", position: { x: 120, y: 0 } },
      { id: "x-in", kind: "item", resourceId: "x", position: { x: 160, y: 0 } },
      { id: "y-out", kind: "item", resourceId: "y", position: { x: 120, y: 140 } },
      { id: "y-in", kind: "item", resourceId: "y", position: { x: 160, y: 140 } },
    ],
    edges: [
      {
        id: "x-out-edge",
        source: "bus-cycle-a",
        target: "x-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "x-in-edge",
        source: "x-in",
        target: "bus-cycle-b",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "x" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "x" }, 0),
        resourceKind: "item",
        resourceId: "x",
      },
      {
        id: "y-out-edge",
        source: "bus-cycle-b",
        target: "y-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }),
        resourceKind: "item",
        resourceId: "y",
      },
      {
        id: "y-in-edge",
        source: "y-in",
        target: "bus-cycle-a",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "y" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "y" }, 0),
        resourceKind: "item",
        resourceId: "y",
      },
    ],
  };
}

function createSmallCyclicBottleneckProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "small-cycle-bottleneck",
    name: "Small cycle bottleneck",
    recipes: [
      {
        id: "small-cycle-source-recipe",
        name: "Small Cycle Source",
        machineType: "A",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "seed", amount: 1 }],
        outputs: [{ kind: "item", id: "product", amount: 1 }],
      },
      {
        id: "small-cycle-return-recipe",
        name: "Small Cycle Return",
        machineType: "B",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "product", amount: 1 }],
        outputs: [{ kind: "item", id: "seed", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("small-cycle-source", "small-cycle-source-recipe", 0),
      {
        ...makeNode("small-cycle-return", "small-cycle-return-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "seed",
          amountPerSecond: 50.2,
        },
      },
    ],
    storages: [],
    edges: [
      {
        id: "small-cycle-product-edge",
        source: "small-cycle-source",
        target: "small-cycle-return",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "product" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "product" }, 0),
        resourceKind: "item",
        resourceId: "product",
      },
      {
        id: "small-cycle-seed-edge",
        source: "small-cycle-return",
        target: "small-cycle-source",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "seed" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "seed" }, 0),
        resourceKind: "item",
        resourceId: "seed",
      },
    ],
  };
}

function createCatalystLoopOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "catalyst-loop-optimization",
    name: "Catalyst loop optimization",
    recipes: [
      {
        id: "loop-compressor-recipe",
        name: "Loop Compressor",
        machineType: "Compressor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "empty_cell", amount: 1 }],
        outputs: [{ kind: "item", id: "compressed_air_cell", amount: 1 }],
      },
      {
        id: "loop-centrifuge-recipe",
        name: "Loop Centrifuge",
        machineType: "Centrifuge",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "compressed_air_cell", amount: 5 }],
        outputs: [
          { kind: "fluid", id: "nitrogen", amount: 1_000 },
          { kind: "item", id: "empty_cell", amount: 4 },
          { kind: "item", id: "oxygen_cell", amount: 1 },
        ],
      },
      {
        id: "loop-canner-recipe",
        name: "Loop Canner",
        machineType: "Fluid Canner",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "oxygen_cell", amount: 1 }],
        outputs: [
          { kind: "item", id: "empty_cell", amount: 1 },
          { kind: "fluid", id: "oxygen", amount: 1_000 },
        ],
      },
      {
        id: "loop-terminal-recipe",
        name: "Loop Terminal",
        machineType: "Consumer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "nitrogen", amount: 1_000 }],
        outputs: [{ kind: "fluid", id: "product", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("loop-compressor", "loop-compressor-recipe", 0),
      makeNode("loop-centrifuge", "loop-centrifuge-recipe", 240),
      makeNode("loop-canner", "loop-canner-recipe", 480),
      makeNode("loop-terminal", "loop-terminal-recipe", 720),
    ],
    storages: [
      {
        id: "loop-empty-cell-buffer",
        kind: "item",
        resourceId: "empty_cell",
        position: { x: 160, y: 120 },
      },
    ],
    edges: [
      {
        id: "loop-compressor-to-centrifuge",
        source: "loop-compressor",
        target: "loop-centrifuge",
        resourceKind: "item",
        resourceId: "compressed_air_cell",
      },
      {
        id: "loop-centrifuge-to-terminal",
        source: "loop-centrifuge",
        target: "loop-terminal",
        resourceKind: "fluid",
        resourceId: "nitrogen",
      },
      {
        id: "loop-centrifuge-to-canner",
        source: "loop-centrifuge",
        target: "loop-canner",
        resourceKind: "item",
        resourceId: "oxygen_cell",
      },
      {
        id: "loop-centrifuge-to-buffer",
        source: "loop-centrifuge",
        target: "loop-empty-cell-buffer",
        resourceKind: "item",
        resourceId: "empty_cell",
      },
      {
        id: "loop-canner-to-buffer",
        source: "loop-canner",
        target: "loop-empty-cell-buffer",
        resourceKind: "item",
        resourceId: "empty_cell",
      },
      {
        id: "loop-buffer-to-compressor",
        source: "loop-empty-cell-buffer",
        target: "loop-compressor",
        resourceKind: "item",
        resourceId: "empty_cell",
      },
    ],
  };
}

function createAmplifyingCycleProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "amplifying-cycle",
    name: "Amplifying cycle",
    recipes: [
      {
        id: "amplifying-a-recipe",
        name: "Amplifying A",
        machineType: "A",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "b", amount: 2 }],
        outputs: [{ kind: "item", id: "a", amount: 1 }],
      },
      {
        id: "amplifying-b-recipe",
        name: "Amplifying B",
        machineType: "B",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "a", amount: 2 }],
        outputs: [{ kind: "item", id: "b", amount: 1 }],
      },
    ],
    nodes: [
      {
        ...makeNode("amplifying-a", "amplifying-a-recipe", 0),
        targetOutput: {
          kind: "item",
          resourceId: "a",
          amountPerSecond: 10,
        },
      },
      makeNode("amplifying-b", "amplifying-b-recipe", 240),
    ],
    storages: [],
    edges: [
      {
        id: "amplifying-a-to-b",
        source: "amplifying-a",
        target: "amplifying-b",
        resourceKind: "item",
        resourceId: "a",
      },
      {
        id: "amplifying-b-to-a",
        source: "amplifying-b",
        target: "amplifying-a",
        resourceKind: "item",
        resourceId: "b",
      },
    ],
  };
}

function createAcyclicStorageBusProject(): FactoryProject {
  return {
    ...createRatioOptimizationProject(),
    id: "acyclic-storage-bus-ratio",
    nodes: [
      makeNode("bus-source", "dust-source-recipe", 0),
      {
        ...makeNode("bus-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [
      { id: "dust-out", kind: "item", resourceId: "dust", position: { x: 100, y: 0 } },
      { id: "dust-in", kind: "item", resourceId: "dust", position: { x: 140, y: 0 } },
    ],
    edges: [
      {
        id: "dust-out-edge",
        source: "bus-source",
        target: "dust-out",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "dust-in-edge",
        source: "dust-in",
        target: "bus-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function createRecipeChainWithStorageSinkProject(): FactoryProject {
  return {
    ...createRatioOptimizationProject(),
    id: "recipe-chain-with-storage-sink",
    nodes: [
      makeNode("sink-source", "dust-source-recipe", 0),
      {
        ...makeNode("sink-target", "plate-target-recipe", 240),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 10,
        },
      },
    ],
    storages: [{ id: "dust-sink", kind: "item", resourceId: "dust", position: { x: 120, y: 120 } }],
    edges: [
      {
        id: "sink-target-edge",
        source: "sink-source",
        target: "sink-target",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }, 0),
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "sink-storage-edge",
        source: "sink-source",
        target: "dust-sink",
        sourceHandle: makeResourceHandleId("output", { kind: "item", id: "dust" }, 0),
        targetHandle: makeResourceHandleId("input", { kind: "item", id: "dust" }),
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function createSplitStorageInputOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "split-storage-input-optimization",
    name: "Split storage input optimization",
    recipes: [
      {
        id: "storage-source-recipe",
        name: "Storage source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 10 }],
      },
      {
        id: "direct-source-recipe",
        name: "Direct source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "dust", amount: 10 }],
      },
      {
        id: "consumer-recipe",
        name: "Consumer",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 10 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("storage-source", "storage-source-recipe", 0),
      makeNode("direct-source", "direct-source-recipe", 160),
      {
        ...makeNode("consumer", "consumer-recipe", 320),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 1,
        },
      },
    ],
    storages: [
      { id: "dust-storage", kind: "item", resourceId: "dust", position: { x: 160, y: 120 } },
    ],
    edges: [
      {
        id: "storage-source-to-storage",
        source: "storage-source",
        target: "dust-storage",
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "storage-to-consumer",
        source: "dust-storage",
        target: "consumer",
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "direct-source-to-consumer",
        source: "direct-source",
        target: "consumer",
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

function createMultiOutputSplitInputOptimizationProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "multi-output-split-input-optimization",
    name: "Multi output split input optimization",
    recipes: [
      {
        id: "source-recipe",
        name: "Source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [
          { kind: "item", id: "dust", amount: 10 },
          { kind: "fluid", id: "oil", amount: 1000 },
        ],
      },
      {
        id: "item-consumer-recipe",
        name: "Item consumer",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "dust", amount: 10 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
      {
        id: "fluid-consumer-recipe",
        name: "Fluid consumer",
        machineType: "Distillation Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "oil", amount: 1000 }],
        outputs: [{ kind: "fluid", id: "light", amount: 1000 }],
      },
    ],
    nodes: [
      makeNode("source", "source-recipe", 0),
      {
        ...makeNode("item-consumer", "item-consumer-recipe", 220),
        targetOutput: {
          kind: "item",
          resourceId: "plate",
          amountPerSecond: 1,
        },
      },
      {
        ...makeNode("fluid-consumer", "fluid-consumer-recipe", 440),
        targetOutput: {
          kind: "fluid",
          resourceId: "light",
          amountPerSecond: 1000,
        },
      },
    ],
    storages: [{ id: "oil-tank", kind: "fluid", resourceId: "oil", position: { x: 260, y: 120 } }],
    edges: [
      {
        id: "source-to-item-consumer",
        source: "source",
        target: "item-consumer",
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "source-to-fluid-consumer",
        source: "source",
        target: "fluid-consumer",
        resourceKind: "fluid",
        resourceId: "oil",
      },
      {
        id: "source-to-oil-tank",
        source: "source",
        target: "oil-tank",
        resourceKind: "fluid",
        resourceId: "oil",
      },
      {
        id: "oil-tank-to-fluid-consumer",
        source: "oil-tank",
        target: "fluid-consumer",
        resourceKind: "fluid",
        resourceId: "oil",
      },
    ],
  };
}

function createSurplusStorageConsumerInputProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "surplus-storage-consumer-input-optimization",
    name: "Surplus storage consumer input optimization",
    recipes: [
      {
        id: "input-source-recipe",
        name: "Input source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "coal", amount: 1 }],
      },
      {
        id: "storage-producer-recipe",
        name: "Storage producer",
        machineType: "Fluid Extractor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "coal", amount: 100 }],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 10000 }],
      },
      {
        id: "direct-producer-recipe",
        name: "Direct producer",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
      },
      {
        id: "storage-consumer-recipe",
        name: "Storage consumer",
        machineType: "Distillation Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "woodtar", amount: 100 }],
        outputs: [{ kind: "fluid", id: "benzene", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("input-source", "input-source-recipe", 0),
      makeNode("storage-producer", "storage-producer-recipe", 220),
      makeNode("direct-producer", "direct-producer-recipe", 220, 140),
      makeNode("storage-consumer", "storage-consumer-recipe", 520),
    ],
    storages: [
      { id: "woodtar-tank", kind: "fluid", resourceId: "woodtar", position: { x: 380, y: 80 } },
    ],
    edges: [
      {
        id: "input-source-to-storage-producer",
        source: "input-source",
        target: "storage-producer",
        resourceKind: "item",
        resourceId: "coal",
      },
      {
        id: "storage-producer-to-tank",
        source: "storage-producer",
        target: "woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "direct-producer-to-tank",
        source: "direct-producer",
        target: "woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "tank-to-storage-consumer",
        source: "woodtar-tank",
        target: "storage-consumer",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
    ],
  };
}

function createImplicitTerminalStorageDemandProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "implicit-terminal-storage-demand",
    name: "Implicit terminal storage demand",
    recipes: [
      {
        id: "implicit-source-recipe",
        name: "Implicit Source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "fluid", id: "oil", amount: 10 }],
      },
      {
        id: "implicit-consumer-recipe",
        name: "Implicit Consumer",
        machineType: "Distillation Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "oil", amount: 1 }],
        outputs: [{ kind: "fluid", id: "fuel", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("implicit-source", "implicit-source-recipe", 0),
      makeNode("implicit-consumer", "implicit-consumer-recipe", 320),
    ],
    storages: [
      { id: "implicit-oil-tank", kind: "fluid", resourceId: "oil", position: { x: 160, y: 0 } },
    ],
    edges: [
      {
        id: "implicit-source-to-tank",
        source: "implicit-source",
        target: "implicit-oil-tank",
        resourceKind: "fluid",
        resourceId: "oil",
      },
      {
        id: "implicit-tank-to-consumer",
        source: "implicit-oil-tank",
        target: "implicit-consumer",
        resourceKind: "fluid",
        resourceId: "oil",
      },
    ],
  };
}

function createImplicitRoundedStorageProducerProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "implicit-rounded-storage-producer",
    name: "Implicit rounded storage producer",
    recipes: [
      {
        id: "storage-producer-recipe",
        name: "Storage Producer",
        machineType: "Chemical Reactor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "feedstock", amount: 1 }],
        outputs: [{ kind: "fluid", id: "product", amount: 3 }],
      },
      {
        id: "storage-consumer-recipe",
        name: "Storage Consumer",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "product", amount: 1 }],
        outputs: [{ kind: "item", id: "part", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("storage-producer", "storage-producer-recipe", 0),
      makeNode("storage-consumer", "storage-consumer-recipe", 320),
    ],
    storages: [
      { id: "product-tank", kind: "fluid", resourceId: "product", position: { x: 160, y: 0 } },
    ],
    edges: [
      {
        id: "producer-to-tank",
        source: "storage-producer",
        target: "product-tank",
        resourceKind: "fluid",
        resourceId: "product",
      },
      {
        id: "tank-to-consumer",
        source: "product-tank",
        target: "storage-consumer",
        resourceKind: "fluid",
        resourceId: "product",
      },
    ],
  };
}

function createImplicitParallelTerminalStorageDemandProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "implicit-parallel-terminal-storage-demand",
    name: "Implicit parallel terminal storage demand",
    recipes: [
      {
        id: "parallel-source-recipe",
        name: "Parallel Source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "fluid", id: "oil", amount: 1 }],
      },
      {
        id: "parallel-consumer-recipe",
        name: "Parallel Consumer",
        // A made-up machine so the dataset's own parallel control drives this
        // test; a curated-table name would bring that machine's speed with it.
        machineType: "Parallel Test Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "oil", amount: 1 }],
        outputs: [{ kind: "fluid", id: "fuel", amount: 1 }],
        machineConfigControls: [
          {
            id: "machineParallel",
            label: "Parallel",
            minimumKey: "x1",
            tiers: [
              {
                key: "x1",
                label: "1x",
                parallelMultiplier: 1,
                resource: { kind: "item", id: "parallel_1", amount: 1 },
              },
              {
                key: "x256",
                label: "256x",
                parallelMultiplier: 256,
                resource: { kind: "item", id: "parallel_256", amount: 1 },
              },
            ],
          },
        ],
      },
    ],
    nodes: [
      makeNode("parallel-source", "parallel-source-recipe", 0),
      {
        ...makeNode("parallel-consumer", "parallel-consumer-recipe", 320),
        // 256 parallels of a 1 EU/t recipe draw 256 EU/t, so the machine needs
        // an HV hatch to run them all. HV has no headroom left over for an
        // overclock, which keeps the ratio under test at a clean 256:1.
        overclockTier: "HV",
        machineConfigTiers: { machineParallel: "x256" },
      },
    ],
    storages: [
      { id: "parallel-oil-tank", kind: "fluid", resourceId: "oil", position: { x: 160, y: 0 } },
    ],
    edges: [
      {
        id: "parallel-source-to-tank",
        source: "parallel-source",
        target: "parallel-oil-tank",
        resourceKind: "fluid",
        resourceId: "oil",
      },
      {
        id: "parallel-tank-to-consumer",
        source: "parallel-oil-tank",
        target: "parallel-consumer",
        resourceKind: "fluid",
        resourceId: "oil",
      },
    ],
  };
}

function createImplicitRoundedSourceProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "implicit-rounded-source",
    name: "Implicit rounded source",
    recipes: [
      {
        id: "rounded-source-recipe",
        name: "Rounded Source",
        machineType: "Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [{ kind: "item", id: "input", amount: 5 }],
      },
      {
        id: "rounded-producer-recipe",
        name: "Rounded Producer",
        machineType: "Producer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "input", amount: 1 }],
        outputs: [
          { kind: "fluid", id: "product", amount: 1 },
          { kind: "item", id: "byproduct", amount: 1 },
        ],
      },
      {
        id: "rounded-indirect-recipe",
        name: "Rounded Indirect",
        machineType: "Indirect",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "byproduct", amount: 1 }],
        outputs: [{ kind: "fluid", id: "product", amount: 5 }],
      },
      {
        id: "rounded-terminal-recipe",
        name: "Rounded Terminal",
        machineType: "Terminal",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "product", amount: 100 }],
        outputs: [{ kind: "fluid", id: "done", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("rounded-source", "rounded-source-recipe", 0),
      makeNode("rounded-producer", "rounded-producer-recipe", 180),
      makeNode("rounded-indirect", "rounded-indirect-recipe", 360),
      makeNode("rounded-terminal", "rounded-terminal-recipe", 540),
    ],
    storages: [
      { id: "rounded-tank", kind: "fluid", resourceId: "product", position: { x: 360, y: 160 } },
    ],
    edges: [
      {
        id: "rounded-source-to-producer",
        source: "rounded-source",
        target: "rounded-producer",
        resourceKind: "item",
        resourceId: "input",
      },
      {
        id: "rounded-producer-to-indirect",
        source: "rounded-producer",
        target: "rounded-indirect",
        resourceKind: "item",
        resourceId: "byproduct",
      },
      {
        id: "rounded-producer-to-tank",
        source: "rounded-producer",
        target: "rounded-tank",
        resourceKind: "fluid",
        resourceId: "product",
      },
      {
        id: "rounded-indirect-to-tank",
        source: "rounded-indirect",
        target: "rounded-tank",
        resourceKind: "fluid",
        resourceId: "product",
      },
      {
        id: "rounded-tank-to-terminal",
        source: "rounded-tank",
        target: "rounded-terminal",
        resourceKind: "fluid",
        resourceId: "product",
      },
    ],
  };
}

function createImplicitDirectAndIndirectStorageOutputProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "implicit-direct-indirect-storage-output",
    name: "Implicit direct and indirect storage output",
    recipes: [
      {
        id: "implicit-coke-recipe",
        name: "Implicit Coke",
        // Named a real machine while testing storage ratios that have nothing to do
        // with it. The curated table gives the coke oven a coil EU discount and
        // slice parallels, which moved these counts.
        machineType: "Test Charcoal Source",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [
          { kind: "item", id: "charcoal", amount: 300 },
          { kind: "fluid", id: "woodtar", amount: 2000 },
        ],
      },
      {
        id: "implicit-extractor-recipe",
        name: "Implicit Extractor",
        machineType: "Fluid Extractor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "charcoal", amount: 100 }],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 1000 }],
      },
      {
        id: "implicit-distillation-recipe",
        name: "Implicit Distillation",
        machineType: "Distillation Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "woodtar", amount: 700 }],
        outputs: [{ kind: "fluid", id: "benzene", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("implicit-coke", "implicit-coke-recipe", 0),
      makeNode("implicit-extractor", "implicit-extractor-recipe", 240),
      makeNode("implicit-distillation", "implicit-distillation-recipe", 520),
    ],
    storages: [
      {
        id: "implicit-woodtar-tank",
        kind: "fluid",
        resourceId: "woodtar",
        position: { x: 380, y: 120 },
      },
    ],
    edges: [
      {
        id: "implicit-coke-to-extractor",
        source: "implicit-coke",
        target: "implicit-extractor",
        resourceKind: "item",
        resourceId: "charcoal",
      },
      {
        id: "implicit-coke-to-tank",
        source: "implicit-coke",
        target: "implicit-woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "implicit-extractor-to-tank",
        source: "implicit-extractor",
        target: "implicit-woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "implicit-tank-to-distillation",
        source: "implicit-woodtar-tank",
        target: "implicit-distillation",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
    ],
  };
}

function createDirectAndIndirectStorageOutputProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "direct-indirect-storage-output-optimization",
    name: "Direct and indirect storage output optimization",
    recipes: [
      {
        id: "coke-oven-recipe",
        name: "Coke Oven",
        machineType: "Coke Oven",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [],
        outputs: [
          { kind: "item", id: "charcoal", amount: 6.25 },
          { kind: "fluid", id: "woodtar", amount: 468.75 },
        ],
      },
      {
        id: "fluid-extractor-recipe",
        name: "Fluid Extractor",
        machineType: "Fluid Extractor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "item", id: "charcoal", amount: 100 }],
        outputs: [{ kind: "fluid", id: "woodtar", amount: 10_000 }],
      },
      {
        id: "distillation-tower-recipe",
        name: "Distillation Tower",
        machineType: "Distillation Tower",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 1,
        inputs: [{ kind: "fluid", id: "woodtar", amount: 1_000 }],
        outputs: [{ kind: "fluid", id: "benzene", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("coke-oven", "coke-oven-recipe", 0),
      makeNode("fluid-extractor", "fluid-extractor-recipe", 240),
      {
        ...makeNode("distillation-tower", "distillation-tower-recipe", 520),
        targetOutput: {
          kind: "fluid",
          resourceId: "benzene",
          amountPerSecond: 1,
        },
      },
    ],
    storages: [
      { id: "woodtar-tank", kind: "fluid", resourceId: "woodtar", position: { x: 380, y: 120 } },
    ],
    edges: [
      {
        id: "coke-to-fluid-extractor",
        source: "coke-oven",
        target: "fluid-extractor",
        resourceKind: "item",
        resourceId: "charcoal",
      },
      {
        id: "coke-to-tank",
        source: "coke-oven",
        target: "woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "fluid-extractor-to-tank",
        source: "fluid-extractor",
        target: "woodtar-tank",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
      {
        id: "tank-to-distillation-tower",
        source: "woodtar-tank",
        target: "distillation-tower",
        resourceKind: "fluid",
        resourceId: "woodtar",
      },
    ],
  };
}

function makeNode(id: string, recipeId: string, x: number, y = 0) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x, y },
  };
}

function createNakCoolantProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "nak-chain",
    name: "NaK chain",
    recipes: [
      {
        id: "fluid-heater-recipe",
        name: "Fluid Heater: Sodium",
        machineType: "Fluid Heater",
        minimumTier: "MV",
        durationTicks: 200,
        eut: 120,
        inputs: [{ kind: "item", id: "sodium_dust", amount: 1 }],
        outputs: [{ kind: "fluid", id: "liquid_sodium", amount: 1000 }],
      },
      {
        id: "distillery-recipe",
        name: "Distillery: Sodium Potassium",
        machineType: "Distillery",
        minimumTier: "LV",
        durationTicks: 400,
        eut: 30,
        inputs: [
          { kind: "item", id: "rock_salt", amount: 1 },
          { kind: "fluid", id: "liquid_sodium", amount: 1000 },
        ],
        outputs: [{ kind: "fluid", id: "sodium_potassium", amount: 1000 }],
      },
      {
        id: "fluid-canner-recipe",
        name: "Fluid Canner: 60k NaK Coolant Cell",
        machineType: "Fluid Canner",
        minimumTier: "LV",
        durationTicks: 200,
        eut: 30,
        inputs: [
          { kind: "item", id: "10k_cell", amount: 1 },
          { kind: "fluid", id: "sodium_potassium", amount: 1000 },
        ],
        outputs: [{ kind: "item", id: "60k_nak_coolant_cell", amount: 1 }],
      },
    ],
    nodes: [
      makeNode("fluid-heater", "fluid-heater-recipe", 0, 0),
      makeNode("distillery", "distillery-recipe", 300, 0),
      makeNode("fluid-canner", "fluid-canner-recipe", 600, 0),
    ],
    storages: [],
    edges: [],
  };
}

describe("board selection editing", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject(createSelectionEditingProject());
  });

  it("moves a whole dragged selection as one undo entry", () => {
    useFactoryStore.getState().moveBoardItems([
      { id: "alpha", position: { x: 100, y: 100 } },
      { id: "tank", position: { x: 500, y: 100 } },
      { id: "note", position: { x: 900, y: 100 } },
    ]);

    const { project, undoHistory } = useFactoryStore.getState();
    expect(project.nodes.find((node) => node.id === "alpha")?.position).toEqual({
      x: 100,
      y: 100,
    });
    expect(project.storages?.find((storage) => storage.id === "tank")?.position).toEqual({
      x: 500,
      y: 100,
    });
    expect(
      project.annotations?.find((annotation) => annotation.id === "note")?.position,
    ).toEqual({ x: 900, y: 100 });
    expect(undoHistory).toHaveLength(1);

    useFactoryStore.getState().undo();
    const restored = useFactoryStore.getState().project;
    expect(restored.nodes.find((node) => node.id === "alpha")?.position).toEqual({ x: 0, y: 0 });
    expect(restored.storages?.find((storage) => storage.id === "tank")?.position).toEqual({
      x: 400,
      y: 0,
    });
    expect(
      restored.annotations?.find((annotation) => annotation.id === "note")?.position,
    ).toEqual({ x: 800, y: 0 });
  });

  it("records no history for a drop where nothing moved", () => {
    useFactoryStore.getState().moveBoardItems([
      { id: "alpha", position: { x: 0, y: 0 } },
      { id: "missing", position: { x: 60, y: 60 } },
    ]);

    expect(useFactoryStore.getState().undoHistory).toHaveLength(0);
  });

  it("deletes a mixed selection and its wires as one undo entry", () => {
    useFactoryStore.getState().deleteBoardSelection({
      nodeIds: ["alpha", "tank", "note"],
      edgeIds: [],
    });

    const { project, undoHistory } = useFactoryStore.getState();
    expect(project.nodes.map((node) => node.id)).toEqual(["beta"]);
    expect(project.storages ?? []).toHaveLength(0);
    expect(project.annotations ?? []).toHaveLength(0);
    expect(project.edges).toHaveLength(0);
    expect(undoHistory).toHaveLength(1);

    useFactoryStore.getState().undo();
    const restored = useFactoryStore.getState().project;
    expect(restored.nodes).toHaveLength(2);
    expect(restored.storages).toHaveLength(1);
    expect(restored.annotations).toHaveLength(1);
    expect(restored.edges).toHaveLength(2);
  });

  it("pastes copies with fresh ids, remapped wires and shifted positions", () => {
    const source = useFactoryStore.getState().project;
    const payload = structuredClone({
      nodes: source.nodes,
      storages: source.storages ?? [],
      annotations: source.annotations ?? [],
      pockets: [],
      edges: source.edges,
      recipes: source.recipes,
    });

    const pastedIds = useFactoryStore.getState().pasteBoardItems(payload, { x: 40, y: 40 });

    const { project, undoHistory } = useFactoryStore.getState();
    expect(undoHistory).toHaveLength(1);
    expect(pastedIds).toHaveLength(4);
    expect(project.nodes).toHaveLength(4);
    expect(project.storages).toHaveLength(2);
    expect(project.annotations).toHaveLength(2);
    expect(project.edges).toHaveLength(4);

    const pastedNodes = project.nodes.filter((node) => !["alpha", "beta"].includes(node.id));
    expect(pastedNodes.map((node) => node.position)).toEqual([
      { x: 40, y: 40 },
      { x: 340, y: 40 },
    ]);

    const originalIds = new Set(["alpha", "beta", "tank", "note"]);
    const pastedEdges = project.edges.slice(2);
    expect(pastedEdges).toHaveLength(2);
    for (const edge of pastedEdges) {
      expect(originalIds.has(edge.source)).toBe(false);
      expect(originalIds.has(edge.target)).toBe(false);
    }
  });

  it("gives a pasted custom-rate card its own recipe copy", () => {
    const project = useFactoryStore.getState().project;
    const dialRecipe = {
      id: "dial-recipe",
      name: "Custom Rate",
      machineType: "Custom Rate",
      minimumTier: "NONE",
      durationTicks: 20,
      eut: 0,
      inputs: [],
      outputs: [{ kind: "item" as const, id: "dust", amount: 5 }],
    };
    const dialNode = makeNode("dial", "dial-recipe", 600, 0);
    useFactoryStore.getState().setProject({
      ...project,
      recipes: [...project.recipes, dialRecipe],
      nodes: [...project.nodes, dialNode],
    });

    const pastedIds = useFactoryStore.getState().pasteBoardItems(
      structuredClone({
        nodes: [dialNode],
        storages: [],
        annotations: [],
        pockets: [],
        edges: [],
        recipes: [dialRecipe],
      }),
      { x: 40, y: 40 },
    );

    const next = useFactoryStore.getState().project;
    const pastedNode = next.nodes.find((node) => node.id === pastedIds[0]);
    expect(pastedNode?.recipeId).toBeDefined();
    expect(pastedNode?.recipeId).not.toBe("dial-recipe");
    expect(next.recipes.filter((recipe) => recipe.machineType === "Custom Rate")).toHaveLength(2);
  });

  it("carries clipboard recipes into a design that lacks them", () => {
    const source = useFactoryStore.getState().project;
    const payload = structuredClone({
      nodes: source.nodes.filter((node) => node.id === "alpha"),
      storages: [],
      annotations: [],
      pockets: [],
      edges: [],
      recipes: source.recipes.filter((recipe) => recipe.id === "smelt"),
    });

    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "blank",
      name: "Blank",
      recipes: [],
      nodes: [],
      edges: [],
    });
    const pastedIds = useFactoryStore.getState().pasteBoardItems(payload, { x: 0, y: 0 });

    const project = useFactoryStore.getState().project;
    expect(pastedIds).toHaveLength(1);
    expect(project.recipes.map((recipe) => recipe.id)).toEqual(["smelt"]);
    expect(project.nodes[0]?.recipeId).toBe("smelt");
  });
});

function createSelectionEditingProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "selection-editing",
    name: "Selection editing",
    recipes: [
      {
        id: "smelt",
        name: "Smelter: Dust",
        machineType: "Smelter",
        minimumTier: "LV",
        durationTicks: 100,
        eut: 32,
        inputs: [{ kind: "item", id: "ore", amount: 1 }],
        outputs: [{ kind: "item", id: "dust", amount: 1 }],
      },
      {
        id: "press",
        name: "Press: Plate",
        machineType: "Press",
        minimumTier: "LV",
        durationTicks: 100,
        eut: 32,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [makeNode("alpha", "smelt", 0, 0), makeNode("beta", "press", 300, 0)],
    storages: [
      {
        id: "tank",
        kind: "item",
        resourceId: "dust",
        position: { x: 400, y: 0 },
      },
    ],
    annotations: [
      {
        id: "note",
        kind: "text",
        text: "hello",
        position: { x: 800, y: 0 },
        size: { width: 200, height: 100 },
      },
    ],
    edges: [
      {
        id: "a2b",
        source: "alpha",
        target: "beta",
        resourceKind: "item",
        resourceId: "dust",
      },
      {
        id: "a2t",
        source: "alpha",
        target: "tank",
        resourceKind: "item",
        resourceId: "dust",
      },
    ],
  };
}

describe("pocket dimensions", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject(createSelectionEditingProject());
  });

  it("compacts a selection into a pocket, converging its boundary wires", () => {
    const before = useFactoryStore.getState().project;
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha", "tank"], "Smeltery");

    const { project, undoHistory } = useFactoryStore.getState();
    expect(pocketId).toBeDefined();
    expect(project.pockets).toHaveLength(1);
    expect(project.pockets?.[0]?.name).toBe("Smeltery");
    expect(project.nodes.find((node) => node.id === "alpha")?.pocketId).toBe(pocketId);
    expect(project.storages?.find((storage) => storage.id === "tank")?.pocketId).toBe(pocketId);
    expect(project.nodes.find((node) => node.id === "beta")?.pocketId).toBeUndefined();
    // Existing wires survive untouched...
    for (const edge of before.edges) {
      expect(project.edges).toContainEqual(edge);
    }
    // ...and the boundary convergence rule completes the fan-out: the
    // pocket offers ONE dust port, so beta now also drinks from the tank
    // behind it, not just from alpha.
    expect(project.edges).toHaveLength(before.edges.length + 1);
    expect(
      project.edges.some((edge) => edge.source === "tank" && edge.target === "beta"),
    ).toBe(true);
    expect(undoHistory).toHaveLength(1);
  });

  it("compacting fans a partially wired input out to every consumer inside", () => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "converge",
      name: "Converge",
      recipes: [
        {
          id: "gen",
          name: "Cobble Gen",
          machineType: "Gen",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [],
          outputs: [{ kind: "item", id: "cobblestone", amount: 1 }],
        },
        {
          id: "melt",
          name: "Melter",
          machineType: "Melter",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item", id: "cobblestone", amount: 20 }],
          outputs: [{ kind: "fluid", id: "lava", amount: 10 }],
        },
      ],
      nodes: [
        makeNode("source", "gen", 0, 0),
        makeNode("melt-a", "melt", 300, 0),
        makeNode("melt-b", "melt", 300, 300),
      ],
      edges: [
        { id: "s2a", source: "source", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
      ],
    });

    useFactoryStore.getState().compactSelectionIntoPocket(["melt-a", "melt-b"], "Lava works");

    const edges = useFactoryStore.getState().project.edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.source === "source")).toBe(true);
    expect(edges.map((edge) => edge.target).sort()).toEqual(["melt-a", "melt-b"]);
  });

  it("warns before compacting whenever convergence would add wires", () => {
    const base: Omit<FactoryProject, "edges"> = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "warn",
      name: "Warn",
      recipes: [
        {
          id: "gen",
          name: "Cobble Gen",
          machineType: "Gen",
          minimumTier: "LV" as const,
          durationTicks: 20,
          eut: 8,
          inputs: [],
          outputs: [{ kind: "item" as const, id: "cobblestone", amount: 1 }],
        },
        {
          id: "melt",
          name: "Melter",
          machineType: "Melter",
          minimumTier: "LV" as const,
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item" as const, id: "cobblestone", amount: 20 }],
          outputs: [{ kind: "fluid" as const, id: "lava", amount: 10 }],
        },
      ],
      nodes: [
        makeNode("gen-a", "gen", 0, 0),
        makeNode("gen-b", "gen", 0, 300),
        makeNode("melt-a", "melt", 300, 0),
        makeNode("melt-b", "melt", 300, 300),
      ],
    };

    // Two different sources, one each: compacting pools them - warn.
    useFactoryStore.getState().setProject({
      ...structuredClone(base),
      edges: [
        { id: "a", source: "gen-a", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
        { id: "b", source: "gen-b", target: "melt-b", resourceKind: "item", resourceId: "cobblestone" },
      ],
    });
    const pooled = collectPocketConvergenceWarnings(useFactoryStore.getState().project, [
      "melt-a",
      "melt-b",
    ]);
    expect(pooled).toHaveLength(1);
    expect(pooled[0]?.resourceId).toBe("cobblestone");
    expect(pooled[0]?.farEndCount).toBe(2);

    // One source feeding one of two consumers: the fan-out splits that
    // source's output and un-hand-feeds the other card - warn, single
    // source flavour.
    useFactoryStore.getState().setProject({
      ...structuredClone(base),
      edges: [
        { id: "a", source: "gen-a", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
      ],
    });
    const stretched = collectPocketConvergenceWarnings(useFactoryStore.getState().project, [
      "melt-a",
      "melt-b",
    ]);
    expect(stretched).toHaveLength(1);
    expect(stretched[0]?.farEndCount).toBe(1);
    expect(stretched[0]?.memberCount).toBe(2);
    expect(stretched[0]?.wiredMemberCount).toBe(1);

    // Two sources that BOTH already feed both consumers: converging adds
    // nothing, so nothing to warn about.
    useFactoryStore.getState().setProject({
      ...structuredClone(base),
      edges: [
        { id: "aa", source: "gen-a", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
        { id: "ab", source: "gen-a", target: "melt-b", resourceKind: "item", resourceId: "cobblestone" },
        { id: "ba", source: "gen-b", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
        { id: "bb", source: "gen-b", target: "melt-b", resourceKind: "item", resourceId: "cobblestone" },
      ],
    });
    expect(
      collectPocketConvergenceWarnings(useFactoryStore.getState().project, ["melt-a", "melt-b"]),
    ).toHaveLength(0);
  });

  it("dissolving converges drifted boundary wiring before it spills", () => {
    // A pocket assembled outside the store's own compact path (an import,
    // an old plan): the source feeds only one of two identical consumers.
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "drift",
      name: "Drift",
      recipes: [
        {
          id: "gen",
          name: "Cobble Gen",
          machineType: "Gen",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [],
          outputs: [{ kind: "item", id: "cobblestone", amount: 1 }],
        },
        {
          id: "melt",
          name: "Melter",
          machineType: "Melter",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item", id: "cobblestone", amount: 20 }],
          outputs: [{ kind: "fluid", id: "lava", amount: 10 }],
        },
      ],
      nodes: [
        makeNode("source", "gen", 0, 0),
        { ...makeNode("melt-a", "melt", 300, 0), pocketId: "pocket-x" },
        { ...makeNode("melt-b", "melt", 300, 300), pocketId: "pocket-x" },
      ],
      pockets: [{ id: "pocket-x", name: "Lava works", position: { x: 300, y: 0 } }],
      edges: [
        { id: "s2a", source: "source", target: "melt-a", resourceKind: "item", resourceId: "cobblestone" },
      ],
    });

    useFactoryStore.getState().dissolvePocket("pocket-x");

    const project = useFactoryStore.getState().project;
    expect(project.pockets ?? []).toHaveLength(0);
    expect(project.edges).toHaveLength(2);
    expect(project.edges.map((edge) => edge.target).sort()).toEqual(["melt-a", "melt-b"]);
  });

  it("dissolving a pocket surfaces members on its parent board", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha", "tank"]) as string;
    useFactoryStore.getState().enterPocket(pocketId);
    useFactoryStore.getState().dissolvePocket(pocketId);

    const state = useFactoryStore.getState();
    expect(state.project.pockets).toHaveLength(0);
    expect(state.project.nodes.find((node) => node.id === "alpha")?.pocketId).toBeUndefined();
    expect(state.activePocketId).toBeUndefined();
  });

  it("nests pockets and re-parents children when the middle one dissolves", () => {
    const inner = useFactoryStore.getState().compactSelectionIntoPocket(["alpha"]) as string;
    const outer = useFactoryStore
      .getState()
      .compactSelectionIntoPocket([inner, "beta"]) as string;

    let project = useFactoryStore.getState().project;
    expect(project.pockets?.find((pocket) => pocket.id === inner)?.parentPocketId).toBe(outer);

    useFactoryStore.getState().dissolvePocket(outer);
    project = useFactoryStore.getState().project;
    expect(project.pockets?.find((pocket) => pocket.id === inner)?.parentPocketId).toBeUndefined();
    expect(project.nodes.find((node) => node.id === "beta")?.pocketId).toBeUndefined();
    expect(project.nodes.find((node) => node.id === "alpha")?.pocketId).toBe(inner);
  });

  it("captures a pocket card as its whole contents", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha", "beta"]) as string;

    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocketId]);
    expect(payload).toBeDefined();
    expect(payload?.pockets.map((pocket) => pocket.id)).toEqual([pocketId]);
    expect(payload?.nodes.map((node) => node.id).sort()).toEqual(["alpha", "beta"]);
    // alpha→beta runs between two captured cards, so it comes along.
    expect(payload?.edges.map((edge) => edge.id)).toEqual(["a2b"]);
  });

  it("pastes a pocket as a fresh dimension and selects only the card", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha", "beta"]) as string;
    const payload = captureBoardSelection(useFactoryStore.getState().project, [
      pocketId,
    ]) as NonNullable<ReturnType<typeof captureBoardSelection>>;

    const pastedIds = useFactoryStore.getState().pasteBoardItems(payload, { x: 40, y: 40 });

    const project = useFactoryStore.getState().project;
    expect(project.pockets).toHaveLength(2);
    const newPocket = project.pockets?.find((pocket) => pocket.id !== pocketId);
    // Only the collapsed card surfaces at the level being viewed.
    expect(pastedIds).toEqual([newPocket?.id]);
    const pastedMembers = project.nodes.filter((node) => node.pocketId === newPocket?.id);
    expect(pastedMembers).toHaveLength(2);
    // The interior wire was remapped onto the copies, inside the new pocket.
    expect(project.edges).toHaveLength(3);
  });

  it("deleting a pocket card deletes the dimension and everything in it", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha", "beta"]) as string;
    useFactoryStore.getState().deleteBoardSelection({ nodeIds: [pocketId] });

    const { project, undoHistory } = useFactoryStore.getState();
    expect(project.pockets).toHaveLength(0);
    expect(project.nodes).toHaveLength(0);
    expect(project.edges).toHaveLength(0);
    // Compact + delete = two undo entries.
    expect(undoHistory).toHaveLength(2);
  });

  it("drags a drawer out of a slot into the pocket being viewed", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["beta"]) as string;
    useFactoryStore.getState().enterPocket(pocketId);

    useFactoryStore
      .getState()
      .addStorageForConnection(
        { kind: "item", id: "plate", displayName: "Plate" },
        "beta",
        "output",
        { x: 600, y: 0 },
        makeResourceHandleId("output", { kind: "item", id: "plate" }, 0),
      );

    const project = useFactoryStore.getState().project;
    const plate = project.storages?.find((storage) => storage.resourceId === "plate");
    // The drawer lands where you are standing. Left undefined it would be
    // filtered off the pocket view and appear on the root board instead.
    expect(plate?.pocketId).toBe(pocketId);
  });

  it("adds new machines, drawers and notes to the pocket being viewed", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha"]) as string;
    useFactoryStore.getState().enterPocket(pocketId);

    useFactoryStore.getState().addResourceStorage({
      kind: "item",
      id: "plate",
      displayName: "Plate",
      iconPath: undefined,
      iconAtlas: undefined,
      dominantColor: undefined,
    });
    useFactoryStore.getState().addAnnotation({
      kind: "text",
      text: "inside",
      position: { x: 0, y: 400 },
      size: { width: 200, height: 100 },
    });

    const project = useFactoryStore.getState().project;
    expect(project.storages?.find((storage) => storage.resourceId === "plate")?.pocketId).toBe(
      pocketId,
    );
    expect(project.annotations?.find((note) => note.text === "inside")?.pocketId).toBe(pocketId);
  });

  it("pastes root payloads into the pocket being viewed", () => {
    const pocketId = useFactoryStore
      .getState()
      .compactSelectionIntoPocket(["alpha"]) as string;
    const payload = captureBoardSelection(useFactoryStore.getState().project, [
      "beta",
    ]) as NonNullable<ReturnType<typeof captureBoardSelection>>;

    useFactoryStore.getState().enterPocket(pocketId);
    const pastedIds = useFactoryStore.getState().pasteBoardItems(payload, { x: 40, y: 40 });

    const project = useFactoryStore.getState().project;
    const pasted = project.nodes.find((node) => node.id === pastedIds[0]);
    expect(pasted?.pocketId).toBe(pocketId);
  });
});

describe("cycled input picks", () => {
  const CIRCUIT_RECIPE = {
    id: "assembler-lv-machine",
    name: "Assembler: LV Machine Hull",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 200,
    eut: 30,
    inputs: [
      {
        kind: "item" as const,
        id: "oredict:circuitBasic",
        amount: 2,
        displayName: "Ore Dictionary: circuitBasic",
        alternatives: [
          { kind: "item" as const, id: "gregtech:circuit@1", displayName: "Electronic Circuit" },
          {
            kind: "item" as const,
            id: "gregtech:circuit@2",
            displayName: "Integrated Logic Circuit",
          },
        ],
      },
      { kind: "item" as const, id: "gregtech:plate@steel", amount: 4, displayName: "Steel Plate" },
    ],
    outputs: [{ kind: "item" as const, id: "gregtech:hull@lv", amount: 1 }],
  };

  beforeEach(() => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "input-picks-test",
      name: "Input picks test",
      recipes: [],
      nodes: [],
      edges: [],
    });
  });

  it("pins the slot to the face that was showing when the node was added", () => {
    useFactoryStore.getState().addNodeForRecipeObject(CIRCUIT_RECIPE, undefined, {
      inputPicks: {
        0: {
          kind: "item",
          id: "gregtech:circuit@2",
          displayName: "Integrated Logic Circuit",
          amount: 1,
        },
      },
    });

    const node = useFactoryStore.getState().project.nodes[0];
    expect(node?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({
        id: "gregtech:circuit@2",
        displayName: "Integrated Logic Circuit",
        alternatives: undefined,
      }),
    );
    // The recipe still asks for two of them: a face carries a per-unit ratio,
    // not a stack size.
    expect(node?.recipeInputOverrides?.["0"]?.amount).toBe(2);
  });

  it("leaves the shared recipe generic so other nodes are unaffected", () => {
    useFactoryStore.getState().addNodeForRecipeObject(CIRCUIT_RECIPE, undefined, {
      inputPicks: {
        0: { kind: "item", id: "gregtech:circuit@2", displayName: "Integrated Logic Circuit" },
      },
    });

    expect(useFactoryStore.getState().project.recipes[0]?.inputs[0]).toEqual(
      expect.objectContaining({ id: "oredict:circuitBasic" }),
    );
  });

  it("does not touch slots that were never cycled", () => {
    useFactoryStore.getState().addNodeForRecipeObject(CIRCUIT_RECIPE, undefined, {
      inputPicks: {
        0: { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit" },
      },
    });

    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides?.["1"]).toBeUndefined();
  });

  it("writes no overrides at all when nothing cycled", () => {
    useFactoryStore.getState().addNodeForRecipeObject(CIRCUIT_RECIPE, undefined, {
      inputPicks: {},
    });

    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides).toBeUndefined();
  });

  it("lets a scrolled slot outrank the resource the browser was opened from", () => {
    useFactoryStore.getState().addNodeForRecipeObject(
      CIRCUIT_RECIPE,
      { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit", mode: "uses" },
      {
        inputPicks: {
          0: { kind: "item", id: "gregtech:circuit@2", displayName: "Integrated Logic Circuit" },
        },
      },
    );

    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides?.["0"]).toEqual(
      expect.objectContaining({ id: "gregtech:circuit@2" }),
    );
  });

  it("ignores a pick for a slot the recipe does not have", () => {
    useFactoryStore.getState().addNodeForRecipeObject(CIRCUIT_RECIPE, undefined, {
      inputPicks: { 7: { kind: "item", id: "gregtech:circuit@2" } },
    });

    expect(useFactoryStore.getState().project.nodes[0]?.recipeInputOverrides).toBeUndefined();
  });
});

const genRecipe = {
  id: "gen",
  name: "Generator",
  machineType: "Generator",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 0,
  machineHandlers: [{ id: "lv", label: "LV", machineType: "Generator", minimumTier: "LV", kind: "single" }],
  inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
  outputs: [{ kind: "energy", id: "lv", amount: 12800, displayName: "Energy (LV)" }],
} as unknown as Recipe;

const smelterRecipe = (eut: number, minimumTier: "LV" | "MV") =>
  ({
    id: "smelt",
    name: "Smelt",
    machineType: "Furnace",
    minimumTier,
    durationTicks: 20,
    eut,
    machineHandlers: [{ id: "base", label: "Furnace", machineType: "Furnace", minimumTier, kind: "single" }],
    inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Ore" }],
    outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
  }) as unknown as Recipe;

function machineNode(id: string, recipeId: string, overrides: Partial<FactoryNode> = {}) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  } as FactoryNode;
}

// The store's initial datasetManifest is undefined and addPowerForTier
// no-ops at the version check before anything else: tests that must get
// PAST that check spread this in.
function testDataset() {
  return {
    datasetManifest: {
      schemaVersion: 1,
      versions: [
        {
          id: "test-version",
          gtnhVersion: "test",
          channel: "stable",
          publishedAt: "2026-08-18T00:00:00.000Z",
          manifestPath: "test/manifest.json",
          recipeDatasetPath: "test/recipe-dataset.json",
          sourceInfo: {},
        },
      ],
    } as unknown as DatasetManifest,
    selectedDatasetVersionId: "test-version",
  };
}

function seedPowerProject(consumerTier: "LV" | "MV" = "LV", consumerEut = 10) {
  const project: FactoryProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "power-wire-project",
    name: "Power wire",
    recipes: [genRecipe, smelterRecipe(consumerEut, consumerTier)],
    nodes: [
      machineNode("G", "gen"),
      machineNode("M", "smelt", { overclockTier: consumerTier }),
    ],
    edges: [],
  };
  useFactoryStore.setState({ project, lastResult: calculateThroughput(project) });
}

describe("wiring energy", () => {
  it("wires a generator to a machine on the same grid, with canonical handles", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    const edge = useFactoryStore.getState().project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("G");
    expect(edge!.target).toBe("M");
    expect(edge!.resourceId).toBe("lv");
    expect(edge!.sourceHandle).toBe("output:energy:lv");
    expect(edge!.targetHandle).toBe("input:energy:lv");
  });

  it("refuses a grid mismatch: no transformer, no bridging", () => {
    seedPowerProject("MV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("refuses to feed a machine that draws nothing", () => {
    seedPowerProject("LV", 0);
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("auto-connects power when a machine lands next to a same-grid generator", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().autoConnectNode("M");

    const edge = useFactoryStore.getState().project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("G");
  });

  it("toggles an identical energy wire off on a second drag", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });
});

function powerSummary(overrides: { id: string; name: string; amount: number; durationTicks: number }): RecipeSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    recipeMap: "Generator",
    machineType: "Generator",
    minimumTier: "LV",
    durationTicks: overrides.durationTicks,
    eut: 0,
    inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
    outputs: [{ kind: "energy", id: "lv", amount: overrides.amount, displayName: "Energy (LV)" }],
    slots: [],
  } as unknown as RecipeSummary;
}

describe("pickPowerRecipe", () => {
  it("picks the highest EU per second", () => {
    const slow = powerSummary({ id: "slow", name: "Slow", amount: 2048, durationTicks: 80 }); // 512/s
    const fast = powerSummary({ id: "fast", name: "Fast", amount: 2048, durationTicks: 20 }); // 2048/s
    expect(pickPowerRecipe([slow, fast], "lv")?.id).toBe("fast");
  });

  it("breaks ties by the smaller name, whatever the order", () => {
    const gamma = powerSummary({ id: "gamma", name: "Gamma", amount: 4096, durationTicks: 40 }); // 2048/s
    const alpha = powerSummary({ id: "alpha", name: "Alpha", amount: 8192, durationTicks: 80 }); // 2048/s
    expect(pickPowerRecipe([gamma, alpha], "lv")?.id).toBe("alpha");
    expect(pickPowerRecipe([alpha, gamma], "lv")?.id).toBe("alpha");
  });

  it("skips recipes that emit no energy on that grid or have no duration", () => {
    const otherGrid = powerSummary({ id: "other", name: "Other", amount: 4096, durationTicks: 20 });
    otherGrid.outputs[0] = { kind: "energy", id: "mv", amount: 4096, displayName: "Energy (MV)" };
    const instant = powerSummary({ id: "instant", name: "Instant", amount: 4096, durationTicks: 0 });
    const good = powerSummary({ id: "good", name: "Good", amount: 2048, durationTicks: 20 });
    expect(pickPowerRecipe([otherGrid, instant, good], "lv")?.id).toBe("good");
  });
});

describe("addPowerForTier", () => {
  beforeEach(() => {
    vi.mocked(queryRecipeDatasetRecipes).mockReset();
    vi.mocked(getRecipeDatasetRecipe).mockReset();
  });

  it("places the best generator, sized to the nameplate gap, wired to the biggest draw", async () => {
    const generator: Recipe = {
      ...genRecipe,
      id: "gas-st-lv",
      name: "Gas Turbine",
      minimumTier: "LV",
      durationTicks: 10,
      machineHandlers: [{ id: "lv", label: "LV Gas Turbine", machineType: "Gas Turbine", minimumTier: "LV", kind: "single" }],
      outputs: [{ kind: "energy", id: "lv", amount: 12800, displayName: "Energy (LV)" }],
    } as unknown as Recipe;
    vi.mocked(queryRecipeDatasetRecipes).mockResolvedValue({
      recipes: [
        powerSummary({ id: "gas-st-lv", name: "Gas Turbine", amount: 12800, durationTicks: 10 }),
        powerSummary({ id: "solar-lv", name: "Solar", amount: 2048, durationTicks: 20 }),
      ],
      total: 2,
      recipeMaps: ["Generator"],
      offset: 0,
      limit: 120,
      hasMore: false,
    });
    vi.mocked(getRecipeDatasetRecipe).mockResolvedValue(generator);

    // A SMELTER-ONLY board: the nameplate gap is 10 EU/t x 20 = 200 EU/s and
    // nothing covers it. (seedPowerProject carries the 12800 EU/s generator,
    // so its grid is already covered — the OTHER no-op, asserted in the
    // "already covered" test below.) The store's initial datasetManifest is
    // undefined, so the action would no-op at the version check before the
    // deficit is read: seed one version too.
    const seed: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-add",
      name: "Add power",
      recipes: [smelterRecipe(10, "LV")],
      nodes: [machineNode("M", "smelt")],
      edges: [],
    };
    useFactoryStore.setState({
      project: seed,
      lastResult: calculateThroughput(seed),
      ...testDataset(),
    });
    await useFactoryStore.getState().addPowerForTier("LV");

    const project = useFactoryStore.getState().project;
    expect(project.nodes).toHaveLength(2);
    const placed = project.nodes.find((node) => node.recipeId === "gas-st-lv");
    expect(placed).toBeDefined();
    expect(placed!.machineCount).toBe(1); // ceil(200 / 25600 per machine)
    expect(placed!.overclockTier).toBe("LV");
    const edge = project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe(placed!.id);
    expect(edge!.target).toBe("M");
    // The new card is the selection, and the solve ran on the new project.
    expect(useFactoryStore.getState().selectedNodeId).toBe(placed!.id);
    expect(useFactoryStore.getState().lastResult.nodes[placed!.id]).toBeDefined();
  });

  it("does nothing when the grid is already covered", async () => {
    vi.mocked(queryRecipeDatasetRecipes).mockResolvedValue({
      recipes: [powerSummary({ id: "gas-st-lv", name: "Gas Turbine", amount: 12800, durationTicks: 10 })],
      total: 1,
      recipeMaps: ["Generator"],
      offset: 0,
      limit: 120,
      hasMore: false,
    });
    vi.mocked(getRecipeDatasetRecipe).mockResolvedValue(genRecipe);

    // A generator already on the board: supply covers the 200/s draw. The
    // testDataset spread is what carries this PAST the version check, so the
    // no-op asserted here is the deficit check, not the missing-manifest one.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "covered",
      name: "Covered",
      recipes: [genRecipe, smelterRecipe(10, "LV")],
      nodes: [machineNode("G", "gen"), machineNode("M", "smelt")],
      edges: [],
    };
    useFactoryStore.setState({ project, lastResult: calculateThroughput(project), ...testDataset() });

    await useFactoryStore.getState().addPowerForTier("LV");
    expect(useFactoryStore.getState().project.nodes).toHaveLength(2);
    expect(queryRecipeDatasetRecipes).not.toHaveBeenCalled();
  });

  it("does nothing when the dataset is not loaded", async () => {
    seedPowerProject("LV");
    useFactoryStore.setState({ datasetManifest: undefined });
    await useFactoryStore.getState().addPowerForTier("LV");
    expect(useFactoryStore.getState().project.nodes).toHaveLength(2);
    expect(queryRecipeDatasetRecipes).not.toHaveBeenCalled();
  });
});
