import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { entryIconSchema } from "@/lib/model/schemas";
import type { CommunityPlanSummary, EntryIcon, PlanResourceStat } from "@/lib/community/types";
import {
  assertLocalDbAllowed,
  isLocalDb,
  LOCAL_DB_SERVICE_KEY,
  localDbFetch,
  localDbUrl,
} from "./local-db/client";
import { makeSessionToken, readSessionCookie, SESSION_COOKIE, SESSION_DAYS, verifySessionToken } from "./session";

export { makeSessionToken, SESSION_COOKIE };

/**
 * Server-only Supabase access for the community hub. Uses the service-role
 * key, so this module must never be imported from client components — the
 * API routes under /api/community are the only intended consumers.
 */

let cachedClient: SupabaseClient | undefined;

/**
 * How long one database request may take before it is abandoned. Without a
 * limit, a stalled Supabase instance holds requests open for minutes, so
 * pages hang instead of failing and the server piles up open sockets. A
 * healthy request finishes in well under a second, so this only cuts off a
 * stall.
 */
export const COMMUNITY_DB_TIMEOUT_MS = 20_000;

/** What a player reads when the database cannot be reached. */
export const COMMUNITY_DB_DOWN_MESSAGE = "The community database is not responding. Try again in a few minutes.";

const DB_DOWN_HEADER = "x-community-db-down";

/** A PostgREST-shaped error answer, which every client reads as `{ message }`. */
function dbDownResponse(status: number): Response {
  return Response.json(
    { message: COMMUNITY_DB_DOWN_MESSAGE, code: "", details: `HTTP ${status}`, hint: "" },
    { status, headers: { [DB_DOWN_HEADER]: "1" } },
  );
}

/**
 * After this many database requests in a row fail as down, the next ones fail
 * at once, without being sent, for `DB_BREAKER_OPEN_MS`; then one goes through
 * to try. A stalled instance only recovers once demand drops (its disk budget
 * refills below baseline), and every tab keeps asking.
 */
export const DB_BREAKER_FAILURES = 5;
export const DB_BREAKER_OPEN_MS = 15_000;
let dbFailuresInARow = 0;
let dbBreakerOpenUntil = 0;

/** For tests: a closed breaker. */
export function resetDbBreaker(): void {
  dbFailuresInARow = 0;
  dbBreakerOpenUntil = 0;
}

/** The database client's fetch: `fetchWithDbTimeout` behind the breaker. */
async function fetchFromDb(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  send: typeof fetch = fetch,
): Promise<Response> {
  if (Date.now() < dbBreakerOpenUntil) {
    // 504: postgrest-js retries a 503, which would only meet the breaker again.
    return dbDownResponse(504);
  }
  const response = await fetchWithDbTimeout(input, init, COMMUNITY_DB_TIMEOUT_MS, send);
  if (response.headers.get(DB_DOWN_HEADER)) {
    dbFailuresInARow += 1;
    if (dbFailuresInARow >= DB_BREAKER_FAILURES) {
      dbBreakerOpenUntil = Date.now() + DB_BREAKER_OPEN_MS;
    }
  } else {
    dbFailuresInARow = 0;
  }
  return response;
}

/**
 * The client's fetch (database, storage), abandoned after `timeoutMs`,
 * body included. A timeout before the answer arrives becomes a 504, not a
 * rejection: postgrest-js RETRIES a GET that rejects (other than with an
 * AbortError) three more times with backoff, and words a rejection as its
 * error's name and message. Supabase sits behind Cloudflare, so a stalled
 * instance answers with Cloudflare's HTML error page (522, 524, sent as
 * text/plain), which the clients would pass on whole as the error message:
 * any 5xx that is not JSON becomes the same plain answer, keeping its status
 * so postgrest-js still retries a 520. A 4xx is left alone (PostgREST reads
 * an empty 404 as no rows).
 */
export async function fetchWithDbTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs = COMMUNITY_DB_TIMEOUT_MS,
  send: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  let response: Response;
  try {
    response = await send(input, { ...init, signal });
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      return dbDownResponse(504);
    }
    throw error;
  }
  if (response.status < 500) {
    return response;
  }
  if (!response.headers.get("content-type")?.includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    return dbDownResponse(response.status);
  }
  // PostgREST up but Postgres not (PGRST000-003: no connection, no schema
  // cache, no pool slot) says so in its own words: "Could not query the
  // database for the schema cache. Retrying."
  const body = (await response.clone().json().catch(() => undefined)) as { code?: unknown } | undefined;
  if (typeof body?.code === "string" && /^PGRST00[0-3]$/.test(body.code)) {
    await response.body?.cancel().catch(() => undefined);
    return dbDownResponse(response.status);
  }
  return response;
}

export function isCommunityConfigured(): boolean {
  return isLocalDb() || Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getCommunityDb(): SupabaseClient {
  if (!cachedClient && isLocalDb()) {
    // Local development (LOCAL_DB=1): the database on this machine, never
    // the hosted project, whatever SUPABASE_URL says. Never in production.
    assertLocalDbAllowed();
    cachedClient = createClient(localDbUrl(), LOCAL_DB_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // The same limit and the same plain answers as the hosted project.
      global: {
        fetch: (input, init) =>
          fetchFromDb(input, init, (i, n) => localDbFetch(i, n, fetch)),
      },
    });
  }
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
      global: { fetch: (input, init) => fetchFromDb(input, init) },
    });
  }

  return cachedClient;
}

/**
 * The address a request came from. The site sits behind Cloudflare and then Caddy, so the TCP peer is a Cloudflare
 * edge and X-Forwarded-For names that edge (Caddy trusts no incoming one). Caddy puts the client's own address in
 * X-Client-Ip, overwriting anything the client sent (its `client_ip` from Cloudflare's CF-Connecting-IP, trusted only
 * from Cloudflare's ranges); without that, CF-Connecting-IP, which Cloudflare always sets itself.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    request.headers.get("x-client-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

/** A salted hash, so keys never hold raw addresses or ids. */
export function saltedKey(text: string): string {
  const salt = process.env.COMMUNITY_HASH_SALT ?? "gtnh-factory-hub";
  return createHash("sha256").update(`${salt}:${text}`).digest("hex").slice(0, 32);
}

/**
 * Anonymous identity: a salted hash of client IP + device id. Good enough to
 * rate-limit without storing raw IPs (votes use `makeVoterKey`).
 */
export function makeActorKey(request: Request, deviceId?: string): string {
  return saltedKey(`${clientAddress(request)}:${deviceId ?? ""}`);
}

/**
 * Who a vote belongs to: the signed-in user, else the browser's device id
 * (a random UUID kept in localStorage). Casting a vote needs an account, since
 * the device id is whatever the client sends; the device form only finds
 * votes cast before that rule, for `myVote`.
 */
export async function makeVoterKey(request: Request, deviceId: string): Promise<string> {
  const user = await getSessionUser(request);
  const salt = process.env.COMMUNITY_HASH_SALT ?? "gtnh-factory-hub";
  const identity = user ? `user:${user.id}` : `device:${deviceId}`;
  return createHash("sha256").update(`${salt}:${identity}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Dead-simple accounts: username + password, scrypt-hashed, with an HMAC-signed
// session cookie (session.ts, shared with the live service). No email, no
// reset flow — this is a hobby community site.
// ---------------------------------------------------------------------------

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

export function sessionCookieHeader(token: string, clear = false): string {
  const maxAge = clear ? 0 : SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export interface SessionUser {
  id: string;
  username: string;
  is_admin: boolean;
}

/**
 * Verifies the session cookie and loads the user, or returns undefined.
 * Throws when the database does not answer (see `loadSessionUser`).
 */
export async function getSessionUser(request: Request): Promise<SessionUser | undefined> {
  const token = readSessionCookie(request.headers.get("cookie"));
  const session = token ? verifySessionToken(token) : undefined;
  return session ? loadSessionUser(session.userId) : undefined;
}

/**
 * The account behind a verified session, or undefined when it is gone. A
 * lookup that fails throws: read as "signed out", it shows a signed-in player
 * the sign-in button, and the live service would close their socket as a
 * refused sign-in, which the client never retries.
 */
export async function loadSessionUser(userId: string): Promise<SessionUser | undefined> {
  const cached = sessionUsers.get(userId);
  if (cached && Date.now() - cached.at < SESSION_USER_CACHE_MS) {
    return cached.user;
  }
  const { data, error } = await getCommunityDb()
    .from("community_users")
    .select("id,username,is_admin")
    .eq("id", userId)
    .maybeSingle<SessionUser>();
  if (error) {
    throw new Error(error.message || "Account lookup failed.");
  }
  if (sessionUsers.size >= SESSION_USER_CACHE_MAX) {
    sessionUsers.clear();
  }
  sessionUsers.set(userId, { at: Date.now(), user: data ?? undefined });
  return data ?? undefined;
}

/**
 * Accounts by id, kept a minute: nearly every request names its account, and
 * the database is small. A rename or an admin change shows within the minute.
 */
const SESSION_USER_CACHE_MS = 60_000;
const SESSION_USER_CACHE_MAX = 5000;
const sessionUsers = new Map<string, { at: number; user: SessionUser | undefined }>();

/** For tests: forget the cached accounts. */
export function forgetSessionUsers(): void {
  sessionUsers.clear();
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
  if ((await countEvents(actorKey, action, windowSeconds)) >= maxPerWindow) {
    return false;
  }
  await recordEvents([{ actorKey, action }]);
  return true;
}

export interface RateLimit {
  actorKey: string;
  action: string;
  max: number;
  windowSeconds: number;
}

/** Rate-limit key for the caller's address alone: a client-sent device id never resets it. */
export function addressKey(request: Request): string {
  return saltedKey(`ip:${clientAddress(request)}`);
}

/** Rate-limit key for an account. */
export function accountKey(userId: string): string {
  return saltedKey(`user:${userId}`);
}

/** Rate-limit key for the whole site: a cap that address-spreading proxies cannot dodge. */
export const SITE_KEY = "site";

/**
 * Every limit must have room, or none is spent. An accepted action is
 * recorded once per key in one insert.
 */
export async function checkRateLimits(limits: RateLimit[]): Promise<boolean> {
  const counts = await Promise.all(
    limits.map((limit) => countEvents(limit.actorKey, limit.action, limit.windowSeconds)),
  );
  if (counts.some((count, index) => count >= limits[index].max)) {
    return false;
  }
  // An hour and a day window on one key share their events: record once.
  const events = new Map(limits.map(({ actorKey, action }) => [`${actorKey}\n${action}`, { actorKey, action }]));
  await recordEvents([...events.values()]);
  return true;
}

/** How many times the actor did the action in the last `windowSeconds`. */
export async function countEvents(actorKey: string, action: string, windowSeconds: number): Promise<number> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await getCommunityDb()
    .from("community_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_key", actorKey)
    .eq("action", action)
    .gte("created_at", windowStart);
  if (error) {
    throw new Error(`Rate limit check failed: ${error.message}`);
  }
  return count ?? 0;
}

/** Records actions for `countEvents`, in one request. */
export async function recordEvents(events: { actorKey: string; action: string }[]): Promise<void> {
  const { error } = await getCommunityDb()
    .from("community_events")
    .insert(events.map((e) => ({ actor_key: e.actorKey, action: e.action })));
  if (error) {
    throw new Error(`Rate limit record failed: ${error.message}`);
  }
}

/**
 * The one item face an author picks for a shared entry. Client-supplied but
 * harmless: it only ever renders as an icon. Anything that doesn't parse
 * becomes "no icon", never a rejection. The schema lives with the model; this
 * is the server's lenient reading.
 */
export function parseEntryIcon(value: unknown): EntryIcon | null {
  const parsed = entryIconSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The columns before the activity trio: what a database not yet migrated can answer. */
export const PLAN_SUMMARY_COLUMNS_LEGACY =
  "id,name,description,game_version,dataset_version,tags,is_public,icon,needs,outputs," +
  "total_eu_t,machine_count,node_count,storage_count,edge_count,highest_tier," +
  "highest_tier_index,upvotes,downvotes,score,downloads,views,created_at,updated_at," +
  "user_id,author_name";
/** The activity columns, which a later migration added; a sort on one needs them. */
export const PLAN_ACTIVITY_COLUMNS = new Set(["comment_count", "last_comment_at", "last_activity_at"]);

/** Columns returned for plan listings (everything except the plan JSON). */
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
 * PGRST204 / 42703: the table predates a column this build reads or writes.
 * Re-running supabase/schema.sql (idempotent ALTERs) fixes it.
 */
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
