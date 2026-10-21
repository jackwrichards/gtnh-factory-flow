import type { FactoryProject, ResourceFlow, ThroughputResult } from "@/lib/model/types";
import { buildMachineList } from "@/lib/model/machine-list";
import { makePortKey } from "@/lib/solver/plan/port-key";
import { rowHandle } from "@/lib/solver/plan/adapter/rows";
import { buildRows, inputRowFor, outputRowFor } from "@/lib/solver/plan/adapter/rows";
import { sectionNodeId, sectionOwnerId, splitSectionHandleId } from "@/lib/model/shared-machine";
import { getStorageRoles } from "@/lib/model/storage-role";
import type { MaterialFlow, NetworkPortFlow, PlanFlows } from "./model";

export function planFlows(project: FactoryProject, result: ThroughputResult): PlanFlows {
  const machines = buildMachineList(project, result);
  const failure = result.plan?.failure;
  const artwork = new Map<string, Pick<MaterialFlow, "iconPath" | "iconAtlas" | "dominantColor">>();
  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      const key = `${resource.kind}:${resource.id}`;
      if (resource.iconPath || resource.iconAtlas || resource.dominantColor)
        artwork.set(key, {
          ...artwork.get(key),
          iconPath: resource.iconPath,
          iconAtlas: resource.iconAtlas,
          dominantColor: resource.dominantColor,
        });
    }
  }
  for (const drawer of project.storages ?? []) {
    if (drawer.iconPath || drawer.iconAtlas || drawer.dominantColor)
      artwork.set(`${drawer.kind}:${drawer.resourceId}`, {
        iconPath: drawer.iconPath,
        iconAtlas: drawer.iconAtlas,
        dominantColor: drawer.dominantColor,
      });
  }
  const materials = new Map<string, MaterialFlow>(
    Object.values(result.resources)
      .filter((row) => row.kind !== "power")
      .map((row) => [
        row.key,
        {
          key: row.key,
          kind: row.kind,
          resourceId: row.resourceId,
          label: row.displayName ?? row.resourceId,
          supply: row.productPerSecond + row.byproductPerSecond + row.bufferFillPerSecond,
          demand: row.importedPerSecond,
        },
      ]),
  );

  const choices = new Map<string, NetworkPortFlow>();
  const labels = new Map(
    machines.map((machine, index) => [machine.nodeId, `${machine.label} · ${index + 1}`]),
  );
  const addPort = (portKey: string, side: "in" | "out", flow: MaterialFlow, machine: string) => {
    const key = JSON.stringify([portKey, flow.key]);
    const previous = choices.get(key);
    if (previous) {
      previous.supply += flow.supply;
      previous.demand += flow.demand;
    } else choices.set(key, { ...flow, portKey, side, machine });
  };

  // The resource books count drawers; the solve's port boundaries count what enters or leaves without one.
  // Drawer-owned ports are excluded by the adapter, and leftovers describe the same forced flows, so neither is added twice.
  const ports = new Map<string, ResourceFlow>();
  for (const node of Object.values(result.nodes)) {
    for (const side of ["input", "output"] as const) {
      for (const flow of Object.values(side === "input" ? node.inputs : node.outputs)) {
        ports.set(
          makePortKey(
            node.nodeId,
            side === "input" ? "i" : "o",
            rowHandle(side, flow.kind, flow.resourceId),
          ),
          flow,
        );
        if (flow.kind !== "power")
          addPort(
            makePortKey(
              node.nodeId,
              side === "input" ? "i" : "o",
              rowHandle(side, flow.kind, flow.resourceId),
            ),
            side === "input" ? "in" : "out",
            {
              key: flow.key,
              kind: flow.kind,
              resourceId: flow.resourceId,
              label: flow.displayName ?? flow.resourceId,
              supply: 0,
              demand: 0,
            },
            labels.get(sectionOwnerId(node.nodeId)) ?? node.nodeId,
          );
      }
    }
  }

  // Attribute ordinary drawer boundaries to their machine port, retaining the drawer's resource
  // identity. Shared buffers and drawer chains retain their own boundary entry rather than
  // inventing a distribution of their net surplus between machines.
  const remaining = new Map([...materials].map(([key, flow]) => [key, { ...flow }]));
  const roles = getStorageRoles(project);
  const drawers = new Map((project.storages ?? []).map((drawer) => [drawer.id, drawer]));
  for (const edge of project.edges) {
    for (const side of ["in", "out"] as const) {
      const drawer = drawers.get(side === "in" ? edge.source : edge.target);
      const role = drawer && roles.get(drawer.id);
      if (
        !drawer ||
        (side === "in" ? role !== "source" : role !== "product" && role !== "byproduct")
      )
        continue;
      const nodeId = sectionNodeId(
        side === "in" ? edge.target : edge.source,
        splitSectionHandleId(side === "in" ? edge.targetHandle : edge.sourceHandle).section,
      );
      const node = result.nodes[nodeId];
      if (!node) continue;
      const rows = buildRows(
        nodeId,
        side === "in",
        side === "in" ? node.inputs : node.outputs,
        () => 0,
      );
      const port = (side === "in" ? inputRowFor : outputRowFor)(rows, edge);
      const resource = remaining.get(`${drawer.kind}:${drawer.resourceId}`);
      if (!port || !resource) continue;
      const field = side === "in" ? "demand" : "supply";
      const amount = Math.min(resource[field], result.edges[edge.id]?.transferredPerSecond ?? 0);
      if (amount <= 0) continue;
      resource[field] -= amount;
      addPort(
        port.portKey,
        side,
        { ...resource, supply: 0, demand: 0, [field]: amount },
        labels.get(sectionOwnerId(nodeId)) ?? nodeId,
      );
    }
  }
  for (const row of remaining.values()) {
    for (const side of ["in", "out"] as const) {
      const amount = side === "in" ? row.demand : row.supply;
      if (amount > 1e-9)
        addPort(
          `drawers:${side}:${row.key}`,
          side,
          { ...row, supply: side === "out" ? amount : 0, demand: side === "in" ? amount : 0 },
          "Drawers",
        );
    }
  }
  for (const boundary of [...(result.plan?.terminals ?? []), ...(result.plan?.forced ?? [])]) {
    const flow = ports.get(boundary.portKey);
    if (!flow || flow.kind === "power" || boundary.perSecond <= 0) continue;
    const row = materials.get(flow.key) ?? {
      key: flow.key,
      kind: flow.kind,
      resourceId: flow.resourceId,
      label: flow.displayName ?? flow.resourceId,
      supply: 0,
      demand: 0,
    };
    if (boundary.side === "out") row.supply += boundary.perSecond;
    else row.demand += boundary.perSecond;
    materials.set(row.key, row);
    addPort(
      boundary.portKey,
      boundary.side,
      {
        ...row,
        supply: boundary.side === "out" ? boundary.perSecond : 0,
        demand: boundary.side === "in" ? boundary.perSecond : 0,
      },
      labels.get(sectionOwnerId(boundary.nodeId)) ?? boundary.nodeId,
    );
  }
  return {
    materials: [...materials.values()]
      .filter((row) => row.supply > 0 || row.demand > 0)
      .map((row) => ({ ...row, ...artwork.get(row.key) })),
    ports: [...choices.values()].map((row) => ({ ...row, ...artwork.get(row.key) })),
    power: {
      used: machines.reduce((sum, machine) => sum + (machine.avgEuT ?? 0), 0),
      made: machines.reduce((sum, machine) => sum + (machine.avgMadeEuT ?? 0), 0),
    },
    stale: result.stale,
    error: Object.values(result.nodes).some((node) => node.status === "missing-recipe")
      ? "Missing recipe"
      : failure
        ? failure.message === "NO_PIN"
          ? "Set a rate or machine count in this plan"
          : "The plan could not be solved"
        : undefined,
  };
}
