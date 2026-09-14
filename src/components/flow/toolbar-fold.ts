"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Shared size for the board's top and corner controls. */
export const BOARD_TOOL_SCALE = 0.8;

/** Responsive board chrome: labeled modes, icon modes, then folded tools.
 * Measurements are shell pixels. Only rem-sized parts grow with Firefox text
 * zoom; the 76px power key and 96/44px mode keys keep their fixed widths.
 * Reserve manual recalculate in every mode so a
 * button becoming visible never creates an overlap.
 */
export interface ToolbarFold {
  build: boolean;
  paint: boolean;
  paintFoldsAll: boolean;
  modeIconsOnly: boolean;
}

export function toolbarFoldFor(boardWidth: number, compact: boolean, textScale = 1): ToolbarFold {
  const scale = Number.isFinite(textScale) ? Math.max(1, textScale) : 1;
  const buildWidth = (260 * scale + 92) * BOARD_TOOL_SCALE;
  const foldedBuildWidth = (124 * scale + 8) * BOARD_TOOL_SCALE;
  const paintWidth = (124 * scale + 8) * BOARD_TOOL_SCALE;
  const foldedPaintWidth = (40 * scale + 4) * BOARD_TOOL_SCALE;
  const margin = 12 * scale;
  const gap = 16 * scale;
  const labelModesWidth = (296 + 8 * scale) * BOARD_TOOL_SCALE;
  const iconModesWidth = (140 + 8 * scale) * BOARD_TOOL_SCALE;
  // The mode tray can shift within the gap: reserve each row's real budget,
  // rather than wasting a second copy of the wider left row to center it.
  const rowFits = (modesWidth: number, rightWidth: number) =>
    boardWidth >= buildWidth + modesWidth + rightWidth + 2 * (margin + gap);
  const modeIconsOnly = compact || !rowFits(labelModesWidth, paintWidth);
  const build = compact || !rowFits(iconModesWidth, foldedPaintWidth);
  const paint = compact || (build
    ? boardWidth < foldedBuildWidth + paintWidth + 2 * margin + gap
    : !rowFits(modeIconsOnly ? iconModesWidth : labelModesWidth, paintWidth));
  return { build, paint, paintFoldsAll: paint, modeIconsOnly };
}

/** The name the unfolded rows read their width cap from. */
export const BOARD_WIDTH_VAR = "--board-width";

/**
 * Watches the board element's width and reports the fold it calls for.
 *
 * State holds the FOLD, never the width: the board re-renders when a side
 * folds or unfolds, not on every pixel of a window resize. The width itself
 * is written straight onto the element as a CSS variable, so an unfolded row
 * can cap itself at the board rather than the viewport (with the side
 * columns open, the two are hundreds of pixels apart).
 */
export function useToolbarFold(
  boardRef: RefObject<HTMLElement | null>,
  compact: boolean,
): ToolbarFold {
  const [fold, setFold] = useState<ToolbarFold>(() => toolbarFoldFor(Infinity, compact));

  useLayoutEffect(() => {
    const element = boardRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      setFold(toolbarFoldFor(Infinity, compact));
      return;
    }
    const measure = () => {
      const width = element.clientWidth;
      element.style.setProperty(BOARD_WIDTH_VAR, `${width}px`);
      const hiddenPanelWidth = Number.parseFloat(getComputedStyle(element).getPropertyValue("--toolbar-hidden-panel-width")) || 0;
      const textScale = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
      const sharedWidth = Math.max(0, width - hiddenPanelWidth);
      const next = toolbarFoldFor(sharedWidth, compact, textScale);
      // At the narrowest sizes, use the edge gutters before hiding or
      // squeezing the always-visible undo/redo and the two fold triggers.
      const scale = Number.isFinite(textScale) ? Math.max(1, textScale) : 1;
      const modesWidth = ((next.modeIconsOnly ? 140 : 296) + 8 * scale) * BOARD_TOOL_SCALE;
      const leftToolsWidth = (260 * scale + 92) * BOARD_TOOL_SCALE;
      const rightToolsWidth = (next.paint ? 40 * scale + 4 : 124 * scale + 8) * BOARD_TOOL_SCALE;
      const clearance = 28 * scale;
      // Center in the canvas width shared by all three modes. At tighter
      // widths, slide only far enough to clear the tools on either side.
      const modeLeft = Math.max(leftToolsWidth + clearance, Math.min(
        (sharedWidth - modesWidth) / 2,
        sharedWidth - rightToolsWidth - clearance - modesWidth,
      ));
      element.style.setProperty("--toolbar-mode-left", `${modeLeft}px`);
      const inset = next.build && next.paint
        ? Math.max(0, Math.min(12 * scale, (width - (168 * scale + 12) * BOARD_TOOL_SCALE) / 2))
        : 12 * scale;
      element.style.setProperty("--toolbar-inset", `${inset}px`);
      setFold((current) =>
        current.build === next.build &&
        current.paint === next.paint &&
        current.modeIconsOnly === next.modeIconsOnly &&
        current.paintFoldsAll === next.paintFoldsAll
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Text-only zoom can change the controls without changing the board width.
    // Observe the trays too; this remains resize work, never a canvas-frame read.
    for (const tray of element.querySelectorAll("[data-toolbar-tray]")) observer.observe(tray);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [boardRef, compact]);

  return fold;
}
