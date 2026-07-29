"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { DatasetVersion, RecipeSummary } from "@/lib/datasets/types";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets/remote";
import { getRecipeDatasetRecipe, listRecipeDatasetCrops } from "@/lib/datasets/browser-loader";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";

// One crop catalog fetch per dataset version, shared by every picker.
let cachedCrops: { versionId: string; crops: RecipeSummary[] } | undefined;

export function cropDisplayName(recipeName: string): string {
  const separator = recipeName.indexOf(": ");
  return separator >= 0 ? recipeName.slice(separator + 2) : recipeName;
}

/**
 * Searchable crop list for crop source nodes. Picking a crop swaps the node's
 * recipe to that crop's Crop Farm entry.
 */
export function CropPickerMenu({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const setNodeRecipe = useFactoryStore((state) => state.setNodeRecipe);
  const version: DatasetVersion | undefined = datasetManifest?.versions.find(
    (entry) => entry.id === selectedDatasetVersionId,
  );
  const manifestUrl = datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;

  const [crops, setCrops] = useState<RecipeSummary[]>(() => {
    const cached = cachedCrops;
    return cached && cached.versionId === selectedDatasetVersionId ? cached.crops : [];
  });
  const [search, setSearch] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!version || (cachedCrops?.versionId === version.id && cachedCrops.crops.length > 0)) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listRecipeDatasetCrops(manifestUrl, version)
      .then((result) => {
        cachedCrops = { versionId: version.id, crops: result.crops };
        if (!cancelled) {
          setCrops(result.crops);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load crops.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, version]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return crops;
    }
    return crops.filter((crop) => {
      const haystack = [
        cropDisplayName(crop.name),
        ...crop.outputs.map((output) => output.displayName ?? output.id),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [crops, search]);

  const handlePick = async (summary: RecipeSummary) => {
    if (!version) {
      return;
    }
    try {
      const recipe = await getRecipeDatasetRecipe(manifestUrl, version, summary.id);
      setNodeRecipe(nodeId, recipe);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the crop.");
    }
  };

  return (
    <div
      className="nodrag absolute left-0 top-7 z-[140] w-[360px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1.5 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="Search crops or drops..."
        className="mb-1 h-7 w-full border border-[var(--mc-33)] bg-[var(--mc-85)] px-2 text-[12px] font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-white"
        aria-label="Search crops"
      />
      {isLoading ? (
        <div className="flex items-center gap-2 px-2 py-3 text-[12px] font-bold text-[var(--mc-ink)]">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading crops...
        </div>
      ) : error ? (
        <div className="px-2 py-3 text-[12px] font-bold text-red-700">{error}</div>
      ) : (
        <div className="max-h-[380px] overflow-y-auto">
          {filtered.map((crop) => {
            const tier = (crop.metadata as { cropsNh?: { tier?: number } } | undefined)?.cropsNh
              ?.tier;
            const dropsLine = crop.outputs
              .map((output) => {
                const name = output.displayName ?? output.id;
                return output.chance !== undefined && output.chance < 1
                  ? `${name} ${Math.round(output.chance * 1000) / 10}%`
                  : name;
              })
              .join(", ");
            return (
              <button
                key={crop.id}
                type="button"
                onClick={() => void handlePick(crop)}
                className="flex w-full items-center gap-2.5 border-2 border-transparent px-1.5 py-1.5 text-left text-[var(--mc-ink)] hover:border-[var(--mc-47)] hover:bg-[var(--mc-100)]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden border border-[var(--mc-33)] bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]">
                  {crop.outputs[0] ? (
                    <ResourceIcon
                      // Hide the chance badge here: chances are spelled out in
                      // the drops line below instead.
                      resource={{ ...crop.outputs[0], chance: undefined }}
                      bare
                      tooltip={false}
                      showAmount={false}
                      showConsumedState={false}
                      iconPixelSize={32}
                      className="h-8 w-8"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold leading-4">
                    {cropDisplayName(crop.name)}
                  </span>
                  <span className="block truncate text-[10px] leading-4 text-[var(--mc-ink-muted)]">
                    {dropsLine}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase text-[var(--mc-ink-muted)]">
                  {tier ? `T${tier}` : ""}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-[12px] font-bold text-[var(--mc-ink-muted)]">
              No crops match.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
