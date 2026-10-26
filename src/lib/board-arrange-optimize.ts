/**
 * The arranger's proxy score and search: takes an island the layered pass
 * has placed and rearranges its cards to lower the score the router's
 * wires would get.
 *
 * Every wire gets a PROXY route shaped like the router's (leave at the rim
 * point facing the far card, run straight for the clean cells, shortest
 * octilinear way with one centred diagonal, land straight), scored in the
 * router's own points: length, bends at turn45/turn90, crossings at the
 * crossing dial weighing the heavier wire, all times wireWeight, plus a
 * detour estimate for each card a proxy path runs through.
 *
 * The SEARCH keeps the column discipline: a state is the card order per
 * column, each column's vertical offset, the air above each card, and each
 * satellite's slide along its machine's side. A placer derives positions
 * from that, so every trial is tidy. Simulated annealing over swaps, column
 * hops flow allows, moves to a partner's side and offset nudges lowers the
 * proxy; the real router then judges the best few and the fewest points
 * wins.
 *
 * Pure and deterministic: the RNG is seeded from the island's ids.
 */

import { BOARD_GRID } from "./board-grid";
import {
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridRouteRequest,
} from "@/components/flow/grid-edge-router";
import { DEFAULT_ROUTER_TUNING, getRouterTuning, type RouterTuning } from "@/components/flow/router-tuning";
import { measureWireRoutes, routePoints, wireWeight } from "./route-metrics";

export interface OptimizeCard {
  id: string;
  width: number;
  height: number;
  role?: "machine" | "storage";
  /** Column from the layered pass. Satellites carry their anchor's. */
  layer: number;
  /** Order within the column from the layered pass (any monotone key). */
  seq: number;
  /** The feeder section the layered pass put the card in; bands keep air. */
  section?: number;
  /**
   * A drawer pinned to one machine's side keeps to that side (supplies
   * left, catches right). It slides along the side and stacks.
   */
  satellite?: { anchorId: string; side: "left" | "right" };
}

export interface OptimizeWire {
  source: string;
  target: string;
  /** Fallback weight when no width is known. */
  weight?: number;
  /** The stroke the wire routes at, in px: sets its weight (wireWeight). */
  width?: number;
}

export interface OptimizeOptions {
  /** Air between stacked cards, in cells. */
  rowGapCells?: number;
  /** Air between stacked cards of different sections, in cells. */
  sectionGapCells?: number;
  /** Least corridor between columns, in cells. */
  columnGapCells?: number;
  /** Air between a satellite and its machine, in cells. */
  satellitePadCells?: number;
  /** Annealing trials; scales with the island by default. */
  trials?: number;
  /**
   * The judge of the finalists: given every card's top-left, the points the
   * board's real wires would score there (the host builds it on the board's
   * own route requests). `false` skips judging; absent, a stand-in routes
   * plain rim docks with the real router.
   */
  judge?: false | ((positions: ReadonlyMap<string, { x: number; y: number }>) => number);
  /** The router's prices; read from the tuning store when absent. */
  prices?: RouterTuning;
  /**
   * The air owed between strangers at these positions (board-arrange-air.ts),
   * added to the proxy score and to the finalists' judged points alike.
   */
  air?: (positions: ReadonlyMap<string, { x: number; y: number }>) => number;
  /** Where the search is, every few hundred trials, for a loader. */
  onProgress?: (done: number, total: number) => void;
}

export interface OptimizeResult {
  /** New top-lefts in px, same order as the input cards, normalised to 0,0. */
  positions: Array<{ x: number; y: number }>;
  /** Proxy score before and after. */
  before: number;
  after: number;
  /** Real points of the winner when the router judged, else undefined. */
  points?: number;
  /** What the judge saw: each finalist's proxy score, proxy crossings and real points. */
  finalists?: Array<{ score: number; proxyCrossings: number; points: number }>;
}

/** The router's prices, so the proxy and the judge speak one currency. */
export function routerPrices(): RouterTuning {
  try {
    return getRouterTuning();
  } catch {
    return DEFAULT_ROUTER_TUNING;
  }
}
/** Per pixel of the layout's bounding box perimeter: tidy is compact. */
const SPRAWL = 0.4;
const CLEAN = 2 * BOARD_GRID;
/**
 * Whether the search may hop cards between columns (within what flow allows,
 * see `mayStandIn`). Hops toward partners shorten long wires: longest-path
 * ranking spreads a board wide.
 */
const ALLOW_COLUMN_MOVES = true;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Path = Point[];

/** A tiny deterministic RNG (mulberry32). */
function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashIds(ids: string[]): number {
  let hash = 2166136261;
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x9e3779b9;
  }
  return hash >>> 0;
}

/**
 * The rim point of `rect` facing `other`, and the outward normal there. The
 * side is chosen by the gap between the two rectangles, not by the other
 * card's centre (a drawer beside a tall tower faces it across the gap even
 * though the tower's centre lies far below). With no clear gap axis it
 * falls back to the centre.
 */
function exitPoint(rect: Rect, other: Rect): { point: Point; nx: number; ny: number } {
  const to = centre(other);
  const clampX = Math.min(Math.max(to.x, rect.left + BOARD_GRID), rect.right - BOARD_GRID);
  const clampY = Math.min(Math.max(to.y, rect.top + BOARD_GRID), rect.bottom - BOARD_GRID);
  const gapX = Math.max(other.left - rect.right, rect.left - other.right, 0);
  const gapY = Math.max(other.top - rect.bottom, rect.top - other.bottom, 0);
  const vertical = gapY > gapX;
  if (vertical || (gapX === 0 && gapY === 0 && (to.y < rect.top || to.y > rect.bottom))) {
    if (to.y < rect.top) {
      return { point: { x: clampX, y: rect.top }, nx: 0, ny: -1 };
    }
    return { point: { x: clampX, y: rect.bottom }, nx: 0, ny: 1 };
  }
  if (to.x < rect.left) {
    return { point: { x: rect.left, y: clampY }, nx: -1, ny: 0 };
  }
  return { point: { x: rect.right, y: clampY }, nx: 1, ny: 0 };
}

function centre(rect: Rect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/** The proxy route: clean exit, shortest octilinear way, clean landing. */
export function proxyPath(source: Rect, target: Rect): Path {
  // Docking is free, so a wire leaves at the rim point facing its far end,
  // never at a fixed port row: pinning to port rows drew long zigzags where
  // the router draws a short straight wire, and misranked layouts.
  const exit = exitPoint(source, target);
  const entry = exitPoint(target, source);
  // Facing sides whose dock ranges overlap line up on one row (or column):
  // the router's straight shot. Aiming each end at the other's centre drew
  // a one-cell jog the router never draws.
  if (exit.nx !== 0 && exit.nx === -entry.nx) {
    const lo = Math.max(source.top, target.top) + BOARD_GRID;
    const hi = Math.min(source.bottom, target.bottom) - BOARD_GRID;
    if (lo <= hi) {
      const y = Math.min(Math.max(entry.point.y, lo), hi);
      exit.point.y = y;
      entry.point.y = y;
    }
  } else if (exit.ny !== 0 && exit.ny === -entry.ny) {
    const lo = Math.max(source.left, target.left) + BOARD_GRID;
    const hi = Math.min(source.right, target.right) - BOARD_GRID;
    if (lo <= hi) {
      const x = Math.min(Math.max(entry.point.x, lo), hi);
      exit.point.x = x;
      entry.point.x = x;
    }
  }
  // The clean runs reach out along the normals, but only as far as half the
  // room ahead: two cards a couple of cells apart meet in the middle of the
  // gap in a straight line, the way the router draws them, instead of each
  // stub overshooting the other card and coming back through it.
  const aheadOfExit =
    (entry.point.x - exit.point.x) * exit.nx + (entry.point.y - exit.point.y) * exit.ny;
  const aheadOfEntry =
    (exit.point.x - entry.point.x) * entry.nx + (exit.point.y - entry.point.y) * entry.ny;
  const stubA = Math.max(0, Math.min(CLEAN, aheadOfExit / 2));
  const stubB = Math.max(0, Math.min(CLEAN, aheadOfEntry / 2));
  const a = { x: exit.point.x + exit.nx * stubA, y: exit.point.y + exit.ny * stubA };
  const b = { x: entry.point.x + entry.nx * stubB, y: entry.point.y + entry.ny * stubB };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const path: Path = [exit.point, a];
  if (adx > ady) {
    const straight = (adx - ady) / 2;
    const sx = Math.sign(dx);
    const m1 = { x: a.x + sx * straight, y: a.y };
    const m2 = { x: m1.x + sx * ady, y: b.y };
    path.push(m1, m2);
  } else if (ady > adx) {
    const straight = (ady - adx) / 2;
    const sy = Math.sign(dy);
    const m1 = { x: a.x, y: a.y + sy * straight };
    const m2 = { x: b.x, y: m1.y + sy * adx };
    path.push(m1, m2);
  }
  path.push(b, entry.point);
  return path;
}

export function pathLength(path: Path): number {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return length;
}

/** Bends along a path at the router's prices: 45°, 90°, sharper as three 90°. */
export function pathBends(path: Path, prices: RouterTuning): number {
  let bends = 0;
  for (let i = 2; i < path.length; i += 1) {
    const ax = path[i - 1].x - path[i - 2].x;
    const ay = path[i - 1].y - path[i - 2].y;
    const bx = path[i].x - path[i - 1].x;
    const by = path[i].y - path[i - 1].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos > 0.99) continue;
    bends += cos > 0.5 ? prices.turn45 : cos > -0.5 ? prices.turn90 : 3 * prices.turn90;
  }
  return bends;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Proper crossings between two paths (touching ends do not count). */
export function pathCrossings(p: Path, q: Path): number {
  let count = 0;
  for (let i = 1; i < p.length; i += 1) {
    const a = p[i - 1];
    const b = p[i];
    if (a.x === b.x && a.y === b.y) continue;
    for (let j = 1; j < q.length; j += 1) {
      const c = q[j - 1];
      const d = q[j];
      if (c.x === d.x && c.y === d.y) continue;
      const d1 = cross(a, b, c);
      const d2 = cross(a, b, d);
      const d3 = cross(c, d, a);
      const d4 = cross(c, d, b);
      const eps = 0.5;
      if (
        ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
        ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Does the segment enter the open rectangle? (Liang-Barsky, inlined: it runs millions of times a search.) */
function segmentEnters(ax: number, ay: number, bx: number, by: number, left: number, top: number, right: number, bottom: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  // clip(-dx, ax - left)
  let p = -dx;
  let q = ax - left;
  if (Math.abs(p) < 1e-9) {
    if (!(q > 0)) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dx;
  q = right - ax;
  if (Math.abs(p) < 1e-9) {
    if (!(q > 0)) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = -dy;
  q = ay - top;
  if (Math.abs(p) < 1e-9) {
    if (!(q > 0)) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dy;
  q = bottom - ay;
  if (Math.abs(p) < 1e-9) {
    if (!(q > 0)) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > 1e-6;
}

/**
 * Estimated detour cost for every card (other than the path's own two) the
 * proxy path runs through: two 90-degree corners plus half the card's
 * shorter side plus the margins, per card.
 */
export function pathBlocked(path: Path, rects: Rect[], skipA: number, skipB: number, prices: RouterTuning): number {
  let cost = 0;
  // The path's own box: a card whose inflated box misses it cannot be run through.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < path.length; i += 1) {
    const pt = path[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  for (let r = 0; r < rects.length; r += 1) {
    if (r === skipA || r === skipB) continue;
    const rect = rects[r];
    const left = rect.left - BOARD_GRID;
    const top = rect.top - BOARD_GRID;
    const right = rect.right + BOARD_GRID;
    const bottom = rect.bottom + BOARD_GRID;
    if (maxX <= left || minX >= right || maxY <= top || minY >= bottom) continue;
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      if (segmentEnters(a.x, a.y, b.x, b.y, left, top, right, bottom)) {
        const shorter = Math.min(rect.right - rect.left, rect.bottom - rect.top);
        cost += 2 * prices.turn90 + shorter / 2 + 2 * BOARD_GRID;
        break;
      }
    }
  }
  return cost;
}

/** The layout state the search permutes. */
interface State {
  /** Card indices per column, top to bottom. Satellites are not here. */
  columns: number[][];
  /** Vertical offset of each column, in cells. */
  columnOffset: number[];
  /** Extra corridor before each column, in cells: how islands part sideways. */
  columnPad: number[];
  /** Extra air above each card, in cells. */
  padBefore: number[];
  /** Satellite: offset of its top from its anchor's top, in cells. */
  satelliteOffset: number[];
}

export function optimizeIslandLayout(
  cards: OptimizeCard[],
  wires: readonly OptimizeWire[],
  options: OptimizeOptions = {},
): OptimizeResult {
  const n = cards.length;
  const prices = options.prices ?? routerPrices();
  const air = options.air ?? (() => 0);
  const index = new Map<string, number>();
  cards.forEach((card, i) => index.set(card.id, i));
  const links: Array<{
    a: number;
    b: number;
    weight: number;
    width: number;
  }> = [];
  for (const wire of wires) {
    const a = index.get(wire.source);
    const b = index.get(wire.target);
    if (a === undefined || b === undefined || a === b) continue;
    links.push({
      a,
      b,
      // The router's own weight when the width is known; the caller's
      // scale (flow, log-compressed) otherwise.
      weight: wire.width !== undefined ? wireWeight(wire.width) : Math.max(wire.weight ?? 1, 0.01),
      width: wire.width ?? 6,
    });
  }
  const rowGap = (options.rowGapCells ?? 2) * BOARD_GRID;
  const sectionGap = (options.sectionGapCells ?? options.rowGapCells ?? 2) * BOARD_GRID;
  const columnGap = (options.columnGapCells ?? 3) * BOARD_GRID;
  const satellitePad = (options.satellitePadCells ?? 2) * BOARD_GRID;
  const snap = (value: number) => Math.round(value / BOARD_GRID) * BOARD_GRID;

  // Satellites hang off anchors; everything else lives in the columns.
  const anchorOf = new Int32Array(n).fill(-1);
  const satellitesOf = new Map<number, number[]>();
  cards.forEach((card, i) => {
    if (!card.satellite) return;
    const anchor = index.get(card.satellite.anchorId);
    if (anchor === undefined || cards[anchor].satellite) return;
    anchorOf[i] = anchor;
    const list = satellitesOf.get(anchor);
    if (list) list.push(i);
    else satellitesOf.set(anchor, [i]);
  });

  const layerCount = cards.reduce((max, card) => Math.max(max, card.layer), 0) + 1;
  const state: State = {
    columns: Array.from({ length: layerCount }, () => []),
    columnOffset: new Array(layerCount).fill(0),
    columnPad: new Array(layerCount).fill(0),
    padBefore: new Array(n).fill(0),
    satelliteOffset: new Array(n).fill(0),
  };
  cards.forEach((card, i) => {
    if (anchorOf[i] < 0) state.columns[card.layer].push(i);
  });
  for (const column of state.columns) {
    column.sort((a, b) => cards[a].seq - cards[b].seq || a - b);
  }
  // Satellites start stacked in seq order along their side.
  for (const [, sats] of satellitesOf) {
    sats.sort((a, b) => cards[a].seq - cards[b].seq || a - b);
    let offset = 0;
    for (const sat of sats) {
      state.satelliteOffset[sat] = offset;
      offset += Math.ceil(cards[sat].height / BOARD_GRID) + 1;
    }
  }

  /** Derives every card's top-left from the state. */
  const positions: Array<{ x: number; y: number }> = cards.map(() => ({ x: 0, y: 0 }));
  const rect: Rect[] = cards.map(() => ({ left: 0, top: 0, right: 0, bottom: 0 }));
  const place = () => {
    // Column widths include the satellites riding on either side.
    const leftPad = new Array(layerCount).fill(0);
    const rightPad = new Array(layerCount).fill(0);
    const widths = new Array(layerCount).fill(0);
    state.columns.forEach((column, layer) => {
      for (const i of column) {
        widths[layer] = Math.max(widths[layer], cards[i].width);
        for (const sat of satellitesOf.get(i) ?? []) {
          const need = cards[sat].width + satellitePad;
          if (cards[sat].satellite!.side === "left") leftPad[layer] = Math.max(leftPad[layer], need);
          else rightPad[layer] = Math.max(rightPad[layer], need);
        }
      }
    });
    let x = 0;
    const columnX: number[] = [];
    for (let layer = 0; layer < layerCount; layer += 1) {
      x += leftPad[layer] + state.columnPad[layer] * BOARD_GRID;
      columnX.push(x);
      x += widths[layer] + rightPad[layer] + columnGap;
    }
    state.columns.forEach((column, layer) => {
      let y = state.columnOffset[layer] * BOARD_GRID;
      let previous: number | undefined;
      for (const i of column) {
        if (previous !== undefined && cards[previous].section !== cards[i].section) {
          y += sectionGap - rowGap;
        }
        previous = i;
        y += state.padBefore[i] * BOARD_GRID;
        // A machine with satellites on a side needs room above for the
        // ones that ride higher than it.
        let rise = 0;
        for (const sat of satellitesOf.get(i) ?? []) {
          rise = Math.max(rise, -state.satelliteOffset[sat] * BOARD_GRID);
        }
        y += rise;
        positions[i].x = snap(columnX[layer] + (widths[layer] - cards[i].width) / 2);
        positions[i].y = snap(y);
        let bottom = y + cards[i].height;
        for (const sat of satellitesOf.get(i) ?? []) {
          const side = cards[sat].satellite!.side;
          positions[sat].x = snap(
            side === "left"
              ? positions[i].x - satellitePad - cards[sat].width
              : positions[i].x + cards[i].width + satellitePad,
          );
          positions[sat].y = snap(y + state.satelliteOffset[sat] * BOARD_GRID);
          bottom = Math.max(bottom, positions[sat].y + cards[sat].height);
        }
        y = bottom + rowGap;
      }
    });
    for (let i = 0; i < n; i += 1) {
      rect[i].left = positions[i].x;
      rect[i].top = positions[i].y;
      rect[i].right = positions[i].x + cards[i].width;
      rect[i].bottom = positions[i].y + cards[i].height;
    }
  };

  /** Satellites on one side must not overlap each other. */
  const satellitesLegal = (anchor: number): boolean => {
    const sats = satellitesOf.get(anchor) ?? [];
    for (let i = 0; i < sats.length; i += 1) {
      for (let k = i + 1; k < sats.length; k += 1) {
        const a = sats[i];
        const b = sats[k];
        if (cards[a].satellite!.side !== cards[b].satellite!.side) continue;
        const aTop = state.satelliteOffset[a];
        const aBottom = aTop + Math.ceil(cards[a].height / BOARD_GRID);
        const bTop = state.satelliteOffset[b];
        const bBottom = bTop + Math.ceil(cards[b].height / BOARD_GRID);
        if (aTop < bBottom + 1 && bTop < aBottom + 1) return false;
      }
    }
    return true;
  };

  // Scoring, incremental: paths, lengths, bends, blocks and the pairwise
  // crossing matrix are kept, and a trial re-scores only what its moved
  // cards touched. The stranger and sprawl terms are cheap and global.
  const paths: Path[] = links.map(() => []);
  const linksOf: number[][] = cards.map(() => []);
  links.forEach((link, l) => {
    linksOf[link.a].push(l);
    linksOf[link.b].push(l);
  });
  const lengthOf = new Float64Array(links.length);
  const bendsOf = new Float64Array(links.length);
  const blockedOf = new Float64Array(links.length);
  const pairCross = new Uint8Array(links.length * links.length);
  let lastProxyCrossings = 0;
  const previous: Array<{ x: number; y: number }> = cards.map(() => ({ x: NaN, y: NaN }));
  const scoreLink = (l: number) => {
    const link = links[l];
    paths[l] = proxyPath(rect[link.a], rect[link.b]);
    lengthOf[l] = pathLength(paths[l]) * link.weight;
    bendsOf[l] = pathBends(paths[l], prices) * link.weight;
    blockedOf[l] = pathBlocked(paths[l], rect, link.a, link.b, prices) * link.weight;
  };
  const crossRow = (l: number) => {
    for (let m = 0; m < links.length; m += 1) {
      if (m === l) continue;
      const c = pathCrossings(paths[l], paths[m]);
      pairCross[l * links.length + m] = c;
      pairCross[m * links.length + l] = c;
    }
  };
  const globalTerms = (): number => {
    let sum = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      minX = Math.min(minX, rect[i].left);
      minY = Math.min(minY, rect[i].top);
      maxX = Math.max(maxX, rect[i].right);
      maxY = Math.max(maxY, rect[i].bottom);
    }
    sum += (maxX - minX + (maxY - minY)) * SPRAWL;
    // The air owed between strangers: what makes islands (board-arrange-air.ts).
    sum += air(positionMap());
    return sum;
  };
  const positionMap = (): Map<string, { x: number; y: number }> =>
    new Map(cards.map((card, i) => [card.id, positions[i]]));
  const total = (): number => {
    let sum = globalTerms();
    let crossings = 0;
    for (let l = 0; l < links.length; l += 1) {
      sum += lengthOf[l] + bendsOf[l] + blockedOf[l];
      for (let m = l + 1; m < links.length; m += 1) {
        const count = pairCross[l * links.length + m];
        if (count === 0) continue;
        crossings += count;
        // A crossing weighs the heavier of its two wires, as in the points.
        sum += count * prices.crossing * Math.max(links[l].weight, links[m].weight);
      }
    }
    lastProxyCrossings = crossings;
    return sum;
  };
  /** Scores the current state; only what moved since the last call is redone. */
  const score = (): number => {
    place();
    const moved: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (positions[i].x !== previous[i].x || positions[i].y !== previous[i].y) {
        moved.push(i);
        previous[i].x = positions[i].x;
        previous[i].y = positions[i].y;
      }
    }
    if (moved.length === 0) {
      return total();
    }
    const touched = new Set<number>();
    for (const i of moved) {
      for (const l of linksOf[i]) touched.add(l);
    }
    for (const l of touched) {
      scoreLink(l);
    }
    for (const l of touched) {
      crossRow(l);
    }
    // A moved card may block, or unblock, wires that never touch it.
    if (moved.length < n) {
      for (let l = 0; l < links.length; l += 1) {
        if (!touched.has(l)) {
          blockedOf[l] = pathBlocked(paths[l], rect, links[l].a, links[l].b, prices) * links[l].weight;
        }
      }
    }
    return total();
  };

  const snapshot = (): State => ({
    columns: state.columns.map((column) => [...column]),
    columnOffset: [...state.columnOffset],
    columnPad: [...state.columnPad],
    padBefore: [...state.padBefore],
    satelliteOffset: [...state.satelliteOffset],
  });
  const restore = (saved: State) => {
    state.columns = saved.columns.map((column) => [...column]);
    state.columnOffset = [...saved.columnOffset];
    state.columnPad = [...saved.columnPad];
    state.padBefore = [...saved.padBefore];
    state.satelliteOffset = [...saved.satelliteOffset];
  };

  const normalise = (places: Array<{ x: number; y: number }>) => {
    let minX = Infinity;
    let minY = Infinity;
    for (const p of places) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
    return places.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  };

  let current = score();
  const before = current;
  if (n < 2 || links.length === 0) {
    return { positions: normalise(positions), before, after: before };
  }
  let best = current;
  let bestState = snapshot();
  // Finalists are STRUCTURALLY distinct: one per column arrangement (which
  // card stands in which column, in what order), the best-scoring state
  // of each. Six near-copies of one layout differing by a nudge told the
  // router nothing; six different layouts give it a real choice.
  const structure = (): string => state.columns.map((column) => column.join(",")).join("|");
  const candidates: Array<{ score: number; state: State; key: string }> = [
    { score: current, state: snapshot(), key: structure() },
  ];
  const remember = (value: number) => {
    const key = structure();
    const known = candidates.find((c) => c.key === key);
    if (known) {
      if (value < known.score - 1e-9) {
        known.score = value;
        known.state = snapshot();
        candidates.sort((a, b) => a.score - b.score);
      }
      return;
    }
    candidates.push({ score: value, state: snapshot(), key });
    candidates.sort((a, b) => a.score - b.score);
    if (candidates.length > Math.max(1, prices.finalists)) candidates.pop();
  };

  const random = rng(hashIds(cards.map((card) => card.id)));
  const trials = options.trials ?? Math.min(prices.searchTrials, 600 * n + 3000);
  // Starts at half the ROUTER's crossing price, not the arrange's dearer one: the search's
  // reach was tuned there, and a hotter start wanders off good layouts it had found.
  const startTemperature = DEFAULT_ROUTER_TUNING.crossing / 2;
  const endTemperature = 4;
  const columnCards = state.columns.flat();
  if (columnCards.length === 0) {
    return { positions: normalise(positions), before, after: before };
  }
  /** Which column a card (or, for a satellite, its anchor) stands in now. */
  const layerOfCard = (i: number): number | undefined => {
    const who = anchorOf[i] >= 0 ? anchorOf[i] : i;
    for (let layer = 0; layer < layerCount; layer += 1) {
      if (state.columns[layer].includes(who)) return layer;
    }
    return undefined;
  };

  /**
   * May `card`, standing in `from`, stand in column `to`? A machine keeps
   * flow reading left to right: every feeder in an earlier column, every
   * taker in a later one (a wire already running backwards does not
   * constrain). A DRAWER may stand anywhere between its first and last
   * partner's column, inclusive, so it can sit between two machines stacked
   * in one column.
   */
  const mayStandIn = (card: number, from: number, to: number): boolean => {
    if (cards[card].role === "storage") {
      let lo = Infinity;
      let hi = -Infinity;
      for (const l of linksOf[card]) {
        const link = links[l];
        const other = link.a === card ? link.b : link.a;
        const otherLayer = layerOfCard(other);
        if (otherLayer === undefined) continue;
        lo = Math.min(lo, otherLayer);
        hi = Math.max(hi, otherLayer);
      }
      return lo === Infinity || (to >= lo && to <= hi);
    }
    for (const l of linksOf[card]) {
      const link = links[l];
      const other = link.a === card ? link.b : link.a;
      const otherLayer = layerOfCard(other);
      if (otherLayer === undefined) continue;
      // A machine may share a column with a drawer it trades with but never
      // pass beyond it; it may not even draw level with a partner machine.
      const reach = cards[other].role === "storage" ? 0 : 1;
      if (link.a === card) {
        if (otherLayer > from && otherLayer < to + reach) return false;
      } else if (otherLayer < from && otherLayer > to - reach) {
        return false;
      }
    }
    return true;
  };
  const columnOfCard = (card: number): number => {
    for (let layer = 0; layer < layerCount; layer += 1) {
      if (state.columns[layer].includes(card)) return layer;
    }
    return -1;
  };

  for (let trial = 0; trial < trials; trial += 1) {
    if (options.onProgress && trial % 250 === 0) {
      options.onProgress(trial, trials);
    }
    const temperature =
      startTemperature * Math.pow(endTemperature / startTemperature, trial / trials);
    const saved = snapshot();
    const kind = random();
    let legal = true;
    if (kind < 0.25) {
      // Swap two cards in one column.
      const layer = Math.floor(random() * layerCount);
      const column = state.columns[layer];
      if (column.length < 2) continue;
      const i = Math.floor(random() * column.length);
      let k = Math.floor(random() * column.length);
      if (k === i) k = (i + 1) % column.length;
      const tmp = column[i];
      column[i] = column[k];
      column[k] = tmp;
    } else if (kind < 0.4 && ALLOW_COLUMN_MOVES) {
      // Move a card into any column flow allows.
      const layer = Math.floor(random() * layerCount);
      const column = state.columns[layer];
      if (column.length === 0) continue;
      const i = Math.floor(random() * column.length);
      const to = Math.floor(random() * layerCount);
      if (to === layer) continue;
      const card = column[i];
      if (!mayStandIn(card, layer, to)) continue;
      column.splice(i, 1);
      const target = state.columns[to];
      const at = Math.floor(random() * (target.length + 1));
      target.splice(at, 0, card);
    } else if (kind < 0.5) {
      // Set a card down beside one of its partners: the partner's column,
      // right above or below it.
      const card = columnCards[Math.floor(random() * columnCards.length)];
      const own = linksOf[card];
      if (own.length === 0) continue;
      const link = links[own[Math.floor(random() * own.length)]];
      const partner = link.a === card ? link.b : link.a;
      const who = anchorOf[partner] >= 0 ? anchorOf[partner] : partner;
      if (who === card) continue;
      const from = columnOfCard(card);
      const to = columnOfCard(who);
      if (from < 0 || to < 0) continue;
      if (to !== from && !mayStandIn(card, from, to)) continue;
      state.columns[from].splice(state.columns[from].indexOf(card), 1);
      const target = state.columns[to];
      const at = target.indexOf(who) + (random() < 0.5 ? 0 : 1);
      target.splice(at, 0, card);
    } else if (kind < 0.62) {
      // Nudge a column up or down.
      const layer = Math.floor(random() * layerCount);
      const reach = 1 + Math.floor(random() * 6);
      state.columnOffset[layer] += random() < 0.5 ? -reach : reach;
    } else if (kind < 0.7) {
      // Widen or narrow the corridor before a column: islands part sideways.
      const layer = Math.floor(random() * layerCount);
      const reach = 1 + Math.floor(random() * 4);
      state.columnPad[layer] = Math.max(0, state.columnPad[layer] + (random() < 0.5 ? -reach : reach));
    } else if (kind < 0.76) {
      // Shift a card AND its direct partners down (or up) together: a
      // cluster moves as one instead of one card at a time.
      const card = columnCards[Math.floor(random() * columnCards.length)];
      const group = new Set<number>([card]);
      for (const l of linksOf[card]) {
        const link = links[l];
        const other = link.a === card ? link.b : link.a;
        group.add(anchorOf[other] >= 0 ? anchorOf[other] : other);
      }
      const step = (1 + Math.floor(random() * 4)) * (random() < 0.5 ? -1 : 1);
      for (const member of group) {
        if (anchorOf[member] >= 0) continue;
        state.padBefore[member] = Math.max(0, state.padBefore[member] + step);
      }
    } else if (kind < 0.88) {
      // More or less air above a card.
      const i = columnCards[Math.floor(random() * columnCards.length)];
      const reach = 1 + Math.floor(random() * 4);
      state.padBefore[i] = Math.max(0, state.padBefore[i] + (random() < 0.5 ? -reach : reach));
    } else {
      // Slide a satellite along its machine's side.
      const sats = cards.map((_, i) => i).filter((i) => anchorOf[i] >= 0);
      if (sats.length === 0) continue;
      const sat = sats[Math.floor(random() * sats.length)];
      const anchor = anchorOf[sat];
      const reach = 1 + Math.floor(random() * 4);
      const limit = Math.ceil(cards[anchor].height / BOARD_GRID);
      state.satelliteOffset[sat] = Math.max(
        -2,
        Math.min(limit, state.satelliteOffset[sat] + (random() < 0.5 ? -reach : reach)),
      );
      legal = satellitesLegal(anchor);
    }
    if (!legal) {
      restore(saved);
      continue;
    }
    const next = score();
    const delta = next - current;
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      current = next;
      if (current < best - 1e-9) {
        best = current;
        bestState = snapshot();
      }
      remember(current);
    } else {
      restore(saved);
    }
  }

  // The finisher: from the best state, every single-step move that helps
  // is taken until none does. Annealing gets close; this lands it, and it
  // is what makes tight spacing come out tight every time.
  restore(bestState);
  current = score();
  const polish = () => {
    for (let round = 0; round < 40; round += 1) {
      let improved = false;
      const attempt = (apply: () => boolean) => {
        const saved = snapshot();
        if (!apply()) {
          restore(saved);
          return;
        }
        const next = score();
        if (next < current - 1e-9) {
          current = next;
          improved = true;
        } else {
          restore(saved);
        }
      };
      for (let layer = 0; layer < layerCount; layer += 1) {
        for (const step of [-1, 1, -2, 2, -4, 4]) {
          attempt(() => {
            state.columnOffset[layer] += step;
            return true;
          });
          attempt(() => {
            const next = state.columnPad[layer] + step;
            if (next < 0) return false;
            state.columnPad[layer] = next;
            return true;
          });
        }
        const column = state.columns[layer];
        for (let i = 0; i + 1 < column.length; i += 1) {
          attempt(() => {
            const tmp = column[i];
            column[i] = column[i + 1];
            column[i + 1] = tmp;
            return true;
          });
        }
      }
      for (const i of columnCards) {
        for (const step of [-1, 1, -2, 2, -4, 4]) {
          attempt(() => {
            const next = state.padBefore[i] + step;
            if (next < 0) return false;
            state.padBefore[i] = next;
            return true;
          });
        }
      }
      for (let i = 0; i < n; i += 1) {
        if (anchorOf[i] < 0) continue;
        for (const step of [-1, 1, -2, 2]) {
          attempt(() => {
            state.satelliteOffset[i] += step;
            return satellitesLegal(anchorOf[i]);
          });
        }
      }
      if (!improved) break;
    }
  };
  polish();
  if (current < best - 1e-9) {
    best = current;
    bestState = snapshot();
    remember(current);
  }

  // The router judges the finalists: fewest real points wins.
  let winner = bestState;
  let points: number | undefined;
  const finalists: OptimizeResult["finalists"] = [];
  if (options.judge !== false && links.length <= 120) {
    let bestReal = Infinity;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      restore(candidate.state);
      score();
      const real =
        typeof options.judge === "function"
          ? options.judge(new Map(cards.map((card, i) => [card.id, { ...positions[i] }])))
          : judgeWithRouter(cards, links, positions, prices) + air(positionMap());
      finalists.push({ score: candidate.score, proxyCrossings: lastProxyCrossings, points: real });
      if (real < bestReal || (real === bestReal && candidate.score < bestScore)) {
        bestReal = real;
        bestScore = candidate.score;
        winner = candidate.state;
      }
    }
    points = bestReal;
  }
  restore(winner);
  place();
  return { positions: normalise(positions), before, after: best, points, finalists };
}

/**
 * The proxy score of a finished layout - the same wire terms the search
 * uses, plus the air - for choosing between layouts when no router judge
 * is at hand.
 */
export function scoreLayoutProxy(
  cards: ReadonlyArray<{ id: string; width: number; height: number }>,
  wires: readonly OptimizeWire[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  prices: RouterTuning,
  air?: (positions: ReadonlyMap<string, { x: number; y: number }>) => number,
): number {
  const index = new Map<string, number>();
  cards.forEach((card, i) => index.set(card.id, i));
  const rects: Rect[] = cards.map((card) => {
    const p = positions.get(card.id) ?? { x: 0, y: 0 };
    return { left: p.x, top: p.y, right: p.x + card.width, bottom: p.y + card.height };
  });
  const paths: Path[] = [];
  const weights: number[] = [];
  let sum = 0;
  for (const wire of wires) {
    const a = index.get(wire.source);
    const b = index.get(wire.target);
    if (a === undefined || b === undefined || a === b) continue;
    const path = proxyPath(rects[a], rects[b]);
    const weight = wire.width !== undefined ? wireWeight(wire.width) : Math.max(wire.weight ?? 1, 0.01);
    paths.push(path);
    weights.push(weight);
    sum += (pathLength(path) + pathBends(path, prices) + pathBlocked(path, rects, a, b, prices)) * weight;
  }
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      sum += pathCrossings(paths[i], paths[j]) * prices.crossing * Math.max(weights[i], weights[j]);
    }
  }
  return sum + (air?.(positions) ?? 0);
}

/** Rim docks the way the board offers them in free-dock mode. */
function rim(rect: Rect): GridEndpoint[] {
  const out: GridEndpoint[] = [];
  const keepOut = (span: number) => (span >= 2 * BOARD_GRID ? BOARD_GRID : 0);
  const kx = keepOut(rect.right - rect.left);
  const ky = keepOut(rect.bottom - rect.top);
  for (let x = rect.left + kx; x <= rect.right - kx; x += BOARD_GRID) {
    out.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" });
  }
  for (let y = rect.top + ky; y <= rect.bottom - ky; y += BOARD_GRID) {
    out.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" });
  }
  return out;
}

/** Runs the real router over a candidate and scores its points. */
function judgeWithRouter(
  cards: OptimizeCard[],
  links: Array<{ a: number; b: number; width: number }>,
  positions: Array<{ x: number; y: number }>,
  prices: RouterTuning,
): number {
  const obstacles: GridObstacle[] = cards.map((card, i) => ({
    id: card.id,
    left: positions[i].x,
    top: positions[i].y,
    right: positions[i].x + card.width,
    bottom: positions[i].y + card.height,
  }));
  const requests: GridRouteRequest[] = links.map((link, i) => ({
    edgeId: `w${i}`,
    order: i,
    sources: rim(obstacles[link.a]),
    targets: rim(obstacles[link.b]),
    sourceCardId: cards[link.a].id,
    targetCardId: cards[link.b].id,
    strokeWidth: link.width,
  }));
  const solved = solveGridRoutes(obstacles, requests, undefined, prices);
  return routePoints(measureWireRoutes(solved.values()), prices);
}
