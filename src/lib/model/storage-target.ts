import type { FactoryStorage } from "./types";
import type { StorageRole } from "./storage-role";

export type TargetMode = "at-least" | "at-most" | "exact" | "ignore";

export function isInputRate(
  storage: Pick<FactoryStorage, "targetPerSecond" | "poolSide">,
  role?: StorageRole,
): boolean {
  if ((storage.targetPerSecond ?? 0) < 0) return true;
  if (storage.poolSide === "drain" && storage.targetPerSecond !== undefined) return false;
  return role === "source" || (role === undefined && storage.poolSide === "source");
}

/** Legacy negative Pool goals were exact even when an old output rule remained saved. */
export function storageTargetMode(
  storage: Pick<FactoryStorage, "targetMode" | "poolTargetMode" | "targetPerSecond" | "poolSide">,
  role?: StorageRole,
): TargetMode {
  if (storage.targetMode) return storage.targetMode;
  if (storage.poolTargetMode === "ignore") return "ignore";
  if (isInputRate(storage, role)) return "exact";
  return storage.poolTargetMode ?? "at-least";
}

export function hasStorageTarget(storage: FactoryStorage, role?: StorageRole): boolean {
  const mode = storageTargetMode(storage, role);
  return (
    mode !== "ignore" &&
    storage.targetPerSecond !== undefined &&
    Number.isFinite(storage.targetPerSecond) &&
    (storage.targetPerSecond !== 0 || mode === "exact" || mode === "at-most")
  );
}

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  "at-least": "At least",
  "at-most": "At most",
  exact: "Exactly",
  ignore: "Ignore",
};
export function targetModeHelp(mode: TargetMode, input: boolean): string {
  if (mode === "ignore")
    return "Keep the saved rate without enforcing it. An input source remains available.";
  if (mode === "at-most")
    return input
      ? "Use up to this much fresh input; unused supply is allowed. This limit alone does not request production."
      : "Make up to this much output. This limit alone does not request production.";
  if (mode === "exact")
    return input ? "Use exactly this much fresh input." : "Make exactly this much output.";
  return input ? "Use at least this much fresh input." : "Make this much output or more.";
}
