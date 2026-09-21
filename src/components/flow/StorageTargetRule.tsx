"use client";
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
}: {
  storage: FactoryStorage;
  input: boolean;
  className?: string;
}) {
  const readOnly = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const setMode = useFactoryStore((state) => state.setStorageTargetMode);
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const options: TargetMode[] = input
    ? ["at-least", "exact", "at-most", "ignore"]
    : ["at-least", "exact", "ignore"];
  return (
    <select
      className={className}
      aria-label={"Target rule for " + (storage.displayName ?? storage.resourceId)}
      value={mode}
      disabled={readOnly}
      title={targetModeHelp(mode, input)}
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
}
