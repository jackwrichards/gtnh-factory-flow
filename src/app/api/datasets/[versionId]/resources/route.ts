import { NextResponse } from "next/server";
import { queryDatasetResources } from "@/lib/server/dataset-query";

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
    const result = await queryDatasetResources(versionId, {
      query: url.searchParams.get("query") ?? "",
      offset: parseOffset(url.searchParams.get("offset")),
      limit: parseLimit(url.searchParams.get("limit")),
      kind: kindParam === "item" || kindParam === "fluid" ? kindParam : undefined,
      mod: url.searchParams.get("mod") ?? undefined,
      sort:
        sortParam === "name" || sortParam === "mod" || sortParam === "recipes"
          ? sortParam
          : undefined,
    });
    return NextResponse.json(result, {
      headers: datasetCacheHeaders(),
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

function datasetCacheHeaders() {
  return {
    "Cache-Control": "no-store",
  };
}
