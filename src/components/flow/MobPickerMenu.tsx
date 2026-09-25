"use client";

import { listRecipeDatasetMobs } from "@/lib/datasets/browser-loader";
import type { RecipeSummary } from "@/lib/datasets/types";
import type { EecMetadata } from "@/lib/machines/extreme-entity-crusher";
import type { RecipeOutput } from "@/lib/model/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { RecipeListPicker, recipeChoiceName } from "./RecipeListPicker";

/** What a kill yields most of, as the mob's face: every spawner looks the same. */
function mainDrop(mob: RecipeSummary) {
  const items = mob.outputs.filter((output) => output.kind === "item");
  const best = items.reduce<RecipeOutput | undefined>(
    (top, output) =>
      !top || output.amount * (output.chance ?? 1) > top.amount * (top.chance ?? 1) ? output : top,
    undefined,
  );
  return best ?? mob.inputs[0];
}

function dropFigure(output: RecipeOutput): string {
  if (output.kind === "fluid") return `${output.amount} L`;
  const perKill = output.amount * (output.chance ?? 1);
  if (perKill < 1) return `${Math.round(perKill * 10000) / 100}%`;
  return `x${Math.round(perKill * 100) / 100}`;
}

/** A kill, drawn: each drop with its icon and what one kill yields with no weapon. */
function MobHover({ mob }: { mob: RecipeSummary }) {
  const eec = (mob.metadata as { eec?: EecMetadata } | undefined)?.eec;
  return (
    <div className="min-w-[190px]">
      <p className="text-[14px] font-bold leading-4 text-white">
        {recipeChoiceName(mob.name)}
        {eec ? <span className="text-[11px] font-normal text-slate-400"> · {eec.maxHealth} health</span> : null}
      </p>
      {eec?.alwaysInfernal ? (
        <p className="mt-0.5 text-[12px] leading-4 text-[var(--mc-bad)]">Always infernal: 8x power.</p>
      ) : null}
      <div className="mt-1.5 space-y-1">
        {mob.outputs.map((output, index) => (
          <div key={`${output.id}-${index}`} className="flex items-center gap-1.5">
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
            <span className="shrink-0 text-[12px] tabular-nums text-slate-400">{dropFigure(output)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] leading-4 text-slate-400">Per kill, with no weapon.</p>
    </div>
  );
}

/**
 * The Extreme Entity Crusher's spawner, swapped: every mob it can hold,
 * searchable by name or drop. A pick changes the mob only; the machine keeps
 * its hatches, weapon, Looting and switches, and wires on drops the new mob
 * also makes stay connected.
 */
export function MobPickerMenu({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const swapMachineRecipe = useFactoryStore((state) => state.swapMachineRecipe);
  const currentRecipeId = useFactoryStore(
    (state) => state.project.nodes.find((entry) => entry.id === nodeId)?.recipeId,
  );
  return (
    <RecipeListPicker
      cacheKey="mobs"
      load={async (manifestUrl, version) => (await listRecipeDatasetMobs(manifestUrl, version)).mobs}
      noun="mobs"
      toggleSelector="[data-mob-picker-toggle]"
      onPick={(recipe) => swapMachineRecipe(nodeId, recipe)}
      onClose={onClose}
      currentRecipeId={currentRecipeId}
      sort={(a, b) => recipeChoiceName(a.name).localeCompare(recipeChoiceName(b.name))}
      tileResource={mainDrop}
      hover={(mob) => <MobHover mob={mob} />}
    />
  );
}
