import { NextResponse } from "next/server";
import {
  attachMyVotes,
  getCommunityDb,
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
