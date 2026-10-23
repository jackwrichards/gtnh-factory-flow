import { NextResponse } from "next/server";
import type { CommunityVoteResponse } from "@/lib/community/types";
import {
  accountKey,
  addressKey,
  checkRateLimits,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
  isMissingColumnError,
  makeVoterKey,
} from "@/lib/server/community";
import { invalidatePlanListCache } from "@/lib/server/plan-list-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Casts, switches, or (when re-sending the same value) retracts a vote.
 * Only a signed-in account votes, once per plan (see makeVoterKey); the
 * account and the address each feed a rate limit.
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
    if (value === undefined) {
      return NextResponse.json({ error: "Invalid vote." }, { status: 400 });
    }

    // One vote per account: a device id is whatever the client sends, so
    // anonymous votes could be cast without end.
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });
    }
    if (
      !(await checkRateLimits([
        { actorKey: accountKey(sessionUser.id), action: "vote", max: 60, windowSeconds: 60 * 10 },
        { actorKey: addressKey(request), action: "vote", max: 120, windowSeconds: 60 * 10 },
      ]))
    ) {
      return NextResponse.json({ error: "Voting too fast. Slow down." }, { status: 429 });
    }
    const voterKey = await makeVoterKey(request, deviceId);

    const db = getCommunityDb();
    const { data: existing } = await db
      .from("community_votes")
      .select("value")
      .eq("plan_id", planId)
      .eq("voter_key", voterKey)
      .maybeSingle();

    let myVote: 1 | -1 | undefined;
    if (existing && existing.value === value) {
      await db.from("community_votes").delete().eq("plan_id", planId).eq("voter_key", voterKey);
      myVote = undefined;
    } else {
      // user_id carries the database's one-vote-per-account index; a database
      // not yet migrated takes the vote without it (voter_key is still the account).
      let { error } = await db
        .from("community_votes")
        .upsert({ plan_id: planId, voter_key: voterKey, user_id: sessionUser.id, value });
      if (error && isMissingColumnError(error)) {
        ({ error } = await db
          .from("community_votes")
          .upsert({ plan_id: planId, voter_key: voterKey, value }));
      }
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

    invalidatePlanListCache();
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
