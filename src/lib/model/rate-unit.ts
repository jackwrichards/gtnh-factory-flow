/**
 * The board-wide rate unit. A module singleton (not React state) so every
 * formatter — node ports, tooltips, edge labels, sidebar rates — reads the
 * same setting without threading a prop through the world. The store action
 * that flips it also recomputes the throughput result, which rebuilds every
 * surface, so nothing renders a stale unit.
 */
export type RateUnit = "second" | "minute" | "hour";

const state: { unit: RateUnit } = { unit: "second" };

export function setActiveRateUnit(unit: RateUnit): void {
  state.unit = unit;
}

export function getActiveRateUnit(): RateUnit {
  return state.unit;
}

/** Multiply a per-second figure by this before display. */
export function rateUnitMultiplier(): number {
  return state.unit === "second" ? 1 : state.unit === "minute" ? 60 : 3600;
}

export function rateUnitSuffix(fluid: boolean): string {
  const per = state.unit === "second" ? "s" : state.unit === "minute" ? "min" : "hr";
  return fluid ? ` L/${per}` : `/${per}`;
}
