"use client";

import type { ReactNode } from "react";
import type { ResourceAmount } from "@/lib/model/types";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import type { NeiAspectCommand } from "@/lib/nei-renderer/core/commands";
import type { NeiRenderAspectAmount } from "@/lib/nei-renderer/core/render-model";
import { resolveThaumcraftAspectColor } from "@/lib/nei-renderer/theme/palette";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { renderStackResourceToResourceAmount, stackToLegacySlot } from "./NeiRecipeSurface";

interface AspectViewProps {
  command: NeiAspectCommand;
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

export function NeiAspectView({
  command,
  scale,
  iconPixelSize,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  getSlotZIndex,
  slotTooltip = true,
}: AspectViewProps) {
  const slot = stackToLegacySlot(command);
  const aspect = aspectDisplayFromCommand(command);
  const shouldSuppressSlotHover = slot ? suppressSlotHover?.(slot) : false;
  const iconSize = iconPixelSize ?? Math.max(12, Math.round(command.width * scale));
  const button = (
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
      data-nei-command="aspect"
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
      <span className="relative flex h-full w-full items-center justify-center">
        <AspectGlyph
          iconPath={aspect.iconPath}
          color={aspect.color}
          name={aspect.name}
          size={iconSize}
        />
        <AspectAmountLabel amount={aspect.amount} />
      </span>
    </button>
  );

  return slotTooltip ? (
    <MinecraftTooltip label={aspect.tooltip}>{button}</MinecraftTooltip>
  ) : (
    button
  );
}

function AspectGlyph({
  iconPath,
  color,
  name,
  size,
}: {
  iconPath: string;
  color?: string;
  name: string;
  size: number;
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className="minecraft-pixel-art relative block max-w-none"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 bg-black opacity-45"
        style={{
          WebkitMaskImage: `url('${iconPath}')`,
          maskImage: `url('${iconPath}')`,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          transform: "translate(1px, 1px)",
        }}
      />
      <span
        className="absolute inset-0"
        style={{
          backgroundColor: color ?? "#ffffff",
          WebkitMaskImage: `url('${iconPath}')`,
          maskImage: `url('${iconPath}')`,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
        }}
      />
    </span>
  );
}

function AspectAmountLabel({ amount }: { amount: number }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const label = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
  return (
    <span
      className="absolute bottom-0 right-0.5 max-w-[95%] whitespace-nowrap font-mono font-black text-white drop-shadow-[1px_1px_0_#000]"
      style={{
        fontSize: label.length <= 2 ? 10 : label.length <= 4 ? 8 : 6,
        lineHeight: label.length <= 2 ? "10px" : label.length <= 4 ? "8px" : "6px",
      }}
    >
      {label}
    </span>
  );
}

function aspectDisplayFromCommand(command: NeiAspectCommand) {
  const resource = command.stack.resource;
  if (isRenderAspectAmount(resource)) {
    const iconPath = NEI_TEXTURES.resolveThaumcraftAspectIconPath(
      resource.aspectId,
      resource.iconPath ?? resource.sourceResource?.iconPath,
    );
    return {
      aspectId: resource.aspectId,
      name: resource.name,
      amount: resource.amount,
      iconPath,
      color: resolveThaumcraftAspectColor(
        resource.aspectId,
        resource.color ?? resource.sourceResource?.dominantColor,
      ),
      tooltip: tooltipLines(resource.name, resource.amount, resource.tooltip ?? resource.sourceResource?.tooltip),
    };
  }

  const aspectResource = renderStackResourceToResourceAmount(resource);
  const aspectId = aspectResource.id;
  const iconPath = NEI_TEXTURES.resolveThaumcraftAspectIconPath(aspectId, aspectResource.iconPath);
  const name = aspectResource.displayName ?? titleCase(NEI_TEXTURES.normalizeThaumcraftAspectId(aspectId));
  return {
    aspectId,
    name,
    amount: aspectResource.amount,
    iconPath,
    color: resolveThaumcraftAspectColor(aspectId, aspectResource.dominantColor),
    tooltip: tooltipLines(name, aspectResource.amount, aspectResource.tooltip),
  };
}

function isRenderAspectAmount(
  resource: ResourceAmount | NeiRenderAspectAmount,
): resource is NeiRenderAspectAmount {
  return "aspectId" in resource;
}

function tooltipLines(name: string, amount: number, tooltip?: string[]) {
  const lines = [name, `Amount: ${amount}`, ...(tooltip ?? [])];
  return [...new Set(lines.filter(Boolean))];
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
