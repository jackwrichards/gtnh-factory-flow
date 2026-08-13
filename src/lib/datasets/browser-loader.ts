"use client";

import type { MachineTier, Recipe, RecipeOutput, ResourceAmount } from "@/lib/model/types";
import type {
  ReachabilityChainResult,
  ReachabilityRootsConfig,
  ReachabilitySummaryResult,
} from "@/lib/reachability/api-types";
import type { SearchCorrection, SearchPhase } from "@/lib/search";
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
  searchPhase?: SearchPhase;
  corrections?: SearchCorrection[];
}

export interface RecipeDatasetResourceQuery {
  query: string;
  offset: number;
  limit: number;
  kind?: "item" | "fluid";
  mod?: string;
  sort?: "relevance" | "name" | "mod" | "recipes";
  /** Narrow to what a crop can grow or a bee can make. */
  source?: "plants" | "bees";
}

export interface RecipeDatasetResourceQueryResult {
  resources: DatasetResourceIndexEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** Mods present in the current search scope, with match counts. */
  mods?: Array<{ id: string; count: number }>;
  /** How the results were arrived at: as typed, respelled, or loosened. */
  searchPhase?: SearchPhase;
  /** The words that had to be respelled to find anything. */
  corrections?: SearchCorrection[];
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

/**
 * Full recipes already fetched this session, keyed by their request URL (which
 * carries the dataset hash, so a republished dataset misses cleanly). Even
 * with HTTP caching in play this saves the parse and the cache lookup, and it
 * holds the promise rather than the recipe so a hover prefetch and the click
 * that follows it share one request.
 */
const recipeFetchCache = new Map<string, Promise<Recipe>>();
const RECIPE_FETCH_CACHE_LIMIT = 256;

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
  const key = url.toString();
  if (options.signal) {
    // An abortable request is one caller's alone; caching it would let that
    // caller's abort reject everyone else's hit.
    return fetchJson<Recipe>(key, { signal: options.signal });
  }

  const cached = recipeFetchCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = fetchJson<Recipe>(key).catch((error) => {
    recipeFetchCache.delete(key);
    throw error;
  });
  if (recipeFetchCache.size >= RECIPE_FETCH_CACHE_LIMIT) {
    const oldest = recipeFetchCache.keys().next().value;
    if (oldest !== undefined) {
      recipeFetchCache.delete(oldest);
    }
  }
  recipeFetchCache.set(key, promise);
  return promise;
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

export async function queryRecipeDatasetReachability(
  _manifestUrl: string,
  version: DatasetVersion,
  body: {
    action?: "summary" | "chain";
    roots: ReachabilityRootsConfig;
    query?: string;
    offset?: number;
    limit?: number;
    target?: { kind: string; id: string };
    preferredProducers?: Record<string, string>;
  },
  options: { signal?: AbortSignal } = {},
): Promise<ReachabilitySummaryResult | ReachabilityChainResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/reachability`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<ReachabilitySummaryResult | ReachabilityChainResult>(url.toString(), {
    method: "POST",
    body: JSON.stringify(body),
    signal: options.signal,
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

export async function listRecipeDatasetCrops(
  _manifestUrl: string,
  version: DatasetVersion,
  options: { signal?: AbortSignal } = {},
): Promise<{ crops: RecipeSummary[] }> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/crops`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<{ crops: RecipeSummary[] }>(url.toString(), { signal: options.signal });
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
  if (query.kind) {
    url.searchParams.set("kind", query.kind);
  }
  if (query.mod) {
    url.searchParams.set("mod", query.mod);
  }
  if (query.sort && query.sort !== "relevance") {
    url.searchParams.set("sort", query.sort);
  }
  if (query.source) {
    url.searchParams.set("source", query.source);
  }
  addDatasetCacheKey(url, version);

  return fetchJson<RecipeDatasetResourceQueryResult>(url.toString(), { signal: options.signal });
}

export const loadRecipeDatasetVersion = initRecipeDatasetVersion;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // No cache mode: every GET here carries the dataset checksum in its URL, so
  // the browser's HTTP cache can legally reuse responses across reloads and
  // sessions. The server marks fingerprinted responses immutable to match.
  const response = await fetch(url, {
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
