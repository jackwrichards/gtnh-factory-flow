"use client";
import { SlidersHorizontal } from "lucide-react";
import type { FactoryStorage } from "@/lib/model/types";
import {
  storageTargetMode,
  targetModeHelp,
  TARGET_MODE_LABELS,
  type TargetMode,
} from "@/lib/model/storage-target";
import { useFactoryStore } from "@/store/factory-store";

/** One rate rule editor shared by the canvas and Pool. */
export function StorageTargetRule({
  storage,
  input,
  className = "",
  compact = false,
}: {
  storage: FactoryStorage;
  input: boolean;
  className?: string;
  compact?: boolean;
}) {
  const readOnly = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const setMode = useFactoryStore((state) => state.setStorageTargetMode);
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const options: TargetMode[] = ["at-least", "exact", "at-most", "ignore"];
  const select = (
    <select
      className={
        compact ? "absolute inset-0 h-full w-full cursor-pointer opacity-0 text-[12px]" : className
      }
      aria-label={"Target rule for " + (storage.displayName ?? storage.resourceId)}
      value={mode}
      disabled={readOnly}
      title={"Rate rule: " + TARGET_MODE_LABELS[mode] + ". " + targetModeHelp(mode, input)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onChange={(event) => setMode(storage.id, event.target.value as TargetMode)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {TARGET_MODE_LABELS[option]}
        </option>
      ))}
    </select>
  );
  return compact ? (
    <span
      className={
        "nodrag nopan relative inline-flex h-4 w-4 items-center justify-center rounded-sm text-[var(--mc-ink-muted)] hover:bg-white/10 focus-within:ring-1 focus-within:ring-current " +
        className
      }
    >
      <SlidersHorizontal aria-hidden className="h-3 w-3" />
      {select}
    </span>
  ) : (
    select
  );
}
