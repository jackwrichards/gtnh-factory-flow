import { NextResponse } from "next/server";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { calculateThroughput } from "@/lib/solver";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  COMMUNITY_THUMBNAIL_MAX_BYTES,
  COMMUNITY_UPLOAD_MAX_BYTES,
  type CommunityPlanListResponse,
  type CommunityPlanSort,
} from "@/lib/community/types";
import {
  attachMyVotes,
  checkRateLimit,
  getCommunityDb,
  hashManageToken,
  isCommunityConfigured,
  makeActorKey,
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
    const search = url.searchParams.get("search")?.trim() ?? "";
    const maxTierIndex = Number.parseInt(url.searchParams.get("maxTierIndex") ?? "", 10);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      48,
      Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "24", 10) || 24),
    );
    const deviceId = url.searchParams.get("deviceId") ?? undefined;

    const db = getCommunityDb();
    let query = db.from("community_plans").select(PLAN_SUMMARY_COLUMNS, { count: "exact" });
    if (search) {
      query = query.ilike("name", `%${search.replaceAll("%", "\\%")}%`);
    }
    if (Number.isFinite(maxTierIndex) && maxTierIndex >= 0) {
      query = query.lte("highest_tier_index", maxTierIndex);
    }

    const { column, ascending } = SORT_COLUMNS[sort];
    const from = (page - 1) * pageSize;
    const { data, count, error } = await query
      .order(column, { ascending })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1)
      .returns<PlanRow[]>();

    if (error) {
      throw new Error(error.message);
    }

    const plans = (data ?? []).map(rowToPlanSummary);
    if (deviceId) {
      await attachMyVotes(plans, makeActorKey(request, deviceId));
    }

    const response: CommunityPlanListResponse = {
      plans,
      total: count ?? plans.length,
      page,
      pageSize,
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
      thumbnailDataUrl?: unknown;
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

    const thumbnailDataUrl =
      typeof body.thumbnailDataUrl === "string" &&
      body.thumbnailDataUrl.startsWith("data:image/") &&
      body.thumbnailDataUrl.length <= COMMUNITY_THUMBNAIL_MAX_BYTES
        ? body.thumbnailDataUrl
        : undefined;

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
        { error: "Upload rate limit reached — try again later." },
        { status: 429 },
      );
    }

    // Stats are always derived server-side from the validated plan.
    const stats = computeCommunityPlanStats(project, calculateThroughput(project));
    const manageToken = crypto.randomUUID();

    const db = getCommunityDb();
    const { data, error } = await db
      .from("community_plans")
      .insert({
        manage_token_hash: hashManageToken(manageToken),
        name,
        description,
        game_version: gameVersion,
        dataset_version: datasetVersionId,
        plan: project,
        thumbnail_data_url: thumbnailDataUrl ?? null,
        needs: stats.needs,
        outputs: stats.outputs,
        total_eu_t: stats.totalEuT,
        machine_count: stats.machineCount,
        node_count: stats.nodeCount,
        storage_count: stats.storageCount,
        edge_count: stats.edgeCount,
        highest_tier: stats.highestTier ?? null,
        highest_tier_index: stats.highestTierIndex,
        uploader_key: actorKey,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Insert failed");
    }

    return NextResponse.json({ id: data.id, manageToken }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sharing the plan failed." },
      { status: 500 },
    );
  }
}
