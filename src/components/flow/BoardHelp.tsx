import {
  Box,
  Eye,
  Focus,
  Gauge,
  ImagePlus,
  Network,
  Paintbrush,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Store,
  Library,
  Trash2,
  TriangleAlert,
  Undo2,
  Zap,
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import {
  GLANCE_CARD_CLASS,
  GLANCE_LINE,
  GLANCE_QUIET,
  GlanceRows,
  GlanceTitle,
  type GlanceRow,
} from "@/components/help/card-parts";

/**
 * The board's help corner: a "?" where the zoom buttons used to live.
 *
 * Hovering it lays a glance sheet over the whole window: each toolbar gets a
 * dashed ring, an arrow, and a card naming what is in it (see
 * `card-parts.tsx`). The things with no toolbar to ring - what a card does,
 * what a drawer does, the keys, the notices - are LEGEND cards: they stack in
 * whatever column has the room, over the panel they are nearest to.
 *
 * Pure glance layer: pointer events stay off everywhere. Moving away folds the
 * whole thing up again.
 *
 * The sheet portals to <body>: the board, the browser and the inspector each
 * sit in their own stacking contexts, so a scrim rendered inside the board
 * could never dim its neighbours.
 *
 * Regions are found by their `data-help-anchor` attribute and measured once
 * per open, so the overlay follows the real layout instead of hardcoding it.
 * Several elements may share one anchor id, and a ring may union several ids
 * (the tool row is three trays and, folded, a trigger).
 *
 * LAYOUT IS COMPUTED, NOT TUNED. Every card is CARD_W wide and cards live in
 * flex COLUMNS whose corner is fixed to a ring, so no card's position depends
 * on another card's height, and an arrow only ever leaves the card whose edge
 * sits on the column's fixed corner. The old hand-set offsets per card broke
 * at every window size the author had not looked at.
 */

type HelpRect = { left: number; top: number; right: number; bottom: number };

type Measured = {
  rects: Record<string, HelpRect>;
  button?: HelpRect;
  vw: number;
  vh: number;
};

/** Every glance card's width. Rows are written to fit it. */
const CARD_W = 280;
/** Between stacked cards in one column. */
const CARD_GAP = 14;
/** Card edge to ring edge: room for the arrow to read as an arrow. */
const CALLOUT_GAP = 18;
const RING_PAD = 5;
const ARROW_HEAD = 12;
const ARROW_STEM = 3;
/** Long enough to cross the gap from the button to the cards over it. */
const HIDE_GRACE_MS = 160;
/**
 * The smallest window the spread-out glance layout is offered in, in SHELL
 * pixels - the space the cards are actually laid out in, which is the window
 * divided by the interface size (`--ui-scale`, 1.3 by default).
 *
 * These used to read 1920x1080, written as though they were real pixels
 * (Jack, 2026-09-07). They are not: `show()` divides by the scale before
 * comparing, so at the shipped 130% they demanded a 2496x1404 window and
 * NOBODY on a 1080p screen ever saw the spread - a maximised browser there
 * measures about 1477x731 here. The whole layout was dead code in practice
 * (Jack, 2026-09-09: "it's just one big scrollable vertical list").
 *
 * So they are now sized to let a real 1080p browser through, and the honest
 * test does the rest: `layoutGlance` reports `fits: false` when its stacks
 * would land on each other, and that answer is READ now rather than
 * computed and thrown away. A window that qualifies on size but still crams
 * falls back to the one-column panel.
 *
 * `help-fit-probe.local.mjs <WxH> <out.png>` screenshots it.
 */
const GLANCE_MIN_VW = 1400;
const GLANCE_MIN_VH = 700;

/**
 * The sheet's own accent: one soft blue-grey.
 *
 * Not cyan: this draws five rings and a dozen cards over the whole window at
 * once, and in cyan that reads as an alarm going off.
 */
const ACCENT = GLANCE_QUIET;
const ACCENT_DIM = "rgba(147, 164, 187, 0.5)";

interface HelpCard {
  title: string;
  rows: GlanceRow[];
}

/* ------------------------------------------------------------------ */
/* The cards. Rows are short on purpose: this is a reminder, not a manual,
   and a row that wraps costs a whole line of the column's budget. */

const BUILD: HelpCard = {
  title: "Units and history",
  rows: [
    { icon: Undo2, text: "*Undo / redo* changes" },
    { chip: "/s", text: "Change the *rate unit*" },
    { icon: Zap, text: "Show power as *EU/t or amps of a tier*" },
  ],
};

/** The mode switch: one card per key, in the key's colour. */
const BUILD_MODE: HelpCard = {
  title: "Build",
  rows: [
    { text: "Place *recipes* and connect their slots" },
    { text: "Set *machine counts*; read actual rates" },
    { text: "Hover a status for *flow limits*" },
  ],
};

const SOLVE_MODE: HelpCard = {
  title: "Solve",
  rows: [
    { text: "Connect recipes and set a *target*" },
    { text: "*Machine counts* are calculated" },
    { text: "Target: *drawer rate* or *pinned count*" },
  ],
};

const POOL_MODE: HelpCard = {
  title: "Pool",
  rows: [
    { text: "Choose recipes and set a *target*" },
    { text: "Counts and resource flow are *automatic*" },
    { text: "Inputs with no producer are *imported*" },
    { chip: "+", tone: "pool", text: "Add a *product drawer*; set its rate" },
  ],
};

const TOOLS: HelpCard = {
  title: "Board tools",
  rows: [
    { icon: Pencil, text: "*Markup*: boards, shapes and notes" },
    { icon: Paintbrush, text: "*Paint*: apply colour to cards" },
    { icon: ImagePlus, text: "*Image*: insert or paste" },
    { icon: Eye, text: "*View*: background and wire display" },
    { icon: Network, text: "*Arrange*: automatic card layout" },
    { icon: Trash2, text: "*Bin*: click objects to delete" },
  ],
};

const FRAMING: HelpCard = {
  title: "Viewport",
  rows: [
    { icon: Focus, text: "*Fit* the plan on screen" },
    { text: "When zoomed out, show:" },
    { icon: Box, text: "*Machine* icons" },
    { icon: Gauge, text: "*Utilization*: running capacity" },
    { icon: TriangleAlert, text: "*Status*: what limits production" },
    { icon: Zap, text: "*Power* consumption and tier" },
  ],
};

const ON_A_CARD: HelpCard = {
  title: "Machine controls",
  rows: [
    { text: "Click the *name* to change machine" },
    { chip: "LV", text: "*Tier*: click up, right-click down" },
    { chip: "2×", text: "Click to edit *hatch count*" },
    { chip: "8", text: "*Count*: type or scroll" },
    { icon: RefreshCw, text: "*Refactor*: choose another recipe" },
    { text: "Hover the name for *machine stats*" },
    { text: "Config slots: *coils, tools, parallels*" },
  ],
};

const DRAWERS: HelpCard = {
  title: "Drawers and tanks",
  rows: [
    { shape: "source", text: "*Source*: unlimited external supply" },
    { shape: "product", text: "*Product*: requests full production" },
    { shape: "byproduct", text: "*Byproduct*: collects only surplus" },
    { shape: "trash", text: "*Trash*: discards all arrivals" },
    { shape: "buffer", text: "*Buffer*: pass-through and storage" },
  ],
};

const BOARDS: HelpCard = {
  title: "Board windows",
  rows: [
    { chip: "Ctrl+G", text: "Group selection in a *board*" },
    { text: "Drag *title bar*: move group" },
    { text: "*Minimize*: show a flow summary" },
    { text: "*Dump*: remove frame only" },
  ],
};

const LEFT_COLUMN: HelpCard = {
  title: "Resources",
  rows: [
    { icon: Zap, text: "Add *generators, custom rates, farms*" },
    { icon: Search, text: "Find *items and fluids*" },
    { mouse: "left", text: "Click a resource: *recipes that make it*" },
    { mouse: "right", text: "Right-click: *recipes that use it*" },
  ],
};

/** The Library pill at the head of the tab strip, ringed and arrowed. */
const LIBRARY: HelpCard = {
  title: "Library",
  rows: [
    { icon: Library, text: "Your *designs*, in folders" },
    { text: "*Community setups*: open in a new tab" },
    { text: "Favorites, saved and *posted* setups" },
  ],
};

const RECIPE_SEARCH: HelpCard = {
  title: "Recipe search",
  rows: [
    { text: "*Takes* filters inputs; *Makes* outputs" },
    { chip: "ANY", text: "Match at least one resource" },
    { chip: "ALL", text: "Match all; extras allowed" },
    { chip: "ONLY", text: "Match all; no extras" },
    { text: "*Machine buttons* filter results" },
    { mouse: "right", text: "Result menu: *Add to board*" },
  ],
};

const PLAN_TOTALS: HelpCard = {
  title: "Inputs and outputs",
  rows: [
    { chip: "INPUTS", tone: "need", text: "Required external supply" },
    { chip: "OUTPUTS", tone: "output", text: "Resources leaving the plan" },
    { chip: "INTERNAL", tone: "internal", text: "Made and used in the plan" },
    { chip: "RAW/NET", text: "Total flows / net balance" },
  ],
};

const MACHINES: HelpCard = {
  title: "Machines",
  rows: [
    { icon: Store, text: "Required *machines by tier*" },
    { chip: "PEAK/AVG", text: "Full-load / actual power" },
    { chip: "USED", text: "Power use and generation" },
    { mouse: "left", text: "Click a row to *locate machines*" },
  ],
};

const PLAN_CARD: HelpCard = {
  title: "Plan details",
  rows: [
    { text: "Edit the *name, icon and description*" },
    { icon: Share2, text: "*Share* the setup and its details" },
    { icon: RotateCcw, text: "*Reset* to the opened setup" },
  ],
};

/**
 * The banners the board raises on its own, so their first sighting is not
 * their first explanation.
 */
const NOTICES: HelpCard = {
  title: "Plan diagnostics",
  rows: [
    { chip: "NOT WIRED UP", tone: "fine", text: "Slots need connections" },
    { chip: "DEAD LOOP", tone: "bottleneck", text: "Cycle supply deficit" },
    { chip: "CLOG LOCK", tone: "clogged", text: "Surplus blocks a cycle" },
    { chip: "SOLVE MODE", tone: "solve", text: "Set rate / pin count" },
    { chip: "POOL MODE", tone: "pool", text: "Add a product target" },
  ],
};

/** The gestures no button reveals. */
const MOVES: HelpCard = {
  title: "Mouse and keyboard",
  rows: [
    { mouse: "left", text: "Drag between slots to *connect*" },
    { mouse: "left", text: "Drag slot to empty space: *drawer*" },
    { chip: "R / U", text: "Hover a port: find *makes / uses*" },
    { chip: "Shift", text: "Drag to *box-select*; click to add" },
    { chip: "Ctrl+C/V", text: "*Copy / paste* selected cards" },
    { chip: "Del", text: "*Delete* selection" },
    { chip: "Esc", text: "*Cancel* the active tool" },
    { chip: "WASD", text: "*Pan* the canvas" },
    { mouse: "scroll", text: "Scroll the canvas to *zoom*" },
  ],
};

/** The same reminder for a finger: the compact world has no hover and no
 * right button, and telling a phone to right click is worse than nothing. */
const TOUCH_MOVES: HelpCard = {
  title: "Touch controls",
  rows: [
    { text: "Drag between slots to *connect*" },
    { text: "Hold a resource for *makes / uses*" },
    { text: "Tap a card, then drag to *move*" },
    { text: "Double-tap to *zoom*" },
    { text: "Swipe from an edge to open a *panel*" },
  ],
};

/** The mode stack, in the order the switch reads. */
const MODES: HelpCard[] = [BUILD_MODE, SOLVE_MODE, POOL_MODE];

/**
 * The three modes as ONE card for the spread, hung right under the switch.
 * Three cards took 400px of the centre column; this takes half, which is
 * what lets the drawer, board and notice legends stand under it at 920px.
 */
const MODES_CARD: HelpCard = {
  title: "Build, Solve, Pool",
  rows: [
    { text: "*Build*: you set counts and wires" },
    { text: "The board reports what flows" },
    { text: "*Solve*: you wire and set a target" },
    { text: "Machine counts are calculated" },
    { text: "*Pool*: pick recipes, set a target" },
    { text: "Counts, wires and imports are automatic" },
  ],
};

/** Every card, in reading order, for the one-column formats. */
const LINEAR: HelpCard[] = [
  ...MODES,
  LIBRARY,
  BUILD,
  TOOLS,
  FRAMING,
  ON_A_CARD,
  DRAWERS,
  BOARDS,
  LEFT_COLUMN,
  RECIPE_SEARCH,
  PLAN_TOTALS,
  MACHINES,
  PLAN_CARD,
  NOTICES,
];

/* ------------------------------------------------------------------ */

/**
 * Real px (a DOMRect) to shell px: every sheet below wears ui-zoom, so its
 * offsets, the card widths and the window size all live in shell px, and the
 * one conversion is here and in `show` for the window itself.
 */
function toHelpRect(rect: DOMRect, scale = getUiScale()): HelpRect {
  return { left: rect.left / scale, top: rect.top / scale, right: rect.right / scale, bottom: rect.bottom / scale };
}

function unionRects(...rects: Array<HelpRect | undefined>): HelpRect | undefined {
  let out: HelpRect | undefined;
  for (const rect of rects) {
    if (!rect) {
      continue;
    }
    out = out
      ? {
          left: Math.min(out.left, rect.left),
          top: Math.min(out.top, rect.top),
          right: Math.max(out.right, rect.right),
          bottom: Math.max(out.bottom, rect.bottom),
        }
      : rect;
  }
  return out;
}

function measureAnchors(): Record<string, HelpRect> {
  const rects: Record<string, HelpRect> = {};
  document.querySelectorAll<HTMLElement>("[data-help-anchor]").forEach((element) => {
    const id = element.dataset.helpAnchor;
    const rect = element.getBoundingClientRect();
    if (!id || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    rects[id] = unionRects(rects[id], toHelpRect(rect))!;
  });
  return rects;
}

/** A ring's rect once the ring pad is on it: what arrows aim at. */
function padRect(rect: HelpRect): HelpRect {
  return {
    left: rect.left - RING_PAD,
    top: rect.top - RING_PAD,
    right: rect.right + RING_PAD,
    bottom: rect.bottom + RING_PAD,
  };
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * An axis-aligned arrow: a run of points, a head at the last one pointing
 * the way the last segment travels.
 */
type Arrow = { points: Array<{ x: number; y: number }> };

/** A column of cards with one fixed corner. */
type Column = {
  key: string;
  style: CSSProperties;
  cards: HelpCard[];
};

type GlanceLayout = {
  rings: HelpRect[];
  columns: Column[];
  arrows: Arrow[];
  /** False when the board is too small for the spread without cards
   * landing on each other: the caller shows the one-column panel. */
  fits: boolean;
  /** The estimated stacks the fit was judged on, keyed by column, and the
   * pairs that collided. Drawn by nothing; this is what
   * `help-fit-probe.local.mjs` reads off `window.__gtnhHelpGlance` to say
   * WHY a window fell back to the panel. */
  boxes: (Box & { key: string })[];
  collisions: [string, string][];
};

/** About how tall a card renders at CARD_W: title, rows, the wrapped ones
 * twice. Only used to keep stacks off each other before anything is drawn. */
function estimateCardHeight(card: HelpCard): number {
  const charsPerLine = 32;
  const rows = card.rows.reduce(
    (sum, row) => sum + 4 + 15 * Math.max(1, Math.ceil(row.text.length / charsPerLine)),
    0,
  );
  return 48 + rows;
}

function estimateStackHeight(cards: HelpCard[]): number {
  return (
    cards.reduce((sum, card) => sum + estimateCardHeight(card), 0) + CARD_GAP * (cards.length - 1)
  );
}

/** A stack's estimated box, for the overlap check. */
type Box = { left: number; top: number; bottom: number; key: string };

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.left < b.left + CARD_W + CARD_GAP &&
    b.left < a.left + CARD_W + CARD_GAP &&
    a.top < b.bottom + CARD_GAP &&
    b.top < a.bottom + CARD_GAP
  );
}

/**
 * Where everything goes, from the measured rings.
 *
 * Board-left hangs under the build toolbar; the CENTRE hangs under the mode
 * switch with the modes card and the machine-card controls; the LEGENDS
 * (drawers, board windows, notices) stand along the board's foot between
 * the corner stack and the framing dock, in as many lanes as fit; the
 * corner stack grows up from the "?" and its bottom card points down at the
 * plan bar; board-right hangs under the tool row and a second board-right
 * stack sits over the framing dock; the browser cards sit inside the
 * browser column, the Library card first with an arrow across to the
 * Library pill; the inspector's totals card sits over its top and its
 * machines card over the machine list. A closed panel takes its own cards
 * with it. When the foot has no lane the legends hang under the centre;
 * when the centre has no lane of its own it takes the build toolbar's and
 * the Units card joins the corner stack. Stacks that would then land on
 * each other report `fits: false`.
 */
function layoutGlance({ rects, button, vw, vh }: Measured): GlanceLayout {
  const rings: HelpRect[] = [];
  const columns: Column[] = [];
  const arrows: Arrow[] = [];
  const boxes: Box[] = [];

  const build = rects.build;
  const toolRow = unionRects(rects.paint, rects.view);
  const modeSwitch = rects.rules;
  const dock = rects.glance;
  const browser = rects.browser;
  const inspector = rects.inspector;
  const machineList = rects.machines;
  const planBar = rects["plan-card"];
  const libraryPill = rects.library;

  // The x the whole right side is hung from: the tool row's right edge,
  // which is also the framing dock's.
  const rightEdge = toolRow?.right ?? dock?.right ?? vw - 12;
  const rightColumnLeft = rightEdge - CARD_W;
  const buildLeft = build?.left ?? 12;
  const switchCentre = modeSwitch ? (modeSwitch.left + modeSwitch.right) / 2 : undefined;

  // THE CENTRE lane wants to sit under the switch; it may start no further
  // left than the build column's right edge (WIDE) or, failing that, the
  // build toolbar's own left (NARROW), and must end clear of the
  // board-right column.
  const laneRightLimit = rightColumnLeft - CARD_GAP - CARD_W;
  const wideLeft =
    switchCentre !== undefined
      ? clamp(switchCentre - CARD_W / 2, buildLeft + CARD_W + CARD_GAP, laneRightLimit)
      : undefined;
  const wide =
    wideLeft !== undefined &&
    wideLeft >= buildLeft + CARD_W + CARD_GAP &&
    wideLeft <= laneRightLimit;
  const narrowLeft =
    switchCentre !== undefined
      ? clamp(switchCentre - CARD_W / 2, buildLeft, laneRightLimit)
      : undefined;
  const narrow =
    !wide && narrowLeft !== undefined && narrowLeft >= buildLeft && narrowLeft <= laneRightLimit;
  const centreLeft = wide ? wideLeft : narrow ? narrowLeft : undefined;
  const centreTop = modeSwitch ? padRect(modeSwitch).bottom + CALLOUT_GAP : 0;
  const centreCards = [MODES_CARD];

  // THE FOOT: two lanes between the corner stack and the dock stack, hung
  // from the plan bar: the machine-card controls and the legends (drawers,
  // board windows, notices), balanced by height. One lane stacks all four;
  // no lane at all hangs them under the centre.
  const footCards = [ON_A_CARD, DRAWERS, BOARDS, NOTICES];
  const footBottom = planBar ? padRect(planBar).top - CALLOUT_GAP : vh - 12;
  const footLeftLimit = (button ? button.left + CARD_W : buildLeft) + CARD_GAP;
  const footRightLimit = (dock ? dock.right - CARD_W : rightColumnLeft) - CARD_GAP;
  const footLanes = Math.max(
    0,
    Math.min(2, Math.floor((footRightLimit - footLeftLimit + CARD_GAP) / (CARD_W + CARD_GAP))),
  );
  const footStacks: HelpCard[][] =
    footLanes === 2
      ? [
          [ON_A_CARD, BOARDS],
          [DRAWERS, NOTICES],
        ]
      : footLanes === 1
        ? [footCards]
        : [];
  if (footLanes === 0 && centreLeft !== undefined) {
    centreCards.push(...footCards);
  }
  const footWidth = footStacks.length * CARD_W + (footStacks.length - 1) * CARD_GAP;
  const footLeft = clamp(
    (footLeftLimit + footRightLimit) / 2 - footWidth / 2,
    footLeftLimit,
    Math.max(footLeftLimit, footRightLimit - footWidth),
  );

  // NARROW puts the centre lane over the build toolbar's lane, so the Units
  // card moves to the corner stack.
  const cornerCards = [...(narrow ? [BUILD] : []), MOVES, PLAN_CARD];

  if (build && !narrow) {
    const ring = padRect(build);
    rings.push(build);
    const top = ring.bottom + CALLOUT_GAP;
    // No browser column means no place for the Library card; it sits here,
    // under the pill it describes. No centre lane at all means the centre
    // cards stack here too.
    const cards = [
      ...(browser ? [] : [LIBRARY]),
      BUILD,
      ...(modeSwitch && centreLeft === undefined ? centreCards : []),
    ];
    columns.push({
      key: "board-left",
      style: { left: build.left, top, width: CARD_W },
      cards,
    });
    boxes.push({ key: "board-left", left: build.left, top, bottom: top + estimateStackHeight(cards) });
    const x = clamp((ring.left + ring.right) / 2, build.left + 24, build.left + CARD_W - 24);
    arrows.push({ points: [{ x, y: top }, { x, y: ring.bottom }] });
  }

  if (modeSwitch) {
    const ring = padRect(modeSwitch);
    rings.push(modeSwitch);
    if (centreLeft !== undefined) {
      columns.push({
        key: "centre",
        style: { left: centreLeft, top: centreTop, width: CARD_W },
        cards: centreCards,
      });
      boxes.push({
        key: "centre",
        left: centreLeft,
        top: centreTop,
        bottom: centreTop + estimateStackHeight(centreCards),
      });
      const x = clamp((ring.left + ring.right) / 2, centreLeft + 24, centreLeft + CARD_W - 24);
      arrows.push({ points: [{ x, y: centreTop }, { x, y: ring.bottom }] });
    }
  }

  footStacks.forEach((cards, index) => {
    const left = footLeft + index * (CARD_W + CARD_GAP);
    columns.push({
      key: `foot-${index}`,
      style: { left, bottom: vh - footBottom, width: CARD_W },
      cards,
    });
    boxes.push({ key: `foot-${index}`, left, top: footBottom - estimateStackHeight(cards), bottom: footBottom });
  });

  if (toolRow) {
    const ring = padRect(toolRow);
    rings.push(toolRow);
    const top = ring.bottom + CALLOUT_GAP;
    const left = rightColumnLeft;
    columns.push({
      key: "board-right",
      style: { left, top, width: CARD_W },
      cards: [TOOLS],
    });
    boxes.push({ key: "board-right", left, top, bottom: top + estimateStackHeight([TOOLS]) });
    const x = clamp((ring.left + ring.right) / 2, left + 24, left + CARD_W - 24);
    arrows.push({ points: [{ x, y: top }, { x, y: ring.bottom }] });
  }

  if (dock) {
    const ring = padRect(dock);
    rings.push(dock);
    const bottom = ring.top - CALLOUT_GAP;
    const left = dock.right - CARD_W;
    columns.push({
      key: "board-right-bottom",
      style: { left, bottom: vh - bottom, width: CARD_W },
      cards: [FRAMING],
    });
    boxes.push({ key: "board-right-bottom", left, top: bottom - estimateStackHeight([FRAMING]), bottom });
    const x = clamp((ring.left + ring.right) / 2, left + 24, left + CARD_W - 24);
    arrows.push({ points: [{ x, y: bottom }, { x, y: ring.top }] });
  }

  if (button) {
    const bottom = button.top - 10;
    columns.push({
      key: "corner",
      style: { left: button.left, bottom: vh - bottom, width: CARD_W },
      cards: cornerCards,
    });
    boxes.push({ key: "corner", left: button.left, top: bottom - estimateStackHeight(cornerCards), bottom });
    if (planBar && planBar.top > bottom + ARROW_HEAD) {
      // The plan bar runs the whole width of the board's foot, so the arrow
      // drops from the stack's bottom card wherever it clears the button.
      const ring = padRect(planBar);
      rings.push(planBar);
      const x = clamp(button.right + 120, button.left + 24, button.left + CARD_W - 24);
      arrows.push({ points: [{ x, y: bottom }, { x, y: ring.top }] });
    }
  }

  if (browser) {
    rings.push(browser);
    const left = browser.left + 12;
    // The Library card leads, level with the pill it points at: the pill
    // sits just past the column's right edge, so the arrow runs straight
    // across the seam into it.
    const pill = libraryPill && libraryPill.left >= browser.right ? libraryPill : undefined;
    const top = pill ? Math.max(browser.top + 8, pill.top - 6) : browser.top + 80;
    columns.push({
      key: "browser",
      style: { left, top, width: CARD_W },
      cards: [LIBRARY, LEFT_COLUMN, RECIPE_SEARCH],
    });
    if (pill) {
      const ring = padRect(pill);
      rings.push(pill);
      const y = clamp((pill.top + pill.bottom) / 2, top + 12, top + 40);
      arrows.push({ points: [{ x: left + CARD_W, y }, { x: ring.left, y }] });
    }
  }

  if (inspector) {
    const left = inspector.left + Math.max(6, (inspector.right - inspector.left - CARD_W) / 2);
    columns.push({
      key: "inspector",
      style: { left, top: inspector.top + 12, width: CARD_W },
      // No machine list on the board yet: its card waits under the totals.
      cards: machineList ? [PLAN_TOTALS] : [PLAN_TOTALS, MACHINES],
    });
    if (machineList) {
      // Over the machine list itself, hung from its head.
      rings.push(machineList);
      columns.push({
        key: "inspector-machines",
        style: { left, top: machineList.top + 10, width: CARD_W },
        cards: [MACHINES],
      });
    }
  }

  // Stacks that land on each other mean the board is too small for the
  // spread; the one-column panel shows instead.
  const collisions: [string, string][] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        collisions.push([boxes[i].key, boxes[j].key]);
      }
    }
  }

  return { rings, columns, arrows, fits: collisions.length === 0, boxes, collisions };
}

/** The arrow's segments as 3px bars, and its head as a border triangle. */
function ArrowMark({ arrow }: { arrow: Arrow }) {
  const { points } = arrow;
  const segments: CSSProperties[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const vertical = from.x === to.x;
    const isLast = index === points.length - 1;
    // The last segment stops short by the head's length, so the head's tip
    // is what touches the ring.
    const trim = isLast ? ARROW_HEAD : 0;
    if (vertical) {
      const y0 = Math.min(from.y, to.y) + (to.y < from.y ? trim : 0);
      const y1 = Math.max(from.y, to.y) - (to.y > from.y ? trim : 0);
      segments.push({
        left: from.x - ARROW_STEM / 2,
        top: y0,
        width: ARROW_STEM,
        height: Math.max(0, y1 - y0),
      });
    } else {
      const x0 = Math.min(from.x, to.x) + (to.x < from.x ? trim : 0);
      const x1 = Math.max(from.x, to.x) - (to.x > from.x ? trim : 0);
      segments.push({
        left: x0,
        top: from.y - ARROW_STEM / 2,
        width: Math.max(0, x1 - x0),
        height: ARROW_STEM,
      });
    }
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const direction =
    last.x === prev.x ? (last.y < prev.y ? "up" : "down") : last.x < prev.x ? "left" : "right";
  const head: CSSProperties =
    direction === "up"
      ? {
          left: last.x - 8,
          top: last.y,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: `${ARROW_HEAD}px solid ${ACCENT}`,
        }
      : direction === "down"
        ? {
            left: last.x - 8,
            top: last.y - ARROW_HEAD,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: `${ARROW_HEAD}px solid ${ACCENT}`,
          }
        : direction === "left"
          ? {
              left: last.x,
              top: last.y - 8,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: `${ARROW_HEAD}px solid ${ACCENT}`,
            }
          : {
              left: last.x - ARROW_HEAD,
              top: last.y - 8,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderLeft: `${ARROW_HEAD}px solid ${ACCENT}`,
            };
  return (
    <Fragment>
      {segments.map((style, index) => (
        <span key={index} className="absolute" style={{ ...style, backgroundColor: ACCENT }} />
      ))}
      <span className="absolute h-0 w-0" style={head} />
    </Fragment>
  );
}

/** One of the sheet's cards: a headline, then its rows. */
function GlanceCard({
  card,
  className,
  style,
}: {
  card: HelpCard;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={[GLANCE_CARD_CLASS, "px-3 py-2.5", className].filter(Boolean).join(" ")}
      style={{ border: `2px solid ${GLANCE_LINE}`, ...style }}
    >
      <GlanceTitle dense>{card.title}</GlanceTitle>
      <div className="mt-2">
        <GlanceRows rows={card.rows} accent={ACCENT} dense />
      </div>
    </div>
  );
}

const HELP_BUTTON_CLASS =
  "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

/**
 * The same help, as one scrolling sheet.
 *
 * The glance layer is built out of rings and arrows pointing at the toolbars it
 * describes; on a phone those toolbars are folded into single buttons, its cards
 * are wider than the screen, and there is no hover to open it with. So compact
 * windows get the content and drop the pointing: every card in a column, over a
 * full-screen sheet with one way out.
 */
function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="ui-zoom fixed inset-0 z-[120] flex flex-col bg-[#101419] font-mono text-[#dbe3ec]">
      <div
        className="flex h-11 shrink-0 items-center justify-between px-3"
        style={{ borderBottom: `1px solid ${GLANCE_LINE}` }}
      >
        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
          Board help
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="flex h-9 w-9 items-center justify-center border text-[16px] text-[#aebccd]"
          style={{ borderColor: GLANCE_LINE }}
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <GlanceCard card={TOUCH_MOVES} />
        {LINEAR.map((card) => (
          <GlanceCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

/**
 * The help, folded to fit: one scrollable column growing out of the "?".
 *
 * The glance layer needs a big window - a dozen cards spread over the
 * screen, each beside the toolbar it names - and between the phone layout
 * and that spread sits a band of small desktop windows where the spread
 * collapses into a pile of overlapping cards. Those windows get this
 * instead: every card in one column beside the button, scrollable, still
 * opened by hover and closed by leaving. Set a target rate or pin a machine count content, no pointing.
 */
function HelpHoverPanel({
  measured,
  onEnter,
  onLeave,
}: {
  measured: Measured;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { button, vw, vh } = measured;
  const anchorTop = button ? button.top : vh - 12;
  const anchorLeft = button ? button.left : 12;
  return (
    <div
      className="ui-zoom pointer-events-none fixed inset-0 z-[120] font-mono"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="pointer-events-auto absolute flex flex-col gap-2 overflow-y-auto pr-1"
        style={{
          left: anchorLeft,
          bottom: vh - anchorTop + 10,
          width: Math.min(380, vw - anchorLeft - 12),
          maxHeight: anchorTop - 22,
        }}
      >
        <GlanceCard card={MOVES} />
        {LINEAR.map((card) => (
          <GlanceCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

function HelpGlanceSheet({
  measured,
  glance,
  onEnter,
  onLeave,
}: {
  measured: Measured;
  /** Laid out by the caller, which had to ask whether it fits anyway. */
  glance: GlanceLayout;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { button } = measured;
  const { rings, columns, arrows } = glance;
  return (
    <div
      className="ui-zoom pointer-events-none fixed inset-0 z-[120] font-mono"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      {rings.map((rect, index) => (
        <div
          key={index}
          className="absolute border border-dashed"
          style={{
            borderColor: ACCENT_DIM,
            left: rect.left - RING_PAD,
            top: rect.top - RING_PAD,
            width: rect.right - rect.left + RING_PAD * 2,
            height: rect.bottom - rect.top + RING_PAD * 2,
          }}
        />
      ))}
      {arrows.map((arrow, index) => (
        <ArrowMark key={index} arrow={arrow} />
      ))}
      {columns.map((column) => (
        <div
          key={column.key}
          className="absolute flex flex-col"
          style={{ ...column.style, gap: CARD_GAP }}
        >
          {column.cards.map((card) => (
            <GlanceCard key={card.title} card={card} />
          ))}
        </div>
      ))}
      {button ? (
        /* A lit stand-in over the real (now dimmed) button, so the corner
           the sheet grew from stays readable. Hover still lands on the
           real button underneath. */
        <div
          className="absolute flex items-center justify-center border-2 bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
          style={{
            borderColor: ACCENT,
            left: button.left,
            top: button.top,
            width: button.right - button.left,
            height: button.bottom - button.top,
          }}
        >
          ?
        </div>
      ) : null}
    </div>
  );
}

export const BoardHelp = memo(function BoardHelp({ compact }: { compact: boolean }) {
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    // Shell px, like the rects: at 130% a 1920 window is 1477 wide here, so
    // it gets the hover panel, the same as browser zoom gave it.
    const scale = getUiScale();
    setMeasured({
      rects: measureAnchors(),
      button: buttonRect ? toHelpRect(buttonRect) : undefined,
      vw: window.innerWidth / scale,
      vh: window.innerHeight / scale,
    });
  }, []);
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setMeasured(undefined), HIDE_GRACE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  // Keep the probe hook before the compact return: opening a keyboard or
  // resizing the window can switch layouts without remounting this component.
  const glance = !compact && measured ? layoutGlance(measured) : undefined;
  useEffect(() => {
    (window as unknown as { __gtnhHelpGlance?: unknown }).__gtnhHelpGlance = glance
      ? { vw: measured?.vw, vh: measured?.vh, fits: glance.fits, boxes: glance.boxes, collisions: glance.collisions }
      : undefined;
  }, [glance, measured]);

  if (compact) {
    return (
      <div className="absolute bottom-3 left-3 z-30">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          data-help-anchor="help"
          className={HELP_BUTTON_CLASS}
          title="Board help"
          aria-label="Show board help"
        >
          ?
        </button>
        {isSheetOpen && typeof document !== "undefined"
          ? createPortal(
              <HelpSheet onClose={() => setSheetOpen(false)} />,
              document.body,
            )
          : null}
      </div>
    );
  }

  // Between the phone layout and the full spread sits a band of small
  // desktop windows; they hover the one-column panel instead. Decided per
  // open, so resizing simply changes what the next hover shows.
  //
  // Two questions, both asked: is there room in principle, and does THIS
  // board's spread actually land without cards on top of each other. The
  // second is the one that matters - a window can be wide and still have
  // both side columns open - and it used to be computed and dropped.
  const fitsGlance =
    measured !== undefined &&
    glance !== undefined &&
    glance.fits &&
    measured.vw >= GLANCE_MIN_VW &&
    measured.vh >= GLANCE_MIN_VH;

  return (
    <div
      className="absolute bottom-3 left-3 z-30"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        ref={buttonRef}
        type="button"
        // Click too, not only hover: a pen, a touch screen above the phone
        // breakpoint, or a keyboard's Enter all land here, and help must
        // open for every one of them.
        onClick={show}
        onFocus={show}
        onBlur={scheduleHide}
        data-help-anchor="help"
        className={HELP_BUTTON_CLASS}
        title="Board help"
        aria-label="Show board help"
      >
        ?
      </button>
      {measured
        ? createPortal(
            fitsGlance ? (
              <HelpGlanceSheet
                measured={measured}
                glance={glance}
                onEnter={show}
                onLeave={scheduleHide}
              />
            ) : (
              <HelpHoverPanel measured={measured} onEnter={show} onLeave={scheduleHide} />
            ),
            document.body,
          )
        : null}
    </div>
  );
});
