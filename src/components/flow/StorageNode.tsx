"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties, type ReactNode } from "react";
import { Copy } from "lucide-react";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { makeResourceKey, trimTrailingDecimalZeros } from "@/lib/model";
import { rateUnitMultiplier, rateUnitSuffix } from "@/lib/model/rate-unit";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useFactoryStore } from "@/store/factory-store";
import { formatSlotRate } from "./flow-explainers";
import { makeResourceHandleId } from "./resource-handles";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";

export interface StorageNodeData extends Record<string, unknown> {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
}

export type StorageFlowNode = Node<StorageNodeData, "storageNode">;

/**
 * What the buffer is actually DOING, from its wiring alone:
 * supply    = outputs only — an infinite source, nothing refills it
 * blackhole = inputs only — flow ends here and nothing draws it out
 * buffer    = both — a real pass-through buffer
 * idle      = unwired
 */
type StorageMode = "supply" | "blackhole" | "buffer" | "idle";

const MODE_BADGE: Record<StorageMode, { word: string; className: string }> = {
  supply: { word: "INFINITE SUPPLY", className: "bg-[#2f7a3d] text-white" },
  blackhole: { word: "INFINITE STORAGE", className: "bg-[#3f4652] text-white" },
  buffer: { word: "BUFFER", className: "bg-[#5f7f9c] text-white" },
  idle: { word: "UNWIRED", className: "bg-[#8a8a8a] text-white" },
};

function StorageNodeComponent({ data, selected }: NodeProps<StorageFlowNode>) {
  const { storage, result } = data;
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredStorageResourceKey = useFactoryStore(
    (state) => state.setHoveredStorageResourceKey,
  );
  const mode = useFactoryStore((state): StorageMode => {
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
    return hasIn ? (hasOut ? "buffer" : "blackhole") : hasOut ? "supply" : "idle";
  });
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  // Lit when a hovered port/label pulls this buffer into its flow scope.
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.nodes[storage.id]),
  );
  const isHighlighted =
    hoveredStorageResourceKey === resourceKey ||
    (hoveredFlowResourceKey ?? selectedFlowResourceKey) === resourceKey;
  const isSearchHighlighted = storageMatchesSearch(storage, recipeSearch);
  const storageColor = storage.colorTag ? GT_NODE_COLORS[storage.colorTag] : undefined;
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
  const net = result?.netPerSecond ?? 0;
  const title = storage.displayName ?? storage.resourceId;
  const isTank = storage.kind === "fluid";
  const inputHandleId = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const outputHandleId = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });

  return (
    <div
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      onMouseEnter={() => setHoveredStorageResourceKey(resourceKey)}
      onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
      className={[
        "group relative text-[#202020]",
        storageColor ? "storage-node-tinted" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isFlowScopeLit && !isHighlighted ? "ring-4 ring-cyan-300" : "",
        isHighlighted
          ? "outline outline-4 outline-offset-4 outline-yellow-300 ring-8 ring-cyan-300 [filter:drop-shadow(0_0_16px_rgba(34,211,238,0.95))]"
          : "",
      ].join(" ")}
      style={{
        ...(storageColor
          ? ({
              "--storage-node-tint": storageColor.panel,
              "--storage-node-tint-header": storageColor.header,
              "--storage-node-tint-border": storageColor.border,
            } as CSSProperties)
          : undefined),
        ...(paintCursor ? { cursor: paintCursor } : undefined),
      }}
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
        className={[
          "storage-node-card w-[132px] border-2 p-1",
          isTank
            ? "border-[#565f72] bg-[#b9c2d4] shadow-[inset_2px_2px_0_#e8edf7,inset_-2px_-2px_0_#7b8497]"
            : "border-[#2b1c0e] bg-[#8a6030] shadow-[inset_3px_3px_0_#ad7b3e,inset_-3px_-3px_0_#3e2a13]",
          isHighlighted || isSearchHighlighted ? "brightness-125 saturate-150" : "",
        ].join(" ")}
      >
        <StorageHeader storageId={storage.id} title={title} isTank={isTank} />
        <div
          className={[
            "mx-auto mt-1 w-max px-2 text-center text-[7px] font-black leading-[11px] tracking-[0.5px]",
            MODE_BADGE[mode].className,
          ].join(" ")}
        >
          {MODE_BADGE[mode].word}
        </div>
        <MinecraftTooltip content={renderStorageHoverContent(storage, mode)}>
          <div className="relative mx-auto mt-1.5">
            {/* Drag-to-wire from the body; header buttons stay clickable. */}
            <Handle
              id={inputHandleId}
              type="target"
              position={Position.Left}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={inputHandleId}
              className="nodrag !absolute !bottom-0 !left-0 !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
            />
            <Handle
              id={outputHandleId}
              type="source"
              position={Position.Right}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={outputHandleId}
              className="nodrag !absolute !bottom-0 !left-auto !right-0 !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
            />
            {isTank ? (
              // The original tank look — steel frame, dark glass well — just
              // tighter, with the fluid icon much larger inside it.
              <div className="mx-auto grid h-[84px] w-[112px] place-items-center border-2 border-[#1f1f1f] bg-black shadow-[inset_5px_5px_0_#1f2933,inset_-5px_-5px_0_#050505]">
                <ResourceIcon
                  resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                  size="sm"
                  showAmount={false}
                  bare
                  className="!h-16 !w-16"
                />
              </div>
            ) : (
              // The original drawer look — wood well, parchment face — tighter,
              // with the item icon much larger.
              <div className="mx-auto grid h-[84px] w-[112px] place-items-center border-2 border-[#3a260f] bg-[#7a5427] shadow-[inset_5px_5px_0_#5a3b1b,inset_-5px_-5px_0_#4a3117]">
                <div className="grid h-[72px] w-[72px] place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
                  <ResourceIcon
                    resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                    size="sm"
                    showAmount={false}
                    bare
                    className="!h-16 !w-16"
                  />
                </div>
              </div>
            )}
          </div>
        </MinecraftTooltip>
        <div
          className={[
            "mt-1 text-center text-[9px] font-bold leading-[13px] tabular-nums",
            net > 0.005 ? "text-[#1d5c2a]" : net < -0.005 ? "text-[#7c1d1d]" : "text-[#42424b]",
          ].join(" ")}
        >
          Net {net >= 0 ? "+" : ""}
          {formatCompactRate(net, storage.kind)}
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

function StorageHeader({
  storageId,
  title,
  isTank,
}: {
  storageId: string;
  title: string;
  isTank: boolean;
}) {
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const duplicateStorage = useFactoryStore((state) => state.duplicateStorage);
  const noun = isTank ? "tank" : "drawer";

  return (
    <div
      className={[
        "storage-node-header flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.55)]",
        isTank ? "border-[#747c91] bg-[#b8c1d9]" : "border-[#4f3518] bg-[#8a6030]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          deleteStorage(storageId);
        }}
        className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
        title={`Delete ${noun}`}
        aria-label={`Delete ${noun}`}
      >
        {/* Drawn rather than a "-" glyph: at this size Monocraft's metrics
            baseline-align the hyphen low instead of centring it. */}
        <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          duplicateStorage(storageId);
        }}
        className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
        title={`Clone ${noun}`}
        aria-label={`Clone ${noun}`}
      >
        <Copy aria-hidden className="h-2.5 w-2.5" />
      </button>
      <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
        {title}
      </div>
      {/* Balances the two buttons so the title stays optically centred. */}
      <span aria-hidden className="h-4 w-[36px] shrink-0" />
    </div>
  );
}

/**
 * The hover: in/out totals, every feeder and drainer by name and rate, and a
 * one-line reading of what this buffer IS right now. Rates live here instead
 * of on the card — the card only carries the net.
 */
function renderStorageHoverContent(storage: FactoryStorage, mode: StorageMode): ReactNode {
  const { project, lastResult } = useFactoryStore.getState();
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const storagesById = new Map((project.storages ?? []).map((entry) => [entry.id, entry]));
  const nameOf = (id: string): string => {
    const other = storagesById.get(id);
    if (other) {
      return `${other.displayName ?? other.resourceId} (buffer)`;
    }
    const node = nodesById.get(id);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    return recipe?.machineType ?? recipe?.name ?? "Machine";
  };

  const feeders: Array<{ name: string; rate: number }> = [];
  const drainers: Array<{ name: string; rate: number }> = [];
  let inTotal = 0;
  let outTotal = 0;
  for (const edge of project.edges) {
    const rate = lastResult?.edges[edge.id]?.transferredPerSecond ?? 0;
    if (edge.target === storage.id) {
      inTotal += rate;
      feeders.push({ name: nameOf(edge.source), rate });
    } else if (edge.source === storage.id) {
      outTotal += rate;
      drainers.push({ name: nameOf(edge.target), rate });
    }
  }
  feeders.sort((left, right) => right.rate - left.rate);
  drainers.sort((left, right) => right.rate - left.rate);
  const net = inTotal - outTotal;

  const modeLine =
    mode === "supply"
      ? "Infinite supply: nothing refills this — it hands out whatever is asked."
      : mode === "blackhole"
        ? "Infinite storage: nothing draws from this — everything sent here piles up."
        : mode === "buffer"
          ? "Buffer: fills from the left list, drains to the right one."
          : "Unwired — connect lines to use it.";

  const section = (label: string, rows: Array<{ name: string; rate: number }>) =>
    rows.length > 0 ? (
      <div className="mt-1.5 border-t border-white/15 pt-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        {rows.map((row, index) => (
          <div key={index} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-slate-300">{row.name}</span>
            <span className="shrink-0 tabular-nums text-slate-200">
              {formatSlotRate(row.rate, storage.kind)}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div className="w-60">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">In</span>
        <span className="font-semibold tabular-nums text-slate-200">
          {formatSlotRate(inTotal, storage.kind)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Out</span>
        <span className="font-semibold tabular-nums text-slate-200">
          {formatSlotRate(outTotal, storage.kind)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Net</span>
        <span
          className={[
            "font-semibold tabular-nums",
            net > 0.005 ? "text-emerald-300" : net < -0.005 ? "text-red-300" : "text-slate-200",
          ].join(" ")}
        >
          {net >= 0 ? "+" : ""}
          {formatSlotRate(net, storage.kind)}
        </span>
      </div>
      {section("Fed by", feeders)}
      {section("Drains to", drainers)}
      <p className="mt-1.5 border-t border-white/15 pt-1 text-[12px] leading-snug text-slate-300">
        {modeLine}
      </p>
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
  const scaled = value * rateUnitMultiplier();
  const unit = rateUnitSuffix(kind === "fluid").trimStart();
  const abs = Math.abs(scaled);

  if (!Number.isFinite(scaled) || abs < 0.005) {
    return `0${unit.startsWith("L") ? ` ${unit}` : unit}`;
  }
  const body =
    abs >= 1_000_000
      ? `${trimFlow(scaled / 1_000_000)}M`
      : abs >= 1_000
        ? `${trimFlow(scaled / 1_000)}k`
        : trimFlow(scaled);
  return unit.startsWith("L") ? `${body} ${unit}` : `${body}${unit}`;
}

function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimTrailingDecimalZeros(value.toFixed(decimals));
}
