"use client";

import { memo, useEffect, useRef } from "react";
import {
  formatRatioShare,
  getProjectRatioBranches,
  ratioExportShare,
} from "@/lib/model/storage-ratios";
import { ArrowUpRight } from "lucide-react";
import { useFactoryStore } from "@/store/factory-store";
import type { RatioWireLabel as Label } from "./ratio-label-layout";

export const RatioWireLabel = memo(function RatioWireLabel({
  edgeId,
  label,
  shares,
}: {
  edgeId: string;
  label: Label & { point: { x: number; y: number } };
  shares: { input?: number; output?: number };
}) {
  const locked = useFactoryStore(
    (s) => s.isReadOnly || s.checklistMode || Boolean(s.project.poolMode),
  );
  const sides =
    label.key === "both" ? (["output", "input"] as const) : [label.key as "input" | "output"];
  return (
    <span
      data-ratio-edge={edgeId}
      data-ratio-side={label.key}
      className={`${locked ? "pointer-events-none" : "pointer-events-auto"} nodrag nopan nowheel absolute flex flex-col justify-center whitespace-pre text-center text-[10px] font-bold leading-[10px] text-[#20242b]`}
      style={{
        left: label.point.x,
        top: label.point.y,
        transform: "translate(-50%, -50%)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {sides.map((side, index) => (
        <WirePercentage
          key={side}
          edgeId={edgeId}
          side={side}
          text={label.text.split("\n")[index]}
          share={shares[side] ?? 0}
          locked={locked}
        />
      ))}
    </span>
  );
});

export function RatioSetupOutput({
  storageId,
  percentage,
}: {
  storageId: string;
  percentage: number;
}) {
  const locked = useFactoryStore(
    (s) => s.isReadOnly || s.checklistMode || Boolean(s.project.poolMode),
  );
  return (
    <span
      data-ratio-setup-output={storageId}
      data-tooltip-stop
      className="nodrag nopan nowheel relative z-40 flex h-5 items-center gap-0.5 border border-[var(--flow-output)]/40 bg-[var(--flow-output)]/10 px-1 text-[10px] font-bold leading-4 text-[var(--flow-output)]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ArrowUpRight aria-hidden className="h-3 w-3" />
      <WirePercentage
        storageId={storageId}
        side="export"
        text={formatRatioShare(percentage / 100)}
        share={percentage / 100}
        locked={locked}
      />
    </span>
  );
}

function adjust(
  edgeId: string | undefined,
  side: "input" | "output" | "export",
  delta: number,
  exportStorageId?: string,
) {
  // Read the current branch on each gesture, including rapid wheel events before React renders.
  const state = useFactoryStore.getState();
  if (state.isReadOnly || state.checklistMode || state.project.poolMode) return;
  if (side === "export") {
    const storage = state.project.storages?.find((storage) => storage.id === exportStorageId);
    if (storage)
      state.setRatioBranchPercentage(
        storage.id,
        undefined,
        Math.max(0, Math.min(100, ratioExportShare(storage) * 100 + delta)),
      );
    return;
  }
  const edge = state.project.edges.find((edge) => edge.id === edgeId);
  if (!edge) return;
  const storageId = side === "input" ? edge.target : edge.source;
  const branch = getProjectRatioBranches(state.project, side)
    .get(storageId)
    ?.find((branch) => branch.edges.some((edge) => edge.id === edgeId));
  if (!branch) return;
  state.setRatioBranchPercentage(
    storageId,
    edgeId,
    Math.max(0, Math.min(100, branch.share * 100 + delta)),
    side,
  );
}

function WirePercentage({
  edgeId,
  side,
  text,
  share,
  locked,
  storageId,
}: {
  edgeId?: string;
  storageId?: string;
  side: "input" | "output" | "export";
  text: string;
  share: number;
  locked: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || locked) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY)
        adjust(edgeId, side, (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 10 : 1), storageId);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [edgeId, side, locked, storageId]);
  return (
    <span
      ref={ref}
      data-ratio-control={side}
      role="spinbutton"
      tabIndex={locked ? -1 : 0}
      aria-label={`${side === "export" ? "Setup output" : side === "input" ? "Incoming" : "Outgoing"} percentage`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share * 100}
      aria-disabled={locked}
      className="relative block focus-visible:outline focus-visible:outline-1"
      onKeyDown={(event) => {
        if (locked || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        event.stopPropagation();
        adjust(
          edgeId,
          side,
          (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1),
          storageId,
        );
      }}
    >
      {text}
    </span>
  );
}
