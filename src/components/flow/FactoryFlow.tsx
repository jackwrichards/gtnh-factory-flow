"use client";

import { ChecklistKeys, useChecklistBoard, checklistCursorStyle } from "./ChecklistMode";

import { emitBoardCameraMove } from "@/lib/board-camera-signal";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { useViewerLock } from "./use-viewer-lock";
import { StorageRatioEditor } from "./StorageRatioEditor";
import { LivePresenceLayer } from "./LivePresenceLayer";
import { isLiveConfigured } from "@/lib/live/live-config";
import { PoolWorksheet } from "../pool/PoolWorksheet";
import { capturePoolWorksheet } from "../export/capture-pool-worksheet";
import { formatRatioShare, getProjectRatioBranches } from "@/lib/model/storage-ratios";
import { labelRatioArrows, layoutRatioLabels, type RatioWireLabel } from "./ratio-label-layout";
import { RatioWireLabel as RatioWireLabelControl } from "./RatioWireLabel";

import {
  BaseEdge,
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
  useKeyPress,
  useStore,
  useStoreApi,
} from "@xyflow/react";
// React Flow's portals, with their target looked up once rather than on every store change.
import { FlowEdgeLabelPortal as EdgeLabelRenderer, FlowViewportPortal as ViewportPortal } from "./virtual/flow-portals";
import { toBlob, toSvg } from "html-to-image";
import {
  Activity,
  AlignJustify,
  AppWindow,
  Ban,
  Box,
  Combine,
  Grid2x2,
  Eye,
  Focus,
  Gauge,
  Grid3x3,
  Grip,
  Hammer,
  Hexagon,
  ImagePlus,
  LoaderCircle,
  Magnet,
  Minus,
  MoveUpRight,
  Network,
  Paintbrush,
  Pencil,
  Plus,
  Redo2,
  Square,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useDeferredValue,
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
  type FlowExportCapture,
  type FlowExportRequest,
} from "@/lib/import-export/plan-image";
import { resolveExportFontCss } from "@/lib/import-export/export-fonts";
import {
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "@/lib/model";
import { fetchLitresPerCell } from "@/lib/datasets/cell-ratio";
import { BoardContextMenu, type BoardMenuTarget } from "./BoardContextMenu";
import { listPoolCellPairs } from "@/lib/solver/pool-mode";
import "./pool-mode.css";
import "./scroll-camera.css";
import "./node-containment.css";
import { ScrollCamera } from "./scroll-camera";
import {
  getEffectiveNodeRecipe,
  isPocketId,
} from "@/lib/model/pocket-connections";
import type {
  EdgeThroughput,
  FactoryAnnotationKind,
  FactoryEdge,
  FactoryNode,
  FactoryNodeColorTag,
  FactoryPocket,
  FactoryProject,
  FactoryStorage,
  Recipe,
  ResourceAmount,
  ResourceKind,
  ThroughputResult,
} from "@/lib/model/types";
import {
  captureBoardSelection,
  findToggleDuplicateEdge,
  useFactoryStore,
  wouldConnectionStorageSpawn,
  type BoardClipboardPayload,
  type BoardFraming,
} from "@/store/factory-store";
import { PlanConversionNotice } from "./PlanConversionNotice";
import { dropFilesOnPlanBoard } from "@/lib/import-export/open-plan-file";
import { getStorageRoles } from "@/lib/model/storage-role";
import { useBlueprintStore } from "@/store/blueprint-store";
import {
  playBoardSound,
} from "@/lib/board-sounds";
import { projectSoundFingerprint } from "./use-board-sound-effects";
import { useDesignStore } from "@/store/design-store";
import { useSolvingBooks } from "./use-solving-books";
import {
  isDesignCameraSettled,
  settleDesignCamera,
  writeDesignCamera,
  type BoardCamera,
} from "@/lib/designs/design-camera";
import { isEditableKeyboardTarget, listenForBoardInput } from "./keyboard";
import {
  didBoardTimelapseEndHeld,
  getBoardTimelapseCameraMode,
  getBoardTimelapseCameraPace,
  getBoardTimelapseCineZoom,
  getBoardTimelapseHoldEnding,
  getBoardTimelapsePopMs,
  getBoardTimelapseSnapshot,
  getBoardTimelapseWireDrawMs,
  getBoardTimelapseZoomRange,
  getServerBoardTimelapseSnapshot,
  reportTimelapseCameraProgress,
  stopBoardTimelapse,
  subscribeBoardTimelapse,
} from "./board-timelapse";
import {
  boardTiltCoverScale,
  boardTiltVisibleFraction,
  getBoardTiltSnapshot,
  getServerBoardTiltSnapshot,
  subscribeBoardTilt,
} from "./board-tilt";
import { BoardHelp } from "./BoardHelp";
import { PerfHud } from "./PerfHud";
import {
  ANNOTATION_DEFAULT_ARROW,
  ANNOTATION_DEFAULT_BOX,
  ANNOTATION_DEFAULT_TEXT,
  ANNOTATION_MIN_ARROW,
  ANNOTATION_MIN_BOX,
  ANNOTATION_MIN_TEXT,
  BOARD_GRID,
  BOARD_WINDOW_DEFAULT_SIZE,
  BOARD_WINDOW_FIT_PAD,
  BOARD_WINDOW_MIN_HEIGHT,
  BOARD_WINDOW_MIN_WIDTH,
  BOARD_WINDOW_TITLE_HEIGHT,
  PICTURE_MIN_HEIGHT,
  RECIPE_NODE_WIDTH,
  STORAGE_NODE_HEIGHT,
  STORAGE_NODE_WIDTH,
  TRASH_NODE_HEIGHT,
  TRASH_NODE_WIDTH,
  cells,
  snapPositionToGrid,
  snapSizeUpToGrid,
} from "@/lib/board-grid";
import {
  arrangeBoard,
  type ArrangeCard,
  type ArrangeTaste,
  type ArrangeWire,
} from "@/lib/board-arrange";
import {
  BOARD_CAMERA_DURATION,
  boardCameraMaxZoom,
  BOARD_CAMERA_PADDING,
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  cardRect,
  framingRect,
  rectCentre,
  zoomForRect,
  type BoardRect,
} from "./board-camera";
import { type RecipeFlowNode } from "./RecipeNode";
import { RecipeNodeSwitch } from "./clean/CleanRecipeNode";
import { StorageNodeSwitch } from "./clean/drawer/CleanStorageNode";
import { CleanDrawerFace } from "./clean/drawer/CleanDrawer";
import { PlanNoticeSwitch, PlanTopNotices } from "./clean/rail/NoticeBar";
import { registerBoardCommands, reportArrange } from "../chrome/board-commands";
import { BoardMinimap } from "./clean/minimap/BoardMinimap";
import { registerMinimapRoutes } from "./clean/minimap/minimap-feed";
import { FeedbackHost } from "./clean/feedback/FeedbackPanel";
import { TourBridge, TourHost, TourOffer } from "./clean/tour";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE, flowRampColor } from "./node-colors";
import {
  CANVAS_PATTERNS,
  CANVAS_PATTERN_LABEL,
  readBoardViewSnapshot,
  useBoardView,
  writeBoardView,
  type BoardView,
  type CanvasPattern,
  type GlanceMode,
} from "./board-view";
import { CANVAS_THEMES, getCanvasTheme, type CanvasTheme } from "./canvas-themes";
import { GrainBackground, RuledBackground, TiledBackground } from "./board-pattern";
import {
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
  sectionHandleId,
} from "./resource-handles";
import { listNodeSections, sectionNodeView, splitSectionHandleId } from "@/lib/model/shared-machine";
import { CleanVerdictLine } from "./clean/interaction/CleanVerdictLine";
import { COMBINE_DEPS } from "./clean/interaction/combine-deps";
import { canCombineSelection, COMBINE_TIP } from "./clean/interaction/selection";
import { tipAttrs } from "./clean/interaction/tip-spec";
import {
  isEdgeStarved,
} from "./edge-labels";
import { RecipeAddChips } from "@/components/RecipeAddChip";
import {
  LANE_CAPACITY,
  laneWidthForHeat,
  solveGridRoutes,
  type GridEndpoint,
  type GridRouteRequest,
  type GridObstacle,
  type GridRoutedEdge,
  measureRoutes,
} from "./grid-edge-router";
import { getRouterTuning, routerTuningKey, subscribeRouterTuning } from "./router-tuning";
import { proxyPath } from "@/lib/board-arrange-optimize";
import { routePoints } from "@/lib/route-metrics";
import { registerBoardGeometryReader, registerBoardScoreReader } from "./board-score";
import { flattenBoards } from "@/lib/model/flatten-boards";
import {
  ARRANGE_STEPS,
  ArrangeCancelled,
  arrangeInWorker,
  cancelArrange,
  type ArrangeProgress,
} from "@/lib/arrange-solve";
import type { ArrangeJudgeInput } from "@/lib/arrange-job";
import {
  ASYNC_ROUTE_EDGE_LIMIT,
  routeWorkerAvailable,
  scheduleRouteSolve,
  setRouteSolveSink,
  type RouteSolveResult,
} from "./grid-route-solve";
import {
  CUSTOM_RATE_ANY_RESOURCE_ID,
  getCustomRateSlot,
  isCustomRateNodeId,
  isCustomRateRecipe,
} from "@/lib/model/custom-rate";
import { getFluidTankSlot, isFluidTankRecipe } from "@/lib/model/fluid-tank";
import { isTrashRecipe, TRASH_ANY_RESOURCE_ID } from "@/lib/model/trash";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { GT_TIER_COLORS } from "./tier-colors";
import { isPowerDisplayUnit, type RateUnit } from "@/lib/model/rate-unit";
import { useIsCompactViewport } from "@/lib/compact-view";
import { useUiScale } from "@/lib/ui-scale";
import { subscribeDeviceSettings, wheelChangesValues } from "@/lib/device-settings";
import { BOARD_TOOL_SCALE, useToolbarFold } from "./toolbar-fold";
import { browseHoveredPort } from "./port-browse";
import { useBoardTouchGestures } from "./board-touch-gestures";
import { useBoardCameraControls } from "./board-camera-controls";
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
import { EDGE_HOP_MAX_RADIUS, buildHoppedPath, type HopSpan } from "./wire-hops";
import { describeDeathSpiral, findDeathSpirals } from "./death-spiral";
import { describeClogLock, findClogLocks } from "./clog-lock";
import { loopEdges, type LoopTone } from "./clean/loops";
import { findUnwiredNodeIds } from "./node-verdict";
import { useBoardPulseGate, useBoardPulseSync } from "./animation-phase";
import { useSlicedMount } from "./sliced-mount";
import { boardVirtualizer } from "./virtual/card-virtualizer";
import { boardEdges } from "./virtual/board-edges";
import { VirtualizationController } from "./virtual/VirtualizationController";
import { writeBoardZoom } from "./virtual/zoom-var";
import {
  CONTAINMENT_HOLD_ATTRIBUTE,
  isCardSkipped,
  useNodeContainment,
} from "./node-containment";
import {
  isWiringConnection,
  onWiringConnectionChange,
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
  NODE_DETAIL_GLANCE,
  getNodeDetailLevel,
  getPublishedNodeDetailLevel,
  getServerNodeDetailLevel,
  nodeDetailAttributeValue,
  setNodeDetailLevel,
  subscribeNodeDetailLevel,
  type NodeDetailLevel,
} from "./node-detail";
import {
  publishEdgePulse,
  publishEdgeWaypointDots,
  retractEdgePulse,
  retractEdgeWaypointDots,
  snapshotEdgeLabelBoxes,
  snapshotEdgePulses,
  snapshotEdgeWaypointDots,
} from "./edge-pulse";
import { StorageTileFace, type StorageFlowNode } from "./StorageNode";
import { TrashNode, type TrashFlowNode } from "./TrashNode";
import {
  POCKET_CARD_SOURCE_HANDLE,
  POCKET_CARD_TARGET_HANDLE,
  PocketNode,
  type PocketFlowNode,
} from "./PocketNode";
import {
  BOARD_DRAG_HANDLE_CLASS,
  BOARD_EDGE,
  BoardFloor,
  BoardNode,
  type BoardNodeData,
  type BoardWindowFlowNode,
} from "./BoardNode";
import {
  boardWindowSize,
  collectPocketDescendantIds,
  computeBoardLevelView,
  computeOpenBoardRects,
  boardBodyRect,
  pickBoardOwnerFor,
} from "@/lib/model/board-windows";
import {
  computePocketSummaries,
  countPocketCrossings,
  pocketCardHeight,
} from "./pocket-summary";
import {
  ANNOTATION_DRAG_HANDLE_CLASS,
  type AnnotationFlowNode,
} from "./AnnotationNode";
import { AnnotationSwitch } from "./clean/note/AnnotationSwitch";
import { BoardNodeSwitch, PocketNodeSwitch } from "./clean/group/GroupSwitch";
import { GroupFloor } from "./clean/group/CleanGroupFrame";
import { setBoardSizeSource, boardSizeOf } from "./clean/group/group-sizes";
import { clearGroupDrop, groupDropSound, groupUnder, showGroupDrop } from "./clean/group/group-drop";
import { computeGroupSummaries } from "./clean/group/group-summary";
import { useWorkspaceView } from "@/lib/workspace-view";
import { playEditSfx } from "@/lib/sound/sfx";
import { visibleAnnotations } from "./clean/note/note-model";
import { settleZonePoints } from "@/lib/model/zone-points";
import { BOARD_PAPER_IDS } from "@/lib/model/board-paper";
import { nearestFreeSpot, type PlacementRect, type PlacementRegion } from "./board-placement";
import { registerBoardResize, type BoardResizeDraft } from "./board-resize";
import { RESOURCE_DRAG_TYPE, readResourceDrag } from "@/lib/resource-drag";

/** How long after the last camera step the settled camera work runs. */
const MOVE_END_SETTLE_MS = 120;

const nodeTypes = {
  recipeNode: RecipeNodeSwitch,
  storageNode: StorageNodeSwitch,
  trashNode: TrashNode,
  annotationNode: AnnotationSwitch,
  pocketNode: PocketNodeSwitch,
  boardNode: BoardNodeSwitch,
} satisfies NodeTypes;

type BoardFlowNode =
  | RecipeFlowNode
  | StorageFlowNode
  | TrashFlowNode
  | AnnotationFlowNode
  | PocketFlowNode
  | BoardWindowFlowNode;

interface AnnotationDraft {
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Every point the pointer passed through; the zone tool settles it. */
  trail: Array<{ x: number; y: number }>;
}

/**
 * What the draw-a-shape pipeline can be armed with: the annotation kinds,
 * plus "board", drawn like a box but landing as an open board that adopts
 * the cards its frame covers.
 */
type BoardDrawTool = FactoryAnnotationKind | "board";

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

// The base colour and pattern ink come from the active canvas theme
// (canvas-themes.ts).

/**
 * Snap step, and the background gap — same number so nodes land on marks.
 * It is also the number every card is built out of: see `@/lib/board-grid`,
 * which owns the cell and the card sizes derived from it.
 */
const BOARD_GRID_SIZE = BOARD_GRID;
/** Stable identity: a fresh array each render would re-init React Flow's snap. */
const BOARD_GRID_SNAP: [number, number] = [BOARD_GRID_SIZE, BOARD_GRID_SIZE];

/** One glyph per background pattern, for the view menu's pattern row. */
const CANVAS_PATTERN_ICON: Record<CanvasPattern, LucideIcon> = {
  dots: Grip,
  lines: Grid3x3,
  cross: Plus,
  ruled: AlignJustify,
  graph: Grid2x2,
  none: Ban,
};

/** Module-level so the board never re-renders on a fresh object identity. */
const PRO_OPTIONS = { hideAttribution: true };

/**
 * Every card's resting depth. Explicit rather than React Flow's default 0
 * because the nodes layer is not a stacking context (globals.css) and each
 * node stacks directly against the edge layer at 10: cards must land above
 * the wires, backdrop annotations (-5) below them.
 */
const CARD_Z_INDEX = 20;

/** A plan board's sticky notes: over the wires (10), under the cards, as the mod stacks them. */
const STICKY_NOTE_Z_INDEX = 15;

/**
 * React Flow's dark colorMode paints its wrapper #141414, which would cover
 * the canvas theme's paper. The board div behind it owns the background, so
 * the wrapper must stay transparent.
 */
const FLOW_WRAPPER_STYLE = { backgroundColor: "transparent" } as const;

/**
 * Narrower than this and a framing request's reserved strip is ignored: about
 * two cards, below which there is no framing left to do and giving a slice
 * away costs more than whatever was going to sit in it. See frameBoardCards.
 */
const MIN_FRAMED_WIDTH = 420;

/**
 * Mid-drag live rerouting. On boards under this many wires the real route
 * solve (the same one the drop runs) reruns while a card moves, throttled to
 * LIVE_DRAG_SOLVE_MS, so the wires follow it to exactly where they will rest.
 * Past the limit wires freeze until the drop: a full board solve per beat is
 * the per-frame bill CLAUDE.md forbids.
 */
const LIVE_DRAG_ROUTE_EDGE_LIMIT = 200;
const LIVE_DRAG_SOLVE_MS = 120;
/**
 * Measured half of the gate above. Each mid-drag solve is timed through to
 * the frame it painted; one over this budget marks the current board size as
 * too slow to follow, and later drags freeze until the board shrinks well
 * below that size.
 */
const LIVE_DRAG_BUDGET_MS = 36;
/**
 * The arrival pop (globals.css), applied in the same DOM pass as the flash.
 * The class outlives the 220ms animation harmlessly and is removed by the
 * flash's own timers, so a later cull remount can never replay it.
 */
const BOARD_ARRIVE_CLASS = "board-card-arrive";
const BOARD_ARRIVE_MS = 600;

/**
 * On compact (touch) a card drags only once selected: tap it, then drag it.
 * Otherwise every drag starting on a card moves it, and a dense plan has no
 * gaps left to pan from.
 *
 * `nodesDraggable` is off wholesale on compact, and a selected card overrides
 * it with its own `draggable`. Unchanged cards keep their identity because the
 * node memos are built on it.
 */
function withTouchDragRule(nodes: BoardFlowNode[], compact: boolean): BoardFlowNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    // Off compact nothing carries the flag, so a window that grows back into a
    // desktop hands every card its drag back. A board window is exempt from
    // select-first: its title bar (the only drag handle) is a deliberate
    // enough target to keep the drag on a finger.
    const draggable =
      node.type === "boardNode" ? (compact ? true : undefined) : compact && node.selected ? true : undefined;
    if (node.draggable === draggable) {
      return node;
    }
    changed = true;
    return { ...node, draggable };
  });
  return changed ? next : nodes;
}

/**
 * Wire lane widths come from the lane-fraction menu in grid-edge-router.ts
 * (`laneWidthForHeat`): the widest is one full lane (16px), this the narrowest.
 */
const FLOW_MODE_MIN_WIDTH = 4;
/**
 * The dash pattern of a wire carrying nothing: round-capped dots one stroke
 * wide with a gap of two and a half strokes, so the dots read as dots on a
 * thin line and stay dots when the line is highlighted thicker.
 */
const idleDots = (strokeWidth: number) => `0.1 ${Math.max(8, strokeWidth * 2.5)}`;
/**
 * The ink a routed lane width draws at: the mod's wire (WireLayer.withWidths), 1.35 x (2 + 5 x heat) board px, so
 * 2.7 px at the quietest and 9.45 at the busiest. The heat comes back from the lane width (a quarter lane at 0, a full
 * lane at 1); the router still packs and prices by lane width, untouched.
 */
const drawnStrokeWidth = (laneWidth: number) => {
  const heat = Math.min(Math.max((laneWidth / LANE_CAPACITY - 0.25) / 0.75, 0), 1);
  return 1.35 * (2 + 5 * heat);
};
const FLOW_MODE_MAX_WIDTH = LANE_CAPACITY;
/**
 * Dash travel in flow pixels per second: the quietest line on the board, and
 * the busiest. Expressed as a velocity rather than a duration so the speed
 * reads as flow and nothing else; see the note where it is applied.
 */
const PULSE_MIN_VELOCITY = 85;
const PULSE_MAX_VELOCITY = 290;

/**
 * How far apart parallel runs sit, as a multiple of EDGE_LANE_SPACING, which
 * was chosen for ~3px wires; thick lines widen every lane to clear the widest
 * line that can be drawn. A module value (not a prop) because the routing
 * functions that read it are pure and module-level; the board bumps it and
 * drops the route caches, like every other geometry input here.
 */
let publishedEdgeLaneScale = 1;
const THICK_LINE_LANE_SCALE = 2.8;
/** Below this a rate is display noise, not a flow — it must not set the floor. */
const RATE_DISPLAY_EPSILON = 1e-6;

/**
 * How much of a line's weight comes from its RANK among the other lines
 * rather than its log-scaled value. A value scale alone squashes everything
 * under one huge line and cannot separate close values (10,000 vs 10,005);
 * rank alone loses magnitude. Blended with rank leading, because the reading
 * asked for is "which of these is bigger", not "how big exactly".
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
// Keeps an unmeasured drawer endpoint inside the card, the way a measured
// one lands.
const STORAGE_SLOT_EDGE_OFFSET = 60;
const BASE_EDGE_NODE_CLEARANCE = 30;
const BASE_EDGE_LINK_CLEARANCE = 12;

/**
 * How much room a wire keeps off a node wall, and how close two wires may run
 * before the scorer charges for it. The base values assume a ~3px wire, where
 * a centreline clearance is a visual clearance; thick lines add their
 * overhang. Derived from the widest line that can be drawn, never from an
 * individual edge's width: per-edge widths come from normalised throughput,
 * so folding them into routing inputs would reroute the board on every solve.
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
  ratio?: { input?: number; output?: number };
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
  /** The wire's kind; its unit is read from the live dials at format time. */
  resourceKind: string;
  isLimited: boolean;
  /** Producer is maxed out and the consumer is going hungry. */
  isSupplyCapped: boolean;
  /** The line ends in a barrel or tank rather than a machine. */
  isStorageTarget?: boolean;
  isStorageEdge: boolean;
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
  /** This wire is part of a jam whose surplus has nowhere to go. */
  isClogLock?: boolean;
  /** A plan board's dead loop or clog lock runs along this wire (`PlanSolveExtras.loops`, clean/loops.ts). */
  planLoop?: LoopTone;
  /**
   * Channels: flat edges carrying the same resource between the same two
   * cards (a shared machine's two recipes, two slots of one material, wires
   * crossing a minimized board's border) draw as ONE wire. Set on the
   * representative edge only: every flat edge id the drawn wire stands for,
   * itself included. Its rates are the channel's sums; deleting it deletes
   * them all.
   */
  mergedEdgeIds?: string[];
  /**
   * `heat` is this line's share of its own kind's range, 0 for the quietest
   * line on the board and 1 for the busiest; the flags say which of colour,
   * thickness and marching dashes to apply, so the three mix freely.
   */
  flowRate?: {
    heat: number;
    kind: "item" | "fluid";
    color: boolean;
    thickness: boolean;
    pulse: boolean;
    /**
     * Nothing moves on this wire at all: drawn dotted at every zoom.
     * Starved-but-flowing wires keep their solid line, dotted only at a
     * glance.
     */
    idle: boolean;
  };
  /**
   * Bust token for the edge-identity cache. Node size changes bump it, which
   * makes every rebuilt edge structurally new so all of them re-render and
   * re-measure; without it the deep-identity reuse would hand back the old
   * object and the stale route would never redraw.
   */
  layoutEpoch: number;
  /**
   * Timelapse only (board-timelapse.ts): the edge's paths render with
   * pathLength=1, so the draw-in animation's normalized dash covers any
   * route exactly and every wire takes the wire-draw slider's duration.
   * Never set outside a run - px-based dash styles (starved dots, the
   * clog-lock dashes) read wrong against a normalized length.
   */
  timelapseDraw?: boolean;
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
  /** Crammed board: the label's only seat is on top of some node, so it does not render. */
  labelHidden?: boolean;
  points: Array<{ x: number; y: number }>;
  /**
   * Whether these points came from the router (fresh or last-solved) rather
   * than the port-anchored fallback. The fallback leaves each end at its
   * port row, so a wire must never be seen ANIMATING out of one (see the
   * morph gate in the edge).
   */
  solved?: boolean;
  /** Where hop bumps replace the wire, as arc lengths along `points`. */
  hopSpans?: HopSpan[];
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
// Wire culling asks for a wire's route to know whether it crosses the screen (virtual/board-edges.ts).
boardEdges.routeOf = (edgeId) => directRouteCache.get(edgeId)?.route.points;

/**
 * Spatial index over every cached route's segments.
 *
 * The scorer's congestion set and the hop pass both need "the other lines
 * near this one". Walking the whole route cache per edge is O(edges²) per
 * render, which CLAUDE.md calls a bug; a uniform grid answers against
 * only the segments in reach. Cells are big relative to a wire and small
 * relative to the board, so a query touches a few cells.
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
  /**
   * The open board frames this wire's endpoints live inside — the only
   * frames its route may cross. Every other frame blocks it like a card.
   */
  throughBoardIds?: string[];
  /**
   * The frames holding BOTH ends: the rooms the wire lives in, which it
   * should not leave and come back into. Always a subset of the above.
   */
  homeBoardIds?: string[];
};

let publishedGridRouteEdges: GridRouteEdgeInput[] = [];
let gridSolveSignature = "";
/**
 * Fast-path gate. ensureGridSolve runs from every edge's render, and the full
 * signature walks every edge, so without a gate that is O(edges²) per pass.
 * Anything that could change the solve moves one of these numbers: a new
 * edge list bumps the stamp, and any geometry/measurement change (including
 * a culled node remounting) bumps the measured layout epoch.
 */
let gridSolveInputsStamp = 0;
let gridSolveCheckedStamp = -1;
let gridSolveCheckedEpoch = -1;
/**
 * Every solve the board asks for gets the next number, and a worker answer
 * installs only if it is newer than what is installed. A late answer to a
 * superseded drag beat still lands (the wires catch up progressively) but
 * never over a fresher one - including a synchronous solve that ran because
 * the board shrank under the async limit while the worker was busy.
 */
let gridSolveRequestSeq = 0;
let gridSolveInstalledSeq = 0;
/** The signature most recently asked for, solved or still in the worker. */
let gridSolveWantedSignature = "";
/** How the board re-issues its edges when worker routes land. */
let routeSolveRerender: (() => void) | undefined;

function pointListsEqual(
  a: Array<{ x: number; y: number }> | undefined,
  b: Array<{ x: number; y: number }> | undefined,
) {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return (a?.length ?? 0) === (b?.length ?? 0);
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].x !== b[index].x || a[index].y !== b[index].y) {
      return false;
    }
  }
  return true;
}

function idListsEqual(a: string[] | undefined, b: string[] | undefined) {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return (a?.length ?? 0) === (b?.length ?? 0);
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function gridRouteEdgeInputsEqual(a: GridRouteEdgeInput[], b: GridRouteEdgeInput[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) {
      continue;
    }
    if (
      left.edgeId !== right.edgeId ||
      left.order !== right.order ||
      left.sourceNodeId !== right.sourceNodeId ||
      left.targetNodeId !== right.targetNodeId ||
      left.sourceHandleId !== right.sourceHandleId ||
      left.targetHandleId !== right.targetHandleId ||
      left.sourceSlotEndpoint !== right.sourceSlotEndpoint ||
      left.targetSlotEndpoint !== right.targetSlotEndpoint ||
      left.sourceStorageEndpoint !== right.sourceStorageEndpoint ||
      left.targetStorageEndpoint !== right.targetStorageEndpoint ||
      left.routingWidth !== right.routingWidth ||
      !pointListsEqual(left.waypoints, right.waypoints) ||
      !idListsEqual(left.throughBoardIds, right.throughBoardIds) ||
      !idListsEqual(left.homeBoardIds, right.homeBoardIds)
    ) {
      return false;
    }
  }
  return true;
}

function publishGridRouteEdges(edges: GridRouteEdgeInput[]) {
  // The edges memo rebuilds on hover, search keystrokes and solver results,
  // none of which move a wire. This O(edges) compare keeps the stamp still so
  // the gate skips the O(edges x perimeter) signature rebuild.
  if (gridRouteEdgeInputsEqual(publishedGridRouteEdges, edges)) {
    return;
  }
  publishedGridRouteEdges = edges;
  gridSolveInputsStamp += 1;
}

/**
 * The dock candidates for one end of one edge: the ENTIRE perimeter of the
 * card, one candidate per grid line crossing the border. Where the drawn wire
 * meets the card is the router's call; ports are only where a wire starts
 * and where its numbers are read.
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

  // Every wire docks freely, self loops included; the router keeps a self
  // loop's two ends apart so it reads as a loop.
  const left = snap(rect.left);
  const right = snap(rect.right);
  const top = snap(rect.top);
  const bottom = snap(rect.bottom);
  // Every grid line crossing the border is a candidate; huge multiblock
  // cards coarsen to every other line so the candidate set stays bounded.
  const perimeterCells = (right - left + (bottom - top)) / BOARD_GRID;
  const step = perimeterCells > 60 ? 2 * BOARD_GRID : BOARD_GRID;
  // The corner itself is not a dock (a wire off the very corner reads as
  // clipped through the card); one cell in is fine, at 45° too.
  const keepOutFor = (span: number) => (span >= 2 * BOARD_GRID ? BOARD_GRID : 0);
  const dockTop = top;
  const centerX = (left + right) / 2;
  const centerY = (dockTop + bottom) / 2;
  const candidates: GridEndpoint[] = [];
  const keepOutX = keepOutFor(right - left);
  const keepOutY = keepOutFor(bottom - dockTop);
  for (let x = left + keepOutX; x <= right - keepOutX; x += step) {
    const penalty = Math.abs(x - centerX) * DOCK_CENTER_BIAS;
    candidates.push({ x, y: top, side: "top", penalty });
    candidates.push({ x, y: bottom, side: "bottom", penalty });
  }
  for (let y = dockTop + keepOutY; y <= bottom - keepOutY; y += step) {
    const penalty = Math.abs(y - centerY) * DOCK_CENTER_BIAS;
    candidates.push({ x: left, y, side: "left", penalty }, { x: right, y, side: "right", penalty });
  }
  // Defensive: a card with no dock left after the keep-out falls back to its
  // side centres.
  if (candidates.length === 0) {
    candidates.push(
      { x: left, y: snap(centerY), side: "left" },
      { x: right, y: snap(centerY), side: "right" },
      { x: snap(centerX), y: bottom, side: "bottom" },
    );
    candidates.push({ x: snap(centerX), y: top, side: "top" });
  }
  return candidates;
}

/**
 * Cost per pixel of distance from a side's centre when choosing a dock:
 * mid-way out a machine's long side costs about one extra turn, so facing
 * wires meet centre-to-centre and a wire slides toward a corner only when
 * the route earns it.
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
  // Endpoint resolution enumerates the whole card perimeter, but those coords
  // derive purely from card rects the sweep hash already covers. So the
  // signature is built from the inputs alone and resolution is deferred
  // until the signature actually differs.
  const deferredInputs: GridRouteEdgeInput[] = [];
  for (const input of publishedGridRouteEdges) {
    const waypointPart =
      input.waypoints && input.waypoints.length > 0
        ? `|wp:${input.waypoints
            .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
            .join("+")}`
        : "";
    // Same skip rule the resolver applies: an unmeasured node yields no
    // candidates, and nothing else can empty them.
    if (
      !getMeasuredNodeBoundsById(input.sourceNodeId) ||
      !getMeasuredNodeBoundsById(input.targetNodeId)
    ) {
      continue;
    }
    deferredInputs.push(input);
    const describe = waypointPart;
    // Frame exemptions are a routing input like a waypoint: adopting a card
    // changes no endpoint and moves no obstacle, yet its wires must reroute.
    const throughPart =
      (input.throughBoardIds && input.throughBoardIds.length > 0
        ? `|thru:${input.throughBoardIds.join(",")}`
        : "") +
      (input.homeBoardIds && input.homeBoardIds.length > 0
        ? `|home:${input.homeBoardIds.join(",")}`
        : "");
    parts.push(
      `${input.edgeId}|${input.order}|${input.routingWidth}|${input.sourceNodeId}|${input.targetNodeId}${describe}${throughPart}`,
    );
  }

  // Open board frames are obstacles too — solid to every wire that is not
  // exempt from them. They live outside the card sweep, so they carry their
  // own slice of the signature.
  const frames = publishedBoardFrameBounds;
  const framesPart = frames
    .map(
      (entry) =>
        `${entry.id}:${Math.round(entry.bounds.left)},${Math.round(entry.bounds.top)},${Math.round(
          entry.bounds.right,
        )},${Math.round(entry.bounds.bottom)}`,
    )
    .join(";");

  const tuning = getRouterTuning();
  const signature = `${routerTuningKey(tuning)}::${sweep.hash}::${framesPart}::${parts.join(";")}`;
  if (signature === gridSolveSignature || signature === gridSolveWantedSignature) {
    return;
  }
  gridSolveWantedSignature = signature;
  gridSolveRequestSeq += 1;
  const seq = gridSolveRequestSeq;

  // The signature actually moved: now pay for the perimeters.
  for (const input of deferredInputs) {
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
      exemptObstacleIds: input.throughBoardIds,
      homeObstacleIds: input.homeBoardIds,
      sourceCardId: input.sourceNodeId,
      targetCardId: input.targetNodeId,
    });
    orderByEdge.set(input.edgeId, input.order);
  }

  const obstacles = [
    ...sweep.bounds.map((entry) => ({ id: entry.id, ...entry.bounds })),
    ...frames.map((entry) => ({ id: entry.id, ...entry.bounds })),
  ];
  // The solve's exact inputs, for probes and router benches
  // (`router-replay.local.test.ts` replays a dumped capture).
  if (typeof window !== "undefined") {
    (window as unknown as { __gtnhRouteSolve?: unknown }).__gtnhRouteSolve = {
      signature,
      obstacles,
      requests,
      tuning,
    };
    // The minimap reads the same installed routes (clean/minimap).
    registerMinimapRoutes(() => ({
      signature: gridSolveSignature,
      routes: publishedGridRouteEdges.flatMap((input) => {
        const entry = directRouteCache.get(input.edgeId);
        return entry
          ? [{ edgeId: input.edgeId, points: entry.route.points, width: Math.min(input.routingWidth, LANE_CAPACITY) }]
          : [];
      }),
    }));
    // Read the installed geometry on demand, never re-solve a benchmark's
    // approximation. The signature gate lets probes wait for the worker.
    registerBoardScoreReader(() => {
      const routes: GridRoutedEdge[] = [];
      let settled = gridSolveSignature === gridSolveWantedSignature;
      for (const input of publishedGridRouteEdges) {
        const entry = directRouteCache.get(input.edgeId);
        if (!entry) {
          settled = false;
          continue;
        }
        if (entry.signature !== gridSolveSignature) settled = false;
        routes.push({
          edgeId: input.edgeId,
          points: entry.route.points,
          width: Math.min(input.routingWidth, LANE_CAPACITY),
        });
      }
      const measured = measureRoutes(routes);
      return {
        crossings: measured.crossings,
        length: measured.length,
        points: routePoints(measured, getRouterTuning()),
        bends45: measured.bends45,
        bends90: measured.bends90 + 3 * measured.bendsSharp,
        wires: routes.length,
        settled,
      };
    });
    // The board's geometry as the router sees it: for the layout string
    // (dev menu -> Score -> Copy layout), enough to rebuild the routing
    // problem offline.
    registerBoardGeometryReader(() => {
      const project = useFactoryStore.getState().project;
      const cards: Array<{ id: string; x: number; y: number; width: number; height: number; role: "machine" | "storage" | "board" }> = [];
      const seen = new Set<string>();
      const take = (id: string, role: "machine" | "storage" | "board") => {
        const rect = getMeasuredNodeBoundsById(id);
        if (!rect || seen.has(id)) return;
        seen.add(id);
        cards.push({ id, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, role });
      };
      for (const node of project.nodes) take(node.id, "machine");
      for (const storage of project.storages ?? []) take(storage.id, "storage");
      for (const pocket of project.pockets ?? []) take(pocket.id, "board");
      const wires = publishedGridRouteEdges
        .filter((input) => seen.has(input.sourceNodeId) && seen.has(input.targetNodeId))
        .map((input) => ({
          id: input.edgeId,
          source: input.sourceNodeId,
          target: input.targetNodeId,
          sourcePortY: input.sourceSlotEndpoint
            ? measuredPortOffsetY(input.sourceNodeId, input.sourceHandleId ?? undefined, Position.Right)
            : undefined,
          targetPortY: input.targetSlotEndpoint
            ? measuredPortOffsetY(input.targetNodeId, input.targetHandleId ?? undefined, Position.Left)
            : undefined,
          width: Math.min(input.routingWidth, LANE_CAPACITY),
        }));
      return { cards, wires };
    });
    (window as unknown as { __gtnhReadDisplayedRoutes?: unknown }).__gtnhReadDisplayedRoutes = () => ({
      signature: gridSolveSignature,
      wantedSignature: gridSolveWantedSignature,
      project: useFactoryStore.getState().project,
      routes: publishedGridRouteEdges.flatMap((input) => {
        const entry = directRouteCache.get(input.edgeId);
        return entry ? [{ edgeId: input.edgeId, signature: entry.signature, points: entry.route.points }] : [];
      }),
    });
  }
  // A big board routes in the worker (`grid-route-solve.ts`): this render
  // keeps serving the installed routes (`gridSolveSignature` does not move
  // until the answer lands) and `installSolvedRoutes` re-issues the edges
  // then. A small board solves synchronously so its wires never lag a frame
  // behind their cards.
  if (requests.length > ASYNC_ROUTE_EDGE_LIMIT && routeWorkerAvailable()) {
    scheduleRouteSolve({ signature, seq, obstacles, requests, tuning });
    return;
  }
  gridSolveSignature = signature;
  gridSolveInstalledSeq = seq;
  const solved = solveGridRoutes(obstacles, requests, undefined, tuning);
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

/**
 * Worker routes landing. Installed exactly as the synchronous path installs
 * its own, then the board is asked to re-issue its edges, which read the
 * fresh cache and morph onto the new lines. Stale answers (older than what
 * is installed) are dropped; see `gridSolveRequestSeq`.
 */
function installSolvedRoutes(result: RouteSolveResult) {
  if (result.seq <= gridSolveInstalledSeq) {
    return;
  }
  gridSolveInstalledSeq = result.seq;
  gridSolveSignature = result.signature;
  for (const routed of result.routes) {
    if (routed.points.length < 2) {
      deleteDirectRoute(routed.edgeId);
      continue;
    }
    setDirectRoute(routed.edgeId, {
      signature: result.signature,
      routeIndex: routed.order,
      route: buildRoutedEdgePath(routed.points),
      segments: getPolylineSegments(routed.points),
    });
  }
  routeCacheGrewThisPass = true;
  routeSolveRerender?.();
}
setRouteSolveSink(installSolvedRoutes);

/** The judge's inputs, serialisable: what the arrange worker builds its judge from. */
function buildArrangeJudgeInput(cardIds: readonly string[]): ArrangeJudgeInput | undefined {
  const ids = new Set(cardIds);
  const inputs = publishedGridRouteEdges.filter(
    (input) => ids.has(input.sourceNodeId) && ids.has(input.targetNodeId),
  );
  if (inputs.length === 0) {
    return undefined;
  }
  const base: Array<{ input: GridRouteEdgeInput; sources: GridEndpoint[]; targets: GridEndpoint[] }> = [];
  for (const input of inputs) {
    const sources = resolveGridRouteEndpoints(input, "source");
    const targets = resolveGridRouteEndpoints(input, "target");
    if (sources.length === 0 || targets.length === 0) {
      continue;
    }
    base.push({ input, sources, targets });
  }
  if (base.length === 0) {
    return undefined;
  }
  const bounds = new Map<string, { left: number; top: number; right: number; bottom: number }>();
  for (const id of ids) {
    const rect = getMeasuredNodeBoundsById(id);
    if (!rect) {
      return undefined;
    }
    bounds.set(id, rect);
  }
  const obstacles: GridObstacle[] = [];
  for (const [id, rect] of bounds) {
    obstacles.push({ id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  const requests: GridRouteRequest[] = base.map(({ input, sources, targets }) => ({
    edgeId: input.edgeId,
    order: input.order,
    sources,
    targets,
    strokeWidth: Math.min(input.routingWidth, LANE_CAPACITY),
    sourceCardId: input.sourceNodeId,
    targetCardId: input.targetNodeId,
  }));
  // The judge's exact inputs at the moment of the arrange, for the audit
  // tool (tools/audit-board.mjs) to save beside the result.
  const input: ArrangeJudgeInput = { obstacles, requests, tuning: getRouterTuning() };
  if (typeof window !== "undefined") {
    (window as unknown as { __gtnhArrangeJudgeInput?: unknown }).__gtnhArrangeJudgeInput = {
      ...input,
      cardIds: [...cardIds],
    };
  }
  return input;
}

function clearDirectRoutes() {
  directRouteCache.clear();
  routeSegmentGrid.clear();
  routeSegmentCellsByEdge.clear();
  // The cache is the solve's output: with it gone, an unchanged signature
  // must not short-circuit the next ensureGridSolve into doing nothing.
  gridSolveSignature = "";
  gridSolveWantedSignature = "";
  gridSolveCheckedStamp = -1;
}

// Measured geometry is stored in FLOW coordinates, which are invariant under
// pan and zoom, so these caches are keyed on a layout epoch the board bumps
// when node positions or sizes change. Never key them on the viewport
// transform: that re-measures the whole board on every pan frame. Only
// `viewportTransformCache` is frame-scoped, because the screen->flow
// conversion depends on the live transform.
type MeasuredBounds = { left: number; right: number; top: number; bottom: number };

/**
 * The OPAQUE parts of an open board: its title bar and the rim around its
 * floor. Both sit above the wires (chrome at z 15, wires at 10), so anything
 * drawn on top of the wires has to stop at them too. The floor between them
 * is a separate layer UNDER the wires, so a wire and its dashes cross it.
 */
function boardChromeOccluders(bounds: MeasuredBounds): MeasuredBounds[] {
  const { left, top, right, bottom } = bounds;
  return [
    { left, top, right, bottom: Math.min(bottom, top + BOARD_WINDOW_TITLE_HEIGHT) },
    { left, top, right: Math.min(right, left + BOARD_EDGE), bottom },
    { left: Math.max(left, right - BOARD_EDGE), top, right, bottom },
    { left, top: Math.max(top, bottom - BOARD_EDGE), right, bottom },
  ];
}

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

// Identity caches for node `data`, memoisation in the spirit of useMemo: values
// derive purely from inputs, so a discarded or replayed render can only yield
// an equivalent identity, never a wrong result. Module scope because reading a
// ref during render is not allowed.
const recipeNodeDataCache = new Map<string, RecipeFlowNode["data"]>();
const storageNodeDataCache = new Map<string, StorageFlowNode["data"]>();
const trashNodeDataCache = new Map<string, TrashFlowNode["data"]>();
const annotationNodeDataCache = new Map<string, AnnotationFlowNode["data"]>();
const pocketNodeDataCache = new Map<string, PocketFlowNode["data"]>();
const boardNodeDataCache = new Map<string, BoardNodeData>();

/**
 * The board chrome's depth: over the wire layer (10 while un-sealed), under
 * the cards (20). See the frame node below.
 */
const BOARD_CHROME_Z_INDEX = 15;
// Same idea for edges, but with structural comparison: an edge object nests
// fresh data/style objects on every rebuild, and handing React Flow an equal-
// but-new identity re-renders the edge — which re-runs the route solver. Most
// rebuilds (hover, solver run) leave most edges untouched.
const edgeObjectCache = new Map<string, ResourceFlowEdge>();

/**
 * Representative edge id → every flat edge id its drawn wire stands for
 * (see `mergedEdgeIds`). Rebuilt by the edges memo each pass; the delete
 * paths read it so removing the wire removes the whole channel.
 */
const channelEdgeIdsByRepresentative = new Map<string, string[]>();

/** Deleting a drawn wire deletes every flat edge it stands for. */
function expandChannelEdgeIds(edgeIds: string[]): string[] {
  return edgeIds.flatMap((id) => channelEdgeIdsByRepresentative.get(id) ?? [id]);
}

/**
 * Shallow field-for-field equality between two board nodes. Compares EVERY
 * key on both sides, including ones React Flow adds (`selected`, `dragging`):
 * a node the library has annotated is not interchangeable with a fresh one.
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

  // Same id space as the pocket cards: a pocket standing open caches here.
  for (const id of boardNodeDataCache.keys()) {
    if (!pocketIds.has(id)) {
      boardNodeDataCache.delete(id);
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

// Node ids currently being dragged. Edges touching them skip endpoint
// measurement and draw their last solved route (see `shouldUsePreciseRouting`
// in the edge); the drop republishes and re-solves. Module state rather than
// React state: those edges re-render every frame anyway via their position props.
const activelyDraggedNodeIds = new Set<string>();
/**
 * Bumped whenever the dragged set changes. The pulse canvas caches its
 * occlusion rects on this plus the published-bounds identities, so the
 * per-frame cost of the drag path is O(dragged cards), not O(all cards).
 */
let draggedNodeSetEpoch = 0;

// The board clipboard lives at module scope on purpose: it survives design-tab
// switches, so a selection copied in one design pastes into another.
// `pasteCount` staggers repeated pastes, each landing two cells past the last.
let boardClipboard: { payload: BoardClipboardPayload; pasteCount: number } | undefined;

const measuredNodeBoundsCache = new Map<string, MeasuredBounds | undefined>();
// Obstacle geometry for route avoidance, published by the board from React
// Flow's node state (positions plus measured sizes), never scanned from the
// DOM: with `onlyRenderVisibleElements` the DOM holds only on-screen nodes, so
// routes would depend on the viewport, which CLAUDE.md forbids.
let publishedBoardBounds: Array<{ id: string; bounds: MeasuredBounds }> | undefined;
/**
 * Open board frames, published separately from the card set: a frame is a
 * ROUTING obstacle for foreign wires, and the solve exempts each wire from
 * the frames its endpoints live in. Kept out of `publishedBoardBounds` so
 * other consumers of the card set (drop targeting, label maths) ignore it.
 */
let publishedBoardFrameBounds: Array<{ id: string; bounds: MeasuredBounds }> = [];
let publishedBoardGeometryById = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();
// The group edits (clean/group) measure things by what the board last published.
setBoardSizeSource((id) => publishedBoardGeometryById.get(id));

/**
 * While a wire is being dragged: for every card on the board, the port a drop
 * would land on, or null when that card refuses the resource. Empty at rest.
 * Module state because two unrelated consumers read it: the green/red wash
 * painter and the connection line (rendered by React Flow, with no path for
 * props). One map keeps the pipe, the wash and the drop in agreement.
 */
const activeDropTargets = new Map<string, ResolvedResourceHandle | null>();

/**
 * The cards a wire drop can land ON (or be refused by): everything except
 * annotations (ink) and open board frames (rooms - a drop on their floor is
 * a void drop that spawns inside). The connection line hit-tests against
 * these to tell "over a refusing card" from "over the void".
 */
let publishedSolidCardIds = new Set<string>();

/**
 * While a wire is being dragged: whether releasing it into the VOID would
 * spawn a drawer. Computed once at drag start (it depends on the plan and the
 * dragged port, never the pointer) and read per frame by the connection line
 * (green-dashed if it spawns, red-dashed if this port's drawer already
 * exists). Module state for the same reason as `activeDropTargets`.
 */
let voidDropWillSpawn = false;
/** Why a void release does nothing, for the ghost's reason card. */
let voidDropReason = "Drawer already exists";

/**
 * The exact drawer a void release would spawn, for the ghost to render with
 * the real tile face: the storage record it would create and the role it
 * would wear (an input drag spawns a SOURCE feeding it, an output drag a
 * PRODUCT catching it).
 */
let voidDropGhostStorage: FactoryStorage | undefined;
let voidDropGhostRole: "source" | "product" = "product";

/**
 * The connection line's live end, published each render in FLOW coords. The
 * ghost positions from this rather than converting pointer events itself:
 * a second conversion drifts apart from the line's own coordinates.
 */
let lastConnectionFlowPoint: { x: number; y: number } | undefined;

/** The dragged port itself, for the snap loop's toggle-delete question. */
let liveDraggedResource: DraggedResourceConnection | undefined;

/**
 * While the drag is snapped onto a pair whose release would DELETE the
 * existing wire (drawing a wire that exists toggles it off), that wire is
 * painted doomed and the connection line reads red. The class is applied
 * imperatively to the one edge element - never a board rebuild.
 */
let snapWillDeleteEdge = false;
let doomedEdgeId: string | undefined;

function paintDoomedEdge(edgeId: string | undefined): void {
  if (edgeId === doomedEdgeId) {
    return;
  }
  if (doomedEdgeId && typeof document !== "undefined") {
    document
      .querySelector(`[data-testid="rf__edge-${doomedEdgeId}"]`)
      ?.classList.remove("edge-doomed");
  }
  doomedEdgeId = edgeId;
  if (edgeId && typeof document !== "undefined") {
    document.querySelector(`[data-testid="rf__edge-${edgeId}"]`)?.classList.add("edge-doomed");
  }
}

// Slot endpoints cached relative to their node's origin, keyed by node size,
// so they survive culling (`onlyRenderVisibleElements` unmounts off-screen
// nodes) and moves; otherwise routes flip between measured and estimated
// shapes as the viewport moves. A slot cannot move inside its node without
// the node changing size. Absolute positions come from the published geometry.
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
   * The drag can go EITHER way, and the far end decides which: a drawer
   * dropped on something that eats its item feeds it, dropped on something
   * that makes the item it fills.
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

export function FactoryFlow({ covered = false }: { covered?: boolean } = {}) {
  const coveredRef = useRef(covered);
  useLayoutEffect(() => {
    coveredRef.current = covered;
  }, [covered]);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const moveBoardItems = useFactoryStore((state) => state.moveBoardItems);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const pasteBoardItems = useFactoryStore((state) => state.pasteBoardItems);
  // Blueprint overwrite picker mode: a shelf row is waiting for the user to
  // click a pocket (banner up top, pockets ringed).
  const overwritePicking = useBlueprintStore((state) => state.overwritePicking);
  const wrapSelectionInBoard = useFactoryStore((state) => state.wrapSelectionInBoard);
  const combineNodesIntoMachine = useFactoryStore((state) => state.combineNodesIntoMachine);
  const expandPocket = useFactoryStore((state) => state.expandPocket);
  const paintPocket = useFactoryStore((state) => state.paintPocket);
  const setPendingBoardSelection = useFactoryStore((state) => state.setPendingBoardSelection);
  const setSelectedBoardIds = useFactoryStore((state) => state.setSelectedBoardIds);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const connectNodesBatch = useFactoryStore((state) => state.connectNodesBatch);
  const connectCustomRate = useFactoryStore((state) => state.connectCustomRate);
  const connectTrash = useFactoryStore((state) => state.connectTrash);
  // Pool mode's cell-fluid bridges need the Canner's litres-per-cell for every
  // cell/fluid pair the plan names in both forms. Fetched as the plan changes
  // and stored on the plan (`poolCellRatios`) so the solve and every shared
  // copy read the same numbers; a pair the Canner does not know stays
  // unbridged, never guessed. One request per pair while the board is mounted.
  const poolPairsSignature = useFactoryStore((state) =>
    state.project.poolMode === true
      ? listPoolCellPairs(state.project)
          .filter((pair) => !state.project.poolCellRatios?.[pair.cellId])
          .map((pair) => `${pair.cellId}=${pair.fluidId}`)
          .join("|")
      : "",
  );
  const poolRatioAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!poolPairsSignature) {
      return;
    }
    const state = useFactoryStore.getState();
    const version = state.datasetManifest?.versions.find(
      (entry) => entry.id === state.selectedDatasetVersionId,
    );
    if (!version) {
      return;
    }
    for (const pairKey of poolPairsSignature.split("|")) {
      if (poolRatioAsked.current.has(pairKey)) {
        continue;
      }
      poolRatioAsked.current.add(pairKey);
      const [cellId, fluidId] = pairKey.split("=") as [string, string];
      void fetchLitresPerCell(version, cellId, fluidId).then((litres) => {
        if (litres) {
          useFactoryStore.getState().setPoolCellRatios({ [cellId]: litres });
        }
      });
    }
  }, [poolPairsSignature]);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const addAnnotation = useFactoryStore((state) => state.addAnnotation);
  const createBoard = useFactoryStore((state) => state.createBoard);
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const deleteAnnotation = useFactoryStore((state) => state.deleteAnnotation);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const boardView = useBoardView();
  const { calmMode } = boardView;
  // Device taste, not plan state: never captured into plan-view snapshots.
  const boardMotion = useBoardMotion();
  const canvasTheme = getCanvasTheme(boardView.canvasTheme);
  // Line colour follows the status glance view; the edge component gates it
  // to the glance zoom step.
  const speedColorMode = boardView.glanceMode === "status";
  // Line thickness is always on: every wire is drawn and routed at the width
  // its flow earns.
  const anyLineMode = true;
  const setFlowViewportCenter = useFactoryStore((state) => state.setFlowViewportCenter);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const hoveredUsageNodeId = useFactoryStore((state) => state.hoveredUsageNodeId);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  // The side panel's question: hover or click a resource row and every wire
  // and card carrying it lights up. Hovering a DRAWER on the board is narrower
  // and goes through flow-scope instead; do not fold it in here, it would
  // light half the board.
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

  // The graph is always the whole flat project; the canvas shows the root
  // plus the contents of every open board, recursively. `representativeOf`
  // maps any project item to what stands for it here: itself when its owner
  // chain is open, or the minimized card hiding it. See board-windows.ts.
  const pocketView = useMemo(() => {
    const view = computeBoardLevelView(project);
    return {
      isLevelShown: view.isLevelShown,
      representativeOf: view.representativeOf,
      visiblePockets: view.collapsedBoards,
      openBoards: view.openBoards,
    };
  }, [project]);

  // What each minimized board says about itself, read from the plan-wide
  // solve (a minimized board has no books of its own; see pocket-summary.ts).
  // Built here rather than in the card so an unrelated store write cannot
  // make every card redo it.
  const pocketSummaries = useMemo(
    () => computePocketSummaries(project, pocketView.visiblePockets, result),
    [project, result, pocketView.visiblePockets],
  );
  // Plan boards: every group's summary (docs/groups.md, "What the summary says"), the open frames' machine counts too.
  const averageMachineDraw = useWorkspaceView().averageMachineDraw;
  const groupSummaries = useMemo(
    () =>
      project.planMode === true
        ? computeGroupSummaries(
            project,
            result,
            (project.pockets ?? []).map((pocket) => pocket.id),
            !averageMachineDraw,
          )
        : undefined,
    [project, result, averageMachineDraw],
  );

  const nodesFromProject = useMemo<BoardFlowNode[]>(() => {
    // An item inside an open board is a React Flow CHILD of the frame: its
    // stored position is already frame-relative, so handing the owner over
    // as `parentId` is the whole mechanism that makes a dragged title bar
    // carry the household. Root items stay parentless.
    const childOf = (levelId: string | undefined) =>
      levelId !== undefined ? { parentId: levelId } : undefined;
    const memberCounts = new Map<string, number>();
    const countMember = (levelId: string | undefined) => {
      if (levelId !== undefined) {
        memberCounts.set(levelId, (memberCounts.get(levelId) ?? 0) + 1);
      }
    };
    for (const node of project.nodes) {
      countMember(node.pocketId);
    }
    for (const storage of project.storages ?? []) {
      countMember(storage.pocketId);
    }
    for (const annotation of project.annotations ?? []) {
      countMember(annotation.pocketId);
    }
    for (const pocket of project.pockets ?? []) {
      countMember(pocket.parentPocketId);
    }

    return [
      // Open boards first: React Flow insists a parent node appears before
      // every child that names it, and `openBoards` already comes
      // parents-before-children for the same reason.
      ...pocketView.openBoards.map(
        (pocket) =>
          ({
            id: pocket.id,
            type: "boardNode",
            position: pocket.position,
            ...childOf(pocket.parentPocketId),
            width: boardWindowSize(pocket).width,
            height: boardWindowSize(pocket).height,
            // The chrome (title bar, border, grip) sits above the wires (10)
            // and below the cards (20), so a wire crossing a board passes
            // under its bar and rim. The floor is painted separately under
            // the wires (BoardFloors). The class keeps the selected/dragging
            // z-lift from raising the frame over the cards it holds.
            zIndex: BOARD_CHROME_Z_INDEX,
            className: "board-window",
            // Selectable like any card. A marquee also collects its members;
            // a passenger's own position change is dropped mid-drag (see
            // dragPassengersRef) so frame and cards never move twice.
            selectable: true,
            dragHandle: `.${BOARD_DRAG_HANDLE_CLASS}`,
            style: { pointerEvents: "none" as const },
            data: reuseObjectIdentity(boardNodeDataCache, pocket.id, {
              pocket,
              memberCount: memberCounts.get(pocket.id) ?? 0,
              ...(groupSummaries ? { machines: groupSummaries.get(pocket.id)?.machines ?? 0 } : {}),
            }),
          }) satisfies BoardWindowFlowNode,
      ),
      ...project.nodes
        .filter((node) => pocketView.isLevelShown(node.pocketId))
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
            ...childOf(node.pocketId),
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
          ...childOf(node.pocketId),
          zIndex:
            hoveredUsageNodeId === node.id
              ? 1500
              : activeNodeBottlenecks && result.nodes[node.id]?.status === "bottleneck"
                ? 1500
                : activeFlowResourceKey && recipeContainsResourceKey(recipe, activeFlowResourceKey)
                  ? 1500
                  : CARD_Z_INDEX,
          // Reusing the previous `data` object when nothing in it moved lets
          // RecipeNode's memo hold; this memo rebuilds on every hover and
          // solve, which would otherwise re-render every node on the board.
          data: reuseObjectIdentity(recipeNodeDataCache, node.id, {
            projectNode: node,
            recipe,
            result: result.nodes[node.id],
          }),
        } satisfies RecipeFlowNode;
      }),
      ...(project.storages ?? [])
        .filter((storage) => pocketView.isLevelShown(storage.pocketId))
        .map(
        (storage) =>
          ({
            id: storage.id,
            type: "storageNode",
            position: storage.position,
            ...childOf(storage.pocketId),
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
      ...visibleAnnotations(project.annotations ?? [], project.planMode === true)
        .filter((annotation) => pocketView.isLevelShown(annotation.pocketId))
        .map(
        (annotation) =>
          ({
            id: annotation.id,
            type: "annotationNode",
            position: annotation.position,
            ...childOf(annotation.pocketId),
            // A level arrow has no height: keep the node a hair tall so it is still measured.
            width: Math.max(annotation.size.width, 1),
            height: Math.max(annotation.size.height, 1),
            // Boxes, zones and images sit under everything as backdrops;
            // arrows and notes float above the nodes they point at. The class
            // keeps the global "selected nodes rise" rule from lifting a
            // box's wash over the machines it frames.
            zIndex:
              annotation.kind === "box" ||
              annotation.kind === "zone" ||
              annotation.kind === "image"
                ? -5
                : project.planMode === true
                  ? STICKY_NOTE_Z_INDEX
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
            ...childOf(pocket.parentPocketId),
            zIndex: CARD_Z_INDEX,
            data: reuseObjectIdentity(pocketNodeDataCache, pocket.id, {
              pocket,
              summary: pocketSummaries.get(pocket.id),
              ...(groupSummaries ? { groupSummary: groupSummaries.get(pocket.id) } : {}),
            }),
          }) satisfies PocketFlowNode,
      ),
    ];
  }, [
    activeFlowResourceKey,
    activeNodeBottlenecks,
    hoveredUsageNodeId,
    groupSummaries,
    pocketSummaries,
    pocketView,
    project.annotations,
    project.planMode,
    project.nodes,
    project.pockets,
    project.storages,
    recipesById,
    result.nodes,
    result.storages,
  ]);
  const [flowNodes, setFlowNodes] = useState<BoardFlowNode[]>(() => nodesFromProject);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  // Pool mode: the wire layers fade out (globals.css, factory-flow-board--pool).
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const worksheet = poolMode;
  const [annotationTool, setAnnotationTool] = useState<BoardDrawTool | undefined>(undefined);
  // Shared by the brush and the annotation tools: the last colour picked in
  // the palette is what a new box/arrow/note is created with. Blue is legible
  // on every paper the board ships with.
  const [activeColorTag, setActiveColorTag] = useState<FactoryNodeColorTag>("blue");
  const [isDeleteMode, setDeleteMode] = useState(false);
  const checklistMode = useFactoryStore((state) => state.checklistMode);
  useEffect(() => {
    if (checklistMode) { setDeleteMode(false); setAnnotationTool(undefined); }
  }, [checklistMode]);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | undefined>(undefined);
  const annotationDraftRef = useRef<AnnotationDraft | undefined>(undefined);
  const [layoutVersion, setLayoutVersion] = useState(0);
  // Worker routes land outside any render; this is how they reach the edges.
  useEffect(() => {
    routeSolveRerender = () => setLayoutVersion((version) => version + 1);
    return () => {
      routeSolveRerender = undefined;
    };
  }, []);
  // A dev-menu dial moved: every route is stale.
  useEffect(
    () =>
      subscribeRouterTuning(() => {
        // Clear the cache and move the input stamp so the fast-path gate
        // cannot short-circuit; the fresh request supersedes any pending
        // worker answer.
        clearDirectRoutes();
        gridSolveInputsStamp += 1;
        setLayoutVersion((version) => version + 1);
      }),
    [],
  );
  // Bumped whenever a paste/wrap/blueprint-load hands the selection to fresh
  // cards. React Flow keeps its band-selection rectangle up through that
  // handoff, eating clicks over the new cards; the controller below watches
  // this counter and dismisses it.
  const [selectionHandoffCount, setSelectionHandoffCount] = useState(0);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
  // For the failure sound: the plan as it stood when the wire drag began
  // (onConnect runs before onConnectEnd, so "did this gesture change
  // anything" must compare against drag START, not connect-end entry).
  const connectStartFingerprintRef = useRef<string | undefined>(undefined);
  // The gesture's origin card, tracked separately from draggedResourceRef:
  // a drag can start on a handle whose resource cannot be resolved, and
  // such a drag ending dead must still buzz rather than slip through the
  // "was there even a drag" check.
  const wireGestureOriginRef = useRef<string | undefined>(undefined);
  const dropFitFrameRef = useRef<number | undefined>(undefined);
  // Export requests are queued: the dialog fires its preview capture the
  // moment it opens, and a second request arriving mid-capture (a background
  // swap, strict mode's double mount) must wait its turn, not error.
  const exportQueueRef = useRef<Promise<void>>(Promise.resolve());
  const boardRef = useRef<HTMLDivElement>(null);
  // Every breathing mark under this element - dead rings and their wires,
  // unwired cards and the notice about them, the hovered-resource wash - shares
  // one period (--board-pulse) and, from here, one phase. See animation-phase.ts.
  useBoardPulseSync(boardRef);
  // ...and a budget of how many may run at once: see useBoardPulseGate.
  useBoardPulseGate(boardRef);
  // Cards off screen are skipped by the browser; see node-containment.ts.
  useNodeContainment(boardRef);
  const flowInstanceRef = useRef<ReactFlowInstance<BoardFlowNode, ResourceFlowEdge> | null>(null);
  // A phone changes several things about the board: which cards can be dragged,
  // which toolbars are folded, where the centred banners sit.
  const isCompact = useIsCompactViewport();
  // The mod's top bar (src/components/chrome) carries the keys the board's own toolbars used to: plan boards on a
  // desktop screen leave them out.
  const modBar = project.planMode === true;
  // The board's zoom ceiling carries the interface size (ui-scale.ts); the
  // prop must follow the setting live, so it is a hook rather than a getter.
  const uiScale = useUiScale();
  const boardMaxZoomValue = BOARD_MAX_ZOOM * uiScale;
  // The two top toolbars fold into their triggers when the BOARD is too
  // narrow for both rows, whatever the window: see toolbar-fold.ts.
  const toolbarFold = useToolbarFold(boardRef, isCompact);

  // A board being resized publishes its frame here (board-resize.ts). The
  // frame's node takes the new rect and its members shift the opposite way,
  // so a moved top/left wall does not tow the cards. Local node state only:
  // nothing reaches the plan until the pointer comes up.
  useEffect(() => {
    registerBoardResize((draft: BoardResizeDraft | undefined) => {
      if (!draft) {
        // The commit that follows re-syncs from the plan; nothing to undo
        // here, and clearing the draft must not fight it.
        return;
      }
      setFlowNodes((currentNodes) => {
        const frame = currentNodes.find((node) => node.id === draft.boardId);
        if (!frame) {
          return currentNodes;
        }
        const dx = frame.position.x - draft.position.x;
        const dy = frame.position.y - draft.position.y;
        if (
          dx === 0 &&
          dy === 0 &&
          frame.width === draft.size.width &&
          frame.height === draft.size.height
        ) {
          return currentNodes;
        }
        return currentNodes.map((node) => {
          if (node.id === draft.boardId) {
            return {
              ...node,
              position: draft.position,
              width: draft.size.width,
              height: draft.size.height,
            } as typeof node;
          }
          if (node.parentId === draft.boardId && (dx !== 0 || dy !== 0)) {
            return {
              ...node,
              position: { x: node.position.x + dx, y: node.position.y + dy },
            } as typeof node;
          }
          return node;
        });
      });
    });
    return () => registerBoardResize(undefined);
  }, []);

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    // Rebuilt node objects lack React Flow's `measured` sizes; syncing them in
    // verbatim would zero every node's dimensions until re-measure, which the
    // geometry fingerprints would read as the whole board resizing.
    //
    // The merge must also hand back the PREVIOUS object whenever nothing in it
    // moved: `nodesFromProject` rebuilds on every hover, and a fresh object per
    // node re-renders the whole board. The node memos rely on this identity.
    //
    // The store carries ids a paste or blueprint load wants selected once the
    // cards exist in flowNodes, which is here. Consumed in the effect body, NOT
    // inside the updater: StrictMode double-invokes updaters, and the second
    // call would find the handoff already cleared.
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
        // React Flow keeps selection on the node objects, so rebuilt objects
        // must inherit it or every project commit clears the selection. A
        // pending paste instead hands the selection to the pasted cards.
        const selected = pendingSelection ? pendingSelection.has(node.id) : previous?.selected;
        // A pocket flipping between card and open board keeps its id but not
        // its shape; carrying the old card's measurement over would publish
        // a frame the size of a card until React Flow re-measures.
        const merged = {
          ...node,
          ...(previous?.measured && previous.type === node.type
            ? { measured: previous.measured }
            : undefined),
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

  useEffect(() => {
    pruneNodeDataCaches(
      new Set(project.nodes.map((node) => node.id)),
      new Set((project.storages ?? []).map((storage) => storage.id)),
      new Set((project.annotations ?? []).map((annotation) => annotation.id)),
      new Set(project.edges.map((edge) => edge.id)),
      new Set((project.pockets ?? []).map((pocket) => pocket.id)),
    );
  }, [project.nodes, project.storages, project.annotations, project.edges, project.pockets]);

  // Flow-space measurements are cached across frames, so anything that moves
  // or resizes a node must drop them explicitly. `flowNodes` changes identity
  // for many reasons that move nothing (hover zIndex, solver results), so
  // geometry is reduced to a fingerprint of positions and React Flow's
  // measured sizes (its ResizeObserver reports content growth through
  // `onNodesChange`). Dimensions are rounded so re-measure jitter cannot
  // masquerade as a resize.
  // Two fingerprints: the OBSTACLE one (machines, drawers, bins, pockets)
  // pays the full bill (measurement invalidation, re-solve, every edge
  // re-issued); annotations are ink wires pass through, so theirs buys only a
  // cheap geometry refresh.
  // They are only compared, so each is a pair of 32-bit rolling hashes rather
  // than a string built per node per drag frame. Positions are quantised at
  // 1/8 px (exact for grid positions); the paired hash makes collisions
  // negligible.
  const geometryFingerprints = useMemo(() => {
    let obstacleA = 0;
    let obstacleB = 0;
    let annotationA = 0;
    let annotationB = 0;
    for (const node of flowNodes) {
      const width = Math.round(node.measured?.width ?? node.width ?? 0);
      const height = Math.round(node.measured?.height ?? node.height ?? 0);
      const quantX = (node.position.x * 8) | 0;
      const quantY = (node.position.y * 8) | 0;
      let hashA = 0;
      let hashB = 0;
      const id = node.id;
      for (let index = 0; index < id.length; index += 1) {
        const code = id.charCodeAt(index);
        hashA = (hashA * 31 + code) | 0;
        hashB = (hashB * 37 + code) | 0;
      }
      hashA = (((((((hashA * 31 + quantX) | 0) * 31 + quantY) | 0) * 31 + width) | 0) * 31 + height) | 0;
      hashB = (((((((hashB * 37 + quantX) | 0) * 37 + quantY) | 0) * 37 + width) | 0) * 37 + height) | 0;
      if (node.type !== "annotationNode") {
        obstacleA = (obstacleA * 31 + hashA) | 0;
        obstacleB = (obstacleB * 37 + hashB) | 0;
      } else {
        annotationA = (annotationA * 31 + hashA) | 0;
        annotationB = (annotationB * 37 + hashB) | 0;
      }
    }
    return {
      obstacle: `${obstacleA}:${obstacleB}`,
      annotation: `${annotationA}:${annotationB}`,
    };
  }, [flowNodes]);
  const obstacleGeometryFingerprint = geometryFingerprints.obstacle;
  const annotationGeometryFingerprint = geometryFingerprints.annotation;
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;
  // Synced in an effect and declared ABOVE the camera effect below, so this
  // commit's cards are in the ref before that effect reads them: a camera
  // move is usually asked for in the very commit that put the cards there.
  const nodesFromProjectRef = useRef(nodesFromProject);
  useEffect(() => {
    nodesFromProjectRef.current = nodesFromProject;
  }, [nodesFromProject]);

  /**
   * Where the cards are, and how big they are, for a camera move.
   *
   * Positions come from `nodesFromProject`, not React Flow's node state, which
   * is one render behind in the commit that put the cards there. Sizes come
   * by id from the cards React Flow has rendered; the rest fall back to the
   * grid's card sizes (see board-camera.ts).
   */
  const cameraCards = useCallback((nodeIds?: string[]) => {
    const wanted = nodeIds && nodeIds.length > 0 ? new Set(nodeIds) : undefined;
    const all = nodesFromProjectRef.current;
    // Members of an open board carry frame-relative positions; the camera
    // frames flow space, so parent chains resolve here first.
    const byId = new Map(all.map((node) => [node.id, node]));
    const absoluteById = new Map<string, { x: number; y: number }>();
    const absoluteOf = (id: string): { x: number; y: number } => {
      const cached = absoluteById.get(id);
      if (cached) {
        return cached;
      }
      const node = byId.get(id)!;
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      const base = parent ? absoluteOf(parent.id) : { x: 0, y: 0 };
      const absolute = { x: base.x + node.position.x, y: base.y + node.position.y };
      absoluteById.set(id, absolute);
      return absolute;
    };
    const picked = wanted ? all.filter((node) => wanted.has(node.id)) : all;
    const cards = picked.map((node) =>
      node.parentId ? ({ ...node, position: absoluteOf(node.id) } as typeof node) : node,
    );
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
        // Nothing to frame: go home rather than sit wherever the last plan
        // left the camera, so the first card placed on an empty tab is easy
        // to find.
        void instance.setCenter(0, 0, { zoom: 1, duration: BOARD_CAMERA_DURATION });
        return;
      }

      // A caller may reserve a strip down the right and be framed in what is
      // left. On a board too narrow to give it away (MIN_FRAMED_WIDTH) the
      // whole width is used and the strip's contents overlap.
      const wanted = Math.max(framing?.insetRight ?? 0, 0);
      const inset = size.width - wanted >= MIN_FRAMED_WIDTH ? wanted : 0;
      const usable = { width: size.width - inset, height: size.height };

      const zoom = zoomForRect(rect, usable, {
        padding: framing?.padding ?? BOARD_CAMERA_PADDING,
        minZoom: BOARD_MIN_ZOOM,
        maxZoom: framing?.maxZoom ?? boardCameraMaxZoom(),
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
   * Put the camera exactly where a design tab was left, instantly. A camera
   * that arrives before the board has initialised (the usual case on page
   * load: the IndexedDB read races React Flow's first render) is parked for
   * `handleInit`.
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

  // Publish the obstacle set for route avoidance from state, not the DOM (see
  // publishedBoardBounds). Reads through the ref so identity-only `flowNodes`
  // churn (hover zIndex, solver results) doesn't feed it.
  const publishBoardGeometry = useCallback((invalidateRoutes = true) => {
    // `invalidateRoutes: false` is the annotation path: notes and boxes are
    // not obstacles, so their moves refresh the published geometry maps and
    // leave the measurement epoch (every cached route and the O(edges)
    // signature rebuild) untouched.
    //
    // Lane scale and clearances are routing inputs like node bounds, both
    // derived from the widest drawable line (edgeClearancesForMode).
    const nextLaneScale = THICK_LINE_LANE_SCALE;
    const nextClearances = edgeClearancesForMode(true);
    if (
      publishedEdgeLaneScale !== nextLaneScale ||
      publishedDirectEdgeNodeClearance !== nextClearances.node ||
      publishedEdgeLinkClearance !== nextClearances.link
    ) {
      publishedEdgeLaneScale = nextLaneScale;
      publishedDirectEdgeNodeClearance = nextClearances.node;
      publishedEdgeLinkClearance = nextClearances.link;
      // Every cached route was solved against the old lanes and clearances.
      clearDirectRoutes();
    }
    // Members of an open board carry frame-RELATIVE positions (so React Flow
    // moves them with the frame); everything downstream of this publish
    // speaks flow space, so the parent chain is resolved here, once.
    const nodeById = new Map(flowNodesRef.current.map((node) => [node.id, node]));
    const absoluteById = new Map<string, { x: number; y: number }>();
    const absoluteOf = (id: string): { x: number; y: number } => {
      const cached = absoluteById.get(id);
      if (cached) {
        return cached;
      }
      const node = nodeById.get(id)!;
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
      const base = parent ? absoluteOf(parent.id) : { x: 0, y: 0 };
      const absolute = { x: base.x + node.position.x, y: base.y + node.position.y };
      absoluteById.set(id, absolute);
      return absolute;
    };
    const geometryById = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of flowNodesRef.current) {
      geometryById.set(node.id, {
        ...absoluteOf(node.id),
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      });
    }
    publishedBoardGeometryById = geometryById;
    // Which cards have their contents mounted is decided from these boxes (virtual/card-virtualizer.ts).
    boardVirtualizer.setGeometry(
      [...geometryById].map(([id, box]) => [id, { x: box.x, y: box.y, w: box.width, h: box.height }] as const),
    );
    const solidCardIds = new Set<string>();
    for (const node of flowNodesRef.current) {
      if (node.type !== "annotationNode" && node.type !== "boardNode") {
        solidCardIds.add(node.id);
      }
    }
    publishedSolidCardIds = solidCardIds;
    // Annotations are ink, not obstacles: wires pass straight through boxes,
    // arrows and notes, so a box drawn around a cluster never changes its
    // routing. Open board frames go in the separate frame list below, solid
    // to every wire except those whose endpoints live inside.
    const annotationIds = new Set(
      flowNodesRef.current
        .filter((node) => node.type === "annotationNode" || node.type === "boardNode")
        .map((node) => node.id),
    );
    const asBounds = (id: string) => {
      const geometry = geometryById.get(id)!;
      return {
        id,
        bounds: {
          left: geometry.x,
          top: geometry.y,
          right: geometry.x + geometry.width,
          bottom: geometry.y + geometry.height,
        },
      };
    };
    publishedBoardBounds = [...geometryById.keys()]
      .filter((id) => !annotationIds.has(id))
      .map(asBounds)
      .filter((entry) => entry.bounds.right > entry.bounds.left)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    publishedBoardFrameBounds = flowNodesRef.current
      .filter((node) => node.type === "boardNode")
      .map((node) => asBounds(node.id))
      .filter((entry) => entry.bounds.right > entry.bounds.left)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (invalidateRoutes) {
      invalidateMeasuredLayout();
    }
  }, []);
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
    // it, wires FOLLOW: a throttled real solve (the one the drop runs) reruns
    // against the card's current cell. Wires freeze instead for an
    // annotation-only drag (ink cannot change a route), a board past the wire
    // cap, or a board whose measured solves blew the frame budget. Not a
    // setting on purpose. The drop republishes explicitly (handleNodeDragStop)
    // because React Flow streams the final position during the last drag
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
    // Edges rendered in this pass routed against the PREVIOUS published
    // geometry (render runs before layout effects). Re-issuing them makes them
    // recompute against what was just published, including nodes that grew
    // as icons or NEI layout resolved.
    setLayoutVersion((version) => version + 1);
  }, [obstacleGeometryFingerprint, publishBoardGeometry]);
  useLayoutEffect(() => {
    // Annotation geometry changed and nothing else: refresh the published
    // maps and touch nothing routing owns. Quiet mid-drag: the drop's
    // explicit publish (handleNodeDragStop) covers the landing, because the
    // fingerprint settles on the last drag frame and will not fire again.
    if (draggingNodeRef.current) {
      return;
    }
    publishBoardGeometry(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationGeometryFingerprint, publishBoardGeometry]);

  // Settle the hop pass. Hops are drawn against lower-index edges' routes in
  // directRouteCache, which fills AS edges render, in no guaranteed order; an
  // edge that rendered early saw an incomplete cache and would never recompute
  // (its signature does not change). So whenever a render added routes, run
  // exactly one more pass. It writes nothing new, so it terminates; the
  // counter backstops an unstable signature and resets when a pass adds
  // nothing.
  const hopSettlePassesRef = useRef(0);
  useEffect(() => {
    // Off mid-drag: live-drag solves already rerender every edge a few times
    // a second, and the drop's publish forces the full pass either way.
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
    (incoming: NodeChange<BoardFlowNode>[]) => {
      let changes = incoming;
      // A marquee that STARTED inside a board may not select that board: the
      // band selects on partial contact, so it always touches the frame.
      // Dropped here rather than by unsetting `selectable`, so the frame
      // never flickers selected and the store never hears about it.
      const shielded = marqueeShieldRef.current;
      if (shielded.size > 0) {
        changes = changes.filter(
          (change) =>
            !(change.type === "select" && change.selected && shielded.has(change.id)),
        );
      }
      // Passengers ride their held frame, so their own position changes are
      // dropped. Then the placement magnet, live: a held card is never
      // allowed onto a spot it cannot have, so it slides along whatever it
      // meets instead of being tidied up after the drop.
      const passengers = dragPassengersRef.current;
      if (passengers.size > 0) {
        changes = changes.filter(
          (change) => change.type !== "position" || !passengers.has(change.id),
        );
      }
      const drop = groupDropRef.current;
      if (drop) {
        const change = changes.find(
          (entry) => entry.type === "position" && entry.dragging && entry.position && entry.id === drop.primary,
        );
        const geometry = publishedBoardGeometryById.get(drop.primary);
        if (change && change.type === "position" && change.position && geometry) {
          const box = {
            x: change.position.x + drop.origin.x,
            y: change.position.y + drop.origin.y,
            width: geometry.width,
            height: geometry.height,
          };
          // Where the pointer aims, before the magnet slides the card clear of what is in the way: a full group still
          // takes it (and grows round it).
          drop.target = groupUnder(drop.frames, box, BOARD_WINDOW_TITLE_HEIGHT, drop.excluded);
          showGroupDrop(drop.target, drop.from);
        }
      }
      const constraints = dragConstraintsRef.current;
      if (constraints.size > 0) {
        for (const change of changes) {
          if (change.type !== "position" || !change.dragging || !change.position) {
            continue;
          }
          const constraint = constraints.get(change.id);
          if (
            !constraint ||
            (constraint.blockers.length === 0 && constraint.regions.length === 0)
          ) {
            continue;
          }
          const geometry = publishedBoardGeometryById.get(change.id);
          const width = geometry?.width ?? 0;
          const height = geometry?.height ?? 0;
          if (width <= 0 || height <= 0) {
            continue;
          }
          const absolute = {
            x: change.position.x + constraint.origin.x,
            y: change.position.y + constraint.origin.y,
            width,
            height,
          };
          const free = nearestFreeSpot(
            absolute,
            constraint.blockers,
            0,
            undefined,
            constraint.regions,
          );
          change.position = {
            x: free.x - constraint.origin.x,
            y: free.y - constraint.origin.y,
          };
        }
      }
      setFlowNodes((currentNodes) => {
        const next = applyNodeChanges(changes, currentNodes) as BoardFlowNode[];
        // Only when the selection moved. This runs on every frame of a drag, and
        // walking every card each frame is the kind of per-frame O(nodes) work
        // CLAUDE.md rules out.
        return changes.some((change) => change.type === "select")
          ? withTouchDragRule(next, isCompact)
          : next;
      });
    },
    [isCompact],
  );

  // The wires follow an edit in a render of their own (deferred): rebuilding every wire is about 100 ms of a
  // 1,000-card edit, and the board's first paint after a click no longer waits for it. They catch up at once.
  const edgeProject = useDeferredValue(project);
  const edgeResult = useDeferredValue(result);
  const edges = useMemo<ResourceFlowEdge[]>(() => {
    const project = edgeProject;
    const result = edgeResult;
    // A producer starved of its own inputs cannot offer its nameplate, so
    // every capacity the labels see is scaled by the producer's real ceiling.
    // A machine merely idle for lack of demand keeps a ceiling of 1 - hooking
    // up a new consumer genuinely would speed it up.
    const supplyCeilings = new Map<string, number>();
    // Built once for the whole edge pass, not once per edge: the index itself
    // is cached per solve, but the lookup below runs for every wire.
    const deathSpiralEdges = findDeathSpirals(project, result).byEdge;
    const clogLockEdges = findClogLocks(project, result).byEdge;
    // A plan board's rings: the wires joining their cards along their rows.
    const planLoopEdges = loopEdges(project.edges, result.plan?.loops);
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
    // up front because line styling needs every edge's figure first.
    //
    // A bare loop with no local helper functions on purpose: a function
    // declared and called inside this memo makes the React Compiler drop its
    // memoization of the whole thing, and this is the hottest memo on the board.
    //
    // Items and fluids get their own scale: fluid lines move ~1000x more, so
    // one shared range would paint every item line at the cold end.
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
      // hottest, a sliver at the coldest.
      publishedEdgeStrokeWidths.set(
        edge.id,
        boardView.fixedEdgeWidth ? FLOW_MODE_MIN_WIDTH : laneWidthForHeat(heat),
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

    // Channels (see `mergedEdgeIds`): flat edges carrying one resource between
    // the same two visible cards draw as ONE wire. The first flat edge is the
    // representative, the rest are skipped, the rates are summed.
    const channelKeyFor = (edge: FactoryEdge, sourceRep: string, targetRep: string) =>
      // Handles stay out of the key on purpose: two slots or two recipes of
      // one material between two cards are still one wire on the board.
      [sourceRep, targetRep, edge.resourceKind, edge.resourceId].join("|");

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
        const key = channelKeyFor(edge, sourceRep, targetRep);
        const group = groups.get(key);
        if (group) {
          group.ids.push(edge.id);
        } else {
          groups.set(key, { representativeId: edge.id, ids: [edge.id] });
        }
      }
      // A map, not a linear find per grouped id, which is O(edges²) on a board
      // of many same-resource channels with no solver results yet.
      const projectRateByEdgeId = new Map(
        project.edges.map((entry) => [entry.id, entry.ratePerSecond]),
      );
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
          demand += edgeResult?.demandPerSecond ?? projectRateByEdgeId.get(id) ?? 0;
          if (id !== group.representativeId) {
            channelSkip.add(id);
          }
        }
        channelTotals.set(group.representativeId, { transferred, demand });
      }
    }

    // Which open frames each wire may cross: the chain of open boards its
    // endpoint cards live inside. A wire into a member must cross that
    // board's border to exist; every OTHER frame turns it away like a card.
    const hasOpenFrames = pocketView.openBoards.length > 0;
    const frameChainByLevel = new Map<string | undefined, string[]>();
    const frameOwnerById = new Map<string, string | undefined>();
    if (hasOpenFrames) {
      frameChainByLevel.set(undefined, []);
      for (const board of pocketView.openBoards) {
        frameChainByLevel.set(board.id, [
          ...(frameChainByLevel.get(board.parentPocketId) ?? []),
          board.id,
        ]);
      }
      for (const node of project.nodes) {
        frameOwnerById.set(node.id, node.pocketId);
      }
      for (const storage of project.storages ?? []) {
        frameOwnerById.set(storage.id, storage.pocketId);
      }
      for (const pocket of project.pockets ?? []) {
        frameOwnerById.set(pocket.id, pocket.parentPocketId);
      }
    }

    // What the grid solve needs about every wire, collected as the edge
    // objects are built and published in one shot below.
    const gridRouteInputs: GridRouteEdgeInput[] = [];
    const ratioByEdge = new Map<string, number>();
    for (const branches of getProjectRatioBranches(project).values()) {
      branches.forEach((branch) => {
        for (const edge of branch.edges) ratioByEdge.set(edge.id, branch.share / branch.edges.length);
      });
    }
    const inputRatioByEdge = new Map<string, number>();
    for (const branches of getProjectRatioBranches(project, "input").values()) {
      for (const branch of branches) for (const edge of branch.edges) inputRatioByEdge.set(edge.id, branch.share / branch.edges.length);
    }
    const builtEdges = project.edges.flatMap((edge, edgeIndex) => {
      // View remap only; the project edge is never touched. An endpoint inside
      // a minimized board renders against that board's card; a wire with no
      // visible representative on an end does not render at all.
      const sourceRep = pocketView.representativeOf(edge.source);
      const targetRep = pocketView.representativeOf(edge.target);
      // Both ends on one card means the wire is interior to a minimized board,
      // UNLESS it is a machine wired into itself and standing as itself, a
      // loop the board must show.
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
      const demand =
        channelTotal?.demand ?? edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      const sourceStorage = storagesById.get(edge.source);
      const targetStorage = storagesById.get(edge.target);
      // Pre-computed above, storage adjustment and all; a channel
      // representative carries the whole channel's flow.
      const transferred = channelTotal?.transferred ?? transferredById.get(edge.id) ?? 0;
      // This line's place in its own kind's range (see flowHeatFor).
      const flowHeat = flowHeatById.get(edge.id) ?? 0;
      // Storage soaks up whatever arrives, so a line into a barrel is never
      // supply-capped.
      const isSupplyCapped = edgeResult?.constraint === "supply" && !targetStorage;
      const isStorageEdge = Boolean(sourceStorage || targetStorage);
      const resource = getEdgeResource(project, edge);
      const edgeColor = getInitialResourceColor(resource);
      const sourceHandle = parseResourceHandleId(edge.sourceHandle);
      const targetHandle = parseResourceHandleId(edge.targetHandle);
      // A legacy trash can is an any-side card like a drawer, so it routes as
      // a "storage" endpoint.
      const targetIsTrashCan = targetHandle?.resourceId === TRASH_ANY_RESOURCE_ID;
      // Rails render one canonical (index-less) handle per resource; stored
      // edges may carry legacy per-slot ids. Collapse them here or React Flow
      // refuses to draw the edge and the anchor lookup misses the port.
      // A MINIMIZED BOARD has no ports: the wire docks anywhere on the card,
      // like a drawer, and its handles are inert anchors that exist only
      // because React Flow will not draw an edge without one.
      const canonicalSourceHandle = sourceIsPocket
        ? POCKET_CARD_SOURCE_HANDLE
        : canonicalizeResourceHandleId(edge.sourceHandle);
      const canonicalTargetHandle = targetIsPocket
        ? POCKET_CARD_TARGET_HANDLE
        : canonicalizeResourceHandleId(edge.targetHandle);
      const isFlowHighlighted =
        activeFlowResourceKey === makeResourceKey(edge.resourceKind, edge.resourceId);

      let throughBoardIds: string[] | undefined;
      let homeBoardIds: string[] | undefined;
      if (hasOpenFrames) {
        const sourceChain = frameChainByLevel.get(frameOwnerById.get(sourceRep));
        const targetChain = frameChainByLevel.get(frameOwnerById.get(targetRep));
        if (sourceChain?.length && targetChain?.length) {
          throughBoardIds =
            sourceChain === targetChain
              ? sourceChain
              : [...new Set([...sourceChain, ...targetChain])];
          // The rooms BOTH ends sit in: the wire stays inside these and
          // only crosses the frames one end is outside of. Chains run
          // outermost-first, so the shared prefix is the answer.
          homeBoardIds = sourceChain.filter((id) => targetChain.includes(id));
        } else if (sourceChain?.length || targetChain?.length) {
          throughBoardIds = sourceChain?.length ? sourceChain : targetChain;
        }
      }

      gridRouteInputs.push({
        edgeId: edge.id,
        order: edgeIndex,
        sourceNodeId: sourceRep,
        targetNodeId: targetRep,
        throughBoardIds,
        homeBoardIds,
        // A machine end is a PORT even when the stored edge carries no handle
        // id (old plans, the demo): the rails publish canonical ids derived
        // from the resource, so the same derivation finds the measured port.
        sourceHandleId:
          canonicalSourceHandle ??
          makeResourceHandleId("output", { kind: edge.resourceKind, id: edge.resourceId }),
        targetHandleId:
          canonicalTargetHandle ??
          makeResourceHandleId("input", { kind: edge.resourceKind, id: edge.resourceId }),
        // A minimized board is an any-side card like a drawer: the wire
        // reaches the summary, and the summary has no rows to aim at.
        sourceSlotEndpoint: !sourceIsPocket && !sourceStorage,
        targetSlotEndpoint: !targetIsPocket && !targetStorage && !targetIsTrashCan,
        sourceStorageEndpoint: sourceIsPocket || Boolean(sourceStorage),
        targetStorageEndpoint:
          targetIsPocket || Boolean(targetStorage || targetIsTrashCan),
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
        // Thick wires pass UNDER the cards, or they would bury the ports they
        // dock into. -1 keeps them above annotation boxes (-5), which must
        // stay backmost. A dragged card is elevated (handleNodeDragStart), so
        // a card in hand always passes over the wiring.
        zIndex: -1,
        source: sourceRep,
        target: targetRep,
        sourceHandle: canonicalSourceHandle,
        targetHandle: canonicalTargetHandle,
        type: "resourceEdge",
        data: {
          resource,
          ratio: (sourceIsPocket || !ratioByEdge.has(edge.id)) && (targetIsPocket || !inputRatioByEdge.has(edge.id)) ? undefined : {
            output: sourceIsPocket || !ratioByEdge.has(edge.id) ? undefined : (channelEdgeIdsByRepresentative.get(edge.id) ?? [edge.id]).reduce((sum, id) => sum + (ratioByEdge.get(id) ?? 0), 0),
            input: targetIsPocket || !inputRatioByEdge.has(edge.id) ? undefined : (channelEdgeIdsByRepresentative.get(edge.id) ?? [edge.id]).reduce((sum, id) => sum + (inputRatioByEdge.get(id) ?? 0), 0),
          },
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
          resourceKind: edge.resourceKind,
          isLimited: edgeResult?.isLimited === true && !targetStorage,
          isSupplyCapped,
          isStorageTarget: Boolean(targetStorage),
          isStorageEdge,
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
          // The ring's own wires carry the mark so the circle reads as one
          // shape, not N red cards that happen to sit together.
          isDeadLoop: deathSpiralEdges.has(edge.id),
          isClogLock: clogLockEdges.has(edge.id),
          planLoop: planLoopEdges.get(edge.id),
          flowRate: anyLineMode
            ? {
                heat: flowHeat,
                idle: (transferredById.get(edge.id) ?? 0) <= RATE_DISPLAY_EPSILON,
                kind: flowBucketFor(edge.resourceKind),
                color: speedColorMode,
                thickness: true,
                // Marching dashes are disabled: their canvas repainted the
                // whole board every frame and lagged the camera by a frame.
                pulse: false,
              }
            : undefined,
          layoutEpoch: layoutVersion,
        },
        style: {
          // Always the resource colour: the edge component derives its own
          // speed-view stroke at the point of use (it knows the LOD step).
          stroke: edgeColor,
          strokeOpacity: 0.95,
          strokeWidth: boardView.fixedEdgeWidth ? FLOW_MODE_MIN_WIDTH : laneWidthForHeat(flowHeat),
        },
      })];
    });

    publishGridRouteEdges(gridRouteInputs);
    publishRatioLabelInputs(builtEdges.flatMap((edge) => edge.data?.ratio ? [{ id: edge.id, ...edge.data.ratio }] : []));

    // Paint order IS depth, and it must be the SAME order hop rendering uses,
    // or a line hops over something drawn on top of it anyway.
    // compareEdgeDepth is that single order; see it for why thin goes on top.
    // Some overlap between thick wires cannot be routed away, and React Flow
    // paints edges in array order, so the sort keeps that overlap stable.
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
    boardView.fixedEdgeWidth,
    anyLineMode,
    speedColorMode,
    layoutVersion,
    pocketSummaries,
    pocketView,
    edgeProject,
    recipeSearch,
    edgeResult,
    storagesById,
  ]);

  // The build timelapse (board-timelapse.ts). While a run is on, unrevealed
  // cards and wires wear React Flow's `hidden` flag, applied HERE, downstream
  // of every real memo, so published geometry, the route solve and the drag
  // machinery keep seeing the full board and no route moves. Stopping hands
  // back the original arrays untouched.
  const timelapse = useSyncExternalStore(
    subscribeBoardTimelapse,
    getBoardTimelapseSnapshot,
    getServerBoardTimelapseSnapshot,
  );
  const visibleFlowNodes = useMemo(() => {
    if (!timelapse) {
      return flowNodes;
    }
    const byId = new Map(flowNodes.map((node) => [node.id, node]));
    const absoluteOf = (node: BoardFlowNode) => {
      let x = node.position.x;
      let y = node.position.y;
      let parentId = node.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) {
          break;
        }
        x += parent.position.x;
        y += parent.position.y;
        parentId = parent.parentId;
      }
      return { x, y };
    };
    return flowNodes.map((node) => {
      if (!timelapse.revealedNodeIds.has(node.id)) {
        return { ...node, hidden: true } as typeof node;
      }
      // Mounted so its wire can draw toward it, held at nothing until its
      // pop beat (globals.css dresses the class).
      const pendingClass = timelapse.pendingNodeIds.has(node.id)
        ? [node.className, "timelapse-pending"].filter(Boolean).join(" ")
        : undefined;
      // A frame is revealed after its members, but React Flow hides every
      // child of a hidden parent, so until the frame's beat its members stand
      // parentless at the same absolute spot.
      if (node.parentId && !timelapse.revealedNodeIds.has(node.parentId)) {
        return {
          ...node,
          parentId: undefined,
          position: absoluteOf(node),
          ...(pendingClass ? { className: pendingClass } : undefined),
        } as typeof node;
      }
      if (pendingClass) {
        return { ...node, className: pendingClass } as typeof node;
      }
      return node;
    });
  }, [flowNodes, timelapse]);
  // Revealed edges wear the draw-in flag through a WeakMap keyed on the
  // real edge object, so their flagged copies keep identity across the
  // beats and React Flow does not re-render every standing wire per beat.
  const timelapseEdgeFlagCache = useRef(new WeakMap<ResourceFlowEdge, ResourceFlowEdge>());
  const visibleFlowEdges = useMemo(() => {
    if (!timelapse) {
      return edges;
    }
    const cache = timelapseEdgeFlagCache.current;
    return edges.map((edge) => {
      if (!timelapse.revealedEdgeIds.has(edge.id)) {
        return { ...edge, hidden: true };
      }
      let flagged = cache.get(edge);
      if (!flagged) {
        flagged = {
          ...edge,
          data: edge.data ? { ...edge.data, timelapseDraw: true } : edge.data,
        };
        cache.set(edge, flagged);
      }
      return flagged;
    });
  }, [edges, timelapse]);
  // Esc or any press on the board ends the show; so does unmounting it.
  // Presses on the timelapse chip are the one exception: its speed buttons
  // are how the run is steered, not a reason to end it.
  const timelapseActive = timelapse !== undefined;
  useEffect(() => {
    if (!timelapseActive) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // A dialog above the board owns its own Escape; that press must close
        // it, not end the show.
        if (document.querySelector('[role="dialog"]')) {
          return;
        }
        event.stopPropagation();
        stopBoardTimelapse();
      }
    };
    const board = boardRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-timelapse-chip]")) {
        return;
      }
      stopBoardTimelapse();
    };
    const stopKeys = listenForBoardInput("keydown", onKeyDown, () => coveredRef.current, true);
    board?.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      stopKeys();
      board?.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [timelapseActive]);
  useEffect(() => stopBoardTimelapse, []);
  // The demo-card tilt (board-tilt.ts): worn during a timelapse (until the
  // finale flattens it for the wide reveal) or all the time when the dev
  // menu says so. Angles are CSS variables so slider edits apply live.
  const boardTilt = useSyncExternalStore(
    subscribeBoardTilt,
    getBoardTiltSnapshot,
    getServerBoardTiltSnapshot,
  );
  // The tilt is worn for the whole run, finale included; when the show ends
  // the board eases to its resting look (the tilt checkbox's state). A HELD
  // ending keeps its lean until the next run.
  const [tiltHeldAfterShow, setTiltHeldAfterShow] = useState(false);
  const wasTimelapseActiveRef = useRef(false);
  useEffect(() => {
    const was = wasTimelapseActiveRef.current;
    wasTimelapseActiveRef.current = timelapseActive;
    if (timelapseActive) {
      setTiltHeldAfterShow(false);
    } else if (was) {
      setTiltHeldAfterShow(didBoardTimelapseEndHeld());
    }
  }, [timelapseActive]);
  const tiltWorn = timelapseActive || boardTilt.always || tiltHeldAfterShow;
  // The timelapse camera. Each beat retargets a shot; a rAF chase eases the
  // viewport toward it every frame, so the shot pans continuously instead of
  // hopping fit to fit. The chase runs only during a timelapse and reads the
  // board size once per run, not per frame.
  const timelapseCameraTargetRef = useRef<{ x: number; y: number; zoom: number } | undefined>(
    undefined,
  );
  const timelapseSpeedRef = useRef(1);
  const timelapseFinaleRef = useRef(false);
  const timelapseCinematicRef = useRef(false);
  // When the current camera move LAUNCHED, for the short ease-in ramp. Only a
  // genuine jump resets it: the cinematic creep retargets every beat by
  // inches and must not live permanently inside the ramp.
  const timelapseCameraLaunchRef = useRef(0);
  // Where the NEXT beat happens, in flow space: the beat gate fires as soon
  // as this rect is inside the live viewport, mid-glide included.
  const timelapseUpcomingRectRef = useRef<BoardRect | undefined>(undefined);
  useEffect(() => {
    if (!timelapse) {
      timelapseCameraTargetRef.current = undefined;
      timelapseUpcomingRectRef.current = undefined;
      return;
    }
    timelapseSpeedRef.current = timelapse.speed;
    timelapseFinaleRef.current = timelapse.finale;
    // A HELD ending: the finale beat retargets nothing - the camera stays
    // exactly where the build left it, and the stop skips its closing fit.
    if (timelapse.finale && getBoardTimelapseHoldEnding()) {
      return;
    }
    const board = boardRef.current;
    if (!board || timelapse.focusGroups.length === 0) {
      return;
    }
    const size = board.getBoundingClientRect();
    if (size.width === 0 || size.height === 0) {
      return;
    }
    // The tilt shows LESS of the plane than the flat pixel size (cover scale
    // plus keystone), so all shot PLANNING below works against the tilted
    // visible area. The rAF chase keeps the real size: it maps React Flow's
    // own 2D transform, which the tilt sits on top of.
    const visible = tiltWorn ? boardTiltVisibleFraction(boardTilt) : { x: 1, y: 1 };
    const planSize = { width: size.width * visible.x, height: size.height * visible.y };
    // The player's working zoom range, read per plan so slider edits take
    // hold on the next shot.
    const zoomRange = getBoardTimelapseZoomRange();
    // Every new shot goes through here so a genuine jump restarts the
    // launch ramp (screen-space distance at the destination zoom).
    const setShot = (next: { x: number; y: number; zoom: number }) => {
      const previous = timelapseCameraTargetRef.current;
      if (
        !previous ||
        Math.hypot((next.x - previous.x) * next.zoom, (next.y - previous.y) * next.zoom) > 150 ||
        Math.abs(next.zoom - previous.zoom) > 0.08
      ) {
        timelapseCameraLaunchRef.current = performance.now();
      }
      timelapseCameraTargetRef.current = next;
    };
    const rectOf = (ids: readonly string[]) => {
      const { cards, measuredById } = cameraCards([...ids]);
      return framingRect(cards, measuredById);
    };
    const actionRect = rectOf(timelapse.focusGroups[0]);
    if (!actionRect) {
      return;
    }
    // What the beat gate watches for: the next beat's stage, or this
    // beat's when the script ends here.
    timelapseUpcomingRectRef.current =
      rectOf(timelapse.focusGroups[1] ?? timelapse.focusGroups[0]) ?? actionRect;

    // CINEMATIC: frame everything that stands PLUS the next stretch of the
    // script, centred on the whole build. The union only grows, so the motion
    // is one continuous outward glide with no deadband or shot planning.
    if (getBoardTimelapseCameraMode() === "cinematic" && !timelapse.finale) {
      const coverIds = new Set<string>(timelapse.revealedNodeIds);
      for (const group of timelapse.focusGroups) {
        for (const id of group) {
          coverIds.add(id);
        }
      }
      const coverRect = coverIds.size > 0 ? rectOf([...coverIds]) : undefined;
      if (coverRect) {
        timelapseCinematicRef.current = true;
        const centre = rectCentre(coverRect);
        setShot({
          x: centre.x,
          y: centre.y,
          // The Offset dial nudges the fit: above 1 sits closer than full
          // coverage, below 1 hangs back with more air.
          zoom: Math.min(
            Math.max(zoomRange.max, zoomRange.min),
            zoomForRect(coverRect, planSize, {
              padding: 0.22,
              minZoom: BOARD_MIN_ZOOM,
              maxZoom: boardCameraMaxZoom(),
            }) * getBoardTimelapseCineZoom(),
          ),
        });
        return;
      }
    }
    timelapseCinematicRef.current = false;

    // The DEADBAND: while this beat's action sits comfortably inside the
    // standing shot, the camera does not move at all.
    const shot = timelapseCameraTargetRef.current;
    if (shot && !timelapse.finale) {
      const inset = 0.04;
      const halfW = (planSize.width / shot.zoom) * (0.5 - inset);
      const halfH = (planSize.height / shot.zoom) * (0.5 - inset);
      if (
        actionRect.x >= shot.x - halfW &&
        actionRect.y >= shot.y - halfH &&
        actionRect.x + actionRect.width <= shot.x + halfW &&
        actionRect.y + actionRect.height <= shot.y + halfH
      ) {
        return;
      }
    }

    // A NEW SHOT: start on this beat's action and widen over the upcoming
    // beats while everything still fits above the zoom range's minimum. The
    // finale skips the planning and frames the whole board.
    const unionRects = (a: BoardRect, b: BoardRect): BoardRect => {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
      };
    };
    let union = actionRect;
    if (!timelapse.finale) {
      for (const group of timelapse.focusGroups.slice(1)) {
        const rect = rectOf(group);
        if (!rect) {
          continue;
        }
        const widened = unionRects(union, rect);
        // Slim padding: this only asks whether all of it stays above the
        // wide limit; the standard padding makes the planner give up early.
        const fit = zoomForRect(widened, planSize, {
          padding: 0.06,
          minZoom: BOARD_MIN_ZOOM,
          maxZoom: boardCameraMaxZoom(),
        });
        if (fit < zoomRange.min) {
          break;
        }
        union = widened;
      }
    }
    const centre = rectCentre(union);
    if (process.env.NODE_ENV !== "production") {
      // Probe instrumentation: how often the camera actually cuts.
      const w = window as unknown as { __timelapseCuts?: number };
      w.__timelapseCuts = (w.__timelapseCuts ?? 0) + 1;
    }
    setShot({
      x: centre.x,
      y: centre.y,
      // Shots are capped by the zoom range so the next few beats can land
      // inside the deadband instead of forcing a cut every beat. The finale
      // goes wider than the fit (extra padding and a shave) so an ending
      // never clips a card; in cinematic the Offset dial nudges it too.
      zoom: timelapse.finale
        ? zoomForRect(union, planSize, {
            padding: 0.34,
            minZoom: BOARD_MIN_ZOOM,
            maxZoom: boardCameraMaxZoom(),
          }) *
          0.94 *
          (getBoardTimelapseCameraMode() === "cinematic" ? getBoardTimelapseCineZoom() : 1)
        : Math.min(
            Math.max(zoomRange.max, zoomRange.min),
            Math.max(
              zoomRange.min,
              zoomForRect(union, planSize, {
                padding: BOARD_CAMERA_PADDING,
                minZoom: BOARD_MIN_ZOOM,
                maxZoom: boardCameraMaxZoom(),
              }),
            ),
          ),
    });
  }, [timelapse, cameraCards, tiltWorn, boardTilt]);
  useEffect(() => {
    if (!timelapseActive) {
      return;
    }
    const board = boardRef.current;
    const size = board?.getBoundingClientRect();
    if (!size || size.width === 0 || size.height === 0) {
      return;
    }
    // Panning leans the tilted plane into the motion, via additive CSS
    // variables React's style never touches (the base angles are React's).
    // The .react-flow transform transition smooths the per-frame writes.
    const setBreathe = (yawDeg: number, pitchDeg: number) => {
      board?.style.setProperty("--board-tilt-breathe-yaw", `${yawDeg.toFixed(2)}deg`);
      board?.style.setProperty("--board-tilt-breathe-pitch", `${pitchDeg.toFixed(2)}deg`);
    };
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      const target = timelapseCameraTargetRef.current;
      const instance = flowInstanceRef.current;
      if (!target || !instance) {
        return;
      }
      // An exponential chase: a fixed fraction of the remaining distance per
      // time slice, so a retarget mid-flight bends the path instead of
      // restarting it. The finale is brisker, and the constant tightens with
      // playback speed. The pace dial divides the time constant; read per
      // frame so the slider takes hold mid-flight.
      const pace = getBoardTimelapseCameraPace();
      const tau = timelapseFinaleRef.current
        ? Math.min(8000, Math.max(40, 260 / pace))
        : timelapseCinematicRef.current
          ? // The crane: far slower than any cut, so the drifting target
            // reads as one long pan rather than a chase.
            Math.min(20000, Math.max(400, 2600 / pace))
          : Math.min(12000, Math.max(40, 420 / (timelapseSpeedRef.current * pace)));
      const k = 1 - Math.exp(-dt / tau);
      const viewport = instance.getViewport();
      const wantX = size.width / 2 - target.x * viewport.zoom;
      const wantY = size.height / 2 - target.y * viewport.zoom;
      const remaining =
        Math.hypot(wantX - viewport.x, wantY - viewport.y) +
        Math.abs(target.zoom - viewport.zoom) * 900;
      // The playback holds beats until the next beat's stage is in view or
      // the camera has essentially arrived (the camera sets the pace);
      // zoom distance counts as travel too.
      let upcomingOnScreen = false;
      const upcoming = timelapseUpcomingRectRef.current;
      if (upcoming) {
        const insetX = size.width * 0.05;
        const insetY = size.height * 0.05;
        upcomingOnScreen =
          upcoming.x * viewport.zoom + viewport.x >= insetX &&
          upcoming.y * viewport.zoom + viewport.y >= insetY &&
          (upcoming.x + upcoming.width) * viewport.zoom + viewport.x <= size.width - insetX &&
          (upcoming.y + upcoming.height) * viewport.zoom + viewport.y <= size.height - insetY;
      }
      reportTimelapseCameraProgress(remaining, upcomingOnScreen);
      // A pure exponential never lands (the last stretch crawls), so a FLOOR
      // on closing speed makes the landing definite.
      const minClose = ((timelapseCinematicRef.current ? 100 : 340) * pace * dt) / 1000;
      // The LAUNCH ramp: a fresh move swells into motion over a short
      // smoothstep, scaled by the pace dial.
      const rampMs = Math.min(600, Math.max(90, 240 / pace));
      const launch = Math.min(1, (now - timelapseCameraLaunchRef.current) / rampMs);
      const launchEase = launch * launch * (3 - 2 * launch);
      const factor =
        remaining > 0.01
          ? Math.min(1, Math.max(k, minClose / remaining) * launchEase)
          : 1;
      const zoom = viewport.zoom + (target.zoom - viewport.zoom) * factor;
      const landX = size.width / 2 - target.x * zoom;
      const landY = size.height / 2 - target.y * zoom;
      // Within a pixel of the vantage: land EXACTLY and go still. The
      // held shot must be a held shot.
      if (
        Math.abs(landX - viewport.x) < 0.75 &&
        Math.abs(landY - viewport.y) < 0.75 &&
        Math.abs(target.zoom - viewport.zoom) < 0.001
      ) {
        if (viewport.x !== landX || viewport.y !== landY || viewport.zoom !== target.zoom) {
          void instance.setViewport({ x: landX, y: landY, zoom: target.zoom });
        }
        setBreathe(0, 0);
        return;
      }
      const x = viewport.x + (landX - viewport.x) * factor;
      const y = viewport.y + (landY - viewport.y) * factor;
      // Lean into the pan: velocity in screen px/s, clamped to a few
      // degrees either way, easing back to level as the camera settles.
      const velocityX = ((x - viewport.x) / Math.max(1, dt)) * 1000;
      const velocityY = ((y - viewport.y) / Math.max(1, dt)) * 1000;
      setBreathe(
        Math.max(-4, Math.min(4, -velocityX * 0.006)),
        Math.max(-2.5, Math.min(2.5, velocityY * 0.004)),
      );
      void instance.setViewport({ x, y, zoom });
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      board?.style.removeProperty("--board-tilt-breathe-yaw");
      board?.style.removeProperty("--board-tilt-breathe-pitch");
    };
  }, [timelapseActive]);

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
      // A minimized board is a summary with no ports: never guess which
      // machine inside a wire meant. The player opens it and wires the machine.
      if (isPocketId(project, sourceNodeId) || isPocketId(project, targetNodeId)) {
        return;
      }
      const sourceIds = [sourceNodeId];
      const targetIds = [targetNodeId];

      const pairs: Array<{
        sourceNodeId: string;
        targetNodeId: string;
        resource?: typeof resource;
      }> = [];
      for (const source of sourceIds) {
        for (const target of targetIds) {
          // A self pair the user actually aimed (the same card named on both
          // ends) is a real loop and has to survive.
          if (source === target && sourceNodeId !== targetNodeId) {
            continue;
          }

          const sourceHandleIds =
            resource?.sourceHandle && resource.kind && resource.id
              ? getRepeatedOutputHandleIds(project, source, resource, resource.sourceHandle)
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
      // Pool mode has no wires: a port-to-port drag lands nothing. (A drag
      // into empty space still makes a drawer, whose side is the link.)
      if (useFactoryStore.getState().project.poolMode) {
        return;
      }
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
          // when something else lands on it. Test which CARD this is, not the
          // port id: once adopted, its port carries a real resource id and
          // would refuse every other resource.
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

          if (!outputResource || !inputResource) {
            return;
          }
          // A cell and its fluid never wire straight to each other: they meet in a fluid tank.
          if (!resourceMatchesInput(outputResource, inputResource)) {
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
    voidDropWillSpawn = false;
    voidDropGhostStorage = undefined;
    liveDraggedResource = undefined;
    snapWillDeleteEdge = false;
    paintDoomedEdge(undefined);
  }, []);

  const startDropFitPainting = useCallback(() => {
    clearNodeDropFit();

    if (!draggedResourceRef.current) {
      return;
    }

    // Entering wiring mode: clear whatever hover highlight the pointer lit on
    // the way to the handle.
    setWiringConnection(true);
    boardRef.current?.classList.add(WIRING_BOARD_CLASS);
    const store = useFactoryStore.getState();
    store.setHoveredFlowScope(undefined);
    clearHopMap();

    paintNodeDropFit(project, draggedResourceRef.current, false);

    // What a VOID release would do, decided once per drag: it depends on
    // the plan and the dragged port, never on where the pointer is. The
    // connection line reads this per frame to color the pipe.
    const dragged = draggedResourceRef.current;
    liveDraggedResource = dragged;
    if (dragged && !isPocketId(project, dragged.nodeId)) {
      const originIsStorage = (project.storages ?? []).some(
        (storage) => storage.id === dragged.nodeId,
      );
      const spawnSide = originIsStorage ? "input" : dragged.side;
      const spawnHandleId = originIsStorage
        ? makeResourceHandleId("input", { kind: dragged.kind, id: dragged.id })
        : dragged.handleId;
      voidDropWillSpawn = wouldConnectionStorageSpawn(
        project,
        dragged,
        dragged.nodeId,
        spawnSide,
        spawnHandleId,
      );
      voidDropReason = "Drawer already exists";
      // POOL MODE: no sources (the pool feeds every input), and ONE product
      // drawer per resource - a second would only be the same ask twice.
      if (project.poolMode) {
        if (spawnSide === "input") {
          voidDropWillSpawn = false;
          voidDropReason = "Pool mode feeds inputs by itself";
        } else if (
          (project.storages ?? []).some(
            (storage) =>
              storage.kind === dragged.kind &&
              storage.resourceId === dragged.id &&
              getStorageRoles(project).get(storage.id) === "product",
          )
        ) {
          voidDropWillSpawn = false;
          voidDropReason = "You already have a product drawer for this";
        }
      }
      voidDropGhostStorage = {
        id: "__void-drop-ghost__",
        kind: dragged.kind,
        resourceId: dragged.id,
        displayName: dragged.displayName,
        iconPath: dragged.iconPath,
        iconAtlas: dragged.iconAtlas,
        dominantColor: dragged.dominantColor ?? dragged.iconAtlas?.dominantColor,
        position: { x: 0, y: 0 },
      };
      voidDropGhostRole = spawnSide === "input" ? "source" : "product";
    } else {
      voidDropWillSpawn = false;
      voidDropGhostStorage = undefined;
    }

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
      // A content fingerprint, not the reference: a refused spawn commits a
      // rebuilt-but-identical project, which must still count as unchanged
      // so the failure sound plays.
      connectStartFingerprintRef.current = projectSoundFingerprint(
        useFactoryStore.getState().project,
      );
      wireGestureOriginRef.current = nodeId ?? undefined;
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
        // The mouseup that ends a wire must not pair into a double-click on a
        // pocket card.
        markWireDrop();
      }
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      lastConnectionPointerRef.current = undefined;
      // Ranked candidates, not a first-match chain: the exact slot under the
      // pointer is asked first, but a candidate the drop cannot USE must not
      // end the search, or a release one row off on a multi-slot card would
      // never reach the whole-card rule the green wash promised.
      const candidates = [
        // Drawers answer first. A drawer's one handle is minted "output" so a
        // drag can start anywhere on it; read literally, dropping drawer A on
        // drawer B would say B supplies A. These resolve a drawer by DIRECTION
        // instead (the one you drag feeds the one you drop on), and a drawer
        // has no more specific slot to lose by asking first.
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

      // POOL MODE has no wires, so no card is ever a target: the only thing
      // a drag can do is make a product drawer, wherever it is let go.
      const targetHandle = project.poolMode
        ? undefined
        : draggedResource
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
          // from. This is what makes a drawer one grab point.
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
          const farResource = getResourceForHandle(
            project,
            targetHandle.nodeId,
            targetHandle.handleId,
          );
          const outputResource = draggedIsSource ? draggedResource : farResource;
          const inputResource = draggedIsSource ? farResource : draggedResource;

          if (!outputResource) {
            return;
          }

          if (inputResource && !resourceMatchesInput(outputResource, inputResource)) {
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

      // Landing on a card that washed red means "no": never spawn a drawer
      // on top of it.
      if (getBoardNodeIdAtPosition(clientPosition)) {
        return;
      }

      // A minimized board has no ports, so no drag can start on one and
      // nothing can be spawned off it.
      if (isPocketId(project, draggedResource.nodeId)) {
        return;
      }
      const storageAnchorIds = draggedResource.nodeId;

      // A drag off a DRAWER into space always spawns a SOURCE feeding it: a
      // drawer already catches its own excess, so the only thing empty
      // canvas can add is supply.
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
    [
      addStorageForConnection,
      connectCustomRate,
      connectResourceEdges,
      connectTrash,
      project,
    ],
  );

  // A wire drag that ended and changed NOTHING plays the error sound. The
  // verdict is the PLAN alone, compared with drag START: React Flow runs
  // onConnect before onConnectEnd and handleConnect marks the gesture
  // completed before it validates, so neither flag can tell a refused drop
  // from a wired one. Silent endings: the plan changed (the watcher plays
  // success), the async loose-cell fetch owns the outcome, or the release
  // was back on the origin card (a cancel, and also a plain CLICK on a port
  // row, which must not buzz every browse).
  const handleConnectEndWithSound = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const dragNodeId = draggedResourceRef.current?.nodeId ?? wireGestureOriginRef.current;
      const fingerprintAtStart = connectStartFingerprintRef.current;
      connectStartFingerprintRef.current = undefined;
      wireGestureOriginRef.current = undefined;
      // Read the pointer BEFORE the handler, which clears it as it runs.
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      handleConnectEnd(event);
      if (fingerprintAtStart === undefined) {
        return;
      }
      if (projectSoundFingerprint(useFactoryStore.getState().project) !== fingerprintAtStart) {
        return;
      }
      const dropCardId = clientPosition ? getBoardNodeIdAtPosition(clientPosition) : undefined;
      if (dropCardId === dragNodeId) {
        return;
      }
      playBoardSound("error");
    },
    [handleConnectEnd],
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
    // Panning or zooming drops the hop map: React Flow culls off-screen
    // nodes, so a map held across a move would miss freshly mounted cards.
    clearHopMap();
    // Every dropdown over the board closes when the camera moves.
    emitBoardCameraMove();
  }, []);

  /**
   * Every camera move ends here, the board's own included, which is where the
   * active tab learns where it is being looked at.
   *
   * `event` is null for a move the board made itself, so a user event also
   * proves a design handover is over (see design-camera.ts).
   */
  // Keyboard pans and animated camera moves call setViewport per FRAME, and
  // React Flow reports each call as a move that ended. The centre (forced
  // layout), store write and localStorage camera write are therefore
  // debounced to once after the last end; the settle flag stays immediate.
  const moveEndTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastMoveEndRef = useRef<BoardCamera | undefined>(undefined);
  useEffect(() => () => clearTimeout(moveEndTimerRef.current), []);
  const handleMoveEnd = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: BoardCamera) => {
      if (event) {
        settleDesignCamera();
      }
      lastMoveEndRef.current = viewport;
      clearTimeout(moveEndTimerRef.current);
      moveEndTimerRef.current = setTimeout(() => {
        moveEndTimerRef.current = undefined;
        updateFlowViewportCenter();
        const settled = lastMoveEndRef.current;
        if (!settled || !isDesignCameraSettled()) {
          return;
        }
        const designId = useDesignStore.getState().activeDesignId;
        if (designId) {
          writeDesignCamera(designId, settled);
        }
      }, MOVE_END_SETTLE_MS);
    },
    [updateFlowViewportCenter],
  );

  const handleInit = useCallback(
    (instance: ReactFlowInstance<BoardFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
      // Dev builds only: the performance probes (*.local.mjs) put the camera
      // on an exact spot through this instead of faking wheel and drag input.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __gtnhFlow?: unknown }).__gtnhFlow = instance;
      }
      // A remembered camera that arrived before the board existed (the usual
      // order on page load; see restoreBoardCamera).
      const pendingCamera = pendingCameraRef.current;
      if (pendingCamera) {
        restoreBoardCamera(pendingCamera);
      }
      window.requestAnimationFrame(updateFlowViewportCenter);
      window.setTimeout(updateFlowViewportCenter, 120);
    },
    [restoreBoardCamera, updateFlowViewportCenter],
  );

  const performFlowImageExport = useCallback(
    async (request: FlowExportRequest) => {
      const { format, requestId, fileName, projectJson } = request;
      const worksheetElement = boardRef.current?.querySelector<HTMLElement>("[data-pool-worksheet]");
      if (worksheetElement) {
        let capture: FlowExportCapture | undefined;
        let failure: string | undefined;
        try {
          capture = await capturePoolWorksheet(worksheetElement, request);
          if (!request.capture && fileName && projectJson) {
            if (capture.svgText) {
              downloadBlob(new Blob([embedProjectJsonInSvg(capture.svgText, projectJson)], { type: "image/svg+xml" }), `${fileName}.svg`);
            } else if (capture.blob) {
              downloadBlob(await embedProjectJsonInPng(capture.blob, projectJson, capture.background), `${fileName}.png`);
            }
          }
        } catch (error) {
          failure = error instanceof Error ? error.message : "Worksheet image export failed.";
        } finally {
          dispatchImageExportComplete(requestId, capture, failure);
        }
        return;
      }
      const viewportElement = boardRef.current?.querySelector<HTMLElement>(".react-flow__viewport");

      if (!viewportElement) {
        dispatchImageExportComplete(requestId);
        return;
      }

      // The photograph's render: the card detail FORCED by the dialog rather than inherited from the
      // screen's zoom. For "full" and "glance" the card look is the ATTRIBUTE
      // alone (pure CSS, see node-detail.ts) and the published LEVEL is
      // pinned to full so edges keep their arrowheads (glance's economies are
      // per-frame savings a single frame does not need). The three smart views
      // publish GLANCE: their lines ARE the zoomed-out look.
      const cardDetail = request.cardDetail ?? "full";
      const isStatLook =
        cardDetail === "status" || cardDetail === "usage" || cardDetail === "power";
      const restoreDetailLevel = getPublishedNodeDetailLevel();
      const savedBoardView = readBoardViewSnapshot();
      const applyCardDetail = (level: NodeDetailLevel) => {
        const board = boardRef.current;
        if (!board) {
          return;
        }
        const value = nodeDetailAttributeValue(level);
        if (value) {
          board.setAttribute(NODE_DETAIL_ATTRIBUTE, value);
        } else {
          board.removeAttribute(NODE_DETAIL_ATTRIBUTE);
        }
      };
      setNodeDetailLevel(isStatLook ? NODE_DETAIL_GLANCE : NODE_DETAIL_FULL);
      applyCardDetail(cardDetail === "full" ? NODE_DETAIL_FULL : NODE_DETAIL_GLANCE);
      // The photograph takes every card, on screen or not.
      boardRef.current?.setAttribute(CONTAINMENT_HOLD_ATTRIBUTE, "");
      // Captures use the ordinary board colours (calm off) and the smart view
      // the dialog named, not the live board's; restored after.
      writeBoardView({
        calmMode: false,
        glanceMode: isStatLook ? cardDetail : "identity",
      });
      // Motion pauses for the photograph, or a capture right after the
      // settings flip catches wires mid-morph and numbers mid-tween. With the
      // switches off every motion hook reports its final value at once.
      const savedMotion = readBoardMotionSnapshot();
      writeBoardMotion({ moveMotion: false, valueMotion: false });
      // Two paints: one for React to commit the unculled board, one for the
      // newly mounted cards' own effects (pulse publication among them).
      await nextPaint();
      await nextPaint();

      const hideAnnotations = request.hideAnnotations === true;
      const framedNodes = hideAnnotations
        ? flowNodes.filter((node) => node.type !== "annotationNode")
        : flowNodes;
      const nodesBounds = getNodesBounds(framedNodes);
      const graphWidth = getExportImageSize(nodesBounds.width);
      const graphHeight = getExportImageSize(nodesBounds.height);
      // Cap the render surface: html-to-image's foreignObject rasterises
      // blank past the browser's limits, silently. Past the cap the whole
      // frame scales down; pixelRatio is bounded by the same constant, so the
      // physical pixel count is unchanged.
      const sizeScale = Math.min(
        1,
        EXPORT_PNG_MAX_PIXEL_SIDE / Math.max(graphWidth, graphHeight),
      );
      const imageWidth = Math.round(graphWidth * sizeScale);
      const imageHeight = Math.round(graphHeight * sizeScale);
      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.05,
        1.8,
        EXPORT_IMAGE_PADDING / Math.max(imageWidth, imageHeight),
      );
      // The active theme's paper by default; the dialog may swap in another
      // colour or transparency. The screen-space texture lives on the
      // container, not the viewport, so exports get the flat colour.
      const background =
        request.background === "transparent" ? undefined : (request.background ?? canvasTheme.base);
      const pixelRatio = getExportPngPixelRatio(imageWidth, imageHeight);
      const options = {
        backgroundColor: background,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
        filter: makeExportNodeFilter(hideAnnotations),
        // With fontEmbedCSS present the skip is inert; without it (the scan
        // failed) the export falls back to a default font rather than paying
        // for a per-capture stylesheet walk. See export-fonts.ts.
        skipFonts: true,
        fontEmbedCSS: await resolveExportFontCss(viewportElement),
      };
      const captureFrame = (kind: FlowExportCapture["kind"]): FlowExportCapture => ({
        kind,
        width: imageWidth,
        height: imageHeight,
        pixelRatio,
        viewport,
        background,
        // What the pulse canvas punches out of the dash layer (cards, label
        // chips, waypoint dots), copied while the whole plan is mounted. The
        // GIF replays against these; the live registries will have forgotten
        // the offscreen edges by then.
        occlusionRects: [
          ...(publishedBoardBounds ?? []).map(({ bounds }) => bounds),
          // Board chrome hides the wires under it in every mode, so the
          // exported dashes stop at it too.
          ...publishedBoardFrameBounds.flatMap(({ bounds }) => boardChromeOccluders(bounds)),
          ...snapshotEdgeLabelBoxes(),
        ],
        occlusionDots: snapshotEdgeWaypointDots(),
        pulses: snapshotEdgePulses(),
      });

      let capture: FlowExportCapture | undefined;
      let failure: string | undefined;
      try {
        if (format === "svg") {
          const svgText = dataUrlToText(await toSvg(viewportElement, options));
          if (request.capture) {
            capture = { ...captureFrame("svg"), svgText };
            return;
          }
          if (typeof fileName !== "string" || typeof projectJson !== "string") {
            return;
          }
          downloadBlob(
            new Blob([embedProjectJsonInSvg(svgText, projectJson)], { type: "image/svg+xml" }),
            `${fileName}.svg`,
          );
          return;
        }

        const imageBlob = await toBlob(viewportElement, { ...options, pixelRatio });
        if (!imageBlob) {
          failure = "The render came back empty.";
          return;
        }

        if (request.capture) {
          capture = { ...captureFrame("png"), blob: imageBlob };
          return;
        }

        if (typeof fileName !== "string" || typeof projectJson !== "string") {
          return;
        }
        const pngBlob = await embedProjectJsonInPng(imageBlob, projectJson, background);
        downloadBlob(pngBlob, `${fileName}.png`);
      } catch (error) {
        failure = error instanceof Error ? error.message : "Plan image export failed.";
        console.error(failure);
      } finally {
        writeBoardMotion(savedMotion);
        writeBoardView({
          calmMode: savedBoardView.calmMode,
          glanceMode: savedBoardView.glanceMode,
        });
        setNodeDetailLevel(restoreDetailLevel);
        applyCardDetail(restoreDetailLevel);
        boardRef.current?.removeAttribute(CONTAINMENT_HOLD_ATTRIBUTE);
        dispatchImageExportComplete(requestId, capture, failure);
      }
    },
    [flowNodes, canvasTheme.base],
  );

  const exportFlowImage = useCallback(
    (request: FlowExportRequest) => {
      const queued = exportQueueRef.current.then(() => performFlowImageExport(request));
      // The chain must survive a failed export or every later request waits
      // on a rejected promise forever.
      exportQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [performFlowImageExport],
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
            background?: unknown;
            cardDetail?: unknown;
            hideAnnotations?: unknown;
          }
        | undefined;

      if (
        (detail?.format !== "svg" && detail?.format !== "png") ||
        typeof detail.requestId !== "string"
      ) {
        return;
      }

      void exportFlowImage({
        format: detail.format,
        requestId: detail.requestId,
        fileName: typeof detail.fileName === "string" ? detail.fileName : undefined,
        projectJson: typeof detail.projectJson === "string" ? detail.projectJson : undefined,
        capture: detail.capture === true,
        background: typeof detail.background === "string" ? detail.background : undefined,
        cardDetail:
          detail.cardDetail === "glance" ||
          detail.cardDetail === "status" ||
          detail.cardDetail === "usage" ||
          detail.cardDetail === "power"
            ? detail.cardDetail
            : "full",
        hideAnnotations: detail.hideAnnotations === true,
      });
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

  // The recipe search covers the board; the board's own notices mute while
  // it does.
  const recipeSearchOpen = useFactoryStore((state) => Boolean(state.recipeBrowserResource));

  /**
   * Whether the selection could become a board: everything in it lives on
   * the root canvas, and none of it IS a board. Nothing may sit in two boards
   * at once, and nesting by marquee must not happen by accident.
   */
  const selectionCanWrap = useMemo(() => {
    if (selectedNodeIds.length < 2) {
      return false;
    }
    // Plan boards: any selection can be grouped (groupItems sorts out where the group sits).
    if (project.planMode === true) {
      return true;
    }
    const chosen = new Set(selectedNodeIds);
    if ((project.pockets ?? []).some((pocket) => chosen.has(pocket.id))) {
      return false;
    }
    const housed = (entry: { id: string; pocketId?: string }) =>
      chosen.has(entry.id) && entry.pocketId !== undefined;
    return !(
      project.nodes.some(housed) ||
      (project.storages ?? []).some(housed) ||
      (project.annotations ?? []).some(housed)
    );
  }, [
    project.annotations,
    project.nodes,
    project.planMode,
    project.pockets,
    project.storages,
    selectedNodeIds,
  ]);

  // SHARED MACHINES: several selected cards that one machine could run can
  // fold into one card. Only recipe cards count (no drawers, boards or
  // notes in the selection), none may own its recipe, and one machine must
  // run every recipe across them.
  const selectionCanCombine = useMemo(
    () => canCombineSelection(project, selectedNodeIds, COMBINE_DEPS),
    [project, selectedNodeIds],
  );
  const combineSelectedMachines = useCallback((): boolean => {
    const hostId = combineNodesIntoMachine(selectedNodeIds);
    if (!hostId) {
      return false;
    }
    setSelectedNodeIds([hostId]);
    setSelectedEdgeIds([]);
    return true;
  }, [combineNodesIntoMachine, selectedNodeIds, setSelectedEdgeIds, setSelectedNodeIds]);

  const wrapSelectedBoardItems = useCallback((): boolean => {
    if (selectedNodeIds.length === 0) {
      return false;
    }

    // Plan boards: a group round the selection where it stands (docs/groups.md); the group becomes the selection.
    if (useFactoryStore.getState().project.planMode === true) {
      const groupId = useFactoryStore.getState().groupSelection(selectedNodeIds, boardSizeOf);
      if (!groupId) {
        return false;
      }
      playEditSfx("board.merge");
      setSelectedNodeIds([groupId]);
      setSelectedEdgeIds([]);
      return true;
    }
    // The frame appears around the cards where they stand; nothing moves
    // and no wire changes, so there is nothing to confirm first.
    const boardId = wrapSelectionInBoard(selectedNodeIds);
    if (!boardId) {
      return false;
    }
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    return true;
  }, [selectedNodeIds, setSelectedEdgeIds, setSelectedNodeIds, wrapSelectionInBoard]);

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
      // A worksheet never edits an invisible canvas selection.
      if (useFactoryStore.getState().project.poolMode && document.querySelector("[data-pool-worksheet]")) return;
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

          if (wrapSelectedBoardItems()) {
            event.preventDefault();
          }
        }
        return;
      }

      // Backspace deletes too. React Flow's own delete key is off
      // (deleteKeyCode null): it removes cards from the canvas without
      // telling the project, so they come back on the next commit.
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
      // left and right click ask.
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

        // Escape backs out of whatever tool or half-made wire is active.
        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        setAnnotationTool(undefined);
        setDeleteMode(false);
      }
    };

    return listenForBoardInput("keydown", handleKeyDown, () => coveredRef.current);
  }, [
    annotationTool,
    cancelResourceConnection,
    copyBoardSelection,
    deleteAnnotation,
    deleteNode,
    deleteSelectedBoardItems,
    deleteStorage,
    isDeleteMode,
    nodeColorPaintMode,
    pasteBoardClipboard,
    project.annotations,
    project.nodes,
    project.storages,
    selectNode,
    selectedNodeId,
    setNodeColorPaintMode,
    wrapSelectedBoardItems,
  ]);

  /**
   * Boards the marquee being dragged may not select: the ones whose frame the
   * drag STARTED inside. Starting inside means reaching for what is in the
   * room, and with partial contact the frame is hit before any member is.
   * A containment test shields the whole chain of nested parents, while a
   * board further in is still selectable.
   */
  const marqueeShieldRef = useRef<Set<string>>(new Set());
  // Shift drags the band only from empty board (the mod: Shift adds a card it clicks). React Flow's own selection key
  // starts the band wherever the press lands, a card too, and swallows the click that would select it.
  const shiftHeld = useKeyPress("Shift");
  const handleSelectionStart = useCallback((event: ReactMouseEvent) => {
    const instance = flowInstanceRef.current;
    if (!instance) {
      return;
    }
    const start = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // Refilled in place: only handleNodesChange reads it, synchronously.
    const shielded = marqueeShieldRef.current;
    shielded.clear();
    for (const { id, bounds } of publishedBoardFrameBounds) {
      if (
        start.x >= bounds.left &&
        start.x <= bounds.right &&
        start.y >= bounds.top &&
        start.y <= bounds.bottom
      ) {
        shielded.add(id);
      }
    }
  }, []);
  const handleSelectionEnd = useCallback(() => {
    // Next frame: React Flow can still emit the band's last select changes
    // after this fires. A click selection needs a fresh press, later still.
    requestAnimationFrame(() => {
      marqueeShieldRef.current.clear();
    });
  }, []);

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
        } else if (node.type === "pocketNode" || node.type === "boardNode") {
          // Deleting a board, open or minimized, takes everything in it.
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

        // The brush on a board (open or minimized) recolours its floor,
        // frame line and bar.
        if (node.type === "boardNode" || node.type === "pocketNode") {
          paintPocket(node.id, nodeColorPaintMode ?? undefined);
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
      paintPocket,
      selectNode,
      updateAnnotation,
      updateNode,
      updateStorage,
    ],
  );

  // React Flow's own double-click plumbing, not a handler on the card: the
  // node wrapper's drag machinery can swallow a hand-rolled dblclick. The name
  // field's rename double-click stops propagation first. Double-clicking a
  // minimized board restores it.
  const handleNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "pocketNode" && !isWiringConnection() && !wasRecentWireDrop()) {
        expandPocket(node.id);
      }
    },
    [expandPocket],
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

  // THE BOARD MENU (BoardContextMenu.tsx): one right click anywhere on the
  // board. A control that already answers a right click has prevented the
  // event's default by the time it reaches here, and is left alone.
  const [boardMenu, setBoardMenu] = useState<BoardMenuTarget | undefined>(undefined);
  const closeBoardMenu = useCallback(() => setBoardMenu(undefined), []);
  const menuPoint = useCallback((event: ReactMouseEvent | MouseEvent) => {
    const instance = flowInstanceRef.current;
    const flow = instance
      ? instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: 0, y: 0 };
    return { x: event.clientX, y: event.clientY, flow };
  }, []);
  const handlePaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      setBoardMenu({ kind: "pane", ...menuPoint(event) });
    },
    [menuPoint],
  );
  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: BoardFlowNode) => {
      if (event.defaultPrevented) {
        return;
      }
      if (node.type === "annotationNode") {
        // A box, zone or arrow on a plan board has its own menu; a sticky note answers for itself.
        const drawn = useFactoryStore.getState().project.annotations?.find((entry) => entry.id === node.id);
        if (drawn && drawn.kind !== "text" && useFactoryStore.getState().project.planMode === true) {
          event.preventDefault();
          setBoardMenu({ kind: "annotation", id: node.id, ...menuPoint(event) });
        }
        return;
      }
      if (
        (node.type === "boardNode" || node.type === "pocketNode") &&
        useFactoryStore.getState().project.planMode === true
      ) {
        // A group, open (its title strip or border) or collapsed: its own menu (docs/groups.md).
        event.preventDefault();
        setBoardMenu({ kind: "group", id: node.id, ...menuPoint(event) });
        return;
      }
      if (node.type !== "recipeNode" && node.type !== "storageNode") {
        return;
      }
      event.preventDefault();
      setBoardMenu({
        kind: node.type === "storageNode" ? "storage" : "node",
        id: node.id,
        ...menuPoint(event),
      });
    },
    [menuPoint],
  );
  const handleEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const project = useFactoryStore.getState().project;
      const flat = project.edges.find((entry) => entry.id === edge.id);
      // The drawer holds what the wire carries: read off the source's port,
      // or the target's when the source is a board with no ports.
      const resource = flat
        ? (getResourceForHandle(project, flat.source, flat.sourceHandle ?? "") ??
          getResourceForHandle(project, flat.target, flat.targetHandle ?? ""))
        : undefined;
      setBoardMenu({
        kind: "edge",
        ids: expandChannelEdgeIds([edge.id]),
        resource,
        ...menuPoint(event),
      });
    },
    [expandChannelEdgeIds, menuPoint],
  );

  const handleShowNodes = useCallback(
    (nodeIds: string[]) => frameBoardCards(nodeIds),
    [frameBoardCards],
  );
  // The Fit key fills the board with the plan, as close as the board itself zooms: on a big screen a small plan
  // would otherwise stop at 1:1, a speck in the middle. Landing on a plan (opening one) keeps the 1:1 cap.
  const handleFitView = useCallback(
    () => frameBoardCards(undefined, { maxZoom: boardMaxZoomValue }),
    [frameBoardCards, boardMaxZoomValue],
  );

  // A freshly landed card gets the arrive pop (board motion). Done to the DOM
  // rather than through the node objects on purpose: a transient class is
  // not state the board should rebuild for.
  const placedBoardToken = useFactoryStore((state) => state.placedBoardToken);
  useEffect(() => {
    if (placedBoardToken === 0 || !readBoardMotionSnapshot().moveMotion) {
      return undefined;
    }

    const ids = useFactoryStore.getState().placedBoardIds ?? [];
    let cleanup: (() => void) | undefined;
    // One frame: the cards are placed by the same commit that raised the token,
    // so they are not in the DOM yet.
    const frame = requestAnimationFrame(() => {
      const arrived = ids
        .map((id) => boardRef.current?.querySelector(`.react-flow__node[data-id="${id}"]`))
        .filter((element): element is Element => element !== null && element !== undefined);
      for (const element of arrived) {
        element.classList.add(BOARD_ARRIVE_CLASS);
      }
      const arriveTimer = window.setTimeout(() => {
        for (const element of arrived) {
          element.classList.remove(BOARD_ARRIVE_CLASS);
        }
      }, BOARD_ARRIVE_MS);
      cleanup = () => {
        window.clearTimeout(arriveTimer);
        for (const element of arrived) {
          element.classList.remove(BOARD_ARRIVE_CLASS);
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
    enabled: !checklistMode && nodeColorPaintMode === undefined && annotationTool === undefined && !isDeleteMode,
  });

  // The camera under the hand: the wheel eases toward its target, a released
  // pan glides for a beat, and WASD/arrows pan while PageUp/PageDown and +/-
  // zoom. Owns the wheel outright — zoomOnScroll is off below.
  useBoardCameraControls({ boardRef, instanceRef: flowInstanceRef });

  // Compact windows fold each toolbar into a single button, and only one
  // unfolds at a time: any two expanded rows would cross on a phone-width board.
  const [openToolGroup, setOpenToolGroup] = useState<ToolGroupId | undefined>(undefined);
  const handleToolGroupToggle = useCallback((group: ToolGroupId | undefined) => {
    setOpenToolGroup((current) => (current === group ? undefined : group));
  }, []);

  // Auto-arrange: lay the visible level out left to right and reframe. Reads
  // the store at click time so the callback stays stable — the toolbar it
  // lives on must not re-render per project edit.
  // The arrange in flight, for the loader; undefined when none is.
  const [arrangeProgress, setArrangeProgress] = useState<ArrangeProgress | undefined>(undefined);
  const arrangeRunningRef = useRef(false);
  const handleAutoArrange = useCallback(async (options: { keepBoards: boolean }) => {
    // One at a time: a click while one runs is ignored.
    if (arrangeRunningRef.current) {
      return;
    }
    arrangeRunningRef.current = true;
    setArrangeProgress({ seq: 0, step: 0, stage: "Reading the board", done: 0, total: 1 });
    const state = useFactoryStore.getState();
    // Unless Keep boards is on, every board is dissolved first (members
    // surface where the frame stood) and the arrange lays out one flat set
    // of cards. With Keep boards on, each board is sealed and only placed.
    // Plan boards always keep their groups: each is one block, its insides untouched (docs/groups.md, Arrange).
    const dumpBoards =
      !options.keepBoards && state.project.planMode !== true && (state.project.pockets?.length ?? 0) > 0;
    const project = dumpBoards ? flattenBoards(state.project) : state.project;
    let computed: Awaited<ReturnType<typeof computeAutoArrangement>>;
    try {
      computed = await computeAutoArrangement(
        project,
        state.lastResult,
        // Islands come from board-arrange-air.ts, not from an option here.
        {
          spacing: "compact",
        },
        { tidyBoardInteriors: false },
        (progress) => setArrangeProgress(progress),
      );
    } catch (error) {
      if (!(error instanceof ArrangeCancelled)) {
        console.error("arrange failed", error);
      }
      arrangeRunningRef.current = false;
      setArrangeProgress(undefined);
      return;
    }
    arrangeRunningRef.current = false;
    setArrangeProgress(undefined);
    const {
      moves,
      wireRoutes,
      resetEdgeIds,
      staleInkIds,
      boardSizes,
      addBoards,
      setOwners,
      setBoardThemes,
    } = computed;
    if (moves.length === 0) {
      return;
    }
    // The board may have changed while the arrange ran; apply to the current
    // store, which is what applyBoardArrangement reads. Stale root notes go:
    // they point at a layout that no longer exists. Kept boards keep their
    // contents, size, name, paper and ink; only the board itself is placed.
    state.applyBoardArrangement({
      moves,
      resetEdgeIds,
      setWaypoints: wireRoutes,
      setBoardSizes: boardSizes,
      addBoards,
      setOwners,
      setBoardThemes,
      removeAnnotationIds: staleInkIds,
      // The dump for real: every board goes, its members ride `moves`
      // (root positions from the flattened plan) and surface on the canvas.
      removeBoards: dumpBoards ? (state.project.pockets ?? []).map((pocket) => pocket.id) : undefined,
    });
    useFactoryStore.getState().frameBoardNodes();
  }, []);

  // The top bar's Arrange and Fit keys (src/components/chrome) call these, and
  // its Arrange label follows the arrange's progress.
  useEffect(
    () =>
      registerBoardCommands({
        arrange: () => void handleAutoArrange({ keepBoards: false }),
        cancelArrange,
        fit: handleFitView,
        openBoardMenu: (at) => {
          const instance = flowInstanceRef.current;
          const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
          const flow =
            instance && rect
              ? instance.screenToFlowPosition({
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                })
              : { x: 0, y: 0 };
          setBoardMenu({ kind: "pane", x: at.x, y: at.y, flow });
        },
      }),
    [handleAutoArrange, handleFitView],
  );
  useEffect(() => {
    reportArrange(arrangeProgress, ARRANGE_STEPS.length);
  }, [arrangeProgress]);

  // Stable references keep the memoized PaintToolbar from re-rendering on the
  // per-frame FactoryFlow renders a node drag produces.
  const handlePaintModeChange = useCallback(
    (tag: FactoryNodeColorTag | null | undefined) => {
      if (tag !== undefined) useFactoryStore.getState().setChecklistMode(false);
      setAnnotationTool(undefined);
      setDeleteMode(false);
      // The brush leaves the smart view alone: coloured views live only at
      // the glance step, so up close the paint shows where it lands.
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
    (tool: BoardDrawTool | undefined) => {
      if (tool) useFactoryStore.getState().setChecklistMode(false);
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
      if (enabled) useFactoryStore.getState().setChecklistMode(false);
      setNodeColorPaintMode(undefined);
      setAnnotationTool(undefined);
      setDeleteMode(enabled);
    },
    [setNodeColorPaintMode],
  );

  /**
   * What each held card may not be dragged onto, worked out once at drag
   * start and applied every frame (see handleNodesChange). Rebuilding it per
   * frame is O(nodes) per-frame work CLAUDE.md rules out, and nothing
   * it depends on changes mid-drag.
   */
  const dragConstraintsRef = useRef<
    Map<
      string,
      {
        blockers: PlacementRect[];
        regions: PlacementRegion[];
        origin: { x: number; y: number };
      }
    >
  >(new Map());

  /**
   * Cards in this drag already carried by a FRAME in the same drag. React
   * Flow moves every selected node AND a frame's children, so a selected
   * card inside a selected board would travel twice as far. Their own
   * position changes are dropped for the drag; their frame-relative
   * positions are already right.
   */
  const dragPassengersRef = useRef<Set<string>>(new Set());

  /**
   * Plan boards (groups, docs/groups.md): the open frames a carried card could join, worked out at drag start, so each
   * drag frame lights the one under the carried card's centre (group-drop.ts). Undefined on classic boards and when
   * only groups are carried.
   */
  const groupDropRef = useRef<
    | {
        primary: string;
        from: string | undefined;
        origin: { x: number; y: number };
        frames: ReturnType<typeof computeOpenBoardRects>;
        excluded: Set<string>;
        /** The group lit now (where the pointer aims); the drop lands there. */
        target?: string;
      }
    | undefined
  >(undefined);

  const handleNodeDragStart = useCallback((_: unknown, node: Node, draggedNodes: Node[]) => {
    // A drag is about to move geometry; the map under it would be a distraction
    // and the pointer never leaves the node, so nothing else would clear it.
    clearHopMap();
    activelyDraggedNodeIds.clear();
    activelyDraggedNodeIds.add(node.id);
    for (const dragged of draggedNodes) {
      activelyDraggedNodeIds.add(dragged.id);
    }
    draggedNodeSetEpoch += 1;
    // Annotations are ink, not furniture: wires pass straight through them,
    // so a drag moving ONLY notes and boxes cannot change any route and must
    // not spend a single mid-drag solve. Decided once at grab time.
    dragMovesObstaclesRef.current = [node, ...draggedNodes].some(
      (dragged) => dragged.type !== "annotationNode",
    );
    // What the held cards may not be dropped on. Furniture only: annotations
    // are ink and never block. A CARD is blocked by other cards but not by
    // board frames — a frame is a room you may drag into, and the drop
    // decides membership. A FRAME is blocked by other frames and by every
    // card that is not its own, since a board sliding over a card would
    // swallow one it never adopted.
    {
      const state = useFactoryStore.getState();
      const project = state.project;
      const pockets = project.pockets ?? [];
      const held = new Set<string>([node.id, ...draggedNodes.map((entry) => entry.id)]);
      const boardIds = new Set(pockets.map((pocket) => pocket.id));
      const ownerOf = (id: string): string | undefined =>
        project.nodes.find((entry) => entry.id === id)?.pocketId ??
        project.storages?.find((entry) => entry.id === id)?.pocketId ??
        pockets.find((entry) => entry.id === id)?.parentPocketId;
      const chainOf = (id: string | undefined): Set<string> => {
        const chain = new Set<string>();
        let cursor = id;
        while (cursor !== undefined && !chain.has(cursor)) {
          chain.add(cursor);
          cursor = pockets.find((entry) => entry.id === cursor)?.parentPocketId;
        }
        return chain;
      };
      // Everything travelling with this drag, including whole boards.
      const carried = new Set(held);
      for (const id of held) {
        if (boardIds.has(id)) {
          for (const descendant of collectPocketDescendantIds(pockets, id)) {
            carried.add(descendant);
          }
        }
      }
      const ridesAlong = (id: string) => {
        for (const owner of chainOf(ownerOf(id))) {
          if (carried.has(owner)) {
            return true;
          }
        }
        return false;
      };
      const inkIds = new Set((project.annotations ?? []).map((annotation) => annotation.id));
      const solid: Array<{ id: string; isFrame: boolean; rect: PlacementRect }> = [];
      for (const [id, geometry] of publishedBoardGeometryById) {
        if (
          carried.has(id) ||
          inkIds.has(id) ||
          ridesAlong(id) ||
          geometry.width <= 0 ||
          geometry.height <= 0
        ) {
          continue;
        }
        const pocket = pockets.find((entry) => entry.id === id);
        solid.push({
          id,
          isFrame: pocket?.expanded === true,
          rect: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
        });
      }

      // The rooms on the canvas, as places to be in or out of. A card
      // straddling a board's wall belongs to neither, so the magnet treats
      // a half-crossing as occupied ground and the card clicks in or clicks
      // out — whichever is nearer.
      const openFrames = computeOpenBoardRects(computeBoardLevelView(project).openBoards);
      const constraints = new Map<
        string,
        {
          blockers: PlacementRect[];
          regions: PlacementRegion[];
          origin: { x: number; y: number };
        }
      >();
      for (const id of held) {
        const heldPocket = pockets.find((entry) => entry.id === id);
        const heldIsOpenFrame = heldPocket?.expanded === true;
        const mine = heldIsOpenFrame ? chainOf(id) : new Set<string>();
        const blockers = solid
          .filter((other) =>
            heldIsOpenFrame
              ? // A frame: everything solid that is not inside it.
                !mine.has(other.id) && !chainOf(ownerOf(other.id)).has(id)
              : // A card: other cards, never the rooms themselves.
                !other.isFrame,
          )
          .map((other) => other.rect);
        // A frame is not asked to be in or out of anything: it is blocked
        // outright by its neighbours. Only cards click in and out of rooms,
        // and never into a room they are travelling with.
        // Plan boards: a group's frame is no wall. A card joins the group its centre is let go over, and the frame
        // grows to hold it (docs/groups.md), so nothing clicks in or out on the way.
        const regions: PlacementRegion[] = heldIsOpenFrame || project.planMode === true
          ? []
          : openFrames
              .filter((rect) => !carried.has(rect.id))
              .map((rect) => ({
                outer: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                inner: boardBodyRect(rect),
              }));

        // Positions arrive in the parent's space; the blockers are in flow
        // space, so the held card's own frame origin closes the gap.
        const owner = ownerOf(id);
        const frame = owner ? openFrames.find((rect) => rect.id === owner) : undefined;
        constraints.set(id, {
          blockers,
          regions,
          origin: frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 },
        });
      }
      dragConstraintsRef.current = constraints;
      // Plan boards: the group under the carried card lights up (group-drop.ts). Only when a card, drawer or note is
      // what the pointer carries; a carried group keeps its own parent.
      groupDropRef.current = undefined;
      if (project.planMode === true && !boardIds.has(node.id) && !ridesAlong(node.id)) {
        const excluded = new Set<string>();
        for (const id of carried) if (boardIds.has(id)) excluded.add(id);
        const owner = ownerOf(node.id) ?? project.annotations?.find((entry) => entry.id === node.id)?.pocketId;
        const frame = owner ? openFrames.find((rect) => rect.id === owner) : undefined;
        groupDropRef.current = {
          primary: node.id,
          from: owner,
          origin: frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 },
          frames: openFrames,
          excluded,
          // Until a drag frame aims elsewhere, the card stays in the group it is in.
          target: owner,
        };
      }
      // Held cards whose board is held too: the frame carries them, so
      // their own drag deltas are dropped for the length of the drag.
      const passengers = new Set<string>();
      for (const id of held) {
        if (ridesAlong(id)) {
          passengers.add(id);
        }
      }
      dragPassengersRef.current = passengers;
    }
    // A fresh drag's first cell change solves immediately; the throttle only
    // paces the changes after it.
    lastLiveDragSolveAtRef.current = 0;
    draggingNodeRef.current = true;
    // The card-over-wires layering during the drag is pure CSS: the
    // --dragging board class and the .dragging node rule lift the held card
    // over the wires and its siblings.
    setNodeDragging(true);
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node, draggedNodes: Node[]) => {
      // A drag moves the WHOLE selection, so the whole selection is persisted
      // (or the next store commit snaps the rest back), as one batch move and
      // one undo entry.
      const dropped = draggedNodes.length > 0 ? draggedNodes : [node];

      // Where did each land? A card wholly inside an open board's body joins
      // that board; one outside every frame surfaces on the canvas. Read
      // fresh from the store so the callback stays stable.
      const state = useFactoryStore.getState();
      const project = state.project;
      const view = computeBoardLevelView(project);
      const frames = computeOpenBoardRects(view.openBoards);
      const frameById = new Map(frames.map((frame) => [frame.id, frame]));
      const pockets = project.pockets ?? [];
      const pocketIdSet = new Set(pockets.map((pocket) => pocket.id));
      // A press let go where it began is a click (a key on a card, a chip): nothing moves, nothing changes group, and
      // a place off this board's grid (the game's 10 px one) stays as it is.
      const storedAt = (id: string) =>
        (project.nodes.find((entry) => entry.id === id) ??
          project.storages?.find((entry) => entry.id === id) ??
          project.annotations?.find((entry) => entry.id === id) ??
          pockets.find((entry) => entry.id === id))?.position;
      const unmoved = dropped.every((entry) => {
        const at = storedAt(entry.id);
        return at !== undefined && at.x === entry.position.x && at.y === entry.position.y;
      });
      // A dragged board cannot land inside itself or its own descendants.
      const excluded = new Set<string>();
      for (const entry of dropped) {
        if (pocketIdSet.has(entry.id)) {
          excluded.add(entry.id);
          for (const id of collectPocketDescendantIds(pockets, entry.id)) {
            excluded.add(id);
          }
        }
      }
      const ownerOf = (id: string): string | undefined => {
        const projectNode = project.nodes.find((entry) => entry.id === id);
        if (projectNode) {
          return projectNode.pocketId;
        }
        const storage = project.storages?.find((entry) => entry.id === id);
        if (storage) {
          return storage.pocketId;
        }
        const annotation = project.annotations?.find((entry) => entry.id === id);
        if (annotation) {
          return annotation.pocketId;
        }
        return pockets.find((entry) => entry.id === id)?.parentPocketId;
      };

      // Everything that MOVES with this drag: the dragged cards, plus every
      // board they hold and everything living on those boards. None of it
      // can block the drop, because all of it is travelling too.
      const carried = new Set<string>(dropped.map((entry) => entry.id));
      for (const entry of dropped) {
        if (pocketIdSet.has(entry.id)) {
          for (const id of collectPocketDescendantIds(pockets, entry.id)) {
            carried.add(id);
          }
        }
      }
      const ridesAlong = (itemId: string): boolean => {
        let owner = ownerOf(itemId);
        const seen = new Set<string>();
        while (owner !== undefined && !seen.has(owner)) {
          if (carried.has(owner)) {
            return true;
          }
          seen.add(owner);
          owner = pockets.find((entry) => entry.id === owner)?.parentPocketId;
        }
        return false;
      };

      // The furniture already on the surface. Annotations are ink and never
      // block anything.
      const inkIds = new Set((project.annotations ?? []).map((annotation) => annotation.id));
      const surface: Array<{ id: string; rect: PlacementRect }> = [];
      for (const [id, geometry] of publishedBoardGeometryById) {
        if (
          carried.has(id) ||
          inkIds.has(id) ||
          ridesAlong(id) ||
          geometry.width <= 0 ||
          geometry.height <= 0
        ) {
          continue;
        }
        surface.push({
          id,
          rect: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
        });
      }
      // The chain of frames a landing sits inside: a card dropped ON a board
      // is not landing on top of it, it is landing IN it.
      const chainOf = (boardId: string | undefined): Set<string> => {
        const chain = new Set<string>();
        let cursor = boardId;
        while (cursor !== undefined && !chain.has(cursor)) {
          chain.add(cursor);
          cursor = pockets.find((entry) => entry.id === cursor)?.parentPocketId;
        }
        return chain;
      };

      const instance = flowInstanceRef.current;
      // Resolved rects of the cards already placed by this same drop, so a
      // multi-card drag does not stack its own cards.
      const placedThisDrop: PlacementRect[] = [];
      const moves = dropped.map((entry) => {
        const internal = instance?.getInternalNode(entry.id);
        const absolute = internal?.internals.positionAbsolute ?? entry.position;
        const width = internal?.measured?.width ?? 0;
        const height = internal?.measured?.height ?? 0;
        const currentOwner = ownerOf(entry.id);
        const planBoard = project.planMode === true;
        // Plan boards (groups, docs/groups.md): a card joins the group its centre is let go over, the frame grows to
        // hold it; a carried group keeps its parent; what rides in a carried group stays in it.
        if (planBoard && ridesAlong(entry.id)) {
          return { id: entry.id, position: entry.position };
        }
        // A card belongs to the room it is WHOLLY inside; the magnet never
        // leaves it across a wall. Clear of every frame, it leaves its board.
        // The group lit while carried is where the carried cards land (the pointer aimed there, whatever the magnet
        // slid them clear of); with nothing lit, the group under the card's centre.
        const aimed = groupDropRef.current;
        const landing = planBoard
          ? pocketIdSet.has(entry.id)
            ? currentOwner
            : aimed
              ? aimed.target
              : groupUnder(frames, { x: absolute.x, y: absolute.y, width, height }, BOARD_WINDOW_TITLE_HEIGHT, excluded)
          : pickBoardOwnerFor(
              frames,
              { x: absolute.x, y: absolute.y, width, height },
              excluded,
            );
        const origin = landing !== undefined ? frameById.get(landing) : undefined;

        // The magnet, in flow space: slide off anything solid, then convert
        // back into whichever board the drop belongs to.
        const inside = chainOf(landing);
        const blockers = [
          ...surface
            .filter((other) => !inside.has(other.id))
            .map((other) => other.rect),
          ...placedThisDrop,
        ];
        // The live magnet already kept this card clear, so this is a safety
        // net for drops that never saw a drag frame; an honest drop stays
        // exactly where it was let go.
        const wanted = snapPositionToGrid({ x: absolute.x, y: absolute.y });
        const free =
          width > 0 && height > 0
            ? nearestFreeSpot({ x: wanted.x, y: wanted.y, width, height }, blockers)
            : wanted;
        placedThisDrop.push({ x: free.x, y: free.y, width, height });

        const position = snapPositionToGrid({
          x: free.x - (origin?.x ?? 0),
          y: free.y - (origin?.y ?? 0),
        });
        return landing === currentOwner
          ? { id: entry.id, position }
          : { id: entry.id, position, owner: { pocketId: landing } };
      });

      // A board's walls never move to swallow a drop that would not fit. A group's do (plan boards): it grows to hold
      // what joined it, and the drop says in or out by its sound.
      if (unmoved) {
        // A click: nothing to write.
      } else if (project.planMode === true) {
        const joined = moves.filter((move) => "owner" in move && move.owner?.pocketId !== undefined).length;
        const left = moves.filter((move) => "owner" in move && move.owner?.pocketId === undefined).length;
        moveBoardItems(moves, boardSizeOf);
        groupDropSound(joined, left);
      } else {
        moveBoardItems(moves);
      }
      clearGroupDrop();
      groupDropRef.current = undefined;

      activelyDraggedNodeIds.clear();
      draggedNodeSetEpoch += 1;
      dragConstraintsRef.current = new Map();
      dragPassengersRef.current = new Set();
      draggingNodeRef.current = false;
      // The drop's own publish below supersedes any trailing live-drag solve.
      window.clearTimeout(liveDragTrailingTimerRef.current);
      // The geometry-publish effects can't see the drop: React Flow streamed
      // the final position into `flowNodes` during the last drag frame, so
      // their fingerprints won't change again. Republish here (the ref holds
      // the final layout). Moved OBSTACLES also invalidate measurements and
      // reissue every route; a drag of ink only refreshes the maps.
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
      // One entry, channels expanded: a drawn wire stands for every flat
      // edge in its channel and they leave together.
      const edgeIds = expandChannelEdgeIds(deletedEdges.map((edge) => edge.id));
      if (edgeIds.length > 0) {
        deleteBoardSelection({ edgeIds });
      }
    },
    [deleteBoardSelection],
  );

  const commitAnnotationDraft = useCallback(
    (tool: BoardDrawTool, draft: AnnotationDraft) => {
      const width = Math.abs(draft.end.x - draft.start.x);
      const height = Math.abs(draft.end.y - draft.start.y);
      const corner = {
        x: Math.min(draft.start.x, draft.end.x),
        y: Math.min(draft.start.y, draft.end.y),
      };

      if (tool === "board") {
        // Drawn like a box, lands as an open board. Root cards whose centre
        // the frame's body covers become members where they stand.
        const isClick = width < 12 && height < 12;
        const position = snapPositionToGrid(isClick ? draft.start : corner);
        const size = isClick
          ? BOARD_WINDOW_DEFAULT_SIZE
          : {
              width: Math.max(BOARD_WINDOW_MIN_WIDTH, snapSizeUpToGrid(width)),
              height: Math.max(BOARD_WINDOW_MIN_HEIGHT, snapSizeUpToGrid(height)),
            };
        const state = useFactoryStore.getState();
        const body = {
          left: position.x,
          top: position.y + BOARD_WINDOW_TITLE_HEIGHT,
          right: position.x + size.width,
          bottom: position.y + size.height,
        };
        const covers = (id: string): boolean => {
          const geometry = publishedBoardGeometryById.get(id);
          if (!geometry) {
            return false;
          }
          const centreX = geometry.x + geometry.width / 2;
          const centreY = geometry.y + geometry.height / 2;
          return (
            centreX >= body.left &&
            centreX <= body.right &&
            centreY >= body.top &&
            centreY <= body.bottom
          );
        };
        const memberIds = [
          ...state.project.nodes
            .filter((node) => node.pocketId === undefined && covers(node.id))
            .map((node) => node.id),
          ...(state.project.storages ?? [])
            .filter((storage) => storage.pocketId === undefined && covers(storage.id))
            .map((storage) => storage.id),
          ...(state.project.annotations ?? [])
            .filter((annotation) => annotation.pocketId === undefined && covers(annotation.id))
            .map((annotation) => annotation.id),
          ...(state.project.pockets ?? [])
            .filter((pocket) => pocket.parentPocketId === undefined && covers(pocket.id))
            .map((pocket) => pocket.id),
        ];
        createBoard({ position, size, memberIds });
        return;
      }

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
   * into whole cells from its own pixels, and dropped at the drop point or in
   * the middle of the view. Every refusal surfaces as a plain dialog.
   */
  const placeImageFile = useCallback(
    async (file: File | Blob, dropPoint?: { x: number; y: number }) => {
      // A plan board has no picture annotations (it shows sticky notes only).
      if (useFactoryStore.getState().project.planMode === true) {
        return;
      }
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
    return listenForBoardInput("paste", handlePaste, () => coveredRef.current);
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
    const stopKeys = listenForBoardInput("keydown", cancelOnEscape, () => coveredRef.current);
    return () => {
      window.removeEventListener("pointermove", followCursor);
      stopKeys();
    };
  }, [annotationTool]);

  // Switching into a coloured view drops the brush: zoomed out under a view
  // wash, a paint stroke would land invisibly.
  const handleGlanceModeChange = useCallback(
    (mode: GlanceMode) => {
      if (mode !== "identity") {
        setNodeColorPaintMode(undefined);
      }
      writeBoardView({ glanceMode: mode });
    },
    [setNodeColorPaintMode],
  );


  const checklistCapture = useChecklistBoard(visibleFlowEdges);
  const viewerCapture = useViewerLock(boardRef, isReadOnly);
  const checklistNodes = useMemo(() => {
    if (isReadOnly && !checklistMode) return visibleFlowNodes.map((node) => ({ ...node, draggable: false, connectable: false }));
    if (!checklistMode) return visibleFlowNodes;
    const checked = new Set(project.checklist?.cards);
    return visibleFlowNodes.map((node) => ({ ...node, draggable: false,
      className: [node.className, checked.has(node.id) ? "checklist-done" : ""].filter(Boolean).join(" ") }));
  }, [visibleFlowNodes, checklistMode, project.checklist, isReadOnly]);
  const checklistEdges = useMemo(() => {
    if (!checklistMode) return visibleFlowEdges;
    const checked = new Set(project.checklist?.edges);
    return visibleFlowEdges.map((edge) => ({ ...edge,
      className: [edge.className, (edge.data?.bundle?.edgeIds ?? [edge.id]).every((id) => checked.has(id)) ? "checklist-done" : ""].filter(Boolean).join(" ") }));
  }, [visibleFlowEdges, checklistMode, project.checklist]);

  // A plan of hundreds of cards reaches React Flow a slice at a time, nearest the
  // camera first (sliced-mount.ts); a small one passes straight through.
  const sliceFocus = useCallback(() => {
    const camera = flowInstanceRef.current?.getViewport() ?? pendingCameraRef.current;
    const size = boardRef.current?.getBoundingClientRect();
    if (!camera || !size || !(camera.zoom > 0)) {
      return undefined;
    }
    return {
      x: (size.width / 2 - camera.x) / camera.zoom,
      y: (size.height / 2 - camera.y) / camera.zoom,
    };
  }, []);
  const mounted = useSlicedMount(checklistNodes, checklistEdges, project.id, sliceFocus);
  // Only the wires on or near the screen reach React Flow; the controller moves the choice with the camera.
  boardVirtualizer.useBoard(project.id);
  const shownEdges = useMemo(() => boardEdges.setAll(mounted.edges), [mounted.edges]);

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
      data-help-anchor="board"
      data-view-only={isReadOnly || undefined}
      className={[
        // The 480px floor keeps a desktop board usable and fits the shortest
        // non-compact window (560px) under the two bars. Compact drops it: a
        // floor taller than the window scrolls the board out of sight.
        "factory-flow-board relative h-full min-h-[480px] compact:min-h-0 overflow-hidden border-x border-line bg-canvas",
        checklistMode ? "checklist-active" : "",
        isNodeDragging ? "factory-flow-board--dragging" : "",
        poolMode ? "factory-flow-board--pool" : "",
        worksheet ? "factory-flow-board--worksheet" : "",
        paintCursor ? "factory-flow-board--painting" : "",
        annotationTool ? "factory-flow-board--annotating" : "",
        isDeleteMode ? "factory-flow-board--deleting" : "",
        "factory-flow-board--edges-under",
        calmMode ? "factory-flow-board--calm" : "",
        // The two motion switches (board-motion.tsx): the grid magnet and the
        // arrival pop hang off the first, the easing gauges off the second.
        boardMotion.moveMotion ? "factory-flow-board--move-motion" : "",
        boardMotion.valueMotion ? "factory-flow-board--value-motion" : "",
        // Blueprint overwrite picking rings the pocket cards (globals.css).
        overwritePicking ? "factory-flow-board--blueprint-picking" : "",
        // A board's chrome must occlude the wires crossing it while its floor
        // stays under them, which needs node and edge depths compared across
        // the two layers (see globals.css).
        pocketView.openBoards.length > 0 ? "factory-flow-board--edges-under" : "",
        // Every card and wire MOUNTS mid-run during the build timelapse, so
        // the pop-in lives on a board class rather than on the nodes.
        timelapseActive ? "factory-flow-board--timelapse" : "",
        tiltWorn ? "factory-flow-board--tilted" : "",
        tiltWorn && boardTilt.drift ? "factory-flow-board--tilted-drift" : "",
      ].join(" ")}
      style={
        {
          ...checklistCursorStyle,
          ...(paintCursor ? { "--paint-cursor": paintCursor } : undefined),
          ...(isDeleteMode ? { "--delete-cursor": getDeleteCursor() } : undefined),
          // The theme paints the room: base colour, the screen-space edge
          // vignette (grain lives in the viewport, see GrainBackground), and
          // the --canvas var every canvas-matching surface reads.
          backgroundColor: canvasTheme.base,
          backgroundImage: canvasTheme.vignette,
          "--canvas": canvasTheme.base,
          "--canvas-dot": canvasTheme.patternColor,
          ...(tiltWorn
            ? {
                "--board-tilt-pitch": `${boardTilt.pitch}deg`,
                "--board-tilt-yaw": `${boardTilt.yaw}deg`,
                "--board-tilt-cover": String(boardTiltCoverScale(boardTilt)),
              }
            : undefined),
          // The wire draw-in's duration, shared with the beat scheduler so
          // a beat holds until its ink is dry. Scaled by playback speed
          // like every other gap.
          ...(timelapseActive && timelapse
            ? {
                "--timelapse-wire-draw": `${Math.round(getBoardTimelapseWireDrawMs() / timelapse.speed)}ms`,
                "--timelapse-pop": `${Math.round(getBoardTimelapsePopMs() / timelapse.speed)}ms`,
              }
            : undefined),
        } as CSSProperties
      }
      onPointerDownCapture={(event) => { if (!worksheet && !checklistCapture(event) && !viewerCapture(event) && !isReadOnly) handleAnnotationPointerDown(event); }}
      onMouseDownCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onTouchStartCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onClickCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onDoubleClickCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onContextMenuCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onKeyDownCapture={(event) => { if (!checklistCapture(event)) viewerCapture(event); }}
      onWheelCapture={checklistCapture}
      // A picture file dropped on the board becomes an image annotation. An
      // item dragged from the items column drops a product drawer there (as
      // the board menu's "New product drawer"); wiring it into an input
      // turns it into a source.
      onDragOver={(event) => {
        const types = event.dataTransfer.types;
        if (types.includes("Files") || (!isReadOnly && types.includes(RESOURCE_DRAG_TYPE))) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (isReadOnly) { event.preventDefault(); return; }
        if (event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) {
          event.preventDefault();
          const resource = readResourceDrag(event.dataTransfer);
          const point = flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (resource && point) useFactoryStore.getState().addPoolStorage(resource, "drain", point);
          return;
        }
        // A plan file dropped on a plan board opens as a new plan; a picture has no place there (plan boards hide
        // image annotations), so it says so instead of placing one nothing shows.
        if (useFactoryStore.getState().project.planMode === true) {
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length > 0) {
            event.preventDefault();
            void dropFilesOnPlanBoard(dropped);
          }
          return;
        }
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
      {boardMenu && !isReadOnly ? <BoardContextMenu target={boardMenu} onClose={closeBoardMenu} /> : null}
      <StorageRatioEditor />
      <ReactFlow
        nodes={mounted.nodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // A press that travels under this many pixels is a CLICK, over it a
        // DRAG. A card's buttons drag the card like its background does (only
        // text inputs and wire handles are nodrag), so a jittery click must
        // still count as one.
        nodeClickDistance={3}
        onConnect={isReadOnly ? undefined : handleConnect}
        nodesConnectable={!isReadOnly}
        onConnectStart={isReadOnly ? undefined : handleConnectStart}
        onConnectEnd={isReadOnly ? undefined : handleConnectEndWithSound}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        // React Flow styles its own controls and minimap off this; the app has
        // no light palette to switch to.
        colorMode="dark"
        style={FLOW_WRAPPER_STYLE}
        // No attribution badge: it would crowd the board's corner buttons. The
        // library is MIT and credited in the repo instead.
        proOptions={PRO_OPTIONS}
        isValidConnection={isValidResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        // A press carries a card from where it went down, 1:1 (a threshold would start the carry late and lose that
        // travel); the click slop above (3 px) keeps a jittery press a click, and the grid swallows what it moves.
        nodeDragThreshold={0}
        elevateNodesOnSelect={false}
        edgesReconnectable={false}
        // Delete/Backspace go through the board's own keydown handler and the
        // store (one undo entry, edges pruned); React Flow's built-in delete
        // edits only its local copy.
        deleteKeyCode={null}
        // The shift-drag band selects whatever it touches, so clipping a big
        // card's edge picks it up.
        selectionMode={SelectionMode.Partial}
        // Shift (like Ctrl/Cmd) adds a card to the selection. Shift also drags
        // the band, but the band starts on the pane and this fires on a card.
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        selectionKeyCode={null}
        selectionOnDrag={shiftHeld}
        panOnDrag={!shiftHeld}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onEdgeClick={handleEdgeClick}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        // Where the band STARTED decides whether it may pick up a board; see
        // marqueeShieldRef.
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        // No `fitView`: React Flow's fit-on-init waits for cards to be
        // measured, so on page load it overwrites the restored camera. The
        // app frames for itself on every path that puts cards on the board.
        onlyRenderVisibleElements={false}
        // Double-click pins and unpins waypoint dots, so it cannot also zoom.
        // d3's dblclick.zoom listener sits upstream of React's synthetic
        // events, so it goes off wholesale.
        zoomOnDoubleClick={false}
        // The wheel belongs to the camera controller (useBoardCameraControls);
        // d3 would fight it for the same events. Touch pinch stays d3's.
        zoomOnScroll={false}
        // The same floor and ceiling a framing move is clamped to.
        minZoom={BOARD_MIN_ZOOM}
        maxZoom={boardMaxZoomValue}
        // React Flow's default ("basic") raises every edge to at least its
        // endpoint nodes' z-index, so an edge can never pass BEHIND a card it
        // connects to. Manual mode takes the published zIndex literally.
        zIndexMode="manual"
        // Always. Cards are whole cells; a card between cells is just wrong.
        snapToGrid
        snapGrid={BOARD_GRID_SNAP}
        // A finger drags a card only after selecting it; see withTouchDragRule.
        nodesDraggable={!isCompact && !isReadOnly}
      >
        <NodeDetailController boardRef={boardRef} />
        <VirtualizationController boardRef={boardRef} />
        <HopMapController boardRef={boardRef} />
        <SelectionHandoffController signal={selectionHandoffCount} />
        {/* The pan is a scroll offset, not a transform: see scroll-camera.tsx. */}
        <ScrollCamera boardRef={boardRef} />
        {/* The paper's grain, in board space so it pans and zooms with the
            factory. Mounted before the pattern so dots ink OVER the grain. */}
        {canvasTheme.grain ? <GrainBackground layers={canvasTheme.grain} /> : null}
        {boardView.canvasPattern === "none" ? null : boardView.canvasPattern === "ruled" ||
          boardView.canvasPattern === "graph" ? (
          <RuledBackground
            mode={boardView.canvasPattern}
            color={canvasTheme.patternColor}
          />
        ) : (
          // Our own compositor-friendly copy of the stock Background: the
          // stock one repaints the whole viewport every pan frame (see
          // TiledBackground in board-pattern.tsx). Same ink, no repaint.
          <TiledBackground
            variant={boardView.canvasPattern}
            gap={BOARD_GRID_SIZE}
            // Lines tile edge to edge, so they need to be thinner than a dot
            // to read as a background instead of as graph paper.
            size={boardView.canvasPattern === "lines" ? 1 : 2}
            color={canvasTheme.patternColor}
          />
        )}
        <BoardFloors />
        <BoardMinimap hidden={isCompact} />
        <TourBridge />
        {/* Other people in a live plan: pointers and selections, a layer of
            their own (LivePresenceLayer). Never mounted without live plans. */}
        {isLiveConfigured() ? <LivePresenceLayer boardRef={boardRef} /> : null}
        <VoidDropGhost />
        {annotationDraft && annotationTool ? (
          <AnnotationDraftPreview
            tool={annotationTool}
            draft={annotationDraft}
            swatch={GT_NODE_COLORS[activeColorTag].swatch}
          />
        ) : null}
      </ReactFlow>
      {/* The room's vignette: a screen-space inset shadow over the wires and
          cards, under the chrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 shadow-[inset_0_0_60px_10px_rgba(0,0,0,0.35)]"
      />
      <SolvingBooksOverlay />
      {worksheet ? <PoolWorksheet /> : null}
      {!isReadOnly && !modBar ? <PaintToolbar
        paintMode={nodeColorPaintMode}
        onPaintModeChange={handlePaintModeChange}
        activeColorTag={activeColorTag}
        onColorSelect={handlePaintColorSelect}
        annotationTool={annotationTool}
        onAnnotationToolChange={handleAnnotationToolChange}
        onPlaceImage={placeImageFile}
        isDeleteMode={isDeleteMode}
        onDeleteModeChange={handleDeleteModeChange}
        view={boardView}
        onViewChange={writeBoardView}
        onAutoArrange={handleAutoArrange}
        folded={toolbarFold.paint}
        openGroup={openToolGroup}
        onToggleGroup={handleToolGroupToggle}
        shiftedDown={false}
      /> : null}
      {modBar ? null : (
        <SourceToolbar
          readOnly={isReadOnly}
          folded={!isReadOnly && toolbarFold.build}
          openGroup={openToolGroup}
          onToggleGroup={handleToolGroupToggle}
          shiftedDown={false}
        />
      )}
      {/* The phone sheet on compact only: a desktop window narrow enough to
          fold the paint row still gets the panel or the spread. The mod's bar
          carries its own help key. */}
      {modBar ? null : <BoardHelp compact={isCompact} />}
      {/* Toggled from the dev menu (shift-click the version chip). Sits above
          the help button; see PerfHud.tsx. */}
      <PerfHud />
      {arrangeProgress && !modBar ? (
        <ArrangeLoader progress={arrangeProgress} onCancel={cancelArrange} />
      ) : null}
      {timelapseActive ? (
        // Settings live in the dev menu; this only ends the run (as do Esc
        // and any click on the board).
        <div
          data-timelapse-chip
          className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded border border-line-strong bg-surface/90 px-2.5 py-1.5 text-xs text-fg-muted shadow-lg"
        >
          <span>Build timelapse</span>
          <button
            type="button"
            onClick={() => stopBoardTimelapse()}
            className="rounded border border-line px-1.5 py-0.5 hover:border-line-strong hover:text-fg"
          >
            Stop
          </button>
        </div>
      ) : null}
      {overwritePicking ? (
        <div
          className={[
            "pointer-events-none absolute left-1/2 z-40 flex max-w-[calc(100*var(--ui-vw)-24px)] -translate-x-1/2 items-center gap-2 border-2 border-amber-500 bg-[#2a1e07]/95 px-3 py-1.5 font-mono text-[12px] text-amber-200 shadow-[4px_4px_0_rgba(0,0,0,0.45)]",
            // An instruction, so on a phone it sits at the bottom with the other
            // actions, above the compact bar if both are up.
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
      <SelectionActionsBar
        selectionCount={selectedNodeIds.length}
        canWrap={selectionCanWrap}
        onWrap={wrapSelectedBoardItems}
        canCombine={selectionCanCombine}
        onCombine={combineSelectedMachines}
      />
      {modBar ? null : (
        <SmartViewToolbar
          glanceMode={boardView.glanceMode}
          onModeChange={handleGlanceModeChange}
          onFitView={handleFitView}
        />
      )}
      <HopMapLegend />
      <PlanTopNotices />
      {/* The notices share one column, so none sits on top of another.
          Unwired goes UNDER the dead loop (unfinished work, not a fault); the
          transient add chips ride on top. */}
      <div
        className={[
          // w-max: hung from the board's centre, shrink-to-fit width would be
          // capped at HALF the board and fold every notice onto several rows.
          "nodrag pointer-events-none absolute bottom-3 left-1/2 z-30 flex w-max max-w-[calc(94*var(--ui-vw))] -translate-x-1/2 flex-col-reverse items-center gap-2 transition-opacity",
          // The recipe search dims the board; these sit level with it in the
          // stack, so they mute themselves.
          recipeSearchOpen ? "opacity-20 grayscale [&_*]:pointer-events-none" : "",
        ].join(" ")}
      >
        <PlanNoticeSwitch>
        <UnwiredNotice onShow={handleShowNodes} />
        <DeathSpiralNotice onShow={handleShowNodes} />
        <ClogLockNotice onShow={handleShowNodes} />
        </PlanNoticeSwitch>
        <PlanConversionNotice />
        <RecipeAddChips />
      </div>
      {isProjectImporting ? <FlowLoadingOverlay /> : null}
      <FeedbackHost />
      <TourHost />
      <TourOffer />
    </div>
  );
}

/**
 * The board's to-do list, in one line: how many cards still have a slot with
 * no wire on it. Unfinished work, not a fault: chalk-white to match the mark
 * on the cards (--verdict-unwired-ink), never alert colours. Not dismissible;
 * it disappears once the last slot is connected.
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
    <div className="unwired-notice nodrag pointer-events-auto flex max-w-[min(calc(92*var(--ui-vw)),560px)] flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-2 border-[#c8d2e0] bg-[#2b3038] px-2 py-1.5 font-mono text-[12px] text-[#e8ecf2] shadow-[inset_2px_2px_0_#5d6877,inset_-2px_-2px_0_#171a1f,4px_4px_0_rgba(0,0,0,0.35)]">
      <span className="shrink-0 font-bold tracking-[0.5px] text-[#eef2f8]">NOT WIRED UP</span>
      {/* One line, always: the cards explain themselves. */}
      <span className="text-[#c2cad6]">
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


/**
 * A ring of machines that has wound down to a standstill and cannot restart.
 * A board-level notice because its cause is the ring itself: every card in it
 * can only point at the next one. Dismissal is keyed to the ring's identity,
 * so dismissing it does not silence the next one.
 */
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
    <div className="nodrag pointer-events-auto flex max-w-[min(calc(92*var(--ui-vw)),560px)] flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-2 border-[#c34c4c] bg-[#2b1c1c] px-2 py-1.5 font-mono text-[12px] text-[#f2e4e4] shadow-[inset_2px_2px_0_#7a3636,inset_-2px_-2px_0_#1a1010,4px_4px_0_rgba(0,0,0,0.35)]">
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
 * The dead loop's mirror, in the clog family's blue: machines frozen because
 * their own surplus has nowhere to go (the fix is a drawer, not a feeder).
 * Board-level and dismissed per jam identity, like DeathSpiralNotice.
 */
const ClogLockNotice = memo(function ClogLockNotice({
  onShow,
}: {
  onShow: (nodeIds: string[]) => void;
}) {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined);
  const [showIndex, setShowIndex] = useState(0);
  const locks = useMemo(
    () => findClogLocks(project, lastResult).locks,
    [project, lastResult],
  );

  const lock = locks[0];
  if (!lock || dismissedId === lock.id) {
    return null;
  }
  const story = describeClogLock(lock);
  // "Show me" lands on the worst surplus first and each further click walks
  // the other vent sites, one card at a time; framing the whole jam points at
  // nothing.
  const showTargets = lock.ventNodeIds.length > 0 ? lock.ventNodeIds : lock.machineIds;
  const showAt = showIndex % showTargets.length;

  return (
    <div className="nodrag pointer-events-auto flex max-w-[min(calc(92*var(--ui-vw)),560px)] flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-2 border-[#4c7ec3] bg-[#1a222b] px-2 py-1.5 font-mono text-[12px] text-[#e4ecf2] shadow-[inset_2px_2px_0_#365d7a,inset_-2px_-2px_0_#10161a,4px_4px_0_rgba(0,0,0,0.35)]">
      <span className="shrink-0 font-bold tracking-[0.5px] text-[#9cc9ff]">CLOG LOCK</span>
      <span className="text-[#d2e0e6]">{story.short}</span>
      {locks.length > 1 ? (
        <span className="shrink-0 text-[#9aaab8]">
          +{locks.length - 1} more
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          onShow([showTargets[showAt]!]);
          setShowIndex(showAt + 1);
        }}
        className="shrink-0 border border-[#4c7ec3] bg-[#24384a] px-2 py-0.5 font-bold text-[#d0e6ff] hover:bg-[#2f4a63]"
      >
        {showTargets.length > 1 ? `Show me (${showAt + 1}/${showTargets.length})` : "Show me"}
      </button>
      <button
        type="button"
        onClick={() => setDismissedId(lock.id)}
        title="Dismiss"
        aria-label="Dismiss this notice"
        className="flex h-5 w-5 shrink-0 items-center justify-center border border-[#365d7a] text-[#b3cbe0] hover:bg-[#24384a]"
      >
        ×
      </button>
    </div>
  );
});

/**
 * Every open board's paper, painted in one viewport-space layer under the
 * wires. Not the boards' own nodes: the chrome sits OVER the wires while the
 * floor sits UNDER them, one node cannot be in two places in the stack, and
 * React Flow pins every child above its parent. Positions come from the live
 * node lookup, so the paper tracks a dragged frame without lagging a commit.
 */
const EMPTY_BOARD_FLOORS: Array<{ pocket: FactoryPocket; width: number; height: number }> = [];

const BoardFloors = memo(function BoardFloors() {
  const planMode = useFactoryStore((state) => state.project.planMode === true);
  const floors = useStore(
    (state) => {
      // This selector runs on EVERY store notification, every pan and drag
      // frame included. With no open board (the common case) it must cost one
      // identity check: returning the shared empty lets Object.is short-circuit.
      let open: Array<{ pocket: FactoryPocket; width: number; height: number }> | undefined;
      for (const [, node] of state.nodeLookup) {
        if (node.type !== "boardNode") {
          continue;
        }
        // A hidden frame paints no paper: the build timelapse hides frames
        // until their beat.
        if (node.hidden) {
          continue;
        }
        const data = node.data as BoardNodeData | undefined;
        const pocket = data?.pocket;
        if (!pocket?.expanded) {
          continue;
        }
        const size = boardWindowSize(pocket);
        (open ??= []).push({
          // The live absolute position, so a nested board's paper follows
          // its parent as well as its own drag.
          pocket: { ...pocket, position: node.internals.positionAbsolute },
          width: node.measured?.width ?? size.width,
          height: node.measured?.height ?? size.height,
        });
      }
      return open ?? EMPTY_BOARD_FLOORS;
    },
    (left, right) =>
      left.length === right.length &&
      left.every((entry, index) => {
        const other = right[index];
        return (
          entry.pocket.id === other.pocket.id &&
          entry.pocket.position.x === other.pocket.position.x &&
          entry.pocket.position.y === other.pocket.position.y &&
          entry.pocket.theme === other.pocket.theme &&
          entry.pocket.pattern === other.pocket.pattern &&
          entry.pocket.colorTag === other.pocket.colorTag &&
          entry.width === other.width &&
          entry.height === other.height
        );
      }),
  );

  if (floors.length === 0) {
    return null;
  }

  return (
    <ViewportPortal>
      {/* Under the wires (10) and above the backdrop ink (-5). */}
      <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: -4 }}>
        {floors.map((floor) =>
          planMode ? (
            <GroupFloor key={floor.pocket.id} pocket={floor.pocket} width={floor.width} height={floor.height} />
          ) : (
          <BoardFloor
            key={floor.pocket.id}
            pocket={floor.pocket}
            width={floor.width}
            height={floor.height}
          />
          ),
        )}
      </div>
    </ViewportPortal>
  );
});

/**
 * Lives inside the ReactFlow tree for its store access. After a band select,
 * React Flow keeps a group-drag rectangle up until a pane click; when a
 * paste/wrap/blueprint-load hands the selection to fresh cards, it would sit
 * over them and swallow clicks. Each handoff dismisses it.
 */
function SelectionHandoffController({ signal }: { signal: number }) {
  const storeApi = useStoreApi();
  useEffect(() => {
    storeApi.setState({ nodesSelectionActive: false });
  }, [signal, storeApi]);
  return null;
}

/**
 * A bar of actions: at the bottom on a phone, in reach of a thumb (the top
 * line already carries the tool triggers).
 */
function actionBarPosition(compact: boolean, second: boolean): string {
  if (compact) {
    return second ? "bottom-28" : "bottom-16";
  }
  // Under the toolbar rows, not over them, or it covers the mode switch on
  // a narrow board.
  return second ? "top-28" : "top-16";
}

/**
 * Appears only while several cards are selected: wrap the selection in a
 * board, or combine it into one shared machine. Lives on the board so it
 * reads as acting on the selection under it.
 */
const SelectionActionsBar = memo(function SelectionActionsBar({
  selectionCount,
  canWrap,
  onWrap,
  canCombine,
  onCombine,
}: {
  selectionCount: number;
  /** False when something selected is already on a board, or is one. */
  canWrap: boolean;
  onWrap: () => boolean;
  /** True when one machine could run every selected card's recipes (shared-machine.ts). */
  canCombine: boolean;
  onCombine: () => boolean;
}) {
  const isCompact = useIsCompactViewport();
  const planBoard = useFactoryStore((state) => state.project.planMode === true);
  if (selectionCount < 2 || (!canWrap && !canCombine)) {
    return null;
  }

  return (
    <div
      data-board-toolbar
      // A button, so on a phone it sits at the bottom in reach of a thumb;
      // on a desktop it stays at the top.
      className={[
        "nodrag pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2",
        actionBarPosition(isCompact, false),
      ].join(" ")}
    >
      {canCombine ? (
        // SHARED MACHINES: the one coloured key on the bar, in the selection's
        // blue (--selection): the cards fold into one machine that runs all
        // of their recipes, wires following.
        <button
          type="button"
          onClick={onCombine}
          {...tipAttrs(COMBINE_TIP)}
          className="flex h-9 items-center gap-1.5 whitespace-nowrap border-2 border-[var(--selection)] bg-[#0b5563] px-3 font-mono text-[12px] font-bold text-white shadow-[inset_2px_2px_0_var(--selection-soft),inset_-2px_-2px_0_#063640] hover:brightness-110"
        >
          <Combine className="h-4 w-4" />
          Combine {selectionCount} into one machine
        </button>
      ) : null}
      {canWrap ? (
      <button
        type="button"
        onClick={onWrap}
        title={planBoard ? "Group these (Ctrl+G)" : "Wrap in a board (Ctrl+G)"}
        // Plain chrome, like every other button: boards have no house colour.
        className="flex h-9 items-center gap-1.5 whitespace-nowrap border-2 border-[var(--mc-15)] bg-[var(--mc-49)] px-3 font-mono text-[12px] font-bold text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
      >
        <Box className="h-4 w-4" />
        {planBoard ? "Group" : `Wrap ${selectionCount} in a board`}
      </button>
      ) : null}
    </div>
  );
});

/** Which of the board's toolbars is unfolded while folded (see toolbar-fold.ts). */
type ToolGroupId = "build" | "paint";

interface ToolGroupProps {
  id: ToolGroupId;
  folded: boolean;
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
 * groups without labels. The palette's bevelled slab, lighter than the board
 * so the darker faces read as recessed keys. A lone button in a plated row
 * gets a plate too, so baselines line up. It casts the cards' drop-shadow
 * (.react-flow__node in globals.css), so chrome and cards sit at one height.
 */
function ToolTray({
  children,
  helpAnchor,
  raised = false,
}: {
  children: React.ReactNode;
  /** Names the tray to the board's help sheet, which rings it. */
  helpAnchor?: string;
  /** A dropdown must sit above trays that wrap onto the next line. */
  raised?: boolean;
}) {
  return (
    <div
      data-toolbar-tray
      style={{ zoom: BOARD_TOOL_SCALE }}
      data-help-anchor={helpAnchor}
      className={`${raised ? "relative z-30 " : ""}pointer-events-auto flex shrink-0 items-start gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] [filter:drop-shadow(6px_8px_7px_rgba(0,0,0,0.45))]`}
    >
      {children}
    </div>
  );
}

/**
 * Close an open fold-out through the shared dropdown rule. Every toolbar
 * fold-out opens on CLICK, never hover: hover-open menus stack over one
 * another when the pointer crosses the row quickly.
 */
function useFoldoutDismiss(
  open: boolean,
  ref: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  // The one dropdown rule (use-dropdown-dismiss.ts): press outside, Escape,
  // wheel, scroll, resize, a board pan, or the mouse drifting away.
  useDropdownDismiss(open, { refs: [ref], onClose: close, fade: true });
}

/**
 * The two faces of every board toggle; ON is the pressed light key. The
 * palette's swatches keep a cyan ring instead: a selection mark there has to
 * stand against any hue, including this grey.
 */
const TOOL_FACE_ON = "bg-[var(--mc-85)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100)]";
const TOOL_FACE_OFF =
  "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

/**
 * A toolbar folded into one button, for boards too narrow to carry it; the
 * open one unfolds over empty canvas. Folding is decided per toolbar by the
 * BOARD's width in toolbar-fold.ts, not the window's. Unfolded this renders
 * its children and nothing else, so the DOM is unchanged.
 */
function ToolGroup({
  id,
  folded,
  openGroup,
  onToggle,
  icon: Icon,
  label,
  side,
  children,
}: ToolGroupProps) {
  if (!folded) {
    return <>{children}</>;
  }

  const isOpen = openGroup === id;
  // The row unfolds DOWNWARDS onto a line of its own, absolutely positioned:
  // the triggers share the top line, and a folded row takes no width, so a
  // trigger never shifts.
  //
  // `invisible` rather than `opacity-0`: every button in these rows sets
  // `pointer-events-auto`, which would override a `pointer-events-none` here
  // and leave invisible buttons taking taps. It costs the fade on the way out.
  const row = (
    <div
      className={[
        // `w-max`, or the row inherits the folded toolbar's one-button width
        // and wraps into a vertical column. top-10 leaves a small gap below
        // the plated trigger.
        "absolute top-10 flex w-max max-w-[calc(var(--board-width,calc(100*var(--ui-vw)))-24px)] flex-wrap items-start gap-1 transition-[opacity,transform] duration-100",
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
        // Folded, the trigger IS the toolbar to the help sheet: the row is
        // still in the DOM but invisible, so the ring goes on this button.
        data-help-anchor={id}
        aria-expanded={isOpen}
        aria-label={isOpen ? `Hide ${label}` : `Show ${label}`}
        title={isOpen ? `Hide ${label}` : label}
        className={[
          "pointer-events-auto relative z-10 flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[var(--mc-15)]",
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

/**
 * The smart-view switch, bottom right: what a zoomed-out card leads with.
 * Exactly one glance mode is always in force.
 */
const SmartViewToolbar = memo(function SmartViewToolbar({
  glanceMode,
  onModeChange,
  onFitView,
}: {
  glanceMode: BoardView["glanceMode"];
  /** Picking a coloured view drops the paint brush. */
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
    <div
      data-help-anchor="glance"
      className="nodrag pointer-events-none absolute bottom-3 right-3 z-20 flex items-start gap-[0.4rem]"
    >
      {/* On its own plate: this one moves the camera, the row beside it
          changes what every card shows. */}
      <ToolTray>
        <button
          type="button"
          onClick={onFitView}
          className={buttonClass(false)}
          title="Fit on screen"
          aria-label="Fit the plan on the screen"
        >
          <Focus className="h-4 w-4" />
        </button>
      </ToolTray>
      {/* The smart views. Every one of them is a zoomed-out reading: up close
          the cards always look like themselves, whichever is picked. */}
      <ToolTray>
        <button
          type="button"
          onClick={() => onModeChange("identity")}
          className={buttonClass(glanceMode === "identity")}
          title="Big icons"
          aria-label="Big icons"
          aria-pressed={glanceMode === "identity"}
        >
          <Box className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onModeChange("status")}
          className={buttonClass(glanceMode === "status")}
          title="Speed"
          aria-label="Speed"
          aria-pressed={glanceMode === "status"}
        >
          <Gauge className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onModeChange("usage")}
          className={buttonClass(glanceMode === "usage")}
          title="Usage"
          aria-label="Usage"
          aria-pressed={glanceMode === "usage"}
        >
          <TriangleAlert className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onModeChange("power")}
          className={buttonClass(glanceMode === "power")}
          title="Power"
          aria-label="Power"
          aria-pressed={glanceMode === "power"}
        >
          <Zap className="h-4 w-4" />
        </button>
      </ToolTray>
    </div>
  );
});

const RATE_UNIT_CHOICES: Array<{ unit: RateUnit; label: string; title: string }> = [
  { unit: "tick", label: "/t", title: "Per tick" },
  { unit: "second", label: "/s", title: "Per second" },
  { unit: "minute", label: "/m", title: "Per minute" },
  { unit: "hour", label: "/h", title: "Per hour" },
  // The odd one out, and dressed as such (gold face, its own sound): not a
  // clock but the EU each output cost to make. See rate-unit.ts.
  { unit: "eu", label: "EU", title: "EU per unit made" },
];

/** The rate key's face while it reads energy: gold, like the readings. */
const TOOL_FACE_ENERGY =
  "bg-amber-300 text-black shadow-[inset_2px_2px_0_#fde68a,inset_-2px_-2px_0_#b45309] hover:brightness-110";

/** One tap of the rate dial, in the voice the chosen unit speaks. */
function playRateDial(unit: RateUnit, step: number): void {
  playBoardSound(unit === "eu" ? "dialEnergy" : "dialRate", { step });
}


/**
 * The left toolbar: undo/redo on their own plate, then (foldable) the rate
 * and power unit dials and the checklist keys.
 */
const SourceToolbar = memo(function SourceToolbar({
  readOnly = false,
  folded,
  openGroup,
  onToggleGroup,
  shiftedDown,
}: {
  readOnly?: boolean;
  folded: boolean;
  openGroup?: ToolGroupId;
  onToggleGroup: (group: ToolGroupId | undefined) => void;
  /** A banner has the top line: step down one. */
  shiftedDown: boolean;
}) {
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const setRateUnit = useFactoryStore((state) => state.setRateUnit);
  const rateChoice =
    RATE_UNIT_CHOICES.find((choice) => choice.unit === rateUnit) ?? RATE_UNIT_CHOICES[1];
  const [isRateMenuOpen, setRateMenuOpen] = useState(false);
  const rateRef = useRef<HTMLDivElement | null>(null);
  const closeRateMenu = useCallback(() => setRateMenuOpen(false), []);
  useFoldoutDismiss(isRateMenuOpen, rateRef, closeRateMenu);
  // The power unit key beside it: EU/t, or amps of a chosen tier; the second
  // board-wide view dial, worked like the rate unit's.
  const powerDisplayUnit = useFactoryStore((state) => state.powerDisplayUnit);
  const setPowerDisplayUnit = useFactoryStore((state) => state.setPowerDisplayUnit);
  const [isPowerUnitMenuOpen, setPowerUnitMenuOpen] = useState(false);
  const powerUnitRef = useRef<HTMLDivElement | null>(null);
  const closePowerUnitMenu = useCallback(() => setPowerUnitMenuOpen(false), []);
  useFoldoutDismiss(isPowerUnitMenuOpen, powerUnitRef, closePowerUnitMenu);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gtnh-factory-flow.power-display-unit.v1");
      if (isPowerDisplayUnit(saved)) setPowerDisplayUnit(saved);
    } catch { /* Use EU/t when storage is unavailable. */ }
  }, [setPowerDisplayUnit]);

  // Subscribe to the DEPTHS, not the history arrays: a selector returning the
  // array itself would re-render this toolbar on every project edit.
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const canUndo = useFactoryStore((state) => state.liveUndo ? state.liveUndo.canUndo : state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.liveUndo ? state.liveUndo.canRedo : state.redoHistory.length > 0);
  const historyButtonClass = (enabled: boolean) =>
    [
      "pointer-events-auto relative z-10 flex h-8 w-8 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
      enabled ? "hover:brightness-110" : "cursor-not-allowed opacity-40",
    ].join(" ");

  return (
    <div
      data-board-toolbar
      data-help-anchor="build"
      className={[
        "nodrag pointer-events-none absolute left-[var(--toolbar-inset,0.75rem)] flex items-start gap-[0.4rem]",
        // Lifted while either unit menu hangs below, so a notice card cannot
        // paint over it - the same lift the paint row gives its fold-outs.
        isRateMenuOpen || isPowerUnitMenuOpen ? "z-40" : "z-20",
        // When a banner takes the top line the row steps down; its fold-out
        // follows, since that is positioned against this root.
        shiftedDown ? "top-14" : "top-3",
      ].join(" ")}
    >
      {/* History first, and set apart on its own plate: it undoes everything
          the rest of the board does, so it belongs to no other group. */}
      {!readOnly && <ToolTray>
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
      </ToolTray>}
      {/* Undo and redo stay out of the fold-out even on a phone: a mistake
          is not the moment to go hunting for them. */}
      <ToolGroup
        id="build"
        folded={folded}
        openGroup={openGroup}
        onToggle={onToggleGroup}
        icon={Hammer}
        label="build tools"
        side="left"
      >
      {/* How the numbers read: ONE key wearing the current unit, opening
          the units as a named list. */}
      <ToolTray raised={isRateMenuOpen || isPowerUnitMenuOpen}>
        <div ref={rateRef} className="relative flex">
          <button
            type="button"
            onClick={() => setRateMenuOpen((was) => !was)}
            onWheel={(event) => {
              // The key is also a wheel dial: scroll up climbs the ladder,
              // clamped at the ends. Stopped so the board never zooms.
              if (!wheelChangesValues()) return;
              event.stopPropagation();
              const index = RATE_UNIT_CHOICES.findIndex((choice) => choice.unit === rateUnit);
              const next = Math.min(
                RATE_UNIT_CHOICES.length - 1,
                Math.max(0, index + (event.deltaY < 0 ? 1 : -1)),
              );
              if (next !== index) {
                playRateDial(RATE_UNIT_CHOICES[next]!.unit, next);
                setRateUnit(RATE_UNIT_CHOICES[next]!.unit);
              }
            }}
            aria-expanded={isRateMenuOpen}
            aria-label={`Rate unit: ${rateChoice.title.toLowerCase()}`}
            className={[
              "pointer-events-auto relative z-10 flex h-8 w-8 items-center justify-center border-2 border-[var(--mc-15)] font-mono text-[12px] font-black",
              isRateMenuOpen ? TOOL_FACE_ON : rateUnit === "eu" ? TOOL_FACE_ENERGY : TOOL_FACE_OFF,
            ].join(" ")}
          >
            {rateChoice.label}
          </button>
          {isRateMenuOpen ? (
            <div className="absolute left-0 top-[calc(100%+10px)] z-30 flex w-max flex-col gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
              {RATE_UNIT_CHOICES.map((choice, index) => (
                <button
                  key={choice.unit}
                  type="button"
                  onClick={() => {
                    playRateDial(choice.unit, index);
                    setRateUnit(choice.unit);
                    setRateMenuOpen(false);
                  }}
                  aria-pressed={rateUnit === choice.unit}
                  className={[
                    "pointer-events-auto flex items-center gap-2 border-2 p-1 pr-2 text-left",
                    rateUnit === choice.unit
                      ? choice.unit === "eu"
                        ? "border-white bg-amber-300 text-black ring-2 ring-amber-200"
                        : "border-white bg-[var(--mc-85)] text-[var(--mc-ink)] ring-2 ring-cyan-300"
                      : choice.unit === "eu"
                        ? "border-amber-700 bg-[var(--mc-49)] text-amber-300 hover:bg-[var(--mc-61)]"
                        : "border-[var(--mc-15)] bg-[var(--mc-49)] text-white hover:bg-[var(--mc-61)]",
                  ].join(" ")}
                >
                  <span className="flex h-6 w-7 shrink-0 items-center justify-center font-mono text-[12px] font-black">
                    {choice.label}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[11px] font-semibold">
                    {choice.title}
                  </span>
                </button>
              ))}
              <div className="pt-0.5 text-center font-mono text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--mc-ink-muted)]">
                Display only
              </div>
            </div>
          ) : null}
        </div>
        {/* The POWER unit: EU/t, or amps of a tier (EU/t over the tier's
            voltage), since dynamos, cables and hatches are rated in amps at
            a voltage. */}
        <div ref={powerUnitRef} className="relative flex">
          <button
            type="button"
            onClick={() => setPowerUnitMenuOpen((was) => !was)}
            onWheel={(event) => {
              // Same wheel dial as the rate key: EU/t is the floor, the
              // tiers climb from it.
              if (!wheelChangesValues()) return;
              event.stopPropagation();
              const ladder: Array<typeof powerDisplayUnit> = [
                "eu",
                ...GT_VOLTAGE_TIERS.map((entry) => entry.tier),
              ];
              const index = ladder.indexOf(powerDisplayUnit);
              const next = Math.min(
                ladder.length - 1,
                Math.max(0, index + (event.deltaY < 0 ? 1 : -1)),
              );
              if (next !== index) {
                playBoardSound("dialPower", { step: next });
                setPowerDisplayUnit(ladder[next]!);
              }
            }}
            aria-expanded={isPowerUnitMenuOpen}
            aria-label={
              powerDisplayUnit === "eu"
                ? "Power unit: EU per tick"
                : `Power unit: amps of ${powerDisplayUnit}`
            }
            className={[
              // Fixed width: the tier names run two to three letters and a
              // wheel-scroll through them must not pump the toolbar.
              "pointer-events-auto relative z-10 flex h-8 w-[76px] items-center justify-center gap-1 whitespace-nowrap border-2 px-1 font-mono text-[11px] font-bold",
              // In a tier mode the WHOLE key IS the tier chip the machine
              // cards wear: same bevel, same text shadow, same weight.
              powerDisplayUnit === "eu"
                ? `border-[var(--mc-15)] font-black text-amber-400 ${isPowerUnitMenuOpen ? TOOL_FACE_ON : TOOL_FACE_OFF}`
                : `shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] ${isPowerUnitMenuOpen ? "brightness-110" : "hover:brightness-110"}`,
            ].join(" ")}
            style={
              powerDisplayUnit === "eu"
                ? undefined
                : {
                    background: GT_TIER_COLORS[powerDisplayUnit as keyof typeof GT_TIER_COLORS].background,
                    borderColor: GT_TIER_COLORS[powerDisplayUnit as keyof typeof GT_TIER_COLORS].border,
                    color: GT_TIER_COLORS[powerDisplayUnit as keyof typeof GT_TIER_COLORS].text,
                    textShadow: `1px 1px 0 ${GT_TIER_COLORS[powerDisplayUnit as keyof typeof GT_TIER_COLORS].shadow}`,
                  }
            }
          >
            <Zap className="h-3 w-3 fill-current" />
            {/* The board's one amps notation: number, then A, then tier -
                "2.5 A LV" - and the key names the unit half of it, "A LV".
                The game's underline convention rides only the tier word. */}
            {powerDisplayUnit === "eu" ? (
              "EU/t"
            ) : (
              <span className="whitespace-nowrap">
                A{" "}
                <span
                  style={{
                    textDecoration: GT_TIER_COLORS[powerDisplayUnit as keyof typeof GT_TIER_COLORS].underline
                      ? "underline"
                      : undefined,
                  }}
                >
                  {powerDisplayUnit}
                </span>
              </span>
            )}
          </button>
          {isPowerUnitMenuOpen ? (
            // EU/t and the fifteen tiers, one uniform 4x4 grid of equal
            // cells - EU/t is a choice like any other, not a banner.
            <div className={`absolute ${folded ? "right-0" : "left-0"} top-[calc(100%+10px)] z-30 grid w-max grid-cols-4 gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[4px_4px_0_rgba(0,0,0,0.45)]`}>
              <button
                type="button"
                onClick={() => {
                  playBoardSound("dialPower", { step: 0 });
                  setPowerDisplayUnit("eu");
                  setPowerUnitMenuOpen(false);
                }}
                aria-pressed={powerDisplayUnit === "eu"}
                aria-label="EU per tick"
                className={[
                  // The EU/t cell wears the same bevel as the tier chips,
                  // on the toolbar's dark face with the amber bolt.
                  "pointer-events-auto flex h-8 items-center justify-center gap-1 border-2 px-1.5 font-mono text-[11px] font-bold shadow-[inset_2px_2px_0_rgba(255,255,255,0.25),inset_-2px_-2px_0_rgba(0,0,0,0.45)]",
                  powerDisplayUnit === "eu"
                    ? "border-[var(--mc-15)] bg-[var(--mc-61)] text-amber-400 ring-2 ring-cyan-300"
                    : "border-[var(--mc-15)] bg-[var(--mc-49)] text-amber-400 hover:bg-[var(--mc-61)]",
                ].join(" ")}
              >
                <Zap className="h-3 w-3 fill-current" />
                EU/t
              </button>
              {GT_VOLTAGE_TIERS.map(({ tier }, index) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => {
                    // Rung 1 upward: the EU/t cell is the ladder's floor.
                    playBoardSound("dialPower", { step: index + 1 });
                    setPowerDisplayUnit(tier);
                    setPowerUnitMenuOpen(false);
                  }}
                  aria-pressed={powerDisplayUnit === tier}
                  aria-label={`Amps of ${tier}`}
                  className={[
                    // The machine cards' own chip treatment: bevel, text
                    // shadow, bold - the menu is a tray of the real chips.
                    "pointer-events-auto flex h-8 items-center justify-center border-2 px-1.5 font-mono text-[11px] font-bold shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)]",
                    powerDisplayUnit === tier ? "ring-2 ring-cyan-300" : "hover:brightness-110",
                  ].join(" ")}
                  style={{
                    background: GT_TIER_COLORS[tier].background,
                    borderColor: GT_TIER_COLORS[tier].border,
                    color: GT_TIER_COLORS[tier].text,
                    textShadow: `1px 1px 0 ${GT_TIER_COLORS[tier].shadow}`,
                    textDecoration: GT_TIER_COLORS[tier].underline ? "underline" : undefined,
                  }}
                >
                  {tier}
                </button>
              ))}
              <div className="col-span-4 pt-0.5 text-center font-mono text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--mc-ink-muted)]">
                Display only
              </div>
            </div>
          ) : null}
        </div>
      </ToolTray>
      <ToolTray>
        <ChecklistKeys folded={folded} />
      </ToolTray>
      </ToolGroup>
    </div>
  );
});

/** A zoom change this large (a ratio, in nats: about 22%) writes --board-zoom at once (only at the glance step). */
const BOARD_ZOOM_STEP = 0.2;
/** Smaller changes write the exact zoom once it has rested this long. */
const BOARD_ZOOM_SETTLE_MS = 140;

/**
 * The single owner of the board's zoom-detail level. Renders nothing: it
 * watches the store's transform, publishes the level for edges to subscribe
 * to, and stamps it on the board element. React state here would re-render
 * the whole board on every threshold crossing.
 *
 * A data ATTRIBUTE, not a class: React owns the board's `className` and
 * rebuilds it every render, which would wipe a class added here. React never
 * touches an attribute it was not given.
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
    let settleTimer: number | undefined;

    // The live zoom, as a custom property on the board: the identity glance's
    // hover popup and the card's screen-size rings divide by it. It is
    // INHERITED, so every write restyles every element under the board (6-8 us
    // each, over a second a frame at 1000 cards). So it moves in coarse steps
    // while the zoom is moving (a ring a few percent too thick for a moment is
    // invisible) and lands exactly once the zoom has rested.
    const publishZoom = (zoom: number) => {
      if (!Number.isFinite(zoom) || zoom <= 0) {
        return;
      }
      const rounded = Math.round(zoom * 500) / 500;
      window.clearTimeout(settleTimer);
      if (rounded === publishedZoom) {
        return;
      }
      const write = () => {
        publishedZoom = rounded;
        writeBoardZoom(boardRef.current, rounded);
      };
      if (publishedZoom === 0 || Math.abs(Math.log(rounded / publishedZoom)) >= BOARD_ZOOM_STEP) {
        write();
      } else {
        settleTimer = window.setTimeout(write, BOARD_ZOOM_SETTLE_MS);
      }
    };

    // The attribute carries the EFFECTIVE level (a forced glance wins over
    // the zoom-derived one), re-applied whenever either changes. Idempotent:
    // the subscription below also fires for flips this code publishes.
    let appliedValue: string | undefined;
    const applyAttribute = () => {
      const board = boardRef.current;
      if (!board) {
        return;
      }
      const effective = getPublishedNodeDetailLevel();
      // The hop map only exists at the glance step; full detail clears it.
      if (effective === NODE_DETAIL_FULL) {
        clearHopMap();
      }
      const value = nodeDetailAttributeValue(effective);
      if (value === appliedValue) {
        return;
      }
      appliedValue = value;
      if (value) {
        board.setAttribute(NODE_DETAIL_ATTRIBUTE, value);
      } else {
        board.removeAttribute(NODE_DETAIL_ATTRIBUTE);
      }
    };

    const relevel = (zoom: number) => {
      const next = getNodeDetailLevel(zoom, level);
      if (next !== level) {
        level = next;
        setNodeDetailLevel(next);
      }
      applyAttribute();
    };
    const apply = (zoom: number) => {
      publishZoom(zoom);
      relevel(zoom);
    };

    apply(flowStore.getState().transform[2]);
    const unsubscribeZoom = flowStore.subscribe((state) => {
      apply(state.transform[2]);
    });
    // Fires on the forced-glance toggle too, which changes the effective
    // level with no zoom event anywhere near it.
    const unsubscribeLevel = subscribeNodeDetailLevel(applyAttribute);
    // The "Zoomed-out view" setting moves the threshold under a board that is not moving.
    const unsubscribeSettings = subscribeDeviceSettings(() =>
      relevel(flowStore.getState().transform[2]),
    );
    return () => {
      window.clearTimeout(settleTimer);
      unsubscribeZoom();
      unsubscribeLevel();
      unsubscribeSettings();
    };
  }, [boardRef, flowStore]);

  return null;
});

/**
 * Owns the hop map: what the pointer is resting on, and when to paint from it.
 *
 * NOT React Flow's `onNodeMouseEnter`: the nodes layer is
 * `pointer-events: none` while panning or zooming (globals.css), so wheeling
 * out to glance over a card fires no node-enter. A plain `mousemove` plus a
 * hit-test asks "what are you on now", whatever order zoom and move came in.
 *
 * Glance state is read from the board's own attribute, which is what CSS is
 * drawing with. The short wait before painting is per CARD (see `pendingId`).
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
      // Cheap checks first: this runs on EVERY mousemove at every zoom, and
      // the closest() walk is only worth doing in the mode that wants the map.
      // A held wire owns the board.
      if (isWiringConnection()) {
        cancel();
        return;
      }
      if (board.getAttribute(NODE_DETAIL_ATTRIBUTE) !== "glance") {
        cancel();
        return;
      }
      // The distance map belongs to the STATUS smart view; in the others hover
      // shows the card's own figures and the map would paint over them.
      if (board.getAttribute("data-glance-mode") !== "status") {
        cancel();
        return;
      }
      const target = event.target;
      const nodeElement =
        target instanceof Element ? target.closest(".react-flow__node") : undefined;
      const nodeId = nodeElement?.getAttribute("data-id");
      if (!nodeId) {
        cancel();
        return;
      }
      if (getHopMapHubId() === nodeId || pendingId === nodeId) {
        // Already the hub, or on its way. The wait is per CARD, not per move:
        // a resting hand still sends mousemoves, and restarting the clock on
        // each would make the map wait for perfect stillness.
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
 * What the colours mean while a hop map is up: turns "near/far" into a hop
 * count. It subscribes to the map's hub, so with no map it renders null.
 * Chains longer than this get a continuous bar instead of a chip per hop.
 */
const HOP_LEGEND_MAX_CHIPS = 9;

const CHIP_CLASS =
  "flex h-8 w-8 items-center justify-center border-2 border-black/60 text-[15px] font-black leading-none";

/**
 * How long the pointer has to be ON a card before the map appears: long
 * enough that sweeping across the board maps nothing. The clock starts on
 * arrival and is not restarted by moving around on the card.
 */
const HOP_MAP_SETTLE_MS = 90;

const HopMapLegend = memo(function HopMapLegend() {
  const map = useHopMapSummary();
  // Any map gets a key, including a card wired to nothing (maxDepth 0): a
  // lone card in a field of grey needs the explanation most.
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
      // z-40, above every node: a card's z-index is lifted on hover and while
      // a picker is open. bottom-16 leaves the corner to the view buttons.
      className="nodrag pointer-events-none absolute bottom-16 right-3 z-40 flex flex-col gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] px-3 py-2.5 font-mono font-bold text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.35)]"
    >
      <span className="text-[13px] uppercase tracking-[1px]">Hops needed</span>
      {chipped ? (
        <div className="flex items-center gap-1.5">
          {/* The hub (the card under the cursor) is step 0. */}
          {hubChip}
          {depths.map((depth) => (
            <span
              key={depth}
              className={CHIP_CLASS}
              style={{
                backgroundColor: hopFill(depth, map.maxDepth),
                // The ramp ends nearly black, so each chip picks its own ink,
                // as the cards do.
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
  tool: BoardDrawTool;
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
        {/* Drawn solid, exactly as it will land. */}
        {tool === "zone" ? (
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            {/* The fill closes the loop through the cursor, previewing the
                shape before the first corner is clicked again. */}
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
        ) : tool === "board" ? (
          // The window's shape in chrome grey, no hue: a board picks its own
          // paper on creation, so a coloured preview would promise the wrong one.
          <div className="h-full w-full border-2 border-[var(--mc-ink)] bg-[var(--mc-ink)]/5">
            <div className="h-[40px] w-full border-b-2 border-[var(--mc-15)] bg-[var(--mc-78)]" />
          </div>
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
 * A hidden file input behind a toolbar button: picking a file IS the gesture.
 * The button spins while the upload is out.
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
          "flex items-center gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] p-1 pr-2 text-left text-white hover:bg-[var(--mc-61)]",
          busy ? "cursor-wait opacity-70" : "",
        ].join(" ")}
        title="Add an image"
        aria-label="Add an image"
      >
        <span className="flex h-7 w-7 items-center justify-center">
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
        </span>
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold">Add an image</span>
      </button>
    </>
  );
}

const ANNOTATION_TOOLS: Array<{
  kind: BoardDrawTool;
  label: string;
  Icon: typeof Square;
}> = [
  { kind: "board", label: "Draw board", Icon: AppWindow },
  { kind: "box", label: "Draw box", Icon: Square },
  { kind: "zone", label: "Draw zone", Icon: Hexagon },
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


/**
 * Board VIEW options, one button and a sheet that names each option. Set
 * apart from the paint and annotation tools: those change the plan, these
 * only how you look at it. Memoized because FactoryFlow re-renders every
 * frame of a node drag; with stable callbacks this renders only when the
 * view or its open state changes.
 */
const BoardViewMenu = memo(function BoardViewMenu({
  view,
  onChange,
  open,
  onOpenChange,
  arrange,
}: {
  view: BoardView;
  onChange: (patch: Partial<BoardView>) => void;
  /** Held by the paint toolbar, which lifts the row's z while the sheet is out. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Auto-arrange: its one setting, and the button that runs it. */
  arrange: {
    keepBoards: boolean;
    onToggleKeepBoards: () => void;
    onArrange: (options: { keepBoards: boolean }) => void;
  };
}) {
  const { canvasPattern } = view;
  // Motion is device taste, not plan state: read and written through its own
  // store (board-motion.tsx), never through the plan-view snapshot.
  const boardMotion = useBoardMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeSheet = useCallback(() => onOpenChange(false), [onOpenChange]);
  useFoldoutDismiss(open, rootRef, closeSheet);

  const toggles: Array<{
    id: string;
    on: boolean;
    label: string;
    line?: string;
    Icon: LucideIcon;
    flip: () => void;
  }> = [
    {
      id: "fixed-edge-width",
      on: view.fixedEdgeWidth,
      label: "Fixed edge width",
      Icon: Minus,
      flip: () => onChange({ fixedEdgeWidth: !view.fixedEdgeWidth }),
    },
    // The two motion switches: device taste, so they write to their own store
    // and never travel with a shared plan.
    {
      id: "smooth",
      on: boardMotion.moveMotion,
      label: "Smooth movement",
      line: "Cards move smoothly instead of jumping.",
      Icon: Magnet,
      flip: () => writeBoardMotion({ moveMotion: !boardMotion.moveMotion }),
    },
    {
      id: "numbers",
      on: boardMotion.valueMotion,
      label: "Live numbers",
      line: "Numbers change smoothly.",
      Icon: Activity,
      flip: () => writeBoardMotion({ valueMotion: !boardMotion.valueMotion }),
    },
  ];

  return (
    <div ref={rootRef} className="pointer-events-auto relative flex">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className={[
          "relative z-10 flex h-8 w-8 items-center justify-center border-2 border-[var(--mc-15)]",
          open ? TOOL_FACE_ON : TOOL_FACE_OFF,
        ].join(" ")}
        title="View options"
        aria-label="View options"
      >
        <Eye className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex max-h-[calc(70*var(--ui-vh))] w-[300px] max-w-[calc(100*var(--ui-vw)-24px)] flex-col gap-1 overflow-y-auto border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
          {/* The background's paper... */}
          <div className="grid grid-cols-2 gap-1">
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
          {/* ...and its pattern, one key per choice. */}
          <div className="flex gap-1">
            {CANVAS_PATTERNS.map((pattern) => {
              const PatternIcon = CANVAS_PATTERN_ICON[pattern];
              return (
                <button
                  key={pattern}
                  type="button"
                  onClick={() => onChange({ canvasPattern: pattern })}
                  title={CANVAS_PATTERN_LABEL[pattern]}
                  aria-label={`Background pattern: ${CANVAS_PATTERN_LABEL[pattern]}`}
                  aria-pressed={canvasPattern === pattern}
                  className={[
                    "flex h-9 flex-1 items-center justify-center border-2 border-[var(--mc-15)]",
                    canvasPattern === pattern ? TOOL_FACE_ON : TOOL_FACE_OFF,
                  ].join(" ")}
                >
                  <PatternIcon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
          {/* No grid or line-colour rows: the grid is always on, and colour
              by speed is the smart view's switch, bottom right. */}
          {toggles.map(({ id, on, label, line, Icon, flip }) => (
            <button
              key={id}
              type="button"
              onClick={flip}
              aria-pressed={on}
              className={[
                "flex items-start gap-2 border-2 p-2 text-left",
                on
                  ? `border-[var(--mc-good)] ${TOOL_FACE_ON}`
                  : `border-[var(--mc-15)] ${TOOL_FACE_OFF}`,
              ].join(" ")}
            >
              <Icon className="mt-[1px] h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-black uppercase">{label}</span>
                  <span
                    className={[
                      "font-mono text-[10px] font-black tracking-[1px]",
                      on ? "text-[var(--mc-good)]" : "text-[var(--mc-ink-muted)]",
                    ].join(" ")}
                  >
                    {on ? "ON" : "OFF"}
                  </span>
                </span>
                {line ? <span className="font-mono text-[11px] leading-snug opacity-80">{line}</span> : null}
              </span>
            </button>
          ))}
          {/* ARRANGE, at the foot of the sheet: its one setting, then the
              button. By default the arrange dissolves every board. */}
          <div className="mt-1 border-t-2 border-[var(--mc-15)] pt-1">
            <button
              type="button"
              onClick={arrange.onToggleKeepBoards}
              aria-pressed={arrange.keepBoards}
              className={[
                "flex w-full items-start gap-2 border-2 p-2 text-left",
                arrange.keepBoards
                  ? `border-[var(--mc-good)] ${TOOL_FACE_ON}`
                  : `border-[var(--mc-15)] ${TOOL_FACE_OFF}`,
              ].join(" ")}
            >
              <Network className="mt-[1px] h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-black uppercase">Keep boards on rearrange</span>
                  <span
                    className={[
                      "font-mono text-[10px] font-black tracking-[1px]",
                      arrange.keepBoards ? "text-[var(--mc-good)]" : "text-[var(--mc-ink-muted)]",
                    ].join(" ")}
                  >
                    {arrange.keepBoards ? "ON" : "OFF"}
                  </span>
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                arrange.onArrange({ keepBoards: arrange.keepBoards });
              }}
              className="mt-1 flex w-full items-center justify-center gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] p-2 font-mono text-[12px] font-black uppercase text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
              aria-label="Arrange the board"
            >
              <Network className="h-4 w-4" />
              Arrange
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

/**
 * THE ARRANGE LOADER: one bar across every step of the arrange, each step an
 * equal share, the steps listed under it with the current one lit, and a
 * Cancel key. Within a step the bar moves with that step's own count (search
 * trials, polish judge calls); a step with no count fills as it ends.
 */
function ArrangeLoader({
  progress,
  onCancel,
}: {
  progress: ArrangeProgress;
  onCancel: () => void;
}) {
  const steps = ARRANGE_STEPS.length;
  const within = Math.min(progress.done, progress.total) / Math.max(progress.total, 1);
  const overall = Math.min(1, (Math.min(progress.step, steps) + within) / steps);
  // Dressed like the Settings dialog. The running step's marker spins the
  // whole time the worker runs, because the bar moves only in steps; the
  // arrange runs off the main thread, so a frozen spinner means a stuck tab.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-neutral-950/40"
    >
      <div className="pointer-events-auto w-[26rem] max-w-[calc(100*var(--ui-vw)-32px)] border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--mc-15)] px-4 py-2.5">
          <h2 className="text-sm font-bold">Arranging the board</h2>
          <span className="font-mono text-sm tabular-nums text-[var(--mc-ink-muted)]">
            {Math.round(overall * 100)}%
          </span>
        </div>
        <div className="px-4 py-3">
          <div className="flex h-3 w-full gap-[3px] border-2 border-[var(--mc-15)] bg-[var(--mc-25)] p-[2px]">
            {ARRANGE_STEPS.map((step, index) => {
              const fill = index < progress.step ? 1 : index === progress.step ? within : 0;
              return (
                <div key={step.key} className="h-full flex-1 overflow-hidden bg-[var(--mc-36)]">
                  <div
                    className="h-full bg-[var(--mc-good)] transition-[width] duration-150"
                    style={{ width: `${Math.round(fill * 100)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <ol className="mt-3 flex flex-col divide-y divide-[var(--mc-36)]">
            {ARRANGE_STEPS.map((step, index) => {
              const state = index < progress.step ? "done" : index === progress.step ? "now" : "next";
              return (
                <li
                  key={step.key}
                  className={[
                    "flex min-h-8 items-center gap-2 py-1 font-mono text-[12px] uppercase",
                    state === "now"
                      ? "font-black text-[var(--mc-ink)]"
                      : state === "done"
                        ? "text-[var(--mc-ink-muted)]"
                        : "text-[var(--mc-ink-muted)] opacity-50",
                  ].join(" ")}
                >
                  {state === "now" ? (
                    <LoaderCircle
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--mc-good)]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={[
                        "inline-block h-3 w-3 shrink-0 border-2 border-[var(--mc-15)]",
                        state === "done" ? "bg-[var(--mc-good)]" : "bg-[var(--mc-36)]",
                      ].join(" ")}
                    />
                  )}
                  <span>{step.label}</span>
                  {state === "now" && progress.stage !== step.label ? (
                    <span className="ml-auto truncate text-[11px] font-normal normal-case text-[var(--mc-ink-muted)]">
                      {progress.stage}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--mc-15)] px-4 py-2.5">
          <span className="text-xs text-[var(--mc-ink-muted)]">Every move is checked against the real wires.</span>
          <button
            type="button"
            onClick={onCancel}
            className={`h-7 border-2 border-[var(--mc-15)] px-3 font-mono text-[12px] font-black uppercase ${TOOL_FACE_OFF}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// A browser preference, not part of the plan: two people sharing a setup
// each keep their own habit.
const ARRANGE_KEEP_BOARDS_KEY = "gtnh-factory-flow.arrange-keep-boards.v1";

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
  view,
  onViewChange,
  onAutoArrange,
  folded,
  openGroup,
  onToggleGroup,
  shiftedDown,
}: {
  paintMode?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
  activeColorTag: FactoryNodeColorTag;
  onColorSelect: (tag: FactoryNodeColorTag) => void;
  annotationTool?: BoardDrawTool;
  onAnnotationToolChange: (tool: BoardDrawTool | undefined) => void;
  onPlaceImage: (file: File) => Promise<void>;
  isDeleteMode: boolean;
  onDeleteModeChange: (enabled: boolean) => void;
  /** The view menu rides this row's corner slot; see BoardViewMenu. */
  view: BoardView;
  onViewChange: (patch: Partial<BoardView>) => void;
  /** Runs the arrange; the fold-out's setting rides along per press. */
  onAutoArrange: (options: { keepBoards: boolean }) => void;
  folded: boolean;
  openGroup?: ToolGroupId;
  onToggleGroup: (group: ToolGroupId | undefined) => void;
  shiftedDown: boolean;
}) {
  const activeColor = GT_NODE_COLORS[activeColorTag];
  // A plan board's markup is the sticky note (right-click the board): no box, zone, arrow, text or image tools.
  const planMode = useFactoryStore((state) => state.project.planMode === true);
  // Every fold-out on this row opens on CLICK (see useFoldoutDismiss). The
  // draw tools live under ONE slot: the menu holds them all with their names;
  // the face opens it, or cancels when a tool is armed.
  const [isDrawMenuOpen, setDrawMenuOpen] = useState(false);
  const drawRef = useRef<HTMLDivElement | null>(null);
  const closeDrawMenu = useCallback(() => setDrawMenuOpen(false), []);
  useFoldoutDismiss(isDrawMenuOpen, drawRef, closeDrawMenu);
  // The view sheet's open state lives here so the whole row can lift its z
  // while it is out, as it does for the draw menu.
  const [isViewMenuOpen, setViewMenuOpen] = useState(false);
  // The arrange setting, remembered per browser; the default dissolves every
  // board.
  const [keepBoards, setKeepBoards] = useState(() => {
    try {
      return localStorage.getItem(ARRANGE_KEEP_BOARDS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const onToggleKeepBoards = useCallback(() => {
    setKeepBoards((was) => {
      try {
        localStorage.setItem(ARRANGE_KEEP_BOARDS_KEY, was ? "0" : "1");
      } catch {
        // Private windows without storage still get the toggle for the session.
      }
      return !was;
    });
  }, []);

  // The bin, last on the right and on a plate of its own: it takes things
  // OFF the board, so it stands past every tool that puts things on. Outside
  // the fold group until the board is too narrow even for the folded row.
  const binTray = (
    <>
      <ToolTray>
        <button
          type="button"
          onClick={() => onDeleteModeChange(!isDeleteMode)}
          data-help-anchor="paint"
          className={[
            "pointer-events-auto relative z-10 flex h-8 w-8 items-center justify-center border-2 border-[var(--mc-15)]",
            isDeleteMode ? TOOL_FACE_ON : TOOL_FACE_OFF,
          ].join(" ")}
          title={isDeleteMode ? "Stop deleting" : "Delete tool"}
          aria-label={isDeleteMode ? "Stop deleting" : "Delete tool"}
        >
          {/* The pressed face says "on"; the red icon still says what is armed. */}
          <Trash2 className={isDeleteMode ? "h-4 w-4 text-red-500" : "h-4 w-4"} />
        </button>
      </ToolTray>
    </>
  );

  // The pencil and the view options share the last plate before the bin;
  // both fold under the trigger on a narrow board or a phone.
  const viewTray = (
    <>
        <ToolTray helpAnchor="view">
          {/* THE PENCIL: every way of marking the board in one drop-down (the
              annotation tools, paint with its colours, an image). The key is
              pressed while a tool or paint is armed, and a click cancels it. */}
          <div ref={drawRef} className="relative flex items-start">
            <div
              className={[
                "absolute right-0 top-[calc(100%+10px)] flex w-max flex-col gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] transition-[opacity,transform] duration-100",
                isDrawMenuOpen
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0",
              ].join(" ")}
            >
              {ANNOTATION_TOOLS.filter(({ kind }) => !planMode || kind === "board").map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    onAnnotationToolChange(kind);
                    setDrawMenuOpen(false);
                  }}
                  aria-pressed={annotationTool === kind}
                  className={[
                    "flex items-center gap-2 border-2 p-1 pr-2 text-left",
                    annotationTool === kind
                      ? "border-white bg-[var(--mc-85)] text-[var(--mc-ink)] ring-2 ring-cyan-300"
                      : "border-[var(--mc-15)] bg-[var(--mc-49)] text-white hover:bg-[var(--mc-61)]",
                  ].join(" ")}
                >
                  <span className="flex h-7 w-7 items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="whitespace-nowrap font-mono text-[11px] font-semibold">
                    {label}
                  </span>
                </button>
              ))}
              <div className="my-0.5 border-t-2 border-[var(--mc-15)]" />
              {/* Paint: the row arms the brush in the current colour; the
                  swatches under it pick the colour AND arm it, the eraser
                  arms erase. */}
              <button
                type="button"
                onClick={() => {
                  onPaintModeChange(paintMode !== undefined ? undefined : activeColorTag);
                  setDrawMenuOpen(false);
                }}
                aria-pressed={paintMode !== undefined}
                className={[
                  "flex items-center gap-2 border-2 p-1 pr-2 text-left",
                  paintMode !== undefined
                    ? "border-white bg-[var(--mc-85)] text-[var(--mc-ink)] ring-2 ring-cyan-300"
                    : "border-[var(--mc-15)] bg-[var(--mc-49)] text-white hover:bg-[var(--mc-61)]",
                ].join(" ")}
              >
                <span className="flex h-7 w-7 items-center justify-center">
                  {paintMode === null ? <X className="h-4 w-4" /> : <Paintbrush className="h-4 w-4" />}
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] font-semibold">
                  {paintMode === null ? "Erasing colours" : "Paint cards"}
                </span>
                <span
                  aria-hidden
                  className="ml-auto h-4 w-4 border-2 border-[var(--mc-15)] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
                  style={{ backgroundColor: activeColor.swatch }}
                />
              </button>
              <div className="grid grid-cols-9 gap-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    onPaintModeChange(null);
                    setDrawMenuOpen(false);
                  }}
                  className={[
                    "flex h-6 w-6 items-center justify-center border-2 bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]",
                    paintMode === null ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
                  ].join(" ")}
                  title="Erase colours"
                  aria-label="Erase colours"
                >
                  <X className="h-3 w-3" />
                </button>
                {GT_NODE_COLOR_PALETTE.map((entry) => (
                  <button
                    key={entry.tag}
                    type="button"
                    onClick={() => {
                      onColorSelect(entry.tag);
                      onPaintModeChange(entry.tag);
                      setDrawMenuOpen(false);
                    }}
                    className={[
                      "h-6 w-6 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
                      activeColorTag === entry.tag && paintMode !== null
                        ? "border-white ring-2 ring-cyan-300"
                        : "border-[var(--mc-15)]",
                    ].join(" ")}
                    style={{ backgroundColor: entry.color.swatch }}
                    title={`Paint ${entry.tag}`}
                    aria-label={`Paint ${entry.tag}`}
                  />
                ))}
              </div>
              {planMode ? null : (
                <>
                  <div className="my-0.5 border-t-2 border-[var(--mc-15)]" />
                  <AddImageButton
                    onPlaceImage={async (file) => {
                      setDrawMenuOpen(false);
                      await onPlaceImage(file);
                    }}
                  />
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (annotationTool !== undefined || paintMode !== undefined) {
                  onAnnotationToolChange(undefined);
                  onPaintModeChange(undefined);
                  setDrawMenuOpen(false);
                  return;
                }
                setDrawMenuOpen((was) => !was);
              }}
              aria-expanded={isDrawMenuOpen}
              data-help-anchor="paint"
              className={[
                "pointer-events-auto relative z-10 flex h-8 w-8 items-center justify-center border-2 border-[var(--mc-15)]",
                annotationTool !== undefined || paintMode !== undefined ? TOOL_FACE_ON : TOOL_FACE_OFF,
              ].join(" ")}
              title={annotationTool !== undefined || paintMode !== undefined ? "Stop" : "Markup"}
              aria-label={annotationTool !== undefined || paintMode !== undefined ? "Stop marking up" : "Markup tools"}
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
              <BoardViewMenu
            view={view}
            onChange={onViewChange}
            open={isViewMenuOpen}
            onOpenChange={setViewMenuOpen}
            arrange={{ keepBoards, onToggleKeepBoards, onArrange: onAutoArrange }}
          />
        </ToolTray>
    </>
  );


  return (
    <>
    <div
      data-board-toolbar
      className={[
        "nodrag pointer-events-none absolute right-[var(--toolbar-inset,0.75rem)] flex items-start gap-[0.4rem]",
        shiftedDown ? "top-14" : "top-3",
        // An open fold-out hangs below the row and can cross another toolbar,
        // which at the same z and later in the DOM would paint over it and
        // take its clicks. The row lifts while any of its fold-outs is out.
        isDrawMenuOpen || isViewMenuOpen
          ? "z-40"
          : "z-20",
      ].join(" ")}
    >
      <ToolGroup
        id="paint"
        folded={folded}
        openGroup={openGroup}
        onToggle={onToggleGroup}
        icon={Pencil}
        label="markup and view tools"
        side="right"
      >
      {viewTray}
      {binTray}
      </ToolGroup>
    </div>
    </>
  );
});

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
  // Waypoint dot dragging: a local draft while the pointer is down, committed
  // to the store (snapped to the grid) on release, so no board-wide re-solve
  // runs per pointer frame.
  const [draftWaypoints, setDraftWaypoints] = useState<
    Array<{ x: number; y: number }> | undefined
  >(undefined);
  const waypointDragRef = useRef<{ pointerId: number; index: number } | undefined>(undefined);
  // Double-press detection for removing a dot. A native dblclick never
  // arrives here: the first press starts a pointer-captured drag and the
  // commit re-renders the circle out from under the second click.
  const waypointPressRef = useRef<{ index: number; time: number } | undefined>(undefined);
  // The board's single detail level, not a zoom threshold of its own: nodes
  // and lines must switch together. Subscribed rather than selected because
  // the level is hysteretic (a React Flow selector must be pure over store
  // state), and it fires only when the level flips. Kept as two statements: a
  // hook call nested inside another call makes the React Compiler give up on
  // memoizing this, the hottest component on the board.
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
  // The stroke colour is derived HERE, not read from `style.stroke`, so the
  // speed ramp must be applied at the point of use. It is a GLANCE-step
  // reading, like the card wash: zoomed in, the wire keeps its resource colour.
  const flowRate = data?.flowRate;
  // A power wire is ALWAYS the POWER button's amber - never the resource
  // color pipeline's saturate/brighten pass, never the glance flow ramp.
  const isPowerEdge = data?.resource?.kind === "power";
  const edgeColor = isPowerEdge
    ? "#fbbf24"
    : flowRate?.color === true && boardDetailLevel === NODE_DETAIL_GLANCE
      ? flowRampColor(flowRate.heat)
      : resolvedResourceColor;
  const arrowFill = brightenHexColor(edgeColor, 0.55);
  // The board's motion switches. Move motion glides this wire onto a new
  // route; value motion eases its thickness and dash speed after the solver.
  const { moveMotion, valueMotion } = useBoardMotion();
  // Likewise the width: the published flow width wins for every line; the
  // style.strokeWidth branches below apply only without it.
  const flowWidthTarget =
    flowRate?.thickness === true
      ? drawnStrokeWidth(Number(style?.strokeWidth ?? FLOW_MODE_MIN_WIDTH))
      : undefined;
  // Eased, so a solver change reads as the pipe swelling. Only the volume
  // width tweens: hover thickening stays instant, or it reads as a miss.
  const flowWidthRaw = useMotionValue(
    flowWidthTarget ?? FLOW_MODE_MIN_WIDTH,
    valueMotion && flowWidthTarget !== undefined,
  );
  // Quantised to quarter pixels: the tween re-renders this every frame for a
  // second after each solve, and at quarter-pixel steps most frames reuse
  // the previous hop path via the getDirectEdgePath memo.
  const flowWidthShown = Math.round(flowWidthRaw * 4) / 4;
  const flowWidth = flowWidthTarget === undefined ? undefined : flowWidthShown;
  // Dash geometry scales with the stroke so the marks read the same on a hair
  // line and on a fat pipe.
  const pulseStroke = flowWidth ?? Number(style?.strokeWidth ?? 3);
  const pulseDash = Math.round(Math.max(5, pulseStroke * 0.9));
  const pulseGap = Math.round(Math.max(10, pulseStroke * 1.9));
  // Speed is a PIXELS-PER-SECOND velocity from volume, converted to a duration
  // for this line's dash period; a fixed duration would make fat lines look
  // faster, since one period is longer on them.
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
  // The width this line draws at, resolved once so casing and stroke agree.
  const coreStrokeWidth =
    flowWidth !== undefined
      ? flowWidth + (isHighlighted ? 2 : 0)
      : isHighlighted
        ? 9
        : data?.bundle?.role === "primary"
          ? Math.max(Number(style?.strokeWidth ?? 3.1) + 0.6, 3.7)
          : Number(style?.strokeWidth ?? 3.1);
  // Mid-drag, an edge whose endpoint node is moving draws its LAST solved
  // route, never a pointer-chasing guess. On a small board the live-drag solve
  // refreshes it a few times a second; on a big board it stays the pre-drag
  // route until the drop re-signs the solve.
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
  // Ratio percentages use the ordinary triangles as their canvas controls,
  // including in pulse mode. Other wires use dashes or arrows, never both.
  const showArrowHead =
    (flowRate?.pulse !== true || (data?.ratio && hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS))) &&
    (isHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_ARROWS));
  // Every wire routes individually through the board-wide grid solve; its
  // lane sharing makes a fan-out ride as one ribbon. No rate labels: the port
  // chips carry the numbers.
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
    // Always the solved route (see shouldUsePreciseRouting). The simple-L
    // fallback inside only covers a brand-new wire the solve has not seen.
    useSmartRouting: true,
    strokeWidth: coreStrokeWidth,
  });
  // The route as DRAWN this frame: the router's line once settled, a morph
  // between old and new lines for a beat after a re-solve (a plain polyline;
  // hop bumps land with the final frame). Capped by wire count: a board-wide
  // morph re-renders every edge per frame, the O(edges)-per-frame bill
  // CLAUDE.md forbids, so big boards snap. A switch between the
  // port-row fallback and a real route also snaps rather than sliding the
  // wire out of a dock it never uses.
  const wasSolvedRef = useRef(true);
  const routeSourceChanged = wasSolvedRef.current !== Boolean(routedEdge.solved);
  wasSolvedRef.current = Boolean(routedEdge.solved);
  const liveRoute = useMotionRoute(
    routedEdge.points,
    routedEdge.path,
    moveMotion && !routeSourceChanged && publishedGridRouteEdges.length <= 300,
  );
  // LIGHTNING. A power wire draws JAGGED: the router's route, zigzagged
  // after the fact so the router, the lanes and the hit-testing all still
  // see the straight line. Power edges are few by construction (only
  // generators make EU), so the extra path build costs nothing board-wide.
  const lightningPath = useMemo(
    () => (isPowerEdge && liveRoute.points.length >= 2 ? zigzagSvgPath(liveRoute.points) : undefined),
    [isPowerEdge, liveRoute.points],
  );
  const drawnPath = lightningPath ?? liveRoute.path;
  // Mid-morph the line is a plain polyline with no bumps, so nothing to avoid.
  const routeArrows = showArrowHead
    ? getRouteArrows(
        liveRoute.points,
        coreStrokeWidth,
        isGlobalView,
        liveRoute.morphing ? undefined : routedEdge.hopSpans,
      )
    : [];
  const ratioLabels = data?.ratio && hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS) ? labelRatioArrows(routeArrows, getRatioLabelsForEdge(id).flatMap((label) => {
    const point = getPointAtPolylineRatio(liveRoute.points, label.ratio);
    return point ? [{ ...label, point }] : [];
  })) : [];
  // The dots the user has pinned, or the draft while one is mid-drag. Only
  // the DOT follows the pointer; the wire takes its real route on release.
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
  // The whole line is a hover surface, stopping short of the ports so it can
  // never steal the pointer-down that starts a wire drag (edges hit-test above
  // nodes). Gone below the labels detail level: zoomed out it would only be
  // hit by accident, and costs a hit-test per path on every mouse move.
  const hoverTrimmedPoints =
    !hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS)
      ? undefined
      : trimPolylineEnds(routedEdge.points, 26);
  // Checklist clicks cannot start a wire, so checklist mode uses the full
  // drawn path at every zoom instead (the 26 px trim erases short wires).
  const checklistMode = useFactoryStore((state) => state.checklistMode);
  const hoverPathD = !checklistMode && hoverTrimmedPoints ? pointsToSvgPath(hoverTrimmedPoints) : undefined;

  // Hand this line's dashes to the board's pulse canvas (see edge-pulse.ts).
  // Published after commit (a side-effecting registration) and dropped on
  // unmount so a culled or deleted edge leaves no ghost. Off below the pulse
  // detail level, and on power wires: the dashes ride the straight route and
  // would cut across the zigzag.
  const pulseActive =
    flowRate?.pulse === true &&
    !isPowerEdge &&
    Boolean(liveRoute.path) &&
    hasEdgeDetail(detailLevel, EDGE_DETAIL_PULSE);
  // A LAYOUT effect: the pulse canvas draws from this registration in its own
  // rAF loop, and a passive effect flushes after paint, so each morph frame's
  // dashes would trail the SVG wire by a frame.
  const livePath = liveRoute.path;
  const livePoints = liveRoute.points;
  const liveMorphing = liveRoute.morphing;
  useLayoutEffect(() => {
    if (!pulseActive) {
      retractEdgePulse(id);
      return;
    }

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of livePoints) {
      if (point.x < left) left = point.x;
      if (point.x > right) right = point.x;
      if (point.y < top) top = point.y;
      if (point.y > bottom) bottom = point.y;
    }
    // Hops bulge off the polyline; the cull box has to cover them or a line
    // would wink out a fraction early at the edge of the screen.
    const margin = EDGE_HOP_MAX_RADIUS + pulseStroke;
    const publish = () =>
      publishEdgePulse(id, {
        path: livePath,
        width: Math.max(2, pulseStroke * 0.38),
        dash: pulseDash,
        gap: pulseGap,
        velocity: pulseVelocity,
        left: left - margin,
        right: right + margin,
        top: top - margin,
        bottom: bottom + margin,
        // A morph frame's path is one-of-a-kind; keep it out of the Path2D cache.
        transient: liveMorphing,
      });
    // During a timelapse draw-in, publish the dashes only once the stroke has
    // landed: the canvas paints them whole, which would give the route away.
    if (data?.timelapseDraw) {
      const speed = getBoardTimelapseSnapshot()?.speed ?? 1;
      const timer = window.setTimeout(
        publish,
        getBoardTimelapseWireDrawMs() / speed + 150,
      );
      return () => window.clearTimeout(timer);
    }
    publish();
  }, [
    id,
    pulseActive,
    livePath,
    livePoints,
    liveMorphing,
    pulseStroke,
    pulseDash,
    pulseGap,
    pulseVelocity,
    data?.timelapseDraw,
  ]);
  // Where this edge's waypoint dots sit, for the dash canvas (painted above
  // the SVG) to punch out. A layout effect for the same reason as the pulse.
  useLayoutEffect(() => {
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
  }, [id, activeWaypoints, coreStrokeWidth]);
  useEffect(() => () => {
    retractEdgePulse(id);
    retractEdgeWaypointDots(id);
  }, [id]);

  return (
    <>
      {ratioLabels.map((label) => (
        <EdgeLabelRenderer key={label.key}>
          <RatioWireLabelControl edgeId={id} label={label} shares={data?.ratio ?? {}} arrowFill={arrowFill} />
        </EdgeLabelRenderer>
      ))}
      {checklistMode && liveRoute.path ? (
        <ViewportPortal>
          {/* Only the invisible hit target clears port hit boxes. The visible
              wire keeps its usual depth behind machines and drawers. */}
          <svg width={1} height={1} aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ zIndex: 30 }}>
            <path data-checklist-edge={id} d={liveRoute.path} fill="none" stroke="transparent"
              strokeWidth={Math.max(14, coreStrokeWidth + 6)} style={{ pointerEvents: "stroke" }} />
          </svg>
        </ViewportPortal>
      ) : null}
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
            path={drawnPath}
            interactionWidth={0}
            // Normalized during a timelapse so the draw-in covers any route
            // exactly; see ResourceEdgeData.timelapseDraw.
            pathLength={data?.timelapseDraw ? 1 : undefined}
            style={{
              // Highlighted, the casing IS the solid part of the glow: the
              // same gold line the cards outline in, 3px per side to match
              // their outline, with the resource colour still in the core.
              // A power wire's casing runs a shade warm - a whisper of
              // orange at the line's edges instead of the neutral dark.
              stroke: isHighlighted ? "var(--glow-line)" : isPowerEdge ? "#452c05" : "#111827",
              // No inline dash while a timelapse draws this wire: an inline
              // strokeDasharray outranks the draw-in's normalized dash.
              strokeDasharray: data?.timelapseDraw
                ? undefined
                : flowRate?.idle
                  ? idleDots(coreStrokeWidth)
                  : isGlobalView && isEdgeStarved(data)
                    ? "2 8"
                    : style?.strokeDasharray,
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
            path={drawnPath}
            interactionWidth={0}
            pathLength={data?.timelapseDraw ? 1 : undefined}
            style={{
              ...style,
              stroke: edgeColor,
              strokeDasharray: data?.timelapseDraw
                ? undefined
                : flowRate?.idle
                  ? idleDots(coreStrokeWidth)
                  : isGlobalView && isEdgeStarved(data)
                    ? "2 8"
                    : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              // Zoom never changes line opacity: it changes how much of the
              // board you see, not how the board looks.
              strokeOpacity: isHighlighted ? 1 : style?.strokeOpacity,
              strokeWidth: coreStrokeWidth,
              // A power wire hums: a static gold glow (no animation, no
              // repaint bill), stronger when highlighted like any wire.
              filter: isHighlighted
                ? "drop-shadow(0 0 6px var(--glow-halo))"
                : isPowerEdge
                  ? "drop-shadow(0 0 4px rgba(251,191,36,0.5))"
                  : undefined,
              // The drawn stroke never takes pointer events: hover and click go
              // through the trimmed hover path below, which stops short of the
              // port handles.
              pointerEvents: "none",
            }}
          />
          {/* Direction dashes, when on, are drawn on the board's pulse canvas
              (edge-pulse.ts), never as an animated path here: an animated
              stroke-dashoffset per edge repaints the whole board every frame. */}
        </>
      )}
      {/* A wire going round a dead ring, breathing on the cards' clock. The
          ONE animated path allowed on the edge layer: a ring is a handful of
          wires, so the damage rect is the ring, not the board. Opacity only,
          so nothing reroutes. */}
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
      {/* The clog lock's wires, same bargain in the clog family's blue: one
          breathing overlay, opacity only, damage rect the size of the jam. */}
      {data?.isClogLock ? (
        <path
          className="clog-lock-wire"
          d={liveRoute.path}
          fill="none"
          stroke="#6fb2d6"
          strokeWidth={coreStrokeWidth + 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {/* A plan board's ring along this wire: lit in its tone, steady (clean.css `.cc-loop-wire`). */}
      {data?.planLoop ? (
        <path
          className="cc-loop-wire"
          data-loop={data.planLoop}
          d={liveRoute.path}
          fill="none"
          strokeWidth={coreStrokeWidth + 4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {/* Direction arrows: FILLED heads in the wire's colour lifted brighter,
          sized to the stroke, one near each end and one every few cells along
          a long run, never across a corner. Double size at a glance. */}
      {showArrowHead
        ? routeArrows.map((arrow, index) => (
            <polygon
              key={index}
              data-resource-edge-arrow={id}
              points={ratioLabels.find((label) => label.arrowIndex === index)?.polygon ?? arrow}
              fill={arrowFill}
              stroke={darkenHexColor(edgeColor, 0.6)}
              strokeWidth={isGlobalView ? 2.5 : 1.5}
              strokeLinejoin="round"
              opacity={isEdgeStarved(data) ? 0.8 : 1}
              style={{
                pointerEvents: "none",
                // The outline is a DEEP shade of the wire's colour, never
                // black (black reads as spots where it crosses the pipe); a
                // soft shadow lifts the head off pipe and paper alike.
                filter: isHighlighted
                  ? "drop-shadow(0 0 4px var(--glow-halo))"
                  : "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.75))",
              }}
            />
          ))
        : null}
      {hoverPathD ? (
        <path
          d={hoverPathD}
          fill="none"
          stroke="transparent"
          // Must cover the line it belongs to: at least 14px for a thin wire,
          // the whole width plus a margin for a fat pipe.
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
                // The dot moves cell to cell on the grid, exactly where it will
                // land, and never onto a card or its wire margin: over one it
                // rides the nearest legal cell.
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
                  // Every dot commits to the nearest legal grid corner (which
                  // also heals old plans with dots inside cards). Order is
                  // kept: the first dot made is the first stop, wherever it is
                  // dragged; never re-sort by position.
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
  // The ghost overlay follows this exact point; see lastConnectionFlowPoint.
  lastConnectionFlowPoint = { x: toX, y: toY };
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
  // What THIS release would do, told by the pipe. A snapped end will connect,
  // whatever React Flow thinks (it reports "valid" only on a handle). Off
  // every card the pipe is green-dashed when release spawns a drawer,
  // red-dashed when it does nothing. Over a refusing card it goes red,
  // agreeing with the card's own wash.
  const overSolidCard = !snap && isPointOverSolidCard(toX, toY);
  // POOL MODE: nothing connects, so the line carries no verdict (the ghost
  // and its reason card do). A faint neutral dashed thread still runs from
  // the port, or the drag reads as broken.
  if (useFactoryStore.getState().project.poolMode) {
    return (
      <g className="react-flow__connection">
        <path
          d={edgePath}
          fill="none"
          stroke="#c8ced8"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="6 8"
          opacity={0.22}
        />
      </g>
    );
  }
  const verdict = snap
    ? "connect"
    : connectionStatus === "invalid" || overSolidCard
      ? "refuse"
      : voidDropWillSpawn
        ? "spawn"
        : "dead";
  // Snapped is GREEN and solid with white marching dots toward the caught
  // slot; a spawnable void is green dashed; refusals and dead voids are red.
  const deleting = verdict === "connect" && snapWillDeleteEdge;
  // A snap whose release would DELETE the existing wire draws no pipe at all:
  // nothing new happens, and the doomed wire's own flashing says it.
  if (deleting) {
    return <g className="react-flow__connection" />;
  }
  // The plan-mode board draws the mod's line: 3 px, three orthogonal segments.
  if (useFactoryStore.getState().project.planMode) {
    return (
      <CleanVerdictLine
        from={{ x: fromX, y: fromY, position: fromPosition }}
        to={{ x: endX, y: endY }}
        pointer={{ x: toX, y: toY }}
        verdict={verdict}
      />
    );
  }
  const color = verdict === "connect" ? "#22c55e" : verdict === "spawn" ? "#22c55e" : "#ef4444";
  const dashed = verdict === "spawn" || verdict === "dead";

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
        strokeDasharray={dashed ? "10 8" : undefined}
        opacity={0.98}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
      {verdict === "connect" ? (
        <path
          className="connection-march"
          d={edgePath}
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 10"
          opacity={0.9}
        />
      ) : null}
      {/* A hollow end: release will make a drawer here. Solid otherwise. */}
      <circle
        cx={endX}
        cy={endY}
        r={6}
        fill={verdict === "spawn" ? "none" : color}
        stroke={verdict === "spawn" ? color : "#052e36"}
        strokeWidth={2}
      />
      {/* Over the void, the HTML overlay (VoidDropGhost) carries the rest:
          the drawer preview when release spawns one, the reason card when
          it does nothing. The line only signals. */}
    </g>
  );
}

/**
 * The GHOST of the drawer a void release would spawn: real footprint and
 * icon, greyed, riding the pointer. Active only while a wire is out (the
 * wiring listener re-renders this component, never the board), positioned
 * imperatively per frame, and hidden over a card or a snapping slot.
 */
function VoidDropGhost() {
  const [wiring, setWiring] = useState(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const lastSnapKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => onWiringConnectionChange(setWiring), []);

  const ghostStorage = wiring ? voidDropGhostStorage : undefined;
  const willSpawn = wiring && voidDropWillSpawn;

  useEffect(() => {
    if (!ghostStorage) {
      return;
    }
    let frame: number;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const ghost = ghostRef.current;
      const point = lastConnectionFlowPoint;
      if (!ghost || !point) {
        return;
      }
      const snap = getConnectionSnap(point.x, point.y);
      // The grab is audible on the TRANSITION into a snap (or onto a
      // different slot), never per frame. The slot's fixed endpoint is the
      // identity - getConnectionSnap returns no ids.
      const snapKey = snap ? `${snap.point.x}|${snap.point.y}` : undefined;
      if (snapKey !== lastSnapKeyRef.current) {
        if (snapKey) {
          playBoardSound("snap");
        }
        // Would this release DELETE the wire that is already here? Same
        // ends and handles the release will use; the doomed wire wears
        // the warning and the line drops its green.
        const dragged = liveDraggedResource;
        const target = snap?.target;
        let doomed: FactoryEdge | undefined;
        if (dragged && target && target.nodeId !== dragged.nodeId) {
          const draggedIsSource = target.side === "input";
          const draggedHandleId = dragged.bidirectional
            ? makeResourceHandleId(draggedIsSource ? "output" : "input", {
                kind: dragged.kind,
                id: dragged.id,
              })
            : dragged.handleId;
          const sourceEnd = draggedIsSource
            ? { nodeId: dragged.nodeId, handleId: draggedHandleId }
            : { nodeId: target.nodeId, handleId: target.handleId };
          const targetEnd = draggedIsSource
            ? { nodeId: target.nodeId, handleId: target.handleId }
            : { nodeId: dragged.nodeId, handleId: draggedHandleId };
          doomed = findToggleDuplicateEdge(
            useFactoryStore.getState().project,
            sourceEnd.nodeId,
            targetEnd.nodeId,
            {
              kind: dragged.kind,
              id: dragged.id,
              displayName: dragged.displayName,
              sourceHandle: sourceEnd.handleId,
              targetHandle: targetEnd.handleId,
            },
          );
        }
        snapWillDeleteEdge = Boolean(doomed);
        paintDoomedEdge(doomed?.id);
      }
      lastSnapKeyRef.current = snapKey;
      // Pool mode: the ghost shows everywhere, since nothing else can
      // happen on release wherever the pointer is.
      const poolMode = useFactoryStore.getState().project.poolMode === true;
      const elsewhere = !poolMode && (snap || isPointOverSolidCard(point.x, point.y));
      ghost.style.display = elsewhere ? "none" : "";
      // Both cards sit CENTRED on the pointer: that is exactly where a
      // release puts the drawer.
      ghost.style.transform = `translate(${point.x - STORAGE_NODE_WIDTH / 2}px, ${point.y - STORAGE_NODE_HEIGHT / 2}px)`;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      lastSnapKeyRef.current = undefined;
      lastConnectionFlowPoint = undefined;
    };
  }, [ghostStorage, willSpawn]);

  if (!ghostStorage) {
    return null;
  }

  return (
    <ViewportPortal>
      <div
        ref={ghostRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{
          // Above the connection line: the pipe runs UNDER the ghost, as a
          // docked wire does behind the real drawer.
          zIndex: 1500,
          width: STORAGE_NODE_WIDTH,
          height: STORAGE_NODE_HEIGHT,
          display: "none",
        }}
      >
        {willSpawn ? (
          <>
            {/* An opaque backing in the tile's silhouette, so the ghost
                occludes the wire while the face above it reads as faded. */}
            <span
              aria-hidden
              data-storage-shape={voidDropGhostRole}
              className="storage-shape absolute inset-0"
              style={{ background: "#0d1117" }}
            />
            <div
              className="relative h-full w-full"
              style={{
                // The real tile at partial presence: not existing yet.
                opacity: 0.62,
              }}
            >
              {useFactoryStore.getState().project.planMode === true && ghostStorage.kind !== "power" ? (<CleanDrawerFace storage={ghostStorage} role={voidDropGhostRole} />) : (<StorageTileFace storage={ghostStorage} role={voidDropGhostRole} />)}
            </div>
          </>
        ) : (
          // The reason card for a dead release: the drawer's footprint,
          // dashed, opaque so the wire runs underneath the words.
          <div
            className="flex h-full w-full items-center justify-center rounded-[4px] border-2 border-dashed border-[#ef4444] p-1.5 text-center text-[11px] font-bold leading-tight text-[#ff9d9d]"
            style={{ background: "#0d1117" }}
          >
            {voidDropReason}
          </div>
        )}
      </div>
    </ViewportPortal>
  );
}

/** Flow-space hit test against the published card set (no DOM per frame). */
function isPointOverSolidCard(x: number, y: number): boolean {
  for (const id of publishedSolidCardIds) {
    const geometry = publishedBoardGeometryById.get(id);
    if (
      geometry &&
      x >= geometry.x &&
      x <= geometry.x + geometry.width &&
      y >= geometry.y &&
      y <= geometry.y + geometry.height
    ) {
      return true;
    }
  }
  return false;
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
    // fans out along it. Several wires into one drawer fan out too.
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

    // Drawers spread their dock points wider, to read as separate wires.
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

  return getRepeatedOutputHandleIds(
    project,
    edge.source,
    { kind: edge.resourceKind, id: edge.resourceId },
    edge.sourceHandle,
  );
}

function getRepeatedOutputHandleIds(
  project: FactoryProject,
  sourceNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
  /** The dragged handle: it names which section of a shared machine the slots belong to. */
  sourceHandle?: string,
) {
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  if (sourceStorage) {
    return [];
  }

  const card = project.nodes.find((node) => node.id === sourceNodeId);
  const section = splitSectionHandleId(sourceHandle).section;
  const sourceNode = card ? sectionNodeView(card, section) : undefined;
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  if (!sourceRecipe) {
    return [];
  }

  return sourceRecipe.outputs
    .map((output, outputIndex) =>
      output.kind === resource.kind && output.id === resource.id
        ? sectionHandleId(section, makeResourceHandleId("output", output, outputIndex))
        : undefined,
    )
    .filter((handleId): handleId is string => Boolean(handleId));
}

/**
 * Identity memo over the assembled path. Edges call getDirectEdgePath on
 * every render (morph frames, width tweens, hover), and rebuilding the hopped
 * path string is most of a render's cost. Keyed on the solve signature
 * because hop bumps read NEIGHBOUR segments: a fresh solve must rebuild even
 * a wire whose own points stood still. A hit returns the identical object,
 * which keeps downstream identity checks quiet.
 */
const directEdgePathMemo = new Map<
  string,
  {
    points: Array<{ x: number; y: number }>;
    width: number;
    routeIndex: number;
    signature: string;
    result: RoutedEdgePath;
  }
>();

/**
 * How far a wire's INK runs on past its dock into a drawer, whose shape can
 * be inset from its rectangle (a hexagon), so a wire stopping at the edge
 * would end in mid-air. Only the drawn path carries on; the route, arrows
 * and hop maths keep the real endpoint. Wires draw under the cards, so the
 * extra ink is hidden.
 */
const STORAGE_INK_OVERSHOOT = 30;

function isStorageNodeId(id: string | undefined): boolean {
  if (!id) return false;
  return useFactoryStore.getState().project.storages?.some((storage) => storage.id === id) ?? false;
}

/** The route's points with each drawer end carried on into the drawer. */
function inkPointsFor(
  points: Array<{ x: number; y: number }>,
  sourceNodeId: string | undefined,
  targetNodeId: string | undefined,
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;
  const intoSource = isStorageNodeId(sourceNodeId);
  const intoTarget = isStorageNodeId(targetNodeId);
  if (!intoSource && !intoTarget) return points;
  const out = points.slice();
  const extend = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1) return to;
    return {
      x: to.x + ((to.x - from.x) / length) * STORAGE_INK_OVERSHOOT,
      y: to.y + ((to.y - from.y) / length) * STORAGE_INK_OVERSHOOT,
    };
  };
  if (intoSource) out[0] = extend(points[1]!, points[0]!);
  if (intoTarget) out[out.length - 1] = extend(points[points.length - 2]!, points[points.length - 1]!);
  return out;
}

function getDirectEdgePath({
  edgeId,
  routeIndex,
  sourceNodeId,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
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
  // The grid solve owns every settled route; fallbacks cover wires it has
  // not routed in the current solve.
  const fresh = useSmartRouting ? getBestDirectEdgePoints({ edgeId }) : undefined;
  // No fresh route: the wire's LAST one stands in. A card is unmeasured for
  // a frame after it mounts and its wires are left out of that solve; without
  // this they would flash the port-anchored L-shape.
  const stale = fresh === undefined && useSmartRouting ? getLastDirectEdgePoints(edgeId) : undefined;
  // A wire the router has never seen (a drawer split, a heal, a paste) draws
  // the ARRANGER'S PROXY PATH between the two cards
  // (board-arrange-optimize.ts), the shape the router is about to draw. The
  // port-anchored L-shape below is the last resort, for an unmeasured card.
  const guess =
    fresh === undefined && stale === undefined && useSmartRouting
      ? proxyBetweenNodes(sourceNodeId, targetNodeId)
      : undefined;
  const points =
    fresh ??
    stale ??
    guess ??
    getSimpleOrthogonalEdgePoints({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  const solved = Boolean(fresh ?? stale);

  // Hop bumps are sized from the width this line actually draws at, so a
  // highlighted (thickened) line still clears what it crosses.
  const width = strokeWidth ?? ownStrokeWidth(edgeId);

  const memoRouteIndex = routeIndex ?? 0;
  if (edgeId) {
    const cached = directEdgePathMemo.get(edgeId);
    if (
      cached &&
      cached.points === points &&
      cached.width === width &&
      cached.routeIndex === memoRouteIndex &&
      cached.signature === gridSolveSignature
    ) {
      return cached.result;
    }
  }

  // The midpoint anchor: "somewhere on this wire" for labels and hover.
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ?? {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };

  const inkPoints = inkPointsFor(points, sourceNodeId, targetNodeId);
  const hopped = buildHoppedPath(
    inkPoints,
    collectHoppedRouteSegments(edgeId, routeIndex, points),
    width,
  );
  // The ink runs on into a drawer at either end; spans are measured along the
  // route itself, so take off whatever the ink added before the start.
  const inkLead =
    inkPoints[0] && points[0] ? Math.hypot(inkPoints[0].x - points[0].x, inkPoints[0].y - points[0].y) : 0;
  const result: RoutedEdgePath = {
    solved,
    path: hopped.path,
    hopSpans: hopped.spans.map((span) => ({ from: span.from - inkLead, to: span.to - inkLead })),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    // A pill with no room is a pill not shown: anchored over (or hard
    // against) a card, it would sit on the card instead of the wire.
    labelHidden: isPointInsideAnyMeasuredNode(labelPoint),
    points,
  };
  if (edgeId) {
    // Routes churn while dragging; without a ceiling this grows unbounded.
    if (directEdgePathMemo.size > 4000) {
      directEdgePathMemo.clear();
    }
    directEdgePathMemo.set(edgeId, {
      points,
      width,
      routeIndex: memoRouteIndex,
      signature: gridSolveSignature,
      result,
    });
  }
  return result;
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
 * The routed points for one edge, from the board-wide grid solve
 * (`grid-edge-router.ts`): one solve over every wire at once, because lane
 * sharing needs the whole picture.
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



/**
 * The shape the router is about to draw between two cards, for a wire that
 * has no route yet: the arranger's own proxy path over the measured card
 * rectangles. Undefined when either card is unmeasured.
 */
function proxyBetweenNodes(
  sourceNodeId: string | undefined,
  targetNodeId: string | undefined,
): Array<{ x: number; y: number }> | undefined {
  const source = getMeasuredNodeBoundsById(sourceNodeId);
  const target = getMeasuredNodeBoundsById(targetNodeId);
  if (!source || !target) {
    return undefined;
  }
  return proxyPath(source, target).map((point) => ({
    x: snapRouteCoord(point.x),
    y: snapRouteCoord(point.y),
  }));
}

/**
 * The last route the router gave this wire, whatever solve it belongs to.
 * Stale by definition; it stands in only while the fresh answer is missing.
 */
function getLastDirectEdgePoints(edgeId?: string): Array<{ x: number; y: number }> | undefined {
  return edgeId ? directRouteCache.get(edgeId)?.route.points : undefined;
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

/**
 * The lightning transform for power wires: each segment is subdivided and
 * interior steps are thrown a few pixels off the line, alternating sides,
 * while ENDING exactly where the route ends (ports, docks and lanes never
 * know). The first and last few pixels stay straight so the stub meets its
 * port square.
 */
function zigzagSvgPath(points: Array<{ x: number; y: number }>): string {
  const STEP = 8;
  const AMP = 4.4;
  const CALM = 8;
  const out: Array<{ x: number; y: number }> = [];
  let flip = 1;
  let strike = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    out.push(a);
    if (length < STEP * 1.5) {
      continue;
    }
    const ux = dx / length;
    const uy = dy / length;
    // Perpendicular, for the throw.
    const px = -uy;
    const py = ux;
    const first = i === 0;
    const last = i === points.length - 2;
    const from = first ? CALM : STEP * 0.5;
    const to = length - (last ? CALM : STEP * 0.5);
    for (let d = from; d < to; d += STEP) {
      // Each throw varies between about half and full amplitude,
      // DETERMINISTICALLY (a hash of the strike index, never Math.random),
      // so the bolt is identical every render and never shivers.
      strike += 1;
      const wobble = 0.55 + 0.45 * (((strike * 7919) % 13) / 12);
      out.push({
        x: a.x + ux * d + px * AMP * wobble * flip,
        y: a.y + uy * d + py * AMP * wobble * flip,
      });
      flip = -flip;
    }
  }
  const end = points[points.length - 1];
  if (end) {
    out.push(end);
  }
  return pointsToSvgPath(out);
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
 * hover-anywhere surface uses this so it never reaches the port chips.
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
 * Every line's current stroke width, by edge id, published by the board.
 * Hops are built at ROUTE time, knowing only the crossed line's id, and are
 * sized from its width, so the widths live at module scope like node bounds.
 */
const publishedEdgeStrokeWidths = new Map<string, number>();
const DEFAULT_EDGE_STROKE_WIDTH = 6;

function ownStrokeWidth(edgeId: string | undefined): number {
  return (
    (edgeId ? publishedEdgeStrokeWidths.get(edgeId) : undefined) ?? DEFAULT_EDGE_STROKE_WIDTH
  );
}

/**
 * Segments this edge should hop over: every other routed line that sits
 * BEHIND it (see compareEdgeDepth), so exactly one side of every crossing
 * bumps and it is always the side you can see. Reads the route cache; a
 * neighbour's reroute refreshes this edge on the next pass.
 */
function collectHoppedRouteSegments(
  edgeId: string | undefined,
  routeIndex: number | undefined,
  points: Array<{ x: number; y: number }>,
) {
  if (routeIndex === undefined || points.length < 2) {
    return [];
  }

  // Only a line through this route's bounding box can cross it, so ask the
  // segment index for that box. The margin covers the tallest hop bump.
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
  // width (which includes a highlight bump): the comparison must stay
  // antisymmetric, or both edges of a pair could hop, or neither.
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

// Shares and published routes are stable across camera frames. Cache the joint
// label layout, then each edge follows its live wire using the chosen fraction.
let ratioLabelInputs: { id: string; input?: number; output?: number }[] = [];
let ratioLabelInputsKey = "";
let ratioLabelLayoutKey = "";
let ratioLabelLayout = new Map<string, RatioWireLabel[]>();
function publishRatioLabelInputs(inputs: typeof ratioLabelInputs) {
  const key = JSON.stringify(inputs);
  if (key === ratioLabelInputsKey) return;
  ratioLabelInputs = inputs;
  ratioLabelInputsKey = key;
}
function getRatioLabelsForEdge(edgeId: string): RatioWireLabel[] {
  const key = `${gridSolveSignature}|${ratioLabelInputsKey}`;
  if (key !== ratioLabelLayoutKey) {
    ratioLabelLayoutKey = key;
    ratioLabelLayout = layoutRatioLabels(ratioLabelInputs.map((entry) => ({
      id: entry.id,
      points: getLastDirectEdgePoints(entry.id) ?? [],
      input: entry.input === undefined ? undefined : formatRatioShare(entry.input),
      output: entry.output === undefined ? undefined : formatRatioShare(entry.output),
    })));
  }
  return ratioLabelLayout.get(edgeId) ?? [];
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
 * The board's obstacle set, built once per layout epoch and shared by every
 * edge (per-edge sweeps are O(edges x nodes) per frame). Ordered by id, not
 * DOM order, so route scoring does not depend on React's mount order.
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
      // Same rule as the published set above: annotations and board frames
      // never block a wire.
      if (
        !id ||
        element.classList.contains("react-flow__node-annotationNode") ||
        element.classList.contains("react-flow__node-boardNode")
      ) {
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

  // Snap and geometry-sort once. Filtering a sorted list preserves its order,
  // so no edge has to re-sort the whole board.
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

  // Two lookup structures built once per epoch, so "which nodes are near me"
  // never walks the whole board per edge (O(nodes x edges) per render, which
  // CLAUDE.md forbids).
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
 * Node rects whose cell overlaps the rect, re-sorted into the sweep's
 * canonical geometry order: route scoring sums over this list, and another
 * order would give a slightly different floating-point score.
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
 * The nearest grid corner a waypoint dot may legally sit on: outside every
 * card and its one-cell wire clearance (the router could only ignore a stop
 * inside it), pushed out of the nearest side. A push can land in a
 * neighbour's margin; a few passes settle it, and a dot buried in a wall of
 * cards stays where the passes left it.
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

/**
 * Whether a label ANCHORED here would overlap some node: the margins are
 * half the label box, so this tests the box, not just the center point.
 */
function isPointInsideAnyMeasuredNode(
  point: { x: number; y: number },
  // Half the label box.
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

  // Node element first: an unmounted node skips the slot scans below. A miss
  // is deliberately not cached, so the render after the node mounts measures.
  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }
  // A card the browser is skipping has no inner boxes (every rectangle reads
  // zero); not cached either, so the next call with the card on screen measures.
  if (isCardSkipped(nodeElement)) {
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
 * A port row's centre measured from its card's TOP edge, when the board has
 * ever rendered the card. Feeds auto-arrange's straightening pass; a miss
 * (culled, never-painted card) means the pass falls back to card centres.
 */
function measuredPortOffsetY(
  nodeId: string,
  handleId: string | undefined,
  edgeSide: Position,
): number | undefined {
  const geometry = publishedBoardGeometryById.get(nodeId);
  if (!geometry) {
    return undefined;
  }
  const measured = getMeasuredSlotEndpoint({ nodeId, handleId, edgeSide });
  // Whole pixels: the measurement jitters by a fraction of a pixel between
  // paints, and the arrange must be the same function of the same board.
  return measured ? Math.round(measured.y - geometry.y) : undefined;
}

/**
 * What a card most likely measures when the board has never painted it. Only
 * auto-arrange on a freshly loaded plan sees these; measured sizes win
 * whenever they exist. Estimates run a row GENEROUS on purpose - a too-tall
 * guess costs a little air, a too-short one overlaps two cards.
 */
function estimateNodeCardSize(
  node: FactoryNode,
  recipe: Recipe | undefined,
  project: Pick<FactoryProject, "recipes">,
): { width: number; height: number } {
  if (recipe && isTrashRecipe(recipe)) {
    return { width: TRASH_NODE_WIDTH, height: TRASH_NODE_HEIGHT };
  }
  if (!recipe) {
    return { width: RECIPE_NODE_WIDTH, height: cells(14) };
  }
  // A shared machine stacks one rail block per recipe, each under a one-cell
  // rule; each section counts its own rows.
  const shared = (node.extraRecipes?.length ?? 0) > 0;
  let rails = 0;
  for (const { section, node: view } of listNodeSections(node)) {
    const sectionRecipe =
      section === 0 ? recipe : project.recipes.find((entry) => entry.id === view.recipeId);
    if (!sectionRecipe) {
      continue;
    }
    const effective = getEffectiveNodeRecipe(sectionRecipe, view);
    const rows = Math.max(1, effective.inputs.length, effective.outputs.length);
    rails += cells(2) * rows + (shared ? cells(1) : 0);
  }
  // Title row + machine strip + the port rails + footer, plus a spare row of
  // slack for a config panel. The rails block is never shorter than the
  // machine picture beside it, which sets a one-row card's height.
  return {
    width: RECIPE_NODE_WIDTH,
    height: cells(4) + Math.max(PICTURE_MIN_HEIGHT, rails) + cells(4),
  };
}

/**
 * The papers the arrange dresses boards in, in order: the board's own dark
 * canvas papers, neighbouring entries a step apart in tone.
 */
const ZONE_PAPERS: readonly string[] = BOARD_PAPER_IDS;

/**
 * Gather the whole plan into auto-arrange's terms and lay it out.
 *
 * Open boards being tidied arrange their members inside their frame, deepest
 * first (what a board takes by its left edge, what it offers by its right),
 * and the frame refits around the result; locked boards keep their interiors.
 * Then the root arranges with every board as ONE meta card at its fresh
 * size, and the router keeps foreign wires out of every frame. Wires the
 * arranged view draws lose their hand-pinned waypoints, which would only
 * fight the router on the new layout.
 */
async function computeAutoArrangement(
  baseProject: FactoryProject,
  result: ThroughputResult | undefined,
  taste: ArrangeTaste,
  options: {
    /**
     * Off (what the board always passes), a board is sealed: its interior is
     * never touched and the arrange only places the board. On, every OPEN
     * board is laid out again in place; membership, name and paper stand.
     */
    tidyBoardInteriors: boolean;
  },
  onProgress?: (progress: ArrangeProgress) => void,
): Promise<{
  moves: Array<{ id: string; position: { x: number; y: number } }>;
  wireRoutes: Array<{ id: string; waypoints: Array<{ x: number; y: number }> }>;
  resetEdgeIds: string[];
  staleInkIds: string[];
  boardSizes: Array<{ id: string; size: { width: number; height: number } }>;
  addBoards: FactoryPocket[];
  setOwners: Array<{ id: string; pocketId?: string }>;
  setBoardThemes: Array<{ id: string; theme: string }>;
}> {
  const recipesById = new Map(baseProject.recipes.map((recipe) => [recipe.id, recipe]));
  // Frames refitted by the interior passes, read by every OUTER pass so a
  // parent sizes its nested board by the frame it is about to wear.
  const refitSizes = new Map<string, { width: number; height: number }>();
  // Where each crossing wire's member landed inside its frame, keyed
  // "edgeId:boardId", measured from the frame's top edge. Outer passes read
  // it as the board card's port height, so wires between boards run straight.
  const boundaryPortY = new Map<string, number>();

  // Everything one level of one project holds, in arrange terms. Every board
  // on the level is ONE meta card: open, its window; minimized, its summary
  // card.
  const makeGatherer = (project: FactoryProject) => {
    const pockets = project.pockets ?? [];
    const parentById = new Map(pockets.map((pocket) => [pocket.id, pocket.parentPocketId]));
    const itemPocketById = new Map<string, string | undefined>();
    for (const node of project.nodes) {
      itemPocketById.set(node.id, node.pocketId);
    }
    for (const storage of project.storages ?? []) {
      itemPocketById.set(storage.id, storage.pocketId);
    }

    // The card that stands for an item at a LEVEL (the root, or one open
    // board's floor): the item itself when it sits there, else the board
    // standing between them, else undefined — the item lives elsewhere.
    const representativeAt = (
      level: string | undefined,
      itemId: string,
    ): string | undefined => {
      let owner = itemPocketById.get(itemId);
      if (owner === level) {
        return itemId;
      }
      const seen = new Set<string>();
      while (owner !== undefined && !seen.has(owner)) {
        seen.add(owner);
        const parent = parentById.get(owner);
        if (parent === level) {
          return owner;
        }
        owner = parent;
      }
      return undefined;
    };

    const minimizedCardSize = (pocketId: string) => ({
      width: RECIPE_NODE_WIDTH,
      height: pocketCardHeight(countPocketCrossings(project, pocketId)),
    });

    const gatherLevel = (level: string | undefined) => {
      const cards: ArrangeCard[] = [];
      const sizeById = new Map<string, { width: number; height: number }>();
      const pushCard = (
        id: string,
        position: { x: number; y: number },
        estimate: { width: number; height: number },
        role: "machine" | "storage",
        exactSize?: { width: number; height: number },
      ) => {
        // Measured sizes win where they exist — except a frame the interior
        // pass just refitted, whose fresh size is the truth.
        const measured = exactSize ? undefined : publishedBoardGeometryById.get(id);
        const width =
          exactSize?.width ??
          (measured?.width ? snapSizeUpToGrid(measured.width) : estimate.width);
        const height =
          exactSize?.height ??
          (measured?.height ? snapSizeUpToGrid(measured.height) : estimate.height);
        sizeById.set(id, { width, height });
        cards.push({ id, x: position.x, y: position.y, width, height, role });
      };
      for (const node of project.nodes) {
        if (node.pocketId !== level) {
          continue;
        }
        const recipe = recipesById.get(node.recipeId);
        // Trash cans are storage-shaped furniture: small tiles that want to
        // ride beside the machine feeding them.
        pushCard(
          node.id,
          node.position,
          estimateNodeCardSize(node, recipe, project),
          recipe && isTrashRecipe(recipe) ? "storage" : "machine",
        );
      }
      for (const storage of project.storages ?? []) {
        if (storage.pocketId !== level) {
          continue;
        }
        pushCard(
          storage.id,
          storage.position,
          { width: STORAGE_NODE_WIDTH, height: STORAGE_NODE_HEIGHT },
          "storage",
        );
      }
      for (const pocket of pockets) {
        if (pocket.parentPocketId !== level) {
          continue;
        }
        pushCard(
          pocket.id,
          pocket.position,
          pocket.expanded ? boardWindowSize(pocket) : minimizedCardSize(pocket.id),
          "machine",
          refitSizes.get(pocket.id),
        );
      }

      const cardIds = new Set(cards.map((card) => card.id));
      const wires: ArrangeWire[] = [];
      for (const edge of project.edges) {
        const sourceRep = representativeAt(level, edge.source);
        const targetRep = representativeAt(level, edge.target);
        if (!sourceRep || !targetRep || sourceRep === targetRep) {
          continue;
        }
        if (!cardIds.has(sourceRep) || !cardIds.has(targetRep)) {
          continue;
        }
        // The live flow, log-compressed so a 10,000 L/s trunk outranks a
        // 2/s side feed without flattening every other distinction.
        const transferred =
          result?.edges[edge.id]?.transferredPerSecond ?? edge.ratePerSecond ?? 0;
        wires.push({
          id: edge.id,
          source: sourceRep,
          target: targetRep,
          // A machine end aligns by its measured port row; a board end by
          // where the interior pass parked the member this wire reaches —
          // falling back to centre only when nothing recorded one (a
          // minimized board, an empty frame).
          sourcePortY:
            sourceRep === edge.source
              ? measuredPortOffsetY(edge.source, edge.sourceHandle, Position.Right)
              : boundaryPortY.get(`${edge.id}:${sourceRep}`),
          targetPortY:
            targetRep === edge.target
              ? measuredPortOffsetY(edge.target, edge.targetHandle, Position.Left)
              : boundaryPortY.get(`${edge.id}:${targetRep}`),
          weight: 1 + Math.log10(1 + Math.max(transferred, 0)),
          width: Math.min(
            publishedEdgeStrokeWidths.get(edge.id) ?? DEFAULT_EDGE_STROKE_WIDTH,
            LANE_CAPACITY,
          ),
        });
      }
      return { cards, wires, sizeById };
    };

    return { gatherLevel, representativeAt };
  };

  // A board on the plan is LOCKED (unless tidyBoardInteriors): its contents
  // are never rearranged and its frame keeps its size; the arrange only
  // places the board, one meta card among the others.
  const basePockets = baseProject.pockets ?? [];
  const lockedBoardIds = new Set(basePockets.map((pocket) => pocket.id));

  const addBoards: FactoryPocket[] = [];
  const setOwners: Array<{ id: string; pocketId?: string }> = [];
  // The arrange never wraps islands in fresh boards (islands emerge from the
  // layout itself), so addBoards and setOwners stay empty; the plumbing
  // remains for the result's bookkeeping.
  const zoneOwner = new Map(setOwners.map((owner) => [owner.id, owner.pocketId]));

  // The plan as the layout passes see it.
  const project: FactoryProject = {
    ...baseProject,
    nodes: baseProject.nodes.map((node) =>
      zoneOwner.has(node.id) ? { ...node, pocketId: zoneOwner.get(node.id) } : node,
    ),
    storages: baseProject.storages?.map((storage) =>
      zoneOwner.has(storage.id) ? { ...storage, pocketId: zoneOwner.get(storage.id) } : storage,
    ),
    pockets: [...basePockets, ...addBoards],
  };

  const { gatherLevel, representativeAt } = makeGatherer(project);
  const view = computeBoardLevelView(project);
  const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
  const boardSizes: Array<{ id: string; size: { width: number; height: number } }> = [];
  // Boards whose interior the arrange re-laid this run (only with
  // tidyBoardInteriors). Waypoints and ink inside any other board stand.
  const tidiedBoards = new Set<string>();

  // Interior passes, deepest board first (openBoards comes parents-first),
  // so every parent already knows its nested boards' fresh frames. Member
  // positions are frame-relative, so the arrange happens IN frame space:
  // content starts one cell in, under the title bar. Interior bridges pin
  // no waypoints — stored waypoints live in flow space, not the frame's.
  for (const board of [...view.openBoards].reverse()) {
    const bundle = gatherLevel(board.id);
    if (bundle.cards.length === 0) {
      continue;
    }

    // A locked board: nothing inside moves. Its crossing wires still report
    // where their members stand, so the root pass lines frames up by real
    // port heights. Only top-level frames record them: nothing reads a
    // nested locked board's.
    if (lockedBoardIds.has(board.id) && !options.tidyBoardInteriors) {
      if (board.parentPocketId === undefined) {
        const lockedCards = new Map(bundle.cards.map((card) => [card.id, card]));
        for (const edge of project.edges) {
          const sourceRep = representativeAt(board.id, edge.source);
          const targetRep = representativeAt(board.id, edge.target);
          const inbound = targetRep !== undefined && sourceRep === undefined;
          const outbound = sourceRep !== undefined && targetRep === undefined;
          if (!inbound && !outbound) {
            continue;
          }
          const member = lockedCards.get((inbound ? targetRep : sourceRep) as string);
          if (member) {
            boundaryPortY.set(`${edge.id}:${board.id}`, member.y + member.height / 2);
          }
        }
      }
      continue;
    }
    tidiedBoards.add(board.id);

    // Boundary pulls: a member whose wires cross the frame must end up by the
    // edge they leave through. Each crossing edge gets a phantom partner (an
    // upstream one a source pulling left, a downstream one a sink pulling
    // right), weighted above interior wires; phantoms are discarded after.
    const cardIds = new Set(bundle.cards.map((card) => card.id));
    const crossings: Array<{ edge: FactoryEdge; memberRep: string }> = [];
    const phantomCards = new Map<string, ArrangeCard>();
    const phantomWires: ArrangeWire[] = [];
    for (const edge of project.edges) {
      const sourceRep = representativeAt(board.id, edge.source);
      const targetRep = representativeAt(board.id, edge.target);
      const inbound = targetRep !== undefined && sourceRep === undefined;
      const outbound = sourceRep !== undefined && targetRep === undefined;
      if (!inbound && !outbound) {
        continue;
      }
      const memberRep = (inbound ? targetRep : sourceRep) as string;
      if (!cardIds.has(memberRep)) {
        continue;
      }
      // One phantom per distinct outer partner and direction, so members
      // talking to different neighbours spread apart.
      const outerEnd = inbound ? edge.source : edge.target;
      const outerRep = representativeAt(undefined, outerEnd) ?? "outside";
      const phantomId = `__phantom:${inbound ? "in" : "out"}:${outerRep}`;
      if (!phantomCards.has(phantomId)) {
        phantomCards.set(phantomId, {
          id: phantomId,
          x: 0,
          y: 0,
          width: STORAGE_NODE_WIDTH,
          height: STORAGE_NODE_HEIGHT,
          role: "machine",
        });
      }
      const transferred =
        result?.edges[edge.id]?.transferredPerSecond ?? edge.ratePerSecond ?? 0;
      const weight = (1 + Math.log10(1 + Math.max(transferred, 0))) * 3;
      phantomWires.push(
        inbound
          ? { source: phantomId, target: memberRep, weight }
          : { source: memberRep, target: phantomId, weight },
      );
      crossings.push({ edge, memberRep });
    }

    const arranged = arrangeBoard({
      cards: [...bundle.cards, ...phantomCards.values()],
      wires: [...bundle.wires, ...phantomWires],
      taste,
      origin: { x: BOARD_WINDOW_FIT_PAD, y: BOARD_WINDOW_TITLE_HEIGHT + BOARD_WINDOW_FIT_PAD },
    });

    // Phantoms go; the real members re-normalise so the content corner lands
    // one cell in, under the title bar.
    const memberMoves = arranged.moves.filter((move) => bundle.sizeById.has(move.id));
    let minX = Infinity;
    let minY = Infinity;
    for (const move of memberMoves) {
      minX = Math.min(minX, move.position.x);
      minY = Math.min(minY, move.position.y);
    }
    const shiftX = BOARD_WINDOW_FIT_PAD - minX;
    const shiftY = BOARD_WINDOW_TITLE_HEIGHT + BOARD_WINDOW_FIT_PAD - minY;
    const placed = new Map<string, { x: number; y: number }>();
    for (const move of memberMoves) {
      const position = { x: move.position.x + shiftX, y: move.position.y + shiftY };
      placed.set(move.id, position);
      moves.push({ id: move.id, position });
    }
    let maxX = 0;
    let maxY = 0;
    for (const [id, position] of placed) {
      const size = bundle.sizeById.get(id)!;
      maxX = Math.max(maxX, position.x + size.width);
      maxY = Math.max(maxY, position.y + size.height);
    }
    const size = {
      width: Math.max(BOARD_WINDOW_MIN_WIDTH, snapSizeUpToGrid(maxX + BOARD_WINDOW_FIT_PAD)),
      height: Math.max(
        BOARD_WINDOW_MIN_HEIGHT,
        snapSizeUpToGrid(maxY + BOARD_WINDOW_FIT_PAD),
      ),
    };
    refitSizes.set(board.id, size);
    boardSizes.push({ id: board.id, size });

    // Where each crossing wire's member stands, from the frame's top edge:
    // the port height the outer pass lines this frame up by.
    for (const crossing of crossings) {
      const position = placed.get(crossing.memberRep);
      const memberSize = bundle.sizeById.get(crossing.memberRep);
      if (position && memberSize) {
        boundaryPortY.set(
          `${crossing.edge.id}:${board.id}`,
          position.y + memberSize.height / 2,
        );
      }
    }
  }

  // The root pass: boards as meta cards at their fresh sizes, wire length
  // between the blocks doing the placing.
  const root = gatherLevel(undefined);
  // The judge routes the real wires at each candidate layout; it exists
  // only when every card on the level is a plain card (no boards).
  const rootIsPlain = root.cards.every((card) => !isPocketId(project, card.id));
  const judgeInput = rootIsPlain
    ? buildArrangeJudgeInput(root.cards.map((card) => card.id))
    : undefined;
  if (typeof window !== "undefined") {
    (window as unknown as { __gtnhArrangeInput?: unknown }).__gtnhArrangeInput = {
      cards: root.cards,
      wires: root.wires,
      taste,
    };
  }
  // The judged arrange is dozens of route solves; it runs in a worker so
  // the page keeps breathing, and reports where it is for the loader.
  const { result: arranged } = await arrangeInWorker(
    { cards: root.cards, wires: root.wires, taste, judgeInput },
    onProgress,
  );
  moves.push(...arranged.moves);

  // How far each locked top-level board moved: waypoints pinned on wires
  // wholly inside one are flow-space points, and the whole room took the
  // same step.
  const arrangedPositionById = new Map(
    arranged.moves.map((move) => [move.id, move.position] as const),
  );
  const lockedBoardDelta = new Map<string, { x: number; y: number }>();
  for (const pocket of basePockets) {
    if (pocket.parentPocketId !== undefined) {
      continue;
    }
    const position = arrangedPositionById.get(pocket.id);
    if (position) {
      lockedBoardDelta.set(pocket.id, {
        x: position.x - pocket.position.x,
        y: position.y - pocket.position.y,
      });
    }
  }

  // Every wire the arrange re-laid loses its hand-pinned stops, which aim at
  // a layout that no longer exists. A wire wholly inside one locked board
  // keeps them, shifted by the board's step.
  const resetEdgeIds: string[] = [];
  const carriedWaypoints: Array<{
    id: string;
    waypoints: Array<{ x: number; y: number }>;
  }> = [];
  for (const edge of project.edges) {
    if (!edge.waypoints?.length) {
      continue;
    }
    const sourceTop = representativeAt(undefined, edge.source);
    const targetTop = representativeAt(undefined, edge.target);
    if (
      sourceTop !== undefined &&
      sourceTop === targetTop &&
      lockedBoardIds.has(sourceTop) &&
      !tidiedBoards.has(sourceTop)
    ) {
      const delta = lockedBoardDelta.get(sourceTop);
      if (delta && (delta.x !== 0 || delta.y !== 0) && edge.waypoints?.length) {
        carriedWaypoints.push({
          id: edge.id,
          waypoints: edge.waypoints.map((point) => ({
            x: point.x + delta.x,
            y: point.y + delta.y,
          })),
        });
      }
      continue;
    }
    resetEdgeIds.push(edge.id);
  }

  // The arrange owns the ink of the levels it re-laid (the root and any
  // tidied board). Ink inside an untouched board rides the frame and stays.
  const staleInkIds = (project.annotations ?? [])
    .filter(
      (annotation) =>
        annotation.pocketId === undefined || tidiedBoards.has(annotation.pocketId),
    )
    .map((annotation) => annotation.id);

  // Every added board (none, currently) gets a paper, cycling through
  // ZONE_PAPERS and skipping papers other boards already wear until the
  // cycle runs dry. Existing boards are never re-dressed.
  const setBoardThemes: Array<{ id: string; theme: string }> = [];
  const wornPapers = new Set(
    (project.pockets ?? []).map((pocket) => pocket.theme).filter(Boolean),
  );
  let paperIndex = 0;
  for (const pocket of addBoards) {
    if (pocket.theme) {
      continue;
    }
    let paper = ZONE_PAPERS[paperIndex % ZONE_PAPERS.length];
    for (let step = 0; step < ZONE_PAPERS.length; step += 1) {
      const candidate = ZONE_PAPERS[(paperIndex + step) % ZONE_PAPERS.length];
      if (!wornPapers.has(candidate)) {
        paper = candidate;
        paperIndex += step;
        break;
      }
    }
    paperIndex += 1;
    wornPapers.add(paper);
    setBoardThemes.push({ id: pocket.id, theme: paper });
  }

  return {
    moves,
    wireRoutes: [...arranged.wireRoutes, ...carriedWaypoints],
    resetEdgeIds,
    staleInkIds,
    boardSizes,
    addBoards,
    setOwners,
    setBoardThemes,
  };
}

/**
 * Converts a screen point inside a node to node-relative FLOW coordinates
 * using only the node's own rect and its published flow size. Deliberately
 * avoids the viewport transform, which can change mid-frame (a restored
 * viewport on reload) and would poison the dims-keyed cache: two rects read
 * in the same instant share whatever transform and browser zoom are live.
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

  // Same as the endpoint lookup above: never memoize a miss.
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
 * Reads the live viewport transform at most once per frame:
 * `getComputedStyle(...).transform` forces a style recalculation, and callers
 * ask per node per edge.
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
  // The scroll camera (scroll-camera.tsx) carries the pan in the .react-flow
  // wrapper's scroll offset, so the on-screen translation is the transform's
  // minus that offset. The renderer's rect is the wrapper's under the camera,
  // on purpose (see scroll-camera.tsx).
  const scrollLeft = root?.scrollLeft ?? 0;
  const scrollTop = root?.scrollTop ?? 0;
  viewportTransformCache = {
    rendererLeft: rendererRect.left,
    rendererTop: rendererRect.top,
    translateX: matrix.translateX - scrollLeft,
    translateY: matrix.translateY - scrollTop,
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
  if (!sidesFit) {
    return false;
  }

  const [output, input] =
    targetHandle.side === "input"
      ? [draggedResource, targetResource]
      : [targetResource, draggedResource];
  // A cell and its fluid never take each other's wires: they meet in a fluid tank.
  return resourceMatchesInput(output, input);
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
 * Drops anywhere on a (legacy) trash card resolve to its universal port.
 * Only outputs qualify, and the whole card counts, so a drop on its frame or
 * header voids the line instead of spawning a drawer on top of the can.
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
 * The whole card is the port. The cascade in `handleConnectEnd` tries exact
 * handles first; this catches drops anywhere else on the card, landing them
 * on whichever slot takes the resource.
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
  // Board windows count as ink for every wire gesture too: a drag lands on
  // the cards inside the frame, never on the frame or its floor.
  return (
    element.classList.contains("react-flow__node-annotationNode") ||
    element.classList.contains("react-flow__node-boardNode")
  );
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
  // A drawer's drag tries the card as a CONSUMER first (the commoner intent),
  // then as a maker. A card that does both takes the first; a drop aimed at
  // an actual slot overrules this anyway.
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
    // A drawer never offers ITSELF: the store refuses a drawer feeding
    // itself. A machine that eats what it makes can self-wire.
    if (storage.id === draggedResource.nodeId) {
      return undefined;
    }
    const held = { kind: storage.kind, id: storage.resourceId };
    return accepts(held) ? port(held) : undefined;
  }

  // A minimized board takes no wires: it is a summary, opened to change it.
  if (isPocketId(project, nodeId)) {
    return undefined;
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
    // A can drinks outputs and nothing else.
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

  // A custom rate card takes anything. Unset, the drop lands on its universal
  // socket; set, on the port it shows, and the card adopts the new resource.
  // Only the side it faces answers; turning it round is the dial's job.
  // An empty fluid tank takes anything on its universal sockets, as a custom rate card does.
  if (isCustomRateRecipe(recipe) || (isFluidTankRecipe(recipe) && !getFluidTankSlot(contextualRecipe))) {
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

  // Every section of a shared machine offers its ports; the first that
  // takes the drop names the section in its handle.
  for (const { section, node: view } of listNodeSections(node)) {
    const sectionRecipe =
      section === 0 ? contextualRecipe : (() => {
        const raw = project.recipes.find((entry) => entry.id === view.recipeId);
        return raw ? getEffectiveNodeRecipe(raw, view) : undefined;
      })();
    if (!sectionRecipe) {
      continue;
    }
    const candidates = side === "input" ? sectionRecipe.inputs : sectionRecipe.outputs;
    const match = (candidates ?? []).find(
      (candidate) =>
        (side === "output" || isRecipeInputConsumed(candidate)) && accepts(candidate),
    );
    if (match) {
      const resolved = port(match);
      return { ...resolved, handleId: sectionHandleId(section, resolved.handleId) };
    }
  }

  return undefined;
}

/**
 * Board-wide drag feedback: every card wears the answer to "would this drop
 * work?" as a data attribute, and rules in globals.css paint the wash. Never
 * through React: re-rendering every node per drag frame blows the frame
 * budget (see CLAUDE.md). `onlyUnpainted` is the per-frame pass for
 * cards mounted mid-drag.
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

  // POOL MODE: nothing connects, so every card reads "none" (no wash), which
  // also leaves the snap map empty so the pipe never jumps to a slot.
  if (project.poolMode) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      element.dataset.dropFit = "none";
    }
    return;
  }

  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const id = element.dataset.id;
    if (!id) {
      continue;
    }

    // Backdrops get no wash and no snap, but are still marked so the
    // per-frame pass skips them.
    if (isAnnotationNodeElement(element)) {
      element.dataset.dropFit = "none";
      continue;
    }

    let target = activeDropTargets.get(id);
    if (target === undefined) {
      target = findNodeDropTarget(project, id, draggedResource) ?? null;
      activeDropTargets.set(id, target);
    }

    // The origin card can take a self-wire, so it may read green, but never
    // red: that would flag a wire nobody aimed there.
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
 * Where the dragged pipe should end: over any card that takes the resource,
 * the slot it will land on (the drop's "whole card is the port" rule, made
 * visible). The hit test runs in FLOW space against published geometry,
 * never the DOM, over only the cards that would accept the drop.
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

  return point ? { point, side: best.target.side, target: best.target } : undefined;
}

/** The colour pulled toward black by `amount` (0 leaves it, 1 is black). */
function darkenHexColor(color: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const drop = (channel: number) => Math.max(0, Math.round(channel * (1 - amount)));
  const r = drop((value >> 16) & 0xff);
  const g = drop((value >> 8) & 0xff);
  const b = drop(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
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
 * How far an arrow sits back from a wire's endpoint: the final stretch is
 * tucked under the card border, so an arrow at the anchor would be half
 * buried.
 */
const ARROW_SETBACK = 10;

/**
 * When a double-press removes a waypoint dot, the trailing native dblclick
 * lands on whatever wire sits under the vanished dot (often a DIFFERENT
 * edge), which would pin a fresh dot. Module-wide so every edge shares the
 * suppression window.
 */
let lastWaypointRemovalAt = 0;

/** A long run wears an arrow every this many px (the mod's ARROW_EVERY, 16 cells). */
const ARROW_SPACING = 320;

/**
 * Direction arrows along a routed wire, as SVG polygon point strings
 * (filled triangles: tip, then the two wing corners behind it). One near
 * each end when the route is long enough, one in the middle when it is
 * not, and one every ARROW_SPACING along a long run - each lying wholly
 * within one straight run, never folded over a corner. Sized to the stroke,
 * a little wider than the wire; larger at a glance to survive the zoom.
 */
function getRouteArrows(
  points: Array<{ x: number; y: number }>,
  strokeWidth: number,
  glance: boolean,
  hopSpans: ReadonlyArray<HopSpan> = [],
): string[] {
  const segments = getPolylineSegments(points);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total < 16) {
    return [];
  }
  const scale = glance ? 1.6 : 1;
  // The mod's heads (WireLayer.arrows): 1.25 x (2w + 3) long within 7..12, 1.25 x (0.9w + 1.5) half wide within 3.5..6.
  const length = 1.25 * Math.min(Math.max(7, 2 * strokeWidth + 3), 12) * scale;
  const halfWidth = 1.25 * Math.min(Math.max(3.5, strokeWidth * 0.9 + 1.5), 6) * scale;

  // Segment starts along the polyline, so an arrow can be kept inside one.
  const starts: number[] = [];
  let walked = 0;
  for (const segment of segments) {
    starts.push(walked);
    walked += segment.length;
  }
  const at = (distance: number): { x: number; y: number; dx: number; dy: number } => {
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (distance <= starts[i] + segment.length || i === segments.length - 1) {
        const t = Math.min(Math.max((distance - starts[i]) / segment.length, 0), 1);
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * t,
          y: segment.start.y + (segment.end.y - segment.start.y) * t,
          dx: (segment.end.x - segment.start.x) / segment.length,
          dy: (segment.end.y - segment.start.y) / segment.length,
        };
      }
    }
    const lastPoint = points[points.length - 1];
    return { x: lastPoint.x, y: lastPoint.y, dx: 1, dy: 0 };
  };
  // A head over a hop would float straight while the wire bulges under it,
  // so it slides clear to the nearer side; undefined when neither has room.
  const overHop = (tip: number) =>
    hopSpans.some((span) => tip > span.from - 2 && tip - length < span.to + 2);
  const offHops = (tip: number): number | undefined => {
    const span = hopSpans.find((hop) => tip > hop.from - 2 && tip - length < hop.to + 2);
    if (!span) return tip;
    const candidates = [span.from - 2, span.to + 2 + length]
      .filter((candidate) => candidate - length >= 0 && candidate <= total && !overHop(candidate))
      .sort((left, right) => Math.abs(left - tip) - Math.abs(right - tip));
    return candidates[0];
  };
  // The arrow whose tip would sit at `tip` slid, if need be, so the whole
  // head lies on one straight run; undefined when no run there is long
  // enough to hold it.
  const settleOnRun = (tip: number): number | undefined => {
    for (let i = 0; i < segments.length; i += 1) {
      const start = starts[i];
      const end = start + segments[i].length;
      if (tip - length >= start - 0.01 && tip <= end + 0.01) {
        return tip;
      }
      if (tip > start && tip - length < start && i > 0) {
        // Folded over the corner at `start`: back onto the run before it
        // if that run can hold the head, else forward onto this one.
        const before = segments[i - 1];
        if (before.length >= length) return start;
        if (segments[i].length >= length) return start + length;
        return undefined;
      }
    }
    return undefined;
  };
  const settle = (wantedTip: number): number | undefined => {
    const clear = offHops(wantedTip);
    const tip = clear === undefined ? undefined : settleOnRun(clear);
    return tip === undefined || overHop(tip) ? undefined : tip;
  };
  const arrowAt = (tip: number): string => {
    const { x, y, dx, dy } = at(tip);
    const backX = x - dx * length;
    const backY = y - dy * length;
    const wingX = -dy * halfWidth;
    const wingY = dx * halfWidth;
    return `${x},${y} ${backX + wingX},${backY + wingY} ${backX - wingX},${backY - wingY}`;
  };

  // Short wire: one arrow in the middle says everything there is room for.
  if (total < 2 * ARROW_SETBACK + 3 * length) {
    const tip = settle(total / 2 + length / 2);
    return tip === undefined ? [] : [arrowAt(tip)];
  }
  const wanted: number[] = [ARROW_SETBACK + length];
  const spacing = ARROW_SPACING * scale;
  const last = total - ARROW_SETBACK;
  for (let tip = wanted[0] + spacing; tip < last - spacing / 2; tip += spacing) {
    wanted.push(tip);
  }
  wanted.push(last);
  const tips: number[] = [];
  for (const tip of wanted) {
    const settled = settle(tip);
    if (settled === undefined) continue;
    if (tips.some((other) => Math.abs(other - settled) < length * 1.5)) continue;
    tips.push(settled);
  }
  return tips.map(arrowAt);
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

  if (sourceHandle.side === targetHandle.side) {
    return false;
  }
  return resourceMatchesInput(output, input);
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

  if (isPocketId(project, nodeId)) {
    // A minimized board has no ports to drag from.
    return undefined;
  }
  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      nodeId,
      side: handle.side,
      handleId,
      // A drawer holds one item, so the drag has no direction until it
      // lands; the target decides.
      bidirectional: true,
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  // The handle names the section of a shared machine it sits on.
  const card = project.nodes.find((entry) => entry.id === nodeId);
  const node = card ? sectionNodeView(card, handle.section) : undefined;
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
    // No ports, so no resource behind one.
    return undefined;
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

  const card = project.nodes.find((entry) => entry.id === nodeId);
  const node = card ? sectionNodeView(card, handle.section) : undefined;
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

function dispatchImageExportComplete(
  requestId: string,
  capture?: FlowExportCapture,
  error?: string,
) {
  window.dispatchEvent(
    new CustomEvent(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, {
      detail: { requestId, capture, error },
    }),
  );
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

function makeExportNodeFilter(hideAnnotations: boolean) {
  return (domNode: HTMLElement) => {
    const element = domNode instanceof Element ? domNode : undefined;

    if (hideAnnotations && element?.classList.contains("react-flow__node-annotationNode")) {
      return false;
    }

    return !(
      element?.classList.contains("react-flow__edgeupdater") ||
      element?.classList.contains("react-flow__selection") ||
      element?.classList.contains("react-flow__nodesselection") ||
      element?.classList.contains("react-flow__handle")
    );
  };
}

/** Resolves after the NEXT frame's paint, not merely before this one's. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * The big-board loading state: a plan past the worker threshold shows stale
 * books (src/store/solve-books.ts) until the real ones arrive. A pill at the
 * BOTTOM CENTRE, the one chrome-free strip, never over the cards being
 * edited. It subscribes through useSolvingBooks itself so the board never
 * re-renders for it, and blocks nothing.
 */
function SolvingBooksOverlay() {
  const solving = useSolvingBooks();
  if (!solving) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-3 whitespace-nowrap border-2 border-neutral-600 bg-neutral-950/90 px-4 py-2 font-mono text-neutral-200 shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
        <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-neutral-700 border-t-cyan-400" />
        <div className="text-[13px]">Working out the numbers... you can keep editing.</div>
      </div>
    </div>
  );
}
