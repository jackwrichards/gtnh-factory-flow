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
  /**
   * One monotone clock over the whole flood: every first-reach of a resource
   * ticks it. `reachOrderByResource` is the tick a resource first existed;
   * `unlockOrderByRecipe` is the tick a recipe's LAST input arrived (0 for
   * roots and zero-input recipes) - the moment it became fully fed.
   *
   * Together they answer the question chains stand on: a recipe with
   * unlockOrder < reachOrder(R) was fully fed before R existed anywhere, so
   * using it to produce R can never smuggle R into its own supply chain.
   */
  reachOrderByResource: Map<string, number>;
  unlockOrderByRecipe: Map<string, number>;
  /** The options this closure ran with, so chain walks can re-run the flood
   *  with extra bans against the same world. */
  options: ClosureOptions;
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
  const reachOrderByResource = new Map<string, number>();
  const unlockOrderByRecipe = new Map<string, number>();
  const queue: string[] = [];
  let clock = 0;

  const reach = (resourceId: string, witnessRecipeId?: string) => {
    if (reached.has(resourceId) || disabledResources.has(resourceId)) {
      return;
    }
    reached.add(resourceId);
    reachable.push(resourceId);
    reachOrderByResource.set(resourceId, ++clock);
    if (witnessRecipeId !== undefined) {
      witnessByResource.set(resourceId, witnessRecipeId);
    }
    queue.push(resourceId);
  };

  const fire = (index: number, unlockOrder: number) => {
    const recipe = recipes[index];
    if (firedRecipeIds.has(recipe.id)) {
      return;
    }
    firedRecipeIds.add(recipe.id);
    unlockOrderByRecipe.set(recipe.id, unlockOrder);
    for (const output of recipe.outputs) {
      reach(output, recipe.id);
    }
  };

  for (const resourceId of options.rootResources ?? []) {
    reach(resourceId);
  }
  for (let index = 0; index < recipes.length; index++) {
    if (missingSlots[index] === 0) {
      // Roots and zero-input recipes were fed before anything existed.
      fire(index, 0);
    }
  }

  // Recipes fire in breadth-first waves: the queue holds resources in the
  // order reached, and a recipe fires the moment its last slot fills - which
  // stamps its unlock order as that resource's reach tick, NOT its position
  // in the firing sequence, so every recipe unlocked by the same arrival is
  // ordered the same however the queue happened to serialise them.
  for (let head = 0; head < queue.length; head++) {
    const resourceId = queue[head];
    const arrivalOrder = reachOrderByResource.get(resourceId) ?? 0;
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
        fire(waiter.recipe, arrivalOrder);
      }
    }
  }

  return {
    reachable,
    reachableSet: reached,
    witnessByResource,
    firedRecipeIds,
    reachOrderByResource,
    unlockOrderByRecipe,
    options,
  };
}

export interface WitnessStep {
  recipeId: string;
  /** Resource ids this step exists to supply (target or a later step's slot). */
  provides: string[];
  /** Depth from the target: 0 is the target's own recipe. */
  depth: number;
}

export interface WitnessChainOptions {
  /**
   * resource id -> recipe id the caller wants producing it. Honoured when
   * that recipe is a legitimate producer at that point in the chain;
   * otherwise the tidiest-producer rule stands. This is how a player swaps
   * one link of a chain and has the walk rebuild beneath their choice.
   */
  preferredProducers?: ReadonlyMap<string, string>;
  /**
   * Recipes that never win by DEFAULT but stay pickable: decomposition
   * recipes (essentia smelting) technically produce their outputs, and a
   * chain that builds a thing just to break it down is not the plan anyone
   * meant - unless they chose it, which the preference above lets them do.
   */
  deprioritizedRecipeIds?: ReadonlySet<string>;
  /**
   * Everything a resource is interchangeable with (its ore dictionary
   * family), banned alongside it in sub-closures. Banning GT's steel ingot
   * alone leaves Railcraft's alive, and through it every oredict recipe -
   * so the walk would still "prove" steel makeable from steel, just via a
   * cousin. Absent = each resource stands alone.
   */
  familyOf?: (resourceId: string) => readonly string[];
}

/**
 * Walk backwards from a target to the roots, choosing at every resource the
 * TIDIEST legitimate producer: fewest outputs first (a smelter over a scrap
 * box whose forty chance drops technically include the thing), earliest
 * unlocked as the tie-break, so the choice is deterministic and biased
 * toward the shallow end.
 *
 * "Legitimate" is decided by a SUB-CLOSURE, and this is the load-bearing
 * idea: for each link, the flood is re-run with that resource and its chain
 * ancestors banned, and only recipes that still fire qualify. Demagnetizing
 * a magnetic steel ingot is steel's tidiest producer by output count, but in
 * a world where steel is banned no polarizer ever runs, so it does not
 * qualify and the walk falls through to the blast furnace. This is exact -
 * honest long routes (ore to dust to ingot) survive, because they fire fine
 * without the ingot - and costs one linear flood per chain link.
 *
 * Steps return deepest-first (producers before consumers), so placing them
 * in order lays a chain left to right. Resources no qualifying recipe
 * produces (the player's granted roots) terminate the walk and are reported
 * apart. Each resource commits to one producer, so termination is by the
 * committed set.
 */
export function witnessChain(
  graph: ReachabilityGraph,
  closure: ClosureResult,
  targetResourceId: string,
  options: WitnessChainOptions = {},
):
  | {
      steps: WitnessStep[];
      rootResourceIds: string[];
      /**
       * Every fired producer of each walked resource, best-first: what the
       * chain-review dropdowns offer. Present for walked resources only.
       */
      candidatesByResource: Map<string, string[]>;
    }
  | undefined {
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

  // Correctness is the sub-closure's job, so ranking is pure taste - and the
  // taste is EARLIEST TECH FIRST: the recipe that became makeable soonest
  // out from the roots is the one a production line reaches for (a blast
  // furnace over a late-game force-bee detour). Output count breaks ties
  // (a smelter over a lucky-dip of forty chance drops).
  const deprioritized = options.deprioritizedRecipeIds;
  const tidiness = (left: ReachabilityRecipe, right: ReachabilityRecipe) =>
    Number(deprioritized?.has(left.id) ?? false) - Number(deprioritized?.has(right.id) ?? false) ||
    (closure.unlockOrderByRecipe.get(left.id) ?? Number.POSITIVE_INFINITY) -
      (closure.unlockOrderByRecipe.get(right.id) ?? Number.POSITIVE_INFINITY) ||
    left.outputs.length - right.outputs.length;

  const baseDisabledResources = [...(closure.options.disabledResourceIds ?? [])];
  const subClosureFor = (banned: readonly string[]): ClosureResult =>
    computeClosure(graph, {
      ...closure.options,
      disabledResourceIds: [...baseDisabledResources, ...banned],
    });

  const stepByRecipe = new Map<string, WitnessStep>();
  const rootResourceIds = new Set<string>();
  const candidatesByResource = new Map<string, string[]>();
  /** resource -> the recipe committed to produce it; null = player supplies. */
  const committed = new Map<string, string | null>();

  const commit = (resourceId: string, depth: number, ancestors: readonly string[]): void => {
    const existing = committed.get(resourceId);
    if (existing !== undefined) {
      if (existing !== null) {
        const step = stepByRecipe.get(existing);
        if (step) {
          step.depth = Math.max(step.depth, depth);
        }
      }
      return;
    }

    // The world without this link or anything above it - nor anything those
    // are interchangeable with: what still fires there is what may
    // legitimately produce it here.
    const banned = [...ancestors, resourceId, ...(options.familyOf?.(resourceId) ?? [])];
    const sub = subClosureFor(banned);
    const qualified = (producersByResource.get(resourceId) ?? [])
      .filter((producer) => sub.firedRecipeIds.has(producer.id))
      .sort(tidiness);
    candidatesByResource.set(
      resourceId,
      qualified.map((candidate) => candidate.id),
    );

    const preferredId = options.preferredProducers?.get(resourceId);
    const chosen =
      (preferredId !== undefined
        ? qualified.find((candidate) => candidate.id === preferredId)
        : undefined) ?? qualified[0];

    if (!chosen) {
      committed.set(resourceId, null);
      rootResourceIds.add(resourceId);
      return;
    }

    committed.set(resourceId, chosen.id);
    const existingStep = stepByRecipe.get(chosen.id);
    if (existingStep) {
      if (!existingStep.provides.includes(resourceId)) {
        existingStep.provides.push(resourceId);
      }
      existingStep.depth = Math.max(existingStep.depth, depth);
    } else {
      stepByRecipe.set(chosen.id, { recipeId: chosen.id, provides: [resourceId], depth });
    }

    const bannedSet = new Set(banned);
    for (const slot of chosen.inputSlots) {
      // Prefer an id already committed, so shared intermediates converge on
      // one producer; otherwise the EARLIEST-REACHED accepted id alive in
      // the banned world - the most primitive form of the thing, not
      // whichever exotic cousin happened to sort first.
      const alreadyCommitted = slot.find((id) => committed.has(id) && !bannedSet.has(id));
      let chosenInput = alreadyCommitted;
      if (chosenInput === undefined) {
        let bestOrder = Number.POSITIVE_INFINITY;
        for (const id of slot) {
          if (!sub.reachableSet.has(id)) {
            continue;
          }
          const order = closure.reachOrderByResource.get(id) ?? Number.POSITIVE_INFINITY;
          if (order < bestOrder) {
            bestOrder = order;
            chosenInput = id;
          }
        }
      }
      if (chosenInput !== undefined) {
        commit(chosenInput, depth + 1, banned);
      }
    }
  };

  commit(targetResourceId, 0, []);

  const steps = [...stepByRecipe.values()].sort((left, right) => right.depth - left.depth);
  return { steps, rootResourceIds: [...rootResourceIds], candidatesByResource };
}
