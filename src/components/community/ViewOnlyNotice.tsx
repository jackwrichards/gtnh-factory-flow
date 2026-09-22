"use client";

import { Copy, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { copyViewedPost } from "@/lib/community/open-post";
import { writeWorkspaceView } from "@/lib/workspace-view";

export function ViewOnlyNotice() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="absolute inset-x-2 top-2 border border-line bg-surface p-3 text-sm shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <strong className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" aria-hidden />View only</strong>
        <button type="button" aria-label="Hide the items column" onClick={() => writeWorkspaceView({ leftPanelOpen: false })} className="px-2">‹</button>
      </div>
      <p className="mt-1 text-xs leading-5 text-fg-muted">This shared plan is view only. Make a copy to add machines, connect items, or change settings.</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await copyViewedPost();
          } catch (thrown) {
            setError(thrown instanceof Error ? thrown.message : "Could not create your copy.");
          } finally {
            setBusy(false);
          }
        }}
        className="mt-2 inline-flex h-7 items-center gap-1.5 rounded border border-line bg-surface-raised px-2 text-xs text-fg hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-50"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Opening…" : "Make a copy"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
