"use client";

import { CopyCheck, X } from "lucide-react";
import { useDesignStore } from "@/store/design-store";

/**
 * Said once, when this browser tab held edits to a design another tab had
 * already saved a newer version of (design-store.ts, persistCanvas): the newer
 * version stayed, and this tab's edits became a copy. Nothing was lost, and
 * the player needs to know where each half went.
 */
export function TabConflictNotice() {
  const conflict = useDesignStore((state) => state.tabConflict);
  const dismiss = useDesignStore((state) => state.dismissTabConflict);
  if (!conflict) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex min-w-0 items-center gap-2 border-b border-amber-700/60 bg-amber-950/60 px-3 py-1.5 text-xs text-amber-100"
    >
      <CopyCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        Another browser tab saved a newer version of &ldquo;{conflict.name}&rdquo;, so your edits
        from this tab were kept as &ldquo;{conflict.copyName}&rdquo;. Nothing was lost.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-amber-200 hover:bg-amber-900/60"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
