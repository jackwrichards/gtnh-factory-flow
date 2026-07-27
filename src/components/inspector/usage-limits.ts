import { makeResourceKey, formatRate } from "@/lib/model";
import type { FactoryProject, ResourceKey, ThroughputResult } from "@/lib/model/types";
import { formatSatisfactionPercent } from "../flow/edge-labels";

/**
 * One factor that could cap a machine's usage. The chain answers "what limits
 * this machine now, and if that were fixed, what would limit it next".
 */
export interface UsageLimitEntry {
  key: string;
  kind: "supply" | "demand" | "no-demand" | "machines";
  label: string;
  /**
   * The ceiling this factor puts on usage: 1 is full speed, 0.5 caps the
   * machine at 50%, Infinity never limits (storage-fed lines).
   */
  fraction: number;
  /** Compact figures for the row, e.g. "5/s of 10/s" or "5 needed". No prose. */
  detail: string;
  /** True on the factor that is setting the usage right now. */
  active: boolean;
}

const EPSILON = 1e-6;

function rateWithUnit(value: number, kind: string): string {
  const unit = kind === "fluid" ? " L/s" : "/s";
  return `${formatRate(value, value >= 100 ? 0 : 1)}${unit}`;
}

/**
 * Ranks everything that could cap a node's usage, the binding factor first and
 * the rest in the order they would take over.
 *
 * Supply ceilings are estimated from producer capacity, which is a producer's
 * total rather than this node's share, so a supplier feeding several machines
 * reads a touch optimistic. The *active* factor never relies on the estimate:
 * it comes from the solver's own edge constraints and utilization.
 */
export function buildUsageLimitChain(
  project: Pick<FactoryProject, "nodes" | "edges" | "storages">,
  result: Pick<ThroughputResult, "nodes" | "edges">,
  nodeId: string,
): UsageLimitEntry[] {
  const nodeResult = result.nodes[nodeId];
  const node = project.nodes.find((entry) => entry.id === nodeId);
  if (!node || !nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
    return [];
  }

  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));

  // Demand side: what every taker would want at its own full speed. Storage
  // edges settle to what actually flows in, which is the honest number for a
  // sink that accepts anything.
  const wantedByOutput = new Map<ResourceKey, number>();
  for (const edge of project.edges) {
    if (edge.source !== nodeId) {
      continue;
    }

    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const wanted = storageIds.has(edge.target)
      ? edgeResult.transferredPerSecond
      : edgeResult.nameplateDemandPerSecond;
    wantedByOutput.set(key, (wantedByOutput.get(key) ?? 0) + wanted);
  }

  if (node.targetOutput) {
    const key = makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId);
    wantedByOutput.set(
      key,
      Math.max(wantedByOutput.get(key) ?? 0, node.targetOutput.amountPerSecond),
    );
  }

  // The most-wanted output is the one that drives the machine, mirroring the
  // solver's selectLimitingOutput.
  let demandEntry: UsageLimitEntry | undefined;
  for (const [key, wanted] of wantedByOutput) {
    const outputFlow = nodeResult.outputs[key];
    if (!outputFlow || outputFlow.amountPerSecond <= EPSILON) {
      continue;
    }

    const capacity = outputFlow.amountPerSecond;
    const fraction = wanted / capacity;
    if (demandEntry && fraction <= demandEntry.fraction) {
      continue;
    }

    const name = outputFlow.displayName ?? outputFlow.resourceId;
    if (fraction > 1 + EPSILON) {
      const machinesNeeded = Math.ceil(node.machineCount * fraction);
      demandEntry = {
        key: `machines:${key}`,
        kind: "machines",
        label: "Machine count",
        fraction,
        detail: `${machinesNeeded} needed`,
        active: false,
      };
    } else {
      demandEntry = {
        key: `demand:${key}`,
        kind: "demand",
        label: `${name} demand`,
        fraction,
        detail: `${rateWithUnit(wanted, outputFlow.kind)} of ${rateWithUnit(capacity, outputFlow.kind)}`,
        active: false,
      };
    }
  }

  if (!demandEntry) {
    demandEntry = {
      key: "no-demand",
      kind: "no-demand",
      label: "No takers",
      fraction: 1,
      detail: "runs free",
      active: false,
    };
  }

  // Supply side: one entry per connected ingredient.
  const supplyEntries: UsageLimitEntry[] = [];
  const incomingByInput = new Map<ResourceKey, { capacity: number; binding: boolean }>();
  for (const edge of project.edges) {
    if (edge.target !== nodeId) {
      continue;
    }

    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    if (!nodeResult.inputs[key]) {
      continue;
    }

    const current = incomingByInput.get(key) ?? { capacity: 0, binding: false };
    current.capacity += edgeResult.sourceCapacityPerSecond;
    current.binding = current.binding || edgeResult.constraint === "supply";
    incomingByInput.set(key, current);
  }

  for (const [key, incoming] of incomingByInput) {
    const inputFlow = nodeResult.inputs[key];
    const need = inputFlow?.amountPerSecond ?? 0;
    if (!inputFlow || need <= EPSILON) {
      continue;
    }

    const name = inputFlow.displayName ?? inputFlow.resourceId;
    if (!Number.isFinite(incoming.capacity)) {
      supplyEntries.push({
        key: `supply:${key}`,
        kind: "supply",
        label: `${name} supply`,
        fraction: Number.POSITIVE_INFINITY,
        detail: "from storage",
        active: false,
      });
      continue;
    }

    const fraction = incoming.capacity / need;
    supplyEntries.push({
      key: `supply:${key}`,
      kind: "supply",
      label: `${name} supply`,
      fraction,
      detail: `${rateWithUnit(incoming.capacity, inputFlow.kind)} of ${rateWithUnit(need, inputFlow.kind)}`,
      active: incoming.binding,
    });
  }

  // Pick the active factor from solver truth, not from the estimates: a
  // supply-capped edge marks its ingredient, overdemand marks machine count,
  // and otherwise demand is what sets the pace.
  const bindingSupply = supplyEntries
    .filter((entry) => entry.active)
    .sort((left, right) => left.fraction - right.fraction)[0];
  for (const entry of supplyEntries) {
    entry.active = entry === bindingSupply;
  }

  if (!bindingSupply) {
    demandEntry.active = true;
  }

  const rest = [demandEntry, ...supplyEntries]
    .filter((entry) => !entry.active)
    .sort((left, right) => left.fraction - right.fraction);
  const chain = [
    ...(bindingSupply ? [bindingSupply] : [demandEntry]),
    ...rest,
  ];

  return chain.slice(0, 4);
}
