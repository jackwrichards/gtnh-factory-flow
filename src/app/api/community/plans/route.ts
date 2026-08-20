import { NextResponse } from "next/server";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { calculateThroughput } from "@/lib/solver";
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
import {
  attachMyVotes,
  checkRateLimit,
  communityStorageErrorMessage,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
  makeActorKey,
  parseEntryIcon,
  PLAN_SUMMARY_COLUMNS,
  rowToPlanSummary,
  type PlanRow,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORT_COLUMNS: Record<CommunityPlanSort, { column: string; ascending: boolean }> = {
  new: { column: "created_at", ascending: false },
  top: { column: "score", ascending: false },
  downloads: { column: "downloads", ascending: false },
  views: { column: "views", ascending: false },
  machines: { column: "machine_count", ascending: false },
  nodes: { column: "node_count", ascending: false },
  power: { column: "total_eu_t", ascending: false },
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
    const search = (url.searchParams.get("search") ?? "")
      .replace(/[,()%_\\]/g, " ")
      .trim()
      .slice(0, 80);
    const maxTierIndex = Number.parseInt(url.searchParams.get("maxTierIndex") ?? "", 10);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      48,
      Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "24", 10) || 24),
    );
    const deviceId = url.searchParams.get("deviceId") ?? undefined;
    const mineOnly = url.searchParams.get("mine") === "1";
    const gameVersion = url.searchParams.get("gameVersion")?.slice(0, 60) ?? "";
    const sessionUser = await getSessionUser(request);

    const db = getCommunityDb();
    let query = db.from("community_plans").select(PLAN_SUMMARY_COLUMNS, { count: "exact" });
    // Tag-aware search, same contract as blueprints: a plain term matches
    // names, descriptions and tags; a leading # narrows to tags alone.
    if (search.startsWith("#")) {
      const tagTerm = search.slice(1).trim();
      if (tagTerm) {
        query = query.ilike("tags_text", `%${tagTerm}%`);
      }
    } else if (search) {
      query = query.or(
        `name.ilike.%${search}%,description.ilike.%${search}%,tags_text.ilike.%${search}%`,
      );
    }
    if (Number.isFinite(maxTierIndex) && maxTierIndex >= 0) {
      query = query.lte("highest_tier_index", maxTierIndex);
    }
    if (gameVersion) {
      query = query.eq("game_version", gameVersion);
    }
    if (mineOnly) {
      if (!sessionUser) {
        return NextResponse.json({ plans: [], total: 0, page: 1, pageSize, gameVersions: [] });
      }
      query = query.eq("user_id", sessionUser.id);
    } else {
      // The public shelf: unpublished posts exist only on their owner's
      // Mine shelf.
      query = query.eq("is_public", true);
    }

    const { column, ascending } = SORT_COLUMNS[sort];
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query
      .order(column, { ascending })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1)
      .returns<PlanRow[]>();

    if (error) {
      throw new Error(communityStorageErrorMessage(error, "Listing community plans failed."));
    }

    const plans = (data ?? []).map((row) => rowToPlanSummary(row, sessionUser?.id));
    if (deviceId) {
      await attachMyVotes(plans, makeActorKey(request, deviceId));
    }

    // Distinct versions across the whole hub feed the filter dropdown.
    const { data: versionRows } = await db
      .from("community_plans")
      .select("game_version")
      .limit(1000)
      .returns<Array<{ game_version: string }>>();
    const gameVersions = [
      ...new Set((versionRows ?? []).map((row) => row.game_version).filter(Boolean)),
    ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    const response: CommunityPlanListResponse = {
      plans,
      total: count ?? plans.length,
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

    const actorKey = makeActorKey(request, deviceId);
    if (!(await checkRateLimit(actorKey, "upload", 10, 60 * 60))) {
      return NextResponse.json(
        { error: "Upload rate limit reached. Try again later." },
        { status: 429 },
      );
    }

    // Stats are always derived server-side from the validated plan.
    const stats = computeCommunityPlanStats(project, calculateThroughput(project));

    const db = getCommunityDb();
    const { data, error } = await db
      .from("community_plans")
      .insert({
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
        uploader_key: actorKey,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(communityStorageErrorMessage(error, "Insert failed"));
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sharing the plan failed." },
      { status: 500 },
    );
  }
}
