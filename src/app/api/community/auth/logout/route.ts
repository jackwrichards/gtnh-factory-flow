import { NextResponse } from "next/server";
import { sessionCookieHeader } from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader("", true) } },
  );
}
