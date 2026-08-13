import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";

/**
 * The wire contract of /api/datasets/[versionId]/reachability, shared by the
 * server implementation and the browser caller so the two cannot drift.
 */

export type ReachabilitySource = "ores" | "smallOres" | "undergroundFluids" | "bees" | "crops";

export const ALL_REACHABILITY_SOURCES: ReachabilitySource[] = [
  "ores",
  "smallOres",
  "undergroundFluids",
  "bees",
  "crops",
];

export interface ReachabilityRootsConfig {
  sources: ReachabilitySource[];
  /** `${kind}:${id}` resource keys the player already has. */
  extraResourceKeys?: string[];
  /** Resource keys treated as never obtainable. */
  disabledResourceKeys?: string[];
  /** Specific source recipes toggled off (one vein someone cannot reach). */
  disabledRecipeIds?: string[];
}

export interface ReachableResourceSummary {
  kind: string;
  id: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: DatasetResourceIndexEntry["iconAtlas"];
  dominantColor?: string;
}

export interface ReachabilitySummaryResult {
  schemaVersion: 1;
  datasetVersionId: string;
  reachableCount: number;
  firedRecipeCount: number;
  totalMatching: number;
  offset: number;
  limit: number;
  resources: ReachableResourceSummary[];
}

export interface ReachabilityChainStep {
  recipeId: string;
  provides: string[];
  depth: number;
}

export interface ReachabilityChainResult {
  schemaVersion: 1;
  datasetVersionId: string;
  target: { kind: string; id: string };
  reachable: boolean;
  steps: ReachabilityChainStep[];
  rootResourceKeys: string[];
}
