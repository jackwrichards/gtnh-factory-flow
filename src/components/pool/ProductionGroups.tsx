"use client";

import type { ReactNode } from "react";
import { ChevronDown, FolderPlus, GripVertical, Trash2 } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { productionGroupDescendants, productionGroupTree } from "@/lib/model/production-groups";
import type { ProductionGroup, ResourceAmount } from "@/lib/model/types";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { formatSlotRate } from "../flow/flow-explainers";
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
  const links = resources.filter(
    (row) => row.rule || (row.feeders.length && row.takers.some((port) => !port.storage)),
  );
  const flows = (title: string, entries: GroupFlow[]) => (
    <section className="pool-group-flow" aria-label={title + " for " + name}>
      <h4>{title}</h4>
      {entries.length ? (
        entries.map(({ resource, rate }) => (
          <div key={resource.kind + ":" + resource.id} className="pool-group-flow-item">
            {renderResource(resource)}
            <strong>{formatSlotRate(rate, resource.kind)}</strong>
          </div>
        ))
      ) : (
        <span className="pool-sheet-muted">None</span>
      )}
    </section>
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
          <div className="pool-group-balance">
            {inputs.length || outputs.length ? (
              <div className="pool-group-totals">
                {flows("Inputs", inputs)}
                {flows("Outputs", outputs)}
              </div>
            ) : null}
            {links.length ? (
              <div className="pool-group-links" aria-label={"Links for " + name}>
                <span>Links</span>
                {links.map((row) => {
                  const ignored = Boolean(row.rule);
                  return (
                    <button
                      type="button"
                      key={row.key}
                      className="pool-group-link"
                      disabled={readOnly}
                      aria-pressed={ignored}
                      aria-label={
                        "Ignore " + (row.resource.displayName ?? row.resource.id) + " in " + name
                      }
                      title={
                        (row.resource.displayName ?? row.resource.id) +
                        ": " +
                        (ignored
                          ? "Click to match this material here again."
                          : group
                            ? "Ignore here: let the parent group handle this material."
                            : "Ignore: permit outside supply of this material.")
                      }
                      onClick={() =>
                        useFactoryStore
                          .getState()
                          .setPoolResourceRule(
                            group?.id,
                            row.key,
                            ignored ? undefined : group ? "share" : "import",
                          )
                      }
                    >
                      <ResourceIcon
                        resource={row.resource}
                        bare
                        size="sm"
                        showAmount={false}
                        tooltip={false}
                        className="!h-5 !w-5"
                      />
                      <span className="sr-only">{row.resource.displayName ?? row.resource.id}</span>
                      {ignored ? (
                        <strong>
                          {group && row.rule === "import" ? "Ignore · outside supply" : "Ignore"}
                        </strong>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </td>
      </tr>
    </tbody>
  );
}
