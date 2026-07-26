import { NextResponse } from "next/server";
import { getSessionUser, isCommunityConfigured } from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ user: null });
  }

  const user = await getSessionUser(request);
  return NextResponse.json(
    { user: user ? { username: user.username } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
