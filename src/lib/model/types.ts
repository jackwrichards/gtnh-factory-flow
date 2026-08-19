export const PROJECT_SCHEMA_VERSION = 1;
export const TICKS_PER_SECOND = 20;

export type ItemId = string;
export type FluidId = string;
export type AspectId = string;
export type ResourceId = ItemId | FluidId | AspectId;
export type ResourceKind = "item" | "fluid" | "aspect" | "energy";
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
  | "UXV"
  | "OpV"
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
  machineHandlerId?: string;
  coilTier?: string;
  machineConfigTiers?: Record<string, string>;
  /** Settings panel folded shut. A view choice, kept so it survives a reload. */
  settingsCollapsed?: boolean;
  recipeInputOverrides?: Record<string, RecipeInput>;
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
 */
export type StorageDrainMode = "product" | "byproduct";

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
  /** Buffers only; absent means `overflow`. See StorageBufferMode. */
  bufferMode?: StorageBufferMode;
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
 */
export interface FactoryPocket {
  id: string;
  name: string;
  colorTag?: FactoryNodeColorTag;
  /** Which board the collapsed card sits on; absent = the root board. */
  parentPocketId?: string;
  /** Where the collapsed card sits on that board. */
  position: {
    x: number;
    y: number;
  };
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
  labelOffset?: {
    x: number;
    y: number;
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
  lineThicknessMode?: boolean;
  freeDockMode?: boolean;
  lineLabelsMode?: boolean;
  linePulseMode?: boolean;
  calmMode?: boolean;
  /** Historical: older plans carry it, nothing applies it. The smart view is
   * personal, and opening a setup always starts on the identity view. */
  glanceMode?: string;
  rateUnit?: "tick" | "second" | "minute" | "hour";
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  showHiddenResources?: boolean;
  favouritesOnly?: boolean;
  trendsOpen?: boolean;
  hiddenResourceKeys?: string[];
  favouriteResourceKeys?: string[];
}

export interface FactoryProject {
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
  /**
   * Sketch mode. When true the solve assumes the plan's boundary: every bare
   * input is supplied for free and every bare output is exported, via virtual
   * drawers that never reach the board. Declared boundaries still win - only
   * slots with no wire are filled in. For quick math before the wiring.
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
    /** The community post this design was shared as / imported from. */
    communityPlanId?: string;
    /**
     * Fingerprint of the board content as last synced with that post, stamped
     * on download and on share. While the board still matches it, "reset to
     * the posted version" has nothing to restore and greys out. Covers what
     * the board IS, not what it is called; see plan-fingerprint.ts.
     */
    communityFingerprint?: string;
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
}
