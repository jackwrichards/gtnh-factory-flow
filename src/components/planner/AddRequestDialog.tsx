"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { getResourceKey, resourceLabel } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { PlannerDialog } from "./PlannerDialog";
import { useResourceSearch } from "./use-resource-search";

/** Pick the resource a new Request node should ask for. */
export function AddRequestDialog({ onClose }: { onClose: () => void }) {
  const addRequest = useFactoryStore((state) => state.addRequest);
  const [query, setQuery] = useState("");
  const { results, isSearching, hasDataset } = useResourceSearch(query, 36);

  return (
    <PlannerDialog title="Request — what do you want?" onClose={onClose} widthClassName="w-[460px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="relative">
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

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-line">
          {query.trim().length < 2 ? (
            <div className="px-3 py-4 text-sm text-fg-muted">
              Type at least two characters to search.
            </div>
          ) : isSearching ? (
            <div className="px-3 py-4 text-sm text-fg-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-sm text-fg-muted">No matches.</div>
          ) : (
            results.map((entry) => (
              <button
                key={getResourceKey(entry)}
                type="button"
                onClick={() => {
                  addRequest({
                    kind: entry.kind,
                    id: entry.id,
                    displayName: entry.displayName,
                    iconPath: entry.iconPath,
                    iconAtlas: entry.iconAtlas,
                    dominantColor: entry.dominantColor ?? entry.iconAtlas?.dominantColor,
                  });
                  onClose();
                }}
                className="flex h-11 w-full items-center gap-2 border-b border-line px-2 text-left last:border-b-0 hover:bg-surface-sunken"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center">
                  <ResourceIcon
                    resource={{ ...entry, amount: 1 }}
                    size="sm"
                    showAmount={false}
                    bare
                    className="!h-8 !w-8"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{resourceLabel(entry)}</span>
                <span className="text-[11px] uppercase text-fg-muted">
                  {entry.kind === "fluid" ? "Fluid" : "Item"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </PlannerDialog>
  );
}
