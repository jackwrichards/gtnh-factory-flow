"use client";

import { memo, useMemo, type ReactNode } from "react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { formatRate, getRecipePowerTier } from "@/lib/model";
import { getNeiRecipeLayout, type NeiPositionedSlot } from "@/lib/nei/layout";
import { NeiRecipeCanvas } from "./NeiRecipeCanvas";

const QUICK_SLOT_PIXEL_SIZE = 40;
const QUICK_SLOT_ICON_PIXEL_SIZE = 64;

interface NeiRecipeWindowProps {
  recipe: Recipe;
  scale?: number;
  compactSlotPixelSize?: number;
  className?: string;
  canvasClassName?: string;
  compact?: boolean;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
  hideCollapseControls?: boolean;
  contextResource?: Pick<ResourceAmount, "kind" | "id">;
  statsAction?: ReactNode;
}

export const NeiRecipeWindow = memo(function NeiRecipeWindow({
  recipe,
  scale = 2,
  compactSlotPixelSize = QUICK_SLOT_PIXEL_SIZE,
  className = "",
  canvasClassName = "",
  compact = false,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  getSlotZIndex,
  slotTooltip = true,
  hideCollapseControls = false,
  contextResource,
  statsAction,
}: NeiRecipeWindowProps) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  const layout = useMemo(() => getNeiRecipeLayout(recipe), [recipe]);
  const usesNativeChrome = layout.chrome === "native";
  const totalEu = recipe.eut * recipe.durationTicks;
  const seconds = recipe.durationTicks / 20;
  const powerTier = useMemo(() => getRecipePowerTier(recipe), [recipe]);
  const preserveNativeSlots = compact || hideCollapseControls;

  if (usesNativeChrome) {
    return (
      <div
        className={[
          "relative inline-block bg-[var(--mc-78)] font-mono text-[var(--mc-ink)]",
          compact ? "text-[10px]" : "text-[14px]",
          className,
        ].join(" ")}
      >
        <div className="relative">
          <NeiRecipeCanvas
            recipe={recipe}
            layout={layout}
            scale={scale}
            iconPixelSize={16 * scale}
            className={canvasClassName}
            renderHandle={renderHandle}
            getSlotConnectionAttributes={getSlotConnectionAttributes}
            onSlotClick={onSlotClick}
            suppressSlotHover={suppressSlotHover}
            suppressConsumedState={suppressConsumedState}
            getSlotZIndex={getSlotZIndex}
            slotTooltip={slotTooltip}
            hideCollapseControls={preserveNativeSlots}
            contextResource={contextResource}
          />
        </div>
      </div>
    );
  }

  const stats = (
    <div className="relative mt-1 text-[var(--mc-ink)]">
      <div
        className={["min-w-0 pr-11 leading-tight", compact ? "text-[10px]" : "text-[16px]"].join(
          " ",
        )}
      >
        <div>Total: {formatRate(totalEu, 0)} EU</div>
        <div>
          Usage: {formatRate(recipe.eut, 0)} EU/t ({powerTier})
        </div>
        <div>Time: {formatRate(seconds, seconds >= 10 ? 0 : 1)} seconds</div>
      </div>
      {statsAction ? <div className="absolute right-0 top-0">{statsAction}</div> : null}
    </div>
  );

  if (compact) {
    // On the flow board the node shell already provides the outer frame and
    // the canvas draws its own panel rim, so the window adds no chrome of its
    // own - the old bevel-in-frame-in-shell nesting read as stacked picture
    // frames.
    return (
      <div
        className={["relative inline-block font-mono text-[10px] text-[var(--mc-ink)]", className]
          .join(" ")
          .trim()}
      >
        <NeiRecipeCanvas
          recipe={recipe}
          layout={layout}
          scale={scale}
          slotPixelSize={compactSlotPixelSize}
          iconPixelSize={QUICK_SLOT_ICON_PIXEL_SIZE}
          className={canvasClassName}
          renderHandle={renderHandle}
          getSlotConnectionAttributes={getSlotConnectionAttributes}
          onSlotClick={onSlotClick}
          suppressSlotHover={suppressSlotHover}
          suppressConsumedState={suppressConsumedState}
          getSlotZIndex={getSlotZIndex}
          slotTooltip={slotTooltip}
          hideCollapseControls={preserveNativeSlots}
          contextResource={contextResource}
        />
        <div className="recipe-node-window-stats">{stats}</div>
      </div>
    );
  }

  return (
    <div
      className={[
        "relative inline-block bg-[var(--mc-78)] p-1 font-mono text-[14px] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]",
        className,
      ].join(" ")}
    >
      <div className="border-2 border-[var(--mc-98)] bg-[var(--mc-78)] shadow-[inset_-2px_-2px_0_var(--mc-44)]">
        <NeiTitleBar label={recipeMap} compact={false} />
        <NeiPageBar compact={false} />
        <div className="p-2">
          <NeiRecipeCanvas
            recipe={recipe}
            layout={layout}
            scale={scale}
            className={canvasClassName}
            renderHandle={renderHandle}
            getSlotConnectionAttributes={getSlotConnectionAttributes}
            onSlotClick={onSlotClick}
            suppressSlotHover={suppressSlotHover}
            suppressConsumedState={suppressConsumedState}
            getSlotZIndex={getSlotZIndex}
            slotTooltip={slotTooltip}
            hideCollapseControls={preserveNativeSlots}
            contextResource={contextResource}
          />
        </div>
      </div>

      {stats}
    </div>
  );
});

function NeiTitleBar({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div
      className={[
        "grid grid-cols-[22px_minmax(0,1fr)_22px] items-center bg-[var(--mc-56)] text-center text-white [text-shadow:2px_2px_0_var(--mc-24)]",
        compact ? "h-6 text-[12px]" : "h-8 text-[18px]",
      ].join(" ")}
    >
      <NeiArrowButton label="<" />
      <div className="truncate border-y-2 border-[var(--mc-33)] bg-[var(--mc-62)] px-2 leading-[1.3] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]">
        {label}
      </div>
      <NeiArrowButton label=">" />
    </div>
  );
}

function NeiPageBar({ compact, label = "Page 1/1" }: { compact: boolean; label?: string }) {
  return (
    <div
      className={[
        "grid grid-cols-[22px_minmax(0,1fr)_22px] items-center bg-[var(--mc-56)] text-center text-white [text-shadow:2px_2px_0_var(--mc-24)]",
        compact ? "h-6 text-[12px]" : "h-8 text-[18px]",
      ].join(" ")}
    >
      <NeiArrowButton label="<" />
      <div className="truncate border-b-2 border-[var(--mc-33)] bg-[var(--mc-66)] px-2 leading-[1.3] shadow-[inset_2px_0_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]">
        {label}
      </div>
      <NeiArrowButton label=">" />
    </div>
  );
}

function NeiArrowButton({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-56)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] [text-shadow:1px_1px_0_#000]">
      {label}
    </div>
  );
}
