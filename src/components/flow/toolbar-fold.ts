"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

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
  const buildWidth = 260 * scale + 92;
  const foldedBuildWidth = 124 * scale + 8;
  const paintWidth = 124 * scale + 8;
  const foldedPaintWidth = 40 * scale + 4;
  const margin = 12 * scale;
  const gap = 16 * scale;
  const labelModesWidth = 296 + 8 * scale;
  const iconModesWidth = 140 + 8 * scale;
  const centerFits = (modesWidth: number, rightWidth: number) =>
    boardWidth >= 2 * Math.max(buildWidth + margin + gap, rightWidth + margin + gap) + modesWidth;
  const modeIconsOnly = compact || !centerFits(labelModesWidth, paintWidth);
  const build = compact || !centerFits(iconModesWidth, foldedPaintWidth);
  const paint = compact || (build
    ? boardWidth < foldedBuildWidth + paintWidth + 2 * margin + gap
    : !centerFits(modeIconsOnly ? iconModesWidth : labelModesWidth, paintWidth));
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
      const textScale = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
      const next = toolbarFoldFor(width, compact, textScale);
      // At the narrowest sizes, use the edge gutters before hiding or
      // squeezing the always-visible undo/redo and the two fold triggers.
      const scale = Number.isFinite(textScale) ? Math.max(1, textScale) : 1;
      const inset = next.build && next.paint
        ? Math.max(0, Math.min(12 * scale, (width - (168 * scale + 12)) / 2))
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
