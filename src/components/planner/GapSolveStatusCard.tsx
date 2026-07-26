"use client";

import { LoaderCircle, X } from "lucide-react";
import { resourceLabel } from "@/lib/model";
import type { GapSolveProgress } from "@/lib/planner/types";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The solve's home on the canvas: a small floating card that narrates the
 * running search, offers cancel, and — once plans are ready but the dialog
 * was closed — a way back into the results. The board stays fully usable.
 */
export function GapSolveStatusCard() {
  const gapSolve = useFactoryStore((state) => state.gapSolve);
  const cancelGapSolve = useFactoryStore((state) => state.cancelGapSolve);
  const openGapSolveResults = useFactoryStore((state) => state.openGapSolveResults);
  const requestTitle = useFactoryStore((state) => {
    const request = (state.project.requests ?? []).find(
      (entry) => entry.id === state.gapSolve?.requestId,
    );
    return request
      ? resourceLabel({ id: request.resourceId, displayName: request.displayName })
      : undefined;
  });

  if (!gapSolve) {
    return null;
  }

  if (gapSolve.status === "ready" && !gapSolve.dismissed) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 w-[380px] -translate-x-1/2 rounded border border-line-strong bg-surface p-3 text-fg shadow-xl">
      {gapSolve.status === "solving" ? (
        <SolvingBody
          requestTitle={requestTitle}
          progress={gapSolve.progress}
          onCancel={cancelGapSolve}
        />
      ) : gapSolve.status === "ready" ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">
            {gapSolve.result?.plans.length ?? 0} plans ready
            {requestTitle ? ` for ${requestTitle}` : ""}
          </span>
          <button
            type="button"
            onClick={openGapSolveResults}
            className="h-7 rounded bg-cyan-600 px-2.5 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            View
          </button>
          <DismissButton onClick={cancelGapSolve} />
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-sm text-red-500">{gapSolve.message}</span>
          <DismissButton onClick={cancelGapSolve} />
        </div>
      )}
    </div>
  );
}

function SolvingBody({
  requestTitle,
  progress,
  onCancel,
}: {
  requestTitle?: string;
  progress?: GapSolveProgress;
  onCancel: () => void;
}) {
  const headline = !progress
    ? `Solving${requestTitle ? ` ${requestTitle}` : ""}…`
    : progress.stage === "indexing"
      ? "Warming up the recipe indexes…"
      : progress.stage === "hydrating"
        ? "Fetching full recipes…"
        : progress.planLabel
          ? `Plan ${(progress.planIndex ?? 0) + 1}: via ${progress.planLabel}`
          : "Picking candidate chains…";
  const detail =
    progress?.stage === "exploring" && progress.resource
      ? `Looking for ways to make ${progress.resource}`
      : undefined;

  return (
    <div className="flex items-start gap-2.5">
      <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{headline}</div>
        {detail ? <div className="truncate text-xs text-fg-muted">{detail}</div> : null}
        {progress?.lookups ? (
          <div className="text-xs tabular-nums text-fg-muted">
            {progress.lookups} recipe lookups
          </div>
        ) : null}
      </div>
      <DismissButton onClick={onCancel} label="Cancel solve" />
    </div>
  );
}

function DismissButton({ onClick, label = "Dismiss" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-sunken hover:text-fg"
      title={label}
      aria-label={label}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
