"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Zap } from "lucide-react";
import type { ResourceAmount, ResourceIconAtlasRef, ResourceKind } from "@/lib/model/types";
import { NEI_TEXTURES } from "@/lib/nei-renderer/theme/textures";
import {
  formatNumberWithThousands,
  resourceLabel,
  stripOreDictionaryPrefix,
  trimTrailingDecimalZeros,
} from "@/lib/model/resources";
import { isProgrammedCircuitResource } from "@/lib/model/programmed-circuit";
import { MinecraftTooltip } from "./MinecraftTooltip";
import { getSpriteFitScale, spriteFitStyle } from "./sprite-fit";

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
  /** Preferred item magnification; opaque bounds still cap it inside the slot. */
  itemZoom?: number;
  showConsumedState?: boolean;
  /**
   * Set on slots that rotate through an oredict's members. `locked` means a
   * player scrolled the slot and it has stopped on one item.
   */
  alternativeState?: "cycling" | "locked";
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

const RESOURCE_ART_SHADOW = "drop-shadow-[0_2px_3px_rgba(0,0,0,0.5)]";
// Exported fluid textures occupy the middle half of their padded canvas.
// Clip the texture first, then cast its shadow from the outer art frame.
const FLUID_SPRITE_CLIP = "inset(25% round 1px)";

function ResourceIconComponent({
  resource,
  size = "md",
  showAmount = true,
  showName = false,
  bare = false,
  className = "",
  tooltip = true,
  iconPixelSize,
  itemZoom = 1,
  showConsumedState = true,
  alternativeState,
}: ResourceIconProps) {
  // Artwork deliberately exceeds its clipped slot. Every art renderer below
  // must opt out of flex shrinking: Firefox shrinks percentage-sized <img>
  // widths where Chromium keeps their aspect-ratio minimum; atlas spans shrink
  // in both engines. That made the same sprite smaller or stretched by format.
  const icon = (
    <div
      style={{ "--resource-item-zoom": itemZoom } as CSSProperties}
      className={[
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        bare
          ? ""
          : "border border-[#373737] bg-[#8d8d8d] shadow-[inset_2px_2px_0_#cfcfcf,inset_-2px_-2px_0_#4d4d4d]",
        sizeClasses[size],
        resource || bare
          ? ""
          : "bg-[#3a3a3a] opacity-100 shadow-[inset_1px_1px_0_#5d5d5d,inset_-1px_-1px_0_#1f1f1f]",
        // The circuit's art is a near-black chip, drawn on a light grey panel
        // at the size of a fingernail. Left as it is, the setting a recipe
        // will not run without is the hardest thing on the card to see.
        resource && isProgrammedCircuitResource(resource)
          ? "[&_.minecraft-pixel-art]:brightness-[1.9] [&_.minecraft-pixel-art]:contrast-[1.15] [&_.minecraft-pixel-art]:saturate-[1.2]"
          : "",
        className,
      ].join(" ")}
    >
      <IconImage resource={resource} iconPixelSize={iconPixelSize} />

      {resource && showAmount ? <AmountLabel resource={resource} /> : null}
      {resource?.chance !== undefined ? <ChanceLabel chance={resource.chance} /> : null}

      {/* A circuit is the setting the recipe runs on, not an ingredient. It is
          never consumed, so "NC" says nothing a player does not already know
          and only crowds a slot that is small to begin with. */}
      {showConsumedState && resource?.consumed === false && !isProgrammedCircuitResource(resource) ? (
        <span
          title="Not consumed"
          className="absolute left-0 top-0 font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]"
        >
          NC
        </span>
      ) : null}

      {resource && alternativeState === "locked" && shouldShowAlternativeMarker(resource) ? (
        <span
          className="absolute left-0 bottom-0 font-mono text-[9px] font-black leading-none text-[#ffaa00] drop-shadow-[1px_1px_0_#000]"
        >
          ■
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
  return (
    <MinecraftTooltip label={buildTooltipLabel(resource, alternativeState)}>{icon}</MinecraftTooltip>
  );
}

function atlasEquals(a?: ResourceIconAtlasRef, b?: ResourceIconAtlasRef): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.imagePath === b.imagePath &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.atlasWidth === b.atlasWidth &&
    a.atlasHeight === b.atlasHeight
  );
}

function displayResourceEquals(
  a?: DisplayResourceAmount,
  b?: DisplayResourceAmount,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.amount === b.amount &&
    a.displayName === b.displayName &&
    a.iconPath === b.iconPath &&
    atlasEquals(a.iconAtlas, b.iconAtlas) &&
    a.dominantColor === b.dominantColor &&
    // Dataset arrays: a call-site spread copies the same references, so
    // identity is the honest comparison.
    a.tooltip === b.tooltip &&
    a.alternatives === b.alternatives &&
    a.consumed === b.consumed &&
    a.chance === b.chance
  );
}

/**
 * Memoised because the canvas and recipe book mount these by the hundred, and a
 * single parent re-render otherwise re-runs every icon's label regexes, class
 * joins and inline style objects.
 *
 * With a field-wise resource comparison, because nearly every call site builds
 * its resource fresh (`{...port.resource, amount: 1}`): the default shallow
 * compare saw a new identity each time and the memo never hit exactly where it
 * was written to.
 */
export const ResourceIcon = memo(
  ResourceIconComponent,
  (prev, next) =>
    prev.size === next.size &&
    prev.showAmount === next.showAmount &&
    prev.showName === next.showName &&
    prev.bare === next.bare &&
    prev.className === next.className &&
    prev.tooltip === next.tooltip &&
    prev.iconPixelSize === next.iconPixelSize &&
    prev.itemZoom === next.itemZoom &&
    prev.showConsumedState === next.showConsumedState &&
    prev.alternativeState === next.alternativeState &&
    displayResourceEquals(prev.resource, next.resource),
);

/**
 * A slot never accepts the other form, so a fluid listed on a cell (or the
 * reverse) must not be advertised as a substitute, marker included. Saying so
 * would promise a wire the board refuses to draw; crossing the two forms takes a
 * Canner, like it does in game.
 */
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

function buildTooltipLabel(
  resource: ResourceIconProps["resource"],
  alternativeState?: ResourceIconProps["alternativeState"],
) {
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
          (line) =>
            stripOreDictionaryPrefix(line) &&
            !isNbtTooltipLine(line) &&
            !isOreDictionaryNoiseLine(line),
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
  // Both short enough to sit on one line at the panel's width: a hint that wraps
  // mid-sentence reads worse than no hint at all.
  const cycleLine =
    alternativeState === "locked"
      ? "Scroll to change."
      : alternativeState === "cycling"
        ? "Scroll to pick one."
        : undefined;

  return [...baseLines, cycleLine, chanceLine, consumedLine].filter(Boolean).join("\n");
}

/**
 * Ore dictionary bookkeeping, which is not what you asked about.
 *
 * Hovering a slot that rotates through what it accepts used to answer with the
 * group's name and then every member of it, twice: once from the dataset's own
 * tooltip and once built here. On a group like `logWood` that is eight wrapped
 * lines of names covering the card, in front of the one thing you pointed at.
 * The wheel shows alternatives one at a time, so the tip only names what is
 * on the slot right now.
 */
function isOreDictionaryNoiseLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized.startsWith("accepts:") || normalized.startsWith("ore dictionary:");
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

  // POWER has no sprite anywhere: EU is app-synthesized, and its face is a
  // drawn bolt in the app's power gold.
  if (resource.kind === "power") {
    return <PowerIconGlyph iconPixelSize={iconPixelSize} />;
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

  return <SpriteImage resource={resource} iconPath={iconPath} iconPixelSize={iconPixelSize} />;
}

/**
 * EU's face: a chunky pixel-family lightning bolt in the power gold, drawn
 * rather than fetched - power is synthesized by the app and has no sprite in
 * any dataset. Crisp edges (no anti-aliased curves) so it sits beside the
 * item pixel art without looking imported from another game.
 */
function PowerIconGlyph({ iconPixelSize }: { iconPixelSize?: number }) {
  const size = iconPixelSize ?? 32;
  // The same thunderbolt, same amber, as the POWER button top-left - and a
  // step smaller than the box, because the bolt reads bigger than a sprite
  // of equal size (all its ink is in the middle).
  const bolt = Math.max(10, Math.round(size * 0.7));
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Zap width={bolt} height={bolt} className="fill-current text-amber-400" strokeWidth={1.5} />
    </span>
  );
}

/**
 * One item's sprite, and what stands in for it until it arrives.
 *
 * A plain `<img>` paints its ALT TEXT while it loads, so a panel of icons filled
 * itself with item names in a 16px font, sized for a box a fraction of their
 * width, for as long as the sprites took to arrive. The image is therefore held
 * hidden until it has actually decoded - `visibility` hides alt text where
 * `opacity` would not - and an outline waits in its place.
 *
 * The outline only becomes visible after a beat (see SPRITE_PULSE_DELAY_MS). A
 * sprite that was already cached arrives inside that beat and the placeholder is
 * never seen at all, which is the whole point: the flash it replaces was the
 * complaint, so it must not become a flash of its own.
 */
function SpriteImage({
  resource,
  iconPath,
  iconPixelSize,
}: {
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName">;
  iconPath: string;
  iconPixelSize?: number;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [fitScale, setFitScale] = useState<number>();
  const imageRef = useRef<HTMLImageElement | null>(null);

  // A cached sprite can finish before React has attached onLoad, and a src that
  // changes has to start over.
  useEffect(() => {
    const image = imageRef.current;
    setStatus(image?.complete ? (image.naturalWidth > 0 ? "loaded" : "failed") : "loading");
    setFitScale(
      resource.kind === "item" && image?.complete && image.naturalWidth
        ? getSpriteFitScale(image)
        : undefined,
    );
  }, [iconPath, resource.kind]);

  return (
    <>
      {status === "loaded" ? null : <SpritePlaceholder settled={status === "failed"} />}
      <span
        className={[
          iconPixelSize
            ? "minecraft-pixel-art block shrink-0 max-w-none"
            : "minecraft-pixel-art block h-[calc(200%-8px)] w-[calc(200%-8px)] shrink-0 max-w-none",
          RESOURCE_ART_SHADOW,
          // Hidden, not transparent: alt text is what we are keeping off screen,
          // and only `visibility` takes it with the picture.
          status === "loaded" ? "" : "invisible",
        ].join(" ")}
        style={{
          ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
          ...spriteFitStyle(fitScale, iconPixelSize),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={iconPath}
          alt={resourceLabel(resource)}
          draggable={false}
          onLoad={(event) => {
            setFitScale(resource.kind === "item" ? getSpriteFitScale(event.currentTarget) : undefined);
            setStatus("loaded");
          }}
          onError={() => setStatus("failed")}
          className="block h-full w-full max-w-none object-contain"
          style={resource.kind === "fluid" ? { clipPath: FLUID_SPRITE_CLIP } : undefined}
        />
      </span>
    </>
  );
}

/** How long a sprite gets to arrive before anything is drawn in its place. */
const SPRITE_PULSE_DELAY_MS = 250;

function SpritePlaceholder({ settled }: { settled: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        "absolute inset-[18%] rounded-[2px] border border-white/20 bg-white/5 opacity-0",
        // A sprite that will never arrive stops pulsing and just sits there: a
        // forever-breathing box reads as "still working on it".
        settled ? "[animation:none] opacity-100" : "animate-pulse",
      ].join(" ")}
      style={settled ? undefined : { animationDelay: `${SPRITE_PULSE_DELAY_MS}ms` }}
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
          ? "minecraft-pixel-art relative block shrink-0 max-w-none"
          : "minecraft-pixel-art relative block h-[72%] w-[72%] shrink-0 max-w-none"
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
 * it on the same visual footing. Exported so storage cards can invert it when
 * they want the swatch itself, not the cell, at a target size.
 */
export const FLUID_ICON_SCALE = 0.56;

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
      className={`minecraft-pixel-art relative block shrink-0 overflow-hidden rounded-[1px] ${RESOURCE_ART_SHADOW}`}
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
 * across reloads. Exported so tank cards can tint themselves the same colour
 * their fluid renders in.
 */
export function getFallbackFluidColor(id: string): string {
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

/**
 * True when this fluid has no sprite and draws the flat colour swatch.
 *
 * The distinction the sizing call sites need: a fluid WITH rendered art
 * carries a baked-in transparent margin like every rendered sprite, so it
 * must be drawn oversized and cropped; only the artless swatch draws
 * edge-to-edge. The old rule "fluids are solid squares" dates from datasets
 * that shipped no fluid art at all, and kept sprite fluids at half the size
 * of their item neighbours.
 */
export function isSwatchFluid(
  resource: Pick<ResourceAmount, "kind" | "iconPath" | "iconAtlas">,
): boolean {
  return resource.kind === "fluid" && !resource.iconPath && !resource.iconAtlas;
}

/**
 * The iconPixelSize that makes a rendered sprite's ART fill a box of the
 * given size, minus a small breathing margin.
 *
 * Most rendered art occupies the middle half of its canvas. Keep that generous
 * size; the renderer measures each item's opaque bounds and caps only artwork
 * that would cross the slot's margin. Fluids have their own sizing helper.
 */
export function spriteArtPixels(box: number): number {
  const margin = Math.max(2, Math.round(box * 0.055));
  return (box - margin * 2) * 2;
}

/**
 * The iconPixelSize that draws a FLUID sprite's square at a comfortable
 * fraction of its box. A fluid square covers every pixel of its bounds where
 * item art is sparse and irregular, so at equal bounds the fluid reads
 * heavier; it sits at 78% of the box instead - between the classic swatch's
 * 56% inset and the edge-to-edge fill that crowded its neighbours. The
 * canvas is twice its art, so the image doubles the wanted art size.
 */
export function fluidArtPixels(box: number): number {
  return Math.round(box * 0.78 * 2);
}

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
  resource: Pick<ResourceAmount, "kind" | "id" | "displayName">;
  atlas: ResourceIconAtlasRef;
  iconPixelSize?: number;
}) {
  const positionX = getAtlasBackgroundPosition(atlas.x, atlas.atlasWidth, atlas.width);
  const positionY = getAtlasBackgroundPosition(atlas.y, atlas.atlasHeight, atlas.height);
  const [fitScale, setFitScale] = useState<number>();
  useEffect(() => {
    setFitScale(undefined);
    if (resource.kind !== "item") return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setFitScale(getSpriteFitScale(image, {
        x: atlas.x, y: atlas.y, width: atlas.width, height: atlas.height,
      }));
    };
    image.src = atlas.imagePath;
    return () => {
      active = false;
    };
  }, [resource.kind, atlas.imagePath, atlas.x, atlas.y, atlas.width, atlas.height]);

  return (
    <span
      role="img"
      aria-label={resourceLabel(resource)}
      className={[
        iconPixelSize
          ? "minecraft-pixel-art block shrink-0 max-w-none"
          : "minecraft-pixel-art block h-[calc(200%-8px)] w-[calc(200%-8px)] shrink-0 max-w-none",
        RESOURCE_ART_SHADOW,
      ].join(" ")}
      style={{
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
        ...spriteFitStyle(fitScale, iconPixelSize),
      }}
    >
      <span
        className="block h-full w-full bg-no-repeat"
        style={{
          backgroundImage: `url('${atlas.imagePath}')`,
          backgroundSize: `${(atlas.atlasWidth / atlas.width) * 100}% ${(atlas.atlasHeight / atlas.height) * 100}%`,
          backgroundPosition: `${positionX} ${positionY}`,
          clipPath: resource.kind === "fluid" ? FLUID_SPRITE_CLIP : undefined,
        }}
      />
    </span>
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
