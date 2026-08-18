// The real DatasetQuery: a thin adapter over the app's own, production-tested
// dataset query layer (@/lib/server/dataset-query). This is the "reuse the
// repo's GTNH brain" seam — the agent does not re-implement recipe/resource
// search, it calls the same functions the recipe book uses.
//
// Everything downstream of the brain (tools, the LLM loop) depends only on the
// DatasetQuery port, so the tool logic is unit-tested against an in-memory
// fake while this adapter is exercised for real against the published dataset
// on the server.
import {
  getDatasetRecipe,
  getResourceModId,
  queryDatasetRecipes,
  queryDatasetResources,
} from "@/lib/server/dataset-query";
import type { RecipeSummary } from "@/lib/datasets/types";
import type {
  DatasetQuery,
  DatasetRecipeHit,
  ResourceKind,
  ResourceRef,
} from "./types";

function toRecipeHit(summary: RecipeSummary): DatasetRecipeHit {
  return {
    id: summary.id,
    name: summary.name,
    recipeMap: summary.recipeMap,
    machineType: summary.machineType,
    minimumTier: summary.minimumTier,
    durationTicks: summary.durationTicks,
    eut: summary.eut,
    inputs: summary.inputs.map((input) => ({
      kind: input.kind,
      id: input.id,
      name: input.displayName,
      amount: input.amount,
    })),
    outputs: summary.outputs.map((output) => ({
      kind: output.kind,
      id: output.id,
      name: output.displayName,
      amount: output.amount,
      chance: output.chance,
    })),
  };
}

/** Build the live DatasetQuery for one published dataset version. */
export function createRealDatasetQuery(versionId: string): DatasetQuery {
  return {
    versionId,

    async searchResources({ query, limit = 10, kind }) {
      const result = await queryDatasetResources(versionId, {
        query,
        offset: 0,
        limit,
        // The query layer knows items and fluids; "aspect" has no book page.
        kind: kind === "item" || kind === "fluid" ? kind : undefined,
      });
      return result.resources.slice(0, limit).map((resource) => ({
        id: resource.id,
        kind: resource.kind as ResourceKind,
        name: resource.displayName,
        modId: getResourceModId(resource),
        recipeCount: resource.recipeCount,
      }));
    },

    async findRecipes({ resource, mode, limit = 20 }) {
      const result = await queryDatasetRecipes(versionId, {
        query: "",
        resource: { kind: resource.kind, id: resource.id },
        mode,
        maxTier: "all",
        offset: 0,
        limit,
      });
      return result.recipes.slice(0, limit).map(toRecipeHit);
    },

    getFullRecipe: (recipeId: string) => getDatasetRecipe(versionId, recipeId),
  };
}

// Re-exported so the bridge can name the resource the LLM means in chat.
export type { ResourceRef };
