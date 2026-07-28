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
  /** One plain sentence explaining this factor, used when it is the limit. */
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

  // Demand side: what every machine downstream would want at its own full
  // speed. Storage sinks are different in kind, not degree - a drawer soaks up
  // any surplus, and the solver runs the node at full speed for it - so a
  // resource with a storage sink can never be demand-limited, and its flow
  // into the drawer must not be dressed up as a demand number.
  const wantedByOutput = new Map<ResourceKey, number>();
  let hasStorageSink = false;
  for (const edge of project.edges) {
    if (edge.source !== nodeId) {
      continue;
    }

    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }

    if (storageIds.has(edge.target)) {
      hasStorageSink = true;
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    wantedByOutput.set(
      key,
      (wantedByOutput.get(key) ?? 0) + edgeResult.nameplateDemandPerSecond,
    );
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
        detail: `Demand is ${rateWithUnit(wanted, outputFlow.kind)} but it can only make ${rateWithUnit(capacity, outputFlow.kind)}. Add ${Math.max(machinesNeeded - node.machineCount, 1)} more machines.`,
        active: false,
      };
    } else {
      demandEntry = {
        key: `demand:${key}`,
        kind: "demand",
        label: `${name} demand`,
        fraction,
        detail: `Only ${rateWithUnit(wanted, outputFlow.kind)} of the ${rateWithUnit(capacity, outputFlow.kind)} it can make is asked for.`,
        active: false,
      };
    }
  }

  // A drawer soaks up whatever demanded outputs leave over, so with a storage
  // sink attached, demand below full speed stops being a limit. Overdemand
  // (needing more machines) still stands - a drawer cannot make more ingots.
  if (hasStorageSink && (!demandEntry || demandEntry.fraction <= 1 + EPSILON)) {
    demandEntry = {
      key: "storage-sink",
      kind: "no-demand",
      label: "Storage",
      fraction: 1,
      detail: "Extra output goes into storage, so it runs at full speed.",
      active: false,
    };
  } else if (!demandEntry) {
    demandEntry = {
      key: "no-demand",
      kind: "no-demand",
      label: "No demand",
      fraction: 1,
      detail: "Nothing uses its output yet, so it runs at full speed.",
      active: false,
    };
  }

  // How much each producer already ships out per resource, across the whole
  // board. What a producer can still offer this node is what it sends now
  // plus its unclaimed leftover - never its whole capacity, which it may be
  // spending on other machines.
  const takenBySourceResource = new Map<string, number>();
  for (const edge of project.edges) {
    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }

    const takenKey = `${edge.source}|${makeResourceKey(edge.resourceKind, edge.resourceId)}`;
    takenBySourceResource.set(
      takenKey,
      (takenBySourceResource.get(takenKey) ?? 0) + edgeResult.transferredPerSecond,
    );
  }

  // Supply side: one entry per connected ingredient. What a producer can give
  // this node *today* is scaled by how fast that producer actually runs - a
  // starved producer's nameplate is a promise, not a supply. The nameplate
  // ceiling is kept separately, as the "even with upstream fixed" line.
  const supplyEntries: UsageLimitEntry[] = [];
  const incomingByInput = new Map<
    ResourceKey,
    { capacityNow: number; capacityMax: number; binding: boolean; upstreamSlow: boolean }
  >();
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

    const producerUtilization = result.nodes[edge.source]?.utilization;
    const producerSpeed =
      producerUtilization !== undefined && Number.isFinite(producerUtilization)
        ? Math.min(Math.max(producerUtilization, 0), 1)
        : 1;
    const taken = takenBySourceResource.get(`${edge.source}|${key}`) ?? 0;
    const capacityMax = edgeResult.sourceCapacityPerSecond;
    const capacityNow = capacityMax * producerSpeed;
    const current = incomingByInput.get(key) ?? {
      capacityNow: 0,
      capacityMax: 0,
      binding: false,
      upstreamSlow: false,
    };
    current.capacityNow += edgeResult.transferredPerSecond + Math.max(0, capacityNow - taken);
    current.capacityMax += edgeResult.transferredPerSecond + Math.max(0, capacityMax - taken);
    current.binding = current.binding || edgeResult.constraint === "supply";
    current.upstreamSlow = current.upstreamSlow || producerSpeed < 1 - EPSILON;
    incomingByInput.set(key, current);
  }

  for (const [key, incoming] of incomingByInput) {
    const inputFlow = nodeResult.inputs[key];
    const need = inputFlow?.amountPerSecond ?? 0;
    if (!inputFlow || need <= EPSILON) {
      continue;
    }

    const name = inputFlow.displayName ?? inputFlow.resourceId;
    if (!Number.isFinite(incoming.capacityNow)) {
      supplyEntries.push({
        key: `supply:${key}`,
        kind: "supply",
        label: `${name} supply`,
        fraction: Number.POSITIVE_INFINITY,
        detail: "Fed from storage, so it never runs short.",
        active: false,
      });
      continue;
    }

    const fraction = incoming.capacityNow / need;
    supplyEntries.push({
      key: `supply:${key}`,
      kind: "supply",
      label: `${name} supply`,
      fraction,
      detail: `It gets ${rateWithUnit(incoming.capacityNow, inputFlow.kind)} of the ${rateWithUnit(need, inputFlow.kind)} it needs.${
        incoming.upstreamSlow ? " The machine making it is running slow too." : ""
      }`,
      active: incoming.binding,
    });

    // The deeper "and then what": even with every upstream machine at full
    // speed, supply still tops out at the producers' nameplate.
    if (
      incoming.upstreamSlow &&
      Number.isFinite(incoming.capacityMax) &&
      incoming.capacityMax > incoming.capacityNow + EPSILON
    ) {
      supplyEntries.push({
        key: `supply-max:${key}`,
        kind: "supply",
        label: "upstream supply",
        fraction: incoming.capacityMax / need,
        detail: `With upstream at full speed it could get ${rateWithUnit(incoming.capacityMax, inputFlow.kind)}.`,
        active: false,
      });
    }
  }

  // The active factor is the lowest ceiling, so the story always agrees with
  // the header percent. Overdemand outranks everything (a fully fed machine
  // can still be swamped), a solver-flagged starving edge outranks estimates,
  // and near-ties go to the demand-side entry, whose sentence explains the
  // running speed rather than restating a supply that just about suffices.
  const flaggedSupply = supplyEntries
    .filter((entry) => entry.active)
    .sort((left, right) => left.fraction - right.fraction)[0];
  let active: UsageLimitEntry = demandEntry;
  if (nodeResult.utilization > 1 + EPSILON && demandEntry.fraction > 1 + EPSILON) {
    active = demandEntry;
  } else if (flaggedSupply) {
    active = flaggedSupply;
  } else {
    for (const entry of supplyEntries) {
      if (Number.isFinite(entry.fraction) && entry.fraction < active.fraction - 1e-3) {
        active = entry;
      }
    }
  }

  for (const entry of [demandEntry, ...supplyEntries]) {
    entry.active = entry === active;
  }

  const rest = [demandEntry, ...supplyEntries]
    .filter((entry) => !entry.active)
    .sort((left, right) => left.fraction - right.fraction);

  return [active, ...rest].slice(0, 4);
}
