"use client";

import { listRecipeDatasetCrops } from "@/lib/datasets/browser-loader";
import type { RecipeSummary } from "@/lib/datasets/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { RecipeListPicker, recipeChoiceName } from "./RecipeListPicker";

export const cropDisplayName = recipeChoiceName;

function cropTier(crop: RecipeSummary): number | undefined {
  return (crop.metadata as { cropsNh?: { tier?: number } } | undefined)?.cropsNh?.tier;
}

function cropMachineOnly(crop: RecipeSummary): boolean {
  return (crop.metadata as { cropsNh?: { machineOnly?: boolean } } | undefined)?.cropsNh?.machineOnly === true;
}

// Tier order, name inside a tier: the list reads as a progression.
function byTierThenName(a: RecipeSummary, b: RecipeSummary): number {
  return (cropTier(a) ?? 99) - (cropTier(b) ?? 99) || cropDisplayName(a.name).localeCompare(cropDisplayName(b.name));
}

/** The crop's harvest, drawn: each drop with its icon, name and roll chance. */
function CropHover({ crop }: { crop: RecipeSummary }) {
  const tier = cropTier(crop);
  return (
    <div className="min-w-[170px]">
      <p className="text-[14px] font-bold leading-4 text-white">
        {cropDisplayName(crop.name)}
        {tier ? <span className="text-[11px] font-normal text-slate-400"> · Tier {tier}</span> : null}
      </p>
      <div className="mt-1.5 space-y-1">
        {crop.outputs.map((output) => (
          <div key={output.id} className="flex items-center gap-1.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden">
              <ResourceIcon
                resource={{ ...output, chance: undefined }}
                bare
                tooltip={false}
                showAmount={false}
                showConsumedState={false}
                size="sm"
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] leading-4 text-slate-100">
              {output.displayName ?? output.id}
            </span>
            {output.chance !== undefined && output.chance < 1 ? (
              <span className="shrink-0 text-[12px] tabular-nums text-slate-400">
                {Math.round(output.chance * 1000) / 10}%
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {cropMachineOnly(crop) ? (
        <p className="mt-1.5 text-[12px] leading-4 text-slate-400">Only works in an Industrial Farm.</p>
      ) : null}
    </div>
  );
}

/**
 * Searchable crop list for crop source nodes. Picking a crop swaps the node's
 * recipe to that crop's Crop Farm entry.
 */
export function CropPickerMenu({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const setNodeRecipe = useFactoryStore((state) => state.setNodeRecipe);
  // On the Crop Manager, a machine-only crop harvests to NOTHING; the tile
  // grays out so the dead pick is visible before it is made (the Industrial
  // Farm tab shows them in full color).
  const onIndustrialFarm = useFactoryStore(
    (state) =>
      state.project.nodes.find((entry) => entry.id === nodeId)?.machineHandlerId ===
      "crop-industrial-farm",
  );
  return (
    <RecipeListPicker
      cacheKey="crops"
      load={async (manifestUrl, version) => (await listRecipeDatasetCrops(manifestUrl, version)).crops}
      noun="crops"
      toggleSelector="[data-crop-picker-toggle]"
      onPick={(recipe) => setNodeRecipe(nodeId, recipe)}
      onClose={onClose}
      sort={byTierThenName}
      // The list is tier-sorted, so a tier's first crop opens its section.
      sectionOf={(crop) => {
        const tier = cropTier(crop);
        return tier !== undefined ? `Tier ${tier}` : undefined;
      }}
      tileResource={(crop) => crop.outputs[0]}
      hover={(crop) => <CropHover crop={crop} />}
      dimmed={(crop) => cropMachineOnly(crop) && !onIndustrialFarm}
    />
  );
}
