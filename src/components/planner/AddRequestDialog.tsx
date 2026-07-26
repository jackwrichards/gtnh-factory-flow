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
  const { results, isSearching, hasDataset } = useResourceSearch(query, 96);

  return (
    <PlannerDialog
      title="Request — what do you want?"
      onClose={onClose}
      widthClassName="w-[min(960px,92vw)]"
      heightClassName="h-[82vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="relative">
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

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-line p-3">
          {query.trim().length < 2 ? (
            <div className="text-base text-fg-muted">Type at least two characters to search.</div>
          ) : isSearching ? (
            <div className="text-base text-fg-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="text-base text-fg-muted">No matches.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {results.map((entry) => (
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
                  title={`Request ${resourceLabel(entry)}`}
                  className="flex flex-col items-center gap-1.5 rounded border border-line bg-surface p-2 hover:border-cyan-400 hover:bg-surface-sunken"
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
              ))}
            </div>
          )}
        </div>
      </div>
    </PlannerDialog>
  );
}
