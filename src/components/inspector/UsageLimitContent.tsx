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
 * The shared "why is this machine at X%" panel: the binding limit first, then
 * who would take over if it were fixed. Bars carry the message; the only words
 * are names and the LIMIT / NEXT tags.
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
      <div className="flex items-baseline gap-2 border-b border-white/15 pb-1.5">
        <span className="truncate text-[14px] font-semibold text-white">{title}</span>
        <span
          className="ml-auto shrink-0 text-[15px] font-bold tabular-nums"
          style={{ color: usagePercentColor(utilization, status) }}
        >
          {formatSatisfactionPercent(utilization)}
        </span>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {entries.map((entry, index) => {
            const isActive = index === 0;
            const barColor = isActive ? "#fbbf24" : "#64748b";
            const fill = Number.isFinite(entry.fraction)
              ? Math.min(Math.max(entry.fraction, 0), 1) * 100
              : 100;

            return (
              <li key={entry.key}>
                <div className="flex items-baseline gap-1.5 text-[12px] leading-none">
                  <span
                    className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: isActive ? "#fbbf24" : "#64748b" }}
                  >
                    {isActive ? "Limit" : "Next"}
                  </span>
                  <span className="truncate font-semibold text-white">{entry.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400">
                    {entry.detail}
                  </span>
                  <span
                    className="w-11 shrink-0 text-right text-[12px] font-bold tabular-nums"
                    style={{ color: isActive ? "#fbbf24" : "#cbd5e1" }}
                  >
                    {entryPercent(entry)}
                  </span>
                </div>
                <div className="ml-[46px] mt-1 h-[5px] overflow-hidden rounded-sm bg-white/10">
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${fill}%`, backgroundColor: barColor }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
