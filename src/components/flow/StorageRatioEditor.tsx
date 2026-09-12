"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  formatRatioShare,
  getStorageRatioBranches,
  type StorageRatioBranch,
} from "@/lib/model/storage-ratios";
import { useFactoryStore } from "@/store/factory-store";
import { RATIO_EDITOR_EVENT, type RatioEditorRequest } from "./ratio-editor";

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
    // Open on Close, not a number field: phones should not launch a keyboard.
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
      className="ui-zoom nodrag nopan nowheel fixed inset-0 m-auto max-h-[calc(88*var(--ui-vh))] w-[calc(100*var(--ui-vw)-32px)] max-w-sm flex-col overflow-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-49)] p-0 text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.45)] open:flex backdrop:bg-neutral-950/75 backdrop:backdrop-blur-sm compact:backdrop:[backdrop-filter:none]"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-[var(--mc-15)] px-4 py-2.5">
        <h2 className="min-w-0 truncate text-sm font-bold">
          Split · {storage?.displayName ?? storage?.resourceId}
        </h2>
        <button
          ref={doneRef}
          type="button"
          aria-label="Close"
          onClick={close}
          className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_76px_68px] gap-2 border-b border-[var(--mc-36)] py-2 text-[10px] text-[var(--mc-ink-muted)]">
          <span>Output</span>
          <span className="text-right">Parts</span>
          <span className="text-right">Share</span>
        </div>
        {branches.map((branch, index) => (
          <RatioBranchRow
            key={branch.edges.map((e) => e.id).join("|")}
            branch={branch}
            storageId={request.storageId}
            name={names.get(branch.targetId) ?? "Machine"}
            index={index}
          />
        ))}
        {!branches.length ? (
          <p className="py-3 text-xs text-[var(--mc-ink-muted)]">
            Connect an output to set its share.
          </p>
        ) : branches.every((branch) => branch.share === 0) ? (
          <p className="pb-3 text-xs text-[var(--mc-ink-muted)]">All outputs closed.</p>
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
    <div className="grid grid-cols-[minmax(0,1fr)_76px_68px] items-center gap-2 border-b border-[var(--mc-36)] py-3 last:border-b-0">
      <label htmlFor={`ratio-parts-${index}`} className="min-w-0 text-xs">
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
        title="Type or scroll parts"
        className="h-7 min-w-0 w-full border-2 border-[var(--mc-15)] bg-[var(--mc-25)] px-1 text-right text-xs tabular-nums focus:outline-[var(--mc-ink-muted)]"
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
      <output className="text-right text-xs font-bold tabular-nums">
        {formatRatioShare(branch.share)}
      </output>
    </div>
  );
}
