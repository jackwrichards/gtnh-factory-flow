import type { Recipe, ResourceAmount, ResourceKind } from "@/lib/model/types";
import { getNeiRecipeLayout, type NeiSlotFrame } from "@/lib/nei/layout";
import type { NeiDrawCommand, NeiSlotCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRenderAspectAmount, NeiRecipeRenderModel } from "../core/render-model";
import { NEI_ITEM_SLOT_SIZE } from "../theme/constants";
import { NEI_PALETTE } from "../theme/palette";
import { NEI_TEXTURES } from "../theme/textures";

export function requireSourceRecipe(recipe: NeiRecipeRenderModel): Recipe {
  if (!recipe.sourceRecipe) {
    throw new Error(`Render model "${recipe.id}" does not include its source Recipe.`);
  }
  return recipe.sourceRecipe;
}

export function gregtechLayout(recipe: NeiRecipeRenderModel) {
  return getNeiRecipeLayout(requireSourceRecipe(recipe));
}

export function basePanel(width: number, height: number): NeiDrawCommand {
  return {
    type: "rect",
    layer: "background",
    x: 0,
    y: 0,
    width,
    height,
    color: NEI_PALETTE.panel,
  };
}

export function slotCommand({
  x,
  y,
  side,
  kind,
  slotIndex,
  empty = false,
  framed = true,
}: {
  x: number;
  y: number;
  side: "input" | "output" | "catalyst" | "info";
  kind: ResourceKind | "special";
  slotIndex: number;
  empty?: boolean;
  framed?: boolean;
}): NeiSlotCommand {
  return {
    type: "slot",
    layer: "slot",
    x,
    y,
    width: NEI_ITEM_SLOT_SIZE,
    height: NEI_ITEM_SLOT_SIZE,
    kind,
    side,
    slotIndex,
    empty,
    framed,
    texturePath: framed ? slotTexturePath(kind) : undefined,
    semanticTags: [
      empty ? "empty-slot" : undefined,
      side === "input" ? "input-slot" : undefined,
      side === "output" ? "output-slot" : undefined,
      side === "catalyst" ? "catalyst-slot" : undefined,
      kind === "aspect" ? "aspect-slot" : undefined,
    ].filter((tag): tag is string => Boolean(tag)),
  };
}

export function frameToSlotCommand(frame: NeiSlotFrame, unframed: boolean): NeiSlotCommand {
  return slotCommand({
    x: frame.x,
    y: frame.y,
    side: frame.side,
    kind: frame.kind,
    slotIndex: frame.slotIndex,
    empty: !frame.resource,
    framed: !unframed,
  });
}

export function frameToPositionedStack(frame: NeiSlotFrame): NeiPositionedStack | undefined {
  if (!frame.resource) {
    return undefined;
  }

  return resourceToPositionedStack({
    resource: frame.resource,
    side: frame.side,
    x: frame.x,
    y: frame.y,
    slotIndex: frame.slotIndex,
    resourceIndex: frame.resourceIndex,
  });
}

export function resourceToPositionedStack({
  resource,
  side,
  x,
  y,
  slotIndex,
  resourceIndex,
  semanticTags,
}: {
  resource: ResourceAmount;
  side: "input" | "output" | "catalyst" | "info";
  x: number;
  y: number;
  slotIndex: number;
  resourceIndex?: number;
  semanticTags?: string[];
}): NeiPositionedStack {
  const recipeResource = resource as ResourceAmount & {
    chance?: number;
    consumed?: boolean;
  };
  return {
    resource,
    side,
    kind: resource.kind,
    x,
    y,
    width: NEI_ITEM_SLOT_SIZE,
    height: NEI_ITEM_SLOT_SIZE,
    slotIndex,
    resourceIndex,
    chance: recipeResource.chance,
    consumed: recipeResource.consumed,
    semanticTags,
  };
}

export function aspectToResource(aspect: NeiRenderAspectAmount): ResourceAmount {
  const id = aspect.aspectId.startsWith("thaumcraft:aspect:")
    ? aspect.aspectId
    : `thaumcraft:aspect:${aspect.aspectId}`;
  const iconPath = NEI_TEXTURES.resolveThaumcraftAspectIconPath(aspect.aspectId, aspect.iconPath);

  return aspect.sourceResource
    ? {
        ...aspect.sourceResource,
        displayName: aspect.sourceResource.displayName ?? aspect.name,
        iconPath: aspect.sourceResource.iconPath ?? iconPath,
        dominantColor: aspect.sourceResource.dominantColor ?? aspect.color,
        tooltip: aspect.sourceResource.tooltip ?? aspect.tooltip,
      }
    : {
        kind: "aspect",
        id,
        amount: aspect.amount,
        displayName: aspect.name,
        iconPath,
        dominantColor: aspect.color,
        tooltip: aspect.tooltip,
      };
}

export function aspectToPositionedStack({
  aspect,
  side,
  x,
  y,
  slotIndex,
  semanticTags,
}: {
  aspect: NeiRenderAspectAmount;
  side: "input" | "output" | "catalyst" | "info";
  x: number;
  y: number;
  slotIndex: number;
  semanticTags?: string[];
}): NeiPositionedStack {
  return {
    resource: aspect,
    side,
    kind: "aspect",
    x,
    y,
    width: NEI_ITEM_SLOT_SIZE,
    height: NEI_ITEM_SLOT_SIZE,
    slotIndex,
    semanticTags,
  };
}

export function progressCommandsFromLayout(recipe: NeiRecipeRenderModel): NeiDrawCommand[] {
  return gregtechLayout(recipe).progressBars.map((bar, index) => ({
    type: "progress",
    layer: "progress",
    x: bar.x,
    y: bar.y,
    width: bar.width,
    height: bar.height,
    direction: bar.direction,
    texture: bar.texture,
    frame: bar.frame,
    semanticTags: ["progress-arrow"],
    id: `progress-${index}`,
  }));
}

export function gridPositions(count: number, x: number, y: number, columns: number, gap = 0) {
  return Array.from({ length: count }, (_, index) => ({
    x: x + (index % columns) * (NEI_ITEM_SLOT_SIZE + gap),
    y: y + Math.floor(index / columns) * (NEI_ITEM_SLOT_SIZE + gap),
  }));
}

function slotTexturePath(kind: ResourceKind | "special") {
  return kind === "aspect" ? NEI_TEXTURES.aspectSlot : NEI_TEXTURES.slot(kind);
}
