import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { entryIconSchema } from "@/lib/model/schemas";
import type { CommunityPlanSummary, EntryIcon, PlanResourceStat } from "@/lib/community/types";

/**
 * Server-only Supabase access for the community hub. Uses the service-role
 * key, so this module must never be imported from client components — the
 * API routes under /api/community are the only intended consumers.
 */

let cachedClient: SupabaseClient | undefined;

/**
 * How long one database request may take before it is abandoned. Without a
 * limit, a stalled Supabase instance (2026-09-24: Cloudflare 522s for hours)
 * held every request open for 90-120 s, so the public setups, the library
 * and the item list's popularity sort all hung instead of failing, and the
 * server piled up hundreds of open sockets. A 3 MB plan moves in well under
 * a second from the droplet, so this only ever cuts off a stall.
 */
export const COMMUNITY_DB_TIMEOUT_MS = 20_000;

/**
 * The client's fetch (database, storage), abandoned after `timeoutMs`,
 * body included. It aborts with a plain AbortError on purpose: postgrest-js
 * RETRIES a GET that fails any other way, three more times with backoff, so
 * `AbortSignal.timeout`'s TimeoutError turned a 20 s limit into ~87 s.
 */
export function fetchWithDbTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs = COMMUNITY_DB_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  return fetch(input, { ...init, signal });
}

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
      global: { fetch: fetchWithDbTimeout },
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

/**
 * Who a VOTE belongs to: the signed-in user, else the browser's device id.
 *
 * Not the actor key above. That one folds the client IP in, which is right
 * for a rate limit and wrong for a vote: IPv6 privacy addresses and carrier
 * NAT hand the same browser a new address every few minutes, and every new
 * address was a new voter, so a player could upvote their own setup again
 * after a short wait. The device id is a random UUID the browser keeps in
 * localStorage; a signed-in account beats it so one person's vote follows
 * them between browsers.
 */
export async function makeVoterKey(request: Request, deviceId: string): Promise<string> {
  const user = await getSessionUser(request);
  const salt = process.env.COMMUNITY_HASH_SALT ?? "gtnh-factory-hub";
  const identity = user ? `user:${user.id}` : `device:${deviceId}`;
  return createHash("sha256").update(`${salt}:${identity}`).digest("hex").slice(0, 32);
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

/**
 * The one item face an author picks for a shared entry. Client-supplied but
 * harmless: it only ever renders as an icon. Anything that doesn't parse
 * becomes "no icon", never a rejection. The schema lives with the model now
 * (a plan carries its own face); this stays the server's lenient reading.
 */
export function parseEntryIcon(value: unknown): EntryIcon | null {
  const parsed = entryIconSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Columns returned for plan listings (everything except the plan JSON). */
/** The columns before the activity trio: what a database not yet migrated can answer. */
export const PLAN_SUMMARY_COLUMNS_LEGACY =
  "id,name,description,game_version,dataset_version,tags,is_public,icon,needs,outputs," +
  "total_eu_t,machine_count,node_count,storage_count,edge_count,highest_tier," +
  "highest_tier_index,upvotes,downvotes,score,downloads,views,created_at,updated_at," +
  "user_id,author_name";
/** The activity columns added 2026-09-04; a sort on one needs them. */
export const PLAN_ACTIVITY_COLUMNS = new Set(["comment_count", "last_comment_at", "last_activity_at"]);

export const PLAN_SUMMARY_COLUMNS =
  "id,name,description,game_version,dataset_version,tags,is_public,icon,needs,outputs," +
  "total_eu_t,machine_count,node_count,storage_count,edge_count,highest_tier," +
  "highest_tier_index,upvotes,downvotes,score,downloads,views,created_at,updated_at," +
  "user_id,author_name,comment_count,last_comment_at,last_activity_at";

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  game_version: string;
  dataset_version: string;
  tags: string[] | null;
  is_public: boolean | null;
  icon: EntryIcon | null;
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
  updated_at: string | null;
  user_id: string | null;
  author_name: string;
  comment_count: number | null;
  last_comment_at: string | null;
  last_activity_at: string | null;
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
    tags: row.tags ?? [],
    isPublic: row.is_public ?? true,
    icon: row.icon ?? undefined,
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
    updatedAt: row.updated_at ?? undefined,
    commentCount: row.comment_count ?? 0,
    lastCommentAt: row.last_comment_at ?? undefined,
    lastActivityAt: row.last_activity_at ?? undefined,
  };
}

/**
 * Restamps a post's comment figures after a comment lands or goes: the live
 * count, the latest comment's time, and the post's last activity (the later
 * of its last edit and that comment). Best effort: a failure here leaves a
 * sort slightly stale, never a comment unposted.
 */
export async function recountPlanComments(planId: string): Promise<void> {
  const db = getCommunityDb();
  const { data: rows } = await db
    .from("community_comments")
    .select("created_at")
    .eq("plan_id", planId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<Array<{ created_at: string }>>();
  const { count } = await db
    .from("community_comments")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId)
    .is("deleted_at", null);
  const { data: plan } = await db
    .from("community_plans")
    .select("created_at,updated_at")
    .eq("id", planId)
    .single<{ created_at: string; updated_at: string | null }>();
  const lastCommentAt = rows?.[0]?.created_at ?? null;
  const edited = plan?.updated_at ?? plan?.created_at ?? null;
  const lastActivityAt =
    lastCommentAt && edited ? (lastCommentAt > edited ? lastCommentAt : edited) : (lastCommentAt ?? edited);
  await db
    .from("community_plans")
    .update({
      comment_count: count ?? 0,
      last_comment_at: lastCommentAt,
      last_activity_at: lastActivityAt,
    })
    .eq("id", planId);
}

/**
 * Same convergence contract as the blueprint tables: PGRST204/42703 mean the
 * community_plans table predates a column this build reads or writes, and
 * re-running supabase/schema.sql (idempotent ALTERs) fixes it.
 */
/** PGRST204 / 42703: the table predates a column this build reads or writes. */
export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

export function communityStorageErrorMessage(
  error: { code?: string; message?: string } | null,
  fallback: string,
): string {
  if (error?.code === "PGRST204" || error?.code === "42703") {
    return "Community storage is out of date: re-run the latest supabase/schema.sql in the Supabase SQL editor.";
  }
  return error?.message ?? fallback;
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
