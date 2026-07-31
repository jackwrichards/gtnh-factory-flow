"use client";

import { AlertTriangle } from "lucide-react";
import type { Recipe } from "@/lib/model/types";
import { formatRate, getRecipePowerTier } from "@/lib/model";
import { NeiRecipeCanvas } from "./nei/NeiRecipeCanvas";

interface NeiRecipeCardProps {
  recipe: Recipe;
  compact?: boolean;
}

export function NeiRecipeCard({ recipe, compact = false }: NeiRecipeCardProps) {
  const durationSeconds = recipe.durationTicks / 20;
  const totalEu = recipe.eut * recipe.durationTicks;
  const powerTier = getRecipePowerTier(recipe);

  return (
    <article className="mx-auto w-full max-w-[390px] border-2 border-[var(--mc-96)] bg-[var(--mc-78)] font-mono text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]">
      <div className="relative px-2 pb-2 pt-1">
        <div className="mt-1 grid grid-cols-[24px_minmax(0,1fr)_24px] items-center">
          <NeiButton label="<" />
          <div className="h-7 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-center text-[18px] leading-[24px] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)] [text-shadow:2px_2px_0_var(--mc-24)]">
            {recipe.machineType}
          </div>
          <NeiButton label=">" />
        </div>

        <div className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-center">
          <NeiButton label="<" dark />
          <div className="h-7 border-x-2 border-b-2 border-[var(--mc-33)] bg-[var(--mc-65)] px-2 text-center text-[18px] leading-[24px] text-white shadow-[inset_2px_0_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)] [text-shadow:2px_2px_0_var(--mc-24)]">
            Page 1/1
          </div>
          <NeiButton label=">" dark />
        </div>

        <NeiRecipeCanvas recipe={recipe} scale={2} className="mt-1" />

        {!compact ? (
          <footer className="mt-2 px-1 text-[18px] leading-[22px] text-[var(--mc-ink)]">
            <div>Total: {formatRate(totalEu, 0)} EU</div>
            <div>
              Usage: {formatRate(recipe.eut, 0)} EU/t ({powerTier})
            </div>
            <div>Time: {formatRate(durationSeconds, 2)} seconds</div>
            {recipe.programmedCircuit ? <div>Circuit: {recipe.programmedCircuit}</div> : null}
            {recipe.source ? (
              <div className="mt-1 truncate text-[11px] leading-4 text-[var(--mc-ink-muted)]">
                {recipe.source.exporter ?? "unknown"} /{" "}
                {recipe.source.datasetVersionId ?? "unknown dataset"}
              </div>
            ) : null}
            {recipe.isDemo ? (
              <div className="mt-2 flex items-start gap-2 border border-amber-700 bg-amber-200 p-1 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Demo data, not authoritative GTNH data.</span>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}

function NeiButton({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={[
        "h-7 w-6 border-2 border-[var(--mc-15)] text-[18px] leading-5 text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] [text-shadow:1px_1px_0_#000]",
        dark ? "bg-[var(--mc-36)]" : "bg-[var(--mc-61)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
