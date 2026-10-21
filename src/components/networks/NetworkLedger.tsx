"use client";

import {
  powerDisplayFromEuT,
  powerDisplaySuffix,
  rateMultiplierForKind,
  rateSuffixForKind,
} from "@/lib/model/rate-unit";
import { formatCompact } from "@/lib/model/resources";
import {
  memberKey,
  unmetDemand,
  type NetworkMember,
  type PlanNetwork,
  type Sharing,
} from "@/lib/networks/model";
import { useRateDisplayUnits } from "@/store/factory-store";
import { useNetworkStore } from "@/store/network-store";
import { useState } from "react";

import type { NetworkChange } from "@/lib/networks/edits";
import type { NetworkBalance } from "@/lib/networks/model";
import {
  NetworkResourceIcon,
  ResourceRows,
  SelfPoweredIcon,
  WheelSelect,
  sharingDescription,
} from "./NetworkWidgets";

export function NetworkLedger({
  network,
  networks,
  balance,
  balances,
  updating,
  openMember,
  change,
}: {
  network: PlanNetwork;
  networks: PlanNetwork[];
  balance: NetworkBalance;
  balances: ReadonlyMap<string, NetworkBalance>;
  updating: boolean;
  openMember: (member: NetworkMember) => Promise<void>;
  change: (transform: NetworkChange) => void;
}) {
  useRateDisplayUnits();
  const [query, setQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const open = useNetworkStore((state) => state.open);
  const rows = balance.resources.map((row) => {
    const unmet = unmetDemand(networks, balances, network.id, row.key);
    return { ...row, unmet, parentShort: row.fromParent > 0 && unmet === undefined };
  });
  const shortageCount = rows.filter((row) => row.unmet !== 0).length;
  const filter = !network.parentId && resourceFilter === "parent" ? "all" : resourceFilter;
  const filteredResources = rows.filter((row) => {
    if (!row.label.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "shortages") return row.unmet !== 0;
    if (filter === "available") return row.free > 0;
    if (filter === "parent") return row.fromParent > 0 || row.toParent > 0;
    return true;
  });
  return (
    <>
      <div className="netview-power">
        {network.parentId && network.selfPowered ? <SelfPoweredIcon /> : null}
        <span>
          Power used{" "}
          <strong>
            {formatCompact(powerDisplayFromEuT(balance.power.used))} {powerDisplaySuffix()}
          </strong>
        </span>
        <span>
          Power generated{" "}
          <strong>
            {formatCompact(powerDisplayFromEuT(balance.power.made))} {powerDisplaySuffix()}
          </strong>
        </span>
      </div>
      <div className="netview-actions">
        <input
          aria-label="Find a resource"
          placeholder="Find a resource"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {shortageCount > 0 ? (
          <button className="netview-shortage-count" onClick={() => setResourceFilter("shortages")}>
            {shortageCount} {shortageCount === 1 ? "resource short" : "resources short"}
          </button>
        ) : null}
      </div>
      <div className="netview-filters" role="group" aria-label="Resource filters">
        {[
          ["all", "All"],
          ["shortages", "Shortages"],
          ["available", "Available"],
          ...(network.parentId ? [["parent", "Parent connections"]] : []),
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setResourceFilter(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="netview-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Supply</th>
              <th>Demand</th>
              <th
                title={
                  network.parentId
                    ? "Surplus after this subnetwork’s own demand, before consumption elsewhere in the parent."
                    : "Surplus after included plans and shared subnet flows."
                }
              >
                {network.parentId ? "Local surplus" : "Free"}
              </th>
              <th>Shortage</th>
              {network.parentId ? (
                <>
                  <th title="Supply needed from the parent. A parent shortage is not allocated between plans.">
                    From parent
                  </th>
                  <th title="Surplus offered to the parent. Other plans may consume it there.">
                    To parent
                  </th>
                  <th>Sharing</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {filteredResources.map((row) => {
              const rate = (value: number) =>
                `${formatCompact(value * rateMultiplierForKind(row.kind))}${rateSuffixForKind(row.kind)}`;
              const expand = expanded.has(row.key);
              const { unmet, parentShort } = row;
              return (
                <ResourceRows key={row.key}>
                  <tr>
                    <th className="netview-resource-cell">
                      <button
                        className="netview-link netview-resource-toggle"
                        aria-expanded={expand}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous);
                            if (expand) next.delete(row.key);
                            else next.add(row.key);
                            return next;
                          })
                        }
                      >
                        <span className="netview-resource">
                          <span aria-hidden>{expand ? "▾" : "▸"}</span>
                          <NetworkResourceIcon flow={row} />
                          <span>{row.label}</span>
                        </span>
                      </button>
                    </th>
                    <td>{rate(row.supply)}</td>
                    <td>{rate(row.demand)}</td>
                    <td className={row.free ? "netview-free" : ""}>{rate(row.free)}</td>
                    <td className={unmet !== 0 ? "netview-short" : ""}>
                      {unmet === undefined ? "Unallocated" : rate(unmet)}
                    </td>
                    {network.parentId ? (
                      <>
                        <td className={row.fromParent && parentShort ? "netview-short" : ""}>
                          {rate(row.fromParent)}
                          {row.fromParent && parentShort ? (
                            <span className="netview-note">Parent shortage</span>
                          ) : null}
                        </td>
                        <td>{rate(row.toParent)}</td>
                        <td>
                          <WheelSelect
                            aria-label={`Sharing for ${row.label}`}
                            title={sharingDescription[network.sharing[row.key] ?? "internal"]}
                            value={network.sharing[row.key] ?? "internal"}
                            onValueChange={(value) =>
                              change((entry) => ({
                                ...entry,
                                sharing: { ...entry.sharing, [row.key]: value as Sharing },
                              }))
                            }
                          >
                            <option value="internal">Internal</option>
                            <option value="import">Import</option>
                            <option value="export">Export</option>
                            <option value="both">Both</option>
                          </WheelSelect>
                        </td>
                      </>
                    ) : null}
                  </tr>
                  {expand
                    ? row.contributions.map((entry) => (
                        <tr className="netview-contribution" key={entry.id}>
                          <th>
                            <button
                              className="netview-link"
                              onClick={() => {
                                if (entry.network) open(entry.id);
                                else {
                                  const member = network.members.find(
                                    (candidate) => memberKey(candidate) === entry.id,
                                  );
                                  if (member) void openMember(member);
                                }
                              }}
                            >
                              {entry.name}
                            </button>
                          </th>
                          <td>{rate(entry.supply)}</td>
                          <td>{rate(entry.demand)}</td>
                          <td colSpan={network.parentId ? 5 : 2} />
                        </tr>
                      ))
                    : null}
                </ResourceRows>
              );
            })}
            {!filteredResources.length ? (
              <tr>
                <td className="netview-empty" colSpan={network.parentId ? 8 : 5}>
                  {balance.resources.length
                    ? "No resources match this view."
                    : updating
                      ? "Updating figures…"
                      : "No boundary flows yet. Add plans with inputs or collected outputs."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
