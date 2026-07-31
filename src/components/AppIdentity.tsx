"use client";

import { useFactoryStore } from "@/store/factory-store";

interface AppIdentityProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * Game-version picker, at the head of the recipe browser panel.
 *
 * Rendered inside the panel's own `<aside>` rather than as a sibling above it.
 * As a sibling it was a separate box that had to be kept the same width and the
 * same colour as the panel by hand — and it was neither, because the browser is
 * hardcoded dark chrome while this used theme tokens. Inside, it is the panel's
 * first row and inherits both for free.
 *
 * The version belongs beside the browser rather than on a global bar: it decides
 * which pack's recipes exist at all, so it is a property of the catalogue below
 * it, not of the plan on the board.
 */
export function AppIdentity({ onLoadDatasetVersion }: AppIdentityProps) {
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);

  return (
    <div className="shrink-0 border-b border-neutral-800 px-3 py-2">
      {/* The app title lives in the global header row now; this panel head
          only carries the dataset picker. */}
      <label
        className="flex items-center gap-2"
        title="Which GTNH pack version every recipe is loaded from. Changing it reloads the recipe list and re-resolves the recipes already on your board."
      >
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Game version
        </span>
        <select
          value={selectedDatasetVersionId ?? ""}
          disabled={isDatasetLoading || !manifest?.versions.length}
          onChange={(event) => onLoadDatasetVersion(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-xs normal-case tracking-normal text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-500"
        >
          {manifest?.versions.length ? (
            manifest.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.gtnhVersion} ({version.channel})
              </option>
            ))
          ) : (
            <option value="">No versions</option>
          )}
        </select>
      </label>
    </div>
  );
}
