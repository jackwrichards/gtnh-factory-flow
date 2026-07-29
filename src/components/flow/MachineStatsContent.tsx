"use client";

import type { MachineHandler, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, getRecipeMachineHandlers } from "@/lib/model/recipe-rules";

const BONUS_COLOR = "#4ade80";
const PENALTY_COLOR = "#f87171";

function formatMultiplier(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
}

interface ParallelSummary {
  fixed?: number;
  scaling: { label: string; max: number }[];
}

function summarizeParallels(recipe: Recipe): ParallelSummary {
  const summary: ParallelSummary = { scaling: [] };
  for (const control of recipe.machineConfigControls ?? []) {
    const multipliers = control.tiers
      .map((tier) => tier.parallelMultiplier)
      .filter((value): value is number => Number.isFinite(value) && (value as number) > 1);
    if (multipliers.length === 0) {
      continue;
    }
    if (control.id === "machineParallel") {
      summary.fixed = Math.max(...multipliers);
    } else {
      summary.scaling.push({ label: control.label, max: Math.max(...multipliers) });
    }
  }
  return summary;
}

function speedAndPowerControls(recipe: Recipe): string[] {
  const names = new Set<string>();
  for (const control of recipe.machineConfigControls ?? []) {
    const changesSpeed = control.tiers.some(
      (tier) => Number.isFinite(tier.durationMultiplier) && tier.durationMultiplier !== 1,
    );
    const changesPower = control.tiers.some(
      (tier) => Number.isFinite(tier.eutMultiplier) && tier.eutMultiplier !== 1,
    );
    if (changesSpeed || changesPower) {
      names.add(control.label);
    }
  }
  return [...names];
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[16px] leading-snug">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{children}</span>
    </div>
  );
}

/**
 * Hover panel for a machine choice. Only says what the screen does not
 * already show: what this exact machine changes (speed, power discount,
 * parallels, structure tuning) and how the simulator overclocks it.
 */
export function MachineStatsContent({
  recipe,
  handler,
}: {
  recipe: Recipe;
  handler: MachineHandler;
}) {
  const handlers = getRecipeMachineHandlers(recipe);
  const isDefault = handler.id === handlers[0]?.id;
  const applied = applyMachineHandlerToRecipe(recipe, { machineHandlerId: handler.id });

  const speedFactor = applied.durationTicks > 0 ? recipe.durationTicks / applied.durationTicks : 1;
  const powerFactor = recipe.eut > 0 ? applied.eut / recipe.eut : 1;
  const parallels = summarizeParallels(applied);
  const tuningControls = speedAndPowerControls(applied);
  const hasExactOverclocks =
    isDefault &&
    recipe.runtimeCalculation?.status === "computed" &&
    (recipe.runtimeCalculation?.variants.length ?? 0) > 0;

  const hasSpeedRow = Math.abs(speedFactor - 1) > 0.01;
  const hasPowerRow = recipe.eut > 0 && Math.abs(powerFactor - 1) > 0.01;
  const hasBonusRows =
    hasSpeedRow ||
    hasPowerRow ||
    parallels.fixed !== undefined ||
    parallels.scaling.length > 0 ||
    tuningControls.length > 0;

  return (
    <div className="w-80">
      <div className="flex items-baseline gap-2 border-b border-white/15 pb-1.5">
        <span className="truncate text-[17px] font-semibold text-white">{handler.label}</span>
        <span className="ml-auto shrink-0 text-[12px] uppercase tracking-wide text-slate-400">
          {handler.kind === "multiblock" ? "Multiblock" : "Single block"}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {hasSpeedRow ? (
          <StatRow label="Speed">
            <span style={{ color: speedFactor > 1 ? BONUS_COLOR : PENALTY_COLOR }}>
              {formatMultiplier(speedFactor)}
            </span>
          </StatRow>
        ) : null}
        {hasPowerRow ? (
          <StatRow label="Power">
            <span style={{ color: powerFactor < 1 ? BONUS_COLOR : PENALTY_COLOR }}>
              {Math.round(powerFactor * 100)}%
            </span>
            <span className="text-slate-400"> of normal</span>
          </StatRow>
        ) : null}
        {parallels.fixed !== undefined ? (
          <StatRow label="Parallels">
            <span style={{ color: BONUS_COLOR }}>{parallels.fixed.toLocaleString()}</span>
            <span className="text-slate-400"> at once</span>
          </StatRow>
        ) : null}
        {parallels.scaling.map((entry) => (
          <StatRow key={entry.label} label="Parallels">
            <span className="text-slate-400">up to </span>
            <span style={{ color: BONUS_COLOR }}>{formatMultiplier(entry.max)}</span>
            <span className="text-slate-400"> from {entry.label}</span>
          </StatRow>
        ))}
        {tuningControls.length > 0 ? (
          <StatRow label="Tuned by">
            <span className="text-slate-300">{tuningControls.join(", ")}</span>
          </StatRow>
        ) : null}
        {!hasBonusRows ? (
          <p className="text-[16px] leading-snug text-slate-300">
            No special bonuses. Runs recipes at their listed time and power.
          </p>
        ) : null}
      </div>

      <div className="mt-2.5 border-t border-white/10 pt-2">
        <p className="text-[16px] font-semibold leading-snug text-amber-300">Overclocking.</p>
        {hasExactOverclocks ? (
          <p className="mt-0.5 text-[15px] leading-relaxed text-slate-100">
            Exact. The numbers for every voltage tier came from GregTech&apos;s own calculator
            while the game was running, so heat bonuses and perfect overclocks are included.
          </p>
        ) : (
          <p className="mt-0.5 text-[15px] leading-relaxed text-slate-100">
            Estimated. Each tier of extra power runs{" "}
            <span style={{ color: BONUS_COLOR }}>2&times;</span> faster for{" "}
            <span style={{ color: PENALTY_COLOR }}>4&times;</span> the power.
            {!isDefault ? " If it has perfect overclocks in game, it will beat this." : null}
          </p>
        )}
      </div>
    </div>
  );
}
