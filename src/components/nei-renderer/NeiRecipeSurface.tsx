"use client";

import { useMemo, type ReactNode } from "react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import { recipeToRenderModel } from "@/lib/nei-renderer/adapters/recipe-to-render-model";
import { selectNeiRecipeHandler } from "@/lib/nei-renderer/adapters/handler-selection";
import { renderNeiRecipe } from "@/lib/nei-renderer/core/render-pipeline";
import type { NeiRenderOptions } from "@/lib/nei-renderer/core/render-options";
import type { NeiDrawCommand } from "@/lib/nei-renderer/core/commands";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";
import { NeiCommandLayer } from "./NeiCommandLayer";

export interface NeiRecipeSurfaceProps {
  recipe: Recipe;
  options?: Partial<NeiRenderOptions>;
  className?: string;
  iconPixelSize?: number;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
}

export function NeiRecipeSurface({
  recipe,
  options,
  className = "",
  iconPixelSize,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  getSlotZIndex,
  slotTooltip = true,
}: NeiRecipeSurfaceProps) {
  const result = useMemo(() => {
    const model = recipeToRenderModel(recipe);
    const handler = selectNeiRecipeHandler(model);
    return renderNeiRecipe(model, handler, options);
  }, [options, recipe]);
  const scale = result.options.scale;
  const layers = useMemo(() => groupCommandsByLayer(result.commands), [result.commands]);

  return (
    <div
      className={[
        "minecraft-pixel-art relative overflow-visible border border-transparent",
        className,
      ].join(" ")}
      data-nei-renderer-handler={result.handlerId}
      style={{
        width: result.width * scale,
        height: result.height * scale,
      }}
    >
      {layers.map(([layer, commands]) => (
        <NeiCommandLayer
          key={layer}
          layer={layer}
          commands={commands}
          scale={scale}
          iconPixelSize={iconPixelSize}
          renderHandle={renderHandle}
          getSlotConnectionAttributes={getSlotConnectionAttributes}
          onSlotClick={onSlotClick}
          suppressSlotHover={suppressSlotHover}
          suppressConsumedState={suppressConsumedState}
          getSlotZIndex={getSlotZIndex}
          slotTooltip={slotTooltip}
        />
      ))}
    </div>
  );
}

function groupCommandsByLayer(commands: NeiDrawCommand[]) {
  const groups = new Map<string, NeiDrawCommand[]>();
  for (const command of commands) {
    const group = groups.get(command.layer) ?? [];
    group.push(command);
    groups.set(command.layer, group);
  }
  return [...groups.entries()];
}

export function stackToLegacySlot(
  command: Extract<NeiDrawCommand, { type: "item" | "fluid" | "aspect" }>,
): NeiPositionedSlot | undefined {
  const side = command.stack.side;
  if (side !== "input" && side !== "output") {
    return undefined;
  }

  const resource = renderStackResourceToResourceAmount(command.stack.resource);
  return {
    side,
    kind: resource.kind,
    resource,
    resourceIndex: command.stack.resourceIndex ?? command.stack.slotIndex,
    slotIndex: command.stack.slotIndex,
    x: command.stack.x,
    y: command.stack.y,
  };
}

export function renderStackResourceToResourceAmount(
  resource: Extract<NeiDrawCommand, { type: "item" | "fluid" | "aspect" }>["stack"]["resource"],
): ResourceAmount {
  if ("kind" in resource) {
    return resource;
  }

  const iconPath = NEI_TEXTURES.resolveThaumcraftAspectIconPath(resource.aspectId, resource.iconPath);
  return resource.sourceResource
    ? {
        ...resource.sourceResource,
        displayName: resource.sourceResource.displayName ?? resource.name,
        iconPath: resource.sourceResource.iconPath ?? iconPath,
        dominantColor: resource.sourceResource.dominantColor ?? resource.color,
        tooltip: resource.sourceResource.tooltip ?? resource.tooltip,
      }
    : {
        kind: "aspect",
        id: resource.aspectId.startsWith("thaumcraft:aspect:")
          ? resource.aspectId
          : `thaumcraft:aspect:${resource.aspectId}`,
        amount: resource.amount,
        displayName: resource.name,
        iconPath,
        dominantColor: resource.color,
        tooltip: resource.tooltip,
      };
}
