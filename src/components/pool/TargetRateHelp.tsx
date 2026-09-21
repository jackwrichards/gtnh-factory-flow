import type { FactoryProject, FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { storageTargetMode, TARGET_MODE_LABELS } from "@/lib/model/storage-target";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { formatPoolRate } from "./worksheet-format";

/** Explain the selected target using the current plan, without guessing a solver cause. */
export function TargetRateHelp({ storage, input, result, project, resources }: {
  storage: FactoryStorage;
  input: boolean;
  result: StorageThroughputResult | undefined;
  project: FactoryProject;
  resources: ReturnType<typeof getPoolGroupResources>;
}) {
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const actual = input ? result?.consumedPerSecond : result?.producedPerSecond;
  const scope = resources.filter(row => row.groupId === storage.productionGroupId);
  const matched = scope.filter(row => !row.rule && row.feeders.some(port => !port.storage) && row.takers.some(port => !port.storage));
  const hasRecipes = project.nodes.some(node => node.enabled);
  return <div className="pool-target-explanation">
    <strong className="pool-target-help-name">{storage.displayName ?? storage.resourceId}</strong>
    <div className="pool-target-help-rates">
      <span>{input ? "Use" : "Make"} {TARGET_MODE_LABELS[mode].toLowerCase()} <strong className="pool-help-goal">{formatPoolRate(Math.abs(storage.targetPerSecond ?? 0), storage.kind)}</strong></span>
      <span>Currently {input ? "using" : "making"} <strong className="pool-help-actual">{formatPoolRate(Math.abs(actual ?? 0), storage.kind)}</strong></span>
    </div>
    {!hasRecipes ? <p>Add or enable recipes that {input ? "use" : "make"} this item.</p> : matched.length ? <>
      <p><strong>Check material rules:</strong> <span className="pool-help-match">Match</span> requires <span className="pool-help-goal">made</span> = <span className="pool-help-actual">used</span>.</p>
      <p>Need extra supply or have leftovers? Set <em>that material</em> to <span className="pool-help-ignore">Ignore</span>{storage.productionGroupId ? " to share with the parent group." : " to allow imports and surplus."}</p>
    </> : <p><strong>Check your setup:</strong> another rate limit or a machine that cannot run may be blocking this target.</p>}
  </div>;
}
