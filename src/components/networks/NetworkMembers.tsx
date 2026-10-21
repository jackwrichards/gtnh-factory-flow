"use client";

import { PanelHandle } from "@/components/PanelHandle";
import { readDeviceSettings, useDeviceSettings, writeDeviceSettings } from "@/lib/device-settings";
import { localDesignId } from "@/lib/networks/calculation";
import { memberKey, type NetworkMember, type PlanNetwork } from "@/lib/networks/model";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { ArrowRightLeft, FolderPlus, GripVertical, Plus } from "lucide-react";
import { useRef } from "react";

import {
  moveMember,
  removeGroup,
  removeMember,
  updateMember,
  type NetworkChange,
} from "@/lib/networks/edits";
import type { NetworkDialog } from "./NetworkDialogs";
import { NetworkTree, OverflowMenu, PlanGroups, isDescendant } from "./NetworkWidgets";

export function NetworkMembers({
  network,
  networks,
  groupNames,
  designs,
  openMember,
  change,
  setDialog,
  layoutRef,
}: {
  network: PlanNetwork;
  networks: PlanNetwork[];
  groupNames: string[];
  designs: ReturnType<typeof useDesignStore.getState>["designs"];
  openMember: (member: NetworkMember) => Promise<void>;
  change: (transform: NetworkChange) => void;
  setDialog: (dialog: NetworkDialog) => void;
  layoutRef: React.RefObject<HTMLDivElement | null>;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const { networkSidebarWidth } = useDeviceSettings();
  const create = useNetworkStore((state) => state.create);
  const patch = (values: Partial<PlanNetwork>) => change((entry) => ({ ...entry, ...values }));
  return (
    <aside className="netview-members" aria-label="Network members" ref={sidebarRef}>
      <div className="netview-members-scroll">
        <div className="netview-section-title">
          Networks
          <button
            className="netview-icon-button"
            aria-label="New subnetwork"
            title="New subnetwork"
            onClick={() => void create("New subnetwork", network.id)}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        <NetworkTree networks={networks} />
        <div className="netview-section-title">
          <span>Plans in {network.name}</span>
          <div className="netview-section-actions">
            <button
              className="netview-icon-button"
              aria-label="New group"
              title="New group"
              onClick={() => {
                setDialog({ kind: "group" });
              }}
            >
              <FolderPlus size={18} aria-hidden="true" />
            </button>
            <button
              className="netview-icon-button"
              aria-label="Add plans"
              title="Add plans"
              onClick={() => setDialog({ kind: "add" })}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <PlanGroups
          members={network.members}
          groups={groupNames}
          onRenameGroup={(group) => {
            setDialog({ kind: "group", previous: group });
          }}
          onRemoveGroup={(group) => change(removeGroup(group))}
          onMove={(key, group) => change(moveMember(key, group))}
          renderMember={(member) => (
            <div className="netview-member netview-member-plan" key={memberKey(member)}>
              <span
                className="netview-drag-handle"
                title="Drag to another plan group"
                aria-hidden="true"
              >
                <GripVertical size={14} />
              </span>
              <label title="Include in totals">
                <input
                  type="checkbox"
                  aria-label={`Include ${member.name}`}
                  checked={member.included}
                  onChange={(event) =>
                    change(updateMember(memberKey(member), { included: event.target.checked }))
                  }
                />
              </label>
              <button
                className="netview-link netview-plan-name"
                title={
                  designs.find((entry) => entry.id === localDesignId(member))?.name ?? member.name
                }
                onClick={() => void openMember(member)}
              >
                {designs.find((entry) => entry.id === localDesignId(member))?.name ?? member.name}
              </button>
              <OverflowMenu
                label={`Options for ${member.name}`}
                entries={[
                  {
                    label: "Inputs and outputs",
                    onSelect: () => setDialog({ kind: "ports", memberKey: memberKey(member) }),
                  },
                  {
                    label: "Remove from network",
                    detail: "plan is kept",
                    tone: "red",
                    onSelect: () => change(removeMember(memberKey(member))),
                  },
                ]}
              />
              <button
                className="netview-plan-io"
                aria-label={`Inputs and outputs for ${member.name}`}
                title="Inputs and outputs"
                onClick={() => setDialog({ kind: "ports", memberKey: memberKey(member) })}
              >
                <ArrowRightLeft size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        />
        {!network.members.length ? <p>Add saved plans to start counting their flows.</p> : null}
        <details className="netview-settings" key={network.id}>
          <summary>Network settings</summary>
          <label className="netview-field">
            Parent network
            <select
              aria-label="Parent network"
              value={network.parentId ?? ""}
              onChange={(event) => patch({ parentId: event.target.value || undefined })}
            >
              <option value="">None</option>
              {networks
                .filter(
                  (entry) => entry.id !== network.id && !isDescendant(entry, network.id, networks),
                )
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          {network.parentId ? (
            <label className="netview-check">
              <input
                type="checkbox"
                checked={network.included}
                onChange={(event) => patch({ included: event.target.checked })}
              />
              Include in parent totals
            </label>
          ) : null}
          {network.parentId ? (
            <div>
              <label className="netview-check">
                <input
                  type="checkbox"
                  checked={network.selfPowered ?? false}
                  onChange={(event) => patch({ selfPowered: event.target.checked })}
                  aria-describedby="network-self-powered-help"
                />
                Self-powered
              </label>
              <p className="netview-note" id="network-self-powered-help">
                Keep this subnetwork’s power out of parent totals.
              </p>
            </div>
          ) : null}
        </details>
      </div>
      <PanelHandle
        label="Resize network plan list"
        edge="right"
        getWidth={() => sidebarRef.current?.offsetWidth || networkSidebarWidth}
        getLimits={() => ({
          min: 240,
          max: Math.max(240, Math.min(640, (layoutRef.current?.clientWidth || 1280) / 2)),
        })}
        onDrag={(width) =>
          layoutRef.current?.style.setProperty("--network-sidebar-width", `${width}px`)
        }
        onCommit={(width) => writeDeviceSettings({ networkSidebarWidth: width })}
        onReset={() => writeDeviceSettings({ networkSidebarWidth: 300 })}
        onEnd={() =>
          layoutRef.current?.style.setProperty(
            "--network-sidebar-width",
            `${readDeviceSettings().networkSidebarWidth}px`,
          )
        }
      />
    </aside>
  );
}
