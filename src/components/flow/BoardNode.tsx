"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";

import { Position, type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Minimize2, PackageOpen, X } from "lucide-react";
import type { FactoryNodeColorTag, FactoryPocket } from "@/lib/model/types";
import { boardWindowSize } from "@/lib/model/board-windows";
import {
  BOARD_GRID,
  BOARD_WINDOW_FIT_PAD,
  BOARD_WINDOW_MIN_HEIGHT,
  BOARD_WINDOW_MIN_WIDTH,
  BOARD_WINDOW_TITLE_HEIGHT,
} from "@/lib/board-grid";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBoardView } from "./board-view";
import { CameraNodeToolbar } from "./scroll-camera";
import { publishBoardResizeDraft } from "./board-resize";
import { rectsOverlap, type PlacementRect } from "./board-placement";
import { CANVAS_THEMES, getCanvasTheme } from "./canvas-themes";
import { paperForBoardId } from "@/lib/model/board-paper";
import { CANVAS_PATTERNS } from "./board-view";
import { GT_NODE_COLORS } from "./node-colors";

/**
 * A board standing OPEN: a window frame whose members render as ordinary
 * cards INSIDE it (React Flow children of this node). This component draws
 * only the chrome — a title bar that drags the whole household and carries
 * the board's actions, a wash for a floor, and a corner grip. Wires pass
 * through the frame only when they belong to it; see the router exemptions.
 *
 * The floor is paintable: the board's `colorTag` (set with the paint tool,
 * like any card) recolours the wash, the frame line and the bar. A board
 * with neither a paper nor a tag is given a paper from its id - there is no
 * default board colour.
 */

/** The title bar is the only place a drag can grab the frame. */
export const BOARD_DRAG_HANDLE_CLASS = "board-window-grab";

/**
 * The frame line, in px. Thicker than a card's: a board is read at zoomed-
 * out distances where a 2px line thins to nothing, and the same number
 * dresses the title bar's border so the bar sits flush in the frame rather
 * than half a pixel proud of it.
 */
export const BOARD_EDGE = 4;

/**
 * The ring every selected thing on this board wears. The colour itself lives
 * in `--selection` (globals.css) with the rest of the selection marks, so the
 * board and the panels cannot drift apart.
 */
export const SELECTION_RING = "var(--selection)";

type ResizeSide = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * How much room each grip answers to. Generous on purpose, and straddling
 * the wall so the reach is the same whether the pointer is a little inside
 * the board or a little outside it.
 */
const GRIP_REACH = 12;
const GRIP_CORNER = 26;

const RESIZE_GRIPS: Array<{
  side: ResizeSide;
  cursor: string;
  hitBox: Record<string, number | string>;
}> = [
  // Edges first, corners over them: a corner grab beats an edge grab.
  { side: "n", cursor: "cursor-ns-resize", hitBox: { top: -GRIP_REACH / 2, left: GRIP_CORNER, right: GRIP_CORNER, height: GRIP_REACH } },
  { side: "s", cursor: "cursor-ns-resize", hitBox: { bottom: -GRIP_REACH / 2, left: GRIP_CORNER, right: GRIP_CORNER, height: GRIP_REACH } },
  { side: "w", cursor: "cursor-ew-resize", hitBox: { left: -GRIP_REACH / 2, top: GRIP_CORNER, bottom: GRIP_CORNER, width: GRIP_REACH } },
  { side: "e", cursor: "cursor-ew-resize", hitBox: { right: -GRIP_REACH / 2, top: GRIP_CORNER, bottom: GRIP_CORNER, width: GRIP_REACH } },
  { side: "nw", cursor: "cursor-nwse-resize", hitBox: { top: -GRIP_REACH / 2, left: -GRIP_REACH / 2, width: GRIP_CORNER, height: GRIP_CORNER } },
  { side: "ne", cursor: "cursor-nesw-resize", hitBox: { top: -GRIP_REACH / 2, right: -GRIP_REACH / 2, width: GRIP_CORNER, height: GRIP_CORNER } },
  { side: "sw", cursor: "cursor-nesw-resize", hitBox: { bottom: -GRIP_REACH / 2, left: -GRIP_REACH / 2, width: GRIP_CORNER, height: GRIP_CORNER } },
  { side: "se", cursor: "cursor-nwse-resize", hitBox: { bottom: -GRIP_REACH / 2, right: -GRIP_REACH / 2, width: GRIP_CORNER, height: GRIP_CORNER } },
];

/** The visible mark on each corner: an L of the board's own grip colour. */
const RESIZE_CORNERS: Array<{ side: ResizeSide; className: string }> = [
  { side: "nw", className: "left-[3px] top-[3px] h-3.5 w-3.5 border-l-[3px] border-t-[3px]" },
  { side: "ne", className: "right-[3px] top-[3px] h-3.5 w-3.5 border-r-[3px] border-t-[3px]" },
  { side: "sw", className: "bottom-[3px] left-[3px] h-3.5 w-3.5 border-b-[3px] border-l-[3px]" },
  { side: "se", className: "bottom-[3px] right-[3px] h-3.5 w-3.5 border-b-[3px] border-r-[3px]" },
];

export interface BoardNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  /** Direct members in the frame: cards, drawers, ink, nested boards. */
  memberCount: number;
}

export type BoardWindowFlowNode = Node<BoardNodeData, "boardNode">;

export interface BoardChrome {
  barBg: string;
  barBevelHi: string;
  barBevelLo: string;
  barBorder: string;
  nameBg: string;
  ink: string;
  inkMuted: string;
  /** The floor: a flat paper colour, its grain, and its own grid dots. */
  floorColor: string;
  floorTexture?: string;
  dotColor: string;
  frameLine: string;
  grip: string;
}

/**
 * The papers a board may be laid on: the canvas themes, minus the light
 * ones. A pale sheet under the board's dark cards reads as a hole cut in
 * the plan rather than as a surface the cards sit on, so the picker simply
 * does not offer them. A board that already carries one still renders it.
 */
const BOARD_PAPERS = CANVAS_THEMES.filter((theme) => !isLightColor(theme.base));

/** Rough luminance of a #rrggbb colour, for picking readable ink. */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length < 6) {
    return false;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Mix a #rrggbb toward black (amount < 0) or white (amount > 0). */
function shadeHex(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  if (value.length < 6) {
    return hex;
  }
  const mix = (channel: number) =>
    Math.round(
      amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount),
    )
      .toString(16)
      .padStart(2, "0");
  return `#${mix(parseInt(value.slice(0, 2), 16))}${mix(
    parseInt(value.slice(2, 4), 16),
  )}${mix(parseInt(value.slice(4, 6), 16))}`;
}

/**
 * A board's clothes. The PAPER comes first: a canvas theme gives the floor
 * its colour, its grain and the ink its own grid dots are drawn in, and the
 * title bar is cut from the same paper a few shades off so the window reads
 * as one object. A board with no paper falls back to a colour tag (the paint
 * tool still works on boards), and a board with neither is given a paper
 * from its id - boards have no default colour to fall back to.
 */
/**
 * Exported because a MINIMIZED board wears the same clothes: folding a
 * board must not turn it into a different-coloured object, and the paper
 * is how you recognise which board it is.
 */
export function boardChrome(
  boardId: string,
  themeId: string | undefined,
  colorTag: FactoryNodeColorTag | undefined,
): BoardChrome {
  const paper = themeId ?? (colorTag ? undefined : paperForBoardId(boardId));
  if (paper) {
    const theme = getCanvasTheme(paper);
    const light = isLightColor(theme.base);
    const ink = light ? "#1b1d21" : "#f4f4f5";
    return {
      // The bar: the same paper, pushed away from the floor so the two never
      // read as one flat slab.
      barBg: shadeHex(theme.base, light ? -0.12 : 0.16),
      barBevelHi: shadeHex(theme.base, light ? -0.02 : 0.28),
      barBevelLo: shadeHex(theme.base, light ? -0.3 : -0.4),
      barBorder: shadeHex(theme.base, light ? -0.45 : -0.55),
      nameBg: shadeHex(theme.base, light ? -0.05 : 0.24),
      ink,
      inkMuted: light ? "rgba(27, 29, 33, 0.7)" : "rgba(244, 244, 245, 0.7)",
      floorColor: theme.base,
      floorTexture: theme.texture,
      dotColor: theme.patternColor,
      frameLine: shadeHex(theme.base, light ? -0.35 : 0.34),
      grip: theme.patternColor,
    };
  }
  const paint = colorTag ? GT_NODE_COLORS[colorTag] : undefined;
  if (!paint) {
    // A tag the palette no longer carries: the board still gets a paper,
    // because there is no house colour to fall back to.
    return boardChrome(boardId, paperForBoardId(boardId), undefined);
  }
  const ink = isLightColor(paint.header) ? "#1b1d21" : "#ffffff";
  return {
    barBg: paint.header,
    barBevelHi: paint.panel,
    barBevelLo: paint.border,
    barBorder: paint.border,
    nameBg: paint.panel,
    ink,
    inkMuted: ink === "#ffffff" ? "rgba(255, 255, 255, 0.75)" : "rgba(27, 29, 33, 0.75)",
    // A wash, not a paint bucket: ~13% of the swatch over the canvas.
    floorColor: `${paint.swatch}22`,
    dotColor: paint.border,
    frameLine: paint.border,
    grip: paint.swatch,
  };
}

function BoardNodeComponent({
  data,
  width,
  height,
  selected,
}: NodeProps<BoardWindowFlowNode>) {
  const { pocket, memberCount } = data;
  const minimizePocket = useFactoryStore((state) => state.minimizePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const setPocketFrame = useFactoryStore((state) => state.setPocketFrame);
  const setPocketTheme = useFactoryStore((state) => state.setPocketTheme);
  const setPocketPattern = useFactoryStore((state) => state.setPocketPattern);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const { calmMode } = useBoardView();
  const { getZoom, getNodes, getInternalNode } = useReactFlow();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  // The palette used to close only on a pick; now it follows the one
  // dropdown rule (use-dropdown-dismiss.ts). Its own key is "inside".
  const paletteRef = useRef<HTMLDivElement>(null);
  useDropdownDismiss(isPaletteOpen, {
    refs: [paletteRef],
    onClose: () => setPaletteOpen(false),
    insideSelector: "[data-board-palette-toggle]",
    fade: true,
  });
  const isRenaming = draftName !== undefined && !calmMode;
  const chrome = boardChrome(pocket.id, pocket.theme, pocket.colorTag);
  // What clearing the paper hands the board back to: a colour of its own,
  // picked from its id. There is no house colour under a board.
  const ownPaper = getCanvasTheme(paperForBoardId(pocket.id));

  // A resize follows the pointer live and lands in the store once, on
  // release. The DRAFT carries a whole frame, not just a size: dragging the
  // top or left wall moves the origin too, and the board applies both halves
  // together (see board-resize.ts).
  const draftRef = useRef<{ position: { x: number; y: number }; size: { width: number; height: number } } | undefined>(
    undefined,
  );

  const storedSize = boardWindowSize(pocket);
  const frameWidth = width ?? storedSize.width;
  const frameHeight = height ?? storedSize.height;

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  // Clone the whole board — the frame, every member, every internal wire —
  // through the same capture/paste path Ctrl+C/Ctrl+V uses, so the copy
  // lands beside the original.
  const duplicateBoard = () => {
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, [pocket.id]);
    if (!payload) {
      return;
    }
    const pastedIds = state.pasteBoardItems(payload, { x: frameWidth + 40, y: 0 });
    if (pastedIds.length > 0) {
      state.setPendingBoardSelection(pastedIds);
    }
  };

  const beginResize = (side: ResizeSide, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };

    // Everything the walls have to respect, measured once at grab time.
    // React Flow gives child positions relative to their parent, so the
    // frame's own absolute origin turns the whole board into one space.
    const self = getInternalNode(pocket.id);
    const frameOrigin = self?.internals.positionAbsolute ?? { x: 0, y: 0 };
    const parentOrigin = {
      x: frameOrigin.x - pocket.position.x,
      y: frameOrigin.y - pocket.position.y,
    };
    const start = {
      left: frameOrigin.x,
      top: frameOrigin.y,
      right: frameOrigin.x + frameWidth,
      bottom: frameOrigin.y + frameHeight,
    };

    // What the board holds: no wall may cut into it.
    const holds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    // What stands outside: no wall may cross it.
    const blockers: PlacementRect[] = [];
    const isInside = (nodeId: string): boolean => {
      let cursor = getInternalNode(nodeId)?.parentId;
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor)) {
        if (cursor === pocket.id) {
          return true;
        }
        seen.add(cursor);
        cursor = getInternalNode(cursor)?.parentId;
      }
      return false;
    };
    for (const other of getNodes()) {
      if (other.id === pocket.id || other.type === "annotationNode") {
        continue;
      }
      const internal = getInternalNode(other.id);
      const absolute = internal?.internals.positionAbsolute;
      const size = {
        width: internal?.measured?.width ?? 0,
        height: internal?.measured?.height ?? 0,
      };
      if (!absolute || size.width <= 0 || size.height <= 0) {
        continue;
      }
      if (isInside(other.id)) {
        holds.left = Math.min(holds.left, absolute.x);
        holds.top = Math.min(holds.top, absolute.y);
        holds.right = Math.max(holds.right, absolute.x + size.width);
        holds.bottom = Math.max(holds.bottom, absolute.y + size.height);
        continue;
      }
      blockers.push({ x: absolute.x, y: absolute.y, width: size.width, height: size.height });
    }

    const pulls = {
      left: side === "w" || side === "nw" || side === "sw",
      right: side === "e" || side === "ne" || side === "se",
      top: side === "n" || side === "nw" || side === "ne",
      bottom: side === "s" || side === "sw" || side === "se",
    };

    const handleMove = (move: PointerEvent) => {
      const zoom = getZoom() || 1;
      const dx = (move.clientX - startClient.x) / zoom;
      const dy = (move.clientY - startClient.y) / zoom;
      const snap = (value: number) => Math.round(value / BOARD_GRID) * BOARD_GRID;

      let left = pulls.left ? snap(start.left + dx) : start.left;
      let right = pulls.right ? snap(start.right + dx) : start.right;
      let top = pulls.top ? snap(start.top + dy) : start.top;
      let bottom = pulls.bottom ? snap(start.bottom + dy) : start.bottom;

      // A wall never cuts into the board's own cards, and never shrinks the
      // window below the smallest a window may be.
      if (pulls.left) {
        if (holds.left !== Infinity) {
          left = Math.min(left, holds.left - BOARD_WINDOW_FIT_PAD);
        }
        left = Math.min(left, right - BOARD_WINDOW_MIN_WIDTH);
      }
      if (pulls.right) {
        if (holds.right !== -Infinity) {
          right = Math.max(right, holds.right + BOARD_WINDOW_FIT_PAD);
        }
        right = Math.max(right, left + BOARD_WINDOW_MIN_WIDTH);
      }
      if (pulls.top) {
        if (holds.top !== Infinity) {
          top = Math.min(top, holds.top - BOARD_WINDOW_TITLE_HEIGHT - BOARD_WINDOW_FIT_PAD);
        }
        top = Math.min(top, bottom - BOARD_WINDOW_MIN_HEIGHT);
      }
      if (pulls.bottom) {
        if (holds.bottom !== -Infinity) {
          bottom = Math.max(bottom, holds.bottom + BOARD_WINDOW_FIT_PAD);
        }
        bottom = Math.max(bottom, top + BOARD_WINDOW_MIN_HEIGHT);
      }

      // And no wall crosses anything standing outside: a board grows until
      // it meets its neighbour and stops there, exactly as a dragged board
      // stops rather than sliding over one.
      const wouldHit = (rect: PlacementRect) =>
        blockers.some((blocker) => rectsOverlap(rect, blocker));
      const frame = () => ({ x: left, y: top, width: right - left, height: bottom - top });
      if (pulls.left) {
        while (left < start.left && wouldHit(frame())) {
          left += BOARD_GRID;
        }
      }
      if (pulls.right) {
        while (right > start.right && wouldHit(frame())) {
          right -= BOARD_GRID;
        }
      }
      if (pulls.top) {
        while (top < start.top && wouldHit(frame())) {
          top += BOARD_GRID;
        }
      }
      if (pulls.bottom) {
        while (bottom > start.bottom && wouldHit(frame())) {
          bottom -= BOARD_GRID;
        }
      }

      const draft = {
        position: { x: left - parentOrigin.x, y: top - parentOrigin.y },
        size: { width: right - left, height: bottom - top },
      };
      draftRef.current = draft;
      publishBoardResizeDraft({ boardId: pocket.id, ...draft });
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const draft = draftRef.current;
      draftRef.current = undefined;
      publishBoardResizeDraft(undefined);
      if (draft) {
        setPocketFrame(pocket.id, draft);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const buttonStyle = {
    borderColor: chrome.barBorder,
    backgroundColor: chrome.nameBg,
    color: chrome.ink,
    boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
  };

  return (
    <div
      className="group relative font-mono"
      style={{ width: frameWidth, height: frameHeight, color: chrome.ink }}
    >
      {/* The background palette, in a React Flow toolbar PORTAL: the frame
          itself sits under every card, and a popover drawn in the node's own
          layer would be buried by the very members it floats over. The
          camera-aware one: the library's own stood off screen. */}
      <CameraNodeToolbar
        isVisible={isPaletteOpen}
        position={Position.Top}
        // The button sits at the right end of the bar, so the sheet opens
        // there: anchored left, a wide board put it a whole screen away
        // from the hand that opened it.
        align="end"
        style={{ zIndex: 30 }}
      >
        {/* ui-zoom: the toolbar portal lives inside .react-flow, which is unzoomed. */}
        <div ref={paletteRef} className="ui-zoom nodrag nopan nowheel flex w-[340px] flex-col gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-47)] p-1 shadow-[6px_6px_0_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => {
              setPocketTheme(pocket.id, undefined);
              setPaletteOpen(false);
            }}
            className={[
              "flex h-7 w-9 items-center justify-center border-2 text-white",
              pocket.theme === undefined
                ? "border-white ring-2 ring-cyan-300"
                : "border-[var(--mc-47)]",
            ].join(" ")}
            style={{ backgroundColor: ownPaper.base, backgroundImage: ownPaper.texture }}
            title="Its own colour"
            aria-label={`Clear the paper on board ${pocket.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {BOARD_PAPERS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => {
                setPocketTheme(pocket.id, theme.id);
                setPaletteOpen(false);
              }}
              className={[
                "flex h-7 w-9 shrink-0 items-center justify-center gap-1 border-2",
                pocket.theme === theme.id
                  ? "border-white ring-2 ring-cyan-300"
                  : "border-[var(--mc-47)]",
              ].join(" ")}
              style={{ backgroundColor: theme.base, backgroundImage: theme.texture }}
              title={theme.name}
              aria-label={`Paper board ${pocket.name} in ${theme.name}`}
            >
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  aria-hidden
                  className="h-[3px] w-[3px]"
                  style={{ backgroundColor: theme.patternColor }}
                />
              ))}
            </button>
          ))}
        </div>
        {/* The ruling on the paper, the same six the canvas itself offers. */}
        <div className="flex flex-wrap gap-1 border-t border-[var(--mc-33)] pt-1">
          {CANVAS_PATTERNS.map((pattern) => (
            <button
              key={pattern}
              type="button"
              onClick={() => {
                setPocketPattern(pocket.id, pattern === "dots" ? undefined : pattern);
                setPaletteOpen(false);
              }}
              className={[
                "relative flex h-7 w-9 shrink-0 items-center justify-center overflow-hidden border-2",
                (pocket.pattern ?? "dots") === pattern
                  ? "border-white ring-2 ring-cyan-300"
                  : "border-[var(--mc-47)]",
              ].join(" ")}
              style={{
                backgroundColor: chrome.floorColor,
                // The ruling itself, drawn small: a picture of the choice
                // beats a four-letter abbreviation of its name.
                ...boardRuling(pattern, chrome.dotColor, undefined, 7),
              }}
              title={`Rule this board's paper: ${pattern}`}
              aria-label={`Rule board ${pocket.name} with ${pattern}`}
            >
              {pattern === "none" ? (
                <span aria-hidden className="text-[9px] uppercase" style={{ color: chrome.inkMuted }}>
                  off
                </span>
              ) : null}
            </button>
          ))}
        </div>
        </div>
      </CameraNodeToolbar>
      {/* The frame line only. The PAPER is a separate node underneath the
          wire layer (BoardFloorNode) so a board's own members keep their
          wiring in plain sight while foreign wires pass beneath the board. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          // Selected, the frame wears the same purple ring every selected
          // card wears - a board picked up by a marquee has to look picked
          // up, and it has no other body to ring.
          boxShadow: selected
            ? `inset 0 0 0 ${BOARD_EDGE}px ${chrome.frameLine}, 0 0 0 3px ${SELECTION_RING}`
            : `inset 0 0 0 ${BOARD_EDGE}px ${chrome.frameLine}`,
        }}
      />
      {/* The title bar: the window's one handle. Dragging it moves the board
          and every member with it. */}
      <div
        className={[
          BOARD_DRAG_HANDLE_CLASS,
          "absolute inset-x-0 top-0 flex h-[40px] cursor-grab items-center gap-1 px-2",
        ].join(" ")}
        style={{
          pointerEvents: "all",
          backgroundColor: chrome.barBg,
          // The bar's outline IS the frame's: same weight, same colour, drawn
          // as a border on three sides so the window reads as one object and
          // the seam under the bar stays a single line.
          borderStyle: "solid",
          borderColor: chrome.frameLine,
          borderWidth: `${BOARD_EDGE}px ${BOARD_EDGE}px 2px`,
          boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
        }}
        title={
          calmMode
            ? `${pocket.name} (drag to move the board and everything on it)`
            : `${pocket.name} (drag to move the board and everything on it, double-click the name to rename)`
        }
      >
        {!calmMode && !isRenaming ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                deleteBoardSelection({ nodeIds: [pocket.id] });
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:!bg-red-700 hover:!text-white"
              style={buttonStyle}
              title="Delete board"
              aria-label={`Delete board ${pocket.name}`}
            >
              {/* Drawn rather than a "-" glyph: at this size Monocraft's
                  metrics baseline-align the hyphen low instead of centring. */}
              <span aria-hidden className="block h-[2px] w-[8px]" style={{ backgroundColor: chrome.ink }} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                duplicateBoard();
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Clone board"
              aria-label={`Clone board ${pocket.name}`}
            >
              <Copy aria-hidden className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        {!isRenaming ? (
          <div
            className="minecraft-title flex h-6 min-w-0 flex-1 items-center border-2 px-2 text-[13px] leading-[18px]"
            style={{
              backgroundColor: chrome.nameBg,
              borderColor: chrome.barBorder,
              boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
            }}
            onDoubleClick={
              calmMode
                ? undefined
                : (event) => {
                    event.stopPropagation();
                    setDraftName(pocket.name);
                  }
            }
          >
            <span className="min-w-0 truncate">✦ {pocket.name}</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px]" style={{ color: chrome.inkMuted }}>
              {memberCount} {memberCount === 1 ? "card" : "cards"}
            </span>
          </div>
        ) : (
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitRename();
              }
              if (event.key === "Escape") {
                setDraftName(undefined);
              }
              event.stopPropagation();
            }}
            className="nodrag h-6 min-w-0 flex-1 border-2 px-1 text-[13px] leading-none outline-none"
            // The board's own clothes, as the folded card's rename field wears.
            style={{
              borderColor: chrome.grip,
              backgroundColor: chrome.barBevelLo,
              color: chrome.ink,
            }}
          />
        )}
        {!calmMode && !isRenaming ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPaletteOpen((open) => !open);
              }}
              data-board-palette-toggle=""
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Paper"
              aria-label={`Choose paper for board ${pocket.name}`}
            >
              <span
                aria-hidden
                className="block h-3.5 w-3.5 border"
                style={{
                  backgroundColor: chrome.floorColor,
                  backgroundImage: chrome.floorTexture,
                  borderColor: chrome.barBorder,
                }}
              />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                dissolvePocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Remove board, keep its cards"
              aria-label={`Remove board ${pocket.name}, keep its cards`}
            >
              <PackageOpen aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button data-viewer-inspect
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                minimizePocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Fold board"
              aria-label={`Fold board ${pocket.name} into a pocket card`}
            >
              <Minimize2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {/* The walls: every edge and every corner is a grip, each with a hand
          of room around it — half outside the frame, half in — so grabbing
          one is a glance, not a hunt. The corners wear permanent brackets
          and the whole set brightens when the pointer is over the board. */}
      {RESIZE_GRIPS.map((grip) => (
        <div
          key={grip.side}
          onPointerDown={(event) => beginResize(grip.side, event)}
          className={`nodrag absolute ${grip.cursor}`}
          style={{ ...grip.hitBox, pointerEvents: "all" }}
          title="Resize board"
          aria-label={`Resize board ${pocket.name}`}
        />
      ))}
      {RESIZE_CORNERS.map((corner) => (
        <span
          key={corner.side}
          aria-hidden
          className={`pointer-events-none absolute ${corner.className} opacity-70 transition-opacity group-hover:opacity-100`}
          style={{ borderColor: chrome.grip }}
        />
      ))}
    </div>
  );
}

/**
 * One board's paper, painted by the floor LAYER rather than by the board's
 * own node.
 *
 * The layer is a viewport portal parked under the wires (see BoardFloors in
 * FactoryFlow): a board's chrome has to sit OVER the wires that cross it
 * while its floor sits UNDER them, and a node cannot be in two places in the
 * stack — React Flow also pins every child node above its parent, so the
 * floor cannot simply be a child either. Pure decoration: no pointer events,
 * no geometry, invisible to routing, drop targeting and the camera.
 */
/**
 * The CSS for one board's ruling: the same six the canvas offers, drawn on
 * the board's own paper in its own ink. The canvas draws these as SVG
 * layers that pan with the viewport; a board is a plain element that pans
 * with it already, so background images are all it takes.
 */
function boardRuling(
  pattern: string | undefined,
  ink: string,
  texture: string | undefined,
  cellPx = BOARD_GRID,
): { backgroundImage?: string; backgroundSize?: string } {
  const cell = `${cellPx}px ${cellPx}px`;
  const layers: string[] = [];
  const sizes: string[] = [];
  const add = (image: string, size: string) => {
    layers.push(image);
    sizes.push(size);
  };
  switch (pattern) {
    case "none":
      break;
    case "lines":
      add(`linear-gradient(to right, ${ink} 1px, transparent 1px)`, cell);
      add(`linear-gradient(to bottom, ${ink} 1px, transparent 1px)`, cell);
      break;
    case "cross":
      // A plus at every corner: two short bars crossing on the grid point.
      add(`linear-gradient(to right, ${ink} 5px, transparent 5px)`, cell);
      add(`linear-gradient(to bottom, ${ink} 5px, transparent 5px)`, cell);
      break;
    case "ruled":
      // A notepad: one line every two cells, nothing vertical.
      add(`linear-gradient(to bottom, ${ink} 1px, transparent 1px)`, `100% ${cellPx * 2}px`);
      break;
    case "graph":
      // Graph paper: a fine line on every cell, a heavy one every five.
      add(`linear-gradient(to right, ${ink} 1px, transparent 1px)`, cell);
      add(`linear-gradient(to bottom, ${ink} 1px, transparent 1px)`, cell);
      add(
        `linear-gradient(to right, ${ink} 2px, transparent 2px)`,
        `${cellPx * 5}px ${cellPx * 5}px`,
      );
      add(
        `linear-gradient(to bottom, ${ink} 2px, transparent 2px)`,
        `${cellPx * 5}px ${cellPx * 5}px`,
      );
      break;
    default:
      add(`radial-gradient(circle at 1px 1px, ${ink} 1.5px, transparent 1.5px)`, cell);
      break;
  }
  if (texture) {
    add(texture, "auto");
  }
  return layers.length > 0
    ? { backgroundImage: layers.join(", "), backgroundSize: sizes.join(", ") }
    : {};
}

export function BoardFloor({
  pocket,
  width,
  height,
}: {
  pocket: FactoryPocket;
  width: number;
  height: number;
}) {
  const chrome = boardChrome(pocket.id, pocket.theme, pocket.colorTag);
  return (
    <div
      aria-hidden
      data-board-floor={pocket.id}
      className="pointer-events-none absolute"
      style={{
        transform: `translate(${pocket.position.x}px, ${pocket.position.y}px)`,
        width,
        height,
        backgroundColor: chrome.floorColor,
        // The board's own ruling, on the same 20px pitch the canvas uses,
        // over the theme's grain: a board reads as a piece of board rather
        // than a tinted rectangle.
        ...boardRuling(pocket.pattern, chrome.dotColor, chrome.floorTexture),
      }}
    />
  );
}

// Position props change every drag frame; the chrome only reads `data` and its
// frame size, so comparing exactly those keeps the window from re-rendering
// while React Flow translates its wrapper (see RecipeNode for the long story).
export const BoardNode = memo(
  BoardNodeComponent,
  (previous, next) =>
    previous.data === next.data &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.selected === next.selected,
);
