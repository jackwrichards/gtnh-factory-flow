import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { calculateThroughput } from "@/lib/solver";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { APP_VERSION } from "@/lib/version";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  COMMUNITY_UPLOAD_MAX_BYTES,
} from "@/lib/community/types";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import { PLAN_PREVIEW_BUCKET } from "@/lib/server/plan-preview";
import {
  attachMyVotes,
  communityStorageErrorMessage,
  getCommunityDb,
  getSessionUser,
  isAdminRequest,
  isCommunityConfigured,
  makeActorKey,
  parseEntryIcon,
  PLAN_SUMMARY_COLUMNS,
  rowToPlanSummary,
  type PlanRow,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan detail. Counts one view per request (client only calls on preview
 * open), except when the caller says `countView=0`: the plan card refreshes
 * this summary in the background, and background reads are not views.
 */
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

    const sessionUser = await getSessionUser(request);
    // Unpublished posts exist only for their owner (and the site admin).
    if (
      data.is_public === false &&
      data.user_id !== sessionUser?.id &&
      !sessionUser?.is_admin &&
      !isAdminRequest(request)
    ) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    const countView = url.searchParams.get("countView") !== "0";
    if (countView) {
      await db
        .from("community_plans")
        .update({ views: data.views + 1 })
        .eq("id", planId);
    }
    const plan = rowToPlanSummary(
      { ...data, views: data.views + (countView ? 1 : 0) },
      sessionUser?.id,
    );
    await refreshStaleStats(db, planId, plan);
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

/**
 * Saved stat cards go stale as the solver improves: a plan shared by an old
 * release keeps the numbers that release computed, so its preview disagrees
 * with the board a player sees on opening it. On preview open, recompute from
 * the stored plan JSON with today's solver — once per plan per release — and
 * persist the result. Best-effort throughout: a schema without the
 * stats_version column, a plan today's parser rejects, or a failed write all
 * leave the saved card serving as before, except that freshly computed
 * numbers still go out in this response even when the write fails.
 */
async function refreshStaleStats(
  db: SupabaseClient,
  planId: string,
  plan: CommunityPlanSummary,
): Promise<void> {
  try {
    const { data, error } = await db
      .from("community_plans")
      .select("stats_version")
      .eq("id", planId)
      .single<{ stats_version: string | null }>();
    if (error || data?.stats_version === APP_VERSION) {
      return;
    }

    const { data: planRow } = await db
      .from("community_plans")
      .select("plan")
      .eq("id", planId)
      .single<{ plan: unknown }>();
    const parsed = factoryProjectSchema.safeParse(planRow?.plan);
    if (!parsed.success) {
      return;
    }

    // The same funnel the board runs a loaded plan through, so the card and
    // the opened tab compute from the identical project.
    const project = normalizeLoadedProject(parsed.data);
    const stats = computeCommunityPlanStats(project, calculateThroughput(project));
    plan.needs = stats.needs;
    plan.outputs = stats.outputs;
    plan.totalEuT = stats.totalEuT;
    plan.machineCount = stats.machineCount;
    plan.nodeCount = stats.nodeCount;
    plan.storageCount = stats.storageCount;
    plan.edgeCount = stats.edgeCount;
    plan.highestTier = stats.highestTier;
    plan.highestTierIndex = stats.highestTierIndex;

    // Not an author edit: updated_at stays untouched.
    await db
      .from("community_plans")
      .update({
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
      })
      .eq("id", planId);
  } catch {
    // A plan today's solver chokes on keeps its saved card.
  }
}

/** Updates a post in place. Only the signed-in owner may do this. */
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
      name?: unknown;
      description?: unknown;
      gameVersion?: unknown;
      datasetVersionId?: unknown;
      plan?: unknown;
      tags?: unknown;
      isPublic?: unknown;
      icon?: unknown;
    };

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Sign in to update your post." }, { status: 401 });
    }

    const db = getCommunityDb();
    const { data: existing } = await db
      .from("community_plans")
      .select("id,user_id")
      .eq("id", planId)
      .single<{ id: string; user_id: string | null }>();

    if (!existing) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    if (existing.user_id !== sessionUser.id) {
      return NextResponse.json({ error: "You don't own this post." }, { status: 403 });
    }

    // Field-wise update: the share dialog re-sends everything, while the
    // shelf's tag editor sends tags alone — no need to round-trip the plan
    // JSON just to relabel a post.
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > COMMUNITY_NAME_MAX_LENGTH) {
        return NextResponse.json(
          { error: "Plan name is required (max 80 chars)." },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if (body.description !== undefined) {
      update.description =
        typeof body.description === "string"
          ? body.description.trim().slice(0, COMMUNITY_DESCRIPTION_MAX_LENGTH)
          : "";
    }

    if (body.gameVersion !== undefined) {
      update.game_version = typeof body.gameVersion === "string" ? body.gameVersion.slice(0, 60) : "";
    }

    if (body.datasetVersionId !== undefined) {
      update.dataset_version =
        typeof body.datasetVersionId === "string" ? body.datasetVersionId.slice(0, 120) : "";
    }

    if (body.tags !== undefined) {
      const tags = normalizeBlueprintTags(body.tags);
      update.tags = tags;
      update.tags_text = tags.join(" ");
    }

    if (typeof body.isPublic === "boolean") {
      update.is_public = body.isPublic;
    }

    if (body.icon !== undefined) {
      // A valid icon sets it; null (or junk) clears it.
      update.icon = parseEntryIcon(body.icon);
    }

    if (body.plan !== undefined) {
      const parsedPlan = factoryProjectSchema.safeParse(body.plan);
      if (!parsedPlan.success) {
        return NextResponse.json({ error: "Plan JSON is not a valid project." }, { status: 400 });
      }

      const project = parsedPlan.data;
      if (project.nodes.length === 0) {
        return NextResponse.json({ error: "Refusing to share an empty plan." }, { status: 400 });
      }

      const stats = computeCommunityPlanStats(project, calculateThroughput(project));
      Object.assign(update, {
        plan: project,
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
      });
    }

    const { error } = await db.from("community_plans").update(update).eq("id", planId);

    if (error) {
      throw new Error(communityStorageErrorMessage(error, "Updating the plan failed."));
    }

    return NextResponse.json({ id: planId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Updating the plan failed." },
      { status: 500 },
    );
  }
}

/** Deletes a post: the signed-in owner or the site admin (env token). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const db = getCommunityDb();
    if (!isAdminRequest(request)) {
      const sessionUser = await getSessionUser(request);
      if (!sessionUser) {
        return NextResponse.json({ error: "Sign in to take down your post." }, { status: 401 });
      }

      const { data: existing } = await db
        .from("community_plans")
        .select("user_id")
        .eq("id", planId)
        .single<{ user_id: string | null }>();

      if (!existing) {
        return NextResponse.json({ error: "Plan not found." }, { status: 404 });
      }

      if (existing.user_id !== sessionUser.id && !sessionUser.is_admin) {
        return NextResponse.json({ error: "You don't own this post." }, { status: 403 });
      }
    }

    const { error } = await db.from("community_plans").delete().eq("id", planId);
    if (error) {
      throw new Error(error.message);
    }

    // The post's board photograph goes with it. Best-effort: a missing
    // object (pre-preview posts) is the normal case, not a failure.
    await db.storage
      .from(PLAN_PREVIEW_BUCKET)
      .remove([`${planId}.png`])
      .catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deleting the plan failed." },
      { status: 500 },
    );
  }
}
