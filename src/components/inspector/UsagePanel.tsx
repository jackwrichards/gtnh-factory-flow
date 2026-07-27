"use client";

import { useMemo } from "react";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "../nei/ResourceIcon";
import { buildUsageCells, type UsageCell, type UsageIconResource } from "./usage-grid";

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

  if (cells.length === 0) {
    return null;
  }

  return (
    <section className="shrink-0 rounded border border-line bg-surface-raised p-2">
      <div className="flex items-baseline gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Usage</h2>
        <span className="text-[10px] text-fg-subtle">hover to find on canvas</span>
      </div>

      <div
        className="mt-1.5 grid max-h-56 gap-1 overflow-y-auto overscroll-contain"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}
      >
        {cells.map((cell) => (
          <UsageCellButton
            key={cell.nodeId}
            cell={cell}
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
  onHover,
  onSelect,
}: {
  cell: UsageCell;
  onHover: (nodeId?: string) => void;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(cell.nodeId)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(cell.nodeId)}
      onBlur={() => onHover(undefined)}
      onClick={() => onSelect(cell.nodeId)}
      title={`${cell.label}${cell.machineCount > 1 ? ` ×${cell.machineCount}` : ""} — ${
        cell.recipeName
      } — running at ${formatUsagePercent(cell.utilization)}`}
      className="relative aspect-square overflow-hidden rounded border border-transparent hover:border-cyan-300 hover:bg-cyan-50 dark:hover:border-cyan-500/60 dark:hover:bg-cyan-500/10"
    >
      {/* The icon owns the whole cell; the percent floats over it so growing
          the art never grows the cell. */}
      <span className="absolute inset-0 flex items-center justify-center overflow-hidden p-0.5">
        {cell.icon ? (
          <ResourceIcon
            resource={{ ...cell.icon, amount: 1 }}
            size="lg"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full"
          />
        ) : (
          <span className="h-full w-full rounded bg-surface-sunken" aria-hidden />
        )}
      </span>
      <span
        className={[
          "absolute bottom-0.5 right-0.5 rounded bg-surface/85 px-1 py-0.5 text-[11px] font-bold leading-none tabular-nums backdrop-blur-[2px]",
          STATUS_TEXT[cell.status] ?? "text-fg",
        ].join(" ")}
      >
        {formatUsagePercent(cell.utilization)}
      </span>
    </button>
  );
}
