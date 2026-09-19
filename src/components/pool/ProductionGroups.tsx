"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, FolderPlus, GripVertical, SlidersHorizontal, Trash2 } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { productionGroupDescendants, productionGroupTree } from "@/lib/model/production-groups";
import type { ProductionGroup, ResourceAmount } from "@/lib/model/types";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { formatSlotRateBare } from "../flow/flow-explainers";
import { rateSuffixForKind } from "@/lib/model/rate-unit";
import { ResourceIcon } from "../nei/ResourceIcon";
import { useWorksheetPointerDrag } from "./worksheet-pointer-drag";

export function ProductionGroupSelect({
  value,
  label,
  onChange,
  disabled,
  exclude,
}: {
  value?: string;
  label: string;
  onChange: (value?: string) => void;
  disabled?: boolean;
  exclude?: Set<string>;
}) {
  const savedGroups = useFactoryStore((state) => state.project.productionGroups);
  const options = productionGroupTree(savedGroups ?? []).filter(
    ({ group }) => !exclude?.has(group.id),
  );
  return (
    <label className="pool-production-move">
      <span>{exclude ? "Inside" : "Group"}</span>
      <select
        className="pool-production-select"
        aria-label={label}
        value={value ?? ""}
        disabled={disabled || !options.length}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Top level</option>
        {options.map(({ group, depth }) => (
          <option key={group.id} value={group.id}>
            {"· ".repeat(depth)}
            {group.name}
          </option>
        ))}
      </select>
    </label>
  );
}

type ResourceRow = ReturnType<typeof getPoolGroupResources>[number];
export type GroupFlow = { resource: ResourceAmount; rate: number };
export function ProductionScopeHeader({
  group,
  collapsed,
  hasContents,
  onToggle,
  resources,
  readOnly,
  power,
  inputs,
  outputs,
  renderResource,
}: {
  group?: ProductionGroup;
  collapsed?: boolean;
  hasContents?: boolean;
  onToggle?: () => void;
  resources: ResourceRow[];
  readOnly: boolean;
  power: ReactNode;
  inputs: GroupFlow[];
  outputs: GroupFlow[];
  renderResource: (resource: ResourceAmount) => ReactNode;
}) {
  useRateDisplayUnits();
  const groups = useFactoryStore((state) => state.project.productionGroups);
  const { begin } = useWorksheetPointerDrag();
  const name = group?.name ?? "All production";
  const excluded = group ? productionGroupDescendants(groups ?? [], group.id) : new Set<string>();
  const canMove =
    group && (group.parentId || (groups ?? []).some((entry) => !excluded.has(entry.id)));
  const rulesTitle = group ? "Sharing rules" : "Supply rules";
  const [rulesOpen, setRulesOpen] = useState(false);
  const rulesId = useId();
  const rulesButton = useRef<HTMLButtonElement>(null);
  const [ruleQuery, setRuleQuery] = useState("");
  const [rulePage, setRulePage] = useState(0);
  const links = resources.filter(
    (row) => row.rule || (row.feeders.length && row.takers.some((port) => !port.storage)),
  );
  const needle = ruleQuery.trim().toLowerCase();
  const filteredRules = needle ? links.filter((row) =>
    (row.resource.displayName ?? row.resource.id).toLowerCase().includes(needle)) : links;
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(filteredRules.length / pageSize));
  const page = Math.min(rulePage, pageCount - 1);
  const visibleRules = filteredRules.slice(page * pageSize, (page + 1) * pageSize);
  const flows = (title: string, entries: GroupFlow[]) => (
    <tr>
      <th scope="row" title={title === "Inputs" ? "Materials supplied from outside " + name + "." : "Outputs available after internal use in " + name + "."}>
        <span>{title}{entries.length > 12 ? <small>({entries.length})</small> : null}</span>
      </th>
      <td>
        <section className="pool-flow-items pool-port-list" aria-label={title + " for " + name}>
          {entries.length ? entries.map(({ resource, rate }) => (
            <div key={resource.kind + ":" + resource.id} className="pool-group-flow-item pool-port flow-port pool-port-line">
              {renderResource(resource)}
              <span className="pool-port-rate"><strong>{formatSlotRateBare(rate, resource.kind)}</strong><small>{rateSuffixForKind(resource.kind).trim()}</small></span>
            </div>
          )) : <span className="pool-sheet-muted">None</span>}
        </section>
      </td>
    </tr>
  );
  return (
    <tbody
      className="pool-production-scope"
      data-production-group={group?.id ?? "factory"}
      data-pool-group-target={group?.id ?? ""}
    >
      <tr>
        <td colSpan={8}>
          <div className="pool-production-heading">
            {group ? (
              <>
                {!readOnly ? (
                  <button
                    type="button"
                    className="pool-order-handle"
                    aria-label={"Move group " + name}
                    onPointerDown={(event) =>
                      begin(event, { kind: "groups", id: group.id, label: name })
                    }
                  >
                    <GripVertical size={14} />
                  </button>
                ) : null}
                {hasContents ? (
                  <button
                    type="button"
                    className="pool-collapse-machine"
                    aria-label={(collapsed ? "Expand " : "Collapse ") + name}
                    aria-expanded={!collapsed}
                    onClick={onToggle}
                  >
                    <ChevronDown size={14} />
                  </button>
                ) : null}
              </>
            ) : null}
            {group && !readOnly ? (
              <input
                key={group.name}
                className="pool-production-name"
                aria-label="Production group name"
                defaultValue={group.name}
                onBlur={(event) => {
                  useFactoryStore
                    .getState()
                    .updateProductionGroup(group.id, { name: event.target.value });
                  if (!event.target.value.trim()) event.target.value = group.name;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.currentTarget.value = group.name;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <strong>{name}</strong>
            )}
            {group && !hasContents ? (
              <span className="pool-production-summary">Empty · drag recipes here</span>
            ) : null}
            {group && hasContents ? <div className="pool-group-power-inline">{power}</div> : null}
            <div className="pool-group-actions">
              {links.length ? (
                <button type="button" ref={rulesButton} className="pool-production-key pool-rules-toggle"
                  aria-label={"Material rules for " + name} aria-expanded={rulesOpen} aria-controls={rulesId}
                  onClick={() => setRulesOpen((open) => !open)}>
                  <SlidersHorizontal size={12} aria-hidden />{rulesTitle}
                </button>
              ) : null}
              {!readOnly ? (
                <>
                  {canMove ? (
                    <ProductionGroupSelect
                      value={group.parentId}
                      label={"Parent of " + name}
                      exclude={excluded}
                      onChange={(parentId) =>
                        useFactoryStore.getState().updateProductionGroup(group.id, { parentId })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className="pool-production-key"
                    aria-label={group ? "Add subgroup to " + name : "Add production group"}
                    title={group ? "Add subgroup to " + name : "Add production group"}
                    onClick={() =>
                      useFactoryStore
                        .getState()
                        .createProductionGroup("Group " + ((groups?.length ?? 0) + 1), group?.id)
                    }
                  >
                    <FolderPlus size={14} />
                    <span className="sr-only">Add group</span>
                  </button>
                  {group ? (
                    <button
                      type="button"
                      className="pool-production-key"
                      aria-label={"Delete group " + name}
                      title="Delete group; keep its recipes and subgroups."
                      onClick={() => useFactoryStore.getState().dissolveProductionGroup(group.id)}
                    >
                      <Trash2 size={14} />
                      <span className="sr-only">Delete group</span>
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          {inputs.length || outputs.length ? (
            <div className="pool-flow-summary">
              <table className="pool-flow-table pool-flow-table--inputs" aria-label={"Input totals for " + name}><tbody>{flows("Inputs", inputs)}</tbody></table>
              <table className="pool-flow-table pool-flow-table--outputs" aria-label={"Output totals for " + name}><tbody>{flows("Outputs", outputs)}</tbody></table>
            </div>
          ) : null}
          {rulesOpen && links.length ? (
            <section id={rulesId} className="pool-material-rules" aria-label={rulesTitle + " for " + name}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setRulesOpen(false);
                  rulesButton.current?.focus();
                }
              }}>
              <div className="pool-rules-toolbar">
                <p>{group
                  ? "Automatic: balance here when both produced and consumed here; otherwise share with parent."
                  : "Automatic: use a producer when present; otherwise import. Import anyway can bypass producers."}</p>
                <input type="search" className="pool-rule-search" aria-label={"Find material in " + name}
                  placeholder="Find material…" value={ruleQuery} onChange={(event) => { setRuleQuery(event.target.value); setRulePage(0); }} />
                {filteredRules.length > pageSize ? <div className="pool-rule-pages">
                  <button type="button" className="pool-sheet-icon-button" aria-label={"Previous rules for " + name} disabled={page === 0} onClick={() => setRulePage(page - 1)}><ChevronLeft /></button>
                  <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredRules.length)} / {filteredRules.length}</span>
                  <button type="button" className="pool-sheet-icon-button" aria-label={"Next rules for " + name} disabled={page + 1 === pageCount} onClick={() => setRulePage(page + 1)}><ChevronRight /></button>
                </div> : null}
              </div>
              <div className="pool-rule-grid">
                {visibleRules.map((row) => {
                  const material = row.resource.displayName ?? row.resource.id;
                  return <label className="pool-rule-entry" key={row.key}>
                    <span className="pool-rule-material" title={material}><ResourceIcon resource={row.resource} bare size="sm" showAmount={false} tooltip={false} className="!h-4 !w-4" /><span>{material}</span></span>
                    <select aria-label={(group ? "Sharing for " : "Supply for ") + material + " in " + name}
                      value={row.rule ?? "auto"} disabled={readOnly}
                      onChange={(event) => useFactoryStore.getState().setPoolResourceRule(group?.id, row.key, event.target.value === "auto" ? undefined : event.target.value === "share" ? "share" : "import")}>
                      <option value="auto">Automatic</option>
                      {group ? <option value="share">Share with parent</option> : <option value="import">Import anyway</option>}
                      {group && row.rule === "import" ? <option value="import">Outside supply</option> : null}
                      {!group && row.rule === "share" ? <option value="share">Import anyway</option> : null}
                    </select>
                  </label>;
                })}
                {!visibleRules.length ? <span className="pool-sheet-muted">No matching materials.</span> : null}
              </div>
            </section>
          ) : null}
        </td>
      </tr>
    </tbody>
  );
}
