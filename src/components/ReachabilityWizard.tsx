"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, Loader2, Search, X } from "lucide-react";
import { placePayload } from "@/components/BlueprintPanel";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetReachability,
  queryRecipeDatasetResources,
} from "@/lib/datasets/browser-loader";
import type { DatasetResourceIndexEntry, DatasetVersion } from "@/lib/datasets/types";
import {
  ALL_REACHABILITY_SOURCES,
  type ReachabilityChainResult,
  type ReachabilityRootsConfig,
  type ReachabilitySource,
  type ReachabilitySummaryResult,
  type ReachableResourceSummary,
} from "@/lib/reachability/api-types";
import { buildChainPlacementPayload } from "@/lib/reachability/chain-payload";
import type { Recipe } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";

/**
 * "What can I make?" - the wizard over the reachability engine.
 *
 * Step one declares the world: which of the board's fundamental sources
 * (veins, small ores, underground fluids, bees, crops) the player has, plus
 * anything they grant themselves by hand. Step two is the answer - everything
 * craftable from those roots - and picking a thing places its whole witness
 * chain on the board, prewired, sources on the left, drains on the right.
 */

const SOURCE_LABELS: Record<ReachabilitySource, { label: string; hint: string }> = {
  ores: { label: "Ore veins", hint: "Everything minable from veins" },
  smallOres: { label: "Small ores", hint: "The scattered singles" },
  undergroundFluids: { label: "Underground fluids", hint: "Oil and gas fields" },
  bees: { label: "Bees", hint: "Every bee's produce" },
  crops: { label: "Crops", hint: "Everything growable" },
};

const PAGE_SIZE = 48;

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
  const [busy, setBusy] = useState<"summary" | "chain" | undefined>();
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
  // point of the toggles is watching the answer move.
  useEffect(() => {
    if (open) {
      refreshSummary(0, browseQuery);
    }
    // browseQuery drives its own debounced effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roots, version]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => refreshSummary(0, browseQuery), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseQuery]);

  const build = useCallback(
    async (target: ReachableResourceSummary) => {
      if (!version || !datasetManifestUrl) {
        return;
      }
      setBusy("chain");
      setError(undefined);
      try {
        const chain = (await queryRecipeDatasetReachability(datasetManifestUrl, version, {
          action: "chain",
          roots,
          target: { kind: target.kind, id: target.id },
        })) as ReachabilityChainResult;
        if (!chain.reachable) {
          setError("That target is not reachable from the chosen roots.");
          setBusy(undefined);
          return;
        }
        const recipes = await Promise.all(
          chain.steps.map((step) =>
            getRecipeDatasetRecipe(datasetManifestUrl, version, step.recipeId),
          ),
        );
        const payload = buildChainPlacementPayload(
          chain.steps.map((step, index) => ({
            recipe: recipes[index] as Recipe,
            depth: step.depth,
          })),
          chain.rootResourceKeys,
        );
        placePayload(payload);
        setBusy(undefined);
        onClose();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Placing the chain failed.");
        setBusy(undefined);
      }
    },
    [version, datasetManifestUrl, roots, onClose],
  );

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
          {summary ? (
            <span className="ml-2 text-[13px] text-neutral-400">
              {summary.reachableCount.toLocaleString()} things reachable
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

        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          {/* The roots: what the player's world offers. */}
          <div className="flex flex-wrap items-center gap-2">
            {ALL_REACHABILITY_SOURCES.map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setSources((current) => ({ ...current, [source]: !current[source] }))}
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
                              (entry) => entry.kind === resource.kind && entry.id === resource.id,
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
                onClick={() => build(resource)}
                title="Place the whole production chain on the board"
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

        <div className="mt-3 flex items-center gap-2 border-t border-neutral-700 pt-3 text-[12px] text-neutral-400">
          {busy === "chain" ? (
            <span className="flex items-center gap-2 text-cyan-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Placing the chain...
            </span>
          ) : (
            <span>
              {summary
                ? `${summary.totalMatching.toLocaleString()} match${summary.totalMatching === 1 ? "" : "es"}. Click one to place its chain, prewired.`
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
        </div>
      </div>
    </div>
  );
}
