import type { DatasetVersion } from "./types";
import type { Recipe } from "@/lib/model/types";
import { isPowerRecipe } from "@/lib/power/power-recipe";
import { recipeContentRef } from "@/lib/import-export/recipe-ref-match";
import { getRecipeDatasetRecipe, resolveRecipeDatasetRecipes } from "./browser-loader";
import { noteRestorableRecipes } from "./restorable-recipes";

/**
 * Which of a plan's recipes to fetch fresh from the dataset: each id once per
 * dataset version, and AGAIN when a recipe whose dataset body carries a
 * runtime table arrives without one. Plans synced through the account and
 * copied plans travel without their GregTech tables (`withoutRuntimeTables`),
 * and a synced plan can land recipes this page already refreshed for another
 * plan; keyed on the id alone, those stayed bare and solved on fallback math.
 *
 * `checked` maps `version|id` to whether the dataset's body had a table;
 * `requested` holds recipe objects already sent, so none is fetched twice.
 */
export function recipesToRefresh(
  recipes: Recipe[],
  versionId: string,
  checked: Map<string, boolean>,
  requested: WeakSet<Recipe>,
): Recipe[] {
  return recipes.filter((recipe) => {
    if (requested.has(recipe)) {
      return false;
    }
    const key = `${versionId}|${recipe.id}`;
    return !checked.has(key) || (checked.get(key) === true && !recipe.runtimeCalculation);
  });
}

/** Marks `recipes` as sent, then what the dataset answered for them. */
export function noteRecipesRequested(
  recipes: Recipe[],
  versionId: string,
  checked: Map<string, boolean>,
  requested: WeakSet<Recipe>,
): void {
  for (const recipe of recipes) {
    requested.add(recipe);
    const key = `${versionId}|${recipe.id}`;
    if (!checked.has(key)) {
      checked.set(key, false);
    }
  }
}

export function noteRecipesRefreshed(
  refreshed: Recipe[],
  versionId: string,
  checked: Map<string, boolean>,
): void {
  noteRestorableRecipes(refreshed);
  for (const recipe of refreshed) {
    checked.set(`${versionId}|${recipe.id}`, Boolean(recipe.runtimeCalculation));
  }
}

/**
 * The dataset's current bodies for a plan's stored recipes.
 *
 * By id first. A stored id the dataset no longer has (recipe ids were
 * re-keyed when the pipeline moved to content ids, and every rebuild can
 * re-key again) is matched by what it takes and makes, the way import does,
 * and comes back with a `migration` entry from the stored id to the id that
 * now stands for it - so a card placed before a rebuild still picks up the
 * dataset's handlers (a tier cap, a new face) instead of keeping a stale
 * body forever. Power cards are synthesized on the way in and are skipped.
 */
export async function resolveProjectRecipes(
  manifestUrl: string,
  version: DatasetVersion,
  recipes: Recipe[],
): Promise<{ refreshed: Recipe[]; migration: Record<string, string> }> {
  const byId = await Promise.allSettled(
    recipes.map((recipe) => getRecipeDatasetRecipe(manifestUrl, version, recipe.id)),
  );
  const refreshed = byId
    .filter((result): result is PromiseFulfilledResult<Recipe> => result.status === "fulfilled")
    .map((result) => result.value);
  const stale = recipes.filter(
    (recipe, index) => byId[index]?.status === "rejected" && !isPowerRecipe(recipe),
  );
  const migration: Record<string, string> = {};
  if (stale.length > 0) {
    try {
      const resolved = await resolveRecipeDatasetRecipes(manifestUrl, version, stale.map(recipeContentRef));
      const fetched = await Promise.allSettled(
        resolved.matches.map(async (match) => ({
          importedId: match.importedId,
          recipe: await getRecipeDatasetRecipe(manifestUrl, version, match.recipeId),
        })),
      );
      for (const result of fetched) {
        if (result.status === "fulfilled") {
          migration[result.value.importedId] = result.value.recipe.id;
          refreshed.push(result.value.recipe);
        }
      }
    } catch {
      // No match service: the stored bodies keep working as they are.
    }
  }
  return { refreshed, migration };
}
