"use client";

import type { MachineTier, Recipe, RecipeOutput, ResourceAmount } from "@/lib/model/types";
import type {
  ExistingProduction,
  GapFillPlan,
  GapSolveOptions,
  GapSolveProgress,
  GapSolveTarget,
  PlannerResource,
} from "@/lib/planner/types";
import type {
  DatasetResourceIndexEntry,
  DatasetVersion,
  RecipeDataset,
  RecipeSummary,
} from "./types";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

export interface RecipeDatasetQuery {
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap?: string;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}

export interface RecipeDatasetQueryResult {
  recipes: RecipeSummary[];
  total: number;
  recipeMaps: string[];
  recipeMapIcons?: Record<string, DatasetResourceIndexEntry>;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface RecipeDatasetResourceQuery {
  query: string;
  offset: number;
  limit: number;
}

export interface RecipeDatasetResourceQueryResult {
  resources: DatasetResourceIndexEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface RecipeDatasetResolveRef {
  id: string;
  name: string;
  machineType: string;
  recipeMap?: string;
  rawRecipeId?: string;
  outputs: Array<Pick<RecipeOutput, "kind" | "id">>;
}

export interface RecipeDatasetResolveResult {
  matches: Array<{
    importedId: string;
    recipeId: string;
  }>;
}

export async function initRecipeDatasetVersion(
  _manifestUrl: string,
  version: DatasetVersion,
  options: { signal?: AbortSignal } = {},
): Promise<RecipeDataset> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/catalog`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<RecipeDataset>(url.toString(), { signal: options.signal });
}

export async function getRecipeDatasetRecipe(
  _manifestUrl: string,
  version: DatasetVersion,
  recipeId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Recipe> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/recipes/${encodeURIComponent(recipeId)}`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<Recipe>(url.toString(), { signal: options.signal });
}

export async function getRecipeDatasetRecipeIds(
  _manifestUrl: string,
  version: DatasetVersion,
): Promise<string[]> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/recipe-ids`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  const result = await fetchJson<{ recipeIds: string[] }>(url.toString());
  return result.recipeIds;
}

export async function resolveRecipeDatasetRecipes(
  _manifestUrl: string,
  version: DatasetVersion,
  recipes: RecipeDatasetResolveRef[],
): Promise<RecipeDatasetResolveResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/resolve-recipes`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<RecipeDatasetResolveResult>(url.toString(), {
    method: "POST",
    body: JSON.stringify({ recipes }),
  });
}

export async function queryRecipeDatasetRecipes(
  _manifestUrl: string,
  version: DatasetVersion,
  query: RecipeDatasetQuery,
  options: { signal?: AbortSignal } = {},
): Promise<RecipeDatasetQueryResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/recipes`,
    window.location.origin,
  );
  url.searchParams.set("query", query.query);
  url.searchParams.set("mode", query.mode);
  url.searchParams.set("maxTier", query.maxTier);
  url.searchParams.set("offset", String(query.offset));
  url.searchParams.set("limit", String(query.limit));
  addDatasetCacheKey(url, version);
  if (query.recipeMap) {
    url.searchParams.set("recipeMap", query.recipeMap);
  }
  if (query.resource) {
    url.searchParams.set("resourceKind", query.resource.kind);
    url.searchParams.set("resourceId", query.resource.id);
  }

  return fetchJson<RecipeDatasetQueryResult>(url.toString(), { signal: options.signal });
}

export async function queryRecipeDatasetResources(
  _manifestUrl: string,
  version: DatasetVersion,
  query: RecipeDatasetResourceQuery,
  options: { signal?: AbortSignal } = {},
): Promise<RecipeDatasetResourceQueryResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/resources`,
    window.location.origin,
  );
  url.searchParams.set("query", query.query);
  url.searchParams.set("offset", String(query.offset));
  url.searchParams.set("limit", String(query.limit));
  addDatasetCacheKey(url, version);

  return fetchJson<RecipeDatasetResourceQueryResult>(url.toString(), { signal: options.signal });
}

export interface RecipeDatasetSolveRequest {
  target: GapSolveTarget;
  supply: PlannerResource[];
  existingOutputs?: ExistingProduction[];
  maxTier: TierFilter;
  options?: Pick<
    GapSolveOptions,
    "planCount" | "beamWidth" | "maxDepth" | "maxSteps" | "allowedRecipeMaps"
  >;
}

export interface RecipeDatasetSolveResult {
  plans: Array<GapFillPlan<Recipe>>;
  notes: string[];
  timings?: {
    totalMs: number;
    indexMs: number;
    searchMs: number;
    hydrateMs: number;
    lookups: number;
  };
}

/**
 * Runs a solve and narrates it: the endpoint streams newline-delimited JSON —
 * progress heartbeats while the search runs, then a final result line.
 */
export async function solveRecipeDatasetGap(
  _manifestUrl: string,
  version: DatasetVersion,
  request: RecipeDatasetSolveRequest,
  options: { signal?: AbortSignal; onProgress?: (progress: GapSolveProgress) => void } = {},
): Promise<RecipeDatasetSolveResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/solve`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);

  const response = await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("ndjson") || !response.body) {
    const body = await response.text();
    const payload = safeParseJson(body) as
      | {
          error?: string;
          plans?: RecipeDatasetSolveResult["plans"];
          notes?: string[];
          timings?: RecipeDatasetSolveResult["timings"];
        }
      | undefined;
    if (response.ok && payload?.plans) {
      return { plans: payload.plans, notes: payload.notes ?? [], timings: payload.timings };
    }

    throw new Error(
      payload?.error ?? `Request failed (${response.status} ${response.statusText || "HTTP error"}).`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: RecipeDatasetSolveResult | undefined;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const event = safeParseJson(trimmed) as
      | ({ type: "progress"; progress: GapSolveProgress } | ({ type: "result" } & RecipeDatasetSolveResult) | { type: "error"; error?: string })
      | undefined;
    if (!event) {
      return;
    }

    if (event.type === "progress") {
      options.onProgress?.(event.progress);
      return;
    }

    if (event.type === "result") {
      result = { plans: event.plans, notes: event.notes ?? [], timings: event.timings };
      return;
    }

    throw new Error(event.error ?? "Gap solve failed.");
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      handleLine(buffered.slice(0, newlineIndex));
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  }
  handleLine(buffered);

  if (!result) {
    throw new Error("The solve stream ended without a result.");
  }

  return result;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export const loadRecipeDatasetVersion = initRecipeDatasetVersion;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const payload =
    body && contentType.includes("application/json")
      ? (JSON.parse(body) as T | { error?: string })
      : undefined;

  if (!response.ok) {
    throw new Error(
      typeof payload === "object" && payload && "error" in payload && payload.error
        ? payload.error
        : `Request failed (${response.status} ${response.statusText || "HTTP error"}).`,
    );
  }

  if (!payload) {
    const preview = body.trim().replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `Expected JSON but received ${contentType || "an unknown content type"}${
        preview ? `: ${preview}` : "."
      }`,
    );
  }

  return payload as T;
}

function addDatasetCacheKey(url: URL, version: DatasetVersion) {
  url.searchParams.set("datasetHash", version.checksumSha256 ?? version.publishedAt ?? version.id);
}
