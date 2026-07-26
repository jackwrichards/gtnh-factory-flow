"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Shared modal shell for the planner dialogs. Portals to <body> because the
 * board and its columns clip absolutely-positioned descendants.
 */
export function PlannerDialog({
  title,
  onClose,
  children,
  widthClassName = "w-[520px]",
  heightClassName = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  /** e.g. "h-[86vh]" for pickers that want all the room they can get. */
  heightClassName?: string;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] grid place-items-center bg-black/45 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${widthClassName} ${heightClassName} flex max-h-[88vh] min-h-0 flex-col border border-line-strong bg-surface text-fg shadow-2xl`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-base font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-sunken hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
