import { getVoltageTierForEuT, getVoltageTierIndex } from "@/lib/model/tiers";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";

export interface PowerSlice {
  key: string;
  label: string;
  euT: number;
  /** Fraction of the plan's total draw, 0..1. */
  share: number;
}

/**
 * Peak is nameplate draw — every machine running flat out. Actual scales each
 * node by its solved utilization, so a starved machine only counts the share of
 * time it actually runs.
 */
export type PowerMode = "peak" | "actual";

/** Rows past this fold into a single "Other" slice. */
export const MACHINE_SLICE_LIMIT = 5;

function clampUtilization(utilization: number): number {
  if (!Number.isFinite(utilization)) {
    return 1;
  }

  return Math.min(Math.max(utilization, 0), 1);
}

function nodeDraw(
  result: Pick<ThroughputResult, "nodes">,
  nodeId: string,
  mode: PowerMode,
): number {
  const nodeResult = result.nodes[nodeId];
  const euT = nodeResult?.euT ?? 0;
  if (euT <= 0) {
    return 0;
  }

  return mode === "actual" ? euT * clampUtilization(nodeResult?.utilization ?? 0) : euT;
}

/** Plan-wide totals for both modes, so the header can show "actual of peak". */
export function computePowerTotals(
  project: Pick<FactoryProject, "nodes">,
  result: Pick<ThroughputResult, "nodes">,
): { peakEuT: number; actualEuT: number } {
  let peakEuT = 0;
  let actualEuT = 0;

  for (const node of project.nodes) {
    peakEuT += nodeDraw(result, node.id, "peak");
    actualEuT += nodeDraw(result, node.id, "actual");
  }

  return { peakEuT, actualEuT };
}

/**
 * Power grouped by the voltage tier each machine has to be fed at.
 *
 * The tier comes from one machine's draw, not the node's total: a node is
 * `machineCount` copies of the same machine, and it is a single machine that a
 * voltage line and its hatches have to reach. Summing first would report a row
 * of twenty LV machines as a UV load, which is the opposite of the answer.
 *
 * The tier is always classified from the nameplate draw — a machine idling at
 * 30% is still wired to the same voltage line — only the summed EU/t is scaled
 * when `mode` is "actual".
 *
 * Ordered low tier to high, because the tier axis is ordinal — the order is the
 * meaning, and the ramp that colours it reads in the same direction.
 */
export function buildPowerByTier(
  project: Pick<FactoryProject, "nodes">,
  result: Pick<ThroughputResult, "nodes">,
  mode: PowerMode = "peak",
): PowerSlice[] {
  const byTier = new Map<string, number>();
  let total = 0;

  for (const node of project.nodes) {
    const peakEuT = nodeDraw(result, node.id, "peak");
    if (peakEuT <= 0) {
      continue;
    }

    const euT = nodeDraw(result, node.id, mode);
    const perMachineEuT = peakEuT / Math.max(1, node.machineCount);
    const tier = getVoltageTierForEuT(perMachineEuT);
    byTier.set(tier, (byTier.get(tier) ?? 0) + euT);
    total += euT;
  }

  if (total <= 0) {
    return [];
  }

  return [...byTier.entries()]
    .filter(([, euT]) => euT > 0)
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
  mode: PowerMode = "peak",
  limit: number = MACHINE_SLICE_LIMIT,
): PowerSlice[] {
  const machineTypeByRecipeId = new Map(
    project.recipes.map((recipe) => [recipe.id, recipe.machineType]),
  );
  const byMachine = new Map<string, number>();
  let total = 0;

  for (const node of project.nodes) {
    const euT = nodeDraw(result, node.id, mode);
    if (euT <= 0) {
      continue;
    }

    const label =
      machineTypeByRecipeId.get(node.recipeId) ||
      result.nodes[node.id]?.recipeName ||
      "Unknown machine";
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
