"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FolderPlus, Ungroup } from "lucide-react";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { productionGroupDescendants, productionGroupTree } from "@/lib/model/production-groups";
import type { ProductionGroup, PoolResourceRule } from "@/lib/model/types";
import type { getPoolGroupResources } from "@/lib/solver/pool-mode";
import { formatSlotRate } from "../flow/flow-explainers";
import { ResourceIcon } from "../nei/ResourceIcon";

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
  const groups = savedGroups ?? [];
  return (
    <select
      className="pool-production-select"
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">Factory</option>
      {productionGroupTree(groups)
        .filter(({ group }) => !exclude?.has(group.id))
        .map(({ group, depth }) => (
          <option key={group.id} value={group.id}>
            {"· ".repeat(depth)}
            {group.name}
          </option>
        ))}
    </select>
  );
}

type ResourceRow = ReturnType<typeof getPoolGroupResources>[number];
export function ProductionScopeHeader({
  group,
  depth = 0,
  collapsed,
  onToggle,
  resources,
  readOnly,
  productAction,
}: {
  group?: ProductionGroup;
  depth?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  resources: ResourceRow[];
  readOnly: boolean;
  productAction?: ReactNode;
}) {
  useRateDisplayUnits();
  const savedGroups = useFactoryStore((state) => state.project.productionGroups);
  const groups = savedGroups ?? [];
  const [rulesOpen, setRulesOpen] = useState(false);
  const name = group?.name ?? "Factory pool";
  const inputs = resources.filter(
    (row) => row.used - row.made > 1e-6 && (row.route !== "local" || row.feeders.length === 0),
  ).length;
  const outputs = resources.filter(
    (row) => row.made - row.used > 1e-6 && row.route === "parent",
  ).length;
  const local = resources.filter((row) => row.route === "local").length;
  return (
    <tbody className="pool-production-scope" data-production-group={group?.id ?? "factory"}>
      <tr>
        <td colSpan={6} style={{ paddingLeft: 10 + Math.min(depth, 8) * 16 }}>
          <div className="pool-production-heading">
            {group ? (
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
            <span className="pool-production-summary">
              {inputs} in · {outputs} out · {local} local
            </span>
            <button
              type="button"
              className="pool-production-key"
              aria-expanded={rulesOpen}
              aria-label={"Material rules for " + name}
              onClick={() => setRulesOpen(!rulesOpen)}
            >
              Materials <ChevronDown size={12} />
            </button>
            {productAction}
            {!readOnly ? (
              <>
                {group ? (
                  <ProductionGroupSelect
                    value={group.parentId}
                    label={"Parent of " + name}
                    exclude={productionGroupDescendants(groups, group.id)}
                    onChange={(parentId) =>
                      useFactoryStore.getState().updateProductionGroup(group.id, { parentId })
                    }
                  />
                ) : null}
                <button
                  type="button"
                  className="pool-production-key"
                  aria-label={group ? "Add subgroup to " + name : "Add production group"}
                  onClick={() =>
                    useFactoryStore
                      .getState()
                      .createProductionGroup("Production group " + (groups.length + 1), group?.id)
                  }
                >
                  <FolderPlus size={14} />
                  {group ? "Subgroup" : "New group"}
                </button>
                {group ? (
                  <button
                    type="button"
                    className="pool-production-key"
                    aria-label={"Ungroup " + name}
                    title="Remove this group; keep its machines, products and subgroups in the parent."
                    onClick={() => useFactoryStore.getState().dissolveProductionGroup(group.id)}
                  >
                    <Ungroup size={14} />
                    Ungroup
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {rulesOpen ? (
            <div className="pool-production-materials">
              <p>
                {group
                  ? "Auto keeps a material here when this group both makes and uses it. Other materials reach the parent. Share with parent skips that local match."
                  : "Auto imports materials nobody in this pool makes. Outside supply also permits imports when a producer is present."}
                {group ? " Outside supply permits imports directly into this group." : ""} Surplus
                is allowed. Outside supply may replace production unless the producer is pinned.
              </p>
              {resources.length ? (
                <div className="pool-production-material-scroll">
                  <table aria-label={"Material balance for " + name}>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Rule</th>
                        <th>Connection</th>
                        <th>Makes</th>
                        <th>Takes</th>
                        <th>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <span className="pool-production-resource">
                              <ResourceIcon
                                resource={row.resource}
                                size="sm"
                                bare
                                showAmount={false}
                                className="!h-5 !w-5"
                              />
                              {row.resource.displayName ?? row.resource.id}
                            </span>
                          </td>
                          <td>
                            <select
                              aria-label={
                                "Rule for " +
                                (row.resource.displayName ?? row.resource.id) +
                                " in " +
                                name
                              }
                              value={row.rule ?? "auto"}
                              disabled={readOnly}
                              onChange={(event) =>
                                useFactoryStore
                                  .getState()
                                  .setPoolResourceRule(
                                    group?.id,
                                    row.key,
                                    event.target.value === "auto"
                                      ? undefined
                                      : (event.target.value as PoolResourceRule),
                                  )
                              }
                            >
                              <option value="auto">Auto</option>
                              {group || row.rule === "share" ? (
                                <option value="share">Share with parent</option>
                              ) : null}
                              <option value="import">Outside supply</option>
                            </select>
                          </td>
                          <td>
                            {row.route === "parent"
                              ? "Parent pool"
                              : row.route === "outside"
                                ? "Outside allowed"
                                : row.feeders.length === 0
                                  ? "Imported"
                                  : group
                                    ? "Kept here"
                                    : "Factory pool"}
                          </td>
                          <td>{formatSlotRate(row.made, row.resource.kind)}</td>
                          <td>{formatSlotRate(row.used, row.resource.kind)}</td>
                          <td
                            className={row.made < row.used ? "pool-flow-input" : "pool-flow-output"}
                          >
                            {row.made > row.used + 1e-6 ? "+" : ""}
                            {formatSlotRate(row.made - row.used, row.resource.kind)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No materials yet. Move a machine or product into this group.</p>
              )}
            </div>
          ) : null}
        </td>
      </tr>
    </tbody>
  );
}
