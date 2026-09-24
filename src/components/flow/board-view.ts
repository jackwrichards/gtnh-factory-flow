"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_CANVAS_THEME_ID,
  isCanvasThemeId,
  type CanvasThemeId,
} from "./canvas-themes";

/**
 * Board view settings: how the canvas looks, and which of the read-only display
 * modes are on.
 *
 * This module holds the LIVE settings, the ones the board is drawing with right
 * now, in localStorage and outside the Zustand store so they can be read
 * without an effect.
 *
 * They are not global taste, though. How a factory is drawn belongs to the
 * factory: one build wants rate labels and fat lines, the next wants a clean
 * board, and a plan that was dressed to be readable should still be wearing
 * that when you come back to it. So a snapshot goes into every design as it is
 * saved and comes back out when you switch to it (`plan-view.ts`, and
 * `showProject` in the design store), which is the same snapshot a SHARED setup
 * has always carried. Switching tabs therefore rewrites what is here — the
 * localStorage copy is what the board reads, not the record of what any one
 * plan wants.
 *
 * The columns and the resource marks deliberately do NOT work this way; see
 * PlanViewScope.
 *
 * Read through useSyncExternalStore: localStorage does not exist during SSR,
 * so the server renders the defaults and the browser swaps in the saved values
 * on hydration. That is the one shape that neither mismatches the server HTML
 * nor sets state from inside an effect.
 */
export type CanvasPattern = "dots" | "lines" | "cross" | "ruled" | "graph" | "none";

export const CANVAS_PATTERNS: CanvasPattern[] = [
  "dots",
  "lines",
  "cross",
  // Paper rulings, same selector as the dots: they are marks on the board,
  // drawn in board space, so they pan and zoom with the factory and never
  // stack on top of another pattern.
  "ruled",
  "graph",
  "none",
];

/**
 * What a zoomed-out card leads with. Always exactly one of these — the
 * smart-view buttons in the board's bottom right switch — and every one of
 * them is a LOD-ONLY reading: zoomed in, cards look the same whichever is
 * picked, because up close the card itself already answers these questions.
 *
 * `identity` is the big machine icon with the count and name, and hovering
 * reveals the I/O rates. `status` is the speed view: cards and lines take
 * their colour from how hard they run, with the hop-distance map on hover.
 * `usage` colours each card by its reason word (bottleneck, starved,
 * clogged...) under the percentage. `power` colours each card by its voltage
 * tier and shows its power draw.
 */
export type GlanceMode = "identity" | "status" | "usage" | "power";

export const GLANCE_MODES: readonly GlanceMode[] = ["identity", "status", "usage", "power"];

export function isGlanceMode(value: unknown): value is GlanceMode {
  return GLANCE_MODES.includes(value as GlanceMode);
}

export interface BoardView {
  /** Draw every connection at the same base width, independent of rate. */
  fixedEdgeWidth: boolean;
  // No `snapToGrid`. Snapping was a preference back when cards were sized by
  // their contents; now they are sized in grid cells, so it is a fact.
  canvasPattern: CanvasPattern;
  /** The paper the board is drawn on; see canvas-themes.ts. */
  canvasTheme: CanvasThemeId;
  // No `heatmapMode` and no `lineHeatMode` any more. Both used to be their
  // own switches; both now ride the status (speed) glance view, and only at
  // the glance step — zoomed in, cards and lines always wear their own
  // colours. Old saved blobs still carrying the keys are simply ignored, so
  // anyone who had line colour on has it off now, on purpose.
  /** Dashes march along each line in the direction of flow. */
  linePulseMode: boolean;
  /**
   * Every status colour steps down to neutral steel: the words, bars and
   * badges still say bottleneck / over-asked / fed, they just stop shouting
   * it in red, amber and green. For showing a plan off, not fixing it.
   */
  calmMode: boolean;
  /** What the glance (zoomed-out) view shows. See GlanceMode. */
  glanceMode: GlanceMode;
}

const BOARD_VIEW_STORAGE_KEY = "gtnh-factory-flow-board-view";

export const DEFAULT_BOARD_VIEW: BoardView = {
  canvasPattern: "dots",
  canvasTheme: DEFAULT_CANVAS_THEME_ID,
  fixedEdgeWidth: false,
  // RETIRED (2026-09-07). The marching dashes were a full-board canvas
  // redrawn every frame; in Firefox a dirty canvas re-renders every board
  // tile under it, which cost most of the frame rate at 4K (33 fps sitting
  // still, 166 without it), and the dashes read the camera a frame late, so
  // they slid against the wires during every pan. The field stays so stored
  // views and shared plans still parse; it is never true again.
  linePulseMode: false,
  calmMode: false,
  glanceMode: "identity",
};

let boardViewState: BoardView = DEFAULT_BOARD_VIEW;
let boardViewLoaded = false;
const listeners = new Set<() => void>();

function readBoardView(): BoardView {
  try {
    const raw = window.localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_BOARD_VIEW;
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof BoardView, unknown>>;
    // A key that is ABSENT falls back to the default; only an explicit `false`
    // would mean off. Reading a missing key as false would mean anyone with a
    // saved blob from before a setting existed silently opts out of its
    // default — and every new default would ship switched off for existing
    // users. Nothing needs that today: the two remaining flags are both
    // pinned off regardless of what is stored.
    const glanceMode = isGlanceMode(parsed.glanceMode)
      ? parsed.glanceMode
      : DEFAULT_BOARD_VIEW.glanceMode;
    return {
      fixedEdgeWidth: parsed.fixedEdgeWidth === true,
      canvasPattern: CANVAS_PATTERNS.includes(parsed.canvasPattern as CanvasPattern)
        ? (parsed.canvasPattern as CanvasPattern)
        : DEFAULT_BOARD_VIEW.canvasPattern,
      canvasTheme: isCanvasThemeId(parsed.canvasTheme)
        ? parsed.canvasTheme
        : DEFAULT_BOARD_VIEW.canvasTheme,
      // Retired: a stored true is not honoured (see DEFAULT_BOARD_VIEW).
      linePulseMode: false,
      // NEVER honoured from storage, and never written to it (see
      // writeBoardView). Calm is a render setting the image export borrows
      // for the length of a capture, not a preference: the board's own
      // switch for it went on 2026-09-08, so a stored `true` was a room
      // with no door. Players reported being stuck in softened colours with
      // no way back (2026-09-09). A reload is now always the way out.
      calmMode: false,
      glanceMode,
    };
  } catch {
    // Corrupt or unreadable storage is not worth breaking the board over.
    return DEFAULT_BOARD_VIEW;
  }
}

export function subscribeBoardView(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Identity is stable between writes, which is what useSyncExternalStore needs
// to avoid an infinite render loop.
function getSnapshot(): BoardView {
  if (!boardViewLoaded) {
    boardViewLoaded = true;
    boardViewState = readBoardView();
  }
  return boardViewState;
}

function getServerSnapshot(): BoardView {
  return DEFAULT_BOARD_VIEW;
}

export function writeBoardView(patch: Partial<BoardView>) {
  boardViewState = { ...getSnapshot(), ...patch };
  try {
    // `calmMode` is SESSION ONLY and is stripped on the way out. The image
    // export turns it on for the length of a capture and back off in a
    // `finally`, and that `finally` is not a promise: close the tab or lose
    // the renderer mid-export and the last thing written was `true`. With no
    // switch on the board to clear it, that stranded players in softened
    // colours for good. Storage cannot hold it, so the worst an interrupted
    // export can now cost is a reload.
    const stored: Partial<BoardView> = { ...boardViewState };
    delete stored.calmMode;
    window.localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A full or blocked storage quota must never break the board.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useBoardView(): BoardView {
  return useSyncExternalStore(subscribeBoardView, getSnapshot, getServerSnapshot);
}

/** The same value the hook returns, for callers outside React. */
export function readBoardViewSnapshot(): BoardView {
  return getSnapshot();
}
