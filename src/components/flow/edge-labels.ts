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
 * The numbers every label decision reads, resolved once: single-target bundles
 * report totals for the whole group, which win over the individual edge's.
 */
function getEdgeFlowFigures(data: EdgeLabelInput): {
  flowing: number;
  nameplate?: number;
  capacity?: number;
  starved: boolean;
} {
  const bundle = data.bundle;
  const bundled = Boolean(bundle?.demand);

  return {
    flowing: bundled ? bundle!.demand! : (data.transferred ?? data.demand),
    nameplate: bundled ? bundle!.nameplateDemand : data.nameplateDemand,
    capacity: bundled ? bundle!.sourceCapacity : data.sourceCapacity,
    starved: bundled ? bundle!.isSupplyCapped : data.isSupplyCapped,
  };
}

/**
 * The producer's capacity on this line, when a satisfaction percent should be
 * shown: the consumer is fed, something is flowing, and the capacity is a real
 * number — drawers and tanks report an infinite supply, which is no
 * comparison at all. A 1:1 line still shows its 100%, rather than hiding the
 * comparison.
 */
export function getEdgeSurplusCapacity(data: EdgeLabelInput | undefined): number | undefined {
  if (!data || isEdgeStarved(data)) {
    return undefined;
  }

  const { flowing, capacity } = getEdgeFlowFigures(data);
  if (capacity === undefined || !Number.isFinite(capacity) || flowing <= 1e-6) {
    return undefined;
  }

  return capacity;
}

/** True only when the producer could push meaningfully more than is flowing. */
export function isEdgeSurplus(data: EdgeLabelInput | undefined): boolean {
  const capacity = getEdgeSurplusCapacity(data);
  if (capacity === undefined) {
    return false;
  }

  return capacity > getEdgeFlowFigures(data!).flowing + 1e-6;
}

/**
 * One plain-English sentence saying what the label's numbers mean, for the
 * hover tooltip. Same precedence as formatEdgeRateLabel, so the sentence
 * always explains the fraction actually on screen.
 */
export function describeEdgeRate(data: EdgeLabelInput | undefined): string {
  if (!data) {
    return "";
  }

  const { flowing, nameplate, starved } = getEdgeFlowFigures(data);
  const unit = data.unit;

  if (starved && nameplate !== undefined && nameplate > flowing + 1e-6) {
    return `The machine this feeds needs ${withUnit(nameplate, unit)} but only gets ${withUnit(flowing, unit)}, so it runs at ${formatSatisfactionPercent(flowing / nameplate)}. It takes ${formatEdgeValue(nameplate / Math.max(flowing, 1e-6))}× the current supply to fill it.`;
  }

  const capacity = getEdgeSurplusCapacity(data);
  if (capacity !== undefined && capacity > flowing + 1e-6) {
    return `The maker can produce ${withUnit(capacity, unit)} but only ${withUnit(flowing, unit)} is taken, so it runs at ${formatSatisfactionPercent(flowing / capacity)}. ${withUnit(capacity - flowing, unit)} is free for new machines.`;
  }

  if (capacity !== undefined) {
    return `All of the maker's ${withUnit(capacity, unit)} is being used (100%). Supply and demand match.`;
  }

  return `Carrying ${withUnit(flowing, unit)}.`;
}

export function formatEdgeRateLabel(data: EdgeLabelInput | undefined): string {
  if (!data) {
    return "";
  }

  // transferred is only populated when the edge is starved, so flowing stays
  // the plain flow rate in the healthy case.
  const { flowing, nameplate, starved } = getEdgeFlowFigures(data);

  // The left side is always the real flow; the percent is how much of the
  // line's potential that flow covers. Red: share of what the consumer needs.
  // Green: share of what the producer could make - a machine giving 1 of a
  // possible 10 reads 10%, the same number its usage cell shows.
  if (starved && nameplate !== undefined && nameplate > flowing + 1e-6) {
    return `${withUnit(flowing, data.unit)} · ${formatSatisfactionPercent(flowing / nameplate)}`;
  }

  const surplusCapacity = getEdgeSurplusCapacity(data);
  if (surplusCapacity !== undefined && flowing > 1e-6) {
    return `${withUnit(flowing, data.unit)} · ${formatSatisfactionPercent(flowing / surplusCapacity)}`;
  }

  return withUnit(flowing, data.unit);
}

export function formatEdgeValue(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return formatNumberWithThousands(trimTrailingDecimalZeros(value.toFixed(digits)));
}

/** "10/s" reads as one token; "12 L/s" needs the space to stay a unit. */
function withUnit(value: number, unit: string): string {
  return unit.startsWith("/") ? `${formatEdgeValue(value)}${unit}` : `${formatEdgeValue(value)} ${unit}`;
}

/**
 * How much of the line's potential is flowing, as a percent. On red edges the
 * potential is what the consumer needs; on green edges it is what the
 * producer could make. Either way 100% means the line is maxed out.
 */
export function formatSatisfactionPercent(ratio: number): string {
  return `${Math.min(Math.round(ratio * 100), 999)}%`;
}
