"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import type { DatasetManifest, RecipeDataset } from "@/lib/datasets";
import {
  canonicalizeResourceHandleId,
  dedupeEdgeWires,
  findDuplicateEdge,
} from "@/lib/model/edge-identity";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { playBoardSound, quietBoardSoundsFor, suppressBoardSound } from "@/lib/board-sounds";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import {
  setActivePowerDisplayUnit,
  setActiveRateUnit,
  type PowerDisplayUnit,
  type RateUnit,
} from "@/lib/model/rate-unit";
import { registerBooksSink, solveBooks } from "./solve-books";
import { applyRecipeInputOverrides, inputOverrideAmount } from "@/lib/model/recipe-input-overrides";
import type { AlternativeCycleFace } from "@/lib/nei/alternative-cycle";
import { createCropFarmPlaceholderRecipe, isCropFarmRecipe } from "@/lib/model/passive-production";
import { buildPowerRecipe, isPowerRecipe } from "@/lib/power/power-recipe";
import { POWER_EU_CLAUSE_ID } from "@/lib/power/power-search";
import {
  createCustomRatePlaceholderRecipe,
  getCustomRateDial,
  getCustomRateSlot,
  isCustomRateRecipe,
  releaseCustomRates,
  withCustomRateSlot,
  type CustomRateMode,
} from "@/lib/model/custom-rate";
import {
  createTrashPlaceholderRecipe,
  isTrashRecipe,
  TRASH_ANY_RESOURCE_ID,
} from "@/lib/model/trash";
import { optimizeMachineCountsForProject } from "@/lib/solver/machine-count-optimizer";
import {
  BOARD_GRID,
  BOARD_WINDOW_DEFAULT_SIZE,
  BOARD_WINDOW_FIT_PAD,
  BOARD_WINDOW_MIN_HEIGHT,
  BOARD_WINDOW_MIN_WIDTH,
  BOARD_WINDOW_TITLE_HEIGHT,
  RECIPE_NODE_WIDTH,
  STORAGE_NODE_HEIGHT,
  STORAGE_NODE_WIDTH,
  snapPositionToGrid,
  snapSizeUpToGrid,
} from "@/lib/board-grid";
import {
  boardWindowSize,
  computeBoardLevelView,
  computeOpenBoardRects,
} from "@/lib/model/board-windows";
import {
  getResourceKey,
  isOreDictionaryResource,
  isRecipeInputConsumed,
  resourceMatchesInput,
  resourceLabel,
} from "@/lib/model/resources";
import type {
  SetupRules,
  EntryIcon,
  FactoryAnnotation,
  FactoryEdge,
  FactoryNode,
  FactoryNodeColorTag,
  FactoryPocket,
  FactoryProject,
  FactoryStorage,
  StorageDrainMode,
  MachineTier,
  Recipe,
  RecipeInput,
  ResourceAmount,
  ResourceKind,
  TargetRate,
  ThroughputResult,
} from "@/lib/model/types";
import { nearestFreeSpot, type PlacementRect } from "@/components/flow/board-placement";
import { collectPocketMembers, expandPocketSelection } from "@/lib/model/pocket-connections";
import { paperForBoardId, pickBoardPaper } from "@/lib/model/board-paper";
import { getSetupRules, packSetupRules } from "@/lib/model/setup-rules";
import type { BoardCamera } from "@/lib/designs/design-camera";

export const LOCAL_STORAGE_KEY = "gtnh-factory-flow.project.v2";
export const RESOURCE_HISTORY_STORAGE_KEY = "gtnh-factory-flow.resource-history.v1";
const RESOURCE_HISTORY_LIMIT = 30;
const PROJECT_HISTORY_LIMIT = 100;

/**
 * A move the board's camera has been asked to make from outside the canvas.
 *
 * `centre` lands on a single card at 1:1 - reading one machine. `fit` zooms
 * out until every named card is on screen at once, and an empty `nodeIds`
 * under `fit` means the whole board. `viewport` names the pan and zoom
 * outright, which is how a tab comes back up where you left it.
 */
/**
 * How hard a `fit` is allowed to push, when the default framing is wrong for
 * the caller.
 *
 * The board's own framing is deliberately timid: it never magnifies past 1:1,
 * because arriving at a plan blown up reads as a bug. A caller that wants
 * "look at THIS card" to actually fill the eye says so rather than every
 * caller inheriting one compromise.
 */
export interface BoardFraming {
  /** How far in the fit may zoom. Defaults to BOARD_CAMERA_MAX_ZOOM. */
  maxZoom?: number;
  /** Slack around the framed cards, as a fraction. Defaults to BOARD_CAMERA_PADDING. */
  padding?: number;
  /**
   * Screen pixels down the right-hand side to leave clear, and to frame
   * AROUND: the cards land centred in what is left, not behind whatever
   * panel is sitting there. Clamped so a phone cannot inset itself to nothing.
   */
  insetRight?: number;
}

export interface BoardCameraRequest {
  mode: "centre" | "fit" | "viewport";
  nodeIds: string[];
  token: number;
  /** `fit` only. */
  framing?: BoardFraming;
  /** `viewport` only: the exact pan and zoom to land on. */
  camera?: BoardCamera;
}

interface FactoryStore {
  project: FactoryProject;
  undoHistory: FactoryProject[];
  redoHistory: FactoryProject[];
  datasetManifest?: DatasetManifest;
  dataset?: RecipeDataset;
  datasetManifestUrl?: string;
  selectedDatasetVersionId?: string;
  isDatasetLoading: boolean;
  isProjectImporting: boolean;
  datasetError?: string;
  recipeSearch: string;
  /**
   * Debounced mirror of `recipeSearch`, published by the recipe browser and read
   * by the canvas.
   *
   * The raw query changes on every keystroke, and everything that highlights
   * against it — every node, every storage, the whole edge array — is expensive
   * to re-render. Splitting the two keeps typing local to the browser panel.
   */
  highlightSearch: string;
  maxTierFilter: TierFilter;
  recipeBrowserResource?: RecipeBrowserResource;
  recipeBrowserMode: RecipeBrowserMode;
  /**
   * Pre-filled stencil conditions for the recipe search, set by the refactor
   * button: every input and output of the card being refactored. A plain
   * browse clears them and seeds from its one resource as always.
   */
  recipeBrowserSeed?: RecipeSeedClause[];
  /** Set while the search is a REFACTOR: the add replaces this node in place. */
  recipeBrowserRefactorNodeId?: string;
  /**
   * Bumped by every refactor press, so each one is a FRESH browse: the
   * card's settings may have changed since last time, and stencil edits
   * keyed to the previous press must not resurrect over the new seed.
   */
  recipeBrowserSeedNonce: number;
  /**
   * The search's own back and forward stacks: every browse made while it is
   * open (a chip click, a refactor press) files the one it replaces here,
   * so a click can be undone and redone like a page in a browser. Cleared
   * when the search closes; the recent strip is the long memory.
   */
  recipeBrowserBack: RecipeBrowserHistoryEntry[];
  recipeBrowserForward: RecipeBrowserHistoryEntry[];
  recipeResourceHistory: RecipeBrowserResource[];
  /**
   * Recipes the plus button promised to the board whose full bodies are still
   * on the wire. The book closes the moment the button is pressed, so these
   * drive the board's "on its way" chip — and carry the apology when a fetch
   * fails, because the book that would have shown the error is gone.
   */
  pendingRecipeAdds: PendingRecipeAdd[];
  pendingResourceConnection?: PendingResourceConnection;
  nodeColorPaintMode?: FactoryNodeColorTag | null;
  // The read-only display modes (heatmap, the three line modes) are NOT here:
  // they are per-person view settings that must survive a reload, so they live
  // in `board-view.ts` behind localStorage. Keeping them in this store would
  // have meant either losing them on refresh or persisting them with the plan.
  hoveredFlowResourceKey?: string;
  selectedFlowResourceKey?: string;
  /**
   * The flow neighbourhood under the cursor: hovering a port lights every
   * edge on it plus their far-end ports; hovering an edge label lights that
   * line and both endpoints. Maps give O(1) membership for per-element
   * selectors.
   */
  hoveredFlowScope?: {
    edges: Record<string, true>;
    ports: Record<string, true>;
    nodes: Record<string, true>;
  };
  hoveredNodeBottlenecks: boolean;
  selectedNodeBottlenecks: boolean;
  /** Node hovered in the inspector's usage grid, highlighted on the canvas. */
  hoveredUsageNodeId?: string;
  flowViewportCenter?: FactoryNode["position"];
  selectedNodeId?: string;
  selectedRecipeId?: string;
  lastResult: ThroughputResult;
  /** Board-wide display unit for rates: per tick / second / minute / hour. */
  rateUnit: RateUnit;
  setRateUnit: (unit: RateUnit) => void;
  /** EU/t, or amps of a chosen tier - the board-wide power display dial. */
  powerDisplayUnit: PowerDisplayUnit;
  setPowerDisplayUnit: (unit: PowerDisplayUnit) => void;
  setProject: (project: FactoryProject) => void;
  markHydratedProject: (project: FactoryProject) => void;
  undo: () => void;
  redo: () => void;
  setDatasetManifest: (manifest: DatasetManifest, manifestUrl: string) => void;
  setDataset: (dataset: RecipeDataset) => void;
  refreshProjectRecipes: (recipes: Recipe[]) => void;
  clearDataset: () => void;
  setDatasetLoading: (isLoading: boolean) => void;
  setProjectImporting: (isImporting: boolean) => void;
  setDatasetError: (error?: string) => void;
  setRecipeSearch: (query: string) => void;
  setHighlightSearch: (query: string) => void;
  setMaxTierFilter: (tier: TierFilter) => void;
  hydrateResourceHistory: (history: RecipeBrowserResource[]) => void;
  clearResourceHistory: () => void;
  browseResource: (resource: RecipeBrowserResource, mode?: RecipeBrowserMode) => void;
  browseBack: () => void;
  browseForward: () => void;
  clearResourceBrowser: () => void;
  beginRecipeAdd: (label: string) => number;
  resolveRecipeAdd: (id: number) => void;
  failRecipeAdd: (id: number, message: string) => void;
  cleanBoard: () => void;
  selectResourceConnectionSlot: (slot: PendingResourceConnection) => void;
  cancelResourceConnection: () => void;
  setNodeColorPaintMode: (colorTag?: FactoryNodeColorTag | null) => void;
  setHoveredFlowResourceKey: (key?: string) => void;
  setHoveredFlowScope: (scope?: {
    edges: Record<string, true>;
    ports: Record<string, true>;
    nodes: Record<string, true>;
  }) => void;
  selectFlowResourceKey: (key?: string) => void;
  setHoveredNodeBottlenecks: (isHovered: boolean) => void;
  toggleNodeBottlenecks: () => void;
  setHoveredUsageNodeId: (nodeId?: string) => void;
  setFlowViewportCenter: (position: FactoryNode["position"]) => void;
  recalculate: () => void;
  selectNode: (nodeId?: string) => void;
  selectRecipe: (recipeId?: string) => void;
  addNodeForRecipe: (recipeId: string) => void;
  addNodeForRecipeObject: (
    recipe: Recipe,
    resource?: RecipeInputContextResource,
    options?: { machineHandlerId?: string; inputPicks?: RecipeInputPicks; focusCamera?: boolean },
  ) => void;
  addConnectedNodeForRecipe: (
    recipeId: string,
    anchorNodeId: string,
    resource: RecipeInputContextResource,
  ) => void;
  addConnectedNodeForRecipeObject: (
    recipe: Recipe,
    anchorNodeId: string,
    resource: RecipeInputContextResource,
    options?: { machineHandlerId?: string; inputPicks?: RecipeInputPicks },
  ) => void;
  /** Opens the recipe search pre-filled with this node's inputs and outputs. */
  beginRecipeRefactor: (nodeId: string) => void;
  /**
   * The refactor's landing: swap the node onto the picked recipe in place,
   * carrying every wire the new recipe can still serve - or, when none can,
   * spawn the pick beside the old card and leave it untouched.
   */
  refactorNodeWithRecipe: (
    nodeId: string,
    recipe: Recipe,
    options?: { machineHandlerId?: string },
  ) => void;
  updateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  /** Drops an empty crop source node; a crop is picked on the node itself. */
  addCropFarmNode: () => void;
  /** The power source picker overlay (src/lib/power). */
  powerMenuOpen: boolean;
  openPowerMenu: () => void;
  closePowerMenu: () => void;
  /**
   * Places a power card: a node owning a synthesized generator recipe. The
   * picker passes `settings` when the search matched through a fuel or
   * product, so the card lands already dialed to what was searched for.
   */
  addPowerSourceNode: (sourceId: string, settings?: Record<string, string>) => void;
  /**
   * The refactor's power landing: swaps the card onto a generator in place,
   * settings dialed, wires re-docking where the resources still match -
   * exactly what refactoring to a recipe does.
   */
  refactorNodeToPowerSource: (
    nodeId: string,
    sourceId: string,
    settings?: Record<string, string>,
  ) => void;
  /**
   * Writes one power card setting and rebuilds its owned recipe in the same
   * step, so the knobs, the slots and the books never disagree. Wires whose
   * resource left the card (a fuel change) are pruned like any edit.
   */
  setPowerSetting: (nodeId: string, settingId: string, value: string) => void;
  /** A dial-a-rate source/sink node; adopts its resource from the first wire. */
  addCustomRateNode: () => void;
  /** Rate stored per second. Flipping the mode reverses direction and drops wires. */
  setCustomRateConfig: (
    nodeId: string,
    patch: { perSecond?: number; mode?: CustomRateMode },
  ) => void;
  /** Wire landed on a custom-rate node's universal port: adopt + connect. */
  connectCustomRate: (
    customNodeId: string,
    customSide: "input" | "output",
    machine: { nodeId: string; handleId?: string },
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
    >,
  ) => void;
  /** Drops a trash can node: anything wired in is voided, never an output. */
  addTrashNode: () => void;
  /** Wire landed on a trash can: void whatever the far end's output carries. */
  connectTrash: (
    trashNodeId: string,
    source: { nodeId: string; handleId?: string },
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
  ) => void;
  /**
   * A loose cell wire (SetupRules.looseCellWires): a filled cell landing
   * straight on its fluid's input, or a fluid landing straight on its cell's
   * input. The edge carries the SOURCE's own resource, the far form's input
   * handle as its target, and the Canner ratio the gesture fetched; the
   * solver bridges the two forms through a hidden free Tank.
   */
  connectCrossFormEdge: (
    source: { nodeId: string; handleId: string },
    target: { nodeId: string; handleId: string },
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
    litresPerCell: number,
  ) => void;
  /** Swaps the node onto another recipe (crop pick), resetting per-recipe state. */
  setNodeRecipe: (nodeId: string, recipe: Recipe) => void;
  deleteNode: (nodeId: string) => void;
  addResourceStorage: (
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
    > &
      Partial<Pick<ResourceAmount, "tooltip" | "amount" | "alternatives">>,
  ) => void;
  addStorageForConnection: (
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
    > &
      Partial<Pick<ResourceAmount, "tooltip" | "amount" | "alternatives">>,
    /** One card, or every member behind a pocket port — all wired to the ONE new drawer/tank. */
    nodeId: string | string[],
    side: "input" | "output",
    position: FactoryStorage["position"],
    handleId: string,
  ) => void;
  /** Drains only: flip between pulling the feeder flat out and catching the extra. */
  setStorageDrainMode: (storageId: string, drainMode: StorageDrainMode) => void;
  /** Solve mode's requirement on a product drawer; undefined clears it. */
  setStorageTarget: (storageId: string, targetPerSecond: number | undefined) => void;
  /** Free inputs and free outputs: what the board does off its own edges. */
  setSetupRules: (rules: Partial<SetupRules>) => void;
  /** Plan mode counts machines and reports flows; solve mode takes the
   * product drawers' typed amounts and reports machine counts. */
  setSolveMode: (solveMode: boolean) => void;
  deleteStorage: (storageId: string) => void;
  /** Clone a node (same recipe/config, no wires) beside the original. */
  duplicateNode: (nodeId: string) => void;
  /** Clone a tank/drawer (same resource/color, no wires) beside the original. */
  duplicateStorage: (storageId: string) => void;
  autoRouteStorage: (storageId: string) => void;
  updateStorage: (storageId: string, patch: Partial<FactoryStorage>) => void;
  setStoragePosition: (storageId: string, position: FactoryStorage["position"]) => void;
  /** Records which community post the current design belongs to (no undo entry). */
  setProjectCommunityLink: (communityPlanId: string) => void;
  /** Detaches the design from its post: link and fingerprint both go. */
  clearProjectCommunityLink: () => void;
  /**
   * The plan's face - blurb and icon - edited from the plan card. Not the
   * name: that belongs to the design tab (every save stamps the tab's name
   * over the plan), so renaming goes through the design store. No undo entry:
   * typing has its own undo, and one board Ctrl+Z must never swallow half a
   * sentence.
   */
  setProjectIdentity: (identity: { description?: string; icon?: EntryIcon | null }) => void;
  addAnnotation: (annotation: Omit<FactoryAnnotation, "id">) => void;
  updateAnnotation: (annotationId: string, patch: Partial<FactoryAnnotation>) => void;
  deleteAnnotation: (annotationId: string) => void;
  setAnnotationPosition: (annotationId: string, position: FactoryAnnotation["position"]) => void;
  setNodePosition: (nodeId: string, position: FactoryNode["position"]) => void;
  /**
   * One drop for a whole dragged selection - machines, drawers and
   * annotations land together as a single undo entry. Ids that match nothing
   * are ignored; a drop where nothing actually moved writes no history.
   */
  moveBoardItems: (
    moves: Array<{
      id: string;
      position: FactoryNode["position"];
      /**
       * Also re-home the item: dropped inside an open board it becomes a
       * member, dropped anywhere else it surfaces on the canvas. The
       * position is already in the new owner's space. Absent = the owner
       * stays. A board re-homes through `parentPocketId`, and a drop that
       * would make one its own ancestor keeps its old home.
       */
      owner?: { pocketId?: string };
    }>,
  ) => void;
  /**
   * Land an auto-arrange as ONE undo entry: every card's new position; a
   * reset of hand-pinned waypoints and dragged rate labels on the wires the
   * rearranged level shows (steering aimed at the old positions would only
   * fight the router on the new ones); fresh waypoint lanes for the wires
   * the arrange chose to steer itself; and the island boxes it draws,
   * replacing any it drew before. Undo restores all of it together.
   */
  applyBoardArrangement: (arrangement: {
    moves: Array<{ id: string; position: FactoryNode["position"] }>;
    resetEdgeIds?: string[];
    setWaypoints?: Array<{ id: string; waypoints: Array<{ x: number; y: number }> }>;
    /** Auto-drawn island boxes; ids are stamped here with the auto prefix. */
    addAnnotations?: Array<Omit<FactoryAnnotation, "id">>;
    removeAnnotationIds?: string[];
    /** Frames refitted around freshly arranged members; same undo entry. */
    setBoardSizes?: Array<{ id: string; size: { width: number; height: number } }>;
    /**
     * Zones the arrange built: fully-formed new boards. Their positions and
     * sizes ride the `moves`/`setBoardSizes` lists like any board's.
     */
    addBoards?: FactoryPocket[];
    /**
     * Where the arrange put each card: a zone's id, or undefined for the
     * open canvas. Positions ride `moves`.
     */
    setOwners?: Array<{ id: string; pocketId?: string }>;
    /** Boards the arrange dumped; their members ride `setOwners`. */
    removeBoards?: string[];
    /** Paper for boards that had none; hand-picked papers are kept. */
    setBoardThemes?: Array<{ id: string; theme: string }>;
  }) => void;
  /**
   * Delete a whole selection as a single undo entry. `nodeIds` may hold any
   * mix of machine, storage and annotation ids; wires touching deleted cards
   * go with them, exactly as the one-at-a-time deletes do.
   */
  deleteBoardSelection: (selection: { nodeIds?: string[]; edgeIds?: string[] }) => void;
  /**
   * Paste a copied selection: fresh ids, wires remapped onto the copies,
   * per-node recipes cloned, everything offset and snapped to the grid - one
   * undo entry. Returns the new root-level ids so the caller can select them
   * (members of a pasted board ride inside it).
   */
  pasteBoardItems: (payload: BoardClipboardPayload, offset: { x: number; y: number }) => string[];
  /**
   * Wrap a selection in a new OPEN board fitted around it: members keep
   * their screen positions and every wire, the frame simply appears around
   * them. Selected boards nest whole. Returns the new board id, or
   * undefined when the selection held nothing.
   */
  /**
   * Wrap a root selection in a new open board. Refused - and returns
   * undefined - when anything selected already belongs to a board or IS
   * one: nothing may sit in two boards at once.
   */
  wrapSelectionInBoard: (ids: string[], name?: string) => string | undefined;
  /** Unwrap a board: members surface where they stand, the frame goes. */
  dissolvePocket: (pocketId: string) => void;
  renamePocket: (pocketId: string, name: string) => void;
  /** Paint a board's background; undefined washes the paint off. */
  paintPocket: (pocketId: string, colorTag?: FactoryNodeColorTag) => void;
  /** The paper a board is drawn on; undefined hands it back to its id. */
  setPocketTheme: (pocketId: string, theme?: string) => void;
  /** The ruling on that paper; undefined returns it to the default dots. */
  setPocketPattern: (pocketId: string, pattern?: string) => void;
  /**
   * Place a new board: an open window on the canvas. Items in `memberIds`
   * (root items covered by the drawn frame) become members without moving
   * on screen — their positions are re-measured from the frame's corner.
   * Returns the new board id.
   */
  createBoard: (input: {
    position: { x: number; y: number };
    size?: { width: number; height: number };
    name?: string;
    memberIds?: string[];
  }) => string | undefined;
  /**
   * Open a collapsed board. Members of a board that has never stood open
   * (a legacy pocket) are rebased to fit inside the frame — their old
   * dive-in coordinates were their own space — and hand-pinned waypoints on
   * wires touching them are dropped: they steered through a space the wires
   * no longer travel.
   */
  expandPocket: (pocketId: string) => void;
  /**
   * Fold a board down to its minimized card — the one that shows the
   * contents' inputs and outputs with the crossing wires docked on it.
   * Members hide until it reopens.
   */
  minimizePocket: (pocketId: string) => void;
  /** Resize a board's window frame; snapped up to whole cells. */
  setPocketSize: (pocketId: string, size: { width: number; height: number }) => void;
  /**
   * Move AND resize a board's frame in one go — what dragging its top or
   * left wall does. Members are relative to the frame's origin, so they are
   * shifted by the same step in the opposite direction: the wall moves and
   * the cards stay exactly where they were on the canvas.
   */
  setPocketFrame: (
    pocketId: string,
    frame: { position: { x: number; y: number }; size: { width: number; height: number } },
  ) => void;
  /**
   * Ids the board should hand the selection to after the next project sync -
   * how a paste or a blueprint load arrives already selected.
   */
  pendingBoardSelectionIds?: string[];
  setPendingBoardSelection: (ids?: string[]) => void;
  /**
   * What was just put on the board, and a token so the same card landing twice
   * still counts twice.
   *
   * Two things read it: the board flashes those cards, because a card added to a
   * plan of two hundred is otherwise indistinguishable from the rest of them, and
   * on a phone the side drawers close, because whatever just landed is behind
   * whichever one is open.
   */
  placedBoardIds?: string[];
  placedBoardToken: number;
  /** The board's live selection, published for panels outside the canvas. */
  selectedBoardIds: string[];
  setSelectedBoardIds: (ids: string[]) => void;
  /**
   * A panel asked the board to move its camera. The token makes the same move
   * requestable twice running - cycling through the machines that share a
   * resource lands back on the first one, and that has to move the viewport
   * again rather than look broken.
   */
  boardFocusRequest?: BoardCameraRequest;
  /** Fly to one card, centre it, and land at 1:1 however far out the user was. */
  focusBoardNode: (nodeId: string) => void;
  /**
   * Frame `nodeIds`, or everything on the board when they are omitted: the
   * board zooms out as far as it has to for the lot to fit.
   *
   * This is how a plan that arrives from somewhere else lands on screen. A
   * shared setup carries its author's positions and nothing about where their
   * camera was, so opening one built thousands of cells from the origin used
   * to leave the viewer looking at blank canvas.
   */
  frameBoardNodes: (nodeIds?: string[], framing?: BoardFraming) => void;
  /**
   * Put the camera exactly here, with no animation: switching to a design tab
   * that remembers where it was left. Instant because you are not travelling
   * anywhere - that tab was already showing this, the last time you saw it.
   */
  moveBoardCamera: (camera: BoardCamera) => void;
  connectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    resource?: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
    > & {
      sourceHandle?: string;
      targetHandle?: string;
    },
  ) => void;
  /**
   * Several source→target wires as ONE undo entry with one solve — how a
   * wire dropped on a pocket card fans out to every member that takes the
   * resource. Each pair keeps connectNodes' semantics: an identical existing
   * wire toggles off, storage conflicts are skipped.
   */
  connectNodesBatch: (
    connections: Array<{
      sourceNodeId: string;
      targetNodeId: string;
      resource?: Pick<
        ResourceAmount,
        "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
      > & {
        sourceHandle?: string;
        targetHandle?: string;
      };
    }>,
  ) => void;
  reconnectEdge: (
    edgeId: string,
    connection: {
      source?: string | null;
      target?: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void;
  updateEdge: (edgeId: string, patch: Partial<FactoryEdge>) => void;
  autoConnectNode: (nodeId: string) => void;
  optimizeMachineCount: (nodeId: string) => void;
  optimizeMachineCounts: () => void;
  /** One wire, or a batch deleted together as a single undo entry. */
  deleteEdge: (edgeId: string | string[]) => void;
  setTargetRate: (targetRate?: TargetRate) => void;
  selectFuelProfile: (fuelProfileId: string) => void;
  renameProject: (name: string) => void;
}

const initialProject = createEmptyProject();

/**
 * What Ctrl+C lifts off the board: the selected items verbatim, the wires
 * that run between two selected items, and the recipes those items lean on -
 * carried along so a paste into another design (or after the originals were
 * deleted) still has everything it needs. Selecting a pocket card lifts the
 * whole pocket: the pocket itself, every member, and every nested pocket.
 * Blueprints save exactly this payload.
 */
export interface BoardClipboardPayload {
  nodes: FactoryNode[];
  storages: FactoryStorage[];
  annotations: FactoryAnnotation[];
  pockets: FactoryPocket[];
  edges: FactoryEdge[];
  recipes: Recipe[];
}

/**
 * Snapshot a board selection as a clipboard/blueprint payload. Pocket cards
 * expand to their full contents; wires survive only when both feet stand
 * inside the capture. Returns undefined when the selection holds nothing.
 */
export function captureBoardSelection(
  project: FactoryProject,
  selectedIds: Iterable<string>,
): BoardClipboardPayload | undefined {
  const { itemIds, pocketIds } = expandPocketSelection(project, selectedIds);
  const nodes = project.nodes.filter((node) => itemIds.has(node.id));
  const storages = (project.storages ?? []).filter((storage) => itemIds.has(storage.id));
  const annotations = (project.annotations ?? []).filter((annotation) =>
    itemIds.has(annotation.id),
  );
  if (nodes.length + storages.length + annotations.length + pocketIds.size === 0) {
    return undefined;
  }

  const recipeIds = new Set(nodes.map((node) => node.recipeId));
  // Snapshotted, not referenced: the capture must not change when the
  // originals are edited or deleted afterwards.
  return structuredClone({
    nodes,
    storages,
    annotations,
    pockets: (project.pockets ?? []).filter((pocket) => pocketIds.has(pocket.id)),
    edges: project.edges.filter((edge) => itemIds.has(edge.source) && itemIds.has(edge.target)),
    recipes: project.recipes.filter((recipe) => recipeIds.has(recipe.id)),
  });
}

export type RecipeBrowserMode = "recipes" | "uses";
export type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

type RecipeInputContextResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip" | "modId"
> & {
  mode: RecipeBrowserMode;
  inputIndex?: number;
  neiSlot?: ResourceAmount["neiSlot"];
};

export interface RecipeBrowserResource {
  kind: ResourceKind;
  id: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  anchorNodeId?: string;
}

/** One page of the recipe search, as the back and forward stacks hold it. */
export interface RecipeBrowserHistoryEntry {
  resource: RecipeBrowserResource;
  mode: RecipeBrowserMode;
  seed?: RecipeSeedClause[];
  refactorNodeId?: string;
  seedNonce: number;
}

/** Deeper than anyone clicks; the stacks live only while the search is open. */
const RECIPE_BROWSER_HISTORY_LIMIT = 60;

/** The open search as one history entry, or undefined when it is closed. */
function currentBrowserPage(state: {
  recipeBrowserResource?: RecipeBrowserResource;
  recipeBrowserMode: RecipeBrowserMode;
  recipeBrowserSeed?: RecipeSeedClause[];
  recipeBrowserRefactorNodeId?: string;
  recipeBrowserSeedNonce: number;
}): RecipeBrowserHistoryEntry | undefined {
  if (!state.recipeBrowserResource) {
    return undefined;
  }
  return {
    resource: state.recipeBrowserResource,
    mode: state.recipeBrowserMode,
    seed: state.recipeBrowserSeed,
    refactorNodeId: state.recipeBrowserRefactorNodeId,
    seedNonce: state.recipeBrowserSeedNonce,
  };
}

/** The same page asked twice (a chip clicked again) is not a step. */
function sameBrowserPage(a: RecipeBrowserHistoryEntry | undefined, b: RecipeBrowserHistoryEntry) {
  return (
    a !== undefined &&
    a.resource.kind === b.resource.kind &&
    a.resource.id === b.resource.id &&
    a.mode === b.mode &&
    a.refactorNodeId === b.refactorNodeId &&
    a.seedNonce === b.seedNonce
  );
}

/** The stack with the open page filed on top, or unchanged when nothing is open. */
function pushBrowserPage(
  stack: RecipeBrowserHistoryEntry[],
  page: RecipeBrowserHistoryEntry | undefined,
): RecipeBrowserHistoryEntry[] {
  if (!page) {
    return stack;
  }
  return [...stack, page].slice(-RECIPE_BROWSER_HISTORY_LIMIT);
}

/** The store fields one history entry sets when it becomes the open page. */
function browserPageState(page: RecipeBrowserHistoryEntry) {
  return {
    recipeBrowserResource: page.resource,
    recipeBrowserMode: page.mode,
    recipeBrowserSeed: page.seed,
    recipeBrowserRefactorNodeId: page.refactorNodeId,
    recipeBrowserSeedNonce: page.seedNonce,
    selectedNodeId: page.resource.anchorNodeId,
  };
}

/** One pre-filled condition of the recipe search's stencil. */
export interface RecipeSeedClause {
  role: "makes" | "takes";
  kind: ResourceKind;
  id: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
}

export interface PendingRecipeAdd {
  id: number;
  /** The recipe's display name, for the board's "on its way" chip. */
  label: string;
  /** Set when the fetch failed; the chip switches to this, then clears. */
  error?: string;
}

export interface PendingResourceConnection {
  nodeId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
  alternatives?: ResourceAmount["alternatives"];
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  handleId: string;
}

/** Never reused within a session, so a chip's dismiss can name its entry. */
let lastRecipeAddId = 0;

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  project: initialProject,
  undoHistory: [],
  redoHistory: [],
  datasetManifest: undefined,
  dataset: undefined,
  datasetManifestUrl: undefined,
  selectedDatasetVersionId: undefined,
  isDatasetLoading: false,
  isProjectImporting: false,
  datasetError: undefined,
  recipeSearch: "",
  highlightSearch: "",
  maxTierFilter: "all",
  recipeBrowserResource: undefined,
  recipeBrowserMode: "recipes",
  recipeBrowserSeed: undefined,
  recipeBrowserRefactorNodeId: undefined,
  recipeBrowserSeedNonce: 0,
  recipeBrowserBack: [],
  recipeBrowserForward: [],
  recipeResourceHistory: [],
  powerMenuOpen: false,
  pendingRecipeAdds: [],
  pendingResourceConnection: undefined,
  nodeColorPaintMode: undefined,
  hoveredFlowResourceKey: undefined,
  hoveredFlowScope: undefined,
  selectedFlowResourceKey: undefined,
  hoveredNodeBottlenecks: false,
  selectedNodeBottlenecks: false,
  hoveredUsageNodeId: undefined,
  selectedNodeId: undefined,
  selectedRecipeId: undefined,
  pendingBoardSelectionIds: undefined,
  placedBoardIds: undefined,
  placedBoardToken: 0,
  selectedBoardIds: [],
  boardFocusRequest: undefined,
  lastResult: solveBooks(initialProject),
  rateUnit: "second",
  setRateUnit: (unit) => {
    // A VIEW change: the books are per-second and stay exactly as they are.
    // The formatters read a module singleton, and every surface that prints
    // a rate also subscribes to the dial (useRateDisplayUnits) so it
    // re-renders. This used to re-solve the whole plan just to hand every
    // surface a fresh result identity, which froze big boards on a unit
    // switch.
    setActiveRateUnit(unit);
    set({ rateUnit: unit });
  },
  powerDisplayUnit: "eu",
  setPowerDisplayUnit: (unit) => {
    // Same view-only rule as the rate unit above.
    setActivePowerDisplayUnit(unit);
    set({ powerDisplayUnit: unit });
  },
  setProject: (project) => {
    // A plan ARRIVING (import, tab switch, setup open) is not an action;
    // its writes must not be mistaken for a giant paste and swept audibly.
    quietBoardSoundsFor(1500);
    const nextProject = touchProject(normalizeLoadedProject(project));
    set({
      project: nextProject,
      selectedNodeId: nextProject.nodes[0]?.id,
      selectedRecipeId: nextProject.nodes[0]?.recipeId ?? nextProject.recipes[0]?.id,
      pendingBoardSelectionIds: undefined,
      selectedBoardIds: [],
      lastResult: solveBooks(nextProject),
      undoHistory: [],
      redoHistory: [],
    });
  },
  markHydratedProject: (project) => {
    quietBoardSoundsFor(1500);
    const nextProject = normalizeLoadedProject(project);
    set({
      project: nextProject,
      selectedNodeId: nextProject.nodes[0]?.id,
      selectedRecipeId: nextProject.nodes[0]?.recipeId ?? nextProject.recipes[0]?.id,
      pendingBoardSelectionIds: undefined,
      selectedBoardIds: [],
      lastResult: solveBooks(nextProject),
      undoHistory: [],
      redoHistory: [],
    });
  },
  undo: () => {
    set((state) => {
      const previousProject = state.undoHistory.at(-1);
      if (!previousProject) {
        return state;
      }

      return {
        ...restoreProjectState(state, previousProject),
        undoHistory: state.undoHistory.slice(0, -1),
        redoHistory: pushProjectHistory(state.redoHistory, state.project),
      };
    });
  },
  redo: () => {
    set((state) => {
      const nextProject = state.redoHistory.at(-1);
      if (!nextProject) {
        return state;
      }

      return {
        ...restoreProjectState(state, nextProject),
        undoHistory: pushProjectHistory(state.undoHistory, state.project),
        redoHistory: state.redoHistory.slice(0, -1),
      };
    });
  },
  setDatasetManifest: (manifest, manifestUrl) => {
    set((state) => ({
      datasetManifest: manifest,
      datasetManifestUrl: manifestUrl,
      selectedDatasetVersionId:
        state.selectedDatasetVersionId ??
        manifest.latestStableVersion ??
        manifest.latestDailyVersion ??
        manifest.versions[0]?.id,
      datasetError: undefined,
    }));
  },
  setDataset: (dataset) => {
    set((state) => ({
      dataset,
      project: refreshProjectResourceIcons(state.project, dataset),
      recipeResourceHistory: refreshResourceHistoryIcons(state.recipeResourceHistory, dataset),
      recipeBrowserResource: state.recipeBrowserResource
        ? refreshBrowserResourceIcon(state.recipeBrowserResource, dataset)
        : undefined,
      pendingResourceConnection: state.pendingResourceConnection
        ? refreshPendingResourceConnectionIcon(state.pendingResourceConnection, dataset)
        : undefined,
      selectedDatasetVersionId: dataset.datasetVersionId,
      selectedRecipeId: state.selectedRecipeId ?? dataset.recipes[0]?.id,
      datasetError: undefined,
      isDatasetLoading: false,
    }));
  },
  refreshProjectRecipes: (recipes) => {
    set((state) => {
      if (recipes.length === 0) {
        return state;
      }

      const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe] as const));
      const project = {
        ...state.project,
        recipes: state.project.recipes.map((recipe) => {
          const refreshedRecipe = recipesById.get(recipe.id);
          return refreshedRecipe ? mergeRefreshedRecipe(refreshedRecipe) : recipe;
        }),
        nodes: state.project.nodes.map((node) => {
          const recipe = state.project.recipes.find((entry) => entry.id === node.recipeId);
          const refreshedRecipe = recipe ? recipesById.get(recipe.id) : undefined;
          if (!recipe || !refreshedRecipe) {
            return node;
          }

          const contextualInputOverrides = buildRecipeInputOverridesFromContextualRecipeInputs(
            recipe,
            refreshedRecipe,
          );
          const validMachineHandlerIds = new Set(
            (refreshedRecipe.machineHandlers ?? []).map((handler) => handler.id),
          );
          const nextRecipeInputOverrides = {
            ...contextualInputOverrides,
            ...node.recipeInputOverrides,
          };
          const nextNode: FactoryNode = Object.keys(nextRecipeInputOverrides).length
            ? {
                ...node,
                recipeInputOverrides: nextRecipeInputOverrides,
              }
            : node;
          return nextNode.machineHandlerId && !validMachineHandlerIds.has(nextNode.machineHandlerId)
            ? { ...nextNode, machineHandlerId: undefined }
            : nextNode;
        }),
      };

      return {
        project,
        lastResult: solveBooks(project),
      };
    });
  },
  clearDataset: () => {
    set({
      dataset: undefined,
      recipeSearch: "",
      highlightSearch: "",
      selectedRecipeId: undefined,
      selectedDatasetVersionId: undefined,
    });
  },
  setDatasetLoading: (isLoading) => {
    set({ isDatasetLoading: isLoading });
  },
  setProjectImporting: (isImporting) => {
    set({ isProjectImporting: isImporting });
  },
  setDatasetError: (error) => {
    set({ datasetError: error, isDatasetLoading: false });
  },
  setRecipeSearch: (query) => {
    set({ recipeSearch: query });
  },
  setHighlightSearch: (query) => {
    set({ highlightSearch: query });
  },
  setMaxTierFilter: (tier) => {
    set({ maxTierFilter: tier });
  },
  hydrateResourceHistory: (history) => {
    set({ recipeResourceHistory: normalizeResourceHistory(history) });
  },
  clearResourceHistory: () => {
    set({ recipeResourceHistory: [] });
    scheduleIdleBrowserWork(() => saveResourceHistory([]));
  },
  browseResource: (resource, mode = "recipes") => {
    let nextHistory: RecipeBrowserResource[] | undefined;
    set((state) => {
      const recipeResourceHistory = updateResourceHistory(state.recipeResourceHistory, resource);
      nextHistory = recipeResourceHistory;

      // The page being left goes on the back stack, and a fresh browse is
      // a new branch: whatever forward steps there were are gone, as in a
      // browser. Asking for the page already open files nothing.
      const leaving = currentBrowserPage(state);
      const repeat = sameBrowserPage(leaving, {
        resource,
        mode,
        seedNonce: state.recipeBrowserSeedNonce,
      });
      return {
        recipeBrowserResource: resource,
        recipeBrowserMode: mode,
        // A plain browse is not a refactor: the stencil seeds from this one
        // resource and an add places a new card.
        recipeBrowserSeed: undefined,
        recipeBrowserRefactorNodeId: undefined,
        recipeBrowserBack: repeat
          ? state.recipeBrowserBack
          : pushBrowserPage(state.recipeBrowserBack, leaving),
        recipeBrowserForward: repeat ? state.recipeBrowserForward : [],
        recipeResourceHistory,
        selectedNodeId: resource.anchorNodeId,
      };
    });

    const historyToSave = nextHistory;
    if (historyToSave) {
      scheduleIdleBrowserWork(() => saveResourceHistory(historyToSave));
    }
  },
  browseBack: () => {
    set((state) => {
      const page = state.recipeBrowserBack[state.recipeBrowserBack.length - 1];
      if (!page) {
        return state;
      }
      return {
        ...browserPageState(page),
        recipeBrowserBack: state.recipeBrowserBack.slice(0, -1),
        recipeBrowserForward: pushBrowserPage(state.recipeBrowserForward, currentBrowserPage(state)),
      };
    });
  },
  browseForward: () => {
    set((state) => {
      const page = state.recipeBrowserForward[state.recipeBrowserForward.length - 1];
      if (!page) {
        return state;
      }
      return {
        ...browserPageState(page),
        recipeBrowserForward: state.recipeBrowserForward.slice(0, -1),
        recipeBrowserBack: pushBrowserPage(state.recipeBrowserBack, currentBrowserPage(state)),
      };
    });
  },
  clearResourceBrowser: () => {
    set({
      recipeBrowserResource: undefined,
      recipeBrowserSeed: undefined,
      recipeBrowserRefactorNodeId: undefined,
      recipeBrowserBack: [],
      recipeBrowserForward: [],
      recipeSearch: "",
      highlightSearch: "",
    });
  },
  beginRecipeRefactor: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      const recipe = state.project.recipes.find((entry) => entry.id === node?.recipeId);
      if (!node || !recipe) {
        return state;
      }

      const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
      const seed: RecipeSeedClause[] = [];
      const seen = new Set<string>();
      const push = (role: RecipeSeedClause["role"], resource: ResourceAmount) => {
        // An oredict slot goes in as its first concrete face - a search
        // condition is a thing, not a dictionary entry.
        const face =
          (isOreDictionaryResource(resource) ? resource.alternatives?.[0] : undefined) ?? resource;
        const key = `${role}:${face.kind}:${face.id}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        seed.push({
          role,
          kind: face.kind,
          id: face.id,
          displayName: face.displayName,
          iconPath: face.iconPath,
          iconAtlas: face.iconAtlas,
          dominantColor: face.dominantColor ?? face.iconAtlas?.dominantColor,
        });
      };
      for (const input of effectiveRecipe.inputs) {
        if (isRecipeInputConsumed(input)) {
          push("takes", input);
        }
      }
      for (const output of effectiveRecipe.outputs) {
        push("makes", output);
      }
      // A generator's product IS power: refactoring one asks for other
      // things that make power, through the stencil's own EU condition.
      if (isPowerRecipe(effectiveRecipe) && effectiveRecipe.power.euPerTick > 0) {
        seed.push({
          role: "makes",
          kind: "fluid",
          id: POWER_EU_CLAUSE_ID,
          displayName: "Power (EU)",
          dominantColor: "#d99a2b",
        });
      }
      if (seed.length === 0) {
        return state;
      }

      // The EU pseudo condition never leads: it is not a dataset resource,
      // and the legacy resource slot it would fill drives real queries.
      const primary =
        seed.find((clause) => clause.role === "makes" && clause.id !== POWER_EU_CLAUSE_ID) ??
        seed.find((clause) => clause.id !== POWER_EU_CLAUSE_ID) ??
        seed[0];
      return {
        recipeBrowserResource: {
          kind: primary.kind,
          id: primary.id,
          displayName: primary.displayName,
          iconPath: primary.iconPath,
          iconAtlas: primary.iconAtlas,
          dominantColor: primary.dominantColor,
          anchorNodeId: nodeId,
        },
        recipeBrowserMode: "recipes" as const,
        recipeBrowserSeed: seed,
        recipeBrowserRefactorNodeId: nodeId,
        recipeBrowserSeedNonce: state.recipeBrowserSeedNonce + 1,
        // A refactor press is a page too: the search it replaces (if one
        // was open) is one step back.
        recipeBrowserBack: pushBrowserPage(state.recipeBrowserBack, currentBrowserPage(state)),
        recipeBrowserForward: [],
        selectedNodeId: nodeId,
      };
    });
  },
  beginRecipeAdd: (label) => {
    const id = ++lastRecipeAddId;
    set((state) => ({
      pendingRecipeAdds: [...state.pendingRecipeAdds, { id, label }],
    }));
    return id;
  },
  resolveRecipeAdd: (id) => {
    set((state) => ({
      pendingRecipeAdds: state.pendingRecipeAdds.filter((entry) => entry.id !== id),
    }));
  },
  failRecipeAdd: (id, message) => {
    set((state) => ({
      pendingRecipeAdds: state.pendingRecipeAdds.map((entry) =>
        entry.id === id ? { ...entry, error: message } : entry,
      ),
    }));
  },
  cleanBoard: () => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        recipes: [],
        nodes: [],
        storages: [],
        edges: [],
        targetRate: undefined,
      });

      return withProjectHistory(state, {
        project,
        recipeBrowserResource: undefined,
        pendingResourceConnection: undefined,
        selectedNodeId: undefined,
        selectedRecipeId: state.dataset?.recipes[0]?.id,
        lastResult: solveBooks(project),
      });
    });
  },
  selectResourceConnectionSlot: (slot) => {
    set((state) => {
      const pending = state.pendingResourceConnection;

      if (!pending) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      if (pending.nodeId === slot.nodeId && pending.handleId === slot.handleId) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      if (!canConnectPendingSlots(pending, slot)) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      const source = pending.side === "output" ? pending : slot;
      const target = pending.side === "input" ? pending : slot;
      const resource = {
        kind: source.kind,
        id: source.resourceId,
        displayName: source.displayName ?? target.displayName,
        iconPath: source.iconPath ?? target.iconPath,
        iconAtlas: source.iconAtlas ?? target.iconAtlas,
        dominantColor:
          source.dominantColor ??
          source.iconAtlas?.dominantColor ??
          target.dominantColor ??
          target.iconAtlas?.dominantColor,
        sourceHandle: source.handleId,
        targetHandle: target.handleId,
      };
      const edge = buildEdgeBetweenNodes(state.project, source.nodeId, target.nodeId, resource);

      if (!edge) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      const duplicateEdge = findDuplicateEdge(state.project.edges, edge);
      if (duplicateEdge) {
        const project = touchProject({
          ...state.project,
          edges: state.project.edges.filter((entry) => entry.id !== duplicateEdge.id),
        });
        return withProjectHistory(state, {
          project,
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
          lastResult: solveBooks(project),
        });
      }

      if (hasStorageEndpointConflict(state.project, edge)) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      const project = touchProject(
        applyEdgeInputOverride(
          {
            ...state.project,
            edges: [...state.project.edges, edge],
          },
          edge,
          resource,
        ),
      );

      return withProjectHistory(state, {
        project,
        pendingResourceConnection: undefined,
        selectedNodeId: slot.nodeId,
        lastResult: solveBooks(project),
      });
    });
  },
  cancelResourceConnection: () => {
    set({ pendingResourceConnection: undefined });
  },
  setNodeColorPaintMode: (colorTag) => {
    set({ nodeColorPaintMode: colorTag });
  },
  setHoveredFlowResourceKey: (key) => {
    set({ hoveredFlowResourceKey: key });
  },
  setHoveredFlowScope: (scope) => {
    set({ hoveredFlowScope: scope });
  },
  selectFlowResourceKey: (key) => {
    set((state) => ({
      selectedFlowResourceKey: state.selectedFlowResourceKey === key ? undefined : key,
    }));
  },
  setHoveredNodeBottlenecks: (isHovered) => {
    set({ hoveredNodeBottlenecks: isHovered });
  },
  toggleNodeBottlenecks: () => {
    set((state) => ({ selectedNodeBottlenecks: !state.selectedNodeBottlenecks }));
  },
  setHoveredUsageNodeId: (nodeId) => {
    set({ hoveredUsageNodeId: nodeId });
  },
  setFlowViewportCenter: (position) => {
    set({ flowViewportCenter: position });
  },
  recalculate: () => {
    const { project } = get();
    set({ lastResult: solveBooks(project) });
  },
  selectNode: (nodeId) => {
    const node = get().project.nodes.find((entry) => entry.id === nodeId);
    set({
      selectedNodeId: nodeId,
      selectedRecipeId: node?.recipeId ?? get().selectedRecipeId,
    });
  },
  selectRecipe: (recipeId) => {
    set({ selectedRecipeId: recipeId, selectedNodeId: undefined });
  },
  addNodeForRecipe: (recipeId) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      if (!recipe) {
        return state;
      }

      return addRecipeNodeToState(state, recipe);
    });
  },
  addNodeForRecipeObject: (recipe, resource, options) => {
    set((state) => addRecipeNodeToState(state, recipe, resource, options));
  },
  addConnectedNodeForRecipe: (recipeId, anchorNodeId, resource) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      if (!recipe) {
        return state;
      }

      return addConnectedRecipeNodeToState(state, recipe, anchorNodeId, resource);
    });
  },
  addConnectedNodeForRecipeObject: (recipe, anchorNodeId, resource, options) => {
    set((state) => addConnectedRecipeNodeToState(state, recipe, anchorNodeId, resource, options));
  },
  refactorNodeWithRecipe: (nodeId, recipe, options) => {
    set((state) => refactorNodeToState(state, nodeId, recipe, options));
  },
  updateNode: (nodeId, patch) => {
    set((state) => {
      const project = touchProject(
        pruneInvalidEdgesAndOrphanStorages({
          ...state.project,
          nodes: state.project.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...patch } : node,
          ),
        }),
      );
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  addCropFarmNode: () => {
    // Crop sources spawn green by default, like drawers/tanks spawn with the
    // active paint color; the user can still repaint them.
    set((state) =>
      addRecipeNodeToState(state, createCropFarmPlaceholderRecipe(), undefined, {
        colorTag: "green",
      }),
    );
  },
  openPowerMenu: () => set({ powerMenuOpen: true }),
  closePowerMenu: () => set({ powerMenuOpen: false }),
  addPowerSourceNode: (sourceId, settings) => {
    set((state) => {
      // Each power card owns its recipe, custom-rate style; settings are
      // defaults until the card's knobs write machineConfigTiers.
      const recipe = buildPowerRecipe(sourceId, settings, createId("recipe"));
      if (!recipe) {
        return state;
      }
      return {
        ...addRecipeNodeToState(state, recipe, undefined, {
          focusCamera: true,
          machineConfigTiers: settings,
        }),
        powerMenuOpen: false,
      };
    });
  },
  refactorNodeToPowerSource: (nodeId, sourceId, settings) => {
    set((state) => {
      const recipe = buildPowerRecipe(sourceId, settings, createId("recipe"));
      if (!recipe) {
        return state;
      }
      return refactorNodeToState(state, nodeId, recipe, { machineConfigTiers: settings });
    });
  },
  setPowerSetting: (nodeId, settingId, value) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isPowerRecipe(recipe)) {
        return state;
      }
      const nextSettings = { ...(node.machineConfigTiers ?? {}), [settingId]: value };
      // A generator setting whose VALUE is a voltage tier (the turbines'
      // and singleblocks' tier knob) speaks the board's one tier voice -
      // the power dial's ladder at that tier's rung. Any other setting
      // keeps the watcher's ordinary adjust tap.
      const tierRung = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === value);
      if (tierRung >= 0) {
        playBoardSound("dialPower", { step: tierRung + 1 });
        suppressBoardSound("adjust", 150);
      }
      // A recipe another node still shares (a clone made before clones
      // reminted) must not be rewritten under that other card: this node
      // takes its own copy and the knob turns only here.
      const sharedWithAnotherNode = state.project.nodes.some(
        (entry) => entry.id !== nodeId && entry.recipeId === recipe.id,
      );
      const nextRecipeId = sharedWithAnotherNode ? createId("recipe") : recipe.id;
      const nextRecipe = buildPowerRecipe(recipe.power.sourceId, nextSettings, nextRecipeId);
      if (!nextRecipe) {
        return state;
      }

      // A wire whose slot the setting just swapped out: a MACHINE at the far
      // end loses the wire (the prune below), but a drawer serving only this
      // card FOLLOWS the change - swap benzene for nitrobenzene and your
      // source drawer becomes a nitrobenzene drawer on the same wire. Only
      // when exactly one same-kind slot replaced the old one, and only when
      // the drawer has no other wires to honour.
      const slotKey = (slot: { kind: string; id: string }) => `${slot.kind}:${slot.id}`;
      const oldInputKeys = new Set(recipe.inputs.map(slotKey));
      const oldOutputKeys = new Set(recipe.outputs.map(slotKey));
      const addedInputs = nextRecipe.inputs.filter((slot) => !oldInputKeys.has(slotKey(slot)));
      const addedOutputs = nextRecipe.outputs.filter((slot) => !oldOutputKeys.has(slotKey(slot)));
      const storagesById = new Map(
        (state.project.storages ?? []).map((storage) => [storage.id, storage]),
      );
      const storageLinkCounts = new Map<string, number>();
      for (const edge of state.project.edges) {
        for (const end of [edge.source, edge.target]) {
          if (storagesById.has(end)) {
            storageLinkCounts.set(end, (storageLinkCounts.get(end) ?? 0) + 1);
          }
        }
      }
      const storagePatches = new Map<string, RecipeInput>();
      const edges = state.project.edges.map((edge) => {
        const intoCard = edge.target === nodeId;
        const outOfCard = edge.source === nodeId;
        if (!intoCard && !outOfCard) {
          return edge;
        }
        const slots = intoCard ? nextRecipe.inputs : nextRecipe.outputs;
        if (slots.some((slot) => slot.kind === edge.resourceKind && slot.id === edge.resourceId)) {
          return edge;
        }
        const farId = intoCard ? edge.source : edge.target;
        const storage = storagesById.get(farId);
        const added = intoCard ? addedInputs : addedOutputs;
        const replacement =
          added.length === 1 && added[0].kind === edge.resourceKind ? added[0] : undefined;
        if (!storage || !replacement || (storageLinkCounts.get(farId) ?? 0) > 1) {
          return edge;
        }
        storagePatches.set(storage.id, replacement);
        return {
          ...edge,
          resourceKind: replacement.kind,
          resourceId: replacement.id,
          label: replacement.displayName ?? edge.label,
          sourceHandle: edge.sourceHandle
            ? makeResourceHandleId("output", replacement)
            : edge.sourceHandle,
          targetHandle: edge.targetHandle
            ? makeResourceHandleId("input", replacement)
            : edge.targetHandle,
        };
      });
      const storages = (state.project.storages ?? []).map((storage) => {
        const patch = storagePatches.get(storage.id);
        return patch
          ? {
              ...storage,
              kind: patch.kind,
              resourceId: patch.id,
              displayName: patch.displayName,
              iconPath: patch.iconPath,
              iconAtlas: patch.iconAtlas,
              dominantColor: patch.dominantColor,
            }
          : storage;
      });

      const project = touchProject(
        // Whatever the retarget could not honestly follow drops here.
        pruneInvalidEdgesAndOrphanStorages({
          ...state.project,
          nodes: state.project.nodes.map((entry) =>
            entry.id === nodeId
              ? {
                  ...entry,
                  recipeId: nextRecipeId,
                  machineConfigTiers: nextSettings,
                  // Overrides stamped by old builds outlive their wire and
                  // would repaint the rebuilt slots; a power card never
                  // legitimately carries one.
                  recipeInputOverrides: undefined,
                }
              : entry,
          ),
          recipes: sharedWithAnotherNode
            ? [...state.project.recipes, nextRecipe]
            : state.project.recipes.map((entry) => (entry.id === recipe.id ? nextRecipe : entry)),
          edges,
          storages,
        }),
      );
      return withProjectHistory(state, { project, lastResult: solveBooks(project) });
    });
  },
  addCustomRateNode: () => {
    // Each custom rate node owns its recipe (the rate lives on it). No paint
    // tag: an unpainted custom rate card gets its own deep blue in RecipeNode,
    // which stays a card face you can read rather than a colour from the
    // player's palette. Painting one still works and still wins.
    set((state) =>
      addRecipeNodeToState(state, createCustomRatePlaceholderRecipe(createId("recipe"))),
    );
  },
  setCustomRateConfig: (nodeId, patch) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isCustomRateRecipe(recipe)) {
        return state;
      }
      // The dial answers on an empty card too: you can set a card up before
      // wiring it, and the numbers survive it letting go of a resource.
      const dial = getCustomRateDial(node, recipe);
      const mode = patch.mode ?? dial.mode;
      const perSecond = patch.perSecond ?? dial.perSecond;
      if (mode === dial.mode && perSecond === dial.perSecond) {
        return state;
      }
      const slot = getCustomRateSlot(recipe);
      const modeFlipped = mode !== dial.mode;
      const project = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((entry) =>
          entry.id === nodeId ? { ...entry, customRate: { perSecond, mode } } : entry,
        ),
        recipes: state.project.recipes.map((entry) =>
          entry.id === recipe.id && slot
            ? withCustomRateSlot(entry, slot.resource, mode, perSecond)
            : entry,
        ),
        // A flipped mode reverses the card's direction, so its old wires point
        // the wrong way and drop. The card then has nothing wired to it and
        // lets go of its resource (touchProject), keeping the dial.
        edges: modeFlipped
          ? state.project.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
          : state.project.edges,
      });
      return withProjectHistory(state, { project, lastResult: solveBooks(project) });
    });
  },
  connectCustomRate: (customNodeId, customSide, machine, resource) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === customNodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isCustomRateRecipe(recipe)) {
        return state;
      }
      const existing = getCustomRateSlot(recipe);
      const mode: CustomRateMode = customSide === "output" ? "supply" : "request";
      // The dialed number, never the last-adopted slot's: a card that held
      // water at 50/s and is handed lava keeps the 50.
      const perSecond = getCustomRateDial(node, recipe).perSecond;
      const resourceChanged =
        existing !== undefined &&
        (existing.resource.kind !== resource.kind || existing.resource.id !== resource.id);
      const modeChanged = existing !== undefined && existing.mode !== mode;
      const nextRecipe = withCustomRateSlot(recipe, resource, mode, perSecond);
      const canonicalHandle = makeResourceHandleId(customSide, {
        kind: resource.kind,
        id: resource.id,
      });
      const edge: FactoryEdge = {
        id: createId("edge"),
        source: mode === "supply" ? customNodeId : machine.nodeId,
        target: mode === "supply" ? machine.nodeId : customNodeId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        label: resource.displayName,
        sourceHandle: mode === "supply" ? canonicalHandle : machine.handleId,
        targetHandle: mode === "supply" ? machine.handleId : canonicalHandle,
      };
      const keptEdges =
        resourceChanged || modeChanged
          ? state.project.edges.filter(
              (entry) => entry.source !== customNodeId && entry.target !== customNodeId,
            )
          : state.project.edges;
      // One line per port the card is wired to, like the trash can below. This
      // is the only adopt-on-wire card whose resource can be re-offered
      // unchanged - drag the same port onto it again and nothing about the card
      // moves, so without this the wire was simply appended again and the drag
      // stacked copies on the same pixels, each carrying a share of the dial.
      //
      // Nothing to unwire on a repeat, either: a card holds its resource only
      // while something is wired to it, so toggling the line off would hand back
      // an empty card in answer to being asked to wire it.
      if (findDuplicateEdge(keptEdges, edge)) {
        return state;
      }
      const project = touchProject({
        ...state.project,
        // The side you wired IS the direction, so the dial follows it.
        nodes: state.project.nodes.map((entry) =>
          entry.id === customNodeId ? { ...entry, customRate: { perSecond, mode } } : entry,
        ),
        recipes: state.project.recipes.map((entry) =>
          entry.id === recipe.id ? nextRecipe : entry,
        ),
        edges: [...keptEdges, edge],
      });
      return withProjectHistory(state, {
        project,
        selectedNodeId: customNodeId,
        lastResult: solveBooks(project),
      });
    });
  },
  addTrashNode: () => {
    // Each can owns its recipe like custom rate nodes do; the recipe stays
    // slotless forever - the solver voids by edge role, not by recipe slots.
    set((state) =>
      addRecipeNodeToState(state, createTrashPlaceholderRecipe(createId("recipe")), undefined, {
        colorTag: "gray",
      }),
    );
  },
  connectTrash: (trashNodeId, source, resource) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === trashNodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isTrashRecipe(recipe) || source.nodeId === trashNodeId) {
        return state;
      }
      // One line per source and resource is enough - the can eats everything
      // on it either way, and duplicates would just split the same leftovers.
      const alreadyWired = state.project.edges.some(
        (edge) =>
          edge.source === source.nodeId &&
          edge.target === trashNodeId &&
          edge.resourceKind === resource.kind &&
          edge.resourceId === resource.id,
      );
      if (alreadyWired) {
        return state;
      }
      const edge: FactoryEdge = {
        id: createId("edge"),
        source: source.nodeId,
        target: trashNodeId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        label: resource.displayName,
        sourceHandle: source.handleId,
        targetHandle: makeResourceHandleId("input", { kind: "item", id: TRASH_ANY_RESOURCE_ID }),
      };
      const project = touchProject({
        ...state.project,
        edges: [...state.project.edges, edge],
      });
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setNodeRecipe: (nodeId, recipe) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node || node.recipeId === recipe.id) {
        return state;
      }

      const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          recipes: recipeAlreadyInProject
            ? state.project.recipes.map((entry) =>
                entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
              )
            : [...state.project.recipes, recipe],
          nodes: state.project.nodes.map((entry) => {
            if (entry.id !== nodeId) {
              return entry;
            }
            // Swapping the CROP keeps the FARM: the harvester tab and its
            // knobs (seed bed, units, feeding) describe the machine the
            // player built, not the plant in it, and every crop card offers
            // the same two handlers with the same controls.
            const keepHarvester =
              entry.machineHandlerId !== undefined &&
              (recipe.machineHandlers ?? []).some(
                (handler) => handler.id === entry.machineHandlerId,
              );
            return {
              ...entry,
              recipeId: recipe.id,
              overclockTier: recipe.minimumTier,
              machineConfigTiers: keepHarvester ? entry.machineConfigTiers : undefined,
              machineHandlerId: keepHarvester ? entry.machineHandlerId : undefined,
              coilTier: undefined,
              recipeInputOverrides: undefined,
            };
          }),
          // The old recipe's resources no longer exist on this node.
          edges: state.project.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          ),
        }),
      );

      return withProjectHistory(state, {
        project,
        selectedNodeId: nodeId,
        selectedRecipeId: recipe.id,
        lastResult: solveBooks(project),
      });
    });
  },
  deleteNode: (nodeId) => {
    set((state) => {
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          nodes: state.project.nodes.filter((node) => node.id !== nodeId),
          edges: state.project.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          ),
        }),
      );
      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          state.pendingResourceConnection?.nodeId === nodeId
            ? undefined
            : state.pendingResourceConnection,
        selectedNodeId: project.nodes[0]?.id,
        selectedRecipeId: project.nodes[0]?.recipeId ?? state.selectedRecipeId,
        lastResult: solveBooks(project),
      });
    });
  },
  addResourceStorage: (resource) => {
    set((state) => {
      const storage: FactoryStorage = {
        id: createId("storage"),
        kind: resource.kind,
        resourceId: resource.id,
        displayName: resource.displayName,
        iconPath: resource.iconPath,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
        position: snapPositionToGrid({
          x: 180 + (state.project.storages?.length ?? 0) * 80,
          y: 180 + (state.project.storages?.length ?? 0) * 60,
        }),
      };
      const project = touchProject({
        ...state.project,
        storages: [...(state.project.storages ?? []), storage],
      });

      return withProjectHistory(state, {
        project,
        selectedNodeId: undefined,
        lastResult: solveBooks(project),
      });
    });
  },
  addStorageForConnection: (resource, nodeId, side, position, handleId) => {
    set((state) => {
      const nodeIds = Array.isArray(nodeId) ? nodeId : [nodeId];
      // Whatever came out of the slot is what the buffer holds. A filled cell
      // makes a drawer of cells, counted in cells; it used to be rewritten into
      // its fluid, which is why an item output reported litres.
      const storageResource = resource;
      // The drawer joins the board of the port it came off: a port you can
      // drag from belongs to a visible card, and a drawer spawned beside a
      // board member should ride that board's title bar with it. `position`
      // arrives in flow space, so it converts to the frame's own.
      const anchorId = nodeIds[0];
      const anchorOwner =
        state.project.nodes.find((node) => node.id === anchorId)?.pocketId ??
        (state.project.storages ?? []).find((entry) => entry.id === anchorId)?.pocketId;
      const anchorFrame = anchorOwner
        ? computeOpenBoardRects(
            computeBoardLevelView(state.project).openBoards,
          ).find((frame) => frame.id === anchorOwner)
        : undefined;
      const storage: FactoryStorage = {
        id: createId("storage"),
        kind: storageResource.kind,
        resourceId: storageResource.id,
        displayName: storageResource.displayName,
        iconPath: storageResource.iconPath,
        iconAtlas: storageResource.iconAtlas,
        dominantColor: storageResource.dominantColor ?? storageResource.iconAtlas?.dominantColor,
        position: snapPositionToGrid(
          anchorFrame
            ? { x: position.x - anchorFrame.x, y: position.y - anchorFrame.y }
            : position,
        ),
        pocketId: anchorFrame ? anchorOwner : undefined,
      };
      let project: FactoryProject = {
        ...state.project,
        storages: [...(state.project.storages ?? []), storage],
      };
      const selectedResource = {
        kind: storageResource.kind,
        id: storageResource.id,
        amount: storageResource.amount,
        displayName: storageResource.displayName,
        iconPath: storageResource.iconPath,
        iconAtlas: storageResource.iconAtlas,
        dominantColor: storageResource.dominantColor ?? storageResource.iconAtlas?.dominantColor,
        tooltip: storageResource.tooltip,
        sourceHandle:
          side === "output"
            ? handleId
            : makeResourceHandleId("output", {
                kind: storageResource.kind,
                id: storageResource.id,
              }),
        targetHandle:
          side === "input"
            ? handleId
            : makeResourceHandleId("input", { kind: storageResource.kind, id: storageResource.id }),
      };

      // One drawer, one edge per anchor card. A pocket port hands over every
      // member behind it; the drawer must buffer them all, not just one.
      let wired = 0;
      let conflicted = false;
      for (const anchorId of nodeIds) {
        const edge =
          side === "output"
            ? buildEdgeBetweenNodes(project, anchorId, storage.id, selectedResource)
            : buildEdgeBetweenNodes(project, storage.id, anchorId, selectedResource);
        if (!edge) {
          continue;
        }
        if (findDuplicateEdge(project.edges, edge)) {
          continue;
        }
        if (hasStorageEndpointConflict(project, edge)) {
          conflicted = true;
          continue;
        }
        project = applyEdgeInputOverride(
          { ...project, edges: [...project.edges, edge] },
          edge,
          selectedResource,
        );
        wired += 1;
      }

      // Wired (or refused over a conflict): sweep orphans, which drops the
      // fresh storage if nothing reached it. A build failure alone keeps the
      // unwired storage, exactly as the single-node path always has.
      const finalProject = touchProject(
        wired > 0 || conflicted ? pruneOrphanStorages(project) : project,
      );
      const placed = (finalProject.storages ?? []).some((entry) => entry.id === storage.id);
      return withProjectHistory(state, {
        project: finalProject,
        selectedNodeId: undefined,
        // The new drawer announces itself with the placed flash below, which
        // ends on its own. It used to ALSO switch on the board-wide glow for
        // its resource, and nothing switched that off until you happened to
        // hover a drawer or start a wire.
        // Only if the sweep above kept it: a drawer nothing reached is gone, and
        // flashing where it briefly was would point at empty canvas.
        ...(placed
          ? { placedBoardIds: [storage.id], placedBoardToken: state.placedBoardToken + 1 }
          : undefined),
        lastResult: solveBooks(finalProject),
      });
    });
  },
  setStorageDrainMode: (storageId, drainMode) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, drainMode } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setStorageTarget: (storageId, targetPerSecond) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, targetPerSecond } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setSolveMode: (solveMode) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        solveMode: solveMode ? true : undefined,
      });

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  deleteStorage: (storageId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).filter((storage) => storage.id !== storageId),
        edges: state.project.edges.filter(
          (edge) => edge.source !== storageId && edge.target !== storageId,
        ),
      });

      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          state.pendingResourceConnection?.nodeId === storageId
            ? undefined
            : state.pendingResourceConnection,
        lastResult: solveBooks(project),
      });
    });
  },
  duplicateNode: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return state;
      }
      const clone = structuredClone(node);
      clone.id = createId("node");
      // Two cells down and across: far enough to see, still on the grid.
      clone.position = snapPositionToGrid({
        x: node.position.x + CLONE_OFFSET,
        y: node.position.y + CLONE_OFFSET,
      });
      // Custom rate AND power nodes own their recipe (the dialed rate or
      // the baked settings live on it), so the clone gets its own copy -
      // otherwise both nodes share one dial, and a rotor change on one
      // turbine rewrote the other's output too.
      const recipe = state.project.recipes.find((entry) => entry.id === node.recipeId);
      let clonedRecipe: Recipe | undefined;
      if (recipe && (isCustomRateRecipe(recipe) || isPowerRecipe(recipe))) {
        clonedRecipe = { ...structuredClone(recipe), id: createId("recipe") };
        clone.recipeId = clonedRecipe.id;
      }
      const project = touchProject({
        ...state.project,
        recipes: clonedRecipe ? [...state.project.recipes, clonedRecipe] : state.project.recipes,
        nodes: [...state.project.nodes, clone],
      });
      return withProjectHistory(state, {
        project,
        selectedNodeId: clone.id,
        selectedRecipeId: clone.recipeId,
        lastResult: solveBooks(project),
      });
    });
  },
  duplicateStorage: (storageId) => {
    set((state) => {
      const storage = (state.project.storages ?? []).find((entry) => entry.id === storageId);
      if (!storage) {
        return state;
      }
      const clone = structuredClone(storage);
      clone.id = createId("storage");
      clone.position = snapPositionToGrid({
        x: storage.position.x + CLONE_OFFSET,
        y: storage.position.y + CLONE_OFFSET,
      });
      const project = touchProject({
        ...state.project,
        storages: [...(state.project.storages ?? []), clone],
      });
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  autoRouteStorage: (storageId) => {
    set((state) => {
      const storage = (state.project.storages ?? []).find((entry) => entry.id === storageId);
      if (!storage) {
        return state;
      }

      const edges = buildCompatibleEdgesForStorage(state.project, storage);
      const missingEdges: FactoryEdge[] = [];
      for (const edge of edges) {
        const projectWithPendingEdges = {
          ...state.project,
          edges: [...state.project.edges, ...missingEdges],
        };
        if (
          !hasDuplicateEdge(projectWithPendingEdges.edges, edge) &&
          !hasStorageEndpointConflict(projectWithPendingEdges, edge)
        ) {
          missingEdges.push(edge);
        }
      }
      if (missingEdges.length === 0) {
        return state;
      }

      const project = touchProject(
        applyEdgeInputOverrides(
          {
            ...state.project,
            edges: [...state.project.edges, ...missingEdges],
          },
          missingEdges,
        ),
      );

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  updateStorage: (storageId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, ...patch } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setStoragePosition: (storageId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, position } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
      });
    });
  },
  setProjectCommunityLink: (communityPlanId) => {
    set((state) => ({
      project: {
        ...state.project,
        metadata: { ...state.project.metadata, communityPlanId },
      },
    }));
  },
  clearProjectCommunityLink: () => {
    set((state) => {
      const { communityPlanId: droppedId, ...metadata } = state.project.metadata ?? {};
      void droppedId;
      return { project: { ...state.project, metadata } };
    });
  },
  setProjectIdentity: (identity) => {
    set((state) => {
      const project = { ...state.project };
      if (identity.description !== undefined) {
        project.description = identity.description || undefined;
      }
      if (identity.icon !== undefined) {
        project.icon = identity.icon ?? undefined;
      }
      return { project };
    });
  },
  addAnnotation: (annotation) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: [
          ...(state.project.annotations ?? []),
          {
            ...annotation,
            ...snapAnnotationToGrid(annotation),
            id: createId("annotation"),
          },
        ],
      });

      return withProjectHistory(state, { project });
    });
  },
  updateAnnotation: (annotationId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).map((annotation) =>
          annotation.id === annotationId
            ? { ...annotation, ...patch, ...snapAnnotationToGrid(patch) }
            : annotation,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  deleteAnnotation: (annotationId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).filter(
          (annotation) => annotation.id !== annotationId,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  setAnnotationPosition: (annotationId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).map((annotation) =>
          annotation.id === annotationId ? { ...annotation, position } : annotation,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  setNodePosition: (nodeId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  moveBoardItems: (moves) => {
    set((state) => {
      const moveById = new Map(moves.map((move) => [move.id, move] as const));
      const currentPockets = state.project.pockets ?? [];
      let moved = false;
      const applyMoves = <
        T extends { id: string; position: { x: number; y: number }; pocketId?: string },
      >(
        items: T[],
      ): T[] =>
        items.map((item) => {
          const move = moveById.get(item.id);
          if (!move) {
            return item;
          }
          const nextOwner = move.owner ? move.owner.pocketId : item.pocketId;
          if (
            move.position.x === item.position.x &&
            move.position.y === item.position.y &&
            nextOwner === item.pocketId
          ) {
            return item;
          }
          moved = true;
          return { ...item, position: move.position, pocketId: nextOwner };
        });

      // A pocket may not become its own descendant. The drop point sits
      // inside a frame the dragged board is an ancestor of, which the board
      // filters out before calling here — this is the safety net.
      const wouldLoop = (pocketId: string, nextParent: string | undefined): boolean => {
        let parent = nextParent;
        const seen = new Set<string>();
        while (parent !== undefined && !seen.has(parent)) {
          if (parent === pocketId) {
            return true;
          }
          seen.add(parent);
          parent = currentPockets.find((entry) => entry.id === parent)?.parentPocketId;
        }
        return false;
      };
      const applyPocketMoves = (items: FactoryPocket[]): FactoryPocket[] =>
        items.map((item) => {
          const move = moveById.get(item.id);
          if (!move) {
            return item;
          }
          const nextParent =
            move.owner && !wouldLoop(item.id, move.owner.pocketId)
              ? move.owner.pocketId
              : item.parentPocketId;
          const nextPosition = move.position;
          if (
            nextPosition.x === item.position.x &&
            nextPosition.y === item.position.y &&
            nextParent === item.parentPocketId
          ) {
            return item;
          }
          moved = true;
          return { ...item, position: nextPosition, parentPocketId: nextParent };
        });

      const nodes = applyMoves(state.project.nodes);
      const storages = state.project.storages ? applyMoves(state.project.storages) : undefined;
      const annotations = state.project.annotations
        ? applyMoves(state.project.annotations)
        : undefined;
      const pockets = state.project.pockets
        ? applyPocketMoves(state.project.pockets)
        : undefined;
      // A drag that ends where it started is not an edit; recording it would
      // burn an undo step on nothing.
      if (!moved) {
        return state;
      }

      const project = touchProject({ ...state.project, nodes, storages, annotations, pockets });
      return withProjectHistory(state, { project });
    });
  },
  applyBoardArrangement: ({
    moves,
    resetEdgeIds,
    setWaypoints,
    addAnnotations,
    removeAnnotationIds,
    setBoardSizes,
    addBoards,
    setOwners,
    setBoardThemes,
    removeBoards,
  }) => {
    set((state) => {
      const positionById = new Map(moves.map((move) => [move.id, move.position] as const));
      const boardSizeById = new Map(
        (setBoardSizes ?? []).map((entry) => [entry.id, entry.size] as const),
      );
      const ownerById = new Map((setOwners ?? []).map((entry) => [entry.id, entry.pocketId]));
      const dumpedBoards = new Set(removeBoards ?? []);
      const boardThemeById = new Map(
        (setBoardThemes ?? []).map((entry) => [entry.id, entry.theme]),
      );
      let changed = false;
      const applyMoves = <
        T extends { id: string; position: { x: number; y: number }; pocketId?: string },
      >(
        items: T[],
      ): T[] =>
        items.map((item) => {
          const position = positionById.get(item.id);
          // An explicit owner wins, including an explicit "no board"; a card
          // whose board was dumped without one surfaces on the canvas.
          const nextOwner = ownerById.has(item.id)
            ? ownerById.get(item.id)
            : item.pocketId !== undefined && dumpedBoards.has(item.pocketId)
              ? undefined
              : item.pocketId;
          const samePosition =
            !position || (position.x === item.position.x && position.y === item.position.y);
          if (samePosition && nextOwner === item.pocketId) {
            return item;
          }
          changed = true;
          return { ...item, position: position ?? item.position, pocketId: nextOwner };
        });

      const nodes = applyMoves(state.project.nodes);
      const storages = state.project.storages ? applyMoves(state.project.storages) : undefined;
      if (addBoards && addBoards.length > 0) {
        changed = true;
      }
      const kept =
        dumpedBoards.size > 0
          ? (state.project.pockets ?? []).filter((pocket) => !dumpedBoards.has(pocket.id))
          : state.project.pockets;
      if (dumpedBoards.size > 0 && (kept?.length ?? 0) !== (state.project.pockets?.length ?? 0)) {
        changed = true;
      }
      const combinedPockets =
        addBoards && addBoards.length > 0 ? [...(kept ?? []), ...addBoards] : kept;
      const pockets = combinedPockets
        ? combinedPockets.map((pocket) => {
            const position = positionById.get(pocket.id);
            const size = boardSizeById.get(pocket.id);
            const theme = boardThemeById.get(pocket.id);
            const samePosition =
              !position ||
              (position.x === pocket.position.x && position.y === pocket.position.y);
            const sameSize =
              !size ||
              (pocket.size?.width === size.width && pocket.size?.height === size.height);
            const sameTheme = !theme || pocket.theme === theme;
            if (samePosition && sameSize && sameTheme) {
              return pocket;
            }
            changed = true;
            return {
              ...pocket,
              position: position ?? pocket.position,
              ...(pocket.parentPocketId !== undefined && dumpedBoards.has(pocket.parentPocketId)
                ? { parentPocketId: undefined }
                : undefined),
              ...(size ? { size } : undefined),
              ...(theme ? { theme } : undefined),
            };
          })
        : undefined;

      const doomedInk = new Set(removeAnnotationIds ?? []);
      let annotations = state.project.annotations
        ? applyMoves(state.project.annotations).filter((annotation) => {
            if (doomedInk.has(annotation.id)) {
              changed = true;
              return false;
            }
            return true;
          })
        : undefined;
      if (addAnnotations && addAnnotations.length > 0) {
        changed = true;
        annotations = [
          ...(annotations ?? []),
          ...addAnnotations.map((annotation) => ({
            ...annotation,
            id: createId("auto-island-box"),
          })),
        ];
      }

      const reset = new Set(resetEdgeIds ?? []);
      const waypointsById = new Map(
        (setWaypoints ?? []).map((entry) => [entry.id, entry.waypoints] as const),
      );
      const edges = state.project.edges.map((edge) => {
        const lane = waypointsById.get(edge.id);
        if (lane) {
          changed = true;
          const { labelOffset: _labelOffset, ...rest } = edge;
          return { ...rest, waypoints: lane };
        }
        if (!reset.has(edge.id) || (!edge.waypoints && !edge.labelOffset)) {
          return edge;
        }
        changed = true;
        const { waypoints: _waypoints, labelOffset: _labelOffset2, ...rest } = edge;
        return rest;
      });

      // Arranging an already-arranged board is not an edit.
      if (!changed) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        nodes,
        storages,
        annotations,
        pockets,
        edges,
      });
      return withProjectHistory(state, { project });
    });
  },
  deleteBoardSelection: ({ nodeIds = [], edgeIds = [] }) => {
    set((state) => {
      // Deleting a pocket card deletes the dimension AND everything in it,
      // the way deleting a folder deletes its files.
      const { itemIds: doomedItems, pocketIds: doomedPockets } = expandPocketSelection(
        state.project,
        nodeIds,
      );
      const doomedEdges = new Set(edgeIds);
      const nodes = state.project.nodes.filter((node) => !doomedItems.has(node.id));
      const storages = (state.project.storages ?? []).filter(
        (storage) => !doomedItems.has(storage.id),
      );
      const annotations = (state.project.annotations ?? []).filter(
        (annotation) => !doomedItems.has(annotation.id),
      );
      const pockets = (state.project.pockets ?? []).filter(
        (pocket) => !doomedPockets.has(pocket.id),
      );
      const edges = state.project.edges.filter(
        (edge) =>
          !doomedEdges.has(edge.id) &&
          !doomedItems.has(edge.source) &&
          !doomedItems.has(edge.target),
      );
      const nothingDeleted =
        nodes.length === state.project.nodes.length &&
        storages.length === (state.project.storages ?? []).length &&
        annotations.length === (state.project.annotations ?? []).length &&
        pockets.length === (state.project.pockets ?? []).length &&
        edges.length === state.project.edges.length;
      if (nothingDeleted) {
        return state;
      }

      const project = touchProject(
        pruneOrphanStorages({ ...state.project, nodes, storages, annotations, pockets, edges }),
      );
      const pendingConnectionNodeId = state.pendingResourceConnection?.nodeId;
      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          pendingConnectionNodeId && doomedItems.has(pendingConnectionNodeId)
            ? undefined
            : state.pendingResourceConnection,
        selectedNodeId:
          state.selectedNodeId && doomedItems.has(state.selectedNodeId)
            ? undefined
            : state.selectedNodeId,
        lastResult: solveBooks(project),
      });
    });
  },
  pasteBoardItems: (payload, offset) => {
    const pastedIds: string[] = [];
    set((state) => {
      const shift = (position: { x: number; y: number }) =>
        snapPositionToGrid({ x: position.x + offset.x, y: position.y + offset.y });
      const payloadRecipesById = new Map(payload.recipes.map((recipe) => [recipe.id, recipe]));
      const projectRecipeIds = new Set(state.project.recipes.map((recipe) => recipe.id));
      const addedRecipes: Recipe[] = [];
      const idMap = new Map<string, string>();

      // Boards first: items need the new board ids to re-home into. A
      // payload item at the payload's root lands on the canvas.
      const pastePockets = payload.pockets ?? [];
      for (const pocket of pastePockets) {
        idMap.set(pocket.id, createId("pocket"));
      }
      const rehome = (pocketId: string | undefined): string | undefined =>
        pocketId !== undefined ? idMap.get(pocketId) : undefined;
      // Positions inside a pasted board are frame-relative, so only items
      // surfacing at the root move by the paste offset — shifting members
      // too would carry a board's contents twice.
      const placeAt = (
        position: { x: number; y: number },
        home: string | undefined,
      ): { x: number; y: number } =>
        home === undefined ? shift(position) : snapPositionToGrid(position);
      const pockets = pastePockets.map((pocket) => {
        const clone = structuredClone(pocket);
        clone.id = idMap.get(pocket.id) as string;
        clone.parentPocketId = rehome(pocket.parentPocketId);
        clone.position = placeAt(pocket.position, clone.parentPocketId);
        return clone;
      });

      const nodes: FactoryNode[] = [];
      for (const node of payload.nodes) {
        const recipe =
          payloadRecipesById.get(node.recipeId) ??
          state.project.recipes.find((entry) => entry.id === node.recipeId);
        // A node whose recipe survived nowhere would paste as a broken card.
        if (!recipe) {
          continue;
        }
        const clone = structuredClone(node);
        clone.id = createId("node");
        idMap.set(node.id, clone.id);
        clone.pocketId = rehome(node.pocketId);
        clone.position = placeAt(node.position, clone.pocketId);
        // Custom rate nodes own their recipe (the dialed rate lives on it) -
        // same rule as duplicateNode, or both cards would share one dial.
        if (isCustomRateRecipe(recipe)) {
          const recipeClone = { ...structuredClone(recipe), id: createId("recipe") };
          clone.recipeId = recipeClone.id;
          addedRecipes.push(recipeClone);
        } else if (!projectRecipeIds.has(recipe.id)) {
          // Pasting into a design that has never seen this recipe: the
          // clipboard carries the copy, exactly like plan import does.
          addedRecipes.push(structuredClone(recipe));
          projectRecipeIds.add(recipe.id);
        }
        nodes.push(clone);
      }
      const storages = payload.storages.map((storage) => {
        const clone = structuredClone(storage);
        clone.id = createId("storage");
        idMap.set(storage.id, clone.id);
        clone.pocketId = rehome(storage.pocketId);
        clone.position = placeAt(storage.position, clone.pocketId);
        return clone;
      });
      const annotations = payload.annotations.map((annotation) => {
        const clone = structuredClone(annotation);
        clone.id = createId("annotation");
        idMap.set(annotation.id, clone.id);
        clone.pocketId = rehome(annotation.pocketId);
        clone.position = placeAt(annotation.position, clone.pocketId);
        return clone;
      });
      // Only wires interior to the copied selection can come along - a wire
      // with one foot outside has nothing on the pasted side to stand on.
      // Waypoints are corners in the space the wire renders in; they ride
      // the paste offset only when an endpoint surfaced at the root — a wire
      // wholly inside a pasted board kept the board's own space.
      const surfaced = new Set([
        ...nodes.filter((entry) => entry.pocketId === undefined).map((n) => n.id),
        ...storages.filter((entry) => entry.pocketId === undefined).map((s) => s.id),
      ]);
      const edges: FactoryEdge[] = [];
      for (const edge of payload.edges) {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) {
          continue;
        }
        const clone = structuredClone(edge);
        clone.id = createId("edge");
        clone.source = source;
        clone.target = target;
        clone.waypoints =
          surfaced.has(source) || surfaced.has(target)
            ? clone.waypoints?.map((waypoint) => shift(waypoint))
            : clone.waypoints;
        edges.push(clone);
      }
      if (nodes.length + storages.length + annotations.length + pockets.length === 0) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        recipes: addedRecipes.length
          ? [...state.project.recipes, ...addedRecipes]
          : state.project.recipes,
        nodes: [...state.project.nodes, ...nodes],
        storages: storages.length
          ? [...(state.project.storages ?? []), ...storages]
          : state.project.storages,
        annotations: annotations.length
          ? [...(state.project.annotations ?? []), ...annotations]
          : state.project.annotations,
        pockets: pockets.length
          ? [...(state.project.pockets ?? []), ...pockets]
          : state.project.pockets,
        edges: edges.length ? [...state.project.edges, ...edges] : state.project.edges,
      });
      // Only what surfaces at the level the board is showing can be
      // selected; cards pasted deeper inside a pocket are reachable by
      // entering it.
      pastedIds.push(
        ...nodes.filter((node) => node.pocketId === undefined).map((node) => node.id),
        ...storages
          .filter((storage) => storage.pocketId === undefined)
          .map((storage) => storage.id),
        ...annotations
          .filter((annotation) => annotation.pocketId === undefined)
          .map((annotation) => annotation.id),
        ...pockets
          .filter((pocket) => pocket.parentPocketId === undefined)
          .map((pocket) => pocket.id),
      );
      const lastPastedNode = nodes.at(-1);
      return withProjectHistory(state, {
        project,
        selectedNodeId: lastPastedNode?.id ?? state.selectedNodeId,
        selectedRecipeId: lastPastedNode?.recipeId ?? state.selectedRecipeId,
        lastResult: solveBooks(project),
      });
    });
    return pastedIds;
  },
  wrapSelectionInBoard: (ids, name) => {
    let createdBoardId: string | undefined;
    set((state) => {
      const selected = new Set(ids);
      const memberNodes = state.project.nodes.filter((node) => selected.has(node.id));
      const memberStorages = (state.project.storages ?? []).filter((storage) =>
        selected.has(storage.id),
      );
      const memberAnnotations = (state.project.annotations ?? []).filter((annotation) =>
        selected.has(annotation.id),
      );
      const memberPockets = (state.project.pockets ?? []).filter((pocket) =>
        selected.has(pocket.id),
      );
      const memberCount =
        memberNodes.length +
        memberStorages.length +
        memberAnnotations.length +
        memberPockets.length;
      if (memberCount === 0) {
        return state;
      }

      // NOTHING IS IN TWO BOARDS AT ONCE. A card already living on a
      // board cannot be wrapped in a second one, and a board cannot be
      // wrapped either - that is nesting, which is its own decision and
      // not one to make by accident from a marquee. The board refuses
      // the gesture rather than building a frame whose members belong
      // to somebody else.
      const alreadyHoused =
        memberPockets.length > 0 ||
        memberNodes.some((node) => node.pocketId !== undefined) ||
        memberStorages.some((storage) => storage.pocketId !== undefined) ||
        memberAnnotations.some((annotation) => annotation.pocketId !== undefined);
      if (alreadyHoused) {
        return state;
      }

      // A selected member may already sit inside another open board; the new
      // frame keeps ONE space, so everything converts to canvas coordinates
      // first, and the frame fits around where things STAND — wrapping never
      // moves a card on screen and never touches a wire.
      const view = computeBoardLevelView(state.project);
      const frameOrigins = new Map(
        computeOpenBoardRects(view.openBoards).map((rect) => [rect.id, rect] as const),
      );
      const absolutize = (
        position: { x: number; y: number },
        home: string | undefined,
      ): { x: number; y: number } => {
        const origin = home !== undefined ? frameOrigins.get(home) : undefined;
        return origin ? { x: position.x + origin.x, y: position.y + origin.y } : position;
      };

      // Footprints are estimated exactly as expandPocket estimates them;
      // overshooting only makes the frame roomy.
      const footprints = [
        ...memberNodes.map((node) => ({
          ...absolutize(node.position, node.pocketId),
          width: RECIPE_NODE_WIDTH,
          height: BOARD_GRID * 14,
        })),
        ...memberStorages.map((storage) => ({
          ...absolutize(storage.position, storage.pocketId),
          width: STORAGE_NODE_WIDTH,
          height: STORAGE_NODE_HEIGHT,
        })),
        ...memberAnnotations.map((annotation) => ({
          ...absolutize(annotation.position, annotation.pocketId),
          width: annotation.size.width,
          height: annotation.size.height,
        })),
        ...memberPockets.map((entry) => ({
          ...absolutize(entry.position, entry.parentPocketId),
          width: boardWindowSize(entry).width,
          height: entry.expanded ? boardWindowSize(entry).height : BOARD_WINDOW_TITLE_HEIGHT,
        })),
      ];
      const minX = Math.min(...footprints.map((rect) => rect.x));
      const minY = Math.min(...footprints.map((rect) => rect.y));
      const maxX = Math.max(...footprints.map((rect) => rect.x + rect.width));
      const maxY = Math.max(...footprints.map((rect) => rect.y + rect.height));
      const corner = snapPositionToGrid({
        x: minX - BOARD_WINDOW_FIT_PAD,
        y: minY - BOARD_WINDOW_TITLE_HEIGHT - BOARD_WINDOW_FIT_PAD,
      });

      const board: FactoryPocket = {
        id: createId("pocket"),
        name: name?.trim() || `Board ${(state.project.pockets ?? []).length + 1}`,
        position: corner,
        expanded: true,
        // Every board wears a paper, and a new one takes a colour nobody
        // else on the plan is wearing.
        theme: pickBoardPaper(
          // What the others are WEARING, which for a board that has never
          // been papered is the colour its id gives it.
          (state.project.pockets ?? []).map((entry) => entry.theme ?? paperForBoardId(entry.id)),
        ),
        size: {
          width: Math.max(
            BOARD_WINDOW_MIN_WIDTH,
            snapSizeUpToGrid(maxX - corner.x + BOARD_WINDOW_FIT_PAD),
          ),
          height: Math.max(
            BOARD_WINDOW_MIN_HEIGHT,
            snapSizeUpToGrid(maxY - corner.y + BOARD_WINDOW_FIT_PAD),
          ),
        },
      };
      createdBoardId = board.id;

      const intoBoard = <
        T extends { id: string; pocketId?: string; position: { x: number; y: number } },
      >(
        items: T[],
      ): T[] =>
        items.map((item) => {
          if (!selected.has(item.id)) {
            return item;
          }
          const absolute = absolutize(item.position, item.pocketId);
          return {
            ...item,
            pocketId: board.id,
            position: { x: absolute.x - corner.x, y: absolute.y - corner.y },
          };
        });

      const project = touchProject({
        ...state.project,
        nodes: intoBoard(state.project.nodes),
        storages: state.project.storages ? intoBoard(state.project.storages) : undefined,
        annotations: state.project.annotations ? intoBoard(state.project.annotations) : undefined,
        pockets: [
          ...(state.project.pockets ?? []).map((entry) => {
            if (!selected.has(entry.id)) {
              return entry;
            }
            const absolute = absolutize(entry.position, entry.parentPocketId);
            return {
              ...entry,
              parentPocketId: board.id,
              position: { x: absolute.x - corner.x, y: absolute.y - corner.y },
            };
          }),
          board,
        ],
      });
      return withProjectHistory(state, { project });
    });
    return createdBoardId;
  },
  dissolvePocket: (pocketId) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket) {
        return state;
      }

      // Members surface where the frame stood. A board that has ever been
      // fitted (it carries a `size`) holds frame-relative member positions,
      // so the frame's own corner is added back and everything stays put on
      // screen while the frame vanishes around it. A legacy pocket that
      // never stood open kept its members' old dive-in coordinates, which
      // surface verbatim — exactly what unpacking always did.
      const fitted = pocket.size !== undefined;
      const surface = <T extends { pocketId?: string; position: { x: number; y: number } }>(
        items: T[],
      ): T[] =>
        items.map((item) =>
          item.pocketId === pocketId
            ? {
                ...item,
                pocketId: pocket.parentPocketId,
                ...(fitted
                  ? {
                      position: {
                        x: item.position.x + pocket.position.x,
                        y: item.position.y + pocket.position.y,
                      },
                    }
                  : undefined),
              }
            : item,
        );

      // Everything the unpack just spilled onto the parent board — direct
      // member cards plus nested pockets, which surface as their own cards.
      // They arrive selected, so the pile can be dragged somewhere in one go.
      const surfacedIds = [
        ...state.project.nodes.filter((node) => node.pocketId === pocketId).map((node) => node.id),
        ...(state.project.storages ?? [])
          .filter((storage) => storage.pocketId === pocketId)
          .map((storage) => storage.id),
        ...(state.project.annotations ?? [])
          .filter((annotation) => annotation.pocketId === pocketId)
          .map((annotation) => annotation.id),
        ...(state.project.pockets ?? [])
          .filter((entry) => entry.parentPocketId === pocketId)
          .map((entry) => entry.id),
      ];

      const project = touchProject({
        ...state.project,
        nodes: surface(state.project.nodes),
        storages: state.project.storages ? surface(state.project.storages) : undefined,
        annotations: state.project.annotations
          ? surface(state.project.annotations)
          : undefined,
        pockets: (state.project.pockets ?? [])
          .filter((entry) => entry.id !== pocketId)
          .map((entry) =>
            entry.parentPocketId === pocketId
              ? {
                  ...entry,
                  parentPocketId: pocket.parentPocketId,
                  ...(fitted
                    ? {
                        position: {
                          x: entry.position.x + pocket.position.x,
                          y: entry.position.y + pocket.position.y,
                        },
                      }
                    : undefined),
                }
              : entry,
          ),
      });
      return withProjectHistory(state, {
        project,
        pendingBoardSelectionIds: surfacedIds.length > 0 ? surfacedIds : undefined,
      });
    });
  },
  renamePocket: (pocketId, name) => {
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return state;
      }
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.name === trimmed) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, name: trimmed } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  paintPocket: (pocketId, colorTag) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.colorTag === colorTag) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, colorTag } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  setPocketTheme: (pocketId, theme) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.theme === theme) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, theme } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  setPocketPattern: (pocketId, pattern) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.pattern === pattern) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, pattern } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  createBoard: ({ position, size, name, memberIds }) => {
    let createdBoardId: string | undefined;
    set((state) => {
      const corner = snapPositionToGrid(position);
      const wanted = size ?? BOARD_WINDOW_DEFAULT_SIZE;
      const frame = {
        width: Math.max(BOARD_WINDOW_MIN_WIDTH, snapSizeUpToGrid(wanted.width)),
        height: Math.max(BOARD_WINDOW_MIN_HEIGHT, snapSizeUpToGrid(wanted.height)),
      };
      const board: FactoryPocket = {
        id: createId("pocket"),
        name: name?.trim() || `Board ${(state.project.pockets ?? []).length + 1}`,
        position: corner,
        expanded: true,
        // Every board wears a paper, and a new one takes a colour nobody
        // else on the plan is wearing.
        theme: pickBoardPaper(
          // What the others are WEARING, which for a board that has never
          // been papered is the colour its id gives it.
          (state.project.pockets ?? []).map((entry) => entry.theme ?? paperForBoardId(entry.id)),
        ),
        size: frame,
      };
      createdBoardId = board.id;

      // Covered items become members without moving on screen: same spot,
      // now measured from the frame's corner. Wires are left entirely alone
      // - a board says nothing about wiring.
      const selected = new Set(memberIds ?? []);
      const adopt = <
        T extends { id: string; pocketId?: string; position: { x: number; y: number } },
      >(
        items: T[],
      ): T[] =>
        items.map((item) =>
          selected.has(item.id) && item.pocketId === undefined
            ? {
                ...item,
                pocketId: board.id,
                position: { x: item.position.x - corner.x, y: item.position.y - corner.y },
              }
            : item,
        );

      const project = touchProject({
        ...state.project,
        nodes: adopt(state.project.nodes),
        storages: state.project.storages ? adopt(state.project.storages) : undefined,
        annotations: state.project.annotations ? adopt(state.project.annotations) : undefined,
        pockets: [
          ...(state.project.pockets ?? []).map((entry) =>
            selected.has(entry.id) && entry.parentPocketId === undefined
              ? {
                  ...entry,
                  parentPocketId: board.id,
                  position: {
                    x: entry.position.x - corner.x,
                    y: entry.position.y - corner.y,
                  },
                }
              : entry,
          ),
          board,
        ],
      });
      return withProjectHistory(state, { project });
    });
    return createdBoardId;
  },
  expandPocket: (pocketId) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.expanded) {
        return state;
      }

      const memberNodes = state.project.nodes.filter((node) => node.pocketId === pocketId);
      const memberStorages = (state.project.storages ?? []).filter(
        (storage) => storage.pocketId === pocketId,
      );
      const memberAnnotations = (state.project.annotations ?? []).filter(
        (annotation) => annotation.pocketId === pocketId,
      );
      const memberPockets = (state.project.pockets ?? []).filter(
        (entry) => entry.parentPocketId === pocketId,
      );

      // The dive view never rendered while collapsed, so there are no
      // measured member sizes to read; footprints are estimated, and
      // overshooting only makes the frame roomy.
      const footprints = [
        ...memberNodes.map((node) => ({
          ...node.position,
          width: RECIPE_NODE_WIDTH,
          height: BOARD_GRID * 14,
        })),
        ...memberStorages.map((storage) => ({
          ...storage.position,
          width: STORAGE_NODE_WIDTH,
          height: STORAGE_NODE_HEIGHT,
        })),
        ...memberAnnotations.map((annotation) => ({
          ...annotation.position,
          width: annotation.size.width,
          height: annotation.size.height,
        })),
        ...memberPockets.map((entry) => ({
          ...entry.position,
          width: entry.expanded ? boardWindowSize(entry).width : RECIPE_NODE_WIDTH,
          height: entry.expanded ? boardWindowSize(entry).height : BOARD_GRID * 12,
        })),
      ];

      // Members are rebased into the frame: their old coordinates were the
      // dive view's own space, which nothing outside ever referenced. The
      // frame fits itself around them; a hand-picked size survives while
      // everything still fits inside it.
      let shiftBy = { x: 0, y: 0 };
      let frame = pocket.size;
      if (footprints.length > 0) {
        const minX = Math.min(...footprints.map((rect) => rect.x));
        const minY = Math.min(...footprints.map((rect) => rect.y));
        const maxX = Math.max(...footprints.map((rect) => rect.x + rect.width));
        const maxY = Math.max(...footprints.map((rect) => rect.y + rect.height));
        shiftBy = {
          x: BOARD_WINDOW_FIT_PAD - minX,
          y: BOARD_WINDOW_TITLE_HEIGHT + BOARD_WINDOW_FIT_PAD - minY,
        };
        const fitted = {
          width: snapSizeUpToGrid(maxX - minX + BOARD_WINDOW_FIT_PAD * 2),
          height: snapSizeUpToGrid(
            maxY - minY + BOARD_WINDOW_TITLE_HEIGHT + BOARD_WINDOW_FIT_PAD * 2,
          ),
        };
        frame =
          frame && frame.width >= fitted.width && frame.height >= fitted.height ? frame : fitted;
      }
      const sized = frame ?? BOARD_WINDOW_DEFAULT_SIZE;
      const clamped = {
        width: Math.max(BOARD_WINDOW_MIN_WIDTH, sized.width),
        height: Math.max(BOARD_WINDOW_MIN_HEIGHT, sized.height),
      };

      const rebase = <T extends { pocketId?: string; position: { x: number; y: number } }>(
        items: T[],
      ): T[] =>
        items.map((item) =>
          item.pocketId === pocketId
            ? {
                ...item,
                position: {
                  x: item.position.x + shiftBy.x,
                  y: item.position.y + shiftBy.y,
                },
              }
            : item,
        );

      // Wires touching anything inside change coordinate space, so their
      // hand-pinned waypoints steered through a space the wires no longer
      // travel. They go; the router redraws clean.
      const members = collectPocketMembers(state.project, pocketId);
      const memberIds = new Set([
        ...members.nodes.map((node) => node.id),
        ...members.storages.map((storage) => storage.id),
      ]);
      const edges = state.project.edges.map((edge) => {
        if (
          !edge.waypoints?.length ||
          (!memberIds.has(edge.source) && !memberIds.has(edge.target))
        ) {
          return edge;
        }
        const { waypoints: _waypoints, ...rest } = edge;
        return rest;
      });

      const project = touchProject({
        ...state.project,
        nodes: rebase(state.project.nodes),
        storages: state.project.storages ? rebase(state.project.storages) : undefined,
        annotations: state.project.annotations ? rebase(state.project.annotations) : undefined,
        pockets: (state.project.pockets ?? []).map((entry) => {
          if (entry.id === pocketId) {
            return { ...entry, expanded: true, size: clamped };
          }
          if (entry.parentPocketId === pocketId) {
            return {
              ...entry,
              position: {
                x: entry.position.x + shiftBy.x,
                y: entry.position.y + shiftBy.y,
              },
            };
          }
          return entry;
        }),
        edges,
      });
      return withProjectHistory(state, { project });
    });
  },
  minimizePocket: (pocketId) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket?.expanded) {
        return state;
      }

      // The mirror of expand's waypoint rule: wires among members were
      // steered in the parent board's space, which the collapsed card's
      // channels do not share.
      const members = collectPocketMembers(state.project, pocketId);
      const memberIds = new Set([
        ...members.nodes.map((node) => node.id),
        ...members.storages.map((storage) => storage.id),
      ]);
      const edges = state.project.edges.map((edge) => {
        if (
          !edge.waypoints?.length ||
          (!memberIds.has(edge.source) && !memberIds.has(edge.target))
        ) {
          return edge;
        }
        const { waypoints: _waypoints, ...rest } = edge;
        return rest;
      });

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, expanded: false } : entry,
        ),
        edges,
      });
      return withProjectHistory(state, { project });
    });
  },
  setPocketFrame: (pocketId, frame) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket) {
        return state;
      }
      const position = snapPositionToGrid(frame.position);
      const size = {
        width: Math.max(BOARD_WINDOW_MIN_WIDTH, snapSizeUpToGrid(frame.size.width)),
        height: Math.max(BOARD_WINDOW_MIN_HEIGHT, snapSizeUpToGrid(frame.size.height)),
      };
      if (
        position.x === pocket.position.x &&
        position.y === pocket.position.y &&
        pocket.size?.width === size.width &&
        pocket.size?.height === size.height
      ) {
        return state;
      }

      // Whatever the origin moved by, its members move back by, so a wall
      // dragged outward reveals more floor instead of towing the cards.
      const dx = pocket.position.x - position.x;
      const dy = pocket.position.y - position.y;
      const shift = <T extends { pocketId?: string; position: { x: number; y: number } }>(
        items: T[],
      ): T[] =>
        dx === 0 && dy === 0
          ? items
          : items.map((item) =>
              item.pocketId === pocketId
                ? { ...item, position: { x: item.position.x + dx, y: item.position.y + dy } }
                : item,
            );

      const project = touchProject({
        ...state.project,
        nodes: shift(state.project.nodes),
        storages: state.project.storages ? shift(state.project.storages) : undefined,
        annotations: state.project.annotations ? shift(state.project.annotations) : undefined,
        pockets: (state.project.pockets ?? []).map((entry) => {
          if (entry.id === pocketId) {
            return { ...entry, position, size };
          }
          if (entry.parentPocketId === pocketId && (dx !== 0 || dy !== 0)) {
            return {
              ...entry,
              position: { x: entry.position.x + dx, y: entry.position.y + dy },
            };
          }
          return entry;
        }),
      });
      return withProjectHistory(state, { project });
    });
  },
  setPocketSize: (pocketId, size) => {
    set((state) => {
      const snapped = {
        width: Math.max(BOARD_WINDOW_MIN_WIDTH, snapSizeUpToGrid(size.width)),
        height: Math.max(BOARD_WINDOW_MIN_HEIGHT, snapSizeUpToGrid(size.height)),
      };
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (
        !pocket ||
        (pocket.size?.width === snapped.width && pocket.size?.height === snapped.height)
      ) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, size: snapped } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  setPendingBoardSelection: (ids) => {
    // Every caller that hands the selection to a set of ids has just created
    // them: a paste, a blueprint dropped in, a pocket packed or unpacked. So this
    // is also where "just placed" gets marked. Clearing (the board consuming the
    // handover) leaves the mark alone — the flash outlives the handover.
    set((state) =>
      ids && ids.length > 0
        ? {
            pendingBoardSelectionIds: ids,
            placedBoardIds: ids,
            placedBoardToken: state.placedBoardToken + 1,
          }
        : { pendingBoardSelectionIds: ids },
    );
  },
  setSelectedBoardIds: (ids) => {
    set((state) => {
      if (
        state.selectedBoardIds.length === ids.length &&
        state.selectedBoardIds.every((id, index) => id === ids[index])
      ) {
        return state;
      }
      return { selectedBoardIds: ids };
    });
  },
  focusBoardNode: (nodeId) => {
    set((state) => ({
      boardFocusRequest: {
        mode: "centre",
        nodeIds: [nodeId],
        token: (state.boardFocusRequest?.token ?? 0) + 1,
      },
    }));
  },
  frameBoardNodes: (nodeIds, framing) => {
    set((state) => ({
      boardFocusRequest: {
        mode: "fit",
        nodeIds: nodeIds ?? [],
        framing,
        token: (state.boardFocusRequest?.token ?? 0) + 1,
      },
    }));
  },
  moveBoardCamera: (camera) => {
    set((state) => ({
      boardFocusRequest: {
        mode: "viewport",
        nodeIds: [],
        camera,
        token: (state.boardFocusRequest?.token ?? 0) + 1,
      },
    }));
  },
  connectNodes: (sourceNodeId, targetNodeId, resource) => {
    get().connectNodesBatch([{ sourceNodeId, targetNodeId, resource }]);
  },
  connectNodesBatch: (connections) => {
    set((state) => {
      let project = state.project;
      let changed = false;
      let removedAny = false;
      for (const { sourceNodeId, targetNodeId, resource } of connections) {
        const edge = buildEdgeBetweenNodes(project, sourceNodeId, targetNodeId, resource);
        if (!edge) {
          continue;
        }

        const duplicateEdge = findDuplicateEdge(project.edges, edge);
        if (duplicateEdge) {
          project = {
            ...project,
            edges: project.edges.filter((entry) => entry.id !== duplicateEdge.id),
          };
          changed = true;
          removedAny = true;
          continue;
        }

        if (hasStorageEndpointConflict(project, edge)) {
          continue;
        }

        project = applyEdgeInputOverride(
          {
            ...project,
            edges: [...project.edges, edge],
          },
          edge,
          resource,
        );
        changed = true;
      }

      if (!changed) {
        return state;
      }

      const finalProject = touchProject(removedAny ? pruneOrphanStorages(project) : project);
      return withProjectHistory(state, {
        project: finalProject,
        lastResult: solveBooks(finalProject),
      });
    });
  },
  connectCrossFormEdge: (source, target, resource, litresPerCell) => {
    set((state) => {
      if (!(litresPerCell > 0)) {
        return state;
      }
      const edge: FactoryEdge = {
        id: createId("edge"),
        source: source.nodeId,
        target: target.nodeId,
        sourceHandle: source.handleId,
        targetHandle: target.handleId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        label: resource.displayName,
        crossForm: { litresPerCell },
      };
      if (findDuplicateEdge(state.project.edges, edge)) {
        return state;
      }
      const finalProject = touchProject({
        ...state.project,
        edges: [...state.project.edges, edge],
      });
      return withProjectHistory(state, {
        project: finalProject,
        lastResult: solveBooks(finalProject),
      });
    });
  },
  reconnectEdge: (edgeId, connection) => {
    set((state) => {
      const oldEdge = state.project.edges.find((edge) => edge.id === edgeId);
      if (!oldEdge || !connection.source || !connection.target) {
        return state;
      }

      const sourceHandle = parseResourceHandleId(connection.sourceHandle);
      const targetHandle = parseResourceHandleId(connection.targetHandle);
      const isReverseHandleDirection =
        sourceHandle?.side === "input" && targetHandle?.side === "output";
      const resource =
        sourceHandle &&
        targetHandle &&
        sourceHandle.side !== targetHandle.side &&
        sourceHandle.kind === targetHandle.kind &&
        sourceHandle.resourceId === targetHandle.resourceId
          ? {
              kind: sourceHandle.kind,
              id: sourceHandle.resourceId,
              displayName: oldEdge.label,
              sourceHandle: isReverseHandleDirection
                ? (connection.targetHandle ?? undefined)
                : (connection.sourceHandle ?? undefined),
              targetHandle: isReverseHandleDirection
                ? (connection.sourceHandle ?? undefined)
                : (connection.targetHandle ?? undefined),
            }
          : undefined;
      const sourceNodeId = isReverseHandleDirection ? connection.target : connection.source;
      const targetNodeId = isReverseHandleDirection ? connection.source : connection.target;

      if (connection.sourceHandle || connection.targetHandle) {
        if (!resource) {
          return state;
        }
      }

      const projectWithoutOld = {
        ...state.project,
        edges: state.project.edges.filter((edge) => edge.id !== edgeId),
      };
      const edge = buildEdgeBetweenNodes(projectWithoutOld, sourceNodeId, targetNodeId, resource);
      if (!edge) {
        const project = touchProject(pruneOrphanStorages(projectWithoutOld));
        return withProjectHistory(state, {
          project,
          lastResult: solveBooks(project),
        });
      }

      const duplicateEdge = findDuplicateEdge(projectWithoutOld.edges, edge);
      if (!duplicateEdge && hasStorageEndpointConflict(projectWithoutOld, edge)) {
        return state;
      }

      const projectWithEdge = pruneOrphanStorages({
        ...projectWithoutOld,
        edges: duplicateEdge
          ? projectWithoutOld.edges.filter((entry) => entry.id !== duplicateEdge.id)
          : [...projectWithoutOld.edges, edge],
      });
      const project = touchProject(
        duplicateEdge ? projectWithEdge : applyEdgeInputOverride(projectWithEdge, edge),
      );

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  updateEdge: (edgeId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        edges: state.project.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...patch } : edge,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  autoConnectNode: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return state;
      }

      const edges: FactoryEdge[] = [];
      const existingAndPending = [...state.project.edges];

      for (const otherNode of state.project.nodes) {
        if (otherNode.id === nodeId) {
          continue;
        }

        for (const edge of [
          ...buildCompatibleEdgesBetweenNodes(state.project, otherNode.id, nodeId),
          ...buildCompatibleEdgesBetweenNodes(state.project, nodeId, otherNode.id),
        ]) {
          if (!hasDuplicateEdge(existingAndPending, edge)) {
            edges.push(edge);
            existingAndPending.push(edge);
          }
        }
      }

      if (edges.length === 0) {
        return state;
      }

      const project = touchProject(
        applyEdgeInputOverrides(
          {
            ...state.project,
            edges: [...state.project.edges, ...edges],
          },
          edges,
        ),
      );

      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  optimizeMachineCount: (nodeId) => {
    set((state) => {
      const currentNode = state.project.nodes.find((node) => node.id === nodeId);
      if (!currentNode) {
        return state;
      }

      const machineCount = optimizeMachineCountsForProject(state.project).machineCounts.get(nodeId);
      if (machineCount === undefined || machineCount === currentNode.machineCount) {
        return state;
      }

      const touchedProject = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((node) =>
          node.id === nodeId ? { ...node, machineCount } : node,
        ),
      });
      return withProjectHistory(state, {
        project: touchedProject,
        lastResult: solveBooks(touchedProject),
      });
    });
  },
  optimizeMachineCounts: () => {
    set((state) => {
      if (state.project.nodes.length === 0) {
        return state;
      }

      const optimized = optimizeMachineCountsForProject(state.project);
      const project = {
        ...state.project,
        nodes: state.project.nodes.map((node) => {
          const machineCount = optimized.machineCounts.get(node.id);
          return machineCount === undefined || machineCount === node.machineCount
            ? node
            : { ...node, machineCount };
        }),
      };

      if (haveSameMachineCounts(state.project, project)) {
        return state;
      }

      const touchedProject = touchProject(project);
      return withProjectHistory(state, {
        project: touchedProject,
        lastResult: solveBooks(touchedProject),
      });
    });
  },
  deleteEdge: (edgeId) => {
    set((state) => {
      const ids = new Set(Array.isArray(edgeId) ? edgeId : [edgeId]);
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          edges: state.project.edges.filter((edge) => !ids.has(edge.id)),
        }),
      );
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setTargetRate: (targetRate) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        targetRate,
      });
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  setSetupRules: (rules) => {
    set((state) => {
      const { assumeBoundaries: _legacy, ...rest } = state.project;
      const project = touchProject({
        ...rest,
        setupRules: packSetupRules({ ...getSetupRules(state.project), ...rules }),
      });
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  selectFuelProfile: (fuelProfileId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        selectedFuelProfileId: fuelProfileId,
      });
      return withProjectHistory(state, {
        project,
        lastResult: solveBooks(project),
      });
    });
  },
  renameProject: (name) => {
    set((state) => {
      if (name === state.project.name) {
        return state;
      }

      // No throughput recalculation: a name cannot change a rate, and the solve
      // is the expensive part of every other mutation here.
      return withProjectHistory(state, {
        project: touchProject({ ...state.project, name }),
      });
    });
  },
}));

function withProjectHistory(
  state: FactoryStore,
  updates: Partial<FactoryStore> & { project?: FactoryProject },
): Partial<FactoryStore> {
  if (!updates.project || updates.project === state.project) {
    return updates;
  }

  return {
    ...updates,
    undoHistory: pushProjectHistory(state.undoHistory, state.project),
    redoHistory: [],
  };
}

function pushProjectHistory(history: FactoryProject[], project: FactoryProject): FactoryProject[] {
  return [...history, project].slice(-PROJECT_HISTORY_LIMIT);
}

function restoreProjectState(
  state: FactoryStore,
  project: FactoryProject,
): Pick<FactoryStore, "project" | "selectedNodeId" | "selectedRecipeId" | "lastResult"> {
  const selectedNode = state.selectedNodeId
    ? project.nodes.find((node) => node.id === state.selectedNodeId)
    : undefined;
  const selectedRecipe = state.selectedRecipeId
    ? project.recipes.find((recipe) => recipe.id === state.selectedRecipeId)
    : undefined;

  return {
    project,
    selectedNodeId: selectedNode?.id ?? project.nodes[0]?.id,
    selectedRecipeId:
      selectedNode?.recipeId ??
      selectedRecipe?.id ??
      project.nodes[0]?.recipeId ??
      project.recipes[0]?.id,
    lastResult: solveBooks(project),
  };
}

function canConnectPendingSlots(
  first: PendingResourceConnection,
  second: PendingResourceConnection,
): boolean {
  const firstResource = {
    kind: first.kind,
    id: first.resourceId,
    alternatives: first.alternatives,
  };
  const secondResource = {
    kind: second.kind,
    id: second.resourceId,
    alternatives: second.alternatives,
  };
  const input = first.side === "input" ? firstResource : secondResource;
  const output = first.side === "output" ? firstResource : secondResource;

  return (
    first.side !== second.side && first.kind === second.kind && resourceMatchesInput(output, input)
  );
}

function findRecipeForPlanning(state: FactoryStore, recipeId: string): Recipe | undefined {
  return (
    state.dataset?.recipes.find((recipe) => recipe.id === recipeId) ??
    state.project.recipes.find((recipe) => recipe.id === recipeId)
  );
}

function addRecipeNodeToState(
  state: FactoryStore,
  recipe: Recipe,
  resource?: RecipeInputContextResource,
  options?: {
    colorTag?: FactoryNodeColorTag;
    machineHandlerId?: string;
    inputPicks?: RecipeInputPicks;
    focusCamera?: boolean;
    /** Power cards: the settings the picker dialed in before placing. */
    machineConfigTiers?: Record<string, string>;
  },
): Partial<FactoryStore> {
  const index = state.project.nodes.length;
  const viewportPosition = state.flowViewportCenter
    ? snapPositionToGrid({
        x: state.flowViewportCenter.x - RECIPE_NODE_WIDTH / 2,
        y: state.flowViewportCenter.y - 160,
      })
    : undefined;
  const desiredPosition =
    viewportPosition ??
    snapPositionToGrid({
      x: 100 + index * 80,
      y: 120 + (index % 4) * 80,
    });
  // Never on top of anything: the same magnet a drag obeys, applied at spawn.
  const position = snapPositionToGrid(
    nearestFreeSpot(
      { ...desiredPosition, width: RECIPE_NODE_WIDTH, height: BOARD_GRID * 14 },
      projectBlockerRects(state.project),
      BOARD_GRID,
    ),
  );
  // A machine picked in the recipe finder spawns the node with that handler
  // selected, at the handler's own minimum tier.
  const spawnHandler = options?.machineHandlerId
    ? recipe.machineHandlers?.find((handler) => handler.id === options.machineHandlerId)
    : undefined;
  const node: FactoryNode = {
    id: createId("node"),
    recipeId: recipe.id,
    machineCount: 1,
    parallel: 1,
    machineHandlerId: spawnHandler?.id,
    machineConfigTiers: options?.machineConfigTiers,
    overclockTier: spawnHandler?.minimumTier ?? recipe.minimumTier,
    recipeInputOverrides: mergeRecipeInputOverrides(
      resource ? buildRecipeInputOverrides(recipe, resource) : undefined,
      buildRecipeInputPickOverrides(recipe, options?.inputPicks),
    ),
    // A crop picked out of the recipe book is the same card the Sprout button
    // drops, so it spawns green like that one rather than as a grey machine.
    colorTag: options?.colorTag ?? (isCropFarmRecipe(recipe) ? "green" : undefined),
    enabled: true,
    position,
  };
  const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
  const project = touchProject({
    ...state.project,
    recipes: recipeAlreadyInProject
      ? state.project.recipes.map((entry) =>
          entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
        )
      : [...state.project.recipes, recipe],
    nodes: [...state.project.nodes, node],
  });

  return withProjectHistory(state, {
    project,
    selectedNodeId: node.id,
    selectedRecipeId: recipe.id,
    placedBoardIds: [node.id],
    placedBoardToken: state.placedBoardToken + 1,
    // The magnet can carry the card away from the viewport centre, so the
    // camera goes to where it actually landed.
    ...(options?.focusCamera
      ? {
          boardFocusRequest: {
            mode: "centre" as const,
            nodeIds: [node.id],
            token: (state.boardFocusRequest?.token ?? 0) + 1,
          },
        }
      : {}),
    lastResult: solveBooks(project),
  });
}

function addConnectedRecipeNodeToState(
  state: FactoryStore,
  recipe: Recipe,
  anchorNodeId: string,
  resource: RecipeInputContextResource,
  options?: { machineHandlerId?: string; inputPicks?: RecipeInputPicks },
): Partial<FactoryStore> {
  const anchorNode = state.project.nodes.find((node) => node.id === anchorNodeId);
  const anchorRecipe = state.project.recipes.find((entry) => entry.id === anchorNode?.recipeId);

  if (!anchorNode || !anchorRecipe) {
    // The anchor can be deleted while the search sits open; the add still
    // lands, just unwired and wherever there is room.
    return addRecipeNodeToState(state, recipe, resource, { ...options, focusCamera: true });
  }

  const spawnHandler = options?.machineHandlerId
    ? recipe.machineHandlers?.find((handler) => handler.id === options.machineHandlerId)
    : undefined;
  // "recipes" asked who MAKES the clicked thing, so the new card feeds the
  // anchor and stands upstream of it; "uses" is the mirror.
  const feedsAnchor = resource.mode === "recipes";
  const anchorFrame =
    anchorNode.pocketId !== undefined
      ? computeOpenBoardRects(computeBoardLevelView(state.project).openBoards).find(
          (rect) => rect.id === anchorNode.pocketId,
        )
      : undefined;
  const beside = snapPositionToGrid({
    x: anchorNode.position.x + (feedsAnchor ? -440 : 440),
    y: anchorNode.position.y,
  });
  // Inside an open board the classic beside-spot stands - the frame is the
  // player's own room to arrange. On the open canvas the magnet finds clear
  // floor so the newcomer never lands on another card.
  const position = anchorFrame
    ? beside
    : snapPositionToGrid(
        nearestFreeSpot(
          { ...beside, width: RECIPE_NODE_WIDTH, height: BOARD_GRID * 14 },
          projectBlockerRects(state.project),
          BOARD_GRID,
        ),
      );

  const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
  const nextNode: FactoryNode = {
    id: createId("node"),
    recipeId: recipe.id,
    machineCount: 1,
    parallel: 1,
    machineHandlerId: spawnHandler?.id,
    overclockTier: spawnHandler?.minimumTier ?? recipe.minimumTier,
    recipeInputOverrides: mergeRecipeInputOverrides(
      buildRecipeInputOverrides(recipe, resource),
      buildRecipeInputPickOverrides(recipe, options?.inputPicks),
    ),
    colorTag: isCropFarmRecipe(recipe) ? "green" : undefined,
    enabled: true,
    position,
    // Spawned beside its anchor, in the anchor's own coordinates - so it
    // joins the anchor's board and the relative placement stays true.
    pocketId: anchorFrame ? anchorNode.pocketId : undefined,
  };

  const projectWithNode: FactoryProject = {
    ...state.project,
    recipes: recipeAlreadyInProject
      ? state.project.recipes.map((entry) =>
          entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
        )
      : [...state.project.recipes, recipe],
    nodes: [...state.project.nodes, nextNode],
  };

  // The wire the click promised: the browsed resource, maker to taker, laid
  // only where the two recipes actually meet on it. A pick that no longer
  // touches the clicked resource simply lands unwired.
  const wires = buildResourceEdgesBetweenNodes(
    projectWithNode,
    feedsAnchor ? nextNode.id : anchorNodeId,
    feedsAnchor ? anchorNodeId : nextNode.id,
    resource,
  );
  const projectWired =
    wires.length > 0
      ? applyEdgeInputOverrides(
          { ...projectWithNode, edges: [...projectWithNode.edges, ...wires] },
          wires,
        )
      : projectWithNode;

  const project = touchProject(projectWired);

  return withProjectHistory(state, {
    project,
    selectedNodeId: nextNode.id,
    selectedRecipeId: recipe.id,
    placedBoardIds: [nextNode.id],
    placedBoardToken: state.placedBoardToken + 1,
    boardFocusRequest: {
      mode: "centre" as const,
      nodeIds: [nextNode.id],
      token: (state.boardFocusRequest?.token ?? 0) + 1,
    },
    lastResult: solveBooks(project),
  });
}

/**
 * Everything solid on the canvas as flow-space rects: cards, drawers,
 * minimized board cards, and every OPEN frame as one whole rect - a spawned
 * card never lands inside somebody's board uninvited. Members hidden inside
 * a minimized board block nothing, exactly as they render. Footprints are
 * the same estimates the wrap tool uses; overshooting only spreads cards out.
 */
function projectBlockerRects(project: FactoryProject): PlacementRect[] {
  const view = computeBoardLevelView(project);
  const frameOrigins = new Map(
    computeOpenBoardRects(view.openBoards).map((rect) => [rect.id, rect] as const),
  );
  const absolutize = (
    position: { x: number; y: number },
    home: string | undefined,
  ): { x: number; y: number } => {
    const origin = home !== undefined ? frameOrigins.get(home) : undefined;
    return origin ? { x: position.x + origin.x, y: position.y + origin.y } : position;
  };
  const visible = (home: string | undefined) => home === undefined || frameOrigins.has(home);

  const rects: PlacementRect[] = [];
  for (const node of project.nodes) {
    if (!visible(node.pocketId)) {
      continue;
    }
    rects.push({
      ...absolutize(node.position, node.pocketId),
      width: RECIPE_NODE_WIDTH,
      height: BOARD_GRID * 14,
    });
  }
  for (const storage of project.storages ?? []) {
    if (!visible(storage.pocketId)) {
      continue;
    }
    rects.push({
      ...absolutize(storage.position, storage.pocketId),
      width: STORAGE_NODE_WIDTH,
      height: STORAGE_NODE_HEIGHT,
    });
  }
  for (const pocket of project.pockets ?? []) {
    if (!visible(pocket.parentPocketId)) {
      continue;
    }
    rects.push({
      ...absolutize(pocket.position, pocket.parentPocketId),
      width: pocket.expanded ? boardWindowSize(pocket).width : RECIPE_NODE_WIDTH,
      height: pocket.expanded ? boardWindowSize(pocket).height : BOARD_GRID * 14,
    });
  }
  return rects;
}

/**
 * {@link buildCompatibleEdgesBetweenNodes} narrowed to ONE resource: the one
 * whose port row was clicked. Wiring every compatible pair would also hook up
 * byproducts nobody asked about.
 */
function buildResourceEdgesBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
): FactoryEdge[] {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return [];
  }

  const matchesResource = (slot: ResourceAmount) =>
    (slot.kind === resource.kind && slot.id === resource.id) ||
    resourceMatchesInput(resource, slot);
  const effectiveSource = applyRecipeInputOverrides(sourceRecipe, sourceNode);
  const effectiveTarget = applyRecipeInputOverrides(targetRecipe, targetNode);
  const edges: FactoryEdge[] = [];

  effectiveSource.outputs.forEach((output, outputIndex) => {
    if (!matchesResource(output)) {
      return;
    }
    effectiveTarget.inputs.forEach((input, inputIndex) => {
      if (
        !isRecipeInputConsumed(input) ||
        !resourceMatchesInput(output, input) ||
        !matchesResource(input)
      ) {
        return;
      }
      edges.push({
        id: createId("edge"),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: output.kind,
        resourceId: output.id,
        label: resourceLabel(output),
      });
    });
  });

  return dedupeEdgeWires(edges);
}

/**
 * The refactor's landing. The pick replaces the card IN PLACE when at least
 * one of its wires still has a matching port on the new recipe - a card with
 * no wires replaces trivially - and the surviving wires re-dock onto the new
 * recipe's slots while the rest are dropped. When every wire would be lost,
 * the old card is left standing and the pick lands beside it instead: a
 * replace that severs everything is not a refactor.
 */
function refactorNodeToState(
  state: FactoryStore,
  nodeId: string,
  recipe: Recipe,
  options?: { machineHandlerId?: string; machineConfigTiers?: Record<string, string> },
): Partial<FactoryStore> {
  const node = state.project.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return addRecipeNodeToState(state, recipe, undefined, { ...options, focusCamera: true });
  }
  if (node.recipeId === recipe.id) {
    return state;
  }

  const spawnHandler = options?.machineHandlerId
    ? recipe.machineHandlers?.find((handler) => handler.id === options.machineHandlerId)
    : undefined;
  const touching = state.project.edges.filter(
    (edge) => edge.source === nodeId || edge.target === nodeId,
  );
  const carried: FactoryEdge[] = [];
  for (const edge of touching) {
    const wireResource = { kind: edge.resourceKind, id: edge.resourceId };
    const matchesWire = (slot: ResourceAmount) =>
      (slot.kind === wireResource.kind && slot.id === wireResource.id) ||
      resourceMatchesInput(wireResource, slot);
    if (edge.source === nodeId) {
      const outputIndex = recipe.outputs.findIndex(matchesWire);
      if (outputIndex >= 0) {
        carried.push({
          ...edge,
          sourceHandle: makeResourceHandleId("output", recipe.outputs[outputIndex], outputIndex),
        });
      }
    } else {
      const inputIndex = recipe.inputs.findIndex(
        (input) => isRecipeInputConsumed(input) && matchesWire(input),
      );
      if (inputIndex >= 0) {
        carried.push({
          ...edge,
          targetHandle: makeResourceHandleId("input", recipe.inputs[inputIndex], inputIndex),
        });
      }
    }
  }

  if (touching.length > 0 && carried.length === 0) {
    // Nothing survives: the pick lands beside the old card, which stays.
    const context: RecipeInputContextResource = {
      kind: recipe.outputs[0]?.kind ?? "item",
      id: recipe.outputs[0]?.id ?? recipe.id,
      mode: "uses",
    };
    return addConnectedRecipeNodeToState(state, recipe, nodeId, context, options);
  }

  const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
  const projectBase: FactoryProject = {
    ...state.project,
    recipes: recipeAlreadyInProject
      ? state.project.recipes.map((entry) =>
          entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
        )
      : [...state.project.recipes, recipe],
    nodes: state.project.nodes.map((entry) =>
      entry.id === nodeId
        ? {
            ...entry,
            recipeId: recipe.id,
            machineHandlerId: spawnHandler?.id,
            overclockTier: spawnHandler?.minimumTier ?? recipe.minimumTier,
            // A power pick carries its dialed settings into the swap; every
            // other refactor resets the knobs as before.
            machineConfigTiers: options?.machineConfigTiers,
            coilTier: undefined,
            recipeInputOverrides: undefined,
          }
        : entry,
    ),
    edges: [
      ...state.project.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      ...carried,
    ],
  };
  // A power card OWNS its recipe; swapping away from one would strand it.
  const oldRecipe = state.project.recipes.find((entry) => entry.id === node.recipeId);
  if (
    oldRecipe &&
    isPowerRecipe(oldRecipe) &&
    !projectBase.nodes.some((entry) => entry.recipeId === oldRecipe.id)
  ) {
    projectBase.recipes = projectBase.recipes.filter((entry) => entry.id !== oldRecipe.id);
  }
  const project = touchProject(
    pruneOrphanStorages(applyEdgeInputOverrides(projectBase, carried)),
  );

  return withProjectHistory(state, {
    project,
    selectedNodeId: nodeId,
    selectedRecipeId: recipe.id,
    placedBoardIds: [nodeId],
    placedBoardToken: state.placedBoardToken + 1,
    boardFocusRequest: {
      mode: "centre" as const,
      nodeIds: [nodeId],
      token: (state.boardFocusRequest?.token ?? 0) + 1,
    },
    lastResult: solveBooks(project),
  });
}

/**
 * The item each cycling input slot was showing when the node was added, keyed by
 * input index.
 *
 * A slot that rotates through an oredict's members has to commit to one of them
 * on the board, because a node asks for a definite thing. Whatever face was
 * visible at the moment the player clicked is that commitment, whether they
 * scrolled to it deliberately or let it land there.
 */
export type RecipeInputPicks = Record<number, AlternativeCycleFace>;

function buildRecipeInputPickOverrides(
  recipe: Recipe,
  picks: RecipeInputPicks | undefined,
): FactoryNode["recipeInputOverrides"] {
  if (!picks) {
    return undefined;
  }

  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  for (const [key, face] of Object.entries(picks)) {
    const index = Number(key);
    const input = recipe.inputs[index];
    if (!input || !face) {
      continue;
    }

    overrides[key] = {
      ...input,
      kind: face.kind,
      id: face.id,
      // A face's own `amount` is a per-unit ratio, not a stack size, so the
      // recipe's requirement is restated through the shared helper rather than
      // spread over.
      amount: inputOverrideAmount(input, face.kind, face),
      displayName: face.displayName ?? input.displayName,
      iconPath: face.iconPath ?? input.iconPath,
      iconAtlas: face.iconAtlas ?? input.iconAtlas,
      dominantColor: face.dominantColor ?? input.dominantColor,
      tooltip: face.tooltip ?? input.tooltip,
      modId: face.modId ?? input.modId,
      alternatives: undefined,
    };
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function mergeRecipeInputOverrides(
  base: FactoryNode["recipeInputOverrides"],
  picks: FactoryNode["recipeInputOverrides"],
): FactoryNode["recipeInputOverrides"] {
  if (!base) {
    return picks;
  }
  if (!picks) {
    return base;
  }
  // A deliberately scrolled slot outranks the resource the browser was opened
  // from; they only ever collide on the same slot when both name it.
  return { ...base, ...picks };
}

function buildRecipeInputOverrides(
  recipe: Recipe,
  resource: RecipeInputContextResource,
): FactoryNode["recipeInputOverrides"] {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  recipe.inputs.forEach((input, index) => {
    if (input.kind !== resource.kind) {
      return;
    }
    const matchesSlot =
      resource.neiSlot &&
      input.neiSlot &&
      resource.neiSlot.x === input.neiSlot.x &&
      resource.neiSlot.y === input.neiSlot.y;
    const matchesIndex = resource.neiSlot === undefined && resource.inputIndex === index;
    const matchesResource =
      resource.neiSlot === undefined &&
      resource.inputIndex === undefined &&
      resourceMatchesInput(resource, input);
    if (!matchesSlot && !matchesIndex && !matchesResource) {
      return;
    }

    const alternative = input.alternatives?.find(
      (entry) => entry.kind === resource.kind && entry.id === resource.id,
    );

    overrides[String(index)] = {
      ...input,
      ...alternative,
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName ?? alternative?.displayName ?? input.displayName,
      iconPath: resource.iconPath ?? alternative?.iconPath ?? input.iconPath,
      iconAtlas: resource.iconAtlas ?? alternative?.iconAtlas ?? input.iconAtlas,
      dominantColor: resource.dominantColor ?? alternative?.dominantColor ?? input.dominantColor,
      tooltip: resource.tooltip ?? alternative?.tooltip ?? input.tooltip,
      modId: resource.modId ?? alternative?.modId ?? input.modId,
      alternatives: undefined,
    };
  });

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function mergeRecipe(existing: Recipe, incoming: Recipe): Recipe {
  return {
    ...existing,
    ...incoming,
    inputs: incoming.inputs.length > 0 ? incoming.inputs : existing.inputs,
    outputs: incoming.outputs.length > 0 ? incoming.outputs : existing.outputs,
    nei: incoming.nei ?? existing.nei,
    machineHandlers: incoming.machineHandlers ?? existing.machineHandlers,
    machineConfigControls: incoming.machineConfigControls ?? existing.machineConfigControls,
  };
}

function mergeRefreshedRecipe(incoming: Recipe): Recipe {
  return {
    ...incoming,
  };
}

function buildRecipeInputOverridesFromContextualRecipeInputs(
  existingRecipe: Recipe,
  refreshedRecipe: Recipe,
): NonNullable<FactoryNode["recipeInputOverrides"]> {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  refreshedRecipe.inputs.forEach((refreshedInput, index) => {
    const existingInput = existingRecipe.inputs[index];
    if (!existingInput || !isContextualRecipeInput(existingInput, refreshedInput)) {
      return;
    }

    overrides[String(index)] = {
      ...refreshedInput,
      id: existingInput.id,
      displayName: existingInput.displayName ?? refreshedInput.displayName,
      iconPath: existingInput.iconPath ?? refreshedInput.iconPath,
      iconAtlas: existingInput.iconAtlas ?? refreshedInput.iconAtlas,
      dominantColor: existingInput.dominantColor ?? refreshedInput.dominantColor,
      tooltip: existingInput.tooltip ?? refreshedInput.tooltip,
      alternatives: undefined,
    };
  });

  return overrides;
}

function isContextualRecipeInput(
  existingInput: Recipe["inputs"][number],
  refreshedInput: Recipe["inputs"][number],
): boolean {
  return (
    existingInput.kind === refreshedInput.kind &&
    existingInput.id !== refreshedInput.id &&
    !isOreDictionaryResource(existingInput) &&
    resourceMatchesInput({ kind: existingInput.kind, id: existingInput.id }, refreshedInput)
  );
}

function applyEdgeInputOverrides(project: FactoryProject, edges: FactoryEdge[]): FactoryProject {
  return edges.reduce((nextProject, edge) => applyEdgeInputOverride(nextProject, edge), project);
}

function applyEdgeInputOverride(
  project: FactoryProject,
  edge: FactoryEdge,
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  > &
    Partial<Pick<ResourceAmount, "amount">>,
): FactoryProject {
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);
  if (!targetNode || !targetRecipe) {
    return project;
  }
  // Power cards: never stamp an input override. Their slots are exact (no
  // oredict, no alternatives), and a stamped override OUTLIVES the wire -
  // wiring benzene once left the slot benzene through every later fuel
  // switch, because the override repainted whatever the rebuilt recipe said.
  if (targetRecipe.power) {
    return project;
  }

  const targetHandle = parseResourceHandleId(edge.targetHandle);
  const inputIndex =
    targetHandle?.side === "input" && targetHandle.slotIndex !== undefined
      ? targetHandle.slotIndex
      : targetRecipe.inputs.findIndex(
          (input) =>
            isRecipeInputConsumed(input) &&
            resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
        );
  const input = inputIndex >= 0 ? targetRecipe.inputs[inputIndex] : undefined;
  if (
    !input ||
    !isRecipeInputConsumed(input) ||
    !resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input)
  ) {
    return project;
  }

  const alternative = input.alternatives?.find(
    (entry) => entry.kind === edge.resourceKind && entry.id === edge.resourceId,
  );
  const override: Recipe["inputs"][number] = {
    ...input,
    ...alternative,
    kind: edge.resourceKind,
    id: edge.resourceId,
    // Only converts when the kind actually changes — see the helper. Taking
    // the cell's fluid amount unconditionally inflated same-kind cell wiring
    // by 1000×.
    amount: resource?.amount ?? inputOverrideAmount(input, edge.resourceKind, alternative),
    displayName:
      resource?.displayName ?? edge.label ?? alternative?.displayName ?? input.displayName,
    iconPath: resource?.iconPath ?? alternative?.iconPath ?? input.iconPath,
    iconAtlas: resource?.iconAtlas ?? alternative?.iconAtlas ?? input.iconAtlas,
    dominantColor: resource?.dominantColor ?? alternative?.dominantColor ?? input.dominantColor,
    tooltip: resource?.tooltip ?? alternative?.tooltip ?? input.tooltip,
    alternatives: undefined,
  };

  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === targetNode.id
        ? {
            ...node,
            recipeInputOverrides: {
              ...node.recipeInputOverrides,
              [String(inputIndex)]: override,
            },
          }
        : node,
    ),
  };
}

function pruneOrphanStorages(project: FactoryProject): FactoryProject {
  const storages = project.storages ?? [];
  if (storages.length === 0) {
    return project;
  }

  const linkedStorageIds = new Set<string>();
  for (const edge of project.edges) {
    linkedStorageIds.add(edge.source);
    linkedStorageIds.add(edge.target);
  }

  const nextStorages = storages.filter((storage) => linkedStorageIds.has(storage.id));
  return nextStorages.length === storages.length ? project : { ...project, storages: nextStorages };
}

function pruneInvalidEdgesAndOrphanStorages(project: FactoryProject): FactoryProject {
  const validEdges = project.edges.filter((edge) => isFactoryEdgeStillValid(project, edge));
  const projectWithValidEdges =
    validEdges.length === project.edges.length ? project : { ...project, edges: validEdges };
  return pruneOrphanStorages(projectWithValidEdges);
}

function isFactoryEdgeStillValid(project: FactoryProject, edge: FactoryEdge): boolean {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if ((!sourceNode && !sourceStorage) || (!targetNode && !targetStorage)) {
    return false;
  }

  // Trash cans have no recipe slots to match: a line into one stays valid as
  // long as the far end still produces the wired resource.
  if (targetRecipe && isTrashRecipe(targetRecipe)) {
    if (sourceStorage) {
      return (
        edge.resourceKind === sourceStorage.kind && edge.resourceId === sourceStorage.resourceId
      );
    }
    if (!sourceNode || !sourceRecipe) {
      return false;
    }
    const effectiveSourceRecipe = applyRecipeInputOverrides(sourceRecipe, sourceNode);
    return effectiveSourceRecipe.outputs.some((output) =>
      resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
    );
  }

  // A drawer-to-drawer line stays valid while both drawers still hold the
  // wired resource.
  if (sourceStorage && targetStorage) {
    return (
      edge.resourceKind === sourceStorage.kind &&
      edge.resourceId === sourceStorage.resourceId &&
      edge.resourceKind === targetStorage.kind &&
      edge.resourceId === targetStorage.resourceId
    );
  }

  if (sourceStorage && targetRecipe) {
    const effectiveTargetRecipe = targetNode
      ? applyRecipeInputOverrides(targetRecipe, targetNode)
      : targetRecipe;
    return (
      edge.resourceKind === sourceStorage.kind &&
      edge.resourceId === sourceStorage.resourceId &&
      effectiveTargetRecipe.inputs.some(
        (input) =>
          isRecipeInputConsumed(input) &&
          resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
      )
    );
  }

  if (sourceRecipe && targetStorage) {
    const effectiveSourceRecipe = sourceNode
      ? applyRecipeInputOverrides(sourceRecipe, sourceNode)
      : sourceRecipe;
    return (
      edge.resourceKind === targetStorage.kind &&
      edge.resourceId === targetStorage.resourceId &&
      effectiveSourceRecipe.outputs.some((output) =>
        resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
      )
    );
  }

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return false;
  }

  const effectiveSourceRecipe = applyRecipeInputOverrides(sourceRecipe, sourceNode);
  const effectiveTargetRecipe = applyRecipeInputOverrides(targetRecipe, targetNode);

  // A LOOSE CELL WIRE's two ends are honest in different forms: the source
  // must still make the wire's own resource, the target must still take the
  // far form the wire's own target handle names - the fluid under a cell
  // wire, the cell under a fluid wire.
  if (edge.crossForm) {
    const handleParts = (edge.targetHandle ?? "").split(":");
    const farKind =
      handleParts[1] === "fluid" || handleParts[1] === "item" ? handleParts[1] : undefined;
    const farId =
      handleParts[0] === "input" && farKind && handleParts[2]
        ? decodeURIComponent(handleParts[2])
        : undefined;
    return Boolean(
      farKind &&
        farId &&
        effectiveSourceRecipe.outputs.some((output) =>
          resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
        ) &&
        effectiveTargetRecipe.inputs.some(
          (input) =>
            isRecipeInputConsumed(input) &&
            resourceMatchesInput({ kind: farKind, id: farId }, input),
        ),
    );
  }

  return (
    effectiveSourceRecipe.outputs.some((output) =>
      resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
    ) &&
    effectiveTargetRecipe.inputs.some(
      (input) =>
        isRecipeInputConsumed(input) &&
        resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
    )
  );
}

function buildEdgeBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
  selectedResource?: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  > & {
    amount?: number;
    sourceHandle?: string;
    targetHandle?: string;
  },
): FactoryEdge | undefined {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if ((!sourceNode && !sourceStorage) || (!targetNode && !targetStorage)) {
    return undefined;
  }

  // Two drawers of the same resource wire together like anything else: the
  // line moves stock from one container to the other. This is how a SOURCE
  // tops up a buffer (and so a recycling loop) without pretending the loop
  // feeds itself from nowhere. A drawer cannot feed itself, and a drawer of
  // spruce logs has no business filling one of oak.
  if (sourceStorage && targetStorage) {
    if (
      sourceStorage.id === targetStorage.id ||
      !resourceMatchesInput(
        sourceStorageResource(sourceStorage),
        sourceStorageResource(targetStorage),
      )
    ) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceStorage.id,
      target: targetStorage.id,
      sourceHandle: selectedResource?.sourceHandle,
      targetHandle: selectedResource?.targetHandle,
      resourceKind: sourceStorage.kind,
      resourceId: sourceStorage.resourceId,
      label: sourceStorage.displayName ?? sourceStorage.resourceId,
    };
  }

  if (sourceStorage && targetRecipe && selectedResource) {
    const effectiveTargetRecipe = targetNode
      ? applyRecipeInputOverrides(targetRecipe, targetNode)
      : targetRecipe;
    const matchedInput = effectiveTargetRecipe.inputs.find(
      (input) =>
        sourceStorage.kind === selectedResource.kind &&
        sourceStorage.resourceId === selectedResource.id &&
        resourceMatchesInput(sourceStorageResource(sourceStorage), input) &&
        isRecipeInputConsumed(input),
    );
    if (!matchedInput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceStorage.id,
      target: targetNodeId,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: sourceStorage.kind,
      resourceId: sourceStorage.resourceId,
      label: resourceLabel(matchedInput),
    };
  }

  if (sourceRecipe && targetStorage && selectedResource) {
    const effectiveSourceRecipe = sourceNode
      ? applyRecipeInputOverrides(sourceRecipe, sourceNode)
      : sourceRecipe;
    const matchedOutput = effectiveSourceRecipe.outputs.find((output) =>
      resourceMatchesInput(sourceStorageResource(targetStorage), output),
    );
    if (!matchedOutput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceNodeId,
      target: targetStorage.id,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: targetStorage.kind,
      resourceId: targetStorage.resourceId,
      label: resourceLabel(matchedOutput),
    };
  }

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return undefined;
  }

  if (selectedResource?.sourceHandle && selectedResource.targetHandle) {
    const matchedInput = getExplicitTargetInput(targetRecipe, targetNode, selectedResource);
    if (!matchedInput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: selectedResource.kind,
      resourceId: selectedResource.id,
      label: selectedResource.displayName ?? resourceLabel(matchedInput),
    };
  }

  const matchedOutput = selectedResource
    ? sourceRecipe.outputs.find(
        (output) =>
          output.kind === selectedResource.kind &&
          output.id === selectedResource.id &&
          targetRecipe.inputs.some(
            (input) => isRecipeInputConsumed(input) && resourceMatchesInput(output, input),
          ),
      )
    : sourceRecipe.outputs.find((output) =>
        targetRecipe.inputs.some(
          (input) => isRecipeInputConsumed(input) && resourceMatchesInput(output, input),
        ),
      );

  if (!matchedOutput) {
    return undefined;
  }

  return {
    id: createId("edge"),
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle: selectedResource?.sourceHandle,
    targetHandle: selectedResource?.targetHandle,
    resourceKind: matchedOutput.kind,
    resourceId: matchedOutput.id,
    label: resourceLabel(matchedOutput),
  };
}

function getExplicitTargetInput(
  targetRecipe: Recipe,
  targetNode: FactoryNode,
  selectedResource: Pick<ResourceAmount, "kind" | "id"> & {
    targetHandle?: string;
  },
): Recipe["inputs"][number] | undefined {
  const targetHandle = parseResourceHandleId(selectedResource.targetHandle);
  const targetRecipeWithOverrides = applyRecipeInputOverrides(targetRecipe, targetNode);
  const indexedInput =
    targetHandle?.side === "input" && targetHandle.slotIndex !== undefined
      ? targetRecipeWithOverrides.inputs[targetHandle.slotIndex]
      : undefined;

  if (
    indexedInput &&
    isRecipeInputConsumed(indexedInput) &&
    resourceMatchesInput(selectedResource, indexedInput)
  ) {
    return indexedInput;
  }

  return targetRecipeWithOverrides.inputs.find(
    (input) => isRecipeInputConsumed(input) && resourceMatchesInput(selectedResource, input),
  );
}

function buildCompatibleEdgesBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
): FactoryEdge[] {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return [];
  }

  const edges: FactoryEdge[] = [];

  sourceRecipe.outputs.forEach((output, outputIndex) => {
    targetRecipe.inputs.forEach((input, inputIndex) => {
      if (!isRecipeInputConsumed(input) || !resourceMatchesInput(output, input)) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: output.kind,
        resourceId: output.id,
        label: resourceLabel(output),
      });
    });
  });

  // Slots, not rows: a recipe holding the same resource in two output slots and
  // a taker holding it in two input slots pairs up four ways, and all four land
  // on the one pair of rows the cards actually draw.
  return dedupeEdgeWires(edges);
}

function buildCompatibleEdgesForStorage(
  project: FactoryProject,
  storage: FactoryStorage,
): FactoryEdge[] {
  const edges: FactoryEdge[] = [];
  const storageInputHandle = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const storageOutputHandle = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });

  for (const node of project.nodes) {
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    if (!recipe) {
      continue;
    }
    const effectiveRecipe = applyRecipeInputOverrides(recipe, node);

    effectiveRecipe.outputs.forEach((output, outputIndex) => {
      if (!resourceMatchesInput(sourceStorageResource(storage), output)) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: node.id,
        target: storage.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: storageInputHandle,
        resourceKind: storage.kind,
        resourceId: storage.resourceId,
        label: resourceLabel(output),
      });
    });

    effectiveRecipe.inputs.forEach((input, inputIndex) => {
      if (
        input.consumed === false ||
        !resourceMatchesInput(sourceStorageResource(storage), input)
      ) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: storage.id,
        target: node.id,
        sourceHandle: storageOutputHandle,
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: storage.kind,
        resourceId: storage.resourceId,
        label: resourceLabel(input),
      });
    });
  }

  return dedupeEdgeWires(edges);
}

function sourceStorageResource(storage: FactoryStorage): Pick<ResourceAmount, "kind" | "id"> {
  return { kind: storage.kind, id: storage.resourceId };
}

function hasDuplicateEdge(edges: FactoryEdge[], edge: FactoryEdge): boolean {
  return Boolean(findDuplicateEdge(edges, edge));
}

/**
 * The edge a connect gesture would TOGGLE AWAY, if any: drawing a wire that
 * already exists deletes it (connectNodesBatch), and the drag preview turns
 * the doomed wire red before the release commits. Same construction the
 * release will run, asked hypothetically.
 */
export function findToggleDuplicateEdge(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
  resource?: Parameters<typeof buildEdgeBetweenNodes>[3],
): FactoryEdge | undefined {
  const edge = buildEdgeBetweenNodes(project, sourceNodeId, targetNodeId, resource);
  return edge ? findDuplicateEdge(project.edges, edge) : undefined;
}

/**
 * Would releasing this wire drag into the VOID leave something on the board?
 * The exact refusal logic of `addStorageForConnection`, run against a
 * hypothetical drawer and committed nowhere: a spawn survives when at least
 * one edge wires, or when nothing wired but nothing CONFLICTED either (a
 * plain build failure keeps the unwired drawer). Only a storage endpoint
 * conflict - this port row already has its drawer for this resource -
 * prunes the spawn into a no-op. The connection line asks this to color
 * the drag before the release commits to anything.
 */
export function wouldConnectionStorageSpawn(
  project: FactoryProject,
  resource: Pick<ResourceAmount, "kind" | "id">,
  nodeId: string | string[],
  side: "input" | "output",
  handleId: string,
): boolean {
  const nodeIds = Array.isArray(nodeId) ? nodeId : [nodeId];
  const storage: FactoryStorage = {
    id: "__hypothetical-spawn__",
    kind: resource.kind,
    resourceId: resource.id,
    position: { x: 0, y: 0 },
  };
  let hypothetical: FactoryProject = {
    ...project,
    storages: [...(project.storages ?? []), storage],
  };
  const selectedResource = {
    kind: resource.kind,
    id: resource.id,
    sourceHandle:
      side === "output"
        ? handleId
        : makeResourceHandleId("output", { kind: resource.kind, id: resource.id }),
    targetHandle:
      side === "input"
        ? handleId
        : makeResourceHandleId("input", { kind: resource.kind, id: resource.id }),
  };
  let wired = 0;
  let conflicted = false;
  for (const anchorId of nodeIds) {
    const edge =
      side === "output"
        ? buildEdgeBetweenNodes(hypothetical, anchorId, storage.id, selectedResource)
        : buildEdgeBetweenNodes(hypothetical, storage.id, anchorId, selectedResource);
    if (!edge) {
      continue;
    }
    if (findDuplicateEdge(hypothetical.edges, edge)) {
      continue;
    }
    if (hasStorageEndpointConflict(hypothetical, edge)) {
      conflicted = true;
      continue;
    }
    hypothetical = { ...hypothetical, edges: [...hypothetical.edges, edge] };
    wired += 1;
  }
  return wired > 0 || !conflicted;
}

function hasStorageEndpointConflict(project: FactoryProject, edge: FactoryEdge): boolean {
  if (!findEdgeStorage(project, edge)) {
    return false;
  }

  const recipeEndpointKey = getRecipeEndpointKey(project, edge);
  if (!recipeEndpointKey) {
    return false;
  }

  return project.edges.some(
    (existingEdge) =>
      findEdgeStorage(project, existingEdge) &&
      existingEdge.resourceKind === edge.resourceKind &&
      existingEdge.resourceId === edge.resourceId &&
      getRecipeEndpointKey(project, existingEdge) === recipeEndpointKey,
  );
}

function findEdgeStorage(project: FactoryProject, edge: FactoryEdge): FactoryStorage | undefined {
  return (
    (project.storages ?? []).find((storage) => storage.id === edge.source) ??
    (project.storages ?? []).find((storage) => storage.id === edge.target)
  );
}

function getRecipeEndpointKey(project: FactoryProject, edge: FactoryEdge): string | undefined {
  const sourceIsStorage = (project.storages ?? []).some((storage) => storage.id === edge.source);
  const targetIsStorage = (project.storages ?? []).some((storage) => storage.id === edge.target);

  // The port ROW is the endpoint, so the slot index comes off: one drawer per
  // row, however the wire already on it happens to spell its handle.
  if (sourceIsStorage && !targetIsStorage) {
    return `target:${edge.target}:${canonicalizeResourceHandleId(edge.targetHandle) ?? ""}`;
  }

  if (targetIsStorage && !sourceIsStorage) {
    return `source:${edge.source}:${canonicalizeResourceHandleId(edge.sourceHandle) ?? ""}`;
  }

  return undefined;
}

function makeResourceHandleId(
  side: "input" | "output",
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

function parseResourceHandleId(handleId?: string | null):
  | {
      side: "input" | "output";
      kind: ResourceKind;
      resourceId: string;
      slotIndex?: number;
    }
  | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId, encodedSlotIndex] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid") ||
    !encodedResourceId
  ) {
    return undefined;
  }

  return {
    side,
    kind,
    resourceId: decodeURIComponent(encodedResourceId),
    slotIndex:
      encodedSlotIndex !== undefined && encodedSlotIndex.trim() !== ""
        ? Number.parseInt(encodedSlotIndex, 10)
        : undefined,
  };
}

function haveSameMachineCounts(left: FactoryProject, right: FactoryProject): boolean {
  if (left.nodes.length !== right.nodes.length) {
    return false;
  }

  const rightCounts = new Map(right.nodes.map((node) => [node.id, node.machineCount]));
  return left.nodes.every((node) => rightCounts.get(node.id) === node.machineCount);
}

function touchProject(project: FactoryProject): FactoryProject {
  return {
    // Every edit passes through here, which is the one place that can promise
    // a custom rate card never keeps a resource after its last wire goes —
    // whether the wire, the machine at the far end or a whole selection was
    // what got deleted.
    ...releaseCustomRates(project),
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

function updateResourceHistory(
  history: RecipeBrowserResource[],
  resource: RecipeBrowserResource,
): RecipeBrowserResource[] {
  const entry: RecipeBrowserResource = {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
  };
  const key = getResourceKey(entry);

  return [entry, ...history.filter((item) => getResourceKey(item) !== key)].slice(
    0,
    RESOURCE_HISTORY_LIMIT,
  );
}

export function loadResourceHistory(): RecipeBrowserResource[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawHistory = window.localStorage.getItem(RESOURCE_HISTORY_STORAGE_KEY);
    if (!rawHistory) {
      return [];
    }

    return normalizeResourceHistory(JSON.parse(rawHistory));
  } catch {
    return [];
  }
}

function saveResourceHistory(history: RecipeBrowserResource[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      RESOURCE_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeResourceHistory(history)),
    );
  } catch {
    // Best effort cache: failing to persist quick access should not block browsing.
  }
}

function scheduleIdleBrowserWork(callback: () => void) {
  if (typeof window === "undefined") {
    return;
  }

  const scheduler = window as Window & {
    requestIdleCallback?: (handler: () => void, options?: { timeout: number }) => number;
  };

  if (scheduler.requestIdleCallback) {
    scheduler.requestIdleCallback(callback, { timeout: 1000 });
    return;
  }

  queueMicrotask(callback);
}

function normalizeResourceHistory(value: unknown): RecipeBrowserResource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const history: RecipeBrowserResource[] = [];

  for (const item of value) {
    if (!isStoredRecipeBrowserResource(item)) {
      continue;
    }

    const entry: RecipeBrowserResource = {
      kind: item.kind,
      id: item.id,
      displayName: item.displayName,
      iconPath: item.iconPath,
      iconAtlas: item.iconAtlas,
      dominantColor: item.dominantColor ?? item.iconAtlas?.dominantColor,
    };
    const key = getResourceKey(entry);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    history.push(entry);
    if (history.length >= RESOURCE_HISTORY_LIMIT) {
      break;
    }
  }

  return history;
}

function isStoredRecipeBrowserResource(value: unknown): value is RecipeBrowserResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const resource = value as Partial<RecipeBrowserResource>;
  return (
    (resource.kind === "item" || resource.kind === "fluid") &&
    typeof resource.id === "string" &&
    resource.id.length > 0 &&
    (resource.displayName === undefined || typeof resource.displayName === "string") &&
    (resource.iconPath === undefined || typeof resource.iconPath === "string") &&
    (resource.iconAtlas === undefined || typeof resource.iconAtlas === "object") &&
    (resource.dominantColor === undefined || typeof resource.dominantColor === "string")
  );
}

type IconResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function refreshProjectResourceIcons(
  project: FactoryProject,
  dataset: RecipeDataset,
): FactoryProject {
  const iconsByResource = getDatasetIconLookup(dataset);

  return {
    ...project,
    recipes: project.recipes.map((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((input) => refreshResourceIcon(input, iconsByResource)),
      outputs: recipe.outputs.map((output) => refreshResourceIcon(output, iconsByResource)),
    })),
    storages: project.storages?.map((storage) => refreshStorageIcon(storage, iconsByResource)),
  };
}

function refreshResourceHistoryIcons(
  history: RecipeBrowserResource[],
  dataset: RecipeDataset,
): RecipeBrowserResource[] {
  const iconsByResource = getDatasetIconLookup(dataset);
  return history.map((resource) => refreshBrowserResourceIcon(resource, dataset, iconsByResource));
}

function refreshBrowserResourceIcon(
  resource: RecipeBrowserResource,
  dataset: RecipeDataset,
  iconsByResource = getDatasetIconLookup(dataset),
): RecipeBrowserResource {
  return refreshResourceIcon(resource, iconsByResource);
}

function refreshPendingResourceConnectionIcon(
  resource: PendingResourceConnection,
  dataset: RecipeDataset,
): PendingResourceConnection {
  const indexed = getDatasetIconLookup(dataset).get(`${resource.kind}:${resource.resourceId}`);
  if (!indexed) {
    return resource;
  }

  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

function refreshStorageIcon(
  storage: FactoryStorage,
  iconsByResource: Map<string, IconResource>,
): FactoryStorage {
  const indexed = iconsByResource.get(`${storage.kind}:${storage.resourceId}`);
  if (!indexed) {
    return storage;
  }

  return {
    ...storage,
    displayName: storage.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? storage.dominantColor,
  };
}

function refreshResourceIcon<T extends IconResource>(
  resource: T,
  iconsByResource: Map<string, IconResource>,
): T {
  const indexed = iconsByResource.get(getResourceKey(resource));
  if (!indexed) {
    return resource;
  }

  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

function getDatasetIconLookup(dataset: RecipeDataset): Map<string, IconResource> {
  const iconsByResource = new Map<string, IconResource>();
  for (const resource of [...dataset.resources, ...(dataset.resourceIndex ?? [])]) {
    if (!resource.iconPath && !resource.iconAtlas) {
      continue;
    }

    const key = getResourceKey(resource);
    const existing = iconsByResource.get(key);
    if (
      !existing ||
      (!existing.iconPath && resource.iconPath) ||
      (!existing.iconAtlas && resource.iconAtlas)
    ) {
      iconsByResource.set(key, resource);
    }
  }

  return iconsByResource;
}

/** A clone lands two cells down and across from its original. */
const CLONE_OFFSET = BOARD_GRID * 2;

/**
 * Annotations are the one thing on the board the user sizes by hand, so they
 * get snapped on the way into the project rather than left to the magnet: a
 * box drawn freehand still ends up a whole number of cells, on a cell corner.
 * Only the keys present in the patch are touched.
 */
function snapAnnotationToGrid(patch: Partial<FactoryAnnotation>): Partial<FactoryAnnotation> {
  const snapped: Partial<FactoryAnnotation> = {};
  if (patch.position) {
    snapped.position = snapPositionToGrid(patch.position);
  }
  if (patch.size) {
    snapped.size = {
      width: snapSizeUpToGrid(patch.size.width),
      height: snapSizeUpToGrid(patch.size.height),
    };
  }
  if (patch.points) {
    snapped.points = patch.points.map((point) => snapPositionToGrid(point));
  }
  return snapped;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// A big board's solve finishes off the main thread; the finished books land
// here and replace the stale placeholder solveBooks handed out. See
// src/store/solve-books.ts.
registerBooksSink((result) => {
  useFactoryStore.setState({ lastResult: result });
});

/**
 * Subscribe a component to the two board-wide display dials, the rate unit
 * and the power unit. The formatters in rate-unit.ts read module singletons,
 * so a component that prints a rate needs this to re-render when a dial
 * turns. The dials are pure view: they never touch the books.
 */
export function useRateDisplayUnits(): void {
  useFactoryStore((state) => state.rateUnit);
  useFactoryStore((state) => state.powerDisplayUnit);
}
