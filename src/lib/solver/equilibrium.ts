import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import {
  getFilledCellFluidEquivalent,
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "../model/resources";
import type {
  FactoryProject,
  FactoryStorage,
  NodeThroughputResult,
  ResourceAmount,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "../model/types";

const EPSILON = 0.000001;

/**
 * Equilibrium solver for the wired factory graph.
 *
 * The old iteration seeded every node from a demand-only guess and let asks
 * chase each other around the graph. That system has many self-consistent
 * answers: "F asks for no apples because it has no bananas, B makes no
 * bananas because F is not asking" is as stable as the fully running plan,
 * and real boards kept landing on the starved one (community gridlock
 * report, 2026-08-02: 26.67/s of toluene in the tank, consumers granted
 * 1.8/s of it, everything downstream at 0.5%).
 *
 * This solver removes the low answers instead of damping toward them, the
 * same way Helmod's matrix solver (MIT, github.com/Helfima/helmod) treats a
 * production block: solve the coupled system simultaneously rather than
 * propagate asks sequentially. Our unknowns differ - machine counts are
 * fixed here, so we solve for per-node utilizations - which turns the
 * problem into a monotone fixed point:
 *
 * - every node starts at FULL BLAST (capability 1, demand 1); the board is
 *   born jump-started, so a feedback loop that can sustain itself never
 *   needs a phantom source to prove it;
 * - each Jacobi round recomputes offers, honest asks, and allocations from
 *   the previous round's vectors only (no mid-pass reads, so wiring order
 *   cannot change the answer), and utilizations descend until the real
 *   constraints - machine counts, genuinely scarce inputs - stop them;
 * - lossy loops decay geometrically, so a per-component geometric
 *   extrapolation jumps them straight to their limit instead of grinding
 *   thousands of passes.
 *
 * Scarce supply is split by water-filling (progressive filling): every
 * hungry line gets an equal share, lines that need less than their share
 * are capped at their ask, and the slack is re-offered to the still-hungry.
 * A 2000/s fleet next to a 400/s fleet on a 26/s tank therefore cannot
 * crush the small asker out of the trickle it needs.
 */

export interface EdgeAllocationResult {
  role: "machine" | "storage-source" | "storage-sink";
  resourceKey: ResourceKey;
  targetDemandKey: ResourceKey;
  needKey: string;
  /** Nameplate output rate of the feeding machine (Infinity for storages). */
  sourceCapacityPerSecond: number;
  /** What the line could carry if the consumer wanted it (capability fill). */
  availablePerSecond: number;
  /** What the line actually carries (desire fill / sink absorption). */
  transferredPerSecond: number;
  /** Carried plus this line's share of the consumer's unmet desire. */
  demandPerSecond: number;
}

export interface EquilibriumSolution {
  capableByNode: Map<string, number>;
  /** Demand-side pressure, unclamped: >1 means "wants more than the fleet". */
  demandByNode: Map<string, number>;
  edgeAllocations: Map<string, EdgeAllocationResult>;
  eatenByNeed: Map<string, number>;
  unmetDesireByNeed: Map<string, number>;
  needEdgeCounts: Map<string, number>;
  rounds: number;
}

interface PreparedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  role: "machine" | "storage-source" | "storage-sink";
  resourceKey: ResourceKey;
  targetDemandKey: ResourceKey;
  /** `${target}|${targetDemandKey}` for machine targets, "" for sinks. */
  needKey: string;
  /** `${source}|${outputKey}` for machine sources, "" for storage sources. */
  budgetKey: string;
  /** Storage pool (resource key of the tank) for storage roles, else "". */
  poolKey: string;
  sourceCapacityPerSecond: number;
}

interface Budget {
  ownerId: string;
  outputKey: ResourceKey;
  makePerSecond: number;
  sinkEdges: PreparedEdge[];
  /** Every edge drawing on this budget (machine consumers and tank sinks). */
  edges: PreparedEdge[];
}

interface Need {
  targetId: string;
  demandKey: ResourceKey;
  nameplatePerSecond: number;
  machineEdges: PreparedEdge[];
  storageEdges: PreparedEdge[];
  edgeCount: number;
}

interface Pool {
  sinkEdges: PreparedEdge[];
  sourceEdges: PreparedEdge[];
}

interface MachineNodeInfo {
  id: string;
  /** Consumed inputs that have at least one incoming wire. */
  wiredInputs: Array<{ needKey: string; nameplatePerSecond: number }>;
  hasOutputs: boolean;
  hasOutgoingWires: boolean;
  budgets: Budget[];
  targetFloors: Array<{ key: ResourceKey; amountPerSecond: number }>;
}

const ROUND_CAP = 512;
const CONVERGENCE_EPS = 1e-9;
const ZERO_SNAP = 1e-7;
const MACHINE_FILL_ROUNDS = 32;
const STORAGE_FILL_ROUNDS = 8;

export function solveEquilibrium(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  storagesById: Map<string, FactoryStorage>,
): EquilibriumSolution {
  // ---- Preparation: resolve every edge once. --------------------------------
  const edges: PreparedEdge[] = [];
  const budgets = new Map<string, Budget>();
  const needs = new Map<string, Need>();
  const pools = new Map<string, Pool>();

  for (const edge of project.edges) {
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);
    if (sourceStorage && targetStorage) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const sourceResult = sourceStorage ? undefined : nodes[edge.source];
    const sourceOutputFlow = getCompatibleOutputFlow(sourceResult, edge);
    const role: PreparedEdge["role"] = targetStorage
      ? "storage-sink"
      : sourceStorage
        ? "storage-source"
        : "machine";
    const poolKey = targetStorage
      ? makeResourceKey(targetStorage.kind, targetStorage.resourceId)
      : sourceStorage
        ? makeResourceKey(sourceStorage.kind, sourceStorage.resourceId)
        : "";
    const prepared: PreparedEdge = {
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      role,
      resourceKey: key,
      targetDemandKey,
      needKey: targetStorage ? "" : `${edge.target}|${targetDemandKey}`,
      budgetKey: sourceStorage ? "" : `${edge.source}|${sourceOutputFlow?.key ?? key}`,
      poolKey,
      sourceCapacityPerSecond:
        sourceStorage || !sourceResult
          ? Number.POSITIVE_INFINITY
          : (sourceOutputFlow?.amountPerSecond ?? 0),
    };
    edges.push(prepared);

    if (prepared.budgetKey && sourceResult) {
      const existing = budgets.get(prepared.budgetKey);
      const budget = existing ?? {
        ownerId: edge.source,
        outputKey: sourceOutputFlow?.key ?? key,
        makePerSecond: sourceOutputFlow?.amountPerSecond ?? 0,
        sinkEdges: [],
        edges: [],
      };
      if (!existing) {
        budgets.set(prepared.budgetKey, budget);
      }
      budget.edges.push(prepared);
      if (role === "storage-sink") {
        budget.sinkEdges.push(prepared);
      }
    }

    if (prepared.needKey) {
      const targetResult = nodes[edge.target];
      const existing = needs.get(prepared.needKey);
      const need = existing ?? {
        targetId: edge.target,
        demandKey: targetDemandKey,
        nameplatePerSecond: targetResult?.inputs[targetDemandKey]?.amountPerSecond ?? 0,
        machineEdges: [],
        storageEdges: [],
        edgeCount: 0,
      };
      if (!existing) {
        needs.set(prepared.needKey, need);
      }
      need.edgeCount += 1;
      if (role === "storage-source") {
        need.storageEdges.push(prepared);
      } else {
        need.machineEdges.push(prepared);
      }
    }

    if (poolKey) {
      const existing = pools.get(poolKey);
      const pool = existing ?? { sinkEdges: [], sourceEdges: [] };
      if (!existing) {
        pools.set(poolKey, pool);
      }
      if (role === "storage-sink") {
        pool.sinkEdges.push(prepared);
      } else {
        pool.sourceEdges.push(prepared);
      }
    }
  }

  const machineNodes: MachineNodeInfo[] = [];
  const infoById = new Map<string, MachineNodeInfo>();
  const budgetsByOwner = new Map<string, Budget[]>();
  for (const budget of budgets.values()) {
    budgetsByOwner.set(budget.ownerId, [
      ...(budgetsByOwner.get(budget.ownerId) ?? []),
      budget,
    ]);
  }
  const targetShares = calculateProjectTargetShares(project, nodes);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    if (!nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
      continue;
    }

    const wiredInputs: MachineNodeInfo["wiredInputs"] = [];
    for (const [inputKey, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond <= EPSILON) {
        continue;
      }
      const needKey = `${node.id}|${inputKey}`;
      if (needs.has(needKey)) {
        wiredInputs.push({ needKey, nameplatePerSecond: flow.amountPerSecond });
      }
    }

    const targetFloors: MachineNodeInfo["targetFloors"] = [];
    if (node.targetOutput) {
      targetFloors.push({
        key: makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId),
        amountPerSecond: node.targetOutput.amountPerSecond,
      });
    }
    const projectShare = targetShares.get(node.id);
    if (projectShare) {
      targetFloors.push(projectShare);
    }

    const info: MachineNodeInfo = {
      id: node.id,
      wiredInputs,
      hasOutputs: Object.keys(nodeResult.outputs).length > 0,
      hasOutgoingWires: (budgetsByOwner.get(node.id) ?? []).length > 0,
      budgets: budgetsByOwner.get(node.id) ?? [],
      targetFloors,
    };
    machineNodes.push(info);
    infoById.set(node.id, info);
  }

  // ---- Iteration state: everything starts at full blast. -------------------
  const cap = new Map<string, number>();
  const dem = new Map<string, number>();
  for (const info of machineNodes) {
    cap.set(info.id, 1);
    dem.set(info.id, 1);
  }
  // A tank's sustainable outflow is last round's inflow; before the first
  // round assume every feeder ships nameplate (full blast, like the rest).
  let poolInflow = new Map<string, number>();
  for (const [poolKey, pool] of pools) {
    let inflow = 0;
    for (const sinkEdge of pool.sinkEdges) {
      inflow += budgets.get(sinkEdge.budgetKey)?.makePerSecond ?? 0;
    }
    poolInflow.set(poolKey, inflow);
  }

  interface RoundOutput {
    capNext: Map<string, number>;
    demNext: Map<string, number>;
    poolInflowNext: Map<string, number>;
    availableByEdge: Map<string, number>;
    eatenByEdge: Map<string, number>;
    demandByEdge: Map<string, number>;
    unmetDesireByNeed: Map<string, number>;
  }

  const runRound = (): RoundOutput => {
    const budgetOffer = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      budgetOffer.set(budgetKey, budget.makePerSecond * clampUtilization(cap.get(budget.ownerId) ?? 1));
    }
    const poolOffer = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      poolOffer.set(
        poolKey,
        pool.sinkEdges.length > 0 ? (poolInflow.get(poolKey) ?? 0) : Number.POSITIVE_INFINITY,
      );
    }

    // Potentials: what each input could draw if everything else wanted it -
    // sibling ceilings judge by capability, never by the current starved
    // state, or the gridlock lie re-enters through the side door.
    const potentialByNeed = new Map<string, number>();
    for (const [needKey, need] of needs) {
      let potential = 0;
      for (const edge of need.machineEdges) {
        potential += budgetOffer.get(edge.budgetKey) ?? 0;
      }
      for (const edge of need.storageEdges) {
        potential += poolOffer.get(edge.poolKey) ?? 0;
      }
      potentialByNeed.set(needKey, potential);
    }

    const sibCeil = (info: MachineNodeInfo, exceptNeedKey: string): number => {
      let ceil = 1;
      for (const input of info.wiredInputs) {
        if (input.needKey === exceptNeedKey) {
          continue;
        }
        const potential = potentialByNeed.get(input.needKey);
        if (potential === undefined || !Number.isFinite(potential)) {
          continue;
        }
        ceil = Math.min(ceil, clampUtilization(potential / input.nameplatePerSecond));
      }
      return ceil;
    };

    const askAvailability = new Map<string, number>();
    const askDesire = new Map<string, number>();
    for (const [needKey, need] of needs) {
      const info = infoById.get(need.targetId);
      if (!info || need.nameplatePerSecond <= EPSILON) {
        askAvailability.set(needKey, 0);
        askDesire.set(needKey, 0);
        continue;
      }
      const ceiling = sibCeil(info, needKey);
      askAvailability.set(needKey, need.nameplatePerSecond * ceiling);
      askDesire.set(
        needKey,
        need.nameplatePerSecond * Math.min(clampUtilization(dem.get(need.targetId) ?? 1), ceiling),
      );
    }

    const availabilityFill = runFill(needs, budgetOffer, poolOffer, askAvailability);
    const desireFill = runFill(needs, budgetOffer, poolOffer, askDesire);

    // Sinks absorb whatever production the desire fill left unclaimed, so a
    // buffered producer keeps running at capability. A tank running dry on
    // its consumers additionally passes the shortfall back as demand.
    const availableByEdge = availabilityFill.grants;
    const eatenByEdge = desireFill.grants;
    const demandByEdge = new Map<string, number>();
    const poolInflowNext = new Map<string, number>();
    const poolDeficit = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length === 0) {
        continue;
      }
      const requested = desireFill.poolRequested.get(poolKey) ?? 0;
      const offered = poolOffer.get(poolKey) ?? 0;
      poolDeficit.set(poolKey, Math.max(0, requested - offered));
    }

    for (const edge of edges) {
      if (edge.role === "storage-sink") {
        const budget = budgets.get(edge.budgetKey);
        const leftover = Math.max(0, desireFill.remainingBudget.get(edge.budgetKey) ?? 0);
        const sinkCount = budget?.sinkEdges.length ?? 1;
        const absorbed = leftover / Math.max(1, sinkCount);
        const pool = pools.get(edge.poolKey);
        const deficitShare =
          (poolDeficit.get(edge.poolKey) ?? 0) / Math.max(1, pool?.sinkEdges.length ?? 1);
        availableByEdge.set(edge.id, absorbed);
        eatenByEdge.set(edge.id, absorbed);
        demandByEdge.set(edge.id, absorbed + deficitShare);
        poolInflowNext.set(edge.poolKey, (poolInflowNext.get(edge.poolKey) ?? 0) + absorbed);
        continue;
      }

      const eaten = eatenByEdge.get(edge.id) ?? 0;
      const need = needs.get(edge.needKey);
      const unmet = Math.max(0, desireFill.remainingNeed.get(edge.needKey) ?? 0);
      demandByEdge.set(edge.id, eaten + unmet / Math.max(1, need?.edgeCount ?? 1));
    }
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length > 0 && !poolInflowNext.has(poolKey)) {
        poolInflowNext.set(poolKey, 0);
      }
    }

    // New capability: what could this node run at if wanted, given what its
    // wired inputs can actually deliver. New demand: what its consumers pull
    // (plus tank absorption), over its nameplate output.
    const capNext = new Map<string, number>();
    const demNext = new Map<string, number>();
    for (const info of machineNodes) {
      let capability = 1;
      for (const input of info.wiredInputs) {
        const need = needs.get(input.needKey);
        if (!need) {
          continue;
        }
        let supplied = 0;
        for (const edge of [...need.machineEdges, ...need.storageEdges]) {
          supplied += availableByEdge.get(edge.id) ?? 0;
        }
        capability = Math.min(capability, clampUtilization(supplied / input.nameplatePerSecond));
      }
      capNext.set(info.id, capability);

      if (!info.hasOutputs) {
        // Pure sink: nothing downstream can pace it; it always wants full
        // blast and only its input supply throttles it.
        demNext.set(info.id, 1);
        continue;
      }
      if (!info.hasOutgoingWires && info.targetFloors.length === 0) {
        demNext.set(info.id, 1);
        continue;
      }

      let pressure = 0;
      for (const budget of info.budgets) {
        let required = 0;
        for (const edge of budget.edges) {
          required += demandByEdge.get(edge.id) ?? 0;
        }
        for (const floor of info.targetFloors) {
          if (floor.key === budget.outputKey) {
            required = Math.max(required, floor.amountPerSecond);
          }
        }
        if (budget.makePerSecond > EPSILON) {
          pressure = Math.max(pressure, required / budget.makePerSecond);
        } else if (required > EPSILON) {
          pressure = Number.POSITIVE_INFINITY;
        }
      }
      const nodeResult = nodes[info.id];
      for (const floor of info.targetFloors) {
        if (info.budgets.some((budget) => budget.outputKey === floor.key)) {
          continue;
        }
        const flow = nodeResult ? getCompatibleOutputFlowForKey(nodeResult, floor.key) : undefined;
        if (flow && flow.amountPerSecond > EPSILON) {
          pressure = Math.max(pressure, floor.amountPerSecond / flow.amountPerSecond);
        }
      }
      demNext.set(info.id, pressure);
    }

    return {
      capNext,
      demNext,
      poolInflowNext,
      availableByEdge,
      eatenByEdge,
      demandByEdge,
      unmetDesireByNeed: desireFill.remainingNeed,
    };
  };

  // ---- Descend to the fixed point. ------------------------------------------
  let lastRound: RoundOutput | undefined;
  let rounds = 0;
  const prevDelta = new Map<string, number>();
  let roundsSinceJump = 0;

  for (let round = 0; round < ROUND_CAP; round += 1) {
    const output = runRound();
    rounds = round + 1;
    roundsSinceJump += 1;

    let maxDelta = 0;
    const currentDelta = new Map<string, number>();
    for (const info of machineNodes) {
      const capDelta = (cap.get(info.id) ?? 1) - (output.capNext.get(info.id) ?? 1);
      const demDelta =
        clampUtilization(dem.get(info.id) ?? 1) - clampUtilization(output.demNext.get(info.id) ?? 1);
      currentDelta.set(`c|${info.id}`, capDelta);
      currentDelta.set(`d|${info.id}`, demDelta);
      maxDelta = Math.max(maxDelta, Math.abs(capDelta), Math.abs(demDelta));
    }

    for (const info of machineNodes) {
      cap.set(info.id, output.capNext.get(info.id) ?? 1);
      dem.set(info.id, output.demNext.get(info.id) ?? 1);
    }
    poolInflow = output.poolInflowNext;
    lastRound = output;

    if (maxDelta < CONVERGENCE_EPS) {
      break;
    }

    // Late-phase safety valve for the rare oscillating board: average with
    // the previous vector so the hard cap cannot freeze a mid-swing state.
    if (round >= ROUND_CAP - 128) {
      for (const info of machineNodes) {
        const key = info.id;
        const capPrev = (output.capNext.get(key) ?? 1) + (currentDelta.get(`c|${key}`) ?? 0);
        const demPrev =
          clampUtilization(output.demNext.get(key) ?? 1) + (currentDelta.get(`d|${key}`) ?? 0);
        cap.set(key, ((output.capNext.get(key) ?? 1) + capPrev) / 2);
        if (Number.isFinite(output.demNext.get(key) ?? 1)) {
          dem.set(key, ((output.demNext.get(key) ?? 1) + demPrev) / 2);
        }
      }
    }

    // Geometric extrapolation: a lossy loop shrinks by a stable factor every
    // round; once two consecutive deltas agree on that factor, jump each
    // component the rest of the way (sum of the geometric series) instead of
    // decaying for thousands of rounds.
    if (round >= 8 && roundsSinceJump >= 4) {
      let jumped = false;
      for (const [key, delta] of currentDelta) {
        const previous = prevDelta.get(key) ?? 0;
        if (Math.abs(delta) <= 1e-12 || Math.abs(previous) <= 1e-12) {
          continue;
        }
        if (Math.sign(delta) !== Math.sign(previous)) {
          continue;
        }
        const ratio = delta / previous;
        if (ratio < 0.2 || ratio > 0.9995) {
          continue;
        }
        const isCap = key.startsWith("c|");
        const nodeId = key.slice(2);
        const vector = isCap ? cap : dem;
        const current = vector.get(nodeId);
        if (current === undefined || !Number.isFinite(current)) {
          continue;
        }
        const limit = clampUtilization(current - (delta * ratio) / (1 - ratio));
        vector.set(nodeId, limit < ZERO_SNAP ? 0 : limit);
        jumped = true;
      }
      if (jumped) {
        roundsSinceJump = 0;
      }
    }

    prevDelta.clear();
    for (const [key, delta] of currentDelta) {
      prevDelta.set(key, delta);
    }
  }

  // Snap converged dust to hard zero so an unfed loop reads 0%, not 1e-9%.
  for (const info of machineNodes) {
    if ((cap.get(info.id) ?? 1) < ZERO_SNAP) {
      cap.set(info.id, 0);
    }
    const demValue = dem.get(info.id) ?? 1;
    if (Number.isFinite(demValue) && demValue < ZERO_SNAP) {
      dem.set(info.id, 0);
    }
  }
  const settled = runRound();
  lastRound = settled;

  const edgeAllocations = new Map<string, EdgeAllocationResult>();
  for (const edge of edges) {
    edgeAllocations.set(edge.id, {
      role: edge.role,
      resourceKey: edge.resourceKey,
      targetDemandKey: edge.targetDemandKey,
      needKey: edge.needKey,
      sourceCapacityPerSecond: edge.sourceCapacityPerSecond,
      availablePerSecond: lastRound.availableByEdge.get(edge.id) ?? 0,
      transferredPerSecond: lastRound.eatenByEdge.get(edge.id) ?? 0,
      demandPerSecond: lastRound.demandByEdge.get(edge.id) ?? 0,
    });
  }
  const eatenByNeed = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.needKey) {
      continue;
    }
    eatenByNeed.set(
      edge.needKey,
      (eatenByNeed.get(edge.needKey) ?? 0) + (lastRound.eatenByEdge.get(edge.id) ?? 0),
    );
  }
  const needEdgeCounts = new Map<string, number>();
  for (const [needKey, need] of needs) {
    needEdgeCounts.set(needKey, need.edgeCount);
  }

  return {
    capableByNode: cap,
    demandByNode: dem,
    edgeAllocations,
    eatenByNeed,
    unmetDesireByNeed: lastRound.unmetDesireByNeed,
    needEdgeCounts,
    rounds,
  };
}

interface FillResult {
  grants: Map<string, number>;
  remainingNeed: Map<string, number>;
  remainingBudget: Map<string, number>;
  /** First-shot storage requests per pool (the honest pull on each tank). */
  poolRequested: Map<string, number>;
}

/**
 * Water-filling over the edge graph. Machine budgets first (a machine wire
 * outranks a buffer top-up), then storage pools. Grant factors are frozen
 * per budget per round so iteration order cannot shortchange later edges,
 * and leftovers migrate to still-hungry lines until nothing moves.
 */
function runFill(
  needs: Map<string, Need>,
  budgetOfferBase: Map<string, number>,
  poolOfferBase: Map<string, number>,
  asks: Map<string, number>,
): FillResult {
  const remainingBudget = new Map(budgetOfferBase);
  const remainingPool = new Map(poolOfferBase);
  const remainingNeed = new Map<string, number>();
  const grants = new Map<string, number>();
  for (const [needKey] of needs) {
    remainingNeed.set(needKey, asks.get(needKey) ?? 0);
  }

  for (let round = 0; round < MACHINE_FILL_ROUNDS; round += 1) {
    const requestsByBudget = new Map<string, number>();
    const requestByEdge = new Map<PreparedEdgeRef, number>();

    for (const [needKey, need] of needs) {
      const rem = remainingNeed.get(needKey) ?? 0;
      if (rem <= EPSILON) {
        continue;
      }
      const liveEdges = need.machineEdges.filter(
        (edge) => (remainingBudget.get(edge.budgetKey) ?? 0) > EPSILON,
      );
      if (liveEdges.length === 0) {
        continue;
      }
      const perEdge = rem / liveEdges.length;
      for (const edge of liveEdges) {
        requestByEdge.set(edge, perEdge);
        requestsByBudget.set(
          edge.budgetKey,
          (requestsByBudget.get(edge.budgetKey) ?? 0) + perEdge,
        );
      }
    }

    if (requestByEdge.size === 0) {
      break;
    }

    // Max-min at every contended budget: each hungry line gets an EQUAL
    // absolute share, capped at its own request; slack from small askers is
    // re-offered next round. Proportional-to-ask grants were the gridlock's
    // teeth - a 2000/s zombie ask (its owner starved on another input, so
    // the ask never shrinks) would crush a 10/s asker out of the trickle it
    // needed to recover. Shares are frozen per budget before any grant
    // applies so iteration order cannot shortchange later edges.
    const liveCountByBudget = new Map<string, number>();
    for (const [edge] of requestByEdge) {
      liveCountByBudget.set(edge.budgetKey, (liveCountByBudget.get(edge.budgetKey) ?? 0) + 1);
    }
    const shareByBudget = new Map<string, number>();
    for (const [budgetKey] of requestsByBudget) {
      const budget = remainingBudget.get(budgetKey) ?? 0;
      shareByBudget.set(budgetKey, budget / Math.max(1, liveCountByBudget.get(budgetKey) ?? 1));
    }

    let granted = 0;
    for (const [edge, request] of requestByEdge) {
      const grant = Math.min(request, shareByBudget.get(edge.budgetKey) ?? 0);
      if (grant <= EPSILON) {
        continue;
      }
      grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
      remainingBudget.set(edge.budgetKey, (remainingBudget.get(edge.budgetKey) ?? 0) - grant);
      remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
      granted += grant;
    }
    if (granted <= EPSILON) {
      break;
    }
  }

  // The honest pull on each tank: what the consumers still want after the
  // machine wires have given everything they can.
  const poolRequested = new Map<string, number>();
  for (const [needKey, need] of needs) {
    const rem = remainingNeed.get(needKey) ?? 0;
    if (rem <= EPSILON || need.storageEdges.length === 0) {
      continue;
    }
    const perEdge = rem / need.storageEdges.length;
    for (const edge of need.storageEdges) {
      poolRequested.set(edge.poolKey, (poolRequested.get(edge.poolKey) ?? 0) + perEdge);
    }
  }

  for (let round = 0; round < STORAGE_FILL_ROUNDS; round += 1) {
    const requestsByPool = new Map<string, number>();
    const requestByEdge = new Map<PreparedEdgeRef, number>();

    for (const [needKey, need] of needs) {
      const rem = remainingNeed.get(needKey) ?? 0;
      if (rem <= EPSILON) {
        continue;
      }
      const liveEdges = need.storageEdges.filter(
        (edge) => (remainingPool.get(edge.poolKey) ?? 0) > EPSILON,
      );
      if (liveEdges.length === 0) {
        continue;
      }
      const perEdge = rem / liveEdges.length;
      for (const edge of liveEdges) {
        requestByEdge.set(edge, perEdge);
        requestsByPool.set(edge.poolKey, (requestsByPool.get(edge.poolKey) ?? 0) + perEdge);
      }
    }

    if (requestByEdge.size === 0) {
      break;
    }

    // Same max-min rule at the tanks: equal shares, saturate small askers,
    // re-offer the slack. An infinite (unfed) pool serves every request.
    const liveCountByPool = new Map<string, number>();
    for (const [edge] of requestByEdge) {
      liveCountByPool.set(edge.poolKey, (liveCountByPool.get(edge.poolKey) ?? 0) + 1);
    }
    const shareByPool = new Map<string, number>();
    for (const [poolKey] of requestsByPool) {
      const pool = remainingPool.get(poolKey) ?? 0;
      shareByPool.set(
        poolKey,
        Number.isFinite(pool)
          ? pool / Math.max(1, liveCountByPool.get(poolKey) ?? 1)
          : Number.POSITIVE_INFINITY,
      );
    }

    let granted = 0;
    for (const [edge, request] of requestByEdge) {
      const grant = Math.min(request, shareByPool.get(edge.poolKey) ?? 0);
      if (grant <= EPSILON) {
        continue;
      }
      grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
      const pool = remainingPool.get(edge.poolKey) ?? 0;
      if (Number.isFinite(pool)) {
        remainingPool.set(edge.poolKey, pool - grant);
      }
      remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
      granted += grant;
    }
    if (granted <= EPSILON) {
      break;
    }
  }

  return { grants, remainingNeed, remainingBudget, poolRequested };
}

type PreparedEdgeRef = Pick<PreparedEdge, "id" | "budgetKey" | "needKey" | "poolKey">;

/**
 * Project-level target rate, split across producers of the target resource
 * that have no outgoing wire for it (the plan's terminal makers).
 */
function calculateProjectTargetShares(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
): Map<string, { key: ResourceKey; amountPerSecond: number }> {
  const shares = new Map<string, { key: ResourceKey; amountPerSecond: number }>();
  if (!project.targetRate) {
    return shares;
  }

  const targetKey = makeResourceKey(project.targetRate.kind, project.targetRate.resourceId);
  const producers = project.nodes.filter((node) => nodes[node.id]?.outputs[targetKey]);
  const terminal = producers.filter(
    (node) =>
      !project.edges.some(
        (edge) =>
          edge.source === node.id &&
          makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey,
      ),
  );
  if (terminal.length === 0) {
    return shares;
  }

  const share = project.targetRate.amountPerSecond / terminal.length;
  for (const node of terminal) {
    shares.set(node.id, { key: targetKey, amountPerSecond: share });
  }
  return shares;
}

// ---- Shared flow helpers (used by the reporting layer in throughput.ts). ----

export function clampUtilization(utilization: number): number {
  if (!Number.isFinite(utilization)) {
    return 1;
  }

  return Math.min(Math.max(utilization, 0), 1);
}

export function getEffectiveFlowRate(flow: ResourceFlow | undefined, utilization: number): number {
  return (flow?.amountPerSecond ?? 0) * clampUtilization(utilization);
}

export function getEdgeTargetDemandKey(
  project: FactoryProject,
  edge: FactoryProject["edges"][number],
): ResourceKey | undefined {
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);
  const edgeResource = { kind: edge.resourceKind, id: edge.resourceId };
  const effectiveTargetRecipe =
    targetNode && targetRecipe ? applyRecipeInputOverrides(targetRecipe, targetNode) : undefined;
  const input = effectiveTargetRecipe?.inputs.find(
    (entry) => isRecipeInputConsumed(entry) && resourceMatchesInput(edgeResource, entry),
  );

  return input ? makeResourceKey(input.kind, input.id) : undefined;
}

export function getCompatibleOutputFlow(
  nodeResult: NodeThroughputResult | undefined,
  resource: Pick<FactoryProject["edges"][number], "resourceKind" | "resourceId">,
): ResourceFlow | undefined {
  if (!nodeResult) {
    return undefined;
  }

  return getCompatibleOutputFlowForResource(nodeResult, {
    kind: resource.resourceKind,
    id: resource.resourceId,
  });
}

export function getCompatibleOutputFlowForKey(
  nodeResult: NodeThroughputResult,
  resourceKey: ResourceKey,
): ResourceFlow | undefined {
  return getCompatibleOutputFlowForResource(nodeResult, resourceFromKey(resourceKey));
}

export function getCompatibleOutputFlowForResource(
  nodeResult: NodeThroughputResult,
  resource: Pick<ResourceAmount, "kind" | "id">,
): ResourceFlow | undefined {
  const exact = nodeResult.outputs[makeResourceKey(resource.kind, resource.id)];
  if (exact) {
    return exact;
  }

  for (const output of Object.values(nodeResult.outputs)) {
    const outputResource = {
      kind: output.kind,
      id: output.resourceId,
      displayName: output.displayName,
      alternatives: output.alternatives,
    };
    if (!resourceMatchesInput(resource, outputResource)) {
      continue;
    }

    if (resource.kind === "fluid" && output.kind === "item") {
      const fluid = getFilledCellFluidEquivalent({
        ...outputResource,
        amount: output.amountPerSecond,
      });
      if (fluid?.id === resource.id) {
        return {
          key: makeResourceKey("fluid", fluid.id),
          kind: "fluid",
          resourceId: fluid.id,
          displayName: fluid.displayName ?? output.displayName,
          amountPerSecond: fluid.amount ?? output.amountPerSecond,
        };
      }
    }

    return output;
  }

  return undefined;
}

export function resourceFromKey(resourceKey: ResourceKey): Pick<ResourceAmount, "kind" | "id"> {
  const separatorIndex = resourceKey.indexOf(":");
  return {
    kind: resourceKey.slice(0, separatorIndex) as ResourceKind,
    id: resourceKey.slice(separatorIndex + 1),
  };
}

export function addRequiredRate(
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
  nodeId: string,
  resourceKey: ResourceKey,
  amountPerSecond: number,
): void {
  const nodeRequirements = requiredByNodeAndResource.get(nodeId) ?? new Map<ResourceKey, number>();
  nodeRequirements.set(resourceKey, (nodeRequirements.get(resourceKey) ?? 0) + amountPerSecond);
  requiredByNodeAndResource.set(nodeId, nodeRequirements);
}
