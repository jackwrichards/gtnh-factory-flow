"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), details > summary:first-of-type, [tabindex]:not([tabindex="-1"]), [role="button"][tabindex="0"], [role="radio"][tabindex="0"]';

/** Open dialogs, newest last: only the top one answers Escape and traps Tab. */
const stack: object[] = [];

function visible(element: HTMLElement): boolean {
  if (element.closest("[hidden], [inert]")) return false;
  // Closed details expose only their summary; hidden inputs cannot be a trap endpoint.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
      const summary = ancestor.querySelector(":scope > summary");
      if (!summary?.contains(element)) return false;
    }
  }
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * What every dialog does for the keyboard: focus moves in when it opens (to `initialFocus`, else the first
 * focusable thing, else the dialog itself) and comes back to where it was when it closes; Tab and Shift+Tab stay
 * inside it; Escape closes it (unless something inside, a dropdown or a text field, took the key first).
 * `escape: false` for a dialog that already closes itself.
 */
export function useDialogA11y(
  ref: RefObject<HTMLElement | null>,
  { onClose, escape = true, initialFocus }: { onClose: () => void; escape?: boolean; initialFocus?: string },
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const token = {};
    stack.push(token);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    const focusables = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
    if (!root.contains(document.activeElement)) {
      const wanted = initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null;
      (wanted ?? focusables()[0] ?? root).focus({ preventScroll: true });
    }
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === "Escape" && escape && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(token);
      if (at >= 0) stack.splice(at, 1);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
    // Mount-only: the dialog's own re-renders must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
