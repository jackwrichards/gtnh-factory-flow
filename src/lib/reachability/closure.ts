/**
 * Reachability over the recipe graph: given a set of root resources and root
 * recipes (sources like ore veins, bees, crops, or anything the player marks
 * as "I have this"), compute everything craftable.
 *
 * A recipe fires once every input slot is satisfied; its outputs join the
 * reachable set and may satisfy further slots. A slot that accepts several
 * things (an ore dictionary group, or a recipe-level substitute list) is
 * satisfied by ANY of them. This is the classic counting worklist over a
 * hypergraph: linear in total slot count, no per-step rescans, so the full
 * ~270k-recipe dataset closes in well under a second.
 *
 * The closure also records, for every reachable resource, the recipe that
 * produced it FIRST (its "witness"). Witnesses arrive in breadth-first order
 * from the roots, so following witnesses backwards from any target yields a
 * shallow producible chain whose every step is itself reachable - which is
 * what the wizard places on the board.
 */

export interface ReachabilityRecipe {
  id: string;
  /**
   * One entry per input slot; each entry lists every resource id the slot
   * accepts (concrete id plus oredict members plus substitutes). An empty
   * slot list can never be satisfied and makes the recipe unreachable.
   */
  inputSlots: string[][];
  outputs: string[];
}

export interface ReachabilityGraph {
  recipes: ReachabilityRecipe[];
}

export interface ClosureOptions {
  /** Resource ids the player starts with. */
  rootResources?: Iterable<string>;
  /** Recipes that fire unconditionally, inputs waived (veins, bees, crops). */
  rootRecipeIds?: Iterable<string>;
  /** Recipes removed from the world entirely (a vein toggled off). */
  disabledRecipeIds?: Iterable<string>;
  /** Resources that never count as reachable, even if produced. */
  disabledResourceIds?: Iterable<string>;
}

export interface ClosureResult {
  /** Every reachable resource id, in the order it was first reached. */
  reachable: string[];
  /** The same ids as a set, for membership checks. */
  reachableSet: Set<string>;
  /** resource id -> id of the recipe that first produced it (roots absent). */
  witnessByResource: Map<string, string>;
  /** Every recipe that fired. */
  firedRecipeIds: Set<string>;
  /** recipe id -> position in the firing sequence, for tie-breaks. */
  fireOrderByRecipe: Map<string, number>;
}

export function computeClosure(graph: ReachabilityGraph, options: ClosureOptions): ClosureResult {
  const disabledRecipes = new Set(options.disabledRecipeIds ?? []);
  const disabledResources = new Set(options.disabledResourceIds ?? []);
  const rootRecipes = new Set(options.rootRecipeIds ?? []);

  // slotWaiters: resource id -> slots the resource could satisfy. A slot is
  // identified by (recipe index, slot index) and shared by every id it
  // accepts, so the first accepted id to arrive satisfies it exactly once.
  const slotWaiters = new Map<string, Array<{ recipe: number; slot: number }>>();
  const slotSatisfied: boolean[][] = [];
  const missingSlots: number[] = [];

  const recipes = graph.recipes;
  for (let index = 0; index < recipes.length; index++) {
    const recipe = recipes[index];
    if (disabledRecipes.has(recipe.id)) {
      slotSatisfied.push([]);
      missingSlots.push(Number.POSITIVE_INFINITY);
      continue;
    }
    if (rootRecipes.has(recipe.id)) {
      slotSatisfied.push([]);
      missingSlots.push(0);
      continue;
    }
    slotSatisfied.push(new Array(recipe.inputSlots.length).fill(false));
    missingSlots.push(recipe.inputSlots.length);
    for (let slot = 0; slot < recipe.inputSlots.length; slot++) {
      const accepted = recipe.inputSlots[slot];
      if (accepted.length === 0) {
        // Nothing satisfies this slot; the recipe can never fire.
        missingSlots[index] = Number.POSITIVE_INFINITY;
        continue;
      }
      for (const resourceId of accepted) {
        let waiters = slotWaiters.get(resourceId);
        if (!waiters) {
          waiters = [];
          slotWaiters.set(resourceId, waiters);
        }
        waiters.push({ recipe: index, slot });
      }
    }
  }

  const reachable: string[] = [];
  const reached = new Set<string>();
  const witnessByResource = new Map<string, string>();
  const firedRecipeIds = new Set<string>();
  const fireOrderByRecipe = new Map<string, number>();
  const queue: string[] = [];

  const reach = (resourceId: string, witnessRecipeId?: string) => {
    if (reached.has(resourceId) || disabledResources.has(resourceId)) {
      return;
    }
    reached.add(resourceId);
    reachable.push(resourceId);
    if (witnessRecipeId !== undefined) {
      witnessByResource.set(resourceId, witnessRecipeId);
    }
    queue.push(resourceId);
  };

  const fire = (index: number) => {
    const recipe = recipes[index];
    if (firedRecipeIds.has(recipe.id)) {
      return;
    }
    firedRecipeIds.add(recipe.id);
    fireOrderByRecipe.set(recipe.id, fireOrderByRecipe.size);
    for (const output of recipe.outputs) {
      reach(output, recipe.id);
    }
  };

  for (const resourceId of options.rootResources ?? []) {
    reach(resourceId);
  }
  for (let index = 0; index < recipes.length; index++) {
    if (missingSlots[index] === 0) {
      fire(index);
    }
  }

  // Recipes fire in breadth-first waves: the queue holds resources in the
  // order reached, and a recipe fires the moment its last slot fills.
  for (let head = 0; head < queue.length; head++) {
    const resourceId = queue[head];
    const waiters = slotWaiters.get(resourceId);
    if (!waiters) {
      continue;
    }
    for (const waiter of waiters) {
      const satisfied = slotSatisfied[waiter.recipe];
      if (satisfied.length === 0 || satisfied[waiter.slot]) {
        continue;
      }
      satisfied[waiter.slot] = true;
      missingSlots[waiter.recipe] -= 1;
      if (missingSlots[waiter.recipe] === 0) {
        fire(waiter.recipe);
      }
    }
  }

  return { reachable, reachableSet: reached, witnessByResource, firedRecipeIds, fireOrderByRecipe };
}

export interface WitnessStep {
  recipeId: string;
  /** Resource ids this step exists to supply (target or a later step's slot). */
  provides: string[];
  /** Depth from the target: 0 is the target's own recipe. */
  depth: number;
}

/**
 * Walk backwards from a target to the roots, choosing at every resource the
 * TIDIEST fired producer rather than the first one the flood happened to
 * reach: fewest outputs first (a smelter over a scrap box whose forty chance
 * drops technically include the thing), earliest fired as the tie-break, so
 * the choice is deterministic and biased toward the shallow end.
 *
 * Steps return deepest-first (producers before consumers), so placing them
 * in order lays a chain left to right. Resources no fired recipe produces
 * (the player's granted roots) terminate the walk and are reported apart.
 * Termination is by the visited sets - each resource and recipe is expanded
 * once - so even a pathological producer choice cannot loop.
 */
export function witnessChain(
  graph: ReachabilityGraph,
  closure: ClosureResult,
  targetResourceId: string,
): { steps: WitnessStep[]; rootResourceIds: string[] } | undefined {
  if (!closure.reachableSet.has(targetResourceId)) {
    return undefined;
  }

  const recipesById = new Map(graph.recipes.map((recipe) => [recipe.id, recipe]));
  const producersByResource = new Map<string, ReachabilityRecipe[]>();
  for (const recipe of graph.recipes) {
    if (!closure.firedRecipeIds.has(recipe.id)) {
      continue;
    }
    for (const output of recipe.outputs) {
      let producers = producersByResource.get(output);
      if (!producers) {
        producers = [];
        producersByResource.set(output, producers);
      }
      producers.push(recipe);
    }
  }

  const chooseProducer = (resourceId: string): ReachabilityRecipe | undefined => {
    const producers = producersByResource.get(resourceId);
    if (!producers || producers.length === 0) {
      return undefined;
    }
    let best = producers[0];
    for (const candidate of producers) {
      const byOutputs = candidate.outputs.length - best.outputs.length;
      if (
        byOutputs < 0 ||
        (byOutputs === 0 &&
          (closure.fireOrderByRecipe.get(candidate.id) ?? Number.POSITIVE_INFINITY) <
            (closure.fireOrderByRecipe.get(best.id) ?? Number.POSITIVE_INFINITY))
      ) {
        best = candidate;
      }
    }
    return best;
  };

  const stepByRecipe = new Map<string, WitnessStep>();
  const rootResourceIds = new Set<string>();
  const visitedResources = new Set<string>();
  const pending: Array<{ resourceId: string; depth: number }> = [
    { resourceId: targetResourceId, depth: 0 },
  ];
  visitedResources.add(targetResourceId);

  for (let head = 0; head < pending.length; head++) {
    const { resourceId, depth } = pending[head];
    const producer = chooseProducer(resourceId);
    if (producer === undefined) {
      rootResourceIds.add(resourceId);
      continue;
    }
    const existing = stepByRecipe.get(producer.id);
    if (existing) {
      if (!existing.provides.includes(resourceId)) {
        existing.provides.push(resourceId);
      }
      existing.depth = Math.max(existing.depth, depth);
      continue;
    }
    const step: WitnessStep = { recipeId: producer.id, provides: [resourceId], depth };
    stepByRecipe.set(producer.id, step);
    const recipe = recipesById.get(producer.id);
    for (const slot of recipe?.inputSlots ?? []) {
      // Follow the accepted id that is actually reachable; prefer one already
      // visited so shared intermediates converge on one producer.
      const chosen =
        slot.find((id) => visitedResources.has(id)) ??
        slot.find((id) => closure.reachableSet.has(id));
      if (chosen !== undefined && !visitedResources.has(chosen)) {
        visitedResources.add(chosen);
        pending.push({ resourceId: chosen, depth: depth + 1 });
      }
    }
  }

  const steps = [...stepByRecipe.values()].sort((left, right) => right.depth - left.depth);
  return { steps, rootResourceIds: [...rootResourceIds] };
}
