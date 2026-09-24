"use client";

import { Check, ClipboardCopy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { encodePlanCode, planCodeLink } from "@/lib/import-export/plan-code";
import { useFactoryStore } from "@/store/factory-store";

type CopyState = "idle" | "working" | "copied" | "failed";

/**
 * Copy the plan to the clipboard, for sharing without an account (Jack,
 * 2026-09-23). What lands there is a link with the whole plan packed inside
 * it (plan-code.ts): click it and the planner opens the plan, or paste it
 * into the plan menu's "Paste a copied plan". Beside the screenshot button,
 * on every plan bar. Worded like ShadowTheAge's "Copy shareable link to
 * clipboard", never as a "code": players read that as programming.
 */
export function CopyPlanButton() {
  const isEmpty = useFactoryStore((state) => state.project.nodes.length === 0);
  const [state, setState] = useState<CopyState>("idle");

  const copy = async () => {
    setState("working");
    let copied = false;
    try {
      const code = await encodePlanCode(useFactoryStore.getState().project);
      copied = await copyToClipboard(planCodeLink(code, window.location.origin));
    } catch (error) {
      console.error(error);
    }
    setState(copied ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  };

  const title = isEmpty
    ? "Copy plan: build something first"
    : state === "failed"
      ? "Could not reach the clipboard"
      : "Copy plan to clipboard: a link anyone can open, no account needed";

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={isEmpty || state === "working"}
      title={title}
      aria-label="Copy plan to clipboard"
      className="plan-summary-action inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded border border-line-strong bg-surface px-2 text-fg-subtle hover:bg-surface-raised hover:text-fg disabled:opacity-40"
    >
      {state === "working" ? (
        <LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />
      ) : state === "copied" ? (
        <Check aria-hidden className="h-3 w-3" />
      ) : (
        <ClipboardCopy aria-hidden className="h-3 w-3" />
      )}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy plan"}</span>
    </button>
  );
}
