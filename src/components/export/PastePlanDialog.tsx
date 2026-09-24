"use client";

import { ClipboardPaste, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { openPlanCode } from "@/lib/open-plan-code";

/**
 * Paste a plan copied with the plan bar's Copy plan button and open it as a
 * new tab. The other half of that button.
 */
export function PastePlanDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [isOpening, setOpening] = useState(false);

  const open = async () => {
    if (!text.trim()) {
      return;
    }
    setOpening(true);
    setError(undefined);
    try {
      await openPlanCode(text);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That copied plan could not be opened.");
      setOpening(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Paste a copied plan"
        className="flex w-full max-w-lg flex-col gap-3 rounded border border-line-strong bg-surface p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ClipboardPaste aria-hidden className="h-4 w-4" />
            Paste a copied plan
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-fg-muted">
          Paste a plan copied with Copy plan. It opens in a new tab.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void open();
            }
          }}
          rows={5}
          spellCheck={false}
          placeholder="https://gtnhplanner.com/#p=..."
          className="w-full resize-none break-all rounded border border-line-strong bg-surface-sunken px-2 py-1.5 font-mono text-xs"
        />
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void open()}
            disabled={!text.trim() || isOpening}
            className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface-raised px-3 py-1.5 text-sm font-semibold hover:bg-surface-sunken disabled:opacity-40"
          >
            {isOpening ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
