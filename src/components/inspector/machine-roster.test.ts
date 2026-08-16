import { describe, expect, it } from "vitest";
import { CUSTOM_RATE_MACHINE_TYPE } from "@/lib/model/custom-rate";
import { PROJECT_SCHEMA_VERSION, type FactoryNode, type FactoryProject, type Recipe } from "@/lib/model/types";
import { TRASH_MACHINE_TYPE } from "@/lib/model/trash";
import { gtnhFuelProfiles } from "@/lib/model/fuels";
import {
  buildMachineRoster,
  filterMachineRoster,
  resolveMachineRosterNodeIds,
  totalMachineCount,
  type MachineRosterIcon,
} from "./machine-roster";

function makeNode(
  id: string,
  recipeId: string,
  overrides: Partial<FactoryNode> = {},
): FactoryNode {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeRecipe(
  id: string,
  machineType: string,
  overrides: Partial<Recipe> = {},
): Recipe {
  return {
    id,
    name: `${machineType} recipe`,
    machineType,
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [],
    outputs: [{ kind: "item", id: `${id}-out`, amount: 1, displayName: "Output" }],
    ...overrides,
  };
}

describe("buildMachineRoster", () => {
  it("stacks the same machine at the same voltage into one row", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("a", "mac", { machineCount: 2 }),
        makeNode("b", "mac", { machineCount: 4 }),
      ],
      recipes: [makeRecipe("mac", "Macerator")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("LV Macerator");
    expect(rows[0]?.machineCount).toBe(6);
    expect(rows[0]?.nodeIds).toEqual(["a", "b"]);
  });

  it("keeps the same machine at two voltages as two rows", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("lv", "mac", { overclockTier: "LV", machineCount: 3 }),
        makeNode("hv", "mac", { overclockTier: "HV", machineCount: 1 }),
      ],
      recipes: [makeRecipe("mac", "Macerator")],
    });

    expect(rows.map((row) => row.label)).toEqual(["HV Macerator", "LV Macerator"]);
    expect(rows.map((row) => row.machineCount)).toEqual([1, 3]);
  });

  it("does not merge distinct machine families", () => {
    const rows = buildMachineRoster({
      nodes: [makeNode("cr", "chem"), makeNode("lcr", "large")],
      recipes: [
        makeRecipe("chem", "Chemical Reactor", {
          machineHandlers: [
            {
              id: "chemical-reactor",
              label: "Chemical Reactor",
              machineType: "Chemical Reactor",
              minimumTier: "LV",
            },
          ],
        }),
        makeRecipe("large", "Large Chemical Reactor", {
          machineHandlers: [
            {
              id: "large-chemical-reactor",
              label: "Large Chemical Reactor",
              machineType: "Large Chemical Reactor",
              minimumTier: "HV",
            },
          ],
        }),
      ],
    });

    expect(rows.map((row) => row.machineName).sort()).toEqual([
      "Chemical Reactor",
      "Large Chemical Reactor",
    ]);
  });

  it("skips disabled cards, trash cans and custom-rate sources", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("on", "mac"),
        makeNode("off", "mac", { enabled: false }),
        makeNode("bin", "trash"),
        makeNode("dial", "custom"),
        makeNode("gone", "missing"),
      ],
      recipes: [
        makeRecipe("mac", "Macerator"),
        makeRecipe("trash", TRASH_MACHINE_TYPE, { eut: 0 }),
        makeRecipe("custom", CUSTOM_RATE_MACHINE_TYPE, { eut: 0 }),
      ],
    });

    expect(rows.map((row) => row.nodeIds)).toEqual([["on"]]);
  });

  it("keeps crop farms and drops the voltage prefix on steam and untimed machines", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("farm", "crop", { overclockTier: "LV" }),
        makeNode("steam", "steam-mac", { overclockTier: "LV" }),
        makeNode("table", "craft", { overclockTier: "LV" }),
      ],
      recipes: [
        makeRecipe("crop", "Crop Farm", { kind: "crop_produce", eut: 0 }),
        makeRecipe("steam-mac", "Steam Macerator", {
          eut: 0,
          machineHandlers: [
            {
              id: "steam-macerator",
              label: "Steam Macerator",
              machineType: "Steam Macerator",
              minimumTier: "LV",
            },
          ],
        }),
        makeRecipe("craft", "Crafting", { eut: 0 }),
      ],
    });

    expect(rows.map((row) => row.label).sort()).toEqual([
      "Crafting",
      "Crop Farm",
      "Steam Macerator",
    ]);
  });

  it("prefers the dataset's machine icon and falls back to the first output", () => {
    const machineIcon: MachineRosterIcon = {
      kind: "item",
      id: "machine.macerator",
      amount: 1,
      displayName: "Macerator",
    };
    const rows = buildMachineRoster(
      {
        nodes: [makeNode("a", "mac"), makeNode("b", "chem")],
        recipes: [
          makeRecipe("mac", "Macerator", {
            machineHandlers: [
              {
                id: "macerator",
                label: "Macerator",
                machineType: "Macerator",
                minimumTier: "LV",
              },
            ],
          }),
          makeRecipe("chem", "Chemical Reactor"),
        ],
      },
      { icons: new Map([["macerator", machineIcon]]) },
    );

    expect(rows.find((row) => row.handlerId === "macerator")?.icon?.id).toBe("machine.macerator");
    expect(rows.find((row) => row.label.includes("Chemical"))?.icon?.id).toBe("chem-out");
  });

  it("sorts highest voltage first, then the busiest stack, then the machine name", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("hv-many", "chem", { overclockTier: "HV", machineCount: 8 }),
        makeNode("lv-few", "bender", { overclockTier: "LV", machineCount: 1 }),
        makeNode("lv-many", "mac", { overclockTier: "LV", machineCount: 8 }),
        makeNode("lv-also-one", "lathe", { overclockTier: "LV", machineCount: 1 }),
        makeNode("steam", "steam-mac", { overclockTier: "LV", machineCount: 20 }),
      ],
      recipes: [
        makeRecipe("chem", "Chemical Reactor"),
        makeRecipe("mac", "Macerator"),
        makeRecipe("bender", "Bending Machine"),
        makeRecipe("lathe", "Lathe"),
        makeRecipe("steam-mac", "Steam Macerator", {
          eut: 0,
          machineHandlers: [
            {
              id: "steam-macerator",
              label: "Steam Macerator",
              machineType: "Steam Macerator",
              minimumTier: "LV",
            },
          ],
        }),
      ],
    });

    expect(rows.map((row) => row.label)).toEqual([
      "HV Chemical Reactor",
      "LV Macerator",
      "LV Bending Machine",
      "LV Lathe",
      "Steam Macerator",
    ]);
  });

  it("can be limited to a set of cards", () => {
    const rows = buildMachineRoster(
      {
        nodes: [
          makeNode("keep", "mac", { machineCount: 2 }),
          makeNode("drop", "mac", { machineCount: 9 }),
        ],
        recipes: [makeRecipe("mac", "Macerator")],
      },
      { nodeIds: new Set(["keep"]) },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.machineCount).toBe(2);
    expect(rows[0]?.nodeIds).toEqual(["keep"]);
  });
});

describe("filterMachineRoster", () => {
  it("matches the printed label, the machine name, or the voltage", () => {
    const rows = buildMachineRoster({
      nodes: [
        makeNode("lv", "mac", { overclockTier: "LV" }),
        makeNode("hv", "chem", { overclockTier: "HV" }),
      ],
      recipes: [makeRecipe("mac", "Macerator"), makeRecipe("chem", "Chemical Reactor")],
    });

    expect(filterMachineRoster(rows, "macer").map((row) => row.machineName)).toEqual(["Macerator"]);
    expect(filterMachineRoster(rows, "hv").map((row) => row.tier)).toEqual(["HV"]);
    expect(filterMachineRoster(rows, "nope")).toEqual([]);
  });
});

describe("resolveMachineRosterNodeIds", () => {
  const project: FactoryProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "roster-scope",
    name: "Roster scope",
    recipes: [makeRecipe("mac", "Macerator")],
    nodes: [makeNode("smelter", "mac"), makeNode("bender", "mac")],
    edges: [],
    storages: [
      {
        id: "chest",
        kind: "item" as const,
        resourceId: "ingot",
        position: { x: 0, y: 0 },
      },
    ],
    fuelProfiles: gtnhFuelProfiles,
    selectedFuelProfileId: "biodiesel",
  };

  it("treats an empty selection as the whole plan", () => {
    expect(resolveMachineRosterNodeIds(project, [])).toBeUndefined();
  });

  it("treats a drawers-only selection as the whole plan", () => {
    expect(resolveMachineRosterNodeIds(project, ["chest"])).toBeUndefined();
  });

  it("keeps a machine selection, pockets included", () => {
    const scoped = resolveMachineRosterNodeIds(project, ["bender"]);
    expect(scoped?.has("bender")).toBe(true);
    expect(scoped?.has("smelter")).toBe(false);
  });
});

describe("totalMachineCount", () => {
  it("sums the stacked counts", () => {
    expect(
      totalMachineCount([
        { machineCount: 4 } as never,
        { machineCount: 2 } as never,
      ]),
    ).toBe(6);
  });
});
