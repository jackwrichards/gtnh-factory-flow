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
  /** The line ends in a barrel or tank; demand on it comes from whatever drains that storage. */
  isStorageTarget?: boolean;
  bundle?: {
    demand?: number;
    transferred?: number;
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
  // Storage soaks up whatever arrives; a line into a barrel is never starved.
  if (data?.isStorageTarget) {
    return false;
  }

  if (data?.isSupplyCapped === true || data?.isLimited === true) {
    return true;
  }

  const ratio = getEdgeSupplyRatio(data);
  return ratio !== undefined && ratio < 1 - 1e-6;
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
    // The real flow always wins; demand is only a fallback for callers that
    // never solved the edge.
    flowing: bundled
      ? (bundle!.transferred ?? bundle!.demand!)
      : (data.transferred ?? data.demand),
    nameplate: bundled ? bundle!.nameplateDemand : data.nameplateDemand,
    capacity: bundled ? bundle!.sourceCapacity : data.sourceCapacity,
    starved: bundled ? bundle!.isSupplyCapped : data.isSupplyCapped,
  };
}

/**
 * The line's one number: what it CAN deliver over what the consumer NEEDS.
 * Under 1 the machine here is going short, over 1 there is spare on offer,
 * exactly 1 is a perfect match. Undefined when there is no honest comparison:
 * drawers offer infinity, split producers withhold their capacity, and a line
 * to nowhere has no need to satisfy.
 */
export function getEdgeSupplyRatio(data: EdgeLabelInput | undefined): number | undefined {
  // A barrel has no need to satisfy - storage lines carry no percent at all.
  if (!data || data.isStorageTarget) {
    return undefined;
  }

  const { flowing, nameplate, capacity, starved } = getEdgeFlowFigures(data);
  const need = nameplate !== undefined && nameplate > 1e-6 ? nameplate : flowing;
  if (need <= 1e-6) {
    return undefined;
  }

  // A starved line with no known capacity still tells the truth: everything
  // it delivers is everything there is.
  const canDeliver =
    capacity !== undefined && Number.isFinite(capacity)
      ? capacity
      : starved || data.isLimited
        ? flowing
        : undefined;
  if (canDeliver === undefined) {
    return undefined;
  }

  return canDeliver / need;
}

/** True only when the line offers meaningfully more than the consumer needs. */
export function isEdgeSurplus(data: EdgeLabelInput | undefined): boolean {
  const ratio = getEdgeSupplyRatio(data);
  return ratio !== undefined && ratio > 1 + 1e-6;
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

  const { flowing, nameplate } = getEdgeFlowFigures(data);
  const unit = data.unit;

  // Dead simple for barrels: they take whatever arrives, end of story.
  if (data.isStorageTarget) {
    return `Flows into storage at ${withUnit(flowing, unit)}.`;
  }

  const need = nameplate !== undefined && nameplate > 1e-6 ? nameplate : flowing;

  // Careful with claims here: this line only knows about one resource. The
  // maker's real run speed can be set by its other products, and the fed
  // machine's by its other ingredients - so speak about the line, never about
  // how fast either machine runs. That is the usage grid's job.
  const ratio = getEdgeSupplyRatio(data);
  if (ratio !== undefined && ratio < 1 - 1e-6) {
    const canDeliver = ratio * need;
    // "need" here is this line's share after pooling: what it carries plus its
    // part of whatever the machine still lacks with every line delivering.
    return `This line's share of the machine's need is ${withUnit(need, unit)} but its source can only deliver ${withUnit(canDeliver, unit)}. It takes ${formatEdgeValue(1 / Math.max(ratio, 1e-6))}× the current supply to fill it.`;
  }

  if (ratio !== undefined && ratio > 1 + 1e-6) {
    const canDeliver = ratio * need;
    return `The maker can send ${withUnit(canDeliver, unit)} but only ${withUnit(need, unit)} is needed. ${withUnit(canDeliver - need, unit)} is spare.`;
  }

  if (ratio !== undefined) {
    return `The maker sends exactly the ${withUnit(need, unit)} that is needed.`;
  }

  return `Carrying ${withUnit(flowing, unit)}.`;
}

export function formatEdgeRateLabel(data: EdgeLabelInput | undefined): string {
  if (!data) {
    return "";
  }

  const { flowing } = getEdgeFlowFigures(data);

  // The left side is always the real flow; the percent is how much of the
  // consumer's need the line can supply. A maker offering 10 to a machine
  // needing 1 reads 1000%; offering 1 to a machine needing 2 reads 50%.
  const ratio = getEdgeSupplyRatio(data);
  if (ratio !== undefined) {
    return `${withUnit(flowing, data.unit)} · ${formatSupplyPercent(ratio)}`;
  }

  return withUnit(flowing, data.unit);
}

/** Uncapped except against absurdity: a drawer-scale ratio stays readable. */
export function formatSupplyPercent(ratio: number): string {
  const percent = Math.round(ratio * 100);
  return percent > 9999 ? "9999%+" : `${percent}%`;
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
