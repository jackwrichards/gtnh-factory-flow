"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getUiScale } from "@/lib/ui-scale";
import { isTouchPointer } from "@/lib/pointer-kind";
import { TOOLTIP_PANEL_CLASS } from "./tooltip-style";

/**
 * Every browser `title` attribute in the app, rendered as the planner's own
 * tooltip instead of the browser's.
 *
 * One delegated listener, mounted once: on hover it finds the nearest
 * `[title]`, MOVES the text into `data-tip-title` (so the native popup can
 * never render - an attribute that is gone cannot be shown), and paints the
 * same words in the Minecraft panel every other tooltip here uses. React
 * changing a hovered control's title updates the panel immediately, without
 * requiring the pointer to leave and re-enter.
 *
 * Precedence with the rich tooltips (MinecraftTooltip):
 * - An element that IS a rich root keeps its rich panel; its `title` was a
 *   duplicate and is stripped without replacement.
 * - A titled element INSIDE a rich area gets stamped `data-tooltip-stop`,
 *   which the rich wrapper already yields to - so hovering a button inside a
 *   card swaps the card's story for the button's own line, one panel at a
 *   time, never two.
 */
const STORED = "data-tip-title";

export function GlobalTitleTooltip() {
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | undefined>();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<{ lines: string[]; x: number; y: number } | undefined>(undefined);
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined);

  useEffect(() => {
    let hovered: Element | null = null;
    let buttons = 0;
    let pressedAt: { x: number; y: number } | undefined;
    let settleFrame: number | undefined;
    const observer = new MutationObserver((records) => {
      // A removed title means the help was removed, not that the cached old
      // title should live forever. Our own title conversion is unobserved.
      if (records.some(record => record.attributeName === "title") && !hovered?.hasAttribute("title")) {
        hovered?.removeAttribute(STORED);
      }
      recheckAtPointer();
    });
    const hide = () => {
      observer.disconnect();
      hovered = null;
      if (settleFrame !== undefined) {
        window.cancelAnimationFrame(settleFrame);
        settleFrame = undefined;
      }
      pendingRef.current = undefined;
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      setTip((current) => (current === undefined ? current : undefined));
    };

    const flush = () => {
      frameRef.current = undefined;
      const next = pendingRef.current;
      if (!next) {
        return;
      }
      setTip((current) =>
        current &&
        current.lines === next.lines &&
        Math.abs(current.x - next.x) < 2 &&
        Math.abs(current.y - next.y) < 2
          ? current
          : next,
      );
    };

    const resolveAt = (target: Element | null, clientX: number, clientY: number, buttons: number) => {
      if (isTouchPointer()) {
        hide();
        return;
      }
      const titled = target?.closest?.(`[title], [${STORED}]`) ?? null;
      if (!titled) {
        hide();
        return;
      }

      // Strip the native attribute the moment it is seen. Do this even for
      // rich roots: their panel already says it, and the browser's box on
      // top of ours is exactly the doubling this component exists to end.
      observer.disconnect();
      const native = titled.getAttribute("title");
      if (native !== null) {
        titled.removeAttribute("title");
        if (native.trim() && !titled.hasAttribute("data-tooltip-root")) {
          titled.setAttribute(STORED, native);
          titled.setAttribute("data-tooltip-stop", "");
        } else {
          titled.removeAttribute(STORED);
        }
      }
      if (titled.hasAttribute("data-tooltip-root")) {
        hide();
        return;
      }
      const text = titled.getAttribute(STORED);
      const holdingOwnControl = hovered === titled && pressedAt && Math.hypot(clientX - pressedAt.x, clientY - pressedAt.y) < 6;
      if (!text || (buttons !== 0 && !holdingOwnControl)) {
        hide();
        return;
      }

      hovered = titled;
      observer.observe(titled, { attributes: true, attributeFilter: ["title", STORED] });
      const lines = text.split("\n");
      const panelWidth = panelRef.current?.offsetWidth ?? 260;
      const panelHeight = panelRef.current?.offsetHeight ?? 60;
      // The panel is a body portal wearing .ui-zoom, so its left/top and its
      // offset size are shell pixels: the pointer and the window (real
      // pixels) are brought across by the interface scale (ui-scale.ts).
      const scale = getUiScale();
      pendingRef.current = {
        lines,
        x: Math.max(4, Math.min(clientX / scale + 12, window.innerWidth / scale - panelWidth - 8)),
        y: Math.max(4, Math.min(clientY / scale + 12, window.innerHeight / scale - panelHeight - 8)),
      };
      if (frameRef.current === undefined) {
        frameRef.current = window.requestAnimationFrame(flush);
      }
    };
    const onMove = (event: globalThis.MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      buttons = event.buttons;
      resolveAt(event.target as Element | null, event.clientX, event.clientY, event.buttons);
    };
    // A wheel or scroll never hides a tip by itself (Jack, 2026-09-07): a
    // frame later, once the page has settled, the tip is re-read from
    // whatever is under the pointer - the same thing keeps it, something
    // else scrolled in re-targets it, and where the document cannot say
    // (no elementFromPoint) the tip stays.
    const recheckAtPointer = () => {
      if (settleFrame !== undefined) {
        return;
      }
      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = undefined;
        const pointer = pointerRef.current;
        if (!pointer) {
          return;
        }
        const under = typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(pointer.x, pointer.y)
          : hovered?.isConnected ? hovered : null;
        resolveAt(under, pointer.x, pointer.y, buttons);
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      buttons = event.buttons;
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest("button, input, select, textarea, [role=button]");
      if (event.pointerType === "mouse" && hovered && target && hovered.contains(target) && control) {
        pressedAt = { x: event.clientX, y: event.clientY };
        return;
      }
      pressedAt = undefined;
      hide();
    };
    const onPointerUp = (event: PointerEvent) => {
      buttons = event.buttons;
      pressedAt = undefined;
      recheckAtPointer();
    };
    const onWindowBlur = (event: Event) => {
      if (!(event.target instanceof Element)) hide();
    };
    const options = { capture: true, passive: true } as const;
    document.addEventListener("mousemove", onMove, options);
    window.addEventListener("wheel", recheckAtPointer, options);
    window.addEventListener("scroll", recheckAtPointer, options);
    window.addEventListener("pointerdown", onPointerDown, options);
    window.addEventListener("pointerup", onPointerUp, options);
    window.addEventListener("click", recheckAtPointer, options);
    window.addEventListener("pointercancel", hide, options);
    window.addEventListener("resize", hide, options);
    window.addEventListener("blur", onWindowBlur, options);
    document.documentElement.addEventListener("mouseleave", hide);
    return () => {
      observer.disconnect();
      document.removeEventListener("mousemove", onMove, options);
      window.removeEventListener("wheel", recheckAtPointer, options);
      window.removeEventListener("scroll", recheckAtPointer, options);
      if (settleFrame !== undefined) {
        window.cancelAnimationFrame(settleFrame);
      }
      window.removeEventListener("pointerdown", onPointerDown, options);
      window.removeEventListener("pointerup", onPointerUp, options);
      window.removeEventListener("click", recheckAtPointer, options);
      window.removeEventListener("pointercancel", hide, options);
      window.removeEventListener("resize", hide, options);
      window.removeEventListener("blur", onWindowBlur, options);
      document.documentElement.removeEventListener("mouseleave", hide);
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  if (!tip || typeof document === "undefined") {
    return null;
  }

  // Same skin as MinecraftTooltip's plain-lines panel, so a converted title
  // is indistinguishable from a tooltip somebody wrote by hand.
  return createPortal(
    <div
      ref={panelRef}
      data-minecraft-tooltip="true"
      className={`${TOOLTIP_PANEL_CLASS} ui-zoom max-w-[340px] px-2 py-1 font-mono text-[16px] leading-[19px]`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.lines.map((line, index) => (
        <div key={`${line}-${index}`} className={index === 0 ? "text-fg" : "text-fg-subtle"}>
          {line}
        </div>
      ))}
    </div>,
    document.body,
  );
}
