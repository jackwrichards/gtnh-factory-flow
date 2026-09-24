import { getMachineBehaviour } from "@/lib/machines/machine-table";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { getFusionMachine } from "@/lib/machines/fusion";
import {
  GT_VOLTAGE_TIERS,
  getRecipeMinimumVoltageTier,
  getRecipePowerTier,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
} from "@/lib/model/tiers";
import type { FactoryNode, FactoryProject, Recipe } from "@/lib/model/types";
import { getMachineStructuralParallels, getMachineEutMultiplier } from "./machine-effects";
import { getHeatDiscountMultiplier } from "./heat";
import {
  getEffectiveVoltageOrdinal,
  getNodePowerAmps,
  getNodeRunTier,
  isMultiblockRecipe,
} from "./power";

/** Highest selectable amperage; raw EU/t remains an explicit power budget. */
export const MAX_HATCH_AMPS = 16_777_216;

/** Seed new cards at recipe minimum; preserve legacy operating voltage on load. */
export function normalizeHatchInput(
  recipe: Recipe,
  node: FactoryNode,
  migrate = false,
): FactoryNode {
  // Most edits reach an already-normalized node. Keep this path constant
  // and preserve identity; only placement/migration needs recipe derivation.
  if (node.hatchVoltageTier !== undefined && node.hatchAmps !== undefined) {
    const powerEuT = getVoltageTierMaxEuT(node.hatchVoltageTier) * node.hatchAmps;
    return node.powerEuT === powerEuT ? node : { ...node, powerEuT };
  }
  const effective = applyMachineHandlerToRecipe(recipe, node);
  if (!isMultiblockRecipe(effective) || effective.eut <= 0 || recipe.power) return node;
  const hatchVoltageTier =
    node.hatchVoltageTier ??
    (migrate ? getNodeRunTier(effective, node) : getRecipeMinimumVoltageTier(effective));
  const voltage = getVoltageTierMaxEuT(hatchVoltageTier);
  let amps: number = node.hatchAmps ?? 0;
  if (node.hatchAmps === undefined) {
    if (node.powerEuT !== undefined) amps = node.powerEuT / voltage;
    else if (migrate) {
      amps =
        (getVoltageTierMaxEuT(getNodeRunTier(effective, node)) *
          getNodePowerAmps(effective, node)) /
        voltage;
    } else {
      // Parallels and heat discounts are constant within each summed-voltage
      // tier. Search those intervals in order. A fixed-point iteration can
      // oscillate when crossing a heat bonus reduces the required supply.
      const factor = getMachineBehaviour(effective.machineType)?.fullPowerPool ? 1 : 2;
      let lower = 0;
      for (const { maxEuT } of GT_VOLTAGE_TIERS) {
        const upper = factor * maxEuT;
        if (maxEuT < voltage) continue;
        const candidate = { ...node, hatchVoltageTier, hatchAmps: lower / voltage };
        const perParallel =
          Math.abs(effective.eut) *
          getMachineEutMultiplier(effective, candidate) *
          getHeatDiscountMultiplier(
            effective,
            candidate,
            hatchVoltageTier,
            getEffectiveVoltageOrdinal(effective, candidate, hatchVoltageTier),
          );
        const required = Math.ceil(
          getMachineStructuralParallels(effective, candidate) * perParallel,
        );
        // Whole amps: nobody builds 0.94A, and a fraction carried onto a
        // higher tier leaves the card short of that tier's own voltage.
        const whole = Math.max(1, Math.ceil(Math.max(lower, required) / voltage));
        if (whole * voltage <= upper || maxEuT === GT_VOLTAGE_TIERS.at(-1)!.maxEuT) {
          amps = whole;
          break;
        }
        lower = upper + 1;
      }
    }
  }
  const powerEuT = amps * voltage;
  if (
    node.hatchVoltageTier === hatchVoltageTier &&
    node.hatchAmps === amps &&
    node.powerEuT === powerEuT
  )
    return node;
  return { ...node, hatchVoltageTier, hatchAmps: amps, powerEuT };
}

/**
 * Switching a card to another machine keeps the voltage it ran at
 * (community report, 2026-09-23: an EV Forge Hammer switched to the
 * Industrial Sledgehammer came up 63A EV, the full-parallel seed chasing
 * parallels that grow with voltage). A singleblock becoming a multiblock
 * gets ONE hatch of its own tier - 1A, what the singleblock ran on - and a
 * multiblock becoming a singleblock takes its hatch tier. Multiblock to
 * multiblock keeps its hatches through the edit funnel, and singleblock to
 * singleblock keeps the caller's reset, so both answer with nothing.
 */
export function carryMachineVoltage(
  from: { recipe: Recipe; node: FactoryNode },
  to: { recipe: Recipe; machineHandlerId: string | undefined },
): Partial<FactoryNode> {
  if (from.recipe.power || to.recipe.power) return {};
  const before = applyMachineHandlerToRecipe(from.recipe, from.node);
  const after = applyMachineHandlerToRecipe(to.recipe, { machineHandlerId: to.machineHandlerId });
  if (getFusionMachine(before.machineType) || getFusionMachine(after.machineType)) return {};
  const wasMultiblock = isMultiblockRecipe(before);
  const isMultiblock = isMultiblockRecipe(after);
  if (wasMultiblock === isMultiblock) return {};
  const tier = getNodeRunTier(before, from.node);
  if (wasMultiblock) return { overclockTier: tier };
  if (after.eut <= 0) return {};
  // Floored at what the recipe draws, never at the handler's declared
  // minimum: a multiblock's controller unlock is not a hatch voltage.
  const powerTier = getRecipePowerTier(after);
  const hatchVoltageTier =
    getVoltageTierIndex(powerTier) > getVoltageTierIndex(tier) ? powerTier : tier;
  return {
    hatchVoltageTier,
    hatchAmps: 1,
    powerInputMode: "amps",
    powerEuT: getVoltageTierMaxEuT(hatchVoltageTier),
  };
}

/**
 * A new tier keeps the amps, except that anything under one amp becomes one:
 * a card seeded at 0.94A LV and moved to HV read 0.94A HV, just under the
 * tier's own voltage, and ran like an MV machine. A lone hatch is 1A. Zero
 * stays zero, and typed decimals of one amp or more (a mixed build written
 * in one tier's terms) stay as typed.
 */
export function ampsForNewTier(amps: number): number {
  return amps > 0 && amps < 1 ? 1 : amps;
}

export function normalizeProjectHatchInputs(
  project: FactoryProject,
  migrate = false,
): FactoryProject {
  const recipes = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  let changed = false;
  const nodes = project.nodes.map((node) => {
    const recipe = recipes.get(node.recipeId);
    const next = recipe ? normalizeHatchInput(recipe, node, migrate) : node;
    changed ||= next !== node;
    return next;
  });
  return changed ? { ...project, nodes } : project;
}

/** EU/t entry uses whole working amps; direct amp entry preserves decimals. */
export function roundHatchBudget(euT: number, voltage: number): number {
  return Math.max(0, Math.round(euT / voltage));
}

export function hatchEquivalent(amps: number, tier: string): string | undefined {
  if (amps === 1) return `1 ${tier} hatch (a lone hatch only counts as 1A)`;
  if (amps >= 4 && Number.isInteger(amps / 2)) return `= ${amps / 2} ${tier} hatches`;
  return undefined;
}

/** Step whole amps, dropping any fraction toward the direction of travel. */
export function stepWholeAmp(amps: number, direction: -1 | 1, step = 1): number {
  return Math.max(0, direction > 0 ? Math.floor(amps) + step : Math.ceil(amps) - step);
}

/** Snap in the requested direction through 1, 4, 16, ...; zero is the lower stop. */
export function stepPowerOfFourAmps(amps: number, direction: -1 | 1): number {
  if (!Number.isFinite(amps) || amps < 0) return 0;
  if (direction < 0 && amps <= 1) return 0;
  let power = 1;
  if (direction > 0) {
    while (power <= amps) power *= 4;
    return Math.min(MAX_HATCH_AMPS, Number.isFinite(power) ? power : amps);
  }
  while (power * 4 < amps) power *= 4;
  return power;
}
