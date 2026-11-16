import type { FactoryNode, Recipe } from "@/lib/model/types";
import {
  applyMachineHandlerToRecipe,
  applyRecipeInputOverrides,
  getRecipeCoilTierControl,
  getRecipeSpecialValue,
} from "@/lib/model";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { getMachineBehaviour } from "@/lib/machines/machine-table";
import { getFusionMachine } from "@/lib/machines/fusion";
import { formulaNumber, knob, type FormulaLine, type FormulaTerm } from "@/lib/machines/formula-lines";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { getHeatDiscountMultiplier, isHeatOverclockMachine } from "@/lib/solver/heat";
import {
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineStructuralParallels,
} from "@/lib/solver/machine-effects";
import { getEffectiveVoltageOrdinal } from "@/lib/solver/power";
import { getNodePowerReport, hasPowerReport } from "@/lib/solver/power-report";
import { prefersCuratedMachineMath } from "@/lib/solver/runtime-calculation";
import {
  EEC_SHARPNESS,
  EEC_WEAPON_DAMAGE,
  getEecDamageReport,
  getEecMetadata,
  getEecSettings,
} from "@/lib/machines/extreme-entity-crusher";

/**
 * A GregTech card's working, as lines for its gear sheet (the mod's `machines/web/Working`): the supply, the coil's
 * heat, the discount, the parallels it pays for, the overclocks the rest buys, and what they make of the time, the
 * draw and the recipes a second. Only the lines that apply, every number from the functions the card runs on.
 */
export const TIER_KNOB = "tier";
export const AMPS_KNOB = "amps";
export const COIL_KNOB = "coil";

const n = formulaNumber;

/** Ticks as the website writes them: whole, or 1/n under one. */
function ticks(t: number): string {
  return t >= 1 ? `${n(t)} t` : `1/${Math.round(1 / t)} t`;
}

function sup(power: number): FormulaTerm {
  return { sup: String(power) };
}

function line(label: string, result: string, tone?: FormulaLine["tone"], ...math: FormulaTerm[]): FormulaLine {
  return { label, math, result, tone };
}

function recipesLine(parallels: number, durationTicks: number): FormulaLine {
  return line("recipes", `${n((parallels * 20) / durationTicks)}/s`, undefined, `${n(parallels)} · 20 / ${ticks(durationTicks)}`);
}

export function workingLines(recipe: Recipe, node: FactoryNode): FormulaLine[] {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  if (!hasPowerReport(nodeRecipe)) return [];
  const e = applyMachineHandlerToRecipe(nodeRecipe, node);
  if (getFusionMachine(e.machineType)) return [];
  const report = getNodePowerReport(nodeRecipe, node);
  const s = getOverclockedRecipeStats(nodeRecipe, node);
  const out: FormulaLine[] = [];
  const tier = report.tier;
  const voltage = getVoltageTierMaxEuT(tier);
  const amps = report.amps;
  const pool = report.poolEuT;

  if (report.isMultiblock) {
    out.push(line("supply", `${n(pool)} EU/t`, undefined, knob(n(voltage), TIER_KNOB), " V · ", knob(n(amps), AMPS_KNOB), " A"));
  } else {
    out.push(
      line("supply", `${n(pool)} EU/t`, undefined, knob(tier, TIER_KNOB), ` machine${amps !== 1 ? ` · ${n(amps)} A` : ""}`),
    );
  }

  const eec = getEecMetadata(e);
  if (eec) {
    out.push(...eecLines(eec, node, s));
    out.push(recipesLine(1, s.durationTicks));
    return out;
  }

  const base = Math.abs(e.eut);
  const baseTicks = e.durationTicks;
  const steps = s.overclockSteps;
  if (!prefersCuratedMachineMath(e)) {
    // The game's own overclock calculator gave these: plain steps.
    out.push(line("overclocks", steps === 0 ? "none" : String(steps)));
    const halved = Math.max(1, Math.floor(baseTicks / 2 ** steps));
    out.push(
      halved === s.durationTicks && steps > 0
        ? line("time", ticks(s.durationTicks), undefined, `${n(baseTicks)} / 2`, sup(steps))
        : line("time", ticks(s.durationTicks)),
    );
    out.push(
      base * 4 ** steps === Math.abs(s.eut) && steps > 0
        ? line("draw", `${n(Math.abs(s.eut))} EU/t`, undefined, `${n(base)} · 4`, sup(steps))
        : line("draw", `${n(Math.abs(s.eut))} EU/t`),
    );
    out.push(recipesLine(Math.max(1, report.parallels), s.durationTicks));
    return out;
  }

  // Heat: the coil over the recipe's need buys perfect overclocks and a discount.
  const ordinal = getEffectiveVoltageOrdinal(e, node, tier);
  const special = getRecipeSpecialValue(e);
  const coil = getRecipeCoilTierControl(e, node);
  const behaviour = getMachineBehaviour(e.machineType);
  if (isHeatOverclockMachine(e.machineType) && special !== undefined && special >= 0 && coil?.current.heat) {
    const coilHeat = coil.current.heat * (behaviour?.heat?.coilHeatMultiplier ?? 1);
    const bonus = behaviour?.heat?.voltageBonus === true;
    const machineHeat = bonus ? coilHeat + 100 * Math.max(0, ordinal - 2) : coilHeat;
    const excess = Math.max(0, machineHeat - special);
    const terms: FormulaTerm[] = [knob(n(coilHeat), COIL_KNOB)];
    if (bonus) terms.push(` + 100·${Math.max(0, ordinal - 2)}`);
    terms.push(` − ${n(special)}`);
    out.push(line("heat", `${n(excess)} K over`, machineHeat >= special ? "good" : "bad", ...terms));
  }

  // Discount: the machine's share of the recipe's power, and the coil's 5% per 900 K.
  const eutMultiplier = getMachineEutMultiplier(e, node);
  const heatDiscount = getHeatDiscountMultiplier(e, node, tier, ordinal);
  const discounted = Math.abs(eutMultiplier * heatDiscount - 1) > 1e-12;
  if (discounted) {
    const terms: FormulaTerm[] = [];
    if (eutMultiplier !== 1) terms.push(n(eutMultiplier));
    if (heatDiscount !== 1) {
      if (terms.length > 0) terms.push(" · ");
      terms.push("0.95", sup(Math.round(Math.log(heatDiscount) / Math.log(0.95))));
    }
    out.push(line("discount", `${n(eutMultiplier * heatDiscount * 100)}% power`, undefined, ...terms));
  }

  // Parallels: as many as the structure offers and the supply pays for, before any overclock.
  const structural = getMachineStructuralParallels(e, node);
  const parallels = Math.max(1, report.parallels);
  const single = Math.ceil(base * eutMultiplier * heatDiscount);
  if (structural > 1 || parallels > 1) {
    out.push(line("parallels", n(parallels), undefined, `min(${n(structural)}, ⌊${n(pool)} / ${n(single)}⌋)`));
  }

  // Overclocks: whole fours of the supply over the draw, a draw under 32 EU/t billed as 32.
  const draw = Math.max(Math.ceil(base * eutMultiplier * heatDiscount * parallels), 32);
  const perfect = s.perfectOverclockSteps;
  const normal = s.overclockSteps - perfect;
  out.push(
    line(
      "overclocks",
      s.overclockSteps === 0 ? "none" : s.overclockSteps + (perfect > 0 ? ` (${perfect} perfect)` : ""),
      undefined,
      `⌊log4(${n(pool)} / ${n(draw)})⌋`,
    ),
  );

  // Time: perfect steps divide by their factor, normal ones halve; the machine's speed; whole ticks.
  const time: FormulaTerm[] = [n(baseTicks)];
  if (perfect > 0) time.push(` / ${n(s.perfectSpeedFactor)}`, sup(perfect));
  if (normal > 0) time.push(" / 2", sup(normal));
  const durationMultiplier = getMachineDurationMultiplier(e, node);
  if (durationMultiplier !== 1) time.push(` · ${n(durationMultiplier)}`);
  out.push(
    time.length === 1 ? line("time", ticks(s.durationTicks)) : line("time", ticks(s.durationTicks), undefined, ...time),
  );

  // Power: the recipe's draw, discounted, times the steps' factor, for each parallel.
  const power: FormulaTerm[] = [n(base)];
  if (discounted) power.push(` · ${n(eutMultiplier * heatDiscount)}`);
  if (perfect > 0) power.push(` · ${n(s.perfectEuFactor)}`, sup(perfect));
  if (normal > 0) power.push(" · 4", sup(normal));
  if (parallels > 1) power.push(` · ${n(parallels)}`);
  out.push(line("draw", `${n(Math.abs(s.eut) * parallels)} EU/t`, report.state !== "ok" ? "bad" : undefined, ...power));
  out.push(recipesLine(parallels, s.durationTicks));
  return out;
}

/**
 * The Extreme Entity Crusher's working: spikes, weapon and Sharpness make the damage, the mob's health over it the
 * kill, never under the spawn interval. The time is per kill's drops, averaged over infernal kills, with the
 * overclocks past the 20-tick floor multiplying the drops instead.
 */
function eecLines(
  meta: NonNullable<ReturnType<typeof getEecMetadata>>,
  node: FactoryNode,
  s: ReturnType<typeof getOverclockedRecipeStats>,
): FormulaLine[] {
  const settings = getEecSettings(node.machineConfigTiers);
  const report = getEecDamageReport(meta, settings);
  const out: FormulaLine[] = [];
  if (settings.ritual) {
    out.push(line("kill", "ritual, 400 t"));
  } else {
    const weapon = settings.weaponDamage - settings.sharpness * 1.25;
    const damage: FormulaTerm[] = [n(report.totalDamage - settings.weaponDamage), " + ", knob(n(weapon), EEC_WEAPON_DAMAGE)];
    if (settings.sharpness > 0) damage.push(" + 1.25·", knob(n(settings.sharpness), EEC_SHARPNESS));
    out.push(line("damage", n(report.totalDamage), undefined, ...damage));
    out.push(
      line(
        "kill",
        report.atFloor ? `${ticks(report.killTicks)} (minimum)` : ticks(report.killTicks),
        undefined,
        `max(${n(report.floorTicks)}, ⌊${n(meta.maxHealth)} HP / ${n(report.totalDamage)} · 10⌋)`,
      ),
    );
  }
  out.push(line("overclocks", s.overclockSteps === 0 ? "none" : String(s.overclockSteps)));
  out.push(line("time per kill", ticks(s.durationTicks)));
  out.push(line("draw", `${n(Math.abs(s.eut))} EU/t`));
  return out;
}
