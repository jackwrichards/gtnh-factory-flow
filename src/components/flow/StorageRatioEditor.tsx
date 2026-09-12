"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { getUiScale } from "@/lib/ui-scale";
import {
  formatRatioShare,
  getStorageRatioBranches,
  type StorageRatioBranch,
} from "@/lib/model/storage-ratios";
import type { StorageBufferMode } from "@/lib/model/types";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { formatSlotRate } from "./flow-explainers";
import { RATIO_EDITOR_EVENT, type RatioEditorRequest } from "./ratio-editor";

/** One listener per board; closed drawers and wires acquire no project subscription. */
export const StorageRatioEditor = memo(function StorageRatioEditor() {
  const [request, setRequest] = useState<RatioEditorRequest>();
  useEffect(() => {
    const open = (event: Event) => {
      const state = useFactoryStore.getState();
      if (!state.isReadOnly && !state.checklistMode)
        setRequest((event as CustomEvent<RatioEditorRequest>).detail);
    };
    window.addEventListener(RATIO_EDITOR_EVENT, open);
    return () => window.removeEventListener(RATIO_EDITOR_EVENT, open);
  }, []);
  return request ? (
    <RatioPanel
      key={`${request.storageId}:${request.edgeId ?? ""}`}
      request={request}
      onClose={() => setRequest(undefined)}
    />
  ) : null;
});

function RatioPanel({ request, onClose }: { request: RatioEditorRequest; onClose: () => void }) {
  const project = useFactoryStore((s) => s.project);
  const readOnly = useFactoryStore((s) => s.isReadOnly);
  const updateStorage = useFactoryStore((s) => s.updateStorage);
  const setScope = useFactoryStore((s) => s.setHoveredFlowScope);
  const storage = project.storages?.find((s) => s.id === request.storageId);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Element | null>(request.anchor);
  const close = () => {
    if (
      document.activeElement instanceof HTMLElement &&
      rootRef.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
    setScope(undefined);
    onClose();
  };
  useDropdownDismiss(true, { refs: [rootRef, anchorRef], onClose: close, fade: true });
  useEffect(() => () => setScope(undefined), [setScope]);
  const [position] = useState(() => {
    const rect = request.anchor.getBoundingClientRect();
    const scale = getUiScale();
    const width = Math.min(410, (window.innerWidth - 16) / scale);
    const above = window.innerHeight - rect.bottom < Math.min(300 * scale, rect.top - 8);
    return {
      width,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width * scale - 8)) / scale,
      top: above ? undefined : Math.max(8, rect.bottom + 6) / scale,
      bottom: above ? Math.max(8, window.innerHeight - rect.top + 6) / scale : undefined,
      maxHeight: Math.max(
        80,
        (above ? rect.top - 14 : window.innerHeight - rect.bottom - 14) / scale,
      ),
    };
  });
  const branches = useMemo(
    () => getStorageRatioBranches(project.edges.filter((e) => e.source === request.storageId)),
    [project.edges, request.storageId],
  );
  const names = useMemo(() => {
    const recipes = new Map(project.recipes.map((r) => [r.id, r]));
    return new Map([
      ...project.nodes.map((n) => [n.id, recipes.get(n.recipeId)?.name ?? "Machine"] as const),
      ...(project.storages ?? []).map(
        (s) =>
          [
            s.id,
            `${s.displayName ?? s.resourceId} ${s.kind === "fluid" ? "tank" : "drawer"}`,
          ] as const,
      ),
    ]);
  }, [project.nodes, project.recipes, project.storages]);
  if (!storage || readOnly || project.poolMode) return null;
  const mode = storage.bufferMode ?? "overflow";
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Drawer split"
      data-ratio-editor
      data-tooltip-stop
      className="ui-zoom nodrag nowheel fixed z-[300] overflow-y-auto border-2 border-[var(--mc-15)] bg-[var(--mc-49)] p-3 text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),2px_3px_6px_rgba(0,0,0,0.3)]"
      style={position}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-sm">
        <strong className="min-w-0 truncate">
          {storage.displayName ?? storage.resourceId} · split
        </strong>
        <button
          type="button"
          aria-label="Close split editor"
          onClick={close}
          className="shrink-0 p-1 hover:bg-[var(--mc-61)]"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mb-3 flex gap-1" aria-label="Drawer mode">
        {(
          [
            ["overflow", "Non-strict"],
            ["strict", "Strict"],
            ["ratio", "Ratio"],
          ] as [StorageBufferMode, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => updateStorage(storage.id, { bufferMode: value })}
            className={`border px-2 py-1 text-xs ${mode === value ? "border-cyan-300 bg-cyan-950 text-white" : "border-[var(--mc-25)] hover:bg-[var(--mc-61)]"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "ratio" ? (
        <>
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_90px_70px] gap-2 text-[10px] uppercase text-[var(--mc-ink-muted)]">
            <span>Outgoing wire</span>
            <span className="text-right">Parts</span>
            <span className="text-right">Share</span>
          </div>
          {branches.map((branch, index) => (
            <RatioBranchRow
              key={branch.edges.map((e) => e.id).join("|")}
              branch={branch}
              storageId={storage.id}
              name={names.get(branch.targetId) ?? "Machine"}
              index={index}
              focus={Boolean(request.edgeId && branch.edges.some((e) => e.id === request.edgeId))}
            />
          ))}
          {!branches.length ? (
            <p className="py-2 text-xs">Connect an outgoing wire to set its share.</p>
          ) : null}
          <p className="mt-3 text-[11px] text-[var(--mc-ink-muted)]">
            Type or scroll parts. Percentages update automatically.
          </p>
          <p className="mt-1 text-[11px] text-[var(--mc-ink-muted)]">
            {branches.length && branches.every((b) => b.share === 0)
              ? "All branches closed. Set a positive share to let flow through."
              : "A blocked branch holds the split. Surplus backs up."}
          </p>
        </>
      ) : (
        <p className="text-xs text-[var(--mc-ink-muted)]">
          {mode === "strict"
            ? "Passes through what downstream accepts. Surplus backs up."
            : "Stores surplus while supplying downstream machines."}
        </p>
      )}
    </div>,
    document.body,
  );
}

function RatioBranchRow({
  branch,
  storageId,
  name,
  index,
  focus,
}: {
  branch: StorageRatioBranch;
  storageId: string;
  name: string;
  index: number;
  focus: boolean;
}) {
  const setWeight = useFactoryStore((s) => s.setRatioBranchWeight);
  const setScope = useFactoryStore((s) => s.setHoveredFlowScope);
  const flow = useFactoryStore((s) =>
    branch.edges.reduce(
      (sum, edge) => sum + (s.lastResult?.edges[edge.id]?.transferredPerSecond ?? 0),
      0,
    ),
  );
  useRateDisplayUnits();
  const [draft, setDraft] = useState(String(branch.weight));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = branch.edges.map((e) => e.id);
  const commit = (raw: string) => {
    const value = raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(value) && value >= 0) setWeight(storageId, ids, value);
    setEditing(false);
  };
  // A native non-passive wheel listener prevents both number-input double
  // stepping and the board camera stealing the scroll gesture.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const parsed = Number(editing ? draft : branch.weight);
      const value = Math.max(
        0,
        (Number.isFinite(parsed) ? parsed : branch.weight) +
          (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 10 : 1),
      );
      setDraft(String(value));
      setEditing(false);
      setWeight(storageId, ids, value);
    };
  });
  useEffect(() => {
    const input = inputRef.current;
    const wheel = (event: WheelEvent) => wheelRef.current(event);
    input?.addEventListener("wheel", wheel, { passive: false });
    if (focus) {
      input?.focus({ preventScroll: true });
      input?.select();
    }
    return () => input?.removeEventListener("wheel", wheel);
  }, [focus]);
  const highlight = () =>
    setScope({
      edges: Object.fromEntries(ids.map((id) => [id, true as const])),
      nodes: { [storageId]: true, [branch.targetId]: true },
      ports: {},
    });
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_90px_70px] items-center gap-2 border-t border-[var(--mc-33)] py-2"
      onMouseEnter={highlight}
      onMouseLeave={() => setScope(undefined)}
    >
      <label htmlFor={`ratio-parts-${index}`} className="min-w-0 text-xs">
        <span className="block truncate" title={name}>
          {name}
        </span>
        <span className="mt-1 block text-[10px] text-[var(--mc-ink-muted)]">
          {formatSlotRate(flow, branch.edges[0].resourceKind)}
        </span>
      </label>
      <input
        ref={inputRef}
        id={`ratio-parts-${index}`}
        aria-label={`${name} parts`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        className="min-w-0 w-full border border-[var(--mc-25)] bg-[var(--mc-15)] px-1 py-1.5 text-right text-xs focus:outline-cyan-300"
        value={editing ? draft : String(branch.weight)}
        onFocus={() => {
          setDraft(String(branch.weight));
          setEditing(true);
          highlight();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setEditing(true);
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <output className="text-right text-xs tabular-nums">{formatRatioShare(branch.share)}</output>
    </div>
  );
}
