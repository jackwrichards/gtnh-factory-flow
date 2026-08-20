"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowBigUp,
  Check,
  Cog,
  Download,
  FolderOpen,
  Globe,
  Link2,
  LoaderCircle,
  Package,
  Save,
  Search,
  Share2,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import {
  deleteCommunityPlan,
  downloadCommunityPlan,
  getCommunityPlan,
  listCommunityPlans,
  patchCommunityPlan,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSort, CommunityPlanSummary, EntryIcon } from "@/lib/community/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { parseFactoryProjectJson, serializeFactoryProject } from "@/lib/import-export";
import { applyPlanView, capturePlanView } from "@/lib/plan-view";
import {
  OPEN_SETUPS_EVENT,
  SETUPS_CHANGED_EVENT,
  takePendingSetupsScope,
  type SetupsScope,
} from "@/lib/setups-tab";
import { useCommunityUser } from "@/components/community/auth";
import { SharePlanDialog } from "@/components/community/SharePlanDialog";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { ControlsCard } from "@/components/ControlsCard";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useDesignStore } from "@/store/design-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { FactoryProject } from "@/lib/model/types";
import { placePayload } from "./BlueprintPanel";
import {
  formatRelativeDate,
  renderEntryHoverCard,
  TagChips,
  TierBadge,
} from "./shelf-cards";

const SETUP_SORTS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
];

const PAGE_SIZE = 24;

/** What the shelf currently shows: which query it answers and how deep. */
interface SetupShelf {
  key: string;
  page: number;
  total: number;
  plans: CommunityPlanSummary[];
}

/**
 * The Setups shelf: everyone's shared factories, browsed without leaving the
 * board. The old community page folded into this column — search, sort,
 * vote, and one click opens a setup as its own design tab (never on top of
 * the open board). NETWORK is the whole hub; MINE is the account's own
 * posts, where take-down lives.
 */
export function SetupsPanel() {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const [scope, setScope] = useState<SetupsScope>(() => takePendingSetupsScope() ?? "network");
  const [sort, setSort] = useState<CommunityPlanSort>("new");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [shelf, setShelf] = useState<SetupShelf>();
  const [target, setTarget] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<{ id: string; kind: "open" | "pocket" }>();
  const [copiedId, setCopiedId] = useState<string>();
  const [isShareOpen, setShareOpen] = useState(false);
  // The row whose icon is being picked; the picker itself is one modal.
  const [iconEditId, setIconEditId] = useState<string>();
  // Bumped when a share lands or a post is overwritten, so a fresh post
  // shows up without a manual refresh.
  const [refreshTick, setRefreshTick] = useState(0);
  const hasBoardContent = useFactoryStore((state) => state.project.nodes.length > 0);
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "this board",
  );

  // "My setups" in the account menu can retarget an already-open panel.
  useEffect(() => {
    const applyScope = () => {
      const requested = takePendingSetupsScope();
      if (requested) {
        setScope(requested);
      }
    };
    window.addEventListener(OPEN_SETUPS_EVENT, applyScope);
    return () => window.removeEventListener(OPEN_SETUPS_EVENT, applyScope);
  }, []);

  // A share posted anywhere (this panel's dialog or the top bar's) refetches
  // the shelf, so the new post is already here when the dialog closes.
  useEffect(() => {
    const refresh = () => setRefreshTick((tick) => tick + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  const username = user?.username ?? "";
  const search = debouncedQuery.trim();
  const key = `${scope}|${sort}|${search}|${username}|${refreshTick}`;
  // A "load more" targets deeper pages of the key it was clicked under; any
  // filter move leaves that target stale and the shelf falls back to page 1.
  const activePage = target.key === key ? target.page : 1;

  useEffect(() => {
    if (scope === "mine" && !username) {
      return;
    }

    let cancelled = false;
    void listCommunityPlans({
      sort,
      search: search || undefined,
      mine: scope === "mine" || undefined,
      page: activePage,
      pageSize: PAGE_SIZE,
    }).then(
      (response) => {
        if (cancelled) {
          return;
        }
        setError(undefined);
        setShelf((current) => ({
          key,
          page: activePage,
          total: response.total,
          plans:
            current && current.key === key && activePage > 1
              ? [...current.plans, ...response.plans]
              : response.plans,
        }));
      },
      (loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Loading setups failed.");
        setShelf({ key, page: activePage, total: 0, plans: [] });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key, activePage, scope, sort, search, username]);

  const isCurrent = shelf?.key === key;
  const plans = isCurrent ? shelf.plans : [];
  const needsAccount = scope === "mine" && !username;
  const isLoading = !needsAccount && (!isCurrent || shelf.page !== activePage);
  const hasMore = isCurrent && shelf.plans.length < shelf.total;
  // The tag dropdown offers whatever the loaded rows wear (plus the active
  // tag itself, so a hand-typed #tag still shows as selected).
  const activeTag = search.startsWith("#") ? search.slice(1).trim() : "";
  const tagOptions = [
    ...new Set([...plans.flatMap((plan) => plan.tags ?? []), ...(activeTag ? [activeTag] : [])]),
  ].sort();

  const patchPlan = (
    planId: string,
    patch: (plan: CommunityPlanSummary) => CommunityPlanSummary,
  ) => {
    setShelf((current) =>
      current
        ? {
            ...current,
            plans: current.plans.map((plan) => (plan.id === planId ? patch(plan) : plan)),
          }
        : current,
    );
  };

  // A post shared by an old release carries the stat card that release
  // computed, and the server only recomputes it when the plan is fetched
  // alone. Pointing at a row is where those numbers show, so the first hover
  // asks once for the current summary and patches the stat fields in place —
  // never counts, votes or tags, which the row may have moved locally since.
  const refreshedStatsRef = useRef(new Set<string>());
  const refreshStats = (planId: string) => {
    if (refreshedStatsRef.current.has(planId)) {
      return;
    }
    refreshedStatsRef.current.add(planId);
    void getCommunityPlan(planId, { countView: false }).then(
      (summary) =>
        patchPlan(planId, (entry) => ({
          ...entry,
          needs: summary.needs,
          outputs: summary.outputs,
          totalEuT: summary.totalEuT,
          machineCount: summary.machineCount,
          nodeCount: summary.nodeCount,
          storageCount: summary.storageCount,
          edgeCount: summary.edgeCount,
          highestTier: summary.highestTier,
          highestTierIndex: summary.highestTierIndex,
        })),
      () => refreshedStatsRef.current.delete(planId),
    );
  };

  const vote = async (plan: CommunityPlanSummary) => {
    try {
      const response = await voteCommunityPlan(plan.id, 1);
      patchPlan(plan.id, (entry) => ({
        ...entry,
        upvotes: response.upvotes,
        downvotes: response.downvotes,
        score: response.score,
        myVote: response.myVote,
      }));
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Voting failed.");
    }
  };

  const open = async (plan: CommunityPlanSummary) => {
    setBusy({ id: plan.id, kind: "open" });
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(planJson, plan.id)),
      );
      // The post's name first: that is the one on the card just clicked. The
      // plan carries its author's own tab name, often still "Untitled design".
      await useDesignStore.getState().importProjectAsDesign(project, plan.name || project.name);
      // Opening a setup means seeing it the way its author set it up. Only
      // here, not in the pocket drop below: that one merges into the board you
      // are already working on, and rearranging your workspace around an
      // import would be an ambush.
      applyPlanView(project.view);
      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the setup failed.");
    } finally {
      setBusy(undefined);
    }
  };

  // The whole setup lands on the CURRENT board as one pocket card: paste it
  // centred like a blueprint, then compact the pasted cards — same code path
  // as Ctrl+G, so ports, wiring and the purple room all come out right.
  const openAsPocket = async (plan: CommunityPlanSummary) => {
    setBusy({ id: plan.id, kind: "pocket" });
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(JSON.stringify(planJson));
      const payload = captureBoardSelection(project, rootBoardIds(project));
      if (!payload) {
        throw new Error("This setup has nothing to place.");
      }

      const pastedIds = placePayload(payload);
      if (pastedIds.length > 0) {
        const state = useFactoryStore.getState();
        const pocketId = state.compactSelectionIntoPocket(pastedIds, plan.name);
        if (pocketId) {
          state.setPendingBoardSelection([pocketId]);
          // The whole setup is one card now, so the camera settles on that
          // card rather than on the spread it was a moment ago.
          state.frameBoardNodes([pocketId]);
        }
      }

      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (pocketError) {
      setError(
        pocketError instanceof Error ? pocketError.message : "Loading as a pocket failed.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const copyLink = async (plan: CommunityPlanSummary) => {
    const url = sharedPlanLink(plan.id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setCopiedId(plan.id);
    window.setTimeout(
      () => setCopiedId((current) => (current === plan.id ? undefined : current)),
      1500,
    );
  };

  const saveTags = async (plan: CommunityPlanSummary, tags: string[]) => {
    try {
      await patchCommunityPlan(plan.id, { tags });
      patchPlan(plan.id, (entry) => ({ ...entry, tags }));
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Saving tags failed.");
    }
  };

  const saveIcon = async (planId: string, icon: EntryIcon | null) => {
    try {
      await patchCommunityPlan(planId, { icon });
      patchPlan(planId, (entry) => ({ ...entry, icon: icon ?? undefined }));
    } catch (iconError) {
      setError(iconError instanceof Error ? iconError.message : "Saving the icon failed.");
    }
  };

  // The row's save button: the OPEN TAB becomes this post's new content.
  // The server re-derives every stat from the fresh plan; the refetch shows
  // the new numbers.
  const overwriteWithBoard = async (plan: CommunityPlanSummary) => {
    try {
      const state = useFactoryStore.getState();
      await patchCommunityPlan(plan.id, {
        // Overwriting re-shares the workspace too, so an updated post does not
        // quietly keep the arrangement from whenever it was first published.
        plan: JSON.parse(
          serializeFactoryProject({ ...state.project, view: capturePlanView() }),
        ) as unknown,
      });
      // The open board IS this post's content now, so the design links to it
      // and its plan card's reset button goes back to sleep.
      state.setProjectCommunityLink(plan.id);
      setError(undefined);
      setRefreshTick((tick) => tick + 1);
    } catch (overwriteError) {
      setError(
        overwriteError instanceof Error ? overwriteError.message : "Overwriting the post failed.",
      );
    }
  };

  // The globe on an owned row: same gesture as blueprints. Private posts
  // keep their votes and downloads; they just leave the public shelf.
  const setVisibility = async (plan: CommunityPlanSummary) => {
    const next = !plan.isPublic;
    try {
      await patchCommunityPlan(plan.id, { isPublic: next });
      if (scope === "network" && !next) {
        setShelf((current) =>
          current
            ? {
                ...current,
                total: Math.max(0, current.total - 1),
                plans: current.plans.filter((entry) => entry.id !== plan.id),
              }
            : current,
        );
      } else {
        patchPlan(plan.id, (entry) => ({ ...entry, isPublic: next }));
      }
    } catch (publishError) {
      setError(
        publishError instanceof Error ? publishError.message : "Changing visibility failed.",
      );
    }
  };

  const remove = async (plan: CommunityPlanSummary) => {
    if (!window.confirm(`Take down "${plan.name}" from the network?`)) {
      return;
    }

    try {
      await deleteCommunityPlan(plan.id);
      setShelf((current) =>
        current
          ? {
              ...current,
              total: Math.max(0, current.total - 1),
              plans: current.plans.filter((entry) => entry.id !== plan.id),
            }
          : current,
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Taking the post down failed.",
      );
    }
  };

  return (
    <>
      <ControlsCard>
        {/* Share on the left, then Mine | Public: the same row shape as the
            pocket shelf. The panel still OPENS on Public: browsing is
            the point. */}
        <div className="flex gap-1">
          <MinecraftTooltip
            label={
              hasBoardContent
                ? "Share this design\nPuts the board you have open on the Public shelf"
                : "Share this design\nBuild something on the board first"
            }
          >
            <button
              type="button"
              disabled={!hasBoardContent}
              onClick={() => setShareOpen(true)}
              aria-label="Share the open design as a setup"
              data-tour-anchor="share-setup"
              className="flex h-7 w-9 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-600 enabled:hover:text-emerald-300 disabled:opacity-50"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </MinecraftTooltip>
          <button
            type="button"
            onClick={() => setScope("mine")}
            className={[
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
              scope === "mine"
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            <User className="h-3.5 w-3.5" />
            Mine
          </button>
          <button
            type="button"
            onClick={() => setScope("network")}
            className={[
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
              scope === "network"
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            <Globe className="h-3.5 w-3.5" />
            Public
          </button>
        </div>
        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              scope === "mine" ? "Search my setups... (#tag)" : "Search the network... (#tag)"
            }
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear setup search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        {/* Tags on the left, sort on the right: the dropdown spares typing
            #tag into the search, though that still works too. */}
        <div className="mt-2 flex items-center gap-1">
          <select
            value={activeTag}
            onChange={(event) =>
              setQuery(event.target.value ? `#${event.target.value}` : "")
            }
            aria-label="Filter by tag"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            <option value="">All tags</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as CommunityPlanSort)}
            aria-label="Sort setups"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            {SETUP_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </ControlsCard>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{error}</p> : null}

        {needsAccount && !isAuthLoading ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Sign in (top right) to see your own setups here. Share one with the board&apos;s Share
            button, then manage it from this shelf.
          </p>
        ) : isLoading && plans.length === 0 ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading the network…
          </p>
        ) : plans.length === 0 && !error ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            {search
              ? "No setups match."
              : scope === "mine"
                ? "Nothing shared yet. Use the Share button above the board to post a setup."
                : "Nothing shared yet. Build a factory and use the Share button above the board to post it."}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {plans.map((plan) => (
                <SetupRow
                  key={plan.id}
                  plan={plan}
                  busy={busy?.id === plan.id ? busy.kind : undefined}
                  isCopied={copiedId === plan.id}
                  // Owner tools are for OWNERS: other people's rows stay
                  // lean (link, pocket, open), even for the site admin.
                  canManage={plan.isMine === true}
                  activeTabName={activeTabName}
                  onVote={() => void vote(plan)}
                  onOpen={() => void open(plan)}
                  onOpenAsPocket={() => void openAsPocket(plan)}
                  onCopyLink={() => void copyLink(plan)}
                  onDelete={() => void remove(plan)}
                  onToggleVisibility={() => void setVisibility(plan)}
                  onOverwriteWithBoard={() => void overwriteWithBoard(plan)}
                  onEditIcon={() => setIconEditId(plan.id)}
                  onSaveTags={(tags) => void saveTags(plan, tags)}
                  onTag={(tag) => setQuery(`#${tag}`)}
                  onHover={() => refreshStats(plan.id)}
                />
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setTarget({ key, page: activePage + 1 })}
                className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-neutral-700 bg-[#17191d] text-[11px] text-neutral-300 enabled:hover:border-neutral-500 disabled:opacity-50"
              >
                {isLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
      {isShareOpen ? <SharePlanDialog onClose={() => setShareOpen(false)} /> : null}
      {iconEditId ? (
        <IconPicker
          title="Pick this setup's icon"
          suggestions={iconSuggestionsFromStats(
            plans.find((entry) => entry.id === iconEditId)?.needs,
            plans.find((entry) => entry.id === iconEditId)?.outputs,
          )}
          onPick={(icon) => {
            setIconEditId(undefined);
            void saveIcon(iconEditId, icon);
          }}
          onClear={
            plans.find((entry) => entry.id === iconEditId)?.icon
              ? () => {
                  setIconEditId(undefined);
                  void saveIcon(iconEditId, null);
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}
    </>
  );
}

/** The whole story a hovered setup row tells. */
function setupHoverCard(plan: CommunityPlanSummary): ReactNode {
  return renderEntryHoverCard({
    icon: plan.icon,
    name: plan.name,
    authorName: plan.authorName,
    createdAt: plan.createdAt,
    cardCount: plan.nodeCount + plan.storageCount,
    machineCount: plan.machineCount,
    tier: plan.highestTier,
    gameVersion: plan.gameVersion,
    description: plan.description || undefined,
    needs: plan.needs,
    outputs: plan.outputs,
  });
}

/** Everything living at a project's top level — what a full-plan capture takes. */
function rootBoardIds(project: FactoryProject): string[] {
  return [
    ...project.nodes.filter((node) => !node.pocketId).map((node) => node.id),
    ...(project.storages ?? [])
      .filter((storage) => !storage.pocketId)
      .map((storage) => storage.id),
    ...(project.annotations ?? [])
      .filter((annotation) => !annotation.pocketId)
      .map((annotation) => annotation.id),
    ...(project.pockets ?? [])
      .filter((pocket) => !pocket.parentPocketId)
      .map((pocket) => pocket.id),
  ];
}

function SetupRow({
  plan,
  busy,
  isCopied,
  canManage,
  activeTabName,
  onVote,
  onOpen,
  onOpenAsPocket,
  onCopyLink,
  onDelete,
  onToggleVisibility,
  onOverwriteWithBoard,
  onEditIcon,
  onSaveTags,
  onTag,
  onHover,
}: {
  plan: CommunityPlanSummary;
  busy?: "open" | "pocket";
  isCopied: boolean;
  canManage: boolean;
  activeTabName: string;
  onVote: () => void;
  onOpen: () => void;
  onOpenAsPocket: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
  onOverwriteWithBoard: () => void;
  onEditIcon: () => void;
  onSaveTags: (tags: string[]) => void;
  onTag: (tag: string) => void;
  onHover: () => void;
}) {
  const isBusy = busy !== undefined;
  // The overwrite asks first: it names the tab that would replace the post.
  const [isConfirmingOverwrite, setConfirmingOverwrite] = useState(false);
  // The tag editor lives in the row: edits stay local as chips and save
  // once, on close — one PUT per session, same manners as blueprints.
  const [tagEditor, setTagEditor] = useState<{ draft: string[]; input: string }>();

  const addDraftTag = (editor: { draft: string[]; input: string }) => {
    const draft = normalizeBlueprintTags([...editor.draft, editor.input]);
    setTagEditor({ draft, input: "" });
    return draft;
  };

  // Closing saves — whatever is still in the input counts as one last tag.
  const closeTagEditor = () => {
    if (!tagEditor) {
      return;
    }
    const finalTags = tagEditor.input.trim() ? addDraftTag(tagEditor) : tagEditor.draft;
    setTagEditor(undefined);
    if (JSON.stringify(finalTags) !== JSON.stringify(plan.tags ?? [])) {
      onSaveTags(finalTags);
    }
  };

  return (
    <li
      className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
      onMouseEnter={onHover}
      // Double-click anywhere that isn't a button opens the setup — the
      // folder button stays as the single-click way.
      onDoubleClick={(event) => {
        if (!isBusy && !(event.target as HTMLElement).closest("button, input")) {
          onOpen();
        }
      }}
    >
      {/* The whole row reveals the setup's story; the buttons inside it
          explain THEMSELVES (nearest tooltip owns the hover), and tag
          chips stay silent so clicking one reads as its own action. */}
      <MinecraftTooltip content={setupHoverCard(plan)}>
      <div className="flex items-center gap-1">
        <MinecraftTooltip
          label={
            plan.myVote === 1
              ? "Upvoted\nClick to take your vote back"
              : "Upvote\nLifts this setup up the Top sort"
          }
        >
          <button
            type="button"
            onClick={onVote}
            aria-label={`Upvote ${plan.name}`}
            className={[
              "flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] border px-1 text-[10px] font-bold tabular-nums",
              plan.myVote === 1
                ? "border-emerald-600 bg-emerald-500/15 text-emerald-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-emerald-600 hover:text-emerald-300",
            ].join(" ")}
          >
            <ArrowBigUp className="h-3 w-3" />
            {plan.score}
          </button>
        </MinecraftTooltip>
        <EntryIconSlot icon={plan.icon} editable={canManage} onEdit={onEditIcon} />
        <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
          {plan.name}
        </span>
        <MinecraftTooltip label={"Copy link\nOpens this setup in a friend's planner"}>
          <button
            type="button"
            onClick={onCopyLink}
            aria-label={`Copy a link to ${plan.name}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-emerald-300" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
          </button>
        </MinecraftTooltip>
        {canManage ? (
          <>
            <MinecraftTooltip
              label={"Overwrite from the board\nThe tab you have open becomes this post"}
            >
              <button
                type="button"
                onClick={() => setConfirmingOverwrite((confirming) => !confirming)}
                aria-label={`Overwrite ${plan.name} with the open tab`}
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  isConfirmingOverwrite
                    ? "border-amber-500 bg-amber-500/15 text-amber-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-amber-600 hover:text-amber-300",
                ].join(" ")}
              >
                <Save className="h-3 w-3" />
              </button>
            </MinecraftTooltip>
            <MinecraftTooltip
              label={
                plan.isPublic
                  ? "Public\nOn the shelf for everyone. Click to make it private"
                  : "Private\nOnly you see it. Click to publish"
              }
            >
              <button
                type="button"
                onClick={onToggleVisibility}
                aria-label={
                  plan.isPublic ? `Make ${plan.name} private` : `Publish ${plan.name}`
                }
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  plan.isPublic
                    ? "border-emerald-600 bg-emerald-500/15 text-emerald-300 hover:border-neutral-500 hover:text-neutral-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-500 hover:border-emerald-600 hover:text-emerald-300",
                ].join(" ")}
              >
                <Globe className="h-3 w-3" />
              </button>
            </MinecraftTooltip>
            <MinecraftTooltip
              label={tagEditor ? "Save tags\nCloses the editor" : "Edit tags\nClosing saves"}
            >
              <button
                type="button"
                onClick={() =>
                  tagEditor
                    ? closeTagEditor()
                    : setTagEditor({ draft: plan.tags ?? [], input: "" })
                }
                aria-label={`Edit tags for ${plan.name}`}
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  tagEditor
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-cyan-600 hover:text-cyan-300",
                ].join(" ")}
              >
                <Tags className="h-3 w-3" />
              </button>
            </MinecraftTooltip>
            <MinecraftTooltip label={"Take it down\nDeletes the post for everyone"}>
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Take down ${plan.name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-red-500 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </MinecraftTooltip>
          </>
        ) : null}
        <MinecraftTooltip label={"Load as a pocket\nLands on this board as one card"}>
          <button
            type="button"
            disabled={isBusy}
            onClick={onOpenAsPocket}
            aria-label={`Load setup ${plan.name} as a pocket`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-[#8d6fd1] enabled:hover:text-[#c9b8ec] disabled:opacity-50"
          >
            {busy === "pocket" ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-[#c9b8ec]" />
            ) : (
              <Package className="h-3 w-3" />
            )}
          </button>
        </MinecraftTooltip>
        <MinecraftTooltip label={"Open the setup\nBecomes its own design tab"}>
          <button
            type="button"
            disabled={isBusy}
            onClick={onOpen}
            aria-label={`Open setup ${plan.name}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
          >
            {busy === "open" ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-emerald-300" />
            ) : (
              <FolderOpen className="h-3 w-3" />
            )}
          </button>
        </MinecraftTooltip>
      </div>
      {isConfirmingOverwrite ? (
        <div
          data-tooltip-stop=""
          className="mt-1 flex items-center gap-1.5 rounded-[4px] border border-amber-700 bg-amber-950/60 px-1.5 py-1"
        >
          <span className="min-w-0 flex-1 text-[11px] leading-tight text-amber-200">
            Overwrite &ldquo;{plan.name}&rdquo; with the open tab &ldquo;{activeTabName}&rdquo;?
            Votes and downloads stay.
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmingOverwrite(false);
              onOverwriteWithBoard();
            }}
            className="shrink-0 rounded-[4px] border border-amber-600 bg-amber-900 px-1.5 py-0.5 text-[10px] font-medium text-amber-100 hover:bg-amber-800"
          >
            Overwrite
          </button>
          <button
            type="button"
            onClick={() => setConfirmingOverwrite(false)}
            title="Cancel"
            aria-label="Cancel overwriting"
            className="shrink-0 rounded-[4px] p-0.5 text-amber-400 hover:text-amber-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div className="mt-0.5 flex items-center gap-2 pl-0.5 text-[10px] tabular-nums text-neutral-500">
        <TierBadge tier={plan.highestTier} />
        {plan.authorName ? (
          <span className="truncate text-neutral-400">{plan.authorName}</span>
        ) : null}
        <span className="shrink-0">{formatRelativeDate(plan.createdAt)}</span>
        {plan.machineCount > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <Cog className="h-3 w-3" /> {plan.machineCount}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <Download className="h-3 w-3" /> {plan.downloads}
        </span>
      </div>
      {tagEditor ? (
        <div
          data-tooltip-stop=""
          className="mt-1 flex flex-wrap items-center gap-1 rounded-[4px] border border-cyan-700 bg-[#17191d] p-1.5"
        >
          {tagEditor.draft.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setTagEditor({
                  draft: tagEditor.draft.filter((entry) => entry !== tag),
                  input: tagEditor.input,
                })
              }
              title={`Remove #${tag}`}
              className="rounded-[3px] border border-neutral-700 bg-[#25272c] px-1 py-px text-[9px] leading-3 text-neutral-300 hover:border-red-500 hover:text-red-400"
            >
              #{tag} ×
            </button>
          ))}
          <input
            autoFocus
            value={tagEditor.input}
            placeholder={tagEditor.draft.length === 0 ? "add tags..." : ""}
            onChange={(event) => setTagEditor({ ...tagEditor, input: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addDraftTag(tagEditor);
              }
              if (event.key === "Escape") {
                setTagEditor(undefined);
              }
            }}
            className="h-5 min-w-16 flex-1 bg-transparent text-[11px] text-neutral-100 outline-none"
          />
        </div>
      ) : (
        <TagChips tags={plan.tags ?? []} onTag={onTag} className="pl-0.5" />
      )}
      </MinecraftTooltip>
    </li>
  );
}
