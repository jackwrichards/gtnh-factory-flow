"use client";

import { Search, X, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DragEvent, PointerEvent, RefObject, WheelEvent } from "react";
import { writeResourceDrag } from "@/lib/resource-drag";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  queryRecipeDatasetResources,
  type RecipeDatasetResourceQueryResult,
} from "@/lib/datasets/browser-loader";
import type { ResourceAmount } from "@/lib/model/types";
import { resourceLabel } from "@/lib/model";
import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import {
  buildSearchVocabulary,
  matchSearchEntry,
  parseSearchQuery,
  resolveSearchPhases,
  splitSearchTokens,
  type SearchCorrection,
  type SearchPhase,
} from "@/lib/search";
import { useFactoryStore } from "@/store/factory-store";
import { POWER_EU_CLAUSE_ID } from "@/lib/power/power-search";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsCompactViewport } from "@/lib/compact-view";
import { isEchoOfTouch } from "@/lib/pointer-kind";
import { isFromBrowseMenu, useBrowseMenu } from "./browse-menu";
import { ControlsCard } from "./ControlsCard";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { isSwatchFluid, ResourceIcon, spriteArtPixels } from "./nei/ResourceIcon";

/**
 * THE ITEM PANEL: the search box, the six filters and the sort, the paged
 * grid of results and the recent shelf. One component, so the items column
 * and every item picker (the product drawer button, the search stencil's
 * keys, the library filter) are literally the same screen. The caller owns
 * the search text - the column keeps its in the store, a picker keeps its
 * own - and says what a click on a tile does.
 */
export function ResourceIndexPane({
  search,
  onSearchChange,
  searchInputRef,
  searchFlashing = false,
  activeResource,
  onBrowse,
  autoFocus = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchFlashing?: boolean;
  activeResource?: IndexedResource;
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
  autoFocus?: boolean;
}) {
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersion = useFactoryStore((state) =>
    state.datasetManifest?.versions.find((entry) => entry.id === state.selectedDatasetVersionId),
  );
  const dataset = useFactoryStore((state) => state.dataset);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const recipeSearch = search;
  const setRecipeSearch = onSearchChange;
  const isSearchFlashing = searchFlashing;
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = searchInputRef ?? ownInputRef;
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus, inputRef]);
  const [resourcePage, setResourcePage] = useState(0);
  const [resourcePageSize, setResourcePageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [resourceResults, setResourceResults] = useState<IndexedResource[]>([]);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [resourceMod, setResourceMod] = useState("");
  // Popular is the resting default: with nothing typed it shows what players
  // actually build. A typed query still ranks name relevance first server-side,
  // so the sort only decides the untyped list and ties.
  const [resourceSort, setResourceSort] = useState<ResourceSortMode>("popular");
  const [resourceFilter, setResourceFilter] = useState<ResourceFilterMode>("all");
  const [resourceMods, setResourceMods] = useState<Array<{ id: string; count: number }>>([]);
  const [resourceSearchOutcome, setResourceSearchOutcome] = useState<SearchOutcome>(EXACT_SEARCH);
  const [resourceQueryLoading, setResourceQueryLoading] = useState(false);
  const [resourceQueryError, setResourceQueryError] = useState<string | undefined>();
  const resourceQueryCacheRef = useRef<Map<string, ResourceQueryCacheEntry>>(new Map());
  const debouncedRecipeSearch = useDebouncedValue(recipeSearch, RESOURCE_SEARCH_DEBOUNCE_MS);
  const resourceWheelRef = useRef(0);
  const onBoard = resourceFilter === "board";
  // The board filter is answered here, from the cards themselves, so it needs no
  // request and cannot go stale. Everything else comes back from the server.
  const boardResults = useBoardResourceResults(onBoard, {
    query: debouncedRecipeSearch.trim(),
    mod: resourceMod,
    sort: resourceSort,
    offset: resourcePage * resourcePageSize,
    limit: resourcePageSize,
  });
  const powerRow =
    !onBoard && resourceFilter === "all" && resourcePage === 0
      ? powerSearchRow(debouncedRecipeSearch)
      : undefined;
  const displayedResources = onBoard
    ? boardResults.resources
    : powerRow
      ? [powerRow, ...resourceResults]
      : resourceResults;
  const displayedTotal = onBoard ? boardResults.total : resourceTotal;
  const displayedMods = onBoard ? boardResults.mods : resourceMods;
  const displayedOutcome = onBoard ? boardResults.outcome : resourceSearchOutcome;
  const resourcePageCount = Math.max(
    1,
    Math.ceil(displayedTotal / Math.max(1, resourcePageSize)),
  );
  /**
   * The wheel turns the page, anywhere in the column.
   *
   * The list does not scroll - it is paged, a screenful at a time - so a wheel
   * over it did nothing at all, which reads as a dead panel. Notches are
   * accumulated rather than acted on one for one, so a trackpad flick moves a
   * page or two instead of forty.
   */
  const handleResourceWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.deltaY) {
        return;
      }
      // Turning back the other way starts over, or the notches left over from
      // scrolling down would have to be spent before the page moved up.
      if (Math.sign(event.deltaY) !== Math.sign(resourceWheelRef.current)) {
        resourceWheelRef.current = 0;
      }
      resourceWheelRef.current += event.deltaY;
      const steps = Math.trunc(resourceWheelRef.current / RESOURCE_WHEEL_PAGE_DELTA);
      if (steps === 0) {
        return;
      }
      resourceWheelRef.current -= steps * RESOURCE_WHEEL_PAGE_DELTA;
      setResourcePage((page) => clamp(page + steps, 0, resourcePageCount - 1));
    },
    [resourcePageCount],
  );
  const getResourceQueryKey = useCallback(
    (page: number) =>
      selectedDatasetVersion
        ? getResourceQueryCacheKey({
            versionId: getDatasetVersionCacheKey(selectedDatasetVersion),
            query: debouncedRecipeSearch.trim(),
            offset: page * resourcePageSize,
            limit: resourcePageSize,
            filter: resourceFilter,
            mod: resourceMod,
            sort: resourceSort,
          })
        : "",
    [
      debouncedRecipeSearch,
      resourceFilter,
      resourceMod,
      resourcePageSize,
      resourceSort,
      selectedDatasetVersion,
    ],
  );
  useEffect(() => {
    return deferStateUpdate(() => setResourcePage(0));
  }, [
    debouncedRecipeSearch,
    resourceFilter,
    resourceMod,
    resourceSort,
    selectedDatasetVersion?.id,
  ]);
  useEffect(() => {
    // The board's own resources are answered from memory, below: no request.
    if (!selectedDatasetVersion || onBoard) {
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
        setResourceSearchOutcome(searchOutcomeOf(cached));
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
        kind: resourceFilterKind(resourceFilter),
        mod: resourceMod || undefined,
        sort: resourceSort,
        source: resourceFilterSource(resourceFilter),
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
        setResourceSearchOutcome(searchOutcomeOf(result));
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
    onBoard,
    resourceFilter,
    resourceMod,
    resourcePage,
    resourcePageSize,
    resourceSort,
    selectedDatasetVersion,
  ]);

  // A filter or search change can empty the selected mod's scope; drop a stale pick.
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

  const browseResource = onBrowse;
  return (
    <div className="flex min-h-0 flex-1 flex-col" onWheel={handleResourceWheel}>
        {/* The same card the board and setup shelves put their search and
            filters in. Bare, this tab's controls read as a different kind of
            thing from the other two, when they are the same thing. */}
        <ControlsCard>
          <div className="flex items-center gap-1.5">
            {/* 16px text on a phone, deliberately: below that, iOS zooms the
                whole page in the moment the field takes focus, and the way back
                out is a pinch. */}
            <label
              className={[
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm compact:text-base text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]",
                isSearchFlashing ? "search-box-flash" : "",
              ].join(" ")}
            >
              <Search className="h-4 w-4 text-neutral-500" />
              <input
                ref={inputRef}
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
          </div>

          {/* What the search had to do to find anything. Only ever shown when it
              had to do something: a spelling stood in, or the words were taken
              one at a time because no item has all of them. */}
          {displayedOutcome.phase !== "exact" ? (
            <p className="mt-1.5 truncate text-[11px] leading-tight text-amber-300/80">
              {displayedOutcome.phase === "corrected"
                ? `Showing results for ${displayedOutcome.corrections
                    .map((correction) => correction.to)
                    .join(", ")}`
                : "No item has all those words. Showing the closest."}
            </p>
          ) : null}

          {/* One question, six answers, one of them on at a time. There is no
              "fluids a bee makes" to ask for, so there is no second row to pair
              this with; the view toggle sits with the search box it belongs to. */}
          {/* Three across, two rows: keep the full filter names readable in
              the narrow items panel. Sort gets its own full-width row. */}
          <div className="mt-1 grid grid-cols-3 gap-1">
            {RESOURCE_FILTER_CHOICES.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                onClick={() => setResourceFilter(choice.mode)}
                title={choice.title}
                aria-pressed={resourceFilter === choice.mode}
                className={[
                  "h-6 min-w-0 truncate rounded-[4px] border text-[11px] font-medium",
                  resourceFilter === choice.mode
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
                ].join(" ")}
              >
                {choice.label}
              </button>
            ))}
            <select
              value={resourceSort}
              onChange={(event) => setResourceSort(event.target.value as ResourceSortMode)}
              title="Sort results"
              aria-label="Sort results"
              className="col-span-3 h-6 min-w-0 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-100 outline-none"
            >
              <option value="popular">Most popular</option>
              <option value="relevance">Best match</option>
              <option value="name">Name A–Z</option>
              <option value="mod">By mod</option>
              <option value="made">Most ways to make</option>
              <option value="uses">Most used</option>
            </select>
          </div>
        </ControlsCard>

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1 pt-2">
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
              resources={displayedResources}
              total={displayedTotal}
              currentPage={resourcePage}
              isLoading={resourceQueryLoading && !onBoard}
              error={resourceQueryError}
              emptyLabel={
                onBoard
                  ? "Nothing placed on the board yet."
                  : resourceFilter === "plants"
                    ? "No crop grows that."
                    : resourceFilter === "bees"
                      ? "No bee makes that."
                      : undefined
              }
              activeResource={activeResource}
              onPageChange={setResourcePage}
              onPageSizeChange={setResourcePageSize}
              onBrowse={browseResource}
            />
          )}
        </div>

        <RecentResourceStrip onBrowse={browseResource} />
    </div>
  );
}

const RESOURCE_DEFAULT_PAGE_SIZE = 6;
/**
 * The one way results are drawn: a dense grid of tiles, the icon on top and a
 * quiet gray name under it. It replaced a list view (name plus a mod/recipe-
 * count line nobody asked for, one item per row) and a bare grid view (no
 * names at all) - as many items as the column holds without losing the name
 * (Jack, 2026-08-31). Four columns in the standard panel; two short lines of
 * name, then the hover tooltip carries the rest.
 */
// The height is exactly what the tile holds - a 44px icon cell + two 10px
// name lines + borders - so a wrapped second line is never clipped. Fluid art
// deliberately stays at the previous 40px size inside the bigger cell: a
// solid square at full cell size out-shouts every item around it.
const RESOURCE_TILE_HEIGHT = 66;
const RESOURCE_TILE_MIN_WIDTH = 58;
const RESOURCE_TILE_GAP = 2;
const RESOURCE_GRID_CELL = 56;
const RESOURCE_GRID_GAP = 4;
/**
 * How the art sits in a grid cell.
 *
 * Magnify the art inside its fixed cell. ResourceIcon caps that zoom against
 * each item's opaque bounds, so wide items keep their corners.
 */
const RESOURCE_GRID_ART = "!h-full !w-full";
// The pager measures 28px (24 + 4 margin); the extra is slack so a fractional
// device pixel can never clip the last row of tiles.
const RESOURCE_PAGER_HEIGHT = 31;
/** One mouse notch is 100 on most platforms, so one notch is one page. */
const RESOURCE_WHEEL_PAGE_DELTA = 80;

type ResourceSortMode = "relevance" | "popular" | "name" | "mod" | "made" | "uses";

/**
 * The one question the list is answering.
 *
 * Six answers, one at a time, because that is how they are actually used: nobody
 * asks for the fluids a bee makes, they ask for what bees make. Splitting the
 * six across a kind row and a source row made it look like they combined, and
 * the combinations were either the same list or nothing.
 *
 * "Board" is answered from the project rather than the server: the cards are
 * already in memory, and nothing the dataset knows could answer it anyway.
 */
type ResourceFilterMode = "all" | "item" | "fluid" | "board" | "plants" | "bees";

const RESOURCE_FILTER_CHOICES: Array<{
  mode: ResourceFilterMode;
  label: string;
  title: string;
}> = [
  { mode: "all", label: "All", title: "Everything" },
  { mode: "item", label: "Items", title: "Items" },
  { mode: "fluid", label: "Fluids", title: "Fluids" },
  { mode: "board", label: "Placed", title: "On this board" },
  { mode: "plants", label: "CropsNH", title: "Grown" },
  { mode: "bees", label: "Bees", title: "From bees" },
];

/** The dataset query only knows kinds and sources; this splits the choice up. */
function resourceFilterKind(filter: ResourceFilterMode): "item" | "fluid" | undefined {
  return filter === "item" || filter === "fluid" ? filter : undefined;
}

function resourceFilterSource(filter: ResourceFilterMode): "plants" | "bees" | undefined {
  return filter === "plants" || filter === "bees" ? filter : undefined;
}

/**
 * What a cell with no room for words says when you hover it.
 *
 * The same two lines a list row prints - the name, then where it came from and
 * how many recipes touch it - followed by whatever the dataset itself has to say
 * about the thing. First line white, the rest blue, like every other tooltip in
 * the app.
 */
function resourceTooltipLines(resource: IndexedResource): string[] {
  const subtitle = [
    getResourceModLabel(resource),
    resource.recipeCount > 0 ? `${resource.recipeCount} recipes` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = resourceLabel(resource);
  return [
    name,
    subtitle,
    ...(resource.tooltip ?? []).filter((line) => line.trim() && line !== name),
  ].filter(Boolean);
}

/** Mod is the id prefix ("gregtech:..."); bare fluid ids group as "fluids". */
function getResourceModLabel(resource: { id: string; kind: string }): string {
  if (resource.id === POWER_EU_CLAUSE_ID) {
    return "generators";
  }
  const colon = resource.id.indexOf(":");
  if (colon > 0) {
    return resource.id.slice(0, colon);
  }
  return resource.kind === "fluid" ? "fluids" : "other";
}

/**
 * The item search's power row: typing "power", "energy" or "eu" puts
 * Power (EU) first in the list. Left click asks who makes it (every
 * generator), right click who takes it (the parasitic machines) - the same
 * two questions every item row answers.
 */
function powerSearchRow(query: string): IndexedResource | undefined {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) {
    return undefined;
  }
  if (!("power".startsWith(trimmed) || "energy".startsWith(trimmed) || trimmed === "eu")) {
    return undefined;
  }
  return {
    kind: "fluid",
    id: POWER_EU_CLAUSE_ID,
    displayName: "Power (EU)",
    recipeCount: 0,
    dominantColor: "#d99a2b",
  } as IndexedResource;
}

const RESOURCE_QUERY_CACHE_TTL_MS = 90_000;
export const RESOURCE_SEARCH_DEBOUNCE_MS = 125;

function useResourcePageSize(
  containerRef: RefObject<HTMLDivElement | null>,
  onPageSizeChange: (pageSize: number) => void,
) {
  const [pageSize, setPageSize] = useState(RESOURCE_DEFAULT_PAGE_SIZE);
  const [gridColumns, setGridColumns] = useState(2);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePageSize = () => {
      const availableHeight = Math.max(RESOURCE_TILE_HEIGHT, container.clientHeight);
      const listHeight = Math.max(RESOURCE_TILE_HEIGHT, availableHeight - RESOURCE_PAGER_HEIGHT);
      const width = Math.max(RESOURCE_TILE_MIN_WIDTH, container.clientWidth);
      const nextColumns = Math.max(
        1,
        Math.floor(
          (width + RESOURCE_TILE_GAP) / (RESOURCE_TILE_MIN_WIDTH + RESOURCE_TILE_GAP),
        ),
      );
      const rows = Math.max(
        1,
        Math.floor((listHeight + RESOURCE_TILE_GAP) / (RESOURCE_TILE_HEIGHT + RESOURCE_TILE_GAP)),
      );
      const nextPageSize = nextColumns * rows;

      setPageSize((current) => (current === nextPageSize ? current : nextPageSize));
      setGridColumns((current) => (current === nextColumns ? current : nextColumns));
      onPageSizeChange(nextPageSize);
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, onPageSizeChange]);

  return { pageSize, gridColumns };
}

export interface IndexedResource extends Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
> {
  recipeCount: number;
}

/** What the search had to do to answer, for the line under the box. */
interface SearchOutcome {
  phase: SearchPhase;
  corrections: SearchCorrection[];
}

const EXACT_SEARCH: SearchOutcome = { phase: "exact", corrections: [] };

function searchOutcomeOf(result: {
  searchPhase?: SearchPhase;
  corrections?: SearchCorrection[];
}): SearchOutcome {
  return result.searchPhase && result.searchPhase !== "exact"
    ? { phase: result.searchPhase, corrections: result.corrections ?? [] }
    : EXACT_SEARCH;
}

/**
 * Every item and fluid the board already touches.
 *
 * Read off the project rather than the dataset, because that is where the answer
 * is: a card's inputs and outputs (with whatever alternative was picked for a
 * slot) plus every drawer and tank. One entry per resource, however many cards
 * use it.
 */
function useBoardResources(enabled: boolean): IndexedResource[] {
  const nodes = useFactoryStore((state) => state.project.nodes);
  const recipes = useFactoryStore((state) => state.project.recipes);
  const storages = useFactoryStore((state) => state.project.storages);

  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const byKey = new Map<string, IndexedResource>();
    // Unlike the dataset list, an entry with no icon is kept: it is genuinely on
    // the board, and its name is what identifies it. Only the demo plan and
    // hand-imported plans hit this.
    const add = (resource: Omit<IndexedResource, "recipeCount">) => {
      if (!resource.id) {
        return;
      }
      const key = `${resource.kind}:${resource.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, { ...resource, recipeCount: 0 });
      }
    };

    const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe] as const));
    for (const node of nodes) {
      const recipe = recipesById.get(node.recipeId);
      if (!recipe) {
        continue;
      }
      const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
      for (const resource of [...effectiveRecipe.inputs, ...effectiveRecipe.outputs]) {
        add(resource);
      }
    }
    for (const storage of storages ?? []) {
      add({
        kind: storage.kind,
        id: storage.resourceId,
        displayName: storage.displayName,
        iconPath: storage.iconPath,
        iconAtlas: storage.iconAtlas,
        dominantColor: storage.dominantColor,
      });
    }

    return [...byKey.values()];
  }, [enabled, nodes, recipes, storages]);
}

/**
 * The same search, run over the board's own resources.
 *
 * It is the identical matcher the server uses, so typing "steal" finds the steel
 * on your board exactly as it finds the steel in the dataset - a filter that
 * behaved differently from the list it replaces would just read as broken.
 */
function useBoardResourceResults(
  enabled: boolean,
  request: {
    query: string;
    mod: string;
    sort: ResourceSortMode;
    offset: number;
    limit: number;
  },
) {
  const resources = useBoardResources(enabled);

  return useMemo(() => {
    if (!enabled) {
      return { resources: [], total: 0, mods: [], outcome: EXACT_SEARCH };
    }

    const fields = resources.map((resource) => ({
      nameText: (resource.displayName ?? resource.id).toLowerCase(),
      name: splitSearchTokens(resource.displayName ?? ""),
      id: splitSearchTokens(resource.id),
    }));
    const vocabulary = buildSearchVocabulary(
      resources.map((resource) => resource.displayName ?? ""),
    );
    const modCounts = new Map<string, number>();

    const resolved = resolveSearchPhases(
      parseSearchQuery(request.query),
      vocabulary,
      (query, options) => {
        modCounts.clear();
        const matches: Array<{ resource: IndexedResource; score: number }> = [];
        resources.forEach((resource, index) => {
          const score = matchSearchEntry(query, fields[index], options);
          if (score === undefined) {
            return;
          }
          const modId = getResourceModLabel(resource);
          modCounts.set(modId, (modCounts.get(modId) ?? 0) + 1);
          if (request.mod && modId !== request.mod) {
            return;
          }
          matches.push({ resource, score });
        });
        return matches;
      },
    );

    const nameOf = (match: { resource: IndexedResource }) =>
      (match.resource.displayName ?? match.resource.id).toLowerCase();
    const sorted = [...resolved.results].sort((left, right) => {
      if (request.sort === "name") {
        return nameOf(left).localeCompare(nameOf(right));
      }
      if (request.sort === "mod") {
        return (
          getResourceModLabel(left.resource).localeCompare(getResourceModLabel(right.resource)) ||
          nameOf(left).localeCompare(nameOf(right))
        );
      }
      // "Most recipes" has nothing to sort by here (a board resource carries no
      // recipe count), so it falls back to the same order as best match.
      return right.score - left.score || nameOf(left).localeCompare(nameOf(right));
    });

    return {
      resources: sorted
        .slice(request.offset, request.offset + request.limit)
        .map((match) => match.resource),
      total: sorted.length,
      mods: [...modCounts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id)),
      outcome:
        resolved.phase === "exact"
          ? EXACT_SEARCH
          : { phase: resolved.phase, corrections: resolved.query.corrections },
    };
  }, [
    enabled,
    request.limit,
    request.mod,
    request.offset,
    request.query,
    request.sort,
    resources,
  ]);
}


interface ResourceQueryCacheEntry {
  result: RecipeDatasetResourceQueryResult;
  expiresAt: number;
}


/**
 * The last things looked up, three rows of them under the results.
 *
 * A build keeps coming back to the same dozen items, and this is the shelf they
 * sit on: click for recipes, right click for uses, exactly like a result row.
 * The list itself is the store's browse history, which every panel on the board
 * already writes to - so an item opened from a card's slot lands here too.
 */
// One small row everywhere (Jack, 2026-08-31): the shelf is a shortcut, and
// every pixel it holds is a pixel the results above it lose.
const RECENT_STRIP_ROWS = 1;
const RECENT_STRIP_ROWS_COMPACT = 1;
const RECENT_STRIP_CELL = 36;
/** More than one row of the widest column could ever show. */
const RECENT_STRIP_LIMIT = 24;

function RecentResourceStrip({
  onBrowse,
}: {
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const history = useFactoryStore((state) => state.recipeResourceHistory);
  const clearResourceHistory = useFactoryStore((state) => state.clearResourceHistory);
  const activeResource = useFactoryStore((state) => state.recipeBrowserResource);
  const isCompact = useIsCompactViewport();
  const rows = isCompact ? RECENT_STRIP_ROWS_COMPACT : RECENT_STRIP_ROWS;
  const cell = RECENT_STRIP_CELL;
  const recent = history.slice(0, RECENT_STRIP_LIMIT);
  const rowBrowse = useResourceBrowseMenu(onBrowse);

  if (recent.length === 0) {
    return null;
  }

  return (
    // A card of its own, like the controls at the top of the column: bare, a shelf
    // of loose icons at the foot of a list of icons read as more of the list. The
    // bottom margin keeps it off the very edge of the window.
    <div className="mx-2 mb-1.5 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-1">
      <div className="mb-0.5 flex items-center justify-between px-0.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
          Recent
        </span>
        <button
          type="button"
          onClick={clearResourceHistory}
          title="Clear recent items"
          className="text-[9px] font-medium text-neutral-600 hover:text-neutral-200"
        >
          Clear
        </button>
      </div>
      {/* auto-fill picks the column count from the width, and the height stops
          it at one row: a shelf, not a second list. */}
      <div
        className="grid gap-1 overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))`,
          maxHeight: rows * cell + (rows - 1) * RESOURCE_GRID_GAP,
        }}
        aria-label="Recently viewed"
        role="listbox"
      >
        {recent.map((resource) => {
          const active =
            activeResource?.kind === resource.kind && activeResource.id === resource.id;
          const indexed: IndexedResource = { ...resource, recipeCount: 0 };
          return (
            <MinecraftTooltip
              key={`${resource.kind}:${resource.id}`}
              label={[
                ...resourceTooltipLines(indexed),
                "Click for recipes, right click for uses",
              ]}
            >
              <button
                type="button"
                onClick={(event) => {
                  if (rowBrowse.claimedByMenu(event) || rowBrowse.openOnTap(event)) {
                    return;
                  }
                  onBrowse(indexed, "recipes");
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (rowBrowse.claimedByMenu(event)) {
                    return;
                  }
                  onBrowse(indexed, "uses");
                }}
                {...rowBrowse.pressProps(indexed)}
                aria-label={resourceLabel(resource)}
                className={[
                  "minecraft-pixel-art flex aspect-square items-center justify-center overflow-hidden rounded-[4px] border",
                  active
                    ? "border-cyan-400 bg-cyan-500/10"
                    : "border-transparent hover:border-neutral-500 hover:bg-white/5",
                ].join(" ")}
                role="option"
                aria-selected={active}
              >
                <ResourceIcon

                  itemZoom={1.4}
                  resource={{ ...resource, amount: 1 }}
                  size="md"
                  bare
                  showAmount={false}
                  tooltip={false}
                  className={RESOURCE_GRID_ART}
                />
              </button>
            </MinecraftTooltip>
          );
        })}
      </div>
      {rowBrowse.menu}
    </div>
  );
}

function VirtualResourceResultList({
  resources,
  total,
  currentPage,
  isLoading,
  error,
  emptyLabel,
  activeResource,
  onPageChange,
  onPageSizeChange,
  onBrowse,
}: {
  resources: IndexedResource[];
  total: number;
  currentPage: number;
  isLoading: boolean;
  error?: string;
  /** What "nothing here" means under the current filter. */
  emptyLabel?: string;
  activeResource?: IndexedResource;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { pageSize, gridColumns } = useResourcePageSize(containerRef, onPageSizeChange);
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
        <ResourceResultSkeleton pageSize={pageSize} gridColumns={gridColumns} />
      ) : resources.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
          {emptyLabel ?? "No matching resource."}
        </div>
      ) : (
        <ResourceResultPage
          resources={resources}
          activeResource={activeResource}
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
  pageSize,
  gridColumns,
}: {
  pageSize: number;
  gridColumns: number;
}) {
  const count = Math.max(3, Math.min(pageSize, 60));
  return (
    <div
      className="grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
      aria-label="Loading resources"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex shrink-0 flex-col items-center gap-1 pt-1"
          style={{ height: RESOURCE_TILE_HEIGHT }}
        >
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-[4px] bg-neutral-800/70" />
          <div
            className="h-2.5 animate-pulse rounded bg-neutral-800/70"
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
    <div className="mt-1 flex h-6 w-full min-w-0 shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0}
        className="flex h-6 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Previous resource page"
        title="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-[11px] text-neutral-400">
        Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1}
        className="flex h-6 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Next resource page"
        title="Next page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A finger's way to choose between the two questions a resource answers.
 *
 * A mouse has a left button for "what makes it" and a right one for "what uses
 * it". A finger has one tap, and here it opens the pair as a menu rather than
 * guessing: unlike a port on the board, a row in this list has no third gesture to
 * protect — no wire to drag out of it — so there is nothing to lose by asking, and
 * "uses" was otherwise unreachable on a phone. Holding opens the same menu, which
 * is the gesture the board taught.
 *
 * One menu for the whole list rather than one per row: which resource is being
 * pressed is captured when the press starts, so this costs a ref and not a hook
 * per item in a list that can run to hundreds.
 */
function useResourceBrowseMenu(
  browse: (resource: IndexedResource, mode: "recipes" | "uses") => void,
) {
  const canDrag = useFactoryStore((state) => state.project.poolMode && !state.isReadOnly);
  const pressedRef = useRef<IndexedResource | undefined>(undefined);
  const [pressedName, setPressedName] = useState("");
  const menu = useBrowseMenu({
    name: pressedName,
    onPick: (mode) => {
      const resource = pressedRef.current;
      if (resource) {
        browse(resource, mode);
      }
    },
  });

  return {
    menu: menu.menu,
    /** Spread on the row, after its own click and context-menu handlers. */
    pressProps: (resource: IndexedResource) => ({
      draggable: canDrag && resource.kind !== "aspect",
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (!canDrag || resource.kind === "aspect") { event.preventDefault(); return; }
        writeResourceDrag(event.dataTransfer, { ...resource, amount: 1 });
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        pressedRef.current = resource;
        if (event.pointerType !== "mouse") {
          setPressedName(resourceLabel(resource));
        }
        menu.pressHandlers.onPointerDown(event);
      },
      onPointerMove: menu.pressHandlers.onPointerMove,
      onPointerUp: menu.pressHandlers.onPointerUp,
      onPointerCancel: menu.pressHandlers.onPointerCancel,
    }),
    /**
     * Whether the row's own click should stand down: the menu is open, or has just
     * closed and this click is the trailing half of the tap that chose from it.
     */
    claimedByMenu: (event: { target: EventTarget | null }) =>
      isFromBrowseMenu(event) || menu.isPressing || menu.isSettling(),
    /**
     * A tap from a finger opens the menu. `isEchoOfTouch` as well as the row's own
     * pointerdown, because the click a tap synthesises claims to be a mouse.
     */
    openOnTap: (event: React.MouseEvent<HTMLElement>) => {
      if (!menu.wasTouch() && !isEchoOfTouch()) {
        return false;
      }
      return menu.openFromTap({ x: event.clientX, y: event.clientY });
    },
  };
}

function ResourceResultPage({
  resources,
  activeResource,
  gridColumns,
  isRefreshing,
  onBrowseResource,
}: {
  resources: IndexedResource[];
  activeResource?: IndexedResource;
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
  const rowBrowse = useResourceBrowseMenu(browse);

  return (
    <div
      className={[
        "grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden",
        isRefreshing ? "opacity-60" : "",
      ].join(" ")}
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
      aria-label="Resource results"
      role="listbox"
    >
      {resources.map((resource) => {
        const active = activeResource?.kind === resource.kind && activeResource.id === resource.id;

        return (
          // No hover tooltip: the tile already says what it is, and a tooltip
          // over every cell of a dense grid is a flicker, not a help.
          <button
              key={`${resource.kind}:${resource.id}`}
              type="button"
              onClick={(event) => {
                if (rowBrowse.claimedByMenu(event) || rowBrowse.openOnTap(event)) {
                  return;
                }
                browse(resource, "recipes");
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (rowBrowse.claimedByMenu(event)) {
                  return;
                }
                browse(resource, "uses");
              }}
              {...rowBrowse.pressProps(resource)}
              aria-label={resourceLabel(resource)}
              className={[
                "flex min-w-0 flex-col items-center overflow-hidden rounded-[4px] border px-0.5",
                // The power tile's own whisper of amber; selection still wins.
                !active && resource.id === POWER_EU_CLAUSE_ID ? "bg-amber-400/[0.07]" : "",
                active
                  ? "border-cyan-400 bg-cyan-500/10"
                  : "border-transparent hover:border-neutral-600 hover:bg-white/5",
              ].join(" ")}
              style={{ height: RESOURCE_TILE_HEIGHT }}
              role="option"
              aria-selected={active}
            >
              <span className="minecraft-pixel-art flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden">
                {resource.id === POWER_EU_CLAUSE_ID ? (
                  <span className="flex h-full w-full items-center justify-center bg-amber-400/10">
                    <Zap className="h-5 w-5 fill-current text-amber-400" aria-hidden />
                  </span>
                ) : (
                  <ResourceIcon

                    itemZoom={1.5}
                    resource={{ ...resource, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    // Items use the shared fit; fluids match their visual size.
                    iconPixelSize={
                      resource.kind === "fluid"
                        ? isSwatchFluid(resource)
                          ? 56
                          : spriteArtPixels(40)
                        : undefined
                    }
                    className="!h-11 !w-11"
                  />
                )}
              </span>
              <span className="line-clamp-2 w-full break-words text-center text-[9px] leading-[10px] text-neutral-400">
                {resource.id === POWER_EU_CLAUSE_ID ? "Power (EU/t)" : resourceLabel(resource)}
              </span>
          </button>
        );
      })}
      {rowBrowse.menu}
    </div>
  );
}


export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function deferStateUpdate(callback: () => void) {
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


export function getDatasetVersionCacheKey(version: {
  id: string;
  checksumSha256?: string;
  publishedAt: string;
}) {
  return [version.id, version.checksumSha256 ?? version.publishedAt].join("@");
}


function getResourceQueryCacheKey({
  versionId,
  query,
  offset,
  limit,
  filter,
  mod,
  sort,
}: {
  versionId: string;
  query: string;
  offset: number;
  limit: number;
  filter: ResourceFilterMode;
  mod: string;
  sort: ResourceSortMode;
}) {
  return [versionId, query.trim().toLowerCase(), offset, limit, filter, mod, sort].join("|");
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


