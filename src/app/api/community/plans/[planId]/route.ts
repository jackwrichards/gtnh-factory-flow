import { NextResponse } from "next/server";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { calculateThroughput } from "@/lib/solver";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  COMMUNITY_THUMBNAIL_MAX_BYTES,
  COMMUNITY_UPLOAD_MAX_BYTES,
} from "@/lib/community/types";
import {
  attachMyVotes,
  getCommunityDb,
  hashManageToken,
  isAdminRequest,
  isCommunityConfigured,
  makeActorKey,
  PLAN_SUMMARY_COLUMNS,
  rowToPlanSummary,
  type PlanRow,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan detail. Counts one view per request (client only calls on preview open). */
export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") ?? undefined;
    const db = getCommunityDb();

    const { data, error } = await db
      .from("community_plans")
      .select(PLAN_SUMMARY_COLUMNS)
      .eq("id", planId)
      .single<PlanRow>();

    if (error || !data) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    await db
      .from("community_plans")
      .update({ views: data.views + 1 })
      .eq("id", planId);

    const plan = rowToPlanSummary({ ...data, views: data.views + 1 });
    if (deviceId) {
      await attachMyVotes([plan], makeActorKey(request, deviceId));
    }

    return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Loading the plan failed." },
      { status: 500 },
    );
  }
}

/** Updates a post in place. Requires the manage token handed out at upload. */
export async function PUT(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const raw = await request.text();
    if (raw.length > COMMUNITY_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: "Upload too large." }, { status: 413 });
    }

    const body = JSON.parse(raw) as {
      manageToken?: unknown;
      name?: unknown;
      description?: unknown;
      gameVersion?: unknown;
      datasetVersionId?: unknown;
      plan?: unknown;
      thumbnailDataUrl?: unknown;
    };

    const manageToken = typeof body.manageToken === "string" ? body.manageToken : "";
    if (!manageToken) {
      return NextResponse.json({ error: "Missing manage token." }, { status: 401 });
    }

    const db = getCommunityDb();
    const { data: existing } = await db
      .from("community_plans")
      .select("id,manage_token_hash")
      .eq("id", planId)
      .single<{ id: string; manage_token_hash: string }>();

    if (!existing) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    if (existing.manage_token_hash !== hashManageToken(manageToken)) {
      return NextResponse.json({ error: "You don't own this post." }, { status: 403 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > COMMUNITY_NAME_MAX_LENGTH) {
      return NextResponse.json({ error: "Plan name is required (max 80 chars)." }, { status: 400 });
    }

    const parsedPlan = factoryProjectSchema.safeParse(body.plan);
    if (!parsedPlan.success) {
      return NextResponse.json({ error: "Plan JSON is not a valid project." }, { status: 400 });
    }

    const project = parsedPlan.data;
    if (project.nodes.length === 0) {
      return NextResponse.json({ error: "Refusing to share an empty plan." }, { status: 400 });
    }

    const stats = computeCommunityPlanStats(project, calculateThroughput(project));
    const thumbnailDataUrl =
      typeof body.thumbnailDataUrl === "string" &&
      body.thumbnailDataUrl.startsWith("data:image/") &&
      body.thumbnailDataUrl.length <= COMMUNITY_THUMBNAIL_MAX_BYTES
        ? body.thumbnailDataUrl
        : undefined;

    const { error } = await db
      .from("community_plans")
      .update({
        name,
        description:
          typeof body.description === "string"
            ? body.description.trim().slice(0, COMMUNITY_DESCRIPTION_MAX_LENGTH)
            : "",
        game_version: typeof body.gameVersion === "string" ? body.gameVersion.slice(0, 60) : "",
        dataset_version:
          typeof body.datasetVersionId === "string" ? body.datasetVersionId.slice(0, 120) : "",
        plan: project,
        ...(thumbnailDataUrl ? { thumbnail_data_url: thumbnailDataUrl } : {}),
        needs: stats.needs,
        outputs: stats.outputs,
        total_eu_t: stats.totalEuT,
        machine_count: stats.machineCount,
        node_count: stats.nodeCount,
        storage_count: stats.storageCount,
        edge_count: stats.edgeCount,
        highest_tier: stats.highestTier ?? null,
        highest_tier_index: stats.highestTierIndex,
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ id: planId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Updating the plan failed." },
      { status: 500 },
    );
  }
}

/** Deletes a post: the owner (manage token) or the site admin (env token). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const body = (await request.json().catch(() => ({}))) as { manageToken?: unknown };
    const manageToken = typeof body.manageToken === "string" ? body.manageToken : "";

    const db = getCommunityDb();
    if (!isAdminRequest(request)) {
      const { data: existing } = await db
        .from("community_plans")
        .select("manage_token_hash")
        .eq("id", planId)
        .single<{ manage_token_hash: string }>();

      if (!existing) {
        return NextResponse.json({ error: "Plan not found." }, { status: 404 });
      }

      if (!manageToken || existing.manage_token_hash !== hashManageToken(manageToken)) {
        return NextResponse.json({ error: "You don't own this post." }, { status: 403 });
      }
    }

    const { error } = await db.from("community_plans").delete().eq("id", planId);
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deleting the plan failed." },
      { status: 500 },
    );
  }
}
