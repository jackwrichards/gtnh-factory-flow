import type {
  BottleneckReport,
  EdgeThroughput,
  FactoryEdge,
  FactoryProject,
  FactoryStorage,
  FuelEstimate,
  NodeThroughputResult,
  ResourceKey,
  ResourceKind,
  StorageThroughputResult,
} from "../../../model/types";

/**
 * Per solve node, what the nameplate loop in `calculateThroughput` computed
 * and the report does not carry. Only filled for a plan-mode project.
 */
export interface PlanUnit {
  /** The overclocked duration of one craft, ticks. */
  durationTicks: number;
  /** `node.parallel * machineParallelMultiplier`: crafts at once per machine. */
  throughputFactor: number;
  /**
   * Units of each report port one craft takes or makes, chances and machine effects applied (a TGS's tier and tools).
   * A card with no count has all-zero flows and cannot be read back, and the bare recipe would drop those effects.
   */
  perCraft?: { inputs: Record<ResourceKey, number>; outputs: Record<ResourceKey, number> };
}

/**
 * The tail of the old books, handed over by the seam so the plan path shares
 * it without importing `throughput.ts` (which imports this folder).
 */
export interface PlanHelpers {
  buildEdgeResult(
    edge: { id: string; resourceKind: ResourceKind; resourceId: string; label?: string },
    key: ResourceKey,
    demandPerSecond: number,
    transferredPerSecond: number,
    capacities?: {
      nameplateDemandPerSecond: number;
      sourceCapacityPerSecond: number;
      availablePerSecond?: number;
    },
  ): EdgeThroughput;
  refreshStorageResultsFromEdges(
    projectStorages: FactoryStorage[],
    storages: Record<string, StorageThroughputResult>,
    edges: FactoryEdge[],
    edgeResults: Record<string, EdgeThroughput>,
  ): void;
  calculateFuelEstimate(project: FactoryProject, totalEuT: number): FuelEstimate | undefined;
}

/**
 * Everything `calculateThroughput` has built by the time it reaches the
 * solve-mode branch: the project fully expanded (shared sections, hatch
 * supplies, loose-cell tanks), every enabled node's nameplate report, the
 * storages, and the hidden helpers to strike from the result. The plan solver
 * reads the nameplate flows, so overclocks, parallels, chances and output
 * multipliers are the old solvers' by construction.
 */
export interface PlanSolveArgs {
  project: FactoryProject;
  nodes: Record<string, NodeThroughputResult>;
  storages: Record<string, StorageThroughputResult>;
  projectStorages: FactoryStorage[];
  bottlenecks: BottleneckReport[];
  options: { generatedAt?: string };
  /** Absent in tests that build the nameplate by hand: durations then read 20 ticks, factor 1. */
  units?: Record<string, PlanUnit>;
  helpers?: PlanHelpers;
}
