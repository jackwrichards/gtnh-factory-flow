import type { Recipe, ResourceAmount } from "@/lib/model/types";
import type {
  NeiRecipeKind,
  NeiRecipeRenderModel,
  NeiRenderAspectAmount,
  NeiRenderResourceAmount,
} from "../core/render-model";
import {
  normalizeThaumcraftAspectId,
  resolveThaumcraftAspectIconPath,
} from "../theme/textures";

export function recipeToRenderModel(recipe: Recipe): NeiRecipeRenderModel {
  const recipeMapName = recipe.source?.recipeMap ?? recipe.machineType;
  const kind = inferRecipeKind(recipe);
  const inputs = recipe.inputs.filter((resource) => resource.kind === "item");
  const outputs = recipe.outputs.filter((resource) => resource.kind === "item");
  const fluidInputs = recipe.inputs.filter((resource) => resource.kind === "fluid");
  const fluidOutputs = recipe.outputs.filter((resource) => resource.kind === "fluid");
  const aspectInputs = recipe.inputs
    .filter((resource) => resource.kind === "aspect")
    .map(resourceToAspectAmount);
  const aspectOutputs = recipe.outputs
    .filter((resource) => resource.kind === "aspect")
    .map(resourceToAspectAmount);

  return {
    id: recipe.id,
    kind,
    recipeMapId: recipe.source?.rawRecipeId?.split(":")[0],
    recipeMapName,
    title: recipe.nei?.source ? recipe.nei.source : recipeMapName,
    inputs,
    outputs,
    catalysts: recipe.inputs.filter((resource) => resource.consumed === false),
    fluidInputs,
    fluidOutputs,
    aspectInputs,
    aspectOutputs,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    specialValue: recipe.specialValue,
    programmedCircuit: findProgrammedCircuitResource(recipe),
    metadata: {
      // The recipe's own metadata rides along first: handlers read
      // dataset-supplied facts from it (a bee's condition, a vein's planets),
      // and building this record fresh used to silently drop them all.
      ...recipe.metadata,
      machineType: recipe.machineType,
      minimumTier: recipe.minimumTier,
      source: recipe.source,
      nei: recipe.nei,
      notes: recipe.notes,
      recipeKind: recipe.kind,
    },
    sourceRecipe: recipe,
  };
}

/**
 * The machines whose recipes are drawn by a handler of their own, by name.
 *
 * Only a machine's own name counts, never the recipe's, because a recipe is
 * named after what it makes and the machine that makes it is what decides the
 * layout. A Centrifuge recipe for Beeswax is still a Centrifuge recipe.
 *
 * Matching is exact for the same reason. Searching for the word "crop" would
 * still claim the Crop Breeder, and searching for "bee" would claim a Beech
 * Wood Plank, both of which are ordinary GregTech machines.
 */
const HANDLER_KIND_BY_MACHINE: ReadonlyMap<string, NeiRecipeKind> = new Map([
  ["bee produce", "bee_produce"],
  ["crop farm", "crop_produce"],
  ["ic2 crop", "crop_produce"],
  ["thaumcraft essentia smelting", "essentia_smelting"],
]);

function inferRecipeKind(recipe: Recipe): NeiRecipeKind {
  // Every recipe in the dataset carries its kind. This is the last resort for
  // one that somehow arrives without it.
  if (recipe.kind) {
    return recipe.kind;
  }

  for (const label of [recipe.machineType, recipe.source?.recipeMap]) {
    const kind = label ? HANDLER_KIND_BY_MACHINE.get(normalizeLabel(label)) : undefined;
    if (kind) {
      return kind;
    }
  }

  return "gregtech_machine";
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resourceToAspectAmount(resource: ResourceAmount): NeiRenderAspectAmount {
  const aspectId = normalizeThaumcraftAspectId(resource.id);
  return {
    aspectId,
    name: resource.displayName ?? titleCase(aspectId.split(":").at(-1) ?? aspectId),
    amount: resource.amount,
    iconPath: resolveThaumcraftAspectIconPath(aspectId, resource.iconPath),
    color: resource.dominantColor,
    tooltip: resource.tooltip,
    sourceResource: resource,
  };
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function findProgrammedCircuitResource(recipe: Recipe): NeiRenderResourceAmount | null {
  if (!recipe.programmedCircuit) {
    return null;
  }

  return (
    recipe.inputs.find(
      (input) =>
        input.kind === "item" &&
        (input.id.includes("circuit") ||
          input.displayName?.toLowerCase().includes("programmed circuit")),
    ) ?? null
  );
}
