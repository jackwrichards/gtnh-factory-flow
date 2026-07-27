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

function entryPercent(entry: UsageLimitEntry): string {
  if (!Number.isFinite(entry.fraction)) {
    return "∞";
  }

  return formatSatisfactionPercent(entry.fraction);
}

/**
 * The shared "why is this machine at X%" panel body: the binding limit first,
 * then who would take over if it were fixed.
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
  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[14px] font-semibold text-white">{title}</span>
        <span
          className="ml-auto shrink-0 text-[14px] font-bold tabular-nums"
          style={{ color: usagePercentColor(utilization, status) }}
        >
          {formatSatisfactionPercent(utilization)}
        </span>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <div className="flex items-baseline gap-2 text-[12px] leading-none">
                <span
                  className={
                    index === 0
                      ? "font-bold uppercase tracking-wide text-amber-300"
                      : "font-semibold uppercase tracking-wide text-slate-400"
                  }
                >
                  {index === 0 ? "Limit" : index === 1 ? "Next" : "Then"}
                </span>
                <span className="truncate font-semibold text-slate-200">{entry.label}</span>
                <span className="ml-auto shrink-0 font-bold tabular-nums text-slate-300">
                  {entryPercent(entry)}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-slate-400">{entry.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
