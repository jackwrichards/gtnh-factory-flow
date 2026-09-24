import { NextResponse } from "next/server";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { COMMUNITY_UPLOAD_MAX_BYTES } from "@/lib/community/types";
import {
  LIBRARY_DESIGN_NAME_MAX_LENGTH,
  LIBRARY_MAX_DESIGNS,
  type DesignUpsertBody,
} from "@/lib/library/sync-types";
import {
  checkRateLimit,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
  parseEntryIcon,
} from "@/lib/server/community";
import {
  DESIGN_META_COLUMNS,
  isIsoTimestamp,
  isLibraryId,
  libraryStorageErrorMessage,
  rowToDesignMeta,
  type DesignRow,
} from "@/lib/server/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ designId: string }> };

/** The plan itself, fetched when a pull finds it missing or moved. */
export async function GET(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to sync your library." }, { status: 401 });
  }

  const { designId } = await context.params;
  const db = getCommunityDb();
  const { data, error } = await db
    .from("library_designs")
    .select(`${DESIGN_META_COLUMNS},plan`)
    .eq("user_id", sessionUser.id)
    .eq("id", designId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: libraryStorageErrorMessage(error, "The design could not be loaded.") },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Design not found." }, { status: 404 });
  }
  const row = data as DesignRow & { plan: unknown };
  return NextResponse.json({ design: rowToDesignMeta(row), plan: row.plan });
}

/**
 * Upsert. The client owns the timestamps: `updatedAt` moves on any change,
 * `planUpdatedAt` only when the plan did, and the plan rides only then. A
 * row already NEWER than the incoming one (another device wrote since) is
 * left alone and reported back, so the client can pull it instead.
 */
export async function PUT(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to sync your library." }, { status: 401 });
  }
  // Everything that can refuse the request without the database goes before
  // the rate limit, which costs two round trips (a count and an insert).
  const { designId } = await context.params;
  if (!isLibraryId(designId)) {
    return NextResponse.json({ error: "Bad design id." }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (raw.length > COMMUNITY_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "This design is too large to sync." }, { status: 413 });
  }
  let body: Partial<DesignUpsertBody>;
  try {
    body = JSON.parse(raw) as Partial<DesignUpsertBody>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > LIBRARY_DESIGN_NAME_MAX_LENGTH) {
    return NextResponse.json({ error: "Design names run 1 to 80 characters." }, { status: 400 });
  }
  if (
    !isIsoTimestamp(body.createdAt) ||
    !isIsoTimestamp(body.updatedAt) ||
    !isIsoTimestamp(body.planUpdatedAt)
  ) {
    return NextResponse.json({ error: "Bad timestamps." }, { status: 400 });
  }
  if (body.folderId !== null && body.folderId !== undefined && !isLibraryId(body.folderId)) {
    return NextResponse.json({ error: "Bad folder id." }, { status: 400 });
  }
  // Autosave pushes a few seconds after edits stop; a busy hour is hundreds,
  // not thousands.
  if (!(await checkRateLimit(`user:${sessionUser.id}`, "library-save", 1200, 60 * 60))) {
    return NextResponse.json({ error: "Saving too fast. Try again later." }, { status: 429 });
  }

  const db = getCommunityDb();
  const { data: existing, error: readError } = await db
    .from("library_designs")
    .select(DESIGN_META_COLUMNS)
    .eq("user_id", sessionUser.id)
    .eq("id", designId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json(
      { error: libraryStorageErrorMessage(readError, "The design could not be saved.") },
      { status: 500 },
    );
  }
  const current = existing as DesignRow | null;

  // Another device wrote later than this one: the caller is behind, and its
  // pull will sort it out. Nothing is overwritten.
  if (current && Date.parse(current.updated_at) > Date.parse(body.updatedAt)) {
    return NextResponse.json({ design: rowToDesignMeta(current), behind: true });
  }

  let plan: unknown;
  if (body.plan !== undefined) {
    const parsed = factoryProjectSchema.safeParse(body.plan);
    if (!parsed.success) {
      return NextResponse.json({ error: "The plan is not valid." }, { status: 400 });
    }
    plan = parsed.data;
  } else if (!current) {
    return NextResponse.json({ error: "A new design needs its plan." }, { status: 400 });
  }

  if (!current) {
    const { count } = await db
      .from("library_designs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", sessionUser.id)
      .is("deleted_at", null);
    if ((count ?? 0) >= LIBRARY_MAX_DESIGNS) {
      return NextResponse.json(
        { error: `Your library is full (${LIBRARY_MAX_DESIGNS} designs). Delete some first.` },
        { status: 409 },
      );
    }
  }

  const row: Record<string, unknown> = {
    user_id: sessionUser.id,
    id: designId,
    name,
    icon: parseEntryIcon(body.icon),
    folder_id: body.folderId ?? null,
    closed: body.closed === true,
    favorite: body.favorite === true,
    sort_order: Number.isInteger(body.order) ? body.order : null,
    community_plan_id:
      typeof body.communityPlanId === "string" && body.communityPlanId.length <= 64
        ? body.communityPlanId
        : null,
    created_at: body.createdAt,
    updated_at: body.updatedAt,
    plan_updated_at: body.planUpdatedAt,
    // Writing a design brings it back: a tombstone is only ever older.
    deleted_at: null,
  };
  if (plan !== undefined) {
    row.plan = plan;
  }

  // An UPDATE for a row that exists, an INSERT for one that does not: an
  // upsert forms the insert row first, and a metadata-only save (no plan)
  // would trip the NOT NULL on plan before the conflict was ever checked.
  const { data, error } = current
    ? await db
        .from("library_designs")
        .update(row)
        .eq("user_id", sessionUser.id)
        .eq("id", designId)
        .select(DESIGN_META_COLUMNS)
        .single()
    : await db.from("library_designs").insert(row).select(DESIGN_META_COLUMNS).single();
  if (error || !data) {
    return NextResponse.json(
      { error: libraryStorageErrorMessage(error, "The design could not be saved.") },
      { status: 500 },
    );
  }
  return NextResponse.json({ design: rowToDesignMeta(data as DesignRow), behind: false });
}

/** A tombstone, never a hole: other devices need to hear about it. */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to sync your library." }, { status: 401 });
  }

  const { designId } = await context.params;
  const now = new Date().toISOString();
  const db = getCommunityDb();
  const { error } = await db
    .from("library_designs")
    .update({ deleted_at: now, updated_at: now, plan: {} })
    .eq("user_id", sessionUser.id)
    .eq("id", designId);
  if (error) {
    return NextResponse.json(
      { error: libraryStorageErrorMessage(error, "The design could not be deleted.") },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, deletedAt: now });
}
