import { NextResponse } from "next/server";
import {
  ALL_REACHABILITY_SOURCES,
  type ReachabilityRootsConfig,
  type ReachabilitySource,
} from "@/lib/reachability/api-types";
import {
  computeDatasetReachability,
  computeDatasetReachabilityChain,
} from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReachabilityRequestBody {
  action?: "summary" | "chain";
  roots?: Partial<ReachabilityRootsConfig>;
  query?: string;
  offset?: number;
  limit?: number;
  target?: { kind?: string; id?: string };
  /** resource key -> recipe id: the review pane's chosen producers. */
  preferredProducers?: Record<string, string>;
}

function normalizeRoots(roots: Partial<ReachabilityRootsConfig> | undefined): ReachabilityRootsConfig {
  const known = new Set<string>(ALL_REACHABILITY_SOURCES);
  const sources = (roots?.sources ?? ALL_REACHABILITY_SOURCES).filter((source): source is ReachabilitySource =>
    known.has(source),
  );
  return {
    sources,
    extraResourceKeys: stringList(roots?.extraResourceKeys),
    disabledResourceKeys: stringList(roots?.disabledResourceKeys),
    disabledRecipeIds: stringList(roots?.disabledRecipeIds),
  };
}

function normalizePreferences(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, 500);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  // Body size is the only real risk on this endpoint; a plan's worth of extra
  // roots is dozens, so thousands means a malformed caller.
  return strings.slice(0, 5000);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const body = (await request.json()) as ReachabilityRequestBody;
    const roots = normalizeRoots(body.roots);

    if (body.action === "chain") {
      if (!body.target?.kind || !body.target?.id) {
        return NextResponse.json({ error: "A chain request needs a target." }, { status: 400 });
      }
      return NextResponse.json(
        await computeDatasetReachabilityChain(
          versionId,
          roots,
          { kind: body.target.kind, id: body.target.id },
          normalizePreferences(body.preferredProducers),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      await computeDatasetReachability(versionId, roots, {
        query: typeof body.query === "string" ? body.query : undefined,
        offset: typeof body.offset === "number" ? body.offset : undefined,
        limit: typeof body.limit === "number" ? body.limit : undefined,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reachability computation failed." },
      { status: 500 },
    );
  }
}
