/**
 * The board-wide rate unit. A module singleton (not React state) so every
 * formatter — node ports, tooltips, edge labels, sidebar rates — reads the
 * same setting without threading a prop through the world. The store action
 * that flips it also recomputes the throughput result, which rebuilds every
 * surface, so nothing renders a stale unit.
 */
export type RateUnit = "tick" | "second" | "minute" | "hour";

const UNITS: Record<RateUnit, { multiplier: number; per: string }> = {
  // A Minecraft tick is a twentieth of a second, and it is the unit the game
  // itself quotes machines in (EU/t, and every recipe duration).
  tick: { multiplier: 1 / 20, per: "t" },
  second: { multiplier: 1, per: "s" },
  minute: { multiplier: 60, per: "min" },
  hour: { multiplier: 3600, per: "hr" },
};

const state: { unit: RateUnit } = { unit: "second" };

export function setActiveRateUnit(unit: RateUnit): void {
  state.unit = unit;
}

export function getActiveRateUnit(): RateUnit {
  return state.unit;
}

/** Multiply a per-second figure by this before display. */
export function rateUnitMultiplier(): number {
  return UNITS[state.unit].multiplier;
}

export function rateUnitSuffix(kind: string): string {
  const { per } = UNITS[state.unit];
  if (kind === "fluid") {
    return ` L/${per}`;
  }
  if (kind === "energy") {
    return ` EU/${per}`;
  }
  return `/${per}`;
}

/**
 * Scale a noise floor or a rounding step that was written in per-second terms.
 *
 * A formatter that rounds the DISPLAYED number keeps less of the truth the
 * smaller the unit is: per tick every figure is twenty times smaller, so a
 * real 0.004/s output lands under a floor meant to hide nothing but zero, and
 * a port that was reading a rate goes blank. Never above 1 — units bigger than
 * a second already carry their own, more generous, precision.
 */
export function rateUnitPrecisionScale(): number {
  return Math.min(rateUnitMultiplier(), 1);
}
