import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CommunityPlanSummary, PlanResourceStat } from "@/lib/community/types";

/**
 * Server-only Supabase access for the community hub. Uses the service-role
 * key, so this module must never be imported from client components — the
 * API routes under /api/community are the only intended consumers.
 */

let cachedClient: SupabaseClient | undefined;

export function isCommunityConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getCommunityDb(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Community hub is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return cachedClient;
}

/**
 * Anonymous identity: a salted hash of client IP + device id. Good enough to
 * dedupe votes and rate-limit without storing raw IPs.
 */
export function makeActorKey(request: Request, deviceId?: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const salt = process.env.COMMUNITY_HASH_SALT ?? "gtnh-factory-hub";
  return createHash("sha256")
    .update(`${salt}:${ip}:${deviceId ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Dead-simple accounts: username + password, scrypt-hashed, with an HMAC-signed
// session cookie. No email, no reset flow — this is a hobby community site.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "gtnh_session";
const SESSION_DAYS = 180;

function authSecret(): string {
  return process.env.COMMUNITY_HASH_SALT ?? "gtnh-factory-hub";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function makeSessionToken(userId: string): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expires}`;
  const signature = createHmac("sha256", authSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function sessionCookieHeader(token: string, clear = false): string {
  const maxAge = clear ? 0 : SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export interface SessionUser {
  id: string;
  username: string;
  is_admin: boolean;
}

/** Verifies the session cookie and loads the user, or returns undefined. */
export async function getSessionUser(request: Request): Promise<SessionUser | undefined> {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) {
    return undefined;
  }

  const [userId, expires, signature] = match[1].split(".");
  if (!userId || !expires || !signature) {
    return undefined;
  }

  const payload = `${userId}.${expires}`;
  const expected = createHmac("sha256", authSecret()).update(payload).digest("hex");
  if (signature !== expected || Number(expires) < Date.now()) {
    return undefined;
  }

  const { data } = await getCommunityDb()
    .from("community_users")
    .select("id,username,is_admin")
    .eq("id", userId)
    .single<SessionUser>();
  return data ?? undefined;
}

export function isAdminRequest(request: Request): boolean {
  const adminToken = process.env.COMMUNITY_ADMIN_TOKEN;
  return Boolean(adminToken) && request.headers.get("x-admin-token") === adminToken;
}

/** Returns true when the action is allowed; records it when it is. */
export async function checkRateLimit(
  actorKey: string,
  action: string,
  maxPerWindow: number,
  windowSeconds: number,
): Promise<boolean> {
  const db = getCommunityDb();
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await db
    .from("community_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_key", actorKey)
    .eq("action", action)
    .gte("created_at", windowStart);

  if (error) {
    throw new Error(`Rate limit check failed: ${error.message}`);
  }

  if ((count ?? 0) >= maxPerWindow) {
    return false;
  }

  const { error: insertError } = await db
    .from("community_events")
    .insert({ actor_key: actorKey, action });
  if (insertError) {
    throw new Error(`Rate limit record failed: ${insertError.message}`);
  }

  return true;
}

/** Columns returned for plan listings (everything except the plan JSON). */
export const PLAN_SUMMARY_COLUMNS =
  "id,name,description,game_version,dataset_version,thumbnail_data_url,needs,outputs," +
  "total_eu_t,machine_count,node_count,storage_count,edge_count,highest_tier," +
  "highest_tier_index,upvotes,downvotes,score,downloads,views,created_at,user_id,author_name";

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  game_version: string;
  dataset_version: string;
  thumbnail_data_url: string | null;
  needs: PlanResourceStat[];
  outputs: PlanResourceStat[];
  total_eu_t: number;
  machine_count: number;
  node_count: number;
  storage_count: number;
  edge_count: number;
  highest_tier: string | null;
  highest_tier_index: number;
  upvotes: number;
  downvotes: number;
  score: number;
  downloads: number;
  views: number;
  created_at: string;
  user_id: string | null;
  author_name: string;
}

export function rowToPlanSummary(row: PlanRow, sessionUserId?: string): CommunityPlanSummary {
  return {
    authorName: row.author_name || undefined,
    isMine: Boolean(sessionUserId && row.user_id === sessionUserId),
    id: row.id,
    name: row.name,
    description: row.description,
    gameVersion: row.game_version,
    datasetVersionId: row.dataset_version,
    thumbnailDataUrl: row.thumbnail_data_url ?? undefined,
    needs: row.needs ?? [],
    outputs: row.outputs ?? [],
    totalEuT: row.total_eu_t,
    machineCount: row.machine_count,
    nodeCount: row.node_count,
    storageCount: row.storage_count,
    edgeCount: row.edge_count,
    highestTier: (row.highest_tier ?? undefined) as CommunityPlanSummary["highestTier"],
    highestTierIndex: row.highest_tier_index,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
    downloads: row.downloads,
    views: row.views,
    createdAt: row.created_at,
  };
}

export async function attachMyVotes(
  plans: CommunityPlanSummary[],
  actorKey: string,
): Promise<void> {
  if (plans.length === 0) {
    return;
  }

  const db = getCommunityDb();
  const { data, error } = await db
    .from("community_votes")
    .select("plan_id,value")
    .eq("voter_key", actorKey)
    .in(
      "plan_id",
      plans.map((plan) => plan.id),
    );

  if (error || !data) {
    return;
  }

  const votesByPlan = new Map(data.map((vote) => [vote.plan_id as string, vote.value as 1 | -1]));
  for (const plan of plans) {
    plan.myVote = votesByPlan.get(plan.id);
  }
}
