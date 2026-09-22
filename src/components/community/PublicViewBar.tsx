"use client";

import { ScreenshotButton } from "@/components/export/ScreenshotButton";
import { Copy, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { copyViewedPost } from "@/lib/community/open-post";
import { useDesignStore } from "@/store/design-store";

export function PublicViewBar() {
  const view = useDesignStore((state) => state.publicView);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!view) return null;
  return (
    <section
      className="plan-summary min-w-0 border-b border-line bg-surface px-2"
      aria-label="Public setup viewer"
    >
      <div className="flex h-[29px] min-w-0 items-center gap-2 text-xs">
        <span className="plan-summary-lock inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted"><LockKeyhole className="h-3 w-3" aria-hidden /><span>View only</span></span>
        <span className="plan-summary-name min-w-0 max-w-[30%] shrink truncate font-semibold" title={view.name}>
          {view.name}
        </span>
        {view.project.description ? <button type="button" aria-label="Show plan description" aria-expanded={descriptionOpen}
          onClick={() => setDescriptionOpen(!descriptionOpen)}
          className="plan-summary-description flex h-6 min-w-0 flex-1 items-center rounded px-1 text-left text-fg-muted hover:bg-surface-raised hover:text-fg">
          <span className="block w-full overflow-hidden whitespace-nowrap text-xs" style={{ maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)" }}>{view.project.description}</span>
        </button> : <span className="flex-1" />}
        {view.authorName ? (
          <span className="truncate text-fg-muted">by {view.authorName}</span>
        ) : null}
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
          className="plan-summary-action inline-flex h-6 shrink-0 items-center gap-1.5 rounded border border-line bg-transparent px-2 py-0 text-fg hover:bg-surface-raised hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Opening…" : "Make a copy"}
        </button>
        <ScreenshotButton />
      </div>
      {descriptionOpen && view.project.description ? (
        <p className="mb-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs text-fg-muted">
          {view.project.description}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
