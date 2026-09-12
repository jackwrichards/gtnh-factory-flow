"use client";

import { useEffect, useRef, type RefObject } from "react";
import { subscribeBoardCameraMove } from "@/lib/board-camera-signal";

/**
 * How every dropdown in the app closes (Jack, 2026-09-07: menus should be
 * "more prone to close"). One rule, applied to the machine menu, the config
 * tile pickers, the in-card selects, the palettes, the toolbar fold-outs and
 * the header menus alike:
 *
 * - a press anywhere outside the panel (and its anchor) closes it;
 * - Escape closes it and is consumed, so a dropdown over a larger surface
 *   never takes that surface down with it;
 * - a wheel turn or a scroll outside the panel closes it - the hand has
 *   moved on to the page, and a fixed menu no longer points at anything;
 * - the board camera moving closes it, however the camera was moved (drag,
 *   wheel, WASD, pinch, a fly-to);
 * - a window resize closes it, except a keyboard height change while typing;
 * - with `fade`, a MOUSE drifting away dims the panel with distance and
 *   closes it past `FADE_GRACE + FADE_RANGE` px from the panel or anchor.
 *   Re-entering restores it. Fingers never fade: a touch has no hover.
 *
 * Capture phase throughout: the board's pan handler and the search's panels
 * stop pointer events on their way up, and a bubbling listener never heard
 * a press that landed there.
 */
export interface DropdownDismissOptions {
  /** The panel first, then any anchor whose own click toggles the menu. */
  refs: ReadonlyArray<RefObject<Element | null>>;
  onClose: () => void;
  /** A selector for elements that count as inside (an anchor without a ref). */
  insideSelector?: string;
  /** Dim and close as the mouse moves away. */
  fade?: boolean;
  /** Skip the board-camera rule (a menu that lives off the board and follows nothing). */
  ignoreCameraMove?: boolean;
}

/** Pixels of free travel outside the panel before the fade begins. */
export const FADE_GRACE = 40;
/** Pixels over which the panel fades from full to gone. */
export const FADE_RANGE = 160;

function isInside(target: EventTarget | null, options: DropdownDismissOptions): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  for (const ref of options.refs) {
    if (ref.current?.contains(target)) {
      return true;
    }
  }
  if (options.insideSelector && target instanceof Element && target.closest(options.insideSelector)) {
    return true;
  }
  return false;
}

/** Distance from a point to the nearest edge of a rect, 0 inside it. */
function distanceToRect(x: number, y: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Distance from a point to an element AND its children. Most callers hand
 * over a small `relative` wrapper (the button) whose menu is an `absolute`
 * child hanging under it, and a bounding box does not cover absolutely
 * positioned children - so measured against the wrapper alone, a pointer
 * walking down a tall menu read as drifting away and closed it before it
 * reached the bottom row.
 */
function distanceToElement(x: number, y: number, element: Element): number {
  let nearest = distanceToRect(x, y, element.getBoundingClientRect());
  for (const child of element.children) {
    if (nearest === 0) break;
    nearest = Math.min(nearest, distanceToRect(x, y, child.getBoundingClientRect()));
  }
  return nearest;
}

export function useDropdownDismiss(open: boolean, options: DropdownDismissOptions): void {
  const { fade, ignoreCameraMove, insideSelector } = options;
  const refs = options.refs;
  // Held in a ref: callers pass inline closures, and re-subscribing on every
  // render would reset a fading panel's opacity mid-fade.
  const onCloseRef = useRef(options.onClose);
  useEffect(() => {
    onCloseRef.current = options.onClose;
  });
  useEffect(() => {
    const onClose = () => onCloseRef.current();
    if (!open) {
      return;
    }
    const opts: DropdownDismissOptions = { refs, onClose, insideSelector, fade, ignoreCameraMove };
    const openedWidth = window.innerWidth;
    const editingInside = () => {
      const active = document.activeElement;
      return isInside(active, opts) && active instanceof HTMLElement &&
        (active.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea") || active.isContentEditable);
    };
    const panel = () => refs[0]?.current as HTMLElement | null | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      // The opacity is NOT restored here: onClose unmounts the menu on a
      // later commit, so restoring it now painted one solid frame of a
      // panel that had faded almost to nothing. The effect cleanup restores
      // it once the menu is gone.
      onClose();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target, opts)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!isInside(event.target, opts)) close();
    };
    const onScroll = (event: Event) => {
      // ScrollCamera restores native focus/scrollIntoView accidents. Its
      // wrapper scrolling is not evidence of a camera gesture; the explicit
      // camera signal below already covers every real pan and zoom.
      if (event.target instanceof Element &&
          event.target.matches("[data-scroll-camera] .react-flow")) return;
      // Mobile focus can scroll the document to reveal the keyboard. Keep
      // the filter alive; outside presses/wheels and other scrollers still close.
      if ((event.target === window || event.target === document ||
           event.target === document.documentElement || event.target === document.body) && editingInside()) return;
      if (!isInside(event.target, opts)) close();
    };
    const onResize = () => {
      if (window.innerWidth === openedWidth && editingInside()) return;
      close();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      // Over the panel or its anchor, however deep: that is distance zero,
      // whatever the boxes say.
      let nearest = isInside(event.target, opts) ? 0 : Number.POSITIVE_INFINITY;
      for (const ref of refs) {
        if (nearest === 0) break;
        const element = ref.current;
        if (!element) continue;
        nearest = Math.min(nearest, distanceToElement(event.clientX, event.clientY, element));
      }
      if (!Number.isFinite(nearest)) return;
      const element = panel();
      if (!element) return;
      if (nearest <= FADE_GRACE) {
        element.style.opacity = "";
        return;
      }
      const away = (nearest - FADE_GRACE) / FADE_RANGE;
      if (away >= 1) {
        close();
        return;
      }
      element.style.opacity = String(Math.max(0.15, 1 - away));
    };

    const capture = { capture: true } as const;
    const passiveCapture = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onPointerDown, capture);
    window.addEventListener("keydown", onKeyDown, capture);
    window.addEventListener("wheel", onWheel, passiveCapture);
    window.addEventListener("scroll", onScroll, passiveCapture);
    window.addEventListener("resize", onResize);
    if (fade) window.addEventListener("pointermove", onPointerMove, passiveCapture);
    const unsubscribe = ignoreCameraMove ? undefined : subscribeBoardCameraMove(close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, capture);
      window.removeEventListener("keydown", onKeyDown, capture);
      window.removeEventListener("wheel", onWheel, passiveCapture);
      window.removeEventListener("scroll", onScroll, passiveCapture);
      window.removeEventListener("resize", onResize);
      if (fade) window.removeEventListener("pointermove", onPointerMove, passiveCapture);
      unsubscribe?.();
      const element = panel();
      if (element) element.style.opacity = "";
    };
    // The refs array is rebuilt per render; its members are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fade, ignoreCameraMove, insideSelector, ...refs]);
}
