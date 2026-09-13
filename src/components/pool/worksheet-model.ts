import type { FactoryNode, FactoryProject, Recipe, ThroughputResult } from "@/lib/model/types";
import {
  applyRecipeInputOverrides,
  applyMachineHandlerToRecipe,
  isRecipeInputConsumed,
} from "@/lib/model";
import { listNodeSections } from "@/lib/model/shared-machine";
import { buildMachineList } from "@/lib/model/machine-list";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { applyMachineOutputMultipliers } from "@/lib/solver/machine-effects";
import { buildRailPorts, deriveNodeVerdict } from "../flow/node-verdict";
import { getRecipeMachineConfigTierControls } from "@/lib/model/recipe-rules";
import {
  applyTreeGrowthSimulatorToolInputs,
  isTreeGrowthSimulatorToolControl,
} from "@/lib/model/recipe-tool-slots";

/** Presentation of the existing books. Never moves cards or runs another solve. */
export function buildWorksheetGroups(project: FactoryProject, result: ThroughputResult) {
  const recipes = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const machines = new Map(buildMachineList(project, result).map((entry) => [entry.nodeId, entry]));
  return project.nodes.map((owner) => ({
    owner,
    machine: machines.get(owner.id),
    sections: listNodeSections(owner).map(({ node, section }) => {
      const recipe = recipes.get(node.recipeId);
      const display = recipe ? worksheetRecipe(recipe, node) : undefined;
      const verdict = deriveNodeVerdict(project, result, node.id);
      return {
        section,
        node,
        recipe,
        display,
        verdict,
        result: result.nodes[node.id],
        ports: display
          ? buildRailPorts(project, result, node.id, display, verdict, { handleSection: section })
          : { inputs: [], outputs: [] },
        nonConsumed: display?.inputs.filter((input) => !isRecipeInputConsumed(input)) ?? [],
      };
    }),
  }));
}

function worksheetRecipe(recipe: Recipe, node: FactoryNode): Recipe {
  const contextual = applyRecipeInputOverrides(recipe, node);
  const handled = applyMachineHandlerToRecipe(contextual, node);
  const effective = applyTreeGrowthSimulatorToolInputs(
    handled,
    getRecipeMachineConfigTierControls(handled, node).filter(isTreeGrowthSimulatorToolControl),
  );
  const stats = getOverclockedRecipeStats(contextual, node);
  return { ...effective, ...applyMachineOutputMultipliers(effective, node, stats.tier), ...stats };
}

export type WorksheetGroup = ReturnType<typeof buildWorksheetGroups>[number];
export type WorksheetSection = WorksheetGroup["sections"][number];

export function filterWorksheetGroups(groups: WorksheetGroup[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  // Keep a shared machine together: filtering must never make one recipe's
  // fraction appear to be its machine's entire requirement.
  return groups.filter((group) =>
    [
      group.machine?.label,
      ...group.sections.flatMap((section) => [
        section.recipe?.name,
        section.recipe?.machineType,
        ...[...section.ports.inputs, ...section.ports.outputs].map((port) => port.displayName),
        ...section.nonConsumed.map((input) => input.displayName ?? input.id),
      ]),
    ].some((text) => text?.toLowerCase().includes(needle)),
  );
}
