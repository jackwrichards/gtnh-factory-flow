import { isCustomRateRecipe } from "../../../model/custom-rate";
import { isFluidTankRecipe } from "../../../model/fluid-tank";
import { pinRuleOf } from "../../../model/pin-rule";
import { resourceLabel } from "../../../model/resources";
import {
  listSharedMachineGroups,
  parseSectionNodeId,
  sectionNodeId,
} from "../../../model/shared-machine";
import { getStorageRoles, type StorageRole } from "../../../model/storage-role";
import { hasStorageTarget, storageTargetMode } from "../../../model/storage-target";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryStorage,
  NodeThroughputResult,
  Recipe,
  ResourceKey,
} from "../../../model/types";
import { TICKS_PER_SECOND } from "../../../model/types";
import { HATCH_SUPPLY_PREFIX } from "../../hatch-supply";
import { compareIds } from "../ids";
import { splitLeftoverKey } from "../port-key";
import type {
  DrawerIn,
  DrawerKind,
  DrawerRule,
  EdgeIn,
  Id,
  MachineIn,
  PoolIn,
  PortIn,
  PortKey,
  PortRef,
  SolveInput,
} from "../types";
import type { PlanSolveArgs, PlanUnit } from "./args";
import { expandBuffers } from "./buffers";
import {
  buildRows,
  canonicalPortRateHandle,
  inputRowFor,
  outputRowFor,
  rawPerCraft,
  type PortRow,
} from "./rows";
import { findUnanchored } from "./unanchored";

/** The core's `SolveInput`, as the adapter builds it from the board. */
export type PlanSolveInput = SolveInput;

/** One machine of the model: the solve node, its report and its port rows. */
export interface MachineEntry {
  id: Id;
  node: FactoryNode;
  recipe: Recipe;
  report: NodeThroughputResult;
  inputs: PortRow[];
  outputs: PortRow[];
  /** The built count the nameplate flows were computed at. */
  builtCount: number;
  durationTicks: number;
  throughputFactor: number;
  /** The card's id (the section's owner), and its section number. */
  owner: Id;
  section: number;
}

/** A wire between a machine port and a drawer. */
export interface DrawerEdge {
  edgeId: string;
  drawerId: Id;
  ref: PortRef;
}

/** The wires of a model, and which of the project's wires each stands for. */
export interface PlanModel {
  input: PlanSolveInput;
  machines: Map<Id, MachineEntry>;
  /** machine-to-machine wires of the engine, by edge id. */
  engineEdges: Map<string, { edge: FactoryEdge; source: PortRow; target: PortRow }>;
  /** wires between a machine and a drawer, by edge id. */
  drawerEdges: Map<string, DrawerEdge>;
  /** The edges (buffer-free) the model was built from, and what each covers. */
  edges: FactoryEdge[];
  covers: Map<string, string[]>;
  storages: FactoryStorage[];
  roles: Map<string, StorageRole>;
  drawers: Map<Id, FactoryStorage>;
  /** Card id -> solve ids of its sections, only for cards with extra sections. */
  groups: Map<string, string[]>;
  /** Ports that a drawer sits on, as PortKeys. */
  drawerPorts: Set<PortKey>;
  /** Ids that are hidden helpers (never shown to the player). */
  hidden: Set<Id>;
  /** Recipes and drawers in a part of the plan nothing sets. */
  unanchored: Id[];
  portByKey: Map<PortKey, PortRef>;
  row(ref: PortRef): PortRow | undefined;
}

const MISSING = "missing";

function plainUnit(): PlanUnit {
  return { durationTicks: TICKS_PER_SECOND, throughputFactor: 1 };
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function drawerKindAndRule(
  storage: FactoryStorage,
  role: StorageRole,
): { kind: DrawerKind; rule: DrawerRule; rate: number } {
  const kind: DrawerKind =
    role === "source" ? "SOURCE" : role === "trash" ? "TRASH" : role === "buffer" ? "BUFFER" : "PRODUCT";
  // A byproduct or trash drawer's number is dormant: it asks for nothing. So is a buffer's: a buffer only passes what
  // its users take (the website has no rule on it; a stored one, from an older plan or a drawer that was a product,
  // waits until it is a product again).
  if (role === "byproduct" || role === "trash" || role === "buffer" || !hasStorageTarget(storage, role)) {
    return { kind, rule: "ANY", rate: 0 };
  }
  const mode = storageTargetMode(storage, role);
  const rule: DrawerRule =
    mode === "at-least"
      ? "AT_LEAST"
      : mode === "exact"
        ? "EXACTLY"
        : mode === "at-most"
          ? "AT_MOST"
          : "ANY";
  return { kind, rule, rate: rule === "ANY" ? 0 : Math.abs(storage.targetPerSecond ?? 0) };
}

/**
 * The website's expanded project as the solver core's `SolveInput`
 * (spec-adapter 2): one machine per enabled solve node with its nameplate
 * flows turned back into per-craft amounts, wires between machines as edges,
 * wires to drawers as drawer links, pins and port rates as pins, shared
 * machines with a pinned count as exact pools. Machines, edges and drawers are
 * in `compareIds` order, so the answer never depends on the board's order.
 */
export function buildPlanModel(args: PlanSolveArgs): PlanModel {
  const { project, nodes } = args;
  const units = args.units ?? {};
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const hidden = new Set<Id>();

  const flat = expandBuffers(project);
  const roles = getStorageRoles({
    ...project,
    edges: flat.edges,
    storages: flat.storages,
    poolMode: undefined,
  });

  // ---- machines ----------------------------------------------------------
  const entries: MachineEntry[] = [];
  for (const node of project.nodes) {
    const report = nodes[node.id];
    const recipe = recipesById.get(node.recipeId);
    if (
      !node.enabled ||
      !report ||
      !recipe ||
      report.status === "missing-recipe" ||
      report.status === "disabled"
    ) {
      continue;
    }
    const inputKeys = Object.keys(report.inputs);
    const outputKeys = Object.keys(report.outputs);
    // A custom rate card holding nothing has no ports and nothing to say.
    if (inputKeys.length + outputKeys.length === 0 && isCustomRateRecipe(recipe)) {
      continue;
    }
    const unit = units[node.id] ?? plainUnit();
    const builtCount = node.machineCount;
    const opRate = report.operationRatePerSecond;
    const readable = builtCount > 0 && opRate > 0 && Number.isFinite(opRate);
    const raw = readable || unit.perCraft ? undefined : rawPerCraft(recipe);
    // The row's flow is amount-per-craft x operationRate, so the engine's
    // `amount` (chance and multiplier 1) is flow / operationRate. A card with
    // no count reads the nameplate loop's own per-craft amounts.
    const amountOf = (side: "i" | "o") => (flow: { key: string; amountPerSecond: number }) =>
      readable
        ? flow.amountPerSecond / opRate
        : unit.perCraft
          ? (side === "i" ? unit.perCraft.inputs : unit.perCraft.outputs)[flow.key as ResourceKey] ?? 0
          : (side === "i" ? raw!.inputs : raw!.outputs).get(flow.key as never) ?? 0;
    const section = parseSectionNodeId(node.id).section;
    entries.push({
      id: node.id,
      node,
      recipe,
      report,
      inputs: buildRows(node.id, true, report.inputs, amountOf("i")),
      outputs: buildRows(node.id, false, report.outputs, amountOf("o")),
      builtCount,
      durationTicks: unit.durationTicks,
      throughputFactor: unit.throughputFactor > 0 ? unit.throughputFactor : 1,
      owner: parseSectionNodeId(node.id).nodeId,
      section,
    });
  }
  entries.sort((a, b) => compareIds(a.id, b.id));
  const machines = new Map(entries.map((entry) => [entry.id, entry]));
  const groups = new Map<string, string[]>();
  for (const [card, ids] of listSharedMachineGroups(machines.keys())) {
    groups.set(
      card,
      ids.filter((id) => machines.has(id)),
    );
  }

  // ---- edges and drawer wires ---------------------------------------------
  const engineEdges = new Map<string, { edge: FactoryEdge; source: PortRow; target: PortRow }>();
  const edgeIns: EdgeIn[] = [];
  const drawerEdges = new Map<string, DrawerEdge>();
  const storagesById = new Map(flat.storages.map((storage) => [storage.id, storage]));
  const linkedDrawer = (id: string) => {
    const role = roles.get(id);
    return storagesById.has(id) &&
      (role === "source" || role === "product" || role === "byproduct" || role === "trash" || role === "buffer")
      ? role
      : undefined;
  };

  for (const edge of [...flat.edges].sort((a, b) => compareIds(a.id, b.id))) {
    const source = machines.get(edge.source);
    const target = machines.get(edge.target);
    if (source && target) {
      const out = outputRowFor(source.outputs, edge);
      const into = inputRowFor(target.inputs, edge);
      if (out && into) {
        engineEdges.set(edge.id, { edge, source: out, target: into });
        edgeIns.push({
          id: edge.id,
          source: source.id,
          sourceOutput: out.index,
          target: target.id,
          targetInput: into.index,
        });
      }
      continue;
    }
    if (source && !target) {
      const role = linkedDrawer(edge.target);
      const out = role && role !== "source" ? outputRowFor(source.outputs, edge) : undefined;
      if (out) {
        drawerEdges.set(edge.id, {
          edgeId: edge.id,
          drawerId: edge.target,
          ref: { node: source.id, port: out.index, input: false },
        });
      }
    } else if (target && !source) {
      const role = linkedDrawer(edge.source);
      const into = role === "source" || role === "buffer" ? inputRowFor(target.inputs, edge) : undefined;
      if (into) {
        drawerEdges.set(edge.id, {
          edgeId: edge.id,
          drawerId: edge.source,
          ref: { node: target.id, port: into.index, input: true },
        });
      }
    }
  }

  // ---- drawers -------------------------------------------------------------
  const linksByDrawer = new Map<Id, Array<{ node: Id; port: number }>>();
  // A buffer's users (the input ports it feeds); its links are the outputs feeding it.
  const takersByDrawer = new Map<Id, Array<{ node: Id; port: number }>>();
  const drawerPorts = new Set<PortKey>();
  const portByKey = new Map<PortKey, PortRef>();
  for (const entry of entries) {
    for (const row of entry.inputs) {
      portByKey.set(row.portKey, { node: entry.id, port: row.index, input: true });
    }
    for (const row of entry.outputs) {
      portByKey.set(row.portKey, { node: entry.id, port: row.index, input: false });
    }
  }
  for (const link of [...drawerEdges.values()].sort((a, b) => compareIds(a.edgeId, b.edgeId))) {
    const buffer = roles.get(link.drawerId) === "buffer";
    const byDrawer = buffer && link.ref.input ? takersByDrawer : linksByDrawer;
    const links = byDrawer.get(link.drawerId) ?? [];
    if (!links.some((l) => l.node === link.ref.node && l.port === link.ref.port)) {
      links.push({ node: link.ref.node, port: link.ref.port });
    }
    byDrawer.set(link.drawerId, links);
    // A buffer is no end of the plan: what crosses at its ports is a forced row there, as on a wire.
    if (buffer) continue;
    const entry = machines.get(link.ref.node)!;
    drawerPorts.add((link.ref.input ? entry.inputs : entry.outputs)[link.ref.port]!.portKey);
  }
  const drawerIns: DrawerIn[] = [];
  const drawerMap = new Map<Id, FactoryStorage>();
  for (const storage of [...flat.storages].sort((a, b) => compareIds(a.id, b.id))) {
    const links = linksByDrawer.get(storage.id) ?? [];
    const takers = takersByDrawer.get(storage.id) ?? [];
    const role = roles.get(storage.id);
    if (links.length + takers.length === 0 || !role) {
      continue;
    }
    const { kind, rule, rate } = drawerKindAndRule(storage, role);
    drawerIns.push({
      id: storage.id,
      label: storage.displayName ?? storage.resourceId,
      kind,
      rule,
      rate,
      links,
      ...(kind === "BUFFER" ? { takers } : {}),
    });
    drawerMap.set(storage.id, storage);
  }

  // ---- pins, pools, port rates ----------------------------------------------
  const pools: PoolIn[] = [];
  const grouped = new Set<Id>();
  for (const [card, ids] of groups) {
    const owner = machines.get(card);
    const pin = owner?.node.solvePin;
    for (const id of ids) {
      grouped.add(id);
    }
    if (owner && positive(pin)) {
      // Exactly pins the group's machine time; Up to caps it and runs it as high as the plan lets it.
      const exact = pinRuleOf(owner.node, owner.recipe) === "exact";
      pools.push({ machines: [...ids].sort(compareIds), capacity: pin, exact, upTo: !exact });
    }
  }
  // A single card's Up to pin is a one-machine pool; its count is the engine's to find.
  const upToSingles = new Set<Id>();
  for (const entry of entries) {
    if (entry.section !== 0 || grouped.has(entry.id) || isFluidTankRecipe(entry.recipe)) continue;
    const pin = entry.node.solvePin;
    if (positive(pin) && pinRuleOf(entry.node, entry.recipe) === "upTo") {
      upToSingles.add(entry.id);
      pools.push({ machines: [entry.id], capacity: pin, exact: false, upTo: true });
    }
  }
  pools.sort((a, b) => compareIds(a.machines[0]!, b.machines[0]!));

  const rateOf = new Map<Id, { out: Record<number, number>; in: Record<number, number> }>();
  const ratesFor = (id: Id) => {
    let rates = rateOf.get(id);
    if (!rates) {
      rates = { out: {}, in: {} };
      rateOf.set(id, rates);
    }
    return rates;
  };
  for (const entry of entries) {
    if (entry.section > 0) {
      continue; // a section view carries a copy of the card's rates; the card owns them
    }
    for (const [handleId, rate] of Object.entries(entry.node.portRates ?? {})) {
      if (!positive(rate)) {
        continue;
      }
      const { section, handle } = canonicalPortRateHandle(handleId);
      const target = machines.get(sectionNodeId(entry.node.id, section));
      if (!target) {
        continue;
      }
      const output = handle.startsWith("output:");
      const row = (output ? target.outputs : target.inputs).find((r) => r.handle === handle);
      if (row) {
        ratesFor(target.id)[output ? "out" : "in"][row.index] = rate;
      }
    }
  }

  // ---- ingredient numbers (diagnostics only) ---------------------------------
  const numbers = new Map<string, number>();
  const numberOf = (key: string) => {
    let n = numbers.get(key);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(key, n);
    }
    return n;
  };
  const resourceOfRow = new Map<PortRow, number>();
  for (const entry of entries) {
    for (const row of [...entry.inputs, ...entry.outputs]) {
      resourceOfRow.set(row, numberOf(row.key));
    }
  }
  // An ore-dictionary input takes the number of the output wired to it, or of the first output feeding the buffer it
  // draws from (the solver joins a buffer's ports of one number).
  for (const { source, target } of engineEdges.values()) {
    resourceOfRow.set(target, resourceOfRow.get(source)!);
  }
  for (const drawer of drawerIns) {
    const first = drawer.links[0];
    if (drawer.kind !== "BUFFER" || !first) continue;
    const made = resourceOfRow.get(machines.get(first.node)!.outputs[first.port]!)!;
    for (const taker of drawer.takers ?? []) resourceOfRow.set(machines.get(taker.node)!.inputs[taker.port]!, made);
  }

  // ---- machines out -----------------------------------------------------------
  const machineIns: MachineIn[] = entries.map((entry) => {
    const rates = rateOf.get(entry.id);
    const power = Boolean(entry.recipe.power);
    // A fluid tank has no count (it keeps up with whatever the plan needs), so a pin it carries from an older plan,
    // which its card neither shows nor can clear, must not fix its rate.
    const pin = isFluidTankRecipe(entry.recipe) ? undefined : entry.node.solvePin;
    const custom = isCustomRateRecipe(entry.recipe);
    let countFixed = false;
    let machineCount = entry.builtCount;
    if (entry.section === 0 && !grouped.has(entry.id)) {
      if (custom) {
        // Pinned at its dial: the card is the rate.
        countFixed = true;
        machineCount = positive(pin) ? pin : entry.builtCount > 0 ? entry.builtCount : 1;
      } else if (positive(pin) && !upToSingles.has(entry.id)) {
        countFixed = true;
        machineCount = pin;
      }
    }
    const port = (rows: PortRow[]): PortIn[] =>
      rows.map((row) => ({
        amount: row.amount,
        chance: 1,
        multiplier: 1,
        resource: resourceOfRow.get(row)!,
        name: row.displayName ?? resourceLabel({ id: row.resourceId, displayName: row.displayName }),
        free: false,
      }));
    return {
      id: entry.id,
      name: entry.report.recipeName,
      durationTicks: entry.durationTicks,
      energyPerTick:
        power || !(entry.builtCount > 0) ? 0 : entry.report.euT / entry.builtCount,
      throughputFactor: entry.throughputFactor,
      inputs: port(entry.inputs),
      outputs: port(entry.outputs),
      countFixed,
      machineCount,
      targetOutputRates: rates?.out ?? {},
      targetInputRates: rates?.in ?? {},
    };
  });

  // ---- stored spare splits ------------------------------------------------------
  const spares: SolveInput["spares"] = {};
  let unknown = 0;
  const engineKey = (portKey: PortKey): string => {
    const ref = portByKey.get(portKey);
    return ref ? `${ref.node}:${ref.input ? "i" : "o"}:${ref.port}` : `${MISSING}${unknown++}`;
  };
  for (const [leftoverKey, shares] of Object.entries(project.spareShares ?? {})) {
    const bearers = splitLeftoverKey(leftoverKey);
    const mapped = new Map<string, string>();
    for (const portKey of new Set([...bearers, ...Object.keys(shares)])) {
      mapped.set(portKey, engineKey(portKey));
    }
    const split: Record<string, number> = {};
    for (const [portKey, share] of Object.entries(shares)) {
      split[mapped.get(portKey)!] = share;
    }
    const key = [...new Set(bearers.map((b) => mapped.get(b)!))].sort().join("|");
    spares[key] = split;
  }

  const input: PlanSolveInput = {
    mode: "AUTO",
    machines: machineIns,
    edges: edgeIns,
    pools,
    drawers: drawerIns,
    extentPins: {},
    spares,
  };

  const model: PlanModel = {
    input,
    machines,
    engineEdges,
    drawerEdges,
    edges: flat.edges,
    covers: flat.covers,
    storages: flat.storages,
    roles,
    drawers: drawerMap,
    groups,
    drawerPorts,
    hidden,
    unanchored: [],
    portByKey,
    row(ref) {
      const entry = machines.get(ref.node);
      return entry ? (ref.input ? entry.inputs : entry.outputs)[ref.port] : undefined;
    },
  };
  for (const storage of flat.storages) {
    if (storage.id.startsWith(HATCH_SUPPLY_PREFIX)) {
      model.hidden.add(storage.id);
    }
  }
  model.unanchored = findUnanchored(model, flat.storages);
  return model;
}
