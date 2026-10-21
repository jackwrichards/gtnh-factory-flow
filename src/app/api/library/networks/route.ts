import { NextResponse } from "next/server";
import { z } from "zod";
import { catalogueSchema } from "@/lib/networks/model";
import {
  checkRateLimit,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
} from "@/lib/server/community";
import { libraryStorageErrorMessage } from "@/lib/server/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.object({
  revision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  networks: catalogueSchema,
});

function networkStorageError(error: { code?: string; message?: string }, fallback: string): string {
  if (["PGRST205", "42P01", "PGRST204", "42703"].includes(error.code ?? ""))
    return "Network sync is not set up: run supabase/migrations/2026-10-19-plan-networks.sql in the Supabase SQL editor.";
  return libraryStorageErrorMessage(error, fallback);
}

async function authenticate(request: Request) {
  if (!isCommunityConfigured())
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  return user ?? NextResponse.json({ error: "Sign in to sync your networks." }, { status: 401 });
}

export async function GET(request: Request) {
  const user = await authenticate(request);
  if (user instanceof Response) return user;
  const { data, error } = await getCommunityDb()
    .from("library_networks")
    .select("revision,networks")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: networkStorageError(error, "Your networks could not be loaded.") },
      { status: 500 },
    );
  return NextResponse.json(data ?? { revision: 0, networks: [] });
}

/** One conditional write protects the entire hierarchy, including membership uniqueness across roots. */
export async function PUT(request: Request) {
  const user = await authenticate(request);
  if (user instanceof Response) return user;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1_000_000)
    return NextResponse.json({ error: "Your networks are too large to sync." }, { status: 413 });
  let body;
  try {
    body = bodySchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: "Invalid network hierarchy or membership." },
      { status: 400 },
    );
  }
  if (!(await checkRateLimit(`user:${user.id}`, "library-networks", 300, 3600)))
    return NextResponse.json({ error: "Saving too fast. Try again later." }, { status: 429 });
  const db = getCommunityDb();
  const next = { revision: body.revision + 1, networks: body.networks };
  const result =
    body.revision === 0
      ? await db
          .from("library_networks")
          .insert({ user_id: user.id, ...next })
          .select("revision,networks")
          .maybeSingle()
      : await db
          .from("library_networks")
          .update(next)
          .eq("user_id", user.id)
          .eq("revision", body.revision)
          .select("revision,networks")
          .maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data))
    return NextResponse.json(
      {
        error:
          "Your networks changed on another device. Review the saved version before replacing it.",
      },
      { status: 409 },
    );
  if (result.error)
    return NextResponse.json(
      { error: networkStorageError(result.error, "Your networks could not be saved.") },
      { status: 500 },
    );
  return NextResponse.json(result.data);
}
