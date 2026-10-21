"use client";

import {
  chromeAnchorOf,
  ChromeMenu,
  MENU_ANCHOR_ATTR,
  type ChromeAnchor,
  type MenuEntry,
} from "@/components/chrome/ChromeMenu";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { wheelChangesValues } from "@/lib/device-settings";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";
import { rateMultiplierForKind, rateSuffixForKind, type TimeRateUnit } from "@/lib/model/rate-unit";
import { formatCompact } from "@/lib/model/resources";
import type { MaterialFlow } from "@/lib/networks/model";
import {
  memberKey,
  type NetworkMember,
  type PlanFlows,
  type PlanNetwork,
  type Sharing,
} from "@/lib/networks/model";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { useNetworkStore } from "@/store/network-store";
import { ChevronRight, CircleHelp, MoreHorizontal, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";

export function ResourceRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export const sharingDescription: Record<Sharing, string> = {
  internal: "Internal: no resources cross the parent boundary",
  import: "Import from parent: request missing resources",
  export: "Export to parent: share surplus resources",
  both: "Both directions: import shortages and export surplus",
};

export function SelfPoweredIcon() {
  return (
    <span
      className="netview-self-powered"
      role="img"
      aria-label="Self-powered"
      title="Self-powered: power excluded from parent totals"
    >
      <Zap size={16} aria-hidden="true" />
    </span>
  );
}

export function PortPicker({
  member,
  flow,
  groups,
  onGroupChange,
  onChange,
  onDone,
}: {
  member: NetworkMember;
  flow?: PlanFlows;
  groups: string[];
  onGroupChange: (group: string | undefined) => void;
  onChange: (selection: string[] | undefined) => void;
  onDone: () => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  useRateDisplayUnits();
  const ports = flow?.ports ?? [];
  const keys = [...new Set(ports.map((port) => port.portKey))];
  const selected = new Set(member.portSelection ?? keys);
  const machines = [...new Set(ports.map((port) => port.machine))];
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  };
  return (
    <NetworkModal
      title={`Inputs and outputs · ${member.name}`}
      onClose={onDone}
      initialFocus='button[aria-label="Close"]'
      actions={
        <button
          className="netview-icon-button"
          aria-label="About network ports"
          aria-expanded={showHelp}
          aria-controls="network-port-help"
          title="About network ports"
          onClick={() => setShowHelp((value) => !value)}
        >
          <CircleHelp size={18} aria-hidden="true" />
        </button>
      }
    >
      <div className="netview-port-toolbar">
        <label className="netview-group-field">
          Plan group
          <select
            aria-label="Plan group"
            value={member.group ?? ""}
            onChange={(event) => onGroupChange(event.target.value || undefined)}
          >
            <option value="">Ungrouped</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
        <NetworkRateControl />
        <button onClick={() => onChange(undefined)}>Use all ports</button>
        <button onClick={() => onChange([])}>Clear all</button>
      </div>
      <p id="network-port-help" hidden={!showHelp}>
        Choose which machine ports count toward this network. Only flows entering or leaving the
        plan count. Drawers are optional.
      </p>
      {flow?.error || !flow ? <p>{flow?.error ?? "Calculating ports…"}</p> : null}
      <div className="netview-port-list">
        {machines.map((machine, index) => {
          const machinePorts = ports.filter((port) => port.machine === machine);
          // Several resource rows may describe one port; selection acts on the port key.
          const machineKeys = [...new Set(machinePorts.map((port) => port.portKey))];
          const selectedCount = machineKeys.filter((key) => selected.has(key)).length;
          return (
            <details className="netview-port-machine" key={machine} open={index === 0}>
              <summary>
                <ChevronRight className="netview-port-chevron" size={16} aria-hidden="true" />
                <span className="netview-port-machine-name">{machine}</span>
                <span className="netview-port-count" aria-live="polite">
                  {selectedCount}/{machineKeys.length}
                  <span className="netview-port-count-word"> selected</span>
                </span>
              </summary>
              <div className="netview-machine-ports">
                {machinePorts.map((port) => (
                  <label className="netview-port" key={JSON.stringify([port.portKey, port.key])}>
                    <input
                      type="checkbox"
                      checked={selected.has(port.portKey)}
                      onChange={(event) => toggle(port.portKey, event.target.checked)}
                    />
                    <NetworkResourceIcon flow={port} />
                    <span>
                      {port.side === "in" ? "Input" : "Output"} · {port.label}
                    </span>
                    <span>
                      {formatCompact(
                        (port.supply + port.demand) * rateMultiplierForKind(port.kind),
                      )}
                      {rateSuffixForKind(port.kind)}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
        {(member.portSelection ?? [])
          .filter((key) => !keys.includes(key))
          .map((key) => (
            <label className="netview-port" key={key}>
              <input type="checkbox" checked onChange={() => toggle(key, false)} />
              <span>Unavailable port</span>
            </label>
          ))}
      </div>
    </NetworkModal>
  );
}

export function PlanGroups({
  members,
  groups,
  renderMember,
  onMove,
  onRemoveGroup,
  onRenameGroup,
}: {
  members: NetworkMember[];
  groups: string[];
  renderMember: (member: NetworkMember) => React.ReactNode;
  onMove: (key: string, group: string | undefined) => void;
  onRemoveGroup: (group: string) => void;
  onRenameGroup: (group: string) => void;
}) {
  const [dragged, setDragged] = useState<string>();
  const dragKey = useRef<string>(undefined);
  const [over, setOver] = useState<string>();
  const finish = () => {
    dragKey.current = undefined;
    setDragged(undefined);
    setOver(undefined);
  };
  const render = (member: NetworkMember) => (
    <div
      key={memberKey(member)}
      className="netview-draggable-plan"
      role="group"
      aria-label={`Draggable plan ${member.name}`}
      draggable
      data-dragging={dragged === memberKey(member) ? "" : undefined}
      onDragStart={(event) => {
        const key = memberKey(member);
        event.dataTransfer.setData("application/x-gtnh-network-plan", key);
        event.dataTransfer.effectAllowed = "move";
        dragKey.current = key;
        setDragged(key);
      }}
      onDragEnd={finish}
    >
      {renderMember(member)}
    </div>
  );
  if (!groups.length) return <>{members.map(render)}</>;
  return (
    <>
      {[...groups, undefined].map((group) => {
        const plans = members.filter((member) => member.group === group);
        if (!group && !plans.length && !dragged) return null;
        return (
          <details
            className="netview-plan-group"
            key={group ?? ""}
            open
            data-drop-target={over === (group ?? "") ? "" : undefined}
            onDragEnter={(event) => {
              if (!dragKey.current) return;
              event.preventDefault();
              setOver(group ?? "");
            }}
            onDragOver={(event) => {
              if (!dragKey.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver(group ?? "");
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setOver(undefined);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const key = event.dataTransfer.getData("application/x-gtnh-network-plan");
              const member = members.find((entry) => memberKey(entry) === key);
              if (key === dragKey.current && member && member.group !== group) onMove(key, group);
              finish();
            }}
          >
            <summary>
              <span className="netview-group-caption">
                <span className="netview-group-name">{group ?? "Ungrouped"}</span>{" "}
                <span className="netview-group-count">{plans.length}</span>
                {group ? (
                  <OverflowMenu
                    label={`Options for group ${group}`}
                    entries={[
                      { label: "Rename group", onSelect: () => onRenameGroup(group) },
                      {
                        label: "Delete group",
                        detail: "plans become Ungrouped",
                        tone: "red",
                        onSelect: () => onRemoveGroup(group),
                      },
                    ]}
                  />
                ) : null}
              </span>
            </summary>
            {plans.map(render)}
            {!plans.length && (group || dragged) ? (
              <p className="netview-drop-hint">Drop a plan here</p>
            ) : null}
          </details>
        );
      })}
    </>
  );
}

export function NetworkRateControl() {
  const unit = useFactoryStore((state) => state.rateUnit);
  const setUnit = useFactoryStore((state) => state.setRateUnit);
  return (
    <WheelSelect
      aria-label="Rate unit"
      title="Rate unit"
      value={unit === "eu" ? "second" : unit}
      onValueChange={(value) => setUnit(value as TimeRateUnit)}
    >
      <option value="tick">/t</option>
      <option value="second">/s</option>
      <option value="minute">/min</option>
      <option value="hour">/hr</option>
    </WheelSelect>
  );
}

export function WheelSelect({
  onValueChange,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & {
  onValueChange: (value: string) => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const select = ref.current;
    if (!select) return;
    const wheel = (event: WheelEvent) => {
      if (!wheelChangesValues() || !event.deltaY || select.disabled || event.ctrlKey) return;
      // A native, non-passive listener keeps a value change from also scrolling the ledger.
      event.preventDefault();
      event.stopPropagation();
      const index = select.selectedIndex;
      const next = Math.max(
        0,
        Math.min(select.options.length - 1, index + (event.deltaY < 0 ? 1 : -1)),
      );
      if (next !== index) onValueChange(select.options[next]!.value);
    };
    select.addEventListener("wheel", wheel, { passive: false });
    return () => select.removeEventListener("wheel", wheel);
  }, [onValueChange]);
  return <select {...props} ref={ref} onChange={(event) => onValueChange(event.target.value)} />;
}

export function OverflowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const [anchor, setAnchor] = useState<ChromeAnchor>();
  return (
    <>
      <button
        className="netview-more"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        {...{ [MENU_ANCHOR_ATTR]: anchor ? "" : undefined }}
        draggable={false}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setAnchor(anchor ? undefined : chromeAnchorOf(event.currentTarget));
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {anchor ? (
        <ChromeMenu
          label={label}
          anchor={anchor}
          align="right"
          entries={entries}
          onClose={() => setAnchor(undefined)}
        />
      ) : null}
    </>
  );
}

export function NetworkModal({
  title,
  initialFocus,
  onClose,
  actions,
  children,
}: {
  title: string;
  initialFocus?: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, { onClose, initialFocus });
  return createPortal(
    <div
      className="netview-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="netview mx netview-modal ui-zoom"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="netview-modal-title">
          <strong>{title}</strong>
          <div className="netview-modal-actions">
            {actions}
            <button className="netview-icon-button" aria-label="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function NetworkResourceIcon({ flow }: { flow: MaterialFlow }) {
  return (
    <span aria-hidden="true" className="netview-resource-icon">
      <ResourceIcon
        resource={{
          kind: flow.kind,
          id: flow.resourceId,
          displayName: flow.label,
          amount: 1,
          iconPath: flow.iconPath,
          iconAtlas: flow.iconAtlas,
          dominantColor: flow.dominantColor,
        }}
        bare
        showAmount={false}
        tooltip={false}
        showConsumedState={false}
        className="!h-7 !w-7"
        iconPixelSize={28}
      />
    </span>
  );
}

export function isDescendant(
  network: PlanNetwork,
  ancestor: string,
  networks: PlanNetwork[],
): boolean {
  let parent = network.parentId;
  while (parent) {
    if (parent === ancestor) return true;
    parent = networks.find((entry) => entry.id === parent)?.parentId;
  }
  return false;
}

export function NetworkTree({
  networks,
  parentId,
}: {
  networks: PlanNetwork[];
  parentId?: string;
}) {
  const activeId = useNetworkStore((state) => state.activeId);
  return (
    <ul className="netview-tree">
      {networks
        .filter((network) => network.parentId === parentId)
        .map((network) => (
          <li key={network.id}>
            <button
              className="netview-link"
              aria-current={activeId === network.id ? "page" : undefined}
              onClick={() => useNetworkStore.getState().open(network.id)}
            >
              {network.name}
              {network.parentId && network.selfPowered ? <SelfPoweredIcon /> : null}
              {!network.included ? " (excluded)" : ""}
            </button>
            <NetworkTree networks={networks} parentId={network.id} />
          </li>
        ))}
    </ul>
  );
}
