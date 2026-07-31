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

function inferRecipeKind(recipe: Recipe): NeiRecipeKind {
  if (recipe.kind) {
    return recipe.kind;
  }

  const labels = [recipe.machineType, recipe.source?.recipeMap, recipe.name]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLabel);

  if (labels.some((label) => label.includes("bee") || label.includes("apiary"))) {
    return "bee_produce";
  }

  if (labels.some((label) => label.includes("crop"))) {
    return "crop_produce";
  }

  if (labels.some((label) => label.includes("essentia") || label.includes("alchemy furnace"))) {
    return "essentia_smelting";
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
