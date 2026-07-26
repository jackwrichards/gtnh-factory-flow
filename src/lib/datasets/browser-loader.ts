"use client";

import type { MachineTier, Recipe, RecipeOutput, ResourceAmount } from "@/lib/model/types";
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
