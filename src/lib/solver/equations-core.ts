import type { FactoryProject, NodeThroughputResult, ResourceKey } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model/resources";
import { getStorageRoles } from "@/lib/model/storage-role";
import { collectTrashNodeIds } from "@/lib/model/trash";
import { getCompatibleOutputFlow, getEdgeTargetDemandKey } from "./equilibrium";
import { type LinearProgram, type LpSolution } from "./simplex";
import { solveLpAuto } from "./lp-engine";
import { listSharedMachineGroups } from "@/lib/model/shared-machine";
import { isPoolEdgeId } from "./pool-mode";
import { storageRatioEqualities } from "./storage-ratios";

/**
 * The board's steady state as equations, solved directly: the BOOKS half of
 * the solver, per docs/solver-equations.md. Conservation is a row, the clog
 * is an equals sign (an output wired only to machines may not make more than
 * its wires carry), and the answer is picked by a lexicographic chain of
 * solves - so there are no rounds, no transients and nothing to latch. The
 * iterative engine in equilibrium.ts keeps the DIAGNOSIS: capability, the
 * "one wire fixes it" stories, the clog names.
 *
 * Stages, each optimum locked before the next runs (Jack's ruling,
 * 2026-08-19: solve for the maximum - a fed machine with somewhere to put
 * its output runs, exactly as in game):
 *   1. Everything runs: maximize total act. A byproduct drawer is permission
 *      to run, a plain buffer voids its overflow like a real drawer, and
 *      nothing idles that conservation would let move.
 *   2. Fairness: progressive max-min over acts within the locked total - the
 *      LP form of the game's round-robin split, so contended supply shares
 *      evenly-with-saturation instead of handing one consumer everything.
 *   3. Recycle before importing: minimize source-drawer outflow.
 *   4. Ship before banking: minimize pool fill, so a buffer passes stock on
 *      to whatever downstream will take and holds only what nothing wants.
 *   5. Canonicalize: minimize total flow, one deterministic point.
 *
 * There is deliberately NO "purpose" stage preferring product drawers: it
 * starved real machines to fatten an export drawer, and the game has no such
 * preference - pipes round-robin. Targets are display arithmetic, not rows.
 *
 * Validated against the tick simulator (src/lib/solver-lab/simulate.ts -
 * exact agreement on real player boards at the doctrine prime) and the full
 * community corpus.
 */

export interface EquationsCoreResult {
  status: "optimal" | "infeasible" | "unbounded";
  /** Actual run level per machine node, in [0, 1] of nameplate. */
  utilization: Map<string, number>;
  /** Resource per second on each modeled wire. */
  edgeFlowPerSecond: Map<string, number>;
  /**
   * Vent-mode only: surplus per machine OUTPUT port that had to leave the
   * board for the answer above to hold, node id -> resource key -> per
   * second. A nonzero vent names a wire that needs a drawer or a trash can.
   */
  ventPerSecond?: Map<string, Map<ResourceKey, number>>;
}

export interface EquationsCoreOptions {
  /**
   * The clog-lock diagnostic: every wired machine output port may shed
   * surplus through a penalized vent, so "what would run if the spare could
   * leave" is solved instead of the books. Bare ports still pin their
   * machine (an unwired slot is the unwired story, not a clog), and the
   * equal-fill rows are off (in a vented world no intake chest ever fills).
   * The books NEVER use this - it exists for the detector that explains
   * boards the clog equality has dragged to zero.
   */
  ventOutputs?: boolean;
  /**
   * Restrict vents to these ports, as "nodeId|resourceKey" strings. The
   * detector's necessity probes use this to ask "does the board still run
   * without a drawer HERE" - which is what separates the lock's true causes
   * from surpluses that only appear at full throttle.
   */
  ventPorts?: ReadonlySet<string>;
  /**
   * Machines that must run at least a hair above zero for the solve to
   * count as feasible - the frozen set a necessity probe insists stays
   * revived while a candidate vent is withheld.
   */
  requireRunning?: readonly string[];
}

interface PortRef {
  key: ResourceKey;
  ratePerSecond: number;
}

export interface EquationsDiagnosis {
  /** Disposal bound from the iterative engine: < 1 marks a consumer whose
   * own outputs throttle it, exempting it from equal-fill (its intake chest
   * fills and the port legitimately serves the others). Supply-side figures
   * must NOT be used here - a starving consumer is exactly who the rule
   * protects. */
  disposalByNode?: Map<string, number>;
}

export function solveEquationsCore(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  // solveLpAuto is the engine switchboard: HiGHS where initLpEngine has run
  // (the solve worker), the homegrown simplex everywhere else.
  solve: (lp: LinearProgram) => LpSolution = solveLpAuto,
  diagnosis?: EquationsDiagnosis,
  options?: EquationsCoreOptions,
): EquationsCoreResult {
  const venting = options?.ventOutputs === true;
  const roles = getStorageRoles(project);
  const trashIds = collectTrashNodeIds(project);
  const storagesById = new Map((project.storages ?? []).map((s) => [s.id, s]));

  const machineIds: string[] = [];
  for (const node of project.nodes) {
    // A trash node is a sink, never a machine: its void recipe has no input
    // port for a wire to land on, so treating it as a machine drops the wire.
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

  const outPort = (edge: (typeof edges)[number]): PortRef | undefined => {
    if (!actVar.has(edge.source)) {
      return undefined;
    }
    const flow = getCompatibleOutputFlow(nodes[edge.source], edge);
    return flow
      ? { key: makeResourceKey(flow.kind, flow.resourceId), ratePerSecond: flow.amountPerSecond }
      : undefined;
  };
  const inPort = (edge: (typeof edges)[number]): PortRef | undefined => {
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
    // A source draining straight into a sink is a boundary pass-through: no
    // machine touches it, no row would hold it, and it means nothing.
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
  let nextVar = machineIds.length + usable.length;
  for (const storage of project.storages ?? []) {
    if (storageKind(storage.id) === "buffer") {
      bufferFillVar.set(storage.id, nextVar);
      nextVar += 1;
    }
  }
  // One extra variable for the fairness stage's "worst-off level" t; it sits
  // idle (free at zero) in every other stage. Vent mode allocates one more
  // variable per wired output port below, before anything solves.
  const tVar = nextVar;
  let totalVars = nextVar + 1;
  const vents: Array<{ nodeId: string; key: ResourceKey; varIndex: number; scale: number }> = [];

  const equalities: LinearProgram["equalities"] = storageRatioEqualities(project, flowVar);
  const upperBounds: LinearProgram["upperBounds"] = [];

  for (const id of machineIds) {
    // A power-stalled build sits at zero; pinning the act (rather than
    // dropping the node) lets conservation carry the outage to its
    // neighbours - the feeder clogs, the eater starves, as in game.
    upperBounds.push({
      coefficients: new Map([[actVar.get(id)!, 1]]),
      rhs: nodes[id]!.powerStalled ? 0 : 1,
    });
  }
  // SHARED MACHINES: the sections of one card time-share its machine. Each
  // section's act is its share of the machine's time (its nameplate already
  // carries the whole count), so the shares sum to at most one. That is the
  // only thing the game couples between recipes on one machine.
  for (const group of listSharedMachineGroups(machineIds).values()) {
    const coefficients = new Map<number, number>();
    for (const id of group) {
      const act = actVar.get(id);
      if (act !== undefined) {
        coefficients.set(act, 1);
      }
    }
    if (coefficients.size > 1) {
      upperBounds.push({ coefficients, rhs: 1 });
    }
  }
  // Necessity probes: these machines must run at least a hair, or the solve
  // reports infeasible - which is the probe's whole answer.
  for (const id of options?.requireRunning ?? []) {
    const act = actVar.get(id);
    if (act !== undefined) {
      upperBounds.push({ coefficients: new Map([[act, -1]]), rhs: -5e-4 });
    }
  }

  // Target dials are NOT rows. Under maximize-everything a floor below the
  // ceiling never binds and a floor above it would poison the whole solve
  // infeasible; the dial stays display arithmetic (the over-asked >100%
  // story) in the finalize layer, exactly where it lives today.

  // Drawer-to-drawer wires get a finite roof so a teleporter chain cannot
  // read as unbounded; machine wires are bounded by their port rows. Pool
  // wires are exempt, as in solve-mode.ts: each is bounded by the machine
  // rows on the pool's other side, and the roof capped pool imports.
  for (const edge of usable) {
    if (!actVar.has(edge.source) && !actVar.has(edge.target) && !isPoolEdgeId(edge.id)) {
      upperBounds.push({ coefficients: new Map([[flowVar.get(edge.id)!, 1]]), rhs: 1e6 });
    }
  }

  // Machine port rows: flows on a port balance act x rate exactly. A port
  // with no wires forces act to zero - the closed-plan rule as algebra.
  // Along the way, remember which machines a bare port pins to zero and who
  // shares each output port, for the equal-fill rows below.
  const pinnedZero = new Set<string>();
  type PortConsumer = { consumerId: string; pullRate: number; flowVars: number[] };
  const portConsumers: PortConsumer[][] = [];
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
    const consumersByPort = new Map<ResourceKey, Map<string, PortConsumer>>();
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
          if (actVar.has(edge.target)) {
            const pull = inPort(edge);
            if (pull && pull.ratePerSecond > 0) {
              let consumers = consumersByPort.get(port.key);
              if (!consumers) {
                consumers = new Map();
                consumersByPort.set(port.key, consumers);
              }
              let entry = consumers.get(edge.target);
              if (!entry) {
                entry = { consumerId: edge.target, pullRate: pull.ratePerSecond, flowVars: [] };
                consumers.set(edge.target, entry);
              }
              entry.flowVars.push(flowVar.get(edge.id)!);
            }
          }
        }
      }
    }
    for (const rows of [inputRows, outputRows]) {
      for (const [key, port] of rows) {
        // POWER is the one output the closed-plan rule waives: EU that goes
        // nowhere just dissipates (in game an unwired generator still runs
        // and the energy is simply not banked), so a bare EU port neither
        // pins its generator nor needs a row. Wired, it is an ordinary
        // port: the row below is what gives the wire its flow.
        if (rows === outputRows && port.vars.length === 0 && key.startsWith("power:")) {
          continue;
        }
        if (port.vars.length === 0) {
          pinnedZero.add(id);
        }
        const scale = 1 / Math.max(1, port.rate);
        const coefficients = new Map<number, number>();
        for (const v of port.vars) {
          coefficients.set(v, scale);
        }
        coefficients.set(actVar.get(id)!, -port.rate * scale);
        // Vent mode: a WIRED output port may shed surplus through its vent.
        // A bare port gets none - an unwired slot still pins its machine,
        // because that is the unwired story, not a clog.
        if (
          venting &&
          rows === outputRows &&
          port.vars.length > 0 &&
          (options?.ventPorts === undefined || options.ventPorts.has(`${id}|${key}`))
        ) {
          const varIndex = totalVars;
          totalVars += 1;
          vents.push({ nodeId: id, key, varIndex, scale });
          coefficients.set(varIndex, scale);
        }
        equalities.push({ coefficients, rhs: 0 });
      }
    }
    for (const consumers of consumersByPort.values()) {
      if (consumers.size >= 2) {
        portConsumers.push([...consumers.values()]);
      }
    }
  }

  // EQUAL-FILL: machine co-consumers of one output port fill at the same
  // per-pull rate - in game the port round-robins its items and a hopper
  // cannot be refused. As a row: a sibling's share of its pull never exceeds
  // a clean co-consumer's act (a saturated co-consumer has act 1, escaping
  // the bound; one the diagnosis knows is throttled by its own outputs, a
  // bare port or a power stall is exempt - its intake chest fills and the
  // port legitimately serves the others). This is what makes a tapped
  // break-even ring DIE instead of pretending its tap never pulls. Off in
  // vent mode: in a vented world no intake chest ever fills, so round-robin
  // never locks anyone.
  if (!venting) {
    const clean = (consumerId: string): boolean =>
      !pinnedZero.has(consumerId) &&
      !nodes[consumerId]!.powerStalled &&
      (diagnosis?.disposalByNode?.get(consumerId) ?? 1) >= 0.999;
    for (const consumers of portConsumers) {
      for (const other of consumers) {
        if (!clean(other.consumerId)) {
          continue;
        }
        for (const sibling of consumers) {
          if (sibling.consumerId === other.consumerId) {
            continue;
          }
          const coefficients = new Map<number, number>();
          for (const v of sibling.flowVars) {
            coefficients.set(v, 1 / sibling.pullRate);
          }
          coefficients.set(actVar.get(other.consumerId)!, -1);
          upperBounds.push({ coefficients, rhs: 0 });
        }
      }
    }
  }

  // Buffer pools: inflow equals outflow plus fill; a strict buffer's fill is
  // pinned at zero, which is its whole meaning.
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

  // Defense: a flow variable in no row would be free to grow without bound;
  // clamp it to zero rather than let a shape the model missed explode.
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

  // The stage chain: each optimum locked as a row before the next runs, so
  // later stages only break the earlier ones' ties.
  let solution: LpSolution | undefined;
  const debugStages = typeof process !== "undefined" && !!process.env?.EQ_CORE_DEBUG;
  const solveStage = (label: string, stage: Map<number, number>): LpSolution | undefined => {
    if (stage.size === 0) {
      return undefined;
    }
    const maximize = new Array<number>(totalVars).fill(0);
    for (const [v, weight] of stage) {
      maximize[v] = weight;
    }
    const t0 = debugStages ? Date.now() : 0;
    const solved = solve({ maximize, equalities, upperBounds });
    if (debugStages) {
      const acts =
        machineIds.length <= 16
          ? machineIds.map((id) => `${id}=${(solved.x[actVar.get(id)!] ?? 0).toFixed(4)}`).join(" ")
          : `${machineIds.length} machines`;
      console.log(
        `stage ${label}: ${solved.status} obj=${solved.objective} rows=${equalities.length}+${upperBounds.length} ${Date.now() - t0}ms ${acts}`,
      );
    }
    return solved;
  };
  // Locks and fairness floors carry solver dust proportional to board scale:
  // a stage objective that is provably signed gets clamped before locking
  // (the "g" board's least-fill once read +4e-6 where the truth is <= 0, and
  // the lock built from that dust demanded a negative fill sum - infeasible
  // by construction). When a later stage still reports non-optimal, every
  // lock and floor is re-cut with wider slack and the stage retried; small
  // boards never need it, so the exact pins stay exact.
  type LockRow = { index: number; value: number; kind: "lock" | "floor" };
  const lockRows: LockRow[] = [];
  let lockEps = 1e-9;
  const lockRhs = (row: LockRow): number => {
    const slack = Math.max(lockEps, Math.abs(row.value) * lockEps);
    return row.kind === "lock" ? -row.value + slack : -Math.max(0, row.value - slack);
  };
  const recutLocks = () => {
    for (const row of lockRows) {
      upperBounds[row.index]!.rhs = lockRhs(row);
    }
  };
  const solveWithEscalation = (
    label: string,
    stage: Map<number, number>,
  ): LpSolution | undefined => {
    let solved = solveStage(label, stage);
    while (solved && solved.status !== "optimal" && lockEps < 1e-4 && lockRows.length > 0) {
      lockEps *= 1000;
      recutLocks();
      solved = solveStage(`${label}~${lockEps}`, stage);
    }
    return solved;
  };
  const runLockedStage = (label: string, stage: Map<number, number>): boolean => {
    const solved = solveWithEscalation(label, stage);
    if (!solved) {
      return true;
    }
    solution = solved;
    if (solved.status !== "optimal") {
      return false;
    }
    const lock = new Map<number, number>();
    let allNonPositive = true;
    let allNonNegative = true;
    for (const [v, weight] of stage) {
      lock.set(v, -weight);
      allNonPositive = allNonPositive && weight <= 0;
      allNonNegative = allNonNegative && weight >= 0;
    }
    let value = solved.objective;
    if (allNonPositive) {
      value = Math.min(value, 0);
    } else if (allNonNegative) {
      value = Math.max(value, 0);
    }
    const row: LockRow = { index: upperBounds.length, value, kind: "lock" };
    lockRows.push(row);
    upperBounds.push({ coefficients: lock, rhs: lockRhs(row) });
    return true;
  };
  const failed = (): EquationsCoreResult => {
    if (debugStages) {
      console.log(`core FAILED: ${solution?.status}`);
    }
    return failedResult();
  };
  const failedResult = (): EquationsCoreResult => ({
    status: solution?.status === "unbounded" ? "unbounded" : "infeasible",
    utilization: new Map(),
    edgeFlowPerSecond: new Map(),
  });

  // GAME TRUTH: everything runs as hard as conservation allows. A fed
  // machine with somewhere to put its output runs in game - a byproduct
  // drawer is permission, not motivation to idle. (Jack's ruling,
  // 2026-08-19: solve for the maximum.)
  const everythingRuns = new Map<number, number>();
  for (const id of machineIds) {
    everythingRuns.set(actVar.get(id)!, 1);
  }
  if (!runLockedStage("everything-runs", everythingRuns)) {
    return failed();
  }

  // FAIRNESS: within the locked totals, lift the worst-off machine as high
  // as it goes, floor the bottleneck there, repeat - the LP form of the
  // game's round-robin item split. Without it the simplex picks a lopsided
  // corner (one consumer full, its twin starved) no hopper line produces.
  // Best-effort: a round that fails to solve or to shrink the pool stops it.
  // Skipped in vent mode: the diagnostic wants the vents, not a fair split.
  if (!venting) {
    const pool = new Set(machineIds);
    for (let round = 0; pool.size > 0 && round < machineIds.length; round += 1) {
      const mark = upperBounds.length;
      for (const id of pool) {
        upperBounds.push({
          coefficients: new Map([
            [tVar, 1],
            [actVar.get(id)!, -1],
          ]),
          rhs: 0,
        });
      }
      const solved = solveWithEscalation(`fair-${round}`, new Map([[tVar, 1]]));
      upperBounds.length = mark;
      if (!solved || solved.status !== "optimal") {
        break;
      }
      solution = solved;
      const t = Math.max(0, solved.x[tVar] ?? 0);
      // Only the machines LEAVING the pool get a floor row: members staying
      // get a higher one on the round they leave, and the temp t-rows hold
      // everyone up meanwhile. Flooring the whole pool every round once grew
      // the model quadratically (a 51-machine board reached a thousand rows
      // and 34 seconds); this keeps it linear.
      const floorAt = (id: string) => {
        const row: LockRow = { index: upperBounds.length, value: t, kind: "floor" };
        lockRows.push(row);
        upperBounds.push({
          coefficients: new Map([[actVar.get(id)!, -1]]),
          rhs: lockRhs(row),
        });
      };
      let shrank = false;
      const atLevel = [...pool].filter((id) => (solved.x[actVar.get(id)!] ?? 0) <= t + 1e-6);
      // A ZERO round is special. A machine that cannot run at all (a bare
      // slot, no power, a dead feeder) pins the worst-off level at zero, and
      // at zero the simplex is free to park OTHER machines at zero too - a
      // shared machine's second recipe, one twin of a pair - even though
      // they could be lifted. Flooring everything at zero then locked those
      // in, and an Electrolyzer running two recipes read 100/0 with a
      // phantom clog lock instead of 50/50. So at zero, only the machines
      // that truly cannot rise leave the pool: the structurally pinned ones
      // outright, and the rest after one solve each asking how high that
      // machine alone can go under the locks so far.
      if (t <= 1e-6) {
        for (const id of atLevel) {
          const stuck =
            pinnedZero.has(id) ||
            nodes[id]?.powerStalled === true ||
            (() => {
              const lifted = solveWithEscalation(`lift-${round}`, new Map([[actVar.get(id)!, 1]]));
              return !lifted || lifted.status !== "optimal" || (lifted.x[actVar.get(id)!] ?? 0) <= 1e-6;
            })();
          if (stuck) {
            floorAt(id);
            pool.delete(id);
            shrank = true;
          }
        }
      } else {
        for (const id of atLevel) {
          floorAt(id);
          pool.delete(id);
          shrank = true;
        }
      }
      if (!shrank) {
        for (const id of pool) {
          floorAt(id);
        }
        break;
      }
    }
  }

  // Vent mode: after everything that CAN run is locked in, shed as little as
  // possible. What survives this minimization is the honest answer to "which
  // wires must a drawer rescue" - every remaining vent is necessary.
  if (venting) {
    const leastVents = new Map<number, number>();
    for (const vent of vents) {
      leastVents.set(vent.varIndex, -vent.scale);
    }
    if (!runLockedStage("least-vents", leastVents)) {
      return failed();
    }
  }

  const leastImports = new Map<number, number>();
  for (const edge of usable) {
    if (storageKind(edge.source) === "source") {
      const port = inPort(edge);
      leastImports.set(flowVar.get(edge.id)!, -(1 / Math.max(1, port?.ratePerSecond ?? 1)));
    }
  }
  if (!runLockedStage("least-imports", leastImports)) {
    return failed();
  }

  // Ship before banking: a pool passes stock on to whatever downstream will
  // take it - in game the pipe out of a chest moves stock as long as there
  // is somewhere for it to go - and holds only what nothing wants.
  const leastFill = new Map<number, number>();
  for (const fill of bufferFillVar.values()) {
    leastFill.set(fill, -1);
  }
  if (!runLockedStage("least-fill", leastFill)) {
    return failed();
  }

  const leastFlow = new Map<number, number>();
  for (const edge of usable) {
    leastFlow.set(flowVar.get(edge.id)!, -(1 / 1000));
  }
  if (!runLockedStage("least-flow", leastFlow)) {
    return failed();
  }

  const x = solution?.x ?? [];
  const utilization = new Map<string, number>();
  for (const id of machineIds) {
    utilization.set(id, Math.min(1, Math.max(0, x[actVar.get(id)!] ?? 0)));
  }
  const edgeFlowPerSecond = new Map<string, number>();
  for (const edge of usable) {
    edgeFlowPerSecond.set(edge.id, Math.max(0, x[flowVar.get(edge.id)!] ?? 0));
  }
  if (!venting) {
    return { status: "optimal", utilization, edgeFlowPerSecond };
  }
  const ventPerSecond = new Map<string, Map<ResourceKey, number>>();
  for (const vent of vents) {
    const perSecond = x[vent.varIndex] ?? 0;
    if (perSecond <= 1e-6) {
      continue;
    }
    let byKey = ventPerSecond.get(vent.nodeId);
    if (!byKey) {
      byKey = new Map();
      ventPerSecond.set(vent.nodeId, byKey);
    }
    byKey.set(vent.key, (byKey.get(vent.key) ?? 0) + perSecond);
  }
  return { status: "optimal", utilization, edgeFlowPerSecond, ventPerSecond };
}
