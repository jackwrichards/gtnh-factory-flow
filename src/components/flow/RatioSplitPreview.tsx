"use client";

import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { getStorageRoles } from "@/lib/model/storage-role";
import {
  formatRatioShare,
  getProjectRatioBranches,
  ratioExportShare,
} from "@/lib/model/storage-ratios";
import { useFactoryStore } from "@/store/factory-store";
import { MouseIcon } from "./RecipeTooltip";

/** Mounted only while a percentage is hovered; idle wires do no graph-wide work. */
export function RatioSplitPreview({
  edgeId,
  storageId,
  side,
  locked,
}: {
  edgeId?: string;
  storageId?: string;
  side: "input" | "output" | "export";
  locked: boolean;
}) {
  const project = useFactoryStore((s) => s.project);
  const view = useMemo(() => {
    const edge = project.edges.find((edge) => edge.id === edgeId);
    const owner = side === "export" ? storageId : side === "input" ? edge?.target : edge?.source;
    const storage = project.storages?.find((storage) => storage.id === owner);
    if (!storage || storage.bufferMode !== "ratio" || project.poolMode) return undefined;
    const roles = getStorageRoles(project);
    const recipes = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
    const names = new Map(
      project.nodes.map((node) => {
        const recipe = recipes.get(node.recipeId);
        return [
          node.id,
          recipe ? getSelectedMachineHandler(recipe, node).label || recipe.machineType : "Machine",
        ];
      }),
    );
    for (const peer of project.storages ?? []) {
      const role = roles.get(peer.id);
      names.set(
        peer.id,
        role === "buffer"
          ? peer.bufferMode === "ratio"
            ? "Ratio"
            : peer.bufferMode === "strict"
              ? "Strict"
              : "Buffer"
          : role === "source"
            ? "Source"
            : role === "product"
              ? "Product"
              : role === "byproduct"
                ? "Byproduct"
                : role === "trash"
                  ? "Trash"
                  : "Drawer",
      );
    }
    const sections = (["input", "output"] as const).map((section) => {
      const branches = getProjectRatioBranches(project, section).get(storage.id) ?? [];
      const counts = new Map<string, number>();
      for (const branch of branches) {
        const name = names.get(branch.targetId) ?? "Machine";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const seen = new Map<string, number>();
      return {
        side: section,
        title: section === "input" ? "Incoming" : "Outgoing",
        rows: branches.map((branch) => {
          const name = names.get(branch.targetId) ?? "Machine";
          const ordinal = (seen.get(name) ?? 0) + 1;
          seen.set(name, ordinal);
          return {
            key: branch.targetId,
            name: `${name}${(counts.get(name) ?? 0) > 1 ? ` ${ordinal}` : ""}`,
            share: branch.share,
            active: section === side && branch.edges.some((edge) => edge.id === edgeId),
          };
        }),
      };
    });
    return { storage, sections };
  }, [project, edgeId, storageId, side]);
  if (!view) return null;
  return (
    <div
      data-ratio-preview
      role="tooltip"
      aria-label="Ratio split"
      className="w-[220px] max-w-[calc(100vw-40px)] text-[10px] font-normal leading-[14px] text-fg-subtle"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-fg">
        <ResourceIcon
          resource={{ ...view.storage, id: view.storage.resourceId, amount: 1 }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={24}
          className="!h-3.5 !w-3.5 shrink-0"
        />
        <span className="truncate">{view.storage.displayName ?? view.storage.resourceId}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {view.sections.map((section) => (
          <section key={section.side} aria-label={section.title}>
            <div className="mb-0.5 text-[11px] font-semibold text-fg-muted">{section.title}</div>
            {section.rows.map((row) => (
              <div
                key={row.key}
                data-ratio-preview-row={row.key}
                className={`flex items-baseline justify-between gap-1 ${row.active ? "bg-white/5 font-bold text-fg" : ""}`}
              >
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 tabular-nums">{formatRatioShare(row.share)}</span>
              </div>
            ))}
            {section.side === "output" && (
              <div
                data-ratio-preview-export
                className={`flex items-baseline justify-between gap-1 text-[var(--flow-output)] ${side === "export" ? "bg-[var(--flow-output)]/10 font-bold" : ""}`}
              >
                <span className="flex items-center gap-0.5 text-[9px]">
                  <ArrowUpRight aria-hidden className="h-2.5 w-2.5" />
                  Setup output
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatRatioShare(ratioExportShare(view.storage))}
                </span>
              </div>
            )}
          </section>
        ))}
      </div>
      {!locked && (
        <div className="mt-1 flex items-center gap-1 border-t border-line pt-1 text-[9px] leading-3 text-fg-muted">
          <span role="img" aria-label="Mouse wheel" className="[&_svg]:h-3.5 [&_svg]:w-3">
            <MouseIcon gesture="wheel" />
          </span>
          <span>↑ +1% · ↓ −1%</span>
          <span className="ml-auto">Shift: 10%</span>
        </div>
      )}
    </div>
  );
}
