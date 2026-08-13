import type { ReachabilityGraph } from "@/lib/reachability/closure";

/**
 * Derives the closure engine's graph from the recipe lookup index, with no
 * shard loads: the lookup already posts every recipe under each resource it
 * uses and each it produces.
 *
 * The one thing the lookup flattens is SLOT GROUPING. A slot that accepts any
 * oredict member (or a substitute pair like Resistor/SMD Resistor) was posted
 * under every accepted id, so a naive inversion reads "uses plankWood AND
 * oak planks AND spruce planks..." where the recipe means OR. The groups are
 * reconstructed here against the catalog's own alternative lists: an id in
 * the pool whose catalog entry names alternatives claims every member present
 * as one slot. Ids left over stand alone as ordinary AND slots.
 *
 * Residual imprecision is deliberate and safe-side-biased: a recipe that
 * names an oredict group AND one of its members as two real slots collapses
 * into one (slightly over-permissive); a substitute group the catalog does
 * not carry stays split into AND slots (slightly under-permissive). Both are
 * rare, and neither invents production out of nothing.
 */

export interface ServerReachabilityGraphInput {
  recipeCount: number;
  /** Real dataset recipe ids by recipe index. */
  recipeIds: string[];
  /** `${mode}:${kind}:${id}` -> recipeMapId -> recipe indexes. */
  entries: Map<string, Map<number, number[]>>;
  /**
   * Catalog alternatives for a resource key: oredict membership on the
   * `oredict:` pseudo-entry, substitute groups on their anchor, placeholder
   * ("Any LV Circuit") expansions from the choice map. Undefined when the
   * key stands only for itself.
   */
  alternativesByKey: (key: string) => string[] | undefined;
}

export function buildServerReachabilityGraph(input: ServerReachabilityGraphInput): ReachabilityGraph {
  const flatInputs: Array<Set<string>> = Array.from({ length: input.recipeCount }, () => new Set());
  const outputs: Array<string[]> = Array.from({ length: input.recipeCount }, () => []);

  for (const [key, recipesByMap] of input.entries) {
    const uses = key.startsWith("uses:");
    const produces = !uses && key.startsWith("recipes:");
    if (!uses && !produces) {
      continue;
    }
    const resourceKey = key.slice(key.indexOf(":") + 1);
    for (const recipeIndexes of recipesByMap.values()) {
      for (const recipeIndex of recipeIndexes) {
        if (recipeIndex < 0 || recipeIndex >= input.recipeCount) {
          continue;
        }
        if (uses) {
          flatInputs[recipeIndex].add(resourceKey);
        } else if (!outputs[recipeIndex].includes(resourceKey)) {
          outputs[recipeIndex].push(resourceKey);
        }
      }
    }
  }

  const recipes = [];
  for (let index = 0; index < input.recipeCount; index++) {
    if (outputs[index].length === 0) {
      continue;
    }
    const inputSlots = groupSlots(flatInputs[index], input.alternativesByKey);
    recipes.push({
      id: input.recipeIds[index] ?? String(index),
      // A recipe the lookup shows no inputs for is NOT free. A few hundred
      // recipes (aspect-only inputs and other shapes the lookup skips) would
      // otherwise fire unconditionally and poison the closure - molten iron
      // was "reachable" from a bee. True sources (veins, bees, crops) fire
      // through rootRecipeIds, which waives slots; everything else with no
      // indexed inputs gets one unsatisfiable slot and stays quiet.
      inputSlots: inputSlots.length > 0 ? inputSlots : [[]],
      outputs: outputs[index],
    });
  }
  return { recipes };
}

function groupSlots(
  pool: Set<string>,
  alternativesByKey: (key: string) => string[] | undefined,
): string[][] {
  if (pool.size === 0) {
    return [];
  }

  const remaining = new Set(pool);
  const slots: string[][] = [];

  // Anchors first, oredict pseudo-ids before substitute anchors, both in
  // sorted order: grouping must not depend on map iteration order, or two
  // servers could disagree about the same dataset.
  const ordered = [...pool].sort((left, right) => {
    const leftOredict = left.startsWith("item:oredict:") ? 0 : 1;
    const rightOredict = right.startsWith("item:oredict:") ? 0 : 1;
    return leftOredict - rightOredict || left.localeCompare(right);
  });

  for (const key of ordered) {
    if (!remaining.has(key)) {
      continue;
    }
    const members = alternativesByKey(key);
    if (!members || members.length === 0) {
      continue;
    }
    const isPseudo = key.startsWith("item:oredict:") || key.startsWith("item:choice:");
    // A substitute anchor only claims a group that is actually all here; the
    // pseudo ids claim on their own authority (the lookup may not have
    // posted a placeholder's members at all).
    const present = members.filter((member) => remaining.has(member));
    if (!isPseudo && present.length + 1 < new Set([key, ...members]).size) {
      continue;
    }
    remaining.delete(key);
    for (const member of members) {
      remaining.delete(member);
    }
    // Accepted = the full membership, whether or not each member was posted:
    // producing ANY member satisfies the slot. The pseudo id itself is left
    // out - nothing ever produces one.
    const accepted = isPseudo ? members : [...new Set([key, ...members])];
    slots.push(accepted);
  }

  for (const key of ordered) {
    if (remaining.has(key)) {
      remaining.delete(key);
      slots.push([key]);
    }
  }

  return slots;
}
