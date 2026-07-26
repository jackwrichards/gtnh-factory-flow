import { NextResponse } from "next/server";
import type { CommunityVoteResponse } from "@/lib/community/types";
import {
  checkRateLimit,
  getCommunityDb,
  isCommunityConfigured,
  makeActorKey,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Casts, switches, or (when re-sending the same value) retracts a vote.
 * Votes are keyed by hashed IP + device id — anonymous but deduplicated.
 */
export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const body = (await request.json()) as { deviceId?: unknown; value?: unknown };
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
    const value = body.value === 1 || body.value === -1 ? body.value : undefined;
    if (!deviceId || value === undefined) {
      return NextResponse.json({ error: "Invalid vote." }, { status: 400 });
    }

    const actorKey = makeActorKey(request, deviceId);
    if (!(await checkRateLimit(actorKey, "vote", 60, 60 * 10))) {
      return NextResponse.json({ error: "Voting too fast — slow down." }, { status: 429 });
    }

    const db = getCommunityDb();
    const { data: existing } = await db
      .from("community_votes")
      .select("value")
      .eq("plan_id", planId)
      .eq("voter_key", actorKey)
      .maybeSingle();

    let myVote: 1 | -1 | undefined;
    if (existing && existing.value === value) {
      await db.from("community_votes").delete().eq("plan_id", planId).eq("voter_key", actorKey);
      myVote = undefined;
    } else {
      const { error } = await db
        .from("community_votes")
        .upsert({ plan_id: planId, voter_key: actorKey, value });
      if (error) {
        throw new Error(error.message);
      }
      myVote = value;
    }

    // Recount instead of increment: idempotent under races and self-healing.
    const [{ count: upvotes }, { count: downvotes }] = await Promise.all([
      db
        .from("community_votes")
        .select("plan_id", { count: "exact", head: true })
        .eq("plan_id", planId)
        .eq("value", 1),
      db
        .from("community_votes")
        .select("plan_id", { count: "exact", head: true })
        .eq("plan_id", planId)
        .eq("value", -1),
    ]);

    const { error: updateError } = await db
      .from("community_plans")
      .update({ upvotes: upvotes ?? 0, downvotes: downvotes ?? 0 })
      .eq("id", planId);
    if (updateError) {
      throw new Error(updateError.message);
    }

    const response: CommunityVoteResponse = {
      upvotes: upvotes ?? 0,
      downvotes: downvotes ?? 0,
      score: (upvotes ?? 0) - (downvotes ?? 0),
      myVote,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voting failed." },
      { status: 500 },
    );
  }
}
