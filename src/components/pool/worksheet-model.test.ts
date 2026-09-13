import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildMachineList } from "@/lib/model/machine-list";
import { buildWorksheetGroups, filterWorksheetGroups } from "./worksheet-model";

export function worksheetFixture(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "worksheet",
    name: "Pool worksheet",
    fuelProfiles: [],
    edges: [],
    solveMode: true,
    poolMode: true,
    recipes: [
      {
        id: "plate",
        name: "Copper Plate",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [
          { kind: "item", id: "copper", displayName: "Copper Ingot", amount: 1 },
          { kind: "item", id: "circuit", displayName: "Circuit 1", amount: 1, consumed: false },
        ],
        outputs: [{ kind: "item", id: "plate", displayName: "Copper Plate", amount: 1 }],
      },
      {
        id: "foil",
        name: "Copper Foil",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "plate", displayName: "Copper Plate", amount: 1 }],
        outputs: [{ kind: "item", id: "foil", displayName: "Copper Foil", amount: 4 }],
      },
    ],
    nodes: [
      {
        id: "bender",
        recipeId: "plate",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 200, y: 60 },
        extraRecipes: [{ recipeId: "foil" }],
      },
    ],
    storages: [
      {
        id: "product",
        kind: "item",
        resourceId: "foil",
        displayName: "Copper Foil",
        poolSide: "drain",
        drainMode: "product",
        targetPerSecond: 2,
        position: { x: 800, y: 60 },
      },
    ],
  };
}

describe("Pool worksheet books", () => {
  it("groups shared recipe results without double-counting or changing the plan", () => {
    const project = worksheetFixture();
    const before = JSON.stringify(project);
    const result = calculateThroughput(project, { generatedAt: "fixed" });
    const groups = buildWorksheetGroups(project, result);
    expect(groups).toHaveLength(1);
    expect(groups[0].sections.map((s) => s.node.id)).toEqual(["bender", "bender#r1"]);
    expect(groups[0].machine).toEqual(buildMachineList(project, result)[0]);
    expect(groups[0].machine?.count).toBeCloseTo(1);
    expect(groups[0].sections[1].ports.outputs[0].currentPerSecond).toBeCloseTo(2);
    expect(groups[0].sections[0].nonConsumed[0].displayName).toBe("Circuit 1");
    expect(JSON.stringify(project)).toBe(before);
    expect(filterWorksheetGroups(groups, "foil")[0].sections).toHaveLength(2);
  });

  it("keeps duplicate cards and disabled cards separately", () => {
    const project = worksheetFixture();
    project.nodes.push({ ...project.nodes[0], id: "second", enabled: false });
    const groups = buildWorksheetGroups(project, calculateThroughput(project));
    expect(groups.map((g) => g.owner.id)).toEqual(["bender", "second"]);
    expect(groups[1].sections[0].verdict.kind).toBe("off");
  });

  it("retains concrete ore-dictionary context in the row", () => {
    const project = worksheetFixture();
    project.nodes[0].extraRecipes = undefined;
    project.nodes[0].solvePin = 0.125;
    project.recipes[0].inputs[0] = {
      kind: "item",
      id: "oredict:ingotCopper",
      amount: 1,
      alternatives: [{ kind: "item", id: "copper", displayName: "Copper Ingot", amount: 1 }],
    };
    project.nodes[0].recipeInputOverrides = {
      "0": { kind: "item", id: "copper", displayName: "Concrete Copper", amount: 1 },
    };
    const group = buildWorksheetGroups(project, calculateThroughput(project))[0];
    expect(group.sections[0].ports.inputs[0].resourceId).toBe("copper");
    expect(group.sections[0].ports.inputs[0].displayName).toBe("Concrete Copper");
    expect(group.machine?.count).toBeCloseTo(0.125);
  });
});
