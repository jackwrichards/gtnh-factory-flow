import type { Recipe, ResourceAmount, ResourceKind } from "./types";
import { isOreDictionaryResource, makeResourceKey } from "./resources";

const recipeCategories = new WeakMap<Recipe[], Map<string, ResourceAmount>>();

/** Drawers store identity, not recipe alternatives. Borrow the saved recipe's
 * members for display only. Build once per recipe-array identity, never per tick. */
export function getCategoryPresentation(recipes: Recipe[], kind: ResourceKind, id: string) {
  if (!isOreDictionaryResource({ id })) return undefined;
  let categories = recipeCategories.get(recipes);
  if (!categories) {
    categories = new Map();
    for (const recipe of recipes) {
      for (const input of recipe.inputs) {
        if (isOreDictionaryResource(input) && input.alternatives?.length) {
          const key = makeResourceKey(input.kind, input.id);
          if (!categories.has(key)) categories.set(key, input);
        }
      }
    }
    recipeCategories.set(recipes, categories);
  }
  return categories.get(makeResourceKey(kind, id));
}
