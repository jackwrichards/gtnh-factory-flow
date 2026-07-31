"use client";

import type { ReactNode } from "react";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import type { NeiDrawCommand } from "@/lib/nei-renderer/core/commands";
import { NEI_LAYER_Z_INDEX } from "@/lib/nei-renderer/theme/constants";
import { NeiAspectView } from "./NeiAspectView";
import { NeiDebugOverlay } from "./NeiDebugOverlay";
import { NeiFluidView } from "./NeiFluidView";
import { NeiItemView } from "./NeiItemView";
import { NeiProgressView } from "./NeiProgressView";
import { NeiRectView } from "./NeiRectView";
import { NeiSlotView } from "./NeiSlotView";
import { NeiTextView } from "./NeiTextView";
import { NeiTextureView } from "./NeiTextureView";

interface NeiCommandLayerProps {
  layer: string;
  commands: NeiDrawCommand[];
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

export function NeiCommandLayer({
  layer,
  commands,
  scale,
  iconPixelSize,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  getSlotZIndex,
  slotTooltip,
}: NeiCommandLayerProps) {
  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: NEI_LAYER_Z_INDEX[layer as keyof typeof NEI_LAYER_Z_INDEX] ?? 1,
        pointerEvents: "none",
      }}
    >
      {commands.map((command, index) => {
        const key = command.id ?? `${command.type}-${command.x}-${command.y}-${index}`;
        switch (command.type) {
          case "slot":
            return <NeiSlotView key={key} command={command} scale={scale} />;
          case "item":
            return (
              <NeiItemView
                key={key}
                command={command}
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
            );
          case "fluid":
            return (
              <NeiFluidView
                key={key}
                command={command}
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
            );
          case "aspect":
            return (
              <NeiAspectView
                key={key}
                command={command}
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
            );
          case "text":
            return <NeiTextView key={key} command={command} scale={scale} />;
          case "texture":
            return <NeiTextureView key={key} command={command} scale={scale} />;
          case "progress":
            return <NeiProgressView key={key} command={command} scale={scale} />;
          case "rect":
            return command.layer === "debug" || command.semanticTags?.includes("debug-bound") ? (
              <NeiDebugOverlay key={key} command={command} scale={scale} />
            ) : (
              <NeiRectView key={key} command={command} scale={scale} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
