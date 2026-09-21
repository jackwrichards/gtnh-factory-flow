import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { hasStorageTarget, isInputRate, storageTargetMode } from "@/lib/model/storage-target";

type RateStatus = { label: string; compact?: string; tone: "muted" | "met" | "failed"; explain?: boolean };

/** Describe the solver's verdict; never guess which constraint caused a failure. */
export function targetStatus(storage: FactoryStorage, role: StorageRole | undefined,
  result: StorageThroughputResult | undefined, stale = false, held = false): RateStatus {
  const mode = storageTargetMode(storage, role);
  if (mode === "ignore") return { label: "Rate not enforced", compact: "Ignored", tone: "muted" };
  if (!hasStorageTarget(storage, role)) return { label: "No rate set", compact: "No rate set", tone: "muted" };
  if (stale || !result) return { label: held ? "Waiting to recalculate" : "Calculating…", tone: "muted" };
  const target = Math.abs(storage.targetPerSecond!);
  const actual = isInputRate(storage, role) ? result.consumedPerSecond : result.producedPerSecond;
  // Treat rounding at the solver's relative precision as equality, including large EU targets.
  const tolerance = Math.max(1e-7, target * 1e-5);
  if (result.targetUnreachable) return {
    label: actual < target - tolerance ? "Below requested rate" : actual > target + tolerance ? "Rate limit exceeded" : "Target not met",
    compact: actual < target - tolerance ? "Below target" : actual > target + tolerance ? "Over limit" : "Not met",
    tone: "failed", explain: true,
  };
  if (mode === "at-most") return { label: "Within rate limit", compact: "Within limit", tone: "met" };
  if (mode === "at-least" && actual > target + tolerance) return { label: "Above requested rate", compact: "Above target", tone: "met" };
  return { label: "Requested rate met", compact: "Rate met", tone: "met" };
}
