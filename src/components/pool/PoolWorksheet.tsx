"use client";
import { targetStatus } from "./target-status";
import { TargetRateHelp } from "./TargetRateHelp";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { playBoardSound } from "@/lib/board-sounds";
import { isInputRate, storageTargetMode } from "@/lib/model/storage-target";
import { StorageTargetRule } from "../flow/StorageTargetRule";
import { productionGroupDescendants, productionGroupTree } from "@/lib/model/production-groups";
import { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { ProductionScopeHeader } from "./ProductionGroups";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronDown, Copy, Plus, RefreshCw, Search, Settings, Trash2, X } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { resourceLabel, isCropProductionRecipe } from "@/lib/model";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { type MachineListEntry } from "@/lib/model/machine-list";
import type { ResourceAmount, FactoryStorage, ProductionGroup } from "@/lib/model/types";
import { getStorageRoles, type StorageRole } from "@/lib/model/storage-role";
import { powerDisplayFromEuT, powerDisplaySuffix, rateSuffixForKind } from "@/lib/model/rate-unit";
import { ResourceIcon } from "../nei/ResourceIcon";
import { getCategoryPresentation } from "@/lib/model/category-presentation";
import { MinecraftTooltip } from "../nei/MinecraftTooltip";
import { CircuitChip, RecipeNodeEditor, SolvedMachinesStat } from "../flow/RecipeNode";
import { ItemPickerPopover } from "../ItemPickerPopover";
import { TargetLine } from "../flow/StorageNode";
import { RecipeTooltip } from "../flow/RecipeTooltip";
import { formatPoolPowerValue as formatPowerValue, formatPoolRate as formatSlotRate, formatPoolRateBare as formatSlotRateBare, formatPoolSignedRate as formatSignedRate } from "./worksheet-format";
import { WorksheetPower } from "./WorksheetPower";
import "../inspector/panel.css";
import { buildStatusTooltip, buildPortTooltip } from "../flow/recipe-tooltip-data";
import type { RailPort } from "../flow/node-verdict";
import {
  getRecipeProgrammedCircuit,
  isProgrammedCircuitResource,
} from "@/lib/model/programmed-circuit";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { useBrowseMenu, type BrowseMode } from "../browse-menu";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { RESOURCE_DRAG_TYPE, readResourceDrag } from "@/lib/resource-drag";
import {
  OrderHandle,
  WorksheetOrderContext,
  moveWorksheetEntry,
  orderWorksheetEntries,
  useOrderTarget,
} from "./worksheet-drag";
import {
  buildWorksheetGroups,
  buildProductionGroupFlows,
  filterWorksheetGroups,
  type WorksheetGroup,
  type WorksheetSection,
} from "./worksheet-model";

import { WorksheetPointerDrag, useWorksheetPointerDrag } from "./worksheet-pointer-drag";
import "./pool-worksheet.css";
import "./pool-worksheet-density.css";

export function PoolWorksheet() {
  const summaryId = useId();
  const targetHelp = useRef<HTMLElement>(null);
  const targetHelpButton = useRef<HTMLButtonElement>(null);
  const [explainedTarget, setExplainedTarget] = useState<string>();
  const closeTargetHelp = () => {
    playBoardSound("pageClose");
    setExplainedTarget(undefined);
  };
  const explainTarget = (id: string, button: HTMLButtonElement) => {
    targetHelpButton.current = button;
    if (id === explainedTarget) { closeTargetHelp(); return; }
    playBoardSound("pageOpen");
    setExplainedTarget(id);
  };
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
          ".pool-machine-settings .nowheel, .pool-editor-power [data-power-controls], .pool-editor-power .nowheel",
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || useFactoryStore.getState().recipeBrowserResource ||
          document.querySelector('[role="dialog"], [data-item-picker]')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        searchInput.current?.select();
      } else if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, closeSearch]);
  useEffect(() => {
    const scrollers = rootRef.current?.querySelectorAll<HTMLElement>(
      ".pool-products-scroll, .pool-sheet-balance .pool-resources-scroll",
    );
    if (!scrollers) return;
    const update = () => {
      for (const scroller of scrollers) {
        scroller.parentElement?.toggleAttribute(
          "data-more-below",
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1,
        );
      }
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    for (const scroller of scrollers) {
      scroller.addEventListener("scroll", update, { passive: true });
      observer?.observe(scroller);
      if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    }
    update();
    return () => {
      observer?.disconnect();
      for (const scroller of scrollers) scroller.removeEventListener("scroll", update);
    };
  }, []);
  const workspace = useWorkspaceView();
  const savedOrder = (kind: string) => workspace.poolWorksheetOrder[`${project.id}:${kind}`] ?? [];
  const groups = useMemo(() => buildWorksheetGroups(project, result), [project, result]);
  // Keep numeric/status columns aligned without reserving space for values
  // this plan does not display. Observe the content, not its allocated cell.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const columns = [
      { variable: "--pool-tier-width", selector: ".pool-tier-cell .pool-editor-power", minimum: 48, padding: 8 },
      { variable: "--pool-count-width", selector: ".pool-machine-count [data-tooltip-root] > div", minimum: 28, padding: 0 },
      { variable: "--pool-status-width", selector: ".pool-status", minimum: 48, padding: 8 },
      { variable: "--pool-power-width", selector: ".pool-machine-power-value", minimum: 48, padding: 8 },
    ].map(column => ({ ...column, elements: [...root.querySelectorAll<HTMLElement>(column.selector)] }));
    const measure = () => {
      for (const column of columns) {
        const width = Math.max(column.minimum, ...column.elements.map(element => element.offsetWidth + column.padding));
        root.style.setProperty(column.variable, width + "px");
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    for (const column of columns) for (const element of column.elements) observer?.observe(element);
    return () => observer?.disconnect();
  }, [groups, workspace, query]);
  const orderedGroups = orderWorksheetEntries(
    groups,
    savedOrder("machines"),
    (group) => group.owner.id,
  );
  const shown = filterWorksheetGroups(orderedGroups, query);
  const productionTree = useMemo(
    () => productionGroupTree(project.productionGroups ?? []),
    [project.productionGroups],
  );
  const groupResources = useMemo(
    () => getPoolGroupResources(project, result).filter((row) => row.resource.kind !== "power"),
    [project, result],
  );
  const collapsedProduction = workspace.poolCollapsedProductionGroups[project.id] ?? [];
  const hiddenScopes = new Set<string>();
  for (const { group } of productionTree) {
    if (
      !query.trim() &&
      (collapsedProduction.includes(group.id) ||
        (group.parentId && hiddenScopes.has(group.parentId)))
    )
      hiddenScopes.add(group.id);
  }
  const visible = shown.filter(
    (entry) => !entry.owner.productionGroupId || !hiddenScopes.has(entry.owner.productionGroupId),
  );
  const roles = useMemo(() => getStorageRoles(project), [project]);
  const products = orderWorksheetEntries(
    (project.storages ?? []).filter((storage) => roles.get(storage.id) === "product" || roles.get(storage.id) === "source"),
    savedOrder("products"),
    (storage) => storage.id,
  );
  const helpTarget = !result.stale ? products.find(storage => storage.id === explainedTarget && result.storages[storage.id]?.targetUnreachable) : undefined;
  useDropdownDismiss(Boolean(helpTarget), { refs: [targetHelp, targetHelpButton], onClose: closeTargetHelp, fade: true });
  useEffect(() => {
    if (helpTarget) targetHelp.current?.focus({ preventScroll: true });
    else setExplainedTarget(undefined);
  }, [helpTarget]);
  const calculationIssue = !result.stale ? result.bottlenecks.find(issue => issue.severity === "critical" && issue.kind === "missing-recipe") : undefined;
  const ids = {
    machines: orderedGroups.map((group) => group.owner.id),
    products: products.map((storage) => storage.id),
    resources: [],
  };
  const renderMachine = (group: WorksheetGroup) => (
    <MachineRows
      key={group.owner.id}
      group={group}
      readOnly={readOnly}
      collapsed={(workspace.poolCollapsedMachines[project.id] ?? []).includes(group.owner.id)}
      onToggleCollapsed={() => {
        const current = workspace.poolCollapsedMachines[project.id] ?? [];
        writeWorkspaceView({
          poolCollapsedMachines: {
            ...workspace.poolCollapsedMachines,
            [project.id]: current.includes(group.owner.id)
              ? current.filter((id) => id !== group.owner.id)
              : [...current, group.owner.id],
          },
        });
      }}
    />
  );
  const renderScope = (group?: ProductionGroup): ReactNode => {
    const scopeRows = groupResources.filter((row) => row.groupId === group?.id);
    const descendants = group
      ? productionGroupDescendants(project.productionGroups ?? [], group.id)
      : undefined;
    const powerEntries = groups
      .filter(
        (entry) =>
          !descendants ||
          (entry.owner.productionGroupId && descendants.has(entry.owner.productionGroupId)),
      )
      .flatMap((entry) => (entry.machine ? [entry.machine] : []));
    const boundary = (rows: typeof result.externalInputs, side: "input" | "output") =>
      rows
        .filter((row) => row.kind !== "power")
        .map((row) => ({
          resource: {
            ...groupResources.find((entry) => entry.key === row.key)?.resource,
            kind: row.kind,
            id: row.resourceId,
            displayName: row.displayName,
            amount: 1,
          },
          rate: side === "input" ? row.deficitPerSecond : row.surplusPerSecond,
        }))
        .filter((row) => row.rate > 1e-6);
    const { inputs, outputs } = group
      ? buildProductionGroupFlows(project.productionGroups ?? [], group.id, groupResources)
      : {
          inputs: boundary(result.externalInputs, "input"),
          outputs: boundary(result.unconsumedOutputs, "output"),
        };
    const collapsed = Boolean(group && hiddenScopes.has(group.id));
    const content = (
      <>
        <ProductionScopeHeader
          group={group}
          resources={scopeRows}
          readOnly={readOnly}
          collapsed={collapsed}
          hasContents={Boolean(
            groups.some((entry) => entry.owner.productionGroupId === group?.id) ||
            project.productionGroups?.some((entry) => entry.parentId === group?.id),
          )}
          inputs={inputs}
          outputs={outputs}
          power={<WorksheetPower entries={powerEntries} compact />}
          renderResource={(resource) => <ResourceLink compact iconsOnly resource={resource} />}
          onToggle={
            group
              ? () =>
                  writeWorkspaceView({
                    poolCollapsedProductionGroups: {
                      ...workspace.poolCollapsedProductionGroups,
                      [project.id]: collapsedProduction.includes(group.id)
                        ? collapsedProduction.filter((id) => id !== group.id)
                        : [...collapsedProduction, group.id],
                    },
                  })
              : undefined
          }
        />
        {!collapsed ? (
          <>
            {visible.some((entry) => entry.owner.productionGroupId === group?.id) ? <ColumnHeadings /> : null}
            {visible
              .filter((entry) => entry.owner.productionGroupId === group?.id)
              .map(renderMachine)}
            {(project.productionGroups ?? [])
              .filter((entry) => entry.parentId === group?.id)
              .map((child) => renderScope(child))}
          </>
        ) : null}
      </>
    );
    return group ? (
      <tbody key={group.id} className="pool-group-frame">
        <tr>
          <td colSpan={10}>
            <table className="pool-sheet-table" aria-label={"Recipes in " + group.name}>
              <colgroup>
                <col className="pool-col-picture" />
                <col className="pool-col-machine" />
                <col className="pool-col-tier" />
                <col className="pool-col-count" />
                <col className="pool-col-status" />
                <col className="pool-col-circuit" />
                <col className="pool-col-power" />
                <col className="pool-col-io" />
                <col className="pool-col-io" />
                <col className="pool-col-actions" />
              </colgroup>
              {content}
            </table>
          </td>
        </tr>
      </tbody>
    ) : (
      content
    );
  };
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      data-viewer-inspect
      data-pool-worksheet
      className="pool-worksheet pool-worksheet--dense nodrag nopan nowheel"
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
            if (readOnly) return false;
            const next = moveWorksheetEntry(ids[kind], from, to, after);
            if (kind === "machines") {
              const destination = project.nodes.find((node) => node.id === to)?.productionGroupId;
              useFactoryStore.getState().moveToProductionGroup([from], destination);
            }
            if (next.every((id, index) => id === ids[kind][index]))
              return useFactoryStore.getState().project !== project;
            writeWorkspaceView({
              poolWorksheetOrder: {
                ...workspace.poolWorksheetOrder,
                [`${project.id}:${kind}`]: [
                  ...next,
                  ...savedOrder(kind).filter((id) => !next.includes(id)),
                ],
              },
            });
            return true;
          },
        }}
      >
        <WorksheetPointerDrag>
          <div className="pool-sheet-scroll">
            <div className="pool-overview">
              <div className="pool-desired-products">
                <ProductsPane id={`${summaryId}-products`}>
                  <div className="pool-products-scroll">
                    <table
                      className="pool-summary-table pool-products-table"
                      aria-label="Pool products"
                    >
                      <thead>
                        <tr className="pool-rates-columns">
                          <th scope="col" className="pool-rates-name-heading"><div className="pool-overview-title"><h3>Desired rates</h3>{!readOnly ? <span className="pool-drop-hint">(Drag items here)</span> : null}</div></th>
                          <th scope="col">Rule</th>
                          <th scope="col" title="Positive amounts set output goals; negative amounts set input goals.">Target (±)</th>
                          <th scope="col">Actual</th>
                          <th scope="col">Status</th>
                          <th scope="col"><span className="sr-only">Actions</span>{!readOnly ? <AddPoolProduct /> : null}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((storage) => (
                          <Product key={storage.id} storage={storage} role={roles.get(storage.id)} helpOpen={helpTarget?.id === storage.id} onExplain={(button) => explainTarget(storage.id, button)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ProductsPane>
                {helpTarget ? <section ref={targetHelp} tabIndex={-1} className="pool-target-popover pool-target-help" aria-label="Target explanation">
                  <TargetRateHelp storage={helpTarget} input={isInputRate(helpTarget, roles.get(helpTarget.id))} result={result.storages[helpTarget.id]} project={project} />
                </section> : null}
              </div>
              <WorksheetPower
                entries={groups.flatMap((entry) => (entry.machine ? [entry.machine] : []))}
                title="Total power"
              />
            </div>
            {calculationIssue ? <p role="alert" className="pool-calculation-issue">{calculationIssue.message}</p> : null}
            {searchOpen ? (
              <div className="pool-machine-toolbar" role="search" aria-label="Find in worksheet">
                <label className="pool-sheet-search"><Search className="h-3.5 w-3.5" />
                  <input ref={searchInput} aria-label="Filter worksheet" placeholder="Search machines or items" value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
                <button type="button" className="pool-sheet-icon-button" aria-label="Close worksheet search" title="Close search (Esc)" onClick={closeSearch}><X /></button>
              </div>
            ) : null}
            <table className="pool-sheet-table" aria-label="Recipes running in the pool">
              <colgroup>
                <col className="pool-col-picture" />
                <col className="pool-col-machine" />
                <col className="pool-col-tier" />
                <col className="pool-col-count" />
                <col className="pool-col-status" />
                <col className="pool-col-circuit" />
                <col className="pool-col-power" />
                <col className="pool-col-io" />
                <col className="pool-col-io" />
                <col className="pool-col-actions" />
              </colgroup>
              {renderScope()}
            </table>
            {!shown.length ? (
              <div className="pool-sheet-empty">
                {groups.length
                  ? "No recipes match this filter."
                  : "Add recipes from the item browser."}
              </div>
            ) : null}
          </div>
        </WorksheetPointerDrag>
      </WorksheetOrderContext.Provider>
    </section>
  );
}

function ProductsPane({ children, id }: { children: ReactNode; id: string }) {
  const [hover, setHover] = useState(false);
  const [resourceDragging, setResourceDragging] = useState(false);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  useEffect(() => {
    if (readOnly) return;
    const start = (event: DragEvent) => setResourceDragging(Boolean(event.dataTransfer?.types.includes(RESOURCE_DRAG_TYPE)));
    const finish = () => { setResourceDragging(false); setHover(false); };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", finish);
    window.addEventListener("drop", finish);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", finish);
      window.removeEventListener("drop", finish);
    };
  }, [readOnly]);
  return (
    <div
      className="pool-sheet-products"
      id={id}
      aria-label="Desired rates drop zone"
      data-resource-drop={!readOnly && hover || undefined}
      data-resource-ready={!readOnly && resourceDragging || undefined}
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

function AddPoolProduct({ groupId }: { groupId?: string }) {
  const [open, setOpen] = useState(false);
  const add = useFactoryStore((state) => state.addPoolStorage);
  return (
    <div className="pool-add-product">
      <button
        type="button"
        className="pool-add-button"
        aria-label={groupId ? "Add rate to this group" : "Add rate"}
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
              undefined,
              groupId,
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
  collapsed,
  onToggleCollapsed,
}: {
  group: WorksheetGroup;
  readOnly: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  useRateDisplayUnits();
  const { owner, machine, sections } = group;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus({ preventScroll: true });
  };
  const settingsId = useId();
  const orderTarget = useOrderTarget("machines", owner.id);
  const { begin, suppressClick } = useWorksheetPointerDrag();
  const updateNode = useFactoryStore((state) => state.updateNode);
  const first = sections[0];
  const handler = first.recipe ? getSelectedMachineHandler(first.recipe, owner) : undefined;
  const label = machine?.label ?? handler?.label ?? "Missing recipe";
  const isCrop = first.recipe && isCropProductionRecipe(first.recipe);
  const countNeeded = isCrop
    ? sections.reduce((sum, section) => sum + (section.result?.theoreticalMachinesRequired ?? 0), 0)
    : (machine?.count ??
      sections.reduce(
        (sum, section) => sum + (section.result?.theoreticalMachinesRequired ?? 0),
        0,
      ));
  const visibleSections = collapsed ? sections.slice(0, 1) : sections;
  const renderRows = (controls: ReactNode, picture: ReactNode, settings: ReactNode, tier: ReactNode = null) => (
    <tbody
      {...orderTarget}
      onPointerDownCapture={(event) => {
        // Keep touch scrolling, item pickup, open editors, and menus independent.
        const target = event.target as Element;
        if (
          event.pointerType !== "mouse" ||
          !event.currentTarget.contains(target) ||
          target.closest(
            '.pool-resource-link, .pool-order-handle, .pool-settings-row, input, textarea, select, a, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="menu"]',
          )
        ) return;
        begin(event, { kind: "machines", id: owner.id, label: "machine " + label });
      }}
      onClickCapture={(event) => {
        if (!suppressClick(event.currentTarget)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      data-worksheet-node={owner.id}
      data-collapsed={collapsed || undefined}
      data-settings-open={(settingsOpen && Boolean(settings)) || undefined}
      className={owner.enabled === false ? "pool-machine-off" : undefined}
    >
      {visibleSections.map((section, index) => (
        <tr key={section.section} style={{ "--pool-section-row": index + 2 } as CSSProperties}>
          {index === 0 ? (
            <>
              <td rowSpan={visibleSections.length} className="pool-picture-cell">
                <div className="pool-machine-row-tools">
                  <OrderHandle kind="machines" id={owner.id} label={"machine " + label} />
                </div>
                <div className="pool-machine-picture">{picture}</div>
              </td>
              <td
                rowSpan={visibleSections.length}
                className="pool-shared-cell pool-machine-cell"
                data-machine-editor-anchor
              >
                <div className="pool-machine-layout">
                  <div className="pool-machine-details">
                    {collapsed ? (
                      <span className="pool-collapsed-name" title={label}>
                        {label}
                      </span>
                    ) : (
                      controls
                    )}
                  </div>
                </div>
              </td>
              <td rowSpan={visibleSections.length} className="pool-tier-cell">{tier}</td>
              <td rowSpan={visibleSections.length} className="pool-count-cell">
                <fieldset disabled={readOnly} className="pool-machine-count">
                  {first.recipe && isCustomRateRecipe(first.recipe) ? null : (
                    <SolvedMachinesStat
                      inline
                      label={isCrop ? "Seeds" : "Machines"}
                      needed={countNeeded}
                      pinned={owner.solvePin}
                      onPin={(solvePin) => updateNode(owner.id, { solvePin })}
                    />
                  )}
                </fieldset>
              </td>
            </>
          ) : null}
          <td className="pool-status-cell">
            <div className="pool-section-status">
              <Status section={section} />
              {sections.length > 1 ? (
                <span className="pool-shared-label" title={section.recipe?.name}>
                  #{index + 1}
                </span>
              ) : null}
            </div>
          </td>
          <td className="pool-circuit-cell">
            <div className="pool-circuit-slot">
              <CircuitChip
                small
                circuit={section.display ? (getRecipeProgrammedCircuit(section.display) ?? {}) : {}}
              />
            </div>
          </td>
          {index === 0 ? (
            <td rowSpan={visibleSections.length} className="pool-power-cell">
              <MachinePower entry={machine} />
            </td>
          ) : null}
          <td className="pool-takes-cell">
            {collapsed ? (
              <CollapsedPorts sections={sections} nodeId={owner.id} side="inputs" />
            ) : (
              <PortList
                ports={section.ports.inputs}
                nodeId={owner.id}
                section={section}
                nonConsumed={section.nonConsumed.filter(
                  (resource) => !isProgrammedCircuitResource(resource),
                )}
              />
            )}
          </td>
          <td className="pool-makes-cell">
            {collapsed ? (
              <CollapsedPorts sections={sections} nodeId={owner.id} side="outputs" />
            ) : (
              <PortList ports={section.ports.outputs} nodeId={owner.id} section={section} />
            )}
          </td>
          <td className="pool-actions-cell">
            <div className="pool-row-actions">
              {index === 0 ? (
                <>
                  <button
                    type="button"
                    className="pool-sheet-icon-button pool-settings-toggle"
                    aria-label={"Settings for " + label}
                    title="Machine settings"
                    ref={settingsButton}
                    disabled={!settings}
                    aria-expanded={Boolean(settings) && settingsOpen}
                    aria-controls={settings ? settingsId : undefined}
                    onClick={() => setSettingsOpen((open) => !open)}
                  >
                    <Settings aria-hidden />
                  </button>
                  {!readOnly ? (
                    <>
                      <button
                        type="button"
                        className="pool-sheet-icon-button"
                        aria-label="Duplicate machine"
                        title="Duplicate machine"
                        onClick={() => useFactoryStore.getState().duplicateNode(owner.id)}
                      >
                        <Copy />
                      </button>
                      <button
                        type="button"
                        className="pool-sheet-icon-button"
                        aria-label="Replace recipe"
                        title="Replace recipe"
                        onClick={() => useFactoryStore.getState().beginRecipeRefactor(owner.id)}
                      >
                        <RefreshCw />
                      </button>
                      <button
                        type="button"
                        className="pool-sheet-icon-button"
                        aria-label="Remove machine"
                        title="Remove machine"
                        onClick={() => useFactoryStore.getState().deleteNode(owner.id)}
                      >
                        <Trash2 />
                      </button>
                    </>
                  ) : null}
                  {sections.length > 1 ? (
                    <button
                      type="button"
                      className="pool-collapse-machine"
                      aria-label={(collapsed ? "Expand " : "Collapse ") + label}
                      title={collapsed ? "Show recipes" : "Fold recipes"}
                      aria-expanded={!collapsed}
                      onClick={onToggleCollapsed}
                    >
                      <ChevronDown size={12} />
                    </button>
                  ) : null}
                </>
              ) : !readOnly ? (
                <button
                  type="button"
                  className="pool-sheet-icon-button"
                  aria-label={"Remove recipe " + (index + 1) + " from shared machine"}
                  title="Remove recipe from shared machine"
                  onClick={() =>
                    useFactoryStore.getState().removeRecipeSection(owner.id, section.section)
                  }
                >
                  <X />
                </button>
              ) : null}
            </div>
          </td>
        </tr>
      ))}
      {settingsOpen && settings ? (
        <tr className="pool-settings-row">
          <td colSpan={10}>
            <div
              id={settingsId}
              className="pool-settings-section"
              role="region"
              aria-label={"Machine settings for " + label}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  closeSettings();
                }
              }}
            >
              {settings}
              <button
                type="button"
                className="pool-sheet-icon-button"
                aria-label="Close machine settings"
                onClick={closeSettings}
              >
                <X />
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
  return first.recipe ? (
    <RecipeNodeEditor
      data={{ projectNode: owner, recipe: first.recipe, result: first.result }}
      render={renderRows}
    />
  ) : (
    renderRows(<span>{label}</span>, null, null)
  );
});

function CollapsedPorts({
  sections,
  nodeId,
  side,
}: {
  sections: WorksheetSection[];
  nodeId: string;
  side: "inputs" | "outputs";
}) {
  return (
    <div className="pool-collapsed-ports" aria-label={side === "inputs" ? "Takes" : "Makes"}>
      {sections.map((section) => (
        <PortList
          key={section.section}
          ports={section.ports[side]}
          nodeId={nodeId}
          section={section}
          nonConsumed={
            side === "inputs"
              ? section.nonConsumed.filter((resource) => !isProgrammedCircuitResource(resource))
              : []
          }
        />
      ))}
    </div>
  );
}

function ColumnHeadings() {
  return <tbody className="pool-column-headings"><tr>
    <th colSpan={2} scope="col">Machine</th>
    <th scope="col" className="pool-tier-heading" title="Voltage tier and amperage">Tier</th>
    <th scope="col">Count</th>
    <th scope="col"><span className="pool-status-heading">Status</span><span className="pool-status-heading-dot" aria-hidden="true">●</span></th><th scope="col">Circuit</th><th scope="col">Power</th>
    <th scope="col">Takes</th><th scope="col">Makes</th><th scope="col">Actions</th>
  </tr></tbody>;
}

function Status({ section }: { section: WorksheetSection }) {
  const label = section.result?.powerStalled ? "Power stalled" : buildStatusTooltip(section.verdict, "pool").title;
  return (
    <MinecraftTooltip openOnFocus placement="below"
      content={() => <RecipeTooltip view={buildStatusTooltip(section.verdict, "pool")} />}
    >
      <span
        className={`pool-status pool-status--${section.result?.powerStalled ? "power-stalled" : section.verdict.kind}`}
        tabIndex={0} role="img" aria-label={label}
      >
        <span className="pool-status-text">{label}</span>
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
    <div className="pool-port-list" role="group" aria-label="Recipe items">
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
                nameTooltip={false}
                iconsOnly
              />
            </div>
          </MinecraftTooltip>
        </div>
      ))}
      {nonConsumed.map((resource, index) => (
        <div className="pool-port flow-port pool-port-line" key={`nc:${index}`}>
          <ResourceLink resource={resource} nodeId={nodeId} iconsOnly />
          <span className="pool-port-note">NC · ×{resource.amount}</span>
        </div>
      ))}
    </div>
  );
}

function ResourceLink({
  resource,
  nodeId,
  compact = false,
  nameTooltip = true,
  iconsOnly = false,
}: {
  resource: ResourceAmount;
  nodeId?: string;
  compact?: boolean;
  nameTooltip?: boolean;
  iconsOnly?: boolean;
}) {
  const category = useFactoryStore((state) =>
    getCategoryPresentation(state.project.recipes, resource.kind, resource.id),
  );
  const displayResource = category ? { ...resource, alternatives: category.alternatives } : resource;
  const hasCategoryArt = displayResource.alternatives?.some((face) => face.iconPath || face.iconAtlas);
  const { begin, suppressClick } = useWorksheetPointerDrag();
  const browse = (mode: BrowseMode) => {
    if (resource.kind === "power") return;
    useFactoryStore.getState().browseResource({ ...resource, anchorNodeId: nodeId }, mode);
  };
  const { pressHandlers, menu, wasDragged, wasTouch, openFromTap } = useBrowseMenu({
    name: resourceLabel(displayResource),
    onPick: browse,
  });
  return (
    <>
      <button
        type="button"
        className="pool-resource-link"
        aria-label={iconsOnly ? resourceLabel(displayResource) : undefined}
        title={iconsOnly && nameTooltip ? resourceLabel(displayResource) : undefined}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        {...pressHandlers}
        onPointerDown={(event) => {
          pressHandlers.onPointerDown(event);
          begin(event, { resource });
        }}
        onClick={(event) => {
          if (suppressClick(event.currentTarget) || wasDragged()) return;
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
        {iconsOnly && !resource.iconPath && !resource.iconAtlas && !hasCategoryArt && resource.kind !== "power" ? (
          <span className="pool-resource-fallback" aria-hidden>
            {resourceLabel(displayResource).slice(0, 2)}
          </span>
        ) : (
          <ResourceIcon
            resource={displayResource}
            size="sm"
            bare
            className={
              iconsOnly
                ? "pool-item-icon !h-[18px] !w-[18px]"
                : compact
                  ? "pool-item-icon !h-4 !w-4"
                  : "pool-item-icon !h-8 !w-8"
            }
            iconPixelSize={iconsOnly ? 36 : compact ? 22 : 44}
            showAmount={false}
            showConsumedState={false}
            tooltip={false}
          />
        )}
        {iconsOnly ? null : (
          <span title={nameTooltip ? resourceLabel(displayResource) : undefined}>
            {resourceLabel(displayResource)}
          </span>
        )}
      </button>
      {menu}
    </>
  );
}

function MachinePower({ entry }: { entry?: MachineListEntry }) {
  if (!entry) return <span className="pool-sheet-muted">—</span>;
  const steam = entry.steamLs !== undefined;
  const made = entry.madeEuT !== undefined;
  const average = (steam ? entry.avgSteamLs : (entry.avgMadeEuT ?? entry.avgEuT)) ?? 0;
  const peak = (steam ? entry.steamLs : (entry.madeEuT ?? entry.euT)) ?? 0;
  const number = (value: number) =>
    steam ? formatSlotRateBare(value, "fluid") : formatPowerValue(powerDisplayFromEuT(value));
  const unit = steam ? rateSuffixForKind("fluid").trim() : powerDisplaySuffix();
  const description =
    (made ? "Generated" : steam ? "Steam" : "Power") +
    ": average " +
    number(average) +
    " " +
    unit +
    ", peak " +
    number(peak) +
    " " +
    unit;
  return (
    <span
      className={"pool-machine-power-value" + (made ? " pool-flow-output" : "")}
      title={description}
      aria-label={description}
    >
      <strong>
        {made ? "+" : ""}
        {number(average)}
      </strong>
      <small>{unit}</small>
    </span>
  );
}

function Product({ storage, role, onExplain, helpOpen }: { storage: FactoryStorage; onExplain: (button: HTMLButtonElement) => void; helpOpen: boolean; role: StorageRole | undefined }) {
  const scopeName = useFactoryStore(
    (state) =>
      state.project.productionGroups?.find((group) => group.id === storage.productionGroupId)?.name,
  );
  const result = useFactoryStore((state) => state.lastResult.storages[storage.id]);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const orderTarget = useOrderTarget("products", storage.id);
  const ignored = storageTargetMode(storage, role) === "ignore";
  const inputGoal = isInputRate(storage, role);
  const stale = useFactoryStore(state => state.lastResult.stale);
  const held = useFactoryStore(state => state.lastResult.held);
  const status = targetStatus(storage, role, result, stale, held);
  return (
    <tr {...orderTarget} className="pool-product" data-worksheet-product={storage.id} data-target-ignored={ignored || undefined}>
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
        {scopeName ? (
          <span className="pool-product-scope">
            Target in {scopeName}
            {!readOnly ? (
              <button
                type="button"
                onClick={() => useFactoryStore.getState().moveToProductionGroup([storage.id])}
              >
                Make global
              </button>
            ) : null}
          </span>
        ) : null}
      </td>
      <td className="pool-product-rule">
        <StorageTargetRule storage={storage} input={inputGoal} className="pool-target-rule" />
      </td>
      <td className="pool-product-target">
        <div className="pool-target-controls">
        {readOnly ? (
          <span>
            {storage.targetPerSecond === undefined
              ? "No target"
              : formatSlotRate((inputGoal ? -1 : 1) * Math.abs(storage.targetPerSecond), storage.kind)}
          </span>
        ) : (
          <TargetLine inlinePencil storage={storage} result={result} input={inputGoal} formatDisplayRate={formatSlotRate} />
        )}
        </div>
      </td>
      <td className={result?.targetUnreachable ? "pool-flow-input" : "pool-sheet-muted"}>
        <span className="inline-flex max-w-full items-center justify-end gap-1">
          <BalanceRate value={inputGoal ? (result?.consumedPerSecond ?? 0) : (result?.producedPerSecond ?? 0)} kind={storage.kind} sign={inputGoal ? -1 : 0} />
        </span>
      </td>
      <td className="pool-product-status" data-tone={status.tone}>
        {status.explain ? <button type="button" aria-expanded={helpOpen} onClick={(event) => onExplain(event.currentTarget)} aria-label={status.label + ": explain target for " + (storage.displayName ?? storage.resourceId)}>
          <span className="pool-state-dot" aria-hidden /><span className="pool-rate-label-full">{status.label}</span><span className="pool-rate-label-compact">{status.compact ?? status.label}</span><span className="pool-status-why">Why?</span>
        </button> : <span className="pool-rate-state"><span className="pool-state-dot" aria-hidden /><span className="pool-rate-label-full">{status.label}</span><span className="pool-rate-label-compact">{status.compact ?? status.label}</span></span>}
      </td>
      <td>
        {!readOnly ? (
          <button
            type="button"
            className="pool-sheet-icon-button"
            aria-label={`Remove rate ${storage.displayName ?? storage.resourceId}`}
            onClick={() => useFactoryStore.getState().deleteStorage(storage.id)}
          >
            <X />
          </button>
        ) : null}
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
