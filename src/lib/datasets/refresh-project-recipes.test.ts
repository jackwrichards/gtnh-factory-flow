import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { noteRecipesRefreshed, noteRecipesRequested, recipesToRefresh } from "./refresh-project-recipes";

const table = {
  sourceKind: "gregtech-overclock-calculator",
  status: "computed",
  oracleEligible: true,
  variants: [{ id: "lv", durationTicks: 100, eut: 30 }],
} as const;
const recipe = (id: string, withTable: boolean) =>
  ({ id, inputs: [], outputs: [], ...(withTable ? { runtimeCalculation: table } : {}) }) as unknown as Recipe;

describe("recipesToRefresh", () => {
  it("fetches each id once per dataset version", () => {
    const checked = new Map<string, boolean>();
    const requested = new WeakSet<Recipe>();
    const first = [recipe("a", true), recipe("b", false)];
    expect(recipesToRefresh(first, "v1", checked, requested)).toEqual(first);
    noteRecipesRequested(first, "v1", checked, requested);
    noteRecipesRefreshed([recipe("a", true), recipe("b", false)], "v1", checked);
    // Same ids again, as new objects with their bodies intact: nothing to do.
    expect(recipesToRefresh([recipe("a", true), recipe("b", false)], "v1", checked, requested)).toEqual([]);
    // A new dataset version checks again.
    expect(recipesToRefresh([recipe("a", true)], "v2", checked, requested)).toHaveLength(1);
  });

  it("fetches again when a synced plan brings a recipe back without its table", () => {
    // A plan pulled from the account travels without GregTech tables, and
    // its recipes can be ids this page already refreshed for another plan.
    const checked = new Map<string, boolean>();
    const requested = new WeakSet<Recipe>();
    noteRecipesRequested([recipe("a", true), recipe("b", false)], "v1", checked, requested);
    noteRecipesRefreshed([recipe("a", true), recipe("b", false)], "v1", checked);
    const pulled = [recipe("a", false), recipe("b", false)];
    expect(recipesToRefresh(pulled, "v1", checked, requested).map((entry) => entry.id)).toEqual(["a"]);
    // The same bare object is never sent twice.
    noteRecipesRequested([pulled[0]!], "v1", checked, requested);
    expect(recipesToRefresh(pulled, "v1", checked, requested)).toEqual([]);
  });
});
