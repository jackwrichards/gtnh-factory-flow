"use client";

import { materialRuleHelp } from "./material-rule-help";

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, FolderPlus, GripVertical, Trash2 } from "lucide-react";
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
  const direction = (entry: { input: number; output: number; row?: ResourceRow }) => {
    const net = entry.output - entry.input;
    if (net !== 0) return net < 0 ? 0 : 1;
    // A stopped line still has ingredients and products. Drawers declare
    // targets/supply; they must not turn a recipe's boundary into an intermediate.
    const made = entry.row?.feeders.some((port) => !port.storage);
    const used = entry.row?.takers.some((port) => !port.storage);
    if (made || used) return made && used ? 2 : used ? 0 : 1;
    const supplied = entry.row?.feeders.some((port) => port.storage);
    const requested = entry.row?.takers.some((port) => port.storage);
    return supplied && !requested ? 0 : requested && !supplied ? 1 : 2;
  };
  const visibleMaterials = [...materials.entries()]
    .sort(([, a], [, b]) => direction(a) - direction(b) || (a.resource.displayName ?? a.resource.id).localeCompare(b.resource.displayName ?? b.resource.id));
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
            <div className="pool-scope-content">
          {materials.size ? (
            <section className="pool-scope-materials" aria-label={"Materials for " + name}>
              <div className="pool-material-strip">
                {["Inputs", "Outputs", "Internal"].map((label, index) => {
                  const entries = visibleMaterials.filter(([, entry]) => direction(entry) === index);
                  if (!entries.length) return null;
                  // Size each repeated rate column from its actual text, rather than stretching empty space.
                  const rateChars = Math.max(...entries.map(([, entry]) => {
                    const net = entry.output - entry.input;
                    return formatPoolSignedRate(Math.abs(net), entry.resource.kind, Math.sign(net)).length
                      + rateSuffixForKind(entry.resource.kind).trim().length * .8;
                  }));
                  return <table className="pool-material-table" key={label} aria-label={label + " for " + name}>
                    <caption title={index === 2 ? "Made and used within this scope, with no net flow." : undefined}>{label}</caption>
                    <tbody><tr>
                      <td><div className="pool-material-columns" style={{ "--pool-material-rate-width": `${Math.ceil(rateChars) + 1}ch`, "--pool-material-rule-width": entries.some(([, entry]) => !entry.row) ? "80px" : "22px" } as CSSProperties}>
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
                    {row ? <button type="button" className="pool-material-ignore"
                      aria-label={"Skip balance for " + material + " in " + name} aria-pressed={Boolean(row.rule)}
                      title={materialRuleHelp(row.rule, Boolean(group))} disabled={readOnly}
                      onClick={() => useFactoryStore.getState().setPoolResourceRule(group?.id, row.key, row.rule ? undefined : group ? "share" : "import")}>
                      Skip
                    </button> : <span className="pool-material-inherited" title="This total includes a child group's local material. Change its rule in that group.">Within groups</span>}
                  </div>;
                })}
                      </div></td>
                    </tr></tbody>
                  </table>;
                })}
              </div>
            </section>
          ) : null}
            </div>
        </td>
      </tr>
    </tbody>
  );
}
