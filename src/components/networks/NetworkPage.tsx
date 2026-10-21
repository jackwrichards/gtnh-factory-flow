"use client";

import { useDeviceSettings } from "@/lib/device-settings";
import { useCloudLibraryStore } from "@/lib/library/cloud-library";
import { useNetworkCalculations } from "@/lib/networks/calculation";
import {
  aggregateNetworks,
  memberKey,
  type NetworkMember,
  type PlanNetwork,
} from "@/lib/networks/model";
import { syncNetworks } from "@/lib/networks/sync";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import "./networks.css";

import { networkGroups, updateNetwork, type NetworkChange } from "@/lib/networks/edits";
import { NetworkDialogs, type NetworkDialog } from "./NetworkDialogs";
import { NetworkLedger } from "./NetworkLedger";
import { NetworkMembers } from "./NetworkMembers";
import { NetworkRateControl } from "./NetworkWidgets";

export function NetworksLibrary() {
  const catalogue = useNetworkStore((state) => state.catalogue);
  const create = useNetworkStore((state) => state.create);
  const open = useNetworkStore((state) => state.open);
  const ready = useNetworkStore((state) => state.ready);
  const [name, setName] = useState("");
  return (
    <div className="netview mx netview-library">
      <h1>Networks</h1>
      <p>Group your plans to see supply, demand and free resources.</p>
      <NetworkStatus />
      <form
        className="netview-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void create(name || "New network");
          setName("");
        }}
      >
        <input
          aria-label="New network name"
          placeholder="Network name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <button disabled={!ready}>Create network</button>
      </form>
      <div className="netview-network-list">
        {catalogue?.networks
          .filter((network) => !network.parentId)
          .map((network) => (
            <button key={network.id} onClick={() => open(network.id)}>
              <strong>{network.name}</strong>
              <span>
                {network.members.length} plans ·{" "}
                {catalogue.networks.filter((entry) => entry.parentId === network.id).length}{" "}
                subnetworks
              </span>
            </button>
          ))}
      </div>
      {ready && !catalogue?.networks.length ? (
        <p>No networks yet. Create one, then add your saved plans.</p>
      ) : null}
    </div>
  );
}

function NetworkStatus() {
  const state = useNetworkStore();
  return (
    <>
      {state.error ? (
        <p role="alert" className="netview-warning">
          {state.error}
        </p>
      ) : null}
      {state.conflict ? (
        <div className="netview-actions">
          <span>Both versions are kept until you choose.</span>
          <button onClick={() => void state.resolveConflict(true)}>Keep my changes</button>
          <button onClick={() => void state.resolveConflict(false)}>Use saved networks</button>
        </div>
      ) : state.error ? (
        <button
          onClick={() => {
            if (state.catalogue) void state.load(state.catalogue.account).then(syncNetworks);
          }}
        >
          Reload networks
        </button>
      ) : null}
    </>
  );
}

function NetworkSaveStatus({ updating }: { updating: boolean }) {
  const { ready, saving, syncing, catalogue, error, conflict } = useNetworkStore();
  const message = !ready
    ? "Loading networks…"
    : error || conflict
      ? "Changes need attention"
      : saving
        ? "Saving…"
        : syncing
          ? "Syncing…"
          : catalogue?.account === "local"
            ? "Saved locally"
            : catalogue?.dirty
              ? "Saved locally · Sync pending"
              : "Synced";
  return (
    <span className="netview-save-status" role="status">
      {message}
      {updating ? " · Updating figures…" : ""}
    </span>
  );
}

export function NetworkPage() {
  const catalogue = useNetworkStore((state) => state.catalogue);
  const activeId = useNetworkStore((state) => state.activeId);
  const edit = useNetworkStore((state) => state.edit);
  const designs = useDesignStore((state) => state.designs);
  const shared = useCloudLibraryStore((state) => state.shared);
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState<NetworkDialog>();
  const layoutRef = useRef<HTMLDivElement>(null);
  const { networkSidebarWidth } = useDeviceSettings();
  const flows = useNetworkCalculations(retry);
  const networks = catalogue?.networks ?? [];
  const balances = useMemo(
    () => aggregateNetworks(catalogue?.networks ?? [], flows),
    [catalogue?.networks, flows],
  );
  const network = networks.find((entry) => entry.id === activeId);
  const balance = activeId ? balances.get(activeId) : undefined;
  if (!network || !balance) return <NetworksLibrary />;
  const groupNames = networkGroups(network);
  const change = (transform: NetworkChange) =>
    void edit((entries) => updateNetwork(entries, network.id, transform));
  const patch = (values: Partial<PlanNetwork>) => change((entry) => ({ ...entry, ...values }));
  const openMember = async (member: NetworkMember) => {
    useNetworkStore.getState().leave();
    if (member.ownerId) {
      const remote = shared?.find(
        (entry) => entry.id === member.designId && entry.ownerId === member.ownerId,
      );
      if (remote)
        await useDesignStore
          .getState()
          .openSharedDesign(
            { ownerId: member.ownerId, designId: member.designId, ownerName: remote.ownerName },
            remote.name,
          );
    } else await useDesignStore.getState().switchToDesign(member.designId);
  };
  const updating = networks.some((entry) =>
    entry.members.some(
      (member) =>
        member.included && (!flows.has(memberKey(member)) || flows.get(memberKey(member))?.stale),
    ),
  );
  const excludedAncestor = (() => {
    let entry: PlanNetwork | undefined = network;
    while (entry) {
      if (entry.parentId && !entry.included) return true;
      entry = networks.find((next) => next.id === entry?.parentId);
    }
    return false;
  })();
  return (
    <div className="netview mx netview-page" data-network-page="">
      <header className="netview-header">
        <div>
          <span className="netview-kicker">{network.parentId ? "Subnetwork" : "Network"}</span>
          <input
            key={network.id}
            className="netview-title"
            aria-label="Network name"
            defaultValue={network.name}
            maxLength={80}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== network.name) patch({ name });
              else event.target.value = network.name;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div className="netview-actions">
          <NetworkSaveStatus updating={updating} />
          <NetworkRateControl />
          <button
            className="netview-danger netview-icon-button"
            aria-label="Delete network"
            title="Delete network"
            onClick={() => setDialog({ kind: "delete", networkId: network.id })}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
          <button
            className="netview-icon-button"
            aria-label="Refresh figures"
            title="Refresh figures"
            onClick={() => {
              setRetry((value) => value + 1);
              void syncNetworks();
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      <NetworkStatus />
      <div
        className="netview-layout"
        ref={layoutRef}
        style={{ "--network-sidebar-width": `${networkSidebarWidth}px` } as CSSProperties}
      >
        <NetworkMembers
          network={network}
          networks={networks}
          groupNames={groupNames}
          designs={designs}
          openMember={openMember}
          change={change}
          setDialog={setDialog}
          layoutRef={layoutRef}
        />
        <main className="netview-ledger">
          <NetworkDialogs
            key={network.id}
            dialog={dialog}
            network={network}
            networks={networks}
            groups={groupNames}
            flows={flows}
            onClose={() => setDialog(undefined)}
            change={change}
          />
          {excludedAncestor ? (
            <p className="netview-warning">
              Excluded from ancestor totals. Figures below describe this network on its own.
            </p>
          ) : null}
          {balance.incomplete.length ? (
            <details className="netview-warning" open>
              <summary>Figures incomplete · {balance.incomplete.length} members</summary>
              {balance.incomplete.map((message, index) => (
                <p key={index}>{message}</p>
              ))}
            </details>
          ) : null}
          <NetworkLedger
            network={network}
            networks={networks}
            balance={balance}
            balances={balances}
            updating={updating}
            openMember={openMember}
            change={change}
          />
        </main>
      </div>
    </div>
  );
}
