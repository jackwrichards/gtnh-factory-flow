"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { formatRate, makeResourceKey, trimTrailingDecimalZeros } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { makeResourceHandleId } from "./resource-handles";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";

export interface StorageNodeData extends Record<string, unknown> {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
}

export type StorageFlowNode = Node<StorageNodeData, "storageNode">;

function StorageNodeComponent({ data, selected }: NodeProps<StorageFlowNode>) {
  const { storage, result } = data;
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredStorageResourceKey = useFactoryStore(
    (state) => state.setHoveredStorageResourceKey,
  );
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
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
  const produced = result?.producedPerSecond ?? 0;
  const consumed = result?.consumedPerSecond ?? 0;
  const net = result?.netPerSecond ?? 0;
  const unit = storage.kind === "fluid" ? "L/s" : "/s";
  const title = storage.displayName ?? storage.resourceId;
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
      title={`${title}\nIn ${formatRate(produced, 3)}${unit}\nOut ${formatRate(consumed, 3)}${unit}\nNet ${net >= 0 ? "+" : ""}${formatRate(net, 3)}${unit}`}
    >
      {storage.kind === "fluid" ? (
        <FluidStorageCard
          storage={storage}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
          isHighlighted={isHighlighted || isSearchHighlighted}
          inputHandleId={inputHandleId}
          outputHandleId={outputHandleId}
        />
      ) : (
        <ItemStorageCard
          storage={storage}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
          isHighlighted={isHighlighted || isSearchHighlighted}
          inputHandleId={inputHandleId}
          outputHandleId={outputHandleId}
        />
      )}
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
  variant,
}: {
  storageId: string;
  title: string;
  variant: "tank" | "drawer";
}) {
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const label = variant === "tank" ? "Delete tank" : "Delete drawer";

  return (
    <div
      className={[
        "storage-node-header flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.55)]",
        variant === "tank" ? "border-[#747c91] bg-[#b8c1d9]" : "border-[#4f3518] bg-[#8a6030]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          deleteStorage(storageId);
        }}
        className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
        title={label}
        aria-label={label}
      >
        {/* Drawn rather than a "-" glyph: at this size Monocraft's metrics
            baseline-align the hyphen low instead of centring it. */}
        <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
      </button>
      <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
        {title}
      </div>
      {/* Balances the delete button so the title stays optically centred. */}
      <span aria-hidden className="h-4 w-4 shrink-0" />
    </div>
  );
}

function FluidStorageCard({
  storage,
  produced,
  consumed,
  net,
  unit,
  isHighlighted,
  inputHandleId,
  outputHandleId,
}: {
  storage: FactoryStorage;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  isHighlighted: boolean;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <div
      className={[
        "storage-node-card storage-node-card--tank w-[174px] border-2 border-[#565f72] bg-[#b9c2d4] p-1 shadow-[inset_2px_2px_0_#e8edf7,inset_-2px_-2px_0_#7b8497]",
        isHighlighted ? "brightness-125 saturate-150" : "",
      ].join(" ")}
    >
      <StorageHeader storageId={storage.id} title="Super Tank" variant="tank" />
      <div className="storage-node-body mx-auto mt-3 grid h-[96px] w-[132px] place-items-center border-2 border-[#1f1f1f] bg-black shadow-[inset_7px_7px_0_#1f2933,inset_-7px_-7px_0_#050505]">
        <div className="relative grid h-[64px] w-[64px] place-items-center bg-[#111]">
          <StorageEdgeAnchors
            nodeId={storage.id}
            inputHandleId={inputHandleId}
            outputHandleId={outputHandleId}
          />
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="!h-12 !w-12"
          />
        </div>
      </div>
      <StorageStats produced={produced} consumed={consumed} net={net} unit={unit} />
    </div>
  );
}

function ItemStorageCard({
  storage,
  produced,
  consumed,
  net,
  unit,
  isHighlighted,
  inputHandleId,
  outputHandleId,
}: {
  storage: FactoryStorage;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  isHighlighted: boolean;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <div
      className={[
        "storage-node-card w-[174px] border-2 border-[#2b1c0e] bg-[#8a6030] p-1 shadow-[inset_3px_3px_0_#ad7b3e,inset_-3px_-3px_0_#3e2a13]",
        isHighlighted ? "brightness-125 saturate-150" : "",
      ].join(" ")}
    >
      <StorageHeader storageId={storage.id} title="Drawer" variant="drawer" />
      <div className="storage-node-body mx-auto mt-3 grid h-[96px] w-[132px] place-items-center border-2 border-[#3a260f] bg-[#7a5427] shadow-[inset_7px_7px_0_#5a3b1b,inset_-7px_-7px_0_#4a3117]">
        <div className="relative grid h-[64px] w-[64px] place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
          <StorageEdgeAnchors
            nodeId={storage.id}
            inputHandleId={inputHandleId}
            outputHandleId={outputHandleId}
          />
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="!h-12 !w-12"
          />
        </div>
      </div>
      <StorageStats produced={produced} consumed={consumed} net={net} unit={unit} />
    </div>
  );
}

function StorageEdgeAnchors({
  nodeId,
  inputHandleId,
  outputHandleId,
}: {
  nodeId: string;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <>
      <Handle
        id={inputHandleId}
        type="target"
        position={Position.Left}
        data-resource-handle="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={inputHandleId}
        className="nodrag !absolute !bottom-0 !left-0 !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id={outputHandleId}
        type="source"
        position={Position.Right}
        data-resource-handle="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={outputHandleId}
        className="nodrag !absolute !bottom-0 !left-auto !right-0 !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={outputHandleId}
        className="pointer-events-none absolute inset-0"
      />
    </>
  );
}

function StorageStats({
  produced,
  consumed,
  net,
  unit,
}: {
  produced: number;
  consumed: number;
  net: number;
  unit: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 pt-2">
      <StorageStat label="In" value={formatCompact(produced, unit)} />
      <StorageStat label="Out" value={formatCompact(consumed, unit)} />
      <StorageStat label="Net" value={formatCompact(net, unit, { forceSign: true })} />
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

function StorageStat({ label, value }: { label: string; value: string }) {
  const valueTextStyle = getStorageStatTextStyle(value);

  return (
    <div className="storage-node-stat grid h-10 min-w-0 overflow-hidden border-2 border-[#707070] bg-[#bababa] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="h-[11px] truncate text-[8px] uppercase leading-[11px] text-[#424242]">
        {label}
      </div>
      <div
        className="block max-w-full overflow-hidden whitespace-nowrap text-center font-medium leading-[18px] text-[#111] tabular-nums"
        style={valueTextStyle}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function getStorageStatTextStyle(value: string): CSSProperties {
  const maxTextWidthPx = 42;
  const maxFontSizePx = 10;
  const minFontSizePx = 5;
  const estimatedGlyphWidthEm = 0.72;
  const estimatedTextWidthAtMaxSize = value.length * maxFontSizePx * estimatedGlyphWidthEm;
  const fontSize = Math.max(
    minFontSizePx,
    Math.min(maxFontSizePx, (maxTextWidthPx / estimatedTextWidthAtMaxSize) * maxFontSizePx),
  );

  return { fontSize: `${fontSize.toFixed(2)}px` };
}

function formatCompact(value: number, unit: string, options?: { forceSign?: boolean }) {
  const abs = Math.abs(value);
  const sign = options?.forceSign && value > 0 ? "+" : "";

  if (!Number.isFinite(value) || abs < 0.005) {
    return `0${unit}`;
  }

  if (abs >= 1_000_000) {
    return `${sign}${trimFlow(value / 1_000_000)}M${unit}`;
  }

  if (abs >= 1_000) {
    return `${sign}${trimFlow(value / 1_000)}k${unit}`;
  }

  return `${sign}${trimFlow(value)}${unit}`;
}

function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimTrailingDecimalZeros(value.toFixed(decimals));
}
