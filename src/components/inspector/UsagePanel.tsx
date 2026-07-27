"use client";

import { useMemo } from "react";
import { useFactoryStore } from "@/store/factory-store";
import { MinecraftTooltip } from "../nei/MinecraftTooltip";
import { ResourceIcon } from "../nei/ResourceIcon";
import { buildUsageCells, type UsageCell, type UsageIconResource } from "./usage-grid";
import { UsageLimitContent } from "./UsageLimitContent";
import { buildUsageLimitChain, type UsageLimitEntry } from "./usage-limits";

/**
 * Percent colour keys to the solver's own status thresholds rather than
 * re-deriving bands here: red is overdemanded, green is running in balance,
 * muted is slack capacity.
 */
const STATUS_TEXT: Record<string, string> = {
  bottleneck: "text-red-600 dark:text-red-400",
  balanced: "text-emerald-600 dark:text-emerald-400",
};

function formatUsagePercent(utilization: number): string {
  const percent = Math.round(utilization * 100);
  return `${Math.min(percent, 999)}%`;
}

export function UsagePanel() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const dataset = useFactoryStore((state) => state.dataset);
  const setHoveredUsageNodeId = useFactoryStore((state) => state.setHoveredUsageNodeId);
  const selectNode = useFactoryStore((state) => state.selectNode);

  const machineIconsByRecipeMap = useMemo(() => {
    const icons = new Map<string, UsageIconResource>();
    for (const entry of dataset?.recipeMapIcons ?? []) {
      if (entry.resource.kind === "aspect") {
        continue;
      }
      icons.set(entry.recipeMap, { ...entry.resource, kind: entry.resource.kind, amount: 1 });
    }
    return icons;
  }, [dataset?.recipeMapIcons]);

  const cells = useMemo(
    () => buildUsageCells(project, result, machineIconsByRecipeMap),
    [machineIconsByRecipeMap, project, result],
  );

  // The limit chain is only built for the cell being hovered, which is also
  // the node lit up on the canvas.
  const hoveredNodeId = useFactoryStore((state) => state.hoveredUsageNodeId);
  const hoveredChain = useMemo(
    () => (hoveredNodeId ? buildUsageLimitChain(project, result, hoveredNodeId) : []),
    [hoveredNodeId, project, result],
  );

  if (cells.length === 0) {
    return null;
  }

  return (
    <section className="shrink-0 rounded border border-line bg-surface-raised p-1.5">
      <h2
        className="text-[10px] font-semibold uppercase leading-none tracking-wide text-fg-muted"
        title="One cell per machine on the board — hover to find it on the canvas, click to select it."
      >
        Usage
      </h2>

      <div className="mt-1 grid max-h-56 grid-cols-6 gap-0.5 overflow-y-auto overscroll-contain">
        {cells.map((cell) => (
          <UsageCellButton
            key={cell.nodeId}
            cell={cell}
            limitChain={cell.nodeId === hoveredNodeId ? hoveredChain : undefined}
            onHover={setHoveredUsageNodeId}
            onSelect={selectNode}
          />
        ))}
      </div>
    </section>
  );
}

function UsageCellButton({
  cell,
  limitChain,
  onHover,
  onSelect,
}: {
  cell: UsageCell;
  limitChain?: UsageLimitEntry[];
  onHover: (nodeId?: string) => void;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <MinecraftTooltip
      content={
        limitChain && limitChain.length > 0 ? (
          <UsageLimitContent
            title={`${cell.label}${cell.machineCount > 1 ? ` ×${cell.machineCount}` : ""}`}
            utilization={cell.utilization}
            status={cell.status}
            entries={limitChain}
          />
        ) : undefined
      }
    >
    <button
      type="button"
      onMouseEnter={() => onHover(cell.nodeId)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(cell.nodeId)}
      onBlur={() => onHover(undefined)}
      onClick={() => onSelect(cell.nodeId)}
      className="relative aspect-square overflow-hidden rounded border border-transparent hover:border-cyan-300 hover:bg-cyan-50 dark:hover:border-cyan-500/60 dark:hover:bg-cyan-500/10"
    >
      {/* The icon owns the whole cell; the percent floats over it so growing
          the art never grows the cell. Sprites ship with a wide transparent
          margin baked in — the scale crop-zooms past it so the art, not the
          margin, is what fills the cell. */}
      <span className="absolute inset-0 flex items-center justify-center overflow-hidden">
        {cell.icon ? (
          <ResourceIcon
            resource={{ ...cell.icon, amount: 1 }}
            size="lg"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full -translate-y-[2px] scale-[1.3]"
          />
        ) : (
          <span className="h-full w-full rounded bg-surface-sunken" aria-hidden />
        )}
      </span>
      {/* No plate behind the text — a shadow keeps it readable over any icon
          without reading as a box. */}
      <span
        className={[
          "pointer-events-none absolute inset-x-0 bottom-0 text-center text-[10px] font-bold leading-none tabular-nums",
          "[text-shadow:0_0_3px_rgba(255,255,255,0.95),0_1px_2px_rgba(255,255,255,0.9)] dark:[text-shadow:0_0_3px_rgba(0,0,0,0.9),0_1px_2px_rgba(0,0,0,0.95)]",
          STATUS_TEXT[cell.status] ?? "text-fg",
        ].join(" ")}
      >
        {formatUsagePercent(cell.utilization)}
      </span>
    </button>
    </MinecraftTooltip>
  );
}
