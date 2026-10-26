/**
 * The layout judge: routes a board's real wires at hypothetical card
 * positions and reports crossings, length and points (`board-arrange`'s
 * judge).
 *
 * A full verdict solves every wire. A QUICK verdict, given the `base`
 * positions it differs from, pins the base's routes for every wire that
 * neither touches a moved card nor runs through where one now stands, and
 * re-solves only the rest, so the polish's many one-card trials stay cheap.
 * Full verdicts are cached by their positions, so a base is found by
 * layout, not by Map identity.
 */

import {
  measureRoutes,
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridRoutedEdge,
  type GridRouteRequest,
  type PinnedRoute,
} from "@/components/flow/grid-edge-router";
import { BOARD_GRID } from "@/lib/board-grid";
import { routePoints } from "@/lib/route-metrics";
import { DEFAULT_ROUTER_TUNING, type RouterTuning } from "@/components/flow/router-tuning";

export type JudgePositions = ReadonlyMap<string, { x: number; y: number }>;

export interface JudgeVerdict {
  crossings: number;
  length: number;
  /** Length plus bends and crossings at the router's prices: the score. */
  points: number;
  events: Array<{ point: { x: number; y: number }; edges: [string, string] }>;
}

/** What the judges have done so far, for benches. */
export const judgeStats = { full: 0, fullMs: 0, quick: 0, quickMs: 0, loose: 0, pinned: 0, prepMs: 0, verdictMs: 0 };

export function makeRouteJudge(
  restingObstacles: readonly GridObstacle[],
  restingRequests: readonly GridRouteRequest[],
  tuningIn: Partial<RouterTuning>,
  /**
   * Obstacles that ride on an arranged card, by id: the cards inside a kept
   * group move with the group's block, so wires into the group are judged at
   * the card they really reach. The layouts name only the arranged cards.
   */
  riders: ReadonlyArray<readonly [string, string]> = [],
): (positions: JudgePositions, options?: { quick?: boolean; base?: JudgePositions }) => JudgeVerdict {
  const riderOf = new Map(riders);
  const restingById = new Map(restingObstacles.map((o) => [o.id, o]));
  /** Where an obstacle's top-left stands in a layout: its own place, or its block's step from rest. */
  const at = (positions: JudgePositions, o: GridObstacle): { x: number; y: number } => {
    const own = positions.get(o.id);
    if (own) return own;
    const blockId = riderOf.get(o.id);
    const blockAt = blockId === undefined ? undefined : positions.get(blockId);
    const block = blockId === undefined ? undefined : restingById.get(blockId);
    if (blockAt && block) return { x: o.left + blockAt.x - block.left, y: o.top + blockAt.y - block.top };
    return { x: o.left, y: o.top };
  };
  // A tuning saved before a dial existed still routes with that dial at
  // its default, exactly as the app fills it in.
  const tuning: RouterTuning = { ...DEFAULT_ROUTER_TUNING, ...tuningIn };
  const quickTuning: RouterTuning = {
    ...tuning,
    negotiationRounds: 1,
    negotiationBudget: 0.5,
    wideRungCells: Math.min(tuning.wideRungCells, 12),
  };
  const fullByKey = new Map<string, { obstacles: GridObstacle[]; requests: GridRouteRequest[]; routes: Map<string, GridRoutedEdge> }>();
  const keyOf = (positions: JudgePositions) =>
    restingObstacles.map((o) => {
      const p = at(positions, o);
      return `${p.x},${p.y}`;
    }).join(";");
  const place = (positions: JudgePositions) => {
    const delta = new Map<string, { dx: number; dy: number }>();
    const obstacles: GridObstacle[] = restingObstacles.map((o) => {
      const p = at(positions, o);
      delta.set(o.id, { dx: p.x - o.left, dy: p.y - o.top });
      return { id: o.id, left: p.x, top: p.y, right: p.x + (o.right - o.left), bottom: p.y + (o.bottom - o.top) };
    });
    const shift = (ends: GridEndpoint[], id: string): GridEndpoint[] => {
      const d = delta.get(id) ?? { dx: 0, dy: 0 };
      return ends.map((e) => ({ ...e, x: e.x + d.dx, y: e.y + d.dy }));
    };
    const requests: GridRouteRequest[] = restingRequests.map((r) => ({
      ...r,
      sources: shift(r.sources, r.sourceCardId ?? ""),
      targets: shift(r.targets, r.targetCardId ?? ""),
      waypoints: undefined,
    }));
    return { obstacles, requests };
  };
  const verdict = (routes: Iterable<GridRoutedEdge>): JudgeVerdict => {
    const started = performance.now();
    const measure = measureRoutes(routes);
    judgeStats.verdictMs += performance.now() - started;
    // Routed at the router's prices, scored at the arrange's crossing price.
    const points = routePoints(measure, tuning) + (tuning.arrangeCrossing - tuning.crossing) * measure.crossings;
    return { ...measure, points };
  };
  const full = (positions: JudgePositions): JudgeVerdict => {
    const key = keyOf(positions);
    const cached = fullByKey.get(key);
    if (cached) {
      return verdict(cached.routes.values());
    }
    const { obstacles, requests } = place(positions);
    const started = performance.now();
    const routes = solveGridRoutes(obstacles, requests, undefined, tuning);
    judgeStats.full += 1;
    judgeStats.fullMs += performance.now() - started;
    fullByKey.set(key, { obstacles, requests, routes });
    if (fullByKey.size > 64) {
      fullByKey.delete(fullByKey.keys().next().value!);
    }
    return verdict(routes.values());
  };
  return (positions, options) => {
    if (!options?.quick || !options.base) {
      return full(positions);
    }
    const base = fullByKey.get(keyOf(options.base));
    if (!base) {
      return full(positions);
    }
    const prepStarted = performance.now();
    // Which cards moved between the base and this layout?
    const moved = new Set<string>();
    for (const o of restingObstacles) {
      const a = at(options.base, o);
      const b = at(positions, o);
      if (a.x !== b.x || a.y !== b.y) moved.add(o.id);
    }
    if (moved.size === 0) {
      return verdict(base.routes.values());
    }
    const { obstacles, requests } = place(positions);
    const movedRects = obstacles.filter((o) => moved.has(o.id)).map((o) => ({
      left: o.left - BOARD_GRID,
      top: o.top - BOARD_GRID,
      right: o.right + BOARD_GRID,
      bottom: o.bottom + BOARD_GRID,
    }));
    const runsThroughMoved = (route: GridRoutedEdge): boolean => {
      for (let i = 1; i < route.points.length; i += 1) {
        const a = route.points[i - 1];
        const b = route.points[i];
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const bottom = Math.max(a.y, b.y);
        for (const rect of movedRects) {
          if (right > rect.left && left < rect.right && bottom > rect.top && top < rect.bottom) return true;
        }
      }
      return false;
    };
    const pinned: PinnedRoute[] = [];
    const loose: GridRouteRequest[] = [];
    const baseRequests = new Map(base.requests.map((r) => [r.edgeId, r]));
    for (const request of requests) {
      const route = base.routes.get(request.edgeId);
      const touches = moved.has(request.sourceCardId ?? "") || moved.has(request.targetCardId ?? "");
      if (!route || touches || !route.vertices || runsThroughMoved(route)) {
        loose.push(request);
      } else {
        pinned.push({ request: baseRequests.get(request.edgeId) ?? request, route });
      }
    }
    judgeStats.prepMs += performance.now() - prepStarted;
    const started = performance.now();
    // The loose wires negotiate briefly: the pinned ones cannot yield, so
    // long rounds only re-fight the same crossings.
    const routes = solveGridRoutes(obstacles, loose, undefined, quickTuning, pinned);
    judgeStats.quick += 1;
    judgeStats.quickMs += performance.now() - started;
    judgeStats.loose += loose.length;
    judgeStats.pinned += pinned.length;
    return verdict(routes.values());
  };
}
