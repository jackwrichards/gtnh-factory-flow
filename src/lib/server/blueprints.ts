import { z } from "zod";
import { resourceIconAtlasRefSchema } from "@/lib/model/schemas";
import {
  BLUEPRINT_RESOURCE_STAT_LIMIT,
  type BlueprintResourceStat,
  type BlueprintSummary,
} from "@/lib/blueprints/types";
import type { EntryIcon } from "@/lib/community/types";
import { getNodeMachineBuildCount } from "@/lib/model/passive-production";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { getCommunityDb } from "@/lib/server/community";

/**
 * Client-computed stat lines (same trust model as community plan stats).
 * Anything that doesn't parse becomes an empty stat card, never a rejection.
 */
const resourceStatSchema = z.object({
  kind: z.enum(["item", "fluid"]),
  resourceId: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  iconPath: z.string().max(500).optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: z.string().max(32).optional(),
  ratePerSecond: z.number().finite().nonnegative(),
});
const resourceStatsSchema = z.array(resourceStatSchema).max(BLUEPRINT_RESOURCE_STAT_LIMIT);

export function parseResourceStats(value: unknown) {
  const parsed = resourceStatsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Machines a captured payload builds. Crop cards count the harvesters their
 * planted crops fill, never one machine per seed.
 */
export function countBlueprintMachines(captured: {
  nodes: Array<
    Pick<FactoryNode, "recipeId" | "machineCount"> &
      Partial<Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId">>
  >;
  recipes: Array<Pick<Recipe, "id" | "machineType" | "source" | "metadata">>;
}): number {
  const recipesById = new Map(captured.recipes.map((recipe) => [recipe.id, recipe]));
  return captured.nodes.reduce(
    (sum, node) => sum + getNodeMachineBuildCount(recipesById.get(node.recipeId), node),
    0,
  );
}

export const BLUEPRINT_SUMMARY_COLUMNS =
  "id,user_id,name,node_count,storage_count,edge_count,pocket_count,machine_count,is_public,description,author_name,published_at,upvotes,downvotes,score,downloads,needs,outputs,tags,icon,highest_tier,highest_tier_index,created_at";

export interface BlueprintRow {
  id: string;
  user_id: string;
  name: string;
  node_count: number;
  storage_count: number;
  edge_count: number;
  pocket_count: number;
  machine_count: number;
  is_public: boolean;
  description: string;
  author_name: string;
  published_at: string | null;
  upvotes: number;
  downvotes: number;
  score: number;
  downloads: number;
  needs: BlueprintResourceStat[];
  outputs: BlueprintResourceStat[];
  tags: string[];
  icon: EntryIcon | null;
  highest_tier: string | null;
  highest_tier_index: number | null;
  created_at: string;
}

/** GT tier labels a blueprint may report; anything else stores as none. */
const KNOWN_TIERS = new Set([
  "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV",
  "UHV", "UEV", "UIV", "UMV", "UXV", "MAX",
]);

export function parseHighestTier(value: unknown): string | null {
  // "OpV" is the old misname of the 536M EU/t tier; it stores as UXV now.
  const tier = value === "OpV" ? "UXV" : value;
  return typeof tier === "string" && KNOWN_TIERS.has(tier) ? tier : null;
}

export function rowToBlueprintSummary(
  row: BlueprintRow,
  sessionUserId?: string,
): BlueprintSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    nodeCount: row.node_count,
    storageCount: row.storage_count,
    edgeCount: row.edge_count,
    pocketCount: row.pocket_count,
    machineCount: row.machine_count,
    isPublic: row.is_public,
    description: row.description,
    authorName: row.author_name || undefined,
    publishedAt: row.published_at ?? undefined,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
    downloads: row.downloads,
    isMine: Boolean(sessionUserId && row.user_id === sessionUserId),
    needs: row.needs ?? [],
    outputs: row.outputs ?? [],
    tags: row.tags ?? [],
    icon: row.icon ?? undefined,
    highestTier: (row.highest_tier ?? undefined) as BlueprintSummary["highestTier"],
    highestTierIndex: row.highest_tier_index ?? -1,
  };
}

/** Marks each summary with the actor's own vote, exactly like plan listings. */
export async function attachMyBlueprintVotes(
  blueprints: BlueprintSummary[],
  actorKey: string,
): Promise<void> {
  if (blueprints.length === 0) {
    return;
  }

  const db = getCommunityDb();
  const { data, error } = await db
    .from("blueprint_votes")
    .select("blueprint_id,value")
    .eq("voter_key", actorKey)
    .in(
      "blueprint_id",
      blueprints.map((blueprint) => blueprint.id),
    );
  if (error || !data) {
    return;
  }

  const votes = new Map(data.map((vote) => [vote.blueprint_id as string, vote.value as 1 | -1]));
  for (const blueprint of blueprints) {
    blueprint.myVote = votes.get(blueprint.id);
  }
}

/**
 * Turns the two schema-drift Postgres errors into messages that say what to
 * actually do, instead of a generic 500: PGRST205 means the blueprints table
 * has never been created; PGRST204/42703 mean the table predates a column
 * this build reads or writes (schema.sql converges when re-run — its later
 * additions are idempotent ALTERs). Anything else keeps the caller's word.
 */
export function blueprintStorageErrorMessage(
  error: { code?: string } | null,
  fallback: string,
): string {
  if (error?.code === "PGRST205") {
    return "Blueprint storage is not set up yet: run supabase/schema.sql in the Supabase SQL editor.";
  }
  if (error?.code === "PGRST204" || error?.code === "42703") {
    return "Blueprint storage is out of date: re-run the latest supabase/schema.sql in the Supabase SQL editor.";
  }
  return fallback;
}
