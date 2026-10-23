import { NextResponse } from "next/server";
import {
  addressKey,
  checkRateLimits,
  SITE_KEY,
  getCommunityDb,
  hashPassword,
  isCommunityConfigured,
  makeSessionToken,
  sessionCookieHeader,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,24}$/;

export async function POST(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Community hub is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!USERNAME_PATTERN.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-24 characters: letters, numbers, - or _." },
        { status: 400 },
      );
    }

    if (password.length < 6 || password.length > 128) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 },
      );
    }

    // Per address, and a site-wide cap: thousands of accounts have been made
    // from thousands of addresses, a handful each.
    if (
      !(await checkRateLimits([
        { actorKey: addressKey(request), action: "register", max: 5, windowSeconds: 60 * 60 },
        { actorKey: addressKey(request), action: "register", max: 10, windowSeconds: 24 * 60 * 60 },
        { actorKey: SITE_KEY, action: "register", max: 60, windowSeconds: 60 * 60 },
      ]))
    ) {
      return NextResponse.json(
        { error: "Too many accounts created. Try again later." },
        { status: 429 },
      );
    }

    const db = getCommunityDb();
    const { data, error } = await db
      .from("community_users")
      .insert({ username, password_hash: hashPassword(password) })
      .select("id,username")
      .single<{ id: string; username: string }>();

    if (error || !data) {
      const taken = error?.message.includes("duplicate") || error?.code === "23505";
      return NextResponse.json(
        { error: taken ? "That username is taken." : (error?.message ?? "Sign up failed.") },
        { status: taken ? 409 : 500 },
      );
    }

    return NextResponse.json(
      { username: data.username, isAdmin: false },
      { status: 201, headers: { "Set-Cookie": sessionCookieHeader(makeSessionToken(data.id)) } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign up failed." },
      { status: 500 },
    );
  }
}
