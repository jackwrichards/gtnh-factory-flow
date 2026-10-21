"use client";

import { useCloudLibraryStore } from "@/lib/library/cloud-library";
import { moveMember, saveGroup, updateMember, type NetworkChange } from "@/lib/networks/edits";
import {
  memberKey,
  type NetworkMember,
  type PlanFlows,
  type PlanNetwork,
} from "@/lib/networks/model";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { useState } from "react";
import { NetworkModal, PortPicker } from "./NetworkWidgets";

export type NetworkDialog =
  | { kind: "add" }
  | { kind: "group"; previous?: string }
  | { kind: "ports"; memberKey: string }
  | { kind: "delete"; networkId: string };

export function NetworkDialogs({
  dialog,
  network,
  networks,
  groups,
  flows,
  onClose,
  change,
}: {
  dialog?: NetworkDialog;
  network: PlanNetwork;
  networks: PlanNetwork[];
  groups: string[];
  flows: ReadonlyMap<string, PlanFlows>;
  onClose: () => void;
  change: (transform: NetworkChange) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === "add")
    return <AddPlansDialog network={network} networks={networks} onClose={onClose} />;
  if (dialog.kind === "group")
    return (
      <GroupDialog
        key={dialog.previous ?? ""}
        previous={dialog.previous}
        groups={groups}
        onClose={onClose}
        change={change}
      />
    );
  if (dialog.kind === "delete")
    return dialog.networkId === network.id ? (
      <NetworkModal title={`Delete ${network.name}?`} onClose={onClose}>
        <p>Plans are kept. Subnetworks move to this network’s parent.</p>
        <div className="netview-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="netview-danger"
            onClick={() => void useNetworkStore.getState().remove(network.id)}
          >
            Delete network
          </button>
        </div>
      </NetworkModal>
    ) : null;
  const member = network.members.find((entry) => memberKey(entry) === dialog.memberKey);
  return member ? (
    <PortPicker
      key={dialog.memberKey}
      member={member}
      flow={flows.get(dialog.memberKey)}
      groups={groups}
      onGroupChange={(group) => change(moveMember(dialog.memberKey, group))}
      onChange={(portSelection) => change(updateMember(dialog.memberKey, { portSelection }))}
      onDone={onClose}
    />
  ) : null;
}

function AddPlansDialog({
  network,
  networks,
  onClose,
}: {
  network: PlanNetwork;
  networks: PlanNetwork[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const designs = useDesignStore((state) => state.designs);
  const shared = useCloudLibraryStore((state) => state.shared);
  const choices: NetworkMember[] = [
    ...designs
      .filter((entry) => !entry.taskBoard && !entry.cloud)
      .map((entry) => ({ designId: entry.id, name: entry.name, included: true })),
    ...(shared ?? []).map((entry) => ({
      designId: entry.id,
      ownerId: entry.ownerId,
      name: `${entry.name} (${entry.ownerName})`.slice(0, 80),
      included: true,
    })),
  ];
  const filtered = choices.filter((entry) =>
    entry.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <NetworkModal title="Add plans" initialFocus="input" onClose={onClose}>
      <div className="netview-actions">
        <input
          aria-label="Find plans to add"
          placeholder="Find a plan"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="netview-choices">
        {filtered.map((member) => {
          const current = networks.find((entry) =>
            entry.members.some((plan) => memberKey(plan) === memberKey(member)),
          );
          return (
            <div className="netview-member" key={memberKey(member)}>
              <span>{member.name}</span>
              <button
                disabled={current?.id === network.id}
                onClick={() => void useNetworkStore.getState().addMember(network.id, member)}
              >
                {current?.id === network.id
                  ? "Added"
                  : current
                    ? `Move from ${current.name}`
                    : "Add"}
              </button>
            </div>
          );
        })}
      </div>
      {!choices.length ? <p>Create a plan first, then add it here.</p> : null}
      {choices.length > 0 && !filtered.length ? <p>No plans match your search.</p> : null}
    </NetworkModal>
  );
}

function GroupDialog({
  previous,
  groups,
  onClose,
  change,
}: {
  previous?: string;
  groups: string[];
  onClose: () => void;
  change: (transform: NetworkChange) => void;
}) {
  const [draft, setDraft] = useState(previous ?? "");
  const name = draft.trim();
  const invalid = !name || (name !== previous && groups.includes(name));
  return (
    <NetworkModal
      title={previous ? "Rename group" : "New group"}
      initialFocus="input"
      onClose={onClose}
    >
      <form
        className="netview-actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          change(saveGroup(name, previous));
          onClose();
        }}
      >
        <input
          aria-label="Group name"
          placeholder="Group name"
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button disabled={invalid}>{previous ? "Save name" : "Create group"}</button>
      </form>
      <p>Drag plans into the group, or choose it in a plan’s I/O settings.</p>
    </NetworkModal>
  );
}
