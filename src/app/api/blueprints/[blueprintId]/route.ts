import { NextResponse } from "next/server";
import type { BoardClipboardPayload } from "@/store/factory-store";
import { boardSelectionPayloadSchema } from "@/lib/model/schemas";
import {
  BLUEPRINT_NAME_MAX_LENGTH,
  BLUEPRINT_PAYLOAD_MAX_BYTES,
  normalizeBlueprintTags,
} from "@/lib/blueprints/types";
import {
  checkRateLimit,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
  parseEntryIcon,
} from "@/lib/server/community";
import {
  BLUEPRINT_SUMMARY_COLUMNS,
  blueprintStorageErrorMessage,
  countBlueprintMachines,
  parseHighestTier,
  parseResourceStats,
  rowToBlueprintSummary,
  type BlueprintRow,
} from "@/lib/server/blueprints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ blueprintId: string }> };

/**
 * The full payload, fetched only when a blueprint is actually placed. The
 * owner always may; anyone may once it is published — a public blueprint IS
 * its payload. (The counted download path is POST [id]/download; this GET
 * stays count-free for owners placing their own work.)
 */
export async function GET(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  const { blueprintId } = await context.params;
  const db = getCommunityDb();
  // Ownership is the cookie's user id, never a client-supplied owner.
  const { data, error } = await db
    .from("blueprints")
    .select(`${BLUEPRINT_SUMMARY_COLUMNS},payload`)
    .eq("id", blueprintId)
    .or(`is_public.eq.true${sessionUser ? `,user_id.eq.${sessionUser.id}` : ""}`)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: blueprintStorageErrorMessage(error, "Blueprint could not be loaded.") },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Blueprint not found." }, { status: 404 });
  }

  const row = data as BlueprintRow & { payload: BoardClipboardPayload };
  return NextResponse.json({
    blueprint: { ...rowToBlueprintSummary(row, sessionUser?.id), payload: row.payload },
  });
}

/**
 * Edits a blueprint IN PLACE — the row keeps its id, votes, downloads and
 * publish state, which is the whole point: an author refreshes a published
 * build without losing the standing it earned. `name` renames; `payload`
 * (with its stat card) overwrites the content from a pocket on the board.
 * Owner only, both.
 */
export async function PUT(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to edit blueprints." }, { status: 401 });
  }

  if (!(await checkRateLimit(`user:${sessionUser.id}`, "blueprint-update", 60, 60 * 60))) {
    return NextResponse.json(
      { error: "Editing too fast. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { name, payload, needs, outputs, tags, icon, highestTier, highestTierIndex } =
    (body ?? {}) as {
      name?: unknown;
      payload?: unknown;
      needs?: unknown;
      outputs?: unknown;
      tags?: unknown;
      icon?: unknown;
      highestTier?: unknown;
      highestTierIndex?: unknown;
    };

  const patch: Record<string, unknown> = {};
  if (tags !== undefined) {
    const normalizedTags = normalizeBlueprintTags(tags);
    patch.tags = normalizedTags;
    patch.tags_text = normalizedTags.join(" ");
  }
  if (icon !== undefined) {
    // A valid icon sets it; null (or junk) clears it.
    patch.icon = parseEntryIcon(icon);
  }
  if (name !== undefined) {
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName || trimmedName.length > BLUEPRINT_NAME_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Blueprint names run 1–${BLUEPRINT_NAME_MAX_LENGTH} characters.` },
        { status: 400 },
      );
    }
    patch.name = trimmedName;
  }
  if (payload !== undefined) {
    if (JSON.stringify(payload ?? null).length > BLUEPRINT_PAYLOAD_MAX_BYTES) {
      return NextResponse.json({ error: "Blueprint is too large to save." }, { status: 413 });
    }
    const parsedPayload = boardSelectionPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return NextResponse.json({ error: "Blueprint payload is not valid." }, { status: 400 });
    }
    const captured = parsedPayload.data;
    if (captured.nodes.length + captured.storages.length + captured.pockets.length === 0) {
      return NextResponse.json({ error: "Blueprint has no cards in it." }, { status: 400 });
    }
    // Stats are always derived server-side from the validated payload.
    patch.payload = captured;
    patch.node_count = captured.nodes.length;
    patch.storage_count = captured.storages.length;
    patch.edge_count = captured.edges.length;
    patch.pocket_count = captured.pockets.length;
    patch.machine_count = countBlueprintMachines(captured);
    patch.needs = parseResourceStats(needs);
    patch.outputs = parseResourceStats(outputs);
    patch.highest_tier = parseHighestTier(highestTier);
    patch.highest_tier_index = Number.isInteger(highestTierIndex) ? highestTierIndex : -1;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const db = getCommunityDb();
  const { blueprintId } = await context.params;
  // Ownership is the cookie's user id; the update matches nothing for anyone
  // else's blueprint, which reads back as 404.
  const { data, error } = await db
    .from("blueprints")
    .update(patch)
    .eq("id", blueprintId)
    .eq("user_id", sessionUser.id)
    .select(BLUEPRINT_SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: blueprintStorageErrorMessage(error, "Blueprint could not be updated.") },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Blueprint not found." }, { status: 404 });
  }

  return NextResponse.json({
    blueprint: rowToBlueprintSummary(data as BlueprintRow, sessionUser.id),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to use blueprints." }, { status: 401 });
  }

  const { blueprintId } = await context.params;
  const db = getCommunityDb();
  const { error } = await db
    .from("blueprints")
    .delete()
    .eq("id", blueprintId)
    .eq("user_id", sessionUser.id);
  if (error) {
    return NextResponse.json(
      { error: blueprintStorageErrorMessage(error, "Blueprint could not be deleted.") },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
