import { NextResponse } from "next/server";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { calculateThroughput } from "@/lib/solver";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { ensurePlanEngine } from "@/lib/server/plan-engine";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import { APP_VERSION } from "@/lib/version";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  COMMUNITY_UPLOAD_MAX_BYTES,
  type CommunityPlanListResponse,
  type CommunityPlanSort,
} from "@/lib/community/types";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import { applyPlanSearch, parsePlanSearch } from "@/lib/community/search-query";
import {
  accountKey,
  addressKey,
  checkRateLimits,
  SITE_KEY,
  communityStorageErrorMessage,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
  makeVoterKey,
  parseEntryIcon,
  isMissingColumnError,
  makeActorKey,
  PLAN_ACTIVITY_COLUMNS,
  PLAN_SUMMARY_COLUMNS,
  PLAN_SUMMARY_COLUMNS_LEGACY,
  rowToPlanSummary,
  type PlanRow,
} from "@/lib/server/community";
import { invalidatePlanListCache, readPlanListCache, writePlanListCache } from "@/lib/server/plan-list-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORT_COLUMNS: Record<
  CommunityPlanSort,
  { column: string; ascending: boolean; nullsLast?: boolean }
> = {
  new: { column: "created_at", ascending: false },
  top: { column: "score", ascending: false },
  downloads: { column: "downloads", ascending: false },
  views: { column: "views", ascending: false },
  machines: { column: "machine_count", ascending: false },
  nodes: { column: "node_count", ascending: false },
  power: { column: "total_eu_t", ascending: false },
  lowPower: { column: "total_eu_t", ascending: true },
  tier: { column: "highest_tier_index", ascending: false },
  comments: { column: "comment_count", ascending: false },
  // Posts nobody has commented on or touched sort after every post someone
  // has, whichever way the column is read.
  commented: { column: "last_comment_at", ascending: false, nullsLast: true },
  active: { column: "last_activity_at", ascending: false, nullsLast: true },
};

export async function GET(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const sortParam = url.searchParams.get("sort") ?? "new";
    const sort = SORT_COLUMNS[sortParam as CommunityPlanSort] ? (sortParam as CommunityPlanSort) : "new";
    // ilike patterns and PostgREST's or() syntax both have magic characters;
    // stripping them beats escaping them for a search box.
    // #tags stack, one @name is exact (underscores and all), the rest is
    // free text: see search-query.ts, which the library's box shares.
    const search = parsePlanSearch(url.searchParams.get("search") ?? "");
    const maxTierIndex = Number.parseInt(url.searchParams.get("maxTierIndex") ?? "", 10);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      60,
      Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "24", 10) || 24),
    );
    const deviceId = url.searchParams.get("deviceId") ?? undefined;
    const mineOnly = url.searchParams.get("mine") === "1";
    const gameVersion = url.searchParams.get("gameVersion")?.slice(0, 60) ?? "";
    const maxEuT = Number(url.searchParams.get("maxEuT") ?? NaN);
    // Resource keys as "kind:resourceId"; a post must carry every one of
    // them on the named side. Capped so a URL cannot become a query bomb.
    const resourceKeys = (name: string) =>
      (url.searchParams.get(name) ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => /^(item|fluid):[^,]{1,200}$/.test(entry))
        .slice(0, 8)
        .map((entry) => {
          const [kind, ...rest] = entry.split(":");
          return { kind, resourceId: rest.join(":") };
        });
    const makes = resourceKeys("makes");
    const takes = resourceKeys("takes");
    const sessionUser = await getSessionUser(request);
    if (mineOnly && !sessionUser) {
      return NextResponse.json({ plans: [], total: 0, page: 1, pageSize, gameVersions: [] });
    }

    const db = getCommunityDb();
    const { column, ascending, nullsLast } = SORT_COLUMNS[sort];
    const from = (page - 1) * pageSize;

    // The public page is the same rows for every reader, so it is served
    // from memory for a minute (plan-list-cache.ts); only what is personal
    // - isMine, myVote - is stamped on below. A reader's own posts are
    // never cached: that list is theirs alone and changes as they work.
    const cacheKey = mineOnly
      ? undefined
      : [
          "public",
          sort,
          url.searchParams.get("search") ?? "",
          maxTierIndex,
          gameVersion,
          Number.isFinite(maxEuT) ? maxEuT : "",
          url.searchParams.get("makes") ?? "",
          url.searchParams.get("takes") ?? "",
          page,
          pageSize,
        ].join("|");
    // A database still without the activity columns answers with the old
    // ones, and a sort that needs them falls back to newest first, so the
    // list never blanks between a deploy and the schema paste.
    const loadPage = async (legacy = false): Promise<{ rows: PlanRow[]; total: number }> => {
      const orderColumn = legacy && PLAN_ACTIVITY_COLUMNS.has(column) ? "created_at" : column;
      let query = db
        .from("community_plans")
        .select(legacy ? PLAN_SUMMARY_COLUMNS_LEGACY : PLAN_SUMMARY_COLUMNS, { count: "exact" });
      query = applyPlanSearch(query, search);
      if (Number.isFinite(maxTierIndex) && maxTierIndex >= 0) {
        query = query.lte("highest_tier_index", maxTierIndex);
      }
      if (gameVersion) {
        query = query.eq("game_version", gameVersion);
      }
      if (Number.isFinite(maxEuT) && maxEuT >= 0) {
        query = query.lte("total_eu_t", maxEuT);
      }
      // JSON containment: the stat arrays hold {kind, resourceId, ...} and
      // @> matches on the keys given, so the rate is free to differ.
      for (const resource of makes) {
        query = query.contains("outputs", JSON.stringify([resource]));
      }
      for (const resource of takes) {
        query = query.contains("needs", JSON.stringify([resource]));
      }
      if (mineOnly && sessionUser) {
        query = query.eq("user_id", sessionUser.id);
      } else {
        // The public shelf: unpublished posts exist only on their owner's
        // Mine shelf.
        query = query.eq("is_public", true);
      }
      const { data, count, error } = await query
        .order(orderColumn, { ascending, nullsFirst: nullsLast ? false : undefined })
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1)
        .returns<PlanRow[]>();
      if (error && !legacy && isMissingColumnError(error)) {
        return loadPage(true);
      }
      if (error) {
        throw new Error(communityStorageErrorMessage(error, "Listing community plans failed."));
      }
      return { rows: data ?? [], total: count ?? data?.length ?? 0 };
    };
    // Distinct versions across the whole hub feed the filter dropdown; the
    // set moves once a release, so it is cached the same way.
    const loadVersions = async (): Promise<string[]> => {
      const cached = readPlanListCache<string[]>("versions");
      if (cached) {
        return cached;
      }
      const { data: versionRows } = await db
        .from("community_plans")
        .select("game_version")
        .limit(1000)
        .returns<Array<{ game_version: string }>>();
      const versions = [
        ...new Set((versionRows ?? []).map((row) => row.game_version).filter(Boolean)),
      ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      writePlanListCache("versions", versions);
      return versions;
    };

    let pageData = cacheKey ? readPlanListCache<{ rows: PlanRow[]; total: number }>(cacheKey) : undefined;
    // What is not cached is fetched at once, side by side, not in turn.
    const [loaded, gameVersions, voterKey] = await Promise.all([
      pageData ? Promise.resolve(pageData) : loadPage(),
      loadVersions(),
      deviceId ? makeVoterKey(request, deviceId) : Promise.resolve(undefined),
    ]);
    if (!pageData && cacheKey) {
      writePlanListCache(cacheKey, loaded);
    }
    pageData = loaded;

    const plans = pageData.rows.map((row) => rowToPlanSummary(row, sessionUser?.id));
    if (voterKey) {
      // A reader's votes are few and change only when they vote, which
      // empties the cache, so they ride the same minute.
      const votesKey = `votes|${voterKey}`;
      let votes = readPlanListCache<Map<string, 1 | -1>>(votesKey);
      if (!votes) {
        const { data } = await db
          .from("community_votes")
          .select("plan_id,value")
          .eq("voter_key", voterKey)
          .returns<Array<{ plan_id: string; value: 1 | -1 }>>();
        votes = new Map((data ?? []).map((vote) => [vote.plan_id, vote.value]));
        writePlanListCache(votesKey, votes);
      }
      for (const plan of plans) {
        plan.myVote = votes.get(plan.id);
      }
    }

    const response: CommunityPlanListResponse = {
      plans,
      total: pageData.total,
      page,
      pageSize,
      gameVersions,
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Listing community plans failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const raw = await request.text();
    if (raw.length > COMMUNITY_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: "Upload too large." }, { status: 413 });
    }

    const body = JSON.parse(raw) as {
      name?: unknown;
      description?: unknown;
      gameVersion?: unknown;
      datasetVersionId?: unknown;
      deviceId?: unknown;
      plan?: unknown;
      tags?: unknown;
      icon?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > COMMUNITY_NAME_MAX_LENGTH) {
      return NextResponse.json({ error: "Plan name is required (max 80 chars)." }, { status: 400 });
    }

    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, COMMUNITY_DESCRIPTION_MAX_LENGTH)
        : "";
    const gameVersion = typeof body.gameVersion === "string" ? body.gameVersion.slice(0, 60) : "";
    const datasetVersionId =
      typeof body.datasetVersionId === "string" ? body.datasetVersionId.slice(0, 120) : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
    if (!deviceId) {
      return NextResponse.json({ error: "Missing device id." }, { status: 400 });
    }

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Sign in to share plans to the community." },
        { status: 401 },
      );
    }

    const tags = normalizeBlueprintTags(body.tags);

    const parsedPlan = factoryProjectSchema.safeParse(body.plan);
    if (!parsedPlan.success) {
      return NextResponse.json({ error: "Plan JSON is not a valid project." }, { status: 400 });
    }

    const project = parsedPlan.data;
    if (project.nodes.length === 0) {
      return NextResponse.json({ error: "Refusing to share an empty plan." }, { status: 400 });
    }

    // Per account, per address and for the whole site: spam has come from
    // thousands of accounts and addresses at once, each posting once.
    if (
      !(await checkRateLimits([
        { actorKey: accountKey(sessionUser.id), action: "upload", max: 10, windowSeconds: 60 * 60 },
        { actorKey: accountKey(sessionUser.id), action: "upload", max: 30, windowSeconds: 24 * 60 * 60 },
        { actorKey: addressKey(request), action: "upload", max: 10, windowSeconds: 60 * 60 },
        { actorKey: SITE_KEY, action: "upload", max: 120, windowSeconds: 60 * 60 },
      ]))
    ) {
      return NextResponse.json(
        { error: "Upload rate limit reached. Try again later." },
        { status: 429 },
      );
    }

    // Stats are always derived server-side from the validated plan, as the
    // plan board runs it: there is one mode, so an older plan is converted
    // first (the stored plan stays as uploaded).
    const solved = normalizeLoadedProject(project);
    await ensurePlanEngine(solved);
    const stats = computeCommunityPlanStats(solved, calculateThroughput(solved));

    const db = getCommunityDb();
    const row = {
        user_id: sessionUser.id,
        author_name: sessionUser.username,
        name,
        description,
        game_version: gameVersion,
        dataset_version: datasetVersionId,
        plan: project,
        tags,
        tags_text: tags.join(" "),
        icon: parseEntryIcon(body.icon),
        needs: stats.needs,
        outputs: stats.outputs,
        total_eu_t: stats.totalEuT,
        machine_count: stats.machineCount,
        node_count: stats.nodeCount,
        storage_count: stats.storageCount,
        edge_count: stats.edgeCount,
        highest_tier: stats.highestTier ?? null,
        highest_tier_index: stats.highestTierIndex,
        stats_version: APP_VERSION,
        uploader_key: makeActorKey(request, deviceId),
      };
    let { data, error } = await db
      .from("community_plans")
      .insert({ ...row, last_activity_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error && isMissingColumnError(error)) {
      // The activity column is not there yet: the post still lands.
      ({ data, error } = await db.from("community_plans").insert(row).select("id").single());
    }

    if (error || !data) {
      throw new Error(communityStorageErrorMessage(error, "Insert failed"));
    }

    invalidatePlanListCache();
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sharing the plan failed." },
      { status: 500 },
    );
  }
}
