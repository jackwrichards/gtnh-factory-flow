"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Wand2 } from "lucide-react";
import { memo, useState } from "react";
import type { FactoryRequest } from "@/lib/model/types";
import { REQUEST_DEMAND_HANDLE } from "@/lib/planner/materialize";
import { formatRate, resourceLabel } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";

export const GAP_FILL_REQUEST_EVENT = "gtnh-flow.gap-fill-request";

export interface RequestNodeData extends Record<string, unknown> {
  request: FactoryRequest;
  fulfilledPerSecond: number;
  hasStockpile: boolean;
}

export type RequestFlowNode = Node<RequestNodeData, "requestNode">;

function RequestNodeComponent({ data, selected }: NodeProps<RequestFlowNode>) {
  const { request, fulfilledPerSecond, hasStockpile } = data;
  const deleteRequest = useFactoryStore((state) => state.deleteRequest);
  const updateRequest = useFactoryStore((state) => state.updateRequest);
  const [rateDraft, setRateDraft] = useState(String(request.amountPerSecond));
  const [syncedRate, setSyncedRate] = useState(request.amountPerSecond);

  // Adjust-during-render: when the stored rate changes (undo, apply, another
  // session), the draft resets without an effect-driven double render.
  if (syncedRate !== request.amountPerSecond) {
    setSyncedRate(request.amountPerSecond);
    setRateDraft(String(request.amountPerSecond));
  }

  const unit = request.kind === "fluid" ? "L/s" : "/s";
  const title = resourceLabel({ id: request.resourceId, displayName: request.displayName });
  const fulfillment =
    request.amountPerSecond > 0
      ? Math.min(1, fulfilledPerSecond / request.amountPerSecond)
      : 0;
  const isMet = fulfillment >= 0.999;

  const commitRate = () => {
    const parsed = Number.parseFloat(rateDraft.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== request.amountPerSecond) {
      updateRequest(request.id, { amountPerSecond: parsed });
      return;
    }

    setRateDraft(String(request.amountPerSecond));
  };

  return (
    <div
      data-request-node-id={request.id}
      className={[
        "relative w-[190px] border-2 border-[#241243] bg-[#4a2e7d] p-1 text-[#f0eaff] shadow-[inset_3px_3px_0_#6a4aa8,inset_-3px_-3px_0_#31205a]",
        selected ? "ring-2 ring-cyan-300" : "",
      ].join(" ")}
      title={`Request — ${title} at ${formatRate(request.amountPerSecond)}${unit}`}
    >
      <div className="flex h-6 items-center gap-1 border-b-2 border-[#31205a] bg-[#3b2566] px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.22)]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteRequest(request.id);
          }}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
          title="Delete request"
          aria-label="Delete request"
        >
          <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
        </button>
        <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
          Request
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            window.dispatchEvent(
              new CustomEvent(GAP_FILL_REQUEST_EVENT, { detail: { requestId: request.id } }),
            );
          }}
          disabled={!hasStockpile}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] enabled:hover:bg-cyan-700 disabled:opacity-40"
          title={
            hasStockpile
              ? "Auto-build a chain from your stockpile"
              : "Place a stockpile first to auto-build"
          }
          aria-label="Auto-build a chain from your stockpile"
        >
          <Wand2 className="h-2.5 w-2.5" />
        </button>
      </div>

      <div className="relative mt-1 border-2 border-[#31205a] bg-[#3b2566] p-2 shadow-[inset_2px_2px_0_#31205a,inset_-2px_-2px_0_#5a3d94]">
        <Handle
          id={REQUEST_DEMAND_HANDLE}
          type="target"
          position={Position.Left}
          className="nodrag !absolute !bottom-0 !left-0 !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
        />
        <span
          data-resource-edge-anchor="true"
          data-resource-node-id={request.id}
          data-resource-handle-id={REQUEST_DEMAND_HANDLE}
          className="pointer-events-none absolute inset-0"
        />
        <div className="pointer-events-none flex items-center gap-2">
          <span className="grid h-11 w-11 shrink-0 place-items-center border-2 border-[#241243] bg-[#e6ddf7] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#9a86bd]">
            <ResourceIcon
              resource={{
                kind: request.kind,
                id: request.resourceId,
                amount: 1,
                displayName: request.displayName,
                iconPath: request.iconPath,
                iconAtlas: request.iconAtlas,
                dominantColor: request.dominantColor,
              }}
              size="sm"
              showAmount={false}
              bare
              className="!h-9 !w-9"
            />
          </span>
          <span className="minecraft-title min-w-0 flex-1 truncate text-[13px] leading-4">
            {title}
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-1 px-0.5">
        <input
          type="text"
          inputMode="decimal"
          value={rateDraft}
          onChange={(event) => setRateDraft(event.target.value)}
          onBlur={commitRate}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
          className="nodrag h-6 w-0 min-w-0 flex-1 border-2 border-[#241243] bg-[#e6ddf7] px-1 text-right text-[12px] text-[#241243] shadow-[inset_1px_1px_0_#9a86bd] outline-none focus:border-cyan-400"
          aria-label="Requested rate"
        />
        <span className="shrink-0 text-[11px] text-[#cbb8ee]">{unit}</span>
      </div>

      <div className="mt-1 px-0.5 pb-0.5">
        <div className="h-2 border border-[#241243] bg-[#31205a]">
          <div
            className={isMet ? "h-full bg-emerald-400" : "h-full bg-amber-400"}
            style={{ width: `${Math.round(fulfillment * 100)}%` }}
          />
        </div>
        <div className="pt-0.5 text-right text-[10px] leading-3 text-[#cbb8ee]">
          {formatRate(fulfilledPerSecond)} / {formatRate(request.amountPerSecond)}
          {unit}
        </div>
      </div>
    </div>
  );
}

export const RequestNode = memo(RequestNodeComponent);
