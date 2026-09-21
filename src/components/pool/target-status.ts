import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { hasStorageTarget, isInputRate, storageTargetMode } from "@/lib/model/storage-target";

type RateStatus = { label: string; tone: "muted" | "met" | "failed"; explain?: boolean };

/** Describe the solver's verdict; never guess which constraint caused a failure. */
export function targetStatus(storage: FactoryStorage, role: StorageRole | undefined,
  result: StorageThroughputResult | undefined, stale = false, held = false): RateStatus {
  const mode = storageTargetMode(storage, role);
  if (mode === "ignore") return { label: "Ignored", tone: "muted" };
  if (!hasStorageTarget(storage, role)) return { label: "No target", tone: "muted" };
  if (stale || !result) return { label: held ? "Recalculate" : "Updating…", tone: "muted" };
  const target = Math.abs(storage.targetPerSecond!);
  const actual = isInputRate(storage, role) ? result.consumedPerSecond : result.producedPerSecond;
  // Treat rounding at the solver's relative precision as equality, including large EU targets.
  const tolerance = Math.max(1e-7, target * 1e-5);
  if (result.targetUnreachable) return {
    label: actual < target - tolerance ? "Short" : actual > target + tolerance ? "Over limit" : "Not met",
    tone: "failed", explain: true,
  };
  if (mode === "at-most") return { label: "Within limit", tone: "met" };
  if (mode === "at-least" && actual > target + tolerance) return { label: "Above target", tone: "met" };
  return { label: "Met", tone: "met" };
}
