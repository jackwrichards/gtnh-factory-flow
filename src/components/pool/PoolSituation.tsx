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
  const groupCount = project.productionGroups?.length ?? 0;
  const rootResources = resources.filter(row => row.groupId === undefined);
  const rootRules = {
    matched: rootResources.filter(row => !row.rule && row.feeders.some(port => !port.storage) && row.takers.some(port => !port.storage)).length,
    outside: rootResources.filter(row => row.rule === "import" || row.rule === "share").length,
  };
  const inputs = result.externalInputs.filter(row => row.kind !== "power" && row.deficitPerSecond > 1e-6).length;
  const outputs = result.unconsumedOutputs.filter(row => row.kind !== "power" && row.surplusPerSecond > 1e-6).length;
  const issues = result.bottlenecks.filter(issue => issue.severity === "critical");
  const pending = result.stale || targets.some(storage => !result.storages[storage.id]);
  const state = pending ? "pending" : failed.length || issues.length ? "blocked" : requested || running ? "running" : "idle";
  const title = pending ? result.held ? "Waiting for Recalculate" : "Calculating…" : failed.length ? "Targets not met" : issues.length ? "Setup needs attention" : requested ? "All targets met" : running ? "Running from machine settings" : "No production requested";
  const Icon = pending ? LoaderCircle : failed.length || issues.length ? AlertTriangle : requested || running ? Check : CircleDashed;
  return <>
    <div className="pool-situation-scope">Whole setup{groupCount > 0 ? <span>including {groupCount} {groupCount === 1 ? "group" : "groups"}</span> : null}</div>
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
        <summary><CircleHelp size={12} aria-hidden />Material rules</summary>
        <div className="pool-rule-guide">
          <header><strong>Material rules</strong><button type="button" aria-label="Close material rules" onClick={event => {
            const details = event.currentTarget.closest("details");
            if (details) { details.open = false; details.querySelector("summary")?.focus(); }
          }}><X size={13} aria-hidden /></button></header>
          <p className="pool-rule-intro">For materials both made and used:</p>
          <dl className="pool-rule-meaning">
            <div><dt className="pool-help-match">Match</dt><dd>Make what you use.</dd></div>
            <div><dt className="pool-help-ignore">Ignore</dt><dd>Top up shortages; let extras out.</dd></div>
          </dl>
          <section className="pool-rule-example" aria-label="Material balance example">
            <h4>Water <span>(Example) · 100 needed</span></h4>
            <div className="pool-rule-example-row" role="group" aria-label="Match example">
              <strong className="pool-help-match">Match</strong>
              <div className="pool-rule-water-bar"><span>30 recycled</span><span className="pool-rule-water-missing">70 missing <X size={11} aria-label="Blocked" /></span></div>
            </div>
            <div className="pool-rule-example-row" role="group" aria-label="Ignore example">
              <strong className="pool-help-ignore">Ignore</strong>
              <div className="pool-rule-water-bar"><span>30 recycled</span><span className="pool-rule-water-imported">70 imported <Check size={11} aria-label="Supplied" /></span></div>
            </div>
          </section>
          <p className="pool-rule-group-note"><strong>In groups:</strong> Ignore shares with the parent. Its rules still apply.</p>
          <p className="pool-rule-footnote">Desired rates still apply.</p>
        </div>
      </details>
    </div>
  </>;
}
