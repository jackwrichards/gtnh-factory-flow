"use client";

import { getUiScale } from "@/lib/ui-scale";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";

import { useLayoutEffect, useRef, useState } from "react";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";
import type { RecipeQueryRole } from "@/lib/datasets/recipe-query";
import { ResourceIndexPane, type IndexedResource } from "./ResourceIndexPane";

/**
 * The item picker behind the stencil's "+ takes" / "+ makes" keys, the
 * library's filter and Pool's product drawer button: THE ITEM PANEL
 * (ResourceIndexPane - the items column's own search, filters, sort, paged
 * grid and recent shelf), in a popover, where a click on a tile picks it. A
 * click anywhere else closes it. The recipe search opens it ABOVE the
 * stencil (the stencil sits at the bottom of the screen); the library opens
 * it BELOW its header keys. Same picker, one `placement`.
 */
export function ItemPickerPopover({
  role,
  placement = "above",
  align = "center",
  onPick,
  onClose,
}: {
  role: RecipeQueryRole;
  placement?: "above" | "below";
  align?: "center" | "start";
  onPick: (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => void;
  onClose: () => void;
  /** Kept for callers that still pass it; the pane queries the dataset itself. */
  searchPickerResources?: unknown;
}) {
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  // Centred under its key, then nudged back inside the window if that put
  // an edge off screen. Measured once it is on the page.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || placement !== "below") {
      return;
    }
    const margin = 8;
    // Real px in, shell px out: the shift is a translate inside the zoomed shell.
    const scale = getUiScale();
    const rect = root.getBoundingClientRect();
    const overRight = (rect.right - (window.innerWidth - margin)) / scale;
    const overLeft = (margin - rect.left) / scale;
    if (overRight > 0) {
      setShift((current) => current - overRight);
    } else if (overLeft > 0) {
      setShift((current) => current + overLeft);
    }
  }, [placement, align]);

  // The one dropdown rule (use-dropdown-dismiss.ts); its Escape is consumed
  // so the search behind the picker stays open.
  useDropdownDismiss(true, { refs: [rootRef], onClose, fade: true });

  const pick = (resource: IndexedResource) => {
    onPick(
      {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName,
        iconPath: resource.iconPath,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor,
        tooltip: resource.tooltip,
      } as DatasetResourceIndexEntry,
      role,
    );
  };

  return (
    <div
      ref={rootRef}
      style={placement === "below" ? { transform: `translateX(calc(${align === "start" ? "0px" : "-50%"} + ${shift}px))` } : undefined}
      // The items column's own shell: same ground, same border. Tall enough
      // for the paged grid to show a few rows; the pane sizes its page to it.
      className={[
        // pointer-events-auto: the board's toolbars are pointer-events-none
        // layers and the picker inherits that; nowheel/nodrag keep the wheel
        // paging the list instead of zooming the board under it.
        "pointer-events-auto nodrag nowheel absolute z-20 flex h-[min(560px,calc(100*var(--ui-vh)-120px))] w-full max-w-[calc(100*var(--ui-vw)-16px)] flex-col overflow-hidden border border-neutral-800 bg-[#25272c] text-neutral-100 shadow-[0_8px_24px_rgba(0,0,0,0.5)] sm:w-[380px] sm:max-w-[380px]",
        placement === "above" ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : `${align === "start" ? "left-0" : "left-1/2"} top-full mt-2`,
      ].join(" ")}
      data-item-picker={role}
    >
      <ResourceIndexPane
        search={search}
        onSearchChange={setSearch}
        onBrowse={pick}
        autoFocus
      />
    </div>
  );
}
