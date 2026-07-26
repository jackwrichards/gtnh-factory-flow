import { NextResponse } from "next/server";
import { getCommunityDb, isCommunityConfigured } from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the full plan JSON and counts the download. */
export async function POST(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const db = getCommunityDb();

    const { data, error } = await db
      .from("community_plans")
      .select("plan,downloads,name")
      .eq("id", planId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }

    await db
      .from("community_plans")
      .update({ downloads: (data.downloads as number) + 1 })
      .eq("id", planId);

    return NextResponse.json(
      { name: data.name, plan: data.plan },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Downloading the plan failed." },
      { status: 500 },
    );
  }
}
