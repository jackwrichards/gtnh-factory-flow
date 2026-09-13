"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowUpRight, ChevronDown, ChevronUp, Factory, Split, X } from "lucide-react";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import type { ResourceAmount } from "@/lib/model/types";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { getStorageRoles, type StorageRole } from "@/lib/model/storage-role";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import {
  machineIconAtTier,
  useMachineHandlerIconEntries,
  useRecipeMapIcons,
} from "./machine-icons";
import {
  getStorageRatioBranches,
  ratioExportShare,
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
  const equalize = useFactoryStore((s) => s.equalizeRatioBranches);
  const machineIcons = useMachineHandlerIconEntries();
  const mapIcons = useRecipeMapIcons();
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
  const branches = useMemo(() => {
    const exported = ratioExportShare(storage);
    return [
      ...getStorageRatioBranches(project.edges.filter((e) => e.source === request.storageId)).map(
        (branch) => ({ ...branch, share: branch.share * (1 - exported) }),
      ),
      { targetId: "", edges: [], weight: exported * 100, share: exported },
    ];
  }, [project.edges, request.storageId, storage]);
  const inputs = useMemo(
    () =>
      getStorageRatioBranches(
        project.edges.filter((edge) => edge.target === request.storageId),
        "input",
      ),
    [project.edges, request.storageId],
  );
  const peers = useMemo(() => {
    const recipes = new Map(project.recipes.map((r) => [r.id, r]));
    const roles = getStorageRoles(project);
    return new Map<string, { name: string; icon?: ResourceAmount; drawerRole?: StorageRole }>([
      ...project.nodes.map((node) => {
        const recipe = recipes.get(node.recipeId);
        const powerIcon = recipe?.power ? getPowerMachineIcon(recipe.power.sourceId) : undefined;
        const icon = powerIcon
          ? { ...powerIcon, kind: "item" as const }
          : recipe
            ? (machineIconAtTier(
                machineIcons.get(getSelectedMachineHandler(recipe, node).id),
                node.overclockTier,
              ) ?? mapIcons.get(recipe.source?.recipeMap ?? recipe.machineType))
            : undefined;
        return [
          node.id,
          {
            name: recipe
              ? getSelectedMachineHandler(recipe, node).label || recipe.machineType
              : "Machine",
            icon: icon ? { ...icon, amount: 1 } : undefined,
          },
        ] as const;
      }),
      ...(project.storages ?? []).map(
        (s) =>
          [
            s.id,
            {
              name:
                roles.get(s.id) === "buffer"
                  ? s.bufferMode === "ratio"
                    ? "Ratio"
                    : s.bufferMode === "strict"
                      ? "Strict"
                      : "Buffer"
                  : ({
                      source: "Source",
                      product: "Product",
                      byproduct: "Byproduct",
                      trash: "Trash",
                      idle: "Drawer",
                    }[roles.get(s.id) as Exclude<StorageRole, "buffer">] ?? "Drawer"),
              drawerRole: roles.get(s.id),
            },
          ] as const,
      ),
    ]);
  }, [project, machineIcons, mapIcons]);
  return createPortal(
    <dialog
      ref={rootRef}
      aria-label="Drawer split"
      data-ratio-editor
      data-tooltip-stop
      className="ui-zoom nodrag nopan nowheel fixed inset-0 m-auto max-h-[calc(88*var(--ui-vh))] w-[calc(100*var(--ui-vw)-32px)] max-w-sm flex-col overflow-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-49)] p-0 text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25),4px_4px_0_rgba(0,0,0,0.45)] open:flex backdrop:bg-transparent backdrop:[backdrop-filter:none]"
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
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold">
          {storage && (
            <ResourceIcon
              resource={{ ...storage, id: storage.resourceId, amount: 1 }}
              showAmount={false}
              tooltip={false}
              bare
              iconPixelSize={56}
              className="!h-7 !w-7 shrink-0"
            />
          )}
          <span className="truncate">{storage?.displayName ?? storage?.resourceId}</span>
          <Split aria-hidden className="h-4 w-4 shrink-0 text-[var(--mc-ink-muted)]" />
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
        {(
          [
            ["input", inputs],
            ["output", branches],
          ] as const
        ).map(([side, entries]) => (
          <section key={side} className="border-b-2 border-[var(--mc-15)] last:border-b-0">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--mc-36)] py-2">
              <h3 className="text-base font-bold text-[var(--mc-ink)]">
                {side === "input" ? "Incoming" : "Outgoing"}
              </h3>
              <button
                type="button"
                aria-label={`Equal split ${side === "input" ? "incoming" : "outgoing"}`}
                onClick={() => equalize(request.storageId, side)}
                disabled={entries.filter((branch) => branch.edges.length).length < 2}
                style={{ fontSize: 10, lineHeight: "14px" }}
                className="ml-auto h-5 border border-[var(--mc-15)] bg-[var(--mc-49)] px-1.5 text-[9px] font-normal text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)] disabled:opacity-40"
              >
                Equal split
              </button>
            </div>
            {entries.map((branch, index) => (
              <RatioBranchRow
                key={branch.edges.map((edge) => edge.id).join("|") || "export"}
                branch={branch}
                storageId={request.storageId}
                name={
                  !branch.edges.length
                    ? "Setup output"
                    : (peers.get(branch.targetId)?.name ?? "Machine")
                }
                icon={peers.get(branch.targetId)?.icon}
                drawerRole={peers.get(branch.targetId)?.drawerRole}
                index={index}
                side={side}
              />
            ))}
          </section>
        ))}
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
  side,
  icon,
  drawerRole,
}: {
  branch: StorageRatioBranch;
  storageId: string;
  name: string;
  index: number;
  side: "input" | "output";
  icon?: ResourceAmount;
  drawerRole?: StorageRole;
}) {
  const setPercentage = useFactoryStore((s) => s.setRatioBranchPercentage);
  const percentage = Number((branch.share * 100).toFixed(4));
  const [draft, setDraft] = useState(String(percentage));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const edgeId = branch.edges[0]?.id;
  const fieldLabel = branch.edges.length ? `${name} ${side} percentage` : "Setup output percentage";
  const step = (direction: number, shift: boolean) => {
    const parsed = Number(editing ? draft : percentage);
    const value = Math.min(
      100,
      Math.max(0, (Number.isFinite(parsed) ? parsed : percentage) + direction * (shift ? 10 : 1)),
    );
    setDraft(String(value));
    setEditing(false);
    setPercentage(storageId, edgeId, value, side);
  };
  const commit = (raw: string) => {
    const value = raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 100 && value !== percentage)
      setPercentage(storageId, edgeId, value, side);
    setEditing(false);
  };
  // Non-passive prevents native double-stepping and scrolling the dialog.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (event) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      step(event.deltaY < 0 ? 1 : -1, event.shiftKey);
    };
  });
  useEffect(() => {
    const input = inputRef.current;
    const wheel = (event: WheelEvent) => wheelRef.current(event);
    input?.addEventListener("wheel", wheel, { passive: false });
    return () => input?.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2 border-b border-[var(--mc-36)] py-1 last:border-b-0 ${!branch.edges.length ? "-mx-2 border-t border-t-[var(--flow-output)] bg-[color-mix(in_srgb,var(--flow-output)_10%,transparent)] px-2 text-[var(--flow-output)]" : ""}`}
    >
      <label
        htmlFor={`ratio-percentage-${side}-${index}`}
        className="flex min-w-0 items-center gap-2 text-xs"
      >
        <span
          aria-hidden
          className="pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center"
        >
          {!branch.edges.length ? (
            <ArrowUpRight className="h-4 w-4" />
          ) : drawerRole ? (
            <DrawerRoleIcon role={drawerRole} />
          ) : icon ? (
            <ResourceIcon
              resource={icon}
              showAmount={false}
              tooltip={false}
              bare
              iconPixelSize={64}
              className="!h-8 !w-8"
            />
          ) : (
            <Factory className="h-5 w-5 text-[var(--mc-ink-muted)]" />
          )}
        </span>
        <span className="min-w-0 break-words">{name}</span>
      </label>
      <div className="flex h-7 items-stretch overflow-hidden border-2 border-[var(--mc-15)] bg-[var(--mc-25)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--mc-ink-muted)]">
        <input
          ref={inputRef}
          id={`ratio-percentage-${side}-${index}`}
          aria-label={fieldLabel}
          type="text"
          role="spinbutton"
          inputMode="decimal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          title="Type or scroll the percentage"
          className="min-h-0 min-w-0 w-full border-0 bg-transparent p-0 pl-1 text-right text-xs tabular-nums outline-none"
          value={editing ? draft : String(percentage)}
          onFocus={() => {
            setDraft(String(percentage));
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
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              step(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
            }
          }}
        />
        <span aria-hidden className="flex items-center px-1 text-xs">
          %
        </span>
        <div className="grid w-4 shrink-0 grid-rows-2 border-l border-[var(--mc-15)] bg-[var(--mc-49)]">
          {[1, -1].map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={`${direction === 1 ? "Increase" : "Decrease"} ${fieldLabel}`}
              className="flex min-h-0 items-center justify-center p-0 hover:bg-[var(--mc-61)] first:border-b first:border-[var(--mc-15)]"
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => step(direction, event.shiftKey)}
            >
              {direction === 1 ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DrawerRoleIcon({ role }: { role: StorageRole }) {
  const color =
    role === "source"
      ? "var(--flow-input)"
      : role === "product" || role === "byproduct"
        ? "var(--flow-output)"
        : "#8a93a6";
  return (
    <Archive className="h-6 w-6" style={{ color }} strokeWidth={1.5} aria-hidden />
  );
}
