"use client";

import { Handle, Position, useStoreApi, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeftRight, Pencil } from "lucide-react";
import type {
  FactoryStorage,
  StorageDrainMode,
  StorageThroughputResult,
} from "@/lib/model/types";
import { formatCompact, makeResourceKey, trimTrailingDecimalZeros } from "@/lib/model";
import { isDrainRole, type StorageRole } from "@/lib/model/storage-role";
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
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useBoardView } from "./board-view";
import { MotionNumberText } from "./board-motion";
import { formatSlotRate } from "./flow-explainers";
import { makeResourceHandleId } from "./resource-handles";
import { useRenderedHandles } from "./use-rendered-handles";
import { canonicalizeResourceHandleId } from "@/lib/model/edge-identity";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";
import { hasAnySolveNumbers } from "@/lib/solver/throughput";

/**
 * The flow neighbourhood a drawer hover lights up: every wire ON this drawer,
 * the far-end port of each wire, and the nodes those wires reach. The mirror
 * of `buildPortFlowScope` in RecipeNode.tsx, because a drawer IS a port - it
 * holds one resource and the card is the row.
 *
 * It used to light every wire and card on the board carrying the drawer's
 * resource, wired to this drawer or not, and breathe while it did. Asking
 * "where does THIS drawer's copper go" is not asking where copper appears.
 */
function buildStorageFlowScope(storage: FactoryStorage) {
  const { project } = useFactoryStore.getState();
  const resource = { kind: storage.kind, id: storage.resourceId };
  const edges: Record<string, true> = {};
  const nodes: Record<string, true> = { [storage.id]: true };
  // The drawer's own two handles: whatever side a wire arrives on, the card is
  // the port it arrives at, so it wears the port rim rather than the quieter
  // node one.
  const ports: Record<string, true> = {
    [`${storage.id}|${makeResourceHandleId("input", resource)}`]: true,
    [`${storage.id}|${makeResourceHandleId("output", resource)}`]: true,
  };
  for (const edge of project.edges) {
    const leavesHere = edge.source === storage.id;
    const arrivesHere = edge.target === storage.id;
    if (!leavesHere && !arrivesHere) {
      continue;
    }
    edges[edge.id] = true;
    const otherId = leavesHere ? edge.target : edge.source;
    nodes[otherId] = true;
    const rawOtherHandle = leavesHere ? edge.targetHandle : edge.sourceHandle;
    const otherHandle =
      canonicalizeResourceHandleId(rawOtherHandle) ??
      makeResourceHandleId(leavesHere ? "input" : "output", {
        kind: edge.resourceKind,
        id: edge.resourceId,
      });
    ports[`${otherId}|${otherHandle}`] = true;
  }
  return { edges, ports, nodes };
}

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
  { word: string; boundary: boolean; line: string }
> = {
  source: {
    word: "SOURCE",
    boundary: true,
    line: "Never runs out. Counts as an import.",
  },
  product: {
    word: "PRODUCT",
    boundary: true,
    line: "Pulls its machine flat out. The plan's output.",
  },
  byproduct: {
    word: "BYPRODUCT",
    boundary: true,
    line: "Catches what is left over. Asks for nothing.",
  },
  trash: {
    word: "TRASH",
    boundary: true,
    line: "Voids what arrives. Asks for nothing.",
  },
  buffer: {
    word: "BUFFER",
    boundary: false,
    line: "Passes on what is pulled. Extra piles up here.",
  },
  idle: {
    word: "STORAGE",
    boundary: false,
    line: "Unwired. Feed it, draw from it, or both.",
  },
};

/** The strict-buffer line, swapped in for ROLE_PRESENTATION.buffer.line. */
const STRICT_BUFFER_LINE = "Passes on what is pulled. Extra backs up the machine.";

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

function storageTint(storage: Pick<FactoryStorage, "kind" | "colorTag">, role: StorageRole): string {
  if (storage.colorTag) {
    return GT_NODE_COLORS[storage.colorTag].swatch;
  }
  if (storage.kind === "power") {
    return POWER_STORAGE_TINT;
  }
  return ROLE_TINTS[role];
}

const ROLE_TINTS: Record<StorageRole, string> = {
  source: "#ef4444",
  product: "#10b981",
  byproduct: "#10b981",
  // A bin is neither an import nor a shipment: dull steel, like the plumbing.
  trash: "#8a93a6",
  buffer: "#8a93a6",
  idle: "#5d6877",
};

/** Which of the two buffer behaviours this drawer runs (absent is overflow). */
function isStrictBuffer(storage: FactoryStorage): boolean {
  return storage.bufferMode === "strict";
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
const CARD_ICON_PX = 36;
/**
 * Plain-fluid swatches draw edge to edge — no baked-in margin like item
 * sprites — so undiluted they brush right up against the header above and the
 * net line below. Shrink only them; items keep the full box.
 */
const FLUID_BREATHE_PX = 6;
/** Oversized glance icon (zoomed out) — a shade larger than the card FACE so
    it reads as the node's identity, but well inside the 100px card: at 128
    and even 112 the art swamped the card instead of riding it. */
const GLANCE_ICON_PX = 88;

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
  const reactFlowStore = useStoreApi();
  // The invisible wire handles blanket the card body, and React Flow does not
  // select a node for clicks that land on a handle - so a plain click (no
  // drag) selects explicitly, keeping Delete-to-remove reachable for tanks.
  const selectOnHandleClick = () => {
    reactFlowStore.getState().addSelectedNodes([storage.id]);
  };
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
    return hasIn
      ? hasOut
        ? "buffer"
        : storage.drainMode === "byproduct"
          ? "byproduct"
          : storage.drainMode === "trash"
            ? "trash"
            : "product"
      : hasOut
        ? "source"
        : "idle";
  });
  const solveMode = useFactoryStore((state) => state.project.solveMode === true);
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
  const title = storage.displayName ?? storage.resourceId;
  const isTank = storage.kind === "fluid";
  const isPlainFluid = isTank && !storage.iconPath && !storage.iconAtlas;
  // The card wears its JOB's colour, the same dialect the side panel already
  // speaks: red is what the plan imports (NEED), blue is what it is for
  // (PRODUCTS), green is what it also makes (BYPRODUCTS), steel is internal
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

  return (
    <div
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      className={[
        "group relative text-[#e8e9ee]",
        (isFlowScopeLit || isFlowScopePort) && !isHighlighted ? "flow-scope-glow" : "",
        isHighlighted ? "resource-glow" : "",
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
          // Five cells by four, fixed. Wires dock on the card's perimeter, so
          // an off-grid edge would mean off-grid endpoints. A drawer is a
          // TILE: silhouette and colour for the role, the word to say it in
          // letters, icon for the item, net rate for the news.
          "storage-node-card relative flex h-[80px] w-[100px] flex-col p-1",
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
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            showAmount={false}
            bare
            iconPixelSize={storageIconPixelSize(GLANCE_ICON_PX, storage)}
            className="!h-[88px] !w-[88px]"
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
        {/* The content carries the SAME silhouette as the frame. Without it
            the header and the mode button paint their own square backgrounds
            straight through the cut corners, and the card reads as a rectangle
            wearing an octagon. The glance icon stays outside this wrapper on
            purpose: it is deliberately bigger than the card and spills past
            the frame, which a clip would eat. */}
        {/* The hover tooltip covers the WHOLE card, header and buttons
            included: it is the drawer's one explanation, and it should not
            matter which pixel of a small tile the pointer found. The span is
            display:contents, so the flex column underneath lays out as if it
            were not there. */}
        <MinecraftTooltip content={() => renderStorageHoverContent(storage, role)}>
        <div
          data-storage-shape={role}
          className="storage-shape-content relative z-10 flex min-h-0 flex-1 flex-col"
        >
          {/* Which of the two buffers this is, readable at a glance without
              the hover: a catching buffer wears a thick dashed ring TRACING
              its hexagon tight inside the frame, while a STRICT one is solid
              border and nothing else. An SVG rather than a CSS border,
              because a border follows the element's box and only a path can
              follow the silhouette. It sits UNDER the header, the word and
              the numbers (z-0): the chrome reads on top, and the ring shows
              wherever the tile is bare. The coordinates are the 100x80
              tile's hexagon inset by 1.5px - hugging the frame, so the
              stroke stays off the word and the net line - and they can be
              exact because STORAGE_NODE_WIDTH/HEIGHT are fixed. */}
          {role === "buffer" && !isStrictBuffer(storage) ? (
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0"
              viewBox="0 0 100 80"
              width="100%"
              height="100%"
            >
              <polygon
                points="15.1,1.5 84.9,1.5 98.4,40 84.9,78.5 15.1,78.5 1.6,40"
                fill="none"
                stroke={tint}
                strokeWidth={3}
                strokeDasharray="7 5.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          ) : null}
          <StorageHeader storage={storage} isTank={isTank} tint={tint} role={role} />
          {/* Everything under the header is the wire zone: drag from the
              left or right half to pull a wire. The header is plain card,
              so grabbing it (or the frame) moves the node. The handles
              carry inline styles pinned to this box; stylesheet !important
              wars once let them blanket the whole card and swallow the
              header buttons.
              The zone is also the resource-hover trigger — the ITEM lights
              the flow, not the card around it. Wiring is a mode; a held
              wire must not also be lighting up cards. */}
          <div
            className="relative mx-auto flex min-h-0 w-full flex-1 flex-col"
            onMouseEnter={() =>
              isWiringConnection() ? undefined : setHoveredFlowScope(buildStorageFlowScope(storage))
            }
            onMouseLeave={() => setHoveredFlowScope(undefined)}
          >
            {/* The whole well, one grab point. Typed as a source so a drag can
                START anywhere on it; the board runs in ConnectionMode.Loose,
                so a wire coming the other way still lands here, and the drop
                resolves a drawer by direction rather than by which element the
                pointer happened to be over (getStorageHandleAtPosition). */}
            <Handle
              id={outputHandleId}
              type="source"
              position={Position.Right}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={outputHandleId}
              onClick={selectOnHandleClick}
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
            {/* No wood face, no glass box: the dark tinted card IS the
                surface, and the item fills nearly the whole well. */}
            <div className="grid min-h-0 w-full flex-1 place-items-center">
              <ResourceIcon
                resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                showAmount={false}
                bare
                iconPixelSize={storageIconPixelSize(
                  isPlainFluid ? CARD_ICON_PX - FLUID_BREATHE_PX : CARD_ICON_PX,
                  storage,
                )}
                className="!h-[36px] !w-[36px]"
              />
            </div>
            {solveMode && role === "product" ? (
              <TargetLine storage={storage} result={result} />
            ) : (
              <NetLine net={net} kind={storage.kind} role={role} />
            )}
          </div>
        </div>
        </MinecraftTooltip>
      </div>
    </div>
  );
}

/**
 * The tile's LOOK alone - silhouette, role tint, header, icon, net line -
 * for anything that must show a drawer that is not (yet) a node: the
 * void-drop ghost previews the exact drawer a release would spawn with it.
 * Built from the same parts as the real card (StorageHeader, NetLine,
 * ResourceIcon, the storage-shape layers), so the preview can never drift
 * from the thing it predicts. No handles, no glance, no tooltip, no washes:
 * those belong to the node.
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
  const isTank = storage.kind === "fluid";
  const isPlainFluid = isTank && !storage.iconPath && !storage.iconAtlas;
  const tint = storageTint(storage, role);
  const borderColor = `color-mix(in srgb, ${tint} 55%, #262b34)`;
  return (
    <div className="storage-node-card relative flex h-[80px] w-[100px] flex-col p-1 text-[#e8e9ee]">
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
      >
        <StorageHeader storage={storage} isTank={isTank} tint={tint} role={role} />
        <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col">
          <div className="grid min-h-0 w-full flex-1 place-items-center">
            <ResourceIcon
              resource={{ ...storage, id: storage.resourceId, amount: 1 }}
              showAmount={false}
              bare
              iconPixelSize={storageIconPixelSize(
                isPlainFluid ? CARD_ICON_PX - FLUID_BREATHE_PX : CARD_ICON_PX,
                storage,
              )}
              className="!h-[36px] !w-[36px]"
            />
          </div>
          <NetLine net={net} kind={storage.kind} role={role} />
        </div>
      </div>
    </div>
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
 * The room it has depends on the SILHOUETTE, not the box: the tile's
 * clip-path cuts its children too, and the shield's tapered base and the
 * hexagon's points bite exactly the row this line sits on. Each role's width
 * is the shape's clearance at the line's own height, worked from the
 * polygons in globals.css over the fixed 100x80 tile.
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

function rateFitClass(label: string, role: StorageRole): string {
  const width = NET_LINE_WIDTH_BY_ROLE[role];
  for (const step of NET_LINE_FIT_STEPS) {
    if (label.length * step.perChar <= width) {
      return step.className;
    }
  }
  return NET_LINE_FIT_STEPS[NET_LINE_FIT_STEPS.length - 1].className;
}

/** The tile's one line of news: the net rate, sized to fit its silhouette. */
function NetLine({ net, kind, role }: { net: number; kind: string; role: StorageRole }) {
  // The fit class and the colour read the TARGET value: the size and tone
  // land immediately, and only the digits ease their way there.
  const label = `${net >= 0 ? "+" : ""}${formatCompactRate(net, kind)}`;
  return (
    <div
      className={[
        // No "Net" word: the sign and the colour already say it, and
        // the number is the thing worth reading.
        "storage-net-line relative z-10 h-4 whitespace-nowrap text-center font-bold leading-4 tabular-nums",
        rateFitClass(label, role),
        net > 0.005 ? "text-[#7ede96]" : net < -0.005 ? "text-[#ff9191]" : "text-[#a8afbb]",
      ].join(" ")}
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

/**
 * "2.5k" is a number: metric shorthand for the rate field, k / m / g for
 * thousand, million, billion, either case, spaces and commas forgiven.
 * Anything else is not a number and the caller falls back rather than guess.
 */
/** The mirror: a committed value is SHOWN in the same shorthand it was
 * typed in - 10000 reads back as 10k, never expanded under your cursor. */
function formatAmountWithSuffix(value: number): string {
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
    .match(/^([0-9]*\.?[0-9]+)\s*([kmg]?)$/);
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
function TargetLine({
  storage,
  result,
}: {
  storage: FactoryStorage;
  result: StorageThroughputResult | undefined;
}) {
  const setStorageTarget = useFactoryStore((state) => state.setStorageTarget);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const target = storage.targetPerSecond;
  const unreachable = result?.targetUnreachable === true;
  // While the solver has NOTHING to solve for - no amount, no pin, anywhere -
  // every empty rate line blinks the ask, in step with the board's notice.
  const askBlink = useFactoryStore((state) => !hasAnySolveNumbers(state.project));
  const beginEdit = () => {
    setDraft(
      target !== undefined && target > 0
        ? formatAmountWithSuffix(target * rateMultiplierForKind(storage.kind))
        : "",
    );
    setEditing(true);
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
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      // Not a number: the field falls back to what it held.
      return;
    }
    setStorageTarget(storage.id, value / rateMultiplierForKind(storage.kind));
  };

  if (!editing) {
    return (
      // The resting face IS the net line - the same component every other
      // tile draws, wrapped only to be clickable (z-40, over the wire
      // handles that blanket the well at z-30). Unreachable overrides the
      // line's own green with red from outside.
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
        onMouseDown={(event) => event.stopPropagation()}
        title={
          unreachable
            ? "No chain on the board can make this much at any machine count. Click to change it."
            : "Make at least this much. Click to type an amount; shorthand like 2.5k works."
        }
        aria-label="Required amount"
        className={[
          "nodrag group/target relative z-40 flex cursor-pointer justify-center hover:brightness-125",
          unreachable ? "[&_div]:!text-[#ff9191]" : "",
        ].join(" ")}
      >
        {/* Two marks say "this line takes typing", both attached to the
            NUMBER rather than parked at the tile's edge: a dotted
            underline in the value's own colour - the editable-value
            idiom - and a pencil riding the text's right shoulder. */}
        {/* Nudged up a couple of pixels so the dotted underline clears the
            tile's bottom edge instead of merging with it. */}
        <div className="relative -translate-y-[2px] underline decoration-dotted decoration-[1.5px] underline-offset-[3px]">
          {target !== undefined && target > 0 ? (
            <NetLine net={target} kind={storage.kind} role="product" />
          ) : (
            <div
              className={[
                "storage-net-line relative h-4 whitespace-nowrap text-center text-[12px] font-bold leading-4 tabular-nums",
                askBlink ? "animate-pulse text-[#a8afbb]" : "text-[#6b7280]",
              ].join(" ")}
            >
              rate?
            </div>
          )}
          <Pencil
            aria-hidden
            // Centred on the ink-and-underline block, not the line's box:
            // the glyphs sit low in it, so dead-centre floated the pencil.
            className="absolute left-full top-[calc(50%+2px)] ml-[2px] h-[11px] w-[11px] -translate-y-1/2 fill-current text-[#a8afbb] group-hover/target:text-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="storage-net-line relative z-40 flex h-4 items-center justify-center whitespace-nowrap text-center leading-none">
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
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        inputMode="decimal"
        placeholder="rate"
        aria-label="Required amount"
        className={[
          "nodrag h-4 w-[60px] border px-[3px] text-center text-[9px] font-bold tabular-nums outline-none",
          "bg-[#14171d] shadow-[inset_1px_1px_0_rgba(255,255,255,0.08),inset_-1px_-1px_0_rgba(0,0,0,0.5)]",
          "placeholder:font-normal placeholder:text-[#6b7280]",
          "focus:bg-[#1a1e26] focus:ring-1 focus:ring-cyan-400",
          "border-[#3a4150] text-[#e8e9ee] focus:border-cyan-700",
        ].join(" ")}
      />
    </div>
  );
}

function StorageHeader({
  storage,
  isTank,
  tint,
  role,
}: {
  storage: FactoryStorage;
  isTank: boolean;
  tint: string;
  role: StorageRole;
}) {
  const storageId = storage.id;
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const noun = isTank ? "tank" : "drawer";
  const presentation = ROLE_PRESENTATION[role];
  const strict = role === "buffer" && isStrictBuffer(storage);
  const word = strict ? "STRICT" : presentation.word;

  return (
    <div
      // relative z-40: the invisible wire handles (z-30) blanket the card,
      // and without a higher stacking position they swallow every click
      // aimed at the delete/clone buttons underneath.
      className="storage-node-header relative z-40 flex h-5 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]"
      style={{
        borderColor: `color-mix(in srgb, ${tint} 55%, #262b34)`,
        background: `color-mix(in srgb, ${tint} 32%, #0a0c10)`,
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          deleteStorage(storageId);
        }}
        className="board-edit-chrome nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
        title={`Delete ${noun}`}
        aria-label={`Delete ${noun}`}
      >
        {/* Drawn rather than a "-" glyph: at this size Monocraft's metrics
            baseline-align the hyphen low instead of centring it. */}
        <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
      </button>
      {/* The role, in letters, centred between the two buttons. Colour and
          silhouette say it too, but a word is the one channel nobody has to
          learn. The tile is five cells wide precisely so the longest word
          (BYPRODUCT) clears the buttons; truncate is the safety net, not the
          plan. No title here: the card-wide tooltip already explains it.
          The tapered shapes narrow their own header, so their word steps
          down a point to keep clear of the slopes.
          storage-node-word: calm mode leans on this hook too. */}
      <div
        className={[
          "storage-node-word pointer-events-none absolute inset-x-0 truncate text-center font-black tracking-[0.4px] text-[#e8e9ee] [text-shadow:1px_1px_0_rgba(0,0,0,0.65)]",
          role === "buffer" || role === "byproduct" ? "text-[7px]" : "text-[8px]",
        ].join(" ")}
      >
        {word}
      </div>
      {isDrainRole(role) ? (
        <DrainModeSwap storageId={storageId} role={role} kind={storage.kind} />
      ) : null}
      {role === "buffer" ? <BufferModeSwap storageId={storageId} strict={strict} /> : null}
    </div>
  );
}

/**
 * The one thing about a BUFFER you choose, worn as its own icon so the tile
 * SAYS which one it is: an arrow dropping into a tray while the tank catches
 * overflow, plain left-right arrows when it is a strict pass-through.
 * Clicking flips it.
 */
function BufferModeSwap({ storageId, strict }: { storageId: string; strict: boolean }) {
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const Icon = strict ? ArrowLeftRight : ArrowDownToLine;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        updateStorage(storageId, { bufferMode: strict ? "overflow" : "strict" });
      }}
      title={
        strict
          ? "Strict: extra backs up the machine. Click to let it pile up here."
          : "Overflow: extra piles up here. Click to back it up the machine instead."
      }
      aria-label={strict ? "Switch to overflow" : "Switch to strict"}
      aria-pressed={strict}
      className="board-edit-chrome nodrag relative z-40 ml-auto flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
    >
      <Icon aria-hidden className="h-2.5 w-2.5" />
    </button>
  );
}

/**
 * The one thing about a drawer you CHOOSE. Source and buffer are read off the
 * wiring and cannot be picked; which kind of end-of-the-line this is cannot be
 * read off anything, so it gets a control.
 *
 * A three-way cycle since 2026-08-23: product, byproduct, trash. The trash
 * step is what replaced the toolbar's separate trash can node.
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
  // Always the cycle arrows: the button is the CONTROL, and the tile's word
  // and silhouette already say which state it is in.
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

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setStorageDrainMode(storageId, next);
      }}
      title={
        role === "product"
          ? "Product: pulls the machine flat out. Click to make it a byproduct."
          : role === "byproduct"
            ? kind === "power"
              ? "Byproduct: catches what is left over. Click to make it a product."
              : "Byproduct: catches what is left over. Click to make it a trash bin."
            : "Trash: voids what arrives. Click to make it a product."
      }
      aria-label={`Switch to ${next}`}
      className="board-edit-chrome nodrag relative z-40 ml-auto flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
    >
      <ArrowLeftRight aria-hidden className="h-2.5 w-2.5" />
    </button>
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
  let inTotal = 0;
  let outTotal = 0;
  for (const edge of project.edges) {
    const rate = lastResult?.edges[edge.id]?.transferredPerSecond ?? 0;
    if (edge.target === storage.id) {
      inTotal += rate;
    } else if (edge.source === storage.id) {
      outTotal += rate;
    }
  }
  const net = inTotal - outTotal;
  const presentation = ROLE_PRESENTATION[role];
  const strict = role === "buffer" && isStrictBuffer(storage);
  const rate = (value: number) => formatSlotRate(value, storage.kind);

  // The three figures never wrap mid-number: the box grows to hold them, and
  // past its cap the NUMBERS give up size instead - same rule as the tile.
  const inLabel = `In ${rate(inTotal)}`;
  const outLabel = `Out ${rate(outTotal)}`;
  const netLabel = `${net >= 0 ? "+" : ""}${rate(net)}`;
  const rateLength = inLabel.length + outLabel.length + netLabel.length;
  const rateSize = rateLength <= 34 ? "text-[12px]" : rateLength <= 44 ? "text-[11px]" : "text-[10px]";

  return (
    <div className="w-max min-w-56 max-w-80">
      <div className="text-[13px] font-semibold text-white">
        {storage.displayName ?? storage.resourceId}
        <span className="ml-1.5 text-[11px] font-bold text-slate-400">
          {strict ? "STRICT" : presentation.word}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-300">
        {strict ? STRICT_BUFFER_LINE : presentation.line}
      </p>
      <div
        className={[
          "mt-1.5 flex items-baseline justify-between gap-3 border-t border-white/15 pt-1 text-slate-300",
          rateSize,
        ].join(" ")}
      >
        <span className="whitespace-nowrap">{inLabel}</span>
        <span className="whitespace-nowrap">{outLabel}</span>
        <span
          className={[
            "whitespace-nowrap font-semibold tabular-nums",
            net > 0.005 ? "text-emerald-300" : net < -0.005 ? "text-red-300" : "text-slate-200",
          ].join(" ")}
        >
          {netLabel}
        </span>
      </div>
    </div>
  );
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
