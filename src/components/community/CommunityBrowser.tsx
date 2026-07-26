"use client";

import {
  ArrowBigDown,
  ArrowBigUp,
  Download,
  Eye,
  Factory,
  LoaderCircle,
  Pencil,
  Search,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadCommunityPlan,
  getCommunityPlan,
  listCommunityPlans,
  stashPlanForEditor,
  voteCommunityPlan,
} from "@/lib/community/client";
import type { CommunityPlanSort, CommunityPlanSummary } from "@/lib/community/types";
import { GT_VOLTAGE_TIERS, getVoltageTierIndex } from "@/lib/model/tiers";
import { formatRate } from "@/lib/model";

const SORT_OPTIONS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
];

export function CommunityBrowser() {
  const router = useRouter();
  const [plans, setPlans] = useState<CommunityPlanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<CommunityPlanSort>("new");
  const [search, setSearch] = useState("");
  const [maxTier, setMaxTier] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<CommunityPlanSummary>();
  const searchTimerRef = useRef<number>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [search]);

  const pageSize = 24;

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await listCommunityPlans({
        sort,
        search: debouncedSearch || undefined,
        maxTier: maxTier || undefined,
        page,
        pageSize,
      });
      setPlans(response.plans);
      setTotal(response.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Loading plans failed.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, maxTier, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [sort, debouncedSearch, maxTier]);

  const vote = async (plan: CommunityPlanSummary, value: 1 | -1) => {
    try {
      const response = await voteCommunityPlan(plan.id, value);
      const patch = (entry: CommunityPlanSummary) =>
        entry.id === plan.id
          ? {
              ...entry,
              upvotes: response.upvotes,
              downvotes: response.downvotes,
              score: response.score,
              myVote: response.myVote,
            }
          : entry;
      setPlans((current) => current.map(patch));
      setPreview((current) => (current ? patch(current) : current));
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Voting failed.");
    }
  };

  const downloadJson = async (plan: CommunityPlanSummary) => {
    try {
      const { name, plan: planJson } = await downloadCommunityPlan(plan.id);
      const blob = new Blob([JSON.stringify(planJson, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "plan"}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      bumpDownloads(plan.id);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Download failed.");
    }
  };

  const openInEditor = async (plan: CommunityPlanSummary) => {
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      stashPlanForEditor(planJson);
      bumpDownloads(plan.id);
      router.push("/");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the plan failed.");
    }
  };

  const bumpDownloads = (planId: string) => {
    const patch = (entry: CommunityPlanSummary) =>
      entry.id === planId ? { ...entry, downloads: entry.downloads + 1 } : entry;
    setPlans((current) => current.map(patch));
    setPreview((current) => (current ? patch(current) : current));
  };

  const openPreview = async (plan: CommunityPlanSummary) => {
    setPreview(plan);
    try {
      // Detail fetch counts the view and refreshes counters.
      setPreview(await getCommunityPlan(plan.id));
    } catch {
      // The card data is already shown; a failed refresh is not fatal.
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search plans by name…"
            className="w-full rounded border border-line-strong bg-surface py-1.5 pl-8 pr-2 text-sm"
          />
        </label>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as CommunityPlanSort)}
          className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          aria-label="Sort plans"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={maxTier}
          onChange={(event) => setMaxTier(event.target.value)}
          className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          aria-label="Filter by maximum machine tier"
        >
          <option value="">Any tier</option>
          {GT_VOLTAGE_TIERS.map((entry) => (
            <option key={entry.tier} value={String(getVoltageTierIndex(entry.tier))}>
              ≤ {entry.tier}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="mb-3 rounded border border-red-400 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid place-items-center py-16 text-fg-muted">
          <LoaderCircle className="h-6 w-6 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded border border-line bg-surface-raised px-4 py-12 text-center text-sm text-fg-subtle">
          No shared plans yet{debouncedSearch ? " matching your search" : ""}. Build something in{" "}
          <Link href="/" className="text-cyan-500 underline">
            the planner
          </Link>{" "}
          and hit Share!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onVote={vote}
              onPreview={openPreview}
              onDownload={downloadJson}
              onOpen={openInEditor}
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded border border-line-strong px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-fg-subtle">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded border border-line-strong px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      {preview ? (
        <PlanPreviewModal
          plan={preview}
          onClose={() => setPreview(undefined)}
          onVote={vote}
          onDownload={downloadJson}
          onOpen={openInEditor}
        />
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  onVote,
  onPreview,
  onDownload,
  onOpen,
}: {
  plan: CommunityPlanSummary;
  onVote: (plan: CommunityPlanSummary, value: 1 | -1) => void;
  onPreview: (plan: CommunityPlanSummary) => void;
  onDownload: (plan: CommunityPlanSummary) => void;
  onOpen: (plan: CommunityPlanSummary) => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded border border-line bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => onPreview(plan)}
        className="relative block h-36 w-full overflow-hidden border-b border-line bg-surface-sunken text-left"
        title="Preview"
      >
        {plan.thumbnailDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={plan.thumbnailDataUrl}
            alt={`${plan.name} preview`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-fg-muted">
            <Factory className="h-8 w-8" />
          </div>
        )}
        {plan.highestTier ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-neutral-900/80 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
            {plan.highestTier}
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onPreview(plan)}
              className="block max-w-full truncate text-left text-sm font-semibold hover:text-cyan-500"
            >
              {plan.name}
            </button>
            <p className="text-xs text-fg-muted">
              {plan.gameVersion ? `GTNH ${plan.gameVersion}` : plan.datasetVersionId || "unknown"}
            </p>
          </div>
          <VoteControls plan={plan} onVote={onVote} />
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3" /> {formatRate(Math.abs(plan.totalEuT), 3)} EU/t
          </span>
          <span className="inline-flex items-center gap-1">
            <Factory className="h-3 w-3" /> {plan.machineCount} machines
          </span>
          <span>{plan.nodeCount} nodes</span>
        </div>

        <ResourceLine label="Needs" stats={plan.needs} />
        <ResourceLine label="Makes" stats={plan.outputs} />

        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <Download className="h-3 w-3" /> {plan.downloads}
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" /> {plan.views}
            </span>
          </span>
          <span className="inline-flex gap-1">
            <button
              type="button"
              onClick={() => onOpen(plan)}
              title="Open in editor"
              className="inline-flex items-center gap-1 rounded border border-cyan-700 bg-cyan-600 px-2 py-1 font-medium text-white hover:bg-cyan-500"
            >
              <Pencil className="h-3 w-3" /> Open
            </button>
            <button
              type="button"
              onClick={() => onDownload(plan)}
              title="Download JSON"
              className="inline-flex items-center rounded border border-line-strong px-2 py-1 hover:bg-surface-raised"
            >
              <Download className="h-3 w-3" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function VoteControls({
  plan,
  onVote,
}: {
  plan: CommunityPlanSummary;
  onVote: (plan: CommunityPlanSummary, value: 1 | -1) => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-xs">
      <button
        type="button"
        onClick={() => onVote(plan, 1)}
        aria-label="Upvote"
        className={`rounded p-0.5 hover:bg-surface-raised ${plan.myVote === 1 ? "text-emerald-500" : "text-fg-muted"}`}
      >
        <ArrowBigUp className="h-4 w-4" fill={plan.myVote === 1 ? "currentColor" : "none"} />
      </button>
      <span className="min-w-5 text-center font-semibold">{plan.score}</span>
      <button
        type="button"
        onClick={() => onVote(plan, -1)}
        aria-label="Downvote"
        className={`rounded p-0.5 hover:bg-surface-raised ${plan.myVote === -1 ? "text-red-500" : "text-fg-muted"}`}
      >
        <ArrowBigDown className="h-4 w-4" fill={plan.myVote === -1 ? "currentColor" : "none"} />
      </button>
    </span>
  );
}

function ResourceLine({
  label,
  stats,
}: {
  label: string;
  stats: CommunityPlanSummary["needs"];
}) {
  if (stats.length === 0) {
    return null;
  }

  const shown = stats.slice(0, 3);
  const more = stats.length - shown.length;
  return (
    <p className="truncate text-xs text-fg-subtle" title={stats.map(describeStat).join(", ")}>
      <span className="font-medium text-fg">{label}:</span>{" "}
      {shown.map(describeStat).join(", ")}
      {more > 0 ? ` +${more} more` : ""}
    </p>
  );
}

function describeStat(stat: CommunityPlanSummary["needs"][number]): string {
  const unit = stat.kind === "fluid" ? " L/s" : "/s";
  return `${stat.displayName ?? stat.resourceId} ${formatRate(stat.ratePerSecond, 2)}${unit}`;
}

function PlanPreviewModal({
  plan,
  onClose,
  onVote,
  onDownload,
  onOpen,
}: {
  plan: CommunityPlanSummary;
  onClose: () => void;
  onVote: (plan: CommunityPlanSummary, value: 1 | -1) => void;
  onDownload: (plan: CommunityPlanSummary) => void;
  onOpen: (plan: CommunityPlanSummary) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded border border-line-strong bg-surface p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{plan.name}</h2>
            <p className="text-xs text-fg-muted">
              {plan.gameVersion ? `GTNH ${plan.gameVersion}` : plan.datasetVersionId}
              {" · "}
              shared {new Date(plan.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <VoteControls plan={plan} onVote={onVote} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {plan.thumbnailDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={plan.thumbnailDataUrl}
            alt={`${plan.name} full preview`}
            className="mb-3 w-full rounded border border-line bg-surface-sunken"
          />
        ) : null}

        {plan.description ? (
          <p className="mb-3 whitespace-pre-wrap text-sm">{plan.description}</p>
        ) : null}

        <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <StatTile label="Power" value={`${formatRate(Math.abs(plan.totalEuT), 3)} EU/t`} />
          <StatTile label="Machines" value={String(plan.machineCount)} />
          <StatTile label="Nodes" value={String(plan.nodeCount)} />
          <StatTile label="Top tier" value={plan.highestTier ?? "—"} />
        </div>

        <PreviewResourceList label="Needs" stats={plan.needs} />
        <PreviewResourceList label="Makes" stats={plan.outputs} />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDownload(plan)}
            className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            <Download className="h-4 w-4" /> Download JSON
          </button>
          <button
            type="button"
            onClick={() => onOpen(plan)}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
          >
            <Pencil className="h-4 w-4" /> Open in editor
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-surface-raised px-2 py-1.5">
      <p className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="truncate font-semibold">{value}</p>
    </div>
  );
}

function PreviewResourceList({
  label,
  stats,
}: {
  label: string;
  stats: CommunityPlanSummary["needs"];
}) {
  if (stats.length === 0) {
    return null;
  }

  return (
    <div className="mb-2">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
      <ul className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
        {stats.map((stat) => (
          <li
            key={`${stat.kind}:${stat.resourceId}`}
            className="flex justify-between gap-2 border-b border-line/50 py-0.5"
          >
            <span className="truncate">{stat.displayName ?? stat.resourceId}</span>
            <span className="shrink-0 text-fg-subtle">
              {formatRate(stat.ratePerSecond, 2)}
              {stat.kind === "fluid" ? " L/s" : "/s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
