"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Split } from "lucide-react";
import {
  formatRatioShare,
  getStorageRatioBranches,
  type StorageRatioBranch,
} from "@/lib/model/storage-ratios";
import { useFactoryStore } from "@/store/factory-store";
import { RATIO_EDITOR_EVENT, type RatioEditorRequest } from "./ratio-editor";
import { ratioColor } from "./storage-ratio-presentation";

/** One listener per board; closed drawers acquire no editor subscriptions. */
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
    <RatioPanel key={request.storageId} request={request} onClose={() => setRequest(undefined)} />
  ) : null;
});

function RatioPanel({ request, onClose }: { request: RatioEditorRequest; onClose: () => void }) {
  const project = useFactoryStore((s) => s.project);
  const readOnly = useFactoryStore((s) => s.isReadOnly || s.checklistMode);
  const storage = project.storages?.find((s) => s.id === request.storageId);
  const rootRef = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [projectId] = useState(project.id);
  const valid = Boolean(
    storage?.bufferMode === "ratio" && !readOnly && !project.poolMode && project.id === projectId,
  );
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  useEffect(() => {
    const dialog = rootRef.current;
    dialog?.showModal();
    // Open on Done, not a number field: phones should not launch a keyboard.
    doneRef.current?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, []);
  const close = () => {
    if (
      document.activeElement instanceof HTMLElement &&
      rootRef.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
    onClose();
  };
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
  return createPortal(
    <dialog
      ref={rootRef}
      aria-label="Drawer split"
      data-ratio-editor
      data-tooltip-stop
      className="ui-zoom nodrag nopan nowheel fixed inset-0 m-0 max-h-none max-w-none overflow-y-auto border-0 bg-[#10191e] p-0 text-[#e8f4f5] backdrop:bg-[#10191e]"
      style={{ width: "calc(100 * var(--ui-vw, 1vw))", height: "calc(100 * var(--ui-dvh, 1dvh))" }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-5 py-6 sm:px-10 sm:py-12">
        <header className="sticky top-0 z-10 mb-8 flex items-center justify-between gap-4 bg-[#10191e] py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Split aria-hidden className="h-7 w-7 shrink-0 text-cyan-200" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold">Split</h2>
              <p className="truncate text-xs text-slate-400">
                {storage?.displayName ?? storage?.resourceId}
              </p>
            </div>
          </div>
          <button
            ref={doneRef}
            type="button"
            onClick={close}
            className="shrink-0 rounded border border-cyan-200/50 bg-cyan-200/10 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-200/20 focus-visible:outline-2 focus-visible:outline-cyan-200"
          >
            Done
          </button>
        </header>
        <div aria-hidden className="mb-3 flex h-12 overflow-hidden rounded bg-white/5">
          {branches.map((branch, index) => (
            <div
              key={branch.targetId + index}
              className="flex min-w-0 items-center justify-center overflow-hidden text-sm font-bold text-[#10191e]"
              style={{ width: `${branch.share * 100}%`, background: ratioColor(index) }}
            >
              {branch.share >= 0.13 ? formatRatioShare(branch.share) : null}
            </div>
          ))}
        </div>
        <p className="mb-7 text-xs text-slate-400">Type or scroll the parts. Percentages follow.</p>
        <div className="flex flex-col gap-3">
          {branches.map((branch, index) => (
            <RatioBranchRow
              key={branch.edges.map((e) => e.id).join("|")}
              branch={branch}
              storageId={request.storageId}
              name={names.get(branch.targetId) ?? "Machine"}
              index={index}
            />
          ))}
        </div>
        {!branches.length ? (
          <p className="py-4 text-sm text-slate-400">Connect an output to set its share.</p>
        ) : branches.every((branch) => branch.share === 0) ? (
          <p className="mt-4 text-xs text-slate-400">All outputs closed.</p>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}

function RatioBranchRow({
  branch,
  storageId,
  name,
  index,
}: {
  branch: StorageRatioBranch;
  storageId: string;
  name: string;
  index: number;
}) {
  const setWeight = useFactoryStore((s) => s.setRatioBranchWeight);
  const [draft, setDraft] = useState(String(branch.weight));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = branch.edges.map((e) => e.id);
  const commit = (raw: string) => {
    const value = raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(value) && value >= 0) setWeight(storageId, ids, value);
    setEditing(false);
  };
  // Non-passive prevents native double-stepping and scrolling the dialog.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (event) => {
      if (event.deltaY === 0) return;
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
    return () => input?.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-x-4 gap-y-3 rounded border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-[minmax(0,1fr)_100px_90px]">
      <label
        htmlFor={`ratio-parts-${index}`}
        className="col-span-2 flex min-w-0 items-center gap-3 text-sm sm:col-span-1"
      >
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ background: ratioColor(index) }}
        />
        <span className="min-w-0 break-words">{name}</span>
      </label>
      <input
        ref={inputRef}
        id={`ratio-parts-${index}`}
        aria-label={`${name} parts`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        className="min-w-0 w-full rounded border border-white/20 bg-black/20 px-3 py-2 text-right text-base tabular-nums focus:outline-cyan-200"
        value={editing ? draft : String(branch.weight)}
        onFocus={() => {
          setDraft(String(branch.weight));
          setEditing(true);
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
      <output
        className="text-right text-base font-bold tabular-nums"
        style={{ color: ratioColor(index) }}
      >
        {formatRatioShare(branch.share)}
      </output>
    </div>
  );
}
