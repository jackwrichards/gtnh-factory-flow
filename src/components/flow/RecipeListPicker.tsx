"use client";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { focusDropdownFilter } from "@/lib/dropdown-focus";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import { LoaderCircle } from "lucide-react";
import type { DatasetVersion, RecipeSummary } from "@/lib/datasets/types";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets/remote";
import { getRecipeDatasetRecipe } from "@/lib/datasets/browser-loader";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useFactoryStore } from "@/store/factory-store";

// One list fetch per kind and dataset version, shared by every picker.
const cachedLists = new Map<string, { versionId: string; recipes: RecipeSummary[] }>();

/** "Crop Farm: Wheat" -> "Wheat": the part after the map's name. */
export function recipeChoiceName(recipeName: string): string {
  const separator = recipeName.indexOf(": ");
  return separator >= 0 ? recipeName.slice(separator + 2) : recipeName;
}

/** Below this much room above the card the list goes under the bar instead. */
const MENU_MIN_HEIGHT = 220;

export interface RecipeListPickerProps {
  /** Names the cached list ("crops", "mobs"). */
  cacheKey: string;
  load: (manifestUrl: string, version: DatasetVersion) => Promise<RecipeSummary[]>;
  /** The plural the search box and messages use: "crops", "mobs". */
  noun: string;
  /** The opener's own selector: a press on it is "inside", so it can toggle. */
  toggleSelector: string;
  onPick: (recipe: Recipe) => void;
  onClose: () => void;
  /** The recipe the card runs now, ringed in the list. */
  currentRecipeId?: string;
  sort?: (left: RecipeSummary, right: RecipeSummary) => number;
  /** A heading a run of the sorted list opens under ("Tier 3"). */
  sectionOf?: (recipe: RecipeSummary) => string | undefined;
  tileResource: (recipe: RecipeSummary) => ResourceAmount | undefined;
  hover: (recipe: RecipeSummary) => ReactNode;
  dimmed?: (recipe: RecipeSummary) => boolean;
}

/**
 * A card's own searchable list of the recipes it can switch between: a crop
 * farm's crops, an Extreme Entity Crusher's mobs. Search matches the name and
 * every output; a pick fetches the whole recipe and hands it to `onPick`.
 */
export function RecipeListPicker({
  cacheKey,
  load,
  noun,
  toggleSelector,
  onPick,
  onClose,
  currentRecipeId,
  sort,
  sectionOf,
  tileResource,
  hover,
  dimmed,
}: RecipeListPickerProps) {
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const version: DatasetVersion | undefined = datasetManifest?.versions.find(
    (entry) => entry.id === selectedDatasetVersionId,
  );
  const manifestUrl = datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;

  const [recipes, setRecipes] = useState<RecipeSummary[]>(() => {
    const cached = cachedLists.get(cacheKey);
    return cached && cached.versionId === selectedDatasetVersionId ? cached.recipes : [];
  });
  const [search, setSearch] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const cached = cachedLists.get(cacheKey);
    if (!version || (cached?.versionId === version.id && cached.recipes.length > 0)) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    load(manifestUrl, version)
      .then((result) => {
        cachedLists.set(cacheKey, { versionId: version.id, recipes: result });
        if (!cancelled) {
          setRecipes(result);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : `Could not load ${noun}.`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render; the list is keyed by kind and version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, manifestUrl, version, noun]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? recipes.filter((recipe) =>
          [recipeChoiceName(recipe.name), ...recipe.outputs.map((output) => output.displayName ?? output.id)]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : recipes;
    return sort ? [...matches].sort(sort) : matches;
  }, [recipes, search, sort]);

  // The one dropdown rule (use-dropdown-dismiss.ts). The opener manages its
  // own toggle, so a press on it is "inside": closing here too would make
  // its click immediately reopen the panel.
  const rootRef = useRef<HTMLDivElement>(null);
  useDropdownDismiss(true, {
    refs: [rootRef],
    onClose,
    insideSelector: toggleSelector,
    fade: true,
    fadeKeep: () => anchorRef.current?.closest("[data-node-glance-root]"),
  });

  // The menu PORTALS to the body: inside the card it lived in the node
  // layer's stacking context, under the marching-dash canvas and every
  // higher card. Measured once from the opener on open; a board pan
  // closes it anyway through the click-away.
  // As wide as the card's window and ABOVE it when there is room, the way
  // the machine menu sits: over the canvas, not over the card's own knobs.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchorAt, setAnchorAt] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight?: number }>();
  useEffect(() => {
    const parent = anchorRef.current?.parentElement;
    const card = anchorRef.current?.closest("[data-node-glance-root]");
    if (parent) {
      // Real px throughout; the menu box wears ui-zoom, so every number is
      // divided by the scale where the style reads it.
      const scale = getUiScale();
      const shell = (px: number) => px / scale;
      const rect = parent.getBoundingClientRect();
      const cardRect = card?.getBoundingClientRect() ?? rect;
      const width = Math.max(360 * scale, Math.round(cardRect.width));
      const left = Math.max(8, Math.min(Math.round(cardRect.left), window.innerWidth - width - 8));
      // UP, always, unless the card is jammed against the top of the window:
      // the list takes whatever room there is above and scrolls inside it.
      const roomAbove = Math.round(cardRect.top) - 12;
      setAnchorAt(
        roomAbove >= MENU_MIN_HEIGHT * scale
          ? { left: shell(left), width: shell(width), bottom: shell(window.innerHeight - Math.round(cardRect.top) + 4), maxHeight: shell(roomAbove) }
          : { left: shell(left), width: shell(width), top: shell(Math.min(rect.bottom + 2, window.innerHeight - 120)) },
      );
    }
  }, []);

  const handlePick = async (summary: RecipeSummary) => {
    if (!version) {
      return;
    }
    try {
      const recipe = await getRecipeDatasetRecipe(manifestUrl, version, summary.id);
      onPick(recipe);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the pick.");
    }
  };

  const menu = anchorAt ? (
    <div
      ref={rootRef}
      style={{ position: "fixed", left: anchorAt.left, top: anchorAt.top, bottom: anchorAt.bottom, width: anchorAt.width, maxHeight: anchorAt.maxHeight }}
      // "nowheel" stops React Flow from zooming the canvas when scrolling the
      // list: its native wheel handler runs before React's synthetic one, so
      // stopPropagation alone is not enough.
      className="ui-zoom nodrag nowheel z-[300] flex flex-col border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1.5 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <input
        ref={focusDropdownFilter}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder={`Search ${noun} or drops...`}
        className="mb-1 h-7 w-full border border-[var(--mc-33)] bg-[var(--mc-85)] px-2 text-[12px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)]"
        aria-label={`Search ${noun}`}
      />
      {isLoading ? (
        <div className="flex items-center gap-2 px-2 py-3 text-[12px] font-bold text-[var(--mc-ink)]">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading {noun}...
        </div>
      ) : error ? (
        <div className="px-2 py-3 text-[12px] font-bold text-[var(--mc-bad)]">{error}</div>
      ) : (
        <div className="grid min-h-0 max-h-[420px] grid-cols-5 overflow-y-auto">
          {filtered.map((recipe, index) => {
            const section = sectionOf?.(recipe);
            const previous = index > 0 ? filtered[index - 1] : undefined;
            const opensSection = section !== undefined && (!previous || sectionOf?.(previous) !== section);
            const face = tileResource(recipe);
            const current = recipe.id === currentRecipeId;
            return (
              <Fragment key={recipe.id}>
                {opensSection ? (
                  <div className="col-span-5 flex items-center gap-1.5 px-0.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-[var(--mc-ink-muted)]">
                    <span className="shrink-0">{section}</span>
                    <span className="h-px min-w-0 flex-1 bg-[var(--mc-56)]" />
                  </div>
                ) : null}
                <MinecraftTooltip content={() => hover(recipe)}>
                <button
                  type="button"
                  onClick={() => void handlePick(recipe)}
                  aria-current={current || undefined}
                  // The left item shelf's language: a bare icon over its
                  // name, no box of its own, a quiet hover wash.
                  className={[
                    "flex flex-col items-center gap-0.5 p-0.5 pb-1 text-[var(--mc-ink)] hover:bg-[var(--mc-85)]",
                    current ? "bg-[var(--mc-85)] outline outline-1 -outline-offset-1 outline-[var(--selection)]" : "",
                    dimmed?.(recipe) ? "opacity-35 saturate-50" : "",
                  ].join(" ")}
                >
                  <span className="grid h-12 w-12 place-items-center overflow-hidden">
                    {face ? (
                      <ResourceIcon

                        itemZoom={1.4}
                        // Chance badges are spelled out in the hover instead.
                        resource={{ ...face, chance: undefined }}
                        bare
                        tooltip={false}
                        showAmount={false}
                        showConsumedState={false}
                        size="md"
                      />
                    ) : null}
                  </span>
                  <span className="w-full overflow-hidden text-center text-[8px] font-bold leading-[9px]">
                    {recipeChoiceName(recipe.name)}
                  </span>
                </button>
                </MinecraftTooltip>
              </Fragment>
            );
          })}
          {filtered.length === 0 ? (
            <div className="col-span-5 px-2 py-3 text-[12px] font-bold text-[var(--mc-ink-muted)]">
              No {noun} match.
            </div>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <span ref={anchorRef} className="hidden" />
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
