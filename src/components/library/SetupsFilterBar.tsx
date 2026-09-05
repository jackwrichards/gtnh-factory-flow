"use client";

import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useIsCompactViewport } from "@/lib/compact-view";
import { ItemPickerPopover } from "@/components/ItemPickerPopover";
import { parseEuT } from "@/lib/community/eu-shorthand";
import { parsePlanSearch, withTag } from "@/lib/community/search-query";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { queryRecipeDatasetResources } from "@/lib/datasets/browser-loader";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { EntryIcon } from "@/lib/model/types";
import { playBoardSound } from "@/lib/board-sounds";
import { useFactoryStore } from "@/store/factory-store";
import { Face } from "./LibraryTile";

/**
 * THE ONE FILTER BAR over every grid in the library: your designs and the
 * public setups share it exactly, so a filter learned on one works on the
 * other. Two rows: what you are looking for (search with #tag completion,
 * the EU/t ceiling, tier, sort, and My posts on the public page), then
 * what it must be (ITEM FILTER: what it makes and takes, as chips).
 *
 * The state lives in `useSetupFilters` so a page can read the same fields
 * the bar edits and apply them however it lists things: the public grid
 * sends them to the server, the design grid filters in memory.
 */

export interface SetupFilters {
  query: string;
  setQuery: (next: string | ((current: string) => string)) => void;
  sort: string;
  setSort: (next: string) => void;
  /** Highest tier allowed, as an index into GT_VOLTAGE_TIERS; "" is any. */
  maxTier: string;
  setMaxTier: (next: string) => void;
  /** The EU/t ceiling as typed, as read, and as settled for a fetch. */
  maxEuText: string;
  setMaxEuText: (next: string) => void;
  maxEuT: number | undefined;
  debouncedMaxEuT: number | undefined;
  /** What a setup must make and take: every one of these, on that side. */
  makes: EntryIcon[];
  takes: EntryIcon[];
  setMakes: (next: (list: EntryIcon[]) => EntryIcon[]) => void;
  setTakes: (next: (list: EntryIcon[]) => EntryIcon[]) => void;
  /** "kind:resourceId" keys of the two lists, for a fetch key or a match. */
  makesKeys: string[];
  takesKeys: string[];
}

export function resourceKey(resource: { kind: string; resourceId: string }): string {
  return `${resource.kind}:${resource.resourceId}`;
}

export function useSetupFilters(defaultSort: string): SetupFilters {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [maxTier, setMaxTier] = useState("");
  const [maxEuText, setMaxEuText] = useState("");
  const maxEuT = maxEuText.trim() ? parseEuT(maxEuText) : undefined;
  const debouncedMaxEuT = useDebouncedValue(maxEuT, 350);
  const [makes, setMakes] = useState<EntryIcon[]>([]);
  const [takes, setTakes] = useState<EntryIcon[]>([]);
  const makesKeys = useMemo(() => makes.map(resourceKey), [makes]);
  const takesKeys = useMemo(() => takes.map(resourceKey), [takes]);
  return {
    query,
    setQuery,
    sort,
    setSort,
    maxTier,
    setMaxTier,
    maxEuText,
    setMaxEuText,
    maxEuT,
    debouncedMaxEuT,
    makes,
    takes,
    setMakes,
    setTakes,
    makesKeys,
    takesKeys,
  };
}

const INSET =
  "border-2 border-[var(--mc-33)] bg-[#17191d] text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]";

export function SetupsFilterBar({
  filters,
  placeholder,
  sortOptions,
  knownTags,
  myPosts,
  itemFilter = true,
}: {
  filters: SetupFilters;
  placeholder: string;
  sortOptions: Array<{ value: string; label: string }>;
  /** Every tag the page knows, for #tag completion. */
  knownTags: Iterable<string>;
  /** The public page's switch; absent elsewhere. */
  myPosts?: { checked: boolean; onChange: (checked: boolean) => void };
  itemFilter?: boolean;
}) {
  const {
    query,
    setQuery,
    sort,
    setSort,
    maxTier,
    setMaxTier,
    maxEuText,
    setMaxEuText,
    maxEuT,
    makes,
    takes,
    setMakes,
    setTakes,
  } = filters;
  const [picking, setPicking] = useState<"makes" | "takes">();
  const [searchFocused, setSearchFocused] = useState(false);
  // On a phone everything but the search folds behind one key, which
  // wears a count of the filters in force so a narrowed list is never a
  // mystery.
  const isCompact = useIsCompactViewport();
  const [unfolded, setUnfolded] = useState(false);
  const showFilters = !isCompact || unfolded;
  const inForce =
    (myPosts?.checked ? 1 : 0) +
    (maxEuT !== undefined ? 1 : 0) +
    (maxTier ? 1 : 0) +
    makes.length +
    takes.length;

  // #tag completion: the word being typed, against the tags known, minus
  // the ones already in the search. A two-word tag travels as one word.
  const typedTag = /(?:^|\s)#([^\s#]*)$/.exec(query)?.[1];
  const chosenTags = parsePlanSearch(query).tags;
  const tagSuggestions =
    typedTag === undefined
      ? []
      : [...new Set(knownTags)]
          .filter(
            (tag) =>
              tag.startsWith(typedTag.toLowerCase().replace(/_/g, " ")) &&
              !chosenTags.includes(tag),
          )
          .sort()
          .slice(0, 12);
  const completeTag = (tag: string) => {
    playBoardSound("shelfTick");
    setQuery((current) => withTag(current.replace(/#[^\s#]*$/, "").trim(), tag) + " ");
  };

  // The item picker searches the dataset the board is on, as the recipe
  // search does.
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );
  const searchPickerResources = useCallback(
    async (pickerQuery: string, signal: AbortSignal) => {
      if (!selectedDatasetVersion) {
        return [];
      }
      const result = await queryRecipeDatasetResources(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        { query: pickerQuery, offset: 0, limit: 48 },
        { signal },
      );
      return result.resources;
    },
    [datasetManifestUrl, selectedDatasetVersion],
  );

  return (
    <header className="flex shrink-0 flex-col border-b border-[var(--mc-33)]">
      <div className="flex h-10 items-center gap-2 px-4 compact:h-auto compact:flex-wrap compact:gap-1.5 compact:px-2 compact:py-1.5">
        <div className="relative min-w-0 flex-1 compact:basis-full">
          <label className={`flex h-7 min-w-0 items-center gap-1.5 px-2 text-xs ${INSET}`}>
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--mc-ink-muted)]" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && tagSuggestions[0]) {
                  event.preventDefault();
                  completeTag(tagSuggestions[0]);
                } else if (event.key === "Escape") {
                  setSearchFocused(false);
                }
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--mc-ink-muted)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          {/* Typing #... offers the tags known; Enter or a click finishes the word. */}
          {searchFocused && tagSuggestions.length > 0 ? (
            <div className="absolute left-0 top-full z-20 mt-1 flex max-w-full flex-wrap gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-61)] p-1.5 shadow-[6px_6px_0_rgba(0,0,0,0.45)]">
              {tagSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => completeTag(tag)}
                  className="border-2 border-transparent bg-[var(--mc-47)] px-1.5 py-0.5 text-xs font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
                >
                  #{tag.replace(/\s+/g, "_")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {isCompact ? (
          <button
            type="button"
            onClick={() => {
              playBoardSound("shelfTick");
              setUnfolded((current) => !current);
            }}
            aria-expanded={unfolded}
            className={[
              `flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs ${INSET}`,
              unfolded || inForce > 0 ? "!text-cyan-200" : "",
            ].join(" ")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Filters
            {inForce > 0 ? <span className="tabular-nums">{inForce}</span> : null}
          </button>
        ) : null}
        {showFilters && myPosts ? (
          <label
            className={[
              `flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 px-2 text-xs ${INSET}`,
              myPosts.checked ? "!text-cyan-200" : "",
            ].join(" ")}
          >
            <input
              type="checkbox"
              checked={myPosts.checked}
              onChange={(event) => {
                playBoardSound("shelfTick");
                myPosts.onChange(event.target.checked);
              }}
              className="h-3 w-3 accent-cyan-400"
            />
            My posts
          </label>
        ) : null}
        {showFilters ? (
          <>
            {/* Unfolded on a phone, the boxes take a row of their own. */}
            <div className="hidden basis-full compact:block" />
            <label
              title="Leave out anything that draws more than this. Shorthand works: 512, 14.3k, 2M, 1.5G"
              className={[
                `flex h-7 w-[118px] shrink-0 items-center gap-1 px-2 text-xs compact:w-auto compact:min-w-0 compact:flex-1 ${INSET}`,
                maxEuText && maxEuT === undefined ? "!text-red-300" : "",
              ].join(" ")}
            >
              <span className="shrink-0 text-[var(--mc-ink-muted)]">EU/t ≤</span>
              <input
                value={maxEuText}
                onChange={(event) => setMaxEuText(event.target.value)}
                onBlur={() => playBoardSound("shelfTick")}
                placeholder="any"
                aria-label="Highest EU/t to show"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--mc-ink-muted)]"
              />
            </label>
            <select
              value={maxTier}
              onChange={(event) => {
                playBoardSound("shelfTick");
                setMaxTier(event.target.value);
              }}
              aria-label="Highest power tier"
              className={`h-7 shrink-0 px-1 text-xs outline-none compact:min-w-0 compact:flex-1 ${INSET}`}
            >
              <option value="">Any tier</option>
              {GT_VOLTAGE_TIERS.map((entry, index) => (
                <option key={entry.tier} value={String(index)}>
                  Up to {entry.tier}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(event) => {
                playBoardSound("shelfTick");
                setSort(event.target.value);
              }}
              aria-label="Sort"
              className={`h-7 shrink-0 px-1 text-xs outline-none compact:min-w-0 compact:flex-1 ${INSET}`}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      {itemFilter && showFilters ? (
        <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-[var(--mc-33)]/60 bg-[#0c0e11] px-4 py-1 compact:gap-1.5 compact:px-2">
          <span className="mr-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mc-ink-muted)]">
            Item filter
          </span>
          {(["makes", "takes"] as const).map((side) => (
            <div key={side} className="relative flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setPicking(picking === side ? undefined : side)}
                title={side === "makes" ? "Only what makes this" : "Only what takes this"}
                className="flex h-7 items-center gap-1 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-xs font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85)] hover:bg-[var(--mc-85)]"
              >
                <Plus className="h-3 w-3" aria-hidden />
                {side === "makes" ? "Makes" : "Takes"}
              </button>
              {picking === side ? (
                // The recipe search's own picker, opened downward from the key.
                <ItemPickerPopover
                  role={side}
                  placement="below"
                  searchPickerResources={searchPickerResources}
                  onPick={(entry) => {
                    playBoardSound("shelfTick");
                    const picked: EntryIcon = {
                      kind: entry.kind === "fluid" ? "fluid" : "item",
                      resourceId: entry.id,
                      displayName: entry.displayName,
                      iconPath: entry.iconPath,
                      iconAtlas: entry.iconAtlas,
                      dominantColor: entry.dominantColor,
                    };
                    (side === "makes" ? setMakes : setTakes)((list) =>
                      list.some((item) => item.resourceId === picked.resourceId)
                        ? list
                        : [...list, picked],
                    );
                    setPicking(undefined);
                  }}
                  onClose={() => setPicking(undefined)}
                />
              ) : null}
              {(side === "makes" ? makes : takes).map((resource) => (
                <span
                  key={resourceKey(resource)}
                  className={`flex h-7 items-center gap-1 pl-1 pr-1.5 text-xs ${INSET}`}
                >
                  <Face icon={resource} size={18} />
                  <span className="max-w-[120px] truncate">
                    {resource.displayName ?? resource.resourceId}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playBoardSound("shelfTick");
                      (side === "makes" ? setMakes : setTakes)((list) =>
                        list.filter((entry) => entry.resourceId !== resource.resourceId),
                      );
                    }}
                    aria-label={`Stop filtering by ${resource.displayName ?? resource.resourceId}`}
                    title="Remove"
                    className="text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </header>
  );
}
