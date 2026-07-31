"use client";

import type { ReactNode } from "react";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import type { NeiItemCommand } from "@/lib/nei-renderer/core/commands";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { renderStackResourceToResourceAmount, stackToLegacySlot } from "./NeiRecipeSurface";

interface StackViewProps {
  command: NeiItemCommand;
  scale: number;
  iconPixelSize?: number;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
}

export function NeiItemView(props: StackViewProps) {
  return <StackIconButton {...props} />;
}

export function StackIconButton({
  command,
  scale,
  iconPixelSize,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  getSlotZIndex,
  slotTooltip = true,
}: StackViewProps) {
  const slot = stackToLegacySlot(command);
  const resource = {
    ...renderStackResourceToResourceAmount(command.stack.resource),
    chance: command.stack.chance,
    consumed: command.stack.consumed,
  };
  const shouldSuppressSlotHover = slot ? suppressSlotHover?.(slot) : false;
  const shouldSuppressConsumedState = slot ? suppressConsumedState?.(slot) : false;

  return (
    <button
      type="button"
      tabIndex={slot ? 0 : -1}
      {...(slot ? getSlotConnectionAttributes?.(slot) : undefined)}
      onClick={(event) => {
        if (!slot || !onSlotClick) return;
        event.stopPropagation();
        onSlotClick(slot, "recipes");
      }}
      onContextMenu={(event) => {
        if (!slot || !onSlotClick) return;
        event.preventDefault();
        event.stopPropagation();
        onSlotClick(slot, "uses");
      }}
      className={[
        "nodrag absolute border-0 bg-transparent p-0 text-left",
        slot && onSlotClick && !shouldSuppressSlotHover
          ? "cursor-pointer hover:ring-2 hover:ring-cyan-300"
          : "",
      ].join(" ")}
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        pointerEvents: "auto",
        zIndex: slot ? getSlotZIndex?.(slot) : undefined,
      }}
    >
      {slot ? renderHandle?.(slot) : null}
      <ResourceIcon
        resource={resource}
        size="md"
        showAmount
        showName={false}
        className="!h-full !w-full"
        iconPixelSize={iconPixelSize ?? command.width * scale}
        tooltip={slotTooltip}
        showConsumedState={!shouldSuppressConsumedState}
        bare
      />
    </button>
  );
}
