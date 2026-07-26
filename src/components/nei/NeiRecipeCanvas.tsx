"use client";

import { useMemo, type ReactNode } from "react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import type { NeiPositionedSlot, NeiRecipeLayout } from "@/lib/nei/layout";
import { NeiRecipeSurface } from "@/components/nei-renderer/NeiRecipeSurface";
import type { NeiRenderPreset } from "@/lib/nei-renderer/core/render-options";

interface NeiRecipeCanvasProps {
  recipe: Recipe;
  scale?: number;
  slotPixelSize?: number;
  iconPixelSize?: number;
  className?: string;
  hideCollapseControls?: boolean;
  layout?: NeiRecipeLayout;
  contextResource?: Pick<ResourceAmount, "kind" | "id">;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
}

export function NeiRecipeCanvas(props: NeiRecipeCanvasProps) {
  const renderScale = props.slotPixelSize
    ? props.slotPixelSize / (props.layout?.slotSize ?? 18)
    : (props.scale ?? 2);
  const preset: NeiRenderPreset = props.hideCollapseControls ? "compact" : "native";
  // NeiRecipeSurface memoises the whole render pipeline on this object. Passing a
  // fresh literal made that memo a permanent miss, so every recipe re-ran layout
  // resolution and command generation on every parent render.
  const options = useMemo(() => ({ preset, scale: renderScale }), [preset, renderScale]);

  return (
    <NeiRecipeSurface
      recipe={props.recipe}
      options={options}
      iconPixelSize={props.iconPixelSize ?? 16 * renderScale}
      className={props.className}
      renderHandle={props.renderHandle}
      getSlotConnectionAttributes={props.getSlotConnectionAttributes}
      onSlotClick={props.onSlotClick}
      suppressSlotHover={props.suppressSlotHover}
      suppressConsumedState={props.suppressConsumedState}
      getSlotZIndex={props.getSlotZIndex}
      slotTooltip={props.slotTooltip}
    />
  );
}
