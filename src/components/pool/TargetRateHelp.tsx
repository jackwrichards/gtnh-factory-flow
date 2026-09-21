import type { FactoryProject, FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { storageTargetMode, TARGET_MODE_LABELS } from "@/lib/model/storage-target";
import { formatPoolRate, isPoolDisplayZero } from "./worksheet-format";

/** Explain the selected target using the current plan, without guessing a solver cause. */
export function TargetRateHelp({ storage, input, result, project }: {
  storage: FactoryStorage;
  input: boolean;
  result: StorageThroughputResult | undefined;
  project: FactoryProject;
}) {
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const actual = input ? result?.consumedPerSecond : result?.producedPerSecond;
  const stopped = actual !== undefined && isPoolDisplayZero(actual);
  const hasRecipes = project.nodes.some(node => node.enabled);
  return <div className="pool-target-explanation">
    <strong className="pool-target-help-name">{storage.displayName ?? storage.resourceId}</strong>
    <div className="pool-target-help-rates">
      <span>{input ? "Use" : "Make"} {TARGET_MODE_LABELS[mode].toLowerCase()} <strong className="pool-help-goal">{formatPoolRate(Math.abs(storage.targetPerSecond ?? 0), storage.kind)}</strong></span>
      <span>Currently {input ? "using" : "making"} <strong className="pool-help-actual">{formatPoolRate(Math.abs(actual ?? 0), storage.kind)}</strong></span>
    </div>
    {stopped ? <p className="pool-help-actual"><strong>No flow.</strong> This target is stopped.</p> : null}
    {!hasRecipes ? <p>Add or enable recipes that {input ? "use" : "make"} this item.</p> : <p className="pool-situation-check">Check material rules, rate limits, and machine settings.</p>}
  </div>;
}
