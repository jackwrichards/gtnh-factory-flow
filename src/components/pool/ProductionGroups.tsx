"use client";

import { materialRuleHelp } from "./material-rule-help";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, FolderPlus, GripVertical, Trash2 } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { productionGroupDescendants, productionGroupTree } from "@/lib/model/production-groups";
import type { ProductionGroup, ResourceAmount } from "@/lib/model/types";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { formatPoolRateBare as formatSlotRateBare, formatPoolSignedRate } from "./worksheet-format";
import { rateSuffixForKind } from "@/lib/model/rate-unit";
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
  const [materialQuery, setMaterialQuery] = useState("");
  const [materialPage, setMaterialPage] = useState(0);
  // Boundary totals may include closed child pools. Only rows in this scope
  // get a rule control; a parent's rule must not pretend to change a child.
  const materials = new Map<string, { resource: ResourceAmount; row?: ResourceRow; input: number; output: number }>();
  for (const row of resources) materials.set(row.key, { resource: row.resource, row, input: 0, output: 0 });
  for (const [side, flows] of [["input", inputs], ["output", outputs]] as const) {
    for (const flow of flows) {
      const key = flow.resource.kind + ":" + flow.resource.id;
      const entry = materials.get(key) ?? { resource: flow.resource, input: 0, output: 0 };
      entry[side] += flow.rate;
      materials.set(key, entry);
    }
  }
  const direction = (entry: { input: number; output: number }) => {
    const net = entry.output - entry.input;
    return net < 0 ? 0 : net > 0 ? 1 : 2;
  };
  const needle = materialQuery.trim().toLowerCase();
  const filteredMaterials = [...materials.entries()]
    .filter(([, entry]) => !needle || (entry.resource.displayName ?? entry.resource.id).toLowerCase().includes(needle))
    .sort(([, a], [, b]) => direction(a) - direction(b) || (a.resource.displayName ?? a.resource.id).localeCompare(b.resource.displayName ?? b.resource.id));
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(filteredMaterials.length / pageSize));
  const page = Math.min(materialPage, pageCount - 1);
  const visibleMaterials = filteredMaterials.slice(page * pageSize, (page + 1) * pageSize);
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
          {materials.size ? (
            <section className="pool-scope-materials" aria-label={"Materials for " + name}>
              {materials.size > pageSize || materialQuery ? <div className="pool-material-toolbar">
                {materials.size > pageSize || materialQuery ? <input type="search" className="pool-rule-search" aria-label={"Find material in " + name}
                  placeholder="Find material…" value={materialQuery} onChange={(event) => { setMaterialQuery(event.target.value); setMaterialPage(0); }} /> : null}
                {filteredMaterials.length > pageSize ? <div className="pool-rule-pages">
                  <button type="button" className="pool-sheet-icon-button" aria-label={"Previous materials for " + name} disabled={page === 0} onClick={() => setMaterialPage(page - 1)}><ChevronLeft /></button>
                  <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredMaterials.length)} / {filteredMaterials.length}</span>
                  <button type="button" className="pool-sheet-icon-button" aria-label={"Next materials for " + name} disabled={page + 1 === pageCount} onClick={() => setMaterialPage(page + 1)}><ChevronRight /></button>
                </div> : null}
              </div> : null}
              <div className="pool-material-strip">
                {["Inputs", "Outputs", "Internal"].map((label, index) => {
                  const entries = visibleMaterials.filter(([, entry]) => direction(entry) === index);
                  if (!entries.length) return null;
                  return <table className="pool-material-table" key={label} aria-label={label + " for " + name}>
                    <tbody><tr>
                      <th scope="row" title={index === 2 ? "No net input or output, including inactive materials." : undefined}>{label}</th>
                      <td><div className="pool-material-columns">
                {entries.map(([key, { resource, row, input, output }]) => {
                  const material = resource.displayName ?? resource.id;
                  const net = output - input;
                  const sign = Math.sign(net);
                  const rate = formatPoolSignedRate(sign ? Math.abs(net) : 0, resource.kind, sign);
                  const unit = rateSuffixForKind(resource.kind).trim();
                  return <div className="pool-scope-material" key={key} data-material-key={key}>
                    {renderResource(resource)}
                      <span className={"pool-material-rate " + (sign < 0 ? "pool-flow-input" : sign > 0 ? "pool-flow-output" : "pool-flow-internal")}
                        aria-label={material + ": " + (sign < 0 ? "net input " : sign > 0 ? "net output " : "no net flow ") + formatSlotRateBare(Math.abs(net), resource.kind) + unit}
                        title={"Input: " + formatSlotRateBare(input, resource.kind) + unit + "; output: " + formatSlotRateBare(output, resource.kind) + unit}>
                        <strong>{rate}</strong><small>{unit}</small>
                      </span>
                    {row ? <span className="pool-material-rule-control" data-auto={!row.rule || undefined}><select className="pool-material-rule" data-auto={!row.rule || undefined} aria-label={(group ? "Sharing for " : "Supply for ") + material + " in " + name}
                      title={materialRuleHelp(row.rule, Boolean(group))} value={row.rule ?? "auto"} disabled={readOnly}
                      onChange={(event) => useFactoryStore.getState().setPoolResourceRule(group?.id, row.key, event.target.value === "auto" ? undefined : event.target.value === "share" ? "share" : "import")}>
                      <option value="auto">Match</option>
                      {group ? <option value="share">Ignore</option> : <option value="import">Ignore</option>}
                      {group && row.rule === "import" ? <option value="import">Ignore · outside supply</option> : null}
                      {!group && row.rule === "share" ? <option value="share">Ignore</option> : null}
                    </select><ChevronDown size={8} aria-hidden /></span> : <span className="pool-material-inherited" title="This total includes a child group's local material. Change its rule in that group.">Within groups</span>}
                  </div>;
                })}
                      </div></td>
                    </tr></tbody>
                  </table>;
                })}
                {!visibleMaterials.length ? <span className="pool-sheet-muted">No matching materials.</span> : null}
              </div>
            </section>
          ) : null}
        </td>
      </tr>
    </tbody>
  );
}
