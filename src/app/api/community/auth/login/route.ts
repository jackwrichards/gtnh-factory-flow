import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getCommunityDb,
  isCommunityConfigured,
  makeActorKey,
  makeSessionToken,
  sessionCookieHeader,
  verifyPassword,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required." }, { status: 400 });
    }

    const actorKey = makeActorKey(request);
    if (!(await checkRateLimit(actorKey, "login", 20, 60 * 10))) {
      return NextResponse.json({ error: "Too many attempts — slow down." }, { status: 429 });
    }

    const { data } = await getCommunityDb()
      .from("community_users")
      .select("id,username,password_hash,is_admin")
      .eq("username", username)
      .single<{ id: string; username: string; password_hash: string; is_admin: boolean }>();

    if (!data || !verifyPassword(password, data.password_hash)) {
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }

    return NextResponse.json(
      { username: data.username, isAdmin: data.is_admin },
      { headers: { "Set-Cookie": sessionCookieHeader(makeSessionToken(data.id)) } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign in failed." },
      { status: 500 },
    );
  }
}
