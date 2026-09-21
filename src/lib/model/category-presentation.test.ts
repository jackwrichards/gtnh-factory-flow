import { describe, expect, it } from "vitest";
import saved from "./__fixtures__/wooden-axe-categories.json";
import type { FactoryProject } from "./types";
import { normalizeLoadedProject } from "./project-normalize";
import { applyRecipeInputOverrides } from "./recipe-input-overrides";
import { applyEdgeInputOverride } from "./edge-input-overrides";
import { getCategoryPresentation } from "./category-presentation";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildRailPorts, deriveNodeVerdict } from "@/components/flow/node-verdict";
import { getAlternativeCycleFaces } from "@/lib/nei/alternative-cycle";

describe("unresolved ingredients in the saved wooden axe plan", () => {
  it("recovers all five category inputs without changing quantities, handles, or production", () => {
    const original = structuredClone(saved) as FactoryProject;
    const loaded = normalizeLoadedProject(original);
    const node = loaded.nodes[0];
    const recipe = applyRecipeInputOverrides(loaded.recipes[0], node);
    expect(recipe.inputs.map((input) => input.amount)).toEqual([1, 1, 1, 1, 1]);
    expect(recipe.inputs.every((input) => getAlternativeCycleFaces(input).length > 1)).toBe(true);
    expect(loaded.edges).toEqual(original.edges);
    const result = calculateThroughput(loaded);
    const ports = buildRailPorts(loaded, result, node.id, recipe, deriveNodeVerdict(loaded, result, node.id)).inputs;
    expect(ports.map((port) => port.displayName)).toEqual(["Any wooden planks", "Any wooden sticks"]);
    expect(ports.every((port) => port.connected)).toBe(true);
    expect(result.nodes[node.id].utilization).toBeGreaterThan(0);
    const output = Object.values(result.nodes[node.id].outputs)[0].amountPerSecond;
    expect(result.nodes[node.id].inputs["item:oredict:plankWood"].amountPerSecond).toBeCloseTo(3 * output);
    expect(result.nodes[node.id].inputs["item:oredict:stickWood"].amountPerSecond).toBeCloseTo(2 * output);
    expect(normalizeLoadedProject(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
    expect(original).toEqual(saved);
  });

  it("does not write a fake choice for a category wire, and resolves drawer art from saved recipes", () => {
    const plan = structuredClone(saved) as FactoryProject;
    delete plan.nodes[0].recipeInputOverrides;
    for (const edge of plan.edges.filter((entry) => entry.resourceId.startsWith("oredict:"))) {
      expect(applyEdgeInputOverride(plan, edge)).toBe(plan);
      const category = getCategoryPresentation(plan.recipes, edge.resourceKind, edge.resourceId);
      expect(category?.alternatives?.length).toBeGreaterThan(1);
      expect(getCategoryPresentation(plan.recipes, edge.resourceKind, edge.resourceId)).toBe(category);
    }
    expect(getCategoryPresentation(plan.recipes, "item", "minecraft:wooden_axe")).toBeUndefined();
  });

  it("keeps an actual connected item fixed, including repeated crafting slots", () => {
    const plan = structuredClone(saved) as FactoryProject;
    delete plan.nodes[0].recipeInputOverrides;
    const edge = plan.edges.find((entry) => entry.resourceId === "oredict:plankWood")!;
    const member = plan.recipes[0].inputs[0].alternatives![1];
    const wired = applyEdgeInputOverride(plan, { ...edge, resourceId: member.id }, member);
    const recipe = applyRecipeInputOverrides(wired.recipes[0], wired.nodes[0]);
    expect(recipe.inputs.slice(0, 3).map((input) => input.id)).toEqual([member.id, member.id, member.id]);
    expect(recipe.inputs.slice(0, 3).every((input) => !input.alternatives)).toBe(true);
    expect(recipe.inputs[3].alternatives).toBeDefined();
  });
});
