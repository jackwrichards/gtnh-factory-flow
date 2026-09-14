"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Copy, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { formatPowerValue, resourceLabel, isCropProductionRecipe } from "@/lib/model";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { type MachineListEntry } from "@/lib/model/machine-list";
import type { ResourceAmount, ResourceBalance, FactoryStorage } from "@/lib/model/types";
import { getStorageRoles } from "@/lib/model/storage-role";
import { powerDisplayFromEuT, powerDisplaySuffix, rateSuffixForKind } from "@/lib/model/rate-unit";
import { ResourceIcon } from "../nei/ResourceIcon";
import { MinecraftTooltip } from "../nei/MinecraftTooltip";
import { CircuitChip, RecipeNodeEditor, SolvedMachinesStat } from "../flow/RecipeNode";
import { ItemPickerPopover } from "../ItemPickerPopover";
import { TargetLine } from "../flow/StorageNode";
import { RecipeTooltip } from "../flow/RecipeTooltip";
import { formatSignedRate } from "../inspector/flow-rate";
import { WorksheetPower } from "./WorksheetPower";
import "../inspector/panel.css";
import { buildStatusTooltip, buildPortTooltip } from "../flow/recipe-tooltip-data";
import {
  formatEnergyPerUnitParts,
  formatSlotRate,
  formatSlotRateBare,
  portReadsEnergy,
} from "../flow/flow-explainers";
import type { RailPort } from "../flow/node-verdict";
import {
  getRecipeProgrammedCircuit,
  isProgrammedCircuitResource,
} from "@/lib/model/programmed-circuit";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { useBrowseMenu, type BrowseMode } from "../browse-menu";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { RESOURCE_DRAG_TYPE, readResourceDrag, writeResourceDrag } from "@/lib/resource-drag";
import {
  OrderHandle,
  WorksheetOrderContext,
  moveWorksheetEntry,
  orderWorksheetEntries,
  useOrderTarget,
} from "./worksheet-drag";
import {
  buildWorksheetGroups,
  filterWorksheetGroups,
  type WorksheetGroup,
  type WorksheetSection,
} from "./worksheet-model";

import "./pool-worksheet.css";

export function PoolWorksheet() {
  const ioHeaderRef = useRef<HTMLTableCellElement>(null);
  const [ioWidth, setIoWidth] = useState(232);
  useEffect(() => {
    const header = ioHeaderRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setIoWidth(entry.contentRect.width));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // React's wheel listeners are passive. Cancel the native scroll in
    // capture, while letting each control's existing wheel handler run.
    const preventControlScroll = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".pool-machine-settings .nowheel, .pool-editor-power [data-power-controls]",
        )
      )
        event.preventDefault();
    };
    root.addEventListener("wheel", preventControlScroll, { capture: true, passive: false });
    return () => root.removeEventListener("wheel", preventControlScroll, true);
  }, []);
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  useRateDisplayUnits();
  const [query, setQuery] = useState("");
  const [internal, setInternal] = useState(false);
  const workspace = useWorkspaceView();
  const savedOrder = (kind: string) => workspace.poolWorksheetOrder[`${project.id}:${kind}`] ?? [];
  const groups = useMemo(() => buildWorksheetGroups(project, result), [project, result]);
  const orderedGroups = orderWorksheetEntries(
    groups,
    savedOrder("machines"),
    (group) => group.owner.id,
  );
  const shown = filterWorksheetGroups(orderedGroups, query);
  const maxItems = Math.max(
    1,
    ...shown.flatMap((group) =>
      group.sections.flatMap((section) => [
        section.ports.outputs.length,
        section.ports.inputs.length +
          section.nonConsumed.filter((resource) => !isProgrammedCircuitResource(resource)).length,
      ]),
    ),
  );
  // One ruler for both sides of every recipe: empty slots keep their place.
  const comfortableColumns = Math.max(1, Math.floor((ioWidth + 9) / 201));
  const compactColumns = Math.max(1, Math.floor((ioWidth + 9) / 153));
  // Prefer readable widths, but narrow cards before reserving a third row.
  const itemColumns = Math.min(
    maxItems,
    Math.max(comfortableColumns, Math.min(Math.ceil(maxItems / 2), compactColumns)),
  );
  const itemRows = Math.ceil(maxItems / itemColumns);
  const roles = useMemo(() => getStorageRoles(project), [project]);
  const products = orderWorksheetEntries(
    (project.storages ?? []).filter((storage) => roles.get(storage.id) === "product"),
    savedOrder("products"),
    (storage) => storage.id,
  );
  const boundaryKeys = new Set(
    [...result.externalInputs, ...result.unconsumedOutputs].map((entry) => entry.key),
  );
  const balances = orderWorksheetEntries(
    Object.values(result.resources)
      .filter(
        (balance) =>
          balance.kind !== "power" &&
          (internal || boundaryKeys.has(balance.key)) &&
          (balance.displayName ?? balance.resourceId)
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      )
      .sort((a, b) => (a.displayName ?? a.resourceId).localeCompare(b.displayName ?? b.resourceId)),
    savedOrder("resources"),
    (balance) => balance.key,
  );
  const ids = {
    machines: orderedGroups.map((group) => group.owner.id),
    products: products.map((storage) => storage.id),
    resources: balances.map((balance) => balance.key),
  };
  return (
    <section
      ref={rootRef}
      data-viewer-inspect
      data-pool-worksheet
      className="pool-worksheet nodrag nopan nowheel"
      aria-label="Pool worksheet"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <WorksheetOrderContext.Provider
        value={{
          readOnly,
          ids,
          move: (kind, from, to, after) => {
            if (readOnly) return;
            const next = moveWorksheetEntry(ids[kind], from, to, after);
            writeWorkspaceView({
              poolWorksheetOrder: {
                ...workspace.poolWorksheetOrder,
                [`${project.id}:${kind}`]: [
                  ...next,
                  ...savedOrder(kind).filter((id) => !next.includes(id)),
                ],
              },
            });
          },
        }}
      >
        <div className="pool-sheet-summary">
          <ProductsPane>
            <div className="pool-products-heading">
              <h3>Products</h3>
              {!readOnly ? <AddPoolProduct /> : null}
            </div>
            <div className="pool-products-scroll">
              <table className="pool-summary-table pool-products-table" aria-label="Pool products">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Target</th>
                    <th>Supplied</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((storage) => (
                    <Product key={storage.id} storage={storage} />
                  ))}
                </tbody>
              </table>
            </div>
          </ProductsPane>
          <div className="pool-sheet-balance">
            <div className="pool-sheet-resource-heading">
              <h3>Resources</h3>
              <label>
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                Include internal
              </label>
            </div>
            <div className="pool-resources-scroll">
              <table className="pool-summary-table pool-sheet-resources" aria-label="Pool resource balance">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="pool-flow-input">Inputs</th>
                    <th className="pool-flow-output">Outputs</th>
                    <th>Internal</th>
                    <th>Net</th>
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
          <WorksheetPower
            entries={groups.flatMap((group) => (group.machine ? [group.machine] : []))}
          />
        </div>
        <div className="pool-sheet-scroll">
          {result.stale ? (
            <p className="pool-sheet-notice" role="status">
              {result.held
                ? "Results are waiting for Recalculate."
                : "Calculating… Showing the previous results."}
            </p>
          ) : null}
          <table
            className="pool-sheet-table"
            aria-label="Recipes running in the pool"
            style={
              { "--pool-io-columns": itemColumns, "--pool-io-rows": itemRows } as CSSProperties
            }
          >
            <colgroup>
              <col className="pool-col-picture" />
              <col className="pool-col-machine" />
              <col className="pool-col-status" />
              <col className="pool-col-circuit" />
              <col className="pool-col-io" />
              <col className="pool-col-io" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Machine picture</span>
                </th>
                <th>
                  <label className="pool-sheet-search">
                    <Search className="h-3.5 w-3.5" />
                    <input
                      aria-label="Filter worksheet"
                      placeholder="Search machines or items"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </th>
                <th>Status</th>
                <th>Circuit</th>
                <th ref={ioHeaderRef}>Takes</th>
                <th>Makes</th>
              </tr>
            </thead>
            {shown.map((group) => (
              <MachineRows
                key={group.owner.id}
                group={group}
                readOnly={readOnly}
                columns={itemColumns}
              />
            ))}
          </table>
          {!shown.length ? (
            <div className="pool-sheet-empty">
              {groups.length
                ? "No recipes match this filter."
                : "Add recipes from the item browser."}
            </div>
          ) : null}
        </div>
      </WorksheetOrderContext.Provider>
    </section>
  );
}

function ProductsPane({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  return (
    <div
      className="pool-sheet-products"
      aria-label="Products drop zone"
      data-resource-drop={hover || undefined}
      onDragOver={(event) => {
        if (!readOnly && event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setHover(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(false);
      }}
      onDrop={(event) => {
        setHover(false);
        if (!readOnly && event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) {
          event.preventDefault();
          event.stopPropagation();
          const resource = readResourceDrag(event.dataTransfer);
          if (resource) useFactoryStore.getState().addPoolStorage(resource, "drain");
        }
      }}
    >
      {children}
    </div>
  );
}

function AddPoolProduct() {
  const [open, setOpen] = useState(false);
  const add = useFactoryStore((state) => state.addPoolStorage);
  return (
    <div className="pool-add-product">
      <button
        type="button"
        className="pool-add-button"
        aria-label="Add product"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="h-4 w-4" />
      </button>
      {open ? (
        <ItemPickerPopover
          role="makes"
          placement="below"
          align="start"
          onClose={() => setOpen(false)}
          onPick={(entry) => {
            if (entry.kind === "aspect") return;
            add(
              {
                kind: entry.kind,
                id: entry.id,
                displayName: entry.displayName,
                iconPath: entry.iconPath,
                iconAtlas: entry.iconAtlas,
                dominantColor: entry.dominantColor,
              },
              "drain",
            );
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

const MachineRows = memo(function MachineRows({
  group,
  readOnly,
  columns,
}: {
  group: WorksheetGroup;
  readOnly: boolean;
  columns: number;
}) {
  useRateDisplayUnits();
  const { owner, machine, sections } = group;
  const orderTarget = useOrderTarget("machines", owner.id);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const first = sections[0];
  const handler = first.recipe ? getSelectedMachineHandler(first.recipe, owner) : undefined;
  const label = machine?.label ?? handler?.label ?? "Missing recipe";
  const required =
    machine?.count ??
    sections.reduce((sum, section) => sum + (section.result?.theoreticalMachinesRequired ?? 0), 0);
  const machineCells = (controls: ReactNode, picture: ReactNode, settings: ReactNode) => (
    <>
      <td rowSpan={sections.length} className="pool-picture-cell">
        <OrderHandle kind="machines" id={owner.id} label={`machine ${label}`} />
        <div className="pool-machine-picture">{picture}</div>
      </td>
      <td
        rowSpan={sections.length}
        className="pool-shared-cell pool-machine-cell"
        data-machine-editor-anchor
      >
        <div className="pool-machine-layout">
          <div className="pool-machine-details">{controls}</div>
          <div className="pool-machine-stats">
            <fieldset disabled={readOnly} className="pool-machine-count">
              {first.recipe && isCustomRateRecipe(first.recipe) ? null : (
                <SolvedMachinesStat
                  inline
                  label={
                    first.recipe && isCropProductionRecipe(first.recipe) ? "Seeds" : "Machines"
                  }
                  needed={
                    first.recipe && isCropProductionRecipe(first.recipe)
                      ? sections.reduce(
                          (sum, section) =>
                            sum + (section.result?.theoreticalMachinesRequired ?? 0),
                          0,
                        )
                      : required
                  }
                  pinned={owner.solvePin}
                  onPin={(solvePin) => updateNode(owner.id, { solvePin })}
                />
              )}
            </fieldset>
            <div className="pool-machine-power">
              <MachinePower entry={machine} />
            </div>
            {!readOnly ? (
              <div className="pool-row-actions">
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
          {settings ? <div className="pool-settings-section">{settings}</div> : null}
        </div>
      </td>
    </>
  );
  return (
    <tbody
      {...orderTarget}
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
              machineCells(<span>{label}</span>, null, null)
            )
          ) : null}
          <td className="pool-status-cell">
            <div className="pool-section-status">
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
          </td>
          <td className="pool-circuit-cell">
            <div className="pool-circuit-slot">
              <CircuitChip
                bare
                circuit={section.display ? (getRecipeProgrammedCircuit(section.display) ?? {}) : {}}
              />
            </div>
          </td>
          <td>
            <PortList
              columns={columns}
              ports={section.ports.inputs}
              nodeId={owner.id}
              section={section}
              nonConsumed={section.nonConsumed.filter(
                (resource) => !isProgrammedCircuitResource(resource),
              )}
            />
          </td>
          <td>
            <PortList
              columns={columns}
              ports={section.ports.outputs}
              nodeId={owner.id}
              section={section}
            />
          </td>
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
  columns,
}: {
  ports: RailPort[];
  nodeId: string;
  section: WorksheetSection;
  nonConsumed?: ResourceAmount[];
  columns: number;
}) {
  if (!ports.length && !nonConsumed.length) return <span className="pool-sheet-muted">—</span>;
  return (
    <div className="pool-port-list" role="group" aria-label="Recipe items">
      {Array.from({ length: columns - 1 }, (_, index) => (
        <span
          key={`divider:${index}`}
          aria-hidden
          className="pool-item-divider"
          style={{ left: `calc(${index + 1} * (100% + 9px) / ${columns} - 4.5px)` }}
        />
      ))}
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
            <div className="flow-port pool-port-line">
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
                <PortRate port={port} />
              </span>
            </div>
          </MinecraftTooltip>
        </div>
      ))}
      {nonConsumed.map((resource, index) => (
        <div className="pool-port flow-port pool-port-line" key={`nc:${index}`}>
          <ResourceLink resource={resource} nodeId={nodeId} />
          <span className="pool-port-rate">NC · ×{resource.amount}</span>
        </div>
      ))}
    </div>
  );
}

function PortRate({ port }: { port: RailPort }) {
  if (port.free) return <>Free</>;
  const energy = portReadsEnergy(port);
  const parts = energy
    ? formatEnergyPerUnitParts(port.energyPerUnit!, port.kind)
    : {
        value: formatSlotRateBare(port.currentPerSecond, port.kind),
        unit: rateSuffixForKind(port.kind).trim(),
      };
  return (
    <span className={energy ? "text-amber-300" : undefined}>
      <strong>{parts.value}</strong>
      <small>{parts.unit}</small>
    </span>
  );
}

function ResourceLink({
  resource,
  nodeId,
  compact = false,
}: {
  resource: ResourceAmount;
  nodeId?: string;
  compact?: boolean;
}) {
  const readOnly = useFactoryStore((state) => state.isReadOnly);
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
        draggable={!readOnly}
        onDragStart={(event) => {
          event.stopPropagation();
          writeResourceDrag(event.dataTransfer, resource);
        }}
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
          className={compact ? "pool-item-icon !h-4 !w-4" : "pool-item-icon !h-8 !w-8"}
          iconPixelSize={compact ? 22 : 44}
          showAmount={false}
          showConsumedState={false}
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
  const steam = entry.steamLs !== undefined;
  const sign = entry.madeEuT !== undefined ? "+" : "";
  const average = steam ? entry.avgSteamLs : (entry.avgMadeEuT ?? entry.avgEuT);
  const peak = steam ? entry.steamLs : (entry.madeEuT ?? entry.euT);
  const format = (value: number) =>
    steam
      ? formatSlotRate(value, "fluid")
      : `${sign}${formatPowerValue(powerDisplayFromEuT(value))} ${powerDisplaySuffix()}`;
  if (average === peak && peak !== undefined) {
    return (
      <div className="pool-power-line" title="Average and peak are equal">
        <small>{steam ? "Steam" : "Power"}</small>
        <strong>{format(peak)}</strong>
      </div>
    );
  }
  return (
    <>
      {average !== undefined ? (
        <div className="pool-power-line">
          <small>{steam ? "Avg steam" : "Avg"}</small>
          <strong>{format(average)}</strong>
        </div>
      ) : null}
      {peak !== undefined ? (
        <div className="pool-power-line">
          <small>{steam ? "Peak steam" : "Peak"}</small>
          <strong>{format(peak)}</strong>
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
  const orderTarget = useOrderTarget("products", storage.id);
  return (
    <tr {...orderTarget} className="pool-product" data-worksheet-product={storage.id}>
      <td>
        <div className="pool-balance-name">
          <OrderHandle
            kind="products"
            id={storage.id}
            label={`product ${storage.displayName ?? storage.resourceId}`}
          />
          <ResourceLink
            compact
            resource={{
              kind: storage.kind,
              id: storage.resourceId,
              displayName: storage.displayName,
              iconPath: storage.iconPath,
              iconAtlas: storage.iconAtlas,
              amount: 1,
            }}
          />
        </div>
      </td>
      <td className="pool-product-target">
        {readOnly ? (
          <span>
            {storage.targetPerSecond === undefined
              ? "No target"
              : formatSlotRate(storage.targetPerSecond, storage.kind)}
          </span>
        ) : (
          <TargetLine storage={storage} result={result} />
        )}
      </td>
      <td className={result?.targetUnreachable ? "pool-flow-input" : "pool-sheet-muted"}>
        {result?.targetUnreachable ? (
          "Unreachable"
        ) : (
          <BalanceRate value={result?.producedPerSecond ?? 0} kind={storage.kind} sign={0} />
        )}
      </td>
      <td>
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
      </td>
    </tr>
  );
}

function BalanceRow({ balance }: { balance: ResourceBalance }) {
  const orderTarget = useOrderTarget("resources", balance.key);
  const dataset = useFactoryStore((state) => state.dataset);
  const resource = dataset?.resources.find(
    (entry) => entry.kind === balance.kind && entry.id === balance.resourceId,
  );
  const net = balance.surplusPerSecond - balance.deficitPerSecond;
  return (
    <tr {...orderTarget} data-worksheet-resource={balance.key}>
      <td>
        <div className="pool-balance-name">
          <OrderHandle
            kind="resources"
            id={balance.key}
            label={`resource ${balance.displayName ?? balance.resourceId}`}
          />
          <ResourceLink
            compact
            resource={{
              ...resource,
              kind: balance.kind,
              id: balance.resourceId,
              displayName: balance.displayName ?? resource?.displayName,
              amount: 1,
            }}
          />
        </div>
      </td>
      <td>
        <BalanceRate value={balance.deficitPerSecond} kind={balance.kind} sign={-1} />
      </td>
      <td>
        <BalanceRate value={balance.surplusPerSecond} kind={balance.kind} sign={1} />
      </td>
      <td>
        <BalanceRate value={balance.consumedPerSecond} kind={balance.kind} sign={0} />
      </td>
      <td>
        <BalanceRate value={net} kind={balance.kind} sign={Math.sign(net)} />
      </td>
    </tr>
  );
}

function BalanceRate({
  value,
  kind,
  sign,
}: {
  value: number;
  kind: ResourceAmount["kind"];
  sign: number;
}) {
  return (
    <span
      className={`inspector-resource-net pool-balance-rate ${sign < 0 ? "pool-flow-input" : sign > 0 ? "pool-flow-output" : "pool-flow-internal"}`}
    >
      {formatSignedRate(value, kind, sign)}
      <span className="inspector-unit">{rateSuffixForKind(kind).trim()}</span>
    </span>
  );
}
