import type { Recipe } from "@/lib/model/types";

/**
 * Recipe ids whose dataset body carries a runtime table, as learned from the
 * refreshes this page has made (FactoryPlannerApp).
 *
 * A plan may leave a GregTech table out when it travels (account sync, Copy
 * plan) ONLY if the dataset will put it back on landing. A recipe the dataset
 * no longer knows (an old plan's id with no content match) keeps the table
 * it arrived with, and that stored copy is the only one there is: stripping
 * it lost it for good. Unknown means keep.
 */
const restorable = new Set<string>();

export function noteRestorableRecipes(refreshed: Recipe[]): void {
  for (const recipe of refreshed) {
    if (recipe.runtimeCalculation) {
      restorable.add(recipe.id);
    }
  }
}

export function isRestorableRecipe(recipeId: string): boolean {
  return restorable.has(recipeId);
}
