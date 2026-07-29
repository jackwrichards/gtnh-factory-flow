"use client";

import {
  ArrowBigDown,
  ArrowBigUp,
  Check,
  Download,
  Eye,
  Factory,
  Link2,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadCommunityPlan,
  getCommunityPlan,
  listCommunityPlans,
  stashPlanForEditor,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import type {
  CommunityPlanSort,
  CommunityPlanSummary,
  PlanResourceStat,
} from "@/lib/community/types";
import { GT_VOLTAGE_TIERS, getVoltageTierIndex } from "@/lib/model/tiers";
import { formatRate } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { deleteCommunityPlan } from "@/lib/community/client";
import { useCommunityUser } from "./auth";

const SORT_OPTIONS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
];

const PAGE_SIZE = 24;

interface LoadedPlans {
  key: string;
  plans: CommunityPlanSummary[];
  total: number;
  gameVersions: string[];
}

export function CommunityBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useCommunityUser();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<CommunityPlanSort>("new");
  const [search, setSearch] = useState("");
  const [maxTier, setMaxTier] = useState("");
  const [gameVersion, setGameVersion] = useState("");
  // "My posts" can be deep-linked from the account menu (?mine=1).
  const [mineOnly, setMineOnly] = useState(() => searchParams.get("mine") === "1");
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<CommunityPlanSummary>();
  const [copiedKey, setCopiedKey] = useState<string>();
  const searchTimerRef = useRef<number>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Loading state is derived: whenever the query params move past what was
  // last fetched, we are loading. No sync setState inside effects needed.
  const [loaded, setLoaded] = useState<LoadedPlans>();
  const queryKey = `${sort}|${debouncedSearch}|${maxTier}|${gameVersion}|${page}|${mineOnly}|${user?.username ?? ""}`;

  useEffect(() => {
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await listCommunityPlans({
          sort,
          search: debouncedSearch || undefined,
          maxTier: maxTier || undefined,
          gameVersion: gameVersion || undefined,
          mine: mineOnly || undefined,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) {
          return;
        }

        setError(undefined);
        setLoaded({
          key: queryKey,
          plans: response.plans,
          total: response.total,
          gameVersions: response.gameVersions ?? [],
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Loading plans failed.");
        setLoaded({ key: queryKey, plans: [], total: 0, gameVersions: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, gameVersion, maxTier, mineOnly, page, queryKey, sort]);

  const plans = loaded?.plans ?? [];
  const total = loaded?.total ?? 0;
  const gameVersions = loaded?.gameVersions ?? [];
  const isLoading = loaded?.key !== queryKey;

  const patchPlans = useCallback(
    (patch: (entry: CommunityPlanSummary) => CommunityPlanSummary) => {
      setLoaded((current) =>
        current ? { ...current, plans: current.plans.map(patch) } : current,
      );
      setPreview((current) => (current ? patch(current) : current));
    },
    [],
  );

  const vote = async (plan: CommunityPlanSummary, value: 1 | -1) => {
    try {
      const response = await voteCommunityPlan(plan.id, value);
      patchPlans((entry) =>
        entry.id === plan.id
          ? {
              ...entry,
              upvotes: response.upvotes,
              downvotes: response.downvotes,
              score: response.score,
              myVote: response.myVote,
            }
          : entry,
      );
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
      stashPlanForEditor(tagPlanWithCommunityId(planJson, plan.id));
      bumpDownloads(plan.id);
      router.push("/");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the plan failed.");
    }
  };

  const bumpDownloads = (planId: string) => {
    patchPlans((entry) =>
      entry.id === planId ? { ...entry, downloads: entry.downloads + 1 } : entry,
    );
  };

  const removeMyPost = async (plan: CommunityPlanSummary) => {
    if (!plan.isMine && user?.isAdmin !== true) {
      return;
    }

    if (!window.confirm(`Take down "${plan.name}" from the community hub?`)) {
      return;
    }

    try {
      await deleteCommunityPlan(plan.id);
      setLoaded((current) =>
        current
          ? {
              ...current,
              plans: current.plans.filter((entry) => entry.id !== plan.id),
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
      setPreview((current) => (current?.id === plan.id ? undefined : current));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Taking the post down failed.");
    }
  };

  const openPreview = async (plan: CommunityPlanSummary) => {
    setPreview(plan);
    syncPlanUrlParam(plan.id);
    try {
      // Detail fetch counts the view and refreshes counters.
      setPreview(await getCommunityPlan(plan.id));
    } catch {
      // The card data is already shown; a failed refresh is not fatal.
    }
  };

  const closePreview = () => {
    setPreview(undefined);
    syncPlanUrlParam(undefined);
  };

  // Shared links (/community?plan=<id>) open the preview directly.
  const sharedPlanId = searchParams.get("plan");
  useEffect(() => {
    if (!sharedPlanId) {
      return;
    }

    let cancelled = false;
    void getCommunityPlan(sharedPlanId).then(
      (plan) => {
        if (!cancelled) {
          setPreview(plan);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [sharedPlanId]);

  const copyPlanLink = async (plan: CommunityPlanSummary, kind: "view" | "edit") => {
    const url =
      kind === "edit"
        ? `${window.location.origin}/?plan=${plan.id}`
        : `${window.location.origin}/community?plan=${plan.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    const key = `${plan.id}:${kind}`;
    setCopiedKey(key);
    window.setTimeout(
      () => setCopiedKey((current) => (current === key ? undefined : current)),
      1500,
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search plans by name…"
            className="w-full rounded border border-line-strong bg-surface py-1.5 pl-8 pr-2 text-sm"
          />
        </label>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as CommunityPlanSort);
            setPage(1);
          }}
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
          value={gameVersion}
          onChange={(event) => {
            setGameVersion(event.target.value);
            setPage(1);
          }}
          className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm"
          aria-label="Filter by game version"
        >
          <option value="">All versions</option>
          {gameVersions.map((version) => (
            <option key={version} value={version}>
              GTNH {version}
            </option>
          ))}
        </select>
        <select
          value={maxTier}
          onChange={(event) => {
            setMaxTier(event.target.value);
            setPage(1);
          }}
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
        {user ? (
          <label className="flex items-center gap-1.5 rounded border border-line-strong bg-surface px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(event) => {
                setMineOnly(event.target.checked);
                setPage(1);
              }}
            />
            My posts
          </label>
        ) : null}
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
              canManage={plan.isMine === true || user?.isAdmin === true}
              copiedKey={copiedKey}
              onVote={vote}
              onPreview={openPreview}
              onDownload={downloadJson}
              onOpen={openInEditor}
              onDelete={removeMyPost}
              onCopyLink={copyPlanLink}
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
          canManage={preview.isMine === true || user?.isAdmin === true}
          copiedKey={copiedKey}
          onClose={closePreview}
          onVote={vote}
          onDownload={downloadJson}
          onOpen={openInEditor}
          onDelete={removeMyPost}
          onCopyLink={copyPlanLink}
        />
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  canManage,
  copiedKey,
  onVote,
  onPreview,
  onDownload,
  onOpen,
  onDelete,
  onCopyLink,
}: {
  plan: CommunityPlanSummary;
  canManage: boolean;
  copiedKey?: string;
  onVote: (plan: CommunityPlanSummary, value: 1 | -1) => void;
  onPreview: (plan: CommunityPlanSummary) => void;
  onDownload: (plan: CommunityPlanSummary) => void;
  onOpen: (plan: CommunityPlanSummary) => void;
  onDelete: (plan: CommunityPlanSummary) => void;
  onCopyLink: (plan: CommunityPlanSummary, kind: "view" | "edit") => void;
}) {
  const isMine = plan.isMine === true;
  const isLinkCopied = copiedKey === `${plan.id}:view`;
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
        ) : plan.outputs[0]?.iconPath || plan.outputs[0]?.iconAtlas ? (
          // No photo: fall back to the plan's main product sprite.
          <div className="grid h-full w-full place-items-center minecraft-pixel-art">
            <ResourceIcon
              resource={{
                kind: plan.outputs[0].kind,
                id: plan.outputs[0].resourceId,
                amount: plan.outputs[0].ratePerSecond,
                displayName: plan.outputs[0].displayName,
                iconPath: plan.outputs[0].iconPath,
                iconAtlas: plan.outputs[0].iconAtlas,
                dominantColor: plan.outputs[0].dominantColor,
              }}
              size="xl"
              bare
              showAmount={false}
              tooltip={false}
            />
          </div>
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
        {isMine ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-cyan-600/90 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            Yours
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
              {plan.authorName ? ` · by ${plan.authorName}` : ""}
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

        <ResourceIconRow label="Needs" stats={plan.needs} />
        <ResourceIconRow label="Makes" stats={plan.outputs} />

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
              title={plan.isMine ? "Open in editor" : "Open a copy in the editor"}
              className="inline-flex items-center gap-1 rounded border border-cyan-700 bg-cyan-600 px-2 py-1 font-medium text-white hover:bg-cyan-500"
            >
              <Pencil className="h-3 w-3" /> {plan.isMine ? "Open" : "Open a copy"}
            </button>
            <button
              type="button"
              onClick={() => onCopyLink(plan, "view")}
              title={isLinkCopied ? "Link copied!" : "Copy link to this post"}
              className={`inline-flex items-center rounded border px-2 py-1 ${
                isLinkCopied
                  ? "border-emerald-600 text-emerald-500"
                  : "border-line-strong hover:bg-surface-raised"
              }`}
            >
              {isLinkCopied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => onDownload(plan)}
              title="Download JSON"
              className="inline-flex items-center rounded border border-line-strong px-2 py-1 hover:bg-surface-raised"
            >
              <Download className="h-3 w-3" />
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={() => onDelete(plan)}
                title="Take this post down"
                className="inline-flex items-center rounded border border-red-700 px-2 py-1 text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
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

/** Keeps ?plan=<id> in the address bar in sync with the open preview. */
function syncPlanUrlParam(planId: string | undefined) {
  const params = new URLSearchParams(window.location.search);
  if (planId) {
    params.set("plan", planId);
  } else {
    params.delete("plan");
  }
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
  );
}

function describeStat(stat: PlanResourceStat): string {
  const unit = stat.kind === "fluid" ? " L/s" : "/s";
  return `${stat.displayName ?? stat.resourceId} ${formatRate(stat.ratePerSecond, 2)}${unit}`;
}

/** A row of item sprites — never truncated text. Hover a sprite for details. */
function ResourceIconRow({
  label,
  stats,
  max = 6,
}: {
  label: string;
  stats: PlanResourceStat[];
  max?: number;
}) {
  if (stats.length === 0) {
    return null;
  }

  const shown = stats.slice(0, max);
  const more = stats.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-11 shrink-0 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      <div className="minecraft-pixel-art flex flex-wrap items-center gap-1">
        {shown.map((stat) => (
          <span key={`${stat.kind}:${stat.resourceId}`} title={describeStat(stat)}>
            <ResourceIcon
              resource={{
                kind: stat.kind,
                id: stat.resourceId,
                amount: stat.ratePerSecond,
                displayName: stat.displayName,
                iconPath: stat.iconPath,
                iconAtlas: stat.iconAtlas,
                dominantColor: stat.dominantColor,
              }}
              size="sm"
              bare
              showAmount={false}
              tooltip={false}
            />
          </span>
        ))}
        {more > 0 ? <span className="ml-0.5 text-xs text-fg-muted">+{more}</span> : null}
      </div>
    </div>
  );
}

function PlanPreviewModal({
  plan,
  canManage,
  copiedKey,
  onClose,
  onVote,
  onDownload,
  onOpen,
  onDelete,
  onCopyLink,
}: {
  plan: CommunityPlanSummary;
  canManage: boolean;
  copiedKey?: string;
  onClose: () => void;
  onVote: (plan: CommunityPlanSummary, value: 1 | -1) => void;
  onDownload: (plan: CommunityPlanSummary) => void;
  onOpen: (plan: CommunityPlanSummary) => void;
  onDelete: (plan: CommunityPlanSummary) => void;
  onCopyLink: (plan: CommunityPlanSummary, kind: "view" | "edit") => void;
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
              {plan.authorName ? ` · by ${plan.authorName}` : ""}
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

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canManage ? (
            <button
              type="button"
              onClick={() => onDelete(plan)}
              className="mr-auto inline-flex items-center gap-1.5 rounded border border-red-700 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Take down
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onCopyLink(plan, "view")}
            className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            {copiedKey === `${plan.id}:view` ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Copy link
          </button>
          <button
            type="button"
            onClick={() => onCopyLink(plan, "edit")}
            title="A link that opens this plan directly in the editor"
            className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            {copiedKey === `${plan.id}:edit` ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            Copy edit link
          </button>
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
            <Pencil className="h-4 w-4" /> {plan.isMine ? "Open in editor" : "Open a copy in the editor"}
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
            className="flex items-center justify-between gap-2 border-b border-line/50 py-0.5"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ResourceIcon
                resource={{
                  kind: stat.kind,
                  id: stat.resourceId,
                  amount: stat.ratePerSecond,
                  displayName: stat.displayName,
                  iconPath: stat.iconPath,
                  iconAtlas: stat.iconAtlas,
                  dominantColor: stat.dominantColor,
                }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className="shrink-0"
              />
              <span className="truncate">{stat.displayName ?? stat.resourceId}</span>
            </span>
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
