"use client";

import { useState } from "react";
import { formatCompact } from "@/lib/model/resources";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier, ResourceKey } from "@/lib/model/types";
import { useWorkspaceView } from "@/lib/workspace-view";
import { useFactoryStore } from "@/store/factory-store";
import { GT_TIER_COLORS } from "./flow/tier-colors";

/**
 * Supply versus demand, per grid. The solver bills every machine's draw as an
 * energy input and every generator's output as energy (throughput.ts), so
 * this block only reads the books — it decides nothing. Collapsed it is one
 * line (the net); open, one row per grid that trades.
 */
export function PowerBalanceBlock({ onAddPower }: { onAddPower?: (tier: MachineTier) => void }) {
  const lastResult = useFactoryStore((state) => state.lastResult);
  const average = useWorkspaceView().averageMachineDraw;
  const [open, setOpen] = useState(false);

  const rows = GT_VOLTAGE_TIERS.map(({ tier }) => {
    const key = `energy:${tier.toLowerCase()}` as ResourceKey;
    let demand = 0;
    let supply = 0;
    for (const node of Object.values(lastResult.nodes)) {
      if (node.status === "missing-recipe") {
        continue;
      }
      const utilization = average ? Math.min(1, Math.max(0, node.utilization)) : 1;
      demand += (node.inputs[key]?.amountPerSecond ?? 0) * utilization;
      supply += (node.outputs[key]?.amountPerSecond ?? 0) * utilization;
    }
    return { tier, demand, supply };
  }).filter((row) => row.demand > 0 || row.supply > 0);

  if (rows.length === 0) {
    return null;
  }

  const net = rows.reduce((sum, row) => sum + row.supply - row.demand, 0);

  return (
    <div className="border-b border-[var(--mc-47)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--mc-ink-muted)]">
          Grids
        </span>
        {net >= 0 ? (
          <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-400">
            {net > 0 ? `+${formatCompact(net)} EU/s` : "balanced"}
          </span>
        ) : (
          <span className="ml-auto rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-red-400">
            −{formatCompact(-net)} EU/s
          </span>
        )}
      </button>
      {open ? (
        <div className="px-2 pb-1.5">
          {rows.map(({ tier, demand, supply }) => {
            const color = GT_TIER_COLORS[tier];
            return (
              <div key={tier} className="flex items-center gap-2 py-1 text-[12px] tabular-nums">
                <span
                  className="w-11 shrink-0 rounded px-1 text-center text-[11px] font-bold"
                  style={{ backgroundColor: `${color.background}1f`, color: color.text }}
                >
                  {tier}
                </span>
                <span className="text-[var(--mc-ink-muted)]">
                  {formatCompact(supply)} in / {formatCompact(demand)} out
                </span>
                {supply >= demand ? (
                  <span className="ml-auto shrink-0 text-[11px] font-bold text-emerald-400">supplied</span>
                ) : (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] font-bold text-red-400">
                      −{formatCompact(demand - supply)} EU/s
                    </span>
                    {onAddPower ? (
                      <button
                        type="button"
                        onClick={() => onAddPower(tier)}
                        className="rounded bg-[var(--mc-71)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--mc-ink)]"
                      >
                        Add power
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
