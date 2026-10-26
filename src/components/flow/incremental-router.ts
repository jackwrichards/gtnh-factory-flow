/**
 * The board's router between edits: it keeps the last board and its routes,
 * and when the board changes it routes again only what the change touched.
 *
 * A wire keeps its route while both its cards stand where they stood, its
 * request is unchanged, and the route runs nowhere a card (or frame) left,
 * took or now stands. That holds for a wire the router could not place too
 * (its boxed-in L): searching again would find no way until something moves. Everything else routes again around the kept wires,
 * which are pinned into the solve exactly as they were (`solveGridRoutes`'s
 * `pinned`). When most of the board changed, or the dials did, it solves
 * afresh. Moving one card on a fifty-wire board re-solves a handful of wires,
 * so the wires follow the card while it moves.
 *
 * Rough solves (a card in hand) skip the negotiation; the solve that follows
 * the drop routes those wires again properly. A route therefore depends on
 * the board's history as well as its geometry, never on the viewport.
 *
 * Pure and worker-safe. A router's state can be written down (`snapshot`)
 * and read back (`restore`), so a plan opened again starts from the routes
 * it had (`route-memory.ts`).
 */

import {
  solveGridRoutes,
  type GridObstacle,
  type GridRoutedEdge,
  type GridRouteRequest,
  type GridSolveStats,
  type PinnedRoute,
} from "./grid-edge-router";
import { BOARD_GRID } from "@/lib/board-grid";
import { routerTuningKey, type RouterTuning } from "./router-tuning";

/**
 * How far round a changed card a kept route must stay: its clearance cell
 * plus one, so a wire that hugged a card that left gets to straighten out.
 */
const AREA_PAD = 2 * BOARD_GRID;

export interface IncrementalStats extends GridSolveStats {
  /** Wires routed again this call, and wires kept as they were. */
  routed: number;
  kept: number;
  fresh: boolean;
}

type Rect = { left: number; top: number; right: number; bottom: number };

/** A router's whole state, plain data: what `route-memory.ts` stores. */
export interface RouterSnapshot {
  tuningKey: string;
  obstacles: GridObstacle[];
  /** Each wire's request key (`requestKey`), by edge id. */
  requests: Array<[string, string]>;
  routes: GridRoutedEdge[];
  rough: string[];
}

export class IncrementalRouter {
  private obstacles = new Map<string, GridObstacle>();
  /** Each wire's request key, by edge id: what it asked for last time. */
  private requests = new Map<string, string>();
  private routes = new Map<string, GridRoutedEdge>();
  /** Wires last routed by a rough solve: a thorough one routes them again. */
  private rough = new Set<string>();
  private tuningKey: string | undefined;

  /** The state as plain data, or undefined before the first solve. */
  snapshot(): RouterSnapshot | undefined {
    if (this.tuningKey === undefined) return undefined;
    return {
      tuningKey: this.tuningKey,
      obstacles: [...this.obstacles.values()],
      requests: [...this.requests],
      routes: [...this.routes.values()],
      rough: [...this.rough],
    };
  }

  /** Takes up a written-down state: the next solve diffs against it. */
  restore(snapshot: RouterSnapshot) {
    this.tuningKey = snapshot.tuningKey;
    this.obstacles = new Map(snapshot.obstacles.map((obstacle) => [obstacle.id, obstacle]));
    this.requests = new Map(snapshot.requests);
    this.routes = new Map(snapshot.routes.map((route) => [route.edgeId, route]));
    this.rough = new Set(snapshot.rough);
  }

  /** The obstacles it last routed around, by id: how a caller tells boards apart. */
  knows(id: string): boolean {
    return this.obstacles.has(id);
  }

  /** Forgets everything: the next solve routes the whole board. */
  reset() {
    this.obstacles.clear();
    this.requests.clear();
    this.routes.clear();
    this.rough.clear();
    this.tuningKey = undefined;
  }

  solve(
    obstacles: GridObstacle[],
    requests: GridRouteRequest[],
    tuning: RouterTuning,
    options: { thorough: boolean; stats?: IncrementalStats },
  ): Map<string, GridRoutedEdge> {
    const { thorough, stats } = options;
    const key = routerTuningKey(tuning);
    const solveTuning = thorough ? tuning : { ...tuning, negotiationRounds: 0 };
    const nextObstacles = new Map(obstacles.map((obstacle) => [obstacle.id, obstacle]));

    const plan = this.tuningKey === key ? this.diff(nextObstacles, requests, thorough) : undefined;
    let routes: Map<string, GridRoutedEdge>;
    if (!plan) {
      routes = solveGridRoutes(obstacles, requests, stats, solveTuning);
      this.rough = thorough ? new Set() : new Set(requests.map((request) => request.edgeId));
    } else {
      routes = solveGridRoutes(obstacles, plan.loose, stats, solveTuning, plan.pinned);
      const rough = new Set<string>();
      for (const pin of plan.pinned) {
        if (this.rough.has(pin.request.edgeId)) rough.add(pin.request.edgeId);
      }
      if (!thorough) {
        for (const request of plan.loose) rough.add(request.edgeId);
      }
      this.rough = rough;
    }
    if (stats) {
      stats.fresh = !plan;
      stats.routed = plan ? plan.loose.length : requests.length;
      stats.kept = plan ? plan.pinned.length : 0;
    }
    this.tuningKey = key;
    this.obstacles = nextObstacles;
    this.requests = new Map(requests.map((request) => [request.edgeId, requestKey(request)]));
    this.routes = routes;
    return routes;
  }

  /**
   * Which wires keep their routes and which route again, or undefined when
   * the board should be solved afresh.
   */
  private diff(
    next: Map<string, GridObstacle>,
    requests: GridRouteRequest[],
    thorough: boolean,
  ): { pinned: PinnedRoute[]; loose: GridRouteRequest[] } | undefined {
    if (this.routes.size === 0) {
      return undefined;
    }
    const changed = new Set<string>();
    const areas: Rect[] = [];
    for (const [id, obstacle] of next) {
      const before = this.obstacles.get(id);
      if (before && sameRect(before, obstacle)) continue;
      changed.add(id);
      // What the obstacle left and took: a frame that grows a row touches
      // that row, not every wire inside it.
      for (const area of before ? rectDifference(before, obstacle) : [obstacle]) areas.push(pad(area));
    }
    for (const [id, before] of this.obstacles) {
      if (next.has(id)) continue;
      changed.add(id);
      areas.push(pad(before));
    }
    // Most of the board changed: a fresh solve is as quick, and cleaner.
    if (2 * changed.size > Math.max(next.size, this.obstacles.size)) {
      return undefined;
    }
    const pinned: PinnedRoute[] = [];
    const loose: GridRouteRequest[] = [];
    for (const request of requests) {
      const route = this.routes.get(request.edgeId);
      const keep =
        this.requests.get(request.edgeId) === requestKey(request) &&
        route !== undefined &&
        !(thorough && this.rough.has(request.edgeId)) &&
        !changed.has(request.sourceCardId ?? "") &&
        !changed.has(request.targetCardId ?? "") &&
        !runsThrough(route!, areas);
      if (keep) {
        pinned.push({ request, route: route! });
      } else {
        loose.push(request);
      }
    }
    // Pinned wires install in the order the last solve installed them, so
    // wires sharing a lane keep their places in it.
    const rank = new Map<string, number>();
    for (const id of this.routes.keys()) rank.set(id, rank.size);
    pinned.sort((a, b) => rank.get(a.request.edgeId)! - rank.get(b.request.edgeId)!);
    return { pinned, loose };
  }
}

function pad(rect: Rect): Rect {
  return {
    left: rect.left - AREA_PAD,
    top: rect.top - AREA_PAD,
    right: rect.right + AREA_PAD,
    bottom: rect.bottom + AREA_PAD,
  };
}

/**
 * The ground two rectangles do not share: both whole when they are apart,
 * otherwise the bands of each that the other does not cover.
 */
export function rectDifference(a: Rect, b: Rect): Rect[] {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (left >= right || top >= bottom) {
    return [a, b];
  }
  const shared = { left, top, right, bottom };
  return [...bandsOutside(a, shared), ...bandsOutside(b, shared)];
}

/** The parts of `rect` outside `inner` (which lies inside it), as up to four bands. */
function bandsOutside(rect: Rect, inner: Rect): Rect[] {
  const bands: Rect[] = [];
  if (inner.top > rect.top) bands.push({ left: rect.left, top: rect.top, right: rect.right, bottom: inner.top });
  if (inner.bottom < rect.bottom) bands.push({ left: rect.left, top: inner.bottom, right: rect.right, bottom: rect.bottom });
  if (inner.left > rect.left) bands.push({ left: rect.left, top: inner.top, right: inner.left, bottom: inner.bottom });
  if (inner.right < rect.right) bands.push({ left: inner.right, top: inner.top, right: rect.right, bottom: inner.bottom });
  return bands;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/**
 * What a wire asks for, as one string: equal keys mean the same request. The
 * docks are left out (they are the rims of the two cards, which the diff
 * checks for itself), and so is `order`, a tiebreak that shifts for every
 * wire after one added or removed. So is the width: it changes with the
 * flow (all of them at once when a plan's numbers arrive after its first
 * route), and a kept route takes its new width when its lanes are packed.
 */
function requestKey(request: GridRouteRequest): string {
  const stops = (request.waypoints ?? []).map((point) => `${point.x},${point.y}`).join(" ");
  return [
    request.sourceCardId ?? "",
    request.targetCardId ?? "",
    request.sourceSquare ? 1 : 0,
    request.targetSquare ? 1 : 0,
    (request.exemptObstacleIds ?? []).join(","),
    (request.homeObstacleIds ?? []).join(","),
    stops,
  ].join("|");
}

/** Whether any segment of the drawn route enters any of the areas. */
function runsThrough(route: GridRoutedEdge, areas: Rect[]): boolean {
  if (areas.length === 0) return false;
  const points = route.points;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    for (const area of areas) {
      if (segmentMeetsRect(a.x, a.y, b.x, b.y, area)) return true;
    }
  }
  return false;
}

/** Liang-Barsky: does the segment touch the open rectangle? */
function segmentMeetsRect(x0: number, y0: number, x1: number, y1: number, rect: Rect): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let lo = 0;
  let hi = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > hi) return false;
      if (t > lo) lo = t;
    } else {
      if (t < lo) return false;
      if (t < hi) hi = t;
    }
    return true;
  };
  return (
    clip(-dx, x0 - rect.left) &&
    clip(dx, rect.right - x0) &&
    clip(-dy, y0 - rect.top) &&
    clip(dy, rect.bottom - y0) &&
    lo < hi
  );
}
