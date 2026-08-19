import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { isRecipeInputConsumed, makeResourceKey, resourceMatchesInput } from "../model/resources";
import { getStorageRoles, isDrainRole } from "../model/storage-role";
import { collectTrashNodeIds } from "../model/trash";
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
 *
 * CONSERVATION. The plan is a CLOSED system. Nothing appears from nowhere and
 * nothing vanishes, and the only places that rule is suspended are the two a
 * player declares by hand:
 *
 *   a SOURCE drawer  nothing feeds it, so it invents its resource
 *   a DRAIN drawer   nothing draws from it, so it swallows what arrives
 *
 * plus the trash can, which is a drain you can see destroying things. A
 * BUFFER is neither: it passes on exactly what its consumers pull.
 *
 * So a machine is bounded at BOTH ends. `capableByNode` asks whether every
 * ingredient has somewhere to come from, `disposalByNode` whether everything
 * it makes has somewhere to go, and it runs at the lesser. A port with no
 * wire on it is not an escape hatch in either direction: an input with no
 * feeder is an empty bus and an output with no taker is a full one, and both
 * stop the machine dead. A node standing on the disposal limit is CLOGGED.
 *
 * A clog has to be JUSTIFIED by what takers would take if nothing were
 * clogged. Judged on live flows alone, a clog can hold itself in place: the
 * held machine asks for less, its suppliers read "not wanted", their clogs
 * deepen, and a one-round allocation wobble becomes a stable answer a fixed
 * fraction below the truth (the platline board stranded at exactly 90%).
 * Disposal is therefore judged against a SHADOW of the demand system - same
 * asks, same fairness, but throttled by pressure-only demand (`demWant`) and
 * offered capability instead of throttled rates - a world with no clogs in
 * it, where a suppressed want cannot masquerade as a missing one.
 *
 * This is a real cost and it is the point. Every plan now has to say where
 * its raw materials come from and where its product goes, in drawers, on the
 * board - and until it does, it reads zero rather than quietly inventing the
 * answer at both ends.
 *
 * BALANCED RINGS get one appeal. A ring that conserves its circulating goods
 * exactly (the cell loops: every cell out of the electrolyzer comes back
 * through a canner) has a continuum of self-consistent levels and no
 * restoring force between them, so the descent's transients ratchet it to
 * zero even though the same ring, primed once in game, runs forever. A ring
 * whose machines all converge to zero capability is therefore re-solved with
 * its internal needs allowed to borrow against the ring's own capability
 * (the solver priming the loop), and that answer is adopted only if the
 * borrowing idles out - see the balanced-ring rescue below.
 *
 * THE SETTLEMENT closes the books last. Because capability is clog-blind on
 * purpose, a consumer downstream of a clogged supplier converges wanting and
 * "capable of" full blast while its wire carries a trickle - and every
 * figure multiplied off that level mints material from nowhere. After the
 * verdicts converge (and any rescue is judged), a separate fixed point
 * bounds each node's ACTUAL level by what its wires really delivered and
 * re-settles the actual flows at it, without ever feeding back into
 * capability, demand or disposal: the card still diagnoses the clog, the
 * books stop paying out on it.
 */

export interface EdgeAllocationResult {
  role: "machine" | "storage-source" | "storage-sink" | "storage-transfer" | "trash";
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
  /**
   * How hard each node could run before a wired output it cannot get rid of
   * backs up on it. 1 when nothing binds; absent when the node has no bounded
   * output at all. See the conservation note at the top of this file.
   */
  disposalByNode: Map<string, number>;
  /** The output resource whose surplus sets `disposalByNode`, when one does. */
  clogOutputByNode: Map<string, ResourceKey>;
  /**
   * The settled ACTUAL run level: min(capable, demand, disposal) further
   * bounded by what each node's wires really delivered (see THE SETTLEMENT).
   * This is the one figure the books may multiply nameplate rates by.
   */
  actualByNode: Map<string, number>;
  /** The input whose real arrivals pulled `actualByNode` below the verdict
   * level, for nodes the settlement throttled. */
  actualLimitingInputByNode: Map<string, ResourceKey>;
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
  role: "machine" | "storage-source" | "storage-sink" | "storage-transfer" | "trash";
  resourceKey: ResourceKey;
  targetDemandKey: ResourceKey;
  /** `${target}|${targetDemandKey}` for machine targets, "" for sinks/trash. */
  needKey: string;
  /** `${source}|${outputKey}` for machine sources, "" for storage sources. */
  budgetKey: string;
  /**
   * The RECEIVING drawer of a storage-transfer line, else "". A transfer
   * touches two pools, so `poolKey` names the giving drawer and this one the
   * fed drawer.
   */
  sinkPoolKey: string;
  /** The drawer this line touches (its node id) for storage roles, else "". */
  poolKey: string;
  /**
   * This line can swallow anything the producer sends: a trash can, or a
   * drain drawer nothing draws from. A buffer sink is deliberately NOT free -
   * it relays its consumers' pull and stops there.
   */
  freeDisposal: boolean;
  /**
   * Absorbs but never asks: a BYPRODUCT drawer. Its demand is reported as
   * zero, so the pace comes from whoever genuinely wants the output.
   */
  silent: boolean;
  /**
   * An OVERFLOW buffer sink: a buffer that catches what its takers leave
   * instead of clogging its feeder, filling at a visible rate. It relays only
   * its takers' pull as demand (it never drives production), and it can never
   * run net-negative: its outflow is still bounded by what really arrived.
   * A buffer set to `strict` opts back into the pass-through-only rule.
   */
  overflow: boolean;
  sourceCapacityPerSecond: number;
}

interface Budget {
  ownerId: string;
  outputKey: ResourceKey;
  makePerSecond: number;
  sinkEdges: PreparedEdge[];
  /** The subset of `sinkEdges` that feed a DRAIN: those absorb without limit. */
  drainEdges: PreparedEdge[];
  /** Every edge drawing on this budget (machine consumers and tank sinks). */
  edges: PreparedEdge[];
  /**
   * Trash cans on this output. They live outside `edges` because they never
   * ask - they drink the leftovers - while their mere presence pins the
   * budget fully demanded (a voided output can never pace its machine down).
   */
  trashEdges: PreparedEdge[];
  /**
   * Somewhere on this output there is a can or a drain, so the surplus always
   * has a home and this output can never clog its machine.
   */
  freeDisposal: boolean;
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
  /** Sinks into a BUFFER: bounded by what the pool's consumers pull. */
  bufferSinkEdges: PreparedEdge[];
  sourceEdges: PreparedEdge[];
  /** Trash cans draining this tank: they take what real consumers leave. */
  trashEdges: PreparedEdge[];
  /** Drawer-to-drawer lines INTO this drawer: its own feeders of last resort. */
  feedInEdges: PreparedEdge[];
  /** Drawer-to-drawer lines OUT of this drawer: containers it stocks. */
  feedOutEdges: PreparedEdge[];
  /**
   * Somewhere up this drawer's feed chain sits a SOURCE, so its takers can
   * never run dry: real material still moves first, and the chain covers only
   * what is left owing. Set once after preparation - it is wiring, not state.
   */
  hasBottomlessBackup: boolean;
}

/** Half a percent: below this, two utilizations are the same number. */
const CLOG_EPSILON = 0.005;

/**
 * Max-min split of `total` across takers with capacities: equal shares,
 * saturated takers leave their slack to the rest. The same rule the fills
 * use, packaged for the buffer relays below, where an even split between a
 * pool's FEEDERS understates the bigger one (two canners feeding one cell
 * buffer at 0.67/s and 0.89/s are not asked 0.78/s each).
 */
function waterFillShares(total: number, caps: number[]): number[] {
  const takes = caps.map(() => 0);
  let remaining = total;
  for (let pass = 0; pass < caps.length; pass += 1) {
    if (remaining <= EPSILON) {
      break;
    }
    const live: number[] = [];
    for (let i = 0; i < caps.length; i += 1) {
      if (caps[i]! - takes[i]! > EPSILON) {
        live.push(i);
      }
    }
    if (live.length === 0) {
      break;
    }
    const share = remaining / live.length;
    let moved = 0;
    for (const i of live) {
      const take = Math.min(share, caps[i]! - takes[i]!);
      takes[i] = takes[i]! + take;
      moved += take;
    }
    remaining -= moved;
    if (moved <= EPSILON) {
      break;
    }
  }
  return takes;
}

/** A rescued ring may lean on its anchor for at most this share of its own
 * internal flow once settled - convergence dust, not real makeup. */
const RING_ANCHOR_TOLERANCE = 1e-3;
const RING_ANCHOR_FLOOR = 1e-6;

/**
 * Below this a node has converged to a hard stop, not merely to "slow".
 * Shared by the dead-loop badge (death-spiral.ts) and the balanced-ring
 * rescue's detection, deliberately: a descent can converge at a microscopic
 * dust level (2e-5 of full speed) instead of ratcheting all the way to the
 * snap threshold, and a ring the badge calls dead while the rescue calls
 * alive gets a DEAD LOOP verdict with no appeal - the one-electrolyzer
 * strict-buffer board fell exactly in that gap.
 */
export const DEAD_RING_EPSILON = 1e-4;

interface MachineNodeInfo {
  id: string;
  /** Consumed inputs that have at least one incoming wire. */
  wiredInputs: Array<{ needKey: string; nameplatePerSecond: number }>;
  /** Consumed inputs with NO incoming wire: nothing declares where they come
   * from, so the machine cannot run. */
  bareInputKeys: ResourceKey[];
  /** Outputs with NO outgoing wire: nothing carries them away, so they back
   * up and the machine cannot run. */
  bareOutputKeys: ResourceKey[];
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
/** Passes of the post-convergence settlement (see THE SETTLEMENT below): each
 * pass propagates a delivered-input bound one hop, so this caps how deep a
 * starved chain settles in one solve. */
const SETTLE_ROUNDS = 32;

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
  const trashNodeIds = collectTrashNodeIds(project);
  const storageRoles = getStorageRoles(project);

  const ensurePool = (poolKey: string): Pool => {
    const existing = pools.get(poolKey);
    if (existing) {
      return existing;
    }
    const pool: Pool = {
      sinkEdges: [],
      bufferSinkEdges: [],
      sourceEdges: [],
      trashEdges: [],
      feedInEdges: [],
      feedOutEdges: [],
      hasBottomlessBackup: false,
    };
    pools.set(poolKey, pool);
    return pool;
  };

  for (const edge of project.edges) {
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);
    if (sourceStorage && targetStorage) {
      // A drawer feeding a drawer. No budget and no need - neither end is a
      // machine - just two containers and a line that moves stock from one to
      // the other. How much moves is settled AFTER the fills each round (see
      // the transfer settlement in runRound): the fed drawer's takers set the
      // pull, real deliveries count against it, and the feeder covers what is
      // left owing - from its own stock, or bottomlessly when it is (or is
      // backed by) a SOURCE.
      const transferKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      const prepared: PreparedEdge = {
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        role: "storage-transfer",
        resourceKey: transferKey,
        targetDemandKey: transferKey,
        needKey: "",
        budgetKey: "",
        sinkPoolKey: targetStorage.id,
        poolKey: sourceStorage.id,
        freeDisposal: false,
        // A feed into a BYPRODUCT drawer catches leftovers and never begs,
        // same as the machine-fed kind.
        silent: storageRoles.get(edge.target) === "byproduct",
        overflow: false,
        sourceCapacityPerSecond: Number.POSITIVE_INFINITY,
      };
      edges.push(prepared);
      ensurePool(sourceStorage.id).feedOutEdges.push(prepared);
      ensurePool(targetStorage.id).feedInEdges.push(prepared);
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const sourceResult = sourceStorage ? undefined : nodes[edge.source];
    const sourceOutputFlow = getCompatibleOutputFlow(sourceResult, edge);
    const role: PreparedEdge["role"] = trashNodeIds.has(edge.target)
      ? "trash"
      : targetStorage
        ? "storage-sink"
        : sourceStorage
          ? "storage-source"
          : "machine";
    // A pool is ONE DRAWER, not one item.
    //
    // This used to key on the resource, which quietly rebuilt the drawer
    // network the conservation rework exists to remove: every drawer holding
    // carbon dust anywhere on the board was one tank, so a product drawer
    // parked beside an unrelated chain gave a source drawer on the titanium
    // line `sinkEdges`, dropped its offer from infinite to that OTHER chain's
    // output, and starved a line it shares no wire with. Material teleported
    // between drawers nobody had connected.
    //
    // Keyed by node, every drawer is its own container and the roles fall out
    // of its own wires: nothing feeds a SOURCE, so it has no sinks and offers
    // without limit; a BUFFER's outflow is bounded by its own inflow, which is
    // exactly "you can never take out more than you put in". Two drawers of
    // the same item are two containers, whatever their roles - to move goods
    // between them you wire them together, like everything else on the board.
    const poolKey = targetStorage?.id ?? sourceStorage?.id ?? "";
    // A buffer catches overflow unless the player set it strict. This is what
    // makes "machine into tank into machine" behave like the in-game build:
    // the tank soaks up a surplus (visibly, at a net fill rate) instead of
    // backing it up into the feeder as a clog.
    const isOverflowBufferSink =
      role === "storage-sink" &&
      storageRoles.get(edge.target) === "buffer" &&
      targetStorage?.bufferMode !== "strict";
    const prepared: PreparedEdge = {
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      role,
      resourceKey: key,
      targetDemandKey,
      needKey: targetStorage || role === "trash" ? "" : `${edge.target}|${targetDemandKey}`,
      budgetKey: sourceStorage ? "" : `${edge.source}|${sourceOutputFlow?.key ?? key}`,
      sinkPoolKey: "",
      poolKey,
      // A can always. A drawer only when nothing draws from it, which is what
      // makes it the plan's declared export rather than an ordinary buffer.
      // BOTH kinds of drain accept without limit; they differ only in whether
      // they ask (see `silent` below). An overflow buffer accepts freely too,
      // but unlike a drain the material stays in the plan's books: it piles up
      // in the tank at a rate the card shows.
      freeDisposal:
        role === "trash" ||
        isOverflowBufferSink ||
        (role === "storage-sink" && isDrainRole(storageRoles.get(edge.target) ?? "idle")),
      // A BYPRODUCT drawer takes what is left and asks for nothing, so it must
      // not report what it absorbed as demand: doing so would pace its feeder
      // to full blast purely by existing, which is what a PRODUCT drawer is
      // for. This is the one flag that separates the two.
      silent: role === "storage-sink" && storageRoles.get(edge.target) === "byproduct",
      overflow: isOverflowBufferSink,
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
        drainEdges: [],
        edges: [],
        trashEdges: [],
        freeDisposal: false,
      };
      if (!existing) {
        budgets.set(prepared.budgetKey, budget);
      }
      if (role === "trash") {
        budget.trashEdges.push(prepared);
      } else {
        budget.edges.push(prepared);
        if (role === "storage-sink") {
          budget.sinkEdges.push(prepared);
          if (prepared.freeDisposal) {
            budget.drainEdges.push(prepared);
          }
        }
      }
      budget.freeDisposal = budget.freeDisposal || prepared.freeDisposal;
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
      const pool = ensurePool(poolKey);
      if (role === "storage-sink") {
        pool.sinkEdges.push(prepared);
        if (!prepared.freeDisposal) {
          pool.bufferSinkEdges.push(prepared);
        }
      } else if (role === "trash") {
        pool.trashEdges.push(prepared);
      } else {
        pool.sourceEdges.push(prepared);
      }
    }
  }

  // A pool is bottomless when NOTHING feeds it - no machine line and no
  // drawer line - which is the SOURCE rule with drawer feeders now counted.
  // Walking the feed lines out from every bottomless pool marks the drawers
  // that have one somewhere behind them; that mark is what lets their takers
  // read full capability and their shortfalls pull through the chain.
  const isBottomlessPool = (poolKey: string): boolean => {
    const pool = pools.get(poolKey);
    return pool !== undefined && pool.sinkEdges.length === 0 && pool.feedInEdges.length === 0;
  };
  {
    const frontier: string[] = [];
    for (const [poolKey, pool] of pools) {
      if (pool.feedOutEdges.length > 0 && isBottomlessPool(poolKey)) {
        frontier.push(poolKey);
      }
    }
    while (frontier.length > 0) {
      const upstream = pools.get(frontier.pop()!);
      for (const feedEdge of upstream?.feedOutEdges ?? []) {
        const downstream = pools.get(feedEdge.sinkPoolKey);
        if (downstream && !downstream.hasBottomlessBackup) {
          downstream.hasBottomlessBackup = true;
          frontier.push(feedEdge.sinkPoolKey);
        }
      }
    }
  }
  const backedPoolKeys = new Set<string>();
  for (const [poolKey, pool] of pools) {
    if (pool.hasBottomlessBackup) {
      backedPoolKeys.add(poolKey);
    }
  }
  const storageFeedEdges = edges.filter((edge) => edge.role === "storage-transfer");

  const machineNodes: MachineNodeInfo[] = [];
  const infoById = new Map<string, MachineNodeInfo>();
  const budgetsByOwner = new Map<string, Budget[]>();
  for (const budget of budgets.values()) {
    budgetsByOwner.set(budget.ownerId, [...(budgetsByOwner.get(budget.ownerId) ?? []), budget]);
  }
  const targetShares = calculateProjectTargetShares(project, nodes);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    if (!nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
      continue;
    }

    const wiredInputs: MachineNodeInfo["wiredInputs"] = [];
    const bareInputKeys: ResourceKey[] = [];
    for (const [inputKey, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond <= EPSILON) {
        continue;
      }
      const needKey = `${node.id}|${inputKey}`;
      if (needs.has(needKey)) {
        wiredInputs.push({ needKey, nameplatePerSecond: flow.amountPerSecond });
      } else {
        // Nothing feeds this ingredient. In a closed plan that is not a
        // standing assumption that you carry it in by hand, it is a machine
        // with an empty input bus: it does not run until something declares
        // where the ingredient comes from.
        bareInputKeys.push(inputKey as ResourceKey);
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

    // Outputs with no wire on them. Same rule as a bare input, the other way
    // round: a full output bus with nothing carrying it away stops the machine.
    const bareOutputKeys: ResourceKey[] = [];
    for (const [outputKey, flow] of Object.entries(nodeResult.outputs)) {
      if (flow.amountPerSecond <= EPSILON) {
        continue;
      }
      if (!budgets.has(`${node.id}|${outputKey}`)) {
        bareOutputKeys.push(outputKey as ResourceKey);
      }
    }

    const info: MachineNodeInfo = {
      id: node.id,
      wiredInputs,
      bareInputKeys,
      bareOutputKeys,
      hasOutputs: Object.keys(nodeResult.outputs).length > 0,
      hasOutgoingWires: (budgetsByOwner.get(node.id) ?? []).length > 0,
      budgets: budgetsByOwner.get(node.id) ?? [],
      targetFloors,
    };
    machineNodes.push(info);
    infoById.set(node.id, info);
  }

  // Structural and fixed for the whole solve: these machines have a power
  // setup the game would refuse to start, so they sit at zero - offers, asks
  // and fills alike - while their nameplate shape stays on the card.
  const powerStalledNodes = new Set(
    machineNodes.filter((info) => nodes[info.id]?.powerStalled === true).map((info) => info.id),
  );
  // Also structural and fixed: these machines have a slot with no wire on it,
  // so they ship nothing no matter what anybody downstream wants. See the
  // offer split in runRound.
  const stoppedByBareSlot = new Set([
    ...machineNodes.filter((info) => info.bareOutputKeys.length > 0).map((info) => info.id),
    ...powerStalledNodes,
  ]);

  // ---- Iteration state: everything starts at full blast. -------------------
  const cap = new Map<string, number>();
  const dem = new Map<string, number>();
  // Pressure-only demand, iterated alongside dem for the shadow fill: how
  // hard each node is wanted with every clog throttle removed. See the
  // shadow fill in runRound.
  const demW = new Map<string, number>();
  const disp = new Map<string, number>();
  // The needs a ring under rescue may draw on the anchor for, with the ring
  // wires the draw lands on, plus each need's allowance bucket - the ring's
  // own supply of that resource, which is all the anchor may redistribute.
  // Empty except during the balanced-ring rescue's second descent (see below).
  let activeAnchors: RingAnchorPlan | undefined;
  // Set only during the settlement (see THE SETTLEMENT below): each node's
  // actual run level, bounded by what its wires really delivered. While set,
  // runRound throttles the ACTUAL-flow side - desire asks, actual offers,
  // sink absorption - by it, and the verdict-side fills stand down.
  let settleAct: Map<string, number> | undefined;
  // The priority tranche starts empty: round one splits fairly, and from the
  // second round on each output's must-ship rate is served first (see the
  // priority map in runRound).
  let unconditionalByBudget = new Map<string, number>();
  // A tank's sustainable outflow is last round's inflow; before the first
  // round assume every feeder ships nameplate (full blast, like the rest).
  let poolInflow = new Map<string, number>();
  const resetIterationState = () => {
    for (const info of machineNodes) {
      // A power-stalled machine starts still and never rises: its offers are
      // zeroed in the fill, but the sink-absorption path reads production off
      // these fills directly, so the stillness has to live here too.
      const stopped = powerStalledNodes.has(info.id);
      cap.set(info.id, stopped ? 0 : 1);
      dem.set(info.id, stopped ? 0 : 1);
      demW.set(info.id, stopped ? 0 : 1);
      disp.set(info.id, stopped ? 0 : 1);
    }
    unconditionalByBudget = new Map();
    poolInflow = new Map();
    for (const [poolKey, pool] of pools) {
      let inflow = 0;
      for (const sinkEdge of pool.sinkEdges) {
        inflow += budgets.get(sinkEdge.budgetKey)?.makePerSecond ?? 0;
      }
      poolInflow.set(poolKey, inflow);
    }
  };
  resetIterationState();

  interface RoundOutput {
    capNext: Map<string, number>;
    demNext: Map<string, number>;
    /** Pressure-only demand: what takers want with clog throttles removed.
     * Feeds the next round's shadow asks; never takes the disposal min. */
    demWantNext: Map<string, number>;
    disposalNext: Map<string, number>;
    clogOutputNext: Map<string, ResourceKey>;
    /** Per budget: the rate its owner runs at regardless of this output's
     * takers - the priority tranche of the next round's fills. */
    unconditionalNext: Map<string, number>;
    poolInflowNext: Map<string, number>;
    availableByEdge: Map<string, number>;
    eatenByEdge: Map<string, number>;
    demandByEdge: Map<string, number>;
    unmetDesireByNeed: Map<string, number>;
    /** What each anchored need really drew from the rescue anchor (desire
     * fill): the evidence the balanced-ring rescue judges itself on. */
    anchorGrantByNeed: Map<string, number>;
  }

  const runRound = (): RoundOutput => {
    // TWO offers, because the two fills ask different questions.
    //
    // `budgetOffer` is capability: what this producer could ship if everything
    // upstream ran flat out. A clog is deliberately absent from it. Capability
    // answers "are my inputs short", the clog is the player's own wiring, and
    // one wire clears it - so a consumer downstream of a clogged machine must
    // not read as INPUT-starved, and a ring idling for want of a customer must
    // keep the capability that proves it is not a dead loop.
    //
    // `budgetOfferActual` is what really moves this round. A machine sitting
    // at 50% because its other output has nowhere to go cannot hand anybody
    // its full-blast rate; without this the desire fill would mint the very
    // resource conservation is here to protect.
    const budgetOffer = new Map<string, number>();
    const budgetOfferActual = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      const capable = clampUtilization(cap.get(budget.ownerId) ?? 1);
      const disposal = disp.get(budget.ownerId) ?? 1;
      // STOPPED is not THROTTLED, and the difference is STRUCTURAL, not a
      // matter of the number reaching zero.
      //
      // A machine with a slot nobody has wired can never ship anything, so it
      // advertises nothing. Without this a consumer downstream computed a
      // utilization out of material that never arrives - a card reading 12.5%
      // on a line carrying 0/s, fed by a machine sitting at 0% because one of
      // its OWN slots is bare.
      //
      // A machine whose disposal merely converged to zero is a different
      // animal and keeps advertising its capability: that is a ring idling for
      // want of a customer, and collapsing its capability would resurrect the
      // gridlock lie this solver exists to kill (it would read as a dead loop).
      // Hence the test is `bareOutputKeys`, never `disposal <= 0`.
      budgetOffer.set(
        budgetKey,
        stoppedByBareSlot.has(budget.ownerId) ? 0 : budget.makePerSecond * capable,
      );
      // The actual offer is floored at the budget's own must-ship rate. The
      // disposal throttle exists so a machine choked by ANOTHER output cannot
      // hand out material it will not make - but a budget's own clog must not
      // cap its own offer, or the fill can never drain the clog it is being
      // asked to relieve: the throttled offer keeps the demand low, the low
      // demand keeps the clog, and a loop that one more grant would clear
      // settles half-dead instead. The must-ship rate already respects the
      // machine's inputs and its OTHER outputs' throttles, so nothing here
      // offers material that would not exist.
      budgetOfferActual.set(
        budgetKey,
        stoppedByBareSlot.has(budget.ownerId)
          ? 0
          : settleAct
            ? // Settling: a machine ships exactly what it makes at its
              // delivered-input level. The tranche floor is deliberately gone
              // - it exists to break latches DURING the descent, and material
              // above the settled level is exactly what the settlement is
              // here to stop shipping. runFill still serves the (capped)
              // priority tranche first, so the allocation ORDER between
              // competing consumers stays the converged one.
              budget.makePerSecond * clampUtilization(settleAct.get(budget.ownerId) ?? 0)
            : Math.max(
                budget.makePerSecond * clampUtilization(Math.min(capable, disposal)),
                Math.min(
                  unconditionalByBudget.get(budgetKey) ?? 0,
                  budget.makePerSecond * capable,
                ),
              ),
      );
    }
    // TWO offers again, for the same reason the budgets have two.
    //
    // `poolOffer` is what a tank can really hand out this round: last round's
    // inflow, which is the rule that stops a buffer inventing material.
    //
    // `poolOfferCapable` is what its feeders COULD put in if everything ran
    // flat out. Capability has to be demand-blind or a buffer launders a
    // downstream choke into an upstream shortage: a consumer thottled to 91%
    // by its own clogged output pulls 91% of the nitrogen, so 91% is all that
    // ever entered the tank, so the tank offers 91%, so the consumer reads as
    // STARVED of nitrogen - by a producer sitting at 4% with plenty to spare.
    // Wire the same producer straight in and it reads correctly, because a
    // machine budget already answers this question with `budgetOffer`. A tank
    // in the middle must not change the diagnosis.
    const poolOffer = new Map<string, number>();
    const poolOfferCapable = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length === 0 && pool.feedInEdges.length === 0) {
        // Nothing feeds it: a SOURCE drawer, infinite by construction.
        poolOffer.set(poolKey, Number.POSITIVE_INFINITY);
        poolOfferCapable.set(poolKey, Number.POSITIVE_INFINITY);
        continue;
      }
      poolOffer.set(poolKey, poolInflow.get(poolKey) ?? 0);
      let capable = 0;
      for (const sink of pool.sinkEdges) {
        capable += budgetOffer.get(sink.budgetKey) ?? 0;
      }
      poolOfferCapable.set(poolKey, pool.hasBottomlessBackup ? Number.POSITIVE_INFINITY : capable);
    }
    // Capability flows down the drawer chains: a tank fed from another tank
    // can deliver what that tank's own feeders could make. Relaxed against a
    // snapshot each pass (read old, write new) so wiring order cannot change
    // the answer; bottomless backup was already stamped above, and a chain
    // deeper than these passes settles across solver rounds like every other
    // lagged figure here.
    for (let relax = 0; relax < STORAGE_FILL_ROUNDS; relax += 1) {
      let changed = false;
      const snapshot = new Map(poolOfferCapable);
      for (const [poolKey, pool] of pools) {
        if (pool.feedInEdges.length === 0 || pool.hasBottomlessBackup) {
          continue;
        }
        let capable = 0;
        for (const sink of pool.sinkEdges) {
          capable += budgetOffer.get(sink.budgetKey) ?? 0;
        }
        for (const feedEdge of pool.feedInEdges) {
          capable += snapshot.get(feedEdge.poolKey) ?? 0;
        }
        if (capable !== snapshot.get(poolKey)) {
          poolOfferCapable.set(poolKey, capable);
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }

    // The rescue anchor's allowance: the ring's capability on each anchored
    // resource this round. Capability, never the throttled actual - a primed
    // loop's stock covers a dip at the sustainable level (see the anchor pass
    // in runFill), and it shrinks to zero with the ring's real capability, so
    // a ring that could not run stays unable to borrow.
    if (activeAnchors) {
      activeAnchors.allowanceByBucket = new Map();
      for (const [bucket, supply] of activeAnchors.supplyByBucket) {
        let total = 0;
        for (const budgetKey of supply.budgetKeys) {
          total += budgetOffer.get(budgetKey) ?? 0;
        }
        for (const poolKey of supply.poolKeys) {
          const capable = poolOfferCapable.get(poolKey) ?? 0;
          if (Number.isFinite(capable)) {
            total += capable;
          }
        }
        activeAnchors.allowanceByBucket.set(bucket, total);
      }
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
        potential += poolOfferCapable.get(edge.poolKey) ?? 0;
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
    const askShadow = new Map<string, number>();
    for (const [needKey, need] of needs) {
      const info = infoById.get(need.targetId);
      if (!info || need.nameplatePerSecond <= EPSILON) {
        askAvailability.set(needKey, 0);
        askDesire.set(needKey, 0);
        askShadow.set(needKey, 0);
        continue;
      }
      const ceiling = sibCeil(info, needKey);
      // Settling: consumption follows the recipe at the node's actual level -
      // a machine at 10% eats 10% of EVERY ingredient, so a starved input
      // releases its siblings' unclaimed shares back to the board. The
      // availability and shadow asks stand down (their fills answer verdict
      // questions the settlement leaves frozen).
      askAvailability.set(needKey, settleAct ? 0 : need.nameplatePerSecond * ceiling);
      askDesire.set(
        needKey,
        need.nameplatePerSecond *
          Math.min(
            settleAct
              ? clampUtilization(settleAct.get(need.targetId) ?? 0)
              : clampUtilization(dem.get(need.targetId) ?? 1),
            ceiling,
          ),
      );
      // The same ask, throttled by demWANT instead of dem: what this consumer
      // would take if no clog anywhere were holding it back. See the shadow
      // fill below for why disposal has to be judged on this and not on dem.
      askShadow.set(
        needKey,
        settleAct
          ? 0
          : need.nameplatePerSecond *
              Math.min(clampUtilization(demW.get(need.targetId) ?? 1), ceiling),
      );
    }

    const availabilityFill = runFill(
      needs,
      budgetOffer,
      poolOfferCapable,
      askAvailability,
      unconditionalByBudget,
      backedPoolKeys,
      activeAnchors,
    );
    const desireFill = runFill(
      needs,
      budgetOfferActual,
      poolOffer,
      askDesire,
      unconditionalByBudget,
      backedPoolKeys,
      activeAnchors,
    );
    // THE SHADOW FILL. Disposal - the clog ceiling below - must not be judged
    // by the desire fill, because the desire fill is downstream of every clog:
    // a machine held low asks its suppliers for less, the supplier's output
    // reads "not wanted", ITS disposal drops, and a slowdown that started as a
    // one-round allocation wobble justifies itself forever. On a board of
    // mass-conserving loops (every recycle chain is one) that stranded state
    // is a genuine fixed point, and the whole plan settles a fixed fraction
    // below the answer - the platline board that ran at exactly 90% until an
    // unrelated drawer perturbed it.
    //
    // So the clog question is asked in a world with no clogs in it: capability
    // offers (a supplier competes at what it COULD make, so a source drawer
    // takes only the true residue), and asks throttled by demWANT - the
    // pressure-only demand iterated alongside dem, which never takes the
    // disposal min. A real surplus still clogs: demWant honours what takers
    // genuinely want (a taker that wants no more asks for no more), it merely
    // refuses to count a want that a clog itself suppressed.
    const shadowFill = runFill(
      needs,
      budgetOffer,
      poolOfferCapable,
      askShadow,
      unconditionalByBudget,
      backedPoolKeys,
      activeAnchors,
    );

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

    // A BUFFER takes exactly what its own consumers pull, never the whole
    // leftover: it is a pass-through, not a hole in the plan's books. What it
    // declines stays on the producer's budget, where either a drain/can takes
    // it or it clogs the machine. Buffers are served first because a drain is
    // the last resort by definition.
    const bufferAbsorbByEdge = new Map<string, number>();
    const freeLeftoverByBudget = new Map<string, number>();
    const strictOfferByEdge = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      // What the owner actually RUNS at, not what it could offer. A sink can
      // never absorb more than the machine makes, and the offer above is
      // deliberately demand-blind - so without this a BYPRODUCT drawer would
      // bank the full nameplate off a machine idling at a fifth of it, which
      // is exactly the conservation break the drawer exists to prevent.
      const runs = clampUtilization(
        settleAct
          ? (settleAct.get(budget.ownerId) ?? 0)
          : Math.min(
              cap.get(budget.ownerId) ?? 1,
              disp.get(budget.ownerId) ?? 1,
              clampUtilization(dem.get(budget.ownerId) ?? 1),
            ),
      );
      const offered = budgetOfferActual.get(budgetKey) ?? 0;
      const takenByMachines = Math.max(
        0,
        offered - (desireFill.remainingBudget.get(budgetKey) ?? 0),
      );
      const leftover = Math.max(0, budget.makePerSecond * runs - takenByMachines);
      freeLeftoverByBudget.set(budgetKey, leftover);
      const bufferSinks = budget.sinkEdges.filter((sink) => !sink.freeDisposal);
      for (const sink of bufferSinks) {
        strictOfferByEdge.set(sink.id, leftover / bufferSinks.length);
      }
    }
    // A STRICT buffer takes exactly what its consumers pull, and the pull is
    // attributed across its feeders by saturate-and-reoffer, same as the
    // overflow relay below: split evenly instead, two unequal canners feeding
    // one cell drawer were each asked for the average, the bigger one's
    // declined surplus read as a real clog, and a balanced loop died the
    // moment its buffer went strict. What the pull does not claim stays on
    // the producer's budget, where either a drain takes it or it clogs the
    // machine - that is what strict OPTS INTO.
    for (const [poolKey, pool] of pools) {
      if (pool.bufferSinkEdges.length === 0) {
        continue;
      }
      const caps = pool.bufferSinkEdges.map((edge) => strictOfferByEdge.get(edge.id) ?? 0);
      const takes = waterFillShares(desireFill.poolRequested.get(poolKey) ?? 0, caps);
      pool.bufferSinkEdges.forEach((edge, index) => {
        const take = takes[index]!;
        bufferAbsorbByEdge.set(edge.id, take);
        freeLeftoverByBudget.set(
          edge.budgetKey,
          Math.max(0, (freeLeftoverByBudget.get(edge.budgetKey) ?? 0) - take),
        );
      });
    }

    /**
     * How much of the surplus a drain that ASKS is asking on behalf of.
     *
     * The leftover splits evenly across every drain on an output, which is
     * what each one physically catches. Demand cannot be read off that share
     * directly once some of the drains are silent: a product drawer beside a
     * byproduct drawer would ask for half the output, the machine would drop
     * to half, that halves the leftover, and the whole thing spirals to zero -
     * a machine wired to a drawer that wants everything it makes sitting at 0%.
     *
     * So the askers claim the silent ones' shares as well. One product drawer
     * next to one byproduct drawer asks for the lot, the machine runs flat out,
     * and the two still catch half each. With no silent drains this is 1 and
     * nothing changes.
     */
    const drainClaimByBudget = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      const drains = budget.drainEdges.length + budget.trashEdges.length;
      let asking = budget.trashEdges.length;
      for (const drain of budget.drainEdges) {
        // An overflow buffer catches a share of the leftovers like any drain,
        // but it never asks on its own behalf - its demand is its takers'
        // pull, computed below - so it counts as a catcher here, not an asker.
        if (!drain.silent && !drain.overflow) {
          asking += 1;
        }
      }
      drainClaimByBudget.set(budgetKey, asking > 0 ? drains / asking : 1);
    }

    // The pull a tank relays back to its feeders, attributed by
    // saturate-and-reoffer instead of an even split: the pool's requested
    // pull water-fills across its sink edges, each capped by what that edge
    // absorbed this round (the real relay) or by its budget's capability
    // (the shadow relay). An even split understates the bigger feeder - two
    // canners at 0.67/s and 0.89/s into one cell buffer were each asked for
    // 0.78/s, the bigger one read "nothing asks for more", and its idling
    // held a clog upstream that the idling itself justified.
    const overflowPullByEdge = new Map<string, number>();
    const shadowRelayByEdge = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length === 0) {
        continue;
      }
      const absorbedCaps = pool.sinkEdges.map((edge) => {
        const budget = budgets.get(edge.budgetKey);
        return edge.freeDisposal
          ? (freeLeftoverByBudget.get(edge.budgetKey) ?? 0) /
              Math.max(1, (budget?.drainEdges.length ?? 0) + (budget?.trashEdges.length ?? 0))
          : (bufferAbsorbByEdge.get(edge.id) ?? 0);
      });
      const pullTakes = waterFillShares(
        desireFill.poolRequested.get(poolKey) ?? 0,
        absorbedCaps,
      );
      const shadowCaps = pool.sinkEdges.map((edge) => budgetOffer.get(edge.budgetKey) ?? 0);
      const shadowTakes = waterFillShares(
        shadowFill.poolRequested.get(poolKey) ?? 0,
        shadowCaps,
      );
      pool.sinkEdges.forEach((edge, index) => {
        overflowPullByEdge.set(edge.id, pullTakes[index]!);
        shadowRelayByEdge.set(edge.id, shadowTakes[index]!);
      });
    }

    for (const edge of edges) {
      if (edge.role === "storage-transfer") {
        // Settled after this loop, once the fed drawer's machine deliveries
        // are known - a drawer feeder covers what is left owing, never more.
        continue;
      }
      // Drains and trash cans on a machine output drink whatever is left after
      // the buffers, splitting it evenly; the difference is that a drain
      // relays its tank's unmet pull as demand while trash never begs - its
      // demand IS what it carries, so nothing upstream reads hunger off it.
      if (edge.role === "storage-sink" || (edge.role === "trash" && edge.budgetKey)) {
        const budget = budgets.get(edge.budgetKey);
        const absorbed = edge.freeDisposal
          ? (freeLeftoverByBudget.get(edge.budgetKey) ?? 0) /
            Math.max(1, (budget?.drainEdges.length ?? 0) + (budget?.trashEdges.length ?? 0))
          : (bufferAbsorbByEdge.get(edge.id) ?? 0);
        availableByEdge.set(edge.id, absorbed);
        eatenByEdge.set(edge.id, absorbed);
        if (edge.role === "trash") {
          demandByEdge.set(edge.id, absorbed);
          continue;
        }
        const pool = pools.get(edge.poolKey);
        const deficitShare =
          (poolDeficit.get(edge.poolKey) ?? 0) / Math.max(1, pool?.sinkEdges.length ?? 1);
        // A PRODUCT drawer's absorption IS its demand: it asks its feeder for
        // everything the machine can make, which is what pins a terminal
        // machine at full blast and is exactly what you want from the thing
        // the factory is for.
        //
        // A BYPRODUCT drawer asks for nothing. It still eats the surplus
        // (`eatenByEdge` above, so conservation holds and nothing clogs), it
        // simply never begs, which leaves the pace to real consumers and to
        // the plan's target rate.
        //
        // An OVERFLOW buffer asks for what its takers pull, and not one item
        // more. It still catches the whole surplus (so the feeder never clogs
        // on it), but reporting the catch as demand would drive the feeder to
        // produce FOR the tank, and a buffer that manufactures demand is a
        // product drawer wearing the wrong badge. Each feeder's share of the
        // pull is the water-filled attribution above, already capped by what
        // this edge absorbed.
        demandByEdge.set(
          edge.id,
          edge.silent
            ? 0
            : edge.overflow
              ? (overflowPullByEdge.get(edge.id) ?? 0) + deficitShare
              : absorbed *
                  (edge.freeDisposal ? (drainClaimByBudget.get(edge.budgetKey) ?? 1) : 1) +
                deficitShare,
        );
        poolInflowNext.set(edge.poolKey, (poolInflowNext.get(edge.poolKey) ?? 0) + absorbed);
        continue;
      }

      if (edge.role === "trash") {
        // Tank -> trash: drain what the tank's real consumers left. An unfed
        // (infinite) tank has no surplus to void, so the can sips nothing.
        const pool = pools.get(edge.poolKey);
        const remaining = desireFill.remainingPool.get(edge.poolKey) ?? 0;
        const drained = Number.isFinite(remaining)
          ? Math.max(0, remaining) / Math.max(1, pool?.trashEdges.length ?? 1)
          : 0;
        availableByEdge.set(edge.id, drained);
        eatenByEdge.set(edge.id, drained);
        demandByEdge.set(edge.id, drained);
        continue;
      }

      const eaten = eatenByEdge.get(edge.id) ?? 0;
      const need = needs.get(edge.needKey);
      const unmet = Math.max(0, desireFill.remainingNeed.get(edge.needKey) ?? 0);
      demandByEdge.set(edge.id, eaten + unmet / Math.max(1, need?.edgeCount ?? 1));
    }

    // ---- Drawer-to-drawer settlement. ------------------------------------
    // A drawer feeder owes its drawer what the drawer's takers pulled beyond
    // what machine deliveries covered - the buffer's own "pass on the pull,
    // not one item more" rule, applied one container up. Committed stock
    // migrates first; a chain ending in a SOURCE covers the rest, which is
    // what holds a top-up line at exactly the loop's shortfall - and at 0/s
    // the day the loop turns net-positive. Relayed a few passes so a chain
    // settles inside the round; deeper ones converge across rounds like
    // every other lagged figure here.
    if (storageFeedEdges.length > 0) {
      // Stock still uncommitted after the fills. Cans already drank theirs.
      const stockByPool = new Map<string, number>();
      for (const [poolKey, pool] of pools) {
        if (pool.feedOutEdges.length === 0) {
          continue;
        }
        const remaining = desireFill.remainingPool.get(poolKey) ?? 0;
        stockByPool.set(
          poolKey,
          !Number.isFinite(remaining) || pool.trashEdges.length > 0
            ? 0
            : Math.max(0, remaining),
        );
      }
      const owedByPool = new Map<string, number>();
      for (const [poolKey, pool] of pools) {
        if (pool.feedInEdges.length === 0) {
          continue;
        }
        const requested = desireFill.poolRequested.get(poolKey) ?? 0;
        const arrived = poolInflowNext.get(poolKey) ?? 0;
        owedByPool.set(poolKey, Math.max(0, requested - arrived));
      }

      for (let pass = 0; pass < STORAGE_FILL_ROUNDS; pass += 1) {
        let moved = 0;
        for (const [poolKey, pool] of pools) {
          const owed = owedByPool.get(poolKey) ?? 0;
          if (owed <= EPSILON || pool.feedInEdges.length === 0) {
            continue;
          }
          // Even share per feeder; a feeder that cannot cover its share
          // leaves the rest for the next pass, where the ones that can pick
          // it up - the same saturate-and-reoffer rule the fills use.
          const share = owed / pool.feedInEdges.length;
          let served = 0;
          for (const feedEdge of pool.feedInEdges) {
            const stock = stockByPool.get(feedEdge.poolKey) ?? 0;
            const fromStock = Math.min(share, stock);
            const chainServes =
              isBottomlessPool(feedEdge.poolKey) || backedPoolKeys.has(feedEdge.poolKey);
            const grant = chainServes ? share : fromStock;
            if (grant <= EPSILON) {
              continue;
            }
            if (fromStock > EPSILON) {
              stockByPool.set(feedEdge.poolKey, stock - fromStock);
            }
            // Shipped beyond its own stock is owed to ITS feeders in turn.
            const passedThrough = grant - fromStock;
            if (passedThrough > EPSILON && !isBottomlessPool(feedEdge.poolKey)) {
              owedByPool.set(
                feedEdge.poolKey,
                (owedByPool.get(feedEdge.poolKey) ?? 0) + passedThrough,
              );
            }
            eatenByEdge.set(feedEdge.id, (eatenByEdge.get(feedEdge.id) ?? 0) + grant);
            poolInflowNext.set(poolKey, (poolInflowNext.get(poolKey) ?? 0) + grant);
            served += grant;
            moved += grant;
          }
          owedByPool.set(poolKey, Math.max(0, owed - served));
        }
        if (moved <= EPSILON) {
          break;
        }
      }

      // A drawer wired into a PRODUCT or BYPRODUCT drawer is exporting: the
      // drain catches whatever stock the feeder's takers left, exactly what
      // a can would have drunk there. It catches; it does not ask.
      for (const feedEdge of storageFeedEdges) {
        const targetRole = storageRoles.get(feedEdge.targetId);
        if (targetRole !== "product" && targetRole !== "byproduct") {
          continue;
        }
        const stock = stockByPool.get(feedEdge.poolKey) ?? 0;
        if (stock <= EPSILON) {
          continue;
        }
        const catchers = (pools.get(feedEdge.poolKey)?.feedOutEdges ?? []).filter((edge) =>
          isDrainRole(storageRoles.get(edge.targetId) ?? "idle"),
        ).length;
        const take = stock / Math.max(1, catchers);
        stockByPool.set(feedEdge.poolKey, stock - take);
        eatenByEdge.set(feedEdge.id, (eatenByEdge.get(feedEdge.id) ?? 0) + take);
        poolInflowNext.set(
          feedEdge.sinkPoolKey,
          (poolInflowNext.get(feedEdge.sinkPoolKey) ?? 0) + take,
        );
      }

      // The line's books. Carried is what settled; availability adds the
      // feeder's untouched stock; demand adds the receiver's still-unserved
      // share, so a dry chain reads hungry instead of quiet. A byproduct
      // feed stays silent, like its machine-fed kind.
      for (const feedEdge of storageFeedEdges) {
        const carried = eatenByEdge.get(feedEdge.id) ?? 0;
        const residualShare =
          (owedByPool.get(feedEdge.sinkPoolKey) ?? 0) /
          Math.max(1, pools.get(feedEdge.sinkPoolKey)?.feedInEdges.length ?? 1);
        availableByEdge.set(feedEdge.id, carried + (stockByPool.get(feedEdge.poolKey) ?? 0));
        demandByEdge.set(feedEdge.id, feedEdge.silent ? carried : carried + residualShare);
      }
    }

    for (const [poolKey, pool] of pools) {
      if (
        (pool.sinkEdges.length > 0 || pool.feedInEdges.length > 0) &&
        !poolInflowNext.has(poolKey)
      ) {
        poolInflowNext.set(poolKey, 0);
      }
    }

    // New capability: what could this node run at if wanted, given what its
    // wired inputs can actually deliver. New demand: what its consumers pull
    // (plus tank absorption), over its nameplate output.
    const capNext = new Map<string, number>();
    const demNext = new Map<string, number>();
    const demWantNext = new Map<string, number>();
    const disposalNext = new Map<string, number>();
    const clogOutputNext = new Map<string, ResourceKey>();
    const unconditionalNext = new Map<string, number>();
    for (const info of machineNodes) {
      // A closed plan has to say where every ingredient comes from. An input
      // with no wire is an empty bus, not a standing delivery.
      let capability = info.bareInputKeys.length > 0 ? 0 : 1;
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
        demWantNext.set(info.id, 1);
        continue;
      }
      // One walk over the budgets collects everything the three verdicts and
      // the priority map below read: what each output is asked for, and
      // whether a can or an asking drain pins it fully demanded.
      const nodeResult = nodes[info.id];
      const budgetStats = info.budgets.map((budget) => {
        let demandSum = 0;
        for (const edge of budget.edges) {
          demandSum += demandByEdge.get(edge.id) ?? 0;
        }
        // The same takers, read in the shadow fill: their pull with every clog
        // throttle removed. Storage sinks keep their real figures - a tank's
        // absorption follows production, it has no suppressed want to restore.
        let shadowSum = 0;
        for (const edge of budget.edges) {
          if (!edge.needKey) {
            // Tanks keep their real figures in the shadow - absorption
            // follows production - EXCEPT a buffer, whose demand is its
            // takers' pull relayed. Judged on the REAL pull, a clog-held
            // taker depresses the tank's pull, the low pull justifies the
            // feeder's clog, and the latch the shadow exists to break simply
            // re-forms one drawer upstream (the three-electrolyzer cell
            // board: the electrolyzer read clogged on oxygen cells because
            // the canner idled, and the canner idled because the cell
            // buffer's pull was depressed by that very clog). So a buffer
            // relays its takers' SHADOW pull instead.
            const isBufferSink =
              edge.overflow || (edge.role === "storage-sink" && !edge.freeDisposal);
            if (isBufferSink) {
              shadowSum += shadowRelayByEdge.get(edge.id) ?? 0;
            } else {
              shadowSum += demandByEdge.get(edge.id) ?? 0;
            }
            continue;
          }
          const need = needs.get(edge.needKey);
          const unmet = Math.max(0, shadowFill.remainingNeed.get(edge.needKey) ?? 0);
          shadowSum +=
            (shadowFill.grants.get(edge.id) ?? 0) + unmet / Math.max(1, need?.edgeCount ?? 1);
        }
        let floorRate = 0;
        for (const floor of info.targetFloors) {
          if (floor.key === budget.outputKey) {
            floorRate = Math.max(floorRate, floor.amountPerSecond);
          }
        }
        const required = Math.max(demandSum, floorRate);
        // A voided output is a fully demanded output: the can drinks whatever
        // arrives, so this budget can never pace the machine below full blast
        // (the in-game void-pipe semantic, the jump-start trick built in).
        //
        // A DRAIN deliberately does not do this. The two are different asks: a
        // can says "run flat out and destroy the rest", a drain says only
        // "a surplus here is allowed". Pinning drains too would drive every
        // machine feeding a dead-end drawer to full blast for no reason but
        // the drawer's existence. Overflow buffers are absent from the pin for
        // the same reason: catching a surplus is not wanting one, and a tank
        // must never be the reason a machine runs flat out.
        const pinned =
          budget.trashEdges.length > 0 ||
          budget.drainEdges.some((e) => !e.silent && !e.overflow);
        return { budget, demandSum, shadowSum, floorRate, required, pinned };
      });
      // Target floors on outputs no wire carries still ask the machine to run.
      let floorPressure = 0;
      for (const floor of info.targetFloors) {
        if (info.budgets.some((budget) => budget.outputKey === floor.key)) {
          continue;
        }
        const flow = nodeResult ? getCompatibleOutputFlowForKey(nodeResult, floor.key) : undefined;
        if (flow && flow.amountPerSecond > EPSILON) {
          floorPressure = Math.max(floorPressure, floor.amountPerSecond / flow.amountPerSecond);
        }
      }

      let pressure = floorPressure;
      // The shadow pressure: how hard the takers pull with clog throttles
      // removed. This is what demWant carries into the next round's shadow
      // asks - never the disposal min, which is the whole point of it.
      let pressureShadow = floorPressure;
      for (const stat of budgetStats) {
        if (stat.pinned) {
          pressure = Math.max(pressure, 1);
          pressureShadow = Math.max(pressureShadow, 1);
        }
        if (stat.budget.makePerSecond > EPSILON) {
          pressure = Math.max(pressure, stat.required / stat.budget.makePerSecond);
          pressureShadow = Math.max(
            pressureShadow,
            Math.max(stat.shadowSum, stat.floorRate) / stat.budget.makePerSecond,
          );
        } else if (stat.required > EPSILON) {
          pressure = Number.POSITIVE_INFINITY;
          pressureShadow = Number.POSITIVE_INFINITY;
        }
      }

      // CONSERVATION. Demand says how fast this node is WANTED; disposal says
      // how fast it CAN go before a wired output it cannot shift backs up on
      // it. A budget with a drain or a can on it can always shift everything.
      // Any other one moves only what its consumers pull, and the tightest of
      // those is the ceiling. Target floors are asks, not outlets, so they are
      // deliberately absent here: dialling a rate does not create somewhere to
      // put the result.
      // The ceiling honours the HIGHER of the two readings. The real fill can
      // dip below the truth for a round while signals cross (the latch the
      // shadow exists to break); the shadow can sit below the truth when a
      // competing supplier is genuinely clogged elsewhere and its imagined
      // unclogged offer absorbs ask it will never really serve. Either alone
      // understates somewhere; a want is proven by whichever world shows it.
      let disposal = Number.POSITIVE_INFINITY;
      let clogKey: ResourceKey | undefined;
      for (const stat of budgetStats) {
        if (stat.budget.freeDisposal || stat.budget.makePerSecond <= EPSILON) {
          continue;
        }
        const ceiling = Math.max(stat.demandSum, stat.shadowSum) / stat.budget.makePerSecond;
        if (ceiling < disposal) {
          disposal = ceiling;
          clogKey = stat.budget.outputKey;
        }
      }

      // THE PRIORITY MAP. For each output, the rate the machine would run at
      // even if this output's takers pulled nothing: what the REST of the node
      // wants of it (its other outputs' demand and pins, the plan's dialled
      // floors), bounded by what its inputs allow. Whatever this output makes
      // at that rate exists whether or not anybody drinks it - so next round's
      // fills serve it FIRST, before any feeder that is free to idle. This is
      // what lets a byproduct return-feed be drained ahead of an honest supply
      // line instead of clogging its machine while the supply line hogs the
      // ask (the NyrZ collapse), without touching the fairness rule between
      // competing consumers.
      for (const stat of budgetStats) {
        let pressureExcl = floorPressure;
        let dispExcl = Number.POSITIVE_INFINITY;
        for (const other of budgetStats) {
          if (other === stat) {
            continue;
          }
          if (other.pinned) {
            pressureExcl = Math.max(pressureExcl, 1);
          }
          if (other.budget.makePerSecond > EPSILON) {
            pressureExcl = Math.max(pressureExcl, other.required / other.budget.makePerSecond);
          } else if (other.required > EPSILON) {
            pressureExcl = Number.POSITIVE_INFINITY;
          }
          if (!other.budget.freeDisposal && other.budget.makePerSecond > EPSILON) {
            dispExcl = Math.min(
              dispExcl,
              Math.max(other.demandSum, other.shadowSum) / other.budget.makePerSecond,
            );
          }
        }
        unconditionalNext.set(
          `${info.id}|${stat.budget.outputKey}`,
          stat.budget.makePerSecond *
            clampUtilization(Math.min(capability, pressureExcl, dispExcl)),
        );
      }
      // A wired output moving exactly what is asked of it is DEMAND, not a
      // clog: the takers simply want no more. Only an output held below what
      // something is still asking for has anything stuck in it.
      if (clogKey !== undefined && !(disposal < pressure - CLOG_EPSILON)) {
        clogKey = undefined;
      }
      // A bare output is a hard zero, but it is never NAMED as the clog: a
      // slot with no wire on it is reported as UNWIRED, which says the same
      // thing in a word the reader can act on without any arithmetic.
      if (info.bareOutputKeys.length > 0) {
        disposal = 0;
        clogKey = undefined;
      }
      disposalNext.set(info.id, disposal);
      if (clogKey !== undefined) {
        clogOutputNext.set(info.id, clogKey);
      }
      demNext.set(info.id, Math.min(pressure, disposal));
      demWantNext.set(info.id, pressureShadow);
    }

    return {
      capNext,
      demNext,
      demWantNext,
      disposalNext,
      clogOutputNext,
      unconditionalNext,
      poolInflowNext,
      availableByEdge,
      eatenByEdge,
      demandByEdge,
      unmetDesireByNeed: desireFill.remainingNeed,
      anchorGrantByNeed: desireFill.anchorGrants,
    };
  };

  // ---- Descend to the fixed point. ------------------------------------------
  let rounds = 0;

  const descend = (): RoundOutput => {
    resetIterationState();
    const prevDelta = new Map<string, number>();
    let roundsSinceJump = 0;

  for (let round = 0; round < ROUND_CAP; round += 1) {
    const output = runRound();
    rounds += 1;
    roundsSinceJump += 1;

    let maxDelta = 0;
    const currentDelta = new Map<string, number>();
    for (const info of machineNodes) {
      const capDelta = (cap.get(info.id) ?? 1) - (output.capNext.get(info.id) ?? 1);
      const demDelta =
        clampUtilization(dem.get(info.id) ?? 1) -
        clampUtilization(output.demNext.get(info.id) ?? 1);
      currentDelta.set(`c|${info.id}`, capDelta);
      currentDelta.set(`d|${info.id}`, demDelta);
      // Disposal counts toward CONVERGENCE but is deliberately kept out of
      // `currentDelta`: the geometric jump below routes every entry into
      // either `cap` or `dem` by key prefix, and it is re-derived from the
      // edge demands each round anyway, so extrapolating it would only let it
      // disagree with the numbers it came from.
      const dispDelta =
        clampUtilization(disp.get(info.id) ?? 1) -
        clampUtilization(output.disposalNext.get(info.id) ?? 1);
      // demWant converges like disposal: counted here, never extrapolated
      // (the jump below routes keys into cap or dem only).
      const demWDelta =
        clampUtilization(demW.get(info.id) ?? 1) -
        clampUtilization(output.demWantNext.get(info.id) ?? 1);
      maxDelta = Math.max(
        maxDelta,
        Math.abs(capDelta),
        Math.abs(demDelta),
        Math.abs(dispDelta),
        Math.abs(demWDelta),
      );
    }

    // The lagged auxiliary state is part of the fixed point too. Watching
    // only the four vectors, a board could repeat them exactly for one round
    // while the priority tranches were still moving, stop, and report a
    // round computed from mid-flight tranches - the silicone board read its
    // LCR's inputs at one level and its outputs at another. Both figures are
    // normalized onto the same utilization scale the vector deltas use.
    for (const [budgetKey, budget] of budgets) {
      if (budget.makePerSecond <= EPSILON) {
        continue;
      }
      const prev = unconditionalByBudget.get(budgetKey) ?? 0;
      const next = output.unconditionalNext.get(budgetKey) ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(next - prev) / budget.makePerSecond);
    }
    for (const poolKey of pools.keys()) {
      const prev = poolInflow.get(poolKey) ?? 0;
      const next = output.poolInflowNext.get(poolKey) ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(next - prev) / Math.max(1, prev, next));
    }

    for (const info of machineNodes) {
      // The power-stalled machines stay pinned at zero across rounds;
      // everything else follows the fill.
      if (powerStalledNodes.has(info.id)) {
        continue;
      }
      cap.set(info.id, output.capNext.get(info.id) ?? 1);
      dem.set(info.id, output.demNext.get(info.id) ?? 1);
      demW.set(info.id, output.demWantNext.get(info.id) ?? 1);
      disp.set(info.id, output.disposalNext.get(info.id) ?? 1);
    }
    poolInflow = output.poolInflowNext;
    unconditionalByBudget = output.unconditionalNext;

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
    const demWValue = demW.get(info.id) ?? 1;
    if (Number.isFinite(demWValue) && demWValue < ZERO_SNAP) {
      demW.set(info.id, 0);
    }
  }
  return runRound();
  };

  let lastRound = descend();

  interface DeadRing {
    /** Ring-internal needs, each with the ring wires an anchor grant lands on. */
    anchoredNeeds: Map<string, PreparedEdge[]>;
    /** needKey -> `${ring}|${resourceKey}` allowance bucket. */
    bucketByNeed: Map<string, string>;
    /** Bucket -> the ring budgets and pools that measure its own supply. */
    supplyByBucket: Map<string, { budgetKeys: string[]; poolKeys: string[] }>;
  }

  const findDeadRings = (): DeadRing[] => {
    // Vertices: machines that converged to (at most dust above) zero
    // capability, plus every drawer (a ring may pass through a buffer). Live
    // machines are pruned FIRST, so any cycle that survives is dead wall to
    // wall - the exact signature the dead-loop badge fires on, at the same
    // threshold the badge uses.
    const vertices = new Set<string>();
    for (const info of machineNodes) {
      if ((cap.get(info.id) ?? 1) <= DEAD_RING_EPSILON) {
        vertices.add(info.id);
      }
    }
    for (const poolKey of pools.keys()) {
      vertices.add(poolKey);
    }
    const outgoing = new Map<string, string[]>();
    const selfLooped = new Set<string>();
    for (const edge of edges) {
      if (!vertices.has(edge.sourceId) || !vertices.has(edge.targetId)) {
        continue;
      }
      const bucket = outgoing.get(edge.sourceId);
      if (bucket) {
        bucket.push(edge.targetId);
      } else {
        outgoing.set(edge.sourceId, [edge.targetId]);
      }
      if (edge.sourceId === edge.targetId) {
        selfLooped.add(edge.sourceId);
      }
    }

    const rings: DeadRing[] = [];
    for (const component of stronglyConnectedComponents([...vertices], outgoing)) {
      if (component.length < 2 && !selfLooped.has(component[0]!)) {
        continue;
      }
      const members = new Set(component);
      if (!component.some((id) => infoById.has(id))) {
        continue;
      }
      const ringIndex = rings.length;
      const anchoredNeeds = new Map<string, PreparedEdge[]>();
      const bucketByNeed = new Map<string, string>();
      const supplyByBucket = new Map<string, { budgetKeys: string[]; poolKeys: string[] }>();
      for (const [needKey, need] of needs) {
        if (!members.has(need.targetId)) {
          continue;
        }
        const anchorEdges = [...need.machineEdges, ...need.storageEdges].filter((edge) =>
          members.has(edge.sourceId),
        );
        if (anchorEdges.length === 0) {
          continue;
        }
        anchoredNeeds.set(needKey, anchorEdges);
        const bucket = `${ringIndex}|${need.demandKey}`;
        bucketByNeed.set(needKey, bucket);
        if (!supplyByBucket.has(bucket)) {
          const budgetKeys: string[] = [];
          for (const [budgetKey, budget] of budgets) {
            if (members.has(budget.ownerId) && budget.outputKey === need.demandKey) {
              budgetKeys.push(budgetKey);
            }
          }
          const poolKeys = [
            ...new Set(
              anchorEdges
                .filter((edge) => edge.poolKey && members.has(edge.poolKey))
                .map((edge) => edge.poolKey),
            ),
          ];
          supplyByBucket.set(bucket, { budgetKeys, poolKeys });
        }
      }
      if (anchoredNeeds.size === 0) {
        continue;
      }
      rings.push({ anchoredNeeds, bucketByNeed, supplyByBucket });
    }
    return rings;
  };

  // ---- THE BALANCED-RING RESCUE. --------------------------------------------
  // A ring that conserves its circulating goods EXACTLY (loop gain 1.0 - the
  // in-game cell loop: an electrolyzer eats 1 acid cell + 6 empty and hands
  // all 7 cells back through its canners) has a continuum of self-consistent
  // levels and no restoring force between them. The descent's transients -
  // fair-share splits taken while a sibling ceiling is still settling, a
  // drawer's one-round offer lag - each shave a little off the circulating
  // level, and with nothing to put a dip back (a SURPLUS ring re-inflates by
  // itself, which is why gain > 1 rings hold) the level ratchets down the
  // continuum to zero. In game the same ring, primed once, runs forever.
  //
  // So a ring whose machines all converged to zero CAPABILITY gets one
  // appeal: solve again with the ring's internal needs allowed to draw their
  // residual ask from an anchor - thin air, landing on the ring's own wires,
  // strictly after every real supplier, with potentials untouched so real
  // constraints (a short water line, machine counts) still pace the level.
  // The anchor is the solver's own version of the player priming the loop.
  // The verdict is read off the settled anchors themselves: a ring that
  // sustains itself leaves them idling at ~0/s (the workaround that exposed
  // this bug - a source drawer wired into the cell buffer - settles at 0/s
  // the same way), while a genuinely lossy ring leans on them every round,
  // and that rescue is thrown away in favour of the honest dead answer.
  {
    const deadRings = findDeadRings();
    if (deadRings.length > 0) {
      const saved = {
        cap: new Map(cap),
        dem: new Map(dem),
        demW: new Map(demW),
        disp: new Map(disp),
        lastRound,
      };
      let candidates = deadRings;
      let adopted = false;
      // If only SOME rings sustain, retry anchoring just those: a lossy
      // ring's anchor must not prop up its neighbours' verdicts. Each pass
      // strictly shrinks the set, so this ends.
      for (let attempt = 0; attempt <= deadRings.length && candidates.length > 0; attempt += 1) {
        activeAnchors = {
          needs: new Map(),
          bucketByNeed: new Map(),
          supplyByBucket: new Map(),
          allowanceByBucket: new Map(),
        };
        for (const ring of candidates) {
          for (const [needKey, anchorEdges] of ring.anchoredNeeds) {
            activeAnchors.needs.set(needKey, anchorEdges);
          }
          for (const [needKey, bucket] of ring.bucketByNeed) {
            activeAnchors.bucketByNeed.set(needKey, bucket);
          }
          for (const [bucket, supply] of ring.supplyByBucket) {
            activeAnchors.supplyByBucket.set(bucket, supply);
          }
        }
        const settled = descend();
        // Judged PER NEED against that need's own real flow, never against a
        // ring total: a ring's fluids run at hundreds of litres a second and
        // its cells at one, so a ring-relative gate waves through an anchor
        // that is quietly minting most of an item line (0.25/s of hydrogen
        // cells hid under 0.05% of a litre-dominated sum, and the plan made
        // empty cells from nothing).
        const sustained = candidates.filter((ring) => {
          for (const [needKey, anchorEdges] of ring.anchoredNeeds) {
            const anchorFlow = settled.anchorGrantByNeed.get(needKey) ?? 0;
            if (anchorFlow <= RING_ANCHOR_FLOOR) {
              continue;
            }
            let realFlow = 0;
            for (const edge of anchorEdges) {
              realFlow += settled.eatenByEdge.get(edge.id) ?? 0;
            }
            // The wires carry the anchor's own grant too; net it out.
            realFlow = Math.max(0, realFlow - anchorFlow);
            if (anchorFlow > Math.max(RING_ANCHOR_FLOOR, realFlow * RING_ANCHOR_TOLERANCE)) {
              return false;
            }
          }
          return true;
        });
        if (sustained.length === candidates.length) {
          lastRound = settled;
          adopted = true;
          break;
        }
        candidates = sustained;
      }
      activeAnchors = undefined;
      if (!adopted) {
        cap.clear();
        dem.clear();
        demW.clear();
        disp.clear();
        for (const [key, value] of saved.cap) cap.set(key, value);
        for (const [key, value] of saved.dem) dem.set(key, value);
        for (const [key, value] of saved.demW) demW.set(key, value);
        for (const [key, value] of saved.disp) disp.set(key, value);
        lastRound = saved.lastRound;
      }
    }
  }

  // ---- THE SETTLEMENT. -------------------------------------------------------
  // The converged answer can still CLAIM more than the wires deliver.
  // Capability is deliberately clog-blind (see the two offers in runRound),
  // so a consumer downstream of a clogged supplier converges wanting full
  // blast, reads capable of it, and eats material that never arrives - the
  // silicone board's chem reactor sat at "100%", minting 43.2 L/s of product
  // from a 0.03/s trickle of PDMS. The verdict layer is RIGHT to keep the
  // clog-blind reading - it is what says "one wire clears it" instead of
  // cascading one clog into a board of phantom shortages - but the settled
  // flows must conserve.
  //
  // So one last, separate fixed point, AFTER the verdicts are done: each
  // node's actual level is bounded by what its wires really delivered, and
  // the actual-flow side (desire asks, actual offers, sink absorption) is
  // re-run at that level - a starved machine releases its other ingredients'
  // unclaimed shares, its own output offer shrinks, and the bound chases
  // down its consumers hop by hop. None of it feeds back into cap/dem/disp,
  // so the diagnosis keeps naming the clog while the books keep the truth.
  // Boards whose deliveries already cover every claim - almost all of them -
  // skip this entirely and keep their figures bit for bit.
  const act = new Map<string, number>();
  const actBinders = new Map<string, ResourceKey>();
  {
    for (const info of machineNodes) {
      act.set(
        info.id,
        clampUtilization(
          Math.min(
            clampUtilization(cap.get(info.id) ?? 1),
            clampUtilization(dem.get(info.id) ?? 1),
            clampUtilization(disp.get(info.id) ?? 1),
          ),
        ),
      );
    }
    const deliveredBound = (
      round: RoundOutput,
      info: MachineNodeInfo,
    ): { bound: number; binder?: ResourceKey } => {
      let bound = 1;
      let binder: ResourceKey | undefined;
      for (const input of info.wiredInputs) {
        const need = needs.get(input.needKey);
        if (!need) {
          continue;
        }
        let delivered = 0;
        for (const edge of [...need.machineEdges, ...need.storageEdges]) {
          delivered += round.eatenByEdge.get(edge.id) ?? 0;
        }
        const ratio = clampUtilization(delivered / input.nameplatePerSecond);
        if (ratio < bound) {
          bound = ratio;
          binder = need.demandKey;
        }
      }
      return { bound, binder };
    };
    let needsSettling = false;
    for (const info of machineNodes) {
      const { bound, binder } = deliveredBound(lastRound, info);
      if (bound < (act.get(info.id) ?? 0) - CONVERGENCE_EPS) {
        needsSettling = true;
        if (binder !== undefined) {
          actBinders.set(info.id, binder);
        }
      }
    }
    if (needsSettling) {
      // The converged verdict levels are a hard ceiling: settlement only ever
      // removes flow the desire fill could not back, never invents any.
      const actCeiling = new Map(act);
      poolInflow = lastRound.poolInflowNext;
      unconditionalByBudget = lastRound.unconditionalNext;
      for (let pass = 0; pass < SETTLE_ROUNDS; pass += 1) {
        settleAct = act;
        const settled = runRound();
        rounds += 1;
        let maxDelta = 0;
        for (const info of machineNodes) {
          const { bound, binder } = deliveredBound(settled, info);
          const next = Math.min(actCeiling.get(info.id) ?? 0, bound);
          const previous = act.get(info.id) ?? 0;
          maxDelta = Math.max(maxDelta, Math.abs(next - previous));
          // The binder is only visible while the bound is DROPPING: at the
          // settled point every input of a throttled node ties at its level
          // (a machine at 10% eats 10% of everything), so the name is taken
          // from the pass that pulled it down.
          if (next < previous - CONVERGENCE_EPS && binder !== undefined) {
            actBinders.set(info.id, binder);
          }
          act.set(info.id, next);
        }
        poolInflow = settled.poolInflowNext;
        // Adopt the settled physical flows; demand, availability and the
        // unmet-desire book keep the last verdict round's story - what is
        // WANTED and what COULD arrive are diagnosis, not delivery.
        lastRound = {
          ...lastRound,
          eatenByEdge: settled.eatenByEdge,
          poolInflowNext: settled.poolInflowNext,
        };
        if (maxDelta < CONVERGENCE_EPS) {
          break;
        }
      }
      settleAct = undefined;
    }
  }

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
    disposalByNode: lastRound.disposalNext,
    clogOutputByNode: lastRound.clogOutputNext,
    actualByNode: act,
    actualLimitingInputByNode: actBinders,
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
  /** What each tank still holds after the fill (trash cans drain this). */
  remainingPool: Map<string, number>;
  /** First-shot storage requests per pool (the honest pull on each tank). */
  poolRequested: Map<string, number>;
  /** What each anchored need drew from the ring rescue's anchor (see below). */
  anchorGrants: Map<string, number>;
}

/**
 * Water-filling over the edge graph, in FOUR passes, and the order of the
 * passes is drain priority:
 *
 *   1. must-ship machine output   (the priority tranche: co-products of
 *                                  machines that run anyway - see the
 *                                  priority map in runRound)
 *   2. tanks                      (material already committed into a buffer)
 *   3. machine supply free to idle
 *   4. source drawers             (bottomless makeup, always last - including
 *                                  drawers with a SOURCE up their feed chain,
 *                                  which serve here on the chain's behalf)
 *
 * A consumer therefore drinks what EXISTS before asking anybody to make more,
 * and asks everybody real before touching the infinite drawer. This is what
 * lets a byproduct return-feed or a recycling loop be drained first while the
 * honest supply line paces down to cover the difference - the fix for the
 * whole-board collapse a closed loop used to cause. Within every pass the
 * max-min rule stands unchanged: each hungry line gets an equal share of a
 * contended budget, small askers saturate, and the slack is re-offered, so a
 * 2000/s zombie ask still cannot crush a 10/s asker out of its trickle.
 * Grant factors are frozen per budget per round so iteration order cannot
 * shortchange later edges.
 */
/**
 * The balanced-ring rescue's anchor plan: which needs may draw on the anchor,
 * on which ring wires the draw lands, and - per allowance bucket
 * (`${ring}|${resourceKey}`) - which ring budgets and pools measure the
 * ring's own supply of the resource. The anchor may REDISTRIBUTE that supply
 * (cover a fair-split transient that starved one ring member while another
 * over-claimed), never invent beyond it: without the bound, a demand-pinned
 * ring member would happily run flat out on conjured material and the rescue
 * would always read "lossy" and reject itself.
 */
interface RingAnchorPlan {
  needs: Map<string, PreparedEdge[]>;
  bucketByNeed: Map<string, string>;
  supplyByBucket: Map<string, { budgetKeys: string[]; poolKeys: string[] }>;
  /** Per bucket, this round's capability-measured ring supply of the
   * resource. Stamped by runRound before the fills run. */
  allowanceByBucket: Map<string, number>;
}

function runFill(
  needs: Map<string, Need>,
  budgetOfferBase: Map<string, number>,
  poolOfferBase: Map<string, number>,
  asks: Map<string, number>,
  unconditionalByBudget: Map<string, number>,
  backedPools: Set<string>,
  anchors?: RingAnchorPlan,
): FillResult {
  const remainingBudget = new Map(budgetOfferBase);
  const remainingPool = new Map(poolOfferBase);
  const remainingNeed = new Map<string, number>();
  const grants = new Map<string, number>();
  for (const [needKey] of needs) {
    remainingNeed.set(needKey, asks.get(needKey) ?? 0);
  }

  // The priority tranche, bounded by what the budget can offer at all this
  // round (a must-ship rate above a throttled offer is wishful thinking).
  const remainingUnconditional = new Map<string, number>();
  for (const [budgetKey, amount] of unconditionalByBudget) {
    const capped = Math.min(amount, remainingBudget.get(budgetKey) ?? 0);
    if (capped > EPSILON) {
      remainingUnconditional.set(budgetKey, capped);
    }
  }

  const runMachinePass = (tranche: Map<string, number> | undefined) => {
    for (let round = 0; round < MACHINE_FILL_ROUNDS; round += 1) {
      const requestByEdge = new Map<PreparedEdgeRef, number>();
      for (const [needKey, need] of needs) {
        const rem = remainingNeed.get(needKey) ?? 0;
        if (rem <= EPSILON) {
          continue;
        }
        const liveEdges = need.machineEdges.filter((edge) => {
          if ((remainingBudget.get(edge.budgetKey) ?? 0) <= EPSILON) {
            return false;
          }
          return tranche === undefined || (tranche.get(edge.budgetKey) ?? 0) > EPSILON;
        });
        if (liveEdges.length === 0) {
          continue;
        }
        const perEdge = rem / liveEdges.length;
        for (const edge of liveEdges) {
          requestByEdge.set(edge, perEdge);
        }
      }

      if (requestByEdge.size === 0) {
        break;
      }

      const liveCountByBudget = new Map<string, number>();
      for (const [edge] of requestByEdge) {
        liveCountByBudget.set(edge.budgetKey, (liveCountByBudget.get(edge.budgetKey) ?? 0) + 1);
      }
      const shareByBudget = new Map<string, number>();
      for (const [budgetKey, liveCount] of liveCountByBudget) {
        const available = Math.min(
          remainingBudget.get(budgetKey) ?? 0,
          tranche === undefined
            ? Number.POSITIVE_INFINITY
            : (tranche.get(budgetKey) ?? 0),
        );
        shareByBudget.set(budgetKey, available / Math.max(1, liveCount));
      }

      let granted = 0;
      for (const [edge, request] of requestByEdge) {
        const grant = Math.min(request, shareByBudget.get(edge.budgetKey) ?? 0);
        if (grant <= EPSILON) {
          continue;
        }
        grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
        remainingBudget.set(edge.budgetKey, (remainingBudget.get(edge.budgetKey) ?? 0) - grant);
        if (tranche !== undefined) {
          tranche.set(edge.budgetKey, (tranche.get(edge.budgetKey) ?? 0) - grant);
        }
        remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
        granted += grant;
      }
      if (granted <= EPSILON) {
        break;
      }
    }
  };

  const grantsByPool = new Map<string, number>();
  const runStoragePass = (finitePools: boolean) => {
    for (let round = 0; round < STORAGE_FILL_ROUNDS; round += 1) {
      const requestByEdge = new Map<PreparedEdgeRef, number>();
      for (const [needKey, need] of needs) {
        const rem = remainingNeed.get(needKey) ?? 0;
        if (rem <= EPSILON) {
          continue;
        }
        const liveEdges = need.storageEdges.filter((edge) => {
          const pool = remainingPool.get(edge.poolKey) ?? 0;
          if (finitePools) {
            return Number.isFinite(pool) && pool > EPSILON;
          }
          // The last pass also serves lines whose drawer has a SOURCE
          // somewhere up its feed chain: the drawer's own stock was the
          // finite pass's business, and what is still wanted pulls through
          // the chain (the transfer settlement writes it onto those wires).
          return !Number.isFinite(pool) || backedPools.has(edge.poolKey);
        });
        if (liveEdges.length === 0) {
          continue;
        }
        const perEdge = rem / liveEdges.length;
        for (const edge of liveEdges) {
          requestByEdge.set(edge, perEdge);
        }
      }

      if (requestByEdge.size === 0) {
        break;
      }

      const liveCountByPool = new Map<string, number>();
      for (const [edge] of requestByEdge) {
        liveCountByPool.set(edge.poolKey, (liveCountByPool.get(edge.poolKey) ?? 0) + 1);
      }
      const shareByPool = new Map<string, number>();
      for (const [poolKey, liveCount] of liveCountByPool) {
        const pool = remainingPool.get(poolKey) ?? 0;
        // A backed pool in the last pass hands out on its chain's behalf, so
        // its own (spent) stock is no ceiling.
        const bottomless =
          !Number.isFinite(pool) || (!finitePools && backedPools.has(poolKey));
        shareByPool.set(
          poolKey,
          bottomless ? Number.POSITIVE_INFINITY : pool / Math.max(1, liveCount),
        );
      }

      let granted = 0;
      for (const [edge, request] of requestByEdge) {
        const grant = Math.min(request, shareByPool.get(edge.poolKey) ?? 0);
        if (grant <= EPSILON) {
          continue;
        }
        grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
        grantsByPool.set(edge.poolKey, (grantsByPool.get(edge.poolKey) ?? 0) + grant);
        const pool = remainingPool.get(edge.poolKey) ?? 0;
        if (Number.isFinite(pool)) {
          // Floored: a chain-served grant is the SOURCE's material, not this
          // drawer's, and must not drive its stock below empty.
          remainingPool.set(edge.poolKey, Math.max(0, pool - grant));
        }
        remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
        granted += grant;
      }
      if (granted <= EPSILON) {
        break;
      }
    }
  };

  runMachinePass(remainingUnconditional);
  runStoragePass(true);
  runMachinePass(undefined);
  runStoragePass(false);

  // THE RING ANCHOR, last of all - after every real supplier has spoken. A
  // need inside a ring under rescue (see the balanced-ring rescue in
  // solveEquilibrium) may draw its residual ask against the ring's own supply
  // of the resource, landing the grant on the ring's own wires. `anchorGrants`
  // is the rescue's evidence: a ring that sustains itself leaves its anchor
  // idling at ~0/s once settled, a lossy ring leans on it every round and the
  // rescue is thrown away.
  const anchorGrants = new Map<string, number>();
  if (anchors) {
    // The bound is per CONSUMER, not per resource: no single ring member may
    // end up holding more of a resource than the ring's whole capability on
    // it (`allowanceByBucket`, stamped by runRound - capability, never the
    // throttled actual, because a primed loop's banked stock covers a dip at
    // the sustainable level). Across consumers the sum may transiently
    // double-book - that is exactly the wobble the stock exists to absorb
    // when a fair split hands one member's share to a sibling whose own
    // ceiling has not settled yet - and the rescue's validation (anchors idle
    // once settled) guarantees no double-booking survives to the answer. A
    // demand-pinned member still cannot conjure supply: its real grants
    // already reach the ring's capability, so its anchor stays shut.
    for (const [needKey, anchorEdges] of anchors.needs) {
      const rem = remainingNeed.get(needKey) ?? 0;
      const bucket = anchors.bucketByNeed.get(needKey);
      if (rem <= EPSILON || anchorEdges.length === 0 || bucket === undefined) {
        continue;
      }
      const capability = anchors.allowanceByBucket.get(bucket) ?? 0;
      let granted = 0;
      for (const edge of anchorEdges) {
        granted += grants.get(edge.id) ?? 0;
      }
      const grant = Math.min(rem, Math.max(0, capability - granted));
      if (grant <= EPSILON) {
        continue;
      }
      const share = grant / anchorEdges.length;
      for (const edge of anchorEdges) {
        grants.set(edge.id, (grants.get(edge.id) ?? 0) + share);
        // An anchored draw through a drawer still reads as pull on that
        // drawer, so its feeders keep stocking it while the ring recovers.
        if (edge.poolKey) {
          grantsByPool.set(edge.poolKey, (grantsByPool.get(edge.poolKey) ?? 0) + share);
        }
      }
      anchorGrants.set(needKey, grant);
      remainingNeed.set(needKey, rem - grant);
    }
  }

  // The honest pull on each tank: what it actually gave, plus its share of
  // whatever the consumers still want after every supplier has spoken.
  const poolRequested = new Map(grantsByPool);
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

  return { grants, remainingNeed, remainingBudget, remainingPool, poolRequested, anchorGrants };
}

type PreparedEdgeRef = Pick<PreparedEdge, "id" | "budgetKey" | "needKey" | "poolKey">;

/**
 * Project-level target rate, split across producers of the target resource
 * that have no outgoing wire for it (the plan's terminal makers).
 */
/**
 * Producers that carry the plan's target rate: the ones with nowhere for the
 * target resource to go except out of the plan.
 *
 * A wire into a DRAIN or a trash can does NOT count as somewhere it goes.
 * Those accept without asking, so a node that drains its product is still the
 * end of the line and still on the hook for the rate you dialled. That matters
 * far more than it used to: draining the product IS how a closed plan says
 * "this is the thing I make", so without this exception dialling a target and
 * then declaring your export would silently cancel the target.
 *
 * Shared with the reporting pass in throughput.ts, which has to pick the same
 * nodes or the two would disagree about who owes the rate.
 */
export function selectProjectTargetNodes(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  targetKey: ResourceKey,
): FactoryProject["nodes"] {
  const roles = getStorageRoles(project);
  const trashIds = collectTrashNodeIds(project);
  return project.nodes.filter(
    (node) =>
      nodes[node.id]?.outputs[targetKey] !== undefined &&
      !project.edges.some(
        (edge) =>
          edge.source === node.id &&
          makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey &&
          !trashIds.has(edge.target) &&
          !isDrainRole(roles.get(edge.target) ?? "idle"),
      ),
  );
}

function calculateProjectTargetShares(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
): Map<string, { key: ResourceKey; amountPerSecond: number }> {
  const shares = new Map<string, { key: ResourceKey; amountPerSecond: number }>();
  if (!project.targetRate) {
    return shares;
  }

  const targetKey = makeResourceKey(project.targetRate.kind, project.targetRate.resourceId);
  const terminal = selectProjectTargetNodes(project, nodes, targetKey);
  if (terminal.length === 0) {
    return shares;
  }

  const share = project.targetRate.amountPerSecond / terminal.length;
  for (const node of terminal) {
    shares.set(node.id, { key: targetKey, amountPerSecond: share });
  }
  return shares;
}

/**
 * Strongly connected components, iteratively (Tarjan).
 *
 * Iterative on purpose: a 1,200-node plan is a supported board size and a
 * recursive walk over a long chain blows the stack. One pass, O(nodes+edges).
 * The balanced-ring rescue uses it here; death-spiral.ts imports it for the
 * board's dead-loop badges, so the two always agree on what a ring is.
 */
export function stronglyConnectedComponents(
  nodeIds: string[],
  outgoing: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodeIds) {
    if (index.has(root)) {
      continue;
    }

    // Explicit work stack: (node, how far through its edge list we are).
    const work: Array<{ id: string; edge: number }> = [{ id: root, edge: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const frameEdges = outgoing.get(frame.id) ?? [];

      if (frame.edge < frameEdges.length) {
        const next = frameEdges[frame.edge]!;
        frame.edge += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ id: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(next)!));
        }
        continue;
      }

      // Every edge walked: close this node out.
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) {
            break;
          }
        }
        components.push(component);
      }
    }
  }

  return components;
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
