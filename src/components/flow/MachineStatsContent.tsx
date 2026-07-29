"use client";

import type { FactoryNode, MachineHandler, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, getRecipeMachineHandlers } from "@/lib/model/recipe-rules";
import {
  cropsNhEnvironmentFromTiers,
  cropsNhExpectedDrop,
  cropsNhGrowthRate,
  cropsNhHarvestTicks,
  cropsNhNutrientScore,
  getCropsNhStats,
} from "@/lib/model/passive-production";

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

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/**
 * Hover panel for a crop source node: the crop's card data plus the full
 * rate derivation with the node's CURRENT stats and environment plugged into
 * the real in-game formulas.
 */
function CropSourceStatsContent({
  recipe,
  node,
}: {
  recipe: Recipe;
  node?: Pick<FactoryNode, "machineConfigTiers" | "machineCount">;
}) {
  const stats = getCropsNhStats(recipe);
  if (!stats) {
    return null;
  }
  const meta = (recipe.metadata as { cropsNh?: Record<string, unknown> } | undefined)?.cropsNh;
  const requirements = Array.isArray(meta?.requirements)
    ? (meta?.requirements as string[]).slice(0, 3)
    : [];
  const biomeTags = Array.isArray(meta?.biomeTags) ? (meta?.biomeTags as string[]) : [];
  const cropName = recipe.name.includes(": ")
    ? recipe.name.slice(recipe.name.indexOf(": ") + 2)
    : recipe.name;
  const displayNamesById = new Map(
    recipe.outputs.map((output) => [output.id, output.displayName ?? output.id] as const),
  );

  // Live math with the node's current knob settings (defaults when unset).
  const env = cropsNhEnvironmentFromTiers(node?.machineConfigTiers);
  const waterBonus = Math.floor((Math.min(100, Math.max(0, env.water)) + 9) / 10);
  const fertilizerBonus = Math.floor((Math.min(100, Math.max(0, env.fertilizer)) + 9) / 10);
  const skyBonus = env.sky ? 2 : 0;
  const score = cropsNhNutrientScore(env);
  const supply = score * 5;
  const demand = stats.tier * 10;
  const surplus = supply - demand;
  const speedPercent = surplus >= 0 ? 100 + surplus : Math.max(0, 100 - (demand - supply) * 4);
  const rate = cropsNhGrowthRate(stats, env);
  const growing = rate > 0;
  const cycles = growing ? Math.ceil(stats.growthPoints / rate) : Infinity;
  const harvestTicks = cropsNhHarvestTicks(stats, env);
  const harvestSeconds = harvestTicks / 20;
  const rounds = stats.dropChance * 1.03 ** Math.max(1, Math.min(31, env.gain));
  const dropLines = stats.drops.map((drop) => ({
    name: displayNamesById.get(drop.id) ?? drop.id,
    weightPercent: drop.weight / 100,
    stackSize: drop.stackSize,
    expected: cropsNhExpectedDrop(stats, env.gain, drop),
  }));
  const totalPerHarvest = dropLines.reduce((sum, drop) => sum + drop.expected, 0);
  const cropCount = Math.max(1, node?.machineCount ?? 1);

  return (
    <div className="w-[500px]">
      <div className="flex items-baseline gap-2 border-b border-white/15 pb-1.5">
        <span className="truncate text-[18px] font-semibold text-white">{cropName}</span>
        <span className="shrink-0 text-[13px] text-slate-400">Tier {stats.tier}</span>
        <span className="ml-auto shrink-0 text-[12px] uppercase tracking-wide text-slate-400">
          Crop source
        </span>
      </div>

      {/* Fixed crop card data straight from the game export. */}
      <div className="mt-2 space-y-1">
        <StatRow label="Ripens at">
          <span className="text-slate-100">{stats.growthPoints.toLocaleString()}</span>
          <span className="text-slate-400"> growth points, restarting after every harvest</span>
        </StatRow>
        {dropLines.map((drop) => (
          <StatRow key={drop.name} label="Drops">
            <span className="text-slate-100">
              {drop.stackSize > 1 ? `${formatNumber(drop.stackSize, 0)}× ` : ""}
              {drop.name}
            </span>
            {drop.weightPercent < 100 ? (
              <span className="text-slate-400">
                {" "}
                ({formatNumber(drop.weightPercent, 1)}% of loot rolls)
              </span>
            ) : null}
          </StatRow>
        ))}
        {stats.machineOnly ? (
          <StatRow label="Farm">
            <span style={{ color: PENALTY_COLOR }}>Grows only inside an Industrial Farm</span>
          </StatRow>
        ) : null}
        {biomeTags.length > 0 ? (
          <StatRow label="Liked biomes">
            <span className="text-slate-300">{biomeTags.join(", ").toLowerCase()}</span>
          </StatRow>
        ) : null}
        {requirements.map((requirement) => (
          <p key={requirement} className="text-[15px] leading-snug text-slate-300">
            {requirement}
          </p>
        ))}
      </div>

      {/* How well fed is it, with the node's current settings. */}
      <div className="mt-2.5 border-t border-white/10 pt-2">
        <p className="text-[17px] font-semibold leading-snug text-amber-300">
          How well fed is it right now?
        </p>
        <p className="mt-1 text-[16px] leading-relaxed text-slate-100">
          Your settings feed it <span className="text-white">{supply}</span> food (
          {waterBonus > 1 ? "watered" : "dry"}
          {fertilizerBonus > 1 ? ", fertilized" : ", no fertilizer"}
          {env.sky ? ", open sky" : ", covered"}
          {env.biomeBonus > 0 ? ", nice biome" : ", wrong biome"}). Being Tier {stats.tier}, it
          wants <span className="text-white">{demand}</span>.{" "}
          {surplus >= 0 ? (
            <span>
              That&apos;s <span style={{ color: BONUS_COLOR }}>{surplus} more than it needs</span>,
              so it grows at{" "}
              <span style={{ color: BONUS_COLOR }}>{speedPercent}% speed</span> — a well-fed crop
              grows faster.
            </span>
          ) : supply + 25 <= demand ? (
            <span style={{ color: PENALTY_COLOR }}>
              That&apos;s {-surplus} less than it needs — far too hungry. It will not grow at all
              until you feed it better (more water, fertilizer, sky or a better biome).
            </span>
          ) : (
            <span>
              That&apos;s <span style={{ color: PENALTY_COLOR }}>{-surplus} less than it needs</span>
              , and hunger hurts four times harder than surplus helps: it limps along at{" "}
              <span style={{ color: PENALTY_COLOR }}>{speedPercent}% speed</span>.
            </span>
          )}
        </p>
      </div>

      {/* How long until harvest. */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="text-[17px] font-semibold leading-snug text-amber-300">
          How long until each harvest?
        </p>
        {growing ? (
          <p className="mt-1 text-[16px] leading-relaxed text-slate-100">
            With Growth {env.growth} and that feeding, the plant ripens in about{" "}
            <span style={{ color: BONUS_COLOR }}>{formatNumber(harvestSeconds, 1)} seconds</span>,
            over and over.{" "}
            <span className="text-slate-400">
              (It gains {rate} of its {stats.growthPoints.toLocaleString()} growth points every
              12.8 s — {cycles} rounds in total.)
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[16px] leading-relaxed" style={{ color: PENALTY_COLOR }}>
            Never — it&apos;s too hungry to grow. Fix the feeding above and this section comes back
            to life.
          </p>
        )}
      </div>

      {/* What you get. */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="text-[17px] font-semibold leading-snug text-amber-300">
          What do you get each harvest?
        </p>
        <p className="mt-1 text-[16px] leading-relaxed text-slate-100">
          Gain {env.gain} shakes the loot table about{" "}
          <span className="text-white">{formatNumber(rounds, 1)} times</span> per harvest, with a
          small chance of bonus items on top. On average:
        </p>
        <div className="mt-1 space-y-0.5">
          {dropLines.map((drop) => (
            <StatRow key={drop.name} label={drop.name}>
              <span style={{ color: BONUS_COLOR }}>{formatNumber(drop.expected, 2)}</span>
              <span className="text-slate-400"> each harvest</span>
            </StatRow>
          ))}
        </div>
        {growing ? (
          <p className="mt-1.5 text-[16px] leading-relaxed text-slate-100">
            With your {cropCount === 1 ? "single crop" : `${cropCount} crops`}, that works out to{" "}
            <span style={{ color: BONUS_COLOR }}>
              about {formatNumber((totalPerHarvest * cropCount * 60) / harvestSeconds, 1)} items per
              minute
            </span>
            . Plant more seeds to scale it up.
          </p>
        ) : null}
      </div>

      <p className="mt-2 border-t border-white/10 pt-2 text-[13px] leading-relaxed text-slate-400">
        For the curious: food = (5 + water + fertilizer + sky + biome) × 5 vs Tier × 10 demand
        (+1% speed per spare point, −4% per missing); growth = (6 + Growth) points per 12.8 s;
        loot rolls = {formatNumber(stats.dropChance, 3)} × 1.03^Gain with a (Gain + 1)% bonus roll.
        Straight from the game&apos;s own code. Resistance never changes these rates — it only
        fights weeds and sickness.
      </p>
    </div>
  );
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
  node,
}: {
  recipe: Recipe;
  handler: MachineHandler;
  node?: Pick<FactoryNode, "machineConfigTiers" | "machineCount">;
}) {
  const cropStats = getCropsNhStats(recipe);
  if (cropStats) {
    return <CropSourceStatsContent recipe={recipe} node={node} />;
  }

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
        {applied.machineProfile?.perfectOverclock ? (
          <StatRow label="Overclocks">
            <span style={{ color: BONUS_COLOR }}>Perfect</span>
            <span className="text-slate-400"> (no wasted energy)</span>
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
        ) : applied.machineProfile?.perfectOverclock ? (
          <p className="mt-0.5 text-[15px] leading-relaxed text-slate-100">
            Perfect. Each tier of extra power runs{" "}
            <span style={{ color: BONUS_COLOR }}>4&times;</span> faster for{" "}
            <span style={{ color: PENALTY_COLOR }}>4&times;</span> the power, so the total energy
            per craft never grows.
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
