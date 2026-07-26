import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type {
  DatasetManifest,
  DatasetResource,
  DatasetResourceIndexEntry,
  DatasetVersion,
  RecipeMapIconEntry,
  RecipeSummary,
} from "@/lib/datasets/types";
import type { MachineTier, Recipe, RecipeOutput, ResourceAmount } from "@/lib/model/types";
import {
  enrichPassiveProductionRecipe,
  getFilledCellFluidEquivalent,
  getRecipePowerTier,
  GT_VOLTAGE_TIERS,
  isOreDictionaryResource,
  isVirtualChoiceResource,
  resourceMatchesInput,
} from "@/lib/model";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;
type SearchableResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "tooltip"
> & {
  alternatives?: SearchableResource[];
};

interface RecipeIndexShard {
  id: string;
  path: string;
  start: number;
  end: number;
}

interface LoadedRecipeIndex {
  version: DatasetVersion;
  resources: DatasetResource[];
  resourceIndex: DatasetResourceIndexEntry[];
  recipeMaps: string[];
  recipeMapIcons?: RecipeMapIconEntry[];
  recipeCount: number;
  recipes?: RecipeSummary[];
  recipeSearchText?: string[];
  recipeTierIndexes?: number[];
  recipeIconScores?: number[];
  shards: RecipeIndexShard[];
  indexes?: QueryIndexes;
  resourceIndexes?: ResourceQueryIndexes;
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>;
  recipeMapIconCandidates?: RecipeMapIconCandidate[];
  recipeMapIconCache?: Map<string, DatasetResourceIndexEntry | undefined>;
  recipeMapIconEntriesByMap?: Map<string, RecipeMapIconEntry>;
  recipesByRawRecipeId?: Map<string, Recipe[]>;
  hydratedRecipeSummaries?: Map<number, RecipeSummary>;
}

export interface DatasetRecipeRef {
  id: string;
  name: string;
  machineType: string;
  recipeMap?: string;
  rawRecipeId?: string;
  outputs: Array<Pick<RecipeOutput, "kind" | "id">>;
}

interface RecipeLookupIndexFile {
  schemaVersion: 1;
  datasetVersionId: string;
  recipeCount: number;
  shards: RecipeIndexShard[];
  recipeMaps: string[];
  recipeIds?: string[];
  tierIndexes: number[];
  iconScores?: number[];
  searchText?: string[];
  entries: Array<[string, Array<[number, number[]]>]>;
}

interface RecipeIndexFile {
  schemaVersion: 1;
  datasetVersionId: string;
  recipeCount: number;
  shards: RecipeIndexShard[];
  recipeMaps?: string[];
  recipes?: RecipeSummary[];
  tierIndexes?: number[];
  iconScores?: number[];
  searchText?: string[];
}

interface LoadedRecipeLookupIndex {
  version: DatasetVersion;
  recipeCount: number;
  shards: RecipeIndexShard[];
  recipeMaps: string[];
  recipeMapIds: Map<string, number>;
  recipeMapIdsByRecipeIndex: Int32Array;
  recipeIds: string[];
  recipeIndexesById?: Map<string, number>;
  tierIndexes: number[];
  iconScores: number[];
  searchText: string[];
  searchIndex?: TextSearchIndex;
  entries: Map<string, Map<number, number[]>>;
}

interface RecipeResourceScope {
  resource: Pick<ResourceAmount, "kind" | "id">;
  resources: Array<Pick<ResourceAmount, "kind" | "id">>;
}

interface QueryIndexes {
  recipeIndexesByResource: Map<string, number[]>;
  recipeIndexesByResourceAndMap: Map<string, number[]>;
  recipeMaps: string[];
  recipeMapsByResource: Map<string, string[]>;
  recipeMapIcons: Map<string, DatasetResourceIndexEntry | undefined>;
  tierIndexes: number[];
  searchText: string[];
  searchIndex: TextSearchIndex;
  iconScores: number[];
  allRecipeIndexes: number[];
}

interface ResourceQueryIndexes {
  sortedResourceIndexes: number[];
  searchText: string[];
  searchIndex: TextSearchIndex;
}

interface TextSearchIndex {
  tokensByEntry: string[][];
  trigramToEntries: Map<string, number[]>;
}

interface RecipeShardPayload {
  datasetVersionId: string;
  recipes: Recipe[];
}

const datasetRoot = path.join(process.cwd(), "public", "datasets", "gtnh");
const loadedCatalogs = new Map<string, LoadedRecipeIndex>();
const pendingCatalogLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const pendingRecipeIndexLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const loadedRecipeLookupIndexes = new Map<string, LoadedRecipeLookupIndex>();
const pendingRecipeLookupLoads = new Map<string, Promise<LoadedRecipeLookupIndex>>();
const loadedShards = new Map<string, Recipe[]>();
const pendingShardLoads = new Map<string, Promise<Recipe[]>>();
const pendingPrewarmLoads = new Map<string, Promise<void>>();
let manifestCache: DatasetManifest | undefined;
let manifestCacheStamp: string | undefined;
const gunzipAsync = promisify(gunzip);
const maxLoadedShardCount = positiveIntEnv("GTNH_MAX_LOADED_RECIPE_SHARDS", 8);

export async function getDatasetCatalog(versionId: string) {
  const catalog = await loadCatalog(versionId);
  return {
    schemaVersion: 1 as const,
    datasetVersionId: catalog.version.id,
    gtnhVersion: catalog.version.gtnhVersion,
    sourceInfo: catalog.version.sourceInfo,
    resources: [],
    resourceIndex: getMachineConfigResources(catalog),
    recipes: [],
    recipeCount: catalog.recipeCount,
    oreDictionary: {},
    recipeMaps: catalog.recipeMaps,
    recipeMapIcons: catalog.recipeMapIcons,
    generatedAt: catalog.version.publishedAt,
  };
}

function getMachineConfigResources(catalog: LoadedRecipeIndex): DatasetResourceIndexEntry[] {
  return catalog.resources
    .filter((resource) => resource.tooltip?.some(isMachineConfigTooltipLine))
    .map((resource) => ({
      ...resource,
      recipeCount: 0,
    }));
}

function isMachineConfigTooltipLine(line: string) {
  const normalized = line.trim().toLowerCase();
  return (
    normalized === "heating coil tier" ||
    normalized === "pipe casing tier" ||
    normalized === "solenoid tier" ||
    normalized === "log tool" ||
    normalized === "sapling tool" ||
    normalized === "leaves tool" ||
    normalized === "fruit tool"
  );
}

export async function getDatasetRecipeIds(versionId: string): Promise<string[]> {
  const catalog = await loadCatalog(versionId);
  if (catalog.version.recipeLookupIndexPath) {
    return (await loadRecipeLookupIndex(catalog.version)).recipeIds;
  }

  const recipeCatalog = await loadRecipeIndex(versionId);
  return recipeCatalog.recipes?.map((recipe) => recipe.id) ?? [];
}

export async function resolveDatasetRecipeRefs(
  versionId: string,
  refs: DatasetRecipeRef[],
): Promise<Array<{ importedId: string; recipeId: string }>> {
  if (!refs.some((ref) => ref.rawRecipeId)) {
    return [];
  }

  const catalog = await loadCatalog(versionId);
  const recipesByRawRecipeId = await getRecipesByRawRecipeId(catalog);

  return refs
    .map((ref) => {
      if (!ref.rawRecipeId) {
        return undefined;
      }

      const match = recipesByRawRecipeId
        .get(ref.rawRecipeId)
        ?.find(
          (recipe) =>
            recipe.id !== ref.id &&
            recipe.name === ref.name &&
            recipe.machineType === ref.machineType &&
            (!ref.recipeMap || recipe.source?.recipeMap === ref.recipeMap) &&
            outputsAreCompatible(ref.outputs, recipe.outputs),
        );

      return match ? { importedId: ref.id, recipeId: match.id } : undefined;
    })
    .filter((match): match is { importedId: string; recipeId: string } => Boolean(match));
}

export async function queryDatasetResources(
  versionId: string,
  request: {
    query: string;
    offset: number;
    limit: number;
  },
) {
  const catalog = await loadCatalog(versionId);
  const indexes = ensureResourceIndexes(catalog);
  const queryTokens = splitSearchTokens(request.query);
  const candidateIndexes = queryTextSearchIndex(indexes.searchIndex, queryTokens);
  const matches: number[] = [];

  for (const resourceIndex of candidateIndexes ?? indexes.sortedResourceIndexes) {
    const resource = catalog.resourceIndex[resourceIndex];
    if (
      !resource ||
      isVirtualChoiceResource(resource) ||
      (!resource.iconPath && !resource.iconAtlas)
    ) {
      continue;
    }
    if (
      queryTokens.length &&
      !searchTokensMatch(indexes.searchIndex.tokensByEntry[resourceIndex] ?? [], queryTokens)
    ) {
      continue;
    }
    matches.push(resourceIndex);
  }

  return {
    resources: matches
      .slice(request.offset, request.offset + request.limit)
      .map((index) => catalog.resourceIndex[index])
      .filter(Boolean),
    total: matches.length,
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matches.length,
  };
}

export async function queryDatasetRecipes(
  versionId: string,
  request: {
    query: string;
    resource?: Pick<ResourceAmount, "kind" | "id">;
    mode: "recipes" | "uses";
    recipeMap?: string;
    maxTier: TierFilter;
    offset: number;
    limit: number;
  },
) {
  const catalog = await loadCatalog(versionId);
  if (catalog.version.recipeLookupIndexPath) {
    return queryDatasetRecipesFromLookup(catalog, request);
  }

  const recipeCatalog = await loadRecipeIndex(versionId);
  const indexes = ensureIndexes(recipeCatalog);
  const queryTokens = splitSearchTokens(request.query);
  const resourceScope = request.resource
    ? getRecipeResourceScope(recipeCatalog, request.resource, request.mode)
    : undefined;
  const candidates = request.resource
    ? getResourceIndexes(indexes.recipeIndexesByResource, resourceScope!, request.mode)
    : indexes.allRecipeIndexes;
  const searchCandidates = queryTextSearchIndex(indexes.searchIndex, queryTokens);
  const searchCandidateSet = searchCandidates ? new Set(searchCandidates) : undefined;
  const eligibleRecipeMaps = request.resource
    ? getResourceRecipeMaps(indexes.recipeMapsByResource, resourceScope!, request.mode)
    : [...new Set(indexes.recipeMaps.filter(Boolean))];
  const sortedRecipeMaps = eligibleRecipeMaps
    .filter((recipeMap) =>
      recipeMapHasMatchingIndexedRecipe(
        indexes,
        candidates,
        recipeMap,
        request.maxTier,
        queryTokens,
        searchCandidateSet,
        {
          scope: resourceScope,
          mode: request.mode,
        },
      ),
    )
    .sort((a, b) => a.localeCompare(b));
  const effectiveMap =
    request.recipeMap && sortedRecipeMaps.includes(request.recipeMap)
      ? request.recipeMap
      : request.resource
        ? sortedRecipeMaps[0]
        : undefined;
  const scopedCandidates =
    request.resource && effectiveMap
      ? getResourceIndexes(
          indexes.recipeIndexesByResourceAndMap,
          resourceScope!,
          request.mode,
          effectiveMap,
        )
      : candidates;
  const withIcons: Array<{ recipeIndex: number; iconScore: number }> = [];
  const withoutIcons: number[] = [];
  let total = 0;

  for (const recipeIndex of scopedCandidates) {
    if (!recipeMatchesTierIndex(indexes, recipeIndex, request.maxTier)) {
      continue;
    }
    if (searchCandidateSet && !searchCandidateSet.has(recipeIndex)) {
      continue;
    }
    if (
      queryTokens.length &&
      !searchTokensMatch(indexes.searchIndex.tokensByEntry[recipeIndex] ?? [], queryTokens)
    ) {
      continue;
    }
    if (effectiveMap && indexes.recipeMaps[recipeIndex] !== effectiveMap) {
      continue;
    }
    total += 1;
    const iconScore = indexes.iconScores[recipeIndex] ?? 0;
    if (iconScore > 0) {
      withIcons.push({ recipeIndex, iconScore });
    } else {
      withoutIcons.push(recipeIndex);
    }
  }

  const recipeIndexes = [
    ...withIcons.sort((a, b) => b.iconScore - a.iconScore).map((entry) => entry.recipeIndex),
    ...withoutIcons,
  ].slice(request.offset, request.offset + request.limit);
  const recipes = (await getRecipeSummariesByIndex(recipeCatalog, recipeIndexes)).map((recipe) =>
    applyUsesResourceContext(recipe, recipeCatalog, request.resource),
  );

  return {
    recipes,
    total,
    recipeMaps: sortedRecipeMaps,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, indexes.recipeMapIcons.get(recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < total,
  };
}

async function queryDatasetRecipesFromLookup(
  catalog: LoadedRecipeIndex,
  request: {
    query: string;
    resource?: Pick<ResourceAmount, "kind" | "id">;
    mode: "recipes" | "uses";
    recipeMap?: string;
    maxTier: TierFilter;
    offset: number;
    limit: number;
  },
) {
  const lookup = await loadRecipeLookupIndex(catalog.version);
  const queryTokens = splitSearchTokens(request.query);
  const tierCandidatesByMap = new Map<number, number[]>();

  if (!request.resource && queryTokens.length === 0) {
    return emptyRecipeQueryResult(request);
  }

  const resourceScope = request.resource
    ? getRecipeResourceScope(catalog, request.resource, request.mode)
    : undefined;
  const recipesByMap = resourceScope
    ? getLookupRecipesByMap(lookup, resourceScope, request.mode)
    : getLookupRecipesByMapForSearch(lookup, queryTokens);

  for (const [recipeMapId, recipeIndexes] of recipesByMap.entries()) {
    const candidates = recipeIndexes.filter((recipeIndex) =>
      recipeMatchesLookupTier(lookup, recipeIndex, request.maxTier),
    );
    if (candidates.length > 0) {
      tierCandidatesByMap.set(recipeMapId, candidates);
    }
  }

  const searchMatchedRecipeIndexes = queryTokens.length
    ? await getSearchMatchedRecipeIndexes(
        catalog,
        lookup,
        [...new Set([...tierCandidatesByMap.values()].flat())],
        queryTokens,
      )
    : undefined;

  const sortedRecipeMaps = [...tierCandidatesByMap.entries()]
    .filter(([, recipeIndexes]) =>
      recipeIndexes.some(
        (recipeIndex) => !searchMatchedRecipeIndexes || searchMatchedRecipeIndexes.has(recipeIndex),
      ),
    )
    .map(([recipeMapId]) => lookup.recipeMaps[recipeMapId])
    .filter((recipeMap): recipeMap is string => Boolean(recipeMap))
    .sort((a, b) => a.localeCompare(b));
  const effectiveMap =
    request.recipeMap && sortedRecipeMaps.includes(request.recipeMap)
      ? request.recipeMap
      : sortedRecipeMaps[0];
  const effectiveMapId = effectiveMap ? lookup.recipeMapIds.get(effectiveMap) : undefined;
  const scopedCandidates =
    effectiveMapId !== undefined
      ? (tierCandidatesByMap.get(effectiveMapId) ?? [])
      : [...new Set([...tierCandidatesByMap.values()].flat())];
  const matchingRecipeIndexes: number[] = [];

  for (const recipeIndex of scopedCandidates) {
    if (searchMatchedRecipeIndexes && !searchMatchedRecipeIndexes.has(recipeIndex)) {
      continue;
    }
    matchingRecipeIndexes.push(recipeIndex);
  }

  const pageRecipeIndexes = matchingRecipeIndexes.slice(
    request.offset,
    request.offset + request.limit,
  );
  const recipes = (await getRecipeSummariesByIndex(catalog, pageRecipeIndexes)).map((recipe) =>
    applyUsesResourceContext(recipe, catalog, request.resource),
  );

  return {
    recipes,
    total: matchingRecipeIndexes.length,
    recipeMaps: sortedRecipeMaps,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, getRecipeMapIcon(catalog, recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matchingRecipeIndexes.length,
  };
}

function emptyRecipeQueryResult(request: { offset: number; limit: number }) {
  return {
    recipes: [],
    total: 0,
    recipeMaps: [],
    recipeMapIcons: {},
    offset: request.offset,
    limit: request.limit,
    hasMore: false,
  };
}

export async function prewarmDatasetVersion(
  versionId: string,
  options: { includeShards?: boolean } = {},
): Promise<void> {
  const cacheKey = `${versionId}:${options.includeShards ? "full" : "indexes"}`;
  const pending = pendingPrewarmLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = prewarmDatasetVersionOnce(versionId, options).finally(() => {
    pendingPrewarmLoads.delete(cacheKey);
  });
  pendingPrewarmLoads.set(cacheKey, promise);
  return promise;
}

export async function prewarmLatestDatasetVersions(): Promise<void> {
  const manifest = await loadManifest();
  const versionIds =
    process.env.GTNH_PREWARM_ALL_DATASETS === "1"
      ? [
          manifest.latestStableVersion,
          manifest.latestDailyVersion,
          manifest.versions[0]?.id,
        ].filter((versionId, index, versionIds): versionId is string => {
          return Boolean(versionId) && versionIds.indexOf(versionId) === index;
        })
      : [
          manifest.latestStableVersion ?? manifest.latestDailyVersion ?? manifest.versions[0]?.id,
        ].filter((versionId): versionId is string => Boolean(versionId));

  const includeShards = process.env.GTNH_PREWARM_FULL_DATASETS === "1";
  for (const versionId of versionIds) {
    await prewarmDatasetVersion(versionId, { includeShards });
  }
}

async function prewarmDatasetVersionOnce(
  versionId: string,
  { includeShards = false }: { includeShards?: boolean },
): Promise<void> {
  const catalog = await loadCatalog(versionId);
  getCatalogResourcesByKey(catalog);
  ensureResourceIndexes(catalog);

  if (catalog.version.recipeLookupIndexPath) {
    const lookup = await loadRecipeLookupIndex(catalog.version);
    ensureLookupSearchIndex(lookup);
  } else {
    const recipeCatalog = await loadRecipeIndex(versionId);
    ensureIndexes(recipeCatalog);
  }

  if (includeShards) {
    const recipeCatalog = catalog.version.recipeLookupIndexPath
      ? catalog
      : await loadRecipeIndex(versionId);
    await prewarmRecipeShards(recipeCatalog);
  }
}

export async function getDatasetRecipe(
  versionId: string,
  recipeId: string,
): Promise<Recipe | undefined> {
  const catalog = await loadCatalog(versionId);
  const recipeIndex = catalog.version.recipeLookupIndexPath
    ? await getRecipeIndexFromLookup(catalog.version, recipeId)
    : ((await loadRecipeIndex(versionId)).recipes?.findIndex((recipe) => recipe.id === recipeId) ??
      -1);
  if (recipeIndex === -1) {
    return undefined;
  }
  const shard = catalog.shards.find(
    (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
  );
  if (!shard) {
    return undefined;
  }
  const recipes = await loadShard(catalog.version, shard);
  const recipe = recipes.find((entry) => entry.id === recipeId);
  if (!recipe) {
    return undefined;
  }
  const resourcesByKey = getCatalogResourcesByKey(catalog);
  const enrichedRecipe = enrichPassiveProductionRecipe(recipe);
  return {
    ...enrichedRecipe,
    machineConfigControls: hydrateMachineConfigControls(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    machineHandlers: hydrateMachineHandlers(enrichedRecipe.machineHandlers, resourcesByKey),
    inputs: enrichedRecipe.inputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    outputs: enrichedRecipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
  };
}

async function loadManifest(): Promise<DatasetManifest> {
  const manifestPath = path.join(datasetRoot, "datasets.manifest.json");
  const stat = await fs.stat(manifestPath);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  if (manifestCache && manifestCacheStamp === stamp) {
    return manifestCache;
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as DatasetManifest;
  manifestCache = manifest;
  manifestCacheStamp = stamp;
  return manifest;
}

async function loadCatalog(versionId: string): Promise<LoadedRecipeIndex> {
  const manifest = await loadManifest();
  const version = manifest.versions.find((entry) => entry.id === versionId);
  if (!version?.resourceIndexPath) {
    throw new Error(`Dataset ${versionId} has no server resource index.`);
  }

  const resourceIndexPath = version.resourceIndexPath;
  const cacheKey = datasetVersionCacheKey(version);
  const cached = loadedCatalogs.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = pendingCatalogLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const catalog = await readGzipJson<LoadedRecipeIndex>(publicPathToFile(resourceIndexPath));
    const loaded = {
      ...catalog,
      version,
    };
    loadedCatalogs.set(cacheKey, loaded);
    return loaded;
  })().finally(() => {
    pendingCatalogLoads.delete(cacheKey);
  });

  pendingCatalogLoads.set(cacheKey, promise);
  return promise;
}

async function loadRecipeIndex(versionId: string): Promise<LoadedRecipeIndex> {
  const catalog = await loadCatalog(versionId);
  if (catalog.recipes) {
    return catalog;
  }

  const cacheKey = datasetVersionCacheKey(catalog.version);
  const pending = pendingRecipeIndexLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    if (!catalog.version.recipeIndexPath) {
      throw new Error(`Dataset ${versionId} has no recipe index.`);
    }
    const recipeIndex = await readGzipJson<RecipeIndexFile>(
      publicPathToFile(catalog.version.recipeIndexPath),
    );
    catalog.recipes = recipeIndex.recipes ?? [];
    catalog.recipeSearchText = recipeIndex.searchText;
    catalog.recipeTierIndexes = recipeIndex.tierIndexes;
    catalog.recipeIconScores = recipeIndex.iconScores;
    catalog.shards = recipeIndex.shards;
    catalog.recipeCount = recipeIndex.recipeCount;
    return catalog;
  })().finally(() => {
    pendingRecipeIndexLoads.delete(cacheKey);
  });

  pendingRecipeIndexLoads.set(cacheKey, promise);
  return promise;
}

function datasetVersionCacheKey(version: DatasetVersion): string {
  return [
    version.id,
    version.checksumSha256,
    version.publishedAt,
    version.resourceIndexPath,
    version.recipeIndexPath,
    version.recipeLookupIndexPath,
  ]
    .filter(Boolean)
    .join(":");
}

async function loadRecipeLookupIndex(version: DatasetVersion): Promise<LoadedRecipeLookupIndex> {
  const cacheKey = datasetVersionCacheKey(version);
  const cached = loadedRecipeLookupIndexes.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = pendingRecipeLookupLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    if (!version.recipeLookupIndexPath) {
      throw new Error(`Dataset ${version.id} has no recipe lookup index.`);
    }
    const payload = await readGzipJson<RecipeLookupIndexFile>(
      publicPathToFile(version.recipeLookupIndexPath),
    );
    const loaded: LoadedRecipeLookupIndex = {
      version,
      recipeCount: payload.recipeCount,
      shards: payload.shards,
      recipeMaps: payload.recipeMaps,
      recipeMapIds: new Map(payload.recipeMaps.map((recipeMap, index) => [recipeMap, index])),
      recipeMapIdsByRecipeIndex: buildLookupRecipeMapIdsByRecipeIndex(
        payload.recipeCount,
        payload.entries,
      ),
      recipeIds: payload.recipeIds ?? [],
      tierIndexes: payload.tierIndexes,
      iconScores: payload.iconScores ?? [],
      searchText: payload.searchText ?? [],
      entries: new Map(payload.entries.map(([key, recipesByMap]) => [key, new Map(recipesByMap)])),
    };
    loadedRecipeLookupIndexes.set(cacheKey, loaded);
    return loaded;
  })().finally(() => {
    pendingRecipeLookupLoads.delete(cacheKey);
  });

  pendingRecipeLookupLoads.set(cacheKey, promise);
  return promise;
}

async function getRecipeIndexFromLookup(
  version: DatasetVersion,
  recipeId: string,
): Promise<number> {
  const lookup = await loadRecipeLookupIndex(version);
  if (!lookup.recipeIndexesById) {
    lookup.recipeIndexesById = new Map(
      lookup.recipeIds.map((entry, index) => [entry, index] as const),
    );
  }
  return lookup.recipeIndexesById.get(recipeId) ?? -1;
}

function buildLookupRecipeMapIdsByRecipeIndex(
  recipeCount: number,
  entries: RecipeLookupIndexFile["entries"],
): Int32Array {
  const recipeMapIdsByRecipeIndex = new Int32Array(recipeCount);
  recipeMapIdsByRecipeIndex.fill(-1);

  for (const [, recipesByMap] of entries) {
    for (const [recipeMapId, recipeIndexes] of recipesByMap) {
      for (const recipeIndex of recipeIndexes) {
        if (
          recipeIndex >= 0 &&
          recipeIndex < recipeCount &&
          recipeMapIdsByRecipeIndex[recipeIndex] === -1
        ) {
          recipeMapIdsByRecipeIndex[recipeIndex] = recipeMapId;
        }
      }
    }
  }

  return recipeMapIdsByRecipeIndex;
}

async function loadShard(version: DatasetVersion, shard: RecipeIndexShard): Promise<Recipe[]> {
  const key = `${datasetVersionCacheKey(version)}:${shard.id}`;
  const cached = getCachedShard(key);
  if (cached) {
    return cached;
  }

  const pending = pendingShardLoads.get(key);
  if (pending) {
    return pending;
  }

  const promise = readGzipJson<RecipeShardPayload>(publicPathToFile(shard.path))
    .then((payload) => {
      const recipes = payload.recipes.map(enrichPassiveProductionRecipe);
      setCachedShard(key, recipes);
      return recipes;
    })
    .finally(() => {
      pendingShardLoads.delete(key);
    });

  pendingShardLoads.set(key, promise);
  return promise;
}

async function getRecipesByRawRecipeId(catalog: LoadedRecipeIndex): Promise<Map<string, Recipe[]>> {
  if (catalog.recipesByRawRecipeId) {
    return catalog.recipesByRawRecipeId;
  }

  const recipesByRawRecipeId = new Map<string, Recipe[]>();
  const shardRecipes = await Promise.all(
    catalog.shards.map((shard) => loadShard(catalog.version, shard)),
  );
  for (const recipe of shardRecipes.flat()) {
    const rawRecipeId = recipe.source?.rawRecipeId;
    if (!rawRecipeId) {
      continue;
    }

    const existing = recipesByRawRecipeId.get(rawRecipeId);
    if (existing) {
      existing.push(recipe);
    } else {
      recipesByRawRecipeId.set(rawRecipeId, [recipe]);
    }
  }

  catalog.recipesByRawRecipeId = recipesByRawRecipeId;
  return recipesByRawRecipeId;
}

async function prewarmRecipeShards(catalog: LoadedRecipeIndex): Promise<void> {
  const batchSize = Number.parseInt(process.env.GTNH_PREWARM_SHARD_CONCURRENCY ?? "4", 10);
  const concurrency = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 4;

  for (let index = 0; index < catalog.shards.length; index += concurrency) {
    await Promise.all(
      catalog.shards
        .slice(index, index + concurrency)
        .map((shard) => loadShard(catalog.version, shard)),
    );
  }
}

function outputsAreCompatible(
  importedOutputs: Array<Pick<RecipeOutput, "kind" | "id">>,
  candidateOutputs: RecipeOutput[],
): boolean {
  if (importedOutputs.length === 0) {
    return true;
  }

  const candidateResources = new Set(
    candidateOutputs.map((output) => `${output.kind}:${output.id}`),
  );
  return importedOutputs.every((output) => candidateResources.has(`${output.kind}:${output.id}`));
}

async function readGzipJson<T>(filePath: string): Promise<T> {
  const data = await fs.readFile(filePath);
  const unzipped = await gunzipAsync(data);
  return JSON.parse(unzipped.toString("utf8")) as T;
}

function getCachedShard(key: string): Recipe[] | undefined {
  const cached = loadedShards.get(key);
  if (!cached) {
    return undefined;
  }

  loadedShards.delete(key);
  loadedShards.set(key, cached);
  return cached;
}

function setCachedShard(key: string, recipes: Recipe[]) {
  loadedShards.set(key, recipes);
  while (loadedShards.size > maxLoadedShardCount) {
    const oldestKey = loadedShards.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    loadedShards.delete(oldestKey);
  }
}

function positiveIntEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function publicPathToFile(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

function hydrateRecipeSummary(recipe: RecipeSummary, catalog: LoadedRecipeIndex): RecipeSummary {
  const resourcesByKey = getCatalogResourcesByKey(catalog);
  const enrichedRecipe = enrichPassiveProductionRecipe(recipe as Recipe);
  return {
    ...recipe,
    machineType: enrichedRecipe.machineType,
    minimumTier: enrichedRecipe.minimumTier,
    eut: enrichedRecipe.eut,
    machineConfigControls: hydrateMachineConfigControls(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    machineHandlers: hydrateMachineHandlers(enrichedRecipe.machineHandlers, resourcesByKey),
    inputs: enrichedRecipe.inputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    outputs: enrichedRecipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
  };
}

function hydrateResource<T extends ResourceAmount>(
  resource: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  if (!indexed) {
    return resource;
  }
  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: resource.iconPath ?? indexed.iconPath,
    iconAtlas: resource.iconAtlas ?? indexed.iconAtlas,
    dominantColor:
      resource.dominantColor ??
      indexed.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      indexed.iconAtlas?.dominantColor,
    alternatives:
      resource.alternatives ?? ("alternatives" in indexed ? indexed.alternatives : undefined),
  };
}

async function getRecipeSummariesByIndex(
  catalog: LoadedRecipeIndex,
  recipeIndexes: number[],
): Promise<RecipeSummary[]> {
  const summariesByIndex = await getRecipeSummariesByIndexMap(catalog, recipeIndexes);
  return recipeIndexes
    .map((recipeIndex) => summariesByIndex.get(recipeIndex))
    .filter((summary): summary is RecipeSummary => Boolean(summary));
}

async function getSearchMatchedRecipeIndexes(
  catalog: LoadedRecipeIndex,
  lookup: LoadedRecipeLookupIndex | undefined,
  recipeIndexes: number[],
  queryTokens: string[],
): Promise<Set<number>> {
  if (lookup?.searchText.length) {
    const searchIndex = ensureLookupSearchIndex(lookup);
    const indexedCandidates = queryTextSearchIndex(searchIndex, queryTokens);
    const indexedCandidateSet = indexedCandidates ? new Set(indexedCandidates) : undefined;
    return new Set(
      recipeIndexes.filter(
        (recipeIndex) =>
          (!indexedCandidateSet || indexedCandidateSet.has(recipeIndex)) &&
          searchTokensMatch(searchIndex.tokensByEntry[recipeIndex] ?? [], queryTokens),
      ),
    );
  }

  const recipeCatalog = catalog.recipes ? catalog : await loadRecipeIndex(catalog.version.id);
  const indexes = ensureIndexes(recipeCatalog);
  const indexedCandidates = queryTextSearchIndex(indexes.searchIndex, queryTokens);
  const indexedCandidateSet = indexedCandidates ? new Set(indexedCandidates) : undefined;
  return new Set(
    recipeIndexes.filter(
      (recipeIndex) =>
        (!indexedCandidateSet || indexedCandidateSet.has(recipeIndex)) &&
        searchTokensMatch(indexes.searchIndex.tokensByEntry[recipeIndex] ?? [], queryTokens),
    ),
  );
}

function ensureLookupSearchIndex(lookup: LoadedRecipeLookupIndex): TextSearchIndex {
  lookup.searchIndex ??= buildTextSearchIndex(
    lookup.searchText,
    lookup.searchText.map((_, index) => index),
  );
  return lookup.searchIndex;
}

async function getRecipeSummariesByIndexMap(
  catalog: LoadedRecipeIndex,
  recipeIndexes: number[],
): Promise<Map<number, RecipeSummary>> {
  if (recipeIndexes.length === 0) {
    return new Map();
  }

  const summariesByIndex = new Map<number, RecipeSummary>();
  const missingRecipeIndexes: number[] = [];

  for (const recipeIndex of recipeIndexes) {
    const summary = getHydratedRecipeSummary(catalog, recipeIndex);
    if (summary) {
      summariesByIndex.set(recipeIndex, summary);
    } else {
      missingRecipeIndexes.push(recipeIndex);
    }
  }

  if (missingRecipeIndexes.length === 0) {
    return summariesByIndex;
  }

  const shardRequests = new Map<RecipeIndexShard, number[]>();

  for (const recipeIndex of missingRecipeIndexes) {
    const shard = catalog.shards.find(
      (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
    );
    if (!shard) {
      continue;
    }
    const existing = shardRequests.get(shard);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      shardRequests.set(shard, [recipeIndex]);
    }
  }

  await Promise.all(
    [...shardRequests.entries()].map(async ([shard, indexes]) => {
      const recipes = await loadShard(catalog.version, shard);
      for (const recipeIndex of indexes) {
        const recipe = recipes[recipeIndex - shard.start];
        if (recipe) {
          const summary = toRecipeSummary(recipe, getCatalogResourcesByKey(catalog));
          catalog.hydratedRecipeSummaries ??= new Map();
          catalog.hydratedRecipeSummaries.set(recipeIndex, summary);
          summariesByIndex.set(recipeIndex, summary);
        }
      }
    }),
  );

  return summariesByIndex;
}

function getHydratedRecipeSummary(
  catalog: LoadedRecipeIndex,
  recipeIndex: number,
): RecipeSummary | undefined {
  const cached = catalog.hydratedRecipeSummaries?.get(recipeIndex);
  if (cached) {
    return cached;
  }

  const compactSummary = catalog.recipes?.[recipeIndex];
  if (!compactSummary?.inputs || !compactSummary.outputs) {
    return undefined;
  }

  const summary = hydrateRecipeSummary(compactSummary, catalog);
  catalog.hydratedRecipeSummaries ??= new Map();
  catalog.hydratedRecipeSummaries.set(recipeIndex, summary);
  return summary;
}

function toRecipeSummary(
  recipe: Recipe,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): RecipeSummary {
  const enrichedRecipe = enrichPassiveProductionRecipe(recipe);
  return {
    id: enrichedRecipe.id,
    name: enrichedRecipe.name,
    recipeMap: enrichedRecipe.source?.recipeMap ?? enrichedRecipe.machineType,
    machineType: enrichedRecipe.machineType,
    minimumTier: enrichedRecipe.minimumTier,
    durationTicks: enrichedRecipe.durationTicks,
    eut: enrichedRecipe.eut,
    programmedCircuit: enrichedRecipe.programmedCircuit,
    machineHandlers: hydrateMachineHandlers(enrichedRecipe.machineHandlers, resourcesByKey),
    machineConfigControls: hydrateMachineConfigControls(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    inputs: enrichedRecipe.inputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    outputs: enrichedRecipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    source: enrichedRecipe.source?.recipeMap
      ? { recipeMap: enrichedRecipe.source.recipeMap }
      : undefined,
    nei: enrichedRecipe.nei,
    slots: [],
  };
}

function hydrateMachineHandlers<T extends Recipe["machineHandlers"]>(
  handlers: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  return handlers?.map((handler) => ({
    ...handler,
    machineConfigControls: hydrateMachineConfigControls(
      handler.machineConfigControls,
      resourcesByKey,
    ),
  })) as T;
}

function hydrateMachineConfigControls<T extends Recipe["machineConfigControls"]>(
  controls: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  return controls?.map((control) => ({
    ...control,
    tiers: control.tiers.map((tier) => ({
      ...tier,
      resource: tier.resource ? hydrateResource(tier.resource, resourcesByKey) : tier.resource,
    })),
  })) as T;
}

function getCatalogResourcesByKey(
  catalog: LoadedRecipeIndex,
): Map<string, DatasetResource | DatasetResourceIndexEntry> {
  if (catalog.resourcesByKey) {
    return catalog.resourcesByKey;
  }

  catalog.resourcesByKey = new Map();
  for (const resource of [...catalog.resources, ...catalog.resourceIndex]) {
    const key = `${resource.kind}:${resource.id}`;
    const existing = catalog.resourcesByKey.get(key);
    catalog.resourcesByKey.set(key, existing ? mergeCatalogResource(existing, resource) : resource);
  }
  return catalog.resourcesByKey;
}

function mergeCatalogResource(
  existing: DatasetResource | DatasetResourceIndexEntry,
  incoming: DatasetResource | DatasetResourceIndexEntry,
): DatasetResource | DatasetResourceIndexEntry {
  return {
    ...existing,
    ...incoming,
    displayName: incoming.displayName ?? existing.displayName ?? incoming.id ?? existing.id,
    iconPath: incoming.iconPath ?? existing.iconPath,
    iconAtlas: incoming.iconAtlas ?? existing.iconAtlas,
    dominantColor:
      incoming.dominantColor ??
      incoming.iconAtlas?.dominantColor ??
      existing.dominantColor ??
      existing.iconAtlas?.dominantColor,
    tooltip: incoming.tooltip ?? existing.tooltip,
    oreDictionary: incoming.oreDictionary ?? existing.oreDictionary,
    alternatives: mergeResourceAlternatives(existing.alternatives, incoming.alternatives),
  };
}

function mergeResourceAlternatives(
  left: DatasetResourceIndexEntry["alternatives"],
  right: DatasetResourceIndexEntry["alternatives"],
): DatasetResourceIndexEntry["alternatives"] {
  const merged = [...(left ?? [])];
  for (const alternative of right ?? []) {
    if (!merged.some((entry) => entry.kind === alternative.kind && entry.id === alternative.id)) {
      merged.push(alternative);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function getRecipeResourceScope(
  catalog: LoadedRecipeIndex,
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
): RecipeResourceScope {
  const resources = [resource];
  const resourcesByKey = getCatalogResourcesByKey(catalog);
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  for (const equivalent of getFilledCellEquivalentResources(
    catalog,
    indexed ? { ...indexed, kind: indexed.kind, id: indexed.id } : resource,
  )) {
    addScopedResource(resources, equivalent);
  }

  if (mode !== "uses" || resource.kind !== "item" || isOreDictionaryResource(resource)) {
    return { resource, resources };
  }

  const wildcardResource = getWildcardResource(resource);
  if (wildcardResource) {
    addScopedResource(resources, wildcardResource);
  }

  const oreDictionaryNames = new Set(indexed?.oreDictionary ?? []);
  for (const candidate of resourcesByKey.values()) {
    if (
      candidate.kind === "item" &&
      isOreDictionaryResource(candidate) &&
      candidate.alternatives?.some((alternative) =>
        resourceIdsAreCompatible(alternative.id, resource.id),
      )
    ) {
      oreDictionaryNames.add(candidate.id.slice("oredict:".length));
    }
  }
  for (const name of oreDictionaryNames ?? []) {
    addScopedResource(resources, { kind: "item", id: `oredict:${name}` });
  }

  return { resource, resources };
}

function getFilledCellEquivalentResources(
  catalog: LoadedRecipeIndex,
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
): Array<Pick<ResourceAmount, "kind" | "id">> {
  const resourcesByKey = getCatalogResourcesByKey(catalog);
  const equivalents: Array<Pick<ResourceAmount, "kind" | "id">> = [];
  const addEquivalent = (equivalent: Pick<ResourceAmount, "kind" | "id">) => {
    addScopedResource(equivalents, equivalent);
  };
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  for (const alternative of indexed?.alternatives ?? []) {
    addEquivalent({ kind: alternative.kind, id: alternative.id });
  }

  if (resource.kind === "item") {
    const fluid = getFilledCellFluidEquivalent(resource);
    if (fluid) {
      const indexedFluid = resourcesByKey.get(`fluid:${fluid.id}`);
      addEquivalent({ kind: "fluid", id: indexedFluid?.id ?? fluid.id });
    }

    return equivalents;
  }

  for (const candidate of resourcesByKey.values()) {
    if (
      candidate.kind === "item" &&
      !isOreDictionaryResource(candidate) &&
      resourceMatchesInput(resource, candidate)
    ) {
      addEquivalent({ kind: "item", id: candidate.id });
    }
  }

  return equivalents;
}

function addScopedResource(
  resources: Array<Pick<ResourceAmount, "kind" | "id">>,
  resource: Pick<ResourceAmount, "kind" | "id">,
): void {
  if (!resources.some((entry) => entry.kind === resource.kind && entry.id === resource.id)) {
    resources.push(resource);
  }
}

function getResourceIndexes(
  index: Map<string, number[]>,
  scope: RecipeResourceScope,
  mode: "recipes" | "uses",
  recipeMap?: string,
): number[] {
  const indexes = scope.resources.flatMap(
    (resource) =>
      index.get(
        recipeMap
          ? getResourceModeMapKey(resource, mode, recipeMap)
          : getResourceModeKey(resource, mode),
      ) ?? [],
  );
  return [...new Set(indexes)];
}

function getResourceRecipeMaps(
  index: Map<string, string[]>,
  scope: RecipeResourceScope,
  mode: "recipes" | "uses",
): string[] {
  return [
    ...new Set(
      scope.resources.flatMap((resource) => index.get(getResourceModeKey(resource, mode)) ?? []),
    ),
  ];
}

function getLookupRecipesByMap(
  lookup: LoadedRecipeLookupIndex,
  scope: RecipeResourceScope,
  mode: "recipes" | "uses",
): Map<number, number[]> {
  const recipesByMap = new Map<number, number[]>();
  for (const resource of scope.resources) {
    const resourceRecipesByMap = lookup.entries.get(getResourceModeKey(resource, mode));
    if (!resourceRecipesByMap) {
      continue;
    }
    for (const [recipeMapId, recipeIndexes] of resourceRecipesByMap.entries()) {
      const existing = recipesByMap.get(recipeMapId) ?? [];
      recipesByMap.set(recipeMapId, [...new Set([...existing, ...recipeIndexes])]);
    }
  }
  return recipesByMap;
}

function getLookupRecipesByMapForSearch(
  lookup: LoadedRecipeLookupIndex,
  queryTokens: string[],
): Map<number, number[]> {
  const searchIndex = ensureLookupSearchIndex(lookup);
  const indexedCandidates = queryTextSearchIndex(searchIndex, queryTokens);
  const recipesByMap = new Map<number, number[]>();
  const addRecipe = (recipeIndex: number) => {
    if (
      queryTokens.length &&
      !searchTokensMatch(searchIndex.tokensByEntry[recipeIndex] ?? [], queryTokens)
    ) {
      return;
    }
    const recipeMapId = lookup.recipeMapIdsByRecipeIndex[recipeIndex] ?? -1;
    if (recipeMapId < 0) {
      return;
    }
    const recipeIndexes = recipesByMap.get(recipeMapId);
    if (recipeIndexes) {
      recipeIndexes.push(recipeIndex);
    } else {
      recipesByMap.set(recipeMapId, [recipeIndex]);
    }
  };

  if (indexedCandidates) {
    for (const recipeIndex of indexedCandidates) {
      addRecipe(recipeIndex);
    }
  } else {
    for (let recipeIndex = 0; recipeIndex < lookup.recipeCount; recipeIndex += 1) {
      addRecipe(recipeIndex);
    }
  }

  for (const recipeIndexes of recipesByMap.values()) {
    recipeIndexes.sort(
      (left, right) =>
        (lookup.iconScores[right] ?? 0) - (lookup.iconScores[left] ?? 0) || left - right,
    );
  }

  return recipesByMap;
}

function applyUsesResourceContext<T extends RecipeSummary>(
  recipe: T,
  catalog: LoadedRecipeIndex,
  resource: Pick<ResourceAmount, "kind" | "id"> | undefined,
): T {
  if (!resource || resource.kind !== "item" || isOreDictionaryResource(resource)) {
    return recipe;
  }

  const selected = getCatalogResourcesByKey(catalog).get(`${resource.kind}:${resource.id}`);
  if (!selected) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input) => {
    if (!isContextCompatibleItemInput(input, selected)) {
      return input;
    }

    changed = true;
    return {
      ...input,
      id: selected.id,
      displayName: selected.displayName ?? input.displayName,
      iconPath: selected.iconPath ?? input.iconPath,
      iconAtlas: selected.iconAtlas ?? input.iconAtlas,
      dominantColor: selected.dominantColor ?? input.dominantColor,
      tooltip: "tooltip" in selected ? selected.tooltip : undefined,
      alternatives: undefined,
      oreDictionary: undefined,
    };
  });

  return changed ? { ...recipe, inputs } : recipe;
}

function isContextCompatibleItemInput(
  input: ResourceAmount,
  selected: DatasetResource | DatasetResourceIndexEntry,
): boolean {
  if (input.kind !== selected.kind || input.kind !== "item") {
    return false;
  }

  if (!isOreDictionaryResource(input)) {
    return resourceIdsAreCompatible(input.id, selected.id);
  }

  const oreDictionaryName = input.id.slice("oredict:".length);
  return Boolean(
    input.alternatives?.some((alternative) =>
      resourceIdsAreCompatible(alternative.id, selected.id),
    ) || selected.oreDictionary?.includes(oreDictionaryName),
  );
}

function getWildcardResource(
  resource: Pick<ResourceAmount, "kind" | "id">,
): Pick<ResourceAmount, "kind" | "id"> | undefined {
  if (resource.kind !== "item" || resource.id.endsWith("@32767")) {
    return undefined;
  }

  const separatorIndex = resource.id.lastIndexOf("@");
  if (separatorIndex === -1) {
    return undefined;
  }

  return { kind: "item", id: `${resource.id.slice(0, separatorIndex)}@32767` };
}

function resourceIdsAreCompatible(candidateId: string, selectedId: string): boolean {
  if (candidateId === selectedId) {
    return true;
  }

  if (!candidateId.endsWith("@32767")) {
    return false;
  }

  const wildcardBaseId = candidateId.slice(0, -"@32767".length);
  return selectedId === wildcardBaseId || selectedId.startsWith(`${wildcardBaseId}@`);
}

function ensureIndexes(catalog: LoadedRecipeIndex): QueryIndexes {
  if (catalog.indexes) {
    return catalog.indexes;
  }
  const recipeIndexesByResource = new Map<string, number[]>();
  const recipeIndexesByResourceAndMap = new Map<string, number[]>();
  const recipeMapSetsByResource = new Map<string, Set<string>>();
  const recipeMapSet = new Set<string>();
  const recipeMaps: string[] = [];
  const tierIndexes: number[] = [];
  const searchText: string[] = [];
  const iconScores: number[] = [];
  const allRecipeIndexes: number[] = [];
  const resourcesByKey = getCatalogResourcesByKey(catalog);

  catalog.recipes?.forEach((recipe, recipeIndex) => {
    const recipeMap = recipe.recipeMap;
    if (!recipeMap) {
      return;
    }

    allRecipeIndexes.push(recipeIndex);
    recipeMaps[recipeIndex] = recipeMap;
    recipeMapSet.add(recipeMap);
    tierIndexes[recipeIndex] =
      catalog.recipeTierIndexes?.[recipeIndex] ?? getTierIndex(getRecipeTier(recipe));
    searchText[recipeIndex] =
      catalog.recipeSearchText?.[recipeIndex] ?? buildRecipeSearchText(recipe, resourcesByKey);
    iconScores[recipeIndex] =
      catalog.recipeIconScores?.[recipeIndex] ?? recipeIconScore(recipe, resourcesByKey);
    for (const output of recipe.outputs ?? []) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(output, "recipes"), recipeIndex);
      addRecipeIndex(
        recipeIndexesByResourceAndMap,
        getResourceModeMapKey(output, "recipes", recipeMap),
        recipeIndex,
      );
      addRecipeMap(recipeMapSetsByResource, getResourceModeKey(output, "recipes"), recipeMap);
    }
    for (const input of recipe.inputs ?? []) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(input, "uses"), recipeIndex);
      addRecipeIndex(
        recipeIndexesByResourceAndMap,
        getResourceModeMapKey(input, "uses", recipeMap),
        recipeIndex,
      );
      addRecipeMap(recipeMapSetsByResource, getResourceModeKey(input, "uses"), recipeMap);
      for (const alternative of input.alternatives ?? []) {
        addRecipeIndex(
          recipeIndexesByResource,
          getResourceModeKey(alternative, "uses"),
          recipeIndex,
        );
        addRecipeIndex(
          recipeIndexesByResourceAndMap,
          getResourceModeMapKey(alternative, "uses", recipeMap),
          recipeIndex,
        );
        addRecipeMap(recipeMapSetsByResource, getResourceModeKey(alternative, "uses"), recipeMap);
      }
    }
  });

  const recipeMapsByResource = new Map(
    [...recipeMapSetsByResource.entries()].map(([key, maps]) => [key, [...maps]]),
  );

  catalog.indexes = {
    recipeIndexesByResource,
    recipeIndexesByResourceAndMap,
    recipeMaps,
    recipeMapsByResource,
    recipeMapIcons: buildRecipeMapIconMap([...recipeMapSet], catalog),
    tierIndexes,
    searchText,
    searchIndex: buildTextSearchIndex(searchText, allRecipeIndexes),
    iconScores,
    allRecipeIndexes,
  };
  return catalog.indexes;
}

function ensureResourceIndexes(catalog: LoadedRecipeIndex): ResourceQueryIndexes {
  if (catalog.resourceIndexes) {
    return catalog.resourceIndexes;
  }

  const searchText: string[] = [];
  const sortedResourceIndexes = catalog.resourceIndex
    .map((resource, index) => {
      searchText[index] = normalizeResourceSearchText(resource);
      return index;
    })
    .filter((index) => {
      const resource = catalog.resourceIndex[index];
      return Boolean(resource && !isVirtualChoiceResource(resource));
    })
    .sort((leftIndex, rightIndex) => {
      const left = catalog.resourceIndex[leftIndex];
      const right = catalog.resourceIndex[rightIndex];
      return (
        (right?.recipeCount ?? 0) - (left?.recipeCount ?? 0) ||
        (left?.displayName ?? left?.id ?? "").localeCompare(right?.displayName ?? right?.id ?? "")
      );
    });

  catalog.resourceIndexes = {
    sortedResourceIndexes,
    searchText,
    searchIndex: buildTextSearchIndex(searchText, sortedResourceIndexes),
  };
  return catalog.resourceIndexes;
}

function addRecipeIndex(index: Map<string, number[]>, key: string, recipeIndex: number) {
  const existing = index.get(key);
  if (existing) {
    existing.push(recipeIndex);
  } else {
    index.set(key, [recipeIndex]);
  }
}

function addRecipeMap(index: Map<string, Set<string>>, key: string, recipeMap: string) {
  const existing = index.get(key);
  if (existing) {
    existing.add(recipeMap);
  } else {
    index.set(key, new Set([recipeMap]));
  }
}

function recipeMapHasMatchingIndexedRecipe(
  indexes: QueryIndexes,
  candidates: number[],
  recipeMap: string,
  maxTier: TierFilter,
  queryTokens: string[],
  searchCandidateSet: Set<number> | undefined,
  scope: { scope?: RecipeResourceScope; mode: "recipes" | "uses" },
) {
  const scopedCandidates = scope.scope
    ? getResourceIndexes(indexes.recipeIndexesByResourceAndMap, scope.scope, scope.mode, recipeMap)
    : candidates;

  return scopedCandidates.some((recipeIndex) => {
    if (indexes.recipeMaps[recipeIndex] !== recipeMap) {
      return false;
    }

    if (!recipeMatchesTierIndex(indexes, recipeIndex, maxTier)) {
      return false;
    }

    return Boolean(
      (!searchCandidateSet || searchCandidateSet.has(recipeIndex)) &&
      (!queryTokens.length ||
        searchTokensMatch(indexes.searchIndex.tokensByEntry[recipeIndex] ?? [], queryTokens)),
    );
  });
}

function getResourceModeKey(
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
) {
  return `${mode}:${resource.kind}:${resource.id}`;
}

function getResourceModeMapKey(
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
  recipeMap: string,
) {
  return `${getResourceModeKey(resource, mode)}:${recipeMap}`;
}

function buildRecipeSearchText(
  recipe: RecipeSummary,
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): string {
  return normalizeText(
    [
      recipe.name,
      recipe.machineType,
      recipe.recipeMap,
      ...(recipe.inputs ?? []).flatMap((input) => resourceSearchTerms(input, resourcesByKey)),
      ...(recipe.outputs ?? []).flatMap((output) => resourceSearchTerms(output, resourcesByKey)),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function resourceSearchTerms(
  resource: SearchableResource,
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): string[] {
  const indexed = resourcesByKey?.get(`${resource.kind}:${resource.id}`);
  return [
    resource.displayName,
    indexed?.displayName,
    resource.id,
    resource.kind,
    ...(resource.tooltip ?? []),
    ...(indexed?.tooltip ?? []),
  ].filter((term): term is string => Boolean(term));
}

function normalizeResourceSearchText(resource: DatasetResourceIndexEntry): string {
  return normalizeText(
    [resource.displayName, resource.id, resource.kind, ...(resource.tooltip ?? [])]
      .filter(Boolean)
      .join(" "),
  );
}

export function buildTextSearchIndex(
  searchText: string[],
  entryIndexes: number[],
): TextSearchIndex {
  const tokensByEntry: string[][] = [];
  const trigramToEntries = new Map<string, number[]>();

  for (const entryIndex of entryIndexes) {
    const tokens = [...new Set(splitSearchTokens(searchText[entryIndex] ?? ""))];
    tokensByEntry[entryIndex] = tokens;

    const entryTrigrams = new Set<string>();
    for (const token of tokens) {
      for (const trigram of getTokenTrigrams(token)) {
        entryTrigrams.add(trigram);
      }
    }

    for (const trigram of entryTrigrams) {
      const existing = trigramToEntries.get(trigram);
      if (existing) {
        existing.push(entryIndex);
      } else {
        trigramToEntries.set(trigram, [entryIndex]);
      }
    }
  }

  return {
    tokensByEntry,
    trigramToEntries,
  };
}

export function queryTextSearchIndex(
  index: TextSearchIndex,
  queryTokens: string[],
): number[] | undefined {
  if (queryTokens.length === 0) {
    return undefined;
  }

  const indexedTokens = queryTokens.filter((token) => token.length >= 3);
  if (indexedTokens.length === 0) {
    return undefined;
  }

  let candidates: number[] | undefined;
  for (const token of indexedTokens) {
    const tokenCandidates = queryTokenCandidates(index, token);
    if (tokenCandidates.length === 0) {
      return [];
    }

    candidates = candidates
      ? intersectOrderedIndexes(candidates, tokenCandidates)
      : tokenCandidates;

    if (candidates.length === 0) {
      return [];
    }
  }

  return candidates;
}

function queryTokenCandidates(index: TextSearchIndex, token: string): number[] {
  const trigrams = getTokenTrigrams(token);
  let candidates: number[] | undefined;

  for (const trigram of trigrams) {
    const entries = index.trigramToEntries.get(trigram);
    if (!entries?.length) {
      return [];
    }

    candidates = candidates ? intersectOrderedIndexes(candidates, entries) : entries;
    if (candidates.length === 0) {
      return [];
    }
  }

  return candidates ?? [];
}

function intersectOrderedIndexes(left: number[], right: number[]): number[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

export function searchTokensMatch(entryTokens: string[], queryTokens: string[]): boolean {
  return queryTokens.every((queryToken) =>
    entryTokens.some((entryToken) => entryToken.includes(queryToken)),
  );
}

function getTokenTrigrams(token: string): string[] {
  if (token.length < 3) {
    return [];
  }

  const trigrams = new Set<string>();
  for (let index = 0; index <= token.length - 3; index += 1) {
    trigrams.add(token.slice(index, index + 3));
  }
  return [...trigrams];
}

function splitSearchTokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function buildRecipeMapIconMap(
  recipeMaps: string[],
  catalog: LoadedRecipeIndex,
): Map<string, DatasetResourceIndexEntry | undefined> {
  const candidates = getRecipeMapIconCandidates(catalog.resourceIndex);
  return new Map(
    recipeMaps.map((recipeMap) => [
      recipeMap,
      getKnownRecipeMapIcon(catalog, recipeMap) ??
        getExplicitRecipeMapIcon(catalog, recipeMap) ??
        findRecipeMapIcon(recipeMap, candidates),
    ]),
  );
}

function getRecipeMapIcon(
  catalog: LoadedRecipeIndex,
  recipeMap: string,
): DatasetResourceIndexEntry | undefined {
  catalog.recipeMapIconCache ??= new Map();
  if (catalog.recipeMapIconCache.has(recipeMap)) {
    return catalog.recipeMapIconCache.get(recipeMap);
  }

  catalog.recipeMapIconCandidates ??= getRecipeMapIconCandidates(catalog.resourceIndex);
  const icon =
    getKnownRecipeMapIcon(catalog, recipeMap) ??
    getExplicitRecipeMapIcon(catalog, recipeMap) ??
    findRecipeMapIcon(recipeMap, catalog.recipeMapIconCandidates);
  catalog.recipeMapIconCache.set(recipeMap, icon);
  return icon;
}

function getKnownRecipeMapIcon(
  catalog: LoadedRecipeIndex,
  recipeMap: string,
): DatasetResourceIndexEntry | undefined {
  const normalizedMap = normalizeText(recipeMap);
  const known = KNOWN_RECIPE_MAP_ICONS.find((entry) =>
    entry.recipeMaps.some((candidate) => normalizeText(candidate) === normalizedMap),
  );
  const icon = known
    ? hydrateRecipeMapIconResource(known.resource, getCatalogResourcesByKey(catalog))
    : undefined;
  return icon?.iconPath || icon?.iconAtlas ? icon : undefined;
}

type KnownRecipeMapIcon = RecipeMapIconEntry & { recipeMaps: string[] };

const KNOWN_RECIPE_MAP_ICONS: KnownRecipeMapIcon[] = [
  {
    recipeMap: "Thaumcraft Infusion",
    recipeMaps: ["Thaumcraft Infusion", "Arcane Infusion"],
    resource: {
      kind: "item",
      id: "Thaumcraft:blockStoneDevice@2",
      displayName: "Infusion Matrix",
    },
  },
  {
    recipeMap: "Thaumcraft Crucible",
    recipeMaps: ["Thaumcraft Crucible", "Crucible"],
    resource: {
      kind: "item",
      id: "Thaumcraft:blockMetalDevice@0",
      displayName: "Crucible",
    },
  },
  {
    recipeMap: "Thaumcraft Arcane Crafting",
    recipeMaps: [
      "Thaumcraft Arcane Crafting",
      "Shaped Arcane Crafting",
      "Shapeless Arcane Crafting",
    ],
    resource: {
      kind: "item",
      id: "Thaumcraft:blockTable@0",
      displayName: "Arcane Worktable",
    },
  },
];

function getExplicitRecipeMapIcon(
  catalog: LoadedRecipeIndex,
  recipeMap: string,
): DatasetResourceIndexEntry | undefined {
  const entry = getRecipeMapIconEntriesByMap(catalog).get(normalizeText(recipeMap));
  return entry
    ? hydrateRecipeMapIconResource(entry.resource, getCatalogResourcesByKey(catalog))
    : undefined;
}

function getRecipeMapIconEntriesByMap(catalog: LoadedRecipeIndex): Map<string, RecipeMapIconEntry> {
  if (catalog.recipeMapIconEntriesByMap) {
    return catalog.recipeMapIconEntriesByMap;
  }
  catalog.recipeMapIconEntriesByMap = new Map(
    (catalog.recipeMapIcons ?? []).map((entry) => [normalizeText(entry.recipeMap), entry]),
  );
  return catalog.recipeMapIconEntriesByMap;
}

function hydrateRecipeMapIconResource(
  resource: RecipeMapIconEntry["resource"],
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): DatasetResourceIndexEntry | undefined {
  if (!resource?.kind || !resource.id) {
    return undefined;
  }
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  return {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName ?? indexed?.displayName,
    iconPath: resource.iconPath ?? indexed?.iconPath,
    iconAtlas: resource.iconAtlas ?? indexed?.iconAtlas,
    dominantColor:
      resource.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      indexed?.dominantColor ??
      indexed?.iconAtlas?.dominantColor,
    tooltip: resource.tooltip ?? indexed?.tooltip,
    recipeCount: indexed && "recipeCount" in indexed ? indexed.recipeCount : 0,
    oreDictionary: indexed?.oreDictionary,
    alternatives: indexed?.alternatives,
  };
}

function findResourceByKindAndId(
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  kind: ResourceAmount["kind"],
  id: string,
): DatasetResource | DatasetResourceIndexEntry | undefined {
  const exact = resourcesByKey.get(`${kind}:${id}`);
  if (exact) {
    return exact;
  }
  const normalizedKey = normalizeText(`${kind}:${id}`);
  for (const [key, resource] of resourcesByKey) {
    if (normalizeText(key) === normalizedKey) {
      return resource;
    }
  }
  return undefined;
}

interface RecipeMapIconCandidate {
  resource: DatasetResourceIndexEntry;
  label: string;
  tokens: Set<string>;
  exactMachineBonus: boolean;
  prefixBonus: boolean;
  penalty: boolean;
}

function getRecipeMapIconCandidates(
  resources: DatasetResourceIndexEntry[],
): RecipeMapIconCandidate[] {
  return resources
    .filter(
      (resource) =>
        resource.kind === "item" &&
        !isVirtualChoiceResource(resource) &&
        (resource.iconPath || resource.iconAtlas),
    )
    .map((resource) => {
      const label = normalizeText(resource.displayName ?? resource.id);
      return {
        resource,
        label,
        tokens: new Set(label.split(" ").filter(Boolean)),
        exactMachineBonus: resource.id.startsWith("gregtech:gt.blockmachines@"),
        prefixBonus: /^(basic|steam|simple|large) /.test(label),
        penalty: /\b(pipe|cover|upgrade|part|component)\b/.test(label),
      };
    });
}

function findRecipeMapIcon(
  recipeMap: string,
  candidates: RecipeMapIconCandidate[],
): DatasetResourceIndexEntry | undefined {
  const explicitIcon = findExplicitRecipeMapIcon(recipeMap, candidates);
  if (explicitIcon) {
    return explicitIcon;
  }

  const recipeMapTokens = tokenizeRecipeMap(recipeMap);
  const normalizedMap = normalizeText(recipeMap);
  let best: { resource: DatasetResourceIndexEntry; score: number } | undefined;

  for (const candidate of candidates) {
    let score = 0;

    if (candidate.label === normalizedMap) {
      score += 120;
    } else if (candidate.label.includes(normalizedMap)) {
      score += 80;
    }

    for (const token of recipeMapTokens) {
      if (candidate.tokens.has(token) || candidate.label.includes(token)) {
        score += 14;
      }
    }

    if (candidate.exactMachineBonus) {
      score += 35;
    }
    if (candidate.prefixBonus) {
      score += 12;
    }
    if (candidate.penalty) {
      score -= 30;
    }

    if (score > (best?.score ?? 0)) {
      best = { resource: candidate.resource, score };
    }
  }

  return best && best.score >= 35 ? best.resource : undefined;
}

function findExplicitRecipeMapIcon(
  recipeMap: string,
  candidates: RecipeMapIconCandidate[],
): DatasetResourceIndexEntry | undefined {
  const normalizedMap = normalizeText(recipeMap);

  if (isCraftingRecipeMap(normalizedMap)) {
    return bestExplicitIcon(candidates, [
      (candidate) => candidate.label === "crafting table",
      (candidate) => /\bcrafting[_:\s-]*table\b/i.test(candidate.resource.id),
      (candidate) => candidate.label.includes("workbench"),
      (candidate) => /\bworkbench\b/i.test(candidate.resource.id),
    ]);
  }

  if (normalizedMap === "furnace") {
    return bestExplicitIcon(candidates, [
      (candidate) => candidate.label === "furnace",
      (candidate) => /\bfurnace\b/i.test(candidate.resource.id),
    ]);
  }

  return undefined;
}

function isCraftingRecipeMap(normalizedMap: string): boolean {
  return (
    normalizedMap === "shaped crafting" ||
    normalizedMap === "shapeless crafting" ||
    normalizedMap === "crafting table" ||
    normalizedMap.startsWith("crafting table ")
  );
}

function bestExplicitIcon(
  candidates: RecipeMapIconCandidate[],
  predicates: Array<(candidate: RecipeMapIconCandidate) => boolean>,
) {
  for (const predicate of predicates) {
    const match = candidates.find(
      (candidate) => predicate(candidate) && !candidate.penalty && !candidate.exactMachineBonus,
    );
    if (match) {
      return match.resource;
    }
  }

  return undefined;
}

function tokenizeRecipeMap(value: string): string[] {
  const aliases: Record<string, string[]> = {
    crafting: ["crafting", "table", "workbench"],
    washer: ["washing", "wash"],
    wash: ["washing", "washer"],
    extractor: ["extractor", "extract"],
  };

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .flatMap((token) => [token, ...(aliases[token] ?? [])]);
}

function recipeMatchesTierIndex(indexes: QueryIndexes, recipeIndex: number, maxTier: TierFilter) {
  if (maxTier === "all") {
    return true;
  }
  return (indexes.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) <= getTierIndex(maxTier);
}

function recipeMatchesLookupTier(
  lookup: LoadedRecipeLookupIndex,
  recipeIndex: number,
  maxTier: TierFilter,
) {
  if (maxTier === "all") {
    return true;
  }
  return (lookup.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) <= getTierIndex(maxTier);
}

function getRecipeTier(recipe: RecipeSummary): Exclude<MachineTier, "DEMO"> {
  return GT_VOLTAGE_TIERS.some((entry) => entry.tier === recipe.minimumTier)
    ? (recipe.minimumTier as Exclude<MachineTier, "DEMO">)
    : getRecipePowerTier(recipe as Recipe);
}

function getTierIndex(tier: Exclude<MachineTier, "DEMO">) {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

function recipeIconScore(
  recipe: RecipeSummary,
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): number {
  return [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])].reduce(
    (score, resource) => score + (resourceHasIcon(resource, resourcesByKey) ? 1 : 0),
    0,
  );
}

function resourceHasIcon(
  resource: SearchableResource,
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>,
) {
  const indexed = resourcesByKey?.get(`${resource.kind}:${resource.id}`);
  return Boolean(
    resource.iconPath || resource.iconAtlas || indexed?.iconPath || indexed?.iconAtlas,
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
