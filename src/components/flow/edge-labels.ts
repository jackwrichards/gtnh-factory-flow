import { formatNumberWithThousands, trimTrailingDecimalZeros } from "@/lib/model";

/**
 * The parts of an edge's render data that decide its label. Kept structural so
 * these stay pure functions, testable without pulling in React Flow.
 */
export interface EdgeLabelInput {
  demand: number;
  transferred?: number;
  nameplateDemand?: number;
  /**
   * What the producer could emit at 100% utilisation. Only set when this edge
   * (or its single-target bundle) is the producer's sole outlet for the
   * resource — the solver reports the producer's total, so splitting it across
   * several consumers would show the same headroom on every line.
   */
  sourceCapacity?: number;
  unit: string;
  isLimited: boolean;
  isSupplyCapped: boolean;
  bundle?: {
    demand?: number;
    nameplateDemand?: number;
    sourceCapacity?: number;
    isSupplyCapped: boolean;
  };
}

/**
 * Whether the consumer on this edge is going hungry. Prefers the nameplate
 * comparison because isLimited is almost always false once the solver has
 * converged node utilisation down to match available supply.
 */
export function isEdgeStarved(data: EdgeLabelInput | undefined): boolean {
  return data?.isSupplyCapped === true || data?.isLimited === true;
}

/**
 * The producer's spare headroom on this line, when it is worth showing: the
 * consumer is fed, something is flowing, and the producer could push
 * meaningfully more. Returns the producer's full capacity, or undefined when
 * the label should stay a plain rate.
 */
export function getEdgeSurplusCapacity(data: EdgeLabelInput | undefined): number | undefined {
  if (!data || isEdgeStarved(data)) {
    return undefined;
  }

  const bundle = data.bundle;
  const bundled = Boolean(bundle?.demand);
  const flowing = bundled ? bundle!.demand! : (data.transferred ?? data.demand);
  const capacity = bundled ? bundle!.sourceCapacity : data.sourceCapacity;

  if (capacity === undefined || flowing <= 1e-6 || capacity <= flowing + 1e-6) {
    return undefined;
  }

  return capacity;
}

export function isEdgeSurplus(data: EdgeLabelInput | undefined): boolean {
  return getEdgeSurplusCapacity(data) !== undefined;
}

export function formatEdgeRateLabel(data: EdgeLabelInput | undefined): string {
  if (!data) {
    return "";
  }

  // A single-target bundle reports the summed rate for the whole group, so its
  // totals win over the individual edge's.
  const bundle = data.bundle;
  const bundled = Boolean(bundle?.demand);
  // transferred is only populated when the edge is starved, so this stays the
  // plain flow rate in the healthy case.
  const flowing = bundled ? bundle!.demand! : (data.transferred ?? data.demand);
  const nameplate = bundled ? bundle!.nameplateDemand : data.nameplateDemand;
  const starved = bundled ? bundle!.isSupplyCapped : data.isSupplyCapped;

  if (starved && nameplate !== undefined && nameplate > flowing + 1e-6) {
    return `${formatEdgeValue(flowing)} / ${formatEdgeValue(nameplate)} ${data.unit}`;
  }

  // The mirror image of the starved ratio: flowing over what the producer
  // could make, so slack capacity reads at a glance instead of hiding behind
  // a plain rate.
  const surplusCapacity = getEdgeSurplusCapacity(data);
  if (surplusCapacity !== undefined) {
    return `${formatEdgeValue(flowing)} / ${formatEdgeValue(surplusCapacity)} ${data.unit}`;
  }

  return `${formatEdgeValue(flowing)} ${data.unit}`;
}

export function formatEdgeValue(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return formatNumberWithThousands(trimTrailingDecimalZeros(value.toFixed(digits)));
}
