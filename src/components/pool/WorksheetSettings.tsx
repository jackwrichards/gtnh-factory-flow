"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { getUiScale } from "@/lib/ui-scale";

/** A machine's controls float beside its settings key without changing row height. */
export function WorksheetSettings({
  id,
  label,
  anchor,
  onClose,
  children,
}: {
  id: string;
  label: string;
  anchor: { x: number; top: number; bottom: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDropdownDismiss(true, {
    refs: [panel],
    onClose,
    insideSelector: `[data-worksheet-settings-anchor][aria-controls="${id}"]`,
  });
  useEffect(() => {
    const element = panel.current;
    element?.focus({ preventScroll: true });
    const preventControlScroll = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".pool-machine-settings .nowheel")
      )
        event.preventDefault();
    };
    element?.addEventListener("wheel", preventControlScroll, { capture: true, passive: false });
    return () => element?.removeEventListener("wheel", preventControlScroll, true);
  }, []);
  const scale = getUiScale();
  const width = Math.min(320, window.innerWidth / scale - 16);
  const below = (window.innerHeight - anchor.bottom) / scale - 12;
  const above = anchor.top / scale - 12;
  const opensUp = below < 220 && above > below;
  return createPortal(
    <div
      className="ui-zoom pool-worksheet--dense pool-settings-popover nodrag nopan nowheel"
      id={id}
      ref={panel}
      role="dialog"
      aria-label={"Settings for " + label}
      tabIndex={-1}
      style={{
        width,
        left: Math.max(
          8,
          Math.min(anchor.x / scale - width, window.innerWidth / scale - width - 8),
        ),
        ...(opensUp
          ? { bottom: (window.innerHeight - anchor.top) / scale + 4, maxHeight: above }
          : { top: anchor.bottom / scale + 4, maxHeight: below }),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="pool-settings-section">{children}</div>
    </div>,
    document.body,
  );
}
