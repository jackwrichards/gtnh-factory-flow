import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { isFluidTankRecipe } from "@/lib/model/fluid-tank";
import { buildMachineList, type MachineListEntry } from "@/lib/model/machine-list";
import { pinRuleOf, type PinRule } from "@/lib/model/pin-rule";
import type { PlanUpTo } from "@/lib/solver/plan/types";
import { makeResourceKey } from "@/lib/model/resources";
import { getStorageRoles, type StorageRole } from "@/lib/model/storage-role";
import { hasStorageTarget, storageTargetMode, type TargetMode } from "@/lib/model/storage-target";
import type {
  FactoryProject,
  ResourceAmount,
  ResourceKind,
  ThroughputResult,
} from "@/lib/model/types";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
  parseResourceHandleId,
} from "../../resource-handles";

/**
 * The overview's numbers, worked out once per (project, solve): what the plan
 * brings in, sends out and keeps inside, what sets each resource (drawers,
 * ports set to a rate on their cards, open ports) and the machines to build.
 * A port of the mod's `BoardSession.buildTotals` and `OverviewRail.index`.
 * Pure: no store, no DOM.
 */

/** Below this a rate (per second) is solver noise, not a flow worth a line. */
export const RAIL_EPS = 1e-6;

export type RailSide = "inputs" | "outputs" | "internal";

export type RailResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

/** A drawer that takes a rule, as one setter of a line. */
export interface RailDrawer {
  type: "drawer";
  id: string;
  source: boolean;
  role: StorageRole;
  rule: TargetMode;
  /** Magnitude, per second; 0 when none is set. */
  ratePerSecond: number;
  /** A rule or a rate is in force (the box shows the number, not "Set"). */
  set: boolean;
  unmet: boolean;
}

/** A port set to a rate on its card with nothing wired to it. */
export interface RailPin {
  type: "port";
  nodeId: string;
  handle: string;
  output: boolean;
  ratePerSecond: number;
  machine: string;
}

/** A port of a line's resource with nothing wired to it and no drawer. */
export interface RailOpenPort {
  nodeId: string;
  handle: string;
  output: boolean;
  perSecond: number;
  machine: string;
}

export interface RailLine {
  /** The canonical resource key (`item:iron_ingot`). */
  key: string;
  kind: ResourceKind;
  resourceId: string;
  label: string;
  /** Units a second (EU a second for power: the rail shows it per tick). */
  amount: number;
  energy: boolean;
  resource: RailResource;
  drawers: RailDrawer[];
  pins: RailPin[];
  open: RailOpenPort[];
}

export interface RailMachine extends MachineListEntry {
  /** A count is set (Up to or Exactly). */
  pinned: boolean;
  /** The count rule as the card shows it: Any, Up to (with or without a count) or Exactly. */
  rule: PinRule;
  /** The set count when pinned. */
  pin?: number;
  /** The solver's read-out for an Up to card, when it gave one. */
  upTo?: PlanUpTo;
}

export interface RailModel {
  inputs: RailLine[];
  outputs: RailLine[];
  internal: RailLine[];
  machines: RailMachine[];
  /** Whole machines to build (each card rounded up). */
  wholeMachines: number;
  power: {
    peak: { used: number; made: number; steam: number };
    average: { used: number; made: number; steam: number };
    hasMade: boolean;
  };
  /** Canonical resource key by what a port asks for (two keys a wire joins are one resource). */
  aliases: ReadonlyMap<string, string>;
}

export const EMPTY_RAIL: RailModel = {
  inputs: [],
  outputs: [],
  internal: [],
  machines: [],
  wholeMachines: 0,
  power: {
    peak: { used: 0, made: 0, steam: 0 },
    average: { used: 0, made: 0, steam: 0 },
    hasMade: false,
  },
  aliases: new Map(),
};

/** A shared machine's section result id (`card#r2`) split into the card and the handle prefix (`r2:`). */
export function splitResultNodeId(id: string): { cardId: string; prefix: string } {
  const at = id.indexOf("#r");
  if (at < 0) return { cardId: id, prefix: "" };
  return { cardId: id.slice(0, at), prefix: `r${id.slice(at + 2)}:` };
}

/** The canonical handle id of a result node's flow (`output:item:foo`, `r2:output:item:foo`). */
export function flowHandle(
  resultNodeId: string,
  side: "input" | "output",
  kind: ResourceKind,
  resourceId: string,
): string {
  const { prefix } = splitResultNodeId(resultNodeId);
  return `${prefix}${makeResourceHandleId(side, { kind, id: resourceId })}`;
}

export function buildResourceLookup(project: FactoryProject): Map<string, RailResource> {
  const resources = new Map<string, RailResource>();
  const add = (resource: RailResource) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = resources.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) resources.set(key, resource);
  };
  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) add(resource);
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }
  return resources;
}

/** Keys a wire joins to another: what an input asks for, to what is wired into it. */
function buildAliases(project: FactoryProject): Map<string, string> {
  const same = new Map<string, string>();
  for (const edge of project.edges) {
    const made = makeResourceKey(edge.resourceKind, edge.resourceId);
    const target = parseResourceHandleId(edge.targetHandle);
    if (!target) continue;
    const used = makeResourceKey(target.kind, target.resourceId);
    if (used !== made && !same.has(used)) same.set(used, made);
  }
  return same;
}

export function canonicalOf(aliases: ReadonlyMap<string, string>, key: string): string {
  let at = key;
  for (let i = 0; i < 16; i += 1) {
    const next = aliases.get(at);
    if (next === undefined) break;
    at = next;
  }
  return at;
}

function wiredPorts(project: FactoryProject): Set<string> {
  const wired = new Set<string>();
  for (const edge of project.edges) {
    const out =
      canonicalizeResourceHandleId(edge.sourceHandle) ??
      makeResourceHandleId("output", { kind: edge.resourceKind, id: edge.resourceId });
    const inn =
      canonicalizeResourceHandleId(edge.targetHandle) ??
      makeResourceHandleId("input", { kind: edge.resourceKind, id: edge.resourceId });
    wired.add(`${edge.source}|${out}`);
    wired.add(`${edge.target}|${inn}`);
  }
  return wired;
}

function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

interface Look {
  kind: ResourceKind;
  id: string;
  label: string;
}

export function buildRailModel(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): RailModel {
  if (!result) return EMPTY_RAIL;
  const recipes = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const lookup = buildResourceLookup(project);
  const aliases = buildAliases(project);
  const wired = wiredPorts(project);
  const roles = getStorageRoles(project);

  const machineEntries = buildMachineList(project, result);
  const machines: RailMachine[] = machineEntries
    // A fluid tank is free and instant: no machine to build (the mod lists none for it).
    .filter((entry) => !isFluidTankRecipe(recipes.get(nodesById.get(entry.nodeId)?.recipeId ?? "")))
    .map((entry) => {
      const node = nodesById.get(entry.nodeId);
      const rule = node ? pinRuleOf(node) : "any";
      const pin = node?.solvePin;
      const pinned = rule !== "any" && pin !== undefined && pin > 0;
      const upTo = rule === "upTo" ? result.plan?.upTo?.[entry.nodeId] : undefined;
      // An Up to card lists what runs, not what is set.
      const count = upTo ? Math.max(0, upTo.reached) : entry.count;
      return {
        ...entry,
        count,
        pinned,
        rule,
        ...(pinned ? { pin } : {}),
        ...(upTo ? { upTo } : {}),
      };
    });
  const machineName = new Map(machineEntries.map((entry) => [entry.nodeId, entry.label]));
  const nameOf = (cardId: string): string => {
    const known = machineName.get(cardId);
    if (known) return known;
    const recipe = recipes.get(nodesById.get(cardId)?.recipeId ?? "");
    return recipe?.machineType ?? cardId;
  };

  // Flow: what every card makes and uses, by canonical resource.
  const made = new Map<string, number>();
  const used = new Map<string, number>();
  const looks = new Map<string, Look>();
  const pinsByLine = new Map<string, RailPin[]>();
  const openByLine = new Map<string, RailOpenPort[]>();
  // A failed solve (nothing set, nothing to calculate) leaves each card's nominal single craft in its result: those
  // are not flows of the plan, so nothing is counted until the plan has an answer.
  const answered = result.plan?.failure === undefined;
  for (const node of Object.values(result.nodes)) {
    if (!node.enabled) continue;
    const { cardId } = splitResultNodeId(node.nodeId);
    const projectNode = nodesById.get(cardId);
    const recipe = recipes.get(node.recipeId);
    if (!projectNode || isCustomRateRecipe(recipe)) continue;
    // A machine at zero keeps its nameplate rates in the result (its port rows are built from them) but makes and uses
    // nothing: the mod sums solved flows only. Its ports are still listed, at 0, so they can be set from here.
    const flowing = answered && (node.theoreticalMachinesRequired ?? 0) > 1e-9;
    const running = flowing ? Math.min(1, Math.max(0, node.utilization ?? 1)) : 0;
    for (const side of ["output", "input"] as const) {
      const flows = side === "output" ? node.outputs : node.inputs;
      for (const flow of Object.values(flows)) {
        const key = canonicalOf(aliases, flow.key);
        const bucket = side === "output" ? made : used;
        bucket.set(key, (bucket.get(key) ?? 0) + flow.amountPerSecond * running);
        if (!looks.has(key) || (side === "output" && flow.key === key)) {
          looks.set(key, {
            kind: flow.kind,
            id: flow.resourceId,
            label: flow.displayName ?? lookup.get(flow.key)?.displayName ?? flow.resourceId,
          });
        }
        const output = side === "output";
        const handle = flowHandle(node.nodeId, side, flow.kind, flow.resourceId);
        if (wired.has(`${cardId}|${handle}`)) continue;
        const lineKey = `${output ? "o" : "i"}|${key}`;
        const pinned = projectNode.portRates?.[handle];
        if (pinned !== undefined && pinned > 0) {
          addTo(pinsByLine, lineKey, {
            type: "port",
            nodeId: cardId,
            handle,
            output,
            ratePerSecond: pinned,
            machine: nameOf(cardId),
          });
        }
        addTo(openByLine, lineKey, {
          nodeId: cardId,
          handle,
          output,
          perSecond: flow.amountPerSecond * running,
          machine: nameOf(cardId),
        });
      }
    }
  }

  // What trash voids leaves the plan without being one of its outputs.
  const trashed = new Map<string, number>();
  const sourceDrawers = new Map<string, RailDrawer[]>();
  const productDrawers = new Map<string, RailDrawer[]>();
  const unmetIds = result.plan?.unmetDrawers ?? [];
  for (const storage of project.storages ?? []) {
    const role = roles.get(storage.id) ?? "idle";
    const key = canonicalOf(aliases, makeResourceKey(storage.kind, storage.resourceId));
    if (role === "trash") {
      const eaten = result.storages[storage.id]?.producedPerSecond ?? 0;
      trashed.set(key, (trashed.get(key) ?? 0) + Math.max(0, eaten));
      continue;
    }
    if (role !== "source" && role !== "product" && role !== "byproduct") continue;
    const source = role === "source";
    // Nothing typed and no rule picked: Any (the legacy default for an input would read "exactly").
    const rule: TargetMode =
      role === "byproduct" ||
      (storage.targetMode === undefined && storage.targetPerSecond === undefined)
        ? "ignore"
        : storageTargetMode(storage, role);
    const set = role !== "byproduct" && hasStorageTarget(storage, role);
    addTo(source ? sourceDrawers : productDrawers, key, {
      type: "drawer",
      id: storage.id,
      source,
      role,
      rule,
      ratePerSecond: set ? Math.abs(storage.targetPerSecond ?? 0) : 0,
      set,
      unmet: unmetIds.includes(storage.id),
    });
    if (!looks.has(key)) {
      looks.set(key, {
        kind: storage.kind,
        id: storage.resourceId,
        label:
          storage.displayName ??
          lookup.get(`${storage.kind}:${storage.resourceId}`)?.displayName ??
          storage.resourceId,
      });
    }
  }

  const line = (key: string, amount: number, side: "i" | "o" | "x"): RailLine => {
    const look: Look = looks.get(key) ?? {
      kind: key.split(":")[0] as ResourceKind,
      id: key.slice(key.indexOf(":") + 1),
      label: key,
    };
    const resource = lookup.get(`${look.kind}:${look.id}`) ?? {
      kind: look.kind,
      id: look.id,
      displayName: look.label,
    };
    return {
      key,
      kind: look.kind,
      resourceId: look.id,
      label: look.label,
      amount,
      energy: look.kind === "power",
      resource: { ...resource, displayName: resource.displayName ?? look.label },
      drawers:
        side === "i"
          ? (sourceDrawers.get(key) ?? [])
          : side === "o"
            ? (productDrawers.get(key) ?? [])
            : [],
      pins: side === "x" ? [] : (pinsByLine.get(`${side}|${key}`) ?? []),
      open: side === "x" ? [] : (openByLine.get(`${side}|${key}`) ?? []),
    };
  };

  const inputs: RailLine[] = [];
  const outputs: RailLine[] = [];
  const internal: RailLine[] = [];
  for (const key of new Set([...made.keys(), ...used.keys()])) {
    const m = made.get(key) ?? 0;
    const u = used.get(key) ?? 0;
    const leaves = m - u - (trashed.get(key) ?? 0);
    if (u - m > RAIL_EPS) inputs.push(line(key, u - m, "i"));
    if (leaves > RAIL_EPS) outputs.push(line(key, leaves, "o"));
    if (Math.min(m, u) > RAIL_EPS) internal.push(line(key, Math.min(m, u), "x"));
  }
  // Biggest first; equal amounts keep the order the plan met them in (the sort is stable), as the mod lists them.
  const byAmount = (a: RailLine, b: RailLine) => b.amount - a.amount;
  inputs.sort(byAmount);
  outputs.sort(byAmount);
  internal.sort(byAmount);
  // A resource a card's unwired port takes or makes stays listed at 0, so it can be set from here.
  for (const [lineKey] of openByLine) {
    const key = lineKey.slice(2);
    const list = lineKey.startsWith("o|") ? outputs : inputs;
    if (!list.some((l) => l.key === key))
      list.push(line(key, 0, lineKey.startsWith("o|") ? "o" : "i"));
  }
  // A resource with a drawer stays listed at 0, so its rule and rate can be set from here.
  for (const key of sourceDrawers.keys()) {
    if (!inputs.some((l) => l.key === key)) inputs.push(line(key, 0, "i"));
  }
  for (const key of productDrawers.keys()) {
    if (!outputs.some((l) => l.key === key)) outputs.push(line(key, 0, "o"));
  }

  const sum = (pick: (entry: MachineListEntry) => number | undefined) =>
    machineEntries.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
  const power = {
    peak: { used: sum((e) => e.euT), made: sum((e) => e.madeEuT), steam: sum((e) => e.steamLs) },
    average: {
      used: sum((e) => e.avgEuT),
      made: sum((e) => e.avgMadeEuT),
      steam: sum((e) => e.avgSteamLs),
    },
    hasMade: machineEntries.some((e) => e.madeEuT !== undefined),
  };
  const wholeMachines = machines.reduce((total, e) => total + Math.ceil(e.count - 1e-9), 0);
  return { inputs, outputs, internal, machines, wholeMachines, power, aliases };
}

/** A section's lines: what the plan's spares carry is theirs, so a line left with nothing but that is not listed. */
export function visibleLines(
  lines: readonly RailLine[],
  side: RailSide,
  spared: ReadonlyMap<string, number>,
): Array<{ line: RailLine; amount: number }> {
  const out: Array<{ line: RailLine; amount: number }> = [];
  for (const line of lines) {
    if (side === "internal") {
      out.push({ line, amount: line.amount });
      continue;
    }
    const left = Math.max(0, line.amount - (spared.get(line.key) ?? 0));
    if (
      left <= Math.max(RAIL_EPS, line.amount * 1e-4) &&
      line.drawers.length === 0 &&
      line.pins.length === 0
    )
      continue;
    out.push({ line, amount: left });
  }
  return out;
}
