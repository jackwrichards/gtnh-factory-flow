"use client";

import {
  ChevronLeft,
  ChevronRight,
  GitBranchPlus,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PointerEvent, RefObject } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetResources,
  queryRecipeDatasetRecipes,
  type RecipeDatasetResourceQueryResult,
  type RecipeDatasetQueryResult,
} from "@/lib/datasets/browser-loader";
import type { DatasetResourceIndexEntry, RecipeSummary } from "@/lib/datasets/types";
import {
  GT_VOLTAGE_TIERS,
  isVirtualChoiceResource,
  resourceLabel,
  resourceMatchesInput,
} from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import type { TierFilter } from "@/store/factory-store";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { usesNativeNeiChrome } from "@/lib/nei/layout";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { AppIdentity } from "./AppIdentity";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { NeiRecipeWindow } from "./nei/NeiRecipeWindow";
import { ResourceIcon } from "./nei/ResourceIcon";

const RECIPE_QUERY_LIMIT = 120;
const RESOURCE_DEFAULT_PAGE_SIZE = 6;
const RESOURCE_ROW_HEIGHT = 40;
const RESOURCE_ROW_GAP = 2;
const RESOURCE_GRID_CELL = 56;
const RESOURCE_GRID_GAP = 4;
const RESOURCE_PAGER_HEIGHT = 40;
const RESOURCE_VIEW_STORAGE_KEY = "gtnh-factory-flow.resource-view.v1";

type ResourceKindFilter = "all" | "item" | "fluid";
type ResourceSortMode = "relevance" | "name" | "mod" | "recipes";
type ResourceViewMode = "list" | "grid";

/** Mod is the id prefix ("gregtech:..."); bare fluid ids group as "fluids". */
function getResourceModLabel(resource: { id: string; kind: string }): string {
  const colon = resource.id.indexOf(":");
  if (colon > 0) {
    return resource.id.slice(0, colon);
  }
  return resource.kind === "fluid" ? "fluids" : "other";
}
const RESOURCE_HISTORY_VISIBLE_FALLBACK = 18;
const RECIPE_QUERY_CACHE_TTL_MS = 90_000;
const RESOURCE_QUERY_CACHE_TTL_MS = 90_000;
const RESOURCE_SEARCH_DEBOUNCE_MS = 125;
const RECIPE_SEARCH_DEBOUNCE_MS = 200;

interface RecipeBrowserProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

export function RecipeBrowser({ onLoadDatasetVersion }: RecipeBrowserProps) {
  const dataset = useFactoryStore((state) => state.dataset);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const maxTier = useFactoryStore((state) => state.maxTierFilter);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const resourceHistory = useFactoryStore((state) => state.recipeResourceHistory);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const setHighlightSearch = useFactoryStore((state) => state.setHighlightSearch);
  const setMaxTier = useFactoryStore((state) => state.setMaxTierFilter);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const clearResourceBrowser = useFactoryStore((state) => state.clearResourceBrowser);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipeObject);
  const [selectedRecipeMap, setSelectedRecipeMap] = useState("");
  const [recipePage, setRecipePage] = useState(0);
  const [recipeBookSearch, setRecipeBookSearch] = useState("");
  const [filteredRecipes, setFilteredRecipes] = useState<RecipeSummary[]>([]);
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [recipeHasMore, setRecipeHasMore] = useState(false);
  const [availableRecipeMaps, setAvailableRecipeMaps] = useState<string[]>([]);
  const [resourcePage, setResourcePage] = useState(0);
  const [resourcePageSize, setResourcePageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [resourceResults, setResourceResults] = useState<IndexedResource[]>([]);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [resourceKind, setResourceKind] = useState<ResourceKindFilter>("all");
  const [resourceMod, setResourceMod] = useState("");
  const [resourceSort, setResourceSort] = useState<ResourceSortMode>("relevance");
  const [resourceView, setResourceView] = useState<ResourceViewMode>("list");
  const [resourceMods, setResourceMods] = useState<Array<{ id: string; count: number }>>([]);
  const [resourceQueryLoading, setResourceQueryLoading] = useState(false);
  const [resourceQueryError, setResourceQueryError] = useState<string | undefined>();
  const [recipeMapIcons, setRecipeMapIcons] = useState<Record<string, DatasetResourceIndexEntry>>(
    {},
  );
  const [recipeQueryLoading, setRecipeQueryLoading] = useState(false);
  const [recipeQueryError, setRecipeQueryError] = useState<string | undefined>();
  const recipeQueryCacheRef = useRef<Map<string, RecipeQueryCacheEntry>>(new Map());
  const resourceQueryCacheRef = useRef<Map<string, ResourceQueryCacheEntry>>(new Map());
  const pendingRecipePrefetchesRef = useRef<Set<string>>(new Set());
  const debouncedRecipeSearch = useDebouncedValue(recipeSearch, RESOURCE_SEARCH_DEBOUNCE_MS);
  const debouncedRecipeBookSearch = useDebouncedValue(recipeBookSearch, RECIPE_SEARCH_DEBOUNCE_MS);

  // Publish the settled query to the canvas. Highlighting every node, storage and
  // edge against a half-typed word is wasted work the user never sees, so the
  // board only reacts once typing pauses.
  useEffect(() => {
    setHighlightSearch(debouncedRecipeSearch);
  }, [debouncedRecipeSearch, setHighlightSearch]);

  const activeResource = useMemo(() => {
    if (!browserResource) {
      return undefined;
    }

    return {
      ...browserResource,
      recipeCount: 0,
      anchorNodeId: browserResource.anchorNodeId,
    };
  }, [browserResource]);

  const historyResources = resourceHistory.filter((resource) => !isVirtualChoiceResource(resource));

  const recipeMaps = useMemo(
    () => availableRecipeMaps.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [availableRecipeMaps],
  );

  const recipeMapTabs = useMemo(
    () => buildRecipeMapTabs(recipeMaps, recipeMapIcons),
    [recipeMapIcons, recipeMaps],
  );

  const activeRecipeMap = recipeMaps.includes(selectedRecipeMap) ? selectedRecipeMap : "";
  const activeRecipeQuery = activeResource
    ? debouncedRecipeBookSearch.trim()
    : debouncedRecipeSearch.trim();

  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const getRecipeQueryKey = useCallback(
    (recipeMap: string, page: number) =>
      selectedDatasetVersion
        ? getRecipeQueryCacheKey({
            versionId: getDatasetVersionCacheKey(selectedDatasetVersion),
            query: activeRecipeQuery,
            resource: activeResource,
            mode: browserMode,
            recipeMap,
            maxTier,
            offset: page * RECIPE_QUERY_LIMIT,
            limit: RECIPE_QUERY_LIMIT,
          })
        : "",
    [activeRecipeQuery, activeResource, browserMode, maxTier, selectedDatasetVersion],
  );

  const getResourceQueryKey = useCallback(
    (page: number) =>
      selectedDatasetVersion
        ? getResourceQueryCacheKey({
            versionId: getDatasetVersionCacheKey(selectedDatasetVersion),
            query: debouncedRecipeSearch.trim(),
            offset: page * resourcePageSize,
            limit: resourcePageSize,
            kind: resourceKind,
            mod: resourceMod,
            sort: resourceSort,
          })
        : "",
    [
      debouncedRecipeSearch,
      resourceKind,
      resourceMod,
      resourcePageSize,
      resourceSort,
      selectedDatasetVersion,
    ],
  );

  // The saved view preference is applied after mount (deferred) so the SSR
  // markup and first client render agree.
  useEffect(() => {
    const stored = window.localStorage.getItem(RESOURCE_VIEW_STORAGE_KEY);
    if (stored === "grid") {
      return deferStateUpdate(() => setResourceView("grid"));
    }
    return undefined;
  }, []);

  const changeResourceView = useCallback((view: ResourceViewMode) => {
    setResourceView(view);
    window.localStorage.setItem(RESOURCE_VIEW_STORAGE_KEY, view);
  }, []);

  const prefetchRecipeMap = useCallback(
    (recipeMap: string) => {
      if (!selectedDatasetVersion) {
        return;
      }

      const query = activeRecipeQuery;
      if (!activeResource && query.length < 2) {
        return;
      }

      const cacheKey = getRecipeQueryKey(recipeMap, 0);
      if (
        !cacheKey ||
        getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey) ||
        pendingRecipePrefetchesRef.current.has(cacheKey)
      ) {
        return;
      }

      pendingRecipePrefetchesRef.current.add(cacheKey);
      void queryRecipeDatasetRecipes(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        {
          query,
          resource: activeResource
            ? {
                kind: activeResource.kind,
                id: activeResource.id,
              }
            : undefined,
          mode: browserMode,
          recipeMap: recipeMap || undefined,
          maxTier,
          offset: 0,
          limit: RECIPE_QUERY_LIMIT,
        },
      )
        .then((result) => {
          setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
          trimRecipeQueryCache(recipeQueryCacheRef.current);
        })
        .catch(() => {
          // Prefetch is opportunistic; normal tab selection will surface real errors.
        })
        .finally(() => {
          pendingRecipePrefetchesRef.current.delete(cacheKey);
        });
    },
    [
      activeResource,
      activeRecipeQuery,
      browserMode,
      datasetManifestUrl,
      getRecipeQueryKey,
      maxTier,
      selectedDatasetVersion,
    ],
  );

  const getFullRecipe = useCallback(
    async (recipeId: string, preferDataset = false): Promise<Recipe> => {
      const projectRecipe = projectRecipes.find((recipe) => recipe.id === recipeId);
      if (!preferDataset && projectRecipe && recipeHasRenderableIcons(projectRecipe)) {
        return projectRecipe;
      }
      if (!selectedDatasetVersion) {
        throw new Error("No dataset version is selected.");
      }

      return getRecipeDatasetRecipe(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        recipeId,
      );
    },
    [datasetManifestUrl, projectRecipes, selectedDatasetVersion],
  );

  const handleAddRecipe = useCallback(
    async (recipeSummary: RecipeSummary) => {
      const currentState = useFactoryStore.getState();
      const currentResource = currentState.recipeBrowserResource
        ? {
            ...currentState.recipeBrowserResource,
            recipeCount: 0,
            anchorNodeId: currentState.recipeBrowserResource.anchorNodeId,
          }
        : activeResource;
      const currentMode = currentState.recipeBrowserResource
        ? currentState.recipeBrowserMode
        : browserMode;
      const contextResource = getRecipeAddContextResource(
        currentResource,
        currentMode,
        recipeSummary,
      );
      const recipe = await getFullRecipe(recipeSummary.id, Boolean(currentResource));
      addNodeForRecipe(recipe, contextResource);
      clearResourceBrowser();
    },
    [activeResource, addNodeForRecipe, browserMode, clearResourceBrowser, getFullRecipe],
  );

  useEffect(() => {
    return deferStateUpdate(() => setResourcePage(0));
  }, [debouncedRecipeSearch, resourceKind, resourceMod, resourceSort, selectedDatasetVersion?.id]);

  // Kind/search changes can empty the selected mod's scope; drop a stale pick.
  useEffect(() => {
    if (resourceMod && resourceMods.length > 0 && !resourceMods.some((m) => m.id === resourceMod)) {
      return deferStateUpdate(() => setResourceMod(""));
    }
    return undefined;
  }, [resourceMod, resourceMods]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(resourceTotal / resourcePageSize) - 1);
    if (resourcePage > maxPage) {
      return deferStateUpdate(() => setResourcePage(maxPage));
    }
    return undefined;
  }, [resourcePage, resourcePageSize, resourceTotal]);

  useEffect(() => {
    if (!selectedDatasetVersion) {
      return deferStateUpdate(() => {
        setResourceResults([]);
        setResourceTotal(0);
        setResourceQueryLoading(false);
        setResourceQueryError(undefined);
      });
    }

    const query = debouncedRecipeSearch.trim();
    const cacheKey = getResourceQueryKey(resourcePage);
    const cached = getCachedResourceQuery(resourceQueryCacheRef.current, cacheKey);
    if (cached) {
      return deferStateUpdate(() => {
        setResourceResults(cached.resources);
        setResourceTotal(cached.total);
        setResourceMods(cached.mods ?? []);
        setResourceQueryLoading(false);
        setResourceQueryError(undefined);
      });
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setResourceQueryLoading(true);
        setResourceQueryError(undefined);
      }
    });

    queryRecipeDatasetResources(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      selectedDatasetVersion,
      {
        query,
        offset: resourcePage * resourcePageSize,
        limit: resourcePageSize,
        kind: resourceKind === "all" ? undefined : resourceKind,
        mod: resourceMod || undefined,
        sort: resourceSort,
      },
      { signal: controller.signal },
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCachedResourceQuery(resourceQueryCacheRef.current, cacheKey, result);
        trimResourceQueryCache(resourceQueryCacheRef.current);
        setResourceResults(result.resources);
        setResourceTotal(result.total);
        setResourceMods(result.mods ?? []);
        setResourceQueryLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setResourceResults([]);
        setResourceTotal(0);
        setResourceQueryError(error instanceof Error ? error.message : "Resource query failed.");
        setResourceQueryLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    datasetManifestUrl,
    getResourceQueryKey,
    debouncedRecipeSearch,
    resourceKind,
    resourceMod,
    resourcePage,
    resourcePageSize,
    resourceSort,
    selectedDatasetVersion,
  ]);

  useEffect(() => {
    return deferStateUpdate(() => setRecipePage(0));
  }, [
    activeResource?.id,
    activeResource?.kind,
    browserMode,
    maxTier,
    activeRecipeQuery,
    selectedDatasetVersion?.id,
    selectedRecipeMap,
  ]);

  useEffect(() => {
    return deferStateUpdate(() => setRecipeBookSearch(""));
  }, [activeResource?.id, activeResource?.kind, browserMode, selectedDatasetVersion?.id]);

  useEffect(() => {
    if (!selectedDatasetVersion) {
      return deferStateUpdate(() => {
        setFilteredRecipes([]);
        setRecipeTotal(0);
        setRecipeHasMore(false);
        setAvailableRecipeMaps([]);
        setRecipeMapIcons({});
      });
    }

    const query = activeRecipeQuery;
    if (!activeResource && query.length < 2) {
      return deferStateUpdate(() => {
        setFilteredRecipes([]);
        setRecipeTotal(0);
        setRecipeHasMore(false);
        setAvailableRecipeMaps([]);
        setRecipeMapIcons({});
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      });
    }

    const cacheKey = getRecipeQueryKey(activeRecipeMap, recipePage);
    const cached = getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey);
    if (cached) {
      return scheduleAfterPaint(() => {
        setFilteredRecipes((current) =>
          recipePage === 0 ? cached.recipes : appendUniqueRecipes(current, cached.recipes),
        );
        setRecipeTotal(cached.total);
        setRecipeHasMore(cached.hasMore);
        setAvailableRecipeMaps(cached.recipeMaps);
        setRecipeMapIcons(cached.recipeMapIcons ?? {});
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      });
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        if (recipePage === 0) {
          setFilteredRecipes([]);
          setRecipeTotal(0);
          setRecipeHasMore(false);
        }
        setRecipeQueryLoading(true);
        setRecipeQueryError(undefined);
      }
    });

    const cancelAfterPaint = scheduleAfterPaint(() => {
      void queryRecipeDatasetRecipes(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        {
          query,
          resource: activeResource
            ? {
                kind: activeResource.kind,
                id: activeResource.id,
              }
            : undefined,
          mode: browserMode,
          recipeMap: activeRecipeMap || undefined,
          maxTier,
          offset: recipePage * RECIPE_QUERY_LIMIT,
          limit: RECIPE_QUERY_LIMIT,
        },
        { signal: controller.signal },
      )
        .then((result) => {
          if (cancelled) {
            return;
          }
          setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
          trimRecipeQueryCache(recipeQueryCacheRef.current);
          setFilteredRecipes((current) =>
            recipePage === 0 ? result.recipes : appendUniqueRecipes(current, result.recipes),
          );
          setRecipeTotal(result.total);
          setRecipeHasMore(result.hasMore);
          setAvailableRecipeMaps(result.recipeMaps);
          setRecipeMapIcons(result.recipeMapIcons ?? {});
          if (activeResource && !activeRecipeMap && result.recipeMaps[0]) {
            setSelectedRecipeMap(result.recipeMaps[0]);
          }
          setRecipeQueryLoading(false);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setFilteredRecipes([]);
          setRecipeTotal(0);
          setRecipeHasMore(false);
          setAvailableRecipeMaps([]);
          setRecipeMapIcons({});
          setRecipeQueryError(error instanceof Error ? error.message : "Recipe query failed.");
          setRecipeQueryLoading(false);
        });
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelAfterPaint();
    };
  }, [
    activeRecipeMap,
    activeRecipeQuery,
    activeResource,
    browserMode,
    datasetManifestUrl,
    getRecipeQueryKey,
    maxTier,
    recipePage,
    selectedDatasetVersion,
  ]);
  return (
    <>
      <aside className="relative z-40 flex h-full min-h-[360px] flex-col border-r border-neutral-800 bg-[#25272c] text-neutral-100">
        <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
        <div className="border-b border-neutral-800 px-3 py-3">
          <label className="flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
            <Search className="h-4 w-4 text-neutral-500" />
            <input
              value={recipeSearch}
              onChange={(event) => {
                const value = event.target.value;
                setRecipeSearch(value);
              }}
              placeholder="Search item or fluid..."
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            {recipeSearch ? (
              <button
                type="button"
                onClick={() => setRecipeSearch("")}
                title="Clear search"
                aria-label="Clear search"
                className="text-neutral-500 hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>

          <div className="mt-2 flex items-center gap-1">
            {(
              [
                ["all", "All"],
                ["item", "Items"],
                ["fluid", "Fluids"],
              ] as Array<[ResourceKindFilter, string]>
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setResourceKind(kind)}
                className={[
                  "h-7 flex-1 rounded-[4px] border text-xs font-medium",
                  resourceKind === kind
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => changeResourceView(resourceView === "list" ? "grid" : "list")}
              title={resourceView === "list" ? "Switch to grid view" : "Switch to list view"}
              aria-label={resourceView === "list" ? "Switch to grid view" : "Switch to list view"}
              className="flex h-7 w-8 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200"
            >
              {resourceView === "list" ? (
                <LayoutGrid className="h-3.5 w-3.5" />
              ) : (
                <List className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <select
              value={resourceMod}
              onChange={(event) => setResourceMod(event.target.value)}
              title="Filter by mod"
              aria-label="Filter by mod"
              className="h-7 min-w-0 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-xs text-neutral-100 outline-none"
            >
              <option value="">All mods</option>
              {resourceMods.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.id} ({mod.count})
                </option>
              ))}
            </select>
            <select
              value={resourceSort}
              onChange={(event) => setResourceSort(event.target.value as ResourceSortMode)}
              title="Sort results"
              aria-label="Sort results"
              className="h-7 min-w-0 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-xs text-neutral-100 outline-none"
            >
              <option value="relevance">Best match</option>
              <option value="name">Name A–Z</option>
              <option value="mod">By mod</option>
              <option value="recipes">Most recipes</option>
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {!dataset && isDatasetLoading ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Loading recipe index...
            </div>
          ) : !dataset ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Recipe index is not loaded yet.
            </div>
          ) : (
            <VirtualResourceResultList
              resources={resourceResults}
              total={resourceTotal}
              currentPage={resourcePage}
              isLoading={resourceQueryLoading}
              error={resourceQueryError}
              activeResource={activeResource}
              view={resourceView}
              onPageChange={setResourcePage}
              onPageSizeChange={setResourcePageSize}
              onBrowse={browseResource}
            />
          )}
        </div>
        <ResourceHistoryPanel resources={historyResources} onBrowse={browseResource} />
      </aside>

      {activeResource ? (
        <RecipeBookOverlay
          activeRecipeMap={activeRecipeMap}
          activeResource={activeResource}
          filteredRecipes={filteredRecipes}
          isLoading={recipeQueryLoading}
          query={recipeBookSearch}
          queryError={recipeQueryError}
          queryTotal={recipeTotal}
          recipeMapTabs={recipeMapTabs}
          hasMore={recipeHasMore}
          selectedRecipeId={selectedRecipeId}
          maxTier={maxTier}
          onMaxTierChange={setMaxTier}
          onAdd={handleAddRecipe}
          onAddConnected={undefined}
          onBrowseResource={(resource, mode) =>
            browseResource(
              {
                kind: resource.kind,
                id: resource.id,
                displayName: resource.displayName,
                iconPath: resource.iconPath,
                iconAtlas: resource.iconAtlas,
                dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
                anchorNodeId: activeResource.anchorNodeId,
              },
              mode,
            )
          }
          onRecipeMapChange={(recipeMap) => {
            setSelectedRecipeMap(recipeMap);
            setRecipePage(0);
          }}
          onQueryChange={(query) => {
            setRecipeBookSearch(query);
            setRecipePage(0);
          }}
          onLoadMore={() => {
            if (!recipeQueryLoading && recipeHasMore) {
              setRecipePage((page) => page + 1);
            }
          }}
          onRecipeMapHover={prefetchRecipeMap}
          onSelectRecipe={selectRecipe}
          onClose={clearResourceBrowser}
        />
      ) : null}
    </>
  );
}

function ResourceHistoryPanel({
  resources,
  onBrowse,
}: {
  resources: Array<
    Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor">
  >;
  onBrowse: (
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
    >,
    mode: "recipes" | "uses",
  ) => void;
}) {
  const { containerRef, visibleSlotCount } = useVisibleResourceHistorySlots(resources.length);
  const visibleResources = resources.slice(0, visibleSlotCount);

  if (resources.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto z-20 shrink-0 border-t border-neutral-800 bg-[#111317] px-2 pb-2 pt-1.5">
      <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Recent
      </p>
      <div
        ref={containerRef}
        className="minecraft-pixel-art grid w-full min-w-0 gap-1 overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${HISTORY_CELL_SIZE}px, 1fr))`,
        }}
      >
        {visibleResources.map((resource) => (
          <button
            key={`${resource.kind}:${resource.id}`}
            type="button"
            onClick={() => onBrowse(resource, "recipes")}
            onContextMenu={(event) => {
              event.preventDefault();
              onBrowse(resource, "uses");
            }}
            aria-label={resourceLabel(resource)}
            title={resourceLabel(resource)}
            className="flex aspect-square items-center justify-center rounded-[4px] border border-transparent p-0 hover:border-neutral-500 hover:bg-white/5"
          >
            <ResourceIcon
              resource={{ ...resource, amount: 1 }}
              size="md"
              bare
              showAmount={false}
              tooltip={false}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

const HISTORY_CELL_SIZE = 52;
const HISTORY_ROWS = 3;

function useVisibleResourceHistorySlots(resourceCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleSlotCount, setVisibleSlotCount] = useState(RESOURCE_HISTORY_VISIBLE_FALLBACK);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const updateVisibleSlotCount = () => {
      const gap = 4;
      const width = Math.max(0, container.clientWidth - 1);
      const columns = Math.max(1, Math.floor((width + gap) / (HISTORY_CELL_SIZE + gap)));
      setVisibleSlotCount(columns * HISTORY_ROWS);
    };

    const animationFrame = window.requestAnimationFrame(updateVisibleSlotCount);
    const observer = new ResizeObserver(updateVisibleSlotCount);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [resourceCount]);

  return { containerRef, visibleSlotCount };
}

function useResourcePageSize(
  containerRef: RefObject<HTMLDivElement | null>,
  view: ResourceViewMode,
  onPageSizeChange: (pageSize: number) => void,
) {
  const [pageSize, setPageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [gridColumns, setGridColumns] = useState(6);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePageSize = () => {
      const availableHeight = Math.max(RESOURCE_ROW_HEIGHT, container.clientHeight);
      const listHeight = Math.max(RESOURCE_ROW_HEIGHT, availableHeight - RESOURCE_PAGER_HEIGHT);
      let nextPageSize: number;
      let nextColumns = 6;
      if (view === "grid") {
        const width = Math.max(RESOURCE_GRID_CELL, container.clientWidth);
        nextColumns = Math.max(
          1,
          Math.floor((width + RESOURCE_GRID_GAP) / (RESOURCE_GRID_CELL + RESOURCE_GRID_GAP)),
        );
        const rows = Math.max(
          1,
          Math.floor((listHeight + RESOURCE_GRID_GAP) / (RESOURCE_GRID_CELL + RESOURCE_GRID_GAP)),
        );
        nextPageSize = nextColumns * rows;
      } else {
        nextPageSize = Math.max(
          1,
          Math.floor((listHeight + RESOURCE_ROW_GAP) / (RESOURCE_ROW_HEIGHT + RESOURCE_ROW_GAP)),
        );
      }

      setPageSize((current) => (current === nextPageSize ? current : nextPageSize));
      setGridColumns((current) => (current === nextColumns ? current : nextColumns));
      onPageSizeChange(nextPageSize);
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, onPageSizeChange, view]);

  return { pageSize, gridColumns };
}

interface IndexedResource extends Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
> {
  recipeCount: number;
}

export type PreviewContextResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

interface RecipeMapTab {
  id: string;
  label: string;
  icon?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
}

interface RecipeQueryCacheEntry {
  result: RecipeDatasetQueryResult;
  expiresAt: number;
}

interface ResourceQueryCacheEntry {
  result: RecipeDatasetResourceQueryResult;
  expiresAt: number;
}

function VirtualResourceResultList({
  resources,
  total,
  currentPage,
  isLoading,
  error,
  activeResource,
  view,
  onPageChange,
  onPageSizeChange,
  onBrowse,
}: {
  resources: IndexedResource[];
  total: number;
  currentPage: number;
  isLoading: boolean;
  error?: string;
  activeResource?: IndexedResource;
  view: ResourceViewMode;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { pageSize, gridColumns } = useResourcePageSize(containerRef, view, onPageSizeChange);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const handlePreviousPage = useCallback(() => {
    onPageChange(Math.max(0, currentPage - 1));
  }, [currentPage, onPageChange]);
  const handleNextPage = useCallback(() => {
    onPageChange(Math.min(pageCount - 1, currentPage + 1));
  }, [currentPage, onPageChange, pageCount]);

  return (
    <div ref={containerRef} className="flex h-full min-w-0 min-h-0 flex-col overflow-hidden">
      {error ? (
        <div className="rounded border border-dashed border-red-700 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : isLoading && resources.length === 0 ? (
        <ResourceResultSkeleton view={view} pageSize={pageSize} gridColumns={gridColumns} />
      ) : resources.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
          No matching resource.
        </div>
      ) : (
        <ResourceResultPage
          resources={resources}
          activeResource={activeResource}
          view={view}
          gridColumns={gridColumns}
          isRefreshing={isLoading}
          onBrowseResource={onBrowse}
        />
      )}
      <ResourcePager
        currentPage={currentPage}
        pageCount={pageCount}
        onPreviousPage={handlePreviousPage}
        onNextPage={handleNextPage}
      />
    </div>
  );
}

/** Pulsing placeholders shaped like the results, instead of a text box. */
function ResourceResultSkeleton({
  view,
  pageSize,
  gridColumns,
}: {
  view: ResourceViewMode;
  pageSize: number;
  gridColumns: number;
}) {
  const count = Math.max(3, Math.min(pageSize, 60));
  if (view === "grid") {
    return (
      <div
        className="grid min-h-0 flex-1 content-start gap-1 overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        aria-label="Loading resources"
      >
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="aspect-square animate-pulse rounded-[4px] bg-neutral-800/70"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden" aria-label="Loading resources">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex h-10 shrink-0 items-center gap-2.5 px-1.5">
          <div className="h-8 w-8 animate-pulse rounded-[4px] bg-neutral-800/70" />
          <div
            className="h-3 animate-pulse rounded bg-neutral-800/70"
            style={{ width: `${45 + ((index * 17) % 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function ResourcePager({
  currentPage,
  pageCount,
  onPreviousPage,
  onNextPage,
}: {
  currentPage: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="mt-1.5 flex h-8 w-full min-w-0 shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0}
        className="flex h-7 w-8 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Previous resource page"
        title="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-xs text-neutral-400">
        Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1}
        className="flex h-7 w-8 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Next resource page"
        title="Next page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ResourceResultPage({
  resources,
  activeResource,
  view,
  gridColumns,
  isRefreshing,
  onBrowseResource,
}: {
  resources: IndexedResource[];
  activeResource?: IndexedResource;
  view: ResourceViewMode;
  gridColumns: number;
  isRefreshing: boolean;
  onBrowseResource: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const [, startBrowseTransition] = useTransition();

  const browse = useCallback(
    (resource: IndexedResource, mode: "recipes" | "uses") => {
      startBrowseTransition(() => onBrowseResource(resource, mode));
    },
    [onBrowseResource, startBrowseTransition],
  );

  if (view === "grid") {
    return (
      <div
        className={[
          "grid min-h-0 flex-1 content-start gap-1 overflow-hidden",
          isRefreshing ? "opacity-60" : "",
        ].join(" ")}
        style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        aria-label="Resource results"
        role="listbox"
      >
        {resources.map((resource) => {
          const active =
            activeResource?.kind === resource.kind && activeResource.id === resource.id;
          return (
            <button
              key={`${resource.kind}:${resource.id}`}
              type="button"
              onClick={() => browse(resource, "recipes")}
              onContextMenu={(event) => {
                event.preventDefault();
                browse(resource, "uses");
              }}
              className={[
                "minecraft-pixel-art flex aspect-square items-center justify-center rounded-[4px] border",
                active
                  ? "border-cyan-400 bg-cyan-500/10"
                  : "border-transparent hover:border-neutral-500 hover:bg-white/5",
              ].join(" ")}
              role="option"
              aria-selected={active}
            >
              <ResourceIcon
                resource={{ ...resource, amount: 1 }}
                size="md"
                bare
                showAmount={false}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={[
        "flex min-h-0 flex-1 flex-col justify-start gap-0.5 overflow-hidden",
        isRefreshing ? "opacity-60" : "",
      ].join(" ")}
      aria-label="Resource results"
      role="listbox"
    >
      {resources.map((resource) => {
        const active = activeResource?.kind === resource.kind && activeResource.id === resource.id;

        return (
          <button
            key={`${resource.kind}:${resource.id}`}
            type="button"
            onClick={() => browse(resource, "recipes")}
            onContextMenu={(event) => {
              event.preventDefault();
              browse(resource, "uses");
            }}
            title={resourceLabel(resource)}
            className={[
              "flex h-10 w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-[4px] border px-1.5 text-left text-sm text-neutral-50",
              active
                ? "border-cyan-400 bg-cyan-500/10"
                : "border-transparent hover:bg-white/5",
            ].join(" ")}
            role="option"
            aria-selected={active}
          >
            <span className="minecraft-pixel-art flex h-8 w-8 shrink-0 items-center justify-center">
              <ResourceIcon
                resource={{ ...resource, amount: 1 }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className="!h-8 !w-8"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-tight [text-shadow:1px_1px_0_#000]">
                {resourceLabel(resource)}
              </span>
              <span className="block truncate text-[10px] leading-tight text-neutral-500">
                {getResourceModLabel(resource)}
                {resource.recipeCount > 0 ? ` · ${resource.recipeCount} recipes` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RecipeMapTabBar({
  activeRecipeMap,
  tabs,
  onRecipeMapChange,
  onRecipeMapHover,
}: {
  activeRecipeMap: string;
  tabs: RecipeMapTab[];
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [, startTabTransition] = useTransition();

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const updateOverflow = () => {
      setHasOverflow(element.scrollWidth > element.clientWidth + 2);
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [tabs]);

  const scrollTabs = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  };

  return (
    <div
      className={[
        "grid h-[102px] shrink-0 items-start border-b-2 border-[var(--mc-47)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_0_0_var(--mc-33)]",
        hasOverflow ? "grid-cols-[42px_minmax(0,1fr)_42px]" : "grid-cols-[minmax(0,1fr)]",
      ].join(" ")}
    >
      {hasOverflow ? <NeiTabArrow direction="left" onClick={() => scrollTabs(-1)} /> : null}
      <div
        ref={scrollRef}
        className="nei-tab-strip flex h-[88px] gap-2 overflow-x-auto overflow-y-hidden px-1"
      >
        {tabs.map((tab) => (
          <MinecraftTooltip key={tab.id} label={tab.label}>
            <button
              type="button"
              onMouseEnter={() => onRecipeMapHover(tab.id)}
              onFocus={() => onRecipeMapHover(tab.id)}
              onClick={() => startTabTransition(() => onRecipeMapChange(tab.id))}
              aria-label={tab.label}
              className={neiTabClass(activeRecipeMap === tab.id)}
            >
              {tab.icon ? (
                <ResourceIcon resource={tab.icon} size="xl" showAmount={false} tooltip={false} />
              ) : (
                <span className="text-[12px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
                  ?
                </span>
              )}
            </button>
          </MinecraftTooltip>
        ))}
      </div>
      {hasOverflow ? <NeiTabArrow direction="right" onClick={() => scrollTabs(1)} /> : null}
    </div>
  );
}

function NeiTabArrow({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={direction === "left" ? "Previous recipe maps" : "Next recipe maps"}
      aria-label={direction === "left" ? "Previous recipe maps" : "Next recipe maps"}
      className="mt-1 h-20 w-10 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-[24px] leading-5 text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] [text-shadow:1px_1px_0_#000] hover:bg-[var(--mc-61)]"
    >
      {direction === "left" ? "<" : ">"}
    </button>
  );
}

function RecipeBookOverlay({
  activeRecipeMap,
  activeResource,
  filteredRecipes,
  hasMore,
  isLoading,
  query,
  queryError,
  queryTotal,
  recipeMapTabs,
  selectedRecipeId,
  maxTier,
  onMaxTierChange,
  onAdd,
  onAddConnected,
  onBrowseResource,
  onRecipeMapChange,
  onRecipeMapHover,
  onQueryChange,
  onLoadMore,
  onSelectRecipe,
  onClose,
}: {
  activeRecipeMap: string;
  activeResource: IndexedResource & { anchorNodeId?: string };
  filteredRecipes: RecipeSummary[];
  hasMore: boolean;
  isLoading: boolean;
  query: string;
  queryError?: string;
  queryTotal: number;
  recipeMapTabs: RecipeMapTab[];
  selectedRecipeId?: string;
  maxTier: TierFilter;
  onMaxTierChange: (tier: TierFilter) => void;
  onAdd: (recipe: RecipeSummary) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onSelectRecipe: (recipeId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const initialPanelSize = getInitialRecipeBookSize();
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [panelSize] = useState(initialPanelSize);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const displayedRecipes = filteredRecipes;

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setDragOffset(
      clampDragOffset(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        panelRef.current,
      ),
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center px-3 py-4 lg:pl-[360px] lg:pr-[440px]"
      onPointerDown={onClose}
    >
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Recipe book"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          width: `min(${panelSize.width}px, calc(100vw - 24px))`,
          height: `min(${panelSize.height}px, calc(100vh - 32px))`,
        }}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-2 border-[var(--mc-96)] bg-[var(--mc-78)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]">
          <RecipeMapTabBar
            activeRecipeMap={activeRecipeMap}
            tabs={recipeMapTabs}
            onRecipeMapChange={onRecipeMapChange}
            onRecipeMapHover={onRecipeMapHover}
          />

          <div className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-center px-2 pt-2">
            <div />
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="h-8 cursor-move select-none truncate border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-center text-[18px] leading-[26px] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)] [text-shadow:2px_2px_0_var(--mc-24)]"
            >
              {activeRecipeMap || filteredRecipes[0]?.machineType || resourceLabel(activeResource)}
            </div>
            <div />
          </div>

          <div className="flex gap-2 px-3 pt-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
              <Search className="h-4 w-4 text-neutral-500" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search ingredient..."
                className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => onQueryChange("")}
                  className="text-neutral-400 hover:text-white"
                  aria-label="Clear recipe book search"
                  title="Clear recipe book search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <select
              value={maxTier}
              onChange={(event) => onMaxTierChange(event.target.value as TierFilter)}
              title="Hide recipes above this voltage tier (also flags too-high nodes on the board)"
              aria-label="Maximum machine tier"
              className="h-9 w-28 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
            >
              <option value="all">All tiers</option>
              {GT_VOLTAGE_TIERS.map((entry) => (
                <option key={entry.tier} value={entry.tier}>
                  ≤ {entry.tier}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3" id="recipe-book-scroll">
            {queryError ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                {queryError}
              </div>
            ) : isLoading && filteredRecipes.length === 0 ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                Loading recipes...
              </div>
            ) : displayedRecipes.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                No matching recipes.
              </div>
            ) : (
              <VirtualRecipeResultList
                recipes={displayedRecipes}
                queryTotal={queryTotal}
                currentPage={0}
                pageSize={RECIPE_QUERY_LIMIT}
                selectedRecipeId={selectedRecipeId}
                onSelectRecipe={onSelectRecipe}
                onAdd={onAdd}
                onAddConnected={onAddConnected}
                onSlotBrowse={onBrowseResource}
                contextResource={activeResource}
                hasMore={hasMore}
                isLoadingMore={isLoading && displayedRecipes.length > 0}
                onLoadMore={onLoadMore}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function VirtualRecipeResultList({
  recipes,
  queryTotal,
  currentPage,
  pageSize,
  selectedRecipeId,
  onSelectRecipe,
  onAdd,
  onAddConnected,
  onSlotBrowse,
  contextResource,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  recipes: RecipeSummary[];
  queryTotal: number;
  currentPage: number;
  pageSize: number;
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipe: RecipeSummary) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onSlotBrowse: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  contextResource?: PreviewContextResource;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360 });
  // `usesNativeNeiChrome` resolves a layout per call, and infinite scroll keeps
  // growing this array (120, 240, 360...), so it must not run on every scroll
  // frame.
  const rowHeight = useMemo(() => (recipes.some(usesNativeNeiChrome) ? 322 : 246), [recipes]);
  const columnCount = 2;
  const overscan = 1;
  const rowCount = Math.ceil(recipes.length / columnCount);
  const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleRowCount = Math.ceil(viewport.height / rowHeight) + overscan * 2;
  const visibleStartIndex = startRow * columnCount;
  const visibleRecipes = recipes.slice(
    visibleStartIndex,
    visibleStartIndex + visibleRowCount * columnCount,
  );
  const topPadding = startRow * rowHeight;
  const bottomPadding = Math.max(
    0,
    (rowCount - startRow - Math.ceil(visibleRecipes.length / columnCount)) * rowHeight,
  );

  useEffect(() => {
    const scrollParent = anchorRef.current?.parentElement;
    if (!scrollParent) {
      return;
    }

    const updateViewport = () => {
      setViewport({
        scrollTop: scrollParent.scrollTop,
        height: scrollParent.clientHeight,
      });
    };

    updateViewport();
    scrollParent.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scrollParent);

    return () => {
      scrollParent.removeEventListener("scroll", updateViewport);
      resizeObserver.disconnect();
    };
  }, [recipes.length]);

  useEffect(() => {
    const scrollParent = anchorRef.current?.parentElement;
    if (!scrollParent || !hasMore || isLoadingMore) {
      return;
    }

    const threshold = 360;
    const remaining =
      scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight;
    if (remaining <= threshold) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore, viewport.scrollTop, viewport.height, recipes.length]);

  return (
    <div
      ref={anchorRef}
      title={
        queryTotal > recipes.length
          ? `${queryTotal} recipes matched, showing ${currentPage * pageSize + 1}-${Math.min(
              queryTotal,
              currentPage * pageSize + recipes.length,
            )}`
          : undefined
      }
    >
      <div style={{ height: topPadding }} />
      <div className="grid grid-cols-2 items-start gap-3">
        {visibleRecipes.map((recipe) => (
          <RecipeResultCard
            key={recipe.id}
            recipe={recipe}
            selected={selectedRecipeId === recipe.id}
            onSelectRecipe={onSelectRecipe}
            onAdd={onAdd}
            onAddConnected={onAddConnected}
            onSlotBrowse={onSlotBrowse}
            contextResource={contextResource}
          />
        ))}
      </div>
      {isLoadingMore ? (
        <div className="mt-3 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-center text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
          Loading recipes...
        </div>
      ) : null}
      <div style={{ height: bottomPadding }} />
    </div>
  );
}

const RecipeResultCard = memo(function RecipeResultCard({
  recipe,
  selected,
  onSelectRecipe,
  onAdd,
  onAddConnected,
  onSlotBrowse,
  contextResource,
}: {
  recipe: RecipeSummary;
  selected: boolean;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipe: RecipeSummary) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onSlotBrowse?: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  contextResource?: PreviewContextResource;
}) {
  const previewRecipe = useMemo(
    () => contextualizePreviewRecipe(summaryToPreviewRecipe(recipe), contextResource),
    [contextResource, recipe],
  );
  return (
    <article
      onClick={() => onSelectRecipe(recipe.id)}
      onDoubleClick={() => void onAdd(recipe)}
      className={[
        "relative cursor-pointer transition",
        selected ? "ring-1 ring-cyan-400" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-end gap-2">
        <button
          type="button"
          title={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          aria-label={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          onClick={(event) => {
            event.stopPropagation();
            if (onAddConnected) {
              onAddConnected(recipe.id);
            } else {
              onAdd(recipe);
            }
          }}
          className="absolute right-1 top-1 z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center border border-neutral-600 bg-[#1b1d21] text-neutral-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          {onAddConnected ? <GitBranchPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      <div className="overflow-hidden pb-1 pr-9">
        <NeiRecipeWindow
          recipe={previewRecipe}
          scale={2}
          compact
          contextResource={contextResource}
          className="mx-auto"
          onSlotClick={onSlotBrowse ? (slot, mode) => onSlotBrowse(slot.resource, mode) : undefined}
        />
      </div>
    </article>
  );
});

function summaryToPreviewRecipe(summary: RecipeSummary): Recipe {
  return {
    id: summary.id,
    name: summary.name,
    kind: summary.kind,
    category: summary.category,
    machineType: summary.machineType,
    minimumTier: summary.minimumTier,
    durationTicks: summary.durationTicks,
    eut: summary.eut,
    inputs: summary.inputs,
    outputs: summary.outputs,
    programmedCircuit: summary.programmedCircuit,
    specialValue: summary.specialValue,
    machineHandlers: summary.machineHandlers,
    machineConfigControls: summary.machineConfigControls,
    source: summary.source ?? (summary.recipeMap ? { recipeMap: summary.recipeMap } : undefined),
    metadata: summary.metadata,
    nei: summary.nei,
  };
}

export function contextualizePreviewRecipe(
  recipe: Recipe,
  resource: PreviewContextResource | undefined,
): Recipe {
  if (!resource) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input) => {
    if (!resourceMatchesInput(resource, input)) {
      return input;
    }

    if (input.kind !== resource.kind) {
      return input;
    }

    changed = true;
    return {
      ...input,
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName ?? input.displayName,
      iconPath: resource.iconPath ?? input.iconPath,
      iconAtlas: resource.iconAtlas ?? input.iconAtlas,
      dominantColor: resource.dominantColor ?? input.dominantColor,
      alternatives: undefined,
    };
  });
  const outputs = recipe.outputs.map((output) => {
    if (output.kind !== resource.kind || output.id !== resource.id) {
      return output;
    }

    changed = true;
    return {
      ...output,
      displayName: resource.displayName ?? output.displayName,
      iconPath: resource.iconPath ?? output.iconPath,
      iconAtlas: resource.iconAtlas ?? output.iconAtlas,
      dominantColor: resource.dominantColor ?? output.dominantColor,
    };
  });

  return changed ? { ...recipe, inputs, outputs } : recipe;
}

function getRecipeAddContextResource(
  activeResource: (IndexedResource & { anchorNodeId?: string }) | undefined,
  mode: "recipes" | "uses",
  contextRecipe: RecipeSummary | undefined,
):
  | (Pick<
      ResourceAmount,
      | "kind"
      | "id"
      | "displayName"
      | "iconPath"
      | "iconAtlas"
      | "dominantColor"
      | "tooltip"
      | "modId"
    > & {
      mode: "recipes" | "uses";
      inputIndex?: number;
      neiSlot?: ResourceAmount["neiSlot"];
    })
  | undefined {
  if (!activeResource) {
    return undefined;
  }

  if (mode === "uses") {
    const contextInputIndex = contextRecipe?.inputs.findIndex(
      (input) =>
        (input.kind === activeResource.kind && input.id === activeResource.id) ||
        resourceMatchesInput({ kind: activeResource.kind, id: activeResource.id }, input),
    );
    const contextInput =
      contextInputIndex !== undefined && contextInputIndex >= 0
        ? contextRecipe?.inputs[contextInputIndex]
        : undefined;
    const contextSlotInput =
      contextInput ??
      contextRecipe?.inputs.find(
        (input) =>
          input.neiSlot &&
          resourceMatchesInput({ kind: activeResource.kind, id: activeResource.id }, input),
      );
    if (contextSlotInput && !contextSlotInput.id.startsWith("oredict:")) {
      return {
        kind: contextSlotInput.kind,
        id: contextSlotInput.id,
        displayName: contextSlotInput.displayName ?? activeResource.displayName,
        iconPath: contextSlotInput.iconPath ?? activeResource.iconPath,
        iconAtlas: contextSlotInput.iconAtlas ?? activeResource.iconAtlas,
        dominantColor:
          contextSlotInput.dominantColor ??
          contextSlotInput.iconAtlas?.dominantColor ??
          activeResource.dominantColor ??
          activeResource.iconAtlas?.dominantColor,
        tooltip: contextSlotInput.tooltip,
        modId: contextSlotInput.modId,
        mode,
        inputIndex: contextInputIndex,
        neiSlot: contextSlotInput.neiSlot,
      };
    }
  }

  return {
    kind: activeResource.kind,
    id: activeResource.id,
    displayName: activeResource.displayName,
    iconPath: activeResource.iconPath,
    iconAtlas: activeResource.iconAtlas,
    dominantColor: activeResource.dominantColor ?? activeResource.iconAtlas?.dominantColor,
    mode,
  };
}

function recipeHasRenderableIcons(recipe: Recipe) {
  return [...recipe.inputs, ...recipe.outputs]
    .filter((resource) => resource.kind === "item")
    .every((resource) => Boolean(resource.iconPath || resource.iconAtlas));
}

function clampDragOffset(offset: { x: number; y: number }, panel: HTMLElement | null) {
  if (!panel || typeof window === "undefined") {
    return offset;
  }

  const rect = panel.getBoundingClientRect();
  const margin = 12;
  const maxX = Math.max(0, (window.innerWidth - rect.width) / 2 - margin);
  const maxY = Math.max(0, (window.innerHeight - rect.height) / 2 - margin);

  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function deferStateUpdate(callback: () => void) {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) {
      callback();
    }
  });

  return () => {
    cancelled = true;
  };
}

function scheduleAfterPaint(callback: () => void) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;

  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      if (!cancelled) {
        callback();
      }
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
}

function getInitialRecipeBookSize() {
  if (typeof window === "undefined") {
    return { width: 760, height: 760 };
  }

  return {
    width: Math.min(920, Math.max(420, window.innerWidth - 360 - 440 - 48)),
    height: Math.min(760, Math.max(360, window.innerHeight - 32)),
  };
}

function getDatasetVersionCacheKey(version: {
  id: string;
  checksumSha256?: string;
  publishedAt: string;
}) {
  return [version.id, version.checksumSha256 ?? version.publishedAt].join("@");
}

function appendUniqueRecipes(current: RecipeSummary[], incoming: RecipeSummary[]) {
  const seen = new Set(current.map((recipe) => recipe.id));
  const next = [...current];
  for (const recipe of incoming) {
    if (seen.has(recipe.id)) {
      continue;
    }
    seen.add(recipe.id);
    next.push(recipe);
  }
  return next;
}

function getRecipeQueryCacheKey({
  versionId,
  query,
  resource,
  mode,
  recipeMap,
  maxTier,
  offset,
  limit,
}: {
  versionId: string;
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap: string;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}) {
  return [
    versionId,
    query.trim().toLowerCase(),
    resource ? `${resource.kind}:${resource.id}` : "",
    mode,
    recipeMap,
    maxTier,
    offset,
    limit,
  ].join("|");
}

function getResourceQueryCacheKey({
  versionId,
  query,
  offset,
  limit,
  kind,
  mod,
  sort,
}: {
  versionId: string;
  query: string;
  offset: number;
  limit: number;
  kind: ResourceKindFilter;
  mod: string;
  sort: ResourceSortMode;
}) {
  return [versionId, query.trim().toLowerCase(), offset, limit, kind, mod, sort].join("|");
}


function getCachedRecipeQuery(cache: Map<string, RecipeQueryCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.result;
}

function setCachedRecipeQuery(
  cache: Map<string, RecipeQueryCacheEntry>,
  key: string,
  result: RecipeDatasetQueryResult,
) {
  cache.set(key, {
    result,
    expiresAt: Date.now() + RECIPE_QUERY_CACHE_TTL_MS,
  });
}

function trimRecipeQueryCache(cache: Map<string, RecipeQueryCacheEntry>) {
  while (cache.size > 120) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function getCachedResourceQuery(cache: Map<string, ResourceQueryCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.result;
}

function setCachedResourceQuery(
  cache: Map<string, ResourceQueryCacheEntry>,
  key: string,
  result: RecipeDatasetResourceQueryResult,
) {
  cache.set(key, {
    result,
    expiresAt: Date.now() + RESOURCE_QUERY_CACHE_TTL_MS,
  });
}

function trimResourceQueryCache(cache: Map<string, ResourceQueryCacheEntry>) {
  while (cache.size > 160) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function buildRecipeMapTabs(
  recipeMaps: string[],
  icons: Record<string, DatasetResourceIndexEntry>,
): RecipeMapTab[] {
  return recipeMaps.map((recipeMap) => {
    const resource = icons[recipeMap];
    return {
      id: recipeMap,
      label: recipeMap,
      icon: resource
        ? {
            kind: resource.kind,
            id: resource.id,
            amount: 1,
            displayName: resource.displayName,
            iconPath: resource.iconPath,
            iconAtlas: resource.iconAtlas,
            dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
          }
        : undefined,
    };
  });
}

function neiTabClass(active: boolean): string {
  return [
    "flex h-20 w-20 shrink-0 items-center justify-center bg-transparent p-0",
    active ? "ring-2 ring-white" : "hover:ring-2 hover:ring-cyan-300",
  ].join(" ");
}
