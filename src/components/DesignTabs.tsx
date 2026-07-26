"use client";

import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMyPostForDesign } from "@/lib/community/client";
import { useDesignStore } from "@/store/design-store";

const MENU_WIDTH = 160;

/** How far one arrow press travels — roughly one tab. */
const SCROLL_STEP = 160;

interface OpenMenu {
  id: string;
  name: string;
  /** Viewport coordinates of the trigger, for the fixed-position menu. */
  left: number;
  top: number;
}

export function DesignTabs() {
  const designs = useDesignStore((state) => state.designs);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const isHydrated = useDesignStore((state) => state.isHydrated);
  const saveState = useDesignStore((state) => state.saveState);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const addDesign = useDesignStore((state) => state.addDesign);
  const copyDesign = useDesignStore((state) => state.copyDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);

  const [renamingId, setRenamingId] = useState<string>();
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setOpenMenu(undefined);
    setConfirmDeleteId(undefined);
  };

  const syncOverflow = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    setOverflow({
      // A pixel of slack: fractional widths otherwise leave an arrow enabled
      // with nowhere left to go.
      left: scroller.scrollLeft > 1,
      right: scroller.scrollLeft < maxScroll - 1,
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track || typeof ResizeObserver === "undefined") {
      return;
    }

    // Both ends matter: the scroller changes width when the window resizes, the
    // track when a design is added or renamed. Observing fires immediately, so
    // this doubles as the initial measurement.
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(scroller);
    observer.observe(track);
    return () => observer.disconnect();
  }, [syncOverflow]);

  // Switching to a design that sits off-screen should bring it into view rather
  // than leaving the strip looking unchanged.
  useEffect(() => {
    if (!activeDesignId) {
      return;
    }

    scrollerRef.current
      ?.querySelector(`[data-design-id="${CSS.escape(activeDesignId)}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeDesignId]);

  const scrollTabs = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: "smooth" });
  };

  if (!isHydrated) {
    return <div className="h-11 shrink-0 border-b border-line bg-surface" />;
  }

  return (
    <>
      {/*
        Only the tab list scrolls. The actions sit outside it because an
        `overflow` container clips absolutely-positioned children, which is what
        was hiding the export menu when this bar was one scrolling row.
      */}
      <div className="flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        {overflow.left ? <ScrollArrow direction={-1} onClick={() => scrollTabs(-1)} /> : null}

        {/*
          Sized to its tabs (`shrink`), not to the whole bar (`flex-1`): with a
          couple of designs the strip is only as wide as they are, so the `+`
          sits against the last tab instead of being stranded at the far right.
          Once the tabs outgrow the bar it shrinks and scrolls instead.
        */}
        <div
          ref={scrollerRef}
          onScroll={syncOverflow}
          className="no-scrollbar min-w-0 shrink overflow-x-auto"
        >
          <nav ref={trackRef} aria-label="Designs" className="flex w-max items-center gap-1">
            {designs.map((design) => {
              const isActive = design.id === activeDesignId;
              const publishedPost = getMyPostForDesign(design.id);

              return (
                <div
                  key={design.id}
                  data-design-id={design.id}
                  className={[
                    "group flex h-7 shrink-0 items-center rounded-t border-b-2 pl-2 pr-1",
                    isActive
                      ? "border-cyan-500 bg-surface-raised text-fg"
                      : "border-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg",
                  ].join(" ")}
                >
                  {renamingId === design.id ? (
                    <RenameInput
                      initialName={design.name}
                      onCommit={(name) => {
                        void renameDesign(design.id, name);
                        setRenamingId(undefined);
                      }}
                      onCancel={() => setRenamingId(undefined)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void switchToDesign(design.id)}
                      onDoubleClick={() => setRenamingId(design.id)}
                      title={
                        publishedPost
                          ? `${design.name} — shared to the community as "${publishedPost.name}". Double-click to rename.`
                          : `${design.name} — double-click to rename`
                      }
                      className="flex max-w-[170px] items-center gap-1 truncate text-xs font-medium"
                    >
                      {publishedPost ? (
                        <Share2 className="h-3 w-3 shrink-0 text-cyan-500" />
                      ) : null}
                      <span className="truncate">{design.name}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={`Design options for ${design.name}`}
                    aria-expanded={openMenu?.id === design.id}
                    onClick={(event) => {
                      if (openMenu?.id === design.id) {
                        closeMenu();
                        return;
                      }

                      // Measured off the trigger because the menu renders in a
                      // portal: the tab strip scrolls horizontally, and an
                      // overflow container clips absolutely-positioned children
                      // whatever their z-index.
                      const rect = event.currentTarget.getBoundingClientRect();
                      setConfirmDeleteId(undefined);
                      setOpenMenu({
                        id: design.id,
                        name: design.name,
                        left: Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8),
                        top: rect.bottom + 4,
                      });
                    }}
                    className="ml-1 rounded px-1 text-xs text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
          </nav>
        </div>

        {overflow.right ? <ScrollArrow direction={1} onClick={() => scrollTabs(1)} /> : null}

        {/* Just outside the scroller: next to the last tab, but never scrolled
            out of reach the way it would be inside the list. */}
        <button
          type="button"
          onClick={() => void addDesign()}
          title="New design"
          aria-label="New design"
          className="shrink-0 rounded px-2 py-0.5 text-sm text-fg-muted hover:bg-surface-sunken hover:text-fg"
        >
          +
        </button>

        {/* Everything from here is pinned to the right edge. */}
        <span className="ml-auto shrink-0 pl-1 text-[11px] text-fg-muted">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}
        </span>
      </div>

      {openMenu ? (
        <DesignMenu
          menu={openMenu}
          confirmingDelete={confirmDeleteId === openMenu.id}
          onClose={closeMenu}
          onRename={() => {
            setRenamingId(openMenu.id);
            closeMenu();
          }}
          onDuplicate={() => {
            void copyDesign(openMenu.id);
            closeMenu();
          }}
          onRequestDelete={() => setConfirmDeleteId(openMenu.id)}
          onConfirmDelete={() => {
            void removeDesign(openMenu.id);
            closeMenu();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Rendered into `document.body` so no ancestor's `overflow` can clip it, and
 * positioned in viewport coordinates from the trigger's rect.
 */
function DesignMenu({
  menu,
  confirmingDelete,
  onClose,
  onRename,
  onDuplicate,
  onRequestDelete,
  onConfirmDelete,
}: {
  menu: OpenMenu;
  confirmingDelete: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    // A fixed menu does not travel with the strip, so it is dismissed rather
    // than left floating somewhere it no longer points at.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // The menu only ever opens from a click, so this is really just a guard for
  // any render that happens without a DOM.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Design options for ${menu.name}`}
      style={{ left: menu.left, top: menu.top, width: MENU_WIDTH }}
      className="fixed z-[100] overflow-hidden rounded border border-line bg-surface-raised shadow-lg"
    >
      <MenuItem label="Rename" onClick={onRename} />
      <MenuItem label="Duplicate" onClick={onDuplicate} />
      {confirmingDelete ? (
        <MenuItem label="Delete — confirm" tone="danger" onClick={onConfirmDelete} />
      ) : (
        // Two steps rather than a native confirm dialog: deleting a design
        // cannot be undone, and the second click lands where the first did.
        <MenuItem label="Delete" tone="danger" onClick={onRequestDelete} />
      )}
    </div>,
    document.body,
  );
}

/**
 * Rendered only when there is something to scroll to in that direction, so the
 * strip stays clean at the common case of a handful of designs.
 */
function ScrollArrow({ direction, onClick }: { direction: -1 | 1; onClick: () => void }) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === -1 ? "Scroll tabs left" : "Scroll tabs right"}
      title={direction === -1 ? "Scroll tabs left" : "Scroll tabs right"}
      className="inline-flex h-7 w-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-sunken hover:text-fg"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function MenuItem({
  label,
  onClick,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "block w-full px-2 py-1.5 text-left text-xs hover:bg-surface-sunken",
        tone === "danger" ? "text-red-600 dark:text-red-400" : "text-fg",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function RenameInput({
  initialName,
  onCommit,
  onCancel,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      // Committing on blur keeps a click elsewhere from silently discarding the
      // edit, which is what a rename field that only listens for Enter does.
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(value);
        } else if (event.key === "Escape") {
          onCancel();
        }
      }}
      aria-label="Design name"
      className="w-[140px] rounded border border-cyan-500 bg-surface px-1 text-xs text-fg outline-none"
    />
  );
}
