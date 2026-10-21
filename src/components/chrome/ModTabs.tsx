"use client";

import "./chrome.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { activateOnKey } from "@/lib/hooks/button-keys";
import { openDesigns } from "@/lib/designs/design-library";
import { readDesign } from "@/lib/designs/design-storage";
import { leaveLibrary, openLibrary } from "@/lib/library/library-tab";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import { playBoardSound } from "@/lib/board-sounds";
import { playSfx } from "@/lib/sound/sfx";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { useFactoryStore } from "@/store/factory-store";
import { useSolvingBooks } from "@/components/flow/use-solving-books";
import { tipAttrs } from "@/components/flow/clean/interaction";
import { openPlanFile } from "@/lib/import-export/open-plan-file";
import { flashNotice } from "@/components/flow/clean/rail/NoticeBar";
import {
  orderWith,
  shiftsFor,
  slotAt,
  stepped,
  TAB_DRAG_SLOP,
  TAB_EDGE_SPEED,
  TAB_EDGE_ZONE,
  TAB_GLIDE_MS,
  type TabBox,
} from "./tab-reorder";
import { ChromeMenu, chromeAnchorOf, MENU_ANCHOR_ATTR, type ChromeAnchor, type MenuEntry } from "./ChromeMenu";
import { libraryRows } from "./library-rows";
import { copyPlanCode } from "./share-actions";
import type { ShareMode } from "@/components/community/SharePlanDialog";
import { isLiveConfigured } from "@/lib/live/live-config";
import { ChecklistIcon } from "./pixel-icons";

/** What the tab strip asks of the bar: the dialogs it does not own. */
export interface ModTabsActions {
  /** "Paste plan": the paste dialog. */
  onPaste: () => void;
  /** The library dialog for the plan open now: Save to library, Update in library, Save as new post. */
  onShare: (mode?: ShareMode) => void;
}

/** A plan tab in hand (or settling after it): how far it has moved, and where every tab sits for the new order. */
interface TabDrag {
  id: string;
  dx: number;
  shifts: Record<string, number>;
  settling: boolean;
}

interface TabGrab {
  id: string;
  startX: number;
  startScroll: number;
  pointerX: number;
  /** Screen pixels per CSS pixel of the strip (the page may be zoomed). */
  scale: number;
  boxes: TabBox[];
  held: boolean;
  slot: number;
  frame: number;
}

const TAB_GAP = 2;

type TabMenu =
  | { kind: "plus"; anchor: ChromeAnchor }
  | { kind: "network" | "network-delete"; anchor: ChromeAnchor; id: string; name: string }
  | { kind: "tab"; anchor: ChromeAnchor; id: string; name: string }
  | { kind: "delete"; anchor: ChromeAnchor; id: string; name: string };

/** The plan tabs of the top bar (the mod's PlanTabs): one per open plan, then "+". */
export function ModTabs({ onPaste, onShare }: ModTabsActions) {
  const networkId = useNetworkStore((state) => state.activeId);
  const networkTabs = useNetworkStore((state) => state.openIds);
  const networks = useNetworkStore((state) => state.catalogue?.networks);
  const allDesigns = useDesignStore((state) => state.designs);
  const publicViews = useDesignStore((state) => state.publicViews);
  const publicView = useDesignStore((state) => state.publicView);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const addDesign = useDesignStore((state) => state.addDesign);
  const addTaskBoard = useDesignStore((state) => state.addTaskBoard);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const closeDesigns = useDesignStore((state) => state.closeDesigns);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const reorderDesigns = useDesignStore((state) => state.reorderDesigns);
  const designs = openDesigns(allDesigns);
  const linkedPostId = useFactoryStore((state) => state.project.metadata?.communityPlanId);
  const solving = useSolvingBooks();

  const [menu, setMenu] = useState<TabMenu>();
  const [renaming, setRenaming] = useState<string>();
  const [fade, setFade] = useState({ left: false, right: false });
  const stripRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<TabDrag>();
  const grabRef = useRef<TabGrab | null>(null);
  const stopGrabRef = useRef<() => void>(() => undefined);
  const suppressClick = useRef(false);
  const designIds = designs.map((design) => design.id);
  const designIdsRef = useRef(designIds);
  const allDesignsRef = useRef(allDesigns);
  const canClose = designs.length + publicViews.length > 1;
  // One tab is in the Tab order (roving): the open plan's, else the first. The arrows move among the rest.
  const tabIds = [...networkTabs.map((id) => `network:${id}`), ...publicViews.map((view) => `public:${view.id}`), ...designs.map((design) => design.id)];
  const wanted = networkId ? `network:${networkId}` : publicView ? `public:${publicView.id}` : activeDesignId;
  const tabStop = wanted && tabIds.includes(wanted) ? wanted : tabIds[0];
  useLayoutEffect(() => {
    designIdsRef.current = designIds;
    allDesignsRef.current = allDesigns;
  });
  const closeMenu = useCallback(() => setMenu(undefined), []);

  const syncFade = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const max = strip.scrollWidth - strip.clientWidth;
    const next = { left: strip.scrollLeft > 1, right: strip.scrollLeft < max - 1 };
    setFade((previous) => (previous.left === next.left && previous.right === next.right ? previous : next));
  }, []);

  const keepActiveInView = useCallback(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>("[data-active]");
    if (!strip || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, []);

  // The strip narrowing (the window, the bar's keys) must not push the open plan's tab out of sight.
  useLayoutEffect(() => {
    syncFade();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      keepActiveInView();
      syncFade();
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [syncFade, keepActiveInView, designs.length, publicViews.length]);

  // The open plan's tab comes into view when the open plan changes.
  useEffect(() => {
    keepActiveInView();
    syncFade();
  }, [activeDesignId, publicView?.id, designs.length, networkId, networkTabs.length, syncFade, keepActiveInView]);

  /** The new order of the open tabs, with the parked plans left in their own places among the rest. */
  const commitOrder = useCallback(
    (openOrder: string[]) => {
      const open = new Set(designIdsRef.current);
      let next = 0;
      const full = allDesignsRef.current.map((design) => (open.has(design.id) ? openOrder[next++] : design.id));
      void reorderDesigns(full);
    },
    [reorderDesigns],
  );

  useEffect(() => () => stopGrabRef.current(), []);

  /** A press on a plan tab: moved past the slop it is picked up, follows the pointer, the others slide aside. */
  const grabTab = (event: React.PointerEvent<HTMLElement>, id: string) => {
    const strip = stripRef.current;
    if (!strip || event.button !== 0 || event.pointerType === "touch" || grabRef.current) return;
    if ((event.target as HTMLElement).closest(".mt-close, input")) return;
    const boxes = [...strip.querySelectorAll<HTMLElement>(".mt-tab[data-design-id]")].map((tab) => ({
      id: tab.dataset.designId ?? "",
      left: tab.offsetLeft,
      width: tab.offsetWidth,
    }));
    const me = boxes.findIndex((box) => box.id === id);
    if (me < 0 || boxes.length < 2) return;
    const grab: TabGrab = {
      id,
      startX: event.clientX,
      startScroll: strip.scrollLeft,
      pointerX: event.clientX,
      scale: strip.offsetWidth > 0 && strip.getBoundingClientRect().width > 0 ? strip.getBoundingClientRect().width / strip.offsetWidth : 1,
      boxes,
      held: false,
      slot: me,
      frame: 0,
    };
    grabRef.current = grab;

    const order = () => orderWith(designIdsRef.current, id, grab.slot);
    const update = () => {
      const mine = grab.boxes.find((box) => box.id === id);
      if (!mine) return;
      const first = grab.boxes[0];
      const last = grab.boxes[grab.boxes.length - 1];
      const raw = (grab.pointerX - grab.startX) / grab.scale + (strip.scrollLeft - grab.startScroll);
      const dx = Math.max(first.left - mine.left, Math.min(last.left + last.width - mine.left - mine.width, raw));
      const slot = slotAt(grab.boxes, id, mine.left + mine.width / 2 + dx);
      if (slot !== grab.slot) {
        grab.slot = slot;
        playSfx("ui.tick");
      }
      setDrag({ id, dx, shifts: shiftsFor(grab.boxes, order(), TAB_GAP), settling: false });
    };
    const edgeScroll = () => {
      grab.frame = 0;
      if (!grabRef.current) return;
      const rect = strip.getBoundingClientRect();
      const into =
        grab.pointerX < rect.left + TAB_EDGE_ZONE
          ? grab.pointerX - rect.left - TAB_EDGE_ZONE
          : grab.pointerX > rect.right - TAB_EDGE_ZONE
            ? grab.pointerX - rect.right + TAB_EDGE_ZONE
            : 0;
      if (into !== 0) {
        const before = strip.scrollLeft;
        strip.scrollLeft += Math.sign(into) * Math.min(TAB_EDGE_SPEED, 2 + (Math.abs(into) / TAB_EDGE_ZONE) * TAB_EDGE_SPEED);
        if (strip.scrollLeft !== before) update();
      }
      grab.frame = requestAnimationFrame(edgeScroll);
    };
    const onMove = (move: PointerEvent) => {
      grab.pointerX = move.clientX;
      if (!grab.held) {
        if (Math.abs(move.clientX - grab.startX) / grab.scale <= TAB_DRAG_SLOP) return;
        grab.held = true;
        suppressClick.current = true;
        setMenu(undefined);
        playSfx("board.lift");
        grab.frame = requestAnimationFrame(edgeScroll);
      }
      update();
    };
    const finish = (commit: boolean) => {
      const wasHeld = grab.held;
      const final = order();
      const shifts = shiftsFor(grab.boxes, commit ? final : designIdsRef.current, TAB_GAP);
      stopGrabRef.current();
      if (!wasHeld) return;
      if (commit) playSfx("board.drop");
      setDrag({ id, dx: shifts[id] ?? 0, shifts, settling: true });
      window.setTimeout(() => {
        setDrag(undefined);
        if (commit && final.some((other, at) => other !== designIdsRef.current[at])) commitOrder(final);
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }, TAB_GLIDE_MS);
    };
    const onUp = () => finish(true);
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    stopGrabRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      if (grab.frame) cancelAnimationFrame(grab.frame);
      grabRef.current = null;
      stopGrabRef.current = () => undefined;
    };
  };

  /** Ctrl+Shift+Left or Right on a focused tab moves it one place. */
  const moveTabByKey = (event: React.KeyboardEvent<HTMLElement>, id: string, by: -1 | 1) => {
    const next = stepped(designIds, id, by);
    event.preventDefault();
    if (next === designIds) return;
    playSfx("ui.tick");
    commitOrder(next);
    requestAnimationFrame(() => {
      const tab = stripRef.current?.querySelector<HTMLElement>(`.mt-tab[data-design-id="${id}"]`);
      tab?.focus();
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const tabDragStyle = (id: string): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    const mine = drag.id === id;
    const x = mine ? drag.dx : (drag.shifts[id] ?? 0);
    return {
      transform: `translateX(${x}px)`,
      transition: !mine || drag.settling ? `transform ${TAB_GLIDE_MS}ms ease-out` : "none",
      zIndex: mine ? 3 : undefined,
    };
  };

  const close = async (id: string) => {
    playSfx("ui.close");
    const index = designs.findIndex((design) => design.id === id);
    const next = designs[index + 1] ?? designs[index - 1];
    await closeDesigns([id], next?.id);
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

  const activate = async (id: string) => {
    useNetworkStore.getState().leave();
    // A tab switched turns a page; its cards are not landing, they were there.
    if (id !== activeDesignId) playSfx("ui.page");
    leaveWelcomeTab();
    leaveLibrary();
    await switchToDesign(id);
  };

  const openTabMenu = (event: React.MouseEvent<HTMLElement>, id: string, name: string) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ kind: "tab", id, name, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom + 1 } });
  };

  const entries = (m: TabMenu): MenuEntry[] => {
    if (m.kind === "plus") {
      return [
        {
          label: "New plan",
          onSelect: () => {
            playSfx("ui.page");
            leaveWelcomeTab();
            leaveLibrary();
            void addDesign();
          },
        },
        // Task boards come with live plans (the mod's + list has the same row).
        ...(isLiveConfigured()
          ? [
              {
                label: "New task board",
                detail: "a plan of tasks",
                onSelect: () => {
                  playSfx("ui.page");
                  leaveWelcomeTab();
                  leaveLibrary();
                  void addTaskBoard();
                },
              },
            ]
          : []),
        { label: "Open a plan...", detail: "My plans", onSelect: () => openLibrary({ kind: "all" }) },
        { label: "New network", onSelect: () => void useNetworkStore.getState().create("New network") },
        { label: "Open a network...", onSelect: () => openLibrary({ kind: "networks" }) },
        { label: "Open plan file...", detail: ".json", onSelect: () => document.querySelector<HTMLInputElement>("[data-plan-file-input]")?.click() },
        { label: "Paste plan", detail: "a plan link, code or file", onSelect: onPaste },
        { label: "Browse Community", detail: "public plans", onSelect: () => openLibrary({ kind: "public" }) },
      ];
    }
    if (m.kind === "delete") {
      return [
        { label: "Delete it", tone: "red", onSelect: () => void removeDesign(m.id) },
        { label: "Keep it", onSelect: () => undefined },
      ];
    }
    if (m.kind === "network-delete") {
      return [
        { label: "Delete network", detail: "plans are kept", tone: "red", onSelect: () => void useNetworkStore.getState().remove(m.id) },
        { label: "Cancel", onSelect: () => undefined },
      ];
    }
    if (m.kind === "network") {
      return [
        { label: "Rename", onSelect: () => setRenaming(`network:${m.id}`) },
        { label: "New subnetwork", onSelect: () => void useNetworkStore.getState().create("New subnetwork", m.id) },
        { label: "Close tab", detail: "kept in Networks", onSelect: () => useNetworkStore.getState().close(m.id) },
        { label: "Delete network", tone: "red", onSelect: () => setMenu({ ...m, kind: "network-delete" }) },
      ];
    }
    const rows: MenuEntry[] = [
      { label: "Rename", onSelect: () => setRenaming(m.id) },
      { label: "Copy plan code", detail: "to paste or share", onSelect: () => void copyCode(m.id) },
      ...libraryRows(
        Boolean(m.id === activeDesignId ? linkedPostId : designs.find((design) => design.id === m.id)?.communityPlanId),
        (mode) => {
          void (async () => {
            if (m.id !== activeDesignId) await activate(m.id);
            onShare(mode);
          })();
        },
        { taskBoard: Boolean(designs.find((design) => design.id === m.id)?.taskBoard) },
      ),
    ];
    if (canClose) {
      rows.push(
        { label: "Close tab", detail: "kept in My plans", onSelect: () => void close(m.id) },
        {
          label: "Close other tabs",
          detail: "kept in My plans",
          onSelect: () =>
            void closeDesigns(
              designs.filter((design) => design.id !== m.id).map((design) => design.id),
              m.id,
            ),
        },
      );
    }
    rows.push({
      label: "Delete plan",
      tone: "red",
      onSelect: () => setMenu({ kind: "delete", id: m.id, name: m.name, anchor: m.anchor }),
    });
    return rows;
  };

  return (
    <div className="mt" data-mod-tabs="">
      <div className="mt-wrap">
        <div
          ref={stripRef}
          className="mt-strip"
          onScroll={syncFade}
          role="tablist"
          aria-label="Open plans"
          onKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) return;
            const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(".mt-tab")];
            const at = tabs.indexOf(document.activeElement as HTMLElement);
            if (at < 0) return;
            const held = tabs[at].dataset.designId;
            if (held && event.ctrlKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
              moveTabByKey(event, held, event.key === "ArrowLeft" ? -1 : 1);
              return;
            }
            let to = -1;
            if (event.key === "ArrowRight") to = (at + 1) % tabs.length;
            else if (event.key === "ArrowLeft") to = (at - 1 + tabs.length) % tabs.length;
            else if (event.key === "Home") to = 0;
            else if (event.key === "End") to = tabs.length - 1;
            if (to < 0) return;
            event.preventDefault();
            tabs[to].focus();
            tabs[to].scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
          onWheel={(event) => {
            const strip = stripRef.current;
            if (!strip || strip.scrollWidth <= strip.clientWidth) return;
            strip.scrollLeft += event.deltaY + event.deltaX > 0 ? 40 : -40;
          }}
        >
          {networkTabs.map((id) => {
            const network = networks?.find((entry) => entry.id === id);
            if (!network) return null;
            const showMenu = (element: HTMLElement) => setMenu({ kind: "network", id, name: network.name, anchor: chromeAnchorOf(element) });
            return <div key={`network:${id}`} className="mt-tab" role="tab" aria-selected={networkId === id} data-active={networkId === id ? "" : undefined} data-network-tab={id} tabIndex={tabStop === `network:${id}` ? 0 : -1}
              onContextMenu={(event) => { event.preventDefault(); showMenu(event.currentTarget); }}
              onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); showMenu(event.currentTarget); } else activateOnKey(event); }}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); useNetworkStore.getState().close(id); } }}
              onDoubleClick={() => setRenaming(`network:${id}`)} onClick={() => useNetworkStore.getState().open(id)}>
              {renaming === `network:${id}` ? <RenameField initial={network.name} label="Network name" onDone={(name) => {
                setRenaming(undefined);
                if (name) void useNetworkStore.getState().edit((entries) => entries.map((entry) => entry.id === id ? { ...entry, name } : entry));
              }} /> : <span className="mt-name">▤ {network.name}</span>}
              <span className="mt-close" role="button" aria-label={`Close ${network.name}`} onClick={(event) => { event.stopPropagation(); useNetworkStore.getState().close(id); }}><CloseGlyph /></span>
            </div>;
          })}
          {publicViews.map((view) => {
            const active = !networkId && publicView?.id === view.id;
            return (
              <div
                key={`public:${view.id}`}
                className="mt-tab"
                data-active={active ? "" : undefined}
                data-readonly=""
                data-public-tab={view.id}
                role="tab"
                aria-selected={active}
                tabIndex={tabStop === `public:${view.id}` ? 0 : -1}
                onKeyDown={(event) => {
                  activateOnKey(event);
                  if ((event.key === "Delete" || event.key === "Backspace") && event.target === event.currentTarget) {
                    void useDesignStore.getState().closePublicView(view.id);
                  }
                }}
                onClick={() => {
                  useNetworkStore.getState().leave();
                  leaveWelcomeTab();
                  leaveLibrary();
                  void useDesignStore.getState().switchToPublicView(view.id);
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) void useDesignStore.getState().closePublicView(view.id);
                }}
                {...tipAttrs({
                  id: `tab|public:${view.id}`,
                  title: view.name,
                  sub: "Shared plan: view only. Middle-click to close",
                })}
              >
                <span className="mt-name">{view.name}</span>
                <span
                  className="mt-close"
                  role="button"
                  aria-label="Close public setup view"
                  onClick={(event) => {
                    event.stopPropagation();
                    void useDesignStore.getState().closePublicView(view.id);
                  }}
                  {...tipAttrs({ id: `tab|public-close:${view.id}`, title: "Close tab" })}
                >
                  <CloseGlyph />
                </span>
              </div>
            );
          })}
          {designs.map((design) => {
            const active = !networkId && design.id === activeDesignId && !publicView;
            const isRenaming = renaming === design.id;
            return (
              <div
                key={design.id}
                className="mt-tab"
                data-design-id={design.id}
                data-active={active ? "" : undefined}
                data-tasks={design.taskBoard ? "" : undefined}
                data-dragging={drag?.id === design.id ? "" : undefined}
                style={tabDragStyle(design.id)}
                onPointerDown={(event) => {
                  if (!isRenaming) grabTab(event, design.id);
                }}
                role="tab"
                aria-selected={active}
                tabIndex={tabStop === design.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (isRenaming || event.target !== event.currentTarget) return;
                  activateOnKey(event);
                  if (event.key === "F2") {
                    event.preventDefault();
                    setRenaming(design.id);
                  } else if ((event.key === "Delete" || event.key === "Backspace") && canClose) {
                    event.preventDefault();
                    void close(design.id);
                  }
                }}
                onClick={() => {
                  if (suppressClick.current) return;
                  if (!isRenaming) void activate(design.id);
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button === 1 && canClose) void close(design.id);
                }}
                onContextMenu={(event) => openTabMenu(event, design.id, design.name)}
                {...(isRenaming
                  ? {}
                  : tipAttrs({
                      id: `tab|${design.id}`,
                      title: design.name,
                      sub: "Middle-click to close, right-click for more",
                    }))}
              >
                {isRenaming ? (
                  <RenameField
                    initial={design.name}
                    onDone={(name) => {
                      setRenaming(undefined);
                      if (name && name !== design.name) void renameDesign(design.id, name);
                    }}
                  />
                ) : (
                  <>
                    {design.taskBoard ? <ChecklistIcon className="mt-tasks" /> : null}
                    <span className="mt-name">{design.name}</span>
                  </>
                )}
                {active && solving ? <span className="mt-solving" aria-label="Still working out this plan's numbers" /> : null}
                {canClose && !isRenaming ? (
                  <span
                    className="mt-close"
                    role="button"
                    aria-label={`Close ${design.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void close(design.id);
                    }}
                    {...tipAttrs({ id: `tab|close:${design.id}`, title: "Close tab (the plan is kept in My plans)" })}
                  >
                    <CloseGlyph />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <span className="mt-fade" data-edge="l" data-on={fade.left ? "" : undefined} aria-hidden />
        <span className="mt-fade" data-edge="r" data-on={fade.right ? "" : undefined} aria-hidden />
      </div>
      <div
        className="mt-plus"
        role="button"
        aria-label="New plan"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "plus"}
        tabIndex={0}
        onKeyDown={activateOnKey}
        {...{ [MENU_ANCHOR_ATTR]: "" }}
        data-open={menu?.kind === "plus" ? "" : undefined}
        onClick={(event) => {
          playBoardSound("tick");
          const anchor = chromeAnchorOf(event.currentTarget);
          setMenu((current) => (current?.kind === "plus" ? undefined : { kind: "plus", anchor }));
        }}
        {...tipAttrs({ id: "tab|plus", title: "New plan, or open an existing one" })}
      >
        +
      </div>
      <input
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-plan-file-input=""
        aria-label="Open plan file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          leaveWelcomeTab();
          leaveLibrary();
          openPlanFile(file).catch((error) =>
            flashNotice("warn", error instanceof Error ? error.message : "That plan file could not be opened."),
          );
        }}
      />
      {menu ? (
        <ChromeMenu
          anchor={menu.anchor}
          entries={entries(menu)}
          label={menu.kind === "plus" ? "New plan" : `${menu.kind === "network" || menu.kind === "network-delete" ? "Network" : "Plan"} options for ${menu.name}`}
          title={menu.kind === "delete" ? `Delete '${menu.name}' for good?` : menu.kind === "network-delete" ? `Delete '${menu.name}'? Plans stay. Subnetworks move to its parent.` : undefined}
          minWidth={menu.kind === "plus" ? 190 : menu.kind === "delete" ? 150 : 170}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

/** The pixel cross of the close key: two five-pixel diagonals. */
function CloseGlyph() {
  const d: string[] = [];
  for (let k = 0; k < 5; k++) {
    d.push(`M${2 + k} ${2 + k}h1v1h-1z`, `M${6 - k} ${2 + k}h1v1h-1z`);
  }
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden fill="currentColor">
      <path d={d.join("")} />
    </svg>
  );
}

function RenameField({ initial, label = "Plan name", onDone }: { initial: string; label?: string; onDone: (name: string) => void }) {
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
      className="mt-rename"
      aria-label={label}
      maxLength={80}
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
