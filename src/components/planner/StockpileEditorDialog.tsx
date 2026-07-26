"use client";

import { PackagePlus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";
import { getResourceKey, resourceLabel } from "@/lib/model";
import type { FactoryProject, StockpileResource } from "@/lib/model/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { PlannerDialog } from "./PlannerDialog";
import { useResourceSearch } from "./use-resource-search";

/**
 * The stockpile's manager: search the dataset to add resources, drop ones you
 * no longer have, or import everything the current board already overproduces.
 */
export function StockpileEditorDialog() {
  const editingStockpileId = useFactoryStore((state) => state.editingStockpileId);
  const setEditingStockpile = useFactoryStore((state) => state.setEditingStockpile);
  const stockpile = useFactoryStore((state) =>
    (state.project.stockpiles ?? []).find((entry) => entry.id === state.editingStockpileId),
  );

  if (!editingStockpileId || !stockpile) {
    return null;
  }

  return (
    <StockpileEditorContent
      key={stockpile.id}
      stockpileId={stockpile.id}
      onClose={() => setEditingStockpile(undefined)}
    />
  );
}

function StockpileEditorContent({
  stockpileId,
  onClose,
}: {
  stockpileId: string;
  onClose: () => void;
}) {
  const stockpile = useFactoryStore((state) =>
    (state.project.stockpiles ?? []).find((entry) => entry.id === stockpileId),
  );
  const updateStockpile = useFactoryStore((state) => state.updateStockpile);
  const project = useFactoryStore((state) => state.project);
  const surpluses = useFactoryStore((state) => state.lastResult.unconsumedOutputs);
  const [query, setQuery] = useState("");
  const { results, isSearching, hasDataset } = useResourceSearch(query);

  const stockedKeys = useMemo(
    () => new Set((stockpile?.resources ?? []).map((resource) => getResourceKey(resource))),
    [stockpile?.resources],
  );

  if (!stockpile) {
    return null;
  }

  const addResource = (entry: DatasetResourceIndexEntry) => {
    const resource: StockpileResource = {
      kind: entry.kind,
      id: entry.id,
      displayName: entry.displayName,
      iconPath: entry.iconPath,
      iconAtlas: entry.iconAtlas,
      dominantColor: entry.dominantColor ?? entry.iconAtlas?.dominantColor,
      alternatives: entry.alternatives,
    };
    if (stockedKeys.has(getResourceKey(resource))) {
      return;
    }

    updateStockpile(stockpile.id, { resources: [...stockpile.resources, resource] });
  };

  const removeResource = (resource: StockpileResource) => {
    updateStockpile(stockpile.id, {
      resources: stockpile.resources.filter(
        (entry) => getResourceKey(entry) !== getResourceKey(resource),
      ),
    });
  };

  const addSurpluses = () => {
    const additions = surpluses
      .map((balance) => toStockpileResource(project, balance.kind, balance.resourceId, balance.displayName))
      .filter((resource) => !stockedKeys.has(getResourceKey(resource)));
    if (additions.length === 0) {
      return;
    }

    updateStockpile(stockpile.id, { resources: [...stockpile.resources, ...additions] });
  };

  return (
    <PlannerDialog title="Stockpile — what you have in abundance" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={hasDataset ? "Search items and fluids…" : "Dataset still loading…"}
              disabled={!hasDataset}
              className="h-9 w-full rounded border border-line bg-surface-sunken pl-8 pr-2 text-base outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={addSurpluses}
            disabled={surpluses.length === 0}
            title="Add every resource this board currently overproduces"
            className="flex h-9 items-center gap-1.5 rounded border border-line px-2.5 text-sm hover:bg-surface-sunken disabled:opacity-40"
          >
            <PackagePlus className="h-4 w-4" />
            Add board surpluses
          </button>
        </div>

        {query.trim().length >= 2 ? (
          <div className="min-h-[64px] shrink-0 rounded border border-line bg-surface-sunken p-2">
            {isSearching ? (
              <div className="px-1 py-2 text-sm text-fg-muted">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-1 py-2 text-sm text-fg-muted">No matches.</div>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {results.map((entry) => {
                  const key = getResourceKey(entry);
                  const isStocked = stockedKeys.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => addResource(entry)}
                      disabled={isStocked}
                      title={
                        isStocked
                          ? `${resourceLabel(entry)} is already stocked`
                          : `Add ${resourceLabel(entry)}`
                      }
                      className={[
                        "grid h-11 w-11 place-items-center rounded border",
                        isStocked
                          ? "cursor-default border-emerald-500/60 bg-emerald-500/10"
                          : "border-line bg-surface hover:border-cyan-400",
                      ].join(" ")}
                    >
                      <ResourceIcon
                        resource={{ ...entry, amount: 1 }}
                        size="sm"
                        showAmount={false}
                        bare
                        className="!h-8 !w-8"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col rounded border border-line">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-2 text-xs uppercase tracking-wide text-fg-muted">
            <span>Stocked resources</span>
            <span>{stockpile.resources.length}</span>
          </div>
          {stockpile.resources.length === 0 ? (
            <div className="px-3 py-4 text-sm text-fg-muted">
              Nothing yet. Search above, or pull in the board&apos;s surpluses.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {stockpile.resources.map((resource) => (
                <div
                  key={getResourceKey(resource)}
                  className="flex h-10 items-center gap-2 border-b border-line px-2 last:border-b-0"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center">
                    <ResourceIcon
                      resource={{ ...resource, amount: 1 }}
                      size="sm"
                      showAmount={false}
                      bare
                      className="!h-7 !w-7"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{resourceLabel(resource)}</span>
                  <span className="text-[11px] uppercase text-fg-muted">
                    {resource.kind === "fluid" ? "Fluid" : "Item"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeResource(resource)}
                    className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-red-500/10 hover:text-red-500"
                    title={`Remove ${resourceLabel(resource)}`}
                    aria-label={`Remove ${resourceLabel(resource)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded border border-line px-4 text-sm font-medium hover:bg-surface-sunken"
          >
            Done
          </button>
        </div>
      </div>
    </PlannerDialog>
  );
}

function toStockpileResource(
  project: FactoryProject,
  kind: StockpileResource["kind"],
  id: string,
  displayName: string | undefined,
): StockpileResource {
  for (const recipe of project.recipes) {
    for (const resource of [...recipe.outputs, ...recipe.inputs]) {
      if (resource.kind === kind && resource.id === id) {
        return {
          kind,
          id,
          displayName: displayName ?? resource.displayName,
          iconPath: resource.iconPath,
          iconAtlas: resource.iconAtlas,
          dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
          alternatives: resource.alternatives,
        };
      }
    }
  }

  return { kind, id, displayName };
}
