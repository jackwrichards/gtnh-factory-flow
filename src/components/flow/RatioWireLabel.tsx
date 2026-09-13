"use client";

import { memo, useEffect, useRef } from "react";
import { getProjectRatioBranches } from "@/lib/model/storage-ratios";
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
      className={`${locked ? "pointer-events-none" : "pointer-events-auto"} nodrag nopan nowheel absolute whitespace-pre border-2 border-[var(--mc-15)] bg-[var(--mc-49)] px-1.5 py-1 text-[12px] font-bold leading-3 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25),2px_2px_0_rgba(0,0,0,0.45)]`}
      style={{ left: label.point.x, top: label.point.y, transform: "translate(-50%, -50%)" }}
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

function adjust(edgeId: string, side: "input" | "output", delta: number) {
  // Read the current branch on each gesture, including rapid wheel events before React renders.
  const state = useFactoryStore.getState();
  if (state.isReadOnly || state.checklistMode || state.project.poolMode) return;
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
}: {
  edgeId: string;
  side: "input" | "output";
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
        adjust(edgeId, side, (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 10 : 1));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [edgeId, side, locked]);
  return (
    <span
      ref={ref}
      data-ratio-control={side}
      role="spinbutton"
      tabIndex={locked ? -1 : 0}
      aria-label={`${side === "input" ? "Incoming" : "Outgoing"} percentage`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share * 100}
      aria-disabled={locked}
      title={locked ? undefined : "Scroll to adjust · Shift for 10%"}
      className={`block ${locked ? "" : "cursor-ns-resize hover:text-white focus-visible:outline focus-visible:outline-1"}`}
      onKeyDown={(event) => {
        if (locked || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        event.stopPropagation();
        adjust(edgeId, side, (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
      }}
    >
      {text}
    </span>
  );
}
