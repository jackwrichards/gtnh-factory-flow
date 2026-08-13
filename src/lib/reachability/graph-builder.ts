import type { ReachabilityGraph, ReachabilityRecipe } from "./closure";

/**
 * Builds the closure engine's graph from dataset recipes.
 *
 * Resource keys are kind-qualified ("item:gregtech:gt.blockores@855",
 * "fluid:oil") because item and fluid ids live in separate namespaces, and a
 * filled cell must never satisfy its fluid's slot (see "Cells Are Items" in
 * AGENTS.md - the Canner recipes are the bridge, and they are in the graph).
 *
 * A slot's accepted set is the union of the things the slot really takes:
 * its own id, the recipe-level substitutes riding on the input, and - for
 * `oredict:` slots - the group's members from the dataset's ore dictionary.
 * The synthetic oredict/choice ids themselves are excluded: nothing ever
 * produces one.
 */

interface DatasetResourceRef {
  kind?: string;
  id?: string;
  alternatives?: Array<{ kind?: string; id?: string }>;
}

export interface DatasetRecipeForGraph {
  id: string;
  kind?: string;
  inputs?: DatasetResourceRef[];
  outputs?: DatasetResourceRef[];
}

export function resourceKey(kind: string | undefined, id: string | undefined): string | undefined {
  if (!id || (kind !== "item" && kind !== "fluid")) {
    return undefined;
  }
  return `${kind}:${id}`;
}

export function buildReachabilityGraph(
  recipes: DatasetRecipeForGraph[],
  oreDictionary: Record<string, string[]>,
): ReachabilityGraph {
  const graphRecipes: ReachabilityRecipe[] = [];
  for (const recipe of recipes) {
    const inputSlots: string[][] = [];
    for (const input of recipe.inputs ?? []) {
      inputSlots.push(acceptedKeys(input, oreDictionary));
    }
    const outputs: string[] = [];
    for (const output of recipe.outputs ?? []) {
      const key = resourceKey(output.kind, output.id);
      if (key !== undefined) {
        outputs.push(key);
      }
    }
    if (outputs.length === 0) {
      continue;
    }
    graphRecipes.push({ id: recipe.id, inputSlots, outputs });
  }
  return { recipes: graphRecipes };
}

function acceptedKeys(
  input: DatasetResourceRef,
  oreDictionary: Record<string, string[]>,
): string[] {
  const accepted = new Set<string>();
  const id = input.id ?? "";

  if (id.startsWith("oredict:")) {
    for (const member of oreDictionary[id.slice("oredict:".length)] ?? []) {
      const key = resourceKey("item", member);
      if (key !== undefined) {
        accepted.add(key);
      }
    }
  } else if (!id.startsWith("choice:")) {
    const key = resourceKey(input.kind, input.id);
    if (key !== undefined) {
      accepted.add(key);
    }
  }

  for (const alternative of input.alternatives ?? []) {
    const key = resourceKey(alternative.kind ?? input.kind, alternative.id);
    if (key !== undefined) {
      accepted.add(key);
    }
  }

  return [...accepted];
}
