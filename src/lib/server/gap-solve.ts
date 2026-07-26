import { getTierIndexForFilter, solveGapFill } from "@/lib/planner/gap-solver";
import { resourceLabel } from "@/lib/model/resources";
import type {
  ExistingProduction,
  GapFillPlan,
  GapSolveOptions,
  GapSolveProgress,
  GapSolveTarget,
  PlannerResource,
  SolverRecipe,
} from "@/lib/planner/types";
import type { MachineTier, Recipe } from "@/lib/model/types";
import {
  getDatasetProducingRecipes,
  getDatasetRecipe,
  getDatasetRecipeIndexesUsingResources,
} from "./dataset-query";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

/**
 * How many producers per resource are pulled from the index for ranking
 * (a low-tier head from every recipe map). The solver's beam then narrows
 * further; this only bounds hydration work.
 */
const PRODUCER_LOOKUP_LIMIT = 160;

export interface DatasetGapSolveRequest {
  target: GapSolveTarget;
  supply: PlannerResource[];
  existingOutputs?: ExistingProduction[];
  maxTier?: TierFilter;
  options?: GapSolveOptions;
}

export interface DatasetGapSolveResult {
  plans: Array<GapFillPlan<Recipe>>;
  notes: string[];
}

export async function solveDatasetGap(
  versionId: string,
  request: DatasetGapSolveRequest,
  onProgress?: (progress: GapSolveProgress) => void,
): Promise<DatasetGapSolveResult> {
  const maxTier = request.maxTier ?? "all";
  const allowedRecipeMaps = request.options?.allowedRecipeMaps
    ? new Set(request.options.allowedRecipeMaps.map((name) => name.trim().toLowerCase()))
    : undefined;
  // Progress carries the current plan context on every heartbeat so a viewer
  // joining mid-stream still knows what is being explored.
  let lookups = 0;
  let currentPlan: Pick<GapSolveProgress, "planLabel" | "planIndex"> = {};

  onProgress?.({ stage: "indexing" });
  // "Uses something I have" — computed once, then used to sample candidates
  // from variant-heavy families (one Coke Oven recipe per log type) by
  // compatibility with the stockpile instead of by luck.
  const preferredRecipeIndexes = await getDatasetRecipeIndexesUsingResources(
    versionId,
    [...request.supply, ...(request.existingOutputs ?? [])],
    maxTier,
  );
  const result = await solveGapFill(
    {
      target: request.target,
      supply: request.supply,
      existingOutputs: request.existingOutputs,
      options: {
        ...request.options,
        maxTierIndex: request.options?.maxTierIndex ?? getTierIndexForFilter(maxTier),
      },
    },
    {
      getProducers: (resource) => {
        lookups += 1;
        onProgress?.({
          stage: "exploring",
          lookups,
          resource: resourceLabel(resource),
          ...currentPlan,
        });
        return getDatasetProducingRecipes(
          versionId,
          resource,
          maxTier,
          PRODUCER_LOOKUP_LIMIT,
          preferredRecipeIndexes,
          allowedRecipeMaps,
        );
      },
    },
    {
      onPlanStart: (rootName, planIndex) => {
        currentPlan = { planLabel: rootName, planIndex };
        onProgress?.({ stage: "exploring", lookups, ...currentPlan });
      },
    },
  );

  onProgress?.({ stage: "hydrating", lookups });

  // The canvas renders full recipes (NEI layout, machine handlers, icons), so
  // the chosen steps go back hydrated rather than as compact summaries.
  const recipeCache = new Map<string, Promise<Recipe | undefined>>();
  const hydrateRecipe = (recipeId: string) => {
    const cached = recipeCache.get(recipeId);
    if (cached) {
      return cached;
    }

    const pending = getDatasetRecipe(versionId, recipeId).catch(() => undefined);
    recipeCache.set(recipeId, pending);
    return pending;
  };

  const plans = await Promise.all(
    result.plans.map(async (plan) => ({
      ...plan,
      steps: await Promise.all(
        plan.steps.map(async (step) => ({
          ...step,
          recipe: (await hydrateRecipe(step.recipe.id)) ?? toRecipe(step.recipe),
        })),
      ),
    })),
  );

  return { plans, notes: result.notes };
}

function toRecipe(recipe: SolverRecipe): Recipe {
  return {
    id: recipe.id,
    name: recipe.name,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    inputs: recipe.inputs,
    outputs: recipe.outputs,
    source: recipe.source?.recipeMap ? { recipeMap: recipe.source.recipeMap } : undefined,
  };
}
