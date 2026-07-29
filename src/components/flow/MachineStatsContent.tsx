"use client";

import type { MachineHandler, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, getRecipeMachineHandlers } from "@/lib/model/recipe-rules";

const RATE_COLOR = "#67e8f9";
const BONUS_COLOR = "#4ade80";
const PENALTY_COLOR = "#f87171";

function formatSeconds(ticks: number): string {
  const seconds = ticks / 20;
  if (seconds >= 100) {
    return `${Math.round(seconds).toLocaleString()}s`;
  }
  return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 2 })}s`;
}

function formatEu(eut: number): string {
  return `${Math.round(eut).toLocaleString()} EU/t`;
}

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
    <div className="flex items-baseline justify-between gap-3 text-[15px] leading-relaxed">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{children}</span>
    </div>
  );
}

/**
 * Hover panel for a machine choice: what this exact machine does to the
 * recipe (speed, power, parallels, structure options) and an honest note on
 * how the simulator handles its overclocking. Shown on the node's machine
 * name and on every entry of the machine dropdown.
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

  return (
    <div className="w-80">
      <div className="flex items-baseline gap-2 border-b border-white/15 pb-1.5">
        <span className="truncate text-[16px] font-semibold text-white">{handler.label}</span>
        <span className="ml-auto shrink-0 text-[12px] uppercase tracking-wide text-slate-400">
          {handler.kind === "multiblock" ? "Multiblock" : "Single block"}
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        <StatRow label="Needs">
          <span style={{ color: RATE_COLOR }}>{String(applied.minimumTier).toUpperCase()}</span>
          <span className="text-slate-400"> power or better</span>
        </StatRow>
        <StatRow label="Time">
          <span style={{ color: RATE_COLOR }}>{formatSeconds(applied.durationTicks)}</span>
          {Math.abs(speedFactor - 1) > 0.01 ? (
            <span style={{ color: speedFactor > 1 ? BONUS_COLOR : PENALTY_COLOR }}>
              {" "}
              ({formatMultiplier(speedFactor)} speed)
            </span>
          ) : null}
        </StatRow>
        {applied.eut > 0 ? (
          <StatRow label="Power">
            <span style={{ color: RATE_COLOR }}>{formatEu(applied.eut)}</span>
            {Math.abs(powerFactor - 1) > 0.01 ? (
              <span style={{ color: powerFactor < 1 ? BONUS_COLOR : PENALTY_COLOR }}>
                {" "}
                ({Math.round(powerFactor * 100)}% of normal)
              </span>
            ) : null}
          </StatRow>
        ) : null}
        {parallels.fixed !== undefined ? (
          <StatRow label="Parallels">
            <span style={{ color: BONUS_COLOR }}>{parallels.fixed.toLocaleString()}</span>
            <span className="text-slate-400"> recipes at once</span>
          </StatRow>
        ) : null}
        {parallels.scaling.map((entry) => (
          <StatRow key={entry.label} label="Parallels">
            <span className="text-slate-400">up to </span>
            <span style={{ color: BONUS_COLOR }}>{formatMultiplier(entry.max)}</span>
            <span className="text-slate-400"> from {entry.label} tiers</span>
          </StatRow>
        ))}
        {tuningControls.length > 0 ? (
          <StatRow label="Tuning">
            <span className="text-slate-300">{tuningControls.join(", ")}</span>
          </StatRow>
        ) : null}
      </div>

      <div className="mt-2.5 border-t border-white/10 pt-2">
        <p className="text-[15px] font-semibold leading-snug text-amber-300">Overclocking.</p>
        {hasExactOverclocks ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-slate-100">
            Exact. The dataset was exported with the game running, and GregTech&apos;s own
            calculator supplied the time and power for every voltage tier. Heat bonuses and
            perfect overclocks are included.
          </p>
        ) : isDefault ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-slate-100">
            Estimated. Each tier above{" "}
            <span style={{ color: RATE_COLOR }}>{String(applied.minimumTier).toUpperCase()}</span>{" "}
            runs <span style={{ color: BONUS_COLOR }}>2&times;</span> faster and draws{" "}
            <span style={{ color: PENALTY_COLOR }}>4&times;</span> the power.
          </p>
        ) : (
          <p className="mt-0.5 text-[14px] leading-relaxed text-slate-100">
            Estimated for this machine. Each tier above{" "}
            <span style={{ color: RATE_COLOR }}>{String(applied.minimumTier).toUpperCase()}</span>{" "}
            runs <span style={{ color: BONUS_COLOR }}>2&times;</span> faster and draws{" "}
            <span style={{ color: PENALTY_COLOR }}>4&times;</span> the power. If it has perfect
            overclocks in game, it will beat these numbers at high tiers.
          </p>
        )}
      </div>
    </div>
  );
}
