import { getVoltageTierForEuT, getVoltageTierIndex } from "@/lib/model/tiers";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";

export interface PowerSlice {
  key: string;
  label: string;
  euT: number;
  /** Fraction of the plan's total draw, 0..1. */
  share: number;
}

/** Rows past this fold into a single "Other" slice. */
export const MACHINE_SLICE_LIMIT = 5;

/**
 * Power grouped by the voltage tier each machine has to be fed at.
 *
 * The tier comes from one machine's draw, not the node's total: a node is
 * `machineCount` copies of the same machine, and it is a single machine that a
 * voltage line and its hatches have to reach. Summing first would report a row
 * of twenty LV machines as a UV load, which is the opposite of the answer.
 *
 * Ordered low tier to high, because the tier axis is ordinal — the order is the
 * meaning, and the ramp that colours it reads in the same direction.
 */
export function buildPowerByTier(
  project: Pick<FactoryProject, "nodes">,
  result: Pick<ThroughputResult, "nodes">,
): PowerSlice[] {
  const byTier = new Map<string, number>();
  let total = 0;

  for (const node of project.nodes) {
    const euT = result.nodes[node.id]?.euT ?? 0;
    if (euT <= 0) {
      continue;
    }

    const perMachineEuT = euT / Math.max(1, node.machineCount);
    const tier = getVoltageTierForEuT(perMachineEuT);
    byTier.set(tier, (byTier.get(tier) ?? 0) + euT);
    total += euT;
  }

  if (total <= 0) {
    return [];
  }

  return [...byTier.entries()]
    .sort((left, right) => getVoltageTierIndex(left[0] as never) - getVoltageTierIndex(right[0] as never))
    .map(([tier, euT]) => ({ key: tier, label: tier, euT, share: euT / total }));
}

/**
 * Power grouped by machine, biggest first, with the tail folded into "Other".
 *
 * Machine names are nominal — "Chemical Reactor" is not more or less than
 * "Electric Blast Furnace" — so the caller paints every bar one hue and lets
 * length carry the magnitude.
 */
export function buildPowerByMachine(
  project: Pick<FactoryProject, "nodes" | "recipes">,
  result: Pick<ThroughputResult, "nodes">,
  limit: number = MACHINE_SLICE_LIMIT,
): PowerSlice[] {
  const machineTypeByRecipeId = new Map(
    project.recipes.map((recipe) => [recipe.id, recipe.machineType]),
  );
  const byMachine = new Map<string, number>();
  let total = 0;

  for (const node of project.nodes) {
    const nodeResult = result.nodes[node.id];
    const euT = nodeResult?.euT ?? 0;
    if (euT <= 0) {
      continue;
    }

    const label =
      machineTypeByRecipeId.get(node.recipeId) || nodeResult?.recipeName || "Unknown machine";
    byMachine.set(label, (byMachine.get(label) ?? 0) + euT);
    total += euT;
  }

  if (total <= 0) {
    return [];
  }

  const ranked = [...byMachine.entries()].sort((left, right) => right[1] - left[1]);
  const head = ranked.slice(0, limit);
  const tail = ranked.slice(limit);

  const slices = head.map(([label, euT]) => ({
    key: label,
    label,
    euT,
    share: euT / total,
  }));

  if (tail.length > 0) {
    const otherEuT = tail.reduce((sum, [, euT]) => sum + euT, 0);
    slices.push({
      key: "__other__",
      label: `Other (${tail.length})`,
      euT: otherEuT,
      share: otherEuT / total,
    });
  }

  return slices;
}
