import { AlertTriangle, Check, CircleDashed, LoaderCircle, ArrowRight, CircleHelp } from "lucide-react";
import type { FactoryProject, FactoryStorage, NodeThroughputResult, ThroughputResult } from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { hasStorageTarget, isInputRate, storageTargetMode } from "@/lib/model/storage-target";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { TargetRateHelp } from "./TargetRateHelp";

/** Summarize the current books; never run a second solve or infer an unreported cause. */
export function PoolSituation({ project, result, products, roles, resources, recipes, selectedTarget }: {
  project: FactoryProject;
  result: ThroughputResult;
  products: FactoryStorage[];
  roles: Map<string, StorageRole>;
  resources: ReturnType<typeof getPoolGroupResources>;
  recipes: (NodeThroughputResult | undefined)[];
  selectedTarget?: FactoryStorage;
}) {
  const targets = products.filter(storage => hasStorageTarget(storage, roles.get(storage.id)));
  const failed = targets.filter(storage => result.storages[storage.id]?.targetUnreachable);
  const requested = targets.some(storage => storageTargetMode(storage, roles.get(storage.id)) !== "at-most" && Math.abs(storage.targetPerSecond ?? 0) > 0);
  const running = recipes.filter(recipe => recipe?.enabled && recipe.utilization > 0 && recipe.operationRatePerSecond > 0).length;
  const ignoredTargets = products.filter(storage => storageTargetMode(storage, roles.get(storage.id)) === "ignore").length;
  const matched = resources.filter(row => !row.rule && row.feeders.some(port => !port.storage) && row.takers.some(port => !port.storage)).length;
  const outside = resources.filter(row => row.rule === "import" || (!row.groupId && row.rule === "share")).length;
  const shared = resources.filter(row => row.groupId && row.rule === "share").length;
  const inputs = result.externalInputs.filter(row => row.kind !== "power" && row.deficitPerSecond > 1e-6).length;
  const outputs = result.unconsumedOutputs.filter(row => row.kind !== "power" && row.surplusPerSecond > 1e-6).length;
  const issues = result.bottlenecks.filter(issue => issue.severity === "critical");
  const pending = result.stale || targets.some(storage => !result.storages[storage.id]);
  const state = pending ? "pending" : failed.length || issues.length ? "blocked" : requested || running ? "running" : "idle";
  const title = pending ? result.held ? "Waiting for Recalculate" : "Calculating…" : failed.length ? "Targets not met" : issues.length ? "Setup needs attention" : requested ? "All targets met" : running ? "Running from machine settings" : "No production requested";
  const Icon = pending ? LoaderCircle : failed.length || issues.length ? AlertTriangle : requested || running ? Check : CircleDashed;
  return <>
    <div className="pool-situation-top">
      <h3 className="pool-situation-heading" data-state={state} role="status"><Icon size={13} aria-hidden />{title}</h3>
      {!pending && targets.length > 0 ? <span className="pool-situation-counts" title="Rate rules satisfied">{targets.length - failed.length}/{targets.length} rates met</span> : null}
    </div>
    {pending ? <p>Showing the previous calculation.</p> : <>
      <div className="pool-situation-flow" aria-label={inputs + " outside inputs, " + running + " recipes running, " + outputs + " outputs leaving"}>
        <span className="pool-help-actual"><strong>{inputs}</strong> {inputs === 1 ? "input" : "inputs"}</span>
        <ArrowRight size={12} aria-hidden />
        <span><strong>{running}</strong> {running === 1 ? "recipe" : "recipes"} running</span>
        <ArrowRight size={12} aria-hidden />
        <span className="pool-help-goal"><strong>{outputs}</strong> {outputs === 1 ? "output" : "outputs"}</span>
      </div>
      {failed.length > 0 && selectedTarget ? <TargetRateHelp storage={selectedTarget} input={isInputRate(selectedTarget, roles.get(selectedTarget.id))} result={result.storages[selectedTarget.id]} project={project} /> : null}
      {!failed.length && issues.length > 0 ? <p>{issues[0].message}{issues.length > 1 ? ` (+${issues.length - 1} more issues)` : ""}</p> : null}
      {!failed.length && !issues.length && !requested && !running ? <p>Set a <span className="pool-help-goal">+ output</span> or <span className="pool-help-actual">− input</span> rate to start.</p> : null}
    </>}
    <div className="pool-situation-legend">
      <span className="pool-help-match">Match <strong>{matched}</strong></span>
      <span className="pool-help-ignore">Ignore <strong>{outside + shared}</strong></span>
      {ignoredTargets > 0 ? <span title="Saved targets that are not enforced">{ignoredTargets} ignored {ignoredTargets === 1 ? "target" : "targets"}</span> : null}
      <details className="pool-situation-help" onKeyDown={event => {
        if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }}>
        <summary><CircleHelp size={11} aria-hidden />Rules</summary>
        <div>
          <dl className="pool-situation-rules">
            <dt className="pool-help-match">Match</dt><dd>Materials made and reused must balance. A shortage or surplus needs its own target or Ignore.</dd>
            <dt className="pool-help-ignore">Ignore</dt><dd>Allow outside top-ups and surplus. In a group, share with its parent instead; that group's rules still apply.</dd>
            <dt>Outside</dt><dd>No producer? Import automatically. No consumer? Outputs can leave.</dd>
            <dt>Rates</dt><dd>Exactly and At least request production. At most only sets a limit. Ignored targets stay saved but are not enforced.</dd>
          </dl>
        </div>
      </details>
    </div>
  </>;
}
