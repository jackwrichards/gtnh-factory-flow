"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { Copy, Eye, EyeOff, LayoutGrid, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import {
  useWorkspaceView,
  writeWorkspaceView,
  toggleResourceFavourite,
  toggleResourceHidden,
} from "@/lib/workspace-view";
import { formatPowerValue, resourceLabel, isCropProductionRecipe } from "@/lib/model";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { formatMachineListCount, type MachineListEntry } from "@/lib/model/machine-list";
import type { ResourceAmount, ResourceBalance, FactoryStorage } from "@/lib/model/types";
import { getStorageRoles } from "@/lib/model/storage-role";
import { powerDisplayFromEuT, powerDisplaySuffix } from "@/lib/model/rate-unit";
import { ResourceIcon } from "../nei/ResourceIcon";
import { MinecraftTooltip } from "../nei/MinecraftTooltip";
import { CircuitChip, RecipeNodeEditor } from "../flow/RecipeNode";
import { TargetLine } from "../flow/StorageNode";
import { RecipeTooltip } from "../flow/RecipeTooltip";
import { buildStatusTooltip, buildPortTooltip } from "../flow/recipe-tooltip-data";
import { formatPortRate, formatSlotRate } from "../flow/flow-explainers";
import type { RailPort } from "../flow/node-verdict";
import {
  getRecipeProgrammedCircuit,
  isProgrammedCircuitResource,
} from "@/lib/model/programmed-circuit";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { useBrowseMenu, type BrowseMode } from "../browse-menu";
import {
  buildWorksheetGroups,
  filterWorksheetGroups,
  type WorksheetGroup,
  type WorksheetSection,
} from "./worksheet-model";
import { WorksheetNumber } from "./WorksheetSetting";
import "./pool-worksheet.css";

export function PoolWorksheet() {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const workspace = useWorkspaceView();
  useRateDisplayUnits();
  const [query, setQuery] = useState("");
  const [internal, setInternal] = useState(false);
  const groups = useMemo(() => buildWorksheetGroups(project, result), [project, result]);
  const shown = useMemo(() => filterWorksheetGroups(groups, query), [groups, query]);
  const roles = useMemo(() => getStorageRoles(project), [project]);
  const products = (project.storages ?? []).filter(
    (storage) => roles.get(storage.id) === "product",
  );
  const totals = groups.reduce(
    (sum, group) => sum + (group.machine?.avgEuT ?? 0) - (group.machine?.avgMadeEuT ?? 0),
    0,
  );
  const boundaryKeys = new Set(
    [...result.externalInputs, ...result.unconsumedOutputs].map((entry) => entry.key),
  );
  const balances = Object.values(result.resources)
    .filter(
      (balance) =>
        (internal || boundaryKeys.has(balance.key)) &&
        (workspace.showHiddenResources || !workspace.hiddenResourceKeys.includes(balance.key)) &&
        (!workspace.favouritesOnly || workspace.favouriteResourceKeys.includes(balance.key)) &&
        (balance.displayName ?? balance.resourceId)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(workspace.favouriteResourceKeys.includes(b.key)) -
          Number(workspace.favouriteResourceKeys.includes(a.key)) ||
        (a.displayName ?? a.resourceId).localeCompare(b.displayName ?? b.resourceId),
    );
  return (
    <section
      data-viewer-inspect
      data-pool-worksheet
      className="pool-worksheet nodrag nopan nowheel"
      aria-label="Pool worksheet"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="pool-sheet-heading">
        <h2>
          Worksheet{" "}
          <span>{groups.reduce((sum, group) => sum + group.sections.length, 0)} recipes</span>
        </h2>
        <label className="pool-sheet-search">
          <Search className="h-3.5 w-3.5" />
          <input
            aria-label="Filter worksheet"
            placeholder="Filter recipes, machines, resources…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="pool-sheet-button"
          type="button"
          onClick={() => writeWorkspaceView({ poolWorksheet: false })}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Canvas
        </button>
      </div>
      <div className="pool-sheet-scroll">
        <div className="pool-sheet-summary">
          <div className="pool-sheet-products">
            <h3>Products</h3>
            {products.map((storage) => (
              <Product key={storage.id} storage={storage} />
            ))}
            {!products.length ? (
              <p>
                Choose a product with the product drawer key above, or pin a machine count below.
              </p>
            ) : null}
          </div>
          <div className="pool-sheet-balance">
            <div className="pool-sheet-resource-heading">
              <h3>
                Resources <span>{balances.length}</span>
              </h3>
              <label>
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                Include internal
              </label>
              <button
                type="button"
                className="pool-sheet-button"
                aria-label="Show only favourite resources"
                aria-pressed={workspace.favouritesOnly}
                onClick={() => writeWorkspaceView({ favouritesOnly: !workspace.favouritesOnly })}
              >
                <Star className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="pool-sheet-button"
                aria-label="Show hidden resources"
                aria-pressed={workspace.showHiddenResources}
                onClick={() =>
                  writeWorkspaceView({ showHiddenResources: !workspace.showHiddenResources })
                }
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </div>
            <table className="pool-sheet-resources" aria-label="Pool resource balance">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Inputs</th>
                  <th>Outputs</th>
                  <th>Internal</th>
                  <th>Net</th>
                  <th>
                    <span className="sr-only">Resource preferences</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <BalanceRow key={balance.key} balance={balance} />
                ))}
              </tbody>
            </table>
            {!balances.length ? <p className="pool-sheet-empty">No matching resources.</p> : null}
          </div>
        </div>
        {result.stale ? (
          <p className="pool-sheet-notice" role="status">
            {result.held
              ? "Results are waiting for Recalculate."
              : "Calculating… Showing the previous results."}
          </p>
        ) : null}
        <table className="pool-sheet-table" aria-label="Recipes running in the pool">
          <colgroup>
            <col className="pool-col-picture" />
            <col className="pool-col-machine" />
            <col className="pool-col-circuit" />
            <col className="pool-col-io" />
            <col className="pool-col-io" />

            <col className="pool-col-count" />
            <col className="pool-col-power" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <span className="sr-only">Machine picture</span>
              </th>
              <th>Machine / settings</th>
              <th>Circuit</th>
              <th>Takes</th>
              <th>Makes</th>
              <th title="Calculated machine capacity for this configuration. A fractional count uses part of one machine. Pin a count below to set it manually; Auto lets the solver choose.">
                Machines
              </th>
              <th>
                Power <small>{powerDisplaySuffix()}</small>
              </th>
            </tr>
          </thead>
          {shown.map((group) => (
            <MachineRows key={group.owner.id} group={group} readOnly={readOnly} />
          ))}
        </table>
        {!shown.length ? (
          <div className="pool-sheet-empty">
            {groups.length
              ? "No recipes match this filter."
              : "Add recipes from the item browser. They will appear here automatically."}
          </div>
        ) : null}
      </div>
      <footer>
        <span>
          {shown.length} / {groups.length} machine entries
        </span>
        <span>
          Average {formatPowerValue(powerDisplayFromEuT(totals))} {powerDisplaySuffix()}
        </span>
      </footer>
    </section>
  );
}

const MachineRows = memo(function MachineRows({
  group,
  readOnly,
}: {
  group: WorksheetGroup;
  readOnly: boolean;
}) {
  const { owner, machine, sections } = group;
  const updateNode = useFactoryStore((state) => state.updateNode);
  const first = sections[0];
  const handler = first.recipe ? getSelectedMachineHandler(first.recipe, owner) : undefined;
  const label = machine?.label ?? handler?.label ?? "Missing recipe";
  const required =
    machine?.count ??
    sections.reduce((sum, section) => sum + (section.result?.theoreticalMachinesRequired ?? 0), 0);
  const machineCells = (controls: ReactNode, picture: ReactNode) => (
    <>
      <td rowSpan={sections.length} className="pool-picture-cell">
        <div className="pool-machine-picture">{picture}</div>
      </td>
      <td rowSpan={sections.length} className="pool-shared-cell pool-machine-cell">
        {controls}
        <div className="pool-machine-footer">
          <div className="pool-status-list">
            {sections.map((section, index) => (
              <div key={section.section} className="pool-section-status">
                <Status section={section} />
                {sections.length > 1 ? (
                  <span className="pool-shared-label" title={section.recipe?.name}>
                    #{index + 1}
                    {!readOnly ? (
                      <button
                        type="button"
                        className="pool-sheet-icon-button"
                        aria-label={"Remove recipe " + (index + 1) + " from shared machine"}
                        onClick={() =>
                          useFactoryStore.getState().removeRecipeSection(owner.id, section.section)
                        }
                      >
                        <X />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {!readOnly ? (
            <div className="pool-row-actions">
              <button
                type="button"
                className="pool-enable-button"
                aria-label={owner.enabled ? "Disable machine" : "Enable machine"}
                title={
                  owner.enabled
                    ? "Disable this machine and exclude it from production"
                    : "Enable this machine for production"
                }
                onClick={() => updateNode(owner.id, { enabled: !owner.enabled })}
              >
                {owner.enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                className="pool-sheet-icon-button"
                aria-label="Duplicate machine"
                onClick={() => useFactoryStore.getState().duplicateNode(owner.id)}
              >
                <Copy />
              </button>
              <button
                type="button"
                className="pool-sheet-icon-button"
                aria-label="Replace recipe"
                onClick={() => useFactoryStore.getState().beginRecipeRefactor(owner.id)}
              >
                <RefreshCw />
              </button>
              <button
                type="button"
                className="pool-sheet-icon-button"
                aria-label="Remove machine"
                onClick={() => useFactoryStore.getState().deleteNode(owner.id)}
              >
                <Trash2 />
              </button>
            </div>
          ) : null}
        </div>
      </td>
    </>
  );
  return (
    <tbody
      data-worksheet-node={owner.id}
      className={owner.enabled === false ? "pool-machine-off" : undefined}
    >
      {sections.map((section, index) => (
        <tr key={section.section}>
          {index === 0 ? (
            first.recipe ? (
              <RecipeNodeEditor
                data={{ projectNode: owner, recipe: first.recipe, result: first.result }}
                render={machineCells}
              />
            ) : (
              machineCells(<span>{label}</span>, null)
            )
          ) : null}
          <td className="pool-circuit-cell">
            <div className="pool-circuit-slot">
              <CircuitChip
                circuit={section.display ? (getRecipeProgrammedCircuit(section.display) ?? {}) : {}}
              />
            </div>
          </td>
          <td>
            <PortList
              ports={section.ports.inputs}
              nodeId={owner.id}
              section={section}
              nonConsumed={section.nonConsumed.filter(
                (resource) => !isProgrammedCircuitResource(resource),
              )}
            />
          </td>
          <td>
            <PortList ports={section.ports.outputs} nodeId={owner.id} section={section} />
          </td>
          {index === 0 ? (
            <>
              <td rowSpan={sections.length} className="pool-shared-cell">
                <span className="pool-count" title="Calculated machine capacity at these settings">
                  <span className="pool-count-label">Need</span> ×{formatMachineListCount(required)}
                </span>
                {first.recipe && isCustomRateRecipe(first.recipe) ? null : readOnly ? (
                  <small>
                    {owner.solvePin ? "Pinned " + formatMachineListCount(owner.solvePin) : "Auto"}
                  </small>
                ) : (
                  <label className="pool-pin-count">
                    <span className="pool-count-label">Pin</span>
                    <WorksheetNumber
                      key={owner.solvePin ?? "auto"}
                      value={owner.solvePin}
                      min={0}
                      label={
                        first.recipe && isCropProductionRecipe(first.recipe)
                          ? "Pinned seed count"
                          : "Pinned machine count"
                      }
                      placeholder={
                        first.recipe && isCropProductionRecipe(first.recipe) ? "Seeds" : "Auto"
                      }
                      onCommit={(solvePin) =>
                        updateNode(owner.id, { solvePin: solvePin || undefined })
                      }
                    />
                  </label>
                )}
              </td>
              <td rowSpan={sections.length} className="pool-shared-cell">
                <MachinePower entry={machine} />
              </td>
            </>
          ) : null}
        </tr>
      ))}
    </tbody>
  );
});

function Status({ section }: { section: WorksheetSection }) {
  const labels: Record<string, string> = {
    balanced: "Running",
    "demand-set": "On demand",
    paced: "Paced",
    off: "Disabled",
    "no-recipe": "Missing recipe",
    "dead-loop": "Dead loop",
    "clog-lock": "Clog lock",
  };
  return (
    <MinecraftTooltip
      content={() => <RecipeTooltip view={buildStatusTooltip(section.verdict, "pool")} />}
    >
      <span
        className={`pool-status pool-status--${section.result?.powerStalled ? "power-stalled" : section.verdict.kind}`}
      >
        {section.result?.powerStalled
          ? "Power stalled"
          : (labels[section.verdict.kind] ?? section.verdict.kind)}
      </span>
    </MinecraftTooltip>
  );
}

function PortList({
  ports,
  nodeId,
  section,
  nonConsumed = [],
}: {
  ports: RailPort[];
  nodeId: string;
  section: WorksheetSection;
  nonConsumed?: ResourceAmount[];
}) {
  if (!ports.length && !nonConsumed.length) return <span className="pool-sheet-muted">—</span>;
  return (
    <div
      className="pool-port-list"
      tabIndex={ports.length + nonConsumed.length > 4 ? 0 : undefined}
      role="group"
      aria-label="Recipe items"
    >
      {ports.map((port) => (
        <div className="pool-port" key={port.handleId}>
          <MinecraftTooltip
            content={() => {
              const state = useFactoryStore.getState();
              return (
                <RecipeTooltip
                  view={buildPortTooltip(
                    state.project,
                    state.lastResult,
                    section.node.id,
                    port,
                    section.verdict,
                  )}
                />
              );
            }}
          >
            <div className="pool-port-line">
              <ResourceLink
                resource={
                  port.resource ?? {
                    kind: port.kind,
                    id: port.resourceId,
                    displayName: port.displayName,
                    amount: 1,
                  }
                }
                nodeId={nodeId}
              />
              <span className="pool-port-rate">
                {port.free ? "Free" : formatPortRate(port, port.currentPerSecond)}
              </span>
            </div>
          </MinecraftTooltip>
        </div>
      ))}
      {nonConsumed.map((resource, index) => (
        <div className="pool-port pool-port-line" key={`nc:${index}`}>
          <ResourceLink resource={resource} nodeId={nodeId} />
          <span className="pool-port-rate">NC · ×{resource.amount}</span>
        </div>
      ))}
    </div>
  );
}

function ResourceLink({ resource, nodeId }: { resource: ResourceAmount; nodeId?: string }) {
  const browse = (mode: BrowseMode) => {
    if (resource.kind === "power") return;
    useFactoryStore.getState().browseResource({ ...resource, anchorNodeId: nodeId }, mode);
  };
  const { pressHandlers, menu, wasDragged, wasTouch, openFromTap } = useBrowseMenu({
    name: resourceLabel(resource),
    onPick: browse,
  });
  return (
    <>
      <button
        type="button"
        className="pool-resource-link"
        {...pressHandlers}
        onClick={(event) => {
          if (wasDragged()) return;
          if (wasTouch()) {
            openFromTap({ x: event.clientX, y: event.clientY });
            return;
          }
          browse("recipes");
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          browse("uses");
        }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "r" || event.key.toLowerCase() === "u") {
            event.preventDefault();
            browse(event.key.toLowerCase() === "r" ? "recipes" : "uses");
          }
        }}
      >
        <ResourceIcon
          resource={resource}
          size="sm"
          bare
          className="!h-5 !w-5"
          iconPixelSize={20}
          showAmount={false}
          tooltip={false}
        />
        <span title={resourceLabel(resource)}>{resourceLabel(resource)}</span>
      </button>
      {menu}
    </>
  );
}

function MachinePower({ entry }: { entry?: MachineListEntry }) {
  if (!entry) return <span className="pool-sheet-muted">—</span>;
  if (entry.steamLs !== undefined)
    return (
      <>
        <div className="pool-power-line">
          {formatSlotRate(entry.avgSteamLs ?? 0, "fluid")}
          <small>avg steam</small>
        </div>
        <div className="pool-power-line">
          {formatSlotRate(entry.steamLs, "fluid")}
          <small>peak steam</small>
        </div>
      </>
    );
  const sign = entry.madeEuT !== undefined ? "+" : "";
  const average = entry.avgMadeEuT ?? entry.avgEuT;
  const peak = entry.madeEuT ?? entry.euT;
  return (
    <>
      {average !== undefined ? (
        <div className="pool-power-line">
          {sign}
          {formatPowerValue(powerDisplayFromEuT(average))}
          <small>avg</small>
        </div>
      ) : null}
      {peak !== undefined ? (
        <div className="pool-power-line">
          {sign}
          {formatPowerValue(powerDisplayFromEuT(peak))}
          <small>peak</small>
        </div>
      ) : (
        <span className="pool-sheet-muted">—</span>
      )}
    </>
  );
}

function Product({ storage }: { storage: FactoryStorage }) {
  const result = useFactoryStore((state) => state.lastResult.storages[storage.id]);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  return (
    <div className="pool-product">
      <ResourceLink
        resource={{
          kind: storage.kind,
          id: storage.resourceId,
          displayName: storage.displayName,
          iconPath: storage.iconPath,
          iconAtlas: storage.iconAtlas,
          amount: 1,
        }}
      />
      <div className="pool-product-target">
        {readOnly ? (
          <span>
            {storage.targetPerSecond === undefined
              ? "No target"
              : formatSlotRate(storage.targetPerSecond, storage.kind)}
          </span>
        ) : (
          <TargetLine storage={storage} result={result} />
        )}
      </div>
      <span className={result?.targetUnreachable ? "text-red-300" : "pool-sheet-muted"}>
        {result?.targetUnreachable
          ? "Unreachable"
          : `${formatSlotRate(result?.producedPerSecond ?? 0, storage.kind)} supplied`}
      </span>
      {!readOnly ? (
        <button
          type="button"
          className="pool-sheet-icon-button"
          aria-label={`Remove product ${storage.displayName ?? storage.resourceId}`}
          onClick={() => useFactoryStore.getState().deleteStorage(storage.id)}
        >
          <X />
        </button>
      ) : null}
    </div>
  );
}

function BalanceRow({ balance }: { balance: ResourceBalance }) {
  const workspace = useWorkspaceView();
  const dataset = useFactoryStore((state) => state.dataset);
  const resource = dataset?.resources.find(
    (entry) => entry.kind === balance.kind && entry.id === balance.resourceId,
  );
  const star = workspace.favouriteResourceKeys.includes(balance.key);
  const hidden = workspace.hiddenResourceKeys.includes(balance.key);
  const net = balance.surplusPerSecond - balance.deficitPerSecond;
  return (
    <tr className={hidden ? "opacity-40" : undefined}>
      <td>
        <ResourceLink
          resource={{
            ...resource,
            kind: balance.kind,
            id: balance.resourceId,
            displayName: balance.displayName ?? resource?.displayName,
            amount: 1,
          }}
        />
      </td>
      <td>{formatSlotRate(balance.deficitPerSecond, balance.kind)}</td>
      <td>{formatSlotRate(balance.surplusPerSecond, balance.kind)}</td>
      <td>{formatSlotRate(balance.consumedPerSecond, balance.kind)}</td>
      <td>
        {net > 0 ? "+" : ""}
        {formatSlotRate(net, balance.kind)}
      </td>
      <td>
        <div className="pool-row-actions">
          <button
            type="button"
            className="pool-sheet-icon-button"
            aria-label={`${star ? "Unstar" : "Star"} ${balance.displayName ?? balance.resourceId}`}
            aria-pressed={star}
            onClick={() => toggleResourceFavourite(balance.key)}
          >
            <Star />
          </button>
          {!star ? (
            <button
              type="button"
              className="pool-sheet-icon-button"
              aria-label={`${hidden ? "Show" : "Hide"} ${balance.displayName ?? balance.resourceId}`}
              onClick={() => toggleResourceHidden(balance.key)}
            >
              {hidden ? <Eye /> : <EyeOff />}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
