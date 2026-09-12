import type { FactoryProject, NodeThroughputResult, ResourceKey } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model/resources";
import { getStorageRoles } from "@/lib/model/storage-role";
import { listSharedMachineGroups } from "@/lib/model/shared-machine";
import { isPoolEdgeId } from "./pool-mode";
import { collectTrashNodeIds } from "@/lib/model/trash";
import { getCompatibleOutputFlow, getEdgeTargetDemandKey } from "./equilibrium";
import { type LinearProgram, type LpSolution } from "./simplex";
import { solveLpAuto } from "./lp-engine";
import { storageRatioEqualities } from "./storage-ratios";

/**
 * SOLVE MODE: the planner's question turned around. Plan mode fixes the
 * machine counts and asks what flows; solve mode fixes the product amounts
 * (each product drawer's typed rate) and asks how many machines. Same
 * conservation rows as equations-core.ts, but:
 *
 *  - each machine's act is UNBOUNDED above: act is "multiples of the built
 *    count", so act x machineCount is the fractional machine count the
 *    targets require. Nothing idles and nothing clogs by pace - the solver
 *    simply runs each recipe exactly as hard as the targets need.
 *  - a product drawer's typed amount is a ROW: inflow >= target. Targets are
 *    minimums, not equalities, because fixed recipe ratios can force one
 *    product past its number while another lands exactly (the distillation
 *    tower shape); the overshoot reads as spare.
 *  - the objective is MINIMIZE TOTAL MACHINERY (sum of act x machineCount),
 *    ShadowTheAge's objective. It also settles under-determination: a chain
 *    no target needs solves to zero, which is itself the answer.
 *
 * Deliberately absent from this mode: the fairness stage, the equal-fill
 * rows, and power-stall pinning. All three encode "what does this BUILD do
 * with these counts", and the counts are exactly what is being solved here.
 * A bare output port still pins its machine to zero - an unwired byproduct
 * stalls in game at any scale, and the per-target feasibility probe below is
 * what names the products that strands.
 *
 * Feasibility is per-target separable: every non-target row is homogeneous
 * (conservation scales), so two individually reachable targets are always
 * jointly reachable - sources are unlimited and machinery is unbounded. An
 * infeasible solve therefore means some target is unreachable at ANY scale
 * (no wired path, or a bare port pinning its chain), and probing each target
 * alone identifies exactly which.
 */

export interface SolveModeTarget {
  storageId: string;
  amountPerSecond: number;
}

/** Run EXACTLY this many machines of this node; the line solves around it. */
export interface SolveModePin {
  nodeId: string;
  machines: number;
}

export interface SolveModeResult {
  status: "optimal" | "failed";
  /** Solved run level per machine node, in multiples of the BUILT count -
   * may exceed 1. Multiply by machineCount for the machine-count answer. */
  scaleByNode: Map<string, number>;
  /** Resource per second on each modeled wire at the solved scale. */
  edgeFlowPerSecond: Map<string, number>;
  /** Product drawers whose typed amount no chain can reach at any scale. */
  unreachableStorageIds: Set<string>;
  /** The pinned counts cannot all run together (an output with nowhere to
   * go, or two pins fighting through a shared port). */
  pinsInfeasible?: boolean;
}

export function solveSolveMode(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  targets: readonly SolveModeTarget[],
  pins: readonly SolveModePin[] = [],
  /** Synthesized helper nodes (loose-cell-wire tanks) whose machine count is
   * headroom, not machinery: near-zero objective weight. */
  weightlessNodeIds?: ReadonlySet<string>,
  solve: (lp: LinearProgram) => LpSolution = solveLpAuto,
): SolveModeResult {
  const roles = getStorageRoles(project);
  const trashIds = collectTrashNodeIds(project);
  const storagesById = new Map((project.storages ?? []).map((s) => [s.id, s]));
  const countByNode = new Map(project.nodes.map((n) => [n.id, n.machineCount]));

  const machineIds: string[] = [];
  for (const node of project.nodes) {
    if (trashIds.has(node.id)) {
      continue;
    }
    const report = nodes[node.id];
    if (report && node.enabled && report.status !== "missing-recipe" && report.operationRatePerSecond > 0) {
      machineIds.push(node.id);
    }
  }
  const actVar = new Map<string, number>();
  machineIds.forEach((id, index) => actVar.set(id, index));

  const edges = [...project.edges].sort((a, b) => a.id.localeCompare(b.id));

  const outPort = (edge: (typeof edges)[number]) => {
    if (!actVar.has(edge.source)) {
      return undefined;
    }
    const flow = getCompatibleOutputFlow(nodes[edge.source], edge);
    return flow
      ? { key: makeResourceKey(flow.kind, flow.resourceId), ratePerSecond: flow.amountPerSecond }
      : undefined;
  };
  const inPort = (edge: (typeof edges)[number]) => {
    if (!actVar.has(edge.target)) {
      return undefined;
    }
    const key = getEdgeTargetDemandKey(project, edge);
    const flow = key ? nodes[edge.target]!.inputs[key] : undefined;
    return key && flow ? { key, ratePerSecond: flow.amountPerSecond } : undefined;
  };

  type StorageKind = "source" | "sink" | "buffer" | "strict-buffer";
  const storageKind = (id: string): StorageKind | undefined => {
    if (trashIds.has(id)) {
      return "sink";
    }
    const storage = storagesById.get(id);
    if (!storage) {
      return undefined;
    }
    const role = roles.get(id);
    if (role === "source") {
      return "source";
    }
    if (role === "product" || role === "byproduct" || role === "trash") {
      return "sink";
    }
    return storage.bufferMode === "strict" || storage.bufferMode === "ratio" ? "strict-buffer" : "buffer";
  };

  const flowVar = new Map<string, number>();
  const usable: typeof edges = [];
  for (const edge of edges) {
    const fromMachine = actVar.has(edge.source);
    const toMachine = actVar.has(edge.target);
    const fromKind = fromMachine ? "machine" : storageKind(edge.source);
    const toKind = toMachine ? "machine" : storageKind(edge.target);
    if (!fromKind || !toKind || fromKind === "sink" || toKind === "source") {
      continue;
    }
    if (fromKind === "source" && toKind === "sink") {
      continue;
    }
    if (fromMachine && !outPort(edge)) {
      continue;
    }
    if (toMachine && !inPort(edge)) {
      continue;
    }
    flowVar.set(edge.id, machineIds.length + usable.length);
    usable.push(edge);
  }

  const bufferFillVar = new Map<string, number>();
  let totalVars = machineIds.length + usable.length;
  for (const storage of project.storages ?? []) {
    if (storageKind(storage.id) === "buffer") {
      bufferFillVar.set(storage.id, totalVars);
      totalVars += 1;
    }
  }

  const equalities: LinearProgram["equalities"] = storageRatioEqualities(project, flowVar);
  const upperBounds: LinearProgram["upperBounds"] = [];

  // Drawer-to-drawer wires get a finite roof so a teleporter chain cannot
  // read as unbounded; machine wires are bounded by their port rows. POOL
  // wires are exempt: a source-to-pool import is bounded by what the pool's
  // takers drink and a pool-to-product line by what its feeders make, both
  // machine rows - and every import and product in pool mode runs over one
  // of them, so the roof capped a typed target at a million a second
  // (Jack, 2026-09-06: 1000/t of a product read "no machine count reaches
  // the required amount" because its import needed more than that).
  for (const edge of usable) {
    if (!actVar.has(edge.source) && !actVar.has(edge.target) && !isPoolEdgeId(edge.id)) {
      upperBounds.push({ coefficients: new Map([[flowVar.get(edge.id)!, 1]]), rhs: 1e6 });
    }
  }

  // Machine port rows: flows on a port balance act x rate exactly. A port
  // with no wires forces act to zero - the closed-plan rule as algebra, at
  // any scale.
  for (const id of machineIds) {
    const report = nodes[id]!;
    const inputRows = new Map<ResourceKey, { rate: number; vars: number[] }>();
    for (const [key, flow] of Object.entries(report.inputs)) {
      inputRows.set(key as ResourceKey, { rate: flow.amountPerSecond, vars: [] });
    }
    const outputRows = new Map<ResourceKey, { rate: number; vars: number[] }>();
    for (const [key, flow] of Object.entries(report.outputs)) {
      outputRows.set(key as ResourceKey, { rate: flow.amountPerSecond, vars: [] });
    }
    for (const edge of usable) {
      if (edge.target === id) {
        const port = inPort(edge);
        if (port) {
          inputRows.get(port.key)?.vars.push(flowVar.get(edge.id)!);
        }
      }
      if (edge.source === id) {
        const port = outPort(edge);
        if (port) {
          outputRows.get(port.key)?.vars.push(flowVar.get(edge.id)!);
        }
      }
    }
    for (const rows of [inputRows, outputRows]) {
      for (const [key, port] of rows) {
        // The closed-plan rule waives POWER, here as in equations-core: an
        // unwired EU port dissipates rather than pinning its generator.
        if (rows === outputRows && port.vars.length === 0 && key.startsWith("power:")) {
          continue;
        }
        const scale = 1 / Math.max(1, port.rate);
        const coefficients = new Map<number, number>();
        for (const v of port.vars) {
          coefficients.set(v, scale);
        }
        coefficients.set(actVar.get(id)!, -port.rate * scale);
        equalities.push({ coefficients, rhs: 0 });
      }
    }
  }

  // Buffer pools: inflow equals outflow plus fill; a strict buffer's fill is
  // pinned at zero.
  for (const storage of project.storages ?? []) {
    const kind = storageKind(storage.id);
    if (kind !== "buffer" && kind !== "strict-buffer") {
      continue;
    }
    const coefficients = new Map<number, number>();
    let scaleBasis = 1;
    for (const edge of usable) {
      if (edge.target === storage.id) {
        coefficients.set(flowVar.get(edge.id)!, 1);
      } else if (edge.source === storage.id) {
        coefficients.set(flowVar.get(edge.id)!, -1);
      } else {
        continue;
      }
      const port = actVar.has(edge.source) ? outPort(edge) : actVar.has(edge.target) ? inPort(edge) : undefined;
      if (port) {
        scaleBasis = Math.max(scaleBasis, port.ratePerSecond);
      }
    }
    if (coefficients.size === 0) {
      continue;
    }
    const scale = 1 / scaleBasis;
    for (const [v, value] of coefficients) {
      coefficients.set(v, value * scale);
    }
    if (kind === "buffer") {
      coefficients.set(bufferFillVar.get(storage.id)!, -scale);
    }
    equalities.push({ coefficients, rhs: 0 });
  }

  // PINS: run exactly this many machines - one equality per pinned node,
  // act = pinned / built. Conservation then scales the rest of the line
  // around it, feeders and eaters both.
  // A shared machine's pin is the card's: its sections' time shares add up
  // to the pinned count, one equality over the whole group.
  const sharedGroups = listSharedMachineGroups(machineIds);
  for (const pin of pins) {
    if (!(pin.machines > 0)) {
      continue;
    }
    const coefficients = new Map<number, number>();
    for (const id of sharedGroups.get(pin.nodeId) ?? [pin.nodeId]) {
      const act = actVar.get(id);
      if (act !== undefined) {
        coefficients.set(act, 1);
      }
    }
    if (coefficients.size === 0) {
      continue;
    }
    const built = Math.max(1, countByNode.get(pin.nodeId) ?? 1);
    equalities.push({ coefficients, rhs: pin.machines / built });
  }

  // Defense: a flow variable in no row would be free to grow without bound.
  {
    const seen = new Set<number>();
    for (const row of equalities) for (const v of row.coefficients.keys()) seen.add(v);
    for (const row of upperBounds) for (const v of row.coefficients.keys()) seen.add(v);
    for (const edge of usable) {
      const v = flowVar.get(edge.id)!;
      if (!seen.has(v)) {
        upperBounds.push({ coefficients: new Map([[v, 1]]), rhs: 0 });
      }
    }
  }

  // A target is a row: the wires into that product drawer together carry at
  // least the typed amount. Built as -inflow <= -target.
  const targetRow = (target: SolveModeTarget): LinearProgram["upperBounds"][number] | undefined => {
    const coefficients = new Map<number, number>();
    for (const edge of usable) {
      if (edge.target === target.storageId) {
        coefficients.set(flowVar.get(edge.id)!, -1 / Math.max(1, target.amountPerSecond));
      }
    }
    if (coefficients.size === 0) {
      return undefined;
    }
    return { coefficients, rhs: -target.amountPerSecond / Math.max(1, target.amountPerSecond) };
  };

  const activeTargets = targets.filter((t) => t.amountPerSecond > 0);
  // A target with no wire into its drawer at all is unreachable outright.
  const unreachableStorageIds = new Set<string>();
  const rowsByTarget = new Map<string, LinearProgram["upperBounds"][number]>();
  for (const target of activeTargets) {
    const row = targetRow(target);
    if (row) {
      rowsByTarget.set(target.storageId, row);
    } else {
      unreachableStorageIds.add(target.storageId);
    }
  }

  const emptyResult = (status: SolveModeResult["status"]): SolveModeResult => ({
    status,
    scaleByNode: new Map(),
    edgeFlowPerSecond: new Map(),
    unreachableStorageIds,
  });

  // MINIMIZE MACHINERY: the machine-count objective, with the synthesized
  // helper nodes (whose "count" is headroom) nearly free.
  const machineWeights = new Map<number, number>();
  for (const id of machineIds) {
    const weight = weightlessNodeIds?.has(id) ? 1e-6 : Math.max(1, countByNode.get(id) ?? 1);
    machineWeights.set(actVar.get(id)!, -weight);
  }

  const solveStages = (targetRows: Iterable<LinearProgram["upperBounds"][number]>): LpSolution | undefined => {
    const bounds = [...upperBounds, ...targetRows];
    let solution: LpSolution | undefined;
    // Each stage's optimum is locked (with proportional slack for solver
    // dust) before the next runs - same pattern as equations-core.
    const runStage = (stage: Map<number, number>): boolean => {
      if (stage.size === 0) {
        return true;
      }
      const maximize = new Array<number>(totalVars).fill(0);
      for (const [v, weight] of stage) {
        maximize[v] = weight;
      }
      const solved = solve({ maximize, equalities, upperBounds: bounds });
      if (solved.status !== "optimal") {
        // Later tie-break stages must never destroy an achieved answer.
        return solution === undefined;
      }
      solution = solved;
      const lock = new Map<number, number>();
      for (const [v, weight] of stage) {
        lock.set(v, -weight);
      }
      const value = Math.min(solved.objective, 0);
      const slack = Math.max(1e-9, Math.abs(value) * 1e-9);
      bounds.push({ coefficients: lock, rhs: -value + slack });
      return true;
    };

    if (!runStage(machineWeights)) {
      return undefined;
    }
    // Recycle before importing: spend a source drawer only after every real
    // wire, so a loop that can feed itself does.
    const leastImports = new Map<number, number>();
    for (const edge of usable) {
      if (storageKind(edge.source) === "source") {
        const port = inPort(edge);
        leastImports.set(flowVar.get(edge.id)!, -(1 / Math.max(1, port?.ratePerSecond ?? 1)));
      }
    }
    runStage(leastImports);
    // Ship before banking, then canonicalize on least total flow.
    const leastFill = new Map<number, number>();
    for (const fill of bufferFillVar.values()) {
      leastFill.set(fill, -1);
    }
    runStage(leastFill);
    const leastFlow = new Map<number, number>();
    for (const edge of usable) {
      leastFlow.set(flowVar.get(edge.id)!, -(1 / 1000));
    }
    runStage(leastFlow);
    return solution;
  };

  let solution = solveStages(rowsByTarget.values());

  if (!solution) {
    // Pins first: they live in the equalities, so if they cannot run
    // together no amount of target-dropping rescues the solve.
    if (pins.length > 0) {
      const probe = new Array<number>(totalVars).fill(0);
      for (const [v, weight] of machineWeights) {
        probe[v] = weight;
      }
      const pinsAlone = solve({ maximize: probe, equalities, upperBounds });
      if (pinsAlone.status !== "optimal") {
        return { ...emptyResult("failed"), pinsInfeasible: true };
      }
    }
    // Some target cannot be reached at any scale. Feasibility is per-target
    // separable here (see the header note), so probe each alone to name the
    // strays, then answer for the reachable rest.
    for (const [storageId, row] of rowsByTarget) {
      const probe = new Array<number>(totalVars).fill(0);
      for (const [v, weight] of machineWeights) {
        probe[v] = weight;
      }
      const solved = solve({ maximize: probe, equalities, upperBounds: [...upperBounds, row] });
      if (solved.status !== "optimal") {
        unreachableStorageIds.add(storageId);
      }
    }
    const reachableRows = [...rowsByTarget]
      .filter(([storageId]) => !unreachableStorageIds.has(storageId))
      .map(([, row]) => row);
    solution = solveStages(reachableRows);
    if (!solution) {
      return emptyResult("failed");
    }
  }

  const x = solution.x;
  const scaleByNode = new Map<string, number>();
  for (const id of machineIds) {
    scaleByNode.set(id, Math.max(0, x[actVar.get(id)!] ?? 0));
  }
  const edgeFlowPerSecond = new Map<string, number>();
  for (const edge of usable) {
    edgeFlowPerSecond.set(edge.id, Math.max(0, x[flowVar.get(edge.id)!] ?? 0));
  }
  return { status: "optimal", scaleByNode, edgeFlowPerSecond, unreachableStorageIds };
}
