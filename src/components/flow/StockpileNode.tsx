"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Pencil } from "lucide-react";
import { memo } from "react";
import type { FactoryStockpile } from "@/lib/model/types";
import { STOCKPILE_SUPPLY_HANDLE } from "@/lib/planner/materialize";
import { resourceLabel } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";

export interface StockpileNodeData extends Record<string, unknown> {
  stockpile: FactoryStockpile;
  /** How many distinct resources currently flow out over edges. */
  tappedCount: number;
}

export type StockpileFlowNode = Node<StockpileNodeData, "stockpileNode">;

const VISIBLE_SLOTS = 11;

function StockpileNodeComponent({ data, selected }: NodeProps<StockpileFlowNode>) {
  const { stockpile, tappedCount } = data;
  const setEditingStockpile = useFactoryStore((state) => state.setEditingStockpile);
  const deleteStockpile = useFactoryStore((state) => state.deleteStockpile);
  const visible = stockpile.resources.slice(0, VISIBLE_SLOTS);
  const hiddenCount = stockpile.resources.length - visible.length;

  return (
    <div
      data-stockpile-node-id={stockpile.id}
      className={[
        "relative w-[196px] border-2 border-[#12301c] bg-[#2e5d3a] p-1 text-[#eafcf0] shadow-[inset_3px_3px_0_#4a8a5c,inset_-3px_-3px_0_#1c3a24]",
        selected ? "ring-2 ring-cyan-300" : "",
      ].join(" ")}
      title={`Stockpile — ${stockpile.resources.length} resources in abundance`}
    >
      <div className="flex h-6 items-center gap-1 border-b-2 border-[#1c3a24] bg-[#254c30] px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.25)]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteStockpile(stockpile.id);
          }}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
          title="Delete stockpile"
          aria-label="Delete stockpile"
        >
          <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
        </button>
        <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
          Stockpile
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditingStockpile(stockpile.id);
          }}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-33)]"
          title="Edit resources"
          aria-label="Edit stockpile resources"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>

      <div className="relative mt-1 min-h-[96px] border-2 border-[#1c3a24] bg-[#254c30] p-1 shadow-[inset_2px_2px_0_#1c3a24,inset_-2px_-2px_0_#356844]">
        <Handle
          id={STOCKPILE_SUPPLY_HANDLE}
          type="source"
          position={Position.Right}
          className="nodrag !absolute !bottom-0 !left-auto !right-0 !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
        />
        <span
          data-resource-edge-anchor="true"
          data-resource-node-id={stockpile.id}
          data-resource-handle-id={STOCKPILE_SUPPLY_HANDLE}
          className="pointer-events-none absolute inset-0"
        />
        {stockpile.resources.length === 0 ? (
          <div className="grid h-[88px] place-items-center px-2 text-center text-[11px] leading-4 text-[#b8e2c4]">
            Empty. Add everything you have in abundance.
          </div>
        ) : (
          <div className="pointer-events-none grid grid-cols-4 gap-1">
            {visible.map((resource) => (
              <span
                key={`${resource.kind}:${resource.id}`}
                className="grid h-10 w-10 place-items-center border-2 border-[#1c3a24] bg-[#d8ecd0] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#87a389]"
                title={resourceLabel(resource)}
              >
                <ResourceIcon
                  resource={{ ...resource, amount: 1 }}
                  size="sm"
                  showAmount={false}
                  bare
                  className="!h-8 !w-8"
                />
              </span>
            ))}
            {hiddenCount > 0 ? (
              <span className="grid h-10 w-10 place-items-center border-2 border-[#1c3a24] bg-[#356844] text-[11px] font-semibold text-[#eafcf0] shadow-[inset_1px_1px_0_rgba(255,255,255,0.25)]">
                +{hiddenCount}
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1 pt-1 text-[10px] uppercase leading-4 text-[#b8e2c4]">
        <span>{stockpile.resources.length} stocked</span>
        <span>{tappedCount} tapped</span>
      </div>
    </div>
  );
}

export const StockpileNode = memo(StockpileNodeComponent);
