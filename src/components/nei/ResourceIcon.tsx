"use client";

import { memo, type CSSProperties } from "react";
import type { ResourceAmount, ResourceIconAtlasRef, ResourceKind } from "@/lib/model/types";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";
import {
  formatNumberWithThousands,
  resourceLabel,
  stripOreDictionaryPrefix,
  trimTrailingDecimalZeros,
} from "@/lib/model/resources";
import { MinecraftTooltip } from "./MinecraftTooltip";

type DisplayResourceAmount = Pick<
  ResourceAmount,
  | "kind"
  | "id"
  | "amount"
  | "displayName"
  | "iconPath"
  | "iconAtlas"
  | "dominantColor"
  | "tooltip"
  | "alternatives"
> & {
  consumed?: boolean;
  chance?: number;
};

interface ResourceIconProps {
  resource?: DisplayResourceAmount;
  size?: "sm" | "md" | "lg" | "xl";
  showAmount?: boolean;
  showName?: boolean;
  bare?: boolean;
  className?: string;
  tooltip?: boolean;
  iconPixelSize?: number;
  showConsumedState?: boolean;
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

function ResourceIconComponent({
  resource,
  size = "md",
  showAmount = true,
  showName = false,
  bare = false,
  className = "",
  tooltip = true,
  iconPixelSize,
  showConsumedState = true,
}: ResourceIconProps) {
  const icon = (
    <div
      className={[
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        bare
          ? ""
          : "border border-[#373737] bg-[#8d8d8d] shadow-[inset_2px_2px_0_#cfcfcf,inset_-2px_-2px_0_#4d4d4d]",
        sizeClasses[size],
        resource || bare
          ? ""
          : "bg-[#3a3a3a] opacity-100 shadow-[inset_1px_1px_0_#5d5d5d,inset_-1px_-1px_0_#1f1f1f]",
        className,
      ].join(" ")}
    >
      <IconImage resource={resource} iconPixelSize={iconPixelSize} />

      {resource && showAmount ? <AmountLabel resource={resource} /> : null}
      {resource?.chance !== undefined ? <ChanceLabel chance={resource.chance} /> : null}

      {showConsumedState && resource?.consumed === false ? (
        <span
          title="Not consumed"
          className="absolute left-0 top-0 font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]"
        >
          NC
        </span>
      ) : null}

      {resource && shouldShowAlternativeMarker(resource) ? (
        <span className="absolute left-0 bottom-0 font-mono text-[9px] font-black leading-none text-[#55ffff] drop-shadow-[1px_1px_0_#000]">
          +
        </span>
      ) : null}

      {resource && showName ? (
        <span className="absolute left-0.5 top-0.5 max-w-[calc(100%-4px)] truncate font-mono text-[8px] leading-none text-white drop-shadow-[1px_1px_0_#000]">
          {resourceLabel(resource)}
        </span>
      ) : null}
    </div>
  );

  if (!tooltip) {
    return icon;
  }

  // Built only on the tooltip path. It used to run for every icon regardless,
  // including the hundreds rendered with `tooltip={false}`, which threw away a
  // multi-pass string build per icon per render.
  return <MinecraftTooltip label={buildTooltipLabel(resource)}>{icon}</MinecraftTooltip>;
}

/**
 * Memoised because the canvas and recipe book mount these by the hundred, and a
 * single parent re-render otherwise re-runs every icon's label regexes, class
 * joins and inline style objects.
 */
export const ResourceIcon = memo(ResourceIconComponent);

function shouldShowAlternativeMarker(resource: DisplayResourceAmount): boolean {
  return Boolean(
    resource.alternatives?.some((alternative) => !isFluidCellAlternative(resource, alternative)),
  );
}

function isFluidCellAlternative(
  resource: DisplayResourceAmount,
  alternative: NonNullable<DisplayResourceAmount["alternatives"]>[number],
): boolean {
  return (
    (resource.kind === "item" && alternative.kind === "fluid") ||
    (resource.kind === "fluid" && alternative.kind === "item")
  );
}

function buildTooltipLabel(resource: ResourceIconProps["resource"]) {
  if (!resource) {
    return undefined;
  }

  if (isBeeSpeciesResource(resource)) {
    return resourceLabel(resource);
  }

  const baseLines = resource.tooltip?.length
    ? [
        resourceLabel(resource),
        ...resource.tooltip.filter(
          (line) => stripOreDictionaryPrefix(line) && !isNbtTooltipLine(line),
        ),
      ]
    : [resourceLabel(resource)].filter(Boolean);
  const chanceLine =
    resource.chance !== undefined && Number.isFinite(resource.chance) && resource.chance < 1
      ? `Chance: ${trimAmount(resource.chance * 100)}%`
      : undefined;
  const consumedLine =
    resource.consumed === false && !resource.tooltip?.some(isNotConsumedTooltipLine)
      ? "Not consumed"
      : undefined;
  const visibleAlternatives =
    resource.alternatives?.filter(
      (alternative) => !isFluidCellAlternative(resource, alternative),
    ) ?? [];
  const alternativesLine = visibleAlternatives.length
    ? `Accepts: ${visibleAlternatives
        .slice(0, 12)
        .map((alternative) => resourceLabel(alternative))
        .join(
          ", ",
        )}${visibleAlternatives.length > 12 ? `, +${visibleAlternatives.length - 12} more` : ""}`
    : undefined;

  return [...baseLines, alternativesLine, chanceLine, consumedLine].filter(Boolean).join("\n");
}

function isBeeSpeciesResource(resource: Pick<ResourceAmount, "id">) {
  return resource.id.startsWith("factoryflow:bee_species:");
}

function isNotConsumedTooltipLine(line: string) {
  const normalized = line.toLowerCase();
  return normalized.includes("not consumed") || normalized.includes("does not get consumed");
}

function isNbtTooltipLine(line: string) {
  return line.trim().toLowerCase().startsWith("nbt:");
}

function ChanceLabel({ chance }: { chance: number }) {
  if (!Number.isFinite(chance) || chance >= 1) {
    return null;
  }

  const label = `${trimAmount(chance * 100)}%`;
  return (
    <span className="absolute left-0 top-0 max-w-[95%] truncate font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]">
      {label}
    </span>
  );
}

function IconImage({
  resource,
  iconPixelSize,
}: {
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
  iconPixelSize?: number;
}) {
  if (!resource) {
    return null;
  }

  const atlas = resource.iconAtlas;
  if (atlas) {
    return <AtlasIconImage resource={resource} atlas={atlas} iconPixelSize={iconPixelSize} />;
  }

  const iconPath = resource.iconPath ?? getFallbackIconPath(resource);
  if (!iconPath) {
    // The dataset ships no art for fluids at all — not one of the thousands of
    // fluid references carries an iconPath or an atlas entry — so without this
    // every fluid rendered as an empty slot.
    if (resource.kind === "fluid") {
      return <FluidIconImage resource={resource} iconPixelSize={iconPixelSize} />;
    }

    return null;
  }

  if (resource.kind === "aspect") {
    return (
      <AspectIconImage resource={resource} iconPath={iconPath} iconPixelSize={iconPixelSize} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconPath}
      alt={resourceLabel(resource)}
      draggable={false}
      className={
        iconPixelSize
          ? "minecraft-pixel-art max-w-none object-contain"
          : "minecraft-pixel-art h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none object-contain"
      }
      style={{
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
      }}
    />
  );
}

function AspectIconImage({
  resource,
  iconPath,
  iconPixelSize,
}: {
  resource: Pick<ResourceAmount, "id" | "displayName" | "dominantColor">;
  iconPath: string;
  iconPixelSize?: number;
}) {
  const color = resource.dominantColor ?? getFallbackAspectColor(resource.id);
  const sizeStyle = iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined;

  return (
    <span
      role="img"
      aria-label={resourceLabel(resource)}
      className={
        iconPixelSize
          ? "minecraft-pixel-art relative block max-w-none"
          : "minecraft-pixel-art relative block h-[72%] w-[72%] max-w-none"
      }
      style={sizeStyle}
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
          backgroundColor: color,
          WebkitMaskImage: `url('${iconPath}')`,
          maskImage: `url('${iconPath}')`,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
        }}
      />
    </span>
  );
}

/**
 * Fraction of the cell the fluid swatch occupies.
 *
 * Item sprites carry their own transparent margin, so a full-bleed colour block
 * would read as much heavier than the items beside it. Insetting the swatch puts
 * it on the same visual footing.
 */
const FLUID_ICON_SCALE = 0.56;

/**
 * Stand-in art for a fluid: a filled cell in the fluid's own colour, bevelled
 * like a Minecraft tank so it reads as liquid rather than as a colour swatch.
 */
function FluidIconImage({
  resource,
  iconPixelSize,
}: {
  resource: Pick<ResourceAmount, "id" | "displayName" | "dominantColor">;
  iconPixelSize?: number;
}) {
  const color = resource.dominantColor ?? getFallbackFluidColor(resource.id);

  return (
    <span
      role="img"
      aria-label={resourceLabel(resource)}
      className="minecraft-pixel-art relative block overflow-hidden"
      style={
        iconPixelSize
          ? { width: iconPixelSize * FLUID_ICON_SCALE, height: iconPixelSize * FLUID_ICON_SCALE }
          : { width: `${FLUID_ICON_SCALE * 100}%`, height: `${FLUID_ICON_SCALE * 100}%` }
      }
    >
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
      {/* Surface highlight and floor shadow, so the cell has depth at any size. */}
      <span
        className="absolute inset-x-0 top-0 h-1/4"
        style={{ backgroundColor: "rgba(255,255,255,0.28)" }}
      />
      <span
        className="absolute inset-x-0 bottom-0 h-1/5"
        style={{ backgroundColor: "rgba(0,0,0,0.28)" }}
      />
    </span>
  );
}

/**
 * Deterministic colour for a fluid with no dataset art.
 *
 * Well-known fluids are named so they look right; everything else is hashed from
 * its id, which keeps a given fluid the same colour everywhere in the app and
 * across reloads.
 */
function getFallbackFluidColor(id: string): string {
  const normalized = id.toLowerCase();
  for (const [needle, color] of FLUID_COLOR_HINTS) {
    if (normalized.includes(needle)) {
      return color;
    }
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }

  // Mid lightness and moderate saturation keep white amount labels legible.
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

const FLUID_COLOR_HINTS: Array<[string, string]> = [
  ["distilledwater", "#5fb7e8"],
  ["water", "#3f76e4"],
  ["lava", "#ef7c17"],
  ["steam", "#d8d8d8"],
  ["oxygen", "#7fd8ff"],
  ["hydrogen", "#c85a5a"],
  ["nitrogen", "#4f6fb5"],
  ["oil", "#20201c"],
  ["fuel", "#c8a02c"],
  ["lubricant", "#c8b45a"],
  ["molten", "#e08a2c"],
  ["plasma", "#f0d0ff"],
  ["acid", "#9fd12c"],
  ["milk", "#f0f0f0"],
  ["honey", "#e0a83c"],
  ["glue", "#c8b48c"],
  ["concrete", "#8c8c8c"],
];

function getFallbackAspectColor(id: string): string {
  const tag = id.startsWith("thaumcraft:aspect:")
    ? id.slice("thaumcraft:aspect:".length).toLowerCase()
    : id.toLowerCase();
  return ASPECT_COLORS[tag] ?? "#ffffff";
}

const ASPECT_COLORS: Record<string, string> = {
  aer: "#ffff7e",
  alienis: "#805080",
  aqua: "#3cd4fc",
  arbor: "#00c800",
  auram: "#ffc0ff",
  bestia: "#9f6409",
  cognitio: "#f9967f",
  corpus: "#ffcc7f",
  exanimis: "#3a4000",
  fabrico: "#809d80",
  fames: "#9f0000",
  gelum: "#e1ffff",
  herba: "#01ac00",
  humanus: "#ffd7c0",
  ignis: "#ff5a01",
  instrumentum: "#4040ee",
  iter: "#e0585b",
  limus: "#01ac75",
  lucrum: "#e5dd5a",
  lux: "#fff981",
  machina: "#8080a0",
  messis: "#e1c16e",
  metallum: "#b5b5cd",
  meto: "#eead82",
  mortuus: "#6a0005",
  motus: "#cdccf4",
  ordo: "#d5d4ec",
  pannus: "#eaeac0",
  perditio: "#404040",
  perfodio: "#dcd2d2",
  permutatio: "#578357",
  potentia: "#c0ffff",
  praecantatio: "#cf00ff",
  sano: "#ff8080",
  sensus: "#c0ffc0",
  spiritus: "#ebebfb",
  telum: "#c05050",
  tempestas: "#ffffff",
  tenebrae: "#222222",
  terra: "#56c000",
  tutamen: "#00c0c0",
  vacuos: "#888888",
  venenum: "#88c800",
  victus: "#de0005",
  vinculum: "#9a8080",
  vitium: "#800080",
  vitreus: "#80ffff",
  volatus: "#e7e7d7",
};

function getFallbackIconPath(resource: Pick<ResourceAmount, "kind" | "id">): string | undefined {
  if (resource.kind !== "aspect") {
    return undefined;
  }

  return NEI_TEXTURES.resolveThaumcraftAspectIconPath(resource.id);
}

function AtlasIconImage({
  resource,
  atlas,
  iconPixelSize,
}: {
  resource: Pick<ResourceAmount, "id" | "displayName">;
  atlas: ResourceIconAtlasRef;
  iconPixelSize?: number;
}) {
  const positionX = getAtlasBackgroundPosition(atlas.x, atlas.atlasWidth, atlas.width);
  const positionY = getAtlasBackgroundPosition(atlas.y, atlas.atlasHeight, atlas.height);

  return (
    <span
      role="img"
      aria-label={resourceLabel(resource)}
      className={
        iconPixelSize
          ? "minecraft-pixel-art block max-w-none bg-no-repeat"
          : "minecraft-pixel-art block h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none bg-no-repeat"
      }
      style={{
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
        backgroundImage: `url('${atlas.imagePath}')`,
        backgroundSize: `${(atlas.atlasWidth / atlas.width) * 100}% ${
          (atlas.atlasHeight / atlas.height) * 100
        }%`,
        backgroundPosition: `${positionX} ${positionY}`,
      }}
    />
  );
}

function getAtlasBackgroundPosition(offset: number, atlasSize: number, iconSize: number) {
  const travel = atlasSize - iconSize;
  if (travel <= 0) {
    return "0%";
  }

  return `${(offset / travel) * 100}%`;
}

function AmountLabel({ resource }: { resource: Pick<ResourceAmount, "kind" | "amount"> }) {
  const label = formatMinecraftAmount(resource.amount, resource.kind);
  if (!label) {
    return null;
  }

  const position =
    resource.kind === "fluid" ? "bottom-0 left-0.5" : "bottom-0 right-0.5 text-right";
  const style = getAmountLabelStyle(label, resource.kind);

  return (
    <span
      className={[
        "absolute max-w-[95%] whitespace-nowrap font-mono font-black text-white drop-shadow-[1px_1px_0_#000]",
        position,
      ].join(" ")}
      style={style}
    >
      {label}
    </span>
  );
}

function getAmountLabelStyle(label: string, kind: ResourceKind): CSSProperties {
  const length = label.length;
  const fontSize = length <= 4 ? 10 : length <= 6 ? 8 : length <= 9 ? 6 : 5;
  const scaleX = length <= 9 ? 1 : length <= 12 ? 0.9 : 0.78;
  return {
    fontSize,
    lineHeight: `${fontSize}px`,
    transform: scaleX === 1 ? undefined : `scaleX(${scaleX})`,
    transformOrigin: kind === "fluid" ? "bottom left" : "bottom right",
  };
}

function formatMinecraftAmount(amount: number, kind: ResourceKind): string | undefined {
  if (kind === "item") {
    if (amount === 1) {
      return undefined;
    }

    return Number.isInteger(amount) ? formatNumberWithThousands(amount) : trimAmount(amount);
  }

  if (kind === "aspect") {
    return trimAmount(amount);
  }

  return `${trimAmount(amount)}L`;
}

function trimAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return formatNumberWithThousands(amount);
  }

  return formatNumberWithThousands(trimTrailingDecimalZeros(amount.toFixed(2)));
}
