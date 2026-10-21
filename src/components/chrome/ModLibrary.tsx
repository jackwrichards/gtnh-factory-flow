"use client";

import "./chrome.css";
import "./library.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestShareDialog } from "@/lib/setups-tab";
import { openDesigns, type DesignSummary } from "@/lib/designs/design-library";
import { readDesign } from "@/lib/designs/design-storage";
import { libraryRows } from "./library-rows";
import { copyPlanCode } from "./share-actions";
import { agoText, lastOpenOf } from "@/lib/library/last-open";
import { leaveLibrary, setLibraryView, useLibraryTab } from "@/lib/library/library-tab";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import { playBoardSound } from "@/lib/board-sounds";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { tipAttrs } from "@/components/flow/clean/interaction";
import { Face } from "@/components/library/LibraryTile";
import { SETUP_SORTS, SetupsGrid } from "@/components/library/SetupsGrid";
import { useSetupFilters } from "@/components/library/SetupsFilterBar";
import { useCommunityUser } from "@/components/community/auth";
import { ChromeMenu, chromeAnchorOf, MENU_ANCHOR_ATTR, type ChromeAnchor, type MenuEntry } from "./ChromeMenu";
import { SharedWithMe } from "@/components/live/SharedWithMe";
import { isLiveConfigured } from "@/lib/live/live-config";
import { useCloudLibraryStore } from "@/lib/library/cloud-library";
import { ChecklistIcon } from "./pixel-icons";
import { NetworksLibrary } from "@/components/networks/NetworkPage";
import { useNetworkStore } from "@/store/network-store";

/** Plans shared with you come with live plans: none of it shows without NEXT_PUBLIC_LIVE_URL. */
const LIVE = isLiveConfigured();

/**
 * The Library (the mod's LibraryView): a header with the two shelves, My plans (every plan kept, the most recently
 * open first, after a tile for a new one) and Public setups, the search, the public list's sort and tier, the account
 * key and a close key; the shelf below. It takes the board's place and closes back onto it.
 */
export function ModLibrary() {
  const library = useLibraryTab();
  const everyDesign = useDesignStore((state) => state.designs);
  // Copies of plans shared with us are listed under Shared with me, never among ours.
  const designs = useMemo(() => everyDesign.filter((design) => !design.cloud), [everyDesign]);
  const sharedCount = useCloudLibraryStore((state) => state.shared?.length);
  const networkCount = useNetworkStore((state) => state.catalogue?.networks.length);
  const filters = useSetupFilters("top");
  const [publicTotal, setPublicTotal] = useState<number>();
  const [mineQuery, setMineQuery] = useState("");
  const [menu, setMenu] = useState<{ kind: "sort" | "tier"; anchor: ChromeAnchor }>();
  const { user } = useCommunityUser();
  const showShared = LIVE && Boolean(user);
  const shelf: "mine" | "public" | "shared" | "networks" =
    library.view.kind === "networks" ? "networks" : library.view.kind === "public" || library.view.kind === "saved"
      ? "public"
      : library.view.kind === "shared" && showShared
        ? "shared"
        : "mine";
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const onTotal = useCallback((total: number) => setPublicTotal(total), []);

  // Esc closes the library (a text field keeps its own Esc).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (document.querySelector("[data-mod-menu], [data-mod-settings], [data-mod-screenshot]")) return;
      leaveLibrary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sortLabel = SETUP_SORTS.find((entry) => entry.value === filters.sort)?.label ?? "Top voted";
  const tierIndex = filters.maxTier === "" ? -1 : Number(filters.maxTier);
  const tierLabel = tierIndex < 0 ? "Any tier" : `Up to ${GT_VOLTAGE_TIERS[tierIndex]?.tier ?? ""}`;

  const menuEntries = (kind: "sort" | "tier"): MenuEntry[] => {
    if (kind === "sort") {
      return SETUP_SORTS.map((entry) => ({
        label: entry.label,
        current: entry.value === filters.sort,
        onSelect: () => filters.setSort(entry.value),
      }));
    }
    return [
      { label: "Any tier", current: tierIndex < 0, onSelect: () => filters.setMaxTier("") },
      ...GT_VOLTAGE_TIERS.map((entry, index) => ({
        label: `Up to ${entry.tier}`,
        current: tierIndex === index,
        onSelect: () => filters.setMaxTier(String(index)),
      })),
    ];
  };

  return (
    <div className="ml mx" data-mod-library="">
      <div className="ml-head">
        <ShelfTab label="MY PLANS" count={String(designs.length)} on={shelf === "mine"} onClick={() => setLibraryView({ kind: "all" })} />
        <ShelfTab label="NETWORKS" count={networkCount === undefined ? "..." : String(networkCount)} on={shelf === "networks"} onClick={() => setLibraryView({ kind: "networks" })} />
        {showShared ? (
          <ShelfTab
            label="SHARED WITH ME"
            count={sharedCount === undefined ? "..." : String(sharedCount)}
            on={shelf === "shared"}
            onClick={() => setLibraryView({ kind: "shared" })}
          />
        ) : null}
        <ShelfTab
          label="COMMUNITY"
          count={publicTotal === undefined ? "..." : compact(publicTotal)}
          on={shelf === "public"}
          onClick={() => setLibraryView({ kind: "public" })}
        />
        {shelf === "shared" || shelf === "networks" ? null : shelf === "mine" ? (
          <input
            className="ml-search"
            style={{ width: 240 }}
            placeholder="Find a plan"
            aria-label="Find a plan"
            value={mineQuery}
            onChange={(event) => setMineQuery(event.target.value)}
          />
        ) : (
          <input
            className="ml-search"
            style={{ width: 300 }}
            placeholder="Search setups (#tag, @name)"
            aria-label="Search setups"
            value={filters.query}
            onChange={(event) => filters.setQuery(event.target.value)}
          />
        )}
        <span className="mb-grow" />
        {shelf === "public" ? (
          <>
            <DropKey
              label={sortLabel}
              open={menu?.kind === "sort"}
              tip="How the public list is ordered"
              onOpen={(anchor) => setMenu({ kind: "sort", anchor })}
            />
            <DropKey
              label={tierLabel}
              open={menu?.kind === "tier"}
              tip="Hide setups that need a higher tier"
              onOpen={(anchor) => setMenu({ kind: "tier", anchor })}
            />
          </>
        ) : null}
        {user ? (
          <span className="ml-as" data-signed-in-as="">
            Signed in as {user.username}
          </span>
        ) : null}
        <div
          className="mb-key ml-close"
          role="button"
          aria-label="Close the panel"
          onClick={() => {
            playBoardSound("tick");
            leaveLibrary();
          }}
          {...tipAttrs({ id: "lib|close", title: "Back to the board" })}
        >
          x
        </div>
      </div>
      <div className="ml-body">
        {shelf === "networks" ? <NetworksLibrary /> : shelf === "mine" ? (
          <MyPlans query={mineQuery} />
        ) : shelf === "shared" ? (
          <div className="ml-public ml-shared" data-shared-shelf="">
            <SharedWithMe />
          </div>
        ) : (
          <div className="ml-public">
            <SetupsGrid scope="network" presetQuery={library.view.kind === "public" ? library.view.search : undefined} filters={filters} bare onTotal={onTotal} />
          </div>
        )}
      </div>
      {menu ? (
        <ChromeMenu
          anchor={menu.anchor}
          entries={menuEntries(menu.kind)}
          label={menu.kind === "sort" ? "Sort" : "Tier"}
          minWidth={130}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function ShelfTab({ label, count, on, onClick }: { label: string; count: string; on: boolean; onClick: () => void }) {
  return (
    <div className="ml-tab" role="tab" aria-selected={on} data-on={on ? "" : undefined} onClick={onClick}>
      <span>{label}</span>
      <i>{count}</i>
    </div>
  );
}

/** A key with a chevron: the public list's sort and tier. */
function DropKey({ label, open, tip, onOpen }: { label: string; open: boolean; tip: string; onOpen: (anchor: ChromeAnchor) => void }) {
  return (
    <div
      className="mb-key ml-drop"
      role="button"
      data-open={open ? "" : undefined}
      {...{ [MENU_ANCHOR_ATTR]: "" }}
      onClick={(event) => {
        playBoardSound("tick");
        onOpen(chromeAnchorOf(event.currentTarget));
      }}
      {...tipAttrs({ id: `lib|${label}`, title: tip })}
    >
      {label}
      <svg width="5" height="3" viewBox="0 0 5 3" shapeRendering="crispEdges" aria-hidden fill="currentColor">
        <path d="M0 0h5v1h-5zM1 1h3v1h-3zM2 2h1v1h-1z" />
      </svg>
    </div>
  );
}

// ---- My plans --------------------------------------------------------------

function MyPlans({ query }: { query: string }) {
  const everyDesign = useDesignStore((state) => state.designs);
  const allDesigns = useMemo(() => everyDesign.filter((design) => !design.cloud), [everyDesign]);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const addDesign = useDesignStore((state) => state.addDesign);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const linkedPostId = useFactoryStore((state) => state.project.metadata?.communityPlanId);
  const [menu, setMenu] = useState<{ kind: "tile" | "delete"; id: string; name: string; anchor: ChromeAnchor }>();
  const [renaming, setRenaming] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const open = new Set(openDesigns(allDesigns).map((design) => design.id));
    return allDesigns
      .filter((design) => !needle || design.name.toLowerCase().includes(needle))
      .map((design) => ({ design, open: open.has(design.id), at: lastOpenOf(design.id, design.updatedAt) }))
      .sort((a, b) => b.at - a.at);
  }, [allDesigns, needle]);

  const open = async (id: string) => {
    leaveWelcomeTab();
    await switchToDesign(id);
  };

  const copyCode = async (id: string) => {
    try {
      const project = id === activeDesignId ? useFactoryStore.getState().project : (await readDesign(id))?.project;
      if (!project) return;
      await copyPlanCode(project);
    } catch (error) {
      console.error(error);
    }
  };

  const entries = (m: NonNullable<typeof menu>): MenuEntry[] => {
    if (m.kind === "delete") {
      return [
        { label: "Delete it", tone: "red", onSelect: () => void removeDesign(m.id) },
        { label: "Keep it", onSelect: () => undefined },
      ];
    }
    return [
      { label: "Open", onSelect: () => void open(m.id) },
      { label: "Rename", onSelect: () => setRenaming(m.id) },
      { label: "Copy plan code", detail: "to paste or share", onSelect: () => void copyCode(m.id) },
      ...libraryRows(
        Boolean(m.id === activeDesignId ? linkedPostId : allDesigns.find((design) => design.id === m.id)?.communityPlanId),
        (mode) => {
          void (async () => {
            await open(m.id);
            requestShareDialog(mode);
          })();
        },
        { taskBoard: Boolean(allDesigns.find((design) => design.id === m.id)?.taskBoard) },
      ),
      {
        label: "Delete plan",
        tone: "red",
        onSelect: () => setMenu({ kind: "delete", id: m.id, name: m.name, anchor: m.anchor }),
      },
    ];
  };

  return (
    <div className="ml-grid" data-my-plans="">
      <div
        className="ml-tile ml-new"
        role="button"
        onClick={() => {
          playBoardSound("tick");
          leaveWelcomeTab();
          void addDesign();
        }}
      >
        + New plan
      </div>
      {shown.map(({ design, open: isOpen, at }) => (
        <PlanTile
          key={design.id}
          design={design}
          showing={design.id === activeDesignId}
          open={isOpen}
          when={agoText(at, now)}
          renaming={renaming === design.id}
          onOpen={() => void open(design.id)}
          onMenu={(anchor) => setMenu({ kind: "tile", id: design.id, name: design.name, anchor })}
          onRename={(name) => {
            setRenaming(undefined);
            if (name && name !== design.name) void renameDesign(design.id, name);
          }}
        />
      ))}
      {menu ? (
        <ChromeMenu
          anchor={menu.anchor}
          entries={entries(menu)}
          label={`Plan options for ${menu.name}`}
          title={menu.kind === "delete" ? `Delete '${menu.name}' for good?` : undefined}
          minWidth={menu.kind === "delete" ? 150 : 190}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

function PlanTile({
  design,
  showing,
  open,
  when,
  renaming,
  onOpen,
  onMenu,
  onRename,
}: {
  design: DesignSummary;
  showing: boolean;
  open: boolean;
  when: string;
  renaming: boolean;
  onOpen: () => void;
  onMenu: (anchor: ChromeAnchor) => void;
  onRename: (name: string) => void;
}) {
  const cards = design.stats ? Math.max(0, design.stats.cards - (design.stats.drawers ?? 0)) : undefined;
  const drawers = design.stats?.drawers;
  const tasks = design.stats?.tasks ?? 0;
  const size = design.taskBoard
    ? `${tasks} ${tasks === 1 ? "task" : "tasks"}`
    : cards === undefined
      ? undefined
      : `${cards} ${cards === 1 ? "card" : "cards"}${drawers === undefined ? "" : ` · ${drawers} ${drawers === 1 ? "drawer" : "drawers"}`}`;
  const drawable = Boolean(design.icon && (design.icon.iconPath || design.icon.iconAtlas || design.icon.kind === "fluid"));
  return (
    <div
      className="ml-tile"
      role="button"
      data-tasks={design.taskBoard ? "" : undefined}
      data-showing={showing ? "" : undefined}
      onClick={() => !renaming && onOpen()}
      onContextMenu={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu({ left: rect.left + 8, top: rect.top, bottom: rect.top + 20 });
      }}
      {...tipAttrs({
        id: `lib|plan:${design.id}`,
        title: design.name,
        sub: showing ? "On the board now" : "Click to open it",
        actions: [
          { input: "left", label: "Open" },
          { input: "right", label: "More" },
        ],
      })}
    >
      <span className="ml-face">
        {drawable ? <Face icon={design.icon} size={24} /> : <span className="ml-noface" />}
      </span>
      {open ? <span className="ml-chip" data-showing={showing ? "" : undefined}>{showing ? "SHOWING" : "OPEN"}</span> : null}
      {renaming ? (
        <TileRename initial={design.name} onDone={onRename} />
      ) : (
        <span className="ml-name">
          {design.taskBoard ? <ChecklistIcon className="ml-tasks" /> : null}
          {design.name}
        </span>
      )}
      {size ? <span className="ml-size">{size}</span> : null}
      <span className="ml-when">last open {when}</span>
      {design.communityPlanId ? <span className="ml-posted">posted</span> : null}
    </div>
  );
}

function TileRename({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(commit ? value.trim() : "");
  };
  return (
    <input
      autoFocus
      className="ml-rename"
      aria-label="Plan name"
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}
