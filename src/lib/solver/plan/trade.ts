/**
 * AUTO's trading (spec-solver 3.4.2; Java `TradeStage`, `Solver.levels/leastAt/heldAt`). The plan buys as far upstream
 * as it can and sells as far downstream as it can: level by level, buying first (most steps first), then selling (most
 * steps first), it trades as little as it can at each level, holding every level before. What is held rides on
 * `Trades`, with the Up to push's bands (docs/up-to.md, `push.ts`), so every model of a support keeps all of it.
 *
 * With Up to pools a drawer on a wired port is the player's own end (a source drawer is supply, a product, byproduct or
 * trash drawer a sink), as in old Build: its ports are no trade level, so the trades settle and hold only forced flow
 * and the push may use the drawers freely; after the push the drawer stages (`settleDrawers`) draw from the sources as
 * little as they can, then bank in the sinks as little as they can (old Build's "recycle before importing", "ship
 * before banking"), each held like a trade level.
 */
import type { SolveContext } from "./context";
import {
  baseModel,
  closeGatesOutside,
  levelTerms,
  runModel,
  type ModelLp,
  type SolveResult,
} from "./lp";
import type { Note } from "./types";
import { NUMERICS, scaleOf } from "./validate";

/** One step of the trading: the ports where the plan buys (inputs) or sells (outputs) goods `steps` along. */
export interface Level {
  buying: boolean;
  steps: number;
  /** Connected-port indices, ascending. */
  ports: number[];
}

/** What a level trades at a point, in crafts. */
export function measureLevel(
  ctx: SolveContext,
  level: Level,
  externals: ArrayLike<number>,
): number {
  let total = 0;
  for (const p of level.ports) total += externals[p]! * ctx.externalWeight(p);
  return total;
}

/**
 * The levels in the order AUTO settles them (and the alternatives rank by). With Up to pools, a drawer's ports are none
 * of them: what crosses there is not a trade.
 */
export function levels(ctx: SolveContext): Level[] {
  const byKey = new Map<number, number[]>();
  const model = ctx.model;
  const drawerEnds = ctx.upToPools.length > 0;
  for (let p = 0; p < model.connectedPorts.length; p++) {
    if (drawerEnds && ctx.drawnPorts.has(p)) continue;
    const buying = model.connectedPorts[p]!.input;
    // ascending key order = buying (0) before selling (1), then steps descending
    const key = (buying ? 0 : 1) * 4294967296 - model.portSteps[p]!;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  return [...byKey.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const ports = byKey.get(key)!;
      const first = ports[0]!;
      return { buying: model.connectedPorts[first]!.input, steps: model.portSteps[first]!, ports };
    });
}

/** What the trading is held to: per level settled so far, at most what it was solved to. */
export interface Trades {
  /** The only gates the plan may trade at (every gate when null). */
  open: ReadonlySet<number> | null;
  levels: Level[];
  caps: number[];
  /** The push's bands: each Up to pool's level held in [lo, hi] (docs/up-to.md, "Hold"). Empty without Up to pools. */
  floors: Band[];
}

/** An Up to pool's level (its machine time over its capacity) held between `lo` and `hi`, both in 0..1. */
export interface Band {
  pool: number;
  lo: number;
  hi: number;
}

export function tradesWithin(open: ReadonlySet<number> | null): Trades {
  return { open, levels: [], caps: [], floors: [] };
}

/**
 * `held` with room on each hold's loose side, as wide as the conservation check: every value held was read off a point
 * the engine kept only to its own tolerance (HiGHS misses rows by about 1e-7 on its own scaling), so the exact holds
 * together can leave a later model with no point at all. A closed level stays closed, a band at nothing stays there.
 */
export function loosened(held: Trades): Trades {
  const room = NUMERICS.validateTol;
  return {
    ...held,
    caps: held.caps.map((cap) => (cap <= 0 ? 0 : cap * (1 + room) + room * Math.max(1, cap))),
    floors: held.floors.map((band) =>
      band.hi <= 0 ? band : { ...band, lo: Math.max(0, band.lo - room) },
    ),
  };
}

export function holding(trades: Trades, level: Level, cap: number): Trades {
  return {
    open: trades.open,
    levels: [...trades.levels, level],
    caps: [...trades.caps, cap],
    floors: trades.floors,
  };
}

/**
 * Where a level is held once solved: exactly where it was reached. A billionth of how fast the plan's machines run
 * is rounding, not a trade: it closes the level outright.
 */
export function heldAt(reached: number, extents: ArrayLike<number>): number {
  const rounding = NUMERICS.heldAtRounding * Math.max(1, scaleOf(extents));
  return reached <= rounding ? 0 : reached;
}

/** The base model with the open gates, every held level and every push band applied. */
export function tradeModel(ctx: SolveContext, held: Trades): ModelLp {
  const lp = baseModel(ctx);
  if (held.open !== null) closeGatesOutside(ctx, lp, held.open);
  held.levels.forEach((level, i) => {
    const cap = held.caps[i]!;
    if (cap <= 0) {
      for (const p of level.ports) lp.closeExt(p);
      return;
    }
    lp.addRow(
      level.ports.map((p) => lp.extCol(p)),
      level.ports.map((p) => ctx.externalWeight(p)),
      -Infinity,
      cap,
    );
  });
  // Rows, not column bounds: a column the program keeps must start at 0.
  for (const band of held.floors) {
    const { cols, vals } = levelTerms(ctx, lp, band.pool);
    lp.addRow(cols, vals, band.lo, band.hi);
  }
  return lp;
}

/** The least the plan can trade at `level`, with `held`'s levels held. */
export function leastAt(ctx: SolveContext, held: Trades, level: Level): SolveResult {
  const lp = tradeModel(ctx, held);
  for (const p of level.ports) lp.setExtCost(p, ctx.externalWeight(p));
  return runModel(
    ctx,
    lp,
    (level.buying ? "least buying at " : "least selling at ") + level.steps + " steps",
  );
}

export type TradeOutcome = { ok: true; held: Trades } | { ok: false; rejection: Note };

/** The plan's trading settled level by level, trading only at `open`'s gates (every gate when null). */
export function settleTrades(
  ctx: SolveContext,
  open: ReadonlySet<number> | null = null,
): TradeOutcome {
  let held = tradesWithin(open);
  for (const level of levels(ctx)) {
    const least = leastAt(ctx, held, level);
    if (!least.ok) return { ok: false, rejection: least.rejection };
    held = holding(
      held,
      level,
      heldAt(measureLevel(ctx, level, least.point.externals), least.point.extents),
    );
  }
  return { ok: true, held };
}

/**
 * The drawer stages' levels: the source drawers' wired ports, then the sinks' with every port a buffer banks at (what
 * its takers do not take: old Build's "ship before banking"), each only when there are any.
 */
function drawerLevels(ctx: SolveContext): Level[] {
  const sources = new Set<number>();
  const sinks = new Set<number>();
  for (const row of ctx.model.drawers) {
    for (const p of row.externalPorts) (row.kind === "SOURCE" ? sources : sinks).add(p);
  }
  for (const p of ctx.bankPorts.keys()) sinks.add(p);
  const out: Level[] = [];
  for (const [buying, ports] of [
    [true, sources],
    [false, sinks],
  ] as const) {
    if (ports.size > 0) out.push({ buying, steps: 0, ports: [...ports].sort((a, b) => a - b) });
  }
  return out;
}

/**
 * After the push (docs/up-to.md): the least the plan draws from its source drawers, then the least it banks in its sink
 * drawers, with everything before held, each held where it was reached like a trade level. Returns `pushed` itself
 * without Up to pools or wired drawers. A stage that finds nothing (numerics) stops where it is.
 */
export function settleDrawers(ctx: SolveContext, pushed: Trades): Trades {
  if (ctx.upToPools.length === 0) return pushed;
  let held = pushed;
  for (const level of drawerLevels(ctx)) {
    const lp = tradeModel(ctx, held);
    for (const p of level.ports) lp.setExtCost(p, ctx.externalWeight(p));
    const least = runModel(
      ctx,
      lp,
      level.buying ? "least from source drawers" : "least into sink drawers",
    );
    if (!least.ok) return held;
    held = holding(
      held,
      level,
      heldAt(measureLevel(ctx, level, least.point.externals), least.point.extents),
    );
  }
  return held;
}
