"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  ConnectionMode,
  Position,
  ReactFlow,
  SelectionMode,
  applyNodeChanges,
  getNodesBounds,
  getSmoothStepPath,
  getViewportForBounds,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  useStoreApi,
  ViewportPortal,
} from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import {
  Activity,
  AlignJustify,
  Ban,
  Box,
  Cable,
  Grid2x2,
  Ellipsis,
  Anchor,
  Eye,
  Compass,
  Focus,
  Tag,
  Gauge,
  Grid3x3,
  Grip,
  Hammer,
  Hexagon,
  ImagePlus,
  LoaderCircle,
  Magnet,
  MoveUpRight,
  Paintbrush,
  Palette,
  Plus,
  Presentation,
  Redo2,
  Sprout,
  Square,
  Trash,
  Trash2,
  Type,
  Undo2,
  Wallpaper,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
} from "@/lib/import-export/plan-image";
import {
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "@/lib/model";
import {
  getEffectiveNodeRecipe,
  getPocketResourceForHandle,
  isPocketId,
  listPocketPortResources,
  resolvePocketMemberIds,
} from "@/lib/model/pocket-connections";
import type {
  EdgeThroughput,
  FactoryAnnotationKind,
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "@/lib/model/types";
import {
  captureBoardSelection,
  collectPocketConvergenceWarnings,
  useFactoryStore,
  type BoardClipboardPayload,
  type BoardFraming,
  type PocketConvergenceWarning,
} from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";
import { useDesignStore } from "@/store/design-store";
import {
  isDesignCameraSettled,
  settleDesignCamera,
  writeDesignCamera,
  type BoardCamera,
} from "@/lib/designs/design-camera";
import { isEditableKeyboardTarget } from "./keyboard";
import { BoardHelp } from "./BoardHelp";
import {
  ANNOTATION_DEFAULT_ARROW,
  ANNOTATION_DEFAULT_BOX,
  ANNOTATION_DEFAULT_TEXT,
  ANNOTATION_MIN_ARROW,
  ANNOTATION_MIN_BOX,
  ANNOTATION_MIN_TEXT,
  BOARD_GRID,
  STORAGE_NODE_HEIGHT,
  STORAGE_NODE_WIDTH,
} from "@/lib/board-grid";
import {
  BOARD_CAMERA_DURATION,
  BOARD_CAMERA_MAX_ZOOM,
  BOARD_CAMERA_PADDING,
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  cardRect,
  framingRect,
  rectCentre,
  zoomForRect,
} from "./board-camera";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE, flowRampColor } from "./node-colors";
import {
  CANVAS_PATTERNS,
  useBoardView,
  writeBoardView,
  type BoardView,
  type CanvasPattern,
  type GlanceMode,
} from "./board-view";
import { CANVAS_THEMES, getCanvasTheme, type CanvasTheme } from "./canvas-themes";
import { GrainBackground, RuledBackground } from "./board-pattern";
import {
  MotionNumberText,
  readBoardMotionSnapshot,
  useBoardMotion,
  useMotionRoute,
  useMotionValue,
  writeBoardMotion,
} from "./board-motion";
import { readImageSize, uploadBoardImage } from "@/lib/community/images";
import { getDeleteCursor, getPaintBrushCursor } from "./paint-cursor";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
  parseResourceHandleId,
  type ResourceHandleSide,
} from "./resource-handles";
import {
  formatEdgeRateLabelFrom,
  getEdgeRateLabelValues,
  isEdgeStarved,
  type EdgeLabelInput,
} from "./edge-labels";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeAddChips } from "@/components/RecipeAddChip";
import { ReachabilityWizard } from "@/components/ReachabilityWizard";
import {
  LANE_CAPACITY,
  laneWidthForHeat,
  solveGridRoutes,
  type GridEndpoint,
  type GridSide,
  type GridRouteRequest,
} from "./grid-edge-router";
import {
  CUSTOM_RATE_ANY_RESOURCE_ID,
  getCustomRateSlot,
  isCustomRateNodeId,
  isCustomRateRecipe,
} from "@/lib/model/custom-rate";
import { isTrashRecipe, TRASH_ANY_RESOURCE_ID } from "@/lib/model/trash";
import { rateUnitSuffix, type RateUnit } from "@/lib/model/rate-unit";
import { useIsCompactViewport } from "@/lib/compact-view";
import { browseHoveredPort } from "./port-browse";
import { useBoardTouchGestures } from "./board-touch-gestures";
import { getSupplyCeiling } from "@/components/inspector/usage-limits";
import {
  EDGE_DETAIL_ARROWS,
  EDGE_DETAIL_GLOBAL,
  EDGE_DETAIL_LABELS,
  EDGE_DETAIL_PULSE,
  EDGE_DETAIL_BY_LEVEL,
  hasEdgeDetail,
  reuseDeepObjectIdentity,
  reuseObjectIdentity,
} from "./edge-detail";
import { compareEdgeDepth, edgeCasingWidth } from "./edge-geometry";
import { describeDeathSpiral, findDeathSpirals } from "./death-spiral";
import { findUnwiredNodeIds } from "./node-verdict";
import { useBoardPulseSync } from "./animation-phase";
import { getDockTabsRight, getDockTopInset } from "./dock-insets";
import {
  isWiringConnection,
  markWireDrop,
  setWiringConnection,
  wasRecentWireDrop,
  WIRING_BOARD_CLASS,
} from "./connection-drag";
import {
  clearHopMap,
  getHopMapHubId,
  hopFill,
  hopInk,
  registerHopMapBoard,
  setHopMapHub,
  useHopMapSummary,
} from "./hop-map";
import {
  NODE_DETAIL_ATTRIBUTE,
  NODE_DETAIL_FULL,
  getNodeDetailLevel,
  getPublishedNodeDetailLevel,
  getServerNodeDetailLevel,
  nodeDetailAttributeValue,
  setNodeDetailLevel,
  subscribeNodeDetailLevel,
  type NodeDetailLevel,
} from "./node-detail";
import {
  clearEdgePulses,
  drawEdgePulses,
  edgePulseCount,
  eraseEdgePulseOcclusion,
  publishEdgeLabelBox,
  publishEdgePulse,
  publishEdgeWaypointDots,
  retractEdgeLabelBox,
  retractEdgePulse,
  retractEdgeWaypointDots,
} from "./edge-pulse";
import { StorageNode, type StorageFlowNode } from "./StorageNode";
import { TrashNode, type TrashFlowNode } from "./TrashNode";
import { PocketNode, type PocketFlowNode } from "./PocketNode";
import {
  buildPocketRailPorts,
  computePocketSummaries,
  resolvePocketPortHandleId,
} from "./pocket-summary";
import {
  ANNOTATION_DRAG_HANDLE_CLASS,
  AnnotationNode,
  type AnnotationFlowNode,
} from "./AnnotationNode";
import { settleZonePoints } from "@/lib/model/zone-points";

const nodeTypes = {
  recipeNode: RecipeNode,
  storageNode: StorageNode,
  trashNode: TrashNode,
  annotationNode: AnnotationNode,
  pocketNode: PocketNode,
} satisfies NodeTypes;

type BoardFlowNode =
  | RecipeFlowNode
  | StorageFlowNode
  | TrashFlowNode
  | AnnotationFlowNode
  | PocketFlowNode;

interface AnnotationDraft {
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Every point the pointer passed through; the zone tool settles it. */
  trail: Array<{ x: number; y: number }>;
}

const ResourceEdge = memo(ResourceEdgeComponent);

const edgeTypes = {
  resourceEdge: ResourceEdge,
} satisfies EdgeTypes;


const connectionLineStyle = {
  stroke: "#00d9ff",
  strokeWidth: 5,
  strokeOpacity: 0.95,
  filter: "drop-shadow(0 0 5px rgba(0,217,255,0.9))",
};

const DEFAULT_ITEM_EDGE_COLOR = "#8b8f98";
const DEFAULT_FLUID_EDGE_COLOR = "#2f89c5";

// The base colour and pattern ink now come from the active canvas theme
// (canvas-themes.ts); the Slate theme carries the old --canvas / --canvas-dot
// values. Inside a pocket dimension the dots go faintly violet with the room.
const POCKET_CANVAS_DOT_COLOR = "#5b4c7a";

/**
 * Snap step, and the background gap — same number so nodes land on marks.
 * It is also the number every card is built out of: see `@/lib/board-grid`,
 * which owns the cell and the card sizes derived from it.
 */
const BOARD_GRID_SIZE = BOARD_GRID;
/** Stable identity: a fresh array each render would re-init React Flow's snap. */
const BOARD_GRID_SNAP: [number, number] = [BOARD_GRID_SIZE, BOARD_GRID_SIZE];
const CANVAS_PATTERN_LABEL: Record<CanvasPattern, string> = {
  dots: "Background: dots",
  lines: "Background: grid lines",
  cross: "Background: crosses",
  ruled: "Background: ruled lines",
  graph: "Background: graph paper",
  none: "Background: blank",
};
const CANVAS_PATTERN_VARIANT: Record<
  Exclude<CanvasPattern, "none" | "ruled" | "graph">,
  (typeof BackgroundVariant)[keyof typeof BackgroundVariant]
> = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
};

/** Module-level so the board never re-renders on a fresh object identity. */
const PRO_OPTIONS = { hideAttribution: true };

/**
 * Every card's resting depth. Explicit rather than React Flow's default 0
 * because in thickness mode the nodes layer stops being a stacking context
 * (globals.css) and each node stacks directly against the edge layer at 10:
 * cards must land above the pipes, backdrop annotations (-5) below them.
 */
const CARD_Z_INDEX = 20;

/**
 * React Flow's dark colorMode paints its wrapper #141414, which sat invisibly
 * under everything while the canvas was always #1b1d21 - and silently covered
 * every OTHER paper the theme picker offers. The board div behind it owns the
 * background now, so the wrapper must stay glass.
 */
const FLOW_WRAPPER_STYLE = { backgroundColor: "transparent" } as const;

/**
 * Narrower than this and a framing request's reserved strip is ignored: about
 * two cards, below which there is no framing left to do and giving a slice
 * away costs more than whatever was going to sit in it. See frameBoardCards.
 */
const MIN_FRAMED_WIDTH = 420;

/** The delay plus four pulses of the keyframes in globals.css, plus some slack. */
const PLACED_FLASH_CLASS = "board-card-placed";
const PLACED_FLASH_MS = 3100;
/**
 * Mid-drag live rerouting. A held card's wires used to keep their last
 * solved route until the drop; on boards under this many wires the REAL
 * solve now reruns while the card moves — the same solve the drop runs, so
 * the wires follow the card to exactly where they will rest, never a guess
 * (the old pointer-chasing preview lied, which is why drags froze in the
 * first place). Throttled: with the route morph gliding between solves,
 * a handful of solves a second reads as continuous. Past the limit the
 * drag freezes as it always did — a full board solve per beat on a mega
 * board is exactly the per-frame bill ARCHITECTURE.md forbids.
 */
const LIVE_DRAG_ROUTE_EDGE_LIMIT = 200;
const LIVE_DRAG_SOLVE_MS = 120;
/**
 * The self-measuring half of the gate above. The wire count is a guess about
 * cost; this is the receipt. Each mid-drag solve is timed through to the
 * frame it painted, and one over this budget marks the current board size as
 * too slow to follow — later drags freeze until the board shrinks well below
 * the size that lagged. The user never chooses between smooth and laggy:
 * a board that can afford following gets it, one that cannot goes back to
 * frozen drags on its own, whatever the motion buttons say.
 */
const LIVE_DRAG_BUDGET_MS = 36;
/**
 * The materialise-on-arrival pop (globals.css), riding the same DOM pass as
 * the flash. Its class outlives the 220ms animation harmlessly — an animation
 * plays once per application — and comes off with the flash's own timers so a
 * later cull remount can never replay it.
 */
const BOARD_ARRIVE_CLASS = "board-card-arrive";
const BOARD_ARRIVE_MS = 600;

/**
 * On a touchscreen a card moves only once it is selected: tap it, then drag it.
 *
 * A finger has no hover and no precision, and every drag that began on a card was
 * a card being moved — so panning the board meant finding a gap between cards, and
 * a plan dense enough to be worth panning has no gaps. Selection makes the intent
 * explicit: one tap says which card, the drag then moves it, and a drag starting
 * anywhere else pans as it should.
 *
 * `nodesDraggable` is off wholesale on compact, and a selected card overrides it
 * with its own `draggable`. Identity is preserved for every card that does not
 * change, because the node memos are built on it.
 */
function withTouchDragRule(nodes: BoardFlowNode[], compact: boolean): BoardFlowNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    // Off compact nothing carries the flag, so a window that grows back into a
    // desktop hands every card its drag back.
    const draggable = compact && node.selected ? true : undefined;
    if (node.draggable === draggable) {
      return node;
    }
    changed = true;
    return { ...node, draggable };
  });
  return changed ? next : nodes;
}

/**
 * Thickness-mode widths come from the lane-fraction menu in
 * grid-edge-router.ts: the widest pipe is one lane (16px — a shade under the
 * 20px grid cell, so two full pipes in neighbouring lanes keep daylight),
 * the narrowest a sliver. `laneWidthForHeat` does the mapping.
 */
const FLOW_MODE_MIN_WIDTH = 4;
const FLOW_MODE_MAX_WIDTH = LANE_CAPACITY;
/**
 * Dash travel in flow pixels per second: the quietest line on the board, and
 * the busiest. Expressed as a velocity rather than a duration so the speed
 * reads as flow and nothing else — see the note where it is applied.
 */
// A third slower than the first cut (130/434): the quiet lines idled fine
// but the busy ones read as agitation rather than flow.
const PULSE_MIN_VELOCITY = 85;
const PULSE_MAX_VELOCITY = 290;

/**
 * How far apart parallel runs sit, as a multiple of EDGE_LANE_SPACING.
 *
 * Lane spacing was chosen for ~3px wires: at 14px apart they read as separate
 * lines with room to spare. A 34px pipe in a 14px lane overlaps its neighbour
 * by more than half, so thickness mode widens every lane to clear the widest
 * line it can draw. Published as a module value (not a prop) because the
 * routing functions that consume it are pure and module-level; the board bumps
 * it and drops the route caches, which is the same discipline every other
 * geometry input here follows.
 */
let publishedEdgeLaneScale = 1;
const THICK_LINE_LANE_SCALE = 2.8;
/** Below this a rate is display noise, not a flow — it must not set the floor. */
const RATE_DISPLAY_EPSILON = 1e-6;

/**
 * How much of a line's weight comes from its RANK among the other lines rather
 * than from its value. This is the knob that buys resolution.
 *
 * A pure value scale is honest and useless: one fluid line at 10,000/s squashes
 * every other line on the board into the bottom pixel of the range. A pure log
 * scale fixes the squashing across orders of magnitude but still cannot
 * separate 10,000 from 10,005 — they are the same width to any eye.
 *
 * Rank separates them perfectly (adjacent values are adjacent ranks, always one
 * step apart) but throws away magnitude: it cannot tell you that one line moves
 * a thousand times more than another, only that it moves more. Neither alone is
 * what you want, so the two are blended — rank leading, because the reading
 * being asked for is "which of these is bigger", not "how big exactly".
 */
const FLOW_RANK_WEIGHT = 0.62;

/** value -> its 0..1 position among the distinct values present, ascending. */
function distinctRankIndex(sortedValues: number[]): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const value of sortedValues) {
    if (!ranks.has(value)) {
      ranks.set(value, ranks.size);
    }
  }
  const last = ranks.size - 1;
  if (last <= 0) {
    for (const value of ranks.keys()) {
      ranks.set(value, 1);
    }
    return ranks;
  }
  for (const [value, index] of ranks) {
    ranks.set(value, index / last);
  }
  return ranks;
}

/**
 * A line's weight, 0 (quietest on the board) to 1 (busiest), blending its
 * logarithmic share of the range with its rank among the other lines.
 */
function flowHeatFor(
  value: number,
  min: number,
  max: number,
  ranks: Map<number, number>,
): number {
  if (value <= RATE_DISPLAY_EPSILON || !Number.isFinite(min)) {
    return 0;
  }
  // One line, or every line equal: it is the biggest there is.
  if (max - min <= RATE_DISPLAY_EPSILON) {
    return 1;
  }
  // log1p keeps this well behaved for the sub-1/s rates chanced outputs
  // produce, where a plain log would dive toward negative infinity.
  const logSpan = Math.log1p(max) - Math.log1p(min);
  const logShare = logSpan > 1e-9 ? (Math.log1p(value) - Math.log1p(min)) / logSpan : 1;
  const rankShare = ranks.get(value) ?? logShare;
  return Math.min(
    Math.max(rankShare * FLOW_RANK_WEIGHT + logShare * (1 - FLOW_RANK_WEIGHT), 0),
    1,
  );
}
/**
 * Which scale a line is measured on. Fluids move in litres and everything else
 * in whole units, so they are ranged apart; aspects are counted like items.
 */
function flowBucketFor(kind: ResourceKind): "item" | "fluid" {
  return kind === "fluid" ? "fluid" : "item";
}

const RECIPE_SLOT_EDGE_OFFSET = 20;
// Half a drawer card (140×160 → 70), less a cell, so an unmeasured endpoint
// still lands inside the card the way a measured one does.
const STORAGE_SLOT_EDGE_OFFSET = 60;
// Wires were correct but claustrophobic at 18 — they hugged node walls.
const BASE_EDGE_NODE_CLEARANCE = 30;
const BASE_EDGE_LINK_CLEARANCE = 12;

/**
 * How much room a wire keeps off a node wall, and how close two wires may run
 * before the scorer charges for it.
 *
 * Both were tuned for a ~3px wire, where the stroke is thinner than the
 * measurement error and a centreline clearance IS a visual clearance. In
 * thickness mode a line is up to 34px wide, so a route whose CENTRELINE clears
 * a node by 30px leaves a 13px gap, and two centrelines 12px apart overlap by
 * 22px of solid colour — the scorer calls that clear because it only ever
 * measures centre to centre.
 *
 * So the clearances become mode-scoped and are published the same way lane
 * width is: derived from the widest line the mode can draw, never from any
 * individual edge's width. That distinction is the whole point — per-edge
 * widths come from normalised throughput, so folding them into routing inputs
 * would make every solver run reshuffle the ranks, change a width, and reroute
 * the board. Mode-scoped values change only when the user toggles the mode.
 */
let publishedDirectEdgeNodeClearance = BASE_EDGE_NODE_CLEARANCE;
let publishedEdgeLinkClearance = BASE_EDGE_LINK_CLEARANCE;

function edgeClearancesForMode(thicknessMode: boolean) {
  if (!thicknessMode) {
    return { node: BASE_EDGE_NODE_CLEARANCE, link: BASE_EDGE_LINK_CLEARANCE };
  }
  // Half of the widest pipe is the amount of stroke that hangs off the
  // centreline, so adding it restores the gap the base numbers describe.
  const halfWidest = FLOW_MODE_MAX_WIDTH / 2;
  return {
    node: BASE_EDGE_NODE_CLEARANCE + halfWidest,
    // Two lines both hang half a stroke into the gap between them.
    link: BASE_EDGE_LINK_CLEARANCE + halfWidest * 2,
  };
}
const EDGE_ENDPOINT_SPACING = 5;
const EDGE_ROUTE_SNAP_GRID = 4;
const EXPORT_IMAGE_PADDING = 80;
const EXPORT_PNG_PIXEL_RATIO = 2;
const EXPORT_PNG_MAX_PIXEL_SIDE = 8192;
const FLOW_EDGE_LABEL_SELECT_EVENT = "gtnh-flow.edge-label-select";
type ResourceEdgeData = {
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
  color: string;
  demand: number;
  transferred?: number;
  /** What the consumer wants at 100%, so a shortfall can be shown as a ratio. */
  nameplateDemand?: number;
  /** Producer's full output rate; set only when this edge is its sole outlet. */
  sourceCapacity?: number;
  unit: string;
  isLimited: boolean;
  /** Producer is maxed out and the consumer is going hungry. */
  isSupplyCapped: boolean;
  /** The line ends in a barrel or tank rather than a machine. */
  isStorageTarget?: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
  labelOffset?: { x: number; y: number };
  /** User-pinned stops the wire routes through, in order. */
  waypoints?: Array<{ x: number; y: number }>;
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
  sourceEndpointOffset?: number;
  targetEndpointOffset?: number;
  routeIndex: number;
  bundle?: {
    role: "primary" | "member";
    mode: "single-target" | "multi-target";
    size: number;
    sourceHandleIds: string[];
    primarySourceHandleId: string;
    edgeIds: string[];
    demand?: number;
    transferred?: number;
    nameplateDemand?: number;
    sourceCapacity?: number;
    isLimited: boolean;
    isSupplyCapped: boolean;
  };
  isFlowHighlighted?: boolean;
  /** This wire is part of a ring that has wound down and cannot restart. */
  isDeadLoop?: boolean;
  /**
   * Collapsed-pocket channels: convergence keeps several flat wires crossing
   * one boundary with the same resource, but the card advertises ONE channel
   * per resource, so the view draws one wire. Set on the representative edge
   * only — every flat edge id the drawn wire stands for, itself included.
   * Rates on the wire are the channel's sums; deleting it deletes them all.
   */
  mergedEdgeIds?: string[];
  /**
   * Set when any of the three line modes is on. `heat` is this line's share of
   * its own kind's range, 0 for the quietest line on the board and 1 for the
   * busiest; the flags say which of colour, thickness and marching dashes to
   * apply, so the three mix freely.
   */
  flowRate?: {
    heat: number;
    kind: "item" | "fluid";
    color: boolean;
    thickness: boolean;
    pulse: boolean;
  };
  /**
   * Bust token for the edge-identity cache. Node size changes bump it, which
   * makes every rebuilt edge structurally new so all of them re-render and
   * re-measure; without it the deep-identity reuse would hand back the old
   * object and the stale route would never redraw.
   */
  layoutEpoch: number;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type SlotEdgeEndpoint = {
  x: number;
  y: number;
  side: Position;
  // Whether this side may transit its own node body for free (a slot's
  // logical exit side, and every side of a small storage node). Other sides
  // only get a short allowance, so routes cannot tunnel the length of a
  // recipe node just because a slot technically offers that side.
  freeExit?: boolean;
};
type RoutedEdgePath = {
  path: string;
  labelX: number;
  labelY: number;
  /**
   * Crammed board: the label's only seat is on top of some node, so it
   * doesn't render at all (a user-dragged offset always overrides this).
   */
  labelHidden?: boolean;
  points: Array<{ x: number; y: number }>;
};

const directRouteCache = new Map<
  string,
  {
    signature: string;
    routeIndex: number;
    route: RoutedEdgePath;
    segments: ReturnType<typeof getPolylineSegments>;
  }
>();

/**
 * Spatial index over every cached route's segments.
 *
 * Two hot paths need "the other lines near this one": the scorer's congestion
 * set and the hop pass. Both used to answer that by walking the ENTIRE route
 * cache once per edge, which is O(edges²) per board render — the exact shape
 * ARCHITECTURE.md calls a bug, and the reason a 600-edge plan spent seconds
 * per frame in `segmentsIntersect`. A uniform grid answers the same question
 * against the handful of segments that could possibly be in reach.
 *
 * Cells are big relative to a wire and small relative to the board, so a
 * typical query touches a few cells and a long segment spans a few dozen.
 */
const ROUTE_SEGMENT_CELL_SIZE = 512;
/** Guards the packed cell key against absurd coordinates. */
const ROUTE_CELL_LIMIT = 30_000;

type IndexedRouteSegment = {
  edgeId: string;
  routeIndex: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  /** Query stamp, so a segment spanning several cells is yielded once. */
  seen: number;
};

const routeSegmentGrid = new Map<number, IndexedRouteSegment[]>();
/** Which cells each edge currently occupies, so removal stays O(cells). */
const routeSegmentCellsByEdge = new Map<string, number[]>();
let routeSegmentQueryStamp = 0;

function routeCellKey(cellX: number, cellY: number) {
  const x = Math.max(-ROUTE_CELL_LIMIT, Math.min(ROUTE_CELL_LIMIT, cellX)) + ROUTE_CELL_LIMIT;
  const y = Math.max(-ROUTE_CELL_LIMIT, Math.min(ROUTE_CELL_LIMIT, cellY)) + ROUTE_CELL_LIMIT;
  return x * (ROUTE_CELL_LIMIT * 2 + 1) + y;
}

function unindexRouteSegments(edgeId: string) {
  const cells = routeSegmentCellsByEdge.get(edgeId);
  if (!cells) {
    return;
  }
  for (const cell of cells) {
    const bucket = routeSegmentGrid.get(cell);
    if (!bucket) {
      continue;
    }
    const kept = bucket.filter((segment) => segment.edgeId !== edgeId);
    if (kept.length === 0) {
      routeSegmentGrid.delete(cell);
    } else {
      routeSegmentGrid.set(cell, kept);
    }
  }
  routeSegmentCellsByEdge.delete(edgeId);
}

function indexRouteSegments(
  edgeId: string,
  routeIndex: number,
  segments: ReturnType<typeof getPolylineSegments>,
) {
  unindexRouteSegments(edgeId);
  if (segments.length === 0) {
    return;
  }

  const cells = new Set<number>();
  for (const segment of segments) {
    const indexed: IndexedRouteSegment = {
      edgeId,
      routeIndex,
      start: segment.start,
      end: segment.end,
      length: segment.length,
      seen: 0,
    };
    const minCellX = Math.floor(Math.min(segment.start.x, segment.end.x) / ROUTE_SEGMENT_CELL_SIZE);
    const maxCellX = Math.floor(Math.max(segment.start.x, segment.end.x) / ROUTE_SEGMENT_CELL_SIZE);
    const minCellY = Math.floor(Math.min(segment.start.y, segment.end.y) / ROUTE_SEGMENT_CELL_SIZE);
    const maxCellY = Math.floor(Math.max(segment.start.y, segment.end.y) / ROUTE_SEGMENT_CELL_SIZE);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const cell = routeCellKey(cellX, cellY);
        cells.add(cell);
        const bucket = routeSegmentGrid.get(cell);
        if (bucket) {
          bucket.push(indexed);
        } else {
          routeSegmentGrid.set(cell, [indexed]);
        }
      }
    }
  }
  routeSegmentCellsByEdge.set(edgeId, [...cells]);
}

/** Every indexed segment whose cell overlaps the rect, each yielded once. */
function queryRouteSegments(rect: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}): IndexedRouteSegment[] {
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.right) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.bottom)
  ) {
    return [];
  }

  routeSegmentQueryStamp += 1;
  const stamp = routeSegmentQueryStamp;
  const found: IndexedRouteSegment[] = [];
  const minCellX = Math.floor(rect.left / ROUTE_SEGMENT_CELL_SIZE);
  const maxCellX = Math.floor(rect.right / ROUTE_SEGMENT_CELL_SIZE);
  const minCellY = Math.floor(rect.top / ROUTE_SEGMENT_CELL_SIZE);
  const maxCellY = Math.floor(rect.bottom / ROUTE_SEGMENT_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = routeSegmentGrid.get(routeCellKey(cellX, cellY));
      if (!bucket) {
        continue;
      }
      for (const segment of bucket) {
        if (segment.seen === stamp) {
          continue;
        }
        segment.seen = stamp;
        found.push(segment);
      }
    }
  }
  return found;
}

/** The single door into the route cache, so the index can never drift from it. */
function setDirectRoute(
  edgeId: string,
  entry: {
    signature: string;
    routeIndex: number;
    route: RoutedEdgePath;
    segments: ReturnType<typeof getPolylineSegments>;
  },
) {
  directRouteCache.set(edgeId, entry);
  indexRouteSegments(edgeId, entry.routeIndex, entry.segments);
}

function deleteDirectRoute(edgeId: string) {
  directRouteCache.delete(edgeId);
  unindexRouteSegments(edgeId);
}

/* ------------------------------------------------------------------ */
/* The grid solve: every edge routed together, on the board's grid     */
/* ------------------------------------------------------------------ */

/**
 * What the grid solve needs to know about each edge, published by the
 * `flowEdges` memo before any edge renders (the same pattern as
 * `publishedEdgeStrokeWidths`): routing happens inside the edge components,
 * and by then the full list has to be settled — lane sharing is a property
 * of ALL the wires, not of one.
 */
type GridRouteEdgeInput = {
  edgeId: string;
  order: number;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandleId?: string;
  targetHandleId?: string;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  /** Storage/trash cards dock on whichever side routes best. */
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
  /**
   * The width the SOLVER packs lanes with. Deliberately separate from the
   * drawn stroke: hover highlights fatten the drawn line, and a hover must
   * never change a route.
   */
  routingWidth: number;
  /** User-pinned stops the wire must pass through, in order. */
  waypoints?: Array<{ x: number; y: number }>;
};

let publishedGridRouteEdges: GridRouteEdgeInput[] = [];
/** Free docking (anywhere on the perimeter) vs fixed ports — see the toggle. */
let publishedGridFreeDock = true;
let gridSolveSignature = "";
/**
 * Fast-path gate. Building the full signature walks every edge's endpoints,
 * and ensureGridSolve is called from every edge's render — without a gate
 * that is O(edges²) endpoint resolutions per pass. Anything that could
 * change the solve moves one of these two numbers: a new edge list bumps the
 * stamp, and any geometry/measurement change bumps the measured layout
 * epoch (mounting a culled node re-measures it, which reaches the epoch via
 * the geometry fingerprint).
 */
let gridSolveInputsStamp = 0;
let gridSolveCheckedStamp = -1;
let gridSolveCheckedEpoch = -1;

function publishGridRouteEdges(edges: GridRouteEdgeInput[], freeDock: boolean) {
  publishedGridRouteEdges = edges;
  publishedGridFreeDock = freeDock;
  gridSolveInputsStamp += 1;
}

/**
 * The dock candidates for one end of one edge: the ENTIRE perimeter of the
 * card, one candidate per grid line crossing the border.
 *
 * Docking is fully dynamic — a wire attaches wherever routes cheapest and
 * least cluttered, on any side, and the router's dock claiming plus lane
 * capacity spread multiple wires apart around the card. Ports stay the
 * places you START a wire and read the numbers; where the drawn wire meets
 * the card is the router's call.
 */
function resolveGridRouteEndpoints(
  input: GridRouteEdgeInput,
  end: "source" | "target",
): GridEndpoint[] {
  const nodeId = end === "source" ? input.sourceNodeId : input.targetNodeId;
  const rect = getMeasuredNodeBoundsById(nodeId);
  if (!rect) {
    return [];
  }
  const snap = (value: number) => Math.round(value / BOARD_GRID) * BOARD_GRID;
  // The machine tab zone: routed as card (the rect includes it, so wires
  // keep their clearance over the tabs) but not a real edge. Top docks stay
  // on the routed box and extend their drawn stub down through the zone to
  // the window's true edge; side docks simply start below it.
  const topInset = snap(getDockTopInset(nodeId));

  // A machine wired into itself always uses fixed ports, whatever the anchor
  // toggle says. In free mode both ends of that wire offer the same card's
  // whole perimeter, and the cheapest way to get from a card to itself is to
  // not move: both ends pick one dock and the loop collapses to a stub. The
  // real input and output rows give it two genuinely different ends, so the
  // wire has to travel around the card and reads as the loop it is.
  const isSelfLoop = input.sourceNodeId === input.targetNodeId;

  // Fixed-port mode (the anchor toggle, off): wires attach the classic way —
  // machine inputs on the left at their port row, outputs on the right, and
  // storage/trash cards on whichever side centre routes best.
  if (!publishedGridFreeDock || isSelfLoop) {
    const isSlot = end === "source" ? input.sourceSlotEndpoint : input.targetSlotEndpoint;
    if (isSlot) {
      const handleId = end === "source" ? input.sourceHandleId : input.targetHandleId;
      const handle = parseResourceHandleId(handleId);
      const edgeSide = handle?.side === "input" ? Position.Left : Position.Right;
      const side: GridSide = edgeSide === Position.Left ? "left" : "right";
      const measured = getMeasuredSlotEndpoint({ nodeId, handleId, edgeSide });
      if (measured) {
        return [{ x: measured.x, y: measured.y, side }];
      }
      // Unmeasured (first paint of a culled node): the card edge at a
      // plausible port height until the real measurement lands.
      return [
        {
          x: side === "left" ? rect.left : rect.right,
          y: Math.min(rect.top + 60, (rect.top + rect.bottom) / 2),
          side,
        },
      ];
    }
    const fixedCenterX = snap((rect.left + rect.right) / 2);
    const fixedCenterY = snap((rect.top + topInset + rect.bottom) / 2);
    return [
      { x: rect.left, y: fixedCenterY, side: "left" },
      { x: rect.right, y: fixedCenterY, side: "right" },
      { x: fixedCenterX, y: rect.top, side: "top", stubDepth: topInset || undefined },
      { x: fixedCenterX, y: rect.bottom, side: "bottom" },
    ];
  }

  const left = snap(rect.left);
  const right = snap(rect.right);
  const top = snap(rect.top);
  const bottom = snap(rect.bottom);
  // Every grid line crossing the border is a candidate; huge multiblock
  // cards coarsen to every other line so the candidate set stays bounded.
  const perimeterCells = (right - left + (bottom - top)) / BOARD_GRID;
  const step = perimeterCells > 60 ? 2 * BOARD_GRID : BOARD_GRID;
  // Corners and their neighbourhoods are off limits: a wire hanging off the
  // very corner of a card reads as clipped through it. Docks start two
  // cells in from each corner — close is fine, corner is not.
  const cornerKeepOut = 2 * BOARD_GRID;
  // The window's true top: side docks exist only below it, and the corner
  // keep-out measures from IT — the window's corner, not the phantom box's.
  const dockTop = top + topInset;
  // A top-dock stub descends straight through the zone at its own x. Left of
  // this line the tab art sits, and a stub there would draw the wire (and
  // its marching dashes) across a tab — those docks simply do not exist.
  // Half a cell of margin keeps a fat stub's edge off the last tab too.
  const tabsKeepOut =
    topInset > 0 ? rect.left + getDockTabsRight(nodeId) + BOARD_GRID / 2 : -Infinity;
  const centerX = (left + right) / 2;
  const centerY = (dockTop + bottom) / 2;
  const candidates: GridEndpoint[] = [];
  for (let x = left + cornerKeepOut; x <= right - cornerKeepOut; x += step) {
    const penalty = Math.abs(x - centerX) * DOCK_CENTER_BIAS;
    if (x > tabsKeepOut) {
      candidates.push({ x, y: top, side: "top", penalty, stubDepth: topInset || undefined });
    }
    candidates.push({ x, y: bottom, side: "bottom", penalty });
  }
  for (let y = dockTop + cornerKeepOut; y <= bottom - cornerKeepOut; y += step) {
    const penalty = Math.abs(y - centerY) * DOCK_CENTER_BIAS;
    candidates.push({ x: left, y, side: "left", penalty }, { x: right, y, side: "right", penalty });
  }
  // A card too small to keep two cells off every corner (nothing on the
  // board today, but a future tiny widget) falls back to its side centres.
  if (candidates.length === 0) {
    candidates.push(
      { x: left, y: snap(centerY), side: "left" },
      { x: right, y: snap(centerY), side: "right" },
      { x: snap(centerX), y: bottom, side: "bottom" },
    );
    if (snap(centerX) > tabsKeepOut) {
      candidates.push({ x: snap(centerX), y: top, side: "top", stubDepth: topInset || undefined });
    }
  }
  return candidates;
}

/**
 * Cost per pixel of distance from a side's centre when choosing a dock. At
 * 0.25, docking mid-way out a machine's long side costs about one extra
 * turn — so wires facing each other meet centre-to-centre, and a wire only
 * slides toward a corner when the route genuinely earns it.
 */
const DOCK_CENTER_BIAS = 0.25;

/**
 * Runs the grid solve if anything it depends on changed, and parks every
 * route in `directRouteCache` under the solve's signature. Called lazily by
 * the first edge that renders after an invalidation; every other edge in the
 * same pass gets cache hits. Geometry changes bump the sweep hash, endpoint
 * measurements and width changes show up in the per-edge parts, and an
 * unchanged board is one string compare.
 */
function ensureGridSolve() {
  if (
    gridSolveCheckedStamp === gridSolveInputsStamp &&
    gridSolveCheckedEpoch === measuredLayoutEpoch
  ) {
    return;
  }
  gridSolveCheckedStamp = gridSolveInputsStamp;
  gridSolveCheckedEpoch = measuredLayoutEpoch;

  const sweep = getMeasuredAvoidanceSweep();
  const requests: GridRouteRequest[] = [];
  const orderByEdge = new Map<string, number>();
  const parts: string[] = [];
  for (const input of publishedGridRouteEdges) {
    const sources = resolveGridRouteEndpoints(input, "source");
    const targets = resolveGridRouteEndpoints(input, "target");
    if (sources.length === 0 || targets.length === 0) {
      continue;
    }
    requests.push({
      edgeId: input.edgeId,
      order: input.order,
      sources,
      targets,
      strokeWidth: Math.min(input.routingWidth, LANE_CAPACITY),
      waypoints: input.waypoints,
    });
    orderByEdge.set(input.edgeId, input.order);
    // Free-dock candidates derive purely from the card rects, and the sweep
    // hash already covers those — identity suffices. Fixed-port anchors also
    // depend on lazily-arriving slot measurements, so their coords go in.
    const waypointPart =
      input.waypoints && input.waypoints.length > 0
        ? `|wp:${input.waypoints
            .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
            .join("+")}`
        : "";
    const describe = publishedGridFreeDock
      ? waypointPart
      : `${waypointPart}|${sources
          .map((endpoint) => `${Math.round(endpoint.x)},${Math.round(endpoint.y)}`)
          .join("+")}|${targets
          .map((endpoint) => `${Math.round(endpoint.x)},${Math.round(endpoint.y)}`)
          .join("+")}`;
    parts.push(
      `${input.edgeId}|${input.order}|${input.routingWidth}|${input.sourceNodeId}|${input.targetNodeId}${describe}`,
    );
  }

  const signature = `${publishedGridFreeDock ? "free" : "ports"}::${sweep.hash}::${parts.join(";")}`;
  if (signature === gridSolveSignature) {
    return;
  }
  gridSolveSignature = signature;

  const obstacles = sweep.bounds.map((entry) => ({ id: entry.id, ...entry.bounds }));
  const solved = solveGridRoutes(obstacles, requests);
  for (const [edgeId, routed] of solved) {
    if (routed.points.length < 2) {
      deleteDirectRoute(edgeId);
      continue;
    }
    setDirectRoute(edgeId, {
      signature,
      routeIndex: orderByEdge.get(edgeId) ?? 0,
      route: buildRoutedEdgePath(routed.points),
      segments: getPolylineSegments(routed.points),
    });
  }
  // Edges that rendered before this solve saw the previous routes; the
  // settle pass re-issues them against the fresh cache.
  routeCacheGrewThisPass = true;
}

function clearDirectRoutes() {
  directRouteCache.clear();
  routeSegmentGrid.clear();
  routeSegmentCellsByEdge.clear();
  // The cache is the solve's output: with it gone, an unchanged signature
  // must not short-circuit the next ensureGridSolve into doing nothing.
  gridSolveSignature = "";
  gridSolveCheckedStamp = -1;
}

// Measured geometry is stored in FLOW coordinates, which are invariant under pan
// and zoom: translating the viewport cannot move a node relative to the graph
// origin. Keying these caches on the viewport transform (as they once were) threw
// every entry away on every pan frame and forced a full re-measure of the whole
// board, which is what made panning and zooming crawl.
//
// Instead they are keyed on a layout epoch that the board bumps when node
// positions or sizes actually change. Only `viewportTransformCache` is
// frame-scoped, because the screen->flow conversion genuinely does depend on the
// live transform.
type MeasuredBounds = { left: number; right: number; top: number; bottom: number };

const missingRecipePlaceholders = new Map<string, RecipeFlowNode["data"]["recipe"]>();

/**
 * Stable stand-in for a recipe the dataset no longer contains. Built once per id
 * so the node's `data` keeps a constant identity across rebuilds.
 */
function getMissingRecipePlaceholder(recipeId: string) {
  const existing = missingRecipePlaceholders.get(recipeId);
  if (existing) {
    return existing;
  }

  const placeholder = {
    id: recipeId,
    name: "Missing recipe",
    machineType: "Unknown",
    minimumTier: "DEMO",
    durationTicks: 20,
    eut: 0,
    inputs: [],
    outputs: [],
  } satisfies RecipeFlowNode["data"]["recipe"];
  missingRecipePlaceholders.set(recipeId, placeholder);
  return placeholder;
}

// Identity caches for node `data`. These are memoisation caches in the same
// spirit as useMemo — the value returned is always derived purely from the
// inputs, so a render that is discarded or replayed cannot produce a wrong
// result, only a different (equivalent) object identity. They live at module
// scope rather than in a ref because reading a ref during render is not allowed.
const recipeNodeDataCache = new Map<string, RecipeFlowNode["data"]>();
const storageNodeDataCache = new Map<string, StorageFlowNode["data"]>();
const trashNodeDataCache = new Map<string, TrashFlowNode["data"]>();
const annotationNodeDataCache = new Map<string, AnnotationFlowNode["data"]>();
const pocketNodeDataCache = new Map<string, PocketFlowNode["data"]>();
// Same idea for edges, but with structural comparison: an edge object nests
// fresh data/style objects on every rebuild, and handing React Flow an equal-
// but-new identity re-renders the edge — which re-runs the route solver. Most
// rebuilds (hover, solver run) leave most edges untouched.
const edgeObjectCache = new Map<string, ResourceFlowEdge>();

/**
 * Representative edge id → every flat edge id its drawn wire stands for
 * (collapsed-pocket channels). Rebuilt by the edges memo each pass; the
 * delete paths read it so removing the wire removes the whole channel.
 */
const channelEdgeIdsByRepresentative = new Map<string, string[]>();

/** Deleting a drawn wire deletes every flat edge it stands for. */
function expandChannelEdgeIds(edgeIds: string[]): string[] {
  return edgeIds.flatMap((id) => channelEdgeIdsByRepresentative.get(id) ?? [id]);
}

/**
 * Shallow field-for-field equality between two board nodes.
 *
 * Deliberately compares EVERY key on both sides, including the ones React Flow
 * adds itself (`selected`, `dragging`): a node the library has annotated is not
 * interchangeable with a freshly built one, so those must count as different
 * and be replaced, exactly as they were before.
 */
function isSameFlowNode(left: BoardFlowNode, right: BoardFlowNode) {
  const leftKeys = Object.keys(left) as Array<keyof BoardFlowNode>;
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function pruneNodeDataCaches(
  recipeNodeIds: Set<string>,
  storageIds: Set<string>,
  annotationIds: Set<string>,
  edgeIds: Set<string>,
  pocketIds: Set<string>,
) {
  for (const id of pocketNodeDataCache.keys()) {
    if (!pocketIds.has(id)) {
      pocketNodeDataCache.delete(id);
    }
  }

  for (const id of edgeObjectCache.keys()) {
    if (!edgeIds.has(id)) {
      edgeObjectCache.delete(id);
    }
  }

  // A deleted edge's cached route otherwise lives on as a ghost: hop
  // rendering bumps over it and nearness scoring steers around it.
  for (const id of [...directRouteCache.keys()]) {
    if (!edgeIds.has(id)) {
      deleteDirectRoute(id);
    }
  }

  for (const id of annotationNodeDataCache.keys()) {
    if (!annotationIds.has(id)) {
      annotationNodeDataCache.delete(id);
    }
  }

  for (const id of recipeNodeDataCache.keys()) {
    if (!recipeNodeIds.has(id)) {
      recipeNodeDataCache.delete(id);
    }
  }

  for (const id of trashNodeDataCache.keys()) {
    if (!recipeNodeIds.has(id)) {
      trashNodeDataCache.delete(id);
    }
  }

  for (const id of storageNodeDataCache.keys()) {
    if (!storageIds.has(id)) {
      storageNodeDataCache.delete(id);
    }
  }
}

/**
 * Set whenever a render writes a route into directRouteCache, so the board can
 * run one more pass and let hop rendering see a complete cache. See the settle
 * effect in FactoryFlow.
 */
let routeCacheGrewThisPass = false;
const MAX_HOP_SETTLE_PASSES = 2;

// Node ids currently being dragged. While a drag is live, edges touching these
// nodes drop to cheap estimated routing (so they can follow the pointer without
// DOM measurement), every other edge keeps its cached route untouched, and the
// full precise reroute runs once on drop. Module state rather than React state:
// the edges that need it re-render every frame anyway via their position props.
const activelyDraggedNodeIds = new Set<string>();

// The board clipboard lives at module scope on purpose: it survives design-tab
// switches, so a selection copied in one design pastes into another.
// `pasteCount` staggers repeated pastes, each landing two cells past the last.
let boardClipboard: { payload: BoardClipboardPayload; pasteCount: number } | undefined;

const measuredNodeBoundsCache = new Map<string, MeasuredBounds | undefined>();
// Obstacle geometry for route avoidance, published by the board from React
// Flow's node state (positions plus measured sizes). The sweep used to scan
// `.react-flow__node` elements, but with `onlyRenderVisibleElements` the DOM
// only holds the nodes currently on screen — so every pan frame changed the
// obstacle set, invalidating every cached route (and quietly making routes
// depend on the viewport, which AGENTS.md forbids).
let publishedBoardBounds: Array<{ id: string; bounds: MeasuredBounds }> | undefined;
let publishedBoardGeometryById = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();

/**
 * While a wire is being dragged: for every card on the board, the port a drop
 * would land on, or null when that card refuses the resource. Empty at rest.
 *
 * Module state rather than a ref because two unrelated consumers read it — the
 * green/red wash painter and the connection line, which React Flow renders
 * itself with no path to pass props down. Both answering from one map is what
 * keeps the pipe, the wash and the drop from ever disagreeing.
 */
const activeDropTargets = new Map<string, ResolvedResourceHandle | null>();

// Slot endpoints cached relative to their node's origin, keyed by node size.
// Measuring through the DOM made an edge's endpoints depend on whether its
// node happened to be mounted (`onlyRenderVisibleElements` culls off-screen
// nodes), so routes flip-flopped between measured and estimated shapes as the
// viewport moved — re-scoring on every flip. A slot cannot move inside its
// node without the node changing size, so node-relative points survive
// unmounts and moves alike; absolute positions come from the published
// geometry above.
const relativeSlotEndpointCache = new Map<string, { x: number; y: number }>();
const relativeSlotCenterCache = new Map<string, { x: number; y: number }>();

function boardGeometryDimsKey(geometry: { width: number; height: number } | undefined) {
  return geometry ? `${Math.round(geometry.width)}x${Math.round(geometry.height)}` : "?";
}
/** Node-obstacle grid cell, in flow px. See queryMeasuredNodeBounds. */
const NODE_BOUNDS_CELL_SIZE = 1024;
let measuredAvoidanceSweep:
  | {
      epoch: number;
      bounds: Array<{ id: string; bounds: MeasuredBounds }>;
      /** id -> rect, so an edge's own nodes are a lookup, not a scan. */
      byId: Map<string, MeasuredBounds>;
      /** Uniform grid over the same rects, for "what is near this route". */
      grid: Map<number, Array<{ id: string; bounds: MeasuredBounds }>>;
      hash: string;
    }
  | undefined;
let measuredLayoutEpoch = 0;

let viewportTransformCache:
  | {
      rendererLeft: number;
      rendererTop: number;
      translateX: number;
      translateY: number;
      scaleX: number;
      scaleY: number;
    }
  | undefined;
let viewportTransformClearScheduled = false;

/**
 * Drops every flow-space measurement. Call this when node positions or node
 * inner layout change — never on pan or zoom, which cannot affect flow-space
 * geometry.
 */
function invalidateMeasuredLayout() {
  measuredLayoutEpoch += 1;
  measuredNodeBoundsCache.clear();
  measuredAvoidanceSweep = undefined;
}

type DraggedResourceConnection = Pick<
  ResourceAmount,
  | "kind"
  | "id"
  | "displayName"
  | "iconPath"
  | "iconAtlas"
  | "dominantColor"
  | "tooltip"
  | "alternatives"
> & {
  nodeId: string;
  /**
   * The side the drag LEFT from, and so the default direction of the wire it
   * makes. For a drawer this is always "output" and means nothing more than
   * "the drawer offers what it holds" - see `bidirectional`.
   */
  side: "input" | "output";
  handleId: string;
  /**
   * The drag can go EITHER way, and the far end decides which.
   *
   * A drawer holds one item and the whole card is one grab point, so "wire
   * this drawer up" is a single gesture: drop it on something that eats the
   * item and the drawer feeds it, drop it on something that makes the item and
   * it fills the drawer. It used to be two invisible half-cards, one per
   * direction, and grabbing the wrong half washed a perfectly good target red.
   */
  bidirectional?: boolean;
};

interface ResolvedResourceHandle {
  nodeId: string;
  handleId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
}

export function FactoryFlow() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const moveBoardItems = useFactoryStore((state) => state.moveBoardItems);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const pasteBoardItems = useFactoryStore((state) => state.pasteBoardItems);
  const activePocketId = useFactoryStore((state) => state.activePocketId);
  const enterPocket = useFactoryStore((state) => state.enterPocket);
  // Blueprint overwrite picker mode: a shelf row is waiting for the user to
  // click a pocket. The board wears it — banner up top, pockets ringed.
  const overwritePicking = useBlueprintStore((state) => state.overwritePicking);
  const compactSelectionIntoPocket = useFactoryStore(
    (state) => state.compactSelectionIntoPocket,
  );
  const setPendingBoardSelection = useFactoryStore((state) => state.setPendingBoardSelection);
  const setSelectedBoardIds = useFactoryStore((state) => state.setSelectedBoardIds);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const connectNodesBatch = useFactoryStore((state) => state.connectNodesBatch);
  const connectCustomRate = useFactoryStore((state) => state.connectCustomRate);
  const connectTrash = useFactoryStore((state) => state.connectTrash);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const addAnnotation = useFactoryStore((state) => state.addAnnotation);
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const deleteAnnotation = useFactoryStore((state) => state.deleteAnnotation);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const boardView = useBoardView();
  const { freeDockMode, lineHeatMode, lineLabelsMode, lineThicknessMode, linePulseMode, calmMode } =
    boardView;
  // Device taste, not plan state: never captured into plan-view snapshots.
  const boardMotion = useBoardMotion();
  const canvasTheme = getCanvasTheme(boardView.canvasTheme);
  const anyLineMode = lineHeatMode || lineThicknessMode || linePulseMode;
  const setFlowViewportCenter = useFactoryStore((state) => state.setFlowViewportCenter);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const hoveredUsageNodeId = useFactoryStore((state) => state.hoveredUsageNodeId);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  // The side panel's question: hover or click a resource row and every wire and
  // card carrying it lights up, wherever it is. Hovering a DRAWER on the board
  // asks a narrower one and takes the flow-scope path instead, so it is not
  // folded in here any more (it used to be, and lit half the board).
  const activeFlowResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const activeNodeBottlenecks = hoveredNodeBottlenecks || selectedNodeBottlenecks;
  const recipesById = useMemo(
    () => new Map(project.recipes.map((recipe) => [recipe.id, recipe])),
    [project.recipes],
  );
  const storagesById = useMemo(
    () => new Map((project.storages ?? []).map((storage) => [storage.id, storage])),
    [project.storages],
  );

  // The pocket dimension view. The graph is always the whole flat project;
  // the board only ever SHOWS one level of it — cards whose pocketId is the
  // active level, plus one collapsed card per pocket that sits on this level.
  // `representativeOf` maps any project item to what stands for it here: the
  // item itself when it is on this level, the ancestor pocket card that
  // swallowed it, or undefined when it is outside this view entirely (which
  // is what hides the rest of the plan while zoomed into a pocket).
  const pocketView = useMemo(() => {
    const pockets = project.pockets ?? [];
    const parentById = new Map(pockets.map((pocket) => [pocket.id, pocket.parentPocketId]));
    const itemPocketById = new Map<string, string | undefined>();
    for (const node of project.nodes) {
      itemPocketById.set(node.id, node.pocketId);
    }
    for (const storage of project.storages ?? []) {
      itemPocketById.set(storage.id, storage.pocketId);
    }

    const representativeOf = (itemId: string): string | undefined => {
      let level = itemPocketById.get(itemId);
      if (level === activePocketId) {
        return itemId;
      }
      const seen = new Set<string>();
      while (level !== undefined && !seen.has(level)) {
        seen.add(level);
        const parent = parentById.get(level);
        if (parent === activePocketId) {
          return level;
        }
        level = parent;
      }
      return undefined;
    };

    return {
      representativeOf,
      visiblePockets: pockets.filter((pocket) => pocket.parentPocketId === activePocketId),
    };
  }, [activePocketId, project.nodes, project.storages, project.pockets]);

  // Scoped solves are small (a pocket's members only) and run once per
  // project commit, not per hover — see pocket-summary.ts.
  const pocketSummaries = useMemo(
    () => computePocketSummaries(project, pocketView.visiblePockets),
    [project, pocketView.visiblePockets],
  );

  // The rails a pocket card wears. Built here rather than inside the card for
  // the same reason the summaries are: this reads the whole plan's solve, and
  // a card that derived it per render would redo it on every unrelated store
  // write. Keyed off the result too, so the bars follow the live numbers.
  const pocketRails = useMemo(() => {
    const rails = new Map<string, ReturnType<typeof buildPocketRailPorts>>();
    for (const pocket of pocketView.visiblePockets) {
      const summary = pocketSummaries.get(pocket.id);
      if (summary) {
        rails.set(pocket.id, buildPocketRailPorts(project, result, pocket.id, summary));
      }
    }
    return rails;
  }, [project, result, pocketSummaries, pocketView.visiblePockets]);

  const nodesFromProject = useMemo<BoardFlowNode[]>(
    () => [
      ...project.nodes
        .filter((node) => node.pocketId === activePocketId)
        .map((node): BoardFlowNode => {
        const recipe = recipesById.get(node.recipeId) ?? getMissingRecipePlaceholder(node.recipeId);
        // Trash cans get their own compact card; a distinct node TYPE (not a
        // branch inside RecipeNode) so the hook order of the big machine card
        // never depends on what recipe a node holds.
        if (isTrashRecipe(recipe)) {
          return {
            id: node.id,
            type: "trashNode",
            position: node.position,
            zIndex: CARD_Z_INDEX,
            data: reuseObjectIdentity(trashNodeDataCache, node.id, {
              projectNode: node,
            }),
          } satisfies TrashFlowNode;
        }
        return {
          id: node.id,
          type: "recipeNode",
          position: node.position,
          zIndex:
            hoveredUsageNodeId === node.id
              ? 1500
              : activeNodeBottlenecks && result.nodes[node.id]?.status === "bottleneck"
                ? 1500
                : activeFlowResourceKey && recipeContainsResourceKey(recipe, activeFlowResourceKey)
                  ? 1500
                  : CARD_Z_INDEX,
          // Reusing the previous `data` object when nothing in it moved is what
          // lets RecipeNode's memo actually hold. Rebuilding it — which this memo
          // does whenever a resource is hovered or the solver re-runs — otherwise
          // re-renders every node on the board for a change affecting one.
          data: reuseObjectIdentity(recipeNodeDataCache, node.id, {
            projectNode: node,
            recipe,
            result: result.nodes[node.id],
          }),
        } satisfies RecipeFlowNode;
      }),
      ...(project.storages ?? [])
        .filter((storage) => storage.pocketId === activePocketId)
        .map(
        (storage) =>
          ({
            id: storage.id,
            type: "storageNode",
            position: storage.position,
            zIndex:
              activeFlowResourceKey === makeResourceKey(storage.kind, storage.resourceId)
                ? 1500
                : CARD_Z_INDEX,
            data: reuseObjectIdentity(storageNodeDataCache, storage.id, {
              storage,
              result: result.storages[storage.id],
            }),
          }) satisfies StorageFlowNode,
      ),
      ...(project.annotations ?? [])
        .filter((annotation) => annotation.pocketId === activePocketId)
        .map(
        (annotation) =>
          ({
            id: annotation.id,
            type: "annotationNode",
            position: annotation.position,
            width: annotation.size.width,
            height: annotation.size.height,
            // Boxes, zones and images sit under everything so they read as
            // grouping frames and backdrops; arrows and text notes float
            // above the nodes they point at. The class is how the CSS knows
            // a backdrop from a card: the global "selected nodes rise"
            // rule must never lift a box's wash over the machines it frames.
            zIndex:
              annotation.kind === "box" ||
              annotation.kind === "zone" ||
              annotation.kind === "image"
                ? -5
                : 1000,
            className:
              annotation.kind === "box" ||
              annotation.kind === "zone" ||
              annotation.kind === "image"
                ? "board-backdrop"
                : undefined,
            // Box/arrow interiors must stay click-through; only their
            // drag-handle elements take pointer events (see AnnotationNode).
            dragHandle: annotation.kind === "text" ? undefined : `.${ANNOTATION_DRAG_HANDLE_CLASS}`,
            style: annotation.kind === "text" ? undefined : { pointerEvents: "none" as const },
            data: reuseObjectIdentity(annotationNodeDataCache, annotation.id, { annotation }),
          }) satisfies AnnotationFlowNode,
      ),
      ...pocketView.visiblePockets.map(
        (pocket) =>
          ({
            id: pocket.id,
            type: "pocketNode",
            position: pocket.position,
            zIndex: CARD_Z_INDEX,
            data: reuseObjectIdentity(pocketNodeDataCache, pocket.id, {
              pocket,
              summary: pocketSummaries.get(pocket.id),
              railPorts: pocketRails.get(pocket.id),
            }),
          }) satisfies PocketFlowNode,
      ),
    ],
    [
      activeFlowResourceKey,
      activeNodeBottlenecks,
      activePocketId,
      hoveredUsageNodeId,
      pocketRails,
      pocketSummaries,
      pocketView.visiblePockets,
      project.annotations,
      project.nodes,
      project.storages,
      recipesById,
      result.nodes,
      result.storages,
    ],
  );
  const [flowNodes, setFlowNodes] = useState<BoardFlowNode[]>(() => nodesFromProject);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<FactoryAnnotationKind | undefined>(
    undefined,
  );
  // Shared by the brush and the annotation tools: the last colour picked in
  // the palette is what a new box/arrow/note is created with. Blue to start:
  // the house colour, and legible on every paper the board ships with.
  const [activeColorTag, setActiveColorTag] = useState<FactoryNodeColorTag>("blue");
  const [isDeleteMode, setDeleteMode] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | undefined>(undefined);
  const annotationDraftRef = useRef<AnnotationDraft | undefined>(undefined);
  const [layoutVersion, setLayoutVersion] = useState(0);
  // Bumped whenever a paste/compact/blueprint-load hands the selection to
  // fresh cards. React Flow keeps its band-selection GROUP RECTANGLE up
  // through that handoff, parked over the new card and eating every click —
  // the controller below watches this counter and dismisses the rect.
  const [selectionHandoffCount, setSelectionHandoffCount] = useState(0);
  // Compacting would pool same-resource supplies from different places:
  // the selection waits here while the player reads what would happen.
  const [compactWarning, setCompactWarning] = useState<
    { ids: string[]; warnings: PocketConvergenceWarning[] } | undefined
  >(undefined);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
  const dropFitFrameRef = useRef<number | undefined>(undefined);
  const exportInProgressRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  // Every breathing mark under this element - dead rings and their wires,
  // unwired cards and the notice about them, the hovered-resource wash - shares
  // one period (--board-pulse) and, from here, one phase. See animation-phase.ts.
  useBoardPulseSync(boardRef);
  const flowInstanceRef = useRef<ReactFlowInstance<BoardFlowNode, ResourceFlowEdge> | null>(null);
  // A phone changes several things about the board: which cards can be dragged,
  // which toolbars are folded, where the centred banners sit.
  const isCompact = useIsCompactViewport();

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    // Rebuilt node objects don't carry React Flow's `measured` sizes; syncing
    // them in verbatim would zero every node's dimensions until React Flow
    // re-measures, which the geometry fingerprints below would read as the
    // whole board resizing twice — rerouting everything on every hover.
    //
    // The merge also has to hand back the PREVIOUS object whenever nothing in
    // it moved. `nodesFromProject` is rebuilt whenever a hover changes which
    // node is lifted, and spreading `measured` in produced a brand new object
    // for every node on the board — so hovering one port re-rendered all of
    // them, re-ran their memo comparisons and churned the compositor's layer
    // tree. Identity is the whole mechanism the node memos rely on; this is
    // where it was being thrown away.
    // The store carries ids a paste or a blueprint load wants selected once
    // the pasted cards exist in flowNodes — which is here, after this rebuild.
    // Consumed in the effect body, NOT inside the updater: state updaters
    // must stay pure (StrictMode double-invokes them, and the second call
    // would find the handoff already cleared).
    const pendingIds = useFactoryStore.getState().pendingBoardSelectionIds;
    const pendingSelection = pendingIds ? new Set(pendingIds) : undefined;
    if (pendingIds) {
      setPendingBoardSelection(undefined);
      setSelectionHandoffCount((count) => count + 1);
    }
    setFlowNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      let changed = current.length !== nodesFromProject.length;
      const next = nodesFromProject.map((node) => {
        const previous = currentById.get(node.id);
        // React Flow keeps selection on the node objects themselves, so the
        // rebuilt objects must inherit it — without this, EVERY project
        // commit (a drag drop, a config change, a solver rerun) silently
        // deselected the user's whole selection. A pending paste instead
        // hands the selection over to the freshly pasted cards.
        const selected = pendingSelection ? pendingSelection.has(node.id) : previous?.selected;
        const merged = {
          ...node,
          ...(previous?.measured ? { measured: previous.measured } : undefined),
          ...(selected !== undefined ? { selected } : undefined),
        } as typeof node;
        if (previous && isSameFlowNode(previous, merged)) {
          return previous;
        }
        changed = true;
        return merged;
      });
      return withTouchDragRule(changed ? next : current, isCompact);
    });
  }, [isCompact, nodesFromProject, setPendingBoardSelection]);

  // Switching pulse mode off has to empty the canvas registry: the edges stay
  // mounted and simply stop publishing, so without this the last frame's
  // dashes would march on forever.
  useEffect(() => {
    if (!linePulseMode) {
      clearEdgePulses();
    }
  }, [linePulseMode]);

  useEffect(() => {
    pruneNodeDataCaches(
      new Set(project.nodes.map((node) => node.id)),
      new Set((project.storages ?? []).map((storage) => storage.id)),
      new Set((project.annotations ?? []).map((annotation) => annotation.id)),
      new Set(project.edges.map((edge) => edge.id)),
      new Set((project.pockets ?? []).map((pocket) => pocket.id)),
    );
  }, [project.nodes, project.storages, project.annotations, project.edges, project.pockets]);

  // Flow-space measurements are cached across frames, so anything that can move
  // a node or change its size has to drop them explicitly. `flowNodes` changes
  // identity for plenty of reasons that move nothing — hover zIndex, solver
  // results, drag frames — and invalidating on each of those used to force the
  // whole board to re-measure and reroute every edge per frame, which is what
  // made pans and drags stutter on large graphs. Geometry is therefore reduced
  // to a fingerprint of positions and React Flow's measured sizes (its own
  // ResizeObserver reports content growth, e.g. when icons or NEI layout
  // resolve, through `onNodesChange`).
  // Dimensions are rounded so re-measure jitter (remounts under culling,
  // sub-pixel differences) can't masquerade as a resize.
  // Two fingerprints, not one: the OBSTACLE one (machines, drawers, bins,
  // pockets) is what routing cares about, and moving it pays the full bill —
  // measurement invalidation, a re-solve, every edge re-issued. Annotations
  // are ink the wires pass straight through, so their fingerprint buys only
  // a cheap geometry refresh; folding both into one fingerprint was how
  // dragging a NOTE made six hundred wires re-check their routes.
  const describeNodeGeometry = (node: BoardFlowNode) =>
    `${node.id}:${node.position.x},${node.position.y},${Math.round(
      node.measured?.width ?? node.width ?? 0,
    )}x${Math.round(node.measured?.height ?? node.height ?? 0)}`;
  const obstacleGeometryFingerprint = useMemo(
    () =>
      flowNodes
        .filter((node) => node.type !== "annotationNode")
        .map(describeNodeGeometry)
        .join(";"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flowNodes],
  );
  const annotationGeometryFingerprint = useMemo(
    () =>
      flowNodes
        .filter((node) => node.type === "annotationNode")
        .map(describeNodeGeometry)
        .join(";"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flowNodes],
  );
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;
  // Synced in an effect rather than during render, and declared ABOVE the
  // camera effect below so this commit's cards are in the ref before that
  // effect reads them - which is the whole point, since a camera move is
  // usually asked for in the very commit that put the cards there.
  const nodesFromProjectRef = useRef(nodesFromProject);
  useEffect(() => {
    nodesFromProjectRef.current = nodesFromProject;
  }, [nodesFromProject]);

  /**
   * Where the cards are, and how big they are, for a camera move.
   *
   * Positions come from `nodesFromProject`, not from React Flow's own node
   * state, because a camera move is most often asked for in the same commit
   * that put the cards there - a setup opening, a pocket compacting - and
   * React Flow's copy is one render behind at that moment. Sizes are looked up
   * separately, by id, from the cards React Flow HAS rendered; the rest fall
   * back to the grid's own card sizes (see board-camera.ts).
   */
  const cameraCards = useCallback((nodeIds?: string[]) => {
    const wanted = nodeIds && nodeIds.length > 0 ? new Set(nodeIds) : undefined;
    const cards = wanted
      ? nodesFromProjectRef.current.filter((node) => wanted.has(node.id))
      : nodesFromProjectRef.current;
    const measuredById = new Map(
      flowNodesRef.current.map((node) => [node.id, node.measured] as const),
    );
    return { cards, measuredById };
  }, []);

  /**
   * Move the camera until `nodeIds` - or the whole board, when they are
   * omitted - is on screen, zooming out as far as it takes.
   */
  const frameBoardCards = useCallback(
    (nodeIds?: string[], framing?: BoardFraming) => {
      const instance = flowInstanceRef.current;
      const board = boardRef.current;
      if (!instance || !board) {
        return;
      }

      const size = board.getBoundingClientRect();
      if (size.width === 0 || size.height === 0) {
        return;
      }

      const { cards, measuredById } = cameraCards(nodeIds);
      const rect = framingRect(cards, measuredById);
      if (!rect) {
        // Nothing to frame: go home rather than sit wherever the last plan left
        // the camera. Switching to an empty tab is the common way here, and
        // landing on blank canvas a thousand cells from the origin is how the
        // first card you place ends up somewhere you have to go looking for.
        void instance.setCenter(0, 0, { zoom: 1, duration: BOARD_CAMERA_DURATION });
        return;
      }

      // A caller may reserve a strip down the right and ask to be framed in
      // what is left. It is a luxury, though: on a board too narrow to give the
      // strip away there is no framing left to do, so the whole width is used
      // and whatever sits in the strip is left to overlap.
      const wanted = Math.max(framing?.insetRight ?? 0, 0);
      const inset = size.width - wanted >= MIN_FRAMED_WIDTH ? wanted : 0;
      const usable = { width: size.width - inset, height: size.height };

      const zoom = zoomForRect(rect, usable, {
        padding: framing?.padding ?? BOARD_CAMERA_PADDING,
        minZoom: BOARD_MIN_ZOOM,
        maxZoom: framing?.maxZoom ?? BOARD_CAMERA_MAX_ZOOM,
      });
      // setCenter puts a board point at the middle of the WHOLE viewport, so
      // landing the cards in the middle of the usable part means handing it a
      // point half the inset further right.
      const centre = rectCentre(rect);
      void instance.setCenter(centre.x + inset / 2 / zoom, centre.y, {
        zoom,
        duration: BOARD_CAMERA_DURATION,
      });
    },
    [cameraCards],
  );

  /**
   * Put the camera exactly where a design tab was left. Instant: that tab was
   * already showing this, so there is nowhere to travel from.
   *
   * A camera that arrives before the board has initialised is parked for
   * `handleInit`. That is the ordinary case on a page load, where the design
   * store's read of IndexedDB races React Flow's first render.
   */
  const pendingCameraRef = useRef<BoardCamera>(undefined);
  const restoreBoardCamera = useCallback((camera: BoardCamera) => {
    const instance = flowInstanceRef.current;
    if (!instance) {
      pendingCameraRef.current = camera;
      return;
    }

    pendingCameraRef.current = undefined;
    void instance.setViewport(camera);
    // The board is on the arriving design now, so the moves it reports count as
    // that design's again. See design-camera.ts.
    settleDesignCamera();
  }, []);

  /**
   * A panel asked the board to move: fly to one card and centre it (a
   * double-clicked resource row), or zoom out until a set of cards - or a
   * whole freshly opened plan - fits.
   *
   * Runs off a token rather than the ids alone, so stepping through the cards
   * that share a resource still moves when the ring wraps back to the card the
   * viewport is already on.
   */
  const boardFocusRequest = useFactoryStore((state) => state.boardFocusRequest);
  const servedFocusTokenRef = useRef(boardFocusRequest?.token ?? 0);
  useEffect(() => {
    if (!boardFocusRequest || boardFocusRequest.token === servedFocusTokenRef.current) {
      return;
    }
    servedFocusTokenRef.current = boardFocusRequest.token;

    if (boardFocusRequest.mode === "viewport") {
      if (boardFocusRequest.camera) {
        restoreBoardCamera(boardFocusRequest.camera);
      } else {
        settleDesignCamera();
      }
      return;
    }

    if (boardFocusRequest.mode === "fit") {
      frameBoardCards(boardFocusRequest.nodeIds, boardFocusRequest.framing);
      // A tab with no remembered camera is framed instead, and where framing
      // puts it is what that tab remembers from here on.
      settleDesignCamera();
      return;
    }

    const instance = flowInstanceRef.current;
    const { cards, measuredById } = cameraCards(boardFocusRequest.nodeIds);
    const card = cards[0];
    if (!instance || !card) {
      return;
    }

    // One card, at 1:1, so it arrives readable however far out the user was.
    const centre = rectCentre(cardRect(card, measuredById.get(card.id)));
    void instance.setCenter(centre.x, centre.y, {
      zoom: 1,
      duration: BOARD_CAMERA_DURATION,
    });
  }, [boardFocusRequest, cameraCards, frameBoardCards, restoreBoardCamera]);

  // Publish the obstacle set for route avoidance from state, not the DOM: with
  // `onlyRenderVisibleElements` the DOM only holds on-screen nodes, so a
  // DOM-derived obstacle set changed on every pan and invalidated every cached
  // route. Reads through the ref so identity-only `flowNodes` churn (hover
  // zIndex, solver results) doesn't feed it.
  const publishBoardGeometry = useCallback((invalidateRoutes = true) => {
    // `invalidateRoutes: false` is the annotation path: notes and boxes are
    // not obstacles, so their moves refresh the published geometry maps and
    // deliberately leave the measurement epoch — and with it every cached
    // route and the O(edges) solve-signature rebuild — untouched.
    //
    // Lane width is a routing input just like node bounds, so it is published
    // from here — and because thickness mode is in this callback's deps, the
    // layout effect below re-runs on toggle and bumps the layout epoch, which
    // is what makes every edge reroute against the new lanes. Widening the
    // lanes invalidates every cached route, so they go too.
    //
    // Dock mode rides the same train for the same reason: the anchor toggle
    // republishes every endpoint, but an edge only redraws when its identity
    // changes — without the epoch bump the new docking arrived one hover at
    // a time, as each edge happened to re-render.
    const nextLaneScale = lineThicknessMode ? THICK_LINE_LANE_SCALE : 1;
    // Clearances are a routing input for the same reason lane width is, and
    // they move together: both are functions of the widest line the current
    // mode can draw. See edgeClearancesForMode.
    const nextClearances = edgeClearancesForMode(lineThicknessMode);
    if (
      publishedEdgeLaneScale !== nextLaneScale ||
      publishedDirectEdgeNodeClearance !== nextClearances.node ||
      publishedEdgeLinkClearance !== nextClearances.link
    ) {
      publishedEdgeLaneScale = nextLaneScale;
      publishedDirectEdgeNodeClearance = nextClearances.node;
      publishedEdgeLinkClearance = nextClearances.link;
      // Hop size follows the stroke widths now (see hopRadiusFor), and those
      // are republished on every pass — the routes just have to be rebuilt so
      // the new bumps are drawn.
      clearDirectRoutes();
    }
    const geometryById = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of flowNodesRef.current) {
      geometryById.set(node.id, {
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      });
    }
    publishedBoardGeometryById = geometryById;
    // Annotations are ink on the board, not furniture. A box drawn AROUND a
    // cluster used to be a solid obstacle spanning all of it, so every wire
    // inside was forced to detour around its own group — the drawing changed
    // the routing without changing the factory. Wires now pass straight
    // through boxes, arrows and notes as if they were not there.
    const annotationIds = new Set(
      flowNodesRef.current
        .filter((node) => node.type === "annotationNode")
        .map((node) => node.id),
    );
    publishedBoardBounds = [...geometryById.entries()]
      .filter(([id]) => !annotationIds.has(id))
      .map(([id, geometry]) => ({
        id,
        bounds: {
          left: geometry.x,
          top: geometry.y,
          right: geometry.x + geometry.width,
          bottom: geometry.y + geometry.height,
        },
      }))
      .filter((entry) => entry.bounds.right > entry.bounds.left)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (invalidateRoutes) {
      invalidateMeasuredLayout();
    }
  }, [freeDockMode, lineThicknessMode]);
  // Live-drag throttle state: when the last mid-drag solve ran, and the
  // trailing timer that guarantees the LAST cell a card entered still gets
  // its solve when the pointer stops moving inside a throttle window.
  const lastLiveDragSolveAtRef = useRef(0);
  const liveDragTrailingTimerRef = useRef<number | undefined>(undefined);
  // Whether the current drag moves anything wires route around; see
  // handleNodeDragStart.
  const dragMovesObstaclesRef = useRef(true);
  // The smallest wire count a mid-drag solve has ever blown the frame budget
  // at. Following stays off until the board shrinks well below it.
  const liveDragSlowAtEdgeCountRef = useRef(Infinity);
  // Times one live solve through to the frame it painted, and marks the
  // board size as too slow to follow if it blew the budget.
  const meterLiveDragSolve = useCallback((edgeCount: number, startedAt: number) => {
    window.requestAnimationFrame(() => {
      if (performance.now() - startedAt > LIVE_DRAG_BUDGET_MS) {
        liveDragSlowAtEdgeCountRef.current = Math.min(
          liveDragSlowAtEdgeCountRef.current,
          edgeCount,
        );
      }
    });
  }, []);
  useLayoutEffect(() => {
    // Drag frames rewrite positions constantly. Where the board can afford
    // it, the wires FOLLOW: a throttled real solve reruns against the card's
    // current cell, and the route morph glides every wire to it — the same
    // solve the drop will run, so nothing is ever a guess. The board decides
    // for itself when it cannot afford it, and freezes exactly as all drags
    // once did: an annotation-only drag (ink cannot change a route, so a
    // mid-drag solve would be pure cost), a board past the wire cap, or a
    // board whose own measured solves blew the frame budget. Deliberately
    // NOT a setting — a toggle here would just be a button that enables lag.
    // Untouched edges keep their cached routes and the drop republishes
    // explicitly (see handleNodeDragStop) — it has to, because React Flow
    // streams the final position into `flowNodes` during the last drag
    // frame, so this fingerprint does NOT change again after the drag ends.
    if (draggingNodeRef.current) {
      const edgeCount = publishedGridRouteEdges.length;
      if (
        !dragMovesObstaclesRef.current ||
        edgeCount > LIVE_DRAG_ROUTE_EDGE_LIMIT ||
        // Well below, not just below: a board hovering at the size that
        // lagged would flap between following and freezing.
        edgeCount >= liveDragSlowAtEdgeCountRef.current * 0.8
      ) {
        return;
      }
      const now = performance.now();
      const sinceLastSolve = now - lastLiveDragSolveAtRef.current;
      if (sinceLastSolve < LIVE_DRAG_SOLVE_MS) {
        // Inside the throttle window: book the trailing solve instead, so a
        // pointer that stops moving still sees its final cell routed.
        window.clearTimeout(liveDragTrailingTimerRef.current);
        liveDragTrailingTimerRef.current = window.setTimeout(() => {
          if (!draggingNodeRef.current) {
            return; // the drop already published
          }
          const trailingStart = performance.now();
          lastLiveDragSolveAtRef.current = trailingStart;
          publishBoardGeometry();
          setLayoutVersion((version) => version + 1);
          meterLiveDragSolve(edgeCount, trailingStart);
        }, LIVE_DRAG_SOLVE_MS - sinceLastSolve);
        return;
      }
      lastLiveDragSolveAtRef.current = now;
      meterLiveDragSolve(edgeCount, now);
    }

    publishBoardGeometry();
    // Edges rendered in the pass that carried this geometry change computed
    // their routes against the PREVIOUS published geometry (render runs before
    // layout effects), so a moved node's edges would keep pointing at where it
    // used to be. Re-issuing the edge objects makes them recompute against
    // what was just published; this also covers nodes growing when icons or
    // NEI layout resolve.
    setLayoutVersion((version) => version + 1);
  }, [obstacleGeometryFingerprint, publishBoardGeometry]);
  useLayoutEffect(() => {
    // Annotation geometry changed and nothing else: refresh the published
    // maps so anyone reading a note's rect sees where it is, and touch
    // nothing routing owns. Mid-drag this stays quiet too — the drop's
    // explicit publish (handleNodeDragStop) covers the landing, because the
    // fingerprint settles on the last drag frame and will not fire again.
    if (draggingNodeRef.current) {
      return;
    }
    publishBoardGeometry(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationGeometryFingerprint, publishBoardGeometry]);

  // Settle the hop pass. Hops are drawn against the routes of lower-index
  // edges, read from directRouteCache — which is filled AS edges render. React
  // promises no order there, so an edge that rendered before its neighbours saw
  // an incomplete cache, drew a flat crossing, and then never recomputed,
  // because its own route signature never changed again. That is why hops went
  // missing at random rather than consistently.
  //
  // Forcing a render order is not on offer, so let the pass settle instead:
  // whenever a render added routes to the cache, run exactly one more. By then
  // every route is present and every hop is drawn against the full picture.
  // The extra pass writes nothing new — same signatures, all cache hits — so it
  // terminates on its own; the counter is a backstop against a route whose
  // signature is somehow unstable, and resets as soon as a pass adds nothing.
  const hopSettlePassesRef = useRef(0);
  useEffect(() => {
    // Mid-drag the settle pass stays off: live-drag solves already rerender
    // every edge a few times a second, and a hop drawn against a partial
    // cache for a beat is not worth doubling that. The drop's publish forces
    // the full precise pass either way.
    if (draggingNodeRef.current) {
      return;
    }
    if (!routeCacheGrewThisPass) {
      hopSettlePassesRef.current = 0;
      return;
    }

    routeCacheGrewThisPass = false;
    if (hopSettlePassesRef.current >= MAX_HOP_SETTLE_PASSES) {
      return;
    }

    hopSettlePassesRef.current += 1;
    setLayoutVersion((version) => version + 1);
  });

  const handleNodesChange = useCallback(
    (changes: NodeChange<BoardFlowNode>[]) => {
      setFlowNodes((currentNodes) => {
        const next = applyNodeChanges(changes, currentNodes) as BoardFlowNode[];
        // Only when the selection moved. This runs on every frame of a drag, and
        // walking every card each frame is the kind of per-frame O(nodes) work
        // ARCHITECTURE.md rules out.
        return changes.some((change) => change.type === "select")
          ? withTouchDragRule(next, isCompact)
          : next;
      });
    },
    [isCompact],
  );

  const edges = useMemo<ResourceFlowEdge[]>(() => {
    // A producer starved of its own inputs cannot offer its nameplate, so
    // every capacity the labels see is scaled by the producer's real ceiling.
    // A machine merely idle for lack of demand keeps a ceiling of 1 - hooking
    // up a new consumer genuinely would speed it up.
    const supplyCeilings = new Map<string, number>();
    // Built once for the whole edge pass, not once per edge: the index itself
    // is cached per solve, but the lookup below runs for every wire.
    const deathSpiralEdges = findDeathSpirals(project, result).byEdge;
    const ceilingFor = (sourceId: string) => {
      let ceiling = supplyCeilings.get(sourceId);
      if (ceiling === undefined) {
        ceiling = getSupplyCeiling(project, result, sourceId);
        supplyCeilings.set(sourceId, ceiling);
      }
      return ceiling;
    };
    const edgeBundles = getEdgeBundles(project, project.edges, result.edges, ceilingFor);
    const endpointOffsets = getEdgeEndpointOffsets(project);
    // The solver reports storage-bound edges at the producer's full-speed
    // rate on purpose - that is the mechanism that lets drawers absorb
    // surplus. For display we want what actually flows in: the producer's
    // real output minus what its machine consumers take, split across sinks.
    const directTakenBySourceResource = new Map<string, number>();
    const storageSinkCounts = new Map<string, number>();
    for (const edge of project.edges) {
      const key = `${edge.source}|${makeResourceKey(edge.resourceKind, edge.resourceId)}`;
      if (storagesById.has(edge.target)) {
        storageSinkCounts.set(key, (storageSinkCounts.get(key) ?? 0) + 1);
      } else {
        directTakenBySourceResource.set(
          key,
          (directTakenBySourceResource.get(key) ?? 0) +
            (result.edges[edge.id]?.transferredPerSecond ?? 0),
        );
      }
    }
    // How many lines each producer splits a resource across. The solver's
    // sourceCapacityPerSecond is the producer's total, so the surplus ratio is
    // only honest when a single edge (or single-target bundle) carries it all.
    const outletCounts = new Map<string, number>();
    for (const edge of project.edges) {
      const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
      outletCounts.set(key, (outletCounts.get(key) ?? 0) + 1);
    }

    // What actually moves on each line, storage adjustment included, resolved
    // up front because flow mode has to see every edge's figure before it can
    // style any one of them.
    //
    // Written as a bare loop with no local helper functions on purpose: a
    // function declared and called inside this memo makes the React Compiler
    // drop its memoization of the whole thing, and this is the hottest memo
    // on the board. Verified with eslint, not assumed.
    //
    // Items and fluids get their own scale. A busy item line moves tens per
    // second and a busy fluid line moves tens of thousands, so one shared
    // range would paint every item line at the cold end for ever.
    const transferredById = new Map<string, number>();
    const itemValues: number[] = [];
    const fluidValues: number[] = [];
    let itemMin = Number.POSITIVE_INFINITY;
    let itemMax = 0;
    let fluidMin = Number.POSITIVE_INFINITY;
    let fluidMax = 0;
    for (const edge of project.edges) {
      const edgeResult = result.edges[edge.id];
      const targetStorage = storagesById.get(edge.target);
      const sourceStorage = storagesById.get(edge.source);
      const sourceResult = result.nodes[edge.source];
      const resourceKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      let value = edgeResult?.transferredPerSecond ?? edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      if (targetStorage && !sourceStorage && sourceResult) {
        const speed = Number.isFinite(sourceResult.utilization)
          ? Math.min(Math.max(sourceResult.utilization, 0), 1)
          : 0;
        const effectiveOutput = (sourceResult.outputs[resourceKey]?.amountPerSecond ?? 0) * speed;
        const taken = directTakenBySourceResource.get(`${edge.source}|${resourceKey}`) ?? 0;
        const sinks = storageSinkCounts.get(`${edge.source}|${resourceKey}`) ?? 1;
        value = Math.min(value, Math.max(0, effectiveOutput - taken) / sinks);
      }
      transferredById.set(edge.id, value);
      if (value > RATE_DISPLAY_EPSILON) {
        if (edge.resourceKind === "fluid") {
          fluidMin = Math.min(fluidMin, value);
          fluidMax = Math.max(fluidMax, value);
          fluidValues.push(value);
        } else {
          itemMin = Math.min(itemMin, value);
          itemMax = Math.max(itemMax, value);
          itemValues.push(value);
        }
      }
    }
    // Sorted distinct values per kind, for the rank half of the scale below.
    itemValues.sort((left, right) => left - right);
    fluidValues.sort((left, right) => left - right);
    const itemRanks = distinctRankIndex(itemValues);
    const fluidRanks = distinctRankIndex(fluidValues);

    // Each line's weight and the width that follows from it, resolved before
    // anything renders. The widths go to module scope because hops are built
    // at ROUTE time and need to know how thick the line they cross will be.
    const flowHeatById = new Map<string, number>();
    publishedEdgeStrokeWidths.clear();
    for (const edge of project.edges) {
      const isFluidEdge = edge.resourceKind === "fluid";
      const heat = anyLineMode
        ? flowHeatFor(
            transferredById.get(edge.id) ?? 0,
            isFluidEdge ? fluidMin : itemMin,
            isFluidEdge ? fluidMax : itemMax,
            isFluidEdge ? fluidRanks : itemRanks,
          )
        : 0;
      flowHeatById.set(edge.id, heat);
      // Widths come off the lane-fraction menu: a full lane (16px) at the
      // hottest, a sliver at the coldest, and any two either fit a lane
      // together or visibly do not.
      publishedEdgeStrokeWidths.set(
        edge.id,
        lineThicknessMode ? laneWidthForHeat(heat) : DEFAULT_EDGE_STROKE_WIDTH,
      );
    }

    // Prune ghost routes synchronously (the pruneNodeDataCaches effect runs
    // after render): edges rendered this pass must not hop over or steer
    // around routes of edges that were just deleted.
    const liveEdgeIds = new Set(project.edges.map((edge) => edge.id));
    for (const id of [...directRouteCache.keys()]) {
      if (!liveEdgeIds.has(id)) {
        deleteDirectRoute(id);
      }
    }

    // Collapsed-pocket channels. Convergence keeps several flat wires
    // crossing one boundary with the same resource (a maker feeding both
    // melters inside a pocket is TWO real edges), but the collapsed card
    // advertises one channel per resource — so the view draws ONE wire per
    // (visible far end, pocket, resource, ports) group: the first flat edge
    // is the representative, the rest are skipped, the rates are summed.
    const channelKeyFor = (
      edge: FactoryEdge,
      sourceRep: string,
      targetRep: string,
      sourceIsPocket: boolean,
      targetIsPocket: boolean,
    ) =>
      [
        sourceRep,
        targetRep,
        edge.resourceKind,
        edge.resourceId,
        (sourceIsPocket
          ? (canonicalizeResourceHandleId(edge.sourceHandle) ??
            makeResourceHandleId("output", { kind: edge.resourceKind, id: edge.resourceId }))
          : canonicalizeResourceHandleId(edge.sourceHandle)) ?? "",
        (targetIsPocket
          ? (canonicalizeResourceHandleId(edge.targetHandle) ??
            makeResourceHandleId("input", { kind: edge.resourceKind, id: edge.resourceId }))
          : canonicalizeResourceHandleId(edge.targetHandle)) ?? "",
      ].join("|");

    channelEdgeIdsByRepresentative.clear();
    const channelSkip = new Set<string>();
    // Representative id → summed rates for the one wire that stands in.
    const channelTotals = new Map<string, { transferred: number; demand: number }>();
    {
      const groups = new Map<string, { representativeId: string; ids: string[] }>();
      for (const edge of project.edges) {
        const sourceRep = pocketView.representativeOf(edge.source);
        const targetRep = pocketView.representativeOf(edge.target);
        if (!sourceRep || !targetRep || sourceRep === targetRep) {
          continue;
        }
        const sourceIsPocket = sourceRep !== edge.source;
        const targetIsPocket = targetRep !== edge.target;
        if (!sourceIsPocket && !targetIsPocket) {
          continue;
        }
        const key = channelKeyFor(edge, sourceRep, targetRep, sourceIsPocket, targetIsPocket);
        const group = groups.get(key);
        if (group) {
          group.ids.push(edge.id);
        } else {
          groups.set(key, { representativeId: edge.id, ids: [edge.id] });
        }
      }
      for (const group of groups.values()) {
        if (group.ids.length < 2) {
          continue;
        }
        channelEdgeIdsByRepresentative.set(group.representativeId, group.ids);
        let transferred = 0;
        let demand = 0;
        for (const id of group.ids) {
          transferred += transferredById.get(id) ?? 0;
          const edgeResult = result.edges[id];
          demand +=
            edgeResult?.demandPerSecond ??
            project.edges.find((entry) => entry.id === id)?.ratePerSecond ??
            0;
          if (id !== group.representativeId) {
            channelSkip.add(id);
          }
        }
        channelTotals.set(group.representativeId, { transferred, demand });
      }
    }

    // What the grid solve needs about every wire, collected as the edge
    // objects are built and published in one shot below.
    const gridRouteInputs: GridRouteEdgeInput[] = [];
    const builtEdges = project.edges.flatMap((edge, edgeIndex) => {
      // The pocket view remap. A wire whose endpoint is collapsed inside a
      // pocket renders against the pocket CARD instead, docking on the
      // card's canonical port for the wire's resource; a wire with no
      // visible representative on either end (interior to one collapsed
      // pocket, or outside the pocket being viewed) does not render at all.
      // The project edge itself is never touched — this is all view.
      const sourceRep = pocketView.representativeOf(edge.source);
      const targetRep = pocketView.representativeOf(edge.target);
      // Both ends on one card means the wire is interior to a collapsed pocket
      // and has nothing to draw between — UNLESS it is a machine wired into
      // itself and standing as itself, which is a loop the board must show.
      const isSelfLoop = edge.source === edge.target && sourceRep === edge.source;
      if (!sourceRep || !targetRep || (sourceRep === targetRep && !isSelfLoop)) {
        return [];
      }
      const sourceIsPocket = sourceRep !== edge.source;
      const targetIsPocket = targetRep !== edge.target;
      // A channel member rides its representative's wire — nothing to draw.
      if (channelSkip.has(edge.id)) {
        return [];
      }
      const channelTotal = channelTotals.get(edge.id);
      const edgeResult = result.edges[edge.id];
      const unit = rateUnitSuffix(edge.resourceKind === "fluid").trim();
      const demand =
        channelTotal?.demand ?? edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      const sourceStorage = storagesById.get(edge.source);
      const targetStorage = storagesById.get(edge.target);
      // Pre-computed above, storage adjustment and all; a channel
      // representative carries the whole channel's flow.
      const transferred = channelTotal?.transferred ?? transferredById.get(edge.id) ?? 0;
      // This line's place in its own kind's range: 0 is the quietest line on
      // the board, 1 the busiest. A single line, or a board where every line
      // is equal, reads as the biggest there is.
      const flowHeat = flowHeatById.get(edge.id) ?? 0;
      // isLimited almost never survives the solver's utilisation convergence,
      // since demand gets scaled down to whatever supply exists. The nameplate
      // comparison is what actually catches a starved machine. Storage soaks
      // up whatever arrives, so a line into a barrel is never starved.
      const isSupplyCapped = edgeResult?.constraint === "supply" && !targetStorage;
      const isStarvedEdge =
        isSupplyCapped || (edgeResult?.isLimited === true && !targetStorage);
      const isStorageEdge = Boolean(sourceStorage || targetStorage);
      const resource = getEdgeResource(project, edge);
      const edgeColor = getInitialResourceColor(resource);
      const sourceHandle = parseResourceHandleId(edge.sourceHandle);
      const targetHandle = parseResourceHandleId(edge.targetHandle);
      // A trash can is a small any-side card like a tank, not a machine with
      // a left input rail: routed as a "storage" endpoint so the wire docks
      // on whichever side of the can faces the producer.
      const targetIsTrashCan = targetHandle?.resourceId === TRASH_ANY_RESOURCE_ID;
      // Rails render one canonical (index-less) handle per resource; stored
      // edges may carry legacy per-slot ids. Collapse them here or React Flow
      // refuses to draw the edge and the anchor lookup misses the port.
      // A pocket end docks on the card's canonical port for this wire. The
      // stored handle names the exact port (an oredict input keeps its
      // oredict id even when the wire carries a concrete log); edges of
      // older vintage carry no handle and fall back to the wire's resource.
      // pocket-summary derives its port rows the SAME way, which is what
      // guarantees every crossing wire has a rendered port to dock on.
      // The card merges compatible forms into one row, so the stored handle
      // is not always a port that got drawn: a wire carrying concrete carbon
      // dust docks on the oredict row that survived. Ask the summary which
      // row this wire belongs to, and only fall back to the stored handle
      // when it has no opinion — otherwise the wire anchors to a port that
      // was never rendered and disappears.
      const canonicalSourceHandle = sourceIsPocket
        ? (resolvePocketPortHandleId(project, pocketSummaries.get(sourceRep), sourceRep, "output", {
            kind: sourceHandle?.kind ?? edge.resourceKind,
            id: sourceHandle?.resourceId ?? edge.resourceId,
          }) ??
          canonicalizeResourceHandleId(edge.sourceHandle) ??
          makeResourceHandleId("output", { kind: edge.resourceKind, id: edge.resourceId }))
        : canonicalizeResourceHandleId(edge.sourceHandle);
      const canonicalTargetHandle = targetIsPocket
        ? (resolvePocketPortHandleId(project, pocketSummaries.get(targetRep), targetRep, "input", {
            kind: targetHandle?.kind ?? edge.resourceKind,
            id: targetHandle?.resourceId ?? edge.resourceId,
          }) ??
          canonicalizeResourceHandleId(edge.targetHandle) ??
          makeResourceHandleId("input", { kind: edge.resourceKind, id: edge.resourceId }))
        : canonicalizeResourceHandleId(edge.targetHandle);
      const isSearchEdgeActive = edgeMatchesSearch(edge, resource, recipeSearch);
      // A drawer's own wires thicken when the search names them. Hovering the
      // drawer no longer feeds this: that lights the wires ON the drawer
      // through the flow scope, which is a per-edge subscription and does not
      // rebuild this memo.
      const isStorageEdgeEmphasized = isStorageEdge && isSearchEdgeActive;
      const isFlowHighlighted =
        activeFlowResourceKey === makeResourceKey(edge.resourceKind, edge.resourceId);

      gridRouteInputs.push({
        edgeId: edge.id,
        order: edgeIndex,
        sourceNodeId: sourceRep,
        targetNodeId: targetRep,
        // A machine end is a PORT even when the stored edge carries no handle
        // id (old plans and the demo do this): the rails publish canonical
        // ids derived from the resource, so the same derivation here finds
        // the measured port. Without it these ends fell into the any-side
        // dock branch and wires entered machines through the floor.
        sourceHandleId:
          canonicalSourceHandle ??
          makeResourceHandleId("output", { kind: edge.resourceKind, id: edge.resourceId }),
        targetHandleId:
          canonicalTargetHandle ??
          makeResourceHandleId("input", { kind: edge.resourceKind, id: edge.resourceId }),
        // A pocket card's port is a slot endpoint like a machine rail's,
        // whatever the hidden endpoint inside really is.
        sourceSlotEndpoint: sourceIsPocket || !sourceStorage,
        targetSlotEndpoint: targetIsPocket || (!targetStorage && !targetIsTrashCan),
        sourceStorageEndpoint: !sourceIsPocket && Boolean(sourceStorage),
        targetStorageEndpoint: !targetIsPocket && Boolean(targetStorage || targetIsTrashCan),
        // The published stroke width IS the routing width: it never carries
        // hover/highlight bumps, so a hover can never trigger a re-solve.
        routingWidth: publishedEdgeStrokeWidths.get(edge.id) ?? DEFAULT_EDGE_STROKE_WIDTH,
        waypoints: edge.waypoints,
      });

      // Structural reuse: hover and solver rebuilds leave most edges equal,
      // and returning the previous identity lets React Flow skip re-rendering
      // (and re-routing) them entirely.
      return [reuseDeepObjectIdentity(edgeObjectCache, edge.id, {
        id: edge.id,
        // Thick lines dive UNDER the cards. At 3px a wire crossing a node
        // edge-on was a detail; at 34px it buries the very ports it docks
        // into, so in thickness mode the pipe passes behind the card and only
        // its approach is visible. -1 keeps it above annotation boxes (-5),
        // which must stay the backmost thing on the board.
        // No drag-time bump any more: wires hold still during a drag and the
        // dragged card itself is elevated (see handleNodeDragStart), so a
        // card in hand always passes OVER the board's wiring.
        zIndex: lineThicknessMode ? -1 : isFlowHighlighted ? 1200 : 20,
        source: sourceRep,
        target: targetRep,
        sourceHandle: canonicalSourceHandle,
        targetHandle: canonicalTargetHandle,
        type: "resourceEdge",
        data: {
          resource,
          color: edgeColor,
          demand,
          // Always the real flow. demand can sit at the full-speed rate on
          // lines the solver never converges (storage sinks), and a label
          // must never show more than actually moves.
          transferred,
          nameplateDemand: targetStorage ? undefined : edgeResult?.nameplateDemandPerSecond,
          sourceCapacity:
            outletCounts.get([edge.source, edge.resourceKind, edge.resourceId].join("|")) === 1 &&
            edgeResult?.sourceCapacityPerSecond !== undefined
              ? edgeResult.sourceCapacityPerSecond * ceilingFor(edge.source)
              : undefined,
          unit,
          isLimited: edgeResult?.isLimited === true && !targetStorage,
          isSupplyCapped,
          isStorageTarget: Boolean(targetStorage),
          isStorageEdge,
          showLabel: lineLabelsMode,
          labelOffset: edge.labelOffset,
          waypoints: edge.waypoints,
          sourceHandleId: canonicalSourceHandle,
          targetHandleId: canonicalTargetHandle,
          sourceSlotEndpoint: Boolean(sourceHandle && !sourceStorage),
          targetSlotEndpoint: Boolean(targetHandle && !targetStorage && !targetIsTrashCan),
          sourceStorageEndpoint: Boolean(sourceHandle && sourceStorage),
          targetStorageEndpoint: Boolean(targetHandle && (targetStorage || targetIsTrashCan)),
          sourceEndpointOffset: endpointOffsets.get(`${edge.id}:source`),
          targetEndpointOffset: endpointOffsets.get(`${edge.id}:target`),
          mergedEdgeIds: channelEdgeIdsByRepresentative.get(edge.id),
          routeIndex: edgeIndex,
          bundle: edgeBundles.get(edge.id),
          isFlowHighlighted,
          // O(1) off the per-solve index. The ring's own wires carry the mark
          // so the circle reads as one shape rather than as N red cards that
          // happen to sit near each other.
          isDeadLoop: deathSpiralEdges.has(edge.id),
          // Flow mode: how big this line is on its own kind's scale, 0 (the
          // quietest line on the board) to 1 (the busiest). The edge draws
          // marching dashes over itself when this is set.
          flowRate: anyLineMode
            ? {
                heat: flowHeat,
                kind: flowBucketFor(edge.resourceKind),
                color: lineHeatMode,
                thickness: lineThicknessMode,
                pulse: linePulseMode,
              }
            : undefined,
          layoutEpoch: layoutVersion,
        },
        style: {
          stroke: lineHeatMode ? flowRampColor(flowHeat) : edgeColor,
          // Volume is the whole message in thickness mode, so the starved
          // dashes stand down rather than chopping up a fat pipe.
          strokeDasharray: isStarvedEdge && !lineThicknessMode ? "4 6" : undefined,
          strokeOpacity: lineThicknessMode
            ? 0.95
            : isFlowHighlighted
              ? 1
              : isStarvedEdge
                ? 0.58
                : isStorageEdge
                  ? 0.86
                  : 0.92,
          // Doubled across the board: ~3px wires read as scratches next to
          // the 4-16px dynamic pipes and on dense displays.
          strokeWidth: lineThicknessMode
            ? laneWidthForHeat(flowHeat)
            : isFlowHighlighted
              ? 9
              : isStorageEdge
                ? isStorageEdgeEmphasized
                  ? 7.5
                  : 6.2
                : isStarvedEdge
                  ? 5.4
                  : edge.resourceKind === "fluid"
                    ? 6.8
                    : 5.8,
        },
      })];
    });

    publishGridRouteEdges(gridRouteInputs, freeDockMode);

    // Paint order IS depth, and it has to be the SAME order hop rendering
    // uses — otherwise a line hops over something that is drawn on top of it
    // anyway. compareEdgeDepth is that single order; see it for why thin goes
    // on top.
    //
    // Some overlap in thickness mode is not a routing failure and cannot be
    // routed away: ports on one face sit ~18px apart and a pipe can be 34px
    // wide, so two wires into two neighbouring inputs must share pixels. What
    // that overlap must not be is ambiguous or unstable — and left alone it is
    // both, because React Flow paints edges in array order and this array's
    // order came from whatever the project happened to hold.
    //
    // Applied in both modes. In thin mode every line publishes the same width,
    // so this collapses to routeIndex order — exactly the order the array was
    // already in, and not a single edge moves.
    return [...builtEdges].sort((left, right) =>
      compareEdgeDepth(
        {
          width: ownStrokeWidth(left.id),
          routeIndex: left.data?.routeIndex ?? 0,
        },
        {
          width: ownStrokeWidth(right.id),
          routeIndex: right.data?.routeIndex ?? 0,
        },
      ),
    );
  }, [
    activeFlowResourceKey,
    anyLineMode,
    freeDockMode,
    lineHeatMode,
    lineLabelsMode,
    linePulseMode,
    lineThicknessMode,
    layoutVersion,
    pocketSummaries,
    pocketView,
    project,
    recipeSearch,
    result,
    storagesById,
  ]);

  const connectResourceEdges = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      resource?: Pick<
        ResourceAmount,
        "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
      > & {
        sourceHandle?: string;
        targetHandle?: string;
      },
    ) => {
      // A pocket card is a view: the flat graph only holds member edges, so
      // an end that names a pocket fans out to EVERY member exposing that
      // exact resource on that side — two redstone drinkers inside means two
      // wires, landed together as one undo entry.
      const sourceIsPocket = isPocketId(project, sourceNodeId);
      const targetIsPocket = isPocketId(project, targetNodeId);
      if ((sourceIsPocket || targetIsPocket) && !resource) {
        // A bare node-to-node connect names no resource to fan out on.
        return;
      }
      const sourceIdentity = resource
        ? (parseResourceHandleId(resource.sourceHandle) ?? {
            kind: resource.kind,
            resourceId: resource.id,
          })
        : undefined;
      const targetIdentity = resource
        ? (parseResourceHandleId(resource.targetHandle) ?? {
            kind: resource.kind,
            resourceId: resource.id,
          })
        : undefined;
      const sourceIds =
        sourceIsPocket && sourceIdentity
          ? resolvePocketMemberIds(project, sourceNodeId, "output", {
              kind: sourceIdentity.kind,
              id: sourceIdentity.resourceId,
            })
          : [sourceNodeId];
      const targetIds =
        targetIsPocket && targetIdentity
          ? resolvePocketMemberIds(project, targetNodeId, "input", {
              kind: targetIdentity.kind,
              id: targetIdentity.resourceId,
            })
          : [targetNodeId];

      const pairs: Array<{
        sourceNodeId: string;
        targetNodeId: string;
        resource?: typeof resource;
      }> = [];
      for (const source of sourceIds) {
        for (const target of targetIds) {
          // A pocket fan-out can land both ends on one member — that pair is
          // an artefact of the expansion, not a wire anybody asked for. A self
          // pair the user actually aimed (the same card named on both ends) is
          // a real loop and has to survive.
          if (source === target && sourceNodeId !== targetNodeId) {
            continue;
          }

          const sourceHandleIds =
            resource?.sourceHandle && resource.kind && resource.id
              ? getRepeatedOutputHandleIds(project, source, resource)
              : [];
          const shouldBatchRepeatedOutputs =
            resource?.sourceHandle &&
            sourceHandleIds.length > 1 &&
            sourceHandleIds.includes(resource.sourceHandle);

          if (!resource || !shouldBatchRepeatedOutputs) {
            pairs.push({ sourceNodeId: source, targetNodeId: target, resource });
            continue;
          }

          const allRepeatedEdgesExist = sourceHandleIds.every((sourceHandle) =>
            project.edges.some(
              (edge) =>
                edge.source === source &&
                edge.target === target &&
                edge.resourceKind === resource.kind &&
                edge.resourceId === resource.id &&
                edge.sourceHandle === sourceHandle &&
                edge.targetHandle === resource.targetHandle,
            ),
          );

          for (const sourceHandle of sourceHandleIds) {
            const alreadyExists = project.edges.some(
              (edge) =>
                edge.source === source &&
                edge.target === target &&
                edge.resourceKind === resource.kind &&
                edge.resourceId === resource.id &&
                edge.sourceHandle === sourceHandle &&
                edge.targetHandle === resource.targetHandle,
            );

            if (!allRepeatedEdgesExist && alreadyExists) {
              continue;
            }

            pairs.push({
              sourceNodeId: source,
              targetNodeId: target,
              resource: { ...resource, sourceHandle },
            });
          }
        }
      }

      if (pairs.length > 0) {
        connectNodesBatch(pairs);
      }
    },
    [connectNodesBatch, project],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectCompletedRef.current = true;
      if (connection.source && connection.target) {
        const sourceHandle = parseResourceHandleId(connection.sourceHandle);
        const targetHandle = parseResourceHandleId(connection.targetHandle);

        if (sourceHandle && targetHandle && sourceHandle.side !== targetHandle.side) {
          // A trash can's universal port only drinks: the far end must be an
          // OUTPUT with a concrete resource, and the can takes it as-is.
          const sourceIsTrash = sourceHandle.resourceId === TRASH_ANY_RESOURCE_ID;
          const targetIsTrash = targetHandle.resourceId === TRASH_ANY_RESOURCE_ID;
          if (sourceIsTrash || targetIsTrash) {
            if (sourceIsTrash && targetIsTrash) {
              return;
            }
            const trashNodeId = sourceIsTrash ? connection.source : connection.target;
            const farEnd = sourceIsTrash
              ? {
                  nodeId: connection.target,
                  handleId: connection.targetHandle ?? undefined,
                  side: targetHandle.side,
                }
              : {
                  nodeId: connection.source,
                  handleId: connection.sourceHandle ?? undefined,
                  side: sourceHandle.side,
                };
            if (farEnd.side !== "output" || !farEnd.handleId) {
              return;
            }
            const farResource = getResourceForHandle(project, farEnd.nodeId, farEnd.handleId);
            if (farResource) {
              connectTrash(
                trashNodeId,
                { nodeId: farEnd.nodeId, handleId: farEnd.handleId },
                farResource,
              );
            }
            return;
          }

          // A custom rate card adopts whatever it is wired to, and re-adopts
          // when something else lands on it later. The test is which CARD this
          // is, not which port id it is showing: once a card has adopted, its
          // port carries a real resource id, and matching on that is what made
          // a card refuse every resource but the one it already held.
          const sourceIsCustom = isCustomRateNodeId(project, connection.source);
          const targetIsCustom = isCustomRateNodeId(project, connection.target);
          if (sourceIsCustom !== targetIsCustom) {
            const customEnd = sourceIsCustom
              ? { nodeId: connection.source, side: sourceHandle.side }
              : { nodeId: connection.target, side: targetHandle.side };
            const machineEnd = sourceIsCustom
              ? { nodeId: connection.target, handleId: connection.targetHandle ?? undefined }
              : { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined };
            const machineResource = machineEnd.handleId
              ? getResourceForHandle(project, machineEnd.nodeId, machineEnd.handleId)
              : undefined;
            if (machineResource) {
              connectCustomRate(customEnd.nodeId, customEnd.side, machineEnd, machineResource);
            }
            return;
          }
          if (sourceIsCustom && targetIsCustom) {
            return;
          }

          const outputHandle =
            sourceHandle.side === "output"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const inputHandle =
            sourceHandle.side === "input"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const outputResource = outputHandle.handleId
            ? getResourceForHandle(project, outputHandle.nodeId, outputHandle.handleId)
            : undefined;
          const inputResource = inputHandle.handleId
            ? getResourceForHandle(project, inputHandle.nodeId, inputHandle.handleId)
            : undefined;

          if (
            !outputResource ||
            !inputResource ||
            !resourceMatchesInput(outputResource, inputResource)
          ) {
            return;
          }

          connectResourceEdges(outputHandle.nodeId, inputHandle.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: outputHandle.handleId,
            targetHandle: inputHandle.handleId,
          });
          return;
        }

        if (connection.sourceHandle || connection.targetHandle) {
          return;
        }

        connectResourceEdges(connection.source, connection.target);
      }
    },
    [connectCustomRate, connectResourceEdges, connectTrash, project],
  );

  const isValidResourceConnection = useCallback(
    (connection: Connection | Edge) => isCompatibleResourceConnection(project, connection),
    [project],
  );

  const stopDropFitPainting = useCallback(() => {
    if (dropFitFrameRef.current !== undefined) {
      cancelAnimationFrame(dropFitFrameRef.current);
      dropFitFrameRef.current = undefined;
    }
    setWiringConnection(false);
    boardRef.current?.classList.remove(WIRING_BOARD_CLASS);
    clearNodeDropFit();
  }, []);

  const startDropFitPainting = useCallback(() => {
    clearNodeDropFit();

    if (!draggedResourceRef.current) {
      return;
    }

    // Entering wiring mode. Whatever the pointer was lighting up on the way to
    // the handle — a highlighted line, a lit slot, a hop map — is answering a
    // question nobody is asking any more.
    setWiringConnection(true);
    boardRef.current?.classList.add(WIRING_BOARD_CLASS);
    const store = useFactoryStore.getState();
    store.setHoveredFlowScope(undefined);
    clearHopMap();

    paintNodeDropFit(project, draggedResourceRef.current, false);

    // One cheap selector per frame — it matches nothing until auto-pan mounts
    // a card that has not been given a verdict yet.
    const paintNewlyMounted = () => {
      if (!draggedResourceRef.current) {
        dropFitFrameRef.current = undefined;
        return;
      }
      paintNodeDropFit(project, draggedResourceRef.current, true);
      dropFitFrameRef.current = requestAnimationFrame(paintNewlyMounted);
    };

    if (dropFitFrameRef.current === undefined && draggedResourceRef.current) {
      dropFitFrameRef.current = requestAnimationFrame(paintNewlyMounted);
    }
  }, [project]);

  // A pointer that comes up without React Flow reporting a connect end (an
  // aborted gesture, a drag off the window) must not leave the board washed.
  useEffect(() => {
    const clearIfIdle = () => {
      if (!draggedResourceRef.current) {
        stopDropFitPainting();
      }
    };

    window.addEventListener("pointerup", clearIfIdle);
    window.addEventListener("pointercancel", clearIfIdle);
    return () => {
      window.removeEventListener("pointerup", clearIfIdle);
      window.removeEventListener("pointercancel", clearIfIdle);
      stopDropFitPainting();
    };
  }, [stopDropFitPainting]);

  const handleConnectStart = useCallback(
    (
      event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null },
    ) => {
      const eventHandle =
        event.target instanceof Element
          ? readResourceHandleElement(
              event.target.closest<HTMLElement>("[data-resource-handle='true']"),
            )
          : undefined;
      const nodeId = params.nodeId ?? eventHandle?.nodeId;
      const handleId = params.handleId ?? eventHandle?.handleId;

      connectCompletedRef.current = false;
      lastConnectionPointerRef.current = getClientPosition(event);
      draggedResourceRef.current =
        nodeId && handleId ? getDraggedResourceForHandle(project, nodeId, handleId) : undefined;
      startDropFitPainting();
    },
    [project, startDropFitPainting],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const draggedResource = draggedResourceRef.current;
      draggedResourceRef.current = undefined;
      stopDropFitPainting();
      if (draggedResource) {
        // The mouseup that ends a wire must not pair into a double-click
        // that dives into a pocket card.
        markWireDrop();
      }
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      lastConnectionPointerRef.current = undefined;
      // Ranked candidates, not a first-match chain. Aiming still beats
      // guessing - the exact slot under the pointer is asked first - but a
      // candidate the drop cannot USE must not end the search. It used to:
      // release a wire one row off on a multi-slot card and the precise
      // hit-test answered with that wrong slot, the drop refused it, and the
      // whole-card rule underneath (the one the green wash and the snapped
      // pipe were both promising) never got a turn.
      const candidates = [
        // Drawers answer first. A drawer's one handle is minted "output" so a
        // drag can start anywhere on it, which makes it a misleading answer to
        // "what did this drop land on": read literally, dropping drawer A on
        // drawer B says B supplies A, the reverse of the gesture. These two
        // resolve a drawer by DIRECTION instead - the one you drag feeds the
        // one you drop on - and a drawer holds one item, so there is never a
        // more specific slot on it to lose by asking here first.
        getStorageHandleAtPosition(clientPosition, draggedResource),
        getStorageHandleAtPointer(event, draggedResource),
        getResourceHandleAtPosition(clientPosition),
        getResourceHandleAtPointer(event),
        // Anywhere on a trash card counts as its well: dropping an output on
        // the frame or header must void it, never spawn a tank on top.
        getTrashHandleAtPosition(clientPosition, draggedResource, event),
        // Last resort: any card that takes the resource anywhere on it.
        getNodeCardHandleAtPosition(project, clientPosition, draggedResource),
      ].filter((candidate): candidate is ResolvedResourceHandle => Boolean(candidate));

      const targetHandle = draggedResource
        ? (candidates.find((candidate) =>
            isUsableDropTarget(project, draggedResource, candidate),
          ) ?? candidates[0])
        : candidates[0];

      if (connectCompletedRef.current) {
        return;
      }

      if (draggedResource && targetHandle) {
        // Dropped onto a custom rate card, empty or already holding something:
        // the machine side decides direction (an output feeds it, an input
        // drinks from it) and the card adopts what was dropped.
        if (
          isCustomRateNodeId(project, targetHandle.nodeId) &&
          draggedResource.id !== CUSTOM_RATE_ANY_RESOURCE_ID &&
          draggedResource.id !== TRASH_ANY_RESOURCE_ID &&
          draggedResource.nodeId !== targetHandle.nodeId
        ) {
          connectCompletedRef.current = true;
          connectCustomRate(
            targetHandle.nodeId,
            draggedResource.side === "input" ? "output" : "input",
            { nodeId: draggedResource.nodeId, handleId: draggedResource.handleId },
            draggedResource,
          );
          return;
        }
        // Dropped onto a trash can: only an OUTPUT can be voided.
        if (
          targetHandle.resourceId === TRASH_ANY_RESOURCE_ID &&
          draggedResource.side === "output" &&
          draggedResource.id !== CUSTOM_RATE_ANY_RESOURCE_ID &&
          draggedResource.id !== TRASH_ANY_RESOURCE_ID &&
          draggedResource.nodeId !== targetHandle.nodeId
        ) {
          connectCompletedRef.current = true;
          connectTrash(
            targetHandle.nodeId,
            { nodeId: draggedResource.nodeId, handleId: draggedResource.handleId },
            draggedResource,
          );
          return;
        }
        if (isCompatibleDraggedResourceTarget(project, draggedResource, targetHandle)) {
          // The SLOT it landed on names the direction: a wire runs into an
          // input and out of an output, whichever end the gesture started
          // from. That is what lets a drawer be one grab point - drop it on
          // something that eats the item and the drawer feeds it, drop it on
          // something that makes the item and it fills the drawer.
          const draggedIsSource = targetHandle.side === "input";
          const draggedEnd = {
            nodeId: draggedResource.nodeId,
            // A drawer's single handle is minted "output", so the end that
            // RECEIVES has to be re-minted as its input port.
            handleId: draggedResource.bidirectional
              ? makeResourceHandleId(draggedIsSource ? "output" : "input", {
                  kind: draggedResource.kind,
                  id: draggedResource.id,
                })
              : draggedResource.handleId,
          };
          const farEnd = { nodeId: targetHandle.nodeId, handleId: targetHandle.handleId };
          const source = draggedIsSource ? draggedEnd : farEnd;
          const target = draggedIsSource ? farEnd : draggedEnd;
          const outputResource = draggedIsSource
            ? draggedResource
            : getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

          if (!outputResource) {
            return;
          }

          connectCompletedRef.current = true;
          connectResourceEdges(source.nodeId, target.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: source.handleId,
            targetHandle: target.handleId,
          });
        }
        return;
      }

      const flowInstance = flowInstanceRef.current;
      if (
        !draggedResource ||
        connectCompletedRef.current ||
        isPointerOverIncompatibleFlowHandle(project, event, draggedResource) ||
        !flowInstance
      ) {
        return;
      }

      if (!clientPosition) {
        return;
      }

      // Landing on a card that just washed red means "no" — dropping a fresh
      // drawer on top of it would be a strange answer to a refused wire.
      // A drag off a DRAWER spawns a drawer too: drawers wire to drawers now,
      // so the void answers the same way it does for a machine port.
      if (getBoardNodeIdAtPosition(clientPosition)) {
        return;
      }

      // Dragging out of a pocket port: the one new drawer buffers every
      // member behind the port, not the pocket card (which is no node).
      const storageAnchorIds = isPocketId(project, draggedResource.nodeId)
        ? resolvePocketMemberIds(project, draggedResource.nodeId, draggedResource.side, {
            kind: draggedResource.kind,
            id: draggedResource.id,
          })
        : draggedResource.nodeId;
      if (Array.isArray(storageAnchorIds) && storageAnchorIds.length === 0) {
        return;
      }

      // A drag off a DRAWER into space always answers with a SOURCE feeding
      // it, whichever half the drag left from. A drawer already catches its
      // own excess - its face shows the pile - so the one thing empty canvas
      // can add is supply: the drawer reads short, the new source covers it.
      const originIsStorage = (project.storages ?? []).some(
        (storage) => storage.id === draggedResource.nodeId,
      );
      const spawnSide = originIsStorage ? "input" : draggedResource.side;
      const spawnHandleId = originIsStorage
        ? makeResourceHandleId("input", { kind: draggedResource.kind, id: draggedResource.id })
        : draggedResource.handleId;

      const position = flowInstance.screenToFlowPosition(clientPosition);
      addStorageForConnection(
        draggedResource,
        storageAnchorIds,
        spawnSide,
        // Centre the new drawer on the pointer; the store snaps it to a cell.
        { x: position.x - STORAGE_NODE_WIDTH / 2, y: position.y - STORAGE_NODE_HEIGHT / 2 },
        spawnHandleId,
      );
    },
    [addStorageForConnection, connectCustomRate, connectResourceEdges, connectTrash, project],
  );

  useEffect(() => {
    const updatePointerPosition = (event: PointerEvent | MouseEvent | TouchEvent) => {
      if (!draggedResourceRef.current) {
        return;
      }

      lastConnectionPointerRef.current = getClientPosition(event);
    };

    window.addEventListener("pointermove", updatePointerPosition, { passive: true });
    window.addEventListener("mousemove", updatePointerPosition, { passive: true });
    window.addEventListener("touchmove", updatePointerPosition, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointerPosition);
      window.removeEventListener("mousemove", updatePointerPosition);
      window.removeEventListener("touchmove", updatePointerPosition);
    };
  }, []);


  const updateFlowViewportCenter = useCallback(() => {
    const instance = flowInstanceRef.current;
    const board = boardRef.current;
    if (!instance || !board) {
      return;
    }

    const rect = board.getBoundingClientRect();
    setFlowViewportCenter(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [setFlowViewportCenter]);

  const handleMoveStart = useCallback(() => {
    // Panning or zooming drops the map. React Flow culls off-screen nodes, so
    // a map held across a move would arrive at freshly mounted cards that were
    // never painted — and moving the board is a deliberate act anyway, not
    // something you do while reading one node's neighbourhood.
    clearHopMap();
    boardRef.current?.classList.add("factory-flow-board--moving");
  }, []);

  /**
   * Every camera move ends here, the board's own included, which is where the
   * active tab learns where it is being looked at.
   *
   * `event` is null for a move the board made itself. A hand on the mouse is
   * therefore also proof that a design handover is over, however the ordering
   * fell out - see design-camera.ts.
   */
  const handleMoveEnd = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: BoardCamera) => {
      boardRef.current?.classList.remove("factory-flow-board--moving");
      updateFlowViewportCenter();

      if (event) {
        settleDesignCamera();
      }
      // Inside a pocket the coordinates belong to that dimension, and a plan
      // always loads at the top level, so there is nothing here worth keeping.
      if (!isDesignCameraSettled() || activePocketId) {
        return;
      }

      const designId = useDesignStore.getState().activeDesignId;
      if (designId) {
        writeDesignCamera(designId, viewport);
      }
    },
    [activePocketId, updateFlowViewportCenter],
  );

  const handleInit = useCallback(
    (instance: ReactFlowInstance<BoardFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
      // A remembered camera that arrived before the board existed. It waits
      // rather than being dropped, because on a page load this is the usual
      // order: the plan comes out of IndexedDB while React Flow is still
      // mounting.
      const pendingCamera = pendingCameraRef.current;
      if (pendingCamera) {
        restoreBoardCamera(pendingCamera);
      }
      window.requestAnimationFrame(updateFlowViewportCenter);
      window.setTimeout(updateFlowViewportCenter, 120);
    },
    [restoreBoardCamera, updateFlowViewportCenter],
  );

  const exportFlowImage = useCallback(
    async (
      format: "svg" | "png",
      requestId: string,
      fileName: string,
      projectJson: string,
      capture = false,
    ) => {
      if (exportInProgressRef.current) {
        dispatchImageExportComplete(requestId);
        return;
      }

      const viewportElement = boardRef.current?.querySelector<HTMLElement>(".react-flow__viewport");

      if (!viewportElement) {
        dispatchImageExportComplete(requestId);
        return;
      }

      exportInProgressRef.current = true;
      await nextAnimationFrame();

      const nodesBounds = getNodesBounds(flowNodes);
      const imageWidth = getExportImageSize(nodesBounds.width);
      const imageHeight = getExportImageSize(nodesBounds.height);
      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.15,
        1.8,
        EXPORT_IMAGE_PADDING / Math.max(imageWidth, imageHeight),
      );
      const options = {
        // The active theme's paper, so an export looks like the board did.
        // The screen-space texture is on the container, not the viewport, so
        // exports get the flat colour - a deliberate simplification.
        backgroundColor: canvasTheme.base,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      };

      let capturedDataUrl: string | undefined;
      try {
        if (format === "svg") {
          const svgText = embedProjectJsonInSvg(
            dataUrlToText(
              await toSvg(viewportElement, {
                ...options,
                filter: exportNodeFilter,
                skipFonts: true,
              }),
            ),
            projectJson,
          );
          downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), `${fileName}.svg`);
          return;
        }

        const imageBlob = await toBlob(viewportElement, {
          ...options,
          filter: exportNodeFilter,
          pixelRatio: capture ? 1 : getExportPngPixelRatio(imageWidth, imageHeight),
          skipFonts: true,
        });
        if (!imageBlob) {
          return;
        }

        if (capture) {
          // Capture mode hands a thumbnail back to the caller (community
          // share dialog) instead of saving a file.
          capturedDataUrl = await makeThumbnailDataUrl(imageBlob);
          return;
        }

        const pngBlob = await embedProjectJsonInPng(imageBlob, projectJson);
        downloadBlob(pngBlob, `${fileName}.png`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Plan image export failed.");
      } finally {
        exportInProgressRef.current = false;
        dispatchImageExportComplete(requestId, capturedDataUrl);
      }
    },
    [flowNodes, canvasTheme.base],
  );

  useEffect(() => {
    const handleExportImage = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            format?: unknown;
            requestId?: unknown;
            fileName?: unknown;
            projectJson?: unknown;
            capture?: unknown;
          }
        | undefined;

      if (
        (detail?.format !== "svg" && detail?.format !== "png") ||
        typeof detail.requestId !== "string" ||
        typeof detail.fileName !== "string" ||
        typeof detail.projectJson !== "string"
      ) {
        return;
      }

      void exportFlowImage(
        detail.format,
        detail.requestId,
        detail.fileName,
        detail.projectJson,
        detail.capture === true,
      );
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
  }, [exportFlowImage]);

  useEffect(() => {
    const handleEdgeLabelSelect = (event: Event) => {
      const detail = (event as CustomEvent).detail as { edgeIds?: unknown } | undefined;
      if (
        !Array.isArray(detail?.edgeIds) ||
        !detail.edgeIds.every((edgeId) => typeof edgeId === "string")
      ) {
        return;
      }

      setSelectedEdgeIds(detail.edgeIds);
      setSelectedNodeIds([]);
      selectNode(undefined);
    };

    window.addEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
    return () => window.removeEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
  }, [selectNode]);

  const copyBoardSelection = useCallback((): boolean => {
    const payload = captureBoardSelection(project, selectedNodeIds);
    if (!payload) {
      return false;
    }

    boardClipboard = { payload, pasteCount: 0 };
    return true;
  }, [project, selectedNodeIds]);

  const deleteSelectedBoardItems = useCallback((): boolean => {
    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) {
      return false;
    }

    deleteBoardSelection({
      nodeIds: selectedNodeIds,
      edgeIds: expandChannelEdgeIds(selectedEdgeIds),
    });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    selectNode(undefined);
    return true;
  }, [deleteBoardSelection, selectNode, selectedEdgeIds, selectedNodeIds]);

  const runCompact = useCallback(
    (ids: string[]): boolean => {
      const pocketId = compactSelectionIntoPocket(ids);
      if (!pocketId) {
        return false;
      }

      // The new pocket card takes the selection, ready to drag or dive into.
      setPendingBoardSelection([pocketId]);
      setSelectedNodeIds([pocketId]);
      setSelectedEdgeIds([]);
      return true;
    },
    [compactSelectionIntoPocket, setPendingBoardSelection],
  );

  const compactSelectedBoardItems = useCallback((): boolean => {
    if (selectedNodeIds.length === 0) {
      return false;
    }

    // Two cards taking the same resource from DIFFERENT places: compacting
    // pools those supplies behind one port. Real change, so the player gets
    // to say no first; single-source fan-outs converge silently.
    const warnings = collectPocketConvergenceWarnings(
      useFactoryStore.getState().project,
      selectedNodeIds,
    );
    if (warnings.length > 0) {
      setCompactWarning({ ids: selectedNodeIds, warnings });
      return false;
    }

    return runCompact(selectedNodeIds);
  }, [runCompact, selectedNodeIds]);

  const pasteBoardClipboard = useCallback(() => {
    if (!boardClipboard) {
      return;
    }

    boardClipboard.pasteCount += 1;
    const offset = BOARD_GRID * 2 * boardClipboard.pasteCount;
    const pastedIds = pasteBoardItems(boardClipboard.payload, { x: offset, y: offset });
    if (pastedIds.length === 0) {
      return;
    }

    // The paste takes the selection, so the new cards can be dragged into
    // place immediately; the store field carries it through the flowNodes
    // rebuild.
    setPendingBoardSelection(pastedIds);
    setSelectedNodeIds(pastedIds);
    setSelectedEdgeIds([]);
  }, [pasteBoardItems, setPendingBoardSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === "c" || key === "x") {
          // Never fight the browser for real text: typing fields and selected
          // page text keep native copy/cut.
          if (isEditableKeyboardTarget(event.target) || window.getSelection()?.toString()) {
            return;
          }

          if (!copyBoardSelection()) {
            return;
          }

          if (key === "x") {
            deleteSelectedBoardItems();
          }
          event.preventDefault();
          return;
        }

        if (key === "v") {
          if (isEditableKeyboardTarget(event.target)) {
            return;
          }

          pasteBoardClipboard();
          event.preventDefault();
        }

        if (key === "g") {
          if (isEditableKeyboardTarget(event.target)) {
            return;
          }

          if (compactSelectedBoardItems()) {
            event.preventDefault();
          }
        }
        return;
      }

      // Backspace deletes too — React Flow's own Backspace handling is off
      // (deleteKeyCode null) because it removed cards from the canvas without
      // telling the project, and they came back on the next commit.
      if (event.key === "Delete" || event.key === "Backspace") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        if (deleteSelectedBoardItems()) {
          return;
        }

        if (selectedNodeId) {
          if (project.nodes.some((node) => node.id === selectedNodeId)) {
            deleteNode(selectedNodeId);
            return;
          }

          if ((project.storages ?? []).some((storage) => storage.id === selectedNodeId)) {
            deleteStorage(selectedNodeId);
            selectNode(undefined);
            return;
          }

          if ((project.annotations ?? []).some((annotation) => annotation.id === selectedNodeId)) {
            deleteAnnotation(selectedNodeId);
            selectNode(undefined);
            return;
          }
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        setAnnotationTool(undefined);
        setDeleteMode(false);
        return;
      }

      // R and U on the port row under the pointer: the same two questions its
      // left and right click ask. A hand already on the keyboard should not have
      // to go and find the mouse button, and on a rail of five ports the keys are
      // faster than aiming at any of them.
      if (event.key === "r" || event.key === "R" || event.key === "u" || event.key === "U") {
        if (isEditableKeyboardTarget(event.target) || event.shiftKey) {
          return;
        }

        const mode = event.key === "r" || event.key === "R" ? "recipes" : "uses";
        if (browseHoveredPort(mode)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Escape") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        // Escape means "back out of whatever I'm in": first any active tool
        // or half-made wire, and with nothing else to cancel, one level out
        // of the pocket dimension being viewed.
        const hadTool =
          nodeColorPaintMode !== undefined ||
          annotationTool !== undefined ||
          isDeleteMode ||
          Boolean(useFactoryStore.getState().pendingResourceConnection);
        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        setAnnotationTool(undefined);
        setDeleteMode(false);
        if (!hadTool && activePocketId) {
          enterPocket(
            (project.pockets ?? []).find((pocket) => pocket.id === activePocketId)
              ?.parentPocketId,
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activePocketId,
    annotationTool,
    cancelResourceConnection,
    compactSelectedBoardItems,
    copyBoardSelection,
    deleteAnnotation,
    deleteNode,
    deleteSelectedBoardItems,
    deleteStorage,
    enterPocket,
    isDeleteMode,
    nodeColorPaintMode,
    pasteBoardClipboard,
    project.annotations,
    project.nodes,
    project.pockets,
    project.storages,
    selectNode,
    selectedNodeId,
    setNodeColorPaintMode,
  ]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const ids = selectedNodes.map((node) => node.id);
      setSelectedNodeIds(ids);
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
      // Published so panels outside the canvas (blueprint save, compact) can
      // act on what is selected without reaching into React Flow.
      setSelectedBoardIds(ids);

      const selectedRecipeNode = [...selectedNodes]
        .reverse()
        .find((node) => node.type === "recipeNode");
      selectNode(selectedRecipeNode?.id);
    },
    [selectNode, setSelectedBoardIds],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (isDeleteMode) {
        if (node.type === "recipeNode" || node.type === "trashNode") {
          deleteNode(node.id);
        } else if (node.type === "storageNode") {
          deleteStorage(node.id);
        } else if (node.type === "annotationNode") {
          deleteAnnotation(node.id);
        } else if (node.type === "pocketNode") {
          deleteBoardSelection({ nodeIds: [node.id] });
        }
        return;
      }

      if (nodeColorPaintMode !== undefined) {
        if (node.type === "recipeNode" || node.type === "trashNode") {
          updateNode(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "storageNode") {
          updateStorage(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "annotationNode") {
          updateAnnotation(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        return;
      }

      selectNode(node.id);
    },
    [
      deleteAnnotation,
      deleteBoardSelection,
      deleteNode,
      deleteStorage,
      isDeleteMode,
      nodeColorPaintMode,
      selectNode,
      updateAnnotation,
      updateNode,
      updateStorage,
    ],
  );

  // React Flow's own double-click plumbing, not a handler on the card: the
  // node wrapper's drag machinery can swallow a hand-rolled dblclick, and
  // this path is guaranteed to coexist with it. The name field's rename
  // double-click stops propagation before this fires.
  const handleNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "pocketNode" && !isWiringConnection() && !wasRecentWireDrop()) {
        enterPocket(node.id);
      }
    },
    [enterPocket],
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      if (!isDeleteMode) {
        return;
      }

      event.stopPropagation();
      const edgeIds = expandChannelEdgeIds([edge.id]);
      if (edgeIds.length > 1) {
        deleteBoardSelection({ edgeIds });
      } else {
        deleteEdge(edge.id);
      }
    },
    [deleteBoardSelection, deleteEdge, isDeleteMode],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(undefined);
    cancelResourceConnection();
  }, [cancelResourceConnection, selectNode]);

  // Crossing into or out of a pocket dimension swaps what the board shows
  // wholesale; the camera follows so the traveller lands looking at the new
  // level, not at empty space where the old one was.
  const previousPocketRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousPocketRef.current === activePocketId) {
      return;
    }
    previousPocketRef.current = activePocketId;
    const frame = requestAnimationFrame(() => frameBoardCards());
    return () => cancelAnimationFrame(frame);
  }, [activePocketId, frameBoardCards]);

  const handleShowNodes = useCallback(
    (nodeIds: string[]) => frameBoardCards(nodeIds),
    [frameBoardCards],
  );
  const handleFitView = useCallback(() => frameBoardCards(), [frameBoardCards]);

  // On a phone the pocket breadcrumb takes the board's top line, because where you
  // are is the first thing to know and it was previously stranded a fifth of the
  // way down the screen keeping clear of these. They step down a line instead.
  const toolsStepAside = isCompact && Boolean(activePocketId);

  // Whatever just landed says so, twice. Done to the DOM rather than through the
  // node objects on purpose: a transient outline is not state the board should
  // rebuild for, and threading it through would hand every card a new identity
  // twice per placement — which is what the node memos exist to prevent.
  const placedBoardToken = useFactoryStore((state) => state.placedBoardToken);
  useEffect(() => {
    if (placedBoardToken === 0) {
      return undefined;
    }

    const ids = useFactoryStore.getState().placedBoardIds ?? [];
    let cleanup: (() => void) | undefined;
    // One frame: the cards are placed by the same commit that raised the token,
    // so they are not in the DOM yet.
    const frame = requestAnimationFrame(() => {
      const flashed = ids
        .map((id) => boardRef.current?.querySelector(`.react-flow__node[data-id="${id}"]`))
        .filter((element): element is Element => element !== null && element !== undefined);
      const arrive = readBoardMotionSnapshot().moveMotion;
      for (const element of flashed) {
        element.classList.add(PLACED_FLASH_CLASS);
        if (arrive) {
          element.classList.add(BOARD_ARRIVE_CLASS);
        }
      }
      const arriveTimer = window.setTimeout(() => {
        for (const element of flashed) {
          element.classList.remove(BOARD_ARRIVE_CLASS);
        }
      }, BOARD_ARRIVE_MS);
      const timer = window.setTimeout(() => {
        for (const element of flashed) {
          element.classList.remove(PLACED_FLASH_CLASS);
        }
      }, PLACED_FLASH_MS);
      cleanup = () => {
        window.clearTimeout(timer);
        window.clearTimeout(arriveTimer);
        for (const element of flashed) {
          element.classList.remove(PLACED_FLASH_CLASS, BOARD_ARRIVE_CLASS);
        }
      };
    });

    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [placedBoardToken]);

  // Double tap to zoom, double tap and slide to keep zooming, and a swipe in from
  // either side to pull that drawer out. Off while a tool owns the pointer.
  useBoardTouchGestures({
    boardRef,
    instanceRef: flowInstanceRef,
    enabled: nodeColorPaintMode === undefined && annotationTool === undefined && !isDeleteMode,
  });

  // Compact windows fold each toolbar into a single button, and only one of them
  // unfolds at a time: expanded, any two of these rows would cross each other on
  // a 390px board, which is the mess they are being folded away to avoid.
  const [openToolGroup, setOpenToolGroup] = useState<ToolGroupId | undefined>(undefined);
  const handleToolGroupToggle = useCallback((group: ToolGroupId | undefined) => {
    setOpenToolGroup((current) => (current === group ? undefined : group));
  }, []);

  // Stable references keep the memoized PaintToolbar from re-rendering on the
  // per-frame FactoryFlow renders a node drag produces.
  const handlePaintModeChange = useCallback(
    (tag: FactoryNodeColorTag | null | undefined) => {
      setAnnotationTool(undefined);
      setDeleteMode(false);
      // Picking up the brush drops the status view and its heatmap: painting
      // under heat would look like nothing happened, because the heat is
      // covering every colour. Both together — the heat rides the status
      // view, and a split state would resurrect it on the next reload.
      if (tag !== undefined) {
        writeBoardView({ heatmapMode: false, glanceMode: "identity" });
      }
      setNodeColorPaintMode(tag);
    },
    [setNodeColorPaintMode],
  );
  const handlePaintColorSelect = useCallback(
    (tag: FactoryNodeColorTag) => {
      setActiveColorTag(tag);
      // Changing colour mid-paint keeps painting with the new colour.
      if (nodeColorPaintMode !== undefined) {
        setNodeColorPaintMode(tag);
      }
    },
    [nodeColorPaintMode, setNodeColorPaintMode],
  );
  const handleAnnotationToolChange = useCallback(
    (tool: FactoryAnnotationKind | undefined) => {
      setNodeColorPaintMode(undefined);
      setDeleteMode(false);
      setAnnotationTool(tool);
      // A half-clicked zone dies with its tool; the other tools never leave a
      // draft behind (theirs live only inside one press-drag-release).
      annotationDraftRef.current = undefined;
      setAnnotationDraft(undefined);
    },
    [setNodeColorPaintMode],
  );
  const handleDeleteModeChange = useCallback(
    (enabled: boolean) => {
      setNodeColorPaintMode(undefined);
      setAnnotationTool(undefined);
      setDeleteMode(enabled);
    },
    [setNodeColorPaintMode],
  );

  const handleNodeDragStart = useCallback((_: unknown, node: Node, draggedNodes: Node[]) => {
    // A drag is about to move geometry; the map under it would be a distraction
    // and the pointer never leaves the node, so nothing else would clear it.
    clearHopMap();
    activelyDraggedNodeIds.clear();
    activelyDraggedNodeIds.add(node.id);
    for (const dragged of draggedNodes) {
      activelyDraggedNodeIds.add(dragged.id);
    }
    // Annotations are ink, not furniture: wires pass straight through them,
    // so a drag moving ONLY notes and boxes cannot change any route and must
    // not spend a single mid-drag solve. Decided once at grab time.
    dragMovesObstaclesRef.current = [node, ...draggedNodes].some(
      (dragged) => dragged.type !== "annotationNode",
    );
    // A fresh drag's first cell change solves immediately; the throttle only
    // paces the changes after it.
    lastLiveDragSolveAtRef.current = 0;
    draggingNodeRef.current = true;
    // The card-over-wires layering during the drag is pure CSS: the
    // --dragging board class lifts the whole nodes layer above the edge
    // layer, and the .dragging node rule keeps the held card above its
    // siblings. Per-node zIndex can't do it — each layer is its own
    // stacking context, so node and edge z values are never compared.
    setNodeDragging(true);
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node, draggedNodes: Node[]) => {
      // A drag moves the WHOLE selection, so the whole selection has to land:
      // persisting only the grabbed card left the rest of the selection at
      // their old positions in the project, and the next store commit snapped
      // them back. One batch move is also one undo entry, not one per card.
      const dropped = draggedNodes.length > 0 ? draggedNodes : [node];
      moveBoardItems(dropped.map((entry) => ({ id: entry.id, position: entry.position })));

      activelyDraggedNodeIds.clear();
      draggingNodeRef.current = false;
      // The drop's own publish below supersedes any trailing live-drag solve.
      window.clearTimeout(liveDragTrailingTimerRef.current);
      // The geometry-publish effects can't see the drop: React Flow streamed
      // the final position into `flowNodes` during the last drag frame, so
      // their fingerprints won't change again. Republish here — the ref
      // already holds the final layout. A drag that moved OBSTACLES also
      // invalidates measurements and bumps the layout version so every stale
      // route is reissued; a drag that moved only ink refreshes the maps and
      // leaves all six hundred wires alone.
      const movedObstacles = dragMovesObstaclesRef.current;
      publishBoardGeometry(movedObstacles);
      if (movedObstacles) {
        setLayoutVersion((version) => version + 1);
      }
      setNodeDragging(false);
      const droppedById = new Map(dropped.map((entry) => [entry.id, entry] as const));
      setFlowNodes((currentNodes) =>
        currentNodes.map((entry) => {
          const droppedNode = droppedById.get(entry.id);
          return droppedNode
            ? ({ ...entry, position: droppedNode.position } as typeof entry)
            : entry;
        }),
      );
    },
    [moveBoardItems, publishBoardGeometry],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      // One entry, channels expanded: a collapsed-pocket wire stands for
      // every flat edge in its channel and they leave together.
      const edgeIds = expandChannelEdgeIds(deletedEdges.map((edge) => edge.id));
      if (edgeIds.length > 0) {
        deleteBoardSelection({ edgeIds });
      }
    },
    [deleteBoardSelection],
  );

  const commitAnnotationDraft = useCallback(
    (tool: FactoryAnnotationKind, draft: AnnotationDraft) => {
      const width = Math.abs(draft.end.x - draft.start.x);
      const height = Math.abs(draft.end.y - draft.start.y);
      const corner = {
        x: Math.min(draft.start.x, draft.end.x),
        y: Math.min(draft.start.y, draft.end.y),
      };

      if (tool === "box") {
        // A bare click (no meaningful drag) drops a default-sized shape.
        const isClick = width < 12 && height < 12;
        addAnnotation({
          kind: "box",
          colorTag: activeColorTag,
          position: isClick ? draft.start : corner,
          size: isClick
            ? ANNOTATION_DEFAULT_BOX
            : { width: Math.max(width, ANNOTATION_MIN_BOX), height: Math.max(height, ANNOTATION_MIN_BOX) },
        });
        return;
      }

      if (tool === "zone") {
        // Nothing to settle means nothing lands: corners that snapped onto
        // each other or a loop thinner than a cell never made an area.
        const zone = settleZonePoints(draft.trail, BOARD_GRID_SIZE);
        if (zone) {
          addAnnotation({
            kind: "zone",
            colorTag: activeColorTag,
            position: zone.position,
            size: zone.size,
            points: zone.points,
          });
        }
        return;
      }

      if (tool === "arrow") {
        const isClick = width < 16 && height < 16;
        addAnnotation({
          kind: "arrow",
          colorTag: activeColorTag,
          position: isClick ? draft.start : corner,
          size: isClick
            ? ANNOTATION_DEFAULT_ARROW
            : { width: Math.max(width, ANNOTATION_MIN_ARROW), height: Math.max(height, ANNOTATION_MIN_ARROW) },
          arrowDirection: `${draft.end.y >= draft.start.y ? "down" : "up"}-${
            draft.end.x >= draft.start.x ? "right" : "left"
          }` as const,
        });
        return;
      }

      const isClick = width < 12 && height < 12;
      addAnnotation({
        kind: "text",
        colorTag: activeColorTag,
        text: "",
        position: isClick ? draft.start : corner,
        size: isClick
          ? ANNOTATION_DEFAULT_TEXT
          : {
              width: Math.max(width, ANNOTATION_MIN_TEXT.width),
              height: Math.max(height, ANNOTATION_MIN_TEXT.height),
            },
      });
    },
    [activeColorTag, addAnnotation],
  );

  /**
   * A picture becomes a board annotation: uploaded to the image bucket, sized
   * from its own pixels into a sensible footprint of whole cells, and dropped
   * where asked (a drag-and-drop point) or in the middle of the view (the
   * toolbar button, a paste). Every refusal - too big, not an image, hosting
   * down - surfaces as a plain dialog rather than a silent nothing.
   */
  const placeImageFile = useCallback(
    async (file: File | Blob, dropPoint?: { x: number; y: number }) => {
      try {
        const [imageUrl, natural] = await Promise.all([
          uploadBoardImage(file),
          readImageSize(file),
        ]);
        const scale = Math.min(1, 600 / natural.width, 480 / natural.height);
        const width = Math.max(
          BOARD_GRID * 2,
          Math.round((natural.width * scale) / BOARD_GRID) * BOARD_GRID,
        );
        const height = Math.max(
          BOARD_GRID * 2,
          Math.round((natural.height * scale) / BOARD_GRID) * BOARD_GRID,
        );
        const instance = flowInstanceRef.current;
        const boardRect = boardRef.current?.getBoundingClientRect();
        const centre =
          dropPoint ??
          (instance && boardRect
            ? instance.screenToFlowPosition({
                x: boardRect.left + boardRect.width / 2,
                y: boardRect.top + boardRect.height / 2,
              })
            : { x: 0, y: 0 });
        addAnnotation({
          kind: "image",
          imageUrl,
          colorTag: activeColorTag,
          position: { x: centre.x - width / 2, y: centre.y - height / 2 },
          size: { width, height },
        });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Image upload failed.");
      }
    },
    [activeColorTag, addAnnotation],
  );

  // Ctrl+V with a picture on the OS clipboard drops it on the board. Real
  // paste events only carry files when there IS an image, so this never
  // shadows the board's own copy/paste, which rides the keydown handler.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const file = Array.from(event.clipboardData?.files ?? []).find((candidate) =>
        candidate.type.startsWith("image/"),
      );
      if (!file) {
        return;
      }
      event.preventDefault();
      void placeImageFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [placeImageFile]);

  const handleAnnotationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tool = annotationTool;
      if (!tool || event.button !== 0) {
        return;
      }

      // The tool buttons live inside the board wrapper; they must keep working.
      if ((event.target as HTMLElement).closest("[data-board-toolbar]")) {
        return;
      }

      const instance = flowInstanceRef.current;
      if (!instance) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const start = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // The zone is not a drag: corners land click by click, and the loop
      // closes with a click back on the first corner. Screen distance, so
      // "back on the first corner" means the same thing at every zoom.
      if (tool === "zone") {
        const current = annotationDraftRef.current;
        if (current) {
          const firstOnScreen = instance.flowToScreenPosition(current.trail[0]);
          const isClosing =
            Math.hypot(firstOnScreen.x - event.clientX, firstOnScreen.y - event.clientY) <= 14;
          if (isClosing) {
            if (current.trail.length >= 3) {
              annotationDraftRef.current = undefined;
              setAnnotationDraft(undefined);
              setAnnotationTool(undefined);
              commitAnnotationDraft(tool, current);
            }
            // Two corners cannot close; the click is neither corner nor close.
            return;
          }
          const next = { start: current.start, end: start, trail: [...current.trail, start] };
          annotationDraftRef.current = next;
          setAnnotationDraft(next);
          return;
        }
        const draft = { start, end: start, trail: [start] };
        annotationDraftRef.current = draft;
        setAnnotationDraft(draft);
        return;
      }

      const draft = { start, end: start, trail: [start] };
      annotationDraftRef.current = draft;
      setAnnotationDraft(draft);

      const handleMove = (moveEvent: PointerEvent) => {
        const current = annotationDraftRef.current;
        if (!current) {
          return;
        }

        const end = instance.screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        const next = { start: current.start, end, trail: current.trail };
        annotationDraftRef.current = next;
        setAnnotationDraft(next);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        const current = annotationDraftRef.current;
        annotationDraftRef.current = undefined;
        setAnnotationDraft(undefined);
        setAnnotationTool(undefined);
        if (current) {
          commitAnnotationDraft(tool, current);
        }
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [annotationTool, commitAnnotationDraft],
  );

  // The zone's rubber band: between clicks the next edge follows the cursor,
  // and Escape throws the half-drawn loop away, tool and all.
  useEffect(() => {
    if (annotationTool !== "zone") {
      return;
    }

    const followCursor = (event: PointerEvent) => {
      const current = annotationDraftRef.current;
      const instance = flowInstanceRef.current;
      if (!current || !instance) {
        return;
      }
      const end = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const next = { start: current.start, end, trail: current.trail };
      annotationDraftRef.current = next;
      setAnnotationDraft(next);
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        annotationDraftRef.current = undefined;
        setAnnotationDraft(undefined);
        setAnnotationTool(undefined);
      }
    };

    window.addEventListener("pointermove", followCursor);
    window.addEventListener("keydown", cancelOnEscape);
    return () => {
      window.removeEventListener("pointermove", followCursor);
      window.removeEventListener("keydown", cancelOnEscape);
    };
  }, [annotationTool]);

  // The status smart view brings the heatmap with it: "show me usage" is one
  // mode at every zoom. Turning the heat on drops the brush — painting while
  // every node is showing heat would have you picking colours you cannot see
  // land.
  const handleGlanceModeChange = useCallback(
    (mode: GlanceMode) => {
      if (mode === "status") {
        setNodeColorPaintMode(undefined);
      }
      writeBoardView({ glanceMode: mode, heatmapMode: mode === "status" });
    },
    [setNodeColorPaintMode],
  );

  // One short line of caution before the dock-mode flip rewires the board —
  // shown when there is real work to redo (lots of lines) or user work to
  // unsettle (pinned dots). Undefined means flip silently.
  const dockToggleWarning = useMemo(() => {
    const edgeCount = project.edges.length;
    const hasDots = project.edges.some((edge) => (edge.waypoints?.length ?? 0) > 0);
    if (edgeCount < 50 && !hasDots) {
      return undefined;
    }
    if (hasDots && edgeCount >= 50) {
      return `Rewires all ${edgeCount} lines and your pinned dots. It may take a moment and look odd at first. Flipping back restores it. Continue?`;
    }
    if (hasDots) {
      return "Rewires your lines and pinned dots. It may look odd for a moment. Flipping back restores it. Continue?";
    }
    return `Rewires all ${edgeCount} lines. It may take a moment. Flipping back restores it. Continue?`;
  }, [project.edges]);

  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;

  return (
    <div
      ref={boardRef}
      // The smart-view mode rides as a data attribute so the hop-map
      // controller and the glance CSS can read the mode in force without any
      // React subscription.
      data-glance-mode={boardView.glanceMode}
      data-tour-anchor="board"
      className={[
        // The 480px floor keeps a desktop board usable, and clears the shortest
        // window that is not compact (560px) with the two bars above it. A phone
        // in landscape has about 320px left after the bars and has to live with
        // it: a floor taller than the window is a page that scrolls the board out
        // of sight.
        "factory-flow-board relative h-full min-h-[480px] compact:min-h-0 overflow-hidden border-x border-line bg-canvas",
        isNodeDragging ? "factory-flow-board--dragging" : "",
        paintCursor ? "factory-flow-board--painting" : "",
        annotationTool ? "factory-flow-board--annotating" : "",
        isDeleteMode ? "factory-flow-board--deleting" : "",
        lineThicknessMode ? "factory-flow-board--edges-under" : "",
        calmMode ? "factory-flow-board--calm" : "",
        // The two motion switches (board-motion.tsx): the grid magnet and the
        // arrival pop hang off the first, the easing gauges off the second.
        boardMotion.moveMotion ? "factory-flow-board--move-motion" : "",
        boardMotion.valueMotion ? "factory-flow-board--value-motion" : "",
        // Inside a pocket dimension the room itself says where you are:
        // purple canvas, purple dots, purple window frame (globals.css).
        activePocketId ? "factory-flow-board--pocket-view" : "",
        overwritePicking ? "factory-flow-board--blueprint-picking" : "",
      ].join(" ")}
      style={
        {
          ...(paintCursor ? { "--paint-cursor": paintCursor } : undefined),
          ...(isDeleteMode ? { "--delete-cursor": getDeleteCursor() } : undefined),
          // The theme paints the room: base colour, the screen-space edge
          // vignette (grain moved into the viewport — see GrainBackground),
          // and the --canvas var every canvas-matching surface (edge label
          // backgrounds) reads. Inside a pocket the violet room always wins -
          // the pocket look is a landmark, not a taste.
          ...(activePocketId
            ? undefined
            : {
                backgroundColor: canvasTheme.base,
                backgroundImage: canvasTheme.vignette,
                "--canvas": canvasTheme.base,
                "--canvas-dot": canvasTheme.patternColor,
              }),
        } as CSSProperties
      }
      onPointerDownCapture={handleAnnotationPointerDown}
      // Dragging a picture file straight onto the board drops it where it
      // lands, as an image annotation.
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const file = Array.from(event.dataTransfer.files).find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        if (!file) {
          return;
        }
        event.preventDefault();
        const point = flowInstanceRef.current?.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        void placeImageFile(file, point);
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        // React Flow styles its own controls and minimap off this; the app has
        // no light palette to switch to.
        colorMode="dark"
        style={FLOW_WRAPPER_STYLE}
        // The attribution badge sat in the bottom-right corner and pushed the
        // board's own buttons up out of that corner to clear it. The library is
        // MIT and credited in the repo instead.
        proOptions={PRO_OPTIONS}
        isValidConnection={isValidResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        elevateNodesOnSelect={false}
        edgesReconnectable={false}
        // Delete/Backspace are handled by the board's own keydown handler,
        // which routes through the store (one undo entry, edges pruned).
        // React Flow's built-in delete only edited its local copy: cards
        // vanished from the canvas, stayed in the project, and reappeared on
        // the next commit.
        deleteKeyCode={null}
        // The shift-drag band selects whatever it touches. Full containment
        // made rubber-banding big cards feel broken - clipping a card's edge
        // did nothing.
        selectionMode={SelectionMode.Partial}
        // Shift adds a card to the selection, the same key that drags the
        // band. React Flow's default is Ctrl/Cmd only, which left shift-click
        // REPLACING the selection - the one gesture everyone reaches for.
        // Both keys work; shift doing two jobs is not a clash, since the band
        // starts on the pane and this only fires on a card.
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgeClick={handleEdgeClick}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        // No `fitView`. React Flow's fit-on-init WAITS for the cards to be
        // measured, so on a page load it lands after the plan does - and after
        // the board has been put back where the tab was left, which it then
        // stamped over with a fit of the whole plan. The app frames for itself
        // on every path that puts cards on the board (the design store, plan
        // import, blueprint paste, the tours), so nothing was relying on it.
        onlyRenderVisibleElements
        // Double-click PINS AND UNPINS waypoint dots now, so the gesture can
        // no longer also mean "zoom in". d3's dblclick.zoom listener sits on
        // the pane, upstream of React's synthetic events — stopPropagation
        // in the dot handlers can never reach it, so it goes off wholesale.
        zoomOnDoubleClick={false}
        // The same floor and ceiling a framing move is clamped to.
        minZoom={BOARD_MIN_ZOOM}
        maxZoom={BOARD_MAX_ZOOM}
        // React Flow's default ("basic") raises every edge to at least the
        // z-index of its two endpoint nodes, so an edge can never be told to
        // pass BEHIND a node it connects to — which is why asking for -1 did
        // nothing. Manual mode takes the zIndex we publish literally. This
        // board already sets an explicit zIndex on every edge, so nothing else
        // depended on the automatic elevation.
        zIndexMode="manual"
        // Always. Cards are whole cells; a card between cells is just wrong.
        snapToGrid
        snapGrid={BOARD_GRID_SNAP}
        // A finger drags a card only after selecting it; see withTouchDragRule.
        nodesDraggable={!isCompact}
      >
        <NodeDetailController boardRef={boardRef} />
        <HopMapController boardRef={boardRef} />
        <SelectionHandoffController signal={selectionHandoffCount} activePocketId={activePocketId} />
        {linePulseMode ? <EdgePulseCanvas edgesUnderNodes={lineThicknessMode} /> : null}
        {/* The paper's tooth, in board space so it pans and zooms with the
            factory. Mounted before the pattern so dots ink OVER the grain.
            A pocket keeps its flat violet room. */}
        {!activePocketId && canvasTheme.grain ? (
          <GrainBackground layers={canvasTheme.grain} />
        ) : null}
        {boardView.canvasPattern === "none" ? null : boardView.canvasPattern === "ruled" ||
          boardView.canvasPattern === "graph" ? (
          <RuledBackground
            mode={boardView.canvasPattern}
            color={activePocketId ? POCKET_CANVAS_DOT_COLOR : canvasTheme.patternColor}
          />
        ) : (
          <Background
            variant={CANVAS_PATTERN_VARIANT[boardView.canvasPattern]}
            gap={BOARD_GRID_SIZE}
            // Lines tile edge to edge, so they need to be thinner than a dot
            // to read as a background instead of as graph paper.
            size={boardView.canvasPattern === "lines" ? 1 : 2}
            color={activePocketId ? POCKET_CANVAS_DOT_COLOR : canvasTheme.patternColor}
            // Like the wrapper: the pattern SVG must not lay its own dark
            // paper over the themed board div underneath.
            bgColor="transparent"
          />
        )}
        {annotationDraft && annotationTool ? (
          <AnnotationDraftPreview
            tool={annotationTool}
            draft={annotationDraft}
            swatch={GT_NODE_COLORS[activeColorTag].swatch}
          />
        ) : null}
      </ReactFlow>
      <PaintToolbar
        paintMode={nodeColorPaintMode}
        onPaintModeChange={handlePaintModeChange}
        activeColorTag={activeColorTag}
        onColorSelect={handlePaintColorSelect}
        annotationTool={annotationTool}
        onAnnotationToolChange={handleAnnotationToolChange}
        onPlaceImage={placeImageFile}
        isDeleteMode={isDeleteMode}
        onDeleteModeChange={handleDeleteModeChange}
        compact={isCompact}
        openGroup={openToolGroup}
        onToggleGroup={handleToolGroupToggle}
        shiftedDown={toolsStepAside}
      />
      <BoardViewToolbar
        view={boardView}
        onChange={writeBoardView}
        dockToggleWarning={dockToggleWarning}
        compact={isCompact}
        openGroup={openToolGroup}
        onToggleGroup={handleToolGroupToggle}
        shiftedDown={toolsStepAside}
      />
      <SourceToolbar
        compact={isCompact}
        openGroup={openToolGroup}
        onToggleGroup={handleToolGroupToggle}
        shiftedDown={toolsStepAside}
      />
      <BoardHelp compact={isCompact} />
      {overwritePicking ? (
        <div
          className={[
            "pointer-events-none absolute left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 border-2 border-amber-500 bg-[#2a1e07]/95 px-3 py-1.5 font-mono text-[12px] text-amber-200 shadow-[4px_4px_0_rgba(0,0,0,0.45)]",
            // An instruction about what to do next, so on a phone it goes to the
            // bottom with the other actions. Above the compact bar if both are up.
            actionBarPosition(isCompact, false),
          ].join(" ")}
        >
          {overwritePicking.create ? (
            <>Pick a pocket on the board. It lands on your shelf. Esc cancels.</>
          ) : (
            <>
              Pick a pocket on the board. It becomes &ldquo;{overwritePicking.name}&rdquo;. Esc
              cancels.
            </>
          )}
        </div>
      ) : null}
      {compactWarning ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="max-w-[560px] border-2 border-amber-500 bg-[#1b1d21] p-5 font-mono text-neutral-100 shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
            <p className="text-[17px] font-bold text-amber-300">One port per resource</p>
            <p className="mt-3 text-[14px] leading-relaxed text-neutral-300">
              Pockets allow one connection per resource. This selection has more:
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-[15px] font-bold text-amber-200">
              {compactWarning.warnings.map((warning) => (
                <li key={`${warning.side}:${warning.kind}:${warning.resourceId}`}>
                  {warning.side === "input"
                    ? `${warning.label} will be shared between all ${warning.memberCount} machines`
                    : `${warning.label} will be collected from all ${warning.memberCount} machines`}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] leading-relaxed text-neutral-300">
              Making the pocket merges these wires: every machine that asks gets a share, and the
              planner decides the split. Unpacking keeps this wiring.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompactWarning(undefined)}
                className="h-9 rounded-[4px] border border-neutral-700 bg-[#17191d] px-3 text-[14px] text-neutral-300 hover:text-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const ids = compactWarning.ids;
                  setCompactWarning(undefined);
                  runCompact(ids);
                }}
                className="h-9 rounded-[4px] border border-amber-600 bg-amber-950 px-3 text-[14px] font-medium text-amber-200 hover:bg-amber-900"
              >
                Make the pocket
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <PocketBreadcrumbs />
      <SelectionActionsBar
        selectionCount={selectedNodeIds.length}
        onCompact={compactSelectedBoardItems}
      />
      <SmartViewToolbar
        glanceMode={boardView.glanceMode}
        onModeChange={handleGlanceModeChange}
        onFitView={handleFitView}
      />
      <HopMapLegend />
      {/* The notices share one column, so none ever sits on top of another.
          Unwired goes UNDER the dead loop: a ring is a thing that has gone
          wrong, unfinished wiring is just work still to do. The add chips ride
          on top: they are the most transient thing here. */}
      <div className="nodrag pointer-events-none absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col-reverse items-center gap-2">
        <UnwiredNotice onShow={handleShowNodes} />
        <DeathSpiralNotice onShow={handleShowNodes} />
        <RecipeAddChips />
      </div>
      {isProjectImporting ? <FlowLoadingOverlay /> : null}
    </div>
  );
}

/**
 * The one board-level thing worth interrupting for: a ring of machines that
 * has wound down to a standstill and cannot restart itself.
 *
 * It earns a notice where other problems do not, because a spiral is the only
 * failure whose cause is nowhere in particular. A bottleneck is ON a card, so
 * the card can say it. A ring's cause is the ring, and every card in it can
 * only point at the next one, so at a hundred machines the board reads as a
 * field of zeros with no author. Hence: state the ring once, in one place,
 * and say plainly that the planner is right and the game would do this too.
 *
 * Dismissal is keyed to the ring's identity, so waving this one away does not
 * silence the NEXT spiral you build.
 */
/**
 * The board's to-do list, in one line: how many cards still have a slot with
 * no wire on it.
 *
 * A closed plan has to say where every ingredient comes from and where every
 * product goes, so an unwired slot is not a fault to scold - it is work not
 * done yet, and the honest thing is to say how much of it is left and offer to
 * take you there. Chalk-white to match the mark on the cards themselves (see
 * --verdict-unwired-ink), never the alert reds and ambers: this is a checklist,
 * not an alarm.
 *
 * Not dismissible, deliberately, and it disappears by itself the moment the
 * last slot is connected - which is the only ending it has.
 */
const UnwiredNotice = memo(function UnwiredNotice({
  onShow,
}: {
  onShow: (nodeIds: string[]) => void;
}) {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const unwired = useMemo(
    () => findUnwiredNodeIds(project, lastResult),
    [project, lastResult],
  );

  if (unwired.length === 0) {
    return null;
  }

  return (
    <div className="unwired-notice nodrag pointer-events-auto flex items-center gap-2 border-2 border-[#c8d2e0] bg-[#2b3038]/95 px-2 py-1.5 font-mono text-[12px] text-[#e8ecf2] shadow-[inset_2px_2px_0_#5d6877,inset_-2px_-2px_0_#171a1f,4px_4px_0_rgba(0,0,0,0.35)]">
      <span className="shrink-0 font-bold tracking-[0.5px] text-[#eef2f8]">NOT WIRED UP</span>
      {/* One line, always. The card already explains itself; this only says
          how many are left and offers to take you to them. */}
      <span className="whitespace-nowrap text-[#c2cad6]">
        {unwired.length === 1
          ? "1 machine has a slot with nothing on it"
          : `${unwired.length} machines have slots with nothing on them`}
      </span>
      <button
        type="button"
        onClick={() => onShow(unwired)}
        className="shrink-0 border border-[#c8d2e0] bg-[#454f5e] px-2 py-0.5 font-bold text-[#ffffff] hover:bg-[#566275]"
      >
        Show me
      </button>
    </div>
  );
});

const DeathSpiralNotice = memo(function DeathSpiralNotice({
  onShow,
}: {
  onShow: (nodeIds: string[]) => void;
}) {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined);
  const spirals = useMemo(
    () => findDeathSpirals(project, lastResult).spirals,
    [project, lastResult],
  );

  const spiral = spirals[0];
  if (!spiral || dismissedId === spiral.id) {
    return null;
  }
  const story = describeDeathSpiral(spiral);

  return (
    <div className="nodrag pointer-events-auto flex items-center gap-2 border-2 border-[#c34c4c] bg-[#2b1c1c]/95 px-2 py-1.5 font-mono text-[12px] text-[#f2e4e4] shadow-[inset_2px_2px_0_#7a3636,inset_-2px_-2px_0_#1a1010,4px_4px_0_rgba(0,0,0,0.35)]">
      <span className="shrink-0 font-bold tracking-[0.5px] text-[#ff9c9c]">DEAD LOOP</span>
      <span className="text-[#e6d2d2]">{story.short}</span>
      {spirals.length > 1 ? (
        <span className="shrink-0 text-[#b89a9a]">
          +{spirals.length - 1} more
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onShow(spiral.machineIds)}
        className="shrink-0 border border-[#c34c4c] bg-[#4a2424] px-2 py-0.5 font-bold text-[#ffd0d0] hover:bg-[#63302f]"
      >
        Show me
      </button>
      <button
        type="button"
        onClick={() => setDismissedId(spiral.id)}
        title="Dismiss"
        aria-label="Dismiss this notice"
        className="flex h-5 w-5 shrink-0 items-center justify-center border border-[#7a3636] text-[#e0b3b3] hover:bg-[#4a2424]"
      >
        ×
      </button>
    </div>
  );
});

/**
 * The smart-view switch, bottom right: what a zoomed-out card leads with.
 * Exactly one mode is always in force — identity (big machine icon, count and
 * name, I/O rates on hover) or status (utilisation percentage, hop-distance
 * map on hover).
 */
/**
 * Lives inside the ReactFlow tree for its store access. After a band select,
 * React Flow overlays the selection with a group-drag rectangle and keeps it
 * up until a pane click — but when a compact/paste/blueprint-load hands the
 * selection to freshly created cards, that rectangle would sit over the new
 * card and swallow every click. Any handoff or level change dismisses it.
 */
function SelectionHandoffController({
  signal,
  activePocketId,
}: {
  signal: number;
  activePocketId?: string;
}) {
  const storeApi = useStoreApi();
  useEffect(() => {
    storeApi.setState({ nodesSelectionActive: false });
  }, [signal, activePocketId, storeApi]);
  return null;
}

/**
 * How far down a banner centred over the board sits.
 *
 * On a wide board the top line is clear in the middle, so banners ride at the
 * very top. On a compact one that line holds the three folded toolbars and the
 * line below it is where they unfold, so a centred banner would land on top of
 * them: it drops to the third line instead, and a second banner stacks under the
 * first.
 */
function centredBannerTop(compact: boolean, second: boolean): string {
  if (compact) {
    // The top line, and the tool triggers move down out of its way (see
    // `bannerShiftsTools`). It used to sit on the third line to stay clear of
    // them, which left it stranded a fifth of the way down the screen with an
    // empty band above it — a breadcrumb belongs at the top of what it describes.
    return second ? "top-14" : "top-3";
  }
  return second ? "top-14" : "top-3";
}

/**
 * A bar of actions, at the bottom on a phone.
 *
 * Where you are goes at the top; what you can do goes within reach of a thumb.
 * Both were competing for the top line, and the top line already has the three
 * tool triggers on it.
 */
function actionBarPosition(compact: boolean, second: boolean): string {
  if (compact) {
    return second ? "bottom-28" : "bottom-16";
  }
  return second ? "top-14" : "top-3";
}

/**
 * Where in the multiverse the board is: "Board ▸ Pocket ▸ Inner pocket",
 * top-centre, every segment a jump. Hidden entirely on the root board — the
 * common case pays nothing for the feature.
 */
const PocketBreadcrumbs = memo(function PocketBreadcrumbs() {
  const activePocketId = useFactoryStore((state) => state.activePocketId);
  const pockets = useFactoryStore((state) => state.project.pockets);
  const enterPocket = useFactoryStore((state) => state.enterPocket);
  const isCompact = useIsCompactViewport();
  if (!activePocketId) {
    return null;
  }

  const byId = new Map((pockets ?? []).map((pocket) => [pocket.id, pocket]));
  const trail: { id: string | undefined; name: string }[] = [];
  let cursor: string | undefined = activePocketId;
  const seen = new Set<string>();
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const pocket = byId.get(cursor);
    if (!pocket) {
      break;
    }
    trail.unshift({ id: pocket.id, name: pocket.name });
    cursor = pocket.parentPocketId;
  }
  trail.unshift({ id: undefined, name: "Board" });

  return (
    <div
      data-board-toolbar
      className={[
        "nodrag pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 border-2 border-[#8d6fd1] bg-[#241b33]/95 px-2 py-1.5 font-mono text-[12px] text-white shadow-[inset_2px_2px_0_#3b2d52,inset_-2px_-2px_0_#1a1326]",
        centredBannerTop(isCompact, false),
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => {
          const parent = byId.get(activePocketId)?.parentPocketId;
          enterPocket(parent);
        }}
        title="Back out one level (Esc)"
        aria-label="Exit this pocket dimension"
        className="mr-1 flex h-6 w-6 items-center justify-center border border-[#8d6fd1] bg-[#3b2d52] hover:bg-[#5e4a85]"
      >
        ↩
      </button>
      {trail.map((segment, index) => (
        <span key={segment.id ?? "root"} className="flex items-center gap-1">
          {index > 0 ? <span className="text-[#8d7ab0]">▸</span> : null}
          {index === trail.length - 1 ? (
            <span className="font-bold text-[#e6dcff]">✦ {segment.name}</span>
          ) : (
            <button
              type="button"
              onClick={() => enterPocket(segment.id)}
              className="text-[#c9b8ec] underline-offset-2 hover:underline"
            >
              {segment.name}
            </button>
          )}
        </span>
      ))}
    </div>
  );
});

/**
 * Appears only while several cards are selected: the one gesture that turns
 * a selection into a pocket dimension. Lives on the board (not a toolbar
 * dock) so it reads as acting on the selection under it.
 */
const SelectionActionsBar = memo(function SelectionActionsBar({
  selectionCount,
  onCompact,
}: {
  selectionCount: number;
  onCompact: () => boolean;
}) {
  const activePocketId = useFactoryStore((state) => state.activePocketId);
  const isCompact = useIsCompactViewport();
  if (selectionCount < 2) {
    return null;
  }

  return (
    <div
      data-board-toolbar
      // A button, so on a phone it sits at the bottom in reach of a thumb; on a
      // desktop it stays at the top, below the breadcrumb strip when both are up.
      className={[
        "nodrag pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2",
        actionBarPosition(isCompact, Boolean(activePocketId)),
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onCompact}
        title="Compact the selected cards into a pocket dimension (Ctrl+G): they become one card with the group's inputs and outputs. Double-click it to step inside"
        className="flex h-9 items-center gap-1.5 whitespace-nowrap border-2 border-[#8d6fd1] bg-[#3b2d52] px-3 font-mono text-[12px] font-bold text-white shadow-[inset_2px_2px_0_#5e4a85,inset_-2px_-2px_0_#241b33] hover:brightness-110"
      >
        <Box className="h-4 w-4" />
        Compact {selectionCount} into pocket
      </button>
    </div>
  );
});

/** Which of the board's toolbars is unfolded on a compact window. */
type ToolGroupId = "build" | "paint" | "view";

interface ToolGroupProps {
  id: ToolGroupId;
  compact: boolean;
  openGroup?: ToolGroupId;
  onToggle: (group: ToolGroupId | undefined) => void;
  /** The trigger's mark. */
  icon: LucideIcon;
  /** What it opens, in words, for the trigger's label. */
  label: string;
  /** Which corner the toolbar lives in, and so which way it unfolds. */
  side: "left" | "right";
  children: React.ReactNode;
}

/**
 * A shared plate behind one FAMILY of buttons, so a toolbar reads as its
 * groups — these place things, these change the view — without a word of
 * labelling. The same bevelled slab the colour palette wears (a darkest-tone
 * plate vanished against the canvas): visibly lighter than the board, so the
 * darker button faces read as recessed keys in one housing. Within a plated
 * row even a lone button (the bin, the fit-view) gets a plate, both so
 * baselines line up and because standing apart IS the point.
 */
function ToolTray({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex items-start gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]">
      {children}
    </div>
  );
}

/**
 * The two faces of a board toggle. ON is the pressed light key the rate units
 * have always worn; every toggle on the board speaks that one language now,
 * instead of some pressing in and some growing a blue ring. The palette's
 * swatches keep their cyan ring alone: a selection mark there has to stand
 * against any hue, including this very grey.
 */
const TOOL_FACE_ON = "bg-[var(--mc-85)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100)]";
const TOOL_FACE_OFF =
  "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

/**
 * A toolbar folded into one button, for windows too narrow to carry it.
 *
 * Three rows of nine 36px buttons want 970px between them. A 390px board gave
 * them one, so they overlapped: the paint row's bin sat on top of the rate
 * units, and half of each row was unreachable. Folded, each row costs one
 * button, and the one the player opens unfolds over empty canvas.
 *
 * Off compact this is not a wrapper at all — it renders its children and
 * nothing else, so the desktop toolbars keep exactly the DOM they had.
 */
function ToolGroup({
  id,
  compact,
  openGroup,
  onToggle,
  icon: Icon,
  label,
  side,
  children,
}: ToolGroupProps) {
  if (!compact) {
    return <>{children}</>;
  }

  const isOpen = openGroup === id;
  // The row unfolds DOWNWARDS, onto a line of its own, and out of the layout: the
  // three triggers share the top line, so a row that opened along it would land
  // on top of the other two, and one measured 373px of a 390px board. Absolute
  // also means a folded row takes no width, so a trigger never shifts.
  //
  // `invisible` rather than a bare `opacity-0`: every button in these rows sets
  // `pointer-events-auto` for the sake of the toolbar it lives in, which would
  // override a `pointer-events-none` here and leave a row of invisible buttons
  // taking taps. Hidden visibility cannot be overridden from inside, so it costs
  // the fade on the way out and buys correctness.
  const row = (
    <div
      className={[
        // `w-max`, or the row inherits its shrink-to-fit width from the toolbar
        // root it is positioned against — which folded is one 36px button, so
        // every row wrapped into a vertical column one button wide.
        // top-[3.25rem]: the plated trigger stands 48px tall now.
        "absolute top-[3.25rem] flex w-max max-w-[calc(100vw-24px)] flex-wrap items-start gap-1 transition-[opacity,transform] duration-100",
        side === "left" ? "left-0 justify-start" : "right-0 justify-end",
        isOpen ? "translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
  const trigger = (
    // Plated like everything beside it, so the folded triggers stand level
    // with the undo/redo plate on the same line.
    <ToolTray>
      <button
        type="button"
        onClick={() => onToggle(id)}
        // Folded, the trigger IS the toolbar as far as a guided tour is
        // concerned: the row above is still in the DOM, invisible, and the tour
        // skips invisible anchors, so a phone gets a ring around this button
        // instead of one around empty board.
        data-tour-anchor={id}
        aria-expanded={isOpen}
        aria-label={isOpen ? `Hide ${label}` : `Show ${label}`}
        title={isOpen ? `Hide ${label}` : label}
        className={[
          "pointer-events-auto relative z-10 flex h-9 w-9 shrink-0 items-center justify-center border-2 border-[var(--mc-15)]",
          isOpen ? TOOL_FACE_ON : TOOL_FACE_OFF,
        ].join(" ")}
      >
        <Icon className="h-4 w-4" />
      </button>
    </ToolTray>
  );

  return side === "left" ? (
    <>
      {trigger}
      {row}
    </>
  ) : (
    <>
      {row}
      {trigger}
    </>
  );
}

const SmartViewToolbar = memo(function SmartViewToolbar({
  glanceMode,
  onModeChange,
  onFitView,
}: {
  glanceMode: BoardView["glanceMode"];
  /** Status brings the heatmap with it and drops the paint brush. */
  onModeChange: (mode: GlanceMode) => void;
  /** Zoom out until the whole plan is on screen, and centre it. */
  onFitView: () => void;
}) {
  const buttonClass = (active: boolean) =>
    [
      "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
      active ? TOOL_FACE_ON : TOOL_FACE_OFF,
    ].join(" ");

  return (
    // bottom-3 since the attribution badge left this corner.
    <div
      data-help-anchor="glance"
      className="nodrag pointer-events-none absolute bottom-3 right-3 z-20 flex items-start gap-2"
    >
      {/* On its own plate: this one moves the camera, the pair beside it
          change what every card shows. */}
      <ToolTray>
        <button
          type="button"
          onClick={onFitView}
          className={buttonClass(false)}
          title="Fit the whole plan on the screen"
          aria-label="Fit the plan on the screen"
        >
          <Focus className="h-4 w-4" />
        </button>
      </ToolTray>
      <ToolTray>
        <button
          type="button"
          onClick={() => onModeChange("identity")}
          className={buttonClass(glanceMode === "identity")}
          title="Cards show what they are: their own colours up close, the machine icon zoomed out. Hover a card for its rates."
          aria-label="Show machines"
          aria-pressed={glanceMode === "identity"}
        >
          <Box className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onModeChange("status")}
          className={buttonClass(glanceMode === "status")}
          title="Cards show how hard they run: heat colours up close (red = idle, green = full), percentages zoomed out, and hovering one maps the board by wire distance."
          aria-label="Show usage"
          aria-pressed={glanceMode === "status"}
        >
          <Gauge className="h-4 w-4" />
        </button>
      </ToolTray>
    </div>
  );
});

/**
 * Board tools that drop in source-style nodes (things that produce without
 * crafting, like crop farms). Lives top-left, mirroring the paint toolbar.
 */
const RATE_UNIT_CHOICES: Array<{ unit: RateUnit; label: string; title: string }> = [
  { unit: "tick", label: "/t", title: "Show all rates per tick, the game's own unit: 20 ticks a second" },
  { unit: "second", label: "/s", title: "Show all rates per second" },
  { unit: "minute", label: "/m", title: "Show all rates per minute" },
  { unit: "hour", label: "/h", title: "Show all rates per hour" },
];

const SourceToolbar = memo(function SourceToolbar({
  compact,
  openGroup,
  onToggleGroup,
  shiftedDown,
}: {
  compact: boolean;
  openGroup?: ToolGroupId;
  onToggleGroup: (group: ToolGroupId | undefined) => void;
  /** A banner has the top line: step down one. */
  shiftedDown: boolean;
}) {
  const addCropFarmNode = useFactoryStore((state) => state.addCropFarmNode);
  const addTrashNode = useFactoryStore((state) => state.addTrashNode);
  const addCustomRateNode = useFactoryStore((state) => state.addCustomRateNode);
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const setRateUnit = useFactoryStore((state) => state.setRateUnit);
  const assumeBoundaries = useFactoryStore((state) => Boolean(state.project.assumeBoundaries));
  const setAssumeBoundaries = useFactoryStore((state) => state.setAssumeBoundaries);
  // Subscribe to the DEPTHS, not the history arrays: a selector returning the
  // array itself would re-render this toolbar on every project edit.
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const canUndo = useFactoryStore((state) => state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.redoHistory.length > 0);
  const [isWizardOpen, setWizardOpen] = useState(false);
  const historyButtonClass = (enabled: boolean) =>
    [
      "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
      enabled ? "hover:brightness-110" : "cursor-not-allowed opacity-40",
    ].join(" ");

  return (
    <div
      data-board-toolbar
      data-help-anchor="build"
      className={[
        "nodrag pointer-events-none absolute left-3 z-20 flex items-start gap-2",
        // Inside a pocket the breadcrumb takes the top line and every trigger row
        // steps down to make room; its fold-out follows, since that is positioned
        // against this root.
        shiftedDown ? "top-14" : "top-3",
      ].join(" ")}
    >
      {/* History first, and set apart on its own plate: it undoes everything
          the rest of the board does, so it belongs to no other group. */}
      <ToolTray>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className={historyButtonClass(canUndo)}
          title={canUndo ? "Undo (Ctrl+Z)" : "Nothing to undo"}
          aria-label="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          className={historyButtonClass(canRedo)}
          title={canRedo ? "Redo (Ctrl+Shift+Z)" : "Nothing to redo"}
          aria-label="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>
      </ToolTray>
      {/* Undo and redo stay out in the open even on a phone: they are the two
          buttons a mistake sends you looking for, and a mistake is not the
          moment to go hunting through a fold-out. */}
      <ToolGroup
        id="build"
        compact={compact}
        openGroup={openGroup}
        onToggle={onToggleGroup}
        icon={Hammer}
        label="build tools"
        side="left"
      >
      {/* How the numbers read: the rate units and sketch mode change what the
          existing board says, so they sit nearest the history plate... */}
      <ToolTray>
        <div className="pointer-events-auto flex">
          {RATE_UNIT_CHOICES.map((choice) => (
            <button
              key={choice.unit}
              type="button"
              onClick={() => setRateUnit(choice.unit)}
              title={choice.title}
              aria-pressed={rateUnit === choice.unit}
              className={[
                "flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] font-mono text-[12px] font-black",
                rateUnit === choice.unit ? TOOL_FACE_ON : TOOL_FACE_OFF,
              ].join(" ")}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-tour-anchor="sketch"
          onClick={() => setAssumeBoundaries(!assumeBoundaries)}
          className={[
            "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
            assumeBoundaries ? TOOL_FACE_ON : TOOL_FACE_OFF,
          ].join(" ")}
          title="Sketch mode: every unwired input is supplied for free and every unwired output is exported. Quick math without drawing the boundary. Anything you do wire still behaves as wired."
          aria-label="Sketch mode"
          aria-pressed={assumeBoundaries}
        >
          <Wand2 className="h-4 w-4" />
        </button>
      </ToolTray>
      {/* ...while the plate on the right is the one that puts new cards down. */}
      <ToolTray>
        <button
          type="button"
          onClick={addCropFarmNode}
          className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
          title="Add crop farm: pick a crop and its stats. It produces at the computed rate"
          aria-label="Add crop farm"
        >
          <Sprout className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={addTrashNode}
          className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
          title="Add trash can: wire any output into it. Whatever flows in is voided and never shows as an output"
          aria-label="Add trash can"
        >
          <Trash className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={addCustomRateNode}
          className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
          title="Add custom rate node: wire it to any port and dial a rate. It supplies the resource, or flips to a constant request drain"
          aria-label="Add custom rate node"
        >
          <Gauge className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
          title="What can I make? Pick your roots (veins, bees, crops, anything you have) and place a whole production chain, prewired"
          aria-label="What can I make?"
        >
          <Compass className="h-4 w-4" />
        </button>
      </ToolTray>
      </ToolGroup>
      <ReachabilityWizard open={isWizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
});

/**
 * The board's marching dashes, on one canvas.
 *
 * Sits inside the viewport (so it shares the edge layer's stacking context)
 * but counter-scales itself back to screen resolution, so the dashes are drawn
 * at device pixels at every zoom instead of being a bitmap the browser
 * stretches. The canvas covers exactly the visible rectangle, so its cost is
 * a function of the window, not of the plan: a 10,000-edge board draws the
 * same number of pixels as a 10-edge one.
 *
 * It reads the viewport transform out of the store on each frame rather than
 * subscribing to it — a subscription here would re-render this component on
 * every pan frame, which is the thing the whole layer exists to avoid.
 */
const EdgePulseCanvas = memo(function EdgePulseCanvas({
  edgesUnderNodes,
}: {
  /** Thickness mode: cards sit ON the pipes, so the dashes stop at them. */
  edgesUnderNodes: boolean;
}) {
  // Held in state, not a ref, so the draw loop starts on the render where the
  // element actually exists.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const flowStore = useStoreApi();
  // Read inside the loop rather than baked into it, so toggling thickness mode
  // does not tear down and restart the animation.
  const edgesUnderNodesRef = useRef(edgesUnderNodes);
  useEffect(() => {
    edgesUnderNodesRef.current = edgesUnderNodes;
  }, [edgesUnderNodes]);

  useEffect(() => {
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let frame = 0;
    let backingWidth = 0;
    let backingHeight = 0;
    // The pane is what the canvas has to cover. Measured from the DOM rather
    // than read from the store's width/height, which are only populated once
    // React Flow's own observer has fired and would leave the layer blank
    // until then.
    const pane =
      canvas.closest<HTMLElement>(".react-flow") ??
      (typeof document !== "undefined"
        ? document.querySelector<HTMLElement>(".react-flow")
        : null);
    let width = pane?.clientWidth ?? 0;
    let height = pane?.clientHeight ?? 0;
    const observer =
      pane && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            width = pane.clientWidth;
            height = pane.clientHeight;
          })
        : undefined;
    observer?.observe(pane!);

    const draw = (timeMs: number) => {
      frame = window.requestAnimationFrame(draw);
      const [translateX, translateY, zoom] = flowStore.getState().transform;
      if (width <= 0 || height <= 0 || zoom <= 0) {
        return;
      }

      const ratio = window.devicePixelRatio || 1;
      const nextBackingWidth = Math.round(width * ratio);
      const nextBackingHeight = Math.round(height * ratio);
      if (backingWidth !== nextBackingWidth || backingHeight !== nextBackingHeight) {
        backingWidth = nextBackingWidth;
        backingHeight = nextBackingHeight;
        canvas.width = nextBackingWidth;
        canvas.height = nextBackingHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (edgePulseCount() === 0) {
        return;
      }

      // From here the context speaks flow coordinates, exactly like the SVG.
      context.translate(translateX, translateY);
      context.scale(zoom, zoom);
      const visible = {
        left: -translateX / zoom,
        top: -translateY / zoom,
        right: (-translateX + width) / zoom,
        bottom: (-translateY + height) / zoom,
      };
      // Value motion read per frame, not baked into the loop: flipping the
      // toggle changes how the dashes accelerate without restarting them.
      drawEdgePulses(context, visible, timeMs / 1000, readBoardMotionSnapshot().valueMotion);
      // Punch back out what the dashes are supposed to be behind.
      // `publishedBoardBounds` is the card set already — it excludes
      // annotations, which wires (and so their dashes) legitimately pass
      // straight over. During a drag the whole nodes layer rides above the
      // wires, so EVERY card occludes — and the held cards' rects come from
      // React Flow live (published geometry mid-drag is at best one live-drag
      // beat behind on a small board, and frozen at the drag's start on a
      // big one).
      const dragging = activelyDraggedNodeIds.size > 0;
      let occlusionBounds: Array<{
        left: number;
        top: number;
        right: number;
        bottom: number;
      }> = [];
      if (edgesUnderNodesRef.current || dragging) {
        for (const entry of publishedBoardBounds ?? []) {
          if (dragging && activelyDraggedNodeIds.has(entry.id)) {
            continue;
          }
          // The tab zone at a card's top is transparent canvas and the wire
          // stub visibly crosses it — the dashes must ride the stub all the
          // way to the window's edge, so only the WINDOW occludes.
          const dockInset = getDockTopInset(entry.id);
          occlusionBounds.push(
            dockInset > 0 ? { ...entry.bounds, top: entry.bounds.top + dockInset } : entry.bounds,
          );
        }
        if (dragging) {
          const nodeLookup = flowStore.getState().nodeLookup;
          for (const draggedId of activelyDraggedNodeIds) {
            const draggedNode = nodeLookup?.get(draggedId);
            if (!draggedNode) {
              continue;
            }
            const position =
              draggedNode.internals?.positionAbsolute ?? draggedNode.position;
            const nodeWidth = draggedNode.measured?.width ?? 0;
            const nodeHeight = draggedNode.measured?.height ?? 0;
            if (nodeWidth > 0 && nodeHeight > 0) {
              occlusionBounds.push({
                left: position.x,
                top: position.y + getDockTopInset(draggedId),
                right: position.x + nodeWidth,
                bottom: position.y + nodeHeight,
              });
            }
          }
        }
      }
      eraseEdgePulseOcclusion(context, visible, occlusionBounds);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [canvas, flowStore]);

  // Deliberately NOT inside the viewport: it is the last thing painted in the
  // board, which is what keeps it from promoting every node and label above it
  // into its own composited layer. It draws in screen space and applies the
  // viewport transform itself, so it stays pixel-crisp at every zoom.
  return (
    <canvas
      ref={setCanvas}
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      style={{ zIndex: 5 }}
    />
  );
});

/**
 * The single owner of the board's zoom-detail level.
 *
 * Renders nothing and re-renders nothing: it watches the store's transform,
 * publishes the level for edges to subscribe to, and stamps it on the board
 * element. Routing this through React state would re-render FactoryFlow — and
 * with it the whole board — on every threshold crossing, to change one
 * attribute.
 *
 * A data ATTRIBUTE rather than a class, deliberately. React owns `className` on
 * the board and rebuilds that string on every FactoryFlow render, so a class
 * added here was silently wiped whenever anything else about the board changed
 * — toggling thickness mode mid-zoom dropped the glance view until the next
 * threshold crossing. React never touches an attribute it was not given.
 */
const NodeDetailController = memo(function NodeDetailController({
  boardRef,
}: {
  boardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const flowStore = useStoreApi();

  useEffect(() => {
    let level: NodeDetailLevel = NODE_DETAIL_FULL;
    let publishedZoom = 0;

    // The live zoom, as a custom property on the board. The identity glance's
    // hover popup divides by it to render at SCREEN size regardless of how
    // far out the board is — the one place flow-space sizing is wrong, because
    // the popup is read, not routed. Rounded so pinch jitter does not spam
    // style invalidations.
    const publishZoom = (zoom: number) => {
      if (!Number.isFinite(zoom) || zoom <= 0) {
        return;
      }
      const rounded = Math.round(zoom * 500) / 500;
      if (rounded === publishedZoom) {
        return;
      }
      publishedZoom = rounded;
      boardRef.current?.style.setProperty("--board-zoom", String(rounded));
    };

    const apply = (zoom: number) => {
      publishZoom(zoom);
      const next = getNodeDetailLevel(zoom, level);
      if (next === level) {
        return;
      }
      level = next;
      setNodeDetailLevel(next);
      // The hop map only exists at the glance step. Zooming back in has to take
      // it with it, or a card would come back to full detail wearing a colour
      // that means nothing at that size.
      if (next === NODE_DETAIL_FULL) {
        clearHopMap();
      }
      const board = boardRef.current;
      if (!board) {
        return;
      }
      const value = nodeDetailAttributeValue(next);
      if (value) {
        board.setAttribute(NODE_DETAIL_ATTRIBUTE, value);
      } else {
        board.removeAttribute(NODE_DETAIL_ATTRIBUTE);
      }
    };

    apply(flowStore.getState().transform[2]);
    return flowStore.subscribe((state) => {
      apply(state.transform[2]);
    });
  }, [boardRef, flowStore]);

  return null;
});

/**
 * Owns the hop map: what the pointer is resting on, and when to paint from it.
 *
 * NOT React Flow's `onNodeMouseEnter`, which is where this feature first went
 * and where it did not work. While the board is being panned or zoomed the
 * whole nodes layer is `pointer-events: none` (globals.css), so the natural
 * gesture — wheel out until the cards go to glance, then look at the one under
 * the cursor — produces no node-enter event at all: the pointer entered the
 * card before the zoom, when there was nothing to map, and it never crosses a
 * node boundary again afterwards. The board sat there doing nothing.
 *
 * A plain `mousemove` plus a hit-test asks the question the right way round:
 * not "did you cross into a card" but "what are you on now". Every nudge of the
 * hand re-arms it, so the map appears whatever order the zooming and the moving
 * happened in. It is also what gives the settle for free — each move restarts
 * the timer, so it only fires once the pointer has actually stopped, and
 * sweeping across the board maps nothing on the way.
 *
 * Glance state is read from the board's own attribute rather than from
 * node-detail's published level. Same value, but it is the one thing here that
 * is provably in force: it is what CSS is using to draw the glance view.
 *
 * The short wait before painting is per CARD — see `pendingId` below for why
 * that distinction is the difference between "instant" and "sluggish".
 */
const HopMapController = memo(function HopMapController({
  boardRef,
}: {
  boardRef: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }
    const unregister = registerHopMapBoard(board);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingId: string | undefined;

    const cancel = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pendingId = undefined;
      clearHopMap();
    };

    const handleMove = (event: MouseEvent) => {
      const target = event.target;
      const nodeElement =
        target instanceof Element ? target.closest(".react-flow__node") : undefined;
      const nodeId = nodeElement?.getAttribute("data-id");
      // A held wire owns the board; distance from the card under it is not the
      // question being asked.
      if (isWiringConnection()) {
        cancel();
        return;
      }
      if (!nodeId || board.getAttribute(NODE_DETAIL_ATTRIBUTE) !== "glance") {
        cancel();
        return;
      }
      // The distance map belongs to the STATUS smart view; in identity mode
      // hover means "show me this card's rates" and the map would paint over
      // the answer. Read live off the board attribute, like the glance state.
      if (board.getAttribute("data-glance-mode") !== "status") {
        cancel();
        return;
      }
      if (getHopMapHubId() === nodeId || pendingId === nodeId) {
        // Already the hub, or already on its way. The wait is per CARD, not per
        // movement: a hand resting on a card still sends a mousemove every few
        // milliseconds, and restarting the clock on each one meant the map only
        // appeared once you went perfectly still — which reads as the board
        // taking about a second to think about it. Landing on the card starts
        // the clock exactly once, and jitter on top of it changes nothing.
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      pendingId = nodeId;
      timer = setTimeout(() => {
        timer = undefined;
        pendingId = undefined;
        const { edges, storages } = useFactoryStore.getState().project;
        // Drawers, tanks and buffers are handed over as pass-through: a machine
        // feeding another THROUGH one of them is one step away, not two.
        setHopMapHub(nodeId, edges, new Set((storages ?? []).map((storage) => storage.id)));
      }, HOP_MAP_SETTLE_MS);
    };

    board.addEventListener("mousemove", handleMove);
    board.addEventListener("mouseleave", cancel);
    return () => {
      board.removeEventListener("mousemove", handleMove);
      board.removeEventListener("mouseleave", cancel);
      cancel();
      unregister();
    };
  }, [boardRef]);

  return null;
});

/**
 * What the colours mean while a hop map is up.
 *
 * Colour alone can say "near" and "far", but not "three wires". The legend is
 * what turns the map from an impression into a number you can count along, and
 * it costs nothing when no card is hovered: it subscribes to the map's hub, so
 * with no map it renders null and never hears from the pointer again.
 *
 * Long chains get a continuous bar instead of a chip per hop — twenty chips is
 * a wall, and past a certain depth the exact number stops being the question.
 */
const HOP_LEGEND_MAX_CHIPS = 9;

const CHIP_CLASS =
  "flex h-8 w-8 items-center justify-center border-2 border-black/60 text-[15px] font-black leading-none";

/**
 * How long the pointer has to be ON a card before the map appears.
 *
 * Long enough that crossing the board on the way somewhere else maps nothing,
 * short enough to feel like the card answered rather than considered it. The
 * clock starts when you arrive on the card and is not restarted by moving
 * around on it.
 */
const HOP_MAP_SETTLE_MS = 90;

const HopMapLegend = memo(function HopMapLegend() {
  const map = useHopMapSummary();
  // Any map at all gets a key, including a card wired to nothing (maxDepth 0).
  // It used to bail in that case, which meant the one board state where the
  // colours are hardest to interpret — a lone card and a field of grey — was
  // also the one with nothing explaining them.
  if (!map) {
    return null;
  }
  const chipped = map.maxDepth <= HOP_LEGEND_MAX_CHIPS;
  const depths = chipped
    ? Array.from({ length: map.maxDepth }, (_, index) => index + 1)
    : [1, Math.round(map.maxDepth / 2), map.maxDepth];
  const hubChip = (
    <span
      className={CHIP_CLASS}
      style={{ backgroundColor: hopFill(0, map.maxDepth), color: hopInk(0, map.maxDepth) }}
    >
      0
    </span>
  );

  return (
    <div
      data-board-toolbar
      aria-hidden
      // z-40, above every node: a card's z-index is lifted on hover and while a
      // picker is open, and the legend must not end up underneath whichever
      // card happens to sit in that corner of a dense board.
      //
      // bottom-16 leaves the corner itself to the view buttons, which this used
      // to sit right on top of.
      className="nodrag pointer-events-none absolute bottom-16 right-3 z-40 flex flex-col gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] px-3 py-2.5 font-mono font-bold text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.35)]"
    >
      <span className="text-[13px] uppercase tracking-[1px]">Hops needed</span>
      {chipped ? (
        <div className="flex items-center gap-1.5">
          {/* The hub sits in the row like any other step, and says 0, because
              that is what the card under the cursor is showing. */}
          {hubChip}
          {depths.map((depth) => (
            <span
              key={depth}
              className={CHIP_CLASS}
              style={{
                backgroundColor: hopFill(depth, map.maxDepth),
                // The far end of the ramp is nearly black; a fixed dark digit on
                // it is unreadable, so each chip picks its own ink the same way
                // the cards do.
                color: hopInk(depth, map.maxDepth),
              }}
            >
              {depth}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {hubChip}
          <span
            className="h-8 w-40 border-2 border-black/60"
            style={{
              backgroundImage: `linear-gradient(to right, ${depths
                .map((depth) => hopFill(depth, map.maxDepth))
                .join(", ")})`,
            }}
          />
          <span className="text-[15px]">{map.maxDepth}</span>
        </div>
      )}
    </div>
  );
});

function FlowLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-neutral-950/18 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] px-4 py-3 text-sm font-semibold text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.18)]">
        <LoaderCircle className="h-5 w-5 animate-spin" />
        <span>Loading flowchart...</span>
      </div>
    </div>
  );
}

function AnnotationDraftPreview({
  tool,
  draft,
  swatch,
}: {
  tool: FactoryAnnotationKind;
  draft: AnnotationDraft;
  swatch: string;
}) {
  // The zone spans its clicked corners plus the cursor; everything else
  // spans start-to-end.
  const spanned = tool === "zone" ? [...draft.trail, draft.end] : [draft.start, draft.end];
  const x = Math.min(...spanned.map((point) => point.x));
  const y = Math.min(...spanned.map((point) => point.y));
  const width = Math.max(Math.max(...spanned.map((point) => point.x)) - x, 2);
  const height = Math.max(Math.max(...spanned.map((point) => point.y)) - y, 2);

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute"
        style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      >
        {/* Drawn solid, exactly as it will land: a shape that changes clothes
            the moment you let go reads as two different things. */}
        {tool === "zone" ? (
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            {/* The filled loop closes itself under the corners already placed
                and the edge still following the cursor, so "click the first
                corner and it becomes a shape" is visible before it happens. */}
            <path
              d={`${[...draft.trail, draft.end]
                .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x - x} ${point.y - y}`)
                .join(" ")} Z`}
              fill={`${swatch}14`}
              stroke="none"
            />
            <path
              d={[...draft.trail, draft.end]
                .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x - x} ${point.y - y}`)
                .join(" ")}
              fill="none"
              stroke={swatch}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* The first corner is the door out: click it to close the loop. */}
            <rect
              x={draft.trail[0].x - x - 6}
              y={draft.trail[0].y - y - 6}
              width={12}
              height={12}
              fill={swatch}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={2}
            />
          </svg>
        ) : tool === "arrow" ? (
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            <line
              x1={draft.start.x - x}
              y1={draft.start.y - y}
              x2={draft.end.x - x}
              y2={draft.end.y - y}
              stroke={swatch}
              strokeWidth={5}
              strokeLinecap="round"
            />
          </svg>
        ) : tool === "box" ? (
          <div
            className="h-full w-full border-4"
            style={{ borderColor: swatch, backgroundColor: `${swatch}14` }}
          />
        ) : (
          <div
            className="h-full w-full border-2"
            style={{
              borderColor: swatch,
              backgroundColor: "var(--mc-78)",
              backgroundImage: `linear-gradient(${swatch}33, ${swatch}33)`,
              opacity: 0.85,
            }}
          />
        )}
      </div>
    </ViewportPortal>
  );
}

/**
 * The picture door: a hidden file input behind a toolbar button. No draw
 * mode - picking a file IS the gesture - and the button itself spins while
 * the upload is out, since that is the one wait with a server in it.
 */
function AddImageButton({ onPlaceImage }: { onPlaceImage: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice still fires onChange.
          event.target.value = "";
          if (!file) {
            return;
          }
          setBusy(true);
          try {
            await onPlaceImage(file);
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={[
          "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
          TOOL_FACE_OFF,
          busy ? "cursor-wait opacity-70" : "",
        ].join(" ")}
        title="Add an image: pick a picture and it lands on the board"
        aria-label="Add an image"
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <ImagePlus className="h-4 w-4" />
        )}
      </button>
    </>
  );
}

const ANNOTATION_TOOLS: Array<{
  kind: FactoryAnnotationKind;
  label: string;
  Icon: typeof Square;
}> = [
  { kind: "box", label: "Draw box", Icon: Square },
  { kind: "zone", label: "Draw zone: click its corners, then click the first one to close", Icon: Hexagon },
  { kind: "arrow", label: "Draw arrow", Icon: MoveUpRight },
  { kind: "text", label: "Add text note", Icon: Type },
];

/** A theme row's little preview: its paper, its texture, three of its dots. */
function ThemeSwatch({ theme }: { theme: CanvasTheme }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-11 shrink-0 items-center justify-center gap-1 border border-[var(--mc-15)]"
      style={{ backgroundColor: theme.base, backgroundImage: theme.texture }}
    >
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="h-[3px] w-[3px]" style={{ backgroundColor: theme.patternColor }} />
      ))}
    </span>
  );
}

// Memoized because FactoryFlow re-renders every frame of a node drag; with
// stable callbacks this toolbar renders only when a tool or colour changes.
/**
 * Board VIEW controls, deliberately set apart from the paint and annotation
 * tools above them. Those change the plan; these only change how you look at
 * it, and mixing the two in one strip made "does this edit my factory?" a
 * question you had to answer per button.
 */
const BoardViewToolbar = memo(function BoardViewToolbar({
  view,
  onChange,
  dockToggleWarning,
  compact,
  openGroup,
  onToggleGroup,
  shiftedDown,
}: {
  view: BoardView;
  onChange: (patch: Partial<BoardView>) => void;
  /** One-line caution before the dock flip rewires a big or dotted board. */
  dockToggleWarning?: string;
  compact: boolean;
  openGroup?: ToolGroupId;
  onToggleGroup: (group: ToolGroupId | undefined) => void;
  shiftedDown: boolean;
}) {
  const {
    canvasPattern,
    freeDockMode,
    lineHeatMode,
    lineLabelsMode,
    lineThicknessMode,
    linePulseMode,
    calmMode,
  } = view;
  const PatternIcon =
    canvasPattern === "lines"
      ? Grid3x3
      : canvasPattern === "cross"
        ? Plus
        : canvasPattern === "ruled"
          ? AlignJustify
          : canvasPattern === "graph"
            ? Grid2x2
            : canvasPattern === "none"
              ? Ban
              : Grip;
  const buttonClass = (active: boolean) =>
    [
      "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
      active ? TOOL_FACE_ON : TOOL_FACE_OFF,
    ].join(" ");
  // Motion is device taste, not plan state: read and written through its own
  // store (board-motion.tsx), never through the plan-view snapshot.
  const boardMotion = useBoardMotion();
  const activeTheme = getCanvasTheme(view.canvasTheme);
  // The theme picker opens on hover with the same grace period the paint
  // palette uses, so the two feel like one family of fold-outs.
  const [isThemePickerOpen, setThemePickerOpen] = useState(false);
  const themeCloseTimerRef = useRef<number | undefined>(undefined);
  const openThemePicker = () => {
    window.clearTimeout(themeCloseTimerRef.current);
    setThemePickerOpen(true);
  };
  const scheduleCloseThemePicker = () => {
    window.clearTimeout(themeCloseTimerRef.current);
    themeCloseTimerRef.current = window.setTimeout(() => setThemePickerOpen(false), 250);
  };

  return (
    <div
      data-board-toolbar
      // top-16, not top-3: a clear gap below the editing tools is the whole
      // point of the grouping.
      data-help-anchor="view"
      className={[
        "nodrag pointer-events-none absolute flex items-start gap-1",
        // Lifted while the theme list is out so it cannot be painted over by
        // a later toolbar - the same trap the paint palette fell into once.
        isThemePickerOpen ? "z-40" : "z-20",
        // Folded, this is one button, and it joins the paint trigger on the top
        // line rather than holding a line of its own below it — which also keeps
        // both fold-out rows on the same clear second line.
        compact ? (shiftedDown ? "right-14 top-14" : "right-14 top-3") : "right-3 top-16",
      ].join(" ")}
    >
      <ToolGroup
        id="view"
        compact={compact}
        openGroup={openGroup}
        onToggle={onToggleGroup}
        icon={Eye}
        label="view options"
        side="right"
      >
      {/* One plate: every button here changes how the board is DRAWN, never
          what the plan is. */}
      <ToolTray>
      <div
        className="flex items-start"
        onMouseEnter={openThemePicker}
        onMouseLeave={scheduleCloseThemePicker}
      >
        <div
          className={[
            // Hangs below the row like the paint palette, absolute against
            // the toolbar root so it never widens the plate it lives in.
            "absolute right-0 w-[184px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] transition-[opacity,transform] duration-100",
            compact ? "top-[6.5rem]" : "top-[3.25rem]",
            isThemePickerOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-1 opacity-0",
          ].join(" ")}
        >
          <div className="grid gap-1">
            {CANVAS_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => onChange({ canvasTheme: theme.id })}
                className={[
                  "flex items-center gap-2 border-2 p-1 text-left",
                  view.canvasTheme === theme.id
                    ? "border-white bg-[var(--mc-85)] ring-2 ring-cyan-300"
                    : "border-[var(--mc-15)] bg-[var(--mc-49)] hover:bg-[var(--mc-61)]",
                ].join(" ")}
                aria-label={`Background style: ${theme.name}`}
                aria-pressed={view.canvasTheme === theme.id}
              >
                <ThemeSwatch theme={theme} />
                <span className="min-w-0 truncate text-[11px] font-semibold leading-tight text-[var(--mc-ink)]">
                  {theme.name}
                </span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setThemePickerOpen((open) => !open)}
          className={buttonClass(isThemePickerOpen)}
          title={`Background style: ${activeTheme.name}. Click to choose another.`}
          aria-label="Choose background style"
        >
          <Wallpaper className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={() =>
          onChange({
            canvasPattern:
              CANVAS_PATTERNS[
                (CANVAS_PATTERNS.indexOf(canvasPattern) + 1) % CANVAS_PATTERNS.length
              ],
          })
        }
        className={buttonClass(false)}
        title={`${CANVAS_PATTERN_LABEL[canvasPattern]}: click to change`}
        aria-label={CANVAS_PATTERN_LABEL[canvasPattern]}
      >
        <PatternIcon className="h-4 w-4" />
      </button>
      {/* No grid-lock button any more. The grid is not a mode: every card is
          built out of whole cells and every position is a cell corner, so
          there is nothing left for a toggle to mean. */}
      {/* No heatmap button either: the heat rides the status smart view (the
          gauge button, bottom right), so "show me usage" is one mode at
          every zoom rather than two toggles to keep in sync. */}
      {/* The three line modes, independent and mixable. Volume is always
          ranked within a kind, items against items and fluids against fluids. */}
      <button
        type="button"
        onClick={() => onChange({ lineHeatMode: !lineHeatMode })}
        className={buttonClass(lineHeatMode)}
        title={
          lineHeatMode
            ? "Line colour: by volume. Click to restore resource colours."
            : "Colour every line by how much moves through it (red = least, green = most)"
        }
        aria-label={lineHeatMode ? "Turn line colour off" : "Colour lines by volume"}
        aria-pressed={lineHeatMode}
      >
        <Palette className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ lineThicknessMode: !lineThicknessMode })}
        className={buttonClass(lineThicknessMode)}
        title={
          lineThicknessMode
            ? "Line thickness: by volume. Click to restore normal widths."
            : "Thicken every line by how much moves through it"
        }
        aria-label={lineThicknessMode ? "Turn line thickness off" : "Thicken lines by volume"}
        aria-pressed={lineThicknessMode}
      >
        <Cable className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ linePulseMode: !linePulseMode })}
        className={buttonClass(linePulseMode)}
        title={
          linePulseMode
            ? "Moving dashes: on. Click to stop them."
            : "Show which way each line flows, with dashes that march faster on busier lines"
        }
        aria-label={linePulseMode ? "Stop the moving dashes" : "Show moving dashes"}
        aria-pressed={linePulseMode}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ lineLabelsMode: !lineLabelsMode })}
        className={buttonClass(lineLabelsMode)}
        title={
          lineLabelsMode
            ? "Line labels: on. Click to hide the rate pills."
            : "Show what each line carries and how fast, as a pill on the line"
        }
        aria-label={lineLabelsMode ? "Hide line labels" : "Show line labels"}
        aria-pressed={lineLabelsMode}
      >
        <Tag className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (dockToggleWarning && !window.confirm(dockToggleWarning)) {
            return;
          }
          onChange({ freeDockMode: !freeDockMode });
        }}
        className={buttonClass(freeDockMode)}
        title={
          freeDockMode
            ? "Free docking: wires attach wherever routes best. Click to pin them to their ports."
            : "Port docking: wires attach at their ports. Click to let them attach anywhere."
        }
        aria-label={freeDockMode ? "Pin wires to their ports" : "Let wires attach anywhere"}
        aria-pressed={freeDockMode}
      >
        <Anchor className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ calmMode: !calmMode })}
        className={buttonClass(calmMode)}
        title={
          calmMode
            ? "Calm colours on. The board still names every problem, without the alarm reds and greens. Click to bring them back."
            : "Calm the colours: keep every readout but drop the alarm reds, ambers and greens. Made for presenting a plan"
        }
        aria-label={calmMode ? "Turn calm colours off" : "Turn calm colours on"}
        aria-pressed={calmMode}
      >
        <Presentation className="h-4 w-4" />
      </button>
      {/* The two motion switches. Device taste rather than plan dressing, so
          they write to their own store and never travel with a shared plan. */}
      <button
        type="button"
        onClick={() => writeBoardMotion({ moveMotion: !boardMotion.moveMotion })}
        className={buttonClass(boardMotion.moveMotion)}
        title={
          boardMotion.moveMotion
            ? "Smooth movement: cards glide onto the grid and rerouted wires slide to their new line. Click for instant."
            : "Instant movement. Click to let cards glide onto the grid and wires slide to their new lines."
        }
        aria-label={boardMotion.moveMotion ? "Turn smooth movement off" : "Turn smooth movement on"}
        aria-pressed={boardMotion.moveMotion}
      >
        <Magnet className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => writeBoardMotion({ valueMotion: !boardMotion.valueMotion })}
        className={buttonClass(boardMotion.valueMotion)}
        title={
          boardMotion.valueMotion
            ? "Live numbers: rates, bars, line widths and dash speeds ease into new values. Click for instant."
            : "Instant numbers. Click to let rates, bars, line widths and dash speeds ease into new values."
        }
        aria-label={boardMotion.valueMotion ? "Turn live numbers off" : "Turn live numbers on"}
        aria-pressed={boardMotion.valueMotion}
      >
        <Activity className="h-4 w-4" />
      </button>
      </ToolTray>
      </ToolGroup>
    </div>
  );
});

const PaintToolbar = memo(function PaintToolbar({
  paintMode,
  onPaintModeChange,
  activeColorTag,
  onColorSelect,
  annotationTool,
  onAnnotationToolChange,
  onPlaceImage,
  isDeleteMode,
  onDeleteModeChange,
  compact,
  openGroup,
  onToggleGroup,
  shiftedDown,
}: {
  paintMode?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
  activeColorTag: FactoryNodeColorTag;
  onColorSelect: (tag: FactoryNodeColorTag) => void;
  annotationTool?: FactoryAnnotationKind;
  onAnnotationToolChange: (tool: FactoryAnnotationKind | undefined) => void;
  onPlaceImage: (file: File) => Promise<void>;
  isDeleteMode: boolean;
  onDeleteModeChange: (enabled: boolean) => void;
  compact: boolean;
  openGroup?: ToolGroupId;
  onToggleGroup: (group: ToolGroupId | undefined) => void;
  shiftedDown: boolean;
}) {
  const activeColor = GT_NODE_COLORS[activeColorTag];
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  // A short grace period on close lets the pointer cross the tiny dead gaps
  // between the palette and the brush without the palette snapping shut.
  const paletteCloseTimerRef = useRef<number | undefined>(undefined);
  const openPalette = () => {
    window.clearTimeout(paletteCloseTimerRef.current);
    setPaletteOpen(true);
  };
  const scheduleClosePalette = () => {
    window.clearTimeout(paletteCloseTimerRef.current);
    paletteCloseTimerRef.current = window.setTimeout(() => setPaletteOpen(false), 250);
  };

  return (
    <div
      data-board-toolbar
      className={[
        "nodrag pointer-events-none absolute right-3 flex items-start gap-2",
        shiftedDown ? "top-14" : "top-3",
        // An open palette hangs below its own row and crosses the view
        // toolbar underneath. Both toolbars sit at z-20 and the view row is
        // later in the DOM, so it painted OVER the swatches and took the
        // clicks: the colours were visible and unpickable. The paint row
        // lifts above every other toolbar for as long as the palette is out.
        isPaletteOpen ? "z-40" : "z-20",
      ].join(" ")}
    >
      <ToolGroup
        id="paint"
        compact={compact}
        openGroup={openGroup}
        onToggle={onToggleGroup}
        icon={Paintbrush}
        label="paint and annotation tools"
        side="right"
      >
      <ToolTray>
      <div
        className="flex items-start"
        onMouseEnter={openPalette}
        onMouseLeave={scheduleClosePalette}
      >
      <div
        className={[
          // Nine across, two down: the whole palette reads in one glance.
          // Absolute on every width — hanging below the row rather than
          // sitting invisibly IN it, which used to keep a 296px empty layout
          // box in the row (and would now paint 296px of empty plate). The
          // paint root already lifts to z-40 while the palette is out.
          "absolute right-0 grid gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] transition-[opacity,transform] duration-100",
          // On a phone it hangs two lines down — clear of the unfolded paint
          // row on the line between — six across and three down.
          compact ? "top-[6.5rem] grid-cols-6" : "top-[3.25rem] w-[296px] grid-cols-9",
          isPaletteOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === null ? undefined : null)}
          className={[
            "flex h-7 w-7 items-center justify-center border-2 bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]",
            paintMode === null ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
          ].join(" ")}
          title="Erase colors"
          aria-label="Erase colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {GT_NODE_COLOR_PALETTE.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            onClick={() => onColorSelect(entry.tag)}
            className={[
              "h-7 w-7 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
              activeColorTag === entry.tag
                ? "border-white ring-2 ring-cyan-300"
                : "border-[var(--mc-15)]",
            ].join(" ")}
            style={{ backgroundColor: entry.color.swatch }}
            title={entry.tag}
            aria-label={`Use ${entry.tag}`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen((open) => !open)}
        // Help rings this row from the colour button to the bin: the anchor
        // sits on the visible ends, not the wrapper, so the folded-away
        // palette's empty layout box stays out of the ring.
        data-help-anchor="paint"
        className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
        title={`Color: ${activeColorTag}`}
        aria-label="Pick color"
      >
        <span
          className="h-5 w-5 border-2 border-[var(--mc-15)] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
          style={{ backgroundColor: activeColor.swatch }}
        />
      </button>
      </div>
      <button
        type="button"
        onClick={() =>
          onPaintModeChange(paintMode !== undefined ? undefined : activeColorTag)
        }
        className={[
          "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
          paintMode !== undefined ? TOOL_FACE_ON : TOOL_FACE_OFF,
        ].join(" ")}
        title={
          paintMode !== undefined
            ? "Stop painting"
            : `Paint nodes ${activeColorTag}`
        }
        aria-label={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
      >
        {paintMode === null ? <X className="h-4 w-4" /> : <Paintbrush className="h-4 w-4" />}
      </button>
      {ANNOTATION_TOOLS.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onAnnotationToolChange(annotationTool === kind ? undefined : kind)}
          className={[
            "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
            annotationTool === kind ? TOOL_FACE_ON : TOOL_FACE_OFF,
          ].join(" ")}
          title={annotationTool === kind ? "Cancel" : label}
          aria-label={annotationTool === kind ? "Cancel" : label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <AddImageButton onPlaceImage={onPlaceImage} />
      </ToolTray>
      {/* The bin on a plate of its own: it takes things OFF the board, and it
          must never read as one more stamp in the row beside it. */}
      <ToolTray>
        <button
          type="button"
          onClick={() => onDeleteModeChange(!isDeleteMode)}
          data-help-anchor="paint"
          className={[
            "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)]",
            isDeleteMode ? TOOL_FACE_ON : TOOL_FACE_OFF,
          ].join(" ")}
          title={isDeleteMode ? "Stop deleting" : "Delete tool: click anything to remove it"}
          aria-label={isDeleteMode ? "Stop deleting" : "Delete tool"}
        >
          {/* The pressed face says "on"; the red icon still says what is armed. */}
          <Trash2 className={isDeleteMode ? "h-4 w-4 text-red-500" : "h-4 w-4"} />
        </button>
      </ToolTray>
      </ToolGroup>
    </div>
  );
});

/**
 * The pill's numbers, eased: the flow figure and its percent glide to a new
 * solve on the value-motion clock. A leaf so the per-frame re-render is one
 * text fragment, not the edge. When the ratio appears or disappears the value
 * list changes length, which the tween treats as a snap — correct, because
 * there is no honest halfway between "has a percent" and "has none".
 */
function EdgeRateLabelText({ data }: { data: EdgeLabelInput | undefined }) {
  const { flowing, ratio } = getEdgeRateLabelValues(data);
  const unit = data?.unit ?? "/s";
  const hasRatio = ratio !== undefined;
  return (
    <MotionNumberText
      values={hasRatio ? [flowing, ratio] : [flowing]}
      render={(shown) =>
        formatEdgeRateLabelFrom(unit, shown[0] ?? flowing, hasRatio ? shown[1] : undefined)
      }
    />
  );
}

function ResourceEdgeComponent({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  source,
  sourceHandleId,
  targetX,
  targetY,
  targetPosition,
  target,
  targetHandleId,
  style,
  selected,
  data,
}: EdgeProps<ResourceFlowEdge>) {
  const updateEdge = useFactoryStore((state) => state.updateEdge);
  // Waypoint dot dragging: local draft while the pointer is down, committed
  // to the store (snapped to the grid) on release — the same freeze-then-
  // reconcile shape node drags use, so no board-wide re-solve runs per
  // pointer frame. While a draft exists the wire draws as simple legs
  // through the dots; the drop brings back the real grid route.
  const [draftWaypoints, setDraftWaypoints] = useState<
    Array<{ x: number; y: number }> | undefined
  >(undefined);
  const waypointDragRef = useRef<{ pointerId: number; index: number } | undefined>(undefined);
  // Double-press detection for removing a dot. A native dblclick never
  // arrives here: the first press starts a pointer-captured drag and the
  // commit re-renders the circle out from under the second click.
  const waypointPressRef = useRef<{ index: number; time: number } | undefined>(undefined);
  // The board's single detail level, not a zoom threshold of its own — nodes
  // and lines have to switch together or the board looks like it is glitching
  // half a step at a time. Subscribed rather than selected because the level is
  // hysteretic, which a React Flow selector cannot be (it must be pure over
  // store state), and because this only fires when the level actually flips.
  // Kept as two statements: a hook call nested inside another call expression
  // makes the React Compiler give up on memoizing this component, and this is
  // the hottest component on the board. Verified with eslint, not assumed.
  const boardDetailLevel = useSyncExternalStore(
    subscribeNodeDetailLevel,
    getPublishedNodeDetailLevel,
    getServerNodeDetailLevel,
  );
  const detailLevel = EDGE_DETAIL_BY_LEVEL[boardDetailLevel];
  const resourceColor = data?.resource
    ? getInitialResourceColor(data.resource)
    : (data?.color ?? DEFAULT_ITEM_EDGE_COLOR);
  // Dominant resource colours are averaged from item sprites, which makes them
  // muddy; boost saturation and lift toward white so the wire stays legible
  // against the dark canvas.
  const vividColor = saturateHexColor(resourceColor, 0.6);
  const resolvedResourceColor = brightenHexColor(vividColor, 0.2);
  // Flow mode repaints the line by volume. The stroke colour is derived HERE
  // from the resource, not read from `style`, so setting style.stroke upstream
  // did nothing at all — the ramp has to be applied at the point of use.
  const flowRate = data?.flowRate;
  const edgeColor =
    flowRate?.color === true ? flowRampColor(flowRate.heat) : resolvedResourceColor;
  // The board's motion switches. Move motion glides this wire onto a new
  // route; value motion eases its thickness and dash speed after the solver.
  const { moveMotion, valueMotion } = useBoardMotion();
  // Likewise the width: the branches below override style.strokeWidth for
  // highlighted and bundle-primary lines, which is exactly why only some lines
  // were thickening. In thickness mode the published width wins for every line.
  const flowWidthTarget =
    flowRate?.thickness === true ? Number(style?.strokeWidth ?? FLOW_MODE_MIN_WIDTH) : undefined;
  // Eased, so a solver change reads as the pipe swelling rather than as a
  // different pipe being swapped in. Only the volume width tweens: the
  // highlight thickening below stays instant, because hover feedback that
  // arrives a second late reads as a miss.
  const flowWidthShown = useMotionValue(
    flowWidthTarget ?? FLOW_MODE_MIN_WIDTH,
    valueMotion && flowWidthTarget !== undefined,
  );
  const flowWidth = flowWidthTarget === undefined ? undefined : flowWidthShown;
  // Dash geometry scales with the stroke so the marks read the same on a hair
  // line and on a fat pipe.
  const pulseStroke = flowWidth ?? Number(style?.strokeWidth ?? 3);
  const pulseDash = Math.round(Math.max(5, pulseStroke * 0.9));
  const pulseGap = Math.round(Math.max(10, pulseStroke * 1.9));
  // Speed is a real PIXELS-PER-SECOND velocity derived from volume, then
  // converted to a duration for this line's dash period. Setting the duration
  // directly made a fat line look faster than a thin one carrying the same
  // amount, because one period is further on a fat line — the width was
  // leaking into a reading that is supposed to be about flow alone.
  const pulseVelocity = PULSE_MIN_VELOCITY +
    (flowRate?.heat ?? 0) * (PULSE_MAX_VELOCITY - PULSE_MIN_VELOCITY);
  const isGlobalView = hasEdgeDetail(detailLevel, EDGE_DETAIL_GLOBAL);
  // Lit when a hovered port or label pulls this line into its flow scope.
  // Boolean selector: only involved edges re-render on hover changes.
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.edges[id]),
  );
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const isHighlighted = selected || data?.isFlowHighlighted === true || isFlowScopeLit;
  // The width this line actually draws at, resolved once. It used to be
  // written out twice — inline in the casing and again in the stroke — which
  // is how the two drifted apart in the first place.
  const coreStrokeWidth =
    flowWidth !== undefined
      ? flowWidth + (isHighlighted ? 2 : 0)
      : isHighlighted
        ? 9
        : data?.bundle?.role === "primary"
          ? Math.max(Number(style?.strokeWidth ?? 3.1) + 0.6, 3.7)
          : Number(style?.strokeWidth ?? 3.1);
  // Mid-drag, an edge whose endpoint node is moving draws its LAST solved
  // route — never a cheap pointer-chasing approximation. The old
  // follow-the-pointer preview always guessed differently from what the
  // drop's real solve produced, which read as the board lying. On a small
  // board "last solved" is now refreshed a few times a second (the live-drag
  // solve in the geometry effect), so the wires follow the card to exactly
  // where they will rest; on a big board it stays the pre-drag route until
  // the drop's publish re-signs the solve, as it always did.
  const shouldUsePreciseRouting =
    !activelyDraggedNodeIds.has(source) && !activelyDraggedNodeIds.has(target);
  const visualSourceCandidates = getSlotEdgeEndpointCandidates({
    nodeId: source,
    handleId: data?.sourceHandleId ?? sourceHandleId,
    position: sourcePosition,
    estimatedX: sourceX,
    estimatedY: sourceY,
    endpointOffset: data?.sourceEndpointOffset,
    isRecipeSlotEndpoint: data?.sourceSlotEndpoint,
    isStorageSlotEndpoint: data?.sourceStorageEndpoint,
    counterpartX: targetX,
    counterpartY: targetY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualTargetCandidates = getSlotEdgeEndpointCandidates({
    nodeId: target,
    handleId: data?.targetHandleId ?? targetHandleId,
    position: targetPosition,
    estimatedX: targetX,
    estimatedY: targetY,
    endpointOffset: data?.targetEndpointOffset,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    isStorageSlotEndpoint: data?.targetStorageEndpoint,
    counterpartX: sourceX,
    counterpartY: sourceY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualSource = visualSourceCandidates[0];
  const visualTarget = visualTargetCandidates[0];
  // Direction has one voice: the marching dashes when pulse mode is on,
  // chevrons only when it is off — and only in free-dock mode. With wires
  // pinned to their ports, which side a wire attaches on already says which
  // way it flows (inputs left, outputs right), so the chevrons are noise
  // there. Module state is safe to read here: a mode flip re-signs every
  // route and the settle pass re-issues every edge.
  const showArrowHead =
    flowRate?.pulse !== true &&
    publishedGridFreeDock &&
    (isHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_ARROWS));
  // Every wire routes individually through the board-wide grid solve — the
  // solve's lane sharing is what makes a fan-out ride as one ribbon, which
  // is the look the bundle machinery used to fake by hiding members. The
  // rate labels are gone too (pinned for a later pass): the port chips and
  // couplings already carry the numbers.
  const routedEdge = getDirectEdgePath({
    edgeId: id,
    routeIndex: data?.routeIndex ?? 0,
    sourceNodeId: source,
    sourceX: visualSource.x,
    sourceY: visualSource.y,
    sourcePosition: visualSource.side,
    targetNodeId: target,
    targetX: visualTarget.x,
    targetY: visualTarget.y,
    targetPosition: visualTarget.side,
    // Always the solved route: mid-drag this is the most recent live-drag
    // solve on a small board, or the cached pre-drag route on a big one
    // (where the signature stays frozen until the drop). The simple-L
    // fallback inside only ever covers a brand-new wire the solve has not
    // seen yet.
    useSmartRouting: true,
    strokeWidth: coreStrokeWidth,
  });
  // The route as DRAWN this frame: the router's line once settled, a morph
  // between the old and new lines for a beat after a re-solve. Mid-morph the
  // path is a plain resampled polyline — hop bumps land with the final frame,
  // exactly as they land after any solve today. Capped by wire count: a
  // board-wide re-solve morphs every mounted edge at once, each re-rendering
  // every frame for a quarter second, and past a few hundred wires that is
  // the O(edges)-per-frame bill ARCHITECTURE.md forbids — those boards snap,
  // as they always did. (Module state read here is fine; see showArrowHead.)
  const liveRoute = useMotionRoute(
    routedEdge.points,
    routedEdge.path,
    moveMotion && publishedGridRouteEdges.length <= 300,
  );
  // The dots the user has pinned — the draft while one is mid-drag. Only
  // the DOT follows the pointer; the wire holds its route and takes the
  // real one on release. Live previews always guessed wrong.
  const activeWaypoints = draftWaypoints ?? data?.waypoints;
  // Lights this line (or its whole bundle) plus both endpoint ports; shared
  // by the hover-anywhere line surface below.
  const applyEdgeFlowScope = () => {
    const scopeEdges: Record<string, true> = {};
    for (const bundleEdgeId of data?.bundle?.edgeIds ?? [id]) {
      scopeEdges[bundleEdgeId] = true;
    }
    const scopePorts: Record<string, true> = {};
    const sourcePortHandle = canonicalizeResourceHandleId(data?.sourceHandleId);
    const targetPortHandle = canonicalizeResourceHandleId(data?.targetHandleId);
    if (sourcePortHandle) {
      scopePorts[`${source}|${sourcePortHandle}`] = true;
    }
    if (targetPortHandle) {
      scopePorts[`${target}|${targetPortHandle}`] = true;
    }
    setHoveredFlowScope({
      edges: scopeEdges,
      ports: scopePorts,
      nodes: { [source]: true, [target]: true },
    });
  };
  // The whole line is a hover surface now, not just the label - but it stops
  // short of the ports so it can never steal the pointer-down that starts a
  // wire drag from a chip (edges hit-test above nodes).
  // It goes away with the labels. Zoomed out, a line is a couple of pixels
  // wide and lands under the pointer by accident rather than by aim, so the
  // surface stops being an affordance and is just six hundred more paths for
  // the browser to hit-test on every mouse move.
  const hoverTrimmedPoints =
    !hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS)
      ? undefined
      : trimPolylineEnds(routedEdge.points, 26);
  const hoverPathD = hoverTrimmedPoints ? pointsToSvgPath(hoverTrimmedPoints) : undefined;

  // The rate pill: on only in label mode, and never parked on a card — a
  // pill with no clear stretch of wire to sit on goes away entirely.
  const showRateLabel = Boolean(
    data?.showLabel &&
      data.resource &&
      !routedEdge.labelHidden &&
      hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS),
  );
  // The pulse canvas paints over the whole board and punches back out what
  // the dashes must stay under (see edge-pulse.ts). The pill publishes its
  // box for that punch-out: measured once per mount/text change through a
  // ResizeObserver — never per frame — and centred on the label anchor.
  const labelBoxRef = useRef<HTMLDivElement>(null);
  const labelBoxX = routedEdge.labelX;
  const labelBoxY = routedEdge.labelY;
  useLayoutEffect(() => {
    if (!showRateLabel) {
      retractEdgeLabelBox(id);
      return;
    }
    const element = labelBoxRef.current;
    const publish = () => {
      const pill = labelBoxRef.current;
      if (!pill) {
        return;
      }
      // offsetWidth/Height are pre-transform layout px, which are flow px:
      // zoom is a transform on the viewport, not a layout input.
      publishEdgeLabelBox(id, {
        left: labelBoxX - pill.offsetWidth / 2,
        top: labelBoxY - pill.offsetHeight / 2,
        width: pill.offsetWidth,
        height: pill.offsetHeight,
      });
    };
    publish();
    if (!element || typeof ResizeObserver === "undefined") {
      return () => retractEdgeLabelBox(id);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      retractEdgeLabelBox(id);
    };
  }, [id, labelBoxX, labelBoxY, showRateLabel]);

  // Hand this line's dashes to the board's pulse canvas (see edge-pulse.ts).
  // Published after commit rather than during render because it is a
  // side-effecting registration, and dropped on unmount so a culled or deleted
  // edge cannot leave a ghost marching across the board.
  // Zoomed far enough out the dashes are a shimmer rather than a reading, and
  // six hundred of them are the most expensive shimmer on the board.
  const pulseActive =
    flowRate?.pulse === true &&
    Boolean(liveRoute.path) &&
    hasEdgeDetail(detailLevel, EDGE_DETAIL_PULSE);
  useEffect(() => {
    if (!pulseActive) {
      retractEdgePulse(id);
      return;
    }

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of liveRoute.points) {
      if (point.x < left) left = point.x;
      if (point.x > right) right = point.x;
      if (point.y < top) top = point.y;
      if (point.y > bottom) bottom = point.y;
    }
    // Hops bulge off the polyline; the cull box has to cover them or a line
    // would wink out a fraction early at the edge of the screen.
    const margin = EDGE_HOP_MAX_RADIUS + pulseStroke;
    publishEdgePulse(id, {
      path: liveRoute.path,
      // Same numbers the SVG overlay used, so the marks are unchanged.
      width: Math.max(2, pulseStroke * 0.38),
      dash: pulseDash,
      gap: pulseGap,
      velocity: pulseVelocity,
      left: left - margin,
      right: right + margin,
      top: top - margin,
      bottom: bottom + margin,
      // A morph frame's path is one-of-a-kind; keep it out of the Path2D cache.
      transient: liveRoute.morphing,
    });
  });
  // Where this edge's waypoint dots sit, for the dash canvas to punch out —
  // the canvas paints above the SVG, so without this the dashes march right
  // over the dots. Published every render (drafts move per pointer frame);
  // a handful of circles, so the churn is nothing.
  useEffect(() => {
    if (activeWaypoints && activeWaypoints.length > 0) {
      publishEdgeWaypointDots(
        id,
        activeWaypoints.map((point) => ({
          x: point.x,
          y: point.y,
          // Circle radius + its 2px ring, with a hair of air.
          r: coreStrokeWidth / 2 + 6,
        })),
      );
    } else {
      retractEdgeWaypointDots(id);
    }
  });
  useEffect(() => () => {
    retractEdgePulse(id);
    retractEdgeWaypointDots(id);
  }, [id]);

  return (
    <>
      {(
        <>
          <path
            data-resource-edge-route={id}
            d={routedEdge.path}
            fill="none"
            stroke="transparent"
            strokeWidth="0"
            pointerEvents="none"
          />
          <BaseEdge
            path={liveRoute.path}
            interactionWidth={0}
            style={{
              // Highlighted, the casing IS the solid part of the glow: the
              // same gold line the cards outline in, 3px per side to match
              // their outline, with the resource colour still in the core.
              stroke: isHighlighted ? "var(--glow-line)" : "#111827",
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted ? 1 : 0.72,
              strokeWidth: isHighlighted
                ? coreStrokeWidth + 6
                : edgeCasingWidth(coreStrokeWidth),
              pointerEvents: "none",
            }}
          />
          <BaseEdge
            path={liveRoute.path}
            interactionWidth={0}
            style={{
              ...style,
              stroke: edgeColor,
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              // Zoom changes how much of the board you can see, never how the
              // board looks. Below 0.45 zoom every line used to drop to 0.52
              // opacity (0.28 when starved), which read as the whole plan
              // washing out for no reason the user did anything to cause.
              strokeOpacity: isHighlighted ? 1 : style?.strokeOpacity,
              strokeWidth: coreStrokeWidth,
              filter: isHighlighted ? "drop-shadow(0 0 6px var(--glow-halo))" : undefined,
              // Edges select/hover through their label, never the stroke:
              // edges render above nodes (zIndex 20) so their slot-anchored
              // stubs stay visible, and an interactive stroke there swallows
              // pointer-downs meant for the slot handles beneath it.
              pointerEvents: "none",
            }}
          />
          {/* Which way it moves. Dashes march from source to target along the
              route's own direction, faster on the busier lines — drawn on the
              board's pulse canvas rather than as an animated path here. See
              edge-pulse.ts: an animated stroke-dashoffset is a paint property,
              so one per edge repainted the entire board every frame. */}
        </>
      )}
      {/* A wire going round a dead ring, breathing on the same clock as the
          cards it joins. This is the ONE animated path allowed on the edge
          layer, and only because a spiral is a handful of wires in one place:
          the damage rect is the ring, not the board. (Contrast the marching
          dashes, which every edge wanted at once — see edge-pulse.ts for why
          those had to move to a canvas.) Opacity only, no geometry, so the
          route is untouched and nothing reroutes. */}
      {data?.isDeadLoop ? (
        <path
          className="dead-loop-wire"
          d={liveRoute.path}
          fill="none"
          stroke="#ff6b6b"
          strokeWidth={coreStrokeWidth + 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {/* Direction chevrons, one near each end when the marching dashes are
          off: the source's says "flow leaves here", the target's "flow lands
          here". Both are pulled back off the cards — the last stretch of a
          wire sits in the margin or under the card, where an arrow drowns.
          The wire's own colour, lifted a step brighter over a dark halo —
          tinted like the line it rides but never lost inside it — sized to
          the stroke: a regular little arrow on a thin wire, sitting INSIDE
          the stroke on a fat pipe. */}
      {showArrowHead
        ? getRouteChevrons(liveRoute.points, coreStrokeWidth).map((chevron, index) => (
            <g key={index} style={{ pointerEvents: "none" }}>
              <polyline
                points={chevron}
                stroke="#111827"
                strokeWidth={Math.min(2 + coreStrokeWidth * 0.12, 4) + 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={isEdgeStarved(data) ? 0.75 : 0.9}
              />
              <polyline
                points={chevron}
                stroke={brightenHexColor(edgeColor, 0.35)}
                strokeWidth={Math.min(2 + coreStrokeWidth * 0.12, 4)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={isEdgeStarved(data) ? 0.8 : 1}
                style={{
                  filter: isHighlighted ? "drop-shadow(0 0 4px var(--glow-halo))" : undefined,
                }}
              />
            </g>
          ))
        : null}
      {hoverPathD ? (
        <path
          d={hoverPathD}
          fill="none"
          stroke="transparent"
          // Has to cover the line it belongs to. A flat 14 was a comfortable
          // grab area for a 3px wire and a DEAD ZONE on a 34px pipe: the
          // pointer sat visibly on the pipe, outside the strip, and nothing
          // lit up. The margin keeps thin lines exactly as grabbable as they
          // were while a fat pipe is hoverable across its whole width.
          strokeWidth={Math.max(14, coreStrokeWidth + 6)}
          style={{ pointerEvents: "stroke" }}
          onMouseEnter={applyEdgeFlowScope}
          onMouseLeave={() => setHoveredFlowScope(undefined)}
          onPointerDown={(event) => {
            // Clicking the line selects the edge exactly like its label does.
            event.stopPropagation();
            window.dispatchEvent(
              new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                detail: { edgeIds: data?.bundle?.edgeIds ?? [id] },
              }),
            );
          }}
          onDoubleClick={(event) => {
            // Double-click the wire: pin a dot here. The wire must pass
            // through it from now on; drag it to steer, double-press it to
            // remove. Inserted in route order so several dots chain sanely.
            event.stopPropagation();
            if (Date.now() - lastWaypointRemovalAt < 500) {
              return;
            }
            const flowPoint = screenToFlowPoint(
              { x: event.clientX, y: event.clientY },
              event.currentTarget as unknown as HTMLElement,
            );
            if (!flowPoint) {
              return;
            }
            const snapped = {
              x: Math.round(flowPoint.x / BOARD_GRID) * BOARD_GRID,
              y: Math.round(flowPoint.y / BOARD_GRID) * BOARD_GRID,
            };
            const existing = data?.waypoints ?? [];
            const clickPosition = polylineArcPositionOf(routedEdge.points, snapped);
            let insertAt = 0;
            for (const waypoint of existing) {
              if (polylineArcPositionOf(routedEdge.points, waypoint) <= clickPosition) {
                insertAt += 1;
              }
            }
            updateEdge(id, {
              waypoints: [...existing.slice(0, insertAt), snapped, ...existing.slice(insertAt)],
            });
          }}
        />
      ) : null}
      {activeWaypoints && activeWaypoints.length > 0 && hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS)
        ? activeWaypoints.map((waypoint, index) => (
            <circle
              key={index}
              className="nodrag nopan"
              cx={waypoint.x}
              cy={waypoint.y}
              // A touch wider than the wire it steers, whatever that width is.
              r={coreStrokeWidth / 2 + 4}
              fill={brightenHexColor(edgeColor, 0.15)}
              stroke="#111827"
              strokeWidth={2}
              style={{ pointerEvents: "all", cursor: "grab" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                const now = Date.now();
                const lastPress = waypointPressRef.current;
                waypointPressRef.current = { index, time: now };
                if (lastPress && lastPress.index === index && now - lastPress.time < 400) {
                  // Second press on the same dot: unpin it, no drag.
                  waypointPressRef.current = undefined;
                  lastWaypointRemovalAt = now;
                  const rest = (data?.waypoints ?? []).filter(
                    (_, pointIndex) => pointIndex !== index,
                  );
                  updateEdge(id, { waypoints: rest.length > 0 ? rest : undefined });
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                waypointDragRef.current = { pointerId: event.pointerId, index };
                setDraftWaypoints((data?.waypoints ?? []).map((point) => ({ ...point })));
              }}
              onPointerMove={(event) => {
                const drag = waypointDragRef.current;
                if (!drag) {
                  return;
                }
                event.stopPropagation();
                const flowPoint = screenToFlowPoint(
                  { x: event.clientX, y: event.clientY },
                  event.currentTarget as unknown as HTMLElement,
                );
                if (!flowPoint) {
                  return;
                }
                // Clicky, not smooth: the dot lives on the grid, so it MOVES
                // on the grid — cell to cell under the pointer, exactly where
                // it will land, instead of gliding free and snapping late.
                // And never onto a card or its wire margin: dragged over one,
                // the dot rides the nearest legal cell instead, which is
                // exactly where releasing it will put it.
                const clamped = clampWaypointToClearSpace(flowPoint.x, flowPoint.y);
                setDraftWaypoints((current) =>
                  current?.map((point, pointIndex) =>
                    pointIndex === drag.index ? clamped : point,
                  ),
                );
              }}
              onPointerUp={(event) => {
                const drag = waypointDragRef.current;
                if (!drag) {
                  return;
                }
                event.currentTarget.releasePointerCapture(drag.pointerId);
                waypointDragRef.current = undefined;
                if (draftWaypoints) {
                  // On grid and in clear space, always: the dot commits to
                  // the nearest legal corner (plans saved before the clamp
                  // existed can carry dots inside cards — the commit heals
                  // whichever one was touched).
                  // Order is sacred: the first dot made is the first stop,
                  // wherever either gets dragged — the wire doubles back if
                  // it must. Re-sorting by position here silently swapped
                  // the user's itinerary.
                  updateEdge(id, {
                    waypoints: draftWaypoints.map((point) =>
                      clampWaypointToClearSpace(point.x, point.y),
                    ),
                  });
                }
                setDraftWaypoints(undefined);
              }}
              onPointerCancel={() => {
                waypointDragRef.current = undefined;
                setDraftWaypoints(undefined);
              }}
            >
              <title>Drag to steer this wire. Double-click to remove the stop</title>
            </circle>
          ))
        : null}
      {showRateLabel && data?.resource ? (
        // The rate pill, back by request as a VIEW mode (the tag button in
        // the board toolbar), and deliberately lean this time: what flows
        // and how fast, at the route's midpoint. No dragging, no popover —
        // the port chips carry the full story.
        <EdgeLabelRenderer>
          <div
            ref={labelBoxRef}
            className="nodrag nopan absolute flex cursor-pointer items-center gap-1.5 border border-[var(--mc-15)] bg-[#2b2d32] px-1.5 py-0.5 text-[12px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)]"
            style={{
              transform: `translate(-50%, -50%) translate(${routedEdge.labelX}px, ${routedEdge.labelY}px)`,
              pointerEvents: "all",
              borderColor: isHighlighted ? "var(--glow-line)" : edgeColor,
            }}
            onMouseEnter={applyEdgeFlowScope}
            onMouseLeave={() => setHoveredFlowScope(undefined)}
            onPointerDown={(event) => {
              event.stopPropagation();
              window.dispatchEvent(
                new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                  detail: { edgeIds: data.bundle?.edgeIds ?? [id] },
                }),
              );
            }}
          >
            <ResourceIcon
              resource={data.resource}
              size="sm"
              showAmount={false}
              bare
              className="!h-[18px] !w-[18px]"
            />
            <span className="leading-none tracking-tight tabular-nums">
              <EdgeRateLabelText data={data} />
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function ResourceConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<BoardFlowNode>) {
  // Over a card that takes this resource, the pipe jumps to the slot it will
  // land on rather than following the cursor across the card.
  const snap = getConnectionSnap(toX, toY);
  const endX = snap?.point.x ?? toX;
  const endY = snap?.point.y ?? toY;
  const endPosition = snap ? (snap.side === "input" ? Position.Left : Position.Right) : toPosition;

  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: endX,
    targetY: endY,
    targetPosition: endPosition,
  });
  // A snapped end is by definition a connection that will work, whatever React
  // Flow thinks — it only ever reports "valid" when the pointer is on a handle.
  const color = !snap && connectionStatus === "invalid" ? "#ef4444" : "#00d9ff";

  return (
    <g className="react-flow__connection">
      <path
        d={edgePath}
        fill="none"
        stroke="#052e36"
        strokeWidth={9}
        strokeLinecap="round"
        opacity={0.75}
      />
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.98}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
      <circle cx={endX} cy={endY} r={6} fill={color} stroke="#052e36" strokeWidth={2} />
    </g>
  );
}

function getEdgeBundles(
  project: FactoryProject,
  edges: FactoryEdge[],
  edgeResults: Record<
    string,
    {
      demandPerSecond?: number;
      transferredPerSecond?: number;
      isLimited?: boolean;
      nameplateDemandPerSecond?: number;
      sourceCapacityPerSecond?: number;
      constraint?: EdgeThroughput["constraint"];
    }
  >,
  ceilingFor: (sourceId: string) => number = () => 1,
) {
  const groups = new Map<string, FactoryEdge[]>();

  for (const edge of edges) {
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (edge.sourceHandle && (!sourceHandle || sourceHandle.side !== "output")) {
      continue;
    }

    const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const bundles = new Map<string, NonNullable<ResourceEdgeData["bundle"]>>();
  for (const group of groups.values()) {
    const explicitSourceHandleIds = [
      ...new Set(
        group
          .map((edge) => edge.sourceHandle)
          .filter((handleId): handleId is string => Boolean(handleId)),
      ),
    ];
    const inferredSourceHandleIds = group.some((edge) => edge.sourceHandle)
      ? []
      : inferRepeatedOutputHandleIds(project, group[0]);
    const sourceHandleIds =
      explicitSourceHandleIds.length > 1 ? explicitSourceHandleIds : inferredSourceHandleIds;
    if (sourceHandleIds.length < 2) {
      continue;
    }

    const primaryEdge = group[Math.floor(group.length / 2)];
    const targetKeys = new Set(
      group.map((edge) => `${edge.target}|${edge.targetHandle ?? ""}|${edge.resourceKind}`),
    );
    const mode = targetKeys.size === 1 ? "single-target" : "multi-target";
    const demand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0),
      0,
    );
    const transferred = group.reduce(
      (sum, edge) =>
        sum +
        (edgeResults[edge.id]?.transferredPerSecond ??
          edgeResults[edge.id]?.demandPerSecond ??
          edge.ratePerSecond ??
          0),
      0,
    );
    const isLimited = group.some((edge) => edgeResults[edge.id]?.isLimited === true);
    const isSupplyCapped = group.some((edge) => edgeResults[edge.id]?.constraint === "supply");
    const nameplateDemand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.nameplateDemandPerSecond ?? 0),
      0,
    );
    // Every edge in the group leaves the same producer, so its capacity is one
    // shared total, not a per-edge amount to sum - scaled by how fast that
    // producer can actually run on its own inputs.
    const sourceCapacity =
      group.reduce(
        (max, edge) => Math.max(max, edgeResults[edge.id]?.sourceCapacityPerSecond ?? 0),
        0,
      ) * ceilingFor(group[0].source);
    const primarySourceHandleId = primaryEdge.sourceHandle ?? sourceHandleIds[0];
    const edgeIds = group.map((edge) => edge.id);
    if (!primarySourceHandleId) {
      continue;
    }

    for (const edge of group) {
      bundles.set(edge.id, {
        role: edge.id === primaryEdge.id ? "primary" : "member",
        mode,
        size: group.length,
        sourceHandleIds,
        primarySourceHandleId,
        edgeIds,
        demand: mode === "single-target" ? demand : undefined,
        transferred: mode === "single-target" ? transferred : undefined,
        nameplateDemand: mode === "single-target" ? nameplateDemand : undefined,
        sourceCapacity:
          mode === "single-target" && sourceCapacity > 0 ? sourceCapacity : undefined,
        isLimited,
        isSupplyCapped,
      });
    }
  }

  return bundles;
}

function getEdgeEndpointOffsets(project: FactoryProject) {
  const storagesById = new Set((project.storages ?? []).map((storage) => storage.id));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const groups = new Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >();

  const storageYById = new Map(
    (project.storages ?? []).map((storage) => [storage.id, storage.position?.y ?? 0]),
  );
  const counterpartYOf = (id: string) =>
    nodesById.get(id)?.position.y ?? storageYById.get(id) ?? 0;

  for (const edge of project.edges) {
    // Rails pool one port per resource, so every edge whose (possibly legacy
    // per-slot) handle collapses onto the same canonical id shares a port and
    // must fan out along it. Storages fan out too — several wires into one
    // tank used to dock on the same point and ride each other.
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (storagesById.has(edge.source)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.source}|storage-out`,
        edgeId: edge.id,
        endpoint: "source",
        counterpartY: counterpartYOf(edge.target),
      });
    } else if (sourceHandle) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.source}|${canonicalizeResourceHandleId(edge.sourceHandle)}`,
        edgeId: edge.id,
        endpoint: "source",
        counterpartY: counterpartYOf(edge.target),
      });
    }

    const targetHandle = parseResourceHandleId(edge.targetHandle);
    if (storagesById.has(edge.target)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.target}|storage-in`,
        edgeId: edge.id,
        endpoint: "target",
        counterpartY: counterpartYOf(edge.source),
      });
    } else if (targetHandle) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.target}|${canonicalizeResourceHandleId(edge.targetHandle)}`,
        edgeId: edge.id,
        endpoint: "target",
        counterpartY: counterpartYOf(edge.source),
      });
    }
  }

  const offsets = new Map<string, number>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    // Storage cards are wide open — spread their dock points far enough
    // apart to read as separate wires, not a 5px smear.
    const spacing = key.includes("|storage-") ? 16 : EDGE_ENDPOINT_SPACING;
    const sortedGroup = [...group].sort(
      (left, right) =>
        left.counterpartY - right.counterpartY ||
        left.edgeId.localeCompare(right.edgeId) ||
        left.endpoint.localeCompare(right.endpoint),
    );
    sortedGroup.forEach((entry, index) => {
      offsets.set(`${entry.edgeId}:${entry.endpoint}`, getStackedEndpointOffset(index, spacing));
    });
  }

  return offsets;
}

function getStackedEndpointOffset(index: number, spacing = EDGE_ENDPOINT_SPACING) {
  if (index === 0) {
    return 0;
  }

  const step = Math.ceil(index / 2) * spacing;
  return index % 2 === 1 ? step : -step;
}

function addEndpointOffsetGroupEntry(
  groups: Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >,
  entry: {
    key: string;
    edgeId: string;
    endpoint: "source" | "target";
    counterpartY: number;
  },
) {
  const group = groups.get(entry.key);
  if (group) {
    group.push(entry);
    return;
  }

  groups.set(entry.key, [entry]);
}

function inferRepeatedOutputHandleIds(project: FactoryProject, edge: FactoryEdge | undefined) {
  if (!edge) {
    return [];
  }

  return getRepeatedOutputHandleIds(project, edge.source, {
    kind: edge.resourceKind,
    id: edge.resourceId,
  });
}

function getRepeatedOutputHandleIds(
  project: FactoryProject,
  sourceNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
) {
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  if (sourceStorage) {
    return [];
  }

  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  if (!sourceRecipe) {
    return [];
  }

  return sourceRecipe.outputs
    .map((output, outputIndex) =>
      output.kind === resource.kind && output.id === resource.id
        ? makeResourceHandleId("output", output, outputIndex)
        : undefined,
    )
    .filter((handleId): handleId is string => Boolean(handleId));
}

function getDirectEdgePath({
  edgeId,
  routeIndex,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  useSmartRouting = true,
  strokeWidth,
}: {
  edgeId?: string;
  routeIndex?: number;
  /** Width this line will actually draw at, for hop sizing. */
  strokeWidth?: number;
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  useSmartRouting?: boolean;
}): RoutedEdgePath {
  // The grid solve owns every settled route; the simple L-shape covers the
  // two transient cases — a mid-drag edge following the pointer, and an edge
  // whose endpoints have not been measured yet.
  const points =
    (useSmartRouting ? getBestDirectEdgePoints({ edgeId }) : undefined) ??
    getSimpleOrthogonalEdgePoints({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

  // The midpoint anchor: where the rate pill sits when labels are on, and
  // "somewhere on this wire" for the hover story either way.
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ?? {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };

  // Hop bumps are sized from the width this line actually draws at, so a
  // highlighted (thickened) line still clears what it crosses.
  const width = strokeWidth ?? ownStrokeWidth(edgeId);

  return {
    path: pointsToHoppedSvgPath(
      points,
      collectHoppedRouteSegments(edgeId, routeIndex, points),
      width,
    ),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    // A pill with no room is a pill not shown: anchored over (or hard
    // against) a card, it would sit on the card instead of the wire.
    labelHidden: isPointInsideAnyMeasuredNode(labelPoint),
    points,
  };
}

function getSimpleOrthogonalEdgePoints({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceExit = offsetPointFromSide(source, sourcePosition, publishedDirectEdgeNodeClearance);
  const targetExit = offsetPointFromSide(target, targetPosition, publishedDirectEdgeNodeClearance);
  const sourceVertical = isVerticalSide(String(sourcePosition));
  const targetVertical = isVerticalSide(String(targetPosition));

  if (sourceVertical && targetVertical) {
    const routeY = (sourceExit.y + targetExit.y) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: sourceExit.x, y: routeY },
      { x: targetExit.x, y: routeY },
      targetExit,
      target,
    ]);
  }

  if (!sourceVertical && !targetVertical) {
    const routeX = (sourceExit.x + targetExit.x) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: routeX, y: sourceExit.y },
      { x: routeX, y: targetExit.y },
      targetExit,
      target,
    ]);
  }

  return compactPolylinePoints([
    source,
    sourceExit,
    sourceVertical ? { x: sourceExit.x, y: targetExit.y } : { x: targetExit.x, y: sourceExit.y },
    targetExit,
    target,
  ]);
}

/**
 * The routed points for one edge, from the board-wide grid solve. All the
 * per-edge candidate generation, scoring, and A*-with-portals machinery this
 * used to hold lives in `grid-edge-router.ts` now, as one solve over every
 * wire at once — lane sharing needs the whole picture.
 */
function getBestDirectEdgePoints({
  edgeId,
}: {
  edgeId?: string;
}): Array<{ x: number; y: number }> | undefined {
  if (!edgeId) {
    return undefined;
  }
  ensureGridSolve();
  const cached = directRouteCache.get(edgeId);
  if (cached && cached.signature === gridSolveSignature) {
    return cached.route.points;
  }
  return undefined;
}



function snapRouteCoord(value: number) {
  return Math.round(value / EDGE_ROUTE_SNAP_GRID) * EDGE_ROUTE_SNAP_GRID;
}

function buildRoutedEdgePath(points: Array<{ x: number; y: number }>): RoutedEdgePath {
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ??
    points[Math.floor(points.length / 2)] ?? {
      x: 0,
      y: 0,
    };
  return {
    path: pointsToSvgPath(points),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    labelHidden: isPointInsideAnyMeasuredNode(labelPoint),
    points,
  };
}

function offsetPointFromSide(point: { x: number; y: number }, side: Position, distance: number) {
  switch (String(side)) {
    case "left":
      return { x: point.x - distance, y: point.y };
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "right":
    default:
      return { x: point.x + distance, y: point.y };
  }
}

function isVerticalSide(side: string) {
  return side === "top" || side === "bottom";
}



function compactPolylinePoints(points: Array<{ x: number; y: number } | undefined>) {
  const compacted: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      continue;
    }

    const previous = compacted[compacted.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function pointsToSvgPath(points: Array<{ x: number; y: number }>) {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [`M ${first.x},${first.y}`, ...rest.map((point) => `L ${point.x},${point.y}`)].join(" ");
}

/**
 * The polyline with `startTrim`/`endTrim` px shaved off its ends, or
 * undefined when the route is too short to keep a meaningful middle. The
 * hover-anywhere surface uses this so it never reaches the port chips — and
 * so it clears the plug block a machine-output wire runs beneath.
 */
function trimPolylineEnds(
  points: Array<{ x: number; y: number }>,
  startTrim: number,
  endTrim = startTrim,
) {
  const segments = getPolylineSegments(points);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= startTrim + endTrim + 8) {
    return undefined;
  }

  const pointAtDistance = (distance: number) => {
    let cursor = 0;
    for (const segment of segments) {
      if (cursor + segment.length >= distance) {
        const ratio = segment.length > 0 ? (distance - cursor) / segment.length : 0;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
          y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
        };
      }
      cursor += segment.length;
    }
    return points[points.length - 1]!;
  };

  const startDistance = startTrim;
  const endDistance = total - endTrim;
  const trimmed: Array<{ x: number; y: number }> = [pointAtDistance(startDistance)];
  let cursor = 0;
  for (const segment of segments) {
    cursor += segment.length;
    if (cursor > startDistance && cursor < endDistance) {
      trimmed.push(segment.end);
    }
  }
  trimmed.push(pointAtDistance(endDistance));
  return trimmed;
}

/**
 * Hop size for normal wires. A 5px bump clears a 3px line with room to spare,
 * and vanishes completely under a 34px pipe — the crossing reads as a flat X
 * again, which is the exact thing hops exist to prevent. Thickness mode scales
 * the bump so it still clears whatever it is hopping over.
 */
/** Air between the two strokes at the top of a hop. Snug, not floating. */
const EDGE_HOP_GAP = 3;
/** Nothing sensible needs a bump taller than this, whatever the widths say. */
const EDGE_HOP_MAX_RADIUS = 44;

/**
 * Every line's current stroke width, by edge id, published by the board.
 *
 * Hops are built at ROUTE time, where the only thing known about the line
 * being crossed is its id — so the widths have to be reachable from module
 * scope, the same way node bounds are. A hop that ignores them is either a
 * pimple under a fat pipe or a hoop over a hair.
 */
const publishedEdgeStrokeWidths = new Map<string, number>();
const DEFAULT_EDGE_STROKE_WIDTH = 6;


/**
 * How far a line must lift to clear the one it crosses: half of each stroke,
 * plus a little air. Two 3px wires give ~6px, near the old fixed 5; two 34px
 * pipes give ~37px, which is what "snug over each other" actually costs at
 * that size.
 */
function hopRadiusFor(ownWidth: number, otherWidth: number): number {
  return Math.min(ownWidth / 2 + otherWidth / 2 + EDGE_HOP_GAP, EDGE_HOP_MAX_RADIUS);
}

function ownStrokeWidth(edgeId: string | undefined): number {
  return (
    (edgeId ? publishedEdgeStrokeWidths.get(edgeId) : undefined) ?? DEFAULT_EDGE_STROKE_WIDTH
  );
}

/**
 * Segments this edge should hop over: every other routed line that sits
 * BEHIND it (see compareEdgeDepth), so exactly one side of every crossing
 * bumps and it is always the side you can see.
 *
 * Reads the same cache the relaxation loop uses, with the same staleness
 * class: a neighbour's reroute refreshes this edge on the next epoch.
 */
function collectHoppedRouteSegments(
  edgeId: string | undefined,
  routeIndex: number | undefined,
  points: Array<{ x: number; y: number }>,
) {
  if (routeIndex === undefined || points.length < 2) {
    return [];
  }

  // Only a line that runs through this route's own bounding box can cross it,
  // so the hop pass asks the segment index for that box rather than walking
  // every cached route on the board. The margin covers the tallest bump a hop
  // can be, which is the only way a segment just outside the box can matter.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    if (point.x < left) left = point.x;
    if (point.x > right) right = point.x;
    if (point.y < top) top = point.y;
    if (point.y > bottom) bottom = point.y;
  }
  const margin = EDGE_HOP_MAX_RADIUS + 2;

  // Compared through the PUBLISHED widths on both sides, never the render
  // width: the render width picks up a highlight bump, and a comparison where
  // one side is measured differently is not antisymmetric — both edges of a
  // pair could decide to hop, or neither.
  const own = { width: ownStrokeWidth(edgeId), routeIndex };
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
  }> = [];
  for (const entry of queryRouteSegments({
    left: left - margin,
    right: right + margin,
    top: top - margin,
    bottom: bottom + margin,
  })) {
    if (
      entry.edgeId === edgeId ||
      compareEdgeDepth(own, {
        width: ownStrokeWidth(entry.edgeId),
        routeIndex: entry.routeIndex,
      }) <= 0
    ) {
      continue;
    }
    // Carry the crossed line's thickness along with its geometry: the hop is
    // sized from it, not from a constant.
    segments.push({
      start: entry.start,
      end: entry.end,
      width: publishedEdgeStrokeWidths.get(entry.edgeId) ?? DEFAULT_EDGE_STROKE_WIDTH,
    });
  }
  return segments;
}

/**
 * Like pointsToSvgPath, but wherever an orthogonal segment properly crosses
 * one of the given (earlier-routed) segments, the line lifts over it in a
 * small semicircular bump - the classic schematic hop that makes crossings
 * legible instead of a flat X. Horizontal runs bump upward, vertical runs
 * bump toward the left, so the same crossing always reads the same way.
 */
function pointsToHoppedSvgPath(
  points: Array<{ x: number; y: number }>,
  otherSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
  }>,
  ownWidth = DEFAULT_EDGE_STROKE_WIDTH,
) {
  if (points.length < 2 || otherSegments.length === 0) {
    return pointsToSvgPath(points);
  }

  const first = points[0]!;
  let path = `M ${first.x},${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const horizontal = Math.abs(from.y - to.y) < 0.01;
    const vertical = Math.abs(from.x - to.x) < 0.01;
    if ((!horizontal && !vertical) || (horizontal && vertical)) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }

    // A crossing near a bend still gets its bump: the arc is CLAMPED into
    // the run (asymmetric if it must be) rather than shrunk away. Routes
    // turn beside ports and cross right after the corner, and the old
    // shrink-to-nothing rule silently dropped exactly those hops — a flat X
    // in the one place two wires are guaranteed to meet.
    const crossings: Array<{ at: number; radius: number }> = [];
    const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    // The other line must properly OVERSHOOT this one on both sides: a
    // segment that merely ends a pixel or two past the line (T-junctions at
    // docks, lane-adjacent turns) reads as a touch, not a crossing, and a
    // hump there looks like it sits over nothing.
    const OVERSHOOT = 4;
    for (const segment of otherSegments) {
      const segmentHorizontal = Math.abs(segment.start.y - segment.end.y) < 0.01;
      const segmentVertical = Math.abs(segment.start.x - segment.end.x) < 0.01;
      if (horizontal && segmentVertical) {
        const crossAt = segment.start.x;
        const otherLow = Math.min(segment.start.y, segment.end.y);
        const otherHigh = Math.max(segment.start.y, segment.end.y);
        if (
          crossAt > low + 1 &&
          crossAt < high - 1 &&
          from.y > otherLow + OVERSHOOT &&
          from.y < otherHigh - OVERSHOOT
        ) {
          crossings.push({ at: crossAt, radius: hopRadiusFor(ownWidth, segment.width) });
        }
      } else if (vertical && segmentHorizontal) {
        const crossAt = segment.start.y;
        const otherLow = Math.min(segment.start.x, segment.end.x);
        const otherHigh = Math.max(segment.start.x, segment.end.x);
        if (
          crossAt > low + 1 &&
          crossAt < high - 1 &&
          from.x > otherLow + OVERSHOOT &&
          from.x < otherHigh - OVERSHOOT
        ) {
          crossings.push({ at: crossAt, radius: hopRadiusFor(ownWidth, segment.width) });
        }
      }
    }

    if (crossings.length === 0) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }

    const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
    crossings.sort((left, right) => (left.at - right.at) * direction);
    const merged: Array<{ at: number; radius: number }> = [];
    for (const crossing of crossings) {
      const previous = merged[merged.length - 1];
      if (!previous || Math.abs(crossing.at - previous.at) > previous.radius + crossing.radius + 2) {
        merged.push(crossing);
      }
    }

    for (const crossing of merged) {
      // Clamp the bump's feet inside the run; a crossing tight against a
      // corner gets an asymmetric arc (a taller radius over a shorter
      // chord) instead of no arc at all.
      const bumpLow = Math.max(low + 0.5, crossing.at - crossing.radius);
      const bumpHigh = Math.min(high - 0.5, crossing.at + crossing.radius);
      const chord = bumpHigh - bumpLow;
      if (chord < 4) {
        continue;
      }
      const radius = Math.max(crossing.radius, chord / 2 + 0.1);
      const beforeAt = direction > 0 ? bumpLow : bumpHigh;
      const afterAt = direction > 0 ? bumpHigh : bumpLow;
      if (horizontal) {
        // SVG sweep=1 is clockwise on screen: traveling east that arcs over
        // the top; traveling west needs sweep=0 for the same upward bump.
        const sweep = direction > 0 ? 1 : 0;
        path += ` L ${beforeAt},${from.y} A ${radius} ${radius} 0 0 ${sweep} ${afterAt},${from.y}`;
      } else {
        // Traveling south, clockwise (sweep 1) bulges toward the right;
        // traveling north, sweep 0 keeps the bump on that same side.
        const sweep = direction > 0 ? 1 : 0;
        path += ` L ${from.x},${beforeAt} A ${radius} ${radius} 0 0 ${sweep} ${from.x},${afterAt}`;
      }
    }
    path += ` L ${to.x},${to.y}`;
  }

  return path;
}

function getPointAtPolylineRatio(points: Array<{ x: number; y: number }>, ratio: number) {
  const segments = getPolylineSegments(points);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) {
    return points[0];
  }

  let remaining = totalLength * clamp(ratio, 0, 1);
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length <= 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      };
    }

    remaining -= segment.length;
  }

  return points[points.length - 1];
}

function getPolylineSegments(points: Array<{ x: number; y: number }>) {
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0.5) {
      segments.push({ start, end, length });
    }
  }

  return segments;
}

/**
 * Measures every node on the board once per layout epoch.
 *
 * Each edge needs the same obstacle set minus its own two endpoints, so this
 * used to walk and measure the entire board once per edge — O(edges x nodes)
 * forced layouts every frame. The sweep is now shared and each edge only filters
 * it.
 *
 * Nodes are ordered by id rather than by DOM order so the obstacle list (and
 * therefore route scoring) does not depend on React's mount order.
 */
function getMeasuredAvoidanceSweep() {
  if (measuredAvoidanceSweep?.epoch === measuredLayoutEpoch) {
    return measuredAvoidanceSweep;
  }

  let bounds: Array<{ id: string; bounds: MeasuredBounds }> = [];
  if (publishedBoardBounds) {
    // Published geometry covers the whole board regardless of which nodes are
    // currently mounted, and needs no DOM reads.
    bounds = publishedBoardBounds;
  } else if (typeof document !== "undefined") {
    for (const element of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = element.dataset.id;
      // Same rule as the published set above: annotations never block a wire.
      if (!id || element.classList.contains("react-flow__node-annotationNode")) {
        continue;
      }

      const cacheKey = `${measuredLayoutEpoch}|${id}`;
      let measured = measuredNodeBoundsCache.get(cacheKey);
      if (!measuredNodeBoundsCache.has(cacheKey)) {
        measured = measureNodeElementBounds(element);
        measuredNodeBoundsCache.set(cacheKey, measured);
      }

      if (measured) {
        bounds.push({ id, bounds: measured });
      }
    }
    bounds.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  // Snap and geometry-sort once, in the order `normalizeRouteBounds` would have
  // produced. Filtering an already-sorted list preserves that order, so each edge
  // no longer has to re-sort the whole board.
  const normalized = bounds
    .map((entry) => ({
      id: entry.id,
      bounds: {
        left: snapRouteCoord(entry.bounds.left),
        right: snapRouteCoord(entry.bounds.right),
        top: snapRouteCoord(entry.bounds.top),
        bottom: snapRouteCoord(entry.bounds.bottom),
      },
    }))
    .sort(
      (left, right) =>
        left.bounds.left - right.bounds.left ||
        left.bounds.top - right.bounds.top ||
        left.bounds.right - right.bounds.right,
    );

  // Two lookup structures built once per epoch, because everything downstream
  // used to answer "which nodes are near me" by walking the whole board once
  // per edge — O(nodes x edges) per render, which is the shape ARCHITECTURE.md
  // forbids and which a 1,200-node plan feels immediately.
  const byId = new Map<string, MeasuredBounds>();
  const grid = new Map<number, Array<{ id: string; bounds: MeasuredBounds }>>();
  for (const entry of normalized) {
    byId.set(entry.id, entry.bounds);
    const minCellX = Math.floor(entry.bounds.left / NODE_BOUNDS_CELL_SIZE);
    const maxCellX = Math.floor(entry.bounds.right / NODE_BOUNDS_CELL_SIZE);
    const minCellY = Math.floor(entry.bounds.top / NODE_BOUNDS_CELL_SIZE);
    const maxCellY = Math.floor(entry.bounds.bottom / NODE_BOUNDS_CELL_SIZE);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const cell = routeCellKey(cellX, cellY);
        const bucket = grid.get(cell);
        if (bucket) {
          bucket.push(entry);
        } else {
          grid.set(cell, [entry]);
        }
      }
    }
  }

  measuredAvoidanceSweep = {
    epoch: measuredLayoutEpoch,
    bounds: normalized,
    byId,
    grid,
    hash: bounds
      .map(
        (entry) =>
          `${entry.id}:${snapRouteCoord(entry.bounds.left)},${snapRouteCoord(entry.bounds.top)},${snapRouteCoord(entry.bounds.right)},${snapRouteCoord(entry.bounds.bottom)}`,
      )
      .join(";"),
  };
  return measuredAvoidanceSweep;
}

/**
 * Node rects whose cell overlaps the rect, in the sweep's stable order.
 *
 * Order matters: route scoring sums over this list, and a different order
 * would give a (slightly) different floating-point score, so the grid's
 * results are re-sorted into the sweep's canonical geometry order rather than
 * returned in whatever order the cells happened to hold them.
 */
function queryMeasuredNodeBounds(
  rect: { left: number; right: number; top: number; bottom: number },
  excludedNodeIds?: Set<string>,
): MeasuredBounds[] {
  const sweep = getMeasuredAvoidanceSweep();
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.right) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.bottom)
  ) {
    return [];
  }

  const seen = new Set<string>();
  const found: Array<{ id: string; bounds: MeasuredBounds }> = [];
  const minCellX = Math.floor(rect.left / NODE_BOUNDS_CELL_SIZE);
  const maxCellX = Math.floor(rect.right / NODE_BOUNDS_CELL_SIZE);
  const minCellY = Math.floor(rect.top / NODE_BOUNDS_CELL_SIZE);
  const maxCellY = Math.floor(rect.bottom / NODE_BOUNDS_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = sweep.grid.get(routeCellKey(cellX, cellY));
      if (!bucket) {
        continue;
      }
      for (const entry of bucket) {
        if (seen.has(entry.id) || excludedNodeIds?.has(entry.id)) {
          continue;
        }
        seen.add(entry.id);
        found.push(entry);
      }
    }
  }
  found.sort(
    (left, right) =>
      left.bounds.left - right.bounds.left ||
      left.bounds.top - right.bounds.top ||
      left.bounds.right - right.bounds.right,
  );
  return found.map((entry) => entry.bounds);
}

function getMeasuredNodeBoundsById(nodeId: string | undefined) {
  if (!nodeId) {
    return undefined;
  }
  return getMeasuredAvoidanceSweep().byId.get(nodeId);
}

/**
 * Whether a label ANCHORED here would overlap some node: the margins are
 * half the label box, so this tests the box, not just the center point.
 */
/**
 * The nearest grid corner a waypoint dot may legally sit on: outside every
 * card and its one-cell wire clearance — the same margin routes keep. A dot
 * inside that space is a stop the router could only ignore, so instead of
 * letting it sit on a card it slides out of the nearest side. A push can
 * land inside a neighbouring card's margin; a few passes settle it, and a
 * dot buried in a wall of cards just stays where the passes left it.
 */
function clampWaypointToClearSpace(x: number, y: number): { x: number; y: number } {
  const snap = (value: number) => Math.round(value / BOARD_GRID) * BOARD_GRID;
  let px = snap(x);
  let py = snap(y);
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const bounds of queryMeasuredNodeBounds({
      left: px - BOARD_GRID,
      right: px + BOARD_GRID,
      top: py - BOARD_GRID,
      bottom: py + BOARD_GRID,
    })) {
      const inflated = {
        left: bounds.left - BOARD_GRID,
        right: bounds.right + BOARD_GRID,
        top: bounds.top - BOARD_GRID,
        bottom: bounds.bottom + BOARD_GRID,
      };
      // ON the clearance line is legal — that is where the wires travel.
      if (
        px <= inflated.left ||
        px >= inflated.right ||
        py <= inflated.top ||
        py >= inflated.bottom
      ) {
        continue;
      }
      const pushes = [
        { dx: inflated.left - px, dy: 0, cost: px - inflated.left },
        { dx: inflated.right - px, dy: 0, cost: inflated.right - px },
        { dx: 0, dy: inflated.top - py, cost: py - inflated.top },
        { dx: 0, dy: inflated.bottom - py, cost: inflated.bottom - py },
      ].sort((left, right) => left.cost - right.cost);
      px = snap(px + pushes[0]!.dx);
      py = snap(py + pushes[0]!.dy);
      moved = true;
    }
    if (!moved) {
      break;
    }
  }
  return { x: px, y: py };
}

function isPointInsideAnyMeasuredNode(
  point: { x: number; y: number },
  // Half the label box. 80, not 60: the pill grew a supply percent
  // ("100 L/s · 100%") and the old half-width let its ends rest on cards.
  marginX = 80,
  marginY = 16,
) {
  // Only nodes whose cell covers the point (plus the label's own half-box) can
  // possibly contain it; the rest of the board never needs looking at.
  for (const bounds of queryMeasuredNodeBounds({
    left: point.x - marginX,
    right: point.x + marginX,
    top: point.y - marginY,
    bottom: point.y + marginY,
  })) {
    if (
      point.x >= bounds.left - marginX &&
      point.x <= bounds.right + marginX &&
      point.y >= bounds.top - marginY &&
      point.y <= bounds.bottom + marginY
    ) {
      return true;
    }
  }
  return false;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSlotEdgeEndpointCandidates({
  nodeId,
  handleId,
  position,
  estimatedX,
  estimatedY,
  endpointOffset,
  isRecipeSlotEndpoint,
  isStorageSlotEndpoint,
  counterpartX,
  counterpartY,
  measureEndpoints = true,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isRecipeSlotEndpoint?: boolean;
  isStorageSlotEndpoint?: boolean;
  counterpartX?: number;
  counterpartY?: number;
  measureEndpoints?: boolean;
}) {
  const estimatedSide = positionToEdgeSide(position);
  if (!isRecipeSlotEndpoint && !isStorageSlotEndpoint) {
    return [{ x: estimatedX, y: estimatedY, side: estimatedSide }];
  }

  const handle = parseResourceHandleId(handleId);
  const logicalRecipeSide = handle?.side === "input" ? Position.Left : Position.Right;
  if (isRecipeSlotEndpoint) {
    // Machine ports are strict: inputs enter on the left, outputs leave on
    // the right - never the top, bottom, or wrong side. The router bends
    // around whatever that costs.
    return [
      {
        ...getSlotEdgeEndpointForSide({
          nodeId,
          handleId,
          edgeSide: logicalRecipeSide,
          estimatedX,
          estimatedY,
          endpointOffset,
          isStorageSlotEndpoint,
          measureEndpoint: measureEndpoints,
        }),
        freeExit: true,
      },
    ];
  }

  const preferredSide =
    measureEndpoints && counterpartX !== undefined && counterpartY !== undefined
      ? getSlotEdgeSideTowardPoint({
          nodeId,
          handleId,
          estimatedX,
          estimatedY,
          counterpartX,
          counterpartY,
          estimatedSide,
        })
      : estimatedSide;
  const sides = dedupeEdgeSides([
    preferredSide,
    estimatedSide,
    Position.Bottom,
    Position.Top,
    Position.Left,
    Position.Right,
  ]);

  // Storage nodes are small and legitimately enter/exit on any side.
  return sides.map((edgeSide) => ({
    ...getSlotEdgeEndpointForSide({
      nodeId,
      handleId,
      edgeSide,
      estimatedX,
      estimatedY,
      endpointOffset,
      isStorageSlotEndpoint,
      measureEndpoint: measureEndpoints,
    }),
    freeExit: true,
  }));
}

function getSlotEdgeEndpointForSide({
  nodeId,
  handleId,
  edgeSide,
  estimatedX,
  estimatedY,
  endpointOffset,
  isStorageSlotEndpoint,
  measureEndpoint = true,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: Position;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isStorageSlotEndpoint?: boolean;
  measureEndpoint?: boolean;
}): SlotEdgeEndpoint {
  const measuredEndpoint = measureEndpoint
    ? getMeasuredSlotEndpoint({
        nodeId,
        handleId,
        edgeSide,
        endpointOffset,
      })
    : undefined;
  if (measuredEndpoint) {
    return { ...measuredEndpoint, side: edgeSide };
  }

  const offset = isStorageSlotEndpoint ? STORAGE_SLOT_EDGE_OFFSET : RECIPE_SLOT_EDGE_OFFSET;
  const endpointLaneOffset = endpointOffset ?? 0;

  switch (edgeSide) {
    case Position.Right:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? -offset : offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Left:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? offset : -offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Top:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY - offset, side: edgeSide };
    case Position.Bottom:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY + offset, side: edgeSide };
    default:
      return { x: estimatedX, y: estimatedY, side: edgeSide };
  }
}

function dedupeEdgeSides(sides: Position[]) {
  const seen = new Set<string>();
  return sides.filter((side) => {
    const key = String(side);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function positionToEdgeSide(position: unknown): Position {
  switch (String(position)) {
    case "right":
      return Position.Right;
    case "left":
      return Position.Left;
    case "top":
      return Position.Top;
    case "bottom":
      return Position.Bottom;
    default:
      return Position.Right;
  }
}

function getSlotEdgeSideTowardPoint({
  nodeId,
  handleId,
  estimatedX,
  estimatedY,
  counterpartX,
  counterpartY,
  estimatedSide,
}: {
  nodeId: string;
  handleId?: string | null;
  estimatedX: number;
  estimatedY: number;
  counterpartX: number;
  counterpartY: number;
  estimatedSide: Position;
}) {
  const center = getMeasuredSlotCenter({ nodeId, handleId }) ?? { x: estimatedX, y: estimatedY };
  const distanceX = counterpartX - center.x;
  const distanceY = counterpartY - center.y;
  const horizontalSide = distanceX >= 0 ? Position.Right : Position.Left;
  const verticalSide = distanceY >= 0 ? Position.Bottom : Position.Top;

  if (Math.abs(distanceX) >= 36 && Math.abs(distanceX) > Math.abs(distanceY) * 1.15) {
    return horizontalSide;
  }

  if (Math.abs(distanceY) >= 24) {
    return verticalSide;
  }

  if (Math.abs(distanceY) > Math.abs(distanceX) * 0.45) {
    return verticalSide;
  }

  if (Math.abs(distanceX) > 1) {
    return horizontalSide;
  }

  return estimatedSide;
}

function getMeasuredSlotEndpoint({
  nodeId,
  handleId,
  edgeSide,
  endpointOffset = 0,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: string;
  endpointOffset?: number;
}) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const geometry = publishedBoardGeometryById.get(nodeId);
  const cacheKey = [nodeId, handleId, edgeSide, endpointOffset, boardGeometryDimsKey(geometry)].join(
    "|",
  );
  const cachedRelative = relativeSlotEndpointCache.get(cacheKey);
  if (cachedRelative && geometry) {
    return offsetFlowPointForEdgeSide(
      { x: geometry.x + cachedRelative.x, y: geometry.y + cachedRelative.y },
      edgeSide,
      endpointOffset,
    );
  }

  // Node element first: with viewport culling the node is often simply not
  // mounted, and the slot lookups below are document-wide attribute scans that
  // would run (twice, across every handle on the board) just to find nothing.
  // A miss is deliberately not cached — the next render after the node mounts
  // should measure.
  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }
  const slotElement =
    findResourceEndpointElement(nodeElement, "[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement(nodeElement, "[data-resource-handle='true']", nodeId, handleId);
  if (!slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const screenPoint = getSlotRectEdgePoint(slotRect, edgeSide);
  const relative = slotScreenPointToNodeRelative(screenPoint, nodeElement, geometry);
  if (!relative) {
    return undefined;
  }

  if (geometry) {
    relativeSlotEndpointCache.set(cacheKey, relative);
    return offsetFlowPointForEdgeSide(
      { x: geometry.x + relative.x, y: geometry.y + relative.y },
      edgeSide,
      endpointOffset,
    );
  }
  return undefined;
}

/**
 * Converts a screen point inside a node to node-relative FLOW coordinates
 * using only the node's own rect and its published flow size.
 *
 * This deliberately avoids the viewport transform: on reload React Flow
 * applies the restored viewport mid-frame, so a transform cached moments
 * earlier no longer matches the rects being measured - and the poisoned
 * offset used to be cached under a dims key that never changes, leaving
 * every edge of that node anchored to nonsense until the node was deleted.
 * Two rects read in the same instant always share whatever transform (and
 * browser zoom) is live, so their ratio is timing-proof.
 */
function slotScreenPointToNodeRelative(
  point: { x: number; y: number },
  nodeElement: HTMLElement,
  geometry: { width: number; height: number } | undefined,
) {
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) {
    return undefined;
  }

  const nodeRect = nodeElement.getBoundingClientRect();
  if (nodeRect.width <= 0 || nodeRect.height <= 0) {
    return undefined;
  }

  const scaleX = nodeRect.width / geometry.width;
  const scaleY = nodeRect.height / geometry.height;
  return {
    x: (point.x - nodeRect.left) / scaleX,
    y: (point.y - nodeRect.top) / scaleY,
  };
}

function getMeasuredSlotCenter({ nodeId, handleId }: { nodeId: string; handleId?: string | null }) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const geometry = publishedBoardGeometryById.get(nodeId);
  const cacheKey = [nodeId, handleId, boardGeometryDimsKey(geometry)].join("|");
  const cachedRelative = relativeSlotCenterCache.get(cacheKey);
  if (cachedRelative && geometry) {
    return { x: geometry.x + cachedRelative.x, y: geometry.y + cachedRelative.y };
  }

  // Same ordering rationale as the endpoint lookup above; never memoize a
  // miss, the node may just be culled right now.
  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }
  const slotElement =
    findResourceEndpointElement(nodeElement, "[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement(nodeElement, "[data-resource-handle='true']", nodeId, handleId);
  if (!slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const relative = slotScreenPointToNodeRelative(
    { x: slotRect.left + slotRect.width / 2, y: slotRect.top + slotRect.height / 2 },
    nodeElement,
    geometry,
  );
  if (relative && geometry) {
    relativeSlotCenterCache.set(cacheKey, relative);
    return { x: geometry.x + relative.x, y: geometry.y + relative.y };
  }
  return undefined;
}

function getSlotRectEdgePoint(rect: DOMRect, edgeSide: string) {
  switch (edgeSide) {
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "left":
    default:
      return { x: rect.left, y: rect.top + rect.height / 2 };
  }
}

function offsetFlowPointForEdgeSide(
  point: { x: number; y: number },
  edgeSide: string,
  endpointOffset = 0,
) {
  switch (edgeSide) {
    case "top":
    case "bottom":
      return { x: point.x + endpointOffset, y: point.y };
    case "right":
    case "left":
    default:
      return { x: point.x, y: point.y + endpointOffset };
  }
}

function measureNodeElementBounds(nodeElement: HTMLElement) {
  const rect = nodeElement.getBoundingClientRect();
  const topLeft = screenToFlowPoint({ x: rect.left, y: rect.top }, nodeElement);
  const bottomRight = screenToFlowPoint({ x: rect.right, y: rect.bottom }, nodeElement);
  if (!topLeft || !bottomRight) {
    return undefined;
  }

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function screenToFlowPoint(point: { x: number; y: number }, element: HTMLElement) {
  const transform = getViewportTransform(element);
  if (!transform) {
    return undefined;
  }

  return {
    x: (point.x - transform.rendererLeft - transform.translateX) / transform.scaleX,
    y: (point.y - transform.rendererTop - transform.translateY) / transform.scaleY,
  };
}

/**
 * Reads the live viewport transform at most once per frame.
 *
 * `getComputedStyle(...).transform` forces a style recalculation, and this used
 * to run twice per node per edge — so a board with 40 nodes and 80 edges paid
 * over six thousand forced recalcs in a single frame.
 */
function getViewportTransform(element: HTMLElement) {
  if (viewportTransformCache) {
    return viewportTransformCache;
  }

  const root = element.closest<HTMLElement>(".react-flow");
  const viewport =
    element.closest<HTMLElement>(".react-flow__viewport") ??
    root?.querySelector<HTMLElement>(".react-flow__viewport");
  const renderer =
    element.closest<HTMLElement>(".react-flow__renderer") ??
    root?.querySelector<HTMLElement>(".react-flow__renderer");
  if (!viewport || !renderer) {
    return undefined;
  }

  const rendererRect = renderer.getBoundingClientRect();
  const matrix = parseCssMatrix(getComputedStyle(viewport).transform);
  viewportTransformCache = {
    rendererLeft: rendererRect.left,
    rendererTop: rendererRect.top,
    translateX: matrix.translateX,
    translateY: matrix.translateY,
    scaleX: matrix.scaleX,
    scaleY: matrix.scaleY,
  };
  scheduleViewportTransformClear();
  return viewportTransformCache;
}

function parseCssMatrix(transform: string) {
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  const values = transform
    .match(/matrix(?:3d)?\(([^)]+)\)/)?.[1]
    ?.split(",")
    .map((value) => Number.parseFloat(value.trim()));

  if (!values || values.some((value) => !Number.isFinite(value))) {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  if (values.length === 16) {
    return {
      scaleX: values[0] || 1,
      scaleY: values[5] || values[0] || 1,
      translateX: values[12] ?? 0,
      translateY: values[13] ?? 0,
    };
  }

  return {
    scaleX: values[0] || 1,
    scaleY: values[3] || values[0] || 1,
    translateX: values[4] ?? 0,
    translateY: values[5] ?? 0,
  };
}

function findResourceEndpointElement(
  scope: ParentNode,
  selector: string,
  nodeId: string,
  handleId: string,
) {
  return scope.querySelector<HTMLElement>(
    `${selector}[data-resource-node-id="${cssEscape(nodeId)}"][data-resource-handle-id="${cssEscape(
      handleId,
    )}"]`,
  );
}

function scheduleViewportTransformClear() {
  if (viewportTransformClearScheduled || typeof window === "undefined") {
    viewportTransformCache = undefined;
    return;
  }

  viewportTransformClearScheduled = true;
  window.requestAnimationFrame(() => {
    viewportTransformCache = undefined;
    viewportTransformClearScheduled = false;
  });
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function isPointerOverIncompatibleFlowHandle(
  project: FactoryProject,
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection,
) {
  const position = getClientPosition(event);
  if (!position || typeof document === "undefined") {
    return false;
  }

  return document.elementsFromPoint(position.x, position.y).some((element) => {
    const handleElement = element.closest<HTMLElement>(".react-flow__handle");
    if (!handleElement) {
      return false;
    }

    const resourceHandle = readResourceHandleElement(handleElement);
    if (!resourceHandle) {
      return true;
    }

    return !isCompatibleDraggedResourceTarget(project, draggedResource, resourceHandle);
  });
}

function getResourceHandleAtPointer(event: MouseEvent | TouchEvent) {
  const position = getClientPosition(event);
  return getResourceHandleAtPosition(position, event);
}

function getResourceHandleAtPosition(
  position: { x: number; y: number } | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || typeof document === "undefined") {
    return undefined;
  }

  const geometricMatch = findResourceHandleByGeometry(position);
  if (geometricMatch) {
    return geometricMatch;
  }

  if (estimatedEvent) {
    for (const element of document.elementsFromPoint(position.x, position.y)) {
      const match = readResourceHandleElement(
        element.closest<HTMLElement>("[data-resource-handle='true']"),
      );
      if (match) {
        return match;
      }
    }
  }

  return undefined;
}

function findResourceHandleByGeometry(position: { x: number; y: number }) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const matches = [...document.querySelectorAll<HTMLElement>("[data-resource-handle='true']")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (
        position.x < rect.left ||
        position.x > rect.right ||
        position.y < rect.top ||
        position.y > rect.bottom
      ) {
        return undefined;
      }

      const handle = readResourceHandleElement(element);
      if (!handle) {
        return undefined;
      }

      return {
        handle,
        area: rect.width * rect.height,
      };
    })
    .filter(
      (
        match,
      ): match is { handle: ReturnType<typeof readResourceHandleElement> & {}; area: number } =>
        Boolean(match),
    )
    .sort((left, right) => left.area - right.area);

  return matches[0]?.handle;
}

function readResourceHandleElement(element: HTMLElement | null) {
  const nodeId = element?.dataset.resourceNodeId;
  const handleId = element?.dataset.resourceHandleId;
  const handle = parseResourceHandleId(handleId);

  if (nodeId && handleId && handle) {
    return {
      nodeId,
      handleId,
      side: handle.side,
      kind: handle.kind,
      resourceId: handle.resourceId,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

/**
 * Would a drop on this handle DO something? The three cards that take a wire
 * on terms of their own answer for themselves; everything else has to be a
 * resource match.
 */
function isUsableDropTarget(
  project: FactoryProject,
  draggedResource: DraggedResourceConnection,
  handle: ResolvedResourceHandle,
) {
  if (handle.nodeId === draggedResource.nodeId) {
    // A machine wired into itself is legitimate, but only through a real slot
    // match, which the compatibility check below decides.
    return isCompatibleDraggedResourceTarget(project, draggedResource, handle);
  }

  const draggingUniversalPort =
    draggedResource.id === TRASH_ANY_RESOURCE_ID ||
    draggedResource.id === CUSTOM_RATE_ANY_RESOURCE_ID;

  if (handle.resourceId === TRASH_ANY_RESOURCE_ID) {
    // A can only ever drinks, so the far end has to be something being made.
    return !draggingUniversalPort && draggedResource.side === "output";
  }

  if (isCustomRateNodeId(project, handle.nodeId)) {
    return !draggingUniversalPort;
  }

  return isCompatibleDraggedResourceTarget(project, draggedResource, handle);
}

function isCompatibleDraggedResourceTarget(
  project: FactoryProject,
  draggedResource: DraggedResourceConnection,
  targetHandle: ResolvedResourceHandle,
) {
  const targetResource = getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

  if (!targetResource) {
    return false;
  }

  // A drawer's drag fits either kind of slot, because the slot decides which
  // way the wire runs. Everything else still has to land on the opposite side
  // from the one it left.
  const sidesFit = draggedResource.bidirectional || draggedResource.side !== targetHandle.side;

  return (
    sidesFit &&
    (targetHandle.side === "input"
      ? resourceMatchesInput(draggedResource, targetResource)
      : resourceMatchesInput(targetResource, draggedResource))
  );
}

function getStorageHandleAtPointer(
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection | undefined,
) {
  const position = getClientPosition(event);
  return getStorageHandleAtPosition(position, draggedResource, event);
}

function getStorageHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || !draggedResource || typeof document === "undefined") {
    return undefined;
  }

  const storageElements = [
    ...document.querySelectorAll<HTMLElement>("[data-storage-node-id]"),
    ...(estimatedEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-storage-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const storageElement of storageElements) {
    const rect = storageElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = storageElement?.dataset.storageNodeId;
    const kind = storageElement?.dataset.storageKind;
    const resourceId = storageElement?.dataset.storageResourceId;

    if (
      nodeId &&
      resourceId &&
      nodeId !== draggedResource.nodeId &&
      (kind === "item" || kind === "fluid") &&
      (draggedResource.side === "input"
        ? resourceMatchesInput({ kind, id: resourceId }, draggedResource)
        : resourceMatchesInput(draggedResource, { kind, id: resourceId }))
    ) {
      const side = draggedResource.side === "output" ? "input" : "output";
      return {
        nodeId,
        handleId: `${side}:${kind}:${encodeURIComponent(resourceId)}`,
        side,
        kind,
        resourceId,
      } satisfies ResolvedResourceHandle;
    }
  }

  return undefined;
}

/**
 * Drops anywhere on a trash card resolve to its universal drink-here port.
 * Only outputs qualify — a dragged INPUT looking for a supplier can't dock
 * on a can — and the whole card counts, so a drop landing on the frame or
 * header voids the line instead of spawning a tank on top of the can.
 */
function getTrashHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (
    !position ||
    !draggedResource ||
    draggedResource.side !== "output" ||
    draggedResource.id === TRASH_ANY_RESOURCE_ID ||
    draggedResource.id === CUSTOM_RATE_ANY_RESOURCE_ID ||
    typeof document === "undefined"
  ) {
    return undefined;
  }

  const trashElements = [
    ...document.querySelectorAll<HTMLElement>("[data-trash-node-id]"),
    ...(estimatedEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-trash-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const trashElement of trashElements) {
    const rect = trashElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = trashElement.dataset.trashNodeId;
    if (!nodeId || nodeId === draggedResource.nodeId) {
      continue;
    }

    return {
      nodeId,
      handleId: `input:item:${encodeURIComponent(TRASH_ANY_RESOURCE_ID)}`,
      side: "input",
      kind: "item",
      resourceId: TRASH_ANY_RESOURCE_ID,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

/**
 * The whole card is the port. Aiming at a slot is still the precise way to
 * wire a specific alternative, so the cascade in `handleConnectEnd` tries the
 * exact handles first — this only catches drops that landed on the frame, the
 * header, the machine art, anywhere. If the card takes the resource at all,
 * the drop lands on the slot that takes it.
 */
function getNodeCardHandleAtPosition(
  project: FactoryProject,
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
) {
  const nodeId = getBoardNodeIdAtPosition(position);
  return nodeId && draggedResource
    ? findNodeDropTarget(project, nodeId, draggedResource)
    : undefined;
}

/**
 * The wireable board card under the pointer. Annotations are excluded on
 * purpose: they are backdrops, often larger than the cluster they frame, and
 * treating one as a card would swallow every drop made over it.
 */
function getBoardNodeIdAtPosition(position: { x: number; y: number } | undefined) {
  if (!position || typeof document === "undefined") {
    return undefined;
  }

  for (const element of document.elementsFromPoint(position.x, position.y)) {
    const nodeElement = element.closest<HTMLElement>(".react-flow__node");
    if (nodeElement?.dataset.id && !isAnnotationNodeElement(nodeElement)) {
      return nodeElement.dataset.id;
    }
  }

  // elementsFromPoint reads the live stacking context, which synthetic events
  // do not always produce; fall back to the smallest card containing the point.
  let best: { id: string; area: number } | undefined;
  for (const element of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
    const id = element.dataset.id;
    if (!id || isAnnotationNodeElement(element)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const area = rect.width * rect.height;
    if (!best || area < best.area) {
      best = { id, area };
    }
  }

  return best?.id;
}

function isAnnotationNodeElement(element: HTMLElement) {
  return element.classList.contains("react-flow__node-annotationNode");
}

/**
 * Which port on `nodeId` a drop of `draggedResource` should land on, or
 * undefined when that card cannot take it. This is the single source of truth
 * for both the drop cascade and the green/red wash painted during the drag, so
 * a card can never read green and then refuse the wire.
 */
function findNodeDropTarget(
  project: FactoryProject,
  nodeId: string,
  draggedResource: DraggedResourceConnection,
): ResolvedResourceHandle | undefined {
  // A drawer's drag asks "what does this item connect to", not "what feeds
  // me": try the card as a CONSUMER first (the drawer feeds it, the commoner
  // intent), and if it does not eat the item, try it as a maker. A card that
  // does both - a recycler eating and making the same thing - takes the first,
  // and a drop aimed at an actual slot overrules this anyway.
  if (draggedResource.bidirectional) {
    return (
      findNodeDropTargetOnSide(project, nodeId, draggedResource, "input") ??
      findNodeDropTargetOnSide(project, nodeId, draggedResource, "output")
    );
  }
  return findNodeDropTargetOnSide(
    project,
    nodeId,
    draggedResource,
    draggedResource.side === "output" ? "input" : "output",
  );
}

function findNodeDropTargetOnSide(
  project: FactoryProject,
  nodeId: string,
  draggedResource: DraggedResourceConnection,
  side: ResourceHandleSide,
): ResolvedResourceHandle | undefined {
  const accepts = (candidate: Pick<ResourceAmount, "kind" | "id" | "alternatives">) =>
    side === "input"
      ? resourceMatchesInput(draggedResource, candidate)
      : resourceMatchesInput(candidate, draggedResource);
  const port = (resource: Pick<ResourceAmount, "kind" | "id">): ResolvedResourceHandle => ({
    nodeId,
    handleId: makeResourceHandleId(side, resource),
    side,
    kind: resource.kind,
    resourceId: resource.id,
  });

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    const held = { kind: storage.kind, id: storage.resourceId };
    return accepts(held) ? port(held) : undefined;
  }

  // The whole pocket card is the port, same as a machine card: if any member
  // inside takes the resource, the drop lands on that resource's pocket port
  // and fans out to every member behind it.
  if (isPocketId(project, nodeId)) {
    if (
      draggedResource.id === TRASH_ANY_RESOURCE_ID ||
      draggedResource.id === CUSTOM_RATE_ANY_RESOURCE_ID
    ) {
      return undefined;
    }
    const match = listPocketPortResources(project, nodeId, side).find((candidate) =>
      accepts(candidate),
    );
    return match ? port(match) : undefined;
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  // A universal port is a socket, not a resource: it can receive a concrete
  // drag but never starts one that another universal port could answer.
  const draggingUniversalPort =
    draggedResource.id === TRASH_ANY_RESOURCE_ID ||
    draggedResource.id === CUSTOM_RATE_ANY_RESOURCE_ID;

  if (isTrashRecipe(recipe)) {
    // A can drinks outputs and nothing else — a dragged input looking for a
    // supplier has no business docking on one.
    return draggedResource.side === "output" && !draggingUniversalPort
      ? {
          nodeId,
          handleId: makeResourceHandleId("input", { kind: "item", id: TRASH_ANY_RESOURCE_ID }),
          side: "input",
          kind: "item",
          resourceId: TRASH_ANY_RESOURCE_ID,
        }
      : undefined;
  }

  const contextualRecipe = getEffectiveNodeRecipe(recipe, node);

  // A custom rate card takes anything. Unset, it shows the two universal
  // sockets and the drop lands on those; set, the drop lands on the port it is
  // already showing and the card adopts the new resource in place of the old.
  // Only the side it faces answers: a card that supplies can be asked for
  // something, not fed something. Turning it round is the dial's job.
  if (isCustomRateRecipe(recipe)) {
    if (draggingUniversalPort) {
      return undefined;
    }
    const slot = getCustomRateSlot(contextualRecipe);
    if (!slot) {
      return port({ kind: "item", id: CUSTOM_RATE_ANY_RESOURCE_ID });
    }
    return slot.mode === (side === "output" ? "supply" : "request")
      ? port({ kind: slot.resource.kind, id: slot.resource.id })
      : undefined;
  }

  if (draggingUniversalPort) {
    return undefined;
  }

  const candidates = side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;
  const match = (candidates ?? []).find(
    (candidate) =>
      (side === "output" || isRecipeInputConsumed(candidate)) && accepts(candidate),
  );

  return match ? port(match) : undefined;
}

/**
 * Board-wide drag feedback: every card wears the answer to "would this drop
 * work?" as a data attribute, and rules in globals.css paint the wash. This
 * deliberately never touches React — a hover/drag effect that re-renders every
 * node costs multiples of the frame budget (see ARCHITECTURE.md).
 *
 * `onlyUnpainted` is the per-frame pass: auto-pan mounts fresh cards mid-drag,
 * and those are the only ones still missing a verdict.
 */
function paintNodeDropFit(
  project: FactoryProject,
  draggedResource: DraggedResourceConnection | undefined,
  onlyUnpainted: boolean,
) {
  if (typeof document === "undefined" || !draggedResource) {
    return;
  }

  const selector = onlyUnpainted
    ? ".react-flow__node:not([data-drop-fit])"
    : ".react-flow__node";

  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const id = element.dataset.id;
    if (!id) {
      continue;
    }

    // Backdrops stay out of it entirely — no wash, and no snapping the pipe
    // to them. They are still marked so the per-frame pass has nothing left
    // to look at.
    if (isAnnotationNodeElement(element)) {
      element.dataset.dropFit = "none";
      continue;
    }

    let target = activeDropTargets.get(id);
    if (target === undefined) {
      target = findNodeDropTarget(project, id, draggedResource) ?? null;
      activeDropTargets.set(id, target);
    }

    // A machine that eats what it makes can be wired into itself, so the card
    // the wire came from is a real candidate now. It only ever reads green:
    // washing your own card red on every drag that goes nowhere near it would
    // be the board shouting about a wire you never aimed there.
    if (id === draggedResource.nodeId && !target) {
      element.dataset.dropFit = "none";
      continue;
    }

    const verdict = target ? "yes" : "no";
    if (element.dataset.dropFit !== verdict) {
      element.dataset.dropFit = verdict;
    }
  }
}

function clearNodeDropFit() {
  activeDropTargets.clear();

  if (typeof document === "undefined") {
    return;
  }

  for (const element of document.querySelectorAll<HTMLElement>("[data-drop-fit]")) {
    delete element.dataset.dropFit;
  }
}

/**
 * Where the dragged pipe should actually end. Once the pointer is anywhere
 * over a card that takes the resource, the wire commits to the slot it will
 * land on instead of trailing the cursor until it reaches that slot — the same
 * "the whole card is the port" rule the drop follows, made visible.
 *
 * The hit test runs in FLOW space against published geometry, never the DOM,
 * so it is identical at any zoom and does not care which cards are mounted.
 * It walks only the cards that would accept the drop, which on any real board
 * is a small fraction of them.
 */
function getConnectionSnap(toX: number, toY: number) {
  let best: { target: ResolvedResourceHandle; area: number } | undefined;

  for (const [nodeId, target] of activeDropTargets) {
    if (!target) {
      continue;
    }

    const geometry = publishedBoardGeometryById.get(nodeId);
    if (
      !geometry ||
      toX < geometry.x ||
      toX > geometry.x + geometry.width ||
      toY < geometry.y ||
      toY > geometry.y + geometry.height
    ) {
      continue;
    }

    // Smallest card wins, the same tie-break the slot hit-tests use.
    const area = geometry.width * geometry.height;
    if (!best || area < best.area) {
      best = { target, area };
    }
  }

  if (!best) {
    return undefined;
  }

  const point = getMeasuredSlotEndpoint({
    nodeId: best.target.nodeId,
    handleId: best.target.handleId,
    edgeSide: best.target.side === "input" ? "left" : "right",
  });

  return point ? { point, side: best.target.side } : undefined;
}

function brightenHexColor(color: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const lift = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount));
  const r = lift((value >> 16) & 0xff);
  const g = lift((value >> 8) & 0xff);
  const b = lift(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Pushes every channel away from the pixel's grey point, which raises
// saturation without shifting hue or overall lightness.
function saturateHexColor(color: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const push = (channel: number) =>
    Math.min(255, Math.max(0, Math.round(grey + (channel - grey) * (1 + amount))));
  return `#${((push(r) << 16) | (push(g) << 8) | push(b)).toString(16).padStart(6, "0")}`;
}

function getInitialResourceColor(resource: ResourceEdgeData["resource"]) {
  return (
    resource.dominantColor ??
    resource.iconAtlas?.dominantColor ??
    (resource.kind === "fluid" ? DEFAULT_FLUID_EDGE_COLOR : DEFAULT_ITEM_EDGE_COLOR)
  );
}

/**
 * Arclength position of the nearest point on the polyline to `target` —
 * where along the wire a click or a dot sits, for keeping waypoints in
 * route order.
 */
function polylineArcPositionOf(
  points: Array<{ x: number; y: number }>,
  target: { x: number; y: number },
): number {
  let bestDistance = Infinity;
  let bestPosition = 0;
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) {
      continue;
    }
    const t = Math.min(
      Math.max(((target.x - a.x) * dx + (target.y - a.y) * dy) / (length * length), 0),
      1,
    );
    const distance = Math.hypot(target.x - (a.x + dx * t), target.y - (a.y + dy * t));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = walked + length * t;
    }
    walked += length;
  }
  return bestPosition;
}

/**
 * How far a chevron sits back from a wire's endpoint. The final stretch of a
 * wire is tucked at the card border — under the card in thickness mode — so
 * an arrow at the anchor was half-buried. Half a cell of air is enough to
 * clear the frame while staying snug against the card.
 */
const ARROW_SETBACK = 10;

/**
 * When a double-press removes a waypoint dot, the gesture's trailing
 * native dblclick lands on whatever wire sits under the vanished dot —
 * often a DIFFERENT edge, whose spawn handler would pin a fresh dot right
 * back. Module-wide so every edge shares the suppression window.
 */
let lastWaypointRemovalAt = 0;

/**
 * Direction chevrons along a routed wire, as SVG polyline point strings.
 * One near each end (source and target) when the route is long enough, one
 * in the middle when it is not. Sized to the stroke: wider than a thin wire
 * (a regular little arrow), capped so it fits INSIDE a full-lane pipe.
 */
function getRouteChevrons(
  points: Array<{ x: number; y: number }>,
  strokeWidth: number,
): string[] {
  const segments = getPolylineSegments(points);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total < 24) {
    return [];
  }

  // Two regimes: a thin wire wears a regular little arrow wider than
  // itself; a pipe wide enough to hold one gets a chevron sized to sit
  // INSIDE with clear water on both sides — not rubbing the pipe walls.
  const halfWidth =
    strokeWidth >= 7 ? Math.max(2.8, Math.min(strokeWidth * 0.3, 5)) : 3.5;
  const length = halfWidth * 1.6;

  // The point and travel direction at `distance` along the polyline.
  const at = (distance: number): { x: number; y: number; dx: number; dy: number } => {
    let walked = 0;
    for (const segment of segments) {
      if (walked + segment.length >= distance || segment === segments[segments.length - 1]) {
        const t = Math.min(Math.max((distance - walked) / segment.length, 0), 1);
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * t,
          y: segment.start.y + (segment.end.y - segment.start.y) * t,
          dx: (segment.end.x - segment.start.x) / segment.length,
          dy: (segment.end.y - segment.start.y) / segment.length,
        };
      }
      walked += segment.length;
    }
    const lastPoint = points[points.length - 1];
    return { x: lastPoint.x, y: lastPoint.y, dx: 1, dy: 0 };
  };

  const chevronAt = (tipDistance: number): string => {
    const { x, y, dx, dy } = at(tipDistance);
    const backX = x - dx * length;
    const backY = y - dy * length;
    // Perpendicular wings behind the tip.
    const wingX = -dy * halfWidth;
    const wingY = dx * halfWidth;
    return `${backX + wingX},${backY + wingY} ${x},${y} ${backX - wingX},${backY - wingY}`;
  };

  // Short wire: one chevron at the middle says everything there is room for.
  if (total < 2 * ARROW_SETBACK + 3 * length) {
    return [chevronAt(total / 2 + length / 2)];
  }
  return [chevronAt(ARROW_SETBACK + length), chevronAt(total - ARROW_SETBACK)];
}

function isCompatibleResourceConnection(
  project: FactoryProject,
  connection: Connection | Edge,
): boolean {
  const sourceHandle = parseResourceHandleId(connection.sourceHandle);
  const targetHandle = parseResourceHandleId(connection.targetHandle);
  if (!sourceHandle || !targetHandle) {
    return false;
  }

  // Trash cans drink any concrete resource, but only from an OUTPUT.
  const sourceIsTrash = sourceHandle.resourceId === TRASH_ANY_RESOURCE_ID;
  const targetIsTrash = targetHandle.resourceId === TRASH_ANY_RESOURCE_ID;
  if (sourceIsTrash || targetIsTrash) {
    if (sourceIsTrash && targetIsTrash) {
      return false;
    }
    const farSide = sourceIsTrash ? targetHandle.side : sourceHandle.side;
    if (farSide !== "output") {
      return false;
    }
    const farNodeId = sourceIsTrash ? connection.target : connection.source;
    const farHandleId = sourceIsTrash ? connection.targetHandle : connection.sourceHandle;
    return Boolean(
      farNodeId && farHandleId && getResourceForHandle(project, farNodeId, farHandleId),
    );
  }

  // A custom rate card accepts any concrete resource on the far end, whether
  // it is holding one already or not.
  const sourceIsCustom = isCustomRateNodeId(project, connection.source);
  const targetIsCustom = isCustomRateNodeId(project, connection.target);
  if (sourceIsCustom || targetIsCustom) {
    if (sourceIsCustom && targetIsCustom) {
      return false;
    }
    if (sourceHandle.side === targetHandle.side) {
      return false;
    }
    const machineNodeId = sourceIsCustom ? connection.target : connection.source;
    const machineHandleId = sourceIsCustom ? connection.targetHandle : connection.sourceHandle;
    return Boolean(
      machineNodeId &&
        machineHandleId &&
        getResourceForHandle(project, machineNodeId, machineHandleId),
    );
  }

  const sourceResource =
    connection.source && connection.sourceHandle
      ? getResourceForHandle(project, connection.source, connection.sourceHandle)
      : undefined;
  const targetResource =
    connection.target && connection.targetHandle
      ? getResourceForHandle(project, connection.target, connection.targetHandle)
      : undefined;

  if (!sourceResource || !targetResource) {
    return false;
  }

  const output = sourceHandle.side === "output" ? sourceResource : targetResource;
  const input = sourceHandle.side === "input" ? sourceResource : targetResource;

  return sourceHandle.side !== targetHandle.side && resourceMatchesInput(output, input);
}

function getDraggedResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): DraggedResourceConnection | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  // A pocket port drags like a machine port. The card keeps its own id as
  // the drag origin — the fan-out onto the members behind the port happens
  // when the wire lands, in connectResourceEdges.
  if (isPocketId(project, nodeId)) {
    const resource = getPocketResourceForHandle(project, nodeId, handle.side, {
      kind: handle.kind,
      id: handle.resourceId,
    });
    if (!resource) {
      return undefined;
    }
    return {
      nodeId,
      side: handle.side,
      handleId,
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName,
      iconPath: resource.iconPath,
      iconAtlas: resource.iconAtlas,
      dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
      tooltip: resource.tooltip,
      alternatives: resource.alternatives,
    };
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      nodeId,
      side: handle.side,
      handleId,
      // The whole drawer is one grab point and it holds one item, so the drag
      // is a question about that item rather than about a direction. Whatever
      // it lands on answers it.
      bidirectional: true,
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getEffectiveNodeRecipe(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;
  const resource = resources.find(
    (entry) => entry.kind === handle.kind && entry.id === handle.resourceId,
  );
  if (!resource || (handle.side === "input" && !isRecipeInputConsumed(resource))) {
    return undefined;
  }

  return {
    nodeId,
    side: handle.side,
    handleId,
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
    tooltip: resource.tooltip,
    alternatives: resource.alternatives,
  };
}

function getResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): ResourceAmount | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  if (isPocketId(project, nodeId)) {
    return getPocketResourceForHandle(project, nodeId, handle.side, {
      kind: handle.kind,
      id: handle.resourceId,
    });
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      kind: storage.kind,
      id: storage.resourceId,
      amount: 1,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getEffectiveNodeRecipe(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;

  return resources?.find((entry) => entry.kind === handle.kind && entry.id === handle.resourceId);
}

function getClientPosition(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return undefined;
}

function getExportImageSize(graphSize: number) {
  if (!Number.isFinite(graphSize) || graphSize <= 0) {
    return EXPORT_IMAGE_PADDING * 2;
  }

  return Math.ceil(graphSize + EXPORT_IMAGE_PADDING * 2);
}

function getExportPngPixelRatio(imageWidth: number, imageHeight: number) {
  const maxSide = Math.max(imageWidth, imageHeight);
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return EXPORT_PNG_PIXEL_RATIO;
  }

  return Math.min(EXPORT_PNG_PIXEL_RATIO, EXPORT_PNG_MAX_PIXEL_SIDE / maxSide);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dispatchImageExportComplete(requestId: string, dataUrl?: string) {
  window.dispatchEvent(
    new CustomEvent(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, {
      detail: { requestId, dataUrl },
    }),
  );
}

/**
 * Downscales a full board capture into a share-card thumbnail, shrinking
 * until it fits the upload limit so big factories don't silently lose their
 * preview image.
 */
async function makeThumbnailDataUrl(blob: Blob, maxBytes = 380_000): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const attempts: Array<{ maxSide: number; quality: number }> = [
      { maxSide: 720, quality: 0.82 },
      { maxSide: 560, quality: 0.72 },
      { maxSide: 420, quality: 0.62 },
      { maxSide: 320, quality: 0.5 },
    ];

    let smallest: string | undefined;
    for (const { maxSide, quality } of attempts) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context unavailable");
      }

      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= maxBytes) {
        return dataUrl;
      }
      smallest = dataUrl;
    }

    if (!smallest) {
      throw new Error("Thumbnail encode produced no image");
    }
    return smallest;
  } finally {
    bitmap.close();
  }
}

function getEdgeResource(
  project: FactoryProject,
  edge: FactoryEdge,
): Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
> {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const output = sourceRecipe?.outputs.find(
    (resource) => resource.kind === edge.resourceKind && resource.id === edge.resourceId,
  );
  const storage = sourceStorage ?? targetStorage;

  return {
    kind: edge.resourceKind,
    id: edge.resourceId,
    amount: 1,
    displayName: output?.displayName ?? storage?.displayName ?? edge.label,
    iconPath: output?.iconPath ?? storage?.iconPath,
    iconAtlas: output?.iconAtlas ?? storage?.iconAtlas,
    dominantColor:
      output?.dominantColor ??
      storage?.dominantColor ??
      output?.iconAtlas?.dominantColor ??
      storage?.iconAtlas?.dominantColor,
  };
}

function edgeMatchesSearch(
  edge: FactoryEdge,
  resource: Pick<ResourceAmount, "id" | "displayName">,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${resource.displayName ?? ""} ${resource.id} ${edge.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function recipeContainsResourceKey(recipe: Recipe | undefined, resourceKey: string) {
  if (!recipe) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function exportNodeFilter(domNode: HTMLElement) {
  const element = domNode instanceof Element ? domNode : undefined;

  return !(
    element?.classList.contains("react-flow__edgeupdater") ||
    element?.classList.contains("react-flow__selection") ||
    element?.classList.contains("react-flow__nodesselection") ||
    element?.classList.contains("react-flow__handle")
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
