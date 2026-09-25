import type { FactoryNode, MachineHandler, NodeThroughputResult, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, getRecipeMachineConfigTierControls, type MachineConfigTierControl } from "@/lib/model/recipe-rules";
import { formatCompact } from "@/lib/model";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { getNodePowerReport, getNodeSteamReport, hasPowerReport, describePowerStall } from "@/lib/solver/power-report";
import { getMachineParallelMultiplier } from "@/lib/solver/machine-effects";
import { isMultiblockRecipe } from "@/lib/solver/power";
import { getMachineBehaviour, getMachineTableControls } from "@/lib/machines/machine-table";
import type { RecipeTooltipView, TooltipMode } from "./recipe-tooltip-data";

const number = (value: number) => value > 0 && value < 0.001 ? "<0.001" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function buildMachineTooltip(recipe: Recipe, handler: MachineHandler, node: FactoryNode, mode: TooltipMode, result?: NodeThroughputResult, title?: string): RecipeTooltipView {
  const selectedNode = { ...node, machineHandlerId: handler.id };
  const effective = applyMachineHandlerToRecipe(recipe, selectedNode);
  const stats = getOverclockedRecipeStats(recipe, selectedNode);
  const steam = getNodeSteamReport(recipe, selectedNode);
  const power = !steam && hasPowerReport(effective) ? getNodePowerReport(recipe, selectedNode) : undefined;
  const parallels = power?.parallels ?? getMachineParallelMultiplier(effective, selectedNode);
  const count = mode === "build" ? node.machineCount : node.solvePin ?? result?.theoreticalMachinesRequired;
  const rows = [
    { label: mode === "build" ? "Installed machines" : node.solvePin ? "Pinned machines" : "Required machines", value: count === undefined ? "Unavailable" : number(count) },
    ...(power ? [{ label: "Configured tier", value: stats.tier }] : []),
    { label: "Time per operation", value: stats.durationTicks > 0 ? `${number(stats.durationTicks / 20)} s` : "Instant" },
    ...(steam ? [{ label: "Steam per machine", value: `${formatCompact(steam.drawSteamPerTick * 20)} L/s` }]
      : power ? [{ label: "Draw per machine", value: `${formatCompact(power.drawEuT)} EU/t` }] : []),
    ...(parallels > 1 ? [{ label: "Parallel operations", value: number(parallels) }] : []),
  ];
  return {
    title: title ?? handler.label, subtitle: isMultiblockRecipe(effective) ? "Multiblock" : "Machine", mode, rows,
    requirement: getMachineBehaviour(effective.machineType)?.note,
    reason: power && power.state !== "ok" ? describePowerStall(power) : undefined,
  };
}

/** Show effective configuration values, never tooltip-scraped effect claims. */
export function buildConfigTooltip(recipe: Recipe, node: FactoryNode, control: MachineConfigTierControl): RecipeTooltipView {
  const effective = applyMachineHandlerToRecipe(recipe, node);
  const stats = getOverclockedRecipeStats(recipe, node);
  const steam = getNodeSteamReport(recipe, node);
  const power = !steam && hasPowerReport(effective) ? getNodePowerReport(recipe, node) : undefined;
  const selected = getRecipeMachineConfigTierControls(effective, node).find(c => c.id === control.id) ?? control;
  // Only curated control notes: arbitrary scraped tooltips can claim effects
  // the machine never receives. These explain source/glass requirements too.
  const curatedControl = getMachineTableControls(effective.machineType).find(c => c.id === control.id);
  // A typed number never matches a listed rung; its one rung carries the help.
  const curatedOption = curatedControl?.tiers.find(t => t.key === selected.current.key)
    ?? (control.numeric ? curatedControl?.tiers[0] : undefined);
  return {
    title: control.label, subtitle: selected.current.label,
    bullets: curatedOption?.resource.tooltip,
    rows: [
      ...(control.numeric ? [{ label: "Range", value: control.numeric.max === undefined
        ? `${control.numeric.min} or more` : `${control.numeric.min} to ${control.numeric.max}` }] : []),
      { label: "Time per operation", value: stats.durationTicks > 0 ? `${number(stats.durationTicks / 20)} s` : "Instant" },
      ...(steam ? [{ label: "Steam per machine", value: `${formatCompact(steam.drawSteamPerTick * 20)} L/s` }]
        : power ? [{ label: "Draw per machine", value: `${formatCompact(power.drawEuT)} EU/t` }] : []),
      { label: "Parallel operations", value: number(power?.parallels ?? getMachineParallelMultiplier(effective, node)) },
    ],
    reason: power && power.state !== "ok" ? describePowerStall(power) : undefined,
    actions: control.numeric ? [{ gesture: "left", label: "Type a value" }, { gesture: "wheel", label: "Step" }]
      : control.tiers.length > 1 ? [{ gesture: "left", label: "Change setting" }] : [],
  };
}
