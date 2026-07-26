"use client";

import { LoaderCircle, SlidersHorizontal, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  solveRecipeDatasetGap,
  type RecipeDatasetSolveResult,
} from "@/lib/datasets/browser-loader";
import {
  formatNumberWithThousands,
  formatRate,
  getResourceKey,
  resourceLabel,
} from "@/lib/model";
import { GT_OVERCLOCK_TIERS, GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier, Recipe, ResourceBalance } from "@/lib/model/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { materializeGapFillPlan } from "@/lib/planner/materialize";
import type {
  ExistingProduction,
  GapFillPlan,
  GapSolveProgress,
  PlannerResource,
} from "@/lib/planner/types";
import { calculateThroughput } from "@/lib/solver";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { PlannerDialog } from "./PlannerDialog";

type SolveState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: RecipeDatasetSolveResult };

type SolveTierSetting = "global" | Exclude<MachineTier, "DEMO">;

interface GapSolveSettings {
  maxTier: SolveTierSetting;
  maxDepth: number;
  blockedRecipeMaps: string[];
}

const SETTINGS_STORAGE_KEY = "gtnh-factory-flow.gap-solve-settings.v1";
const DEFAULT_SETTINGS: GapSolveSettings = { maxTier: "global", maxDepth: 8, blockedRecipeMaps: [] };

function loadSolveSettings(): GapSolveSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<GapSolveSettings>;
    return {
      maxTier:
        parsed.maxTier === "global" ||
        GT_VOLTAGE_TIERS.some((entry) => entry.tier === parsed.maxTier)
          ? (parsed.maxTier as SolveTierSetting)
          : DEFAULT_SETTINGS.maxTier,
      maxDepth:
        typeof parsed.maxDepth === "number" && parsed.maxDepth >= 1 && parsed.maxDepth <= 16
          ? Math.round(parsed.maxDepth)
          : DEFAULT_SETTINGS.maxDepth,
      blockedRecipeMaps: Array.isArray(parsed.blockedRecipeMaps)
        ? parsed.blockedRecipeMaps.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSolveSettings(settings: GapSolveSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best effort; the dialog still works without persistence.
  }
}

interface VerifiedPlan {
  plan: GapFillPlan<Recipe>;
  /** Needs the plan would newly leave open, per the real throughput solver. */
  newNeeds: ResourceBalance[];
  euTDelta: number;
  verifiedClosed: boolean;
}

/**
 * The smart arrow's landing spot: solve the gap between stockpile and request,
 * verify every candidate against the real throughput engine, and offer the
 * ranked plans as cards. Applying one materializes plain nodes and edges.
 */
export function GapFillDialog({
  stockpileId,
  requestId,
  onClose,
}: {
  stockpileId: string;
  requestId: string;
  onClose: () => void;
}) {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const applyGapFillPlan = useFactoryStore((state) => state.applyGapFillPlan);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  // Holds settled solves keyed by what was asked; "loading" is derived from a
  // key mismatch rather than reset synchronously when the inputs change.
  const [solved, setSolved] = useState<{
    key: string;
    result?: RecipeDatasetSolveResult;
    message?: string;
  }>();
  const [progress, setProgress] = useState<{ key: string } & GapSolveProgress>();
  const [settings, setSettings] = useState<GapSolveSettings>(loadSolveSettings);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const recipeMaps = useFactoryStore((state) => state.dataset?.recipeMaps);
  const globalMaxTier = useFactoryStore((state) => state.maxTierFilter);

  const updateSettings = (patch: Partial<GapSolveSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveSolveSettings(next);
      return next;
    });
  };

  const version = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );
  const request = (project.requests ?? []).find((entry) => entry.id === requestId);
  const requestTitle = request
    ? resourceLabel({ id: request.resourceId, displayName: request.displayName })
    : "…";
  // Debounced so toggling a batch of machines re-solves once, not per click.
  const settingsKey = useDebouncedValue(JSON.stringify(settings), 600);
  const solveKey = `${stockpileId}|${requestId}|${version?.id ?? ""}|${settingsKey}`;
  const requestExists = Boolean(request);
  // Supply is the union of every stockpile plus what the board already makes;
  // with neither, a solve can only report that everything is missing.
  const hasAnySupply =
    (project.stockpiles ?? []).some((stockpile) => stockpile.resources.length > 0) ||
    project.nodes.some((node) => node.enabled);

  useEffect(() => {
    if (!version || !requestExists || !hasAnySupply) {
      return;
    }

    const controller = new AbortController();
    // Snapshot the whole payload at solve time; the board can keep moving
    // underneath the dialog without the request changing mid-flight.
    const store = useFactoryStore.getState();
    const activeRequest = (store.project.requests ?? []).find((entry) => entry.id === requestId);
    if (!activeRequest) {
      return;
    }

    const supply: PlannerResource[] = (store.project.stockpiles ?? []).flatMap((stockpile) =>
      stockpile.resources.map((resource) => ({
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName,
        iconPath: resource.iconPath,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor,
        stockpileId: stockpile.id,
      })),
    );

    const existingOutputs: ExistingProduction[] = [];
    for (const node of store.project.nodes) {
      if (!node.enabled) {
        continue;
      }

      const nodeResult = store.lastResult.nodes[node.id];
      if (!nodeResult || nodeResult.status === "missing-recipe") {
        continue;
      }

      for (const flow of Object.values(nodeResult.outputs)) {
        existingOutputs.push({
          kind: flow.kind,
          id: flow.resourceId,
          displayName: flow.displayName,
          nodeId: node.id,
          availablePerSecond: flow.amountPerSecond,
        });
      }
    }

    const activeSettings = JSON.parse(settingsKey) as GapSolveSettings;
    const blockedMaps = new Set(activeSettings.blockedRecipeMaps);
    const datasetRecipeMaps = store.dataset?.recipeMaps ?? [];
    const allowedRecipeMaps =
      blockedMaps.size > 0
        ? datasetRecipeMaps.filter((recipeMap) => !blockedMaps.has(recipeMap))
        : undefined;

    solveRecipeDatasetGap(
      store.datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      version,
      {
        target: {
          kind: activeRequest.kind,
          id: activeRequest.resourceId,
          displayName: activeRequest.displayName,
          iconPath: activeRequest.iconPath,
          iconAtlas: activeRequest.iconAtlas,
          dominantColor: activeRequest.dominantColor,
          amountPerSecond: activeRequest.amountPerSecond,
        },
        supply,
        existingOutputs,
        maxTier:
          activeSettings.maxTier === "global" ? store.maxTierFilter : activeSettings.maxTier,
        options: {
          maxDepth: activeSettings.maxDepth,
          allowedRecipeMaps,
        },
      },
      {
        signal: controller.signal,
        onProgress: (event) => setProgress({ key: solveKey, ...event }),
      },
    )
      .then((result) => setSolved({ key: solveKey, result }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSolved({
            key: solveKey,
            message: error instanceof Error ? error.message : "Solve failed.",
          });
        }
      });

    return () => controller.abort();
  }, [hasAnySupply, requestExists, requestId, settingsKey, solveKey, version]);

  const solveState: SolveState = useMemo(() => {
    if (!version) {
      return { status: "error", message: "No recipe dataset is loaded yet." };
    }
    if (!requestExists) {
      return { status: "error", message: "The request no longer exists." };
    }
    if (!hasAnySupply) {
      return {
        status: "error",
        message:
          "Your stockpile is empty and nothing on the board produces anything yet. Add the resources you have in abundance to the stockpile first.",
      };
    }
    if (solved?.key !== solveKey) {
      return { status: "loading" };
    }
    return solved.result
      ? { status: "ready", result: solved.result }
      : { status: "error", message: solved.message ?? "Solve failed." };
  }, [hasAnySupply, requestExists, solveKey, solved, version]);

  const verifiedPlans = useMemo<VerifiedPlan[]>(() => {
    if (solveState.status !== "ready") {
      return [];
    }

    const baselineNeeds = new Set(lastResult.externalInputs.map((balance) => balance.key));
    return solveState.result.plans.map((plan) => {
      const draft = materializeGapFillPlan(project, stockpileId, requestId, plan);
      const throughput = calculateThroughput(draft.project);
      const newNeeds = throughput.externalInputs.filter(
        (balance) => !baselineNeeds.has(balance.key),
      );
      return {
        plan,
        newNeeds,
        euTDelta: throughput.totalEuT - lastResult.totalEuT,
        verifiedClosed: newNeeds.length === 0,
      };
    });
  }, [lastResult, project, requestId, solveState, stockpileId]);

  return (
    <PlannerDialog
      title={`Build a chain for ${requestTitle}`}
      onClose={onClose}
      widthClassName="w-[640px]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            className="flex h-8 items-center gap-1.5 rounded border border-line px-2.5 text-sm hover:bg-surface-sunken"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Search settings
          </button>
          <span className="text-xs text-fg-muted">
            {settings.maxTier === "global" ? `tier ${globalMaxTier}` : `tier ${settings.maxTier}`} ·
            depth {settings.maxDepth}
            {settings.blockedRecipeMaps.length > 0
              ? ` · ${settings.blockedRecipeMaps.length} machines off`
              : ""}
          </span>
        </div>

        {isSettingsOpen ? (
          <SolveSettingsPanel
            settings={settings}
            onChange={updateSettings}
            recipeMaps={recipeMaps ?? []}
            globalMaxTier={globalMaxTier}
          />
        ) : null}

        {solveState.status === "loading" ? (
          <SolveProgressPanel progress={progress?.key === solveKey ? progress : undefined} />
        ) : null}

        {solveState.status === "error" ? (
          <div className="flex flex-col gap-2">
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {solveState.message}
            </div>
            {!hasAnySupply ? (
              <button
                type="button"
                onClick={() => {
                  useFactoryStore.getState().setEditingStockpile(stockpileId);
                  onClose();
                }}
                className="self-start rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-sunken"
              >
                Open the stockpile editor
              </button>
            ) : null}
          </div>
        ) : null}

        {solveState.status === "ready" ? (
          <>
            {solveState.result.notes.map((note) => (
              <div
                key={note}
                className="rounded border border-line bg-surface-sunken px-3 py-2 text-sm text-fg-muted"
              >
                {note}
              </div>
            ))}
            {verifiedPlans.length === 0 ? (
              <div className="py-6 text-sm text-fg-muted">
                No path found from your stockpile to {requestTitle} within the current tier
                filter. Add more base resources, or raise the tier cap.
              </div>
            ) : (
              verifiedPlans.map((entry) => (
                <PlanCard
                  key={entry.plan.id}
                  entry={entry}
                  onApply={() => {
                    applyGapFillPlan(stockpileId, requestId, entry.plan);
                    onClose();
                  }}
                />
              ))
            )}
          </>
        ) : null}
      </div>
    </PlannerDialog>
  );
}

/**
 * The narrowing controls: tier cap, search depth, and which machines the
 * solver may use at all. Fewer machines and shallower depth mean a much
 * smaller graph to search. Changes persist and re-solve automatically.
 */
function SolveSettingsPanel({
  settings,
  onChange,
  recipeMaps,
  globalMaxTier,
}: {
  settings: GapSolveSettings;
  onChange: (patch: Partial<GapSolveSettings>) => void;
  recipeMaps: string[];
  globalMaxTier: string;
}) {
  const [mapFilter, setMapFilter] = useState("");
  const blocked = useMemo(() => new Set(settings.blockedRecipeMaps), [settings.blockedRecipeMaps]);
  const visibleMaps = useMemo(() => {
    const normalized = mapFilter.trim().toLowerCase();
    const maps = normalized
      ? recipeMaps.filter((recipeMap) => recipeMap.toLowerCase().includes(normalized))
      : recipeMaps;
    return [...maps].sort((left, right) => left.localeCompare(right));
  }, [mapFilter, recipeMaps]);

  const toggleMap = (recipeMap: string) => {
    onChange({
      blockedRecipeMaps: blocked.has(recipeMap)
        ? settings.blockedRecipeMaps.filter((entry) => entry !== recipeMap)
        : [...settings.blockedRecipeMaps, recipeMap],
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded border border-line bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Max tier
          <select
            value={settings.maxTier}
            onChange={(event) => onChange({ maxTier: event.target.value as SolveTierSetting })}
            className="h-8 rounded border border-line bg-surface-sunken px-2 text-sm outline-none focus:border-cyan-500"
          >
            <option value="global">Recipe-book filter ({globalMaxTier})</option>
            {GT_OVERCLOCK_TIERS.map((entry) => (
              <option key={entry.tier} value={entry.tier}>
                {entry.tier}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Max depth
          <input
            type="number"
            min={1}
            max={16}
            value={settings.maxDepth}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(parsed)) {
                onChange({ maxDepth: Math.min(16, Math.max(1, parsed)) });
              }
            }}
            className="h-8 w-16 rounded border border-line bg-surface-sunken px-2 text-sm outline-none focus:border-cyan-500"
          />
          <span className="text-xs text-fg-muted">recipes deep</span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">Machines</span>
          <input
            type="text"
            value={mapFilter}
            onChange={(event) => setMapFilter(event.target.value)}
            placeholder="Filter machines…"
            className="h-8 w-48 rounded border border-line bg-surface-sunken px-2 text-sm outline-none focus:border-cyan-500"
          />
          <span className="flex-1" />
          {settings.blockedRecipeMaps.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange({ blockedRecipeMaps: [] })}
              className="h-7 rounded border border-line px-2 text-xs hover:bg-surface-sunken"
            >
              Enable all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onChange({ blockedRecipeMaps: [...recipeMaps] })}
            className="h-7 rounded border border-line px-2 text-xs hover:bg-surface-sunken"
            title="Turn everything off, then enable just the machines you want"
          >
            Disable all
          </button>
        </div>
        <div className="flex max-h-44 flex-wrap content-start gap-1.5 overflow-y-auto">
          {visibleMaps.length === 0 ? (
            <span className="text-sm text-fg-muted">No machines match the filter.</span>
          ) : (
            visibleMaps.map((recipeMap) => {
              const isBlocked = blocked.has(recipeMap);
              return (
                <button
                  key={recipeMap}
                  type="button"
                  onClick={() => toggleMap(recipeMap)}
                  className={[
                    "h-7 rounded border px-2 text-xs",
                    isBlocked
                      ? "border-line text-fg-muted line-through opacity-60 hover:opacity-90"
                      : "border-emerald-500/50 bg-emerald-500/10 hover:border-emerald-400",
                  ].join(" ")}
                  title={isBlocked ? `Allow ${recipeMap}` : `Exclude ${recipeMap}`}
                >
                  {recipeMap}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Narrates the running solve from its streamed heartbeats: which phase, which
 * candidate plan, which resource it is currently finding producers for.
 */
function SolveProgressPanel({ progress }: { progress?: GapSolveProgress }) {
  const headline = !progress
    ? "Contacting the solver…"
    : progress.stage === "indexing"
      ? "Warming up the recipe indexes…"
      : progress.stage === "hydrating"
        ? "Fetching full recipes for the chosen steps…"
        : progress.planLabel
          ? `Plan ${(progress.planIndex ?? 0) + 1}: exploring via ${progress.planLabel}`
          : "Picking candidate chains for the target…";
  const detail =
    progress?.stage === "indexing"
      ? "Loading the dataset index and matching your stockpile against it — the first solve after a server restart is the slow one."
      : progress?.stage === "exploring" && progress.resource
        ? `Looking for ways to make ${progress.resource}`
        : undefined;

  return (
    <div className="flex flex-col gap-1.5 py-6">
      <div className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-base font-medium">{headline}</span>
      </div>
      {detail ? <div className="truncate pl-8 text-sm text-fg-muted">{detail}</div> : null}
      {progress?.lookups ? (
        <div className="pl-8 text-xs tabular-nums text-fg-muted">
          {progress.lookups} recipe lookups so far
        </div>
      ) : null}
    </div>
  );
}

const VISIBLE_STEPS = 6;
const VISIBLE_DRAWS = 5;

function PlanCard({ entry, onApply }: { entry: VerifiedPlan; onApply: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const { plan, newNeeds, euTDelta, verifiedClosed } = entry;
  const isClosed = plan.closed && verifiedClosed;
  const tierName = GT_VOLTAGE_TIERS[plan.stats.maxTierIndex]?.tier ?? "?";
  const missingLabels = [
    ...plan.missing.map((resource) => resourceLabel(resource)),
    ...newNeeds.map((balance) =>
      resourceLabel({ id: balance.resourceId, displayName: balance.displayName }),
    ),
  ];
  const visibleSteps = plan.steps.slice(0, VISIBLE_STEPS);
  const visibleDraws = plan.stats.supplyDraws.slice(0, VISIBLE_DRAWS);

  return (
    <div className="rounded border border-line bg-surface-raised">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{plan.label}</span>
        {isClosed ? (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">
            Closed — nothing missing
          </span>
        ) : (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
            Still needs {missingLabels.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-sm text-fg-subtle">
        {plan.steps.length > 0 ? (
          <>
            <span>{plan.stats.stepCount} steps</span>
            <span>{plan.stats.machineCount} machines</span>
            <span>up to {tierName}</span>
            <span>
              {euTDelta >= 0 ? "+" : ""}
              {formatNumberWithThousands(Math.round(euTDelta))} EU/t
            </span>
          </>
        ) : (
          <span>No new machines — reroutes existing production.</span>
        )}
      </div>

      {missingLabels.length > 0 ? (
        <div className="px-3 pb-2 text-sm text-amber-500">
          Missing: {missingLabels.join(", ")}
        </div>
      ) : null}

      {visibleDraws.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <span className="text-xs uppercase tracking-wide text-fg-muted">From stockpile</span>
          {visibleDraws.map((draw) => (
            <span
              key={getResourceKey(draw)}
              className="flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
              title={resourceLabel(draw)}
            >
              <ResourceIcon
                resource={{ ...draw, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-5 !w-5"
              />
              {formatRate(draw.ratePerSecond)}
              {draw.kind === "fluid" ? "L/s" : "/s"}
            </span>
          ))}
          {plan.stats.supplyDraws.length > visibleDraws.length ? (
            <span className="text-xs text-fg-muted">
              +{plan.stats.supplyDraws.length - visibleDraws.length} more
            </span>
          ) : null}
        </div>
      ) : null}

      {plan.stats.existingDraws.length > 0 ? (
        <div className="px-3 pb-2 text-sm text-fg-subtle">
          Taps{" "}
          {plan.stats.existingDraws
            .map((draw) => {
              const node = project.nodes.find((entry) => entry.id === draw.nodeId);
              const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
              return `${recipe?.name ?? "an existing machine"} (${formatRate(draw.ratePerSecond)}${
                draw.kind === "fluid" ? "L/s" : "/s"
              })`;
            })
            .join(", ")}
        </div>
      ) : null}

      {visibleSteps.length > 0 ? (
        <div className="border-t border-line px-3 py-2">
          {visibleSteps.map((step, index) => (
            <div key={`${step.recipe.id}-${index}`} className="flex items-baseline gap-2 py-0.5">
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {step.machineCount}×
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{step.recipe.name}</span>
            </div>
          ))}
          {plan.steps.length > visibleSteps.length ? (
            <div className="pt-0.5 text-xs text-fg-muted">
              +{plan.steps.length - visibleSteps.length} more steps
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={onApply}
          className="flex h-8 items-center gap-1.5 rounded bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Build it
        </button>
      </div>
    </div>
  );
}
