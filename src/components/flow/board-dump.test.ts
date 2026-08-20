import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildBoardDump, formatBoardDump } from "./board-dump";

/**
 * One undersized smelter feeding a bender that wants twice as much, with a
 * drawer at each end. The bender is starved, which is the case the dump has to
 * explain to someone who cannot see the board.
 */
function makeStarvedProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "board-dump-project",
    name: "Board dump test",
    recipes: [
      {
        id: "smelt",
        name: "Smelt Ingot",
        // A machine the curated table has never heard of, so this test measures
        // the dump rather than one machine's transcribed coefficients.
        machineType: "Test Smelter",
        minimumTier: "LV",
        durationTicks: 40,
        eut: 30,
        inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Raw Ore" }],
        outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
      },
      {
        id: "bend",
        name: "Bend Plate",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "ingot", amount: 2, displayName: "Ingot" }],
        outputs: [{ kind: "item", id: "plate", amount: 1, displayName: "Plate" }],
      },
    ],
    nodes: [
      {
        id: "smelter",
        recipeId: "smelt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "MV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
      {
        id: "bender",
        recipeId: "bend",
        machineCount: 4,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 200, y: 0 },
      },
    ],
    storages: [
      {
        id: "ore-source",
        kind: "item",
        resourceId: "ore",
        displayName: "Raw Ore",
        position: { x: -200, y: 0 },
      },
      {
        id: "plate-drain",
        kind: "item",
        resourceId: "plate",
        displayName: "Plate",
        position: { x: 400, y: 0 },
      },
    ],
    edges: [
      {
        id: "source-to-smelter",
        source: "ore-source",
        target: "smelter",
        resourceKind: "item",
        resourceId: "ore",
      },
      {
        id: "smelter-to-bender",
        source: "smelter",
        target: "bender",
        resourceKind: "item",
        resourceId: "ingot",
      },
      {
        id: "bender-to-drain",
        source: "bender",
        target: "plate-drain",
        resourceKind: "item",
        resourceId: "plate",
      },
    ],
  };
}

/** Only the fields these tests read; the dump itself is a plain object. */
interface DumpShape {
  scope: string;
  machines: Array<Record<string, unknown>>;
  drawers?: unknown[];
  links: string[];
  boundary: { needs: string[]; makes: string[] };
  resourceIds: Record<string, string>;
}

function dumpOf(selectedIds: string[]): DumpShape {
  const project = makeStarvedProject();
  const result = calculateThroughput(project, { generatedAt: "fixed" });
  return buildBoardDump({ project, result, selectedIds }) as unknown as DumpShape;
}

describe("buildBoardDump", () => {
  it("dumps the whole plan when nothing is selected", () => {
    const dump = dumpOf([]);

    expect(dump.scope).toContain("the whole plan");
    expect(dump.machines).toHaveLength(2);
    expect(dump.drawers).toHaveLength(2);
    expect(dump.links).toHaveLength(3);
  });

  it("names cards by handle, in board reading order", () => {
    const dump = dumpOf([]);

    expect(dump.machines.map((machine) => [machine.ref, machine.recipe])).toEqual([
      ["M1", "Smelt Ingot"],
      ["M2", "Bend Plate"],
    ]);
    // Links read as handles, so a stranger can follow the chain without ids.
    expect(dump.links[1]).toContain("M1 -> M2");
  });

  it("restates the overclock math the board applied", () => {
    const smelter = dumpOf([]).machines[0];

    // LV recipe run at MV: one overclock, half the time for four times the EU.
    expect(smelter.tier).toBe("MV");
    expect(smelter.minTier).toBe("LV");
    expect(smelter.recipeAsWritten).toEqual({ seconds: 2, euPerTick: 30 });
    expect(smelter.afterOverclock).toEqual({
      seconds: 1,
      euPerTickPerMachine: 120,
      overclocks: 1,
    });
  });

  it("explains a starved machine in words, and points upstream", () => {
    const bender = dumpOf([]).machines[1];

    expect(bender.verdict).toBe("starved");
    expect(bender.why).toContain("short of Ingot");
    expect(bender.why).toContain("fix at");
  });

  it("scopes to the selection, and reads the severed wire as a need", () => {
    const dump = dumpOf(["bender"]);

    expect(dump.scope).toBe("1 selected card(s) out of 4 on the plan");
    expect(dump.machines).toHaveLength(1);
    expect(dump.drawers).toBeUndefined();
    // Scoped alone, the bender's supply arrives from outside the box.
    expect(dump.boundary.needs).toEqual(["Ingot 8/s"]);
    expect(dump.boundary.makes).toEqual(["Plate 4/s"]);
  });

  it("carries resource ids for anything it named, and nothing it did not", () => {
    // The power draw is a real input line on each card (smelter on MV,
    // bender on LV), so the dump names both grids.
    expect(dumpOf([]).resourceIds).toEqual({
      Ingot: "item:ingot",
      Plate: "item:plate",
      "Raw Ore": "item:ore",
      "Energy (LV)": "energy:lv",
      "Energy (MV)": "energy:mv",
    });
  });
});

describe("formatBoardDump", () => {
  it("is JSON, with small objects kept on one line", () => {
    const text = formatBoardDump({
      project: makeStarvedProject(),
      result: calculateThroughput(makeStarvedProject(), { generatedAt: "fixed" }),
      selectedIds: [],
    });

    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain(`"recipeAsWritten": {"seconds": 2, "euPerTick": 30}`);
    // Never a line so long it wraps into mush in a chat window.
    for (const line of text.split("\n")) {
      expect(line.length).toBeLessThan(160);
    }
  });
});
