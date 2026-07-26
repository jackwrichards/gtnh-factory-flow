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
  const { results, isSearching, hasDataset } = useResourceSearch(query, 96);

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
    <PlannerDialog
      title="Stockpile — what you have in abundance"
      onClose={onClose}
      widthClassName="w-[min(1180px,94vw)]"
      heightClassName="h-[86vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-muted" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={hasDataset ? "Search items and fluids…" : "Dataset still loading…"}
              disabled={!hasDataset}
              className="h-11 w-full rounded border border-line bg-surface-sunken pl-10 pr-3 text-lg outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={addSurpluses}
            disabled={surpluses.length === 0}
            title="Add every resource this board currently overproduces"
            className="flex h-11 items-center gap-2 rounded border border-line px-3 text-base hover:bg-surface-sunken disabled:opacity-40"
          >
            <PackagePlus className="h-5 w-5" />
            Add board surpluses
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <div className="flex min-h-0 flex-col rounded border border-line">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 text-sm uppercase tracking-wide text-fg-muted">
              <span>Search results</span>
              {isSearching ? <span>Searching…</span> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {query.trim().length < 2 ? (
                <div className="text-base text-fg-muted">
                  Type at least two characters to search the dataset.
                </div>
              ) : !isSearching && results.length === 0 ? (
                <div className="text-base text-fg-muted">No matches.</div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
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
                          "flex flex-col items-center gap-1.5 rounded border p-2",
                          isStocked
                            ? "cursor-default border-emerald-500/60 bg-emerald-500/10"
                            : "border-line bg-surface hover:border-cyan-400 hover:bg-surface-sunken",
                        ].join(" ")}
                      >
                        <span className="grid h-14 w-14 place-items-center">
                          <ResourceIcon
                            resource={{ ...entry, amount: 1 }}
                            size="sm"
                            showAmount={false}
                            bare
                            className="!h-12 !w-12"
                          />
                        </span>
                        <span className="w-full truncate text-center text-xs leading-4">
                          {resourceLabel(entry)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded border border-line">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 text-sm uppercase tracking-wide text-fg-muted">
              <span>Stocked resources</span>
              <span>{stockpile.resources.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {stockpile.resources.length === 0 ? (
                <div className="text-base text-fg-muted">
                  Nothing yet. Search on the left, or pull in the board&apos;s surpluses.
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                  {stockpile.resources.map((resource) => (
                    <div
                      key={getResourceKey(resource)}
                      className="group relative flex flex-col items-center gap-1.5 rounded border border-line bg-surface p-2"
                      title={resourceLabel(resource)}
                    >
                      <button
                        type="button"
                        onClick={() => removeResource(resource)}
                        className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded bg-surface text-fg-muted opacity-0 hover:bg-red-500/15 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
                        title={`Remove ${resourceLabel(resource)}`}
                        aria-label={`Remove ${resourceLabel(resource)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <span className="grid h-14 w-14 place-items-center">
                        <ResourceIcon
                          resource={{ ...resource, amount: 1 }}
                          size="sm"
                          showAmount={false}
                          bare
                          className="!h-12 !w-12"
                        />
                      </span>
                      <span className="w-full truncate text-center text-xs leading-4">
                        {resourceLabel(resource)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded border border-line px-5 text-base font-medium hover:bg-surface-sunken"
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
