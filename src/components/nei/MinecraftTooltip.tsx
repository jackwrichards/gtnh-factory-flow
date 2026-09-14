"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import { isTouchPointer } from "@/lib/pointer-kind";
import { TOOLTIP_PANEL_CLASS } from "./tooltip-style";

/**
 * What is under the pointer once a wheel or scroll has settled, or undefined
 * where the document cannot say (jsdom has no elementFromPoint).
 */
export function elementUnderPointer(x: number, y: number): Element | null | undefined {
  if (typeof document.elementFromPoint !== "function") {
    return undefined;
  }
  return document.elementFromPoint(x, y);
}


export function MinecraftTooltip({
  label,
  content,
  companion,
  children,
  placement = "pointer",
  compact = false,
}: {
  label?: string | string[];
  /**
   * Rich panel body; wins over `label` and brings its own typography. Pass a
   * THUNK when the body is expensive to build: it is invoked only while the
   * tooltip is actually open, so a card with eight port tooltips does not
   * build eight discarded panels on every render.
   */
  content?: ReactNode | (() => ReactNode);
  /** A separate controls legend beside the rich panel, wrapping on narrow screens. */
  companion?: ReactNode | (() => ReactNode);
  children: ReactNode;
  /** Anchor readouts to their controls, flipping when the preferred side cannot fit. */
  placement?: "pointer" | "below" | "above" | "above-card";
  /** Small canvas readouts use the same panel with tighter padding. */
  compact?: boolean;
}) {
  const lines = useMemo(
    () => (Array.isArray(label) ? label : label ? label.split("\n") : []),
    [label],
  );
  const hasContent = content !== undefined && content !== null;
  const [position, setPosition] = useState<{ x: number; y: number; maxHeight?: number; belowCard?: boolean } | undefined>();
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPositionRef = useRef<{ x: number; y: number; maxHeight?: number; belowCard?: boolean } | undefined>(undefined);
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<DOMRect | undefined>(undefined);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  const readAnchorRect = useCallback(() => {
    const root = rootRef.current;
    // The worksheet reuses canvas controls outside React Flow nodes. Anchor
    // to the control there, so a large power panel cannot fall back to
    // pointer placement and cover the very dial being adjusted.
    const card = placement === "above-card" ? root?.closest(".react-flow__node") : undefined;
    return (card ?? root?.firstElementChild)?.getBoundingClientRect();
  }, [placement]);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  // A press on one of the hover surface's OWN controls (the tier chip, the
  // hatch counter) is the tooltip's subject being used, not the pointer
  // leaving: the panel stays up and re-reads itself, so clicking through
  // tiers shows each result without re-hovering. Presses anywhere else —
  // panning, dragging, other cards — still clear.
  const pressKeepsTooltip = useCallback(
    (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      rootRef.current?.contains(target) === true &&
      target.closest("button, input, select, textarea") !== null,
    [],
  );

  const clampToViewport = useCallback(
    (pointerX: number, pointerY: number) => {
      const panelWidth = panelRef.current?.offsetWidth ?? (hasContent ? 340 : 320);
      const panelHeight = panelRef.current?.offsetHeight ?? (hasContent ? 240 : 80);
      const anchorWidth = companion ? (panelRef.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? panelWidth : panelWidth;
      // Shell pixels throughout: the panel is a body portal wearing .ui-zoom,
      // so its left/top and offset size are shell pixels, and the pointer and
      // window (real pixels) are divided by the interface scale (ui-scale.ts).
      const scale = getUiScale();
      const anchor = placement !== "pointer" ? anchorRef.current : undefined;
      if (anchor) {
        const below = anchor.bottom / scale + 6;
        const above = anchor.top / scale - panelHeight - 6;
        if (placement === "above-card") {
          // Measure the full content, not its currently constrained viewport,
          // so a clipped panel cannot make the placement oscillate.
          const naturalHeight = Math.max(panelHeight, panelRef.current?.scrollHeight ?? 0);
          const aboveSpace = Math.max(0, anchor.top / scale - 14);
          const belowSpace = Math.max(0, window.innerHeight / scale - below - 8);
          const belowCard = naturalHeight > aboveSpace && belowSpace > aboveSpace;
          const maxHeight = belowCard ? belowSpace : aboveSpace;
          return {
            belowCard,
            maxHeight,
            x: Math.max(4, Math.min(anchor.right / scale - anchorWidth, window.innerWidth / scale - panelWidth - 8)),
            y: belowCard ? below : Math.max(4, anchor.top / scale - Math.min(naturalHeight, maxHeight) - 6),
          };
        }
        const preferredY = placement === "above"
          ? (above >= 4 ? above : below)
          : (below + panelHeight <= window.innerHeight / scale - 8 || above < 4 ? below : above);
        return {
          x: Math.max(4, Math.min(anchor.right / scale - anchorWidth, window.innerWidth / scale - panelWidth - 8)),
          y: Math.max(4, Math.min(preferredY, window.innerHeight / scale - panelHeight - 8)),
        };
      }
      return {
        x: Math.max(4, Math.min(pointerX / scale + 12, window.innerWidth / scale - panelWidth - 8)),
        y: Math.max(4, Math.min(pointerY / scale + 12, window.innerHeight / scale - panelHeight - 8)),
      };
    },
    [hasContent, placement, companion],
  );

  // The first placement of a fresh tooltip clamps against an ESTIMATED panel
  // size, and near a screen edge the estimate lands the panel a hundred-odd
  // pixels from where the measured clamp will. Re-clamping here, before the
  // browser paints, means nobody ever sees the estimate's position - which
  // used to read as the tooltip jittering sideways while the pointer crossed
  // list rows, each row remounting the panel at the estimate first.
  useLayoutEffect(() => {
    const pointer = pointerRef.current;
    if (!position || !pointer || !panelRef.current) {
      return;
    }
    const corrected = clampToViewport(pointer.x, pointer.y);
    if (Math.abs(corrected.x - position.x) >= 2 || Math.abs(corrected.y - position.y) >= 2 || corrected.maxHeight !== position.maxHeight || corrected.belowCard !== position.belowCard) {
      setPosition(corrected);
    }
  }, [clampToViewport, position, content]);

  const handleMouseMove = (event: MouseEvent) => {
    if (lines.length === 0 && !hasContent) {
      return;
    }

    // A finger has no hover to answer, and no way to stop hovering.
    if (isTouchPointer()) {
      clearTooltip();
      return;
    }

    // Tooltips nest: a row-wide reveal can hold buttons with their own
    // tips. Whoever is CLOSEST to the pointer owns it — an outer tooltip
    // yields (and hides) over any inner tooltip region or anything marked
    // data-tooltip-stop (tag chips, editors).
    const owner = (event.target as HTMLElement | null)?.closest(
      "[data-tooltip-root], [data-tooltip-stop]",
    );
    if (owner && owner !== rootRef.current) {
      clearTooltip();
      return;
    }

    if (event.buttons !== 0 && !pressKeepsTooltip(event.target)) {
      pendingPositionRef.current = undefined;
      if (position !== undefined) {
        setPosition(undefined);
      }
      return;
    }

    // Clamp to the measured panel so wide or tall tooltips stay fully on
    // screen; before the first paint we fall back to a generous estimate,
    // and the layout effect below re-clamps against the real size before
    // anything is painted.
    if (placement !== "pointer" && event.type === "mouseenter") {
      // The wrapper is display:contents. Read its control once on entry,
      // never on the mousemove/animation-frame path.
      anchorRef.current = readAnchorRect();
    }
    pointerRef.current = { x: event.clientX, y: event.clientY };
    pendingPositionRef.current = clampToViewport(event.clientX, event.clientY);

    if (frameRef.current !== undefined) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      const nextPosition = pendingPositionRef.current;
      if (!nextPosition) {
        return;
      }

      setPosition((currentPosition) =>
        currentPosition && currentPosition.maxHeight === nextPosition.maxHeight && currentPosition.belowCard === nextPosition.belowCard &&
        Math.abs(currentPosition.x - nextPosition.x) < 2 &&
        Math.abs(currentPosition.y - nextPosition.y) < 2
          ? currentPosition
          : nextPosition,
      );
    });
  };

  const clearTooltip = useCallback(() => {
    pendingPositionRef.current = undefined;
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    // A functional update, never a closure check: the tip opens on an
    // animation frame, and a fast pointer has often LEFT before React has
    // re-rendered with the open position. The leave handler that fires then
    // still holds the closed state, and guarding on it skipped the hide -
    // the panel committed open with nobody left to close it, and a quick
    // sweep across a board left hundreds standing until the next click.
    setPosition((current) => (current === undefined ? current : undefined));
  }, []);

  useEffect(() => {
    if (!position) {
      return undefined;
    }

    const clearOnInteraction = () => clearTooltip();
    const clearOnPointerDown = (event: Event) => {
      if (pressKeepsTooltip(event.target)) {
        return;
      }
      clearTooltip();
    };
    // Capture-phase "blur" sees every ELEMENT losing focus, and clicking the
    // chip under the tooltip blurs whatever held focus before it — only the
    // window itself going unfocused means the pointer story ended. Told apart
    // by the target's kind, not identity: an element's blur names the element,
    // the window's names the window.
    const clearOnWindowBlur = (event: Event) => {
      if (event.target instanceof Element) {
        return;
      }
      clearTooltip();
    };
    // A wheel or scroll NEVER clears a tooltip by itself (Jack, 2026-09-07):
    // zooming the board keeps the card under the pointer, a slot that eats
    // the wheel to step through its items never moves, a setting tile steps
    // its count in place - and in every one of those the tip blinking out
    // read as broken. So the question is asked a frame later, once the
    // page has settled: is the hovered thing STILL under the pointer? It
    // stays while the answer is yes and goes only when something else has
    // scrolled in. Where the document cannot answer, the tip stays.
    let settleFrame: number | undefined;
    const recheckAfterScroll = () => {
      if (settleFrame !== undefined) {
        return;
      }
      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = undefined;
        const pointer = pointerRef.current;
        if (!pointer) {
          return;
        }
        const under = elementUnderPointer(pointer.x, pointer.y);
        if (under === undefined || (under && rootRef.current?.contains(under))) {
          if (placement !== "pointer") {
            anchorRef.current = readAnchorRect();
            const next = clampToViewport(pointer.x, pointer.y);
            setPosition(current => current && current.maxHeight === next.maxHeight && Math.abs(current.x - next.x) < 2 && Math.abs(current.y - next.y) < 2 ? current : next);
          }
          return;
        }
        clearTooltip();
      });
    };
    const options = { capture: true, passive: true } as const;

    window.addEventListener("wheel", recheckAfterScroll, options);
    window.addEventListener("scroll", recheckAfterScroll, options);
    window.addEventListener("pointerdown", clearOnPointerDown, options);
    window.addEventListener("pointercancel", clearOnInteraction, options);
    window.addEventListener("resize", clearOnInteraction, options);
    window.addEventListener("blur", clearOnWindowBlur, options);
    return () => {
      if (settleFrame !== undefined) {
        window.cancelAnimationFrame(settleFrame);
      }
      window.removeEventListener("wheel", recheckAfterScroll, options);
      window.removeEventListener("scroll", recheckAfterScroll, options);
      window.removeEventListener("pointerdown", clearOnPointerDown, options);
      window.removeEventListener("pointercancel", clearOnInteraction, options);
      window.removeEventListener("resize", clearOnInteraction, options);
      window.removeEventListener("blur", clearOnWindowBlur, options);
    };
  }, [clearTooltip, position, pressKeepsTooltip, placement, clampToViewport, readAnchorRect]);

  return (
    <span
      ref={rootRef}
      data-tooltip-root=""
      className="contents"
      onMouseEnter={handleMouseMove}
      onMouseMove={handleMouseMove}
      onMouseLeave={clearTooltip}
    >
      {children}
      {position && (lines.length > 0 || hasContent) && typeof document !== "undefined"
        ? createPortal(
            hasContent ? (
              <div
                ref={panelRef}
                data-minecraft-tooltip={companion ? undefined : "true"}
                className={companion ? `pointer-events-none fixed z-[9999] ui-zoom flex w-max flex-wrap gap-1 ${position.belowCard ? "items-start" : "items-end"}` : `${TOOLTIP_PANEL_CLASS} ui-zoom max-w-[640px] ${compact ? "px-2 py-1.5" : "px-3 py-2.5"}`}
                data-card-placement={placement === "above-card" ? (position.belowCard ? "below" : "above") : undefined}
                style={{ left: position.x, top: position.y, ...(placement !== "pointer" ? { maxWidth: window.innerWidth / getUiScale() - 16 } : {}), ...(placement === "above-card" ? { maxHeight: position.maxHeight, overflowY: "auto" } : {}) }}
              >
                {companion ? <>
                  <div data-minecraft-tooltip="true" className={`${TOOLTIP_PANEL_CLASS} !relative min-w-0 max-w-full px-3 py-2.5`}>
                    {typeof content === "function" ? content() : content}
                  </div>
                  <div data-tooltip-companion className={`${TOOLTIP_PANEL_CLASS} !relative min-w-0 max-w-full px-3 py-2.5`}>
                    {typeof companion === "function" ? companion() : companion}
                  </div>
                </> : typeof content === "function" ? content() : content}
              </div>
            ) : (
              <div
                ref={panelRef}
                data-minecraft-tooltip="true"
                // w-max, and 420 rather than 340: a fixed panel with no width
                // of its own is squeezed by whatever room is left to the
                // viewport's edge, so a one-line label near the right side of
                // the screen shrink-wrapped and broke its last word onto a line
                // of its own. Asking for max-content makes the panel state its
                // real width; the pointer clamp above reads that width back and
                // walks it inside the edge.
                className={`${TOOLTIP_PANEL_CLASS} ui-zoom w-max max-w-[420px] px-2 py-1 font-mono text-[16px] leading-[19px]`}
                style={{ left: position.x, top: position.y }}
              >
                {lines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className={index === 0 ? "text-fg" : "text-fg-subtle"}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ),
            document.body,
          )
        : null}
    </span>
  );
}
