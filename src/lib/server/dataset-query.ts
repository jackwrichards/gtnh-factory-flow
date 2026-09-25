import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type {
  DatasetManifest,
  DatasetResource,
  DatasetResourceIndexEntry,
  DatasetVersion,
  MachineHandlerIconEntry,
  RecipeMapIconEntry,
  RecipeSummary,
} from "@/lib/datasets/types";
import type {
  MachineTier,
  Recipe,
  ResourceAlternative,
  ResourceAmount,
} from "@/lib/model/types";
import {
  AUTO_WORKBENCH_HANDLER_ID,
  CROP_HARVESTER_INDUSTRIAL_FARM_ID,
  CROP_HARVESTER_MANAGER_ID,
  CROP_MANAGER_ITEM_NAMES,
  enrichPassiveProductionRecipe,
  getFilledCellFluidEquivalent,
  isFluidEquivalentToFilledCell,
  getRecipePowerTier,
  GT_VOLTAGE_TIERS,
  isOreDictionaryResource,
  isRecipeInputConsumed,
  isVirtualChoiceResource,
  resourceMatchesInput,
} from "@/lib/model";
import { machineTableControlResourceIds } from "@/lib/machines/machine-table";
import { EEC_MACHINE_TYPE } from "@/lib/machines/extreme-entity-crusher";
import { pickRecipeRefMatch, type RecipeContentRef } from "@/lib/import-export/recipe-ref-match";
import {
  MAX_RECIPE_QUERY_CLAUSES,
  recipeQueryClauseMode,
  type RecipeQueryClause,
  type RecipeQueryRole,
  type RecipeQuerySideOp,
} from "@/lib/datasets/recipe-query";
import {
  buildSearchVocabulary,
  buildTextSearchIndex,
  buildTokenSearchIndex,
  matchSearchEntry,
  matchSearchTokens,
  parseSearchQuery,
  queryTextSearchIndex,
  resolveSearchPhases,
  splitSearchTokens,
  type SearchEntryFields,
  type SearchPhase,
  type SearchQuery,
  type SearchVocabulary,
  type TextSearchIndex,
} from "@/lib/search";

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
  /** Cached made-by/used-by recipe counts per `kind:id`, from the lookup index. */
  resourceDirectionCounts?: Map<string, { madeBy: number; usedBy: number }>;
  recipeMaps: string[];
  recipeMapIcons?: RecipeMapIconEntry[];
  machineHandlerIcons?: MachineHandlerIconEntry[];
  recipeCount: number;
  recipes?: RecipeSummary[];
  recipeSearchText?: string[];
  recipeTierIndexes?: number[];
  recipeIconScores?: number[];
  shards: RecipeIndexShard[];
  indexes?: QueryIndexes;
  resourceIndexes?: ResourceQueryIndexes;
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>;
  choiceAlternativesByKey?: Map<string, ResourceAlternative[]>;
  recipeMapIconCandidates?: RecipeMapIconCandidate[];
  recipeMapIconCache?: Map<string, DatasetResourceIndexEntry | undefined>;
  recipeMapIconEntriesByMap?: Map<string, RecipeMapIconEntry>;
  /** rawRecipeId -> recipe indexes; ids and numbers only, never recipe bodies. */
  recipeIndexesByRawRecipeId?: Map<string, number[]>;
  /** Bounded LRU of hydrated summaries; see setCachedHydratedSummary. */
  hydratedRecipeSummaries?: Map<number, RecipeSummary>;
  /** Resources a crop or a bee can produce; see getPassiveSourceResourceKeys. */
  passiveSourceKeys?: Partial<Record<ResourceSourceFilter, Set<string>>>;
}

export type DatasetRecipeRef = RecipeContentRef;

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
  /**
   * Each resource split by where its words came from, so a word in the item's
   * name counts for more than the same word buried in a registry id.
   */
  fields: SearchEntryFields[];
  searchIndex: TextSearchIndex;
  /** The words items are actually called: what a typo gets corrected against. */
  vocabulary: SearchVocabulary;
}

interface RecipeShardPayload {
  datasetVersionId: string;
  recipes: Recipe[];
}

const CROP_FARM_RECIPE_MAP = "Crop Farm";

/**
 * The recipe maps that are things growing rather than machines running.
 *
 * A crop farm is a real way to get an item, so it belongs in the recipe book
 * next to the machines that make the same thing: looking up Oak Log should show
 * that a crop can grow one. These sets are also what the "grown" and "bees"
 * filters in the item list mean.
 */
const PLANT_RECIPE_MAPS = new Set([CROP_FARM_RECIPE_MAP, "IC2 Crop", "Tree Growth Simulator"]);
const BEE_RECIPE_MAPS = new Set(["Bee Produce"]);

export type ResourceSourceFilter = "plants" | "bees";

const datasetRoot = path.join(process.cwd(), "public", "datasets", "gtnh");
const loadedCatalogs = new Map<string, LoadedRecipeIndex>();
const pendingCatalogLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const pendingRecipeIndexLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const loadedRecipeLookupIndexes = new Map<string, LoadedRecipeLookupIndex>();
const pendingRecipeLookupLoads = new Map<string, Promise<LoadedRecipeLookupIndex>>();
const loadedShards = new Map<string, Recipe[]>();
const pendingShardLoads = new Map<string, Promise<Recipe[]>>();
const pendingRawRecipeIdIndexLoads = new Map<string, Promise<Map<string, number[]>>>();
const pendingPrewarmLoads = new Map<string, Promise<void>>();
let manifestCache: DatasetManifest | undefined;
let manifestCacheStamp: string | undefined;
const gunzipAsync = promisify(gunzip);
const maxLoadedShardCount = positiveIntEnv("GTNH_MAX_LOADED_RECIPE_SHARDS", 8);
const maxHydratedRecipeSummaryCount = positiveIntEnv("GTNH_MAX_HYDRATED_RECIPE_SUMMARIES", 8000);

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
    machineHandlerIcons: withSynthesizedHandlerIcons(catalog),
    generatedAt: catalog.version.publishedAt,
  };
}

/**
 * Handlers synthesized client-side (the Auto Workbench for the crafting maps
 * in recipe-rules.ts, the two crop harvesters in passive-production.ts) never
 * had an exported handler family mint their icon. Each machine is a real
 * dataset item; hand its lowest-tier face to the synthesized family here so
 * their cards draw a machine chip like everything else. Names are candidates
 * in order because datasets disagree (2.8.4 says "Crop Manager (LV)" and has
 * no Industrial Farm); a family with no match simply keeps its letter chip.
 */
const SYNTHESIZED_HANDLER_FACES: Array<{
  familyId: string;
  displayNames: string[];
  /** Tier -> the tier's own item name, for families whose card wears its tier's block. */
  tierNames?: Record<string, string>;
}> = [
  { familyId: AUTO_WORKBENCH_HANDLER_ID, displayNames: ["Auto Workbench (LV)"] },
  {
    familyId: CROP_HARVESTER_MANAGER_ID,
    displayNames: ["Basic Crop Manager", "Crop Manager (LV)"],
    tierNames: CROP_MANAGER_ITEM_NAMES,
  },
  { familyId: CROP_HARVESTER_INDUSTRIAL_FARM_ID, displayNames: ["Industrial Farm"] },
];

/**
 * The Tank map (the planner's free canner, synthesized by the pipeline) used
 * to wear the plain empty cell as its face, and a card names itself after its
 * map's machine, so every Tank card read "Empty Cell". Published datasets
 * still carry that face; swap in the Low Voltage Fluid Tank, called simply
 * "Fluid Tank" (Jack, 2026-09-07), at load so the card, its picture and the
 * search chip all agree without a dataset rebuild.
 */
const TANK_RECIPE_MAP = "Tank";
const TANK_MAP_FACE_ITEM_NAMES = ["Low Voltage Fluid Tank"];
const TANK_MAP_FACE_DISPLAY_NAME = "Fluid Tank";

export function withTankMapFace(
  catalog: Pick<LoadedRecipeIndex, "resources" | "recipeMapIcons">,
): RecipeMapIconEntry[] | undefined {
  const icons = catalog.recipeMapIcons;
  if (!icons?.some((entry) => entry.recipeMap === TANK_RECIPE_MAP)) {
    return icons;
  }
  const byName = new Map(catalog.resources.map((resource) => [resource.displayName, resource] as const));
  const face = TANK_MAP_FACE_ITEM_NAMES.map((name) => byName.get(name)).find(Boolean);
  if (!face) {
    return icons;
  }
  return icons.map((entry) =>
    entry.recipeMap === TANK_RECIPE_MAP
      ? {
          recipeMap: TANK_RECIPE_MAP,
          resource: {
            kind: face.kind,
            id: face.id,
            displayName: TANK_MAP_FACE_DISPLAY_NAME,
            iconPath: face.iconPath,
            iconAtlas: face.iconAtlas,
            dominantColor: face.dominantColor,
            modId: face.modId,
            amount: 1,
          },
        }
      : entry,
  );
}

function withSynthesizedHandlerIcons(catalog: LoadedRecipeIndex): MachineHandlerIconEntry[] {
  const icons = [...(catalog.machineHandlerIcons ?? [])];
  const byName = new Map(catalog.resources.map((resource) => [resource.displayName, resource] as const));
  for (const { familyId, displayNames, tierNames } of SYNTHESIZED_HANDLER_FACES) {
    if (icons.some((entry) => entry.familyId === familyId)) {
      continue;
    }
    const face = displayNames.map((name) => byName.get(name)).find(Boolean);
    if (!face) {
      continue;
    }
    const tiers = Object.entries(tierNames ?? {}).flatMap(([tier, name]) => {
      const resource = byName.get(name);
      return resource ? [{ tier, resource: { ...resource, amount: 1 } }] : [];
    });
    icons.push({
      familyId,
      resource: { ...face, amount: 1 },
      ...(tiers.length > 1 ? { tiers } : {}),
    });
  }
  return icons;
}

function getMachineConfigResources(catalog: LoadedRecipeIndex): DatasetResourceIndexEntry[] {
  // The curated machine table names its control blocks by dataset id (field
  // restriction coils); ship those faces too, or the client can only draw
  // its labelled-slot fallback for them.
  const tableIds = machineTableControlResourceIds();
  return catalog.resources
    .filter(
      (resource) =>
        resource.tooltip?.some(isMachineConfigTooltipLine) ||
        tableIds.has(resource.id) ||
        isCropHarvesterComponent(resource.displayName),
    )
    .map((resource) => ({
      ...resource,
      recipeCount: 0,
    }));
}

// The crop card's harvester knobs name their faces by dataset display name
// (seed beds, farm upgrade units, the tiered Crop Managers); ship those
// faces too, or the crop settings panel can only draw its labelled-slot
// fallback for them.
const CROP_HARVESTER_COMPONENT_PATTERN =
  /^(Seed Bed|Growth Acceleration Unit|Fertilization Unit|Advanced Harvesting Unit|Environmental Enhancement Unit|Overclocked Growth Acceleration Unit) \(|Crop Manager/;

// Faces for the crop card's own knobs (growth, gain, water, fertilizer, sky,
// biome) - `cropsNhAnalyticControls` names these; extend both together.
const CROP_KNOB_FACE_NAMES = new Set([
  "Crop Sticks",
  "Plant Lens",
  "Water Bucket",
  "Fertilizer",
  "Daylight Detector",
  "Grass Block",
]);

function isCropHarvesterComponent(displayName: string | undefined) {
  return (
    displayName !== undefined &&
    (CROP_HARVESTER_COMPONENT_PATTERN.test(displayName) || CROP_KNOB_FACE_NAMES.has(displayName))
  );
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

/**
 * Finds the dataset's recipe behind each imported one whose id it no longer
 * lists.
 *
 * Recipe ids are minted per dataset build (and until 2026-09 from a JVM
 * identity hash, so every rebuild changed all of them), so a plan exported
 * one week and imported the next finds none of its ids. What survives a
 * rebuild is the recipe's content, so each ref carries its slots, ticks and
 * EU, and the candidates - every recipe in the ref's map that makes its
 * first output, read off the lookup index - are scored on that
 * (`pickRecipeRefMatch`). Only a candidate with the same resources in and
 * out is offered; a weaker likeness is not, and the importer keeps the
 * plan's own embedded body instead. A rawRecipeId hit is still consulted
 * for refs the content scan could not settle, since it can bridge dataset
 * versions when the raw ids are stable.
 */
export async function resolveDatasetRecipeRefs(
  versionId: string,
  refs: DatasetRecipeRef[],
): Promise<Array<{ importedId: string; recipeId: string; exact: boolean }>> {
  if (refs.length === 0) {
    return [];
  }

  const catalog = await loadCatalog(versionId);
  const lookup = await loadRecipeLookupIndex(catalog.version);
  const candidateIndexesByRef = new Map<DatasetRecipeRef, number[]>();
  for (const ref of refs) {
    candidateIndexesByRef.set(ref, lookupCandidateIndexes(lookup, ref));
  }

  const candidatesByIndex = await loadRecipeBodies(
    catalog,
    [...candidateIndexesByRef.values()].flat(),
  );
  const matches = new Map<string, { recipeId: string; exact: boolean }>();
  const unsettled: DatasetRecipeRef[] = [];
  for (const ref of refs) {
    const match = pickRecipeRefMatch(
      ref,
      (candidateIndexesByRef.get(ref) ?? [])
        .map((recipeIndex) => candidatesByIndex.get(recipeIndex))
        .filter((recipe): recipe is Recipe => recipe !== undefined),
    );
    if (match && match.score >= RECIPE_REF_MIGRATION_SCORE) {
      matches.set(ref.id, { recipeId: match.candidate.id, exact: match.exact });
    } else if (ref.rawRecipeId) {
      unsettled.push(ref);
    }
  }

  if (unsettled.length > 0) {
    const indexesByRawRecipeId = await getRecipeIndexesByRawRecipeId(catalog);
    const rawIndexes = unsettled.flatMap(
      (ref) => indexesByRawRecipeId.get(ref.rawRecipeId ?? "") ?? [],
    );
    const rawCandidatesByIndex = await loadRecipeBodies(catalog, rawIndexes);
    for (const ref of unsettled) {
      const match = pickRecipeRefMatch(
        ref,
        (indexesByRawRecipeId.get(ref.rawRecipeId ?? "") ?? [])
          .map((recipeIndex) => rawCandidatesByIndex.get(recipeIndex))
          .filter((recipe): recipe is Recipe => recipe !== undefined),
      );
      if (match && match.score >= RECIPE_REF_MIGRATION_SCORE) {
        matches.set(ref.id, { recipeId: match.candidate.id, exact: match.exact });
      }
    }
  }

  return refs.flatMap((ref) => {
    const match = matches.get(ref.id);
    return match ? [{ importedId: ref.id, ...match }] : [];
  });
}

/** Below this the likeness is too loose to swap a plan's recipe for. */
const RECIPE_REF_MIGRATION_SCORE = 300;

/** How many bodies one ref may pull off the shards. */
const RECIPE_REF_CANDIDATE_LIMIT = 600;

/**
 * Every recipe that makes the ref's first output, in the ref's own map when
 * the dataset still has a map by that name and otherwise in any map.
 */
function lookupCandidateIndexes(lookup: LoadedRecipeLookupIndex, ref: DatasetRecipeRef): number[] {
  const mapId = ref.recipeMap ? lookup.recipeMapIds.get(ref.recipeMap) : undefined;
  const indexes: number[] = [];
  for (const output of ref.outputs) {
    const recipesByMap = lookup.entries.get(getResourceModeKey(output, "recipes"));
    if (!recipesByMap) {
      continue;
    }
    if (mapId !== undefined) {
      indexes.push(...(recipesByMap.get(mapId) ?? []));
    } else {
      for (const recipeIndexes of recipesByMap.values()) {
        indexes.push(...recipeIndexes);
      }
    }
    if (indexes.length > 0) {
      break;
    }
  }
  return [...new Set(indexes)].sort((left, right) => left - right).slice(0, RECIPE_REF_CANDIDATE_LIMIT);
}

/**
 * Reads the named recipes through the bounded shard cache, one shard at a
 * time, so the bodies never stay resident.
 */
async function loadRecipeBodies(
  catalog: LoadedRecipeIndex,
  recipeIndexes: number[],
): Promise<Map<number, Recipe>> {
  const requestsByShard = new Map<RecipeIndexShard, number[]>();
  for (const recipeIndex of new Set(recipeIndexes)) {
    const shard = catalog.shards.find(
      (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
    );
    if (!shard) {
      continue;
    }
    const existing = requestsByShard.get(shard);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      requestsByShard.set(shard, [recipeIndex]);
    }
  }

  const bodies = new Map<number, Recipe>();
  for (const [shard, indexes] of requestsByShard) {
    const recipes = await loadShard(catalog.version, shard);
    for (const recipeIndex of indexes) {
      const recipe = recipes[recipeIndex - shard.start];
      if (recipe) {
        bodies.set(recipeIndex, recipe);
      }
    }
  }
  return bodies;
}

export type ResourceQuerySort =
  | "relevance"
  | "name"
  | "mod"
  | "recipes"
  | "made"
  | "uses"
  | "popular";

/**
 * How many recipes MAKE and how many USE each resource, read off the same
 * inverted index the recipe search queries - so a Spruce Log's counts include
 * the oredict recipes it satisfies. Computed once per loaded dataset.
 */
async function getResourceDirectionCounts(
  catalog: LoadedRecipeIndex,
): Promise<Map<string, { madeBy: number; usedBy: number }>> {
  if (catalog.resourceDirectionCounts) {
    return catalog.resourceDirectionCounts;
  }

  const counts = new Map<string, { madeBy: number; usedBy: number }>();
  const credit = (key: string, total: number) => {
    const colon = key.indexOf(":");
    const mode = key.slice(0, colon);
    const resourceKey = key.slice(colon + 1);
    const entry = counts.get(resourceKey) ?? { madeBy: 0, usedBy: 0 };
    if (mode === "recipes") {
      entry.madeBy += total;
    } else if (mode === "uses") {
      entry.usedBy += total;
    }
    counts.set(resourceKey, entry);
  };

  if (catalog.version.recipeLookupIndexPath) {
    const lookup = await loadRecipeLookupIndex(catalog.version);
    for (const [key, recipesByMap] of lookup.entries) {
      let total = 0;
      for (const recipeIndexes of recipesByMap.values()) {
        total += recipeIndexes.length;
      }
      credit(key, total);
    }
  } else {
    const recipeCatalog = await loadRecipeIndex(catalog.version.id);
    const indexes = ensureIndexes(recipeCatalog);
    for (const [key, recipeIndexes] of indexes.recipeIndexesByResource) {
      credit(key, recipeIndexes.length);
    }
  }

  catalog.resourceDirectionCounts = counts;
  return counts;
}

/** Mod is encoded in the id prefix ("gregtech:gt.metaitem..."); fluids are bare ids. */
export function getResourceModId(resource: { id: string; kind: string }): string {
  const colon = resource.id.indexOf(":");
  if (colon > 0) {
    return resource.id.slice(0, colon);
  }
  return resource.kind === "fluid" ? "fluids" : "other";
}

export async function queryDatasetResources(
  versionId: string,
  request: {
    query: string;
    offset: number;
    limit: number;
    kind?: "item" | "fluid";
    mod?: string;
    sort?: ResourceQuerySort;
    source?: ResourceSourceFilter;
    /** Community popularity by `${kind}:${id}`, required only by sort "popular". */
    popularity?: Map<string, number>;
  },
) {
  const catalog = await loadCatalog(versionId);
  const indexes = ensureResourceIndexes(catalog);
  const sourceKeys = request.source
    ? await getPassiveSourceResourceKeys(catalog, request.source)
    : undefined;
  let modCounts = new Map<string, number>();

  const resolved = resolveSearchPhases(
    parseSearchQuery(request.query),
    indexes.vocabulary,
    (query, options) => {
      // Counted per pass, because which mods are on offer depends on which
      // reading of the query the results came from.
      const counts = new Map<string, number>();
      const candidateIndexes =
        queryTextSearchIndex(indexes.searchIndex, query, options) ?? indexes.sortedResourceIndexes;
      const matches: Array<{ resourceIndex: number; score: number }> = [];

      for (const resourceIndex of candidateIndexes) {
        const resource = catalog.resourceIndex[resourceIndex];
        if (
          !resource ||
          isVirtualChoiceResource(resource) ||
          (!resource.iconPath && !resource.iconAtlas)
        ) {
          continue;
        }
        if (request.kind && resource.kind !== request.kind) {
          continue;
        }
        if (sourceKeys && !sourceKeys.has(`${resource.kind}:${resource.id}`)) {
          continue;
        }

        const score = matchSearchEntry(query, indexes.fields[resourceIndex] ?? {}, options);
        if (score === undefined) {
          continue;
        }

        // Mod counts reflect the search+kind scope, so the mod dropdown always
        // shows what picking each mod would leave.
        const modId = getResourceModId(resource);
        counts.set(modId, (counts.get(modId) ?? 0) + 1);
        if (request.mod && modId !== request.mod) {
          continue;
        }
        matches.push({
          resourceIndex,
          score: score > 0 ? score + resourceRelevanceBias(resource) : score,
        });
      }

      modCounts = counts;
      return matches;
    },
  );

  const directionCounts = await getResourceDirectionCounts(catalog);
  const matches = sortResourceMatches(
    catalog,
    resolved.results,
    request.sort ?? "relevance",
    directionCounts,
    request.popularity,
  );

  return {
    resources: matches
      .slice(request.offset, request.offset + request.limit)
      .map((match) => catalog.resourceIndex[match.resourceIndex])
      .filter(Boolean),
    total: matches.length,
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matches.length,
    mods: [...modCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    ...searchOutcome(resolved),
  };
}

/**
 * The nudge that settles two equally good name matches.
 *
 * Between "Steel Plate" and "Compressed Aluminium Plate Casing", the item used
 * in more recipes and named more plainly is the one that was meant, so both
 * count for a little - never enough to outrank an actual better match.
 */
function resourceRelevanceBias(resource: DatasetResourceIndexEntry): number {
  const name = resource.displayName ?? resource.id;
  return Math.log10(1 + (resource.recipeCount ?? 0)) / 10 - name.length / 400;
}

/** What the search did, for the "showing results for ..." line. */
function searchOutcome(resolved: { query: SearchQuery; phase: SearchPhase }) {
  return {
    searchPhase: resolved.phase,
    corrections: resolved.phase === "corrected" ? resolved.query.corrections : [],
  };
}

function sortResourceMatches(
  catalog: LoadedRecipeIndex,
  matches: Array<{ resourceIndex: number; score: number }>,
  sort: ResourceQuerySort,
  directionCounts: Map<string, { madeBy: number; usedBy: number }>,
  popularity?: Map<string, number>,
) {
  const nameOf = (match: { resourceIndex: number }) => {
    const resource = catalog.resourceIndex[match.resourceIndex];
    return (resource?.displayName ?? resource?.id ?? "").toLowerCase();
  };
  const modOf = (match: { resourceIndex: number }) =>
    getResourceModId(catalog.resourceIndex[match.resourceIndex]);
  const recipesOf = (match: { resourceIndex: number }) =>
    catalog.resourceIndex[match.resourceIndex]?.recipeCount ?? 0;
  const countsOf = (match: { resourceIndex: number }) => {
    const resource = catalog.resourceIndex[match.resourceIndex];
    return (
      (resource && directionCounts.get(`${resource.kind}:${resource.id}`)) ?? {
        madeBy: 0,
        usedBy: 0,
      }
    );
  };

  if (sort === "name") {
    return [...matches].sort((left, right) => nameOf(left).localeCompare(nameOf(right)));
  }
  if (sort === "mod") {
    return [...matches].sort(
      (left, right) =>
        modOf(left).localeCompare(modOf(right)) || nameOf(left).localeCompare(nameOf(right)),
    );
  }
  if (sort === "recipes") {
    return [...matches].sort(
      (left, right) =>
        recipesOf(right) - recipesOf(left) || nameOf(left).localeCompare(nameOf(right)),
    );
  }
  if (sort === "made") {
    return [...matches].sort(
      (left, right) =>
        countsOf(right).madeBy - countsOf(left).madeBy || nameOf(left).localeCompare(nameOf(right)),
    );
  }
  if (sort === "uses") {
    return [...matches].sort(
      (left, right) =>
        countsOf(right).usedBy - countsOf(left).usedBy || nameOf(left).localeCompare(nameOf(right)),
    );
  }

  if (sort === "popular") {
    // What the community actually builds, aggregated over shared setups. A
    // typed query still wins first: "steel" must find steel, not the most
    // popular thing named vaguely like it. Resources no plan has touched
    // fall back to the best-match order behind everything with a score.
    const popularityOf = (match: { resourceIndex: number }) => {
      const resource = catalog.resourceIndex[match.resourceIndex];
      return (resource && popularity?.get(`${resource.kind}:${resource.id}`)) ?? 0;
    };
    return [...matches].sort(
      (left, right) =>
        right.score - left.score ||
        popularityOf(right) - popularityOf(left) ||
        countsOf(right).madeBy - countsOf(left).madeBy ||
        nameOf(left).localeCompare(nameOf(right)),
    );
  }

  // Best match. Equal scores - and with nothing typed every score is 0 - fall
  // to the thing with the most ways to MAKE it, which is the item a planner
  // most likely came to place.
  return [...matches].sort(
    (left, right) =>
      right.score - left.score || countsOf(right).madeBy - countsOf(left).madeBy,
  );
}

export interface DatasetRecipeQueryRequest {
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  /**
   * Multi-condition search: when present these REPLACE resource+mode, which
   * stay as the single-condition wire form every existing caller speaks.
   */
  clauses?: RecipeQueryClause[];
  takesOp?: RecipeQuerySideOp;
  makesOp?: RecipeQuerySideOp;
  /** List and page across every recipe map instead of scoping to one. */
  allMaps?: boolean;
  /**
   * The machine chips' multi-select: which maps' recipes the RESULTS show.
   * The map list and per-map counts always cover everything that matched, so
   * an unselected chip keeps its count. "exclude" lists the unselected maps
   * (the everyday shape: all on except a few); "include" lists the selected
   * ones, and empty include is a valid "none selected". Absent means all.
   */
  mapSelection?: RecipeMapSelection;
  recipeMap?: string;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}

export interface RecipeMapSelection {
  mode: "exclude" | "include";
  maps: string[];
}

/** Whether the chips' selection shows this map's recipes in the results. */
function isRecipeMapSelected(
  selection: RecipeMapSelection | undefined,
  recipeMap: string | undefined,
): boolean {
  if (!selection || !recipeMap) {
    return true;
  }
  const listed = selection.maps.includes(recipeMap);
  return selection.mode === "exclude" ? !listed : listed;
}

export async function queryDatasetRecipes(versionId: string, request: DatasetRecipeQueryRequest) {
  const catalog = await loadCatalog(versionId);
  if (catalog.version.recipeLookupIndexPath) {
    return queryDatasetRecipesFromLookup(catalog, request);
  }

  const recipeCatalog = await loadRecipeIndex(versionId);
  const indexes = ensureIndexes(recipeCatalog);
  const clauses = normalizedRecipeQueryClauses(request);
  let candidates = clauses.length
    ? combineClauseIndexes(
        clauses.map((clause) => ({
          role: clause.role,
          recipeIndexes: getResourceIndexes(
            indexes.recipeIndexesByResource,
            getRecipeResourceScope(recipeCatalog, clause, recipeQueryClauseMode(clause.role)),
            recipeQueryClauseMode(clause.role),
          ),
        })),
        request,
      )
    : indexes.allRecipeIndexes;
  if (clauses.length > 0 && hasOnlySide(clauses, request)) {
    // This path holds every summary in memory already.
    candidates = candidates.filter((recipeIndex) => {
      const summary = recipeCatalog.recipes?.[recipeIndex];
      return !summary || recipeIsOnlyMatch(summary, clauses, request);
    });
  }
  const resolved = resolveRecipeSearch(
    request.query,
    () => ensureResourceIndexes(recipeCatalog).vocabulary,
    (query, options) => scoreRecipeCandidates(indexes.searchIndex, candidates, query, options),
  );
  const searchScores = resolved.searchScores;
  const matchingAll: RankedRecipe[] = [];

  for (const recipeIndex of candidates) {
    if (!recipeMatchesTierIndex(indexes, recipeIndex, request.maxTier)) {
      continue;
    }
    if (searchScores && !searchScores.has(recipeIndex)) {
      continue;
    }
    matchingAll.push({
      recipeIndex,
      score: searchScores?.get(recipeIndex) ?? 0,
      iconScore: indexes.iconScores[recipeIndex] ?? 0,
    });
  }

  const sortedRecipeMaps = [
    ...new Set(
      matchingAll
        .map((match) => indexes.recipeMaps[match.recipeIndex])
        .filter((recipeMap): recipeMap is string => Boolean(recipeMap)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const effectiveMap = request.allMaps
    ? undefined
    : request.recipeMap && sortedRecipeMaps.includes(request.recipeMap)
      ? request.recipeMap
      : clauses.length
        ? sortedRecipeMaps[0]
        : undefined;
  const matching = effectiveMap
    ? matchingAll.filter((match) => indexes.recipeMaps[match.recipeIndex] === effectiveMap)
    : request.mapSelection
      ? matchingAll.filter((match) =>
          isRecipeMapSelected(request.mapSelection, indexes.recipeMaps[match.recipeIndex]),
        )
      : matchingAll;

  const recipeIndexes = rankRecipes(await applyFocusScores(recipeCatalog, matching, clauses))
    .slice(request.offset, request.offset + request.limit)
    .map((match) => match.recipeIndex);
  const recipes = (await getRecipeSummariesByIndex(recipeCatalog, recipeIndexes)).map((recipe) =>
    applyClauseResourceContexts(recipe, recipeCatalog, clauses),
  );

  const recipeMapCounts: Record<string, number> = {};
  for (const match of matchingAll) {
    const recipeMap = indexes.recipeMaps[match.recipeIndex];
    if (recipeMap) {
      recipeMapCounts[recipeMap] = (recipeMapCounts[recipeMap] ?? 0) + 1;
    }
  }

  return {
    recipes,
    total: matching.length,
    recipeMaps: sortedRecipeMaps,
    recipeMapCounts,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, indexes.recipeMapIcons.get(recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matching.length,
    ...searchOutcome(resolved),
  };
}

interface RankedRecipe {
  recipeIndex: number;
  score: number;
  iconScore: number;
  /**
   * How much of the recipe is ABOUT the asked-for items: the matched share of
   * its outputs (and consumed inputs), averaged over the sides that carry
   * conditions. A recipe making only diamond dust scores 1; a recipe with a
   * hundred outputs where one is diamond dust scores a rounding error, and
   * sorts accordingly.
   */
  focus?: number;
  /**
   * The recipe's whole size - consumed inputs plus outputs - as the tie-break
   * under equal focus: of two recipes that ONLY make water, the one asking
   * for one thing beats the one asking for nine.
   */
  bulk?: number;
}

/**
 * The order cards come out in.
 *
 * Recipes whose icons render stay ahead of ones that would draw as empty slots,
 * which is a rule the book has always had. Inside that, the closest match to
 * what was typed comes first.
 */
function rankRecipes(matches: RankedRecipe[]): RankedRecipe[] {
  return [...matches].sort(
    (left, right) =>
      Number(right.iconScore > 0) - Number(left.iconScore > 0) ||
      right.score - left.score ||
      (right.focus ?? 0) - (left.focus ?? 0) ||
      (left.bulk ?? 0) - (right.bulk ?? 0) ||
      right.iconScore - left.iconScore ||
      left.recipeIndex - right.recipeIndex,
  );
}

/** {@link RankedRecipe.focus}, read against one recipe body. */
function recipeFocusScore(
  summary: RecipeSummary,
  clauses: RecipeQueryClause[],
): number {
  const makesClauses = clauses.filter((clause) => clause.role === "makes");
  const takesClauses = clauses.filter((clause) => clause.role === "takes");
  let total = 0;
  let sides = 0;
  if (makesClauses.length > 0 && summary.outputs.length > 0) {
    const matched = summary.outputs.filter((output) =>
      slotSatisfiedByClauses(output, makesClauses),
    ).length;
    total += matched / summary.outputs.length;
    sides += 1;
  }
  if (takesClauses.length > 0) {
    const consumed = summary.inputs.filter(isRecipeInputConsumed);
    if (consumed.length > 0) {
      const matched = consumed.filter((input) =>
        slotSatisfiedByClauses(input, takesClauses),
      ).length;
      total += matched / consumed.length;
      sides += 1;
    }
  }
  return sides > 0 ? total / sides : 0;
}

/**
 * Focus scores for a whole result set, with the same honest cap the ONLY
 * check uses: past it the bodies stay unread and the order stands.
 */
async function applyFocusScores(
  catalog: LoadedRecipeIndex,
  matching: RankedRecipe[],
  clauses: RecipeQueryClause[],
): Promise<RankedRecipe[]> {
  if (clauses.length === 0 || matching.length === 0 || matching.length > ONLY_VERIFY_LIMIT) {
    return matching;
  }
  const summaries = await getRecipeSummariesByIndexMap(
    catalog,
    matching.map((match) => match.recipeIndex),
  );
  return matching.map((match) => {
    const summary = summaries.get(match.recipeIndex);
    if (!summary) {
      return match;
    }
    return {
      ...match,
      focus: recipeFocusScore(summary, clauses),
      bulk: summary.inputs.filter(isRecipeInputConsumed).length + summary.outputs.length,
    };
  });
}

/**
 * The typed words resolved against the recipe corpus, or nothing to resolve.
 *
 * With an empty box the caller is browsing a resource rather than searching, so
 * no scoring runs at all and `searchScores` stays undefined: every recipe in
 * scope is in.
 */
function resolveRecipeSearch(
  rawQuery: string,
  getVocabulary: () => SearchVocabulary | undefined,
  run: (query: SearchQuery, options: { partial?: boolean }) => RankedRecipe[],
): {
  query: SearchQuery;
  phase: SearchPhase;
  searchScores: Map<number, number> | undefined;
} {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.terms.length === 0) {
    return { query: parsed, phase: "exact", searchScores: undefined };
  }

  const resolved = resolveSearchPhases(parsed, getVocabulary(), run);
  return {
    query: resolved.query,
    phase: resolved.phase,
    searchScores: new Map(resolved.results.map((match) => [match.recipeIndex, match.score])),
  };
}

/** Which of a known set of recipes the words match, and how well. */
function scoreRecipeCandidates(
  searchIndex: TextSearchIndex,
  candidates: Iterable<number>,
  query: SearchQuery,
  options: { partial?: boolean },
): RankedRecipe[] {
  const narrowed = queryTextSearchIndex(searchIndex, query, options);
  const narrowedSet = narrowed ? new Set(narrowed) : undefined;
  const matches: RankedRecipe[] = [];

  for (const recipeIndex of candidates) {
    if (narrowedSet && !narrowedSet.has(recipeIndex)) {
      continue;
    }
    const score = matchSearchTokens(query, searchIndex.tokensByEntry[recipeIndex] ?? [], options);
    if (score !== undefined) {
      matches.push({ recipeIndex, score, iconScore: 0 });
    }
  }

  return matches;
}

function scoreRecipeIndexes(
  searchIndex: TextSearchIndex,
  recipeIndexes: Iterable<number>,
  query: SearchQuery,
  options: { partial?: boolean },
): RankedRecipe[] {
  const matches: RankedRecipe[] = [];
  for (const recipeIndex of recipeIndexes) {
    const score = matchSearchTokens(query, searchIndex.tokensByEntry[recipeIndex] ?? [], options);
    if (score !== undefined) {
      matches.push({ recipeIndex, score, iconScore: 0 });
    }
  }
  return matches;
}

/**
 * All crop source "recipes", for the crop picker on a crop farm card. They also
 * appear in the recipe book like any other recipe; this is the flat catalogue
 * the card's own dropdown searches.
 */
/**
 * Every recipe of one map, as summaries sorted by name: the list a card's own
 * picker offers (a crop farm's crops, an EEC's mobs). Only for small maps that
 * are one choice each - the whole map ships in one response.
 */
async function listDatasetMapRecipes(versionId: string, recipeMap: string) {
  const catalog = await loadCatalog(versionId);
  if (!catalog.version.recipeLookupIndexPath) {
    return [];
  }

  const lookup = await loadRecipeLookupIndex(catalog.version);
  const mapId = lookup.recipeMapIds.get(recipeMap);
  if (mapId === undefined) {
    return [];
  }

  const recipeIndexes: number[] = [];
  for (let recipeIndex = 0; recipeIndex < lookup.recipeCount; recipeIndex += 1) {
    if (lookup.recipeMapIdsByRecipeIndex[recipeIndex] === mapId) {
      recipeIndexes.push(recipeIndex);
    }
  }

  const recipes = await getRecipeSummariesByIndex(catalog, recipeIndexes);
  recipes.sort((left, right) => left.name.localeCompare(right.name));
  return recipes;
}

export async function listDatasetCropFarmRecipes(versionId: string) {
  return { crops: await listDatasetMapRecipes(versionId, CROP_FARM_RECIPE_MAP) };
}

/** The Extreme Entity Crusher's mobs, one recipe each, for its spawner picker. */
export async function listDatasetEecMobs(versionId: string) {
  return { mobs: await listDatasetMapRecipes(versionId, EEC_MACHINE_TYPE) };
}

async function queryDatasetRecipesFromLookup(
  catalog: LoadedRecipeIndex,
  request: DatasetRecipeQueryRequest,
) {
  const lookup = await loadRecipeLookupIndex(catalog.version);
  const parsedQuery = parseSearchQuery(request.query);
  const clauses = normalizedRecipeQueryClauses(request);

  if (clauses.length === 0 && parsedQuery.terms.length === 0) {
    return emptyRecipeQueryResult(request);
  }

  // Only a typed query needs the words index, and building it walks every
  // recipe: browsing a resource must not pay for one.
  const search = parsedQuery.terms.length
    ? await getRecipeSearchIndex(catalog, lookup)
    : undefined;
  let scopedByMap = clauses.length
    ? tierFilteredByMap(
        lookup,
        getClauseLookupRecipesByMap(catalog, lookup, clauses, request),
        request.maxTier,
      )
    : undefined;
  if (scopedByMap && hasOnlySide(clauses, request)) {
    scopedByMap = await filterOnlyRecipesByMap(catalog, scopedByMap, clauses, request);
  }
  const resolved = resolveRecipeSearch(
    request.query,
    () => ensureResourceIndexes(catalog).vocabulary,
    (query, options) => {
      if (!search) {
        return [];
      }
      return scopedByMap
        ? scoreRecipeCandidates(search.index, flattenRecipeIndexes(scopedByMap), query, options)
        : scoreAllRecipes(search.index, search.entryCount, query, options);
    },
  );
  const searchScores = resolved.searchScores;
  // A pure text search has no resource to group by, so the maps come out of what
  // the words matched.
  const tierCandidatesByMap =
    scopedByMap ??
    tierFilteredByMap(lookup, groupRecipesByMap(lookup, searchScores?.keys() ?? []), request.maxTier);
  const countedRecipeMaps = [...tierCandidatesByMap.entries()]
    .map(([recipeMapId, recipeIndexes]) => {
      const recipeMap = lookup.recipeMaps[recipeMapId];
      if (!recipeMap) {
        return undefined;
      }
      const count = searchScores
        ? recipeIndexes.filter((recipeIndex) => searchScores.has(recipeIndex)).length
        : recipeIndexes.length;
      return count > 0 ? { recipeMap, count } : undefined;
    })
    .filter((entry): entry is { recipeMap: string; count: number } => Boolean(entry))
    .sort((a, b) => a.recipeMap.localeCompare(b.recipeMap));
  const sortedRecipeMaps = countedRecipeMaps.map((entry) => entry.recipeMap);
  const recipeMapCounts = Object.fromEntries(
    countedRecipeMaps.map((entry) => [entry.recipeMap, entry.count]),
  );
  const effectiveMap = request.allMaps
    ? undefined
    : request.recipeMap && sortedRecipeMaps.includes(request.recipeMap)
      ? request.recipeMap
      : sortedRecipeMaps[0];
  const effectiveMapId = effectiveMap ? lookup.recipeMapIds.get(effectiveMap) : undefined;
  // The chips' selection narrows the RESULTS only: the counted map list above
  // deliberately still covers everything, so an unselected chip keeps its count.
  const selectedByMap = request.mapSelection
    ? new Map(
        [...tierCandidatesByMap.entries()].filter(([recipeMapId]) =>
          isRecipeMapSelected(request.mapSelection, lookup.recipeMaps[recipeMapId]),
        ),
      )
    : tierCandidatesByMap;
  const scopedCandidates =
    effectiveMapId !== undefined
      ? (tierCandidatesByMap.get(effectiveMapId) ?? [])
      : flattenRecipeIndexes(selectedByMap);
  const matching: RankedRecipe[] = [];

  for (const recipeIndex of scopedCandidates) {
    if (searchScores && !searchScores.has(recipeIndex)) {
      continue;
    }
    matching.push({
      recipeIndex,
      score: searchScores?.get(recipeIndex) ?? 0,
      iconScore: lookup.iconScores[recipeIndex] ?? 0,
    });
  }

  const pageRecipeIndexes = rankRecipes(await applyFocusScores(catalog, matching, clauses))
    .slice(request.offset, request.offset + request.limit)
    .map((match) => match.recipeIndex);
  const recipes = (await getRecipeSummariesByIndex(catalog, pageRecipeIndexes)).map((recipe) =>
    applyClauseResourceContexts(recipe, catalog, clauses),
  );

  return {
    recipes,
    total: matching.length,
    recipeMaps: sortedRecipeMaps,
    recipeMapCounts,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, getRecipeMapIcon(catalog, recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matching.length,
    ...searchOutcome(resolved),
  };
}

/**
 * The conditions a request actually asks, whichever wire form it spoke.
 * Every pre-existing caller still sends one resource and a mode; that is
 * exactly a one-clause query.
 */
function normalizedRecipeQueryClauses(request: DatasetRecipeQueryRequest): RecipeQueryClause[] {
  if (request.clauses?.length) {
    return request.clauses.slice(0, MAX_RECIPE_QUERY_CLAUSES);
  }
  if (request.resource) {
    return [
      {
        kind: request.resource.kind,
        id: request.resource.id,
        role: request.mode === "uses" ? "takes" : "makes",
      },
    ];
  }
  return [];
}

/**
 * Candidate recipes for a clause set, grouped by recipe map.
 *
 * Each clause reads the inverted index in its own direction with the same
 * oredict/cell widening a single browse gets. Within a side "any" unions and
 * "all" intersects; a recipe must then satisfy BOTH sides to survive, because
 * the stencil reads as one sentence: takes these, makes those.
 */
function getClauseLookupRecipesByMap(
  catalog: LoadedRecipeIndex,
  lookup: LoadedRecipeLookupIndex,
  clauses: RecipeQueryClause[],
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): Map<number, number[]> {
  const sides: Array<Map<number, number[]>> = [];
  for (const role of ["takes", "makes"] as const) {
    const sideClauses = clauses.filter((clause) => clause.role === role);
    if (sideClauses.length === 0) {
      continue;
    }
    const op = (role === "takes" ? ops.takesOp : ops.makesOp) ?? "any";
    const perClause = sideClauses.map((clause) => {
      const mode = recipeQueryClauseMode(clause.role);
      return getLookupRecipesByMap(lookup, getRecipeResourceScope(catalog, clause, mode), mode);
    });
    // "only" starts from the same intersection "all" does; the nothing-else
    // half is checked against the recipes themselves afterwards.
    sides.push(perClause.reduce(op === "any" ? unionRecipesByMap : intersectRecipesByMap));
  }
  return sides.reduce(intersectRecipesByMap);
}

/**
 * The "nothing else" half of ONLY, which set algebra cannot answer: past this
 * many candidates the exact check would mean reading too many recipe bodies,
 * so the query degrades to "all" rather than hanging. In practice an ONLY ask
 * intersects down to far fewer.
 */
const ONLY_VERIFY_LIMIT = 5000;

function hasOnlySide(clauses: RecipeQueryClause[], ops: {
  takesOp?: RecipeQuerySideOp;
  makesOp?: RecipeQuerySideOp;
}): boolean {
  return (
    (ops.takesOp === "only" && clauses.some((clause) => clause.role === "takes")) ||
    (ops.makesOp === "only" && clauses.some((clause) => clause.role === "makes"))
  );
}

function slotSatisfiedByClauses(slot: ResourceAmount, sideClauses: RecipeQueryClause[]): boolean {
  return sideClauses.some(
    (clause) =>
      (slot.kind === clause.kind && slot.id === clause.id) ||
      resourceMatchesInput({ kind: clause.kind, id: clause.id }, slot),
  );
}

/**
 * ONLY, read against the recipe itself: every output must be one of the makes
 * conditions, every CONSUMED input one of the takes conditions. Catalysts and
 * circuits are not consumed, so "takes only iron dust" still finds recipes
 * that also want a programmed circuit in the machine.
 */
function recipeIsOnlyMatch(
  summary: RecipeSummary,
  clauses: RecipeQueryClause[],
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): boolean {
  if (ops.makesOp === "only") {
    const makesClauses = clauses.filter((clause) => clause.role === "makes");
    if (
      makesClauses.length > 0 &&
      !summary.outputs.every((output) => slotSatisfiedByClauses(output, makesClauses))
    ) {
      return false;
    }
  }
  if (ops.takesOp === "only") {
    const takesClauses = clauses.filter((clause) => clause.role === "takes");
    if (
      takesClauses.length > 0 &&
      !summary.inputs.every(
        (input) => !isRecipeInputConsumed(input) || slotSatisfiedByClauses(input, takesClauses),
      )
    ) {
      return false;
    }
  }
  return true;
}

async function filterOnlyRecipesByMap(
  catalog: LoadedRecipeIndex,
  recipesByMap: Map<number, number[]>,
  clauses: RecipeQueryClause[],
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): Promise<Map<number, number[]>> {
  const candidates = flattenRecipeIndexes(recipesByMap);
  if (candidates.length === 0 || candidates.length > ONLY_VERIFY_LIMIT) {
    return recipesByMap;
  }

  const summaries = await getRecipeSummariesByIndexMap(catalog, candidates);
  const filtered = new Map<number, number[]>();
  for (const [recipeMapId, recipeIndexes] of recipesByMap) {
    const kept = recipeIndexes.filter((recipeIndex) => {
      const summary = summaries.get(recipeIndex);
      return !summary || recipeIsOnlyMatch(summary, clauses, ops);
    });
    if (kept.length > 0) {
      filtered.set(recipeMapId, kept);
    }
  }
  return filtered;
}

/** Flat-array version of the side algebra, for the legacy in-memory index path. */
function combineClauseIndexes(
  entries: Array<{ role: RecipeQueryRole; recipeIndexes: number[] }>,
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): number[] {
  const sides: number[][] = [];
  for (const role of ["takes", "makes"] as const) {
    const sideEntries = entries.filter((entry) => entry.role === role);
    if (sideEntries.length === 0) {
      continue;
    }
    const op = (role === "takes" ? ops.takesOp : ops.makesOp) ?? "any";
    sides.push(
      op === "any"
        ? [...new Set(sideEntries.flatMap((entry) => entry.recipeIndexes))]
        : sideEntries.map((entry) => entry.recipeIndexes).reduce(intersectRecipeIndexes),
    );
  }
  return sides.reduce(intersectRecipeIndexes);
}

function intersectRecipeIndexes(left: number[], right: number[]): number[] {
  const keep = new Set(right);
  return left.filter((recipeIndex) => keep.has(recipeIndex));
}

function unionRecipesByMap(
  left: Map<number, number[]>,
  right: Map<number, number[]>,
): Map<number, number[]> {
  const merged = new Map(left);
  for (const [recipeMapId, recipeIndexes] of right) {
    const existing = merged.get(recipeMapId);
    merged.set(
      recipeMapId,
      existing ? [...new Set([...existing, ...recipeIndexes])] : recipeIndexes,
    );
  }
  return merged;
}

function intersectRecipesByMap(
  left: Map<number, number[]>,
  right: Map<number, number[]>,
): Map<number, number[]> {
  const merged = new Map<number, number[]>();
  for (const [recipeMapId, recipeIndexes] of left) {
    const other = right.get(recipeMapId);
    if (!other) {
      continue;
    }
    const keep = new Set(other);
    const kept = recipeIndexes.filter((recipeIndex) => keep.has(recipeIndex));
    if (kept.length > 0) {
      merged.set(recipeMapId, kept);
    }
  }
  return merged;
}

/**
 * Every clause resource is a concrete context for the returned summaries, so
 * an oredict slot a Spruce Log satisfies renders as the Spruce Log that was
 * asked about, exactly as a single-resource browse always has.
 */
function applyClauseResourceContexts<T extends RecipeSummary>(
  recipe: T,
  catalog: LoadedRecipeIndex,
  clauses: RecipeQueryClause[],
): T {
  let contextualized = recipe;
  for (const clause of clauses) {
    contextualized = applyUsesResourceContext(contextualized, catalog, clause);
  }
  return contextualized;
}

function tierFilteredByMap(
  lookup: LoadedRecipeLookupIndex,
  recipesByMap: Map<number, number[]>,
  maxTier: TierFilter,
): Map<number, number[]> {
  const filtered = new Map<number, number[]>();
  for (const [recipeMapId, recipeIndexes] of recipesByMap) {
    const candidates = recipeIndexes.filter((recipeIndex) =>
      recipeMatchesLookupTier(lookup, recipeIndex, maxTier),
    );
    if (candidates.length > 0) {
      filtered.set(recipeMapId, candidates);
    }
  }
  return filtered;
}

function groupRecipesByMap(
  lookup: LoadedRecipeLookupIndex,
  recipeIndexes: Iterable<number>,
): Map<number, number[]> {
  const byMap = new Map<number, number[]>();
  for (const recipeIndex of recipeIndexes) {
    const recipeMapId = lookup.recipeMapIdsByRecipeIndex[recipeIndex] ?? -1;
    if (recipeMapId < 0) {
      continue;
    }
    const existing = byMap.get(recipeMapId);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      byMap.set(recipeMapId, [recipeIndex]);
    }
  }
  return byMap;
}

function flattenRecipeIndexes(recipesByMap: Map<number, number[]>): number[] {
  return [...new Set([...recipesByMap.values()].flat())];
}

/**
 * The words index for recipes, from wherever this dataset keeps it.
 *
 * Datasets published with a lookup index carry the search text in it; older ones
 * only have it on the full recipe index, which then has to be loaded.
 */
async function getRecipeSearchIndex(
  catalog: LoadedRecipeIndex,
  lookup: LoadedRecipeLookupIndex,
): Promise<{ index: TextSearchIndex; entryCount: number }> {
  if (lookup.searchText.length) {
    return { index: ensureLookupSearchIndex(lookup), entryCount: lookup.recipeCount };
  }

  const recipeCatalog = catalog.recipes ? catalog : await loadRecipeIndex(catalog.version.id);
  return {
    index: ensureIndexes(recipeCatalog).searchIndex,
    entryCount: recipeCatalog.recipes?.length ?? 0,
  };
}

function emptyRecipeQueryResult(request: { offset: number; limit: number }) {
  return {
    recipes: [],
    total: 0,
    recipeMaps: [],
    recipeMapCounts: {},
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
    inputs: enrichedRecipe.inputs.map((resource) =>
      hydrateResource(resource, resourcesByKey, getChoiceAlternativesByKey(catalog)),
    ),
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
      recipeMapIcons: withTankMapFace(catalog),
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

/**
 * rawRecipeId -> recipe indexes, built once per loaded dataset.
 *
 * This map holds ids and numbers only. It used to hold every recipe BODY,
 * which pinned the whole corpus (hundreds of MB) in the heap forever the
 * first time anyone imported a plan carrying rawRecipeIds - the single
 * biggest driver of the production server's heap-exhaustion crashes. The
 * scan reads shards a few at a time and keeps none of them.
 */
async function getRecipeIndexesByRawRecipeId(
  catalog: LoadedRecipeIndex,
): Promise<Map<string, number[]>> {
  if (catalog.recipeIndexesByRawRecipeId) {
    return catalog.recipeIndexesByRawRecipeId;
  }

  const cacheKey = datasetVersionCacheKey(catalog.version);
  const pending = pendingRawRecipeIdIndexLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const indexesByRawRecipeId = new Map<string, number[]>();
    const concurrency = 4;
    for (let index = 0; index < catalog.shards.length; index += concurrency) {
      const batch = catalog.shards.slice(index, index + concurrency);
      const payloads = await Promise.all(
        batch.map((shard) => readGzipJson<RecipeShardPayload>(publicPathToFile(shard.path))),
      );
      // Recorded in shard order so candidate lists stay deterministic.
      payloads.forEach((payload, batchIndex) => {
        const shard = batch[batchIndex];
        payload.recipes.forEach((recipe, offset) => {
          const rawRecipeId = recipe.source?.rawRecipeId;
          if (!rawRecipeId) {
            return;
          }
          const existing = indexesByRawRecipeId.get(rawRecipeId);
          if (existing) {
            existing.push(shard.start + offset);
          } else {
            indexesByRawRecipeId.set(rawRecipeId, [shard.start + offset]);
          }
        });
      });
    }
    catalog.recipeIndexesByRawRecipeId = indexesByRawRecipeId;
    return indexesByRawRecipeId;
  })().finally(() => {
    pendingRawRecipeIdIndexLoads.delete(cacheKey);
  });

  pendingRawRecipeIdIndexLoads.set(cacheKey, promise);
  return promise;
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
    inputs: enrichedRecipe.inputs.map((resource) =>
      hydrateResource(resource, resourcesByKey, getChoiceAlternativesByKey(catalog)),
    ),
    outputs: enrichedRecipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
  };
}

function hydrateResource<T extends ResourceAmount>(
  resource: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  choiceAlternatives?: Map<string, ResourceAlternative[]>,
): T {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  // A placeholder input gets the group it stands for even when the catalog has
  // no other metadata for it, so this runs before the missing-entry bail-out.
  const choice =
    !resource.alternatives?.length && isVirtualChoiceResource(resource)
      ? choiceAlternatives?.get(`${resource.kind}:${resource.id}`)
      : undefined;
  if (!indexed) {
    return choice?.length ? { ...resource, alternatives: choice } : resource;
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
      resource.alternatives ??
      ("alternatives" in indexed ? indexed.alternatives : undefined) ??
      choice,
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

/**
 * Which items and fluids a thing that GROWS can hand you.
 *
 * Built by walking the produced-by index once and keeping the resources whose
 * recipes belong to a crop or bee map. Cached on the loaded dataset, because it
 * is the same answer for every player on it.
 */
async function getPassiveSourceResourceKeys(
  catalog: LoadedRecipeIndex,
  source: ResourceSourceFilter,
): Promise<Set<string>> {
  const cached = catalog.passiveSourceKeys?.[source];
  if (cached) {
    return cached;
  }

  const recipeMaps = source === "plants" ? PLANT_RECIPE_MAPS : BEE_RECIPE_MAPS;
  const keys = new Set<string>();

  if (catalog.version.recipeLookupIndexPath) {
    const lookup = await loadRecipeLookupIndex(catalog.version);
    const mapIds = new Set(
      [...recipeMaps]
        .map((recipeMap) => lookup.recipeMapIds.get(recipeMap))
        .filter((mapId): mapId is number => mapId !== undefined),
    );
    for (const [key, recipesByMap] of lookup.entries) {
      if (!key.startsWith("recipes:")) {
        continue;
      }
      for (const recipeMapId of recipesByMap.keys()) {
        if (mapIds.has(recipeMapId)) {
          keys.add(key.slice("recipes:".length));
          break;
        }
      }
    }
  } else {
    const recipeCatalog = await loadRecipeIndex(catalog.version.id);
    for (const recipe of recipeCatalog.recipes ?? []) {
      if (!recipe.recipeMap || !recipeMaps.has(recipe.recipeMap)) {
        continue;
      }
      for (const output of recipe.outputs ?? []) {
        keys.add(`${output.kind}:${output.id}`);
      }
    }
  }

  catalog.passiveSourceKeys = { ...catalog.passiveSourceKeys, [source]: keys };
  return keys;
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
          const summary = toRecipeSummary(
            recipe,
            getCatalogResourcesByKey(catalog),
            getChoiceAlternativesByKey(catalog),
          );
          setCachedHydratedSummary(catalog, recipeIndex, summary);
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
  const cached = getCachedHydratedSummary(catalog, recipeIndex);
  if (cached) {
    return cached;
  }

  const compactSummary = catalog.recipes?.[recipeIndex];
  if (!compactSummary?.inputs || !compactSummary.outputs) {
    return undefined;
  }

  const summary = hydrateRecipeSummary(compactSummary, catalog);
  setCachedHydratedSummary(catalog, recipeIndex, summary);
  return summary;
}

function getCachedHydratedSummary(
  catalog: LoadedRecipeIndex,
  recipeIndex: number,
): RecipeSummary | undefined {
  const cache = catalog.hydratedRecipeSummaries;
  const cached = cache?.get(recipeIndex);
  if (!cache || !cached) {
    return undefined;
  }

  cache.delete(recipeIndex);
  cache.set(recipeIndex, cached);
  return cached;
}

/**
 * Hydrated summaries are cheap to rebuild and were cached forever, which let
 * hours of recipe-book browsing walk the heap into the limit. Same LRU shape
 * as the shard cache: recently used stays, the tail falls off.
 */
function setCachedHydratedSummary(
  catalog: LoadedRecipeIndex,
  recipeIndex: number,
  summary: RecipeSummary,
) {
  const cache = (catalog.hydratedRecipeSummaries ??= new Map());
  cache.set(recipeIndex, summary);
  while (cache.size > maxHydratedRecipeSummaryCount) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function toRecipeSummary(
  recipe: Recipe,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  choiceAlternatives?: Map<string, ResourceAlternative[]>,
): RecipeSummary {
  const enrichedRecipe = enrichPassiveProductionRecipe(recipe);
  return {
    id: enrichedRecipe.id,
    name: enrichedRecipe.name,
    // What the recipe IS, which decides how the recipe book draws it. Leaving
    // it off made the renderer fall back to guessing from the recipe's name,
    // and the guess reads substrings: "miCROProcessor" contains "crop", so the
    // Circuit Assembler recipe for one was drawn on a farm scene. The recipe
    // index built by the pipeline has always carried this; only this
    // server-side projection dropped it.
    kind: enrichedRecipe.kind,
    category: enrichedRecipe.category,
    recipeMap: enrichedRecipe.source?.recipeMap ?? enrichedRecipe.machineType,
    machineType: enrichedRecipe.machineType,
    minimumTier: enrichedRecipe.minimumTier,
    durationTicks: enrichedRecipe.durationTicks,
    eut: enrichedRecipe.eut,
    programmedCircuit: enrichedRecipe.programmedCircuit,
    specialValue: enrichedRecipe.specialValue,
    metadata: enrichedRecipe.metadata,
    machineHandlers: hydrateMachineHandlers(enrichedRecipe.machineHandlers, resourcesByKey),
    machineConfigControls: hydrateMachineConfigControls(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    inputs: enrichedRecipe.inputs.map((resource) =>
      hydrateResource(resource, resourcesByKey, choiceAlternatives),
    ),
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

/**
 * What each "any of these" placeholder actually stands for.
 *
 * GTNH ships real items whose whole job is to mean a set: "Any LV Circuit" is a
 * placeholder, not something you hold. Recipes reference those directly, and
 * the exported resource for one carries no member list, so a slot demanding
 * "Any LV Circuit" could not say which circuits it would take.
 *
 * The membership already exists in the other direction: each `oredict:` group
 * lists its members, and the placeholder is one of them. This inverts that once
 * per catalog so a placeholder can be expanded back into its group.
 *
 * Deliberately restricted to placeholders, which is a narrower rule than it
 * first looks like it should be. Ore dictionary membership is NOT the same
 * thing as what a recipe accepts: the Circuit Assembler recipe for an
 * Electronic Circuit names a Vacuum Tube and takes only that, even though the
 * vacuum tube shares the `circuitPrimitive` group with the NAND chip. Offering
 * the group there invents a recipe that does not exist.
 *
 * A placeholder is different in kind. "Any LV Circuit" is not an item anyone
 * can hold; standing for its group is the entire reason it exists, so
 * expanding it reports what the recipe already meant.
 */
export function getChoiceAlternativesByKey(
  catalog: LoadedRecipeIndex,
): Map<string, ResourceAlternative[]> {
  if (catalog.choiceAlternativesByKey) {
    return catalog.choiceAlternativesByKey;
  }

  const byKey = new Map<string, ResourceAlternative[]>();
  for (const candidate of getCatalogResourcesByKey(catalog).values()) {
    if (candidate.kind !== "item" || !isOreDictionaryResource(candidate)) {
      continue;
    }
    const members = candidate.alternatives ?? [];
    if (members.length < 2) {
      continue;
    }

    // One stand-in must never expand into another, so placeholders are dropped
    // from the offered set no matter who is asking.
    const real = members.filter((member) => !isVirtualChoiceResource(member));
    if (real.length === 0) {
      continue;
    }

    for (const member of members) {
      if (!isVirtualChoiceResource(member)) {
        continue;
      }
      const key = `${member.kind}:${member.id}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, real);
        continue;
      }
      const merged = [...existing];
      for (const sibling of real) {
        if (!merged.some((entry) => entry.kind === sibling.kind && entry.id === sibling.id)) {
          merged.push(sibling);
        }
      }
      byKey.set(key, merged);
    }
  }

  catalog.choiceAlternativesByKey = byKey;
  return byKey;
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

  // Searching a fluid also turns up the cells of it. This is the one place the
  // two forms are still treated as one substance, and it is deliberate: it only
  // widens what the recipe book shows you, it never wires anything together or
  // converts an amount. Connections are strict — see `resourceMatchesInput`.
  for (const candidate of resourcesByKey.values()) {
    if (
      candidate.kind === "item" &&
      !isOreDictionaryResource(candidate) &&
      isFluidEquivalentToFilledCell(resource, candidate)
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

/**
 * A search with no resource behind it: score every recipe the words can reach.
 *
 * The trigram index normally hands back a short list. Only a query it cannot
 * narrow (a two-letter word) falls through to walking all of them, which is why
 * that walk is a generator rather than a 270,000-long array.
 */
function scoreAllRecipes(
  searchIndex: TextSearchIndex,
  entryCount: number,
  query: SearchQuery,
  options: { partial?: boolean },
): RankedRecipe[] {
  const narrowed = queryTextSearchIndex(searchIndex, query, options);
  return scoreRecipeIndexes(searchIndex, narrowed ?? countedRange(entryCount), query, options);
}

function* countedRange(count: number): Generator<number> {
  for (let index = 0; index < count; index += 1) {
    yield index;
  }
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

export function getWildcardResource(
  resource: Pick<ResourceAmount, "kind" | "id">,
): Pick<ResourceAmount, "kind" | "id"> | undefined {
  if (resource.kind !== "item" || resource.id.endsWith("@32767")) {
    return undefined;
  }

  // Bare ids are damage-0 items ("minecraft:log" is Oak Log); they match
  // any-damage wildcard inputs just like their "@<damage>" siblings do.
  const separatorIndex = resource.id.lastIndexOf("@");
  const baseId = separatorIndex === -1 ? resource.id : resource.id.slice(0, separatorIndex);
  return { kind: "item", id: `${baseId}@32767` };
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

  const fields: SearchEntryFields[] = [];
  const tokensByEntry: string[][] = [];
  const sortedResourceIndexes = catalog.resourceIndex
    .map((resource, index) => {
      fields[index] = resourceSearchFields(resource);
      tokensByEntry[index] = [
        ...new Set([
          ...(fields[index].name ?? []),
          ...(fields[index].id ?? []),
          ...(fields[index].text ?? []),
        ]),
      ];
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

  const resourceIndexes: ResourceQueryIndexes = {
    sortedResourceIndexes,
    fields,
    searchIndex: buildTokenSearchIndex(tokensByEntry, sortedResourceIndexes),
    // Ore dictionary entries are named "Ore Dictionary: plateSteel", which is not
    // a phrase anyone types, so only real names teach the corrector words.
    vocabulary: buildSearchVocabulary(
      sortedResourceIndexes
        .map((index) => catalog.resourceIndex[index])
        .filter((resource) => resource && !isOreDictionaryResource(resource))
        .map((resource) => resource.displayName ?? ""),
    ),
  };
  catalog.resourceIndexes = resourceIndexes;
  return resourceIndexes;
}

function resourceSearchFields(resource: DatasetResourceIndexEntry): SearchEntryFields {
  return {
    nameText: normalizeText(resource.displayName ?? resource.id),
    name: splitSearchTokens(resource.displayName ?? ""),
    id: splitSearchTokens(`${resource.id} ${(resource.oreDictionary ?? []).join(" ")}`),
    text: splitSearchTokens((resource.tooltip ?? []).join(" ")),
  };
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
    // The tab a crop grows on. Guessing from the map's name lands on a farming
    // machine, and this reads as "something planted" at 16 pixels.
    recipeMap: CROP_FARM_RECIPE_MAP,
    recipeMaps: [CROP_FARM_RECIPE_MAP, "IC2 Crop"],
    resource: {
      kind: "item",
      id: "cropsnh:cropsticks",
      displayName: "Crop Sticks",
    },
  },
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
  if (!resource?.kind || !resource.id || resource.kind === "power") {
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
