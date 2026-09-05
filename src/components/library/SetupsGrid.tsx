"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCommunityUser } from "@/components/community/auth";
import { IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";
import {
  deleteCommunityPlan,
  getCommunityPlan,
  listCommunityPlans,
  patchCommunityPlan,
  voteCommunityPlan,
} from "@/lib/community/client";
import { withAuthor } from "@/lib/community/search-query";
import { openCommunityPost } from "@/lib/community/open-post";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSort, CommunityPlanSummary, EntryIcon } from "@/lib/community/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { serializeFactoryProject } from "@/lib/import-export";
import { toggleSavedSetup, useSavedSetups } from "@/lib/library/saved-setups";
import { capturePlanView } from "@/lib/plan-view";
import { SETUPS_CHANGED_EVENT, type SetupsScope } from "@/lib/setups-tab";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { LibraryDetail, previewUrlFor } from "./LibraryDetail";
import { ArmedMenuItem, LibraryMenu, MenuItem, MenuRule } from "./library-menu";
import { LibraryTile, TagEditor } from "./LibraryTile";
import { SetupsFilterBar, useSetupFilters } from "./SetupsFilterBar";

const SETUP_SORTS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "active", label: "Recently active" },
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
  { value: "lowPower", label: "Lowest power" },
  { value: "tier", label: "Highest tier" },
  { value: "commented", label: "Latest comment" },
  { value: "comments", label: "Most commented" },
];

const PAGE_SIZE = 60;

/**
 * Every tag seen on any loaded page, kept for the life of the app: a
 * half-typed #tag narrows the results to nothing, so the suggestions must
 * not come from the results alone.
 */
const knownTags = new Set<string>();

/** Edited some time after it was posted; a save in the same minute is the post itself. */
function wasEdited(plan: CommunityPlanSummary): boolean {
  return Boolean(
    plan.updatedAt &&
      new Date(plan.updatedAt).getTime() - new Date(plan.createdAt).getTime() > 60_000,
  );
}

/**
 * Pages already fetched, kept across mounts: leaving Public setups and
 * coming back shows what was there at once, while a fresh page 1 is
 * fetched behind it and takes over when it lands.
 */
const shelfMemory = new Map<string, Shelf>();

interface Shelf {
  key: string;
  page: number;
  total: number;
  plans: CommunityPlanSummary[];
}

type Armed = { id: string; what: "takedown" | "overwrite" };

/**
 * Shared setups as tiles: the whole network (NETWORK) or the account's own
 * posts (MINE), with the owner tools in the menu. Click opens the focus
 * page; from there a setup opens as a COPY in its own tab.
 */
export function SetupsGrid({
  scope,
  presetQuery,
}: {
  scope: SetupsScope | "saved";
  presetQuery?: string;
}) {
  const savedIds = useSavedSetups();
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const filters = useSetupFilters("active");
  const { query, setQuery, maxTier, setMaxTier, debouncedMaxEuT, makesKeys, takesKeys } = filters;
  const sort = filters.sort as CommunityPlanSort;
  /** The public list narrowed to the account's own posts. */
  const [onlyMine, setOnlyMine] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);
  const [shelf, setShelfState] = useState<Shelf>();
  const setShelf = (next: Shelf | ((current: Shelf | undefined) => Shelf | undefined)) =>
    setShelfState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value) {
        shelfMemory.set(value.key, value);
      }
      return value;
    });
  const [target, setTarget] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [copiedId, setCopiedId] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; left: number; top: number }>();
  const [armed, setArmed] = useState<Armed>();
  const [iconEditId, setIconEditId] = useState<string>();
  const [tagEdit, setTagEdit] = useState<{ id: string; left: number; top: number }>();
  /** The post whose preview page is up, if any. */
  const [detailId, setDetailId] = useState<string>();
  const [refreshTick, setRefreshTick] = useState(0);
  // A search handed in from elsewhere (a creator's name clicked on a focus
  // page or in a comment) replaces the box and steps off any focus page.
  const [presetSeen, setPresetSeen] = useState<string>();
  if (presetQuery !== undefined && presetQuery !== presetSeen) {
    setPresetSeen(presetQuery);
    setQuery(presetQuery);
    setDetailId(undefined);
  }
  /** The sentinel under the grid; scrolling it into view asks for the next page. */
  const moreRef = useRef<HTMLDivElement>(null);
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "this board",
  );

  useEffect(() => {
    const refresh = () => setRefreshTick((tick) => tick + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  const username = user?.username ?? "";
  const search = debouncedQuery.trim();
  const mineOnly = scope === "mine" || (scope === "network" && onlyMine && Boolean(username));
  const key = `${scope}|${mineOnly ? "mine" : ""}|${sort}|${maxTier}|${debouncedMaxEuT ?? ""}|${makesKeys.join(",")}|${takesKeys.join(",")}|${search}|${username}|${refreshTick}|${scope === "saved" ? savedIds.join(",") : ""}`;
  const activePage = target.key === key ? target.page : 1;

  useEffect(() => {
    if (scope === "mine" && !username) {
      return;
    }
    let cancelled = false;
    if (scope === "saved") {
      // The bookmarks, fetched one by one: the list is yours and short.
      void Promise.all(
        savedIds.map((id) => getCommunityPlan(id, { countView: false }).catch(() => undefined)),
      ).then((plans) => {
        if (cancelled) {
          return;
        }
        const found = plans.filter((plan): plan is CommunityPlanSummary => Boolean(plan));
        const needle = search.toLowerCase();
        setShelf({
          key,
          page: 1,
          total: found.length,
          plans: needle
            ? found.filter((plan) => plan.name.toLowerCase().includes(needle))
            : found,
        });
      });
      return () => {
        cancelled = true;
      };
    }
    void listCommunityPlans({
      sort,
      search: search || undefined,
      maxTier: maxTier || undefined,
      mine: mineOnly || undefined,
      maxEuT: debouncedMaxEuT,
      makes: makesKeys,
      takes: takesKeys,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, activePage, scope, sort, maxTier, search, username]);

  // The remembered pages stand in until the live ones arrive.
  const remembered = shelf?.key === key ? shelf : shelfMemory.get(key);
  const isCurrent = remembered !== undefined;
  const plans = remembered?.plans ?? [];
  const needsAccount = scope === "mine" && !username;
  const isLoading = !needsAccount && (!isCurrent || remembered.page !== activePage);
  const hasMore = isCurrent && remembered.plans.length < remembered.total;

  // Infinite scroll: when the sentinel under the last row comes into view
  // and the page asked for has LANDED, ask for the next one. Asking while a
  // page is still loading would cancel that fetch and ask again, forever,
  // with the grid never growing - which is what this used to do.
  useEffect(() => {
    const sentinel = moreRef.current;
    if (!sentinel || isLoading || !hasMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTarget({ key, page: activePage + 1 });
        }
      },
      // Asked for two screens early, so the next page is usually there
      // before the last row is.
      { rootMargin: "1600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [key, activePage, isLoading, hasMore]);
  for (const plan of plans) {
    for (const tag of plan.tags ?? []) {
      knownTags.add(tag);
    }
  }

  const patchPlan = (planId: string, patch: (plan: CommunityPlanSummary) => CommunityPlanSummary) =>
    setShelf((current) =>
      current
        ? { ...current, plans: current.plans.map((plan) => (plan.id === planId ? patch(plan) : plan)) }
        : current,
    );
  const dropPlan = (planId: string) =>
    setShelf((current) =>
      current
        ? {
            ...current,
            total: Math.max(0, current.total - 1),
            plans: current.plans.filter((entry) => entry.id !== planId),
          }
        : current,
    );
  const fail = (thrown: unknown, fallback: string) =>
    setError(thrown instanceof Error ? thrown.message : fallback);

  // A post shared by an old release carries the stat card that release
  // computed; the first hover asks once for the current one.
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
    } catch (thrown) {
      fail(thrown, "Voting failed.");
    }
  };

  // Your own post opens your design; anyone else's opens as a copy of yours.
  const open = async (plan: CommunityPlanSummary) => {
    setBusyId(plan.id);
    try {
      const outcome = await openCommunityPost({
        id: plan.id,
        name: plan.name,
        isMine: plan.isMine === true,
      });
      if (outcome === "copied") {
        patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      }
      setError(undefined);
    } catch (thrown) {
      fail(thrown, "Opening the setup failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const copyLink = async (plan: CommunityPlanSummary) => {
    const url = sharedPlanLink(plan.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(plan.id);
      window.setTimeout(() => setCopiedId((c) => (c === plan.id ? undefined : c)), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const saveTags = async (plan: CommunityPlanSummary, tags: string[]) => {
    if (JSON.stringify(tags) === JSON.stringify(plan.tags ?? [])) {
      return;
    }
    try {
      await patchCommunityPlan(plan.id, { tags });
      patchPlan(plan.id, (entry) => ({ ...entry, tags }));
    } catch (thrown) {
      fail(thrown, "Saving tags failed.");
    }
  };

  const saveIcon = async (planId: string, icon: EntryIcon | null) => {
    try {
      await patchCommunityPlan(planId, { icon });
      patchPlan(planId, (entry) => ({ ...entry, icon: icon ?? undefined }));
    } catch (thrown) {
      fail(thrown, "Saving the icon failed.");
    }
  };

  // The OPEN TAB becomes this post's new content.
  const overwriteWithBoard = async (plan: CommunityPlanSummary) => {
    try {
      const state = useFactoryStore.getState();
      await patchCommunityPlan(plan.id, {
        plan: JSON.parse(
          serializeFactoryProject({ ...state.project, view: capturePlanView() }),
        ) as unknown,
      });
      state.setProjectCommunityLink(plan.id);
      setError(undefined);
      setRefreshTick((tick) => tick + 1);
    } catch (thrown) {
      fail(thrown, "Overwriting the post failed.");
    }
  };

  const setVisibility = async (plan: CommunityPlanSummary) => {
    const next = !plan.isPublic;
    try {
      await patchCommunityPlan(plan.id, { isPublic: next });
      if (scope === "network" && !next) {
        dropPlan(plan.id);
      } else {
        patchPlan(plan.id, (entry) => ({ ...entry, isPublic: next }));
      }
    } catch (thrown) {
      fail(thrown, "Changing visibility failed.");
    }
  };

  const takeDown = async (plan: CommunityPlanSummary) => {
    try {
      await deleteCommunityPlan(plan.id);
      dropPlan(plan.id);
    } catch (thrown) {
      fail(thrown, "Taking the post down failed.");
    }
  };

  const closeMenu = () => {
    setMenu(undefined);
    setArmed(undefined);
  };
  const menuPlan = menu ? plans.find((plan) => plan.id === menu.id) : undefined;
  const tagPlan = tagEdit ? plans.find((plan) => plan.id === tagEdit.id) : undefined;
  const detailPlan = detailId ? plans.find((plan) => plan.id === detailId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {detailPlan ? (
        <LibraryDetail
          entry={{
            name: detailPlan.name,
            icon: detailPlan.icon,
            creator: detailPlan.authorName,
            onCreator: detailPlan.authorName
              ? () => {
                  setDetailId(undefined);
                  setQuery((current) => withAuthor(current, detailPlan.authorName ?? ""));
                }
              : undefined,
            when: `posted ${formatRelativeDate(detailPlan.createdAt)}`,
            tier: detailPlan.highestTier,
            machines: detailPlan.machineCount,
            euT: detailPlan.totalEuT,
            description: detailPlan.description || undefined,
            tags: detailPlan.tags,
            needs: detailPlan.needs,
            outputs: detailPlan.outputs,
            previewUrl: previewUrlFor(detailPlan.id),
            downloads: detailPlan.downloads,
            marks: {
              posted: detailPlan.isMine === true,
              privatePost: detailPlan.isMine === true && !detailPlan.isPublic,
            },
            commentsPlanId: detailPlan.id,
            onEdit: detailPlan.isMine
              ? async (patch) => {
                  try {
                    await patchCommunityPlan(detailPlan.id, {
                      name: patch.name,
                      description: patch.description,
                      tags: patch.tags,
                    });
                    patchPlan(detailPlan.id, (entry) => ({ ...entry, ...patch }));
                  } catch (thrown) {
                    fail(thrown, "Saving the post failed.");
                  }
                }
              : undefined,
            editTags: true,
            onPickIcon: detailPlan.isMine ? () => setIconEditId(detailPlan.id) : undefined,
            primary: {
              label: detailPlan.isMine ? "Open" : "Open a copy",
              onClick: () => {
                setDetailId(undefined);
                void open(detailPlan);
              },
            },
            keys: [
              {
                label: detailPlan.myVote === 1 ? "Take back your vote" : "Vote this up",
                icon: "vote",
                active: detailPlan.myVote === 1,
                count: detailPlan.score,
                onClick: () => void vote(detailPlan),
              },
              {
                label: "Copy the share link",
                icon: "link",
                onClick: () => void copyLink(detailPlan),
              },
              ...(detailPlan.isMine
                ? [
                    {
                      label: detailPlan.isPublic ? "Make it private" : "Make it public",
                      icon: detailPlan.isPublic ? ("private" as const) : ("public" as const),
                      onClick: () => void setVisibility(detailPlan),
                    },
                  ]
                : []),
            ],
          }}
          onClose={() => setDetailId(undefined)}
        />
      ) : (
        <>
      {/* Two rows: what you are looking for, then what it must be. */}
      <SetupsFilterBar
        filters={filters}
        placeholder={
          scope === "mine"
            ? "Search my posts (#tag, @name)"
            : scope === "saved"
              ? "Search saved setups"
              : "Search public setups (#tag, @name)"
        }
        sortOptions={SETUP_SORTS}
        knownTags={knownTags}
        myPosts={
          scope === "network" && username
            ? { checked: onlyMine, onChange: setOnlyMine }
            : undefined
        }
        itemFilter={scope !== "saved"}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2"
        onScroll={(event) => {
          // Belt and braces beside the sentinel: within two screens of the
          // end, ask for the next page.
          const el = event.currentTarget;
          if (hasMore && !isLoading && el.scrollTop + el.clientHeight > el.scrollHeight - 1600) {
            setTarget({ key, page: activePage + 1 });
          }
        }}
      >
        {error ? <p className="mb-2 text-[11px] text-red-400">{error}</p> : null}
        {needsAccount && !isAuthLoading ? (
          <p className="text-[12px] leading-relaxed text-[var(--mc-ink-muted)]">
            Sign in (top right) to see your posts here. Share a design with the Share button
            in the header, then manage it from this page.
          </p>
        ) : isLoading && plans.length === 0 ? (
          // Loading is a moment the whole page is about, so it sits in the
          // middle, large, and breathes: not a whisper in the corner.
          <div className="flex h-full min-h-[240px] items-center justify-center">
            <LoaderCircle className="h-14 w-14 animate-spin text-neutral-200" aria-label="Loading" />
          </div>
        ) : plans.length === 0 && !error ? (
          <p className="text-[12px] leading-relaxed text-[var(--mc-ink-muted)]">
            {search
              ? "No setups match."
              : scope === "mine"
                ? "Nothing posted yet. Share a design with the Share button in the header."
                : scope === "saved"
                  ? "Nothing saved yet. Click the ribbon on a public setup to keep it here."
                  : "Nothing shared yet."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
              {plans.map((plan) => (
                <div key={plan.id} className="h-full" onMouseEnter={() => refreshStats(plan.id)}>
                  <LibraryTile
                    icon={plan.icon}
                    name={plan.name}
                    creator={plan.authorName}
                    onCreator={plan.authorName ? () => setQuery((current) => withAuthor(current, plan.authorName ?? "")) : undefined}
                    when={
                      copiedId === plan.id
                        ? "link copied"
                        : sort === "commented" && plan.lastCommentAt
                          ? `commented ${formatRelativeDate(plan.lastCommentAt)}`
                          : sort === "active" && plan.lastActivityAt
                            ? `active ${formatRelativeDate(plan.lastActivityAt)}`
                            : wasEdited(plan)
                              ? `edited ${formatRelativeDate(plan.updatedAt ?? plan.createdAt)}`
                              : `posted ${formatRelativeDate(plan.createdAt)}`
                    }
                    tier={plan.highestTier}
                    onTier={
                      plan.highestTierIndex >= 0
                        ? () => setMaxTier(String(plan.highestTierIndex))
                        : undefined
                    }
                    machines={plan.machineCount}
                    euT={plan.totalEuT}
                    social={{
                      score: plan.score,
                      myVote: plan.myVote,
                      onVote: () => void vote(plan),
                      downloads: plan.downloads,
                      comments: plan.commentCount,
                    }}
                    marks={{ posted: plan.isMine === true, privatePost: plan.isMine && !plan.isPublic }}
                    saved={savedIds.includes(plan.id)}
                    onSave={() => toggleSavedSetup(plan.id)}
                    busy={busyId === plan.id}
                    menuOpen={menu?.id === plan.id}
                    onOpen={() => {
                      refreshStats(plan.id);
                      setDetailId(plan.id);
                    }}
                    onMenu={(left, top) => {
                      setArmed(undefined);
                      setMenu({ id: plan.id, left, top });
                    }}
                  />
                </div>
              ))}
            </div>
            {hasMore ? (
              // The next page comes on its own as this sentinel scrolls into
              // view; the spinner is only there to say so.
              <div ref={moreRef} className="mt-3 flex h-10 items-center justify-center">
                <LoaderCircle className="h-5 w-5 animate-spin text-neutral-400" aria-label="Loading more" />
              </div>
            ) : null}
          </>
        )}
      </div>
        </>
      )}

      {menu && menuPlan ? (
        <LibraryMenu
          left={menu.left}
          top={menu.top}
          label={`Options for ${menuPlan.name}`}
          onClose={closeMenu}
        >
          <MenuItem
            label={menuPlan.isMine ? "Open" : "Open a copy as a tab"}
            onClick={() => {
              closeMenu();
              void open(menuPlan);
            }}
          />
          <MenuItem
            label="Copy link"
            onClick={() => {
              closeMenu();
              void copyLink(menuPlan);
            }}
          />
          {menuPlan.isMine ? (
            <>
              <MenuRule />
              <MenuItem
                label={menuPlan.isPublic ? "Make private" : "Make public"}
                onClick={() => {
                  closeMenu();
                  void setVisibility(menuPlan);
                }}
              />
              <MenuItem
                label="Edit tags"
                onClick={() => {
                  setTagEdit({ id: menuPlan.id, left: menu.left, top: menu.top });
                  closeMenu();
                }}
              />
              <MenuItem
                label="Change icon"
                onClick={() => {
                  closeMenu();
                  setIconEditId(menuPlan.id);
                }}
              />
              <ArmedMenuItem
                label={`Replace with "${activeTabName}"`}
                armedLabel="Confirm: replace the post"
                armed={armed?.id === menuPlan.id && armed.what === "overwrite"}
                onArm={() => setArmed({ id: menuPlan.id, what: "overwrite" })}
                onFire={() => {
                  closeMenu();
                  void overwriteWithBoard(menuPlan);
                }}
              />
              <ArmedMenuItem
                label="Take down"
                armedLabel="Confirm: take it down for everyone"
                armed={armed?.id === menuPlan.id && armed.what === "takedown"}
                onArm={() => setArmed({ id: menuPlan.id, what: "takedown" })}
                onFire={() => {
                  closeMenu();
                  void takeDown(menuPlan);
                }}
              />
            </>
          ) : null}
        </LibraryMenu>
      ) : null}

      {tagEdit && tagPlan ? (
        <TagEditor
          left={tagEdit.left}
          top={tagEdit.top}
          initialTags={tagPlan.tags ?? []}
          onClose={(tags) => {
            setTagEdit(undefined);
            void saveTags(tagPlan, tags);
          }}
        />
      ) : null}

      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
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
    </div>
  );
}
