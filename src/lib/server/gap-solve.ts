import { getRecipeTierIndex, getTierIndexForFilter, solveGapFill } from "@/lib/planner/gap-solver";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
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

export interface GapSolveTimings {
  totalMs: number;
  /** Building the "uses what I have" preference set (includes index warmup). */
  indexMs: number;
  searchMs: number;
  hydrateMs: number;
  lookups: number;
}

export interface DatasetGapSolveResult {
  plans: Array<GapFillPlan<Recipe>>;
  notes: string[];
  timings: GapSolveTimings;
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
  const startedAt = Date.now();

  onProgress?.({ stage: "indexing" });
  // "Uses something I have" — computed once, then used to sample candidates
  // from variant-heavy families (one Coke Oven recipe per log type) by
  // compatibility with the stockpile instead of by luck.
  const preferredRecipeIndexes = await getDatasetRecipeIndexesUsingResources(
    versionId,
    [...request.supply, ...(request.existingOutputs ?? [])],
    maxTier,
  );
  const indexedAt = Date.now();
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

  const searchedAt = Date.now();
  onProgress?.({ stage: "hydrating", lookups });

  // When nothing closed, diagnose instead of shrugging: how many recipes make
  // the target at all, and which setting is filtering them away. This is what
  // turns "no path found" into something the user can actually act on.
  if (!result.plans.some((plan) => plan.closed)) {
    const targetLabel = resourceLabel({
      id: request.target.id,
      displayName: request.target.displayName,
    });
    const unfiltered = await getDatasetProducingRecipes(
      versionId,
      request.target,
      "all",
      PRODUCER_LOOKUP_LIMIT,
      preferredRecipeIndexes,
    );

    if (unfiltered.length === 0) {
      result.notes.push(
        `Nothing in the dataset makes ${targetLabel} (${request.target.id}) at all. Several mods reuse the same item name — if this looks wrong, pick the GregTech variant in the request.`,
      );
    } else {
      const tierOnly =
        maxTier === "all"
          ? unfiltered
          : await getDatasetProducingRecipes(
              versionId,
              request.target,
              maxTier,
              PRODUCER_LOOKUP_LIMIT,
              preferredRecipeIndexes,
            );
      const withMachines = allowedRecipeMaps
        ? tierOnly.filter((recipe) => {
            const recipeMap = (recipe.recipeMap ?? recipe.source?.recipeMap ?? "").toLowerCase();
            return (
              (recipeMap.length > 0 && allowedRecipeMaps.has(recipeMap)) ||
              allowedRecipeMaps.has(recipe.machineType.toLowerCase())
            );
          })
        : tierOnly;

      if (withMachines.length === 0) {
        result.notes.push(
          `${unfiltered.length} recipes make ${targetLabel}, but none survive your solver settings: the ${maxTier} tier cap removes ${
            unfiltered.length - tierOnly.length
          }, disabled machines remove ${tierOnly.length - withMachines.length}.`,
        );
      } else {
        const capIndex = getTierIndexForFilter(maxTier);
        const aboveCap =
          capIndex === undefined
            ? []
            : unfiltered.filter((recipe) => getRecipeTierIndex(recipe) > capIndex);
        if (aboveCap.length > 0) {
          const highestTier =
            GT_VOLTAGE_TIERS[Math.max(...aboveCap.map((recipe) => getRecipeTierIndex(recipe)))]
              ?.tier;
          result.notes.push(
            `${aboveCap.length} recipes that make ${targetLabel} sit above your ${maxTier} tier cap (up to ${
              highestTier ?? "?"
            }). The real chain may need a higher tier.`,
          );
        }
      }
    }
  }

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

  const finishedAt = Date.now();
  return {
    plans,
    notes: result.notes,
    timings: {
      totalMs: finishedAt - startedAt,
      indexMs: indexedAt - startedAt,
      searchMs: searchedAt - indexedAt,
      hydrateMs: finishedAt - searchedAt,
      lookups,
    },
  };
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
