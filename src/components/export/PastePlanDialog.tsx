"use client";

import "../chrome/mod-panel.css";

import { useRef, useState } from "react";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";
import { openPlanCode } from "@/lib/open-plan-code";

/**
 * Paste a plan (a link, a code, or a plan file's text) and open it, in the mod's box
 * (`chrome/mod-panel.css`). The other half of Copy plan code.
 */
export function PastePlanDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dialogRef, { onClose, initialFocus: "textarea" });
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
      setError(reason instanceof Error ? reason.message : "That plan could not be opened.");
      setOpening(false);
    }
  };

  return (
    <div
      className="pn-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Paste a plan" className="pn">
        <div className="pn-title">
          <span>Paste a plan</span>
          <button type="button" onClick={onClose} aria-label="Close" className="pn-x" />
        </div>
        <div className="pn-body">
          <p className="pn-note">Paste a plan link, a code or a plan file&apos;s text. It opens in a new tab.</p>
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
            placeholder="gtnh1.… or a plan link"
            className="pn-field"
            style={{ wordBreak: "break-all" }}
          />
          {error ? <p className="pn-err">{error}</p> : null}
          <div className="pn-keys">
            <button type="button" onClick={onClose} className="pn-key">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void open()}
              disabled={!text.trim() || isOpening}
              data-primary=""
              className="pn-key"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
