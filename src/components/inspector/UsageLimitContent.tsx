"use client";

import type { NodeThroughputResult } from "@/lib/model/types";
import { formatSatisfactionPercent } from "../flow/edge-labels";
import type { UsageLimitEntry } from "./usage-limits";

/**
 * Percent colours on the dark tooltip panel, keyed to the solver's status
 * bands so every surface tells the same story: red is overdemanded, green is
 * balanced, plain is slack.
 */
function usagePercentColor(utilization: number, status?: NodeThroughputResult["status"]): string {
  if (status === "bottleneck" || utilization > 1 + 1e-6) {
    return "#f87171";
  }

  if (status === "balanced" || utilization >= 0.9) {
    return "#4ade80";
  }

  return "#f8fafc";
}

function limitHeadline(entry: UsageLimitEntry): string | undefined {
  if (entry.kind === "no-demand") {
    return undefined;
  }

  if (entry.kind === "machines") {
    return "Not enough machines.";
  }

  return `${entry.label} is the limit.`;
}

/**
 * The shared "why is this machine at X%" panel, written as plain English: what
 * limits it now, and what would take over if that were fixed. Storage-fed
 * lines never limit anything, so they are left out of the story.
 */
export function UsageLimitContent({
  title,
  utilization,
  status,
  entries,
}: {
  title: string;
  utilization: number;
  status?: NodeThroughputResult["status"];
  entries: UsageLimitEntry[];
}) {
  const visible = entries.filter((entry) => Number.isFinite(entry.fraction));
  const limit = visible[0];
  const runnersUp = visible.slice(1, 3);

  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2 border-b border-white/15 pb-1.5">
        <span className="truncate text-[14px] font-semibold text-white">{title}</span>
        <span
          className="ml-auto shrink-0 text-[15px] font-bold tabular-nums"
          style={{ color: usagePercentColor(utilization, status) }}
        >
          {formatSatisfactionPercent(utilization)}
        </span>
      </div>

      {limit ? (
        <div className="mt-2">
          {limitHeadline(limit) ? (
            <p className="text-[13px] font-semibold leading-snug text-amber-300">
              {limitHeadline(limit)}
            </p>
          ) : null}
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-100">{limit.detail}</p>
        </div>
      ) : null}

      {runnersUp.length > 0 ? (
        <div className="mt-2.5 border-t border-white/10 pt-2">
          {runnersUp.map((entry, index) => (
            <p key={entry.key} className="text-[12px] leading-relaxed text-slate-400">
              {index === 0 ? "If fixed, " : "After that, "}
              {entry.label.toLowerCase()} caps it at{" "}
              <span className="font-semibold text-slate-300">
                {formatSatisfactionPercent(entry.fraction)}
              </span>
              .
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
