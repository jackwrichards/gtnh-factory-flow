import { AlertTriangle, Check, CircleDashed, LoaderCircle, ArrowRight, CircleHelp, X } from "lucide-react";
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
  const ruleScopes = [
    { id: undefined, name: "All production" },
    ...(project.productionGroups ?? []).map(group => ({ id: group.id, name: group.name })),
  ].map(scope => {
    const rows = resources.filter(row => row.groupId === scope.id);
    return {
      ...scope,
      matched: rows.filter(row => !row.rule && row.feeders.some(port => !port.storage) && row.takers.some(port => !port.storage)).length,
      outside: rows.filter(row => row.rule === "import" || (!row.groupId && row.rule === "share")).length,
      shared: rows.filter(row => row.groupId && row.rule === "share").length,
    };
  });
  const rootRules = ruleScopes[0];
  const inputs = result.externalInputs.filter(row => row.kind !== "power" && row.deficitPerSecond > 1e-6).length;
  const outputs = result.unconsumedOutputs.filter(row => row.kind !== "power" && row.surplusPerSecond > 1e-6).length;
  const issues = result.bottlenecks.filter(issue => issue.severity === "critical");
  const pending = result.stale || targets.some(storage => !result.storages[storage.id]);
  const state = pending ? "pending" : failed.length || issues.length ? "blocked" : requested || running ? "running" : "idle";
  const title = pending ? result.held ? "Waiting for Recalculate" : "Calculating…" : failed.length ? "Targets not met" : issues.length ? "Setup needs attention" : requested ? "All targets met" : running ? "Running from machine settings" : "No production requested";
  const Icon = pending ? LoaderCircle : failed.length || issues.length ? AlertTriangle : requested || running ? Check : CircleDashed;
  return <>
    <div className="pool-situation-scope">Whole setup{ruleScopes.length > 1 ? <span>including {ruleScopes.length - 1} {ruleScopes.length === 2 ? "group" : "groups"}</span> : null}</div>
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
      <div className="pool-situation-rule-summary" aria-label="All production material rules">
        <span className="pool-rule-scope-name">All production:</span>
        <span className="pool-help-match">{rootRules.matched} {rootRules.matched === 1 ? "material must" : "materials must"} balance</span>
        <span className="pool-help-ignore">{rootRules.outside} on Ignore</span>
      </div>
      {ignoredTargets > 0 ? <span title="Saved targets that are not enforced">{ignoredTargets} ignored {ignoredTargets === 1 ? "target" : "targets"}</span> : null}
      <details className="pool-situation-help" onKeyDown={event => {
        if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }}>
        <summary><CircleHelp size={12} aria-hidden />{ruleScopes.length > 1 ? "Rules by group" : "Material rules"}</summary>
        <div className="pool-rule-guide">
          <header><strong>How materials balance</strong><button type="button" aria-label="Close material rules" onClick={event => {
            const details = event.currentTarget.closest("details");
            if (details) { details.open = false; details.querySelector("summary")?.focus(); }
          }}><X size={13} aria-hidden /></button></header>
          <p className="pool-rule-example-label">Example: recipes need 100 water and recycle 30.</p>
          <div className="pool-rule-examples">
            <section className="pool-rule-example" aria-label="Match example">
              <h4 className="pool-help-match">Match</h4>
              <div><strong className="pool-help-goal">30 made</strong><span> ≠ </span><strong className="pool-help-actual">100 used</strong></div>
              <p className="pool-help-actual">Blocked · short by 70</p>
              <small>Made and used must match.</small>
            </section>
            <section className="pool-rule-example" aria-label="Ignore example">
              <h4 className="pool-help-ignore">Ignore · All production</h4>
              <div><strong className="pool-help-goal">30 recycled</strong><span> + </span><strong className="pool-help-match">70 imported</strong></div>
              <p className="pool-help-goal">Allowed · 100 supplied</p>
              <small>Top up shortages; let surplus out.</small>
            </section>
          </div>
          {ruleScopes.length > 1 ? <>
            <p className="pool-rule-group-note"><strong className="pool-help-ignore">Ignore inside a group</strong> shares with its parent. The parent's rules still apply.</p>
            <table className="pool-rule-scope-table" aria-label="Material rules by scope">
              <thead><tr><th>Where</th><th>Match: must balance</th><th>Ignore: outside</th><th>Ignore: parent</th></tr></thead>
              <tbody>{ruleScopes.map(scope => <tr key={scope.id ?? "root"}><th>{scope.name}</th><td className="pool-help-match">{scope.matched}</td><td className="pool-help-ignore">{scope.outside}</td><td>{scope.shared || "—"}</td></tr>)}</tbody>
            </table>
            <p className="pool-rule-footnote">Counts are per group. The same material can have a rule in more than one group.</p>
          </> : <p className="pool-rule-footnote">Your material rules apply to <strong>All production</strong>.</p>}
          <div className="pool-rule-automatic"><span>Only consumed <ArrowRight size={11} aria-hidden /> <strong className="pool-help-match">auto import</strong></span><span>Only produced <ArrowRight size={11} aria-hidden /> <strong className="pool-help-goal">export</strong></span></div>
          <p className="pool-rule-footnote">Explicit desired rates still apply. Ignoring a desired rate disables that target, not a material balance.</p>
        </div>
      </details>
    </div>
  </>;
}
