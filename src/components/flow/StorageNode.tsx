"use client";
import { isInputRate, storageTargetMode, type TargetMode } from "@/lib/model/storage-target";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { usePortRowBrowse } from "./use-port-row-browse";
import type { BrowseMode as PortBrowseMode } from "@/components/browse-menu";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeftRight, ChevronDown, Pencil, Repeat, Split } from "lucide-react";
import type {
  FactoryStorage,
  StorageBufferMode,
  StorageDrainMode,
  StorageThroughputResult,
} from "@/lib/model/types";
import { formatCompact, formatPowerValue, makeResourceKey, trimTrailingDecimalZeros } from "@/lib/model";
import { effectiveBufferMode, isDrainRole, storageRoleFor, type StorageRole } from "@/lib/model/storage-role";
import {
  rateMultiplierForKind,
  rateSuffixForKind,
  rateUnitMultiplier,
  rateUnitPrecisionScale,
} from "@/lib/model/rate-unit";
import { FLUID_ICON_SCALE, fluidArtPixels, ResourceIcon } from "@/components/nei/ResourceIcon";
import { NodeGlanceIcon } from "./NodeGlance";
import { isWiringConnection } from "./connection-drag";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { RecipeTooltip } from "./RecipeTooltip";
import { buildBufferKeyTooltip, buildDrainKeyTooltip, buildRatePlateTooltip, buildStorageTooltip, buildTargetTooltip } from "./storage-tooltip-data";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useBoardView } from "./board-view";
import { MotionNumberText } from "./board-motion";
import { formatSlotRate } from "./flow-explainers";
import { makeResourceHandleId } from "./resource-handles";
import { buildStorageFlowScope } from "./flow-scope";
import { useRenderedHandles } from "./use-rendered-handles";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";
import { hasAnySolveNumbers } from "@/lib/solver/throughput";
import { openRatioEditor } from "./ratio-editor";
import { RatioSetupOutput } from "./RatioWireLabel";
import { ratioExportShare } from "@/lib/model/storage-ratios";
import { getCategoryPresentation } from "@/lib/model/category-presentation";
import { STORAGE_NODE_WIDTH, STORAGE_NODE_HEIGHT } from "@/lib/board-grid";
import { resourceLabel } from "@/lib/model/resources";


export interface StorageNodeData extends Record<string, unknown> {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
}

export type StorageFlowNode = Node<StorageNodeData, "storageNode">;

/**
 * The header word, the tone it wears, and the one line the hover leads with.
 *
 * A source and a drain are the plan's BOUNDARY: they break conservation on
 * purpose, one inventing its resource and one swallowing whatever arrives, and
 * they are the only cards on the board still allowed to. A buffer does no such
 * thing, so it must never wear the same badge. See `storage-role.ts`.
 */
const ROLE_PRESENTATION: Record<
  StorageRole,
  { word: string; boundary: boolean }
> = {
  source: {
    word: "SOURCE",
    boundary: true,
  },
  product: {
    word: "PRODUCT",
    boundary: true,
  },
  byproduct: {
    word: "BYPRODUCT",
    boundary: true,
  },
  trash: {
    word: "TRASH",
    boundary: true,
  },
  buffer: {
    word: "BUFFER",
    boundary: false,
  },
  idle: {
    word: "STORAGE",
    boundary: false,
  },
};


/**
 * Each job's colour, borrowed from the side panel's sections so board and
 * books say the same thing in the same ink: red IN, green OUT. A source
 * wears the Inputs red, and products and byproducts both wear the Outputs
 * green - they are one section in the panel and one direction on the board,
 * and the blue products used to wear made a third colour for a distinction
 * the header word already carries. Quiet steel for the internal plumbing
 * that buffers are; idle is dimmer still - a drawer mid-drag has nothing to
 * announce.
 */
/**
 * POWER drawers wear their own tint whatever the role: EU is not a material
 * and its tile must not read as one more green product. A somber burnt
 * amber - vibrant but deliberately NOT the bright wire amber, so the tile
 * is ground and the lightning stays the light. Paint still wins.
 */
const POWER_STORAGE_TINT = "#c07c17";

function storageTint(storage: Pick<FactoryStorage, "kind" | "colorTag" | "bufferMode">, role: StorageRole): string {
  if (storage.colorTag) {
    return GT_NODE_COLORS[storage.colorTag].swatch;
  }
  if (storage.kind === "power") {
    return POWER_STORAGE_TINT;
  }
  return ROLE_TINTS[role];
}

const ROLE_TINTS: Record<StorageRole, string> = {
  source: "var(--flow-input)",
  product: "var(--flow-output)",
  byproduct: "var(--flow-output)",
  // A bin is neither an import nor a shipment: dull steel, like the plumbing.
  trash: "#8a93a6",
  buffer: "#8a93a6",
  idle: "#5d6877",
};

/** Both strict and ratio buffers pass through without banking surplus. */
function isStrictBuffer(storage: FactoryStorage, solveMode: boolean): boolean {
  return effectiveBufferMode(storage, solveMode) === "strict" || storage.bufferMode === "ratio";
}

// Inline (not utility classes) so React Flow's own handle stylesheet can
// never reposition or resize this: the well is the wire zone, exactly.
//
// ONE handle over the whole well, not two halves. A drawer holds one item, so
// "wire this up" is one gesture and the far end decides which way it runs. The
// card used to be split down the middle - left half asked who FEEDS it, right
// half who it feeds - with nothing on screen saying which half you had hold
// of, so half of all drags asked the wrong question and washed a perfectly
// good target red. Wires still dock through both port ids; only the grab is
// one thing now. See `bidirectional` in FactoryFlow.tsx.
const WELL_HANDLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  margin: 0,
  transform: "none",
  borderRadius: 0,
  border: "none",
  background: "transparent",
  opacity: 0,
  zIndex: 30,
};

/**
 * Item icon box on the card face; fluids invert FLUID_ICON_SCALE to match.
 * Square and fixed, NOT the well's full box: the well is flexible (a drain
 * spends a row on its mode) and stretching a sprite to a non-square hole
 * distorts it.
 */
const CARD_ICON_PX = 32;
/** The port chip's picture. */
const CHIP_ICON_PX = 32;
/**
 * Plain-fluid swatches draw edge to edge — no baked-in margin like item
 * sprites — so undiluted they brush right up against the header above and the
 * net line below. Shrink only them; items keep the full box.
 */
const FLUID_BREATHE_PX = 4;
/** Oversized glance icon (zoomed out) — a shade larger than the card FACE so
    it reads as the node's identity, but well inside the 100px card: at 128
    and even 112 the art swamped the card instead of riding it. */
const GLANCE_ICON_PX = 84;

/**
 * Rendered and atlas item sprites carry a big baked-in transparent margin —
 * the art never fills more than ~51% of the canvas (measured across the
 * rendered set). Drawing the sprite at 2× the box and letting the icon's
 * overflow-hidden crop the empty margin makes the art itself fill the box.
 * Same convention as ResourceIcon's default calc(200% - 8px) slot rendering.
 */
const ITEM_SPRITE_MARGIN_SCALE = 2;

/** The sprite size that makes the ART fill a box of the given size. */
function storageIconPixelSize(
  boxPx: number,
  storage: Pick<FactoryStorage, "kind" | "iconPath" | "iconAtlas">,
): number {
  const isPlainFluid = storage.kind === "fluid" && !storage.iconPath && !storage.iconAtlas;
  if (isPlainFluid) {
    // The fluid swatch insets itself to FLUID_ICON_SCALE of the request.
    return Math.round(boxPx / FLUID_ICON_SCALE);
  }
  if (storage.kind === "fluid") {
    // A fluid sprite's full square reads heavier than item art at equal
    // bounds, so it sits at a fraction of the box (see fluidArtPixels).
    return fluidArtPixels(boxPx);
  }
  if (storage.kind === "item") {
    return boxPx * ITEM_SPRITE_MARGIN_SCALE;
  }
  // Aspects (and anything else) draw edge-to-edge already — no margin to crop.
  return boxPx;
}

function StorageNodeComponent({ data, selected }: NodeProps<StorageFlowNode>) {
  const { storage, result } = data;
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, storage.kind, storage.resourceId),
  );
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  // The rails print rates, so the drawer follows the rate and power dials.
  useRateDisplayUnits();
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  // Read off this drawer's own wires rather than through getStorageRoles: the
  // whole-board map would make every drawer re-render whenever any OTHER
  // drawer's wiring changed, and cards are the hot path. Same rule, one card.
  const role = useFactoryStore((state): StorageRole => {
    let hasIn = false;
    let hasOut = false;
    for (const edge of state.project.edges) {
      if (edge.target === storage.id) {
        hasIn = true;
      } else if (edge.source === storage.id) {
        hasOut = true;
      }
      if (hasIn && hasOut) {
        break;
      }
    }
    return storageRoleFor(storage, hasIn, hasOut, state.project.poolMode === true);
  });
  const solveMode = useFactoryStore((state) => state.project.solveMode === true);
  // POOL MODE leaves some drawers with nothing to do: a SOURCE (the pool
  // imports by itself) and a loose drawer with no side (the pool is the
  // buffer now). They stay on the board untouched - switching modes must
  // never delete anything - and read greyed and see-through while inert.
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  // Source and product drawers are live in Pool: the pool
  // banks every surplus by itself, so byproduct and trash drawers change
  // nothing a player can see on the board, and go grey with buffers.
  const inertInPool = poolMode && role !== "product" && role !== "source";
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  // Lit when a hovered port/label/drawer pulls this buffer into its flow scope.
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.nodes[storage.id]),
  );
  // Lit as the PORT at one end of what is hovered, rather than as a node the
  // hovered thing merely reaches: this drawer is either the one under the
  // cursor or the far end of a wire on it. A drawer is a port, so it wears the
  // stronger rim, the same as a lit port row on a machine.
  const isFlowScopePort = useFactoryStore((state) => {
    const ports = state.hoveredFlowScope?.ports;
    if (!ports) {
      return false;
    }
    const resource = { kind: storage.kind, id: storage.resourceId };
    return Boolean(
      ports[`${storage.id}|${makeResourceHandleId("input", resource)}`] ||
        ports[`${storage.id}|${makeResourceHandleId("output", resource)}`],
    );
  });
  // The board-wide "where is this resource" glow, which BREATHES. It belongs to
  // the side panel (hover or click a resource row) and to a drawer the app just
  // placed for you. Hovering a drawer on the board is a different question and
  // no longer asks this one: see buildStorageFlowScope.
  const isHighlighted = (hoveredFlowResourceKey ?? selectedFlowResourceKey) === resourceKey;
  const isSearchHighlighted = storageMatchesSearch(storage, recipeSearch);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const { glanceMode } = useBoardView();
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
  const net = result?.netPerSecond ?? 0;
  const title = resourceLabel(category ?? { id: storage.resourceId, displayName: storage.displayName });
  const isTank = storage.kind === "fluid";
  const isPlainFluid = isTank && !storage.iconPath && !storage.iconAtlas;
  const ratio = role === "buffer" && storage.bufferMode === "ratio";
  const word = ratio ? "RATIO" : role === "buffer" && isStrictBuffer(storage, solveMode) ? "STRICT" : ROLE_PRESENTATION[role].word;
  // Solve's rule row sits on source and product drawers only.
  const ruled = solveMode && (role === "source" || role === "product");
  // The card wears its JOB's colour, the same dialect the side panel already
  // speaks: red is what the plan imports, mint green is what it exports
  // (products and byproducts), and steel is internal
  // plumbing. The item's own colour lives in its icon; painting the frame
  // with it too said the same thing twice and left the four jobs looking
  // alike. Paint (colorTag) still wins when the player chose one.
  const tint = storageTint(storage, role);
  const borderColor = `color-mix(in srgb, ${tint} 55%, #262b34)`;
  const inputHandleId = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const outputHandleId = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  // A drawer's handles are named after its resource, and a power card's fuel
  // switch can RETARGET the drawer (setPowerSetting): without a re-measure,
  // React Flow keeps the old handle bounds and silently drops the rewired
  // edge from the screen until the next reload.
  useRenderedHandles(storage.id, [inputHandleId, outputHandleId]);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const browseResource = useFactoryStore((state) => state.browseResource);
  // POWER has no recipe book, exactly as on a machine's port row.
  const browse = (mode: PortBrowseMode) => {
    if (storage.kind === "power") return;
    browseResource(
      {
        kind: storage.kind,
        id: storage.resourceId,
        displayName: title,
        iconPath: storage.iconPath,
        iconAtlas: storage.iconAtlas,
        dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
      },
      mode,
    );
  };
  const chipBrowse = usePortRowBrowse({ nodeId: storage.id, port: { displayName: title, handleId: outputHandleId }, browse });

  return (
    <div
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      className={[
        "group relative text-[#e8e9ee] transition-[opacity,filter] duration-500",
        (isFlowScopeLit || isFlowScopePort) && !isHighlighted ? "flow-scope-glow" : "",
        isHighlighted ? "resource-glow" : "",
        // Inert: mostly grey with a trace of its own colour, and nothing on
        // it takes the pointer - no port to drag off, no pill - while the
        // card itself still drags (the events fall through to the node).
        // Only the WIRE HANDLES go dead: the card still selects, deletes and
        // drags. Blanking every child also swallowed the delete tool.
        inertInPool ? "opacity-40 grayscale-[0.75] [&_[data-resource-handle]]:pointer-events-none" : "",
      ].join(" ")}
      style={paintCursor ? { cursor: paintCursor } : undefined}
    >
      {/* Wires dock anywhere on the card's PERIMETER — the anchors span the
          whole card, and the router already picks the best side. */}
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={outputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <div
        // Glance root is the CARD, not the wrapper: the tinted frame stays,
        // and only what is written on it goes. A copper drawer zoomed out
        // still reads as a copper-coloured card.
        data-node-glance-root=""
        className={[
          // Six cells by four, fixed. Wires dock on the card's perimeter, so
          // an off-grid edge would mean off-grid endpoints. A drawer is a
          // one-port machine card: a title bar to move it by, a port chip to
          // wire from. The shared geometry owns this footprint.
          "storage-node-card relative flex h-[80px] w-[120px] flex-col",
          // Search has no rim of its own, so the card itself brightens to say
          // "this one matched". The glow states deliberately do NOT: a filter
          // here also lifts the rim and the wash drawn inside this box, and
          // brightening #ffd257 clips it to a flat yellow that no longer
          // matched the gold on the wires. See PLUG_GLOW_STYLE in RecipeNode.
          isSearchHighlighted ? "brightness-125 saturate-150" : "",
        ].join(" ")}
      >
        {/* The highlight, wearing the silhouette. A slightly larger clone of
            the shape behind the frame reads as an outline that follows the
            cut corners, where the shared box ring drew a square around a
            hexagon. Selection outranks the hover glow; the flow-scope rim is
            the quiet 2px version of the same idea. */}
        {selected || isHighlighted || isFlowScopePort || isFlowScopeLit ? (
          <span
            aria-hidden
            data-storage-shape={role}
            className={[
              "storage-shape pointer-events-none absolute",
              selected
                ? "-inset-[3px]"
                : isHighlighted || isFlowScopePort
                  ? "storage-rim--glow -inset-[3px]"
                  : "storage-rim--glow -inset-[2px]",
            ].join(" ")}
            style={{ background: selected ? "var(--selection)" : "var(--glow-line)" }}
          />
        ) : null}
        {/* The SHAPE, on its own layer rather than on the card.
            Two reasons it cannot live on the card div. The glance icon is
            deliberately bigger than the card and spills past the frame, and a
            clip-path on the card would cut it off. And an octagon needs its
            outline drawn on the diagonals, which a clipped `border` cannot do:
            the border paints first and the clip then removes it. So the outer
            span is the border colour, the inner one is the fill inset by 2px,
            and both carry the same clip - which leaves a real 2px edge all the
            way round whatever the silhouette is. */}
        <span
          aria-hidden
          data-storage-shape={role}
          className="storage-shape pointer-events-none absolute inset-0"
          style={{ background: borderColor }}
        >
          <span
            className="storage-shape-fill absolute inset-[2px]"
            style={{
              background: `color-mix(in srgb, ${tint} 24%, #101318)`,
              boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.08), inset -2px -2px 0 rgba(0,0,0,0.45)",
            }}
          />
        </span>
        {/* The breathing wash, clipped to the same silhouette the square
            ::after used to ignore. Same layer rules as before: above the
            card's surfaces, below its chrome, never a click target. */}
        {isHighlighted ? (
          <span
            aria-hidden
            data-storage-shape={role}
            className="storage-shape storage-wash pointer-events-none absolute inset-0 z-[2]"
            style={{ background: "var(--glow-halo)" }}
          />
        ) : null}
        {/* No tileTint: the glance layer's box wash would paint a rectangle
            over a card that now keeps its SILHOUETTE at glance - the shaped
            fill underneath is already the role-coloured ground. */}
        <NodeGlanceIcon>
          {/* Deliberately bigger than the card it sits on.
              Zoomed out, WHAT is in the drawer is the only thing worth
              reading, and a sprite confined inside the frame is a few pixels
              on screen. Nothing clips it — the card sets no overflow — so it
              spills a little past the frame and reads as the node's identity
              rather than as its contents. Node SIZE is untouched, which is
              what the router cares about. */}
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1, alternatives: category?.alternatives }}
            showAmount={false}
            bare
            iconPixelSize={storageIconPixelSize(GLANCE_ICON_PX, storage)}
            className="!h-[84px] !w-[84px]"
          />
          {glanceMode === "identity" ? (
            // The hover reveal, same machinery as the recipe cards' (see
            // GlanceIdentityLayer): in the DOM from the start, pure CSS shows
            // it on hover at the glance step and scales it to SCREEN size.
            // A drawer has exactly two facts worth revealing: what it holds
            // and how fast it is filling or draining.
            <span className="glance-io absolute left-1/2 top-full z-30 w-[320px] origin-top flex-col gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-82)] p-3 shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
              <span className="minecraft-title flex h-8 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-[16px] leading-[22px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]">
                <span className="mx-auto min-w-0 truncate">{title}</span>
              </span>
              <span
                className={[
                  "text-center text-[24px] font-black leading-7 tabular-nums",
                  net > 0.005
                    ? "text-[var(--mc-good)]"
                    : net < -0.005
                      ? "text-[var(--mc-bad)]"
                      : "text-[var(--mc-ink-muted)]",
                ].join(" ")}
              >
                <MotionNumberText
                  values={[net]}
                  render={(shown) => {
                    const value = shown[0] ?? net;
                    return `${value >= 0 ? "+" : ""}${formatCompactRate(value, storage.kind)}`;
                  }}
                />
              </span>
            </span>
          ) : null}
        </NodeGlanceIcon>
        {/* Which kind of buffer this is, readable without the hover: a
            catching buffer wears a thick dashed ring TRACING its hexagon
            tight inside the frame; a ratio buffer a thin second rim hugging
            the frame, a double border; a STRICT one is solid border and
            nothing else. SVG rather than a CSS border, because a border
            follows the element's box and only a path can follow the
            silhouette. Drawn over the face (z-20, pointer-events off): the
            title bar and the chip are inset clear of it. */}
        {role === "buffer" && !isStrictBuffer(storage, solveMode) ? (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20"
            viewBox={`0 0 ${STORAGE_NODE_WIDTH} ${STORAGE_NODE_HEIGHT}`}
            width="100%"
            height="100%"
          >
            <polygon
              points="11.1,1.5 108.9,1.5 118.4,40 108.9,78.5 11.1,78.5 1.6,40"
              fill="none"
              stroke={tint}
              strokeWidth={3}
              strokeDasharray="7 5.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
        {ratio ? (
          <svg aria-hidden data-ratio-rim className="pointer-events-none absolute inset-0 z-20" viewBox={`0 0 ${STORAGE_NODE_WIDTH} ${STORAGE_NODE_HEIGHT}`} width="100%" height="100%">
            <polygon points="11.9,3.75 108.1,3.75 116.1,40 108.1,76.25 11.9,76.25 3.9,40" fill="none" stroke={tint} strokeWidth={1.5} />
          </svg>
        ) : null}
        {/* The hover tooltip covers the WHOLE card: it is the drawer's one
            explanation, and it should not matter which pixel of a small tile
            the pointer found. The rule row carries its own. */}
        <MinecraftTooltip content={() => renderStorageHoverContent(storage, role)}>
        <div
          data-storage-shape={role}
          className="storage-shape-content relative z-10 flex min-h-0 flex-1 flex-col"
          style={{ "--storage-tint": tint } as CSSProperties}
        >
          {/* Colour and silhouette carry the role; the tooltip explains it.
              Keep the word available to assistive technology. */}
          <span className="storage-node-word sr-only">{word}</span>
          {/* The TITLE BAR is what you move the drawer by, the way a machine
              card moves by its title row (Jack, 2026-09-22). Nothing on it
              starts a wire. */}
          <StorageTitleBar storage={storage} role={role} isTank={isTank} title={title} solveMode={solveMode} />
          {/* The PORT CHIP answers like a machine's port row: click for the
              recipes that make the item, right click for the ones that use
              it, R and U for the same, a long press for a finger, and a drag
              to wire. One handle blankets it (z-30); what you press on it
              sits above (z-40). It is also the resource-hover trigger - the
              ITEM lights the flow, not the card around it. Wiring is a mode;
              a held wire must not also be lighting up cards. */}
          <div
            className={`storage-port-chip ${ruled ? "" : "storage-port-chip--centered"}`}
            onPointerEnter={() => {
              chipBrowse.handlers.onPointerEnter();
              if (!isWiringConnection()) {
                setHoveredFlowScope(buildStorageFlowScope(useFactoryStore.getState().project, storage));
              }
            }}
            onPointerLeave={() => {
              chipBrowse.handlers.onPointerLeave();
              setHoveredFlowScope(undefined);
            }}
            onPointerDown={chipBrowse.handlers.onPointerDown}
            onPointerMove={chipBrowse.handlers.onPointerMove}
            onPointerUp={chipBrowse.handlers.onPointerUp}
            onPointerCancel={chipBrowse.handlers.onPointerCancel}
            onClick={chipBrowse.handlers.onClick}
            onContextMenu={chipBrowse.handlers.onContextMenu}
          >
            {/* One grab point. Typed as a source so a drag can START anywhere
                on it; the board runs in ConnectionMode.Loose, so a wire coming
                the other way still lands here, and the drop resolves a drawer
                by direction rather than by which element the pointer happened
                to be over (getStorageHandleAtPosition). */}
            <Handle
              id={outputHandleId}
              type="source"
              position={Position.Right}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={outputHandleId}
              aria-label={`${title}${readOnly ? "" : ". Left click or R for recipes, right click or U for uses, drag to connect"}`}
              className="nodrag"
              style={WELL_HANDLE}
            />
            {/* The input port keeps its id for WIRES - edges dock on it, plans
                store it - but it is no longer a place you grab. Zero-sized and
                inert so React Flow still knows the port exists. */}
            <Handle
              id={inputHandleId}
              type="target"
              position={Position.Left}
              className="nodrag !pointer-events-none !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
            />
            <span className="storage-chip-icon">
              <ResourceIcon
                resource={{ ...storage, id: storage.resourceId, amount: 1, alternatives: category?.alternatives }}
                showAmount={false}
                bare
                iconPixelSize={storageIconPixelSize(isPlainFluid ? CHIP_ICON_PX - FLUID_BREATHE_PX : CHIP_ICON_PX, storage)}
                className="!h-[32px] !w-[32px]"
              />
            </span>
            <div className="storage-chip-text">
              {ruled ? (
                <>
                  <RuleInput storage={storage} role={role} result={result} net={net} />
                  <ChipRate net={net} kind={storage.kind} role={role} size="small" />
                  <RuleBar storage={storage} role={role} result={result} net={net} />
                </>
              ) : (
                <>
                  <ChipRate net={net} kind={storage.kind} role={role} size="large" />
                  {ratio ? (
                    // Its own control: a click or right click here is not a browse.
                    <span className="contents" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                      <RatioSetupOutput storageId={storage.id} percentage={ratioExportShare(storage) * 100} />
                    </span>
                  ) : null}
                </>
              )}
            </div>
            {chipBrowse.menu}
          </div>
        </div>
        </MinecraftTooltip>
      </div>
    </div>
  );
}


/**
 * The tile's LOOK alone - silhouette, role tint, title bar, port chip - for
 * anything that must show a drawer that is not (yet) a node: the void-drop
 * ghost previews the exact drawer a release would spawn with it. Built from
 * the same parts as the real card (the title bar's name, the chip, ChipRate),
 * so the preview can never drift from the thing it predicts. Its keys are
 * drawn, not wired: a ghost is never pressed. No handles, no glance, no
 * tooltip, no washes: those belong to the node.
 */
export function StorageTileFace({
  storage,
  role,
  net = 0,
}: {
  storage: FactoryStorage;
  role: StorageRole;
  net?: number;
}) {
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, storage.kind, storage.resourceId),
  );
  const isTank = storage.kind === "fluid";
  const isPlainFluid = isTank && !storage.iconPath && !storage.iconAtlas;
  const tint = storageTint(storage, role);
  const borderColor = `color-mix(in srgb, ${tint} 55%, #262b34)`;
  return (
    <div className="storage-node-card relative flex h-[80px] w-[120px] flex-col text-[#e8e9ee]">
      <span
        aria-hidden
        data-storage-shape={role}
        className="storage-shape pointer-events-none absolute inset-0"
        style={{ background: borderColor }}
      >
        <span
          className="storage-shape-fill absolute inset-[2px]"
          style={{
            background: `color-mix(in srgb, ${tint} 24%, #101318)`,
            boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.08), inset -2px -2px 0 rgba(0,0,0,0.45)",
          }}
        />
      </span>
      <div
        data-storage-shape={role}
        className="storage-shape-content relative z-10 flex min-h-0 flex-1 flex-col"
        style={{ "--storage-tint": tint } as CSSProperties}
      >
        <div className={`storage-title-bar ${isDrainRole(role) || role === "buffer" ? "" : "storage-title-bar--no-end"}`}>
          <span className="storage-title-side">
            <span aria-hidden className="storage-title-key storage-title-key--delete" />
          </span>
          <StorageTitleName title={resourceLabel(category ?? { id: storage.resourceId, displayName: storage.displayName })} />
          <span className="storage-title-side storage-title-side--end">
            {isDrainRole(role) || role === "buffer" ? (
              <span aria-hidden className="storage-title-key">
                {role === "buffer" ? <ArrowDownToLine /> : <Repeat />}
              </span>
            ) : null}
          </span>
        </div>
        <div className="storage-port-chip storage-port-chip--centered">
          <span className="storage-chip-icon">
            <ResourceIcon
              resource={{ ...storage, id: storage.resourceId, amount: 1, alternatives: category?.alternatives }}
              showAmount={false}
              bare
              iconPixelSize={storageIconPixelSize(isPlainFluid ? CHIP_ICON_PX - FLUID_BREATHE_PX : CHIP_ICON_PX, storage)}
              className="!h-[32px] !w-[32px]"
            />
          </span>
          <div className="storage-chip-text">
            <ChipRate net={net} kind={storage.kind} role={role} size="large" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The material's name, one line in the title bar, fading where it runs out. */
function StorageTitleName({ title }: { title: string }) {
  return (
    <span className="storage-title-name">
      {title}
    </span>
  );
}

// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering while
// its wrapper is translated (see RecipeNode for the long version).
export const StorageNode = memo(
  StorageNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/**
 * A rate that will not fit gives up SIZE, never digits and never pixels: a
 * trickle like +0.000000001/s is a real number the player dialled for, and
 * clipping it printed a confident wrong one. Stepped by string length rather
 * than measured, so the board never reads the DOM for it.
 *
 * The rate uses the full bottom row, less the clearance each silhouette
 * needs near its corners. Fit by string length rather than
 * measuring the DOM on a board full of cards.
 */
const NET_LINE_WIDTH_BY_ROLE: Record<StorageRole, number> = {
  product: 92,
  idle: 92,
  source: 84,
  buffer: 70,
  // The shield's base taper is the deepest bite of the set, and it takes it
  // exactly across this line's lowest pixels.
  byproduct: 66,
  // The bin's straight taper reaches ~13px a side at the line's depth.
  trash: 72,
};
/**
 * Advance per character at each step. Measured against the rendered bold
 * pixel font, not the em size: 12px Monocraft draws its digits a full 8px
 * wide, which is how "+123k L/s" cleared the arithmetic and still lost its
 * tail to the shield.
 */
const NET_LINE_FIT_STEPS = [
  { className: "text-[12px]", perChar: 8 },
  { className: "text-[10px]", perChar: 6.6 },
  { className: "text-[8px]", perChar: 5.3 },
  { className: "text-[7px]", perChar: 4.7 },
] as const;

function rateFitClass(label: string, role: StorageRole, width = NET_LINE_WIDTH_BY_ROLE[role]): string {
  for (const step of NET_LINE_FIT_STEPS) {
    if (label.length * step.perChar <= width) {
      return step.className;
    }
  }
  return NET_LINE_FIT_STEPS[NET_LINE_FIT_STEPS.length - 1].className;
}

function netRateColor(net: number): string {
  return net > 0.005 ? "var(--flow-output)" : net < -0.005 ? "var(--flow-input)" : "#a8afbb";
}

/** The tile's one line of news: the net rate, sized to fit its silhouette. */
function NetLine({ net, kind, role, width, formatRate = formatCompactRate, unsigned = false, color = netRateColor(net) }: { net: number; kind: string; role: StorageRole; width?: number; formatRate?: (value: number, kind: string) => string; unsigned?: boolean; color?: string }) {
  // The fit class and the colour read the TARGET value: the size and tone
  // land immediately, and only the digits ease their way there.
  const label = unsigned ? formatRate(Math.abs(net), kind) : `${net >= 0 ? "+" : ""}${formatRate(net, kind)}`;
  return (
    <div
      className={[
        // No "Net" word: the sign and the colour already say it, and
        // the number is the thing worth reading.
        "storage-net-line relative z-10 h-4 whitespace-nowrap text-center font-bold leading-4 tabular-nums",
        rateFitClass(label, role, width),
      ].join(" ")}
      style={{ color }}
    >
      <MotionNumberText
        values={[net]}
        render={(shown) => {
          const value = shown[0] ?? net;
          return unsigned ? formatRate(Math.abs(value), kind) : `${value >= 0 ? "+" : ""}${formatRate(value, kind)}`;
        }}
      />
    </div>
  );
}

/**
 * "2.5k" is a number: metric shorthand for the rate field, k / m / g for
 * thousand, million, billion, either case, spaces and commas forgiven.
 * Anything else is not a number and the caller falls back rather than guess.
 */
/** The mirror: a committed value is SHOWN in the same shorthand it was
 * typed in - 10000 reads back as 10k, never expanded under your cursor. */
function formatAmountWithSuffix(value: number): string {
  if (value < 0) return "-" + formatAmountWithSuffix(-value);
  if (value >= 1e9) {
    return `${trimTrailingDecimalZeros((value / 1e9).toFixed(2))}g`;
  }
  if (value >= 1e6) {
    return `${trimTrailingDecimalZeros((value / 1e6).toFixed(2))}m`;
  }
  if (value >= 1e3) {
    return `${trimTrailingDecimalZeros((value / 1e3).toFixed(2))}k`;
  }
  return trimTrailingDecimalZeros(value.toFixed(4));
}

function parseAmountWithSuffix(text: string): number | undefined {
  const match = text
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/^−/, "-")
    .match(/^([+-]?[0-9]*\.?[0-9]+)\s*([kmg]?)$/);
  if (!match) {
    return undefined;
  }
  const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "g" ? 1e9 : 1;
  return Number.parseFloat(match[1]!) * multiplier;
}

/**
 * Solve mode's question, asked on the tile itself: how much should this
 * product make per second. The number typed here is the constraint the whole
 * solve answers; empty means "whatever falls out" (the drawer behaves like a
 * byproduct until a number lands). Red when no chain can reach the number at
 * any machine scale.
 */
export function TargetLine({
  storage,
  result,
  formatDisplayRate,
  inlinePencil = false,
  input = isInputRate(storage),
}: {
  storage: FactoryStorage;
  result: StorageThroughputResult | undefined;
  formatDisplayRate?: (value: number, kind: string) => string;
  inlinePencil?: boolean;
  input?: boolean;
}) {
  const setStorageTarget = useFactoryStore((state) => state.setStorageTarget);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const signed = useFactoryStore((state) => state.project.poolMode === true);
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const target = storage.targetPerSecond === undefined ? undefined : Math.abs(storage.targetPerSecond) * (signed && input ? -1 : 1);
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const showZero = target === 0;
  const unreachable = result?.targetUnreachable === true;
  const color = unreachable ? "var(--flow-input)"
    : target === undefined ? "var(--flow-output)"
    : netRateColor(input ? -Math.abs(target) : target);
  const rateStyle = { color, "--target-rate-color": color } as CSSProperties;
  // While the solver has NOTHING to solve for - no amount, no pin, anywhere -
  // every empty rate line blinks the ask, in step with the board's notice.
  const askBlink = useFactoryStore((state) => !hasAnySolveNumbers(state.project) && mode !== "ignore");
  const beginEdit = () => {
    if (locked) return;
    setDraft(
      target !== undefined && (target > 0 || (signed && target < 0) || showZero)
        ? Math.abs(target * rateMultiplierForKind(storage.kind)) < 1
          ? (target * rateMultiplierForKind(storage.kind)).toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 })
          : formatAmountWithSuffix(target * rateMultiplierForKind(storage.kind))
        : "",
    );
    setEditing(true);
  };
  const clearRate = (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    setEditing(false);
    setStorageTarget(storage.id, undefined);
  };
  // Typed figures are read in the BOARD'S rate unit and stored per second,
  // converted at the edges, so the number always matches the board around it.
  const commit = () => {
    setEditing(false);
    if (draft.trim() === "") {
      setStorageTarget(storage.id, undefined);
      return;
    }
    const value = parseAmountWithSuffix(draft);
    if (value === undefined || !Number.isFinite(value) || (!signed && value < 0) || (value === 0 && mode !== "exact" && mode !== "at-most")) {
      // Not a number: the field falls back to what it held.
      return;
    }
    setStorageTarget(storage.id, (input && !signed ? -Math.abs(value) : value) / rateMultiplierForKind(storage.kind));
  };

  if (!editing) {
    return (
      // The resting face IS the net line - the same component every other
      // tile draws, wrapped only to be clickable (z-40, over the wire
      // handles that blanket the well at z-30). The value, edit marks and
      // active input share one rate color, including unreachable targets.
      <MinecraftTooltip content={() => <RecipeTooltip view={buildTargetTooltip(storage, result, signed, input)} />}>
      <div
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          beginEdit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            beginEdit();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => { event.stopPropagation(); if (event.button === 1) event.preventDefault(); }}
        onAuxClick={clearRate}
        aria-label="Required amount"
        style={rateStyle}
        className="nodrag group/target relative z-40 flex cursor-pointer justify-center hover:brightness-125"
      >
        {/* Two marks say "this line takes typing", both attached to the
            NUMBER rather than parked at the tile's edge: a dotted
            underline in the value's own colour - the editable-value
            idiom - and a pencil riding the text's right shoulder. */}
        {/* Nudged up a couple of pixels so the dotted underline clears the
            tile's bottom edge instead of merging with it. */}
        <div className={`relative underline decoration-dotted decoration-[1.5px] underline-offset-[3px] ${inlinePencil ? "inline-flex items-center gap-[3px]" : "-translate-y-[2px]"}`}>
          {target !== undefined && (target > 0 || (signed && target < 0) || showZero) ? (
            <NetLine net={input ? -Math.abs(target) : target} unsigned={input && !signed} kind={storage.kind} role={input ? "source" : "product"} formatRate={formatDisplayRate} color={color} />
          ) : (
            <div
              className={[
                "storage-net-line relative h-4 whitespace-nowrap text-center text-[12px] font-bold leading-4 tabular-nums",
                askBlink ? "animate-pulse" : "opacity-60",
              ].join(" ")}
            >
              rate?
            </div>
          )}
          <Pencil
            aria-hidden
            // Centred on the ink-and-underline block, not the line's box:
            // the glyphs sit low in it, so dead-centre floated the pencil.
            className={`h-[11px] w-[11px] fill-current opacity-70 group-hover/target:opacity-100 ${inlinePencil ? "shrink-0" : "absolute left-full top-[calc(50%+2px)] ml-[2px] -translate-y-1/2"}`}
          />
        </div>
      </div>
      </MinecraftTooltip>
    );
  }

  return (
    <div className="storage-net-line relative z-40 flex h-4 items-center justify-center whitespace-nowrap text-center leading-none" style={rateStyle}>
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setEditing(false);
          }
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => { event.stopPropagation(); if (event.button === 1) event.preventDefault(); }}
        onAuxClick={clearRate}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        inputMode={signed ? "text" : "decimal"}
        placeholder="rate"
        aria-label="Required amount"
        className={[
          "nodrag h-4 w-[60px] border px-[3px] text-center text-[9px] font-bold tabular-nums outline-none",
          "bg-[#14171d] shadow-[inset_1px_1px_0_rgba(255,255,255,0.08),inset_-1px_-1px_0_rgba(0,0,0,0.5)]",
          "placeholder:font-normal placeholder:text-[#6b7280]",
          "focus:bg-[#1a1e26] focus:ring-1 focus:ring-[var(--target-rate-color)]",
          "border-current text-inherit",
        ].join(" ")}
      />
    </div>
  );
}

/** The ratio editor's pencil, a key in the title bar beside the mode key. */
function RatioSplitButton({ storageId }: { storageId: string }) {
  return (
    <button type="button" data-tooltip-stop aria-label="Edit drawer ratios" title="Edit split"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); openRatioEditor(storageId); }}
      className="storage-title-key board-edit-chrome nodrag nopan"
    >
      <Pencil aria-hidden />
    </button>
  );
}

/**
 * The drawer's title bar: delete, the name, and the one thing you choose.
 * It is the drawer's MOVE grip, like a machine card's title row: nothing on
 * it starts a wire, so a drag that begins here always carries the drawer.
 */
function StorageTitleBar({
  storage,
  role,
  isTank,
  title,
  solveMode,
}: {
  storage: FactoryStorage;
  role: StorageRole;
  isTank: boolean;
  title: string;
  solveMode: boolean;
}) {
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const noun = isTank ? "tank" : "drawer";
  const ratio = role === "buffer" && storage.bufferMode === "ratio";
  // Pool has one drain kind, so DrainModeSwap shows nothing there.
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  const hasEnd = ratio || role === "buffer" || (isDrainRole(role) && !poolMode);
  return (
    <div className={`storage-title-bar ${ratio ? "storage-title-bar--wide" : hasEnd ? "" : "storage-title-bar--no-end"}`}>
      <span className="storage-title-side">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteStorage(storage.id);
          }}
          className="storage-title-key storage-title-key--delete board-edit-chrome nodrag"
          title={`Delete ${noun}`}
          aria-label={`Delete ${noun}`}
        />
      </span>
      <StorageTitleName title={title} />
      <span className="storage-title-side storage-title-side--end">
        {ratio ? <RatioSplitButton storageId={storage.id} /> : null}
        {isDrainRole(role) ? (
          <DrainModeSwap storageId={storage.id} role={role} kind={storage.kind} />
        ) : role === "buffer" ? (
          <BufferModeSwap storageId={storage.id} mode={effectiveBufferMode(storage, solveMode)} />
        ) : null}
      </span>
    </div>
  );
}

/**
 * The one thing about a BUFFER you choose, worn as its own icon so the tile
 * SAYS which one it is: an arrow dropping into a tray while the tank catches
 * overflow, left-right arrows for strict pass-through, a fork for ratios.
 * Clicking cycles all three; ratio's pencil beside it opens its editor.
 */
function BufferModeSwap({ storageId, mode }: { storageId: string; mode: StorageBufferMode }) {
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const Icon = mode === "ratio" ? Split : mode === "strict" ? ArrowLeftRight : ArrowDownToLine;
  const next = mode === "overflow" ? "strict" : mode === "strict" ? "ratio" : "overflow";

  return (
    <MinecraftTooltip content={() => <RecipeTooltip view={buildBufferKeyTooltip(mode)} />}>
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        updateStorage(storageId, { bufferMode: next });
      }}
      aria-label={`Switch to ${next}`}
      className="storage-title-key board-edit-chrome nodrag"
    >
      <Icon aria-hidden />
    </button>
    </MinecraftTooltip>
  );
}

/**
 * The one thing about a drawer you CHOOSE. Source and buffer are read off the
 * wiring and cannot be picked; which kind of end-of-the-line this is cannot be
 * read off anything, so it gets a control.
 *
 * A three-way cycle since 2026-08-23: product, byproduct, trash. The trash
 * step is what replaced the toolbar's separate trash can node. Cycle arrows,
 * so the strict buffer's left-right arrows mean one thing only.
 */
function DrainModeSwap({
  storageId,
  role,
  kind,
}: {
  storageId: string;
  role: StorageRole;
  kind: FactoryStorage["kind"];
}) {
  const setStorageDrainMode = useFactoryStore((state) => state.setStorageDrainMode);
  // POOL MODE has one drawer kind, the product: byproduct and trash drawers
  // are inert there (the pool banks every surplus by itself), so there is
  // nothing to cycle to and the control is not shown.
  const poolMode = useFactoryStore((state) => state.project.poolMode === true);
  // POWER cannot be trashed - there is no bin for electricity - so its
  // cycle is two states: product and byproduct.
  const next: StorageDrainMode =
    role === "product"
      ? "byproduct"
      : role === "byproduct"
        ? kind === "power"
          ? "product"
          : "trash"
        : "product";
  if (poolMode) {
    return null;
  }

  return (
    <MinecraftTooltip content={() => <RecipeTooltip view={buildDrainKeyTooltip(role, next)} />}>
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setStorageDrainMode(storageId, next);
      }}
      aria-label={`Switch to ${next}`}
      className="storage-title-key board-edit-chrome nodrag"
    >
      <Repeat aria-hidden />
    </button>
    </MinecraftTooltip>
  );
}

/**
 * The chip's rate: what flows, in the drawer's red or green (steel on trash,
 * whose intake is voided, neither shipped nor spare). Large in Build, a step
 * smaller under the rule row in Solve. It gives up SIZE, never digits, when a
 * figure will not fit, fitted by string length so nothing is measured.
 */
const CHIP_RATE_ROOM: Record<StorageRole, number> = {
  product: 63,
  idle: 63,
  source: 61,
  byproduct: 49,
  trash: 49,
  buffer: 47,
};
const CHIP_RATE_STEPS = {
  large: [
    { className: "text-[13px] leading-[15px]", perChar: 8.6 },
    { className: "text-[11px] leading-[13px]", perChar: 7.3 },
    { className: "text-[9.5px] leading-[11px]", perChar: 6.3 },
    { className: "text-[8px] leading-[10px]", perChar: 5.3 },
  ],
  small: [
    { className: "text-[12px] leading-[13px]", perChar: 7.9 },
    { className: "text-[10px] leading-[11px]", perChar: 6.6 },
    { className: "text-[8.5px] leading-[10px]", perChar: 5.6 },
    { className: "text-[7px] leading-[9px]", perChar: 4.7 },
  ],
} as const;

function ChipRate({ net, kind, role, size }: { net: number; kind: string; role: StorageRole; size: "large" | "small" }) {
  const label = `${net >= 0 ? "+" : ""}${formatCompactRate(net, kind)}`;
  const steps = CHIP_RATE_STEPS[size];
  const room = CHIP_RATE_ROOM[role];
  const fit = steps.find((step) => label.length * step.perChar <= room) ?? steps[steps.length - 1];
  return (
    <div
      className={`storage-net-line storage-chip-rate whitespace-nowrap font-extrabold tabular-nums ${fit.className}`}
      style={{ color: role === "trash" ? "#b9c0cd" : netRateColor(net) }}
    >
      <MotionNumberText
        values={[net]}
        render={(shown) => {
          const value = shown[0] ?? net;
          return `${value >= 0 ? "+" : ""}${formatCompactRate(value, kind)}`;
        }}
      />
    </div>
  );
}

/** The rule list, in the order the rule button's wheel steps through it. Any
 * is stored as "ignore": a number can wait there without applying. */
const RULE_STEPS: TargetMode[] = ["ignore", "at-least", "exact", "at-most"];
const RULE_MARK: Record<TargetMode, string> = { ignore: "~", "at-least": "≥", exact: "=", "at-most": "≤" };
const RULE_NAME: Record<TargetMode, string> = { ignore: "Any", "at-least": "At least", exact: "Exactly", "at-most": "At most" };

/** A field value in the board's rate unit and the typed shorthand. */
function draftFor(perSecond: number, kind: string): string {
  const shown = Math.abs(perSecond * rateMultiplierForKind(kind));
  return shown < 1
    ? shown.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 6 })
    : formatAmountWithSuffix(shown);
}

/** Your number in the field: the drawer's compact form, without the unit. */
function formatFieldNumber(perSecond: number, kind: string): string {
  const scaled = Math.abs(perSecond * rateMultiplierForKind(kind));
  if (kind === "power") return formatPowerValue(scaled);
  if (scaled >= 1_000_000) return `${trimFlow(scaled / 1_000_000)}M`;
  if (scaled >= 1_000) return `${trimFlow(scaled / 1_000)}k`;
  return scaled >= 1 ? trimFlow(scaled) : formatCompact(scaled);
}

/** Where a source or product drawer's typed rate stands: its rule, and
 * whether it applies. Any covers both no number and a number kept waiting. */
function useDrawerRule(storage: FactoryStorage, role: StorageRole) {
  const mode = storageTargetMode(storage, role);
  const target = storage.targetPerSecond;
  return { mode, target, any: target === undefined || mode === "ignore", input: isInputRate(storage, role) };
}

/**
 * Solve's input row on a source or product drawer (Jack, 2026-09-22): a rule
 * BUTTON with a ▾ that opens the four rules in words, and your rate in a
 * sunken BOX you click and type into. The box and the arrow are the two cues
 * everyone reads without being told: type here, and there are choices.
 */
export function RuleInput({
  storage,
  role,
  result,
  net,
}: {
  storage: FactoryStorage;
  role: StorageRole;
  result: StorageThroughputResult | undefined;
  net: number;
}) {
  const setStorageTarget = useFactoryStore((state) => state.setStorageTarget);
  const setStorageTargetMode = useFactoryStore((state) => state.setStorageTargetMode);
  const setStorageRule = useFactoryStore((state) => state.setStorageRule);
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const { mode, target, any, input } = useDrawerRule(storage, role);
  // While the solver has NOTHING to solve for - no amount, no pin, anywhere -
  // every empty box pulses the ask, in step with the board's notice.
  const ask = useFactoryStore((state) => target === undefined && mode !== "ignore" && !hasAnySolveNumbers(state.project));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // A rule picked on an empty drawer with nothing flowing yet waits here for
  // the number the box is about to ask for.
  const [pendingMode, setPendingMode] = useState<TargetMode | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  useDropdownDismiss(open, { refs: [rootRef], onClose: () => setOpen(false), fade: true });
  const kind = storage.kind;
  const flowing = Math.abs(net);
  const unreachable = result?.targetUnreachable === true;
  const shownMode: TargetMode = any ? "ignore" : mode;

  const beginEdit = (perSecond: number | undefined, nextMode?: TargetMode) => {
    if (locked) return;
    setOpen(false);
    setPendingMode(nextMode);
    setDraft(perSecond === undefined ? "" : draftFor(perSecond, kind));
    setEditing(true);
  };
  // Picking a rule. From Any with no number yet, the rule starts from what
  // flows now; with nothing flowing, the box asks for the number.
  const choose = (next: TargetMode) => {
    const state = useFactoryStore.getState();
    setOpen(false);
    if (state.isReadOnly || state.checklistMode || next === shownMode) return;
    if (next === "ignore") {
      if (target !== undefined) setStorageTargetMode(storage.id, "ignore");
      return;
    }
    if (target === undefined) {
      const pinned = Number(flowing.toPrecision(4));
      if (pinned > 0) setStorageRule(storage.id, next, pinned);
      else beginEdit(undefined, next);
      return;
    }
    setStorageTargetMode(storage.id, next);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const shownRef = useRef(shownMode);
  shownRef.current = shownMode;
  useEffect(() => {
    if (!button) return;
    // Native listener: React wheel events are passive and cannot stop the
    // board from zooming (and the button is nowheel so the board camera
    // leaves it alone). Scrolling steps through the rules, clamped.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = RULE_STEPS.indexOf(shownRef.current);
      const next = RULE_STEPS[Math.min(RULE_STEPS.length - 1, Math.max(0, index + (event.deltaY > 0 ? 1 : -1)))]!;
      chooseRef.current(next);
    };
    button.addEventListener("wheel", onWheel, { passive: false });
    return () => button.removeEventListener("wheel", onWheel);
  }, [button]);

  const commit = () => {
    setEditing(false);
    const rule = pendingMode ?? (any ? (input ? "exact" : "at-least") : mode);
    const wasPending = pendingMode !== undefined;
    setPendingMode(undefined);
    const text = draft.trim();
    if (text === "") {
      if (target !== undefined) setStorageTarget(storage.id, undefined);
      return;
    }
    const value = parseAmountWithSuffix(text);
    // Not a number, or a number this rule cannot mean: the box keeps what it
    // held. The board shows magnitudes; the direction is the drawer's.
    if (value === undefined || !Number.isFinite(value) || value < 0) return;
    if (value === 0 && rule !== "exact" && rule !== "at-most") return;
    const perSecond = value / rateMultiplierForKind(kind);
    if (any || wasPending) setStorageRule(storage.id, rule, perSecond);
    else setStorageTarget(storage.id, perSecond);
  };
  const clear = (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    setEditing(false);
    setPendingMode(undefined);
    if (target !== undefined) setStorageTarget(storage.id, undefined);
  };
  const unit = rateSuffixForKind(kind).trim();

  return (
    <div
      ref={rootRef}
      // While the list is open no hover tooltip may cover it.
      data-tooltip-stop={open ? "" : undefined}
      className="storage-rule-row nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      // Its own controls: a click or right click here is not a browse.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    >
      <button
        ref={setButton}
        type="button"
        // No tooltip over the rule button at all: the ▾ explains it, and a
        // tip that is already up when the list opens would sit on the list.
        data-tooltip-stop
        className={`storage-rule-button nowheel ${any ? "storage-rule-button--any" : ""} ${open ? "storage-rule-button--open" : ""}`}
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Rule: ${RULE_NAME[shownMode]}. Click to choose.`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {RULE_MARK[shownMode]}
        <ChevronDown aria-hidden />
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setPendingMode(undefined);
              setEditing(false);
            }
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
          onAuxClick={clear}
          inputMode="decimal"
          placeholder={flowing > 0 ? draftFor(flowing, kind) : "rate"}
          aria-label="Your rate"
          className="storage-rate-field storage-rate-field--editing nodrag"
        />
      ) : (
        <MinecraftTooltip content={() => <RecipeTooltip view={buildRatePlateTooltip(storage, result, input, net, any ? undefined : mode)} />}>
        <button
          type="button"
          className={[
            "storage-rate-field",
            any ? "storage-rate-field--empty" : "",
            any && ask ? "storage-rate-field--ask animate-pulse" : "",
            !any && unreachable ? "storage-rate-field--bad" : "",
          ].join(" ")}
          disabled={locked}
          onClick={(event) => {
            event.stopPropagation();
            beginEdit(any ? undefined : target);
          }}
          onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
          onAuxClick={clear}
          aria-label={any ? "Your rate: none. Click to type one." : `Your rate: ${formatFieldNumber(target!, kind)} ${unit}. Click to change it.`}
        >
          <span className="storage-rate-field-number">{any ? "rate?" : formatFieldNumber(target!, kind)}</span>
          <span className="storage-rate-field-unit">{unit}</span>
        </button>
        </MinecraftTooltip>
      )}
      {open ? (
        <div role="listbox" aria-label="Rule" data-tooltip-stop className="storage-rule-list nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
          {RULE_STEPS.map((rule) => (
            <button
              key={rule}
              type="button"
              role="option"
              aria-selected={rule === shownMode}
              className={`storage-rule-option ${rule === shownMode ? "storage-rule-option--on" : ""} ${rule === "ignore" ? "storage-rule-option--any" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                choose(rule);
              }}
            >
              <b>{RULE_MARK[rule]}</b>
              {RULE_NAME[rule]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How far the real rate has got toward your rate, drawn like the machine
 * card's port bars: green once met, red when it can't be, steel on an At
 * most limit (the share of the allowance in use). No bar on Any. */
function RuleBar({
  storage,
  role,
  result,
  net,
}: {
  storage: FactoryStorage;
  role: StorageRole;
  result: StorageThroughputResult | undefined;
  net: number;
}) {
  const { mode, target, any } = useDrawerRule(storage, role);
  if (any || target === undefined || Math.abs(target) === 0) return null;
  const share = Math.min(1, Math.abs(net) / Math.abs(target));
  const tone = result?.targetUnreachable ? "bad" : mode === "at-most" ? "calm" : "ok";
  return (
    <span className="storage-rate-bar" aria-hidden>
      <i data-tone={tone} style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/**
 * The drawer hover: which of the four jobs this card is doing, why it is that
 * one, and the three rates.
 *
 * It used to list every feeder and every drainer by name with its own rate,
 * which on a busy tank was a dozen lines of table hanging off a card whose own
 * face already carries the net. Those wires are on the board; the thing only
 * the hover can tell you is which job the drawer has and what decided it.
 */
function renderStorageHoverContent(storage: FactoryStorage, role: StorageRole): ReactNode {
  const { project, lastResult } = useFactoryStore.getState();
  return <RecipeTooltip view={buildStorageTooltip(project, lastResult, storage, role)} />;
}

function storageMatchesSearch(storage: FactoryStorage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${storage.displayName ?? ""} ${storage.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function formatCompactRate(value: number, kind: string): string {
  const scaled = value * rateMultiplierForKind(kind);
  const unit = rateSuffixForKind(kind).trimStart();
  if (kind === "power") return `${formatPowerValue(scaled)} ${unit}`;
  const abs = Math.abs(scaled);

  // The floor is written per second and scaled with the unit, so "balanced"
  // still reads as a flat 0 while a real trickle keeps its digits per tick.
  const spaced = unit.startsWith("L") || unit.startsWith("EU") || unit.startsWith("A ");
  if (!Number.isFinite(scaled) || abs < 0.005 * rateUnitPrecisionScale()) {
    return `0${spaced ? ` ${unit}` : unit}`;
  }
  const body =
    abs >= 1_000_000
      ? `${trimFlow(scaled / 1_000_000)}M`
      : abs >= 1_000
        ? `${trimFlow(scaled / 1_000)}k`
        : // Under 1 the two fixed decimals stop saying anything (every tick
          // reading would be 0.01 or 0.02), so fall back to the significant
          // digits the ports use.
          abs >= 1
          ? trimFlow(scaled)
          : formatCompact(scaled);
  return spaced ? `${body} ${unit}` : `${body}${unit}`;
}

function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimTrailingDecimalZeros(value.toFixed(decimals));
}
