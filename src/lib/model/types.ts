export const PROJECT_SCHEMA_VERSION = 1;
export const TICKS_PER_SECOND = 20;

export type ItemId = string;
export type FluidId = string;
export type AspectId = string;
export type ResourceId = ItemId | FluidId | AspectId;
export type ResourceKind = "item" | "fluid" | "aspect";
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
  | "black";

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

export interface FactoryNode {
  id: string;
  recipeId: string;
  colorTag?: FactoryNodeColorTag;
  machineCount: number;
  parallel: number;
  overclockTier: MachineTier | string;
  machineHandlerId?: string;
  coilTier?: string;
  machineConfigTiers?: Record<string, string>;
  recipeInputOverrides?: Record<string, RecipeInput>;
  targetOutput?: TargetRate;
  enabled: boolean;
  position: {
    x: number;
    y: number;
  };
}

export interface FactoryStorage {
  id: string;
  kind: ResourceKind;
  resourceId: ResourceId;
  colorTag?: FactoryNodeColorTag;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  capacity?: number;
  position: {
    x: number;
    y: number;
  };
}

export type FactoryAnnotationKind = "box" | "arrow" | "text";

export type FactoryAnnotationArrowDirection = "down-right" | "down-left" | "up-right" | "up-left";

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

export interface FactoryProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  targetRate?: TargetRate;
  recipes: Recipe[];
  nodes: FactoryNode[];
  storages?: FactoryStorage[];
  annotations?: FactoryAnnotation[];
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
  theoreticalMachinesRequired: number;
  limitingResource?: ResourceFlow;
  /**
   * THE bottleneck, by the solver's own arithmetic: the connected input whose
   * supply ratio was the minimum taken when computing `capableUtilization`.
   * The UI must display this rather than re-derive a pick from per-edge
   * figures — the damped asks make those incomparable across inputs.
   */
  limitingInputKey?: ResourceKey;
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
