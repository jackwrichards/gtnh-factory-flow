import { describe, expect, it } from "vitest";
import { buildServerReachabilityGraph } from "./reachability-graph";

function entries(records: Record<string, number[]>): Map<string, Map<number, number[]>> {
  return new Map(Object.entries(records).map(([key, indexes]) => [key, new Map([[0, indexes]])]));
}

describe("buildServerReachabilityGraph", () => {
  it("inverts the lookup into inputs and outputs", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["smelt"],
      entries: entries({
        "uses:item:ore": [0],
        "uses:item:fuel": [0],
        "recipes:item:ingot": [0],
      }),
      alternativesByKey: () => undefined,
    });

    expect(graph.recipes).toHaveLength(1);
    expect(graph.recipes[0].id).toBe("smelt");
    expect(graph.recipes[0].outputs).toEqual(["item:ingot"]);
    expect(graph.recipes[0].inputSlots.map((slot) => slot.length)).toEqual([1, 1]);
  });

  it("collapses an oredict posting back into one OR slot", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["chest"],
      entries: entries({
        "uses:item:oredict:plankWood": [0],
        "uses:item:oak_planks": [0],
        "uses:item:spruce_planks": [0],
        "recipes:item:chest": [0],
      }),
      alternativesByKey: (key) =>
        key === "item:oredict:plankWood" ? ["item:oak_planks", "item:spruce_planks"] : undefined,
    });

    expect(graph.recipes[0].inputSlots).toHaveLength(1);
    expect(graph.recipes[0].inputSlots[0].sort()).toEqual(["item:oak_planks", "item:spruce_planks"]);
  });

  it("collapses a substitute pair anchored on a concrete item", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["circuit"],
      entries: entries({
        "uses:item:resistor": [0],
        "uses:item:smd_resistor": [0],
        "uses:item:board": [0],
        "recipes:item:circuit": [0],
      }),
      alternativesByKey: (key) =>
        key === "item:resistor" ? ["item:resistor", "item:smd_resistor"] : undefined,
    });

    const slots = graph.recipes[0].inputSlots.map((slot) => [...slot].sort());
    expect(slots).toContainEqual(["item:resistor", "item:smd_resistor"]);
    expect(slots).toContainEqual(["item:board"]);
    expect(slots).toHaveLength(2);
  });

  it("expands a placeholder the lookup never posted members for", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["assemble"],
      entries: entries({
        "uses:item:choice:any-lv-circuit": [0],
        "recipes:item:machine": [0],
      }),
      alternativesByKey: (key) =>
        key === "item:choice:any-lv-circuit" ? ["item:electronic_circuit", "item:nand_circuit"] : undefined,
    });

    expect(graph.recipes[0].inputSlots).toEqual([
      ["item:electronic_circuit", "item:nand_circuit"],
    ]);
  });

  it("keeps a partial substitute group split rather than guessing", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["odd"],
      entries: entries({
        "uses:item:resistor": [0],
        "recipes:item:thing": [0],
      }),
      alternativesByKey: (key) =>
        key === "item:resistor" ? ["item:resistor", "item:smd_resistor", "item:asmd_resistor"] : undefined,
    });

    // Only the anchor was posted; a concrete anchor does not claim a group
    // that is not all here, so it stands alone.
    expect(graph.recipes[0].inputSlots).toEqual([["item:resistor"]]);
  });

  it("drops recipes with no outputs", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 2,
      recipeIds: ["real", "husk"],
      entries: entries({
        "recipes:item:thing": [0],
        "uses:item:thing": [1],
      }),
      alternativesByKey: () => undefined,
    });

    expect(graph.recipes.map((recipe) => recipe.id)).toEqual(["real"]);
  });

  it("makes a recipe with no indexed inputs unfireable, not free", () => {
    const graph = buildServerReachabilityGraph({
      recipeCount: 1,
      recipeIds: ["mystery"],
      entries: entries({ "recipes:item:thing": [0] }),
      alternativesByKey: () => undefined,
    });

    // One unsatisfiable slot: only rootRecipeIds (real sources) may waive it.
    expect(graph.recipes[0].inputSlots).toEqual([[]]);
  });
});
