"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Compass, Hammer, Loader2, Search, X } from "lucide-react";
import { placePayload } from "@/components/BlueprintPanel";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetReachability,
  queryRecipeDatasetResources,
} from "@/lib/datasets/browser-loader";
import type { DatasetResourceIndexEntry, DatasetVersion } from "@/lib/datasets/types";
import { GT_OVERCLOCK_TIERS, getVoltageTierIndex } from "@/lib/model";
import type { MachineTier, Recipe } from "@/lib/model/types";
import {
  ALL_REACHABILITY_SOURCES,
  type ReachabilityChainResult,
  type ReachabilityRootsConfig,
  type ReachabilitySource,
  type ReachabilitySummaryResult,
  type ReachableResourceSummary,
} from "@/lib/reachability/api-types";
import { buildChainPlacementPayload } from "@/lib/reachability/chain-payload";
import { useFactoryStore } from "@/store/factory-store";

/**
 * "What can I make?" - the wizard over the reachability engine.
 *
 * Step one declares the world: which of the board's fundamental sources
 * (veins, small ores, underground fluids, bees, crops) the player has, plus
 * anything they grant themselves by hand. Step two is the answer -
 * everything craftable from those roots. Step three reviews the chain before
 * it lands: every link can be swapped to another way of making the same
 * thing, and every machine can be dialled to a voltage tier, because there
 * are usually a dozen ways to make an item and the tidiest one is not
 * always the one the player wants built.
 */

const SOURCE_LABELS: Record<ReachabilitySource, { label: string; hint: string }> = {
  ores: { label: "Ore veins", hint: "Everything minable from veins" },
  smallOres: { label: "Small ores", hint: "The scattered singles" },
  undergroundFluids: { label: "Underground fluids", hint: "Oil and gas fields" },
  bees: { label: "Bees", hint: "Every bee's produce" },
  crops: { label: "Crops", hint: "Everything growable" },
};

const PAGE_SIZE = 48;

interface ReviewState {
  target: ReachableResourceSummary;
  chain: ReachabilityChainResult;
  recipesById: Map<string, Recipe>;
}

export function ReachabilityWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const version = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const [sources, setSources] = useState<Record<ReachabilitySource, boolean>>({
    ores: true,
    smallOres: true,
    undergroundFluids: true,
    bees: true,
    crops: true,
  });
  const [extraRoots, setExtraRoots] = useState<ReachableResourceSummary[]>([]);
  const [rootSearch, setRootSearch] = useState("");
  const [rootResults, setRootResults] = useState<DatasetResourceIndexEntry[]>([]);
  const [summary, setSummary] = useState<ReachabilitySummaryResult>();
  const [browseQuery, setBrowseQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<ReviewState>();
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [tierByRecipeId, setTierByRecipeId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"summary" | "chain" | "place" | undefined>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);

  const roots = useMemo<ReachabilityRootsConfig>(
    () => ({
      sources: ALL_REACHABILITY_SOURCES.filter((source) => sources[source]),
      extraResourceKeys: extraRoots.map((resource) => `${resource.kind}:${resource.id}`),
    }),
    [sources, extraRoots],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // The root picker's search, debounced against the resource API.
  useEffect(() => {
    if (!open || !version || !datasetManifestUrl || rootSearch.trim().length < 2) {
      setRootResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      queryRecipeDatasetResources(
        datasetManifestUrl,
        version,
        { query: rootSearch, offset: 0, limit: 8 },
        { signal: controller.signal },
      )
        .then((result) => setRootResults(result.resources))
        .catch(() => undefined);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, version, datasetManifestUrl, rootSearch]);

  const refreshSummary = useCallback(
    (nextOffset: number, query: string) => {
      if (!version || !datasetManifestUrl) {
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy("summary");
      setError(undefined);
      queryRecipeDatasetReachability(
        datasetManifestUrl,
        version,
        { action: "summary", roots, query, offset: nextOffset, limit: PAGE_SIZE },
        { signal: controller.signal },
      )
        .then((result) => {
          setSummary(result as ReachabilitySummaryResult);
          setOffset(nextOffset);
          setBusy(undefined);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : "The computation failed.");
            setBusy(undefined);
          }
        });
    },
    [version, datasetManifestUrl, roots],
  );

  // Recompute whenever the dialog is open and the roots change: the whole
  // point of the toggles is watching the answer move. A roots change also
  // invalidates any chain being reviewed.
  useEffect(() => {
    if (open) {
      setReview(undefined);
      setPreferences({});
      refreshSummary(0, browseQuery);
    }
    // browseQuery drives its own debounced effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roots, version]);

  useEffect(() => {
    if (!open || review) {
      return;
    }
    const timer = window.setTimeout(() => refreshSummary(0, browseQuery), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseQuery]);

  const fetchChain = useCallback(
    async (
      target: ReachableResourceSummary,
      preferredProducers: Record<string, string>,
    ): Promise<ReviewState | undefined> => {
      if (!version || !datasetManifestUrl) {
        return undefined;
      }
      const chain = (await queryRecipeDatasetReachability(datasetManifestUrl, version, {
        action: "chain",
        roots,
        target: { kind: target.kind, id: target.id },
        preferredProducers,
      })) as ReachabilityChainResult;
      if (!chain.reachable) {
        throw new Error("That target is not reachable from the chosen roots.");
      }
      const recipes = await Promise.all(
        chain.steps.map((step) =>
          getRecipeDatasetRecipe(datasetManifestUrl, version, step.recipeId),
        ),
      );
      return {
        target,
        chain,
        recipesById: new Map(chain.steps.map((step, index) => [step.recipeId, recipes[index]])),
      };
    },
    [version, datasetManifestUrl, roots],
  );

  const openReview = useCallback(
    async (target: ReachableResourceSummary) => {
      setBusy("chain");
      setError(undefined);
      setPreferences({});
      setTierByRecipeId({});
      try {
        setReview(await fetchChain(target, {}));
        setBusy(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Walking the chain failed.");
        setBusy(undefined);
      }
    },
    [fetchChain],
  );

  const swapProducer = useCallback(
    async (resourceKey: string, recipeId: string) => {
      if (!review) {
        return;
      }
      const nextPreferences = { ...preferences, [resourceKey]: recipeId };
      setBusy("chain");
      setError(undefined);
      try {
        // Tier picks keyed by recipe id survive the rewalk for steps that
        // remain; steps that fell out of the chain drop theirs with them.
        setReview(await fetchChain(review.target, nextPreferences));
        setPreferences(nextPreferences);
        setBusy(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Walking the chain failed.");
        setBusy(undefined);
      }
    },
    [review, preferences, fetchChain],
  );

  const place = useCallback(() => {
    if (!review) {
      return;
    }
    setBusy("place");
    try {
      const payload = buildChainPlacementPayload(
        review.chain.steps.map((step) => ({
          recipe: review.recipesById.get(step.recipeId) as Recipe,
          depth: step.depth,
          overclockTier: tierByRecipeId[step.recipeId],
        })),
        review.chain.rootResourceKeys,
      );
      placePayload(payload);
      setBusy(undefined);
      setReview(undefined);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Placing the chain failed.");
      setBusy(undefined);
    }
  }, [review, tierByRecipeId, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[110] grid place-items-center bg-neutral-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="What can I make?"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[6px] border border-neutral-600 bg-[#25272c] p-4 text-neutral-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-700 pb-3">
          <Compass className="h-5 w-5 text-cyan-400" />
          <span className="text-[15px] font-semibold">What can I make?</span>
          {summary && !review ? (
            <span className="ml-2 text-[13px] text-neutral-400">
              {summary.reachableCount.toLocaleString()} things reachable
            </span>
          ) : null}
          {review ? (
            <span className="ml-2 flex min-w-0 items-center gap-1.5 text-[13px] text-neutral-300">
              <Hammer className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span className="truncate">
                {review.target.displayName ?? review.target.id}: {review.chain.steps.length}{" "}
                step{review.chain.steps.length === 1 ? "" : "s"}
              </span>
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {review ? (
          <ChainReview
            review={review}
            busy={busy !== undefined}
            tierByRecipeId={tierByRecipeId}
            onPickTier={(recipeId, tier) =>
              setTierByRecipeId((current) => ({ ...current, [recipeId]: tier }))
            }
            onSwapProducer={swapProducer}
            error={error}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            {/* The roots: what the player's world offers. */}
            <div className="flex flex-wrap items-center gap-2">
              {ALL_REACHABILITY_SOURCES.map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() =>
                    setSources((current) => ({ ...current, [source]: !current[source] }))
                  }
                  title={SOURCE_LABELS[source].hint}
                  className={[
                    "rounded-[4px] border px-2 py-1 text-[12px]",
                    sources[source]
                      ? "border-cyan-500/60 bg-cyan-600/20 text-cyan-100"
                      : "border-neutral-600 bg-neutral-800 text-neutral-400",
                  ].join(" ")}
                >
                  {SOURCE_LABELS[source].label}
                </button>
              ))}
            </div>

            {/* Extra roots the player grants by hand. */}
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {extraRoots.map((resource) => (
                  <button
                    key={`${resource.kind}:${resource.id}`}
                    type="button"
                    onClick={() =>
                      setExtraRoots((current) =>
                        current.filter(
                          (entry) => entry.kind !== resource.kind || entry.id !== resource.id,
                        ),
                      )
                    }
                    title="Remove"
                    className="flex items-center gap-1 rounded-[4px] border border-amber-500/50 bg-amber-600/15 px-1.5 py-0.5 text-[12px] text-amber-100"
                  >
                    <ResourceIcon
                      resource={{ ...resource, amount: 1 } as never}
                      size="sm"
                      bare
                      showAmount={false}
                      tooltip={false}
                      className="!h-4 !w-4"
                    />
                    {resource.displayName ?? resource.id}
                    <X className="h-3 w-3 opacity-70" />
                  </button>
                ))}
                <div className="relative">
                  <input
                    value={rootSearch}
                    onChange={(event) => setRootSearch(event.target.value)}
                    placeholder="I also have..."
                    className="w-44 rounded-[4px] border border-neutral-600 bg-neutral-800 px-2 py-1 text-[12px] text-neutral-100 placeholder:text-neutral-500"
                  />
                  {rootResults.length > 0 ? (
                    <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-[4px] border border-neutral-600 bg-[#2b2d33] shadow-lg">
                      {rootResults.map((resource) => (
                        <button
                          key={`${resource.kind}:${resource.id}`}
                          type="button"
                          onClick={() => {
                            setExtraRoots((current) =>
                              current.some(
                                (entry) =>
                                  entry.kind === resource.kind && entry.id === resource.id,
                              )
                                ? current
                                : [...current, resource],
                            );
                            setRootSearch("");
                            setRootResults([]);
                          }}
                          className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-neutral-700"
                        >
                          <ResourceIcon
                            resource={{ ...resource, amount: 1 } as never}
                            size="sm"
                            bare
                            showAmount={false}
                            tooltip={false}
                            className="!h-5 !w-5"
                          />
                          <span className="truncate">{resource.displayName ?? resource.id}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* The answer. */}
            <div className="mt-4 flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-neutral-500" />
              <input
                value={browseQuery}
                onChange={(event) => setBrowseQuery(event.target.value)}
                placeholder="Search what you can make..."
                className="w-full rounded-[4px] border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-[13px] text-neutral-100 placeholder:text-neutral-500"
              />
              {busy === "summary" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
              ) : null}
            </div>

            {error ? <div className="mt-3 text-[13px] text-red-400">{error}</div> : null}

            <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {(summary?.resources ?? []).map((resource) => (
                <button
                  key={`${resource.kind}:${resource.id}`}
                  type="button"
                  disabled={busy === "chain"}
                  onClick={() => openReview(resource)}
                  title="Review this thing's production chain"
                  className="flex items-center gap-2 rounded-[4px] border border-transparent px-1.5 py-1 text-left text-[12px] text-neutral-200 hover:border-cyan-500/50 hover:bg-cyan-600/10 disabled:opacity-50"
                >
                  <ResourceIcon
                    resource={{ ...resource, amount: 1 } as never}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    className="!h-6 !w-6"
                  />
                  <span className="truncate">{resource.displayName ?? resource.id}</span>
                </button>
              ))}
            </div>

            {summary && summary.totalMatching === 0 && busy !== "summary" ? (
              <div className="mt-4 text-center text-[13px] text-neutral-500">
                Nothing reachable matches. Grant more roots, or widen the search.
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-neutral-700 pt-3 text-[12px] text-neutral-400">
          {review ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setReview(undefined);
                  setPreferences({});
                  setError(undefined);
                }}
                className="flex items-center gap-1 rounded border border-neutral-600 px-2 py-1 hover:bg-neutral-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <span className="min-w-0 truncate">
                Swap any link, set tiers, then place the whole chain prewired.
              </span>
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={place}
                className="ml-auto flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {busy !== undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Place on board
              </button>
            </>
          ) : (
            <>
              {busy === "chain" ? (
                <span className="flex items-center gap-2 text-cyan-300">
                  <Loader2 className="h-4 w-4 animate-spin" /> Walking the chain...
                </span>
              ) : (
                <span>
                  {summary
                    ? `${summary.totalMatching.toLocaleString()} match${summary.totalMatching === 1 ? "" : "es"}. Click one to review its chain.`
                    : "Pick your roots; the answer updates as you toggle."}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0 || busy !== undefined}
                  onClick={() => refreshSummary(Math.max(0, offset - PAGE_SIZE), browseQuery)}
                  className="rounded border border-neutral-600 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={
                    busy !== undefined || !summary || offset + PAGE_SIZE >= summary.totalMatching
                  }
                  onClick={() => refreshSummary(offset + PAGE_SIZE, browseQuery)}
                  className="rounded border border-neutral-600 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The chain as a checklist, build order first. Each link shows what it makes
 * and, when the world knows other ways, a "via" picker; machines that draw
 * power get a tier dial. Swapping a link rebuilds everything beneath it.
 */
function ChainReview({
  review,
  busy,
  tierByRecipeId,
  onPickTier,
  onSwapProducer,
  error,
}: {
  review: ReviewState;
  busy: boolean;
  tierByRecipeId: Record<string, string>;
  onPickTier: (recipeId: string, tier: string) => void;
  onSwapProducer: (resourceKey: string, recipeId: string) => void;
  error?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-3">
      {error ? <div className="mb-2 text-[13px] text-red-400">{error}</div> : null}
      {review.chain.rootResourceKeys.length > 0 ? (
        <div className="mb-2 text-[12px] text-amber-200/90">
          You supply: {review.chain.rootResourceKeys.map((key) => key.split(":").slice(1).join(":")).join(", ")}
        </div>
      ) : null}
      <div className={["space-y-1", busy ? "opacity-50" : ""].join(" ")}>
        {review.chain.steps.map((step, index) => {
          const recipe = review.recipesById.get(step.recipeId);
          const alternatives = review.chain.alternatives[index];
          const candidates = alternatives?.candidates ?? [];
          const primaryOutput = recipe?.outputs[0];
          const minimumTier = typeof recipe?.minimumTier === "string" ? recipe.minimumTier : undefined;
          const minimumIndex =
            recipe && recipe.eut > 0 && minimumTier && minimumTier !== "NONE"
              ? getVoltageTierIndex(minimumTier as Exclude<MachineTier, "DEMO">)
              : undefined;
          const tierChoices =
            minimumIndex !== undefined
              ? GT_OVERCLOCK_TIERS.filter((_, tierIndex) => tierIndex >= minimumIndex)
              : [];
          return (
            <div
              key={step.recipeId}
              className="flex items-center gap-2 rounded-[4px] border border-neutral-700 bg-neutral-800/60 px-2 py-1.5"
            >
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">
                {index + 1}.
              </span>
              <ResourceIcon
                resource={(primaryOutput ?? { kind: "item", id: "?", amount: 1 }) as never}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className="!h-6 !w-6 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-200">
                {recipe?.name ?? step.recipeId}
              </span>
              {candidates.length > 1 ? (
                <select
                  value={step.recipeId}
                  disabled={busy}
                  onChange={(event) =>
                    onSwapProducer(alternatives.resourceKey, event.target.value)
                  }
                  title={`Other ways to make ${alternatives.resourceDisplayName ?? "this"}`}
                  className="max-w-[180px] shrink-0 rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-200"
                >
                  {candidates.map((candidate) => (
                    <option key={candidate.recipeId} value={candidate.recipeId}>
                      {candidate.recipeMap ?? "?"}
                      {candidate.primaryInput ? ` · ${candidate.primaryInput}` : ""}
                      {candidate.outputCount > 1 ? ` (+${candidate.outputCount - 1})` : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              {tierChoices.length > 0 ? (
                <select
                  value={tierByRecipeId[step.recipeId] ?? minimumTier}
                  disabled={busy}
                  onChange={(event) => onPickTier(step.recipeId, event.target.value)}
                  title="Machine voltage tier"
                  className="shrink-0 rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-[11px] font-bold text-neutral-200"
                >
                  {tierChoices.map((choice) => (
                    <option key={choice.tier} value={choice.tier}>
                      {choice.tier}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
