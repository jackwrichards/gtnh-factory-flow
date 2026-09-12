export const PROJECT_SCHEMA_VERSION = 1;
export const TICKS_PER_SECOND = 20;

export type ItemId = string;
export type FluidId = string;
export type AspectId = string;
export type ResourceId = ItemId | FluidId | AspectId;
/**
 * `power` is EU as a resource: one canonical id (`eu`), produced by
 * generator cards' synthesized recipes and consumed by nothing - drawers
 * only. Its flows are per-second like every flow; display is always EU/t.
 */
export type ResourceKind = "item" | "fluid" | "aspect" | "power";
export type ResourceKey = `${ResourceKind}:${string}`;

export interface ResourceIconAtlasRef {
  imagePath: string;
  atlasWidth: number;
  atlasHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dominantColor?: string;
}

/**
 * One item or fluid picked as the face of a whole entry: a plan, a shared
 * setup, a blueprint. Same icon plumbing as a resource slot, minus the rate.
 * Lives here rather than in the community types because a plan carries its
 * own face now, and the model cannot reach into community code.
 */
export interface EntryIcon {
  kind: ResourceKind;
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
}

export type MachineTier =
  | "ULV"
  | "LV"
  | "MV"
  | "HV"
  | "EV"
  | "IV"
  | "LuV"
  | "ZPM"
  | "UV"
  | "UHV"
  | "UEV"
  | "UIV"
  | "UMV"
  | "UXV"
  | "MAX"
  | "DEMO";

export type FactoryNodeColorTag =
  | "white"
  | "orange"
  | "magenta"
  | "light_blue"
  | "yellow"
  | "lime"
  | "pink"
  | "gray"
  | "light_gray"
  | "cyan"
  | "purple"
  | "blue"
  | "brown"
  | "green"
  | "red"
  | "black"
  // The app's own ink, offered as paint: the alarm red, the warning amber,
  // the output emerald, the product blue, and the two card greys.
  | "scarlet"
  | "amber"
  | "emerald"
  | "azure"
  | "steel"
  | "onyx";

export interface ResourceAmount {
  kind: ResourceKind;
  id: ResourceId;
  amount: number;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  modId?: string;
  tooltip?: string[];
  neiSlot?: {
    x: number;
    y: number;
  };
  alternatives?: ResourceAlternative[];
}

export type ResourceAlternative = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip" | "modId"
> &
  Partial<Pick<ResourceAmount, "amount">>;

export interface RecipeInput extends ResourceAmount {
  optional?: boolean;
  consumed?: boolean;
}

export interface RecipeOutput extends ResourceAmount {
  chance?: number;
  byproduct?: boolean;
}

export interface RuntimeCalculationResource {
  kind: ResourceKind;
  id: ResourceId;
  amount: number;
  chance?: number;
}

export interface RuntimeCalculationVariant {
  id: string;
  label?: string;
  machineHandlerId?: string;
  overclockTier?: MachineTier | string;
  coilTier?: string;
  machineConfigTiers?: Record<string, string>;
  durationTicks: number;
  eut: number;
  parallel?: number;
  inputs?: RuntimeCalculationResource[];
  outputs?: RuntimeCalculationResource[];
  notes?: string;
}

export interface RuntimeCalculation {
  sourceKind:
    | "gregtech-processing-logic"
    | "gregtech-overclock-calculator"
    | "gregtech-recipe-baseline"
    | "thaumcraft-runtime"
    | "passive-bee"
    | "passive-crop"
    | "synthetic-passive-bootstrap";
  sourceClass?: string;
  sourceVersion?: string;
  recipeMap?: string;
  status: "computed" | "partial" | "missing";
  oracleEligible: boolean;
  strict?: boolean;
  generatedAt?: string;
  variants: RuntimeCalculationVariant[];
  warnings?: string[];
}

export interface MachineProfile {
  machineType: string;
  minimumTier: MachineTier | string;
  /**
   * The highest real machine in a singleblock family. A tier above it is
   * not a block, so the tier chip stops here and the run tier clamps to it.
   * Absent on multiblocks, whose tier is their hatches.
   */
  maximumTier?: MachineTier | string;
  /** Registered singleblock tiers; some families skip intermediate voltages. */
  availableTiers?: string[];
  durationTicks?: number;
  eut?: number;
  maxParallel?: number;
  eutLimit?: number;
  /** True when the machine performs 4x speed / 4x power overclocks. */
  perfectOverclock?: boolean;
  /**
   * Carried through from the selected handler. Multiblocks turn speed they
   * cannot spend below one tick into extra parallels; singleblocks cannot,
   * and waste it. See `overclock.ts`.
   */
  kind?: "single" | "multiblock" | "crafting" | "automation";
  notes?: string;
}

export interface MachineHandler extends MachineProfile {
  id: string;
  label: string;
  kind?: "single" | "multiblock" | "crafting" | "automation";
  machineConfigControls?: MachineConfigControl[];
}

export interface MachineConfigTierOption {
  key: string;
  label: string;
  heat?: number;
  durationMultiplier?: number;
  eutMultiplier?: number;
  outputMultiplier?: number;
  parallelMultiplier?: number;
  /** Parallels that scale with the machine's voltage tier (GT++ "Voltage Tier * n Parallels"). */
  parallelPerVoltageTier?: number;
  /** Additive base for voltage-scaled parallels: floor(base + n * tier), e.g. Zhuhai 2 * (tier + 1). */
  parallelVoltageBase?: number;
  resource: ResourceAmount;
}

export interface MachineConfigControl {
  id: string;
  label: string;
  minimumKey: string;
  defaultKey?: string;
  /** Whole-number entry; an omitted maximum means there is no machine limit. */
  numeric?: { min: number; max?: number };
  /**
   * The recipe's own special value is a 1-based minimum tier on this ladder
   * (the Naquadah Fuel Refinery's field restriction coils), so `minimumKey`
   * is overridden per recipe to `tiers[specialValue - 1]`. Declared by
   * curated machine-table controls only; the dataset never emits it.
   */
  minimumFromSpecialValue?: boolean;
  /** Special value is required heat in K; offer only coils that meet it. */
  minimumHeatFromSpecialValue?: boolean;
  tiers: MachineConfigTierOption[];
}

export interface Recipe {
  id: string;
  name: string;
  kind?:
    | "gregtech_machine"
    | "bee_produce"
    | "crop_produce"
    | "ore_vein"
    | "small_ore"
    | "underground_fluid"
    | "essentia_smelting"
    | "custom"
    | "unknown";
  category?: string;
  machineType: string;
  minimumTier: MachineTier | string;
  /** The family's highest real machine, carried from the selected handler; see MachineProfile. */
  maximumTier?: MachineTier | string;
  /** Actual registered tiers carried from the selected singleblock handler. */
  availableTiers?: string[];
  durationTicks: number;
  eut: number;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  programmedCircuit?: string;
  specialValue?: number;
  notes?: string;
  machineProfile?: MachineProfile;
  machineHandlers?: MachineHandler[];
  machineConfigControls?: MachineConfigControl[];
  /**
   * Power cards only (src/lib/power): the generator this synthesized recipe
   * was built from and its net EU/t at the baked settings. Presence of this
   * field is what marks a recipe as a power card.
   */
  power?: {
    sourceId: string;
    euPerTick: number;
    stats: Array<{ label: string; value: string }>;
    warnings?: string[];
  };
  runtimeCalculation?: RuntimeCalculation;
  isDemo?: boolean;
  source?: {
    datasetVersionId?: string;
    recipeMap?: string;
    sourceMod?: string;
    exporter?: "nesql" | "recex" | "nerd" | "gtnh-oracle" | "unknown";
    rawRecipeId?: string;
    sourceIdentifier?: string;
  };
  metadata?: Record<string, unknown>;
  nei?: {
    iconPath?: string;
    source?: string;
    handlerClass?: string;
    canvas?: { width: number; height: number };
    backgroundImage?: string;
    itemInputGrid?: { width: number; height: number };
    itemOutputGrid?: { width: number; height: number };
    fluidInputGrid?: { width: number; height: number };
    fluidOutputGrid?: { width: number; height: number };
    slotCapacity?: {
      maxItemInputs?: number;
      maxItemOutputs?: number;
      maxFluidInputs?: number;
      maxFluidOutputs?: number;
    };
    slots?: Array<{
      side: "input" | "output";
      kind: ResourceKind;
      slotIndex: number;
      x: number;
      y: number;
    }>;
    progressBars?: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      direction: "right" | "up" | "circular";
      texture?: string;
    }>;
    additionalInfo?: string[];
    requiresCleanroom?: boolean;
    requiresLowGravity?: boolean;
  };
}

export interface TargetRate {
  kind: ResourceKind;
  resourceId: ResourceId;
  amountPerSecond: number;
  displayName?: string;
}

/** Which way a custom rate card faces: it makes the resource, or it drinks it. */
export type CustomRateMode = "supply" | "request";

/** One more recipe on a card's machine; see `FactoryNode.extraRecipes`. */
export interface FactoryNodeRecipeSection {
  recipeId: string;
  recipeInputOverrides?: Record<string, RecipeInput>;
}

export interface FactoryNode {
  id: string;
  recipeId: string;
  colorTag?: FactoryNodeColorTag;
  /**
   * Custom rate cards only: the dial, kept on the CARD rather than in the
   * synthetic recipe's slot. The slot is the live value the solver reads, and
   * it is emptied every time the card lets go of its resource — this is what
   * survives that, so a card you unwire and rewire comes back on your number.
   */
  customRate?: { perSecond: number; mode: CustomRateMode };
  /** When set, Industrial Farm planting follows this many full seed beds. */
  cropFullFarmCount?: number;
  machineCount: number;
  parallel: number;
  overclockTier: MachineTier | string;
  /**
   * Energy hatches built into a multiblock, 1 by default. One hatch works at
   * 1 amp of its tier; two or more work at 2 amps each, so 2 hatches carry
   * four times the power of one. Ignored on singleblocks, which have no
   * hatches.
   */
  energyHatches?: number;
  /**
   * Which energy hatch family feeds the machine (`energy-hatches.ts`).
   * Absent means the regular 2 A hatches above; the exotic families
   * (multi-amp, laser) carry their whole rating through ONE hatch, so
   * `energyHatches` is clamped to 1 while one of them is selected.
   */
  energyHatchType?: string;
  /** Derived hatchVoltageTier voltage × hatchAmps, persisted for old readers. */
  powerEuT?: number;
  /** Average input voltage, independent of the total power pool. */
  hatchVoltageTier?: Exclude<MachineTier, "DEMO">;
  /** Working input amps. One regular hatch supplies one amp. */
  hatchAmps?: number;
  /** Raw EU/t assumes a suitable voltage; explicit amps use the selected hatch tier. */
  powerInputMode?: "amps" | "eut";
  machineHandlerId?: string;
  coilTier?: string;
  machineConfigTiers?: Record<string, string>;
  /** Settings panel folded shut. A view choice, kept so it survives a reload. */
  settingsCollapsed?: boolean;
  /** Fluids fully supplied by an installed hatch; shared by all recipes on this card. */
  hatchSupplies?: Array<"water" | "air">;
  recipeInputOverrides?: Record<string, RecipeInput>;
  /**
   * More recipes the SAME machine runs (`shared-machine.ts`): a Large
   * Chemical Reactor fed for two reactions is one card with two sections.
   * Each section keeps its own slots, wires and oredict picks; the machine
   * count, tier and every config knob are the card's and shared. Section 0
   * is `recipeId` above; these are sections 1..n, and their port handles
   * wear an `r<n>:` prefix. Absent or empty means an ordinary one-recipe card.
   */
  extraRecipes?: FactoryNodeRecipeSection[];
  /**
   * Solve mode's pin: run EXACTLY this many machines, and solve the rest of
   * the line around it ("I want 20 LGTs; what feeds them"). Absent means the
   * count is the solver's to choose. Ignored in plan mode.
   */
  solvePin?: number;
  targetOutput?: TargetRate;
  enabled: boolean;
  /** The pocket dimension this card lives in; absent = the root board. */
  pocketId?: string;
  position: {
    x: number;
    y: number;
  };
}

/**
 * What a drawer at the END of the plan does about the machine feeding it.
 *
 * `product` pulls: it asks its feeder for everything the machine can make, so
 * the machine runs flat out. This is the thing your factory is FOR, and it is
 * the default for every drain, old plans included.
 *
 * `byproduct` only catches what is left: it asks for nothing at all, so the
 * pace is set by whoever really wants the output (or by the plan's target
 * rate), and the leftover lands here instead of clogging the machine.
 *
 * `trash` voids what arrives: it asks for nothing, un-clogs its feeder like a
 * byproduct, and what it eats is discarded from the books entirely instead of
 * being counted as surplus. The drawer as a bin - this replaced the separate
 * trash can node's spawn button (2026-08-23); old trash can nodes still work.
 */
export type StorageDrainMode = "product" | "byproduct" | "trash";

/**
 * How a BUFFER treats a surplus. `overflow` (the default) catches what its
 * takers leave, filling at a visible rate, so the feeder never clogs on it -
 * the way a real chest or tank behaves. `strict` passes through only what is
 * pulled and hands the surplus back to the feeder as a clog, for players who
 * want the imbalance surfaced instead of stored. Neither mode can run the
 * tank net-negative: a buffer never invents supply.
 */
export type StorageBufferMode = "overflow" | "strict";

export interface FactoryStorage {
  id: string;
  kind: ResourceKind;
  resourceId: ResourceId;
  /** Drains only; absent means `product`. See StorageDrainMode. */
  drainMode?: StorageDrainMode;
  /**
   * Solve mode's question, typed on a PRODUCT drawer: make at least this much
   * per second. Ignored in plan mode and on other drawer roles; a product with
   * no number is unconstrained (byproduct-shaped) so flipping the mode never
   * errors a board.
   */
  targetPerSecond?: number;
  /** Buffers only; absent means `overflow`. See StorageBufferMode. */
  bufferMode?: StorageBufferMode;
  /**
   * Which side of the POOL this drawer sits on when it has no wires of its
   * own (`FactoryProject.poolMode`): a `source` feeds the pool, a `drain`
   * takes from it (its `drainMode` still says product, byproduct or trash).
   * Ignored while the drawer has wires, and outside pool mode.
   */
  poolSide?: "source" | "drain";
  colorTag?: FactoryNodeColorTag;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  capacity?: number;
  /** The pocket dimension this drawer lives in; absent = the root board. */
  pocketId?: string;
  position: {
    x: number;
    y: number;
  };
}

export type FactoryAnnotationKind = "box" | "arrow" | "text" | "zone" | "image";

export type FactoryAnnotationArrowDirection = "down-right" | "down-left" | "up-right" | "up-left";

export type FactoryAnnotationBorderStyle = "solid" | "dashed" | "none";

/**
 * How strongly a box/zone paints its surface: a faint wash, opaque, or not at
 * all. The surface COLOUR is separate (`fillColor` for a dye, `fillTheme` for
 * a textured paper), and the marks drawn over it are separate again
 * (`marks`) - three orthogonal choices, not one long list.
 *
 * The extra tokens are legacy spellings from when one field carried all
 * three; they are still accepted on read (a legacy mark token means "tint
 * surface wearing that mark") so no saved board changes meaning.
 */
export type FactoryAnnotationFillStyle =
  | "tint"
  | "solid"
  | "none"
  | "paper"
  | "dots"
  | "grid"
  | "graph"
  | "ruled"
  | "hatch";

/** The marks a box/zone draws over its surface: the board's own vocabulary. */
export type FactoryAnnotationMarks = "none" | "dots" | "grid" | "graph" | "ruled" | "hatch";

/**
 * How a box, zone or image is dressed. Every field optional: absent means the
 * classic look (solid border and faint tint, both in `colorTag`), so old plans
 * render exactly as they always did. The border and the fill each take their
 * own colour; absent falls back to the annotation's `colorTag`, which is what
 * keeps the paint tool working on styled shapes.
 */
export interface FactoryAnnotationStyle {
  border?: FactoryAnnotationBorderStyle;
  borderColor?: FactoryNodeColorTag;
  fill?: FactoryAnnotationFillStyle;
  fillColor?: FactoryNodeColorTag;
  /**
   * A textured paper as the surface instead of a dye: one of the canvas
   * theme ids. Set from the fill colour popover alongside the dyes; wins
   * over `fillColor` while present.
   */
  fillTheme?: string;
  /** Marks drawn over the surface; absent = none. */
  marks?: FactoryAnnotationMarks;
}

export interface FactoryAnnotation {
  id: string;
  kind: FactoryAnnotationKind;
  colorTag?: FactoryNodeColorTag;
  text?: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  /** Arrow only: which corners of the bounding box the arrow connects (tail → head). */
  arrowDirection?: FactoryAnnotationArrowDirection;
  /**
   * Zone only: the outline's vertices, in order, relative to `position`.
   * Drawn as a closed loop; `position`/`size` stay the bounding box so the
   * board can frame and drag it like any other annotation.
   */
  points?: Array<{ x: number; y: number }>;
  /**
   * Text only: font size in px. A note headlining a whole section and a note
   * labelling one machine want very different sizes, and resizing the box only
   * ever changed how much room the same small text had to wrap in.
   */
  fontSize?: number;
  /** Image only: where the picture lives (an uploaded, hosted URL). */
  imageUrl?: string;
  /** Box/zone/image: border and fill dressing. Absent = the classic look. */
  style?: FactoryAnnotationStyle;
  /** The pocket dimension this ink lives in; absent = the root board. */
  pocketId?: string;
}

/**
 * A pocket dimension: a named sub-board that collapses a group of cards into
 * one node-like card on its parent board. Members are ordinary project
 * nodes/storages/annotations tagged with `pocketId` — the graph the solver
 * sees is completely flat; pockets only decide what the board SHOWS. Pockets
 * nest through `parentPocketId` (absent = the pocket sits on the root board).
 *
 * A pocket can also stand OPEN as a board: a window frame on its parent board
 * whose members render inside it and move with it (`expanded`). Boards and
 * pockets are the same thing in two states — minimizing a board gives back
 * the classic collapsed card, and every plan saved before boards existed
 * simply has no `expanded` flag and renders exactly as it always did.
 */
export interface FactoryPocket {
  id: string;
  name: string;
  colorTag?: FactoryNodeColorTag;
  /** Which board the collapsed card sits on; absent = the root board. */
  parentPocketId?: string;
  /**
   * Where the card — or, standing open, the window frame's top-left corner —
   * sits on that board.
   */
  position: {
    x: number;
    y: number;
  };
  /**
   * Standing open as a board. While open, member positions are relative to
   * the frame's top-left corner; a legacy pocket's members (whose positions
   * were their own dive-in space) are rebased to fit the frame the first
   * time it opens. Absent/false = the classic collapsed pocket card.
   */
  expanded?: boolean;
  /** The window frame, whole cells; absent = fitted when it first opens. */
  size?: {
    width: number;
    height: number;
  };
  /**
   * The paper this board is drawn on: a canvas theme id (see
   * `canvas-themes.ts`), giving the floor its base colour, its grain and its
   * own grid ink. Absent = the house purple. Deliberately the SAME palette
   * the canvas itself offers — a board is a piece of board.
   */
  theme?: string;
  /**
   * The ruling on that paper: a canvas pattern id ("dots", "lines",
   * "cross", "ruled", "graph", "none"). Absent = dots, the canvas default.
   */
  pattern?: string;
}

export interface FactoryEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  resourceKind: ResourceKind;
  resourceId: ResourceId;
  label?: string;
  ratePerSecond?: number;
  /**
   * A loose cell wire (SetupRules.looseCellWires): the edge's own resource is
   * what leaves the source - the filled CELL or the FLUID - and its target
   * handle names the other form's input it lands on. This carries the
   * Canner's litres-per-cell ratio, fetched when the wire was drawn. The
   * solver expands such an edge through a hidden free Tank (see
   * expandCrossFormEdges in throughput.ts); no wire ever crosses kinds on
   * its own.
   */
  crossForm?: {
    litresPerCell: number;
  };
  /**
   * User-pinned stops, in order: the wire must pass through each on its way
   * from source to target. Placed by double-clicking the wire, dragged to
   * steer it, removed by double-clicking the dot. Always on grid corners.
   */
  waypoints?: Array<{
    x: number;
    y: number;
  }>;
}

export interface FuelProfile {
  id: string;
  name: string;
  fuelFluidId: FluidId;
  euPerLiter?: number;
  euPerBucket?: number;
  isDemo?: boolean;
  notes?: string;
}

/**
 * How the author had the workspace set up when they shared a plan.
 *
 * Board view settings and resource marks are normally personal taste kept in
 * localStorage, deliberately outside the project so your grid pattern does not
 * ride along into everyone else's board (see `board-view.ts`). A SHARED SETUP
 * is the exception: the author arranged the view to make their build readable
 * - starred the resources worth watching, hid the noise, picked a rate unit -
 * and that arrangement is part of what they are handing over.
 *
 * So it rides in the plan, but it is only ever APPLIED when a shared setup is
 * opened. Switching between your own designs never touches your live settings,
 * which is the case the original rule was protecting.
 *
 * Every field is optional: an older plan simply has nothing to say, and the
 * viewer's own settings stand.
 */
export interface PlanViewState {
  canvasPattern?: string;
  canvasTheme?: string;
  /** Historical: older plans carry it, nothing reads it. Line colour rides
   * the status glance mode now. */
  lineHeatMode?: boolean;
  /** Historical: the rate pills on wires were dropped (2026-09-08); nothing reads it. */
  lineLabelsMode?: boolean;
  fixedEdgeWidth?: boolean;
  linePulseMode?: boolean;
  calmMode?: boolean;
  /** Historical: older plans carry it, nothing applies it. The smart view is
   * personal, and opening a setup always starts on the identity view. */
  glanceMode?: string;
  rateUnit?: "tick" | "second" | "minute" | "hour" | "eu";
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  showHiddenResources?: boolean;
  favouritesOnly?: boolean;
  trendsOpen?: boolean;
  hiddenResourceKeys?: string[];
  favouriteResourceKeys?: string[];
}

/**
 * The two things a board cannot do for itself: find stock for an input
 * nothing feeds, and get rid of output nothing takes.
 *
 * Both off is the CLOSED plan, and the default: you declare the boundary by
 * wiring it, a slot with no wire reads UNWIRED, and a surplus with nowhere to
 * go clogs. Turning one on is exactly like wiring a source drawer onto every
 * input, or a product drawer onto every output - including slots that already
 * have a wire, so a half-fed input tops up and a surplus output spills rather
 * than holding its machine back.
 *
 * The drawers are virtual: they exist inside the solve and never reach the
 * board, so nothing the player drew is touched or hidden.
 */
export interface SetupRules {
  /** An input short of stock takes the rest from off the board. */
  freeInputs?: boolean;
  /** Output with nowhere to go leaves the board instead of clogging. */
  freeOutputs?: boolean;
  /**
   * A filled cell may wire straight onto its fluid's input, converting for
   * free at the Canner's own ratio (stored on the edge at wire time, see
   * FactoryEdge.crossForm). Off by default: the honest bridge is a Tank or
   * Canner card, and this rule is the player choosing convenience over it.
   * Turning it off later keeps the wires already drawn.
   */
  looseCellWires?: boolean;
}

export interface FactoryProject {
  /** Construction progress; never changes production. */
  checklist?: { cards: string[]; edges: string[] };
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  /**
   * The face this plan wears: its blurb and its one-item icon, edited on the
   * board's plan card and used as the post's face when shared. Part of the
   * plan JSON, so they travel through export, import and sharing.
   */
  description?: string;
  icon?: EntryIcon;
  /** Only shared setups carry this; see PlanViewState. */
  view?: PlanViewState;
  targetRate?: TargetRate;
  /** How the board treats what it cannot feed or shift. See SetupRules. */
  setupRules?: SetupRules;
  /**
   * SOLVE MODE: machine counts become the answer instead of the question.
   * Product drawers' typed amounts (`FactoryStorage.targetPerSecond`) are the
   * constraints, and every card reports the fractional machine count the
   * targets require (`theoreticalMachinesRequired`) in place of usage and
   * verdicts. Part of the plan JSON so a shared setup opens in the mode it
   * was authored in.
   */
  solveMode?: boolean;
  /**
   * POOL MODE: no wires needed. Every resource is one shared pool: whatever
   * any machine makes goes in, whatever any machine needs comes out, the
   * surplus banks. Imports are SOURCE drawers placed on the board with
   * `poolSide: "source"`, products are DRAIN drawers with `poolSide: "drain"`;
   * a resource nobody makes and no source declares stays short. Wires drawn
   * anyway still count. Combines with solve mode. Part of the plan JSON.
   */
  poolMode?: boolean;
  /**
   * Pool mode's cell-to-fluid bridges: litres one filled cell holds, keyed
   * by the cell item id, read from the Canner's own recipes (never
   * guessed) and fetched for every cell/fluid pair the plan's slots name.
   * A pair with no ratio here is not bridged. Stored so a shared plan
   * solves the same everywhere without a lookup.
   */
  poolCellRatios?: Record<string, number>;
  /**
   * LEGACY sketch mode, read on load and rewritten as both board rules.
   * Plans saved before the rules existed still carry it; nothing writes it.
   */
  assumeBoundaries?: boolean;
  recipes: Recipe[];
  nodes: FactoryNode[];
  storages?: FactoryStorage[];
  annotations?: FactoryAnnotation[];
  pockets?: FactoryPocket[];
  edges: FactoryEdge[];
  fuelProfiles: FuelProfile[];
  selectedFuelProfileId?: string;
  notes?: string;
  metadata?: {
    isDemo?: boolean;
    source?: string;
    createdAt?: string;
    updatedAt?: string;
    /**
     * The community post this design IS. Only the owner's design carries it;
     * the post follows every save (post-follow.ts). A copy of someone else's
     * post has none.
     */
    communityPlanId?: string;
  };
}

export interface ResourceFlow {
  key: ResourceKey;
  kind: ResourceKind;
  resourceId: ResourceId;
  displayName?: string;
  alternatives?: ResourceAlternative[];
  amountPerSecond: number;
}

export interface EdgeThroughput {
  edgeId: string;
  resource: ResourceFlow;
  demandPerSecond: number;
  transferredPerSecond: number;
  isLimited: boolean;
  /**
   * What the consumer would draw at 100% utilisation, before the solver scales
   * it down to match available supply. `demandPerSecond` converges to
   * `transferredPerSecond`, so this is the only value that still shows how much
   * the machine actually wants.
   */
  nameplateDemandPerSecond: number;
  /** What the producer could emit at 100% utilisation. */
  sourceCapacityPerSecond: number;
  /**
   * This line's share of what the consumer COULD be supplied (capability
   * allocation, ignoring demand throttles). Solver-internal: consumer
   * capability derives from this rather than from `transferredPerSecond`,
   * which is demand-scaled and would ratchet capability downward.
   */
  availablePerSecond?: number;
  /**
   * Which end is holding the flow back:
   * - `supply`  producer is maxed out and the consumer is starved
   * - `demand`  both ends have slack; the plan just doesn't need more
   * - `full`    consumer is getting everything it asked for
   */
  constraint: "supply" | "demand" | "full";
}

export interface NodeThroughputResult {
  nodeId: string;
  recipeId: string;
  recipeName: string;
  enabled: boolean;
  operationRatePerSecond: number;
  inputs: Record<ResourceKey, ResourceFlow>;
  outputs: Record<ResourceKey, ResourceFlow>;
  euT: number;
  requiredRatePerSecond: number;
  maxRatePerSecond: number;
  utilization: number;
  /**
   * The build cannot start: underpowered or over-tier hatches. Rates above
   * stay nameplate - the card keeps its shape - and the equilibrium pins the
   * node at 0%, exactly like a machine stopped by a bare slot.
   */
  powerStalled?: boolean;
  /**
   * How hard this node COULD run given only its own input supply (1 when
   * nothing upstream limits it). Solver-internal: `utilization` is demand-
   * throttled, but supply allocation must offer consumers what a producer
   * could ramp up to if asked, or an initially low ask locks in forever.
   */
  capableUtilization?: number;
  /**
   * How hard this node WANTS to run from demand alone (targets and consumer
   * asks), before any input-supply clamp. Solver-internal: a consumer's ask
   * for an ingredient must not shrink just because that same ingredient is
   * currently short - allocation is capped by asks, so utilization could
   * ratchet down through any transient but never climb back up.
   */
  demandUtilization?: number;
  /**
   * How hard this node could run before a wired output it cannot get rid of
   * backs up on it (1 when nothing binds). Only a trash can, a DRAIN drawer
   * or a port with no wire on it can absorb a surplus nobody asked for; a
   * buffer passes on what its consumers pull and no more. A node whose speed
   * is set by this rather than by supply or demand is CLOGGED.
   */
  disposalUtilization?: number;
  /** The output whose surplus sets `disposalUtilization`, when one does. */
  clogOutputKey?: ResourceKey;
  theoreticalMachinesRequired: number;
  limitingResource?: ResourceFlow;
  /**
   * THE bottleneck, by the solver's own arithmetic: the connected input whose
   * supply ratio was the minimum taken when computing `capableUtilization`.
   * The UI must display this rather than re-derive a pick from per-edge
   * figures — the damped asks make those incomparable across inputs.
   */
  limitingInputKey?: ResourceKey;
  /**
   * Inputs whose supply ratio sits within the tie window of the minimum:
   * as far as the figures can tell they are the SAME wall, and raising any
   * one of them may just hand the limit to the next. Order-independent.
   */
  limitingInputTiedKeys?: ResourceKey[];
  status: "disabled" | "balanced" | "underutilized" | "bottleneck" | "missing-recipe";
  warnings: string[];
}

export interface StorageThroughputResult {
  storageId: string;
  kind: ResourceKind;
  resourceId: ResourceId;
  displayName?: string;
  storedAmount: number;
  capacity: number;
  producedPerSecond: number;
  consumedPerSecond: number;
  netPerSecond: number;
  status: "filling" | "draining" | "balanced" | "empty";
  /** Solve mode: the typed requirement this drawer carried into the solve. */
  targetPerSecond?: number;
  /** Solve mode: no chain can reach the typed amount at any machine scale. */
  targetUnreachable?: boolean;
}

export interface ResourceBalance {
  key: ResourceKey;
  kind: ResourceKind;
  resourceId: ResourceId;
  displayName?: string;
  producedPerSecond: number;
  consumedPerSecond: number;
  netPerSecond: number;
  surplusPerSecond: number;
  deficitPerSecond: number;
  /**
   * The BOUNDARY figures, read off the drawers rather than off the books.
   *
   * A resource can carry several at once, and that is not a contradiction:
   * importing carbon at one drawer and catching spare carbon at another says
   * the plan brings some in over here and has some to haul away over there.
   * Netting the two would claim the spare feeds the need, which is a wire
   * nobody drew - and if the player wants it, they can draw it.
   */
  importedPerSecond: number;
  productPerSecond: number;
  byproductPerSecond: number;
  /**
   * Spillover piling up in overflow BUFFERS: each buffer's inflow minus its
   * outflow, floored at zero, summed per resource. A pass-through buffer
   * contributes nothing; one that catches more than its takers drink is
   * accumulating real material, and the plan's books surface that as a
   * positive alongside products and byproducts instead of letting a tank
   * quietly swallow it. Sources and drains keep their own columns.
   */
  bufferFillPerSecond: number;
}

export interface BottleneckReport {
  id: string;
  kind: "resource-deficit" | "node-capacity" | "missing-recipe";
  severity: "warning" | "critical";
  message: string;
  nodeId?: string;
  resource?: ResourceFlow;
  requiredPerSecond?: number;
  capacityPerSecond?: number;
}

export interface FuelEstimate {
  fuelProfile: FuelProfile;
  totalEuPerSecond: number;
  fuelPerSecond: number;
  unit: "L/s" | "buckets/s";
}

export interface ThroughputResult {
  nodes: Record<string, NodeThroughputResult>;
  storages: Record<string, StorageThroughputResult>;
  resources: Record<ResourceKey, ResourceBalance>;
  edges: Record<string, EdgeThroughput>;
  totalEuT: number;
  totalEuPerSecond: number;
  fuelEstimate?: FuelEstimate;
  bottlenecks: BottleneckReport[];
  externalInputs: ResourceBalance[];
  unconsumedOutputs: ResourceBalance[];
  generatedAt: string;
  /**
   * These books do not describe the current plan yet: a big board's solve
   * runs off the main thread and the real result replaces them when it
   * lands. See `src/store/solve-books.ts`.
   */
  stale?: boolean;
  /**
   * Stale because automatic recalculation is OFF and the plan changed since
   * the last solve: the books are held until the player asks. Never set by a
   * worker solve, so the "thinking" spinner can tell the two apart.
   */
  held?: boolean;
  /**
   * The clog-lock diagnosis, when the solve that made these books also ran
   * it. Its vent solve is a second, harder LP: a board with many stopped
   * machines pays 20-60 s for it on the main thread, so the solve worker
   * computes it beside the books and `findClogLocks` serves it from here.
   */
  clogLocks?: ClogLockIndex;
}

export interface ClogLockVent {
  nodeId: string;
  /** The culprit machine's display name, so a victim's card can say where
   * to act without the player hunting the board. */
  machineName: string;
  resourceKey: ResourceKey;
  resourceName: string;
  /** What must leave through this port per second for the group to run. */
  perSecond: number;
}

export interface ClogLock {
  /** Stable id: the smallest member node id. Survives re-solves. */
  id: string;
  /** Every frozen card the jam holds, machines and pass-through drawers. */
  nodeIds: string[];
  /** Machine members only - what the copy counts. */
  machineIds: string[];
  /**
   * The machines whose surplus needs the drawer - the only cards that flash,
   * ordered WORST FIRST so the notice's "Show me" walks them by severity.
   * A jam can hold half a board; marking every member painted whole plans
   * blue and pointed nowhere. The victims keep the verdict and its story,
   * the vent sites carry the ring, exactly as the fix copy promises.
   */
  ventNodeIds: string[];
  /** The wires carrying a vented surplus out of a vent site - the ones the
   * drawer tees into. Only these breathe, never the whole web. */
  edgeIds: string[];
  /** The surpluses that need a home, largest first. */
  vents: ClogLockVent[];
}

export interface ClogLockIndex {
  byNode: Map<string, ClogLock>;
  byEdge: Map<string, ClogLock>;
  locks: ClogLock[];
}
