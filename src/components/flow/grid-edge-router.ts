/**
 * The grid edge router.
 *
 * Wires live on the cards' 20px grid (`board-grid.ts`): every straight run
 * travels along a grid line (horizontal, vertical, or a 45° diagonal through
 * the vertices) and stays at least one cell from every card. The only
 * exception is the port stub, the last hop from the card's margin to the port.
 *
 * A grid line is a LANE with a usable width (16px orthogonal, 10px diagonal).
 * Wires are fractions of a lane; wires that fit side by side SHARE it, packed
 * around the centre with a 2px gap. A full lane costs heavily, so overlap is
 * never chosen while a separated path exists. Only port stubs may stack.
 *
 * The wires are solved together: docks are planned per card first
 * (`planDocks`), every crossing of an earlier wire costs (`T.crossing`), and
 * wires that still cross are ripped up and rerouted with contested spots
 * dearer each round (negotiation). See `solveGridRoutes`.
 *
 * Everything here is a pure function of its inputs: flow-space geometry in,
 * polylines out. No DOM, no React, no viewport - the same inputs give the
 * same routes at every zoom, which is the routing invariant src/components/flow/CLAUDE.md
 * demands. The host feeds it published geometry and caches the result by
 * content fingerprint.
 */

import { BOARD_GRID } from "@/lib/board-grid";
import { measureWireRoutes, routePoints } from "@/lib/route-metrics";
import { DEFAULT_ROUTER_TUNING, type RouterTuning } from "./router-tuning";

/** One cell of clearance between any wire run and any card. */
export const WIRE_NODE_MARGIN = BOARD_GRID;

/** Usable stroke pixels inside one orthogonal lane; the rest is daylight. */
export const LANE_CAPACITY = 16;

/** Breathing room between two wires sharing a lane. */
export const LANE_GAP = 2;

/**
 * The widths wires may draw at, as fractions of a lane. The floor is ¼ (4px):
 * anything thinner reads as a scratch. Eight steps keep the resolution of the
 * heat scale (rank blended with log magnitude, so 5k vs 10k stays visible
 * beside 100k).
 */
export const LANE_FRACTIONS = [
  1 / 4,
  5 / 16,
  3 / 8,
  7 / 16,
  1 / 2,
  5 / 8,
  3 / 4,
  1,
] as const;

/**
 * Normalized flow heat (0..1) → stroke width. Heat maps onto the menu by
 * INDEX, so every step gets an equal slice of the scale; thresholding by
 * fraction value would cluster most of the range onto the widest steps.
 */
export function laneWidthForHeat(heat: number): number {
  const clamped = Math.min(Math.max(heat, 0), 1);
  const fraction = LANE_FRACTIONS[Math.round(clamped * (LANE_FRACTIONS.length - 1))];
  return Math.round(fraction * LANE_CAPACITY * 100) / 100;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridObstacle {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type GridSide = "left" | "right" | "top" | "bottom";

/**
 * One place a wire may start or end: the true anchor (on the card border, or
 * a few pixels inside at a coupling) plus which side of the card it faces.
 */
export interface GridEndpoint {
  x: number;
  y: number;
  side: GridSide;
  /**
   * Extra cost for choosing this dock, in pixel-equivalents. The router
   * plans docks itself when it knows which card an end belongs to
   * (`planDocks`); this is the host's own preference otherwise.
   */
  penalty?: number;
  /**
   * How much further INTO the card the drawn wire continues past the routing
   * anchor, along the side's inward normal. The recipe card's machine tab zone
   * is part of the routed box, but its top edge is phantom (the painted window
   * starts lower). Routing math stays on the anchor; only the drawn stub
   * crosses the zone to reach the card's true edge.
   */
  stubDepth?: number;
}

export interface GridRouteRequest {
  edgeId: string;
  /** Deterministic tiebreak between wires the solve order cannot separate. */
  order: number;
  /** Candidate endpoints; the router picks the pair that routes cheapest. */
  sources: GridEndpoint[];
  targets: GridEndpoint[];
  /**
   * Which card each end belongs to. With these the router plans docks per
   * card before routing (`planDocks`), so siblings leave in bearing order and
   * never cross at the card. Without them the endpoints' own `penalty` is the
   * only dock preference.
   */
  sourceCardId?: string;
  targetCardId?: string;
  /** Stroke this wire draws at, in px. Must be ≤ LANE_CAPACITY. */
  strokeWidth: number;
  /**
   * User-pinned stops, in order: the wire routes source → each waypoint →
   * target. Unreachable stops (dragged inside a card's margin) make the
   * route fall back to ignoring them rather than failing.
   */
  waypoints?: GridPoint[];
  /**
   * Obstacles THIS wire is allowed to pass through: the open board frames
   * its endpoints live inside. A wire into a board member has to cross that
   * board's border somewhere, so the frame cannot block it - while every
   * frame the wire has no business in stays as solid as a card.
   */
  exemptObstacleIds?: readonly string[];
  /**
   * The frames holding BOTH of this wire's ends - the rooms it lives in.
   * A wire between two cards on the same board has no business leaving it,
   * so wandering outside these costs (`T.costOutsideHome`), while the
   * frames it is only passing OUT of charge for loitering instead. Always
   * a subset of `exemptObstacleIds`.
   */
  homeObstacleIds?: readonly string[];
}

export interface GridRoutedEdge {
  edgeId: string;
  points: GridPoint[];
  /** The stroke the wire was routed at, in px: its weight in the points. */
  width?: number;
  /**
   * The route's vertex chain in cells and the docks it took: enough to
   * PIN it into a later solve (`solveGridRoutes`'s `pinned`) exactly as
   * it was, so a judge can re-solve only the wires a moved card touched.
   * Absent on a fallback L.
   */
  vertices?: GridPoint[];
  source?: GridEndpoint;
  target?: GridEndpoint;
}

/** A route to hold still in a solve: its request and the route it had. */
export interface PinnedRoute {
  request: GridRouteRequest;
  route: GridRoutedEdge;
}

/** What a solve did, for tests and benches. Filled when passed in. */
export interface GridSolveStats {
  /** Wire crossings on the finished board, as the router counts them. */
  crossings: number;
  /** Wires the negotiation ripped up and routed again. */
  rerouted: number;
  /** Wires that got the boxed-in L instead of a legal route. */
  fallbacks: number;
  /** Search work: A* pops, steps priced, window searches run. */
  pops?: number;
  priced?: number;
  searches?: number;
  /** Time spent in the first pass and in negotiation, ms. */
  firstPassMs?: number;
  negotiationMs?: number;
  /** Per wire: the crossings the router counts against it, and its dock plan. */
  perEdge?: Record<string, { crossings: number; overflowed: boolean; fallback: boolean }>;
}

/** Search-work counters, reset per solve; read into the stats at the end. */
let workPops = 0;
let workPriced = 0;
let workSearches = 0;

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every cost and limit comes from a `RouterTuning` (router-tuning.ts):
 * `DEFAULT_ROUTER_TUNING` ships, the dev menu edits it live, and the worker
 * gets the same object. Costs are in PIXELS of travel on an empty lane, so
 * "a 90° corner costs 80" means a wire will go 80px out of its way to avoid
 * one. The rules the numbers encode:
 *
 * - Sharing a lane costs a little MORE than an empty one, so wires form
 *   ribbons a lane apart; a full lane costs a lot, so overlap is never
 *   chosen while a detour exists.
 * - A 45° bend is well under a 90° corner, so corners get cut diagonally
 *   when there is room; a reversal is dear and only waypoint excursions pay it.
 * - A wire leaves and lands straight for `cleanCells` cells; bending inside
 *   that run costs `earlyTurn` on top of the turn.
 * - A crossing costs more than a couple of turns, and negotiation makes
 *   contested spots dearer each round.
 * - Docks are planned per card; leaving the plan costs per pixel of rim.
 *
 * Solves are synchronous and never nested, so the active tuning lives in
 * module scope for the duration of one solve, like the pools do.
 */
let T: RouterTuning = DEFAULT_ROUTER_TUNING;

/** A* gives up after this many pops, or two per state, whichever is larger. */
const MIN_ASTAR_POPS = 40_000;
const ASTAR_POPS_PER_STATE = 2;
/** The search window grows by this when a wire cannot route inside it. */
const WINDOW_GROWTH = 2.5;
/** Heuristic weight of the wide rung (see routeWithinWindow). 1: plain A*. */
const BOARD_RUNG_WEIGHT = 1;
/**
 * Search work the solve may spend, in A* pops per wire on the board. The
 * first pass may take the wide rung only while under half of it; the
 * negotiation runs while under all of it. Past that the board keeps what
 * it has: a busy board's last few crossings are not worth seconds.
 * Deterministic, unlike a clock.
 */
const NEGOTIATION_POPS_PER_WIRE = 40_000;

/* ------------------------------------------------------------------ */
/* Directions                                                          */
/* ------------------------------------------------------------------ */

/** The eight directions, clockwise from east (screen y points down). */
const DIR_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const DIR_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIR_E = 0;
const DIR_S = 2;
const DIR_W = 4;
const DIR_N = 6;
/** Axis of each direction: 0 h, 1 v, 2 falling diagonal (x-y), 3 rising (x+y). */
const DIR_AXIS = [0, 2, 1, 3, 0, 2, 1, 3] as const;
type Axis = 0 | 1 | 2 | 3;
/** Length of a step in each direction, in px; rebuilt per solve from the tuning. */
const DIR_LENGTH = new Float64Array(8);
/** Cost of turning from one direction to another; NaN forbids the turn. Per solve. */
const TURN_COSTS = new Float64Array(64);
let DIAGONAL_LENGTH = BOARD_GRID * Math.SQRT2;

function applyTuning(tuning: RouterTuning) {
  T = tuning;
  DIAGONAL_LENGTH = BOARD_GRID * tuning.diagonalLength;
  for (let dir = 0; dir < 8; dir += 1) {
    DIR_LENGTH[dir] = (dir & 1) === 1 ? DIAGONAL_LENGTH : BOARD_GRID;
  }
  for (let from = 0; from < 8; from += 1) {
    for (let to = 0; to < 8; to += 1) {
      const diff = (to - from + 8) % 8;
      TURN_COSTS[from * 8 + to] =
        diff === 0
          ? 0
          : diff === 1 || diff === 7
            ? tuning.turn45
            : diff === 2 || diff === 6
              ? tuning.turn90
              : diff === 4
                ? tuning.reverse
                : Number.NaN;
    }
  }
}

function outwardDirection(side: GridSide): number {
  switch (side) {
    case "left":
      return DIR_W;
    case "right":
      return DIR_E;
    case "top":
      return DIR_N;
    case "bottom":
      return DIR_S;
  }
}

/* ------------------------------------------------------------------ */
/* Pooled search state                                                 */
/* ------------------------------------------------------------------ */

/**
 * Pooled A* state, shared by every leg of every edge of every solve. The
 * pool reuses one set of arrays and skips the memset entirely with
 * generation stamps: a state whose stamp is not this leg's generation has
 * not been written yet, and its first access initialises it. Solves are
 * synchronous and never nested, so module scope is safe.
 */
let searchPoolCapacity = 0;
let searchPoolGeneration = 0;
let searchPoolStamp = new Int32Array(0);
let searchPoolG = new Float64Array(0);
let searchPoolCameFrom = new Int32Array(0);
let searchPoolStartOf = new Int32Array(0);
let searchHeapF = new Float64Array(0);
let searchHeapG = new Float64Array(0);
let searchHeapState = new Int32Array(0);
let searchHeapSeq = new Int32Array(0);

function acquireSearchGeneration(stateCount: number): number {
  if (stateCount > searchPoolCapacity) {
    searchPoolCapacity = Math.max(stateCount, searchPoolCapacity * 2, 4096);
    searchPoolStamp = new Int32Array(searchPoolCapacity);
    searchPoolG = new Float64Array(searchPoolCapacity);
    searchPoolCameFrom = new Int32Array(searchPoolCapacity);
    searchPoolStartOf = new Int32Array(searchPoolCapacity);
    searchPoolGeneration = 0;
  }
  searchPoolGeneration += 1;
  if (searchPoolGeneration >= 0x7ffffffe) {
    searchPoolStamp.fill(0);
    searchPoolGeneration = 1;
  }
  return searchPoolGeneration;
}

function ensureSearchHeapCapacity(size: number) {
  if (size <= searchHeapF.length) {
    return;
  }
  const capacity = Math.max(size, searchHeapF.length * 2, 1024);
  const nextF = new Float64Array(capacity);
  const nextG = new Float64Array(capacity);
  const nextState = new Int32Array(capacity);
  const nextSeq = new Int32Array(capacity);
  nextF.set(searchHeapF);
  nextG.set(searchHeapG);
  nextState.set(searchHeapState);
  nextSeq.set(searchHeapSeq);
  searchHeapF = nextF;
  searchHeapG = nextG;
  searchHeapState = nextState;
  searchHeapSeq = nextSeq;
}

/**
 * The step-cost memo, pooled the same way. A STEP is the hop between two
 * neighbouring grid vertices, and its cost (blocked, or length x lane
 * factor x frame penalty, plus crossings) depends on nothing that changes
 * while one wire is being routed: occupancy is claimed only after the final
 * leg. So each step is priced once per routing attempt, and every leg,
 * direction and revisit reads the price back. Steps are undirected and
 * keyed by their lower vertex: four per vertex (E, SE, S, SW).
 */
let stepPoolCapacity = 0;
let stepPoolGeneration = 0;
let stepPoolStamp = new Int32Array(0);
let stepPoolCost = new Float64Array(0);

function acquireStepGeneration(stepCount: number): number {
  if (stepCount > stepPoolCapacity) {
    stepPoolCapacity = Math.max(stepCount, stepPoolCapacity * 2, 4096);
    stepPoolStamp = new Int32Array(stepPoolCapacity);
    stepPoolCost = new Float64Array(stepPoolCapacity);
    stepPoolGeneration = 0;
  }
  stepPoolGeneration += 1;
  if (stepPoolGeneration >= 0x7ffffffe) {
    stepPoolStamp.fill(0);
    stepPoolGeneration = 1;
  }
  return stepPoolGeneration;
}

/** A step is blocked: it enters a card's margin or cuts a corner. */
const STEP_BLOCKED = -1;

/** The reachability flood's visited stamps and queue, pooled per vertex. */
let floodPoolCapacity = 0;
let floodPoolGeneration = 0;
let floodPoolStamp = new Int32Array(0);
let floodPoolQueue = new Int32Array(0);

function acquireFloodGeneration(vertexCount: number): number {
  if (vertexCount > floodPoolCapacity) {
    floodPoolCapacity = Math.max(vertexCount, floodPoolCapacity * 2, 4096);
    floodPoolStamp = new Int32Array(floodPoolCapacity);
    floodPoolQueue = new Int32Array(floodPoolCapacity);
    floodPoolGeneration = 0;
  }
  floodPoolGeneration += 1;
  if (floodPoolGeneration >= 0x7ffffffe) {
    floodPoolStamp.fill(0);
    floodPoolGeneration = 1;
  }
  return floodPoolGeneration;
}

/** Per-vertex flags for the window, pooled: blocked, in an exempt frame, in a home frame. */
let cellPoolCapacity = 0;
let cellBlocked = new Uint8Array(0);
let cellExempt = new Uint8Array(0);
let cellHome = new Uint8Array(0);

function ensureCellPool(vertexCount: number) {
  if (vertexCount > cellPoolCapacity) {
    cellPoolCapacity = Math.max(vertexCount, cellPoolCapacity * 2, 4096);
    cellBlocked = new Uint8Array(cellPoolCapacity);
    cellExempt = new Uint8Array(cellPoolCapacity);
    cellHome = new Uint8Array(cellPoolCapacity);
  }
}

/**
 * routeWithinWindow's answer when no path exists AND no larger window could
 * hold one: an end is walled in by the cards around it (a drawer packed
 * against its neighbours, a card wedged into a corner). Growing the window
 * adds cells only OUTSIDE the current one, so a region the flood could not
 * walk to the current border from is sealed at every size.
 */
const SEALED = "sealed";

/* ------------------------------------------------------------------ */
/* Occupancy: who is already riding which stretch of which line        */
/* ------------------------------------------------------------------ */

interface LaneClaim {
  lo: number;
  hi: number;
}

const KEY_OFFSET = 1 << 20;
const KEY_SPAN = 1 << 21;
/** The packed vertex word: four 6-bit passer counts by axis, then 4 bits of history. */
const PASSER_BITS = 6;
const PASSER_MASK = (1 << PASSER_BITS) - 1;
const HISTORY_SHIFT = 4 * PASSER_BITS;
const HISTORY_MASK = 15;

interface ClaimedRun {
  axis: Axis;
  /** Vertex coordinates in cells, first and last vertex of the run. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Lane claims are tracked per VERTEX of a line (each 20px stretch), because
 * two wires can share a line for part of its length and part company
 * later - capacity is a property of a stretch, not of the whole line.
 * Passers are tracked per vertex (and per cell centre for the diagonals,
 * which cross each other between vertices) so a step can ask how many
 * wires it would cross. Everything a wire holds is remembered against it
 * so it can be ripped up for a reroute.
 */
/** The board's extent in cells: what the dense occupancy arrays cover. */
interface CellBounds {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

/** The direction a passer axis runs in, for the corner test. */
const CORNER_AXIS_DIRECTION = [0, 2, 1, 3] as const;

class LaneOccupancy {
  private cells = new Map<number, LaneClaim[]>();
  /** Claimed stroke per axis per vertex: index axis * cellCount + cell. */
  private totals: Float32Array;
  /** Packed passer words per vertex and per cell centre. */
  private vertices: Int32Array;
  private centres: Int32Array;
  private cellCount: number;
  private claimsByEdge = new Map<string, Array<{ key: number; cell: number; axis: Axis; claim: LaneClaim }>>();
  private passersByEdge = new Map<string, Array<{ centre: boolean; axis: Axis; cell: number }>>();
  private runsByEdge = new Map<string, ClaimedRun[]>();
  private corners = new Map<number, Array<{ edgeId: string; a: number; b: number }>>();
  private cornersByEdge = new Map<string, number[]>();
  /** Corners per vertex, dense: most vertices have none, and the search asks at every expansion. */
  private cornerCount: Uint16Array;

  markCorner(x: number, y: number, incoming: number, outgoing: number, edgeId: string) {
    if (incoming === outgoing) return;
    const cell = this.cellOf(x, y);
    const list = this.corners.get(cell) ?? [];
    list.push({ edgeId, a: (incoming + 4) % 8, b: outgoing });
    this.corners.set(cell, list);
    if (cell >= 0) this.cornerCount[cell] += 1;
    const owned = this.cornersByEdge.get(edgeId) ?? [];
    owned.push(cell);
    this.cornersByEdge.set(edgeId, owned);
  }

  /** A wire may cross a bend too: compare the two pairs of outgoing rays. */
  cornerCrossings(x: number, y: number, incoming: number, outgoing: number): number {
    const cell = this.cellOf(x, y);
    // The common case, answered from two dense reads: nothing bends or
    // passes here. The search asks this eight times per pop.
    const word = cell < 0 ? 0 : this.vertices[cell];
    const bends = cell < 0 ? (this.corners.get(cell)?.length ?? 0) : this.cornerCount[cell];
    if (word === 0 && bends === 0) return 0;
    const a = (incoming + 4) % 8, b = outgoing;
    if (a === b) return 0;
    const span = (b - a + 8) % 8;
    let count = 0;
    if (bends > 0) {
      for (const c of this.corners.get(cell) ?? []) {
        if (a === c.a || a === c.b || b === c.a || b === c.b) continue;
        if (((c.a - a + 8) % 8 < span) !== ((c.b - a + 8) % 8 < span)) count++;
      }
    }
    if (word !== 0) {
      for (let axis = 0; axis < 4; axis++) {
        const c = CORNER_AXIS_DIRECTION[axis], d = c + 4;
        if (a === c || a === d || b === c || b === d) continue;
        if (((c - a + 8) % 8 < span) !== ((d - a + 8) % 8 < span)) count += (word >>> (axis * PASSER_BITS)) & PASSER_MASK;
      }
    }
    return count;
  }

  centreCrossings(axis: Axis, x0: number, y0: number, x1: number, y1: number): number {
    if (axis < 2) return 0;
    const cell = this.cellOf(Math.min(x0, x1), Math.min(y0, y1));
    return cell < 0 ? 0 : this.otherPassers(this.centres[cell], axis, true);
  }

  constructor(private bounds: CellBounds) {
    this.cellCount = bounds.width * bounds.height;
    this.totals = new Float32Array(4 * this.cellCount);
    this.vertices = new Int32Array(this.cellCount);
    this.centres = new Int32Array(this.cellCount);
    this.cornerCount = new Uint16Array(this.cellCount);
  }

  /** Dense index of a vertex, or -1 outside the board's extent. */
  private cellOf(x: number, y: number): number {
    const xi = x - this.bounds.x0;
    const yi = y - this.bounds.y0;
    if (xi < 0 || yi < 0 || xi >= this.bounds.width || yi >= this.bounds.height) {
      return -1;
    }
    return xi * this.bounds.height + yi;
  }

  /** Cells are keyed by axis, line and position along the line, in cells. */
  private laneKey(axis: Axis, x: number, y: number): number {
    let line: number;
    switch (axis) {
      case 0:
        line = y;
        break;
      case 1:
        line = x;
        break;
      case 2:
        line = x - y;
        break;
      default:
        line = x + y;
    }
    const along = axis === 1 ? y : x;
    return (axis * KEY_SPAN + line + KEY_OFFSET) * KEY_SPAN + (along + KEY_OFFSET);
  }

  /** Total stroke already claimed on the busier of a step's two vertices. */
  usedWidth(axis: Axis, x0: number, y0: number, x1: number, y1: number): number {
    const ca = this.cellOf(x0, y0);
    const cb = this.cellOf(x1, y1);
    const a = ca < 0 ? 0 : this.totals[axis * this.cellCount + ca];
    const b = cb < 0 ? 0 : this.totals[axis * this.cellCount + cb];
    return a > b ? a : b;
  }

  claimsAlong(run: ClaimedRun): LaneClaim[] {
    const merged: LaneClaim[] = [];
    const dx = Math.sign(run.x1 - run.x0);
    const dy = Math.sign(run.y1 - run.y0);
    const steps = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.y1 - run.y0));
    for (let i = 0; i <= steps; i += 1) {
      const claims = this.cells.get(this.laneKey(run.axis, run.x0 + dx * i, run.y0 + dy * i));
      if (claims) {
        merged.push(...claims);
      }
    }
    return merged;
  }

  claim(run: ClaimedRun, claimInterval: LaneClaim, edgeId: string) {
    const width = claimInterval.hi - claimInterval.lo;
    let records = this.claimsByEdge.get(edgeId);
    if (!records) {
      records = [];
      this.claimsByEdge.set(edgeId, records);
    }
    const dx = Math.sign(run.x1 - run.x0);
    const dy = Math.sign(run.y1 - run.y0);
    const steps = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.y1 - run.y0));
    for (let i = 0; i <= steps; i += 1) {
      const x = run.x0 + dx * i;
      const y = run.y0 + dy * i;
      const key = this.laneKey(run.axis, x, y);
      const claims = this.cells.get(key);
      if (claims) {
        claims.push(claimInterval);
      } else {
        this.cells.set(key, [claimInterval]);
      }
      const cell = this.cellOf(x, y);
      if (cell >= 0) {
        this.totals[run.axis * this.cellCount + cell] += width;
      }
      records.push({ key, cell, axis: run.axis, claim: claimInterval });
    }
  }

  /**
   * What a step from (x0,y0) to (x1,y1) along `axis` would cross: passers of
   * every OTHER axis through its far vertex, and for a diagonal step the
   * other diagonal through the cell centre it cuts. `weighted` multiplies
   * each by one plus the spot's negotiation history.
   */
  stepCrossings(axis: Axis, x0: number, y0: number, x1: number, y1: number, weighted: boolean): number {
    const far = this.cellOf(x1, y1);
    let count = far < 0 ? 0 : this.otherPassers(this.vertices[far], axis, weighted);
    if (axis >= 2 && (x0 !== x1 || y0 !== y1)) {
      const centre = this.cellOf(Math.min(x0, x1), Math.min(y0, y1));
      if (centre >= 0) {
        count += this.otherPassers(this.centres[centre], axis, weighted);
      }
    }
    return count;
  }

  private otherPassers(word: number, axis: Axis, weighted: boolean): number {
    if (word === 0) {
      return 0;
    }
    const passers =
      (word & PASSER_MASK) +
      ((word >>> PASSER_BITS) & PASSER_MASK) +
      ((word >>> (2 * PASSER_BITS)) & PASSER_MASK) +
      ((word >>> (3 * PASSER_BITS)) & PASSER_MASK) -
      ((word >>> (axis * PASSER_BITS)) & PASSER_MASK);
    if (passers === 0) {
      return 0;
    }
    return weighted ? passers * (1 + ((word >>> HISTORY_SHIFT) & HISTORY_MASK)) : passers;
  }

  /** The crossings a placed wire has right now, against everyone else. */
  crossingsOf(edgeId: string): number {
    const runs = this.runsByEdge.get(edgeId);
    if (!runs) {
      return 0;
    }
    let count = 0;
    for (const run of runs) {
      const dx = Math.sign(run.x1 - run.x0);
      const dy = Math.sign(run.y1 - run.y0);
      const steps = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.y1 - run.y0));
      if (steps === 0) {
        const cell = this.cellOf(run.x0, run.y0);
        count += cell < 0 ? 0 : this.otherPassers(this.vertices[cell], run.axis, false);
        continue;
      }
      for (let i = 1; i <= steps; i += 1) {
        count += this.stepCrossings(
          run.axis,
          run.x0 + dx * (i - 1),
          run.y0 + dy * (i - 1),
          run.x0 + dx * i,
          run.y0 + dy * i,
          false,
        );
      }
    }
    return count;
  }

  /** Ends a negotiation round: every spot wires cross at now costs more. */
  escalate() {
    const bump = (words: Int32Array) => {
      for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        if (word === 0) {
          continue;
        }
        let axes = 0;
        for (let axis = 0; axis < 4; axis += 1) {
          if ((word >>> (axis * PASSER_BITS)) & PASSER_MASK) {
            axes += 1;
          }
        }
        if (axes >= 2 && ((word >>> HISTORY_SHIFT) & HISTORY_MASK) < HISTORY_MASK) {
          words[i] = word + (1 << HISTORY_SHIFT);
        }
      }
    };
    bump(this.vertices);
    bump(this.centres);
  }

  private addPasser(words: Int32Array, cell: number, axis: Axis, delta: number) {
    if (cell < 0) {
      return;
    }
    const shift = axis * PASSER_BITS;
    const word = words[cell];
    const current = (word >>> shift) & PASSER_MASK;
    const next = Math.min(PASSER_MASK, Math.max(0, current + delta));
    // History outlives the passers.
    words[cell] = (word & ~(PASSER_MASK << shift)) | (next << shift);
  }

  private record(edgeId: string, centre: boolean, axis: Axis, cell: number) {
    let records = this.passersByEdge.get(edgeId);
    if (!records) {
      records = [];
      this.passersByEdge.set(edgeId, records);
    }
    records.push({ centre, axis, cell });
  }

  /**
   * Records a run as passed through: its interior vertices on its axis
   * (run ends are corners and stay unmarked), and for a diagonal every
   * cell centre it cuts. Also remembers the run for `crossingsOf`.
   */
  markRun(run: ClaimedRun, edgeId: string) {
    let runs = this.runsByEdge.get(edgeId);
    if (!runs) {
      runs = [];
      this.runsByEdge.set(edgeId, runs);
    }
    runs.push(run);
    const dx = Math.sign(run.x1 - run.x0);
    const dy = Math.sign(run.y1 - run.y0);
    const steps = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.y1 - run.y0));
    for (let i = 1; i < steps; i += 1) {
      const cell = this.cellOf(run.x0 + dx * i, run.y0 + dy * i);
      this.addPasser(this.vertices, cell, run.axis, 1);
      this.record(edgeId, false, run.axis, cell);
    }
    if (run.axis >= 2) {
      for (let i = 0; i < steps; i += 1) {
        const x = run.x0 + dx * i;
        const y = run.y0 + dy * i;
        const cell = this.cellOf(Math.min(x, x + dx), Math.min(y, y + dy));
        this.addPasser(this.centres, cell, run.axis, 1);
        this.record(edgeId, true, run.axis, cell);
      }
    }
  }

  /**
   * Records a wire's apron vertex as passed through along its stub's axis:
   * the stub runs straight on through the apron into the card, so a wire
   * riding the card's margin line crosses it there.
   */
  markStub(axis: Axis, x: number, y: number, edgeId: string) {
    const cell = this.cellOf(x, y);
    this.addPasser(this.vertices, cell, axis, 1);
    this.record(edgeId, false, axis, cell);
    let runs = this.runsByEdge.get(edgeId);
    if (!runs) {
      runs = [];
      this.runsByEdge.set(edgeId, runs);
    }
    // A zero-length run at the vertex, so crossingsOf sees the stub too.
    runs.push({ axis, x0: x, y0: y, x1: x, y1: y });
  }

  /** Rips a wire up: its lane claims and passers are forgotten. */
  release(edgeId: string) {
    for (const cell of this.cornersByEdge.get(edgeId) ?? []) {
      if (cell >= 0) this.cornerCount[cell] -= 1;
      const remaining = (this.corners.get(cell) ?? []).filter((c) => c.edgeId !== edgeId);
      if (remaining.length) this.corners.set(cell, remaining);
      else this.corners.delete(cell);
    }
    this.cornersByEdge.delete(edgeId);
    const claims = this.claimsByEdge.get(edgeId);
    if (claims) {
      for (const { key, cell, axis, claim } of claims) {
        const list = this.cells.get(key);
        if (list) {
          const at = list.indexOf(claim);
          if (at >= 0) {
            list.splice(at, 1);
          }
          if (list.length === 0) {
            this.cells.delete(key);
          }
        }
        if (cell >= 0) {
          const index = axis * this.cellCount + cell;
          const total = this.totals[index] - (claim.hi - claim.lo);
          this.totals[index] = total <= 1e-6 ? 0 : total;
        }
      }
      this.claimsByEdge.delete(edgeId);
    }
    const passers = this.passersByEdge.get(edgeId);
    if (passers) {
      for (const { centre, axis, cell } of passers) {
        this.addPasser(centre ? this.centres : this.vertices, cell, axis, -1);
      }
      this.passersByEdge.delete(edgeId);
    }
    this.runsByEdge.delete(edgeId);
  }
}

/**
 * Where in the lane a new wire of `width` sits, given what is already there.
 * A lone wire rides dead centre. A joiner slots beside the existing claims -
 * on the side of its own upcoming turn when it has one (`prefer` −1/+1), so
 * a wire about to peel off leftward sits on the left of the bundle and never
 * has to cross its lane-mates to leave. A wire that fits nowhere spills past
 * the band rather than drawing on top of what is already there.
 */
function packIntoLane(
  existing: LaneClaim[],
  width: number,
  prefer: number,
  capacity: number,
): { claim: LaneClaim; overflowed: boolean } {
  const half = capacity / 2;
  const clear = (lo: number, hi: number): boolean => {
    for (const claim of existing) {
      if (lo < claim.hi + LANE_GAP - 1e-6 && hi > claim.lo - LANE_GAP + 1e-6) {
        return false;
      }
    }
    return true;
  };
  const candidates: number[] = [0];
  for (const claim of existing) {
    candidates.push(claim.hi + LANE_GAP + width / 2);
    candidates.push(claim.lo - LANE_GAP - width / 2);
  }
  candidates.sort((left, right) =>
    prefer !== 0
      ? prefer * (right - left) || Math.abs(left) - Math.abs(right)
      : Math.abs(left) - Math.abs(right) || left - right,
  );
  for (const center of candidates) {
    const lo = center - width / 2;
    const hi = center + width / 2;
    if (lo < -half - 1e-6 || hi > half + 1e-6) {
      continue;
    }
    if (clear(lo, hi)) {
      return { claim: { lo, hi }, overflowed: false };
    }
  }
  for (const center of candidates) {
    const lo = center - width / 2;
    const hi = center + width / 2;
    if (clear(lo, hi)) {
      return { claim: { lo, hi }, overflowed: true };
    }
  }
  return { claim: { lo: -width / 2, hi: width / 2 }, overflowed: true };
}

/* ------------------------------------------------------------------ */
/* Endpoint plumbing                                                   */
/* ------------------------------------------------------------------ */

function snapLine(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/**
 * Cost per pixel of distance from a side's centre when choosing a dock:
 * mid-way out a machine's long side costs about one extra turn, so facing
 * wires meet centre-to-centre and a wire slides toward a corner only when
 * the route earns it.
 */
export const DOCK_CENTER_BIAS = 0.25;

/**
 * Every dock a card offers: one per grid line crossing its border, on each
 * side's first grid line AT OR OUTSIDE the border, never the nearest one. A
 * border need not sit on a grid line (clean drawers and cards come in the
 * mod's 10 px sizes, a group's corner sits on its 10 px grid), and a dock on
 * a line inside the card puts its apron in the card's own clearance: that
 * whole side is lost, or a touching dock draws the wire from under the card.
 * `stubDepth` carries the drawn wire on from the dock to the true border.
 */
export function cardRimDocks(rect: { left: number; top: number; right: number; bottom: number }): GridEndpoint[] {
  const lineAtOrBefore = (value: number) => Math.floor(value / BOARD_GRID + 1e-6) * BOARD_GRID;
  const lineAtOrAfter = (value: number) => Math.ceil(value / BOARD_GRID - 1e-6) * BOARD_GRID;
  const left = lineAtOrBefore(rect.left);
  const top = lineAtOrBefore(rect.top);
  const right = lineAtOrAfter(rect.right);
  const bottom = lineAtOrAfter(rect.bottom);
  const depth = (gap: number) => (gap > 0.5 ? { stubDepth: gap } : undefined);
  const topDepth = depth(rect.top - top);
  const bottomDepth = depth(bottom - rect.bottom);
  const leftDepth = depth(rect.left - left);
  const rightDepth = depth(right - rect.right);
  // Huge multiblock cards coarsen to every other line so the candidate set stays bounded.
  const perimeterCells = (right - left + (bottom - top)) / BOARD_GRID;
  const step = perimeterCells > 60 ? 2 * BOARD_GRID : BOARD_GRID;
  // The corner itself is not a dock (a wire off the very corner reads as
  // clipped through the card); one cell in is fine, at 45° too.
  const keepOutFor = (span: number) => (span >= 2 * BOARD_GRID ? BOARD_GRID : 0);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const keepOutX = keepOutFor(right - left);
  const keepOutY = keepOutFor(bottom - top);
  const docks: GridEndpoint[] = [];
  for (let x = left + keepOutX; x <= right - keepOutX; x += step) {
    const penalty = Math.abs(x - centerX) * DOCK_CENTER_BIAS;
    docks.push({ x, y: top, side: "top", penalty, ...topDepth });
    docks.push({ x, y: bottom, side: "bottom", penalty, ...bottomDepth });
  }
  for (let y = top + keepOutY; y <= bottom - keepOutY; y += step) {
    const penalty = Math.abs(y - centerY) * DOCK_CENTER_BIAS;
    docks.push(
      { x: left, y, side: "left", penalty, ...leftDepth },
      { x: right, y, side: "right", penalty, ...rightDepth },
    );
  }
  // Defensive: a card with no dock left after the keep-out falls back to its
  // side centres.
  if (docks.length === 0) {
    docks.push(
      { x: left, y: snapLine(centerY), side: "left", ...leftDepth },
      { x: right, y: snapLine(centerY), side: "right", ...rightDepth },
      { x: snapLine(centerX), y: bottom, side: "bottom", ...bottomDepth },
      { x: snapLine(centerX), y: top, side: "top", ...topDepth },
    );
  }
  return docks;
}

/** The apron vertex: the endpoint pushed one cell out of its card, on-grid. */
function apronPoint(endpoint: GridEndpoint): GridPoint {
  const dir = outwardDirection(endpoint.side);
  return {
    x: snapLine(endpoint.x) + DIR_DX[dir] * WIRE_NODE_MARGIN,
    y: snapLine(endpoint.y) + DIR_DY[dir] * WIRE_NODE_MARGIN,
  };
}

function isFiniteEndpoint(endpoint: GridEndpoint): boolean {
  return Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y);
}

function dockKey(endpoint: GridEndpoint): string {
  return `${Math.round(endpoint.x)},${Math.round(endpoint.y)}`;
}

/* ------------------------------------------------------------------ */
/* The solve                                                           */
/* ------------------------------------------------------------------ */

interface SolveContext {
  obstacles: GridObstacle[];
  occupancy: LaneOccupancy;
  /** The board's extent in cells; no search window reaches past it. */
  board: CellBounds;
  /** The wide rung is skipped once the solve's pops pass this. */
  widePopCap: number;
  /**
   * Dock points already taken, as "x,y", each against the wire holding it.
   * With whole-perimeter docking every wire can have its own attachment
   * point, so no two wires should share one while free points remain - the
   * claim is what spreads a fan of wires around the card instead of piling
   * them onto one spot.
   */
  usedDocks: Map<string, string>;
}

/** A request after dock planning: the pruned docks, and the whole rim to fall back on. */
interface PlannedRequest extends GridRouteRequest {
  allSources: GridEndpoint[];
  allTargets: GridEndpoint[];
  /** Rim-to-rim gap, independent of the docks eventually selected. */
  distanceCells: number;
}

/** A found route before it is installed: its ends and its vertex chain in cells. */
interface RouteFound {
  source: GridEndpoint;
  target: GridEndpoint;
  /** Vertex chain in CELL units, apron to apron, one entry per corner. */
  vertices: GridPoint[];
  /** The search's cost for it: length, turns, dock penalties, crossings. */
  cost: number;
}

/** One wire's standing in the solve: its route and how well it fared. */
interface RouteState {
  request: PlannedRequest;
  found: RouteFound | undefined;
  routed: GridRoutedEdge;
  /** Other wires this one runs across. */
  crossings: number;
  /** It had to squeeze into a lane it did not fit. */
  overflowed: boolean;
  /** A reroute gave it back the same route: nothing else to try. */
  stuck: boolean;
  /** Held still by the caller: never ripped up, never traded. */
  pinned?: boolean;
}

/**
 * Every wire on the board, as ONE solve, in three moves:
 *
 * 1. DOCKS: `planDocks` looks at each card's wires together and gives each
 *    a preferred dock facing where it is going, siblings in bearing order
 *    round the rim. A per-wire search cannot see that more wires are about
 *    to leave the same card.
 * 2. FIRST PASS: thickest wires first, then (by default) longest, so a long
 *    wire takes the open lines and the short ones fit around it; a fan to a
 *    row of drawers nests instead of the last wire climbing over the others.
 * 3. NEGOTIATION: wires that cross another or overflow a lane are ripped up
 *    and rerouted against the finished board, contested spots dearer each
 *    round. Only unhappy wires reroute, within `negotiationBudget` reroutes
 *    per wire, so a clean board pays nothing for it.
 */
export function solveGridRoutes(
  obstacles: GridObstacle[],
  requests: GridRouteRequest[],
  stats?: GridSolveStats,
  tuning: RouterTuning = DEFAULT_ROUTER_TUNING,
  /**
   * Routes to hold exactly as they are: installed first, in the order
   * given, and never touched by the negotiation. Everything in `requests`
   * routes around them. A judge trying one card somewhere else pins every
   * wire that card does not touch and re-solves the rest.
   */
  pinned: readonly PinnedRoute[] = [],
): Map<string, GridRoutedEdge> {
  applyTuning(tuning);
  workPops = 0;
  workPriced = 0;
  workSearches = 0;
  const startedAt = performance.now();
  const bounds = boardBounds(obstacles, [...requests, ...pinned.map((pin) => pin.request)]);
  const context: SolveContext = {
    obstacles,
    occupancy: new LaneOccupancy(bounds),
    board: bounds,
    usedDocks: new Map(),
    widePopCap: (NEGOTIATION_POPS_PER_WIRE * requests.length) / 2,
  };
  const planned = planDocks(requests);
  // Thickest (highest-flow) wires take the open lines first and the trickles
  // route round them. At one width, longest first (`T.longestFirst`).
  const sorted = [...planned].sort(
    (left, right) =>
      right.strokeWidth - left.strokeWidth ||
      (T.longestFirst ? routeSpan(right) - routeSpan(left) : routeSpan(left) - routeSpan(right)) ||
      left.order - right.order ||
      (left.edgeId < right.edgeId ? -1 : 1),
  );

  const states: RouteState[] = [];
  for (const pin of pinned) {
    const { vertices, source, target } = pin.route;
    const request: PlannedRequest = {
      ...pin.request,
      sources: pin.request.sources.filter(isFiniteEndpoint),
      targets: pin.request.targets.filter(isFiniteEndpoint),
      allSources: pin.request.sources.filter(isFiniteEndpoint),
      allTargets: pin.request.targets.filter(isFiniteEndpoint),
      distanceCells: endpointGapCells(pin.request.sources, pin.request.targets),
    };
    if (vertices && source && target) {
      const state = install(context, request, { source, target, vertices, cost: 0 });
      state.pinned = true;
      states.push(state);
    } else {
      states.push({ ...routeOne(context, request), pinned: true });
    }
  }
  for (const request of sorted) {
    states.push(routeOne(context, request));
  }

  const firstPassMs = performance.now() - startedAt;
  let bestRoutes = states.map((state) => state.routed);
  let bestPoints = routePoints(measureWireRoutes(bestRoutes), T);
  // The board kept is the one with the fewest POINTS (length, bends and
  // crossings at the dials, each wire weighted by its width) - the same
  // number the arrange and the dev menu's score read.
  const retainBest = () => {
    const routes = states.map((state) => state.routed);
    const points = routePoints(measureWireRoutes(routes), T);
    if (points < bestPoints) {
      bestRoutes = routes;
      bestPoints = points;
    }
  };
  let rerouted = 0;
  // A floor on the budget: a small board's few wires may need several
  // trades to settle, and the whole solve is still milliseconds.
  let budget = Math.max(12, Math.round(T.negotiationBudget * states.length));
  const popCap = NEGOTIATION_POPS_PER_WIRE * states.length;
  context.widePopCap = popCap;
  readCrossings(context, states);
  for (let round = 0; round < T.negotiationRounds && budget > 0 && workPops < popCap; round += 1) {
    // Every round the contested spots get dearer (escalate), so a wire
    // whose last reroute changed nothing is worth another try: `stuck`
    // only spares it the rest of the round it was found stuck in.
    const unhappy: number[] = [];
    for (let i = 0; i < states.length; i += 1) {
      const state = states[i];
      state.stuck = false;
      if (state.found && !state.pinned && (state.crossings > 0 || state.overflowed)) {
        unhappy.push(i);
      }
    }
    if (unhappy.length === 0) {
      break;
    }
    context.occupancy.escalate();
    for (const index of unhappy) {
      if (budget === 0 || workPops >= popCap) {
        break;
      }
      const state = states[index];
      ripUp(context, state);
      const again = routeOne(context, state.request, state.found);
      if (state.found && again.found && sameRoute(state.found, again.found)) {
        again.stuck = true;
      }
      states[index] = again;
      rerouted += 1;
      budget -= 1;
    }
    // Others may have been crossed by the movers; re-read every wire so the
    // next round works from the truth.
    let remaining = readCrossings(context, states);
    retainBest();
    if (remaining === 0) {
      break;
    }
    // SWAPS. Two wires leaving one card that still cross may have their docks
    // the wrong way round (a wall beside the card can invert the bearing
    // order), which neither can fix alone. They trade planned docks and both
    // reroute; the trade stands only if the board's crossings fall. Two
    // reroutes from the budget per trial, one trial per pair per round.
    for (let i = 0; i < states.length && budget >= 2 && workPops < popCap; i += 1) {
      const a = states[i];
      if (!a.found || a.pinned || a.crossings === 0) {
        continue;
      }
      for (let k = i + 1; k < states.length && budget >= 2; k += 1) {
        const b = states[k];
        if (!b.found || b.pinned || b.crossings === 0 || !sharesCard(a.request, b.request)) {
          continue;
        }
        const foundA = a.found;
        const foundB = b.found;
        swapPlans(a.request, b.request);
        ripUp(context, a);
        ripUp(context, b);
        const nextA = routeOne(context, a.request, foundA);
        const nextB = routeOne(context, b.request, foundB);
        budget -= 2;
        rerouted += 2;
        states[i] = nextA;
        states[k] = nextB;
        const after = readCrossings(context, states);
        if (after < remaining) {
          remaining = after;
          retainBest();
          break;
        }
        // No better: put both back exactly as they were.
        ripUp(context, nextA);
        ripUp(context, nextB);
        swapPlans(a.request, b.request);
        states[i] = install(context, a.request, foundA);
        states[k] = install(context, b.request, foundB);
        readCrossings(context, states);
      }
    }
    if (remaining === 0) {
      break;
    }
  }

  // Lanes are packed as wires arrive, so a wire that packed beside a
  // neighbour keeps that offset after the neighbour has moved on. Once every
  // route is final, pack them all again on a clean board.
  if (rerouted > 0) {
    context.occupancy = new LaneOccupancy(bounds);
    for (let i = 0; i < states.length; i += 1) {
      const state = states[i];
      if (state.found) {
        const pinnedState = state.pinned;
        states[i] = install(context, state.request, state.found);
        states[i].pinned = pinnedState;
      }
    }
  }

  retainBest();
  const results = new Map(bestRoutes.map((route) => [route.edgeId, route]));
  let crossings = 0;
  let fallbacks = 0;
  for (const state of states) {
    crossings += state.crossings;
    if (!state.found && state.routed.points.length > 0) {
      fallbacks += 1;
    }
  }
  if (stats) {
    stats.crossings = measureWireRoutes(bestRoutes).crossings;
    stats.rerouted = rerouted;
    stats.fallbacks = fallbacks;
    stats.pops = workPops;
    stats.priced = workPriced;
    stats.searches = workSearches;
    stats.firstPassMs = Math.round(firstPassMs);
    stats.perEdge = {};
    for (const state of states) {
      stats.perEdge[state.request.edgeId] = {
        crossings: state.crossings,
        overflowed: state.overflowed,
        fallback: !state.found,
      };
    }
    stats.negotiationMs = Math.round(performance.now() - startedAt - firstPassMs);
  }
  return results;
}

/**
 * The board's extent in cells, padded past the largest search window a wire
 * can grow to, so the dense occupancy arrays cover every vertex a route can
 * touch. Anything outside (nothing, in practice) counts as empty.
 */
function boardBounds(obstacles: GridObstacle[], requests: GridRouteRequest[]): CellBounds {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const take = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  };
  for (const obstacle of obstacles) {
    take(obstacle.left, obstacle.top);
    take(obstacle.right, obstacle.bottom);
  }
  for (const request of requests) {
    for (const endpoint of request.sources) take(endpoint.x, endpoint.y);
    for (const endpoint of request.targets) take(endpoint.x, endpoint.y);
    for (const stop of request.waypoints ?? []) take(stop.x, stop.y);
  }
  if (left === Infinity) {
    return { x0: 0, y0: 0, width: 1, height: 1 };
  }
  const padCells = Math.ceil(T.windowPad * WINDOW_GROWTH) + 2;
  const x0 = Math.floor(left / BOARD_GRID) - padCells;
  const y0 = Math.floor(top / BOARD_GRID) - padCells;
  const x1 = Math.ceil(right / BOARD_GRID) + padCells;
  const y1 = Math.ceil(bottom / BOARD_GRID) + padCells;
  return { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Re-reads every placed wire's crossings from the occupancy; returns the total. */
function readCrossings(context: SolveContext, states: RouteState[]): number {
  const measured = measureWireRoutes(states.map((state) => state.routed));
  const byId = new Map(states.map((state) => { state.crossings = 0; return [state.request.edgeId, state]; }));
  for (const event of measured.events) for (const id of event.edges) byId.get(id)!.crossings++;
  return measured.crossings;
}

function sharesCard(a: PlannedRequest, b: PlannedRequest): boolean {
  return (
    (a.sourceCardId !== undefined && a.sourceCardId === b.sourceCardId) ||
    (a.targetCardId !== undefined && a.targetCardId === b.targetCardId)
  );
}

/** Trades the planned docks (the priced candidate lists) on every card two wires share. */
function swapPlans(a: PlannedRequest, b: PlannedRequest) {
  if (a.sourceCardId !== undefined && a.sourceCardId === b.sourceCardId) {
    const sources = a.sources;
    a.sources = b.sources;
    b.sources = sources;
  }
  if (a.targetCardId !== undefined && a.targetCardId === b.targetCardId) {
    const targets = a.targets;
    a.targets = b.targets;
    b.targets = targets;
  }
}

function sameRoute(a: RouteFound, b: RouteFound): boolean {
  if (a.vertices.length !== b.vertices.length) {
    return false;
  }
  for (let i = 0; i < a.vertices.length; i += 1) {
    if (a.vertices[i].x !== b.vertices[i].x || a.vertices[i].y !== b.vertices[i].y) {
      return false;
    }
  }
  return true;
}

/** Manhattan distance between a wire's two candidate sets, for the order. */
function routeSpan(request: GridRouteRequest): number {
  const source = endpointsCentre(request.sources);
  const target = endpointsCentre(request.targets);
  if (!source || !target) {
    return 0;
  }
  return Math.abs(source.x - target.x) + Math.abs(source.y - target.y);
}

type Rect = { left: number; top: number; right: number; bottom: number };

function endpointsRect(endpoints: GridEndpoint[]): Rect | undefined {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const endpoint of endpoints) {
    if (!isFiniteEndpoint(endpoint)) {
      continue;
    }
    if (endpoint.x < left) left = endpoint.x;
    if (endpoint.x > right) right = endpoint.x;
    if (endpoint.y < top) top = endpoint.y;
    if (endpoint.y > bottom) bottom = endpoint.y;
  }
  if (left === Infinity) {
    return undefined;
  }
  return { left, top, right, bottom };
}

function endpointsCentre(endpoints: GridEndpoint[]): GridPoint | undefined {
  const rect = endpointsRect(endpoints);
  return rect ? { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 } : undefined;
}

/** Forgets everything a wire holds: lanes, passers and both docks. */
function ripUp(context: SolveContext, state: RouteState) {
  const edgeId = state.request.edgeId;
  context.occupancy.release(edgeId);
  for (const [key, holder] of context.usedDocks) {
    if (holder === edgeId) {
      context.usedDocks.delete(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Dock planning                                                       */
/* ------------------------------------------------------------------ */

/**
 * A card's perimeter as one line: the distance clockwise from the top-left
 * corner. Every candidate dock and every wire's ideal exit live on it, so
 * "how far is this dock from where the wire wants to leave" is a subtraction.
 */
function perimeterParam(side: GridSide, x: number, y: number, rect: Rect): number {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  switch (side) {
    case "top":
      return x - rect.left;
    case "right":
      return width + (y - rect.top);
    case "bottom":
      return width + height + (rect.right - x);
    case "left":
      return 2 * width + height + (rect.bottom - y);
  }
}

interface DockEnd {
  request: PlannedRequest;
  end: "source" | "target";
  cardId: string;
  farCardId: string | undefined;
  rect: Rect;
  /** Where the wire would ideally leave, on the perimeter line. */
  ideal: number;
  /** The heading's angle round the card, for ordering ties at a corner. */
  angle: number;
  /** The ideal after siblings have been spread apart. */
  planned: number;
}

/**
 * Plans where every wire leaves and arrives, one card at a time.
 *
 * Each end's ideal exit is the rim point nearest the far end (or the first
 * waypoint). Siblings on one card are sorted round the rim by that point
 * (corner ties by destination bearing) and matched onto real docks in that
 * order (`assignDocks`), so none has to cross another to leave. Two wires
 * between the SAME pair of cards are ordered one way at one card and the
 * other way at the other (by card id), so they run parallel instead of
 * swapping over. The plan is soft: it becomes each candidate's `penalty`,
 * and docks far from it are set aside (kept in `allSources` / `allTargets`
 * for a wire that cannot route from the near ones). Returns copies; the
 * caller's requests stand.
 */
function planDocks(requests: GridRouteRequest[]): PlannedRequest[] {
  const byCard = new Map<string, DockEnd[]>();
  const copies: PlannedRequest[] = requests.map((request) => ({
    ...request,
    sources: request.sources.filter(isFiniteEndpoint),
    targets: request.targets.filter(isFiniteEndpoint),
    allSources: request.sources.filter(isFiniteEndpoint),
    allTargets: request.targets.filter(isFiniteEndpoint),
    distanceCells: endpointGapCells(request.sources, request.targets),
  }));
  for (const request of copies) {
    for (const end of ["source", "target"] as const) {
      const cardId = end === "source" ? request.sourceCardId : request.targetCardId;
      const own = end === "source" ? request.sources : request.targets;
      if (cardId === undefined || own.length < 2) {
        continue;
      }
      const rect = endpointsRect(own);
      const far = endpointsCentre(end === "source" ? request.targets : request.sources);
      if (!rect || rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0 || !far) {
        continue;
      }
      const stops = request.waypoints ?? [];
      const heading =
        stops.length > 0 ? (end === "source" ? stops[0] : stops[stops.length - 1]) : far;
      const centreX = (rect.left + rect.right) / 2;
      const centreY = (rect.top + rect.bottom) / 2;
      // Angle round the card, measured so it grows clockwise from the
      // top-left corner like the perimeter line does.
      const angle =
        (Math.atan2(heading.y - centreY, heading.x - centreX) + Math.PI * 1.25 + Math.PI * 4) %
        (Math.PI * 2);
      const ideal = exitParam(rect, heading);
      const dockEnd: DockEnd = {
        request,
        end,
        cardId,
        farCardId: end === "source" ? request.targetCardId : request.sourceCardId,
        rect,
        ideal,
        angle,
        planned: ideal,
      };
      const list = byCard.get(cardId);
      if (list) {
        list.push(dockEnd);
      } else {
        byCard.set(cardId, [dockEnd]);
      }
    }
  }

  for (const [cardId, ends] of byCard) {
    ends.sort((left, right) => {
      if (left.ideal !== right.ideal) {
        return left.ideal - right.ideal;
      }
      if (left.angle !== right.angle) {
        return left.angle - right.angle;
      }
      const byEdge =
        left.request.edgeId < right.request.edgeId
          ? -1
          : left.request.edgeId > right.request.edgeId
            ? 1
            : 0;
      // Same far card at both: mirror the order at the far side.
      if (left.farCardId !== undefined && left.farCardId === right.farCardId) {
        return cardId < left.farCardId ? byEdge : -byEdge;
      }
      return byEdge;
    });
    const rect = ends[0].rect;
    const perimeter = 2 * (rect.right - rect.left + (rect.bottom - rect.top));
    // The docks this card actually offers, once round the rim.
    const dockParams = new Set<number>();
    for (const dockEnd of ends) {
      const own = dockEnd.end === "source" ? dockEnd.request.sources : dockEnd.request.targets;
      for (const endpoint of own) {
        dockParams.add(perimeterParam(endpoint.side, endpoint.x, endpoint.y, dockEnd.rect));
      }
    }
    assignDocks(ends, [...dockParams].sort((a, b) => a - b));
    for (const dockEnd of ends) {
      const own = dockEnd.end === "source" ? dockEnd.request.sources : dockEnd.request.targets;
      const priced: GridEndpoint[] = [];
      for (const endpoint of own) {
        const at = perimeterParam(endpoint.side, endpoint.x, endpoint.y, dockEnd.rect);
        const gap = Math.abs(at - dockEnd.planned);
        const distance = Math.min(gap, perimeter - gap);
        if (distance <= (T.dockPlanWindow * BOARD_GRID) + 1e-6) {
          priced.push({ ...endpoint, penalty: distance * T.dockPlanBias });
        }
      }
      if (priced.length === 0) {
        continue;
      }
      if (dockEnd.end === "source") {
        dockEnd.request.sources = priced;
      } else {
        dockEnd.request.targets = priced;
      }
    }
  }
  return copies;
}

/** Nearby cards cannot earn diagonals by docking on their far sides. */
function endpointGapCells(sources: GridEndpoint[], targets: GridEndpoint[]): number {
  const a = endpointsRect(sources.filter(isFiniteEndpoint));
  const b = endpointsRect(targets.filter(isFiniteEndpoint));
  if (!a || !b) return 0;
  return Math.max(0, a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom) / BOARD_GRID;
}

/**
 * Soft cost for a route whose docks sit fewer than `T.dockTravelCells`
 * cells apart (horizontal + vertical), so docks move apart and leave room
 * for visible wire and arrows. Soft, so a wire still connects when other
 * cards block the roomier docks. Fixed endpoints, waypoint trips and self
 * loops pay nothing; the caller exempts actual straight shots.
 */
function crampedDockCost(request: PlannedRequest, source: GridEndpoint, target: GridEndpoint): number {
  if (
    (request.allSources.length < 2 && request.allTargets.length < 2) ||
    request.waypoints?.length ||
    (request.sourceCardId !== undefined && request.sourceCardId === request.targetCardId)
  ) {
    return 0;
  }
  const travel = (Math.abs(source.x - target.x) + Math.abs(source.y - target.y)) / BOARD_GRID;
  return Math.max(0, T.dockTravelCells - travel) * (T.turn90 + T.earlyTurn + BOARD_GRID);
}

/**
 * The rim point nearest `heading`: the side the destination is beyond, at
 * the destination's coordinate clamped to that side. Not a ray from the
 * centre: on a tall card, the ray to a drawer over its top-right corner
 * leaves by the right side and climbs across every wire leaving there. A
 * heading inside the card (overlapping cards) falls back to the ray.
 */
function exitParam(rect: Rect, heading: GridPoint): number {
  const clampX = Math.min(Math.max(heading.x, rect.left), rect.right);
  const clampY = Math.min(Math.max(heading.y, rect.top), rect.bottom);
  if (heading.y < rect.top) {
    return perimeterParam("top", clampX, rect.top, rect);
  }
  if (heading.y > rect.bottom) {
    return perimeterParam("bottom", clampX, rect.bottom, rect);
  }
  if (heading.x < rect.left) {
    return perimeterParam("left", rect.left, clampY, rect);
  }
  if (heading.x > rect.right) {
    return perimeterParam("right", rect.right, clampY, rect);
  }
  const halfWidth = (rect.right - rect.left) / 2;
  const halfHeight = (rect.bottom - rect.top) / 2;
  const centreX = rect.left + halfWidth;
  const centreY = rect.top + halfHeight;
  const dx = heading.x - centreX;
  const dy = heading.y - centreY;
  if (dx === 0 && dy === 0) {
    return perimeterParam("right", rect.right, centreY, rect);
  }
  if (Math.abs(dx) * halfHeight >= Math.abs(dy) * halfWidth) {
    const y = centreY + (dy * halfWidth) / Math.abs(dx);
    return dx > 0
      ? perimeterParam("right", rect.right, y, rect)
      : perimeterParam("left", rect.left, y, rect);
  }
  const x = centreX + (dx * halfHeight) / Math.abs(dy);
  return dy > 0
    ? perimeterParam("bottom", x, rect.bottom, rect)
    : perimeterParam("top", x, rect.top, rect);
}

/**
 * Hands each of a card's wires (sorted round the rim) its own real dock, in
 * that order, minimising total distance from their ideals: a monotone
 * matching by dynamic programming over ends x docks. Matching onto actual
 * docks, not rim positions, matters because a corner keep-out leaves
 * stretches of rim with no docks, where nearby ideals would snap onto the
 * same dock. More wires than docks: the overflow takes its nearest dock and
 * shares.
 */
function assignDocks(ends: DockEnd[], docks: number[]) {
  const n = ends.length;
  const m = docks.length;
  if (m === 0) {
    return;
  }
  const matched = Math.min(n, m);
  // dp[i][j]: least cost matching the first i ends into the first j docks.
  const dp: Float64Array[] = [];
  for (let i = 0; i <= matched; i += 1) {
    dp.push(new Float64Array(m + 1).fill(Infinity));
  }
  dp[0].fill(0);
  for (let i = 1; i <= matched; i += 1) {
    for (let j = i; j <= m; j += 1) {
      const skip = dp[i][j - 1];
      const take = dp[i - 1][j - 1] + Math.abs(docks[j - 1] - ends[i - 1].ideal);
      dp[i][j] = skip < take ? skip : take;
    }
  }
  let j = m;
  for (let i = matched; i >= 1; i -= 1) {
    while (j > i && dp[i][j - 1] <= dp[i][j]) {
      j -= 1;
    }
    ends[i - 1].planned = docks[j - 1];
    j -= 1;
  }
  for (let i = matched; i < n; i += 1) {
    let best = docks[0];
    for (const dock of docks) {
      if (Math.abs(dock - ends[i].ideal) < Math.abs(best - ends[i].ideal)) {
        best = dock;
      }
    }
    ends[i].planned = best;
  }
}

/* ------------------------------------------------------------------ */
/* One wire                                                            */
/* ------------------------------------------------------------------ */

/**
 * Routes one wire against the board as it stands and installs the result.
 * `previous` is the route it held before a rip-up: if nothing better can
 * be found now, that route goes back rather than a fallback.
 */
function routeOne(
  context: SolveContext,
  request: PlannedRequest,
  previous?: RouteFound,
): RouteState {
  const found = findRoute(context, request) ?? previous;
  if (found) {
    return install(context, request, found);
  }
  return {
    request,
    found: undefined,
    routed: fallbackRoute(context, request),
    crossings: 0,
    overflowed: false,
    stuck: false,
  };
}

/** Claims the found route's lanes and docks and draws its polyline. */
function install(context: SolveContext, request: PlannedRequest, found: RouteFound): RouteState {
  context.usedDocks.set(dockKey(found.source), request.edgeId);
  context.usedDocks.set(dockKey(found.target), request.edgeId);
  const assembled = claimAndAssemble(context, request, found);
  return {
    request,
    found,
    routed: {
      edgeId: request.edgeId,
      width: request.strokeWidth,
      points: assembled.points,
      vertices: found.vertices,
      source: found.source,
      target: found.target,
    },
    crossings: assembled.crossings,
    overflowed: assembled.overflowed,
    stuck: false,
  };
}

/** The boxed-in L: the wire still exists, and may cross things. */
function fallbackRoute(context: SolveContext, request: PlannedRequest): GridRoutedEdge {
  const source = request.allSources[0];
  const target = request.allTargets[0];
  if (!source || !target) {
    return { edgeId: request.edgeId, points: [], width: request.strokeWidth };
  }
  context.usedDocks.set(dockKey(source), request.edgeId);
  context.usedDocks.set(dockKey(target), request.edgeId);
  const sourceApron = apronPoint(source);
  const targetApron = apronPoint(target);
  return {
    edgeId: request.edgeId,
    width: request.strokeWidth,
    points: compactPoints([
      { x: source.x, y: source.y },
      sourceApron,
      { x: sourceApron.x, y: targetApron.y },
      targetApron,
      { x: target.x, y: target.y },
    ]),
  };
}

function findRoute(context: SolveContext, request: PlannedRequest): RouteFound | undefined {
  if (request.allSources.length === 0 || request.allTargets.length === 0) {
    return undefined;
  }
  // The frames this wire lives inside are not obstacles to it. Filtered per
  // request, not in the shared context: the same frame that lets a member
  // wire through must still turn every foreign wire away.
  const exempt = request.exemptObstacleIds;
  const obstacles =
    exempt && exempt.length > 0
      ? context.obstacles.filter((obstacle) => !exempt.includes(obstacle.id))
      : context.obstacles;
  const home = request.homeObstacleIds;
  const exemptRects =
    exempt && exempt.length > 0
      ? context.obstacles.filter(
          (obstacle) => exempt.includes(obstacle.id) && !(home && home.includes(obstacle.id)),
        )
      : [];
  const homeRects =
    home && home.length > 0
      ? context.obstacles.filter((obstacle) => home.includes(obstacle.id))
      : [];
  const waypoints = (request.waypoints ?? []).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  // The planned docks first; the whole rim if those cannot route. A dock
  // another wire already uses costs `dockShare` more but stays on the
  // menu: when one side of a drawer is where every wire wants to be, they
  // stack onto it one after another rather than being sent round the back.
  const menus: Array<[GridEndpoint[], GridEndpoint[]]> = [[request.sources, request.targets]];
  if (
    request.allSources.length > request.sources.length ||
    request.allTargets.length > request.targets.length
  ) {
    menus.push([request.allSources, request.allTargets]);
  }
  const priceTaken = (endpoints: GridEndpoint[]): GridEndpoint[] =>
    endpoints.map((endpoint) =>
      context.usedDocks.has(dockKey(endpoint))
        ? { ...endpoint, penalty: (endpoint.penalty ?? 0) + T.dockShare }
        : endpoint,
    );
  // A route that paid for a crossing is a reason to look further: first the
  // whole rim (the way round may be a dock the plan set aside), then a bigger
  // window (the way round may be over the top of a tall card). The cheapest
  // wins; a clean route ends the search at once, so an ordinary wire pays for
  // one search. Touching docks connect first, without a search (`directDock`).
  let best: RouteFound | undefined;
  const consider = (found: RouteFound): boolean => {
    if (!best || found.cost < best.cost) {
      best = found;
    }
    return found.cost < T.crossing;
  };
  const selfLoop = request.sourceCardId !== undefined && request.sourceCardId === request.targetCardId;
  if (waypoints.length === 0 && !selfLoop) {
    const direct = directDock(context, priceTaken(request.allSources), priceTaken(request.allTargets));
    if (direct && consider(direct)) {
      return direct;
    }
  }
  // Two rungs: the planned docks inside the wire's own box, then the whole
  // rim across the whole board (windows are clamped to the board, so that is
  // the last rung there can be).
  const rungs: Array<[GridEndpoint[], GridEndpoint[], number, number]> = [
    [request.sources, request.targets, T.windowPad * BOARD_GRID, 1],
  ];
  const last = menus[menus.length - 1];
  if (T.wideRungCells > T.windowPad) {
    rungs.push([last[0], last[1], T.wideRungCells * BOARD_GRID, BOARD_RUNG_WEIGHT]);
  }
  // Waypoints that cannot be reached (parked inside a card's margin,
  // sealed off) must not cost the wire its route: try again without.
  for (const stops of waypoints.length > 0 ? [waypoints, []] : [[]]) {
    for (const [menuSources, menuTargets, pad, weight] of rungs) {
      if (pad > T.windowPad * BOARD_GRID && workPops >= context.widePopCap) {
        break;
      }
      const routed = routeWithinWindow(
        context,
        obstacles,
        exemptRects,
        homeRects,
        request,
        priceTaken(menuSources),
        priceTaken(menuTargets),
        stops,
        pad,
        weight,
      );
      if (routed === SEALED) {
        break;
      }
      if (routed && consider(routed)) {
        return routed;
      }
    }
    if (best) {
      break;
    }
  }
  return best;
}

/**
 * TOUCHING DOCKS: two cards one grid space apart have no vertex between
 * them (each dock's apron is the other card's edge), so a source dock whose
 * apron IS a facing target dock connects straight across without a search.
 * The only route the search cannot find by itself. Straight only: diagonals
 * need two cells. Two borders less than a cell apart share their dock line
 * (`cardRimDocks`), so facing docks on the SAME point connect too, as long as
 * the borders themselves do not touch (the wire would have no length).
 */
function directDock(
  context: SolveContext,
  sources: GridEndpoint[],
  targets: GridEndpoint[],
): RouteFound | undefined {
  const targetsAt = new Map<string, GridEndpoint[]>();
  for (const target of targets) {
    const key = dockKey(target);
    const list = targetsAt.get(key);
    if (list) list.push(target);
    else targetsAt.set(key, [target]);
  }
  let best: RouteFound | undefined;
  for (const source of sources) {
    const dir = outwardDirection(source.side);
    for (const reach of [BOARD_GRID, 0]) {
      const x = source.x + DIR_DX[dir] * reach;
      const y = source.y + DIR_DY[dir] * reach;
      for (const target of targetsAt.get(`${Math.round(x)},${Math.round(y)}`) ?? []) {
        if ((dir + 4) % 8 !== outwardDirection(target.side)) {
          continue;
        }
        if (reach === 0 && (source.stubDepth ?? 0) + (target.stubDepth ?? 0) <= 0) {
          continue;
        }
        const vertex = { x: Math.round(x / BOARD_GRID), y: Math.round(y / BOARD_GRID) };
        const cost =
          reach +
          (source.penalty ?? 0) +
          (target.penalty ?? 0) +
          context.occupancy.stepCrossings(DIR_AXIS[dir], vertex.x, vertex.y, vertex.x, vertex.y, false) *
            T.crossing;
        if (!best || cost < best.cost) {
          best = { source, target, vertices: [vertex], cost };
        }
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* The search                                                          */
/* ------------------------------------------------------------------ */

function routeWithinWindow(
  context: SolveContext,
  obstacles: GridObstacle[],
  exemptRects: GridObstacle[],
  homeRects: GridObstacle[],
  request: PlannedRequest,
  sources: GridEndpoint[],
  targets: GridEndpoint[],
  waypoints: GridPoint[],
  pad: number,
  /**
   * Heuristic weight. 1 is plain A* and finds the cheapest route; above 1
   * (the whole-board rung) the search trusts the distance more, explores a
   * fraction of the states, and may miss a slightly cheaper detour - a
   * fair trade for a fallback whose job is finding a way round at all.
   */
  weight: number,
): RouteFound | typeof SEALED | undefined {
  const toCell = (value: number) => Math.round(value / BOARD_GRID);
  // A card wired to itself routes with 90° turns only (no diagonal exits,
  // landings or runs): a 45° loop turning back on itself reads as a scribble.
  const straightOnly =
    !T.diagonals || request.distanceCells < T.diagonalDistanceCells ||
    (request.sourceCardId !== undefined && request.sourceCardId === request.targetCardId);
  const sourceAprons = sources.map(apronPoint);
  const targetAprons = targets.map(apronPoint);
  const stops = waypoints.map((point) => ({ x: snapLine(point.x), y: snapLine(point.y) }));

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of [...sourceAprons, ...targetAprons, ...stops]) {
    if (point.x < left) left = point.x;
    if (point.x > right) right = point.x;
    if (point.y < top) top = point.y;
    if (point.y > bottom) bottom = point.y;
  }
  // The window is the ends' own box plus the pad: with turns and crossings
  // priced, the search sweeps most of its window whatever the heuristic
  // says, so the window IS the cost. A wire that cannot route inside it
  // gets a bigger one (WINDOW_GROWTH), not every wire a big one.
  // Clamped to the board's own extent (plus a cell): growing past the
  // last card adds nothing a wire could use.
  const board = context.board;
  const cx0 = Math.max(toCell(left - pad), board.x0);
  const cx1 = Math.min(toCell(right + pad), board.x0 + board.width - 1);
  const cy0 = Math.max(toCell(top - pad), board.y0);
  const cy1 = Math.min(toCell(bottom + pad), board.y0 + board.height - 1);
  const width = cx1 - cx0 + 1;
  const height = cy1 - cy0 + 1;
  const vertexCount = width * height;
  const stateCount = vertexCount * 8;
  const maxPops = Math.max(MIN_ASTAR_POPS, stateCount * ASTAR_POPS_PER_STATE);

  // Per-vertex flags. Blocked: strictly inside a margin-inflated card (the
  // margin boundary itself stays legal). Exempt/home: on or inside a frame.
  ensureCellPool(vertexCount);
  const blocked = cellBlocked;
  const exemptFlag = cellExempt;
  const homeFlag = cellHome;
  blocked.fill(0, 0, vertexCount);
  const hasExempt = exemptRects.length > 0;
  const hasHome = homeRects.length > 0;
  if (hasExempt) exemptFlag.fill(0, 0, vertexCount);
  if (hasHome) homeFlag.fill(0, 0, vertexCount);
  const vertexAt = (xi: number, yi: number) => xi * height + yi;
  const fillRect = (flags: Uint8Array, rect: GridObstacle, inflate: number, strict: boolean) => {
    // Cells whose coordinate lies within (strict) or on (loose) the rect.
    const epsilon = strict ? 1e-6 : -1e-6;
    const xa = Math.max(Math.ceil((rect.left - inflate + epsilon) / BOARD_GRID), cx0);
    const xb = Math.min(Math.floor((rect.right + inflate - epsilon) / BOARD_GRID), cx1);
    const ya = Math.max(Math.ceil((rect.top - inflate + epsilon) / BOARD_GRID), cy0);
    const yb = Math.min(Math.floor((rect.bottom + inflate - epsilon) / BOARD_GRID), cy1);
    for (let x = xa; x <= xb; x += 1) {
      for (let y = ya; y <= yb; y += 1) {
        flags[vertexAt(x - cx0, y - cy0)] = 1;
      }
    }
  };
  for (const obstacle of obstacles) {
    fillRect(blocked, obstacle, WIRE_NODE_MARGIN, true);
  }
  for (const rect of exemptRects) {
    fillRect(exemptFlag, rect, 0, false);
  }
  for (const rect of homeRects) {
    fillRect(homeFlag, rect, 0, false);
  }

  const inWindow = (xi: number, yi: number) => xi >= 0 && xi < width && yi >= 0 && yi < height;

  // Steps are undirected and keyed by their lower vertex: (vertex x 4 + k)
  // for k = 0 E, 1 SE, 2 S, 3 SW. Priced lazily, once per attempt.
  const stepGeneration = acquireStepGeneration(vertexCount * 4);
  const stepStamp = stepPoolStamp;
  const stepCosts = stepPoolCost;
  /** Cost of the step from (xi,yi) in direction dir, or STEP_BLOCKED. */
  const priceStep = (xi: number, yi: number, dir: number): number => {
    const nxi = xi + DIR_DX[dir];
    const nyi = yi + DIR_DY[dir];
    if (!inWindow(nxi, nyi)) {
      return STEP_BLOCKED;
    }
    // Canonical orientation: E, SE, S, SW from the lower vertex.
    const stepIndex = dir < 4 ? vertexAt(xi, yi) * 4 + dir : vertexAt(nxi, nyi) * 4 + (dir - 4);
    if (stepStamp[stepIndex] === stepGeneration) {
      return stepCosts[stepIndex];
    }
    stepStamp[stepIndex] = stepGeneration;
    workPriced += 1;
    const a = vertexAt(xi, yi);
    const b = vertexAt(nxi, nyi);
    let free = blocked[a] === 0 && blocked[b] === 0 && (T.diagonals || (dir & 1) === 0);
    if (free && (dir & 1) === 1) {
      // No corner cutting: a diagonal needs both orthogonal neighbours free.
      free = blocked[vertexAt(nxi, yi)] === 0 && blocked[vertexAt(xi, nyi)] === 0;
    }
    if (!free) {
      stepCosts[stepIndex] = STEP_BLOCKED;
      return STEP_BLOCKED;
    }
    const axis = DIR_AXIS[dir];
    const capacity = axis >= 2 ? T.diagonalLaneCapacity : LANE_CAPACITY;
    const used = context.occupancy.usedWidth(axis, xi + cx0, yi + cy0, nxi + cx0, nyi + cy0);
    const fits = used === 0 || used + LANE_GAP + request.strokeWidth <= capacity;
    const factor = used === 0 ? T.costEmpty : fits ? T.costShared : T.costOverflow;
    // Loitering in a frame the wire is leaving costs; so does straying out
    // of the frame it lives in.
    let framePenalty = 1;
    if (hasExempt && (exemptFlag[a] === 1 || exemptFlag[b] === 1)) {
      framePenalty = T.costInsideExempt;
    } else if (hasHome && (homeFlag[a] === 0 || homeFlag[b] === 0)) {
      framePenalty = T.costOutsideHome;
    }
    // Only centre crossings are undirected. Vertex crossings depend on
    // the arrival AND departure headings and are charged in the search.
    const crossings = context.occupancy.centreCrossings(
      axis,
      xi + cx0,
      yi + cy0,
      nxi + cx0,
      nyi + cy0,
    );
    const cost = DIR_LENGTH[dir] * factor * framePenalty + crossings * T.crossing;
    stepCosts[stepIndex] = cost;
    return cost;
  };

  const vertexOf = (point: GridPoint): number | undefined => {
    const xi = toCell(point.x) - cx0;
    const yi = toCell(point.y) - cy0;
    return inWindow(xi, yi) ? vertexAt(xi, yi) : undefined;
  };

  // Ends: the apron (one cell out) and the clean point (T.cleanCells out
  // along the normal), when the straight run to it is open.
  interface EndVertex {
    endpointIndex: number;
    apron: number;
    clean: number | undefined;
    /** The direction the stub leaves the card in: the port's normal or 45° either side of it. */
    outward: number;
    /** Cost of the straight run apron -> clean point. */
    cleanCost: number;
    /**
     * A diagonal exit is priced as the 45° bend it is, at the dock; otherwise
     * "out at 45°, one bend, straight in" beats a plain two-cell jog and short
     * wires come out sideways.
     */
    exitCost: number;
  }
  const endVertices = (endpoints: GridEndpoint[]): EndVertex[] => {
    const list: EndVertex[] = [];
    for (let i = 0; i < endpoints.length; i += 1) {
      const normal = outwardDirection(endpoints[i].side);
      const dockX = toCell(endpoints[i].x) - cx0;
      const dockY = toCell(endpoints[i].y) - cy0;
      for (const outward of straightOnly ? [normal] : [normal, (normal + 1) % 8, (normal + 7) % 8]) {
        const apronX = dockX + DIR_DX[outward];
        const apronY = dockY + DIR_DY[outward];
        if (!inWindow(apronX, apronY)) {
          continue;
        }
        const apron = vertexAt(apronX, apronY);
        if (blocked[apron] === 1) {
          continue;
        }
        let clean: number | undefined = apron;
        let cleanCost = 0;
        const cleanCells = outward === normal ? T.cleanCells : Math.max(2, T.cleanCells);
        for (let step = 1; step < cleanCells && clean !== undefined; step += 1) {
          const xi = Math.floor(clean / height);
          const yi = clean % height;
          const cost = priceStep(xi, yi, outward);
          if (cost === STEP_BLOCKED) {
            clean = undefined;
          } else {
            clean = vertexAt(xi + DIR_DX[outward], yi + DIR_DY[outward]);
            cleanCost += cost;
          }
        }
        // Never offer a one-cell diagonal stub, even in a tight corridor.
        if (outward !== normal && clean === undefined) continue;
        list.push({
          endpointIndex: i,
          apron,
          clean: clean === apron ? undefined : clean,
          outward,
          cleanCost,
          exitCost: outward === normal ? 0 : T.turn45,
        });
      }
    }
    return list;
  };
  const starts = endVertices(sources);
  const ends = endVertices(targets);
  if (starts.length === 0 || ends.length === 0) {
    return undefined;
  }
  const stopVertices: number[] = [];
  for (const stop of stops) {
    const vertex = vertexOf(stop);
    if (vertex === undefined || blocked[vertex] === 1) {
      return undefined;
    }
    stopVertices.push(vertex);
  }

  /**
   * Cost-free flood over free steps from a seed set: does it reach any of
   * `wanted`, and does it touch the window border? Four-connected: a
   * diagonal step needs both orthogonal neighbours free anyway, so it never
   * reaches anything the orthogonal steps cannot.
   */
  const flood = (
    seedVertices: Iterable<number>,
    wanted: Set<number>,
  ): { reached: boolean; touchedBorder: boolean } => {
    const generation = acquireFloodGeneration(vertexCount);
    const stamp = floodPoolStamp;
    const queue = floodPoolQueue;
    let head = 0;
    let tail = 0;
    let touchedBorder = false;
    for (const seed of seedVertices) {
      if (stamp[seed] !== generation) {
        stamp[seed] = generation;
        queue[tail] = seed;
        tail += 1;
      }
    }
    while (head < tail) {
      const vertex = queue[head];
      head += 1;
      if (wanted.has(vertex)) {
        return { reached: true, touchedBorder };
      }
      const xi = Math.floor(vertex / height);
      const yi = vertex % height;
      if (xi === 0 || yi === 0 || xi === width - 1 || yi === height - 1) {
        touchedBorder = true;
      }
      for (let dir = 0; dir < 8; dir += 2) {
        if (priceStep(xi, yi, dir) === STEP_BLOCKED) {
          continue;
        }
        const next = vertexAt(xi + DIR_DX[dir], yi + DIR_DY[dir]);
        if (stamp[next] !== generation) {
          stamp[next] = generation;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    return { reached: false, touchedBorder };
  };
  // A direct wire (no stops) is checked for reachability before the A*
  // spends anything on it. Unreachable, and either end's region never
  // touches the border: sealed, no window will do. Unreachable but both
  // regions reach the border: the way round lies outside, so grow.
  if (stopVertices.length === 0) {
    const startSet = new Set(starts.map((start) => start.apron));
    const goalSet = new Set(ends.map((end) => end.apron));
    const fromStarts = flood(startSet, goalSet);
    if (!fromStarts.reached) {
      if (!fromStarts.touchedBorder) {
        return SEALED;
      }
      const fromGoals = flood(goalSet, startSet);
      return fromGoals.touchedBorder ? undefined : SEALED;
    }
  }

  interface LegSeed {
    state: number;
    g: number;
    startIndex: number;
  }
  interface LegGoal {
    vertex: number;
    /** Required arrival direction, or -1 for any. */
    dir: number;
    penalty: number;
    endpointIndex: number;
    /** Vertices to append after the goal (the clean run into the apron). */
    tail: number[];
    /** A dock of the target card (not a waypoint stop). */
    landing?: boolean;
  }
  // A self loop must land at least SELF_LOOP_CELLS from where it left, or the
  // cheapest loop is a dock beside its own and the wire is an unreadable stub.
  const selfLoop = request.sourceCardId !== undefined && request.sourceCardId === request.targetCardId;
  const SELF_LOOP_CELLS = 1;
  /**
   * THE CLEAN RUN, by start: the apron and the cells after it up to the clean
   * point (T.cleanCells out from the card edge). A turn made ON one of these,
   * by a wire that left from that start, costs `earlyTurn` on top of the turn.
   * A wire that never turns there pays nothing, so a straight shot to a card
   * two cells away stays a cheap straight line.
   */
  const cleanZone = new Map<number, number[]>();
  const landsTooClose = (startIndex: number, goal: LegGoal): boolean => {
    if (!selfLoop || !goal.landing) {
      return false;
    }
    const start = starts[startIndex];
    if (!start) {
      return false;
    }
    const dx = Math.floor(start.apron / height) - Math.floor(goal.vertex / height);
    const dy = (start.apron % height) - (goal.vertex % height);
    return Math.max(Math.abs(dx), Math.abs(dy)) < SELF_LOOP_CELLS;
  };
  interface LegResult {
    startIndex: number;
    arrivalDir: number;
    vertices: number[];
    goal: LegGoal;
    cost: number;
  }

  /**
   * One A* leg over the grid. Seeds are (vertex, direction) states with
   * starting costs; goals name a vertex, the direction it must be reached
   * in, and a penalty paid on finishing there. The best (g + penalty) goal
   * wins, not the first popped.
   */
  const searchLeg = (seeds: LegSeed[], goals: LegGoal[]): LegResult | undefined => {
    workSearches += 1;
    const goalsByVertex = new Map<number, LegGoal[]>();
    let goalLeft = Infinity;
    let goalRight = -Infinity;
    let goalTop = Infinity;
    let goalBottom = -Infinity;
    for (const goal of goals) {
      const list = goalsByVertex.get(goal.vertex);
      if (list) {
        list.push(goal);
      } else {
        goalsByVertex.set(goal.vertex, [goal]);
      }
      const xi = Math.floor(goal.vertex / height);
      const yi = goal.vertex % height;
      if (xi < goalLeft) goalLeft = xi;
      if (xi > goalRight) goalRight = xi;
      if (yi < goalTop) goalTop = yi;
      if (yi > goalBottom) goalBottom = yi;
    }
    // Octile distance to the goal set's bounding box, plus one 45° bend
    // when the box is not straight ahead in the state's own direction: a
    // lower bound on any path's cost, so admissibility holds - and a much
    // tighter one than distance alone once turns cost real money, which is
    // what keeps the search from sweeping the whole window.
    const minTurn = Math.min(T.turn45, T.turn90);
    const heuristic = (state: number): number => {
      const vertex = state >> 3;
      const dir = state & 7;
      const xi = Math.floor(vertex / height);
      const yi = vertex % height;
      const dx = xi < goalLeft ? goalLeft - xi : xi > goalRight ? xi - goalRight : 0;
      const dy = yi < goalTop ? goalTop - yi : yi > goalBottom ? yi - goalBottom : 0;
      const diagonal = dx < dy ? dx : dy;
      const straight = (dx > dy ? dx : dy) - diagonal;
      let cost = (straight * BOARD_GRID + diagonal * DIAGONAL_LENGTH) * T.costEmpty * weight;
      if (dx !== 0 || dy !== 0) {
        // Does a ray from here in `dir` hit the box? Intersect the ray
        // parameter intervals per axis.
        const ddx = DIR_DX[dir];
        const ddy = DIR_DY[dir];
        let lo = 0;
        let hi = Infinity;
        if (ddx === 0) {
          if (xi < goalLeft || xi > goalRight) hi = -1;
        } else {
          const a = (goalLeft - xi) / ddx;
          const b = (goalRight - xi) / ddx;
          lo = Math.max(lo, Math.min(a, b));
          hi = Math.min(hi, Math.max(a, b));
        }
        if (ddy === 0) {
          if (yi < goalTop || yi > goalBottom) hi = -1;
        } else {
          const a = (goalTop - yi) / ddy;
          const b = (goalBottom - yi) / ddy;
          lo = Math.max(lo, Math.min(a, b));
          hi = Math.min(hi, Math.max(a, b));
        }
        if (hi < lo) {
          cost += minTurn;
        }
      }
      return cost;
    };

    const generation = acquireSearchGeneration(stateCount);
    const stamp = searchPoolStamp;
    const gScores = searchPoolG;
    const cameFrom = searchPoolCameFrom;
    const startOf = searchPoolStartOf;
    const touch = (state: number) => {
      if (stamp[state] !== generation) {
        stamp[state] = generation;
        gScores[state] = Infinity;
        cameFrom[state] = -1;
        startOf[state] = -1;
      }
    };

    let heapSize = 0;
    let seq = 0;
    // The open set: a binary heap on (f, g, seq), seq unique - so the pop
    // order is a total order and any correct heap yields the same route.
    // Sifting moves a HOLE instead of swapping four arrays at every level,
    // which halved the heap's share of a solve.
    const before = (f: number, g: number, s: number, i: number): boolean => {
      const fi = searchHeapF[i];
      if (f !== fi) return f < fi;
      const gi = searchHeapG[i];
      if (g !== gi) return g < gi;
      return s < searchHeapSeq[i];
    };
    const push = (f: number, g: number, state: number) => {
      ensureSearchHeapCapacity(heapSize + 1);
      let i = heapSize;
      heapSize += 1;
      const s = (seq += 1);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!before(f, g, s, parent)) break;
        searchHeapF[i] = searchHeapF[parent];
        searchHeapG[i] = searchHeapG[parent];
        searchHeapState[i] = searchHeapState[parent];
        searchHeapSeq[i] = searchHeapSeq[parent];
        i = parent;
      }
      searchHeapF[i] = f;
      searchHeapG[i] = g;
      searchHeapState[i] = state;
      searchHeapSeq[i] = s;
    };
    let popF = 0;
    let popG = 0;
    let popState = 0;
    const pop = (): boolean => {
      if (heapSize === 0) {
        return false;
      }
      popF = searchHeapF[0];
      popG = searchHeapG[0];
      popState = searchHeapState[0];
      heapSize -= 1;
      if (heapSize > 0) {
        const f = searchHeapF[heapSize];
        const g = searchHeapG[heapSize];
        const state = searchHeapState[heapSize];
        const s = searchHeapSeq[heapSize];
        let i = 0;
        for (;;) {
          let child = i * 2 + 1;
          if (child >= heapSize) break;
          const right = child + 1;
          if (right < heapSize && before(searchHeapF[right], searchHeapG[right], searchHeapSeq[right], child)) {
            child = right;
          }
          if (before(f, g, s, child)) break;
          searchHeapF[i] = searchHeapF[child];
          searchHeapG[i] = searchHeapG[child];
          searchHeapState[i] = searchHeapState[child];
          searchHeapSeq[i] = searchHeapSeq[child];
          i = child;
        }
        searchHeapF[i] = f;
        searchHeapG[i] = g;
        searchHeapState[i] = state;
        searchHeapSeq[i] = s;
      }
      return true;
    };

    for (const seed of seeds) {
      touch(seed.state);
      if (seed.g < gScores[seed.state]) {
        gScores[seed.state] = seed.g;
        startOf[seed.state] = seed.startIndex;
        push(seed.g + heuristic(seed.state), seed.g, seed.state);
      }
    }

    let goalState = -1;
    let goalCost = Infinity;
    let goalHit: LegGoal | undefined;
    let pops = 0;
    while (pop()) {
      const currentF = popF;
      const currentG = popG;
      const currentState = popState;
      if (currentF >= goalCost) {
        break;
      }
      if (currentG > gScores[currentState] + 1e-9) {
        continue;
      }
      pops += 1;
      workPops += 1;
      if (pops > maxPops) {
        return undefined;
      }
      const vertex = currentState >> 3;
      const currentDir = currentState & 7;
      const here = goalsByVertex.get(vertex);
      if (here) {
        for (const goal of here) {
          if (goal.dir !== -1 && goal.dir !== currentDir) {
            continue;
          }
          if (landsTooClose(startOf[currentState], goal)) {
            continue;
          }
          const source = sources[starts[startOf[currentState]].endpointIndex];
          const target = targets[goal.endpointIndex];
          let dockCost = goal.landing ? crampedDockCost(request, source, target) : 0;
          if (dockCost > 0) {
            const normal = outwardDirection(source.side);
            const aligned = DIR_DX[normal] === 0 ? source.x === target.x : source.y === target.y;
            if (aligned && outwardDirection(target.side) === (normal + 4) % 8) {
              // Exempt the actual straight path, not just aligned docks:
              // an obstacle between them can still force a bent route.
              let state = currentState;
              while (state >= 0 && (state & 7) === normal) state = cameFrom[state];
              if (state < 0) dockCost = 0;
            }
          }
          const cost = currentG + goal.penalty + dockCost;
          if (cost < goalCost) {
            goalCost = cost;
            goalState = currentState;
            goalHit = goal;
          }
        }
        // No break, no skip: goal vertices are ordinary vertices that other
        // routes (and cheaper docks past this one) travel through.
      }

      const xi = Math.floor(vertex / height);
      const yi = vertex % height;
      // Leaving an occupied lane at this vertex is half a crossing: the
      // wire may have to weave across its lane-mate to get off. Joining
      // one is the other half. The search cannot see which side of the
      // lane-mate the wire will be packed on, and charging the weave both
      // ways keeps wires off each other's shoulders, which is the look
      // wanted anyway - ribbons run a lane apart.
      const leaveWeave =
        context.occupancy.usedWidth(DIR_AXIS[currentDir], xi + cx0, yi + cy0, xi + cx0, yi + cy0) > 0
          ? T.crossing / 2
          : 0;
      const zoneStarts = cleanZone.get(vertex);
      const earlyTurn =
        zoneStarts !== undefined && zoneStarts.includes(startOf[currentState]) ? T.earlyTurn : 0;
      for (let dir = 0; dir < 8; dir += 1) {
        if (straightOnly && (dir & 1) === 1) {
          continue;
        }
        const turn = TURN_COSTS[currentDir * 8 + dir];
        if (turn !== turn) {
          continue;
        }
        let stepCost = priceStep(xi, yi, dir);
        if (stepCost === STEP_BLOCKED) {
          continue;
        }
        // Enter a diagonal with two checked cells, then extend it one cell
        // at a time. This forbids tiny bevels without excluding odd lengths
        // or adding another dimension to the search state.
        const steps = (dir & 1) === 1 && dir !== currentDir ? 2 : 1;
        if (steps === 2) {
          const secondCost = priceStep(xi + DIR_DX[dir], yi + DIR_DY[dir], dir);
          if (secondCost === STEP_BLOCKED) continue;
          stepCost += secondCost;
        }
        let weave = 0;
        if (dir !== currentDir) {
          weave = leaveWeave + earlyTurn;
          if (context.occupancy.usedWidth(DIR_AXIS[dir], xi + cx0, yi + cy0, xi + cx0, yi + cy0) > 0) {
            weave += T.crossing / 2;
          }
        }
        const nextState = (vertexAt(xi + DIR_DX[dir] * steps, yi + DIR_DY[dir] * steps) << 3) | dir;
        const cornerCost = context.occupancy.cornerCrossings(xi + cx0, yi + cy0, currentDir, dir) * T.crossing;
        const nextG = currentG + stepCost + turn + weave + cornerCost;
        touch(nextState);
        if (nextG < gScores[nextState] - 1e-9) {
          gScores[nextState] = nextG;
          cameFrom[nextState] = currentState;
          startOf[nextState] = startOf[currentState];
          push(nextG + heuristic(nextState), nextG, nextState);
        }
      }
    }

    if (goalState < 0 || !goalHit) {
      return undefined;
    }
    const chain: number[] = [];
    for (let state = goalState; state >= 0; state = cameFrom[state]) {
      chain.push(state >> 3);
    }
    chain.reverse();
    return {
      startIndex: startOf[goalState],
      arrivalDir: goalState & 7,
      vertices: chain,
      goal: goalHit,
      cost: goalCost,
    };
  };

  // Seeds: leaving straight along the port's normal. The clean point (two
  // cells out) is free to turn from; the apron is seeded too, dearer by the
  // early-turn cost, for the wire that has nowhere else to go.
  let seeds: LegSeed[] = [];
  // startIndex is the index into `starts` (a dock AND an exit angle); the
  // endpoint behind it is starts[startIndex].endpointIndex.
  starts.forEach((start, variant) => {
    // Leaving along a lane another wire already rides is half a weave,
    // like turning onto one: stacked docks are not free.
    const apronX = Math.floor(start.apron / height) + cx0;
    const apronY = (start.apron % height) + cy0;
    const stacked =
      context.occupancy.usedWidth(DIR_AXIS[start.outward], apronX, apronY, apronX, apronY) > 0
        ? T.crossing / 2
        : 0;
    const penalty = (sources[start.endpointIndex]?.penalty ?? 0) + stacked + start.exitCost;
    seeds.push({
      state: (((start.outward & 1) === 1 ? start.clean! : start.apron) << 3) | start.outward,
      g: penalty + ((start.outward & 1) === 1 ? start.cleanCost : 0),
      startIndex: variant,
    });
    let zx = Math.floor(start.apron / height);
    let zy = start.apron % height;
    for (let cell = 1; cell < T.cleanCells && inWindow(zx, zy); cell += 1) {
      const zone = vertexAt(zx, zy);
      const list = cleanZone.get(zone);
      if (list) list.push(variant);
      else cleanZone.set(zone, [variant]);
      zx += DIR_DX[start.outward];
      zy += DIR_DY[start.outward];
    }
  });

  const mergedVertices: number[] = [];
  let sourceIndex: number | undefined;
  let totalCost = 0;
  const takeLeg = (leg: LegResult) => {
    const continuing = mergedVertices.length > 0;
    if (sourceIndex === undefined) {
      sourceIndex = leg.startIndex;
    }
    // A leg after the first starts where the last one ended.
    mergedVertices.push(...(continuing ? leg.vertices.slice(1) : leg.vertices));
  };
  for (const stopVertex of stopVertices) {
    const leg = searchLeg(seeds, [
      { vertex: stopVertex, dir: -1, penalty: 0, endpointIndex: 0, tail: [] },
    ]);
    if (!leg) {
      return undefined;
    }
    takeLeg(leg);
    totalCost += leg.cost;
    // Preserve arrival direction: the next search prices the actual turn
    // and enforces its minimum diagonal run, including at a pinned dot.
    seeds = [{ state: (stopVertex << 3) | leg.arrivalDir, g: 0, startIndex: leg.startIndex }];
  }

  // Goals: landing straight. The clean point must be reached heading in
  // along the normal; the apron takes any arrival, dearer by the early-turn
  // cost.
  const goals: LegGoal[] = [];
  for (const end of ends) {
    const apronX = Math.floor(end.apron / height) + cx0;
    const apronY = (end.apron % height) + cy0;
    const stacked =
      context.occupancy.usedWidth(DIR_AXIS[end.outward], apronX, apronY, apronX, apronY) > 0
        ? T.crossing / 2
        : 0;
    const penalty = (targets[end.endpointIndex]?.penalty ?? 0) + stacked + end.exitCost;
    goals.push({
      vertex: (end.outward & 1) === 1 ? end.clean! : end.apron,
      dir: -1,
      penalty: penalty + T.earlyTurn + ((end.outward & 1) === 1 ? end.cleanCost : 0),
      endpointIndex: end.endpointIndex,
      tail: (end.outward & 1) === 1 ? [end.apron] : [],
      landing: true,
    });
    if (end.clean === undefined) {
      // No room for a clean run (the far card is right there): arriving
      // straight is still clean, and only a turn pays the surcharge.
      goals.push({
        vertex: end.apron,
        dir: (end.outward + 4) % 8,
        penalty,
        endpointIndex: end.endpointIndex,
        tail: [],
        landing: true,
      });
    } else {
      goals.push({
        vertex: end.clean,
        dir: (end.outward + 4) % 8,
        penalty: penalty + end.cleanCost,
        endpointIndex: end.endpointIndex,
        tail: [end.apron],
        landing: true,
      });
    }
  }
  const finalLeg = searchLeg(seeds, goals);
  if (!finalLeg) {
    return undefined;
  }
  takeLeg(finalLeg);
  totalCost += finalLeg.cost;
  mergedVertices.push(...finalLeg.goal.tail);

  const startVariant = starts[sourceIndex ?? finalLeg.startIndex];
  if (startVariant && (startVariant.outward & 1) === 1) {
    mergedVertices.unshift(startVariant.apron);
  }
  const source = sources[startVariant?.endpointIndex ?? 0] ?? sources[0];
  const target = targets[finalLeg.goal.endpointIndex] ?? targets[0];
  const points = mergedVertices.map((vertex) => ({
    x: Math.floor(vertex / height) + cx0,
    y: (vertex % height) + cy0,
  }));
  return { source, target, vertices: compactPoints(points), cost: totalCost };
}

/* ------------------------------------------------------------------ */
/* Lane claiming and the final polyline                                */
/* ------------------------------------------------------------------ */

interface AssembledRoute {
  points: GridPoint[];
  crossings: number;
  overflowed: boolean;
}

interface Run {
  axis: Axis;
  /** Unit direction, in cells. */
  dx: number;
  dy: number;
  /** First and last vertex, in cells. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Sideways offset of the drawn line from the grid line, in px. */
  offset: number;
}

/** A point on a run's drawn line, from a vertex on its grid line. */
function drawnPoint(run: Run, x: number, y: number): GridPoint {
  const length = Math.hypot(run.dx, run.dy);
  const nx = -run.dy / length;
  const ny = run.dx / length;
  return { x: x * BOARD_GRID + nx * run.offset, y: y * BOARD_GRID + ny * run.offset };
}

/** Where two drawn lines meet; undefined when parallel. */
function intersectLines(
  p: GridPoint,
  u: { x: number; y: number },
  q: GridPoint,
  v: { x: number; y: number },
): GridPoint | undefined {
  const denominator = u.x * v.y - u.y * v.x;
  if (Math.abs(denominator) < 1e-9) {
    return undefined;
  }
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / denominator;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * Turns the vertex chain into the drawn polyline: every straight run claims
 * its slice of its lane and shifts sideways to it, corners re-join where the
 * neighbouring drawn lines meet, and the true anchors go on the ends. The
 * stubs - anchor to first/last corner - stay at the anchor's exact
 * coordinate, so a wire always leaves a port dead straight.
 */
function claimAndAssemble(
  context: SolveContext,
  request: PlannedRequest,
  found: RouteFound,
): AssembledRoute {
  const { source, target, vertices } = found;
  if (vertices.length === 0) {
    return { points: [], crossings: 0, overflowed: false };
  }
  const firstVertex = vertices[0];
  const lastVertex = vertices[vertices.length - 1];
  // The stubs run from the docks to the aprons the search chose: the
  // port's normal, or 45° to either side of it.
  const dirOf = (fromX: number, fromY: number, toX: number, toY: number, fallback: number): number => {
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    const dir = DIR_DX.findIndex((x, d) => x === dx && DIR_DY[d] === dy);
    return dir < 0 ? fallback : dir;
  };
  const sourceDir = dirOf(
    Math.round(source.x / BOARD_GRID),
    Math.round(source.y / BOARD_GRID),
    firstVertex.x,
    firstVertex.y,
    outwardDirection(source.side),
  );
  const targetDir = dirOf(
    Math.round(target.x / BOARD_GRID),
    Math.round(target.y / BOARD_GRID),
    lastVertex.x,
    lastVertex.y,
    outwardDirection(target.side),
  );
  const sourceAxis = DIR_AXIS[sourceDir];
  const targetAxis = DIR_AXIS[targetDir];
  const sourceTip = stubTip(source);
  const targetTip = stubTip(target);
  const sourceApron = { x: firstVertex.x * BOARD_GRID, y: firstVertex.y * BOARD_GRID };
  const targetApron = { x: lastVertex.x * BOARD_GRID, y: lastVertex.y * BOARD_GRID };

  // The stubs pass straight through their apron vertices.
  let crossings = 0;
  crossings += context.occupancy.stepCrossings(
    sourceAxis,
    firstVertex.x,
    firstVertex.y,
    firstVertex.x,
    firstVertex.y,
    false,
  );
  crossings += context.occupancy.stepCrossings(
    targetAxis,
    lastVertex.x,
    lastVertex.y,
    lastVertex.x,
    lastVertex.y,
    false,
  );
  context.occupancy.markStub(sourceAxis, firstVertex.x, firstVertex.y, request.edgeId);
  context.occupancy.markStub(targetAxis, lastVertex.x, lastVertex.y, request.edgeId);

  // No moves at all: the two aprons share a vertex (adjacent ports). Pure
  // stub work, nothing claims a lane.
  if (vertices.length === 1) {
    return {
      points: compactPoints([sourceTip, { x: source.x, y: source.y }, sourceApron, { x: target.x, y: target.y }, targetTip]),
      crossings,
      overflowed: false,
    };
  }

  const runs: Run[] = [];
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const axis: Axis = dy === 0 ? 0 : dx === 0 ? 1 : dx === dy ? 2 : 3;
    runs.push({ axis, dx, dy, x0: a.x, y0: a.y, x1: b.x, y1: b.y, offset: 0 });
  }

  // Which side of its lane each run should sit on: the side of the turn at
  // the run's end (the last run turns toward its target anchor). A wire
  // that will peel off to the right rides the right of a shared bundle, so
  // leaving never means crossing over a lane-mate.
  const departureFor = (index: number): number => {
    const run = runs[index];
    let nx: number;
    let ny: number;
    if (index + 1 < runs.length) {
      nx = runs[index + 1].dx;
      ny = runs[index + 1].dy;
    } else {
      nx = targetTip.x - targetApron.x;
      ny = targetTip.y - targetApron.y;
    }
    const departure = Math.sign(run.dx * ny - run.dy * nx);
    // The side the wire ARRIVED from, the same way: the previous run lies
    // behind the corner. When it agrees with the departure side the wire
    // sits there and never has to cross a lane-mate; when the two
    // disagree a weave is unavoidable and the departure side wins.
    let px: number;
    let py: number;
    if (index > 0) {
      px = runs[index - 1].dx;
      py = runs[index - 1].dy;
    } else {
      px = sourceApron.x - sourceTip.x;
      py = sourceApron.y - sourceTip.y;
    }
    const arrival = -Math.sign(run.dx * py - run.dy * px);
    if (departure === 0) {
      return arrival;
    }
    return departure;
  };
  let overflowed = false;
  runs.forEach((run, index) => {
    const claimed: ClaimedRun = { axis: run.axis, x0: run.x0, y0: run.y0, x1: run.x1, y1: run.y1 };
    const steps = Math.max(Math.abs(run.x1 - run.x0), Math.abs(run.y1 - run.y0));
    for (let i = 1; i <= steps; i += 1) {
      crossings += context.occupancy.stepCrossings(
        run.axis,
        run.x0 + run.dx * (i - 1),
        run.y0 + run.dy * (i - 1),
        run.x0 + run.dx * i,
        run.y0 + run.dy * i,
        false,
      );
    }
    const existing = context.occupancy.claimsAlong(claimed);
    const packed = packIntoLane(
      existing,
      request.strokeWidth,
      departureFor(index),
      run.axis >= 2 ? T.diagonalLaneCapacity : LANE_CAPACITY,
    );
    if (packed.overflowed) {
      overflowed = true;
    }
    run.offset = (packed.claim.lo + packed.claim.hi) / 2;
    context.occupancy.claim(claimed, packed.claim, request.edgeId);
    context.occupancy.markRun(claimed, request.edgeId);
  });

  const points: GridPoint[] = [sourceTip];

  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1], next = runs[i];
    const incoming = DIR_DX.findIndex((dx, d) => dx === prev.dx && DIR_DY[d] === prev.dy);
    const outgoing = DIR_DX.findIndex((dx, d) => dx === next.dx && DIR_DY[d] === next.dy);
    context.occupancy.markCorner(next.x0, next.y0, incoming, outgoing, request.edgeId);
  }

  // Source stub onto the first run. Along the normal (the usual clean
  // exit): straight to the apron at the port's own coordinate, then a jog
  // onto the packed lane. Any other way: straight out along the normal
  // until it meets the run's drawn line.
  const first = runs[0];
  const outX = DIR_DX[sourceDir];
  const outY = DIR_DY[sourceDir];
  if (first.dx === outX && first.dy === outY) {
    points.push(sourceApron, drawnPoint(first, first.x0, first.y0));
  } else {
    const met = intersectLines(
      { x: source.x, y: source.y },
      { x: outX, y: outY },
      drawnPoint(first, first.x0, first.y0),
      { x: first.dx, y: first.dy },
    );
    points.push(met ?? drawnPoint(first, first.x0, first.y0));
  }

  // Interior corners: where neighbouring drawn lines meet. Two consecutive
  // runs along the SAME line in opposite directions are a reversal - a
  // waypoint excursion turning around - so the corner is the turnaround
  // vertex, with a small jog between the two runs' lane slots.
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const runA = runs[i];
    const runB = runs[i + 1];
    const met = intersectLines(
      drawnPoint(runA, runA.x0, runA.y0),
      { x: runA.dx, y: runA.dy },
      drawnPoint(runB, runB.x0, runB.y0),
      { x: runB.dx, y: runB.dy },
    );
    if (met) {
      points.push(met);
    } else {
      points.push(drawnPoint(runA, runA.x1, runA.y1), drawnPoint(runB, runB.x0, runB.y0));
    }
  }

  // Target stub off the last run, mirroring the source.
  const last = runs[runs.length - 1];
  const inX = -DIR_DX[targetDir];
  const inY = -DIR_DY[targetDir];
  if (last.dx === inX && last.dy === inY) {
    points.push(drawnPoint(last, last.x1, last.y1), targetApron);
  } else {
    const met = intersectLines(
      { x: target.x, y: target.y },
      { x: inX, y: inY },
      drawnPoint(last, last.x1, last.y1),
      { x: last.dx, y: last.dy },
    );
    points.push(met ?? drawnPoint(last, last.x1, last.y1));
  }
  points.push(targetTip);

  return { points: compactPoints(points), crossings, overflowed };
}

/**
 * The drawn anchor: the endpoint pushed `stubDepth` further into the card,
 * along the side's inward normal. See GridEndpoint.stubDepth.
 */
function stubTip(endpoint: GridEndpoint): GridPoint {
  const depth = endpoint.stubDepth ?? 0;
  if (depth <= 0) {
    return { x: endpoint.x, y: endpoint.y };
  }
  const dir = outwardDirection(endpoint.side);
  return { x: endpoint.x - DIR_DX[dir] * depth, y: endpoint.y - DIR_DY[dir] * depth };
}

/**
 * Proper crossings between the routes of different wires, and their total
 * length in px: the two numbers a layout is judged by (crossings first).
 * Touching ends and T-junctions do not count as crossings.
 */
export function measureRoutes(routes: Iterable<GridRoutedEdge>): ReturnType<typeof measureWireRoutes> {
  return measureWireRoutes(routes);
}

/**
 * Drops zero-length and collinear intermediate points - but ONLY when the
 * direction of travel is preserved. A point where the wire REVERSES along
 * the same line (a waypoint excursion: out to a dot and back the way it
 * came) is a real turnaround, and merging it would swallow the excursion.
 */
export function compactPoints(points: GridPoint[]): GridPoint[] {
  const kept: GridPoint[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 0.01 && Math.abs(prev.y - point.y) < 0.01) {
      continue;
    }
    kept.push(point);
    while (kept.length >= 3) {
      const a = kept[kept.length - 3];
      const b = kept[kept.length - 2];
      const c = kept[kept.length - 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const collinear = Math.abs(abx * bcy - aby * bcx) < 0.01;
      const sameDirection = abx * bcx + aby * bcy > 0;
      if (!collinear || !sameDirection) {
        break;
      }
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept;
}
