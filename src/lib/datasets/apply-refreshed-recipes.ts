import type { FactoryProject, FactoryNode, Recipe } from "@/lib/model/types";
import { isOreDictionaryResource, resourceMatchesInput } from "@/lib/model/resources";

/** Restore recipes identically on the canvas and in closed network members, without saving. */
export function withRefreshedRecipes(
  existing: FactoryProject,
  recipes: Recipe[],
  migration: Record<string, string> = {},
): FactoryProject {
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe] as const));
  const refreshedFor = (storedId: string) =>
    recipesById.get(storedId) ??
    (migration[storedId] ? recipesById.get(migration[storedId]) : undefined);
  const project = {
    ...existing,
    recipes: existing.recipes.map((recipe) => {
      const refreshedRecipe = refreshedFor(recipe.id);
      return refreshedRecipe ? mergeRefreshedRecipe(refreshedRecipe, recipe) : recipe;
    }),
    nodes: existing.nodes.map((node) => {
      const recipe = existing.recipes.find((entry) => entry.id === node.recipeId);
      const fetched = recipe ? refreshedFor(recipe.id) : undefined;
      const refreshedRecipe = fetched && recipe ? mergeRefreshedRecipe(fetched, recipe) : fetched;
      if (!recipe || !refreshedRecipe) {
        return node;
      }

      const contextualInputOverrides = buildRecipeInputOverridesFromContextualRecipeInputs(
        recipe,
        refreshedRecipe,
      );
      const validMachineHandlerIds = new Set(
        (refreshedRecipe.machineHandlers ?? []).map((handler) => handler.id),
      );
      const nextRecipeInputOverrides = {
        ...contextualInputOverrides,
        ...node.recipeInputOverrides,
      };
      // A shared machine's extra recipes follow a migration by id too.
      const extraRecipes = node.extraRecipes?.map((extra) => {
        const refreshedExtra = refreshedFor(extra.recipeId);
        return refreshedExtra && refreshedExtra.id !== extra.recipeId
          ? { ...extra, recipeId: refreshedExtra.id }
          : extra;
      });
      const nextNode: FactoryNode = {
        ...node,
        // A migrated recipe has a new id; the node follows it.
        ...(refreshedRecipe.id !== node.recipeId ? { recipeId: refreshedRecipe.id } : {}),
        ...(extraRecipes ? { extraRecipes } : {}),
        ...(Object.keys(nextRecipeInputOverrides).length
          ? { recipeInputOverrides: nextRecipeInputOverrides }
          : {}),
      };
      return nextNode.machineHandlerId && !validMachineHandlerIds.has(nextNode.machineHandlerId)
        ? { ...nextNode, machineHandlerId: undefined }
        : nextNode;
    }),
  };
  return project;
}

function mergeRefreshedRecipe(incoming: Recipe, stored?: Recipe): Recipe {
  if (!stored?.id.startsWith(GAME_RECIPE_PREFIX) || !stored.machineHandlers?.length) {
    return { ...incoming };
  }
  const listed = new Set((incoming.machineHandlers ?? []).map((handler) => handler.id));
  const gameOnly = stored.machineHandlers.filter((handler) => !listed.has(handler.id));
  return gameOnly.length > 0
    ? { ...incoming, machineHandlers: [...gameOnly, ...(incoming.machineHandlers ?? [])] }
    : { ...incoming };
}

/** The id prefix of a recipe the game wrote for one of its cards (its `FfPlan.GAME_RECIPE_PREFIX`). */
const GAME_RECIPE_PREFIX = "gtnhplanner:";

function buildRecipeInputOverridesFromContextualRecipeInputs(
  existingRecipe: Recipe,
  refreshedRecipe: Recipe,
): NonNullable<FactoryNode["recipeInputOverrides"]> {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  refreshedRecipe.inputs.forEach((refreshedInput, index) => {
    const existingInput = existingRecipe.inputs[index];
    if (!existingInput || !isContextualRecipeInput(existingInput, refreshedInput)) {
      return;
    }

    overrides[String(index)] = {
      ...refreshedInput,
      id: existingInput.id,
      displayName: existingInput.displayName ?? refreshedInput.displayName,
      iconPath: existingInput.iconPath ?? refreshedInput.iconPath,
      iconAtlas: existingInput.iconAtlas ?? refreshedInput.iconAtlas,
      dominantColor: existingInput.dominantColor ?? refreshedInput.dominantColor,
      tooltip: existingInput.tooltip ?? refreshedInput.tooltip,
      alternatives: undefined,
    };
  });

  return overrides;
}

function isContextualRecipeInput(
  existingInput: Recipe["inputs"][number],
  refreshedInput: Recipe["inputs"][number],
): boolean {
  return (
    existingInput.kind === refreshedInput.kind &&
    existingInput.id !== refreshedInput.id &&
    !isOreDictionaryResource(existingInput) &&
    resourceMatchesInput({ kind: existingInput.kind, id: existingInput.id }, refreshedInput)
  );
}
