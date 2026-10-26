/**
 * Every dial the grid router has, as one plain object.
 *
 * The router (`grid-edge-router.ts`) reads all of its costs and limits from
 * a `RouterTuning`, never from module constants, so the dev menu can turn
 * any of them live and the worker can be handed the same numbers the main
 * thread is using. `DEFAULT_ROUTER_TUNING` is the shipped behaviour; the
 * dev menu's overrides persist on this device only and never touch a plan.
 *
 * Pure and worker-safe: no React, no DOM beyond a guarded localStorage.
 */

export interface RouterTuning {
  /** Cost per pixel on an empty lane. The unit everything else is priced in. */
  costEmpty: number;
  /** Cost per pixel on a lane this wire fits beside others in. */
  costShared: number;
  /** Cost per pixel on a lane this wire does NOT fit into. */
  costOverflow: number;
  /** Cost multiplier inside a board frame the wire is leaving. */
  costInsideExempt: number;
  /** Cost multiplier outside the frame holding both of the wire's ends. */
  costOutsideHome: number;
  /** A 45° bend, in pixel-equivalents. */
  turn45: number;
  /** A 90° corner, in pixel-equivalents. */
  turn90: number;
  /** Reversing along the same line (waypoint excursions only). */
  reverse: number;
  /** Bending inside the clean run at either end, on top of the turn. */
  earlyTurn: number;
  /** Cells a wire runs straight out of a port and straight into one. */
  cleanCells: number;
  /** Crossing another wire once. */
  crossing: number;
  /** Whether diagonal runs are allowed at all. */
  diagonals: boolean;
  /** Minimum gap between the endpoint rims before diagonals are allowed. */
  diagonalDistanceCells: number;
  /** Preferred Manhattan dock separation for bent routes, in cells. */
  dockTravelCells: number;
  /** Length of a diagonal cell relative to a straight one (root two is true). */
  diagonalLength: number;
  /** Usable stroke pixels in a diagonal lane. */
  diagonalLaneCapacity: number;
  /** Per pixel of rim between the dock taken and the dock planned. */
  dockPlanBias: number;
  /** Cells of rim either side of the plan a wire may still dock in. */
  dockPlanWindow: number;
  /** Landing on a dock another wire already uses, on top of everything else. */
  dockShare: number;
  /** Negotiation rounds after the first pass. */
  negotiationRounds: number;
  /** Reroute budget, as a multiple of the wire count. */
  negotiationBudget: number;
  /** Route the longest wires first (else shortest first). */
  longestFirst: boolean;
  /** Search window padding round a wire's ends, in cells. */
  windowPad: number;
  /** Padding of the wide retry rung a route that paid for a crossing gets, in cells. */
  wideRungCells: number;
  /**
   * ARRANGE: price per pixel each card pays when its nearest STRANGER (three
   * or more wire hops away) stands closer than six cells. This is the whole
   * of how islands happen (board-arrange-air.ts); zero packs the board as
   * tight as the wires allow.
   */
  islandAir: number;
  /**
   * ARRANGE: a crossing's price when the arrange compares layouts, in pixels
   * of wire; the router's own `crossing` prices routing. The same by default:
   * dearer (2,000) cut crossings in a one-thread bench but not on the board.
   */
  arrangeCrossing: number;
  /** ARRANGE: annealing trials the search may spend (capped by board size). */
  searchTrials: number;
  /** ARRANGE: distinct layouts the real router judges at the end of the search. */
  finalists: number;
  /** ARRANGE: router questions the polish may ask per layout. */
  polishBudget: number;
  /** ARRANGE: air between stacked cards, in cells. */
  arrangeRowGap: number;
  /** ARRANGE: least corridor between columns, in cells. */
  arrangeColumnGap: number;
  /** ARRANGE: air between a drawer and the machine it rides, in cells. */
  arrangeDrawerGap: number;
}

export const DEFAULT_ROUTER_TUNING: RouterTuning = {
  costEmpty: 1,
  costShared: 1.3,
  costOverflow: 6,
  costInsideExempt: 3,
  costOutsideHome: 3,
  turn45: 35,
  turn90: 80,
  // All but forbidden: a wire doubles back only when no other route
  // exists, which only a pinned dot can force.
  reverse: 100000,
  earlyTurn: 100,
  cleanCells: 2,
  crossing: 400,
  diagonals: true,
  diagonalDistanceCells: 6,
  dockTravelCells: 6,
  diagonalLength: Math.SQRT2,
  diagonalLaneCapacity: 10,
  dockPlanBias: 0.35,
  dockPlanWindow: 12,
  dockShare: 300,
  negotiationRounds: 8,
  negotiationBudget: 2,
  longestFirst: true,
  windowPad: 4,
  wideRungCells: 30,
  islandAir: 0.5,
  arrangeCrossing: 400,
  searchTrials: 20000,
  finalists: 6,
  polishBudget: 100,
  arrangeRowGap: 1,
  arrangeColumnGap: 2,
  arrangeDrawerGap: 1,
};

export interface RouterTuningField {
  key: keyof RouterTuning;
  label: string;
  /** What the dial is, in plain words. */
  hint: string;
  /** What happens when it is turned down. */
  low: string;
  /** What happens when it is turned up. */
  high: string;
  kind: "number" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  group: "Costs" | "Turns" | "Crossings" | "Docks" | "Negotiation" | "Search" | "Arrange";
}

/**
 * The dials in the order the dev menu shows them, each explained in plain
 * words (what it is, and what turning it down or up does). The first six
 * groups shape the WIRES; the Arrange group shapes AUTO ARRANGE only and
 * never re-routes a wire by itself.
 */
export const ROUTER_TUNING_FIELDS: RouterTuningField[] = [
  {
    key: "costEmpty", label: "Empty lane", kind: "number", min: 0.1, max: 5, step: 0.1, group: "Costs",
    hint: "Price per pixel along a free line. The unit everything else is priced in.",
    low: "Distance barely matters; wires detour to dodge a single bend.",
    high: "Distance is everything; wires go straight through bends and crossings.",
  },
  {
    key: "costShared", label: "Shared lane", kind: "number", min: 0.1, max: 5, step: 0.1, group: "Costs",
    hint: "Price per pixel riding beside another wire that still fits.",
    low: "Wires bundle into ribbons.",
    high: "Wires keep a line apart.",
  },
  {
    key: "costOverflow", label: "Full lane", kind: "number", min: 1, max: 30, step: 0.5, group: "Costs",
    hint: "Price per pixel in a lane too full for the wire.",
    low: "Wires overlap when crowded.",
    high: "Wires go round rather than overlap.",
  },
  {
    key: "costInsideExempt", label: "Leaving a board", kind: "number", min: 1, max: 10, step: 0.5, group: "Costs",
    hint: "Multiplier while a wire is still inside a board it is leaving.",
    low: "A leaving wire may wander inside the frame.",
    high: "A leaving wire heads for the nearest wall.",
  },
  {
    key: "costOutsideHome", label: "Outside home board", kind: "number", min: 1, max: 10, step: 0.5, group: "Costs",
    hint: "Multiplier when a wire with both ends in one board steps outside it.",
    low: "Such a wire may duck out and back in.",
    high: "Such a wire stays inside.",
  },
  {
    key: "turn45", label: "45 degree bend", kind: "number", min: 0, max: 400, step: 5, group: "Turns",
    hint: "One 45 degree bend, in pixels of travel. A 45 degree exit or landing costs one too.",
    low: "Wires zig-zag freely.",
    high: "Wires travel further rather than bend.",
  },
  {
    key: "turn90", label: "90 degree corner", kind: "number", min: 0, max: 600, step: 5, group: "Turns",
    hint: "One square corner, in pixels of travel.",
    low: "Wires draw staircases.",
    high: "Wires use diagonals or longer straights instead.",
  },
  {
    key: "reverse", label: "Reversal", kind: "number", min: 0, max: 100000, step: 1000, group: "Turns",
    hint: "Doubling back along the same line. Only a pinned dot can force one.",
    low: "A wire loops back on itself to reach a dot.",
    high: "A wire goes any other way first.",
  },
  {
    key: "earlyTurn", label: "Early bend", kind: "number", min: 0, max: 600, step: 10, group: "Turns",
    hint: "Extra for bending inside the clean run at a port.",
    low: "Wires may turn right off a card.",
    high: "Wires leave and land dead straight.",
  },
  {
    key: "cleanCells", label: "Clean run", kind: "number", min: 1, max: 5, step: 1, group: "Turns",
    hint: "Cells out of a port that count as the clean run.",
    low: "Wires may bend one cell out.",
    high: "Wires run straight longer; cards need more room.",
  },
  {
    key: "diagonals", label: "Diagonals", kind: "boolean", group: "Turns",
    hint: "Whether wires may run at 45 degrees.",
    low: "Off: horizontal and vertical only.",
    high: "On: diagonals allowed.",
  },
  {
    key: "diagonalLength", label: "Diagonal length", kind: "number", min: 1, max: 2.5, step: 0.01, group: "Turns",
    hint: "A diagonal cell relative to a straight one. True length is 1.41.",
    low: "Diagonals count cheap; wires prefer them.",
    high: "Diagonals count dear; wires prefer straights.",
  },
  {
    key: "diagonalDistanceCells", label: "Diagonal trip distance", kind: "number", min: 0, max: 20, step: 1, group: "Turns",
    hint: "Minimum gap between cards, in grid spaces, before their wire may use diagonals.",
    low: "Nearby cards can connect diagonally.",
    high: "Diagonals are reserved for longer trips; nearby wires use square bends.",
  },
  {
    key: "dockTravelCells", label: "Wire breathing room", kind: "number", min: 0, max: 10, step: 1, group: "Docks",
    hint: "Preferred dock separation for a wire that bends, in horizontal plus vertical grid spaces. Straight shots are exempt.",
    low: "Wires can shrink to tiny stubs between neighbouring cards.",
    high: "Docks move apart to leave more visible wire and room for an arrow.",
  },
  {
    key: "crossing", label: "Crossing", kind: "number", min: 0, max: 2000, step: 10, group: "Crossings",
    hint: "Crossing another wire once, in pixels of travel. Thick wires weigh more.",
    low: "Wires cross freely and stay short.",
    high: "Wires go far round to avoid one crossing.",
  },
  {
    key: "negotiationRounds", label: "Rounds", kind: "number", min: 0, max: 12, step: 1, group: "Negotiation",
    hint: "Passes that rip up crossing wires and route them again.",
    low: "One pass. Fast, more crossings.",
    high: "Many passes. Slower, fewer crossings.",
  },
  {
    key: "negotiationBudget", label: "Reroute budget", kind: "number", min: 0, max: 5, step: 0.25, group: "Negotiation",
    hint: "Reroutes allowed, as a multiple of the wire count.",
    low: "Few wires get a second try.",
    high: "Crossing wires are tried again and again.",
  },
  {
    key: "longestFirst", label: "Longest first", kind: "boolean", group: "Negotiation",
    hint: "After the thickest wires, which go next.",
    low: "Off: shortest first.",
    high: "On: longest first, short ones nest inside.",
  },
  {
    key: "dockPlanBias", label: "Plan pull", kind: "number", min: 0, max: 3, step: 0.05, group: "Docks",
    hint: "Pull toward the planned spot on the card edge, per pixel away from it.",
    low: "Wires dock wherever is cheapest.",
    high: "Wires dock exactly as planned, never crossing at the card.",
  },
  {
    key: "dockShare", label: "Shared dock", kind: "number", min: 0, max: 600, step: 10, group: "Docks",
    hint: "Extra for a spot another wire already uses. Never a ban.",
    low: "Wires share spots freely.",
    high: "Every wire wants its own spot.",
  },
  {
    key: "dockPlanWindow", label: "Plan window", kind: "number", min: 1, max: 60, step: 1, group: "Docks",
    hint: "Cells of edge either side of the planned spot a wire may still use.",
    low: "Wires stick to the plan.",
    high: "Wires may dock anywhere nearby.",
  },
  {
    key: "diagonalLaneCapacity", label: "Diagonal lane width", kind: "number", min: 4, max: 16, step: 1, group: "Search",
    hint: "Pixels of wire that fit side by side on a diagonal. Straights hold 16.",
    low: "Thick wires avoid diagonals.",
    high: "Diagonals hold as much as straights.",
  },
  {
    key: "wideRungCells", label: "Wide retry", kind: "number", min: 0, max: 80, step: 2, group: "Search",
    hint: "How far, in cells, a crossing wire may look on its retry.",
    low: "Nearby only. Fast.",
    high: "Across the board. Slow, finds the way over tall cards.",
  },
  {
    key: "windowPad", label: "Search pad", kind: "number", min: 2, max: 40, step: 1, group: "Search",
    hint: "Cells beyond a wire's own box the first search may look.",
    low: "Own box only. Fast.",
    high: "Further afield. Slower.",
  },
  {
    key: "islandAir", label: "Island air", kind: "number", min: 0, max: 5, step: 0.1, group: "Arrange",
    hint: "Price for standing within six cells of an unrelated card. Parts clusters into islands.",
    low: "Zero packs tight, no islands.",
    high: "Groups stand far apart; bridge wires get longer.",
  },
  {
    key: "arrangeCrossing", label: "Crossing (arrange)", kind: "number", min: 0, max: 8000, step: 100, group: "Arrange",
    hint: "A crossing's price when Arrange compares layouts, in pixels of wire. Wire routing keeps its own price.",
    low: "Arrange takes crossings for shorter wires.",
    high: "Arrange takes longer wires for fewer crossings.",
  },
  {
    key: "searchTrials", label: "Search trials", kind: "number", min: 1000, max: 100000, step: 1000, group: "Arrange",
    hint: "Ceiling on the layout search's trial moves.",
    low: "Quick and rough.",
    high: "Slow and thorough.",
  },
  {
    key: "finalists", label: "Finalists", kind: "number", min: 1, max: 12, step: 1, group: "Arrange",
    hint: "Layouts the real router judges before one is chosen.",
    low: "The search's favourite on trust. Fast.",
    high: "More routed for real. Slower, better chosen.",
  },
  {
    key: "polishBudget", label: "Polish budget", kind: "number", min: 0, max: 400, step: 10, group: "Arrange",
    hint: "Router questions the polish may ask per layout. Most of an arrange's time.",
    low: "Zero skips the polish. Fast.",
    high: "Keeps moving cards. Slow, a little better.",
  },
  {
    key: "arrangeRowGap", label: "Row gap", kind: "number", min: 0, max: 6, step: 1, group: "Arrange",
    hint: "Cells between cards stacked in a column.",
    low: "Cards touch.",
    high: "Room between for wires.",
  },
  {
    key: "arrangeColumnGap", label: "Column gap", kind: "number", min: 1, max: 10, step: 1, group: "Arrange",
    hint: "Least corridor between columns, in cells. Busy corridors grow by themselves.",
    low: "Short, crowded wires.",
    high: "Longer wires with room.",
  },
  {
    key: "arrangeDrawerGap", label: "Drawer gap", kind: "number", min: 0, max: 6, step: 1, group: "Arrange",
    hint: "Cells between a drawer and its machine.",
    low: "Drawers touch.",
    high: "Drawers stand off.",
  },
];

const STORAGE_KEY = "gtnh-factory-flow.router-tuning.v1";

let current: RouterTuning = { ...DEFAULT_ROUTER_TUNING };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as Partial<RouterTuning>;
    current = sanitize({ ...DEFAULT_ROUTER_TUNING, ...parsed });
  } catch {
    current = { ...DEFAULT_ROUTER_TUNING };
  }
}

function sanitize(tuning: RouterTuning): RouterTuning {
  const clean: RouterTuning = { ...tuning };
  for (const field of ROUTER_TUNING_FIELDS) {
    const value = clean[field.key];
    if (field.kind === "boolean") {
      (clean as unknown as Record<string, unknown>)[field.key] = Boolean(value);
      continue;
    }
    let number = typeof value === "number" && Number.isFinite(value) ? value : (DEFAULT_ROUTER_TUNING[field.key] as number);
    if (field.min !== undefined) number = Math.max(field.min, number);
    if (field.max !== undefined) number = Math.min(field.max, number);
    (clean as unknown as Record<string, unknown>)[field.key] = number;
  }
  return clean;
}

export function getRouterTuning(): RouterTuning {
  load();
  return current;
}

/**
 * Undo history for the dials. A slider drag fires a change per pixel, so
 * consecutive edits to the SAME dial within `COALESCE_MS` fold into one
 * step: Ctrl+Z takes the whole drag back, not one notch of it.
 */
const COALESCE_MS = 800;
const undoStack: RouterTuning[] = [];
const redoStack: RouterTuning[] = [];
let lastEditKey: string | undefined;
let lastEditAt = 0;

function commit(next: RouterTuning) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage is a convenience; the live value is what matters.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setRouterTuning(patch: Partial<RouterTuning>) {
  load();
  const keys = Object.keys(patch).sort().join("+");
  const now = Date.now();
  if (keys !== lastEditKey || now - lastEditAt > COALESCE_MS) {
    undoStack.push(current);
    if (undoStack.length > 200) {
      undoStack.shift();
    }
  }
  lastEditKey = keys;
  lastEditAt = now;
  redoStack.length = 0;
  commit(sanitize({ ...current, ...patch }));
}

export function resetRouterTuning() {
  setRouterTuning({ ...DEFAULT_ROUTER_TUNING });
}

/** The Arrange group's dials, and only those, back to default. */
export function resetArrangeTuning() {
  const patch: Partial<RouterTuning> = {};
  for (const field of ROUTER_TUNING_FIELDS) {
    if (field.group === "Arrange") {
      (patch as Record<string, unknown>)[field.key] = DEFAULT_ROUTER_TUNING[field.key];
    }
  }
  setRouterTuning(patch);
}

export function canUndoRouterTuning(): boolean {
  return undoStack.length > 0;
}

export function canRedoRouterTuning(): boolean {
  return redoStack.length > 0;
}

/** Steps the dials back one edit; false when there is nothing to undo. */
export function undoRouterTuning(): boolean {
  const previous = undoStack.pop();
  if (!previous) {
    return false;
  }
  redoStack.push(current);
  lastEditKey = undefined;
  commit(previous);
  return true;
}

export function redoRouterTuning(): boolean {
  const next = redoStack.pop();
  if (!next) {
    return false;
  }
  undoStack.push(current);
  lastEditKey = undefined;
  commit(next);
  return true;
}

/** Every dial at its default, the Arrange group included: what the top Reset asks. */
export function isDefaultRouterTuning(): boolean {
  const tuning = getRouterTuning();
  return ROUTER_TUNING_FIELDS.every((field) => tuning[field.key] === DEFAULT_ROUTER_TUNING[field.key]);
}

export function isDefaultArrangeTuning(): boolean {
  const tuning = getRouterTuning();
  return ROUTER_TUNING_FIELDS.filter((field) => field.group === "Arrange").every(
    (field) => tuning[field.key] === DEFAULT_ROUTER_TUNING[field.key],
  );
}

/**
 * Asks the board to throw every route away and solve again with the dials
 * as they stand. The dev menu's "Re-route all wires" key: the same wake-up
 * a dial change sends, for when a route looks stale.
 */
export function requestWireReroute() {
  for (const listener of listeners) {
    listener();
  }
}

/** Runs `listener` after every change; returns the unsubscribe. */
export function subscribeRouterTuning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A string that changes whenever any dial does, for solve signatures. */
export function routerTuningKey(tuning: RouterTuning): string {
  // The Arrange dials shape the arranger only; turning one must not
  // re-route every wire on the board.
  return ROUTER_TUNING_FIELDS.filter((field) => field.group !== "Arrange")
    .map((field) => String(tuning[field.key]))
    .join(",");
}
