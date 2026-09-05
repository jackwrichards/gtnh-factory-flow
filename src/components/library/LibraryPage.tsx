"use client";

import { Bookmark, Factory, Folder, FolderPlus, LayoutGrid, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useCommunityUser } from "@/components/community/auth";
import { IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";
import { deleteCommunityPlan, listCommunityPlans, patchCommunityPlan } from "@/lib/community/client";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSummary } from "@/lib/community/types";
import type { DesignSummary } from "@/lib/designs/design-library";
import { SETUPS_CHANGED_EVENT, notifySetupsChanged, requestShareDialog } from "@/lib/setups-tab";
import { setLibraryView, useLibraryTab } from "@/lib/library/library-tab";
import { playBoardSound } from "@/lib/board-sounds";
import { useSavedSetups } from "@/lib/library/saved-setups";
import { useDesignStore } from "@/store/design-store";
import { LibraryDetail, previewUrlFor } from "./LibraryDetail";
import { ArmedMenuItem, LibraryMenu, MenuHeading, MenuItem, MenuRule } from "./library-menu";
import { Face, InlineName, LibraryTile } from "./LibraryTile";
import { SetupsGrid } from "./SetupsGrid";
import { SetupsFilterBar, useSetupFilters } from "./SetupsFilterBar";
import { parsePlanSearch } from "@/lib/community/search-query";

/**
 * The Library: everything you have and everything the network has, as one
 * kind of tile (see LibraryTile).
 *
 * YOUR designs are ONE GRID, no sections: the OPEN chip says what is on
 * the strip and the globe says what is posted. The rail on the left is
 * All, then your folders: a folder holds the grid to itself, a tile
 * dragged onto one is filed there (or Move to in its menu, like adding to
 * a playlist). Search, tier and sort at the top apply to whatever is
 * showing. Below a rule sits the one other page, Public setups.
 *
 * Click a tile to open it, right click or the dots for its menu. The globe
 * is green when the design is posted and dim when it is not; clicking the
 * dim one posts it. Posted tiles carry a link button. Closing a tab never
 * deletes; delete lives here, armed.
 */

const POSTS_PAGE_SIZE = 48;
const POSTS_MAX_PAGES = 6;

type SortKey = "edited" | "name" | "created" | "tier" | "power" | "lowPower" | "machines";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "edited", label: "Last edited" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
  { value: "tier", label: "Highest tier" },
  { value: "power", label: "Highest power" },
  { value: "lowPower", label: "Lowest power" },
  { value: "machines", label: "Most machines" },
];

export function LibraryPage() {
  const library = useLibraryTab();
  const designs = useDesignStore((state) => state.designs);
  const folders = useDesignStore((state) => state.folders);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const copyDesign = useDesignStore((state) => state.copyDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const closeDesign = useDesignStore((state) => state.closeDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const moveDesignToFolder = useDesignStore((state) => state.moveDesignToFolder);
  const toggleFavorite = useDesignStore((state) => state.toggleFavorite);
  const createFolder = useDesignStore((state) => state.createFolder);
  const renameFolder = useDesignStore((state) => state.renameFolder);
  const deleteFolder = useDesignStore((state) => state.deleteFolder);
  const updateDesignIdentity = useDesignStore((state) => state.updateDesignIdentity);

  // The same bar and the same fields as Public setups (SetupsFilterBar);
  // here they are applied in memory over the designs.
  const filters = useSetupFilters("edited");
  const { query, maxTier, setMaxTier } = filters;
  const sort = filters.sort as SortKey;
  /** The design whose icon is being picked on the preview page. */
  const [iconEditId, setIconEditId] = useState<string>();
  const [tileMenu, setTileMenu] = useState<{ designId: string; left: number; top: number }>();
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; left: number; top: number }>();
  const [armed, setArmed] = useState<{ id: string; what: "delete" }>();
  const [renamingId, setRenamingId] = useState<string>();
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [namingFolder, setNamingFolder] = useState(false);
  const [copiedId, setCopiedId] = useState<string>();
  const [error, setError] = useState<string>();
  /** Our own drag: the ghost card, where it is, and what it is over. */
  const [drag, setDrag] = useState<TileDrag>();
  /** Multi-select: Ctrl-click toggles, Shift-click ranges from the anchor. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string>();
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  /** The design whose preview page is up, if any. */
  const [detailId, setDetailId] = useState<string>();
  const { posts: myPosts, signedIn } = useMyPosts();
  const savedIds = useSavedSetups();

  // The library has the search's voice for its pages: a page turned for
  // every view and every focus page. Arriving and leaving are silent,
  // like switching tabs.
  const turnedRef = useRef(false);
  const pageKey = `${library.view.kind}:${viewFolderKey(library.view)}:${detailId ?? ""}`;
  useEffect(() => {
    if (!turnedRef.current) {
      turnedRef.current = true;
      return;
    }
    playBoardSound("shelfTurn");
  }, [pageKey]);

  const closeMenus = useCallback(() => {
    setTileMenu(undefined);
    setFolderMenu(undefined);
    setArmed(undefined);
  }, []);

  // A view naming a folder that has since gone falls back to everything.
  useEffect(() => {
    if (
      library.view.kind === "folder" &&
      !folders.some((folder) => folder.id === (library.view as { folderId: string }).folderId)
    ) {
      setLibraryView({ kind: "all" });
    }
  }, [folders, library.view]);

  const viewFolderId = library.view.kind === "folder" ? library.view.folderId : undefined;
  const favoritesOnly = library.view.kind === "favorites";
  const parsedSearch = parsePlanSearch(query);
  const search = parsedSearch.text.toLowerCase();
  const { maxEuT, makesKeys, takesKeys } = filters;
  const shown = useMemo(() => {
    const tierLimit = maxTier === "" ? undefined : Number(maxTier);
    return sortDesignsBy(
      designs.filter(
        (design) =>
          (!viewFolderId || design.folderId === viewFolderId) &&
          (!favoritesOnly || design.favorite === true) &&
          (!search || design.name.toLowerCase().includes(search)) &&
          // #tags are the post's: an unposted design has none to match.
          parsedSearch.tags.every((tag) =>
            myPosts?.get(design.communityPlanId ?? "")?.tags.includes(tag),
          ) &&
          (maxEuT === undefined ||
            (design.stats?.euT !== undefined && design.stats.euT <= maxEuT)) &&
          makesKeys.every((key) => design.stats?.makes?.includes(key)) &&
          takesKeys.every((key) => design.stats?.takes?.includes(key)) &&
          // A design with no stat row yet cannot answer the tier question,
          // so it shows under "any" and hides under a limit.
          (tierLimit === undefined ||
            (design.stats !== undefined && design.stats.tierIndex <= tierLimit)),
      ),
      sort,
    );
  }, [designs, viewFolderId, favoritesOnly, search, parsedSearch.tags, myPosts, maxEuT, makesKeys, takesKeys, maxTier, sort]);
  const knownTags = useMemo(
    () => [...(myPosts?.values() ?? [])].flatMap((post) => post.tags ?? []),
    [myPosts],
  );

  const perFolder = useMemo(
    () =>
      new Map(
        folders.map((folder) => [
          folder.id,
          designs.filter((design) => design.folderId === folder.id).length,
        ]),
      ),
    [designs, folders],
  );

  // The selection lives in the grid that is showing: a view change or
  // Escape clears it, and ids that scroll out of the filter drop out.
  const shownIds = useMemo(() => shown.map((design) => design.id), [shown]);
  // Derived, not pruned: ids that scroll out of the filter simply stop
  // counting, and come back if the filter lets them back in.
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => shownIds.includes(id))),
    [selected, shownIds],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(new Set());
        setBulkDeleteArmed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selectTile = (id: string, mode: "toggle" | "range") => {
    setBulkDeleteArmed(false);
    if (mode === "range" && anchorId && shownIds.includes(anchorId)) {
      const from = shownIds.indexOf(anchorId);
      const to = shownIds.indexOf(id);
      const [start, end] = from < to ? [from, to] : [to, from];
      setSelected((current) => new Set([...current, ...shownIds.slice(start, end + 1)]));
      return;
    }
    setAnchorId(id);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setBulkDeleteArmed(false);
  };
  const selectedIds = [...visibleSelected];
  const closeSelected = async () => {
    await useDesignStore.getState().closeDesigns(selectedIds);
    clearSelection();
  };
  const fileSelected = async (folderId: string | undefined) => {
    for (const id of selectedIds) {
      await moveDesignToFolder(id, folderId);
    }
    clearSelection();
  };
  const deleteSelected = async () => {
    for (const id of selectedIds) {
      await deleteDesign(id);
    }
    clearSelection();
  };
  /** What a drag from `id` carries: the selection when it is part of one. */
  const dragIdsFor = (id: string) => (visibleSelected.has(id) ? selectedIds : [id]);

  // The click that ends a drag must not also open the tile.
  const suppressClickRef = useRef(false);

  /**
   * OUR OWN DRAG, not the browser's: a press on a tile that moves a few
   * pixels becomes a small card riding the pointer (the face, the name, a
   * count when the selection comes along). Rail chips light as it passes;
   * releasing on a collection files the lot there, and releasing on New
   * collection makes one on the spot and files them into it.
   */
  const beginTileDrag = (design: DesignSummary, event: ReactPointerEvent) => {
    const ids = dragIdsFor(design.id);
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let over: string | undefined;
    const targetAt = (x: number, y: number): string | undefined => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]");
      return hit?.dataset.dropTarget;
    };
    const move = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) {
          return;
        }
        started = true;
        suppressClickRef.current = true;
      }
      over = targetAt(moveEvent.clientX, moveEvent.clientY);
      setDrag({
        ids,
        name: design.name,
        icon: design.icon,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        over,
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDrag(undefined);
      if (!started) {
        return;
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      if (over === "new") {
        void (async () => {
          const folder = await createFolder("New collection");
          for (const id of ids) {
            await moveDesignToFolder(id, folder.id);
          }
          setLibraryView({ kind: "folder", folderId: folder.id });
          setRenamingFolderId(folder.id);
        })();
        clearSelection();
      } else if (over === "favorites") {
        // Dropping on Favorites stars; it never unstars, so a mixed drag ends
        // with every design starred rather than half of them flipped.
        const unstarred = ids.filter((id) => !designs.find((d) => d.id === id)?.favorite);
        void (async () => {
          for (const id of unstarred) {
            await toggleFavorite(id);
          }
        })();
        if (ids.length > 1) {
          clearSelection();
        }
      } else if (over?.startsWith("folder:")) {
        const folderId = over.slice("folder:".length);
        void (async () => {
          for (const id of ids) {
            await moveDesignToFolder(id, folderId);
          }
        })();
        if (ids.length > 1) {
          clearSelection();
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const open = (id: string) => void switchToDesign(id);
  const postDesign = async (id: string) => {
    await switchToDesign(id);
    requestShareDialog();
  };
  const copyLink = async (design: DesignSummary) => {
    if (!design.communityPlanId) {
      return;
    }
    const url = sharedPlanLink(design.communityPlanId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(design.id);
      window.setTimeout(() => setCopiedId((c) => (c === design.id ? undefined : c)), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  const setPostVisibility = async (design: DesignSummary, isPublic: boolean) => {
    if (!design.communityPlanId) {
      return;
    }
    try {
      await patchCommunityPlan(design.communityPlanId, { isPublic });
      notifySetupsChanged();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Changing visibility failed.");
    }
  };
  /**
   * A design and its post are one thing, so deleting the design takes the
   * post down. A post that cannot be reached (signed out, already gone) does
   * not stop the delete; a leftover post is the owner's to find in Public
   * setups.
   */
  const deleteDesign = async (id: string) => {
    const design = designs.find((entry) => entry.id === id);
    if (design?.communityPlanId && signedIn) {
      try {
        await deleteCommunityPlan(design.communityPlanId);
        notifySetupsChanged();
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : "Taking the post down failed.");
      }
    }
    await removeDesign(id);
  };

  const menuDesign = tileMenu
    ? designs.find((design) => design.id === tileMenu.designId)
    : undefined;
  const menuPost = menuDesign?.communityPlanId
    ? myPosts?.get(menuDesign.communityPlanId)
    : undefined;
  const menuFolder = folderMenu
    ? folders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;
  const detailDesign = detailId ? designs.find((design) => design.id === detailId) : undefined;
  const detailPost = detailDesign?.communityPlanId
    ? myPosts?.get(detailDesign.communityPlanId)
    : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#101215] text-[var(--mc-ink)]">
      <div className="min-h-0 flex-1">
        {/* The frame is the recipe search's: 4px, one shade off the floor,
            an accent by contrast rather than colour, flush to the board. */}
        <div className="flex h-full min-h-0 overflow-hidden border-4 border-[#23262d] bg-[#101215] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)] compact:flex-col compact:border-0 compact:shadow-none">
          {/* THE RAIL: all, then folders. On a phone, one row of chips. */}
          {/* On a phone the rail is one dropdown: the chips in a row had to
              be scrolled sideways to be found at all. */}
          <div className="hidden shrink-0 border-b border-[var(--mc-33)] px-2 py-1.5 compact:block">
            <select
              value={railValue(library.view)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "new") {
                  const name = window.prompt("Name the collection");
                  if (name?.trim()) {
                    void createFolder(name).then((folder) =>
                      setLibraryView({ kind: "folder", folderId: folder.id }),
                    );
                  }
                  return;
                }
                playBoardSound("shelfTick");
                setLibraryView(railView(value));
              }}
              aria-label="Where in the library"
              className="h-9 w-full border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-[13px] font-bold text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
            >
              <option value="all">My designs ({designs.length})</option>
              <option value="favorites">
                Favorites ({designs.filter((design) => design.favorite).length})
              </option>
              {folders.map((folder) => (
                <option key={folder.id} value={`folder:${folder.id}`}>
                  {folder.name} ({perFolder.get(folder.id) ?? 0})
                </option>
              ))}
              <option value="new">New collection…</option>
              <option value="public">Public setups</option>
              <option value="saved">Saved ({savedIds.length})</option>
            </select>
          </div>
          <aside className="flex w-[184px] shrink-0 flex-col gap-1 overflow-y-auto bg-[#101215] px-2 py-2 compact:hidden">
            <RailItem
              icon={LayoutGrid}
              label="My designs"
              count={designs.length}
              selected={library.view.kind === "all"}
              onClick={() => setLibraryView({ kind: "all" })}
            />
            {/* Favorites ships with the library: a collection that is a star,
                not a name, and cannot be deleted or renamed. */}
            <RailItem
              icon={Star}
              label="Favorites"
              nested
              count={designs.filter((design) => design.favorite).length}
              selected={library.view.kind === "favorites"}
              highlighted={drag?.over === "favorites"}
              dropTarget="favorites"
              onClick={() => setLibraryView({ kind: "favorites" })}
            />
            {folders.map((folder) => (
              <RailItem
                key={folder.id}
                icon={Folder}
                label={folder.name}
                nested
                count={perFolder.get(folder.id) ?? 0}
                selected={viewFolderId === folder.id}
                highlighted={drag?.over === `folder:${folder.id}`}
                dropTarget={`folder:${folder.id}`}
                renaming={renamingFolderId === folder.id}
                onRename={(name) => {
                  setRenamingFolderId(undefined);
                  void renameFolder(folder.id, name);
                }}
                onCancelRename={() => setRenamingFolderId(undefined)}
                onClick={() => setLibraryView({ kind: "folder", folderId: folder.id })}
                onDoubleClick={() => setRenamingFolderId(folder.id)}
                onMenu={(left, top) => {
                  closeMenus();
                  setFolderMenu({ folderId: folder.id, left, top });
                }}
              />
            ))}
            {namingFolder ? (
              <div className="ml-3 flex h-7 items-center gap-1.5 px-2 compact:ml-0">
                <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--mc-ink-muted)]" aria-hidden />
                <InlineName
                  initialName=""
                  placeholder="Collection name"
                  onCommit={(name) => {
                    setNamingFolder(false);
                    if (name.trim()) {
                      void createFolder(name).then((folder) =>
                        setLibraryView({ kind: "folder", folderId: folder.id }),
                      );
                    }
                  }}
                  onCancel={() => setNamingFolder(false)}
                />
              </div>
            ) : null}
            <button
              type="button"
              data-drop-target="new"
              onClick={() => setNamingFolder(true)}
              className={[
                "ml-3 flex h-8 shrink-0 items-center gap-1.5 border-2 border-dashed px-2 hover:border-[var(--mc-61)] hover:text-[var(--mc-ink)] compact:ml-0",
                drag?.over === "new"
                  ? "border-cyan-400 text-[var(--mc-ink)]"
                  : "border-[var(--mc-47)] text-[var(--mc-ink-muted)]",
              ].join(" ")}
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              <span className="whitespace-nowrap text-[12px] font-bold">New collection</span>
            </button>

            <div className="mx-1 my-2 border-t-2 border-[#23262d] compact:mx-2 compact:my-0 compact:h-4 compact:border-l compact:border-t-0" />
            <RailItem
              icon={Factory}
              label="Public setups"
              selected={library.view.kind === "public"}
              onClick={() => setLibraryView({ kind: "public" })}
            />
            <RailItem
              icon={Bookmark}
              label="Saved"
              nested
              count={savedIds.length}
              selected={library.view.kind === "saved"}
              onClick={() => setLibraryView({ kind: "saved" })}
            />
          </aside>

          {/* THE PAGE. */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {library.view.kind === "public" ? (
              <SetupsGrid scope="network" presetQuery={library.view.search} />
            ) : library.view.kind === "saved" ? (
              <SetupsGrid scope="saved" />
            ) : detailDesign ? (
              <LibraryDetail
                entry={{
                  name: detailDesign.name,
                  icon: detailDesign.icon,
                  creator: folders.find((folder) => folder.id === detailDesign.folderId)?.name,
                  when: `edited ${formatRelativeDate(detailDesign.updatedAt)}`,
                  tier: detailDesign.stats?.tier,
                  machines: detailDesign.stats?.machines,
                  euT: detailDesign.stats?.euT,
                  description: detailPost?.description || undefined,
                  tags: detailPost?.tags,
                  needs: detailPost?.needs,
                  outputs: detailPost?.outputs,
                  previewUrl: detailPost ? previewUrlFor(detailPost.id) : undefined,
                  marks: {
                    open: !detailDesign.closed,
                    posted: Boolean(detailPost),
                    privatePost: detailPost ? !detailPost.isPublic : false,
                  },
                  commentsPlanId: detailPost?.id,
                  primary: {
                    label: "Open",
                    onClick: () => {
                      setDetailId(undefined);
                      open(detailDesign.id);
                    },
                  },
                  onEdit: async (patch) => {
                    await updateDesignIdentity(detailDesign.id, {
                      name: patch.name,
                      description: patch.description,
                    });
                    if (detailPost) {
                      try {
                        await patchCommunityPlan(detailPost.id, {
                          name: patch.name,
                          description: patch.description,
                          tags: patch.tags,
                        });
                        notifySetupsChanged();
                      } catch (thrown) {
                        setError(thrown instanceof Error ? thrown.message : "Saving the post failed.");
                      }
                    }
                  },
                  editTags: Boolean(detailPost),
                  onPickIcon: () => setIconEditId(detailDesign.id),
                  keys: [
                    ...(detailPost
                      ? [
                          {
                            label: "Copy the share link",
                            icon: "link" as const,
                            onClick: () => void copyLink(detailDesign),
                          },
                          {
                            label: detailPost.isPublic ? "Make it private" : "Make it public",
                            icon: detailPost.isPublic ? ("private" as const) : ("public" as const),
                            onClick: () => void setPostVisibility(detailDesign, !detailPost.isPublic),
                          },
                        ]
                      : signedIn
                        ? [
                            {
                              label: "Post as a public setup",
                              icon: "post" as const,
                              onClick: () => {
                                setDetailId(undefined);
                                void postDesign(detailDesign.id);
                              },
                            },
                          ]
                        : []),
                    {
                      label: "Delete this design",
                      icon: "delete" as const,
                      confirm: detailPost
                        ? `Delete "${detailDesign.name}"? Its post comes down with it. This cannot be undone.`
                        : `Delete "${detailDesign.name}" from your library? This cannot be undone.`,
                      onClick: () => {
                        setDetailId(undefined);
                        void deleteDesign(detailDesign.id);
                      },
                    },
                  ],
                }}
                onClose={() => setDetailId(undefined)}
              />
                  ) : (
              <>
                <SetupsFilterBar
                  filters={filters}
                  placeholder="Search your designs (#tag)"
                  sortOptions={SORTS}
                  knownTags={knownTags}
                />

                {visibleSelected.size > 0 ? (
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--mc-33)] bg-cyan-500/10 px-4 text-xs text-[var(--mc-ink)] compact:px-2">
                    <span className="font-bold text-cyan-200">{visibleSelected.size} selected</span>
                    <span className="text-[var(--mc-ink-muted)] compact:hidden">
                      Ctrl-click to add, Shift-click for a run
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {selectedIds.some((id) => !designs.find((d) => d.id === id)?.closed) ? (
                        <BarButton onClick={() => void closeSelected()}>Close tabs</BarButton>
                      ) : null}
                      {folders.length > 0 ? (
                        <select
                          value=""
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value) {
                              void fileSelected(value === "none" ? undefined : value);
                            }
                          }}
                          aria-label="Add the selection to a collection"
                          className="h-6 border-2 border-[var(--mc-33)] bg-[#17191d] px-1 text-xs text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
                        >
                          <option value="">Add to collection…</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                          <option value="none">No collection</option>
                        </select>
                      ) : null}
                      <BarButton
                        tone="danger"
                        onClick={() => {
                          if (bulkDeleteArmed) {
                            void deleteSelected();
                          } else {
                            setBulkDeleteArmed(true);
                          }
                        }}
                      >
                        {bulkDeleteArmed ? `Confirm delete ${visibleSelected.size}` : "Delete"}
                      </BarButton>
                      <BarButton onClick={clearSelection}>Clear</BarButton>
                    </span>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2">
                  {error ? <p className="mb-2 text-[11px] text-red-400">{error}</p> : null}
                  {shown.length === 0 ? (
                    <p className="px-0.5 pt-1 text-[12px] leading-relaxed text-[var(--mc-ink-muted)]">
                      {search || maxTier
                        ? "No designs match."
                        : viewFolderId
                          ? "Nothing here yet. Drag a design onto this collection, or use Add to collection in its menu."
                          : favoritesOnly
                            ? "Nothing starred yet. Click the star on a design to put it here."
                            : "Nothing here yet. Press + on the tab strip to start one."}
                    </p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
                      {shown.map((design) => {
                        const post = design.communityPlanId
                          ? myPosts?.get(design.communityPlanId)
                          : undefined;
                        // A design opened as a copy of someone else's post is YOURS now: it
                        // posts, edits and wears marks like anything you made from scratch.
                        // The link it keeps to its source serves the plan card's reset only.
                        return (
                          <LibraryTile
                            key={design.id}
                            onDragPress={(event) => beginTileDrag(design, event)}
                            selected={visibleSelected.has(design.id)}
                            onSelect={(mode) => selectTile(design.id, mode)}
                            icon={design.icon}
                            name={design.name}
                            creator={
                              viewFolderId
                                ? undefined
                                : folders.find((folder) => folder.id === design.folderId)?.name
                            }
                            when={
                              copiedId === design.id
                                ? "link copied"
                                : formatRelativeDate(design.updatedAt)
                            }
                            tier={design.stats?.tier}
                            onTier={
                              design.stats && design.stats.tierIndex >= 0
                                ? () => setMaxTier(String(design.stats?.tierIndex))
                                : undefined
                            }
                            machines={design.stats?.machines}
                            euT={design.stats?.euT}
                            marks={{
                              open: !design.closed,
                              posted: Boolean(post),
                              privatePost: post ? !post.isPublic : false,
                            }}
                            favorite={design.favorite === true}
                            onFavorite={() => void toggleFavorite(design.id)}
                            onPost={
                              !post && signedIn
                                ? () => void postDesign(design.id)
                                : undefined
                            }
                            onCopyLink={post ? () => void copyLink(design) : undefined}
                            menuOpen={tileMenu?.designId === design.id}
                            onOpen={() => {
                              if (suppressClickRef.current) {
                                return;
                              }
                              setDetailId(design.id);
                            }}
                            onMenu={(left, top) => {
                              closeMenus();
                              setTileMenu({ designId: design.id, left, top });
                            }}
                            renaming={
                              renamingId === design.id
                                ? {
                                    onCommit: (name) => {
                                      setRenamingId(undefined);
                                      void renameDesign(design.id, name);
                                    },
                                    onCancel: () => setRenamingId(undefined),
                                  }
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {tileMenu && menuDesign ? (
        <LibraryMenu
          left={tileMenu.left}
          top={tileMenu.top}
          label={`Options for ${menuDesign.name}`}
          onClose={closeMenus}
        >
          <MenuItem
            label="Open"
            onClick={() => {
              closeMenus();
              open(menuDesign.id);
            }}
          />
          {!menuDesign.closed ? (
            <MenuItem
              label="Close tab"
              onClick={() => {
                closeMenus();
                void closeDesign(menuDesign.id);
              }}
            />
          ) : null}
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingId(menuDesign.id);
            }}
          />
          <MenuItem
            label="Duplicate"
            onClick={() => {
              closeMenus();
              void copyDesign(menuDesign.id);
            }}
          />
          {folders.length > 0 ? (
            <>
              <MenuHeading>Add to collection</MenuHeading>
              {folders.map((folder) => (
                <MenuItem
                  key={folder.id}
                  label={folder.name}
                  indent
                  checked={menuDesign.folderId === folder.id}
                  onClick={() => {
                    closeMenus();
                    void moveDesignToFolder(
                      menuDesign.id,
                      menuDesign.folderId === folder.id ? undefined : folder.id,
                    );
                  }}
                />
              ))}
            </>
          ) : null}
          <MenuRule />
          {menuPost ? (
            <>
              <MenuItem
                label="Copy link"
                onClick={() => {
                  closeMenus();
                  void copyLink(menuDesign);
                }}
              />
              <MenuItem
                label={menuPost.isPublic ? "Make private" : "Make public"}
                onClick={() => {
                  closeMenus();
                  void setPostVisibility(menuDesign, !menuPost.isPublic);
                }}
              />
            </>
          ) : signedIn ? (
            <MenuItem
              label="Post as a public setup"
              onClick={() => {
                closeMenus();
                void postDesign(menuDesign.id);
              }}
            />
          ) : null}
          <ArmedMenuItem
            label="Delete"
            armedLabel={menuPost ? "Confirm delete (the post comes down too)" : "Confirm delete"}
            armed={armed?.id === menuDesign.id && armed.what === "delete"}
            onArm={() => setArmed({ id: menuDesign.id, what: "delete" })}
            onFire={() => {
              closeMenus();
              void deleteDesign(menuDesign.id);
            }}
          />
        </LibraryMenu>
      ) : null}

      {drag ? <DragGhost drag={drag} /> : null}

      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
          suggestions={iconSuggestionsFromStats(detailPost?.needs, detailPost?.outputs)}
          onPick={(icon) => {
            const id = iconEditId;
            setIconEditId(undefined);
            void updateDesignIdentity(id, { icon });
            if (detailPost) {
              void patchCommunityPlan(detailPost.id, { icon }).then(notifySetupsChanged, () => undefined);
            }
          }}
          onClear={
            detailDesign?.icon
              ? () => {
                  const id = iconEditId;
                  setIconEditId(undefined);
                  void updateDesignIdentity(id, { icon: null });
                  if (detailPost) {
                    void patchCommunityPlan(detailPost.id, { icon: null }).then(notifySetupsChanged, () => undefined);
                  }
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}

      {folderMenu && menuFolder ? (
        <LibraryMenu
          left={folderMenu.left}
          top={folderMenu.top}
          label={`Options for collection ${menuFolder.name}`}
          onClose={closeMenus}
        >
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingFolderId(menuFolder.id);
            }}
          />
          <ArmedMenuItem
            label="Delete collection"
            armedLabel="Confirm delete (designs stay)"
            armed={armed?.id === menuFolder.id && armed.what === "delete"}
            onArm={() => setArmed({ id: menuFolder.id, what: "delete" })}
            onFire={() => {
              closeMenus();
              void deleteFolder(menuFolder.id);
            }}
          />
        </LibraryMenu>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface TileDrag {
  ids: string[];
  name: string;
  icon?: DesignSummary["icon"];
  x: number;
  y: number;
  /** The drop target under the pointer, if any. */
  over?: string;
}

/** The little card that rides the pointer while a tile is dragged. */
function DragGhost({ drag }: { drag: TileDrag }) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      aria-hidden
      style={{ left: drag.x + 14, top: drag.y + 10 }}
      className="pointer-events-none fixed z-[120] flex max-w-[240px] items-center gap-2 border-2 border-[var(--mc-61)] bg-[var(--mc-47)] px-2 py-1.5 text-[var(--mc-ink)] shadow-[0_8px_0_rgba(0,0,0,0.5)]"
    >
      <Face icon={drag.icon} size={28} />
      <span className="min-w-0 truncate text-[12px] font-bold">{drag.name}</span>
      {drag.ids.length > 1 ? (
        <span className="shrink-0 border border-cyan-400 px-1 text-[10px] font-black text-cyan-200">
          +{drag.ids.length - 1}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}

function viewFolderKey(view: { kind: string; folderId?: string }): string {
  return view.kind === "folder" ? (view.folderId ?? "") : "";
}

/** A button on the selection bar. */
function BarButton({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: "danger";
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-6 border px-2 text-xs font-medium",
        tone === "danger"
          ? "border-red-800 bg-red-950/60 text-red-300 hover:border-red-600"
          : "border-[var(--mc-61)] bg-[var(--mc-33)] text-neutral-300 hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** The rail dropdown's value for a view, and back. */
function railValue(view: ReturnType<typeof useLibraryTab>["view"]): string {
  switch (view.kind) {
    case "folder":
      return `folder:${view.folderId}`;
    case "public":
    case "saved":
    case "favorites":
    case "all":
      return view.kind;
  }
}

function railView(value: string): Parameters<typeof setLibraryView>[0] {
  if (value.startsWith("folder:")) {
    return { kind: "folder", folderId: value.slice("folder:".length) };
  }
  if (value === "public" || value === "saved" || value === "favorites") {
    return { kind: value };
  }
  return { kind: "all" };
}

function sortDesignsBy(designs: DesignSummary[], sort: SortKey): DesignSummary[] {
  const sorted = [...designs];
  switch (sort) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
    case "created":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "tier":
      sorted.sort((a, b) => (b.stats?.tierIndex ?? -1) - (a.stats?.tierIndex ?? -1));
      break;
    case "power":
      sorted.sort((a, b) => (b.stats?.euT ?? -1) - (a.stats?.euT ?? -1));
      break;
    case "lowPower":
      // A design with no figure yet goes last, not first.
      sorted.sort((a, b) => (a.stats?.euT ?? Infinity) - (b.stats?.euT ?? Infinity));
      break;
    case "machines":
      sorted.sort((a, b) => (b.stats?.machines ?? -1) - (a.stats?.machines ?? -1));
      break;
    case "edited":
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

/**
 * The signed-in account's posts by id, or undefined while signed out or
 * still loading. Read once per sign-in and again whenever a share lands or
 * a post is changed from here.
 */
function useMyPosts(): { posts: Map<string, CommunityPlanSummary> | undefined; signedIn: boolean } {
  const { user } = useCommunityUser();
  const username = user?.username;
  const [loaded, setLoaded] = useState<{
    username: string;
    posts: Map<string, CommunityPlanSummary>;
  }>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    let cancelled = false;
    (async () => {
      const found = new Map<string, CommunityPlanSummary>();
      for (let page = 1; page <= POSTS_MAX_PAGES; page += 1) {
        const response = await listCommunityPlans({
          mine: true,
          sort: "new",
          page,
          pageSize: POSTS_PAGE_SIZE,
        });
        for (const plan of response.plans) {
          found.set(plan.id, plan);
        }
        if (response.plans.length < POSTS_PAGE_SIZE || found.size >= response.total) {
          break;
        }
      }
      if (!cancelled) {
        setLoaded({ username, posts: found });
      }
    })().catch(() => {
      // The marks fall back to "linked"; nothing else depends on this.
    });
    return () => {
      cancelled = true;
    };
  }, [username, tick]);

  return {
    posts: loaded && loaded.username === username ? loaded.posts : undefined,
    signedIn: Boolean(username),
  };
}

/* ------------------------------------------------------------------ */

function RailItem({
  icon: Icon,
  label,
  count,
  selected,
  highlighted,
  renaming,
  onRename,
  onCancelRename,
  onClick,
  onDoubleClick,
  onMenu,
  dropTarget,
  nested,
}: {
  icon: typeof Folder;
  label: string;
  count?: number;
  selected: boolean;
  highlighted?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onMenu?: (left: number, top: number) => void;
  /** Named, the chip takes a dropped tile. */
  dropTarget?: string;
  /** Under a head entry: stepped in, so the rail reads as a tree. */
  nested?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onClick();
        }
      }}
      data-drop-target={dropTarget}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault();
              onMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      className={[
        "group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 border-2 px-2 text-[12px] font-bold compact:h-8",
        selected
          ? "border-[var(--mc-61)] bg-[var(--mc-47)] text-[var(--mc-ink)]"
          : "border-[var(--mc-47)] bg-[var(--mc-33)] text-[var(--mc-ink)] opacity-55 hover:opacity-100",
        highlighted ? "border-cyan-400 opacity-100" : "",
        nested ? "ml-3 compact:ml-0" : "",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {renaming && onRename && onCancelRename ? (
        <InlineName initialName={label} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-left text-[12px] font-bold">{label}</span>
      )}
      {count !== undefined ? (
        <span className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--mc-ink-muted)]">{count}</span>
      ) : null}
      {onMenu ? (
        <button
          type="button"
          aria-label={`Options for collection ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(rect.left, rect.bottom + 4);
          }}
          className="-mr-1 shrink-0 px-1 text-[var(--mc-ink-muted)] opacity-0 hover:bg-[var(--mc-33)] hover:text-[var(--mc-ink)] focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}
