import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { queryDatasetResources } from "@/lib/server/dataset-query";
import { getResourcePopularity } from "@/lib/server/resource-popularity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    const sortParam = url.searchParams.get("sort");
    const sourceParam = url.searchParams.get("source");
    // Never awaits the database: the last good ranking, or none yet.
    const popularity = sortParam === "popular" ? getResourcePopularity() : undefined;
    const result = await queryDatasetResources(versionId, {
      query: url.searchParams.get("query") ?? "",
      offset: parseOffset(url.searchParams.get("offset")),
      limit: parseLimit(url.searchParams.get("limit")),
      kind: kindParam === "item" || kindParam === "fluid" ? kindParam : undefined,
      mod: url.searchParams.get("mod") ?? undefined,
      sort:
        sortParam === "name" ||
        sortParam === "mod" ||
        sortParam === "recipes" ||
        sortParam === "made" ||
        sortParam === "uses" ||
        sortParam === "popular"
          ? sortParam
          : undefined,
      source: sourceParam === "plants" || sourceParam === "bees" ? sourceParam : undefined,
      popularity,
    });
    return NextResponse.json(result, {
      // Popularity is community data, not dataset bytes: the datasetHash
      // fingerprint doesn't pin it, so it must not ride the immutable policy.
      // Before the first sweep lands the order is plain best match, which
      // must not stick in a browser for half an hour.
      headers:
        sortParam === "popular"
          ? { "Cache-Control": popularity?.size ? "public, max-age=1800" : "no-store" }
          : datasetCacheHeaders(request),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Resource query failed." },
      { status: 500 },
    );
  }
}

function parseOffset(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(120, parsed)) : 24;
}

