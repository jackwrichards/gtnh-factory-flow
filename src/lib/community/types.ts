import type { MachineTier, ResourceKind } from "@/lib/model/types";

/** One line of a plan's stat card: an external need or an unconsumed output. */
export interface PlanResourceStat {
  kind: ResourceKind;
  resourceId: string;
  displayName?: string;
  /** items/s or L/s, positive. */
  ratePerSecond: number;
}

/** The sortable/filterable identity of a shared plan, computed from its JSON. */
export interface CommunityPlanStats {
  nodeCount: number;
  storageCount: number;
  edgeCount: number;
  /** Sum of configured machine counts across nodes. */
  machineCount: number;
  totalEuT: number;
  highestTier?: Exclude<MachineTier, "DEMO">;
  highestTierIndex: number;
  needs: PlanResourceStat[];
  outputs: PlanResourceStat[];
}

export interface CommunityPlanSummary extends CommunityPlanStats {
  id: string;
  name: string;
  description: string;
  gameVersion: string;
  datasetVersionId: string;
  thumbnailDataUrl?: string;
  upvotes: number;
  downvotes: number;
  score: number;
  downloads: number;
  views: number;
  createdAt: string;
  /** This device's current vote, when known. */
  myVote?: 1 | -1;
}

export type CommunityPlanSort =
  | "new"
  | "top"
  | "downloads"
  | "views"
  | "machines"
  | "nodes"
  | "power";

export interface CommunityPlanListRequest {
  sort?: CommunityPlanSort;
  search?: string;
  maxTier?: string;
  page?: number;
  pageSize?: number;
  deviceId?: string;
}

export interface CommunityPlanListResponse {
  plans: CommunityPlanSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CommunityUploadRequest {
  name: string;
  description: string;
  gameVersion: string;
  datasetVersionId: string;
  deviceId: string;
  /** Full FactoryProject JSON; the server re-validates and re-derives stats. */
  plan: unknown;
  thumbnailDataUrl?: string;
}

export interface CommunityVoteRequest {
  deviceId: string;
  value: 1 | -1;
}

export interface CommunityVoteResponse {
  upvotes: number;
  downvotes: number;
  score: number;
  myVote?: 1 | -1;
}

export const COMMUNITY_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const COMMUNITY_THUMBNAIL_MAX_BYTES = 400 * 1024;
export const COMMUNITY_NAME_MAX_LENGTH = 80;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 2000;
export const COMMUNITY_RESOURCE_STAT_LIMIT = 40;
