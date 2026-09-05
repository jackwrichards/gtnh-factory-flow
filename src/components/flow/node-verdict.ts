import type {
  EdgeThroughput,
  FactoryProject,
  NodeThroughputResult,
  Recipe,
  ResourceAmount,
  ResourceKind,
  ThroughputResult,
} from "@/lib/model/types";
import { isRecipeInputConsumed, makeResourceKey } from "@/lib/model";
import { findDeathSpirals, type DeathSpiral } from "./death-spiral";
import { findClogLocks, type ClogLock } from "./clog-lock";
import { findBareSlots } from "./bare-slots";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { collectTrashNodeIds } from "@/lib/model/trash";
import { describeStorage, getStorageRole, getStorageRoles } from "@/lib/model/storage-role";
import { makeResourceHandleId } from "./resource-handles";
import { getSetupRules, type ResolvedSetupRules } from "@/lib/model/setup-rules";
import { energyPerUnit } from "@/lib/model/rate-unit";

type ProjectEdge = FactoryProject["edges"][number];

/**
 * The node-level verdict that replaces the bare "Usage %": one state derived
 * from the solver's three separate facts (utilization, what the inputs would
 * allow, what downstream asks), plus the cause and the concrete next action.
 *
 * Two independent questions decide it, both measured against this card's own
 * full blast at its current machine count:
 *
 *   are the inputs short?   `capableUtilization` < 1
 *   is anyone going without? a `deficit` on some output
 *
 *                 | nobody waiting | someone waiting
 *   inputs fine   | balanced /     | BOTTLENECK
 *                 | demand-set     | (add machines HERE)
 *   inputs short  | STARVED        | BLOCKED
 *                 | (nothing to do)| (the fix is upstream)
 *
 * Two more states sit ABOVE that table, because in a closed plan a machine is
 * bounded at both ends and neither of the two words above should ever be made
 * to mean "you have not finished wiring it".
 *
 * UNWIRED is first and beats everything: some slot, input or output, has no
 * wire on it. Nothing declares where that ingredient comes from or where that
 * product goes, so the machine is at zero, and there is no arithmetic to
 * explain - the card just marks every bare slot and you go and connect them.
 * A SOURCE or DRAIN drawer counts as connecting one, which is how a plan says
 * "this part I bring in myself" out loud.
 *
 * CLOGGED is next, and only ever applies to a FULLY WIRED card: everything is
 * connected, and a wired output still cannot shift what it makes, because its
 * takers want less than the machine produces and no drain or can is there to
 * take the rest. The machine runs only as fast as that output empties. It is
 * not a fault - a plan that makes 10 redstone and only wants 5 is a normal
 * plan - so it is stated, not scolded: the card says where the surplus is and
 * offers the honest ways out.
 *
 * The doctrine that follows: running below 100% is not a fault. A machine
 * that hands every asker what it asked for is FINE, whatever its percent
 * reads. Only an unmet ask is a problem, and only when the inputs are already
 * covered is this card the place to fix it. Follow BLOCKED cards upstream and
 * you always arrive at a bottleneck, a dialled source, or a DEAD LOOP — so
 * the red cards are the whole to-do list.
 *
 * That walk only terminates because `dead-loop` exists. In a ring, A blames
 * B, B blames C and C blames A, so without a state that names the ring the
 * advice chases itself forever. See death-spiral.ts.
 */
export type NodeVerdictKind =
  | "off"
  | "no-recipe"
  | "unwired"
  | "starved"
  | "blocked"
  | "bottleneck"
  | "clogged"
  | "dead-loop"
  | "clog-lock"
  | "demand-set"
  | "paced"
  | "balanced";

/**
 * The two supply-short states. Both mean "the inputs, not this card, set the
 * speed", so every reader that used to test the old single `starved` kind
 * wants this instead.
 */
export function isSupplyShort(kind: NodeVerdictKind): boolean {
  return kind === "starved" || kind === "blocked";
}

/** The machine (or buffer) to go fix on a starved line, with its own state. */
export interface UpstreamCulprit {
  name: string;
  kind: "machine" | "buffer" | "loop";
  /** The culprit's own speed as a display percent; buffers read 100. */
  pct: number;
  /** True when the culprit runs flat out — adding machines there helps. */
  atFullSpeed: boolean;
  /**
   * True when the culprit COULD run faster (its own inputs allow it) — it
   * isn't starving, the damped ask just isn't pulling it. Advice is still
   * "act there" (+machines/tier), never "fix above it".
   */
  hasHeadroom: boolean;
  /** Machines to add at the culprit to close this gap, when computable. */
  machinesToAdd?: number;
  /** The culprit's CURRENT machine count, so advice reads "×6 → ×15". */
  machineCount?: number;
}

export interface NodeVerdict {
  kind: NodeVerdictKind;
  /** Clamped display percentage, 0-100. */
  pct: number;
  /** Starved/blocked: the input that pins the machine below what's asked. */
  binding?: {
    resourceKey: string;
    kind: ResourceKind;
    displayName: string;
    /** What actually arrives on the connected lines. */
    suppliedPerSecond: number;
    /** What the demanded speed would eat. */
    neededPerSecond: number;
    /** Rate still missing versus the demanded speed. */
    shortfallPerSecond: number;
    /** Who to fix: the machine/buffer on the short line, if identifiable. */
    upstreamName?: string;
    upstream?: UpstreamCulprit;
    /**
     * Inputs tied with this one at the limit (within the solver's tie
     * window): the figures cannot distinguish them, so the UI marks them
     * all and says so instead of crowning one arbitrarily.
     */
    tiedKeys?: string[];
    tiedWithNames?: string[];
  };
  /** The worst unmet ask across this node's outputs — someone goes without. */
  deficit?: {
    resourceKey: string;
    kind: ResourceKind;
    displayName: string;
    missingPerSecond: number;
    /**
     * Machines to add so EVERY hungry output is fed (machine count scales all
     * outputs together, so this is the max of the per-output requirements).
     */
    machinesToAdd?: number;
    /**
     * How far past full blast the asks reach, as a percent ("over-asked by
     * 40%"). Measured on the worst output against its nameplate rate, so it
     * stays coherent with `machinesToAdd` — the same ratio, rounded up.
     */
    overAskPct?: number;
    /** How many outputs are over-asked right now (they're independent). */
    hungryOutputs: number;
    /** How many outputs have anything plugged in at all. */
    pluggedOutputs: number;
  };
  /**
   * Unwired: every slot with no wire on it, both ends, so the card can mark
   * them all rather than crowning one. These are the things to go and connect.
   */
  bare?: {
    inputs: Array<{ resourceKey: string; kind: ResourceKind; displayName: string }>;
    outputs: Array<{ resourceKey: string; kind: ResourceKind; displayName: string }>;
  };
  /** Clogged: the output that has nowhere to go, and how much piles up. */
  clog?: {
    resourceKey: string;
    kind: ResourceKind;
    displayName: string;
    /** Rate this output would make at the speed the plan wants. */
    madePerSecond: number;
    /** Rate anything downstream actually takes. */
    takenPerSecond: number;
    /** The difference: what would pile up with nowhere to put it. */
    surplusPerSecond: number;
    /** Percentage points this card would climb if the surplus had a home. */
    heldBackPct: number;
    /**
     * Set when nothing takes the output because every machine that would is
     * itself stopped: the card is waiting on THAT machine, not on a drawer.
     */
    stoppedTakerName?: string;
    /**
     * Set when the output's takers all run but none can take more: the
     * card is held at their pace, and their own cards say what holds them.
     */
    heldTakerName?: string;
    /** The held taker's own speed, display percent, for the hover. */
    heldTakerPct?: number;
  };
  /** Dead-loop: the ring this card is trapped in, and who else is in it. */
  spiral?: DeathSpiral;
  /** Clog-lock: the jam this card is frozen in, and the surpluses to home. */
  clogLock?: ClogLock;
  /** Clog-lock only: whose card this verdict sits on, so the hover can tell
   * a vent site's first-person story apart from a victim's. */
  clogLockNodeId?: string;
}

/** Half a percent: below this, converged solver states are just float noise. */
const VERDICT_EPSILON = 0.005;
const RATE_EPSILON = 1e-6;

function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * What the consumer on this edge truly asks for. The solver's converged
 * `demandPerSecond` is self-damped (it collapses to whatever was shipped, by
 * design, to stay stable), so the honest ask is the nameplate one whenever
 * the consumer is genuinely capability-starved — flagged by the solver
 * (constraint "supply") OR read off the consumer itself, because the damping
 * can also keep the flag from ever being raised (a starving reactor whose
 * ask collapsed leaves its furnace looking "demand-set"). Deliberately
 * throttled consumers (true demand-set) never beg. Everything the UI says
 * about hunger must go through here — never the damped figure directly.
 */
export function honestEdgeAskPerSecond(
  edgeResult: EdgeThroughput | undefined,
  targetResult?: NodeThroughputResult,
  edge?: Pick<ProjectEdge, "resourceKind" | "resourceId">,
): number {
  if (!edgeResult) {
    return 0;
  }
  const nameplate = edgeResult.nameplateDemandPerSecond ?? 0;
  const damped = edgeResult.demandPerSecond ?? 0;
  if (edgeResult.constraint === "supply") {
    return Math.max(nameplate, damped);
  }
  if (targetResult) {
    const capable = clamp01(targetResult.capableUtilization, 1);
    const demand = clamp01(targetResult.demandUtilization, capable);
    const demandSet = demand < capable - VERDICT_EPSILON && demand < 1 - VERDICT_EPSILON;
    // Beg at nameplate ONLY on the consumer's actually-limiting input.
    // A starved machine's OTHER lines ask for what it can really eat —
    // apples-and-oranges: short on oranges at 50% means the apple line
    // honestly asks for half the apples, and the apple maker is FINE.
    const limitsThisLine =
      edge === undefined ||
      targetResult.limitingInputKey === undefined ||
      makeResourceKey(edge.resourceKind, edge.resourceId) === targetResult.limitingInputKey ||
      targetResult.limitingInputTiedKeys?.includes(
        makeResourceKey(edge.resourceKind, edge.resourceId),
      ) === true;
    if (!demandSet && capable < 1 - VERDICT_EPSILON && limitsThisLine) {
      return Math.max(nameplate, damped);
    }
  }
  return damped;
}

/**
 * What a supply line could HONESTLY deliver — the edge-label book, the one
 * Jack verified against reality:
 * - a non-dry buffer grants whatever is asked (Infinity: never a cap);
 * - a machine line whose producer has this as its sole outlet can deliver
 *   the producer's full-blast capacity (`sourceCapacityPerSecond`);
 * - otherwise fall back to the allocation figure (damped, least trusted).
 * The allocation-only version of this is what mis-crowned bottlenecks: the
 * ask coupling drags innocent lines' allocations down to the binder's level.
 */
/**
 * What a buffer can honestly hand ONE of its consumers.
 *
 * A tank with no reserve cannot deliver more than it receives, so once the
 * asks on it exceed its inflow, that inflow is a REAL ceiling: the shortage
 * just moved one hop upstream and the consumer is still starved by it. While
 * the tank covers everyone it stays Infinity, which is what keeps a buffer
 * from becoming a false ceiling (the rule that killed "could deliver 0%").
 * A tank with no inbound lines is hand-stocked: assumed never dry.
 */
export function bufferRelaySupplyPerSecond(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  storageId: string,
  edgeId: string,
): number {
  const index = getBufferRelayIndex(project, result);
  // No inbound lines: hand-stocked, assumed never dry.
  if ((index.inflowEdges.get(storageId) ?? 0) === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const inflow = index.inflow.get(storageId) ?? 0;
  const asks = index.asks.get(storageId) ?? 0;
  // Still covering everyone: not a ceiling, and must never become a false one.
  if (asks <= inflow + RATE_EPSILON) {
    return Number.POSITIVE_INFINITY;
  }
  const ownAsk = index.edgeAsk.get(edgeId) ?? 0;
  return inflow * (asks > RATE_EPSILON ? ownAsk / asks : 1);
}

/**
 * Per-buffer inflow and asks, resolved in one pass over the edges.
 *
 * The scan used to live inside bufferRelaySupplyPerSecond, which made it
 * O(edges) per buffer-fed input — and it is called from per-node code, so the
 * board would have paid O(nodes × edges) on every solver tick. The index is
 * built once per (project, result) pair and every lookup after that is O(1).
 */
interface BufferRelayIndex {
  inflow: Map<string, number>;
  inflowEdges: Map<string, number>;
  asks: Map<string, number>;
  edgeAsk: Map<string, number>;
}

// Keyed on object identity: the solver hands out a fresh result per tick, so a
// stale index can never outlive the numbers it was built from.
const bufferRelayIndexCache = new WeakMap<
  FactoryProject,
  { result: ThroughputResult | undefined; index: BufferRelayIndex }
>();

function getBufferRelayIndex(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): BufferRelayIndex {
  const cached = bufferRelayIndexCache.get(project);
  if (cached && cached.result === result) {
    return cached.index;
  }
  const index: BufferRelayIndex = {
    inflow: new Map(),
    inflowEdges: new Map(),
    asks: new Map(),
    edgeAsk: new Map(),
  };
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  if (storageIds.size > 0) {
    for (const edge of project.edges) {
      if (storageIds.has(edge.target)) {
        index.inflowEdges.set(edge.target, (index.inflowEdges.get(edge.target) ?? 0) + 1);
        index.inflow.set(
          edge.target,
          (index.inflow.get(edge.target) ?? 0) +
            (result?.edges[edge.id]?.transferredPerSecond ?? 0),
        );
      }
      if (storageIds.has(edge.source)) {
        const ask = honestEdgeAskPerSecond(
          result?.edges[edge.id],
          result?.nodes[edge.target],
          edge,
        );
        index.edgeAsk.set(edge.id, ask);
        index.asks.set(edge.source, (index.asks.get(edge.source) ?? 0) + ask);
      }
    }
  }
  bufferRelayIndexCache.set(project, { result, index });
  return index;
}

/** A machine that could turn at all: powered, and inputs allowing something. */
function isMachineAbleToRun(nodeResult: NodeThroughputResult | undefined): boolean {
  if (!nodeResult) {
    return true;
  }
  if (nodeResult.powerStalled) {
    return false;
  }
  return clamp01(nodeResult.capableUtilization, 1) > VERDICT_EPSILON;
}

/**
 * A machine stopped by its own unfinished setup - no power for its hatches,
 * or a slot with no wire on it - as opposed to one stopped by what its
 * neighbours do. Its card already says so; every neighbour's card should
 * point at it rather than tell a story of its own.
 */
function isStoppedBySetup(
  nodeResult: NodeThroughputResult | undefined,
  incoming: ProjectEdge[],
  outgoing: ProjectEdge[],
  rules: ResolvedSetupRules,
): boolean {
  if (!nodeResult) {
    return false;
  }
  if (nodeResult.powerStalled) {
    return true;
  }
  return findBareSlots(nodeResult, incoming, outgoing, rules) !== undefined;
}

/**
 * The output that holds this card at a dead stop because every machine
 * taking it has stopped. Walks through drawers to the machines behind them;
 * a port with no machine takers at all (a drawer only, a can) is never it.
 */
function findStoppedTakerClog(
  project: FactoryProject,
  result: ThroughputResult,
  nodeResult: NodeThroughputResult,
  outgoing: ProjectEdge[],
): NodeVerdict["clog"] {
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const recipeById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const nodeById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const outgoingBy = outgoingByNode(project);
  const capable = clamp01(nodeResult.capableUtilization, 1);
  const utilization = clamp01(nodeResult.utilization, 0);
  for (const [key, flow] of Object.entries(nodeResult.outputs).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (flow.amountPerSecond <= RATE_EPSILON || flow.kind === "power") {
      continue;
    }
    const edges = outgoing.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    if (edges.length === 0) {
      continue;
    }
    let transferred = 0;
    for (const edge of edges) {
      transferred += result.edges[edge.id]?.transferredPerSecond ?? 0;
    }
    if (transferred > RATE_EPSILON) {
      continue;
    }
    const takers = new Set<string>();
    const seen = new Set<string>();
    const walk = (edgesOut: ProjectEdge[]) => {
      for (const edge of edgesOut) {
        if (storageIds.has(edge.target)) {
          if (!seen.has(edge.target)) {
            seen.add(edge.target);
            walk(outgoingBy.get(edge.target) ?? []);
          }
        } else if (nodeById.has(edge.target)) {
          takers.add(edge.target);
        }
      }
    };
    walk(edges);
    if (takers.size === 0) {
      continue;
    }
    let stoppedTaker: string | undefined;
    let allStopped = true;
    for (const taker of takers) {
      const takerResult = result.nodes[taker];
      const takerNode = nodeById.get(taker);
      const stopped =
        takerNode?.enabled === false ||
        !takerResult ||
        takerResult.status === "missing-recipe" ||
        clamp01(takerResult.utilization, 0) <= VERDICT_EPSILON;
      if (!stopped) {
        allStopped = false;
        break;
      }
      if (stoppedTaker === undefined) {
        const recipe = takerNode ? recipeById.get(takerNode.recipeId) : undefined;
        stoppedTaker = recipe?.machineType ?? recipe?.name ?? takerResult?.recipeName;
      }
    }
    if (!allStopped) {
      continue;
    }
    const made = flow.amountPerSecond * capable;
    return {
      resourceKey: key,
      kind: flow.kind,
      displayName: flow.displayName ?? flow.resourceId ?? key,
      madePerSecond: made,
      takenPerSecond: 0,
      surplusPerSecond: made,
      heldBackPct: Math.max(0, Math.round((capable - utilization) * 1000) / 10),
      stoppedTakerName: stoppedTaker,
    };
  }
  return undefined;
}

/**
 * The output that holds a FED card below the speed its hungry takers want.
 *
 * The books never idle a fed machine with somewhere to put its output, so a
 * card whose inputs are covered, whose one output is over-asked and which
 * still sits below full speed is being held by ANOTHER output: every wire
 * on it lands on a machine that cannot take more, and no drawer absorbs
 * the rest. That is a clog, one machine removed - two more of this card
 * would only make more of the stuck thing. The old diagnosis filed the
 * taker's smaller ask as demand, so `clogOutputKey` never named it and the
 * card fell through to BOTTLENECK with advice to add machines here.
 *
 * Prefers an output whose taker is visibly held (clogged, stopped, or at
 * full speed) over one merely pacing, so the name on the hover is the card
 * whose own story explains this one.
 */
function findHeldOutputClog(
  project: FactoryProject,
  result: ThroughputResult,
  nodeResult: NodeThroughputResult,
  outgoing: ProjectEdge[],
  hungryKey: string,
  utilization: number,
  wanted: number,
): NodeVerdict["clog"] {
  let best: { rank: number; clog: NonNullable<NodeVerdict["clog"]> } | undefined;
  for (const [key, flow] of Object.entries(nodeResult.outputs).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (key === hungryKey || flow.amountPerSecond <= RATE_EPSILON || flow.kind === "power") {
      continue;
    }
    const edges = outgoing.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    if (edges.length === 0) {
      continue;
    }
    const takers = machineTakersBehindOutput(project, edges);
    if (!takers || takers.size === 0) {
      continue;
    }
    let taken = 0;
    for (const edge of edges) {
      taken += result.edges[edge.id]?.transferredPerSecond ?? 0;
    }
    const made = flow.amountPerSecond * wanted;
    if (made - taken <= RATE_EPSILON) {
      continue;
    }
    const named = rankHeldTaker(project, result, takers);
    const clog: NonNullable<NodeVerdict["clog"]> = {
      resourceKey: key,
      kind: flow.kind,
      displayName: flow.displayName ?? flow.resourceId ?? key,
      madePerSecond: made,
      takenPerSecond: taken,
      surplusPerSecond: made - taken,
      heldBackPct: Math.max(0, Math.round((wanted - utilization) * 1000) / 10),
      heldTakerName: named.name,
      heldTakerPct: named.pct,
    };
    if (!best || named.rank > best.rank) {
      best = { rank: named.rank, clog };
    }
  }
  return best?.clog;
}

/**
 * The machines behind one output port, through any buffers on the way.
 * Absent when a drain drawer or an overflow buffer sits on the route: those
 * absorb a surplus, so nothing on that port can be holding the card.
 */
function machineTakersBehindOutput(
  project: FactoryProject,
  edges: ProjectEdge[],
): Set<string> | undefined {
  const storageById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const nodeIds = new Set(project.nodes.map((entry) => entry.id));
  const outgoingBy = outgoingByNode(project);
  const takers = new Set<string>();
  const seen = new Set<string>();
  let absorbed = false;
  const walk = (edgesOut: ProjectEdge[]) => {
    for (const edge of edgesOut) {
      const storage = storageById.get(edge.target);
      if (storage) {
        const isDrain = (outgoingBy.get(storage.id) ?? []).length === 0;
        if (isDrain || (storage.bufferMode ?? "overflow") === "overflow") {
          absorbed = true;
          return;
        }
        if (!seen.has(storage.id)) {
          seen.add(storage.id);
          walk(outgoingBy.get(storage.id) ?? []);
        }
      } else if (nodeIds.has(edge.target)) {
        takers.add(edge.target);
      }
    }
  };
  walk(edges);
  return absorbed ? undefined : takers;
}

/**
 * Which taker to name on a held output. A stopped or clogged one explains
 * itself best (rank 3), a full one next (2), a merely pacing one last (1).
 * Deterministic: ties go to the first id in sort order.
 */
function rankHeldTaker(
  project: FactoryProject,
  result: ThroughputResult,
  takers: Set<string>,
): { rank: number; name: string; pct: number } {
  const recipeById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const nodeById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  let best: { rank: number; name: string; pct: number } | undefined;
  for (const taker of [...takers].sort()) {
    const takerResult = result.nodes[taker];
    const takerNode = nodeById.get(taker);
    const takerUtil = clamp01(takerResult?.utilization, 0);
    const takerCapable = clamp01(takerResult?.capableUtilization, 1);
    const takerDisposal = clamp01(takerResult?.disposalUtilization, 1);
    const rank =
      takerNode?.enabled === false || !takerResult || takerUtil <= VERDICT_EPSILON
        ? 3
        : takerDisposal < 1 - VERDICT_EPSILON && takerDisposal < takerCapable - VERDICT_EPSILON
          ? 3
          : takerUtil >= 1 - VERDICT_EPSILON
            ? 2
            : 1;
    if (!best || rank > best.rank) {
      const recipe = takerNode ? recipeById.get(takerNode.recipeId) : undefined;
      best = {
        rank,
        name: recipe?.machineType ?? recipe?.name ?? takerResult?.recipeName ?? taker,
        pct: Math.round(takerUtil * 1000) / 10,
      };
    }
  }
  return best ?? { rank: 0, name: "", pct: 0 };
}

/**
 * What ONE inbound line can honestly deliver, buffers included.
 *
 * This is the call every consumer of honestEdgeAvailablePerSecond should make.
 * The bare function defaults a buffer source to Infinity ("a tank grants
 * whatever is asked"), which is only true while the tank is covering everyone;
 * a dry one is a real ceiling and the shortage has simply moved one hop up.
 * Forgetting the fourth argument makes every buffer-fed input look infinitely
 * supplied, which silently disqualifies it from ever being named the
 * bottleneck.
 */
function honestInboundAvailablePerSecond(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  edge: ProjectEdge,
  sourceIsStorage: boolean,
  sourceHasSoleOutlet: boolean,
): number {
  // The sole-outlet uplift says "this producer could ramp to full blast if
  // asked". A producer at a dead stop for its own reasons - no power, or
  // inputs that allow nothing - cannot, so its line honestly delivers what
  // it delivers: nothing. Without this a machine starved by an unwired
  // feeder read as fully supplied and never got to say who stopped it.
  const sourceCanRamp = sourceIsStorage || isMachineAbleToRun(result?.nodes[edge.source]);
  return honestEdgeAvailablePerSecond(
    result?.edges[edge.id],
    sourceIsStorage,
    sourceHasSoleOutlet && sourceCanRamp,
    sourceIsStorage
      ? bufferRelaySupplyPerSecond(project, result, edge.source, edge.id)
      : Number.POSITIVE_INFINITY,
  );
}

export function honestEdgeAvailablePerSecond(
  edgeResult: EdgeThroughput | undefined,
  sourceIsStorage: boolean,
  sourceHasSoleOutlet = false,
  /** From bufferRelaySupplyPerSecond: a tank that runs dry IS a ceiling. */
  bufferSupplyPerSecond = Number.POSITIVE_INFINITY,
): number {
  if (sourceIsStorage && edgeResult?.constraint !== "supply") {
    return bufferSupplyPerSecond;
  }
  const allocated = edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
  if (sourceHasSoleOutlet && edgeResult?.sourceCapacityPerSecond !== undefined) {
    return Math.max(allocated, edgeResult.sourceCapacityPerSecond);
  }
  return allocated;
}

const edgeIndexCache = new WeakMap<
  FactoryProject,
  { incoming: Map<string, ProjectEdge[]>; outgoing: Map<string, ProjectEdge[]> }
>();
function edgeIndex(project: FactoryProject) {
  let cached = edgeIndexCache.get(project);
  if (!cached) {
    cached = { incoming: new Map(), outgoing: new Map() };
    for (const edge of project.edges) {
      cached.incoming.set(edge.target, [...(cached.incoming.get(edge.target) ?? []), edge]);
      cached.outgoing.set(edge.source, [...(cached.outgoing.get(edge.source) ?? []), edge]);
    }
    edgeIndexCache.set(project, cached);
  }
  return cached;
}
function incomingByNode(project: FactoryProject): Map<string, ProjectEdge[]> {
  return edgeIndex(project).incoming;
}
function outgoingByNode(project: FactoryProject): Map<string, ProjectEdge[]> {
  return edgeIndex(project).outgoing;
}

/** How many outgoing lines each source has per resource — the sole-outlet test. */
export function countSourceOutlets(project: FactoryProject): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of project.edges) {
    const key = `${edge.source}|${edge.resourceKind}|${edge.resourceId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function edgeSourceHasSoleOutlet(outletCounts: Map<string, number>, edge: ProjectEdge): boolean {
  return (outletCounts.get(`${edge.source}|${edge.resourceKind}|${edge.resourceId}`) ?? 0) === 1;
}

export function deriveNodeVerdict(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
): NodeVerdict {
  const node = project.nodes.find((entry) => entry.id === nodeId);
  if (!node || node.enabled === false) {
    return { kind: "off", pct: 0 };
  }

  const nodeResult = result?.nodes[nodeId];
  if (!nodeResult || nodeResult.status === "missing-recipe") {
    return { kind: "no-recipe", pct: 0 };
  }

  const utilization = clamp01(nodeResult.utilization, 0);
  const capable = clamp01(nodeResult.capableUtilization, 1);
  const demand = clamp01(nodeResult.demandUtilization, utilization);
  const disposal = clamp01(nodeResult.disposalUtilization, 1);
  const pct = Math.round(utilization * 1000) / 10;

  const incoming = project.edges.filter((edge) => edge.target === nodeId);
  const outgoing = project.edges.filter((edge) => edge.source === nodeId);

  // UNWIRED outranks everything below it. In a closed plan every slot has to
  // say where its stuff comes from or goes, so a slot with no wire is a hard
  // zero at whichever end it sits - and it is the one state that needs no
  // arithmetic to explain. Naming it here keeps the two subtler words honest:
  // STARVED means a feeder cannot keep up, CLOGGED means a wired output cannot
  // shift its surplus. Neither should ever mean "you have not wired it yet".
  //
  // A BOARD RULE takes its own side out of that: with free inputs on, the
  // solve already fed every bare input, so marking it is nagging about
  // something the plan has answered. The other side still speaks up - the
  // rules are separate on purpose, and half a closed plan is still a plan.
  const rules = getSetupRules(project);
  if (!rules.freeInputs || !rules.freeOutputs) {
    const bare = findBareSlots(nodeResult, incoming, outgoing, rules);
    // A machine whose recipe has NO slots at all (a solar panel: nothing in,
    // EU out through no port) has nothing to wire, so "unwired" would nag
    // about a wire that cannot exist. It runs; the ordinary readings apply.
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    const hasSlots = (recipe?.inputs.length ?? 0) > 0 || (recipe?.outputs.length ?? 0) > 0;
    if (bare || (hasSlots && incoming.length === 0 && outgoing.length === 0)) {
      // The second clause catches a SLOTTED card with no wires whose slots
      // the solver has no flows for. There are no bare slots to mark, but
      // "unwired" is still the only true thing to say about it.
      return { kind: "unwired", pct, bare };
    }
  }

  // SOLVE MODE: the books are the solved build, not the player's, and every
  // diagnosis below (spirals, clog locks, deficits, starvation ladders)
  // describes a FIXED build that is not what is on screen. A solved machine
  // runs by construction; one at zero is simply not needed by any typed
  // amount - a quiet reading, never an alarm.
  if (project.solveMode) {
    return utilization > VERDICT_EPSILON ? { kind: "balanced", pct } : { kind: "demand-set", pct };
  }

  // A dead ring outranks every other reading. Its members ARE starved and
  // ARE blocking each other, so the ordinary path would have each one point
  // at the next and never name the thing they are all standing in.
  const spiral = findDeathSpirals(project, result).byNode.get(nodeId);
  if (spiral) {
    return { kind: "dead-loop", pct, spiral };
  }

  // Its mirror image: frozen not because the loop starves but because its
  // own surplus has filled every escape route. The members read stuffed, not
  // empty, and the fix is a drawer, so it needs its own name - CLOGGED on
  // each card would send the player pipe-chasing round the circle forever.
  const clogLock = findClogLocks(project, result).byNode.get(nodeId);
  if (clogLock) {
    return { kind: "clog-lock", pct, clogLock, clogLockNodeId: nodeId };
  }

  // A card at a dead stop whose takers have ALL stopped is waiting on them,
  // not choking on a surplus and not short of machines. Unwire one slot on
  // the machine downstream and this one falls to 0% with everything it
  // needs; the only true thing to say is which machine stopped, so the
  // player goes there instead of adding machines here or hanging a drawer.
  if (utilization <= VERDICT_EPSILON && capable > VERDICT_EPSILON && result) {
    const waiting = findStoppedTakerClog(project, result, nodeResult, outgoing);
    if (waiting) {
      return { kind: "clogged", pct, clog: waiting };
    }
  }

  const deficit = findWorstOutputDeficit(project, result, nodeResult, nodeId, outgoing);

  // Conservation outranks supply and demand both. A machine held below full
  // speed because one of its outputs has nowhere to go is not starved (its
  // inputs are fine) and not demand-set (something downstream may be begging
  // for the OTHER output) - it is clogged, and neither of those two words
  // would send you to the pipe that is actually full.
  // Strictly below capability, so a card that is short at BOTH ends tells the
  // input story first: you have to feed a machine before where its output goes
  // is a question worth answering.
  if (
    nodeResult.clogOutputKey !== undefined &&
    disposal < 1 - VERDICT_EPSILON &&
    disposal < capable - VERDICT_EPSILON
  ) {
    const clog = describeClog(nodeResult, utilization, disposal);
    if (clog) {
      // Name the machine on the other end when there is one: "nowhere to
      // go" with an address sends the player to the card that says why.
      if (result) {
        const takers = machineTakersBehindOutput(
          project,
          outgoing.filter(
            (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === clog.resourceKey,
          ),
        );
        if (takers && takers.size > 0) {
          const named = rankHeldTaker(project, result, takers);
          clog.heldTakerName = named.name;
          clog.heldTakerPct = named.pct;
        }
      }
      return { kind: "clogged", pct, clog, deficit };
    }
  }

  if (utilization >= 1 - VERDICT_EPSILON) {
    return deficit ? { kind: "bottleneck", pct, deficit } : { kind: "balanced", pct };
  }

  // Below full speed with a hungry taker, BOTTLENECK is only true if this
  // card could actually ramp. When another wired output has no home for
  // the extra, it cannot, and the honest word is CLOGGED naming that
  // output's taker. Asked only on the paths that would otherwise say
  // bottleneck, after a genuinely short input has had its say.
  const heldClog = () =>
    deficit && result
      ? findHeldOutputClog(
          project,
          result,
          nodeResult,
          outgoing,
          deficit.resourceKey,
          utilization,
          Math.min(1, capable, Math.max(demand, utilization)),
        )
      : undefined;

  // Below full speed there is always a cause. Downstream owns it only when
  // demand is the strictly smaller limit; a tie means something upstream
  // ultimately caps the line, so the arrow should point that way.
  if (demand < capable - VERDICT_EPSILON && demand < 1 - VERDICT_EPSILON) {
    // Demand-set WITH a real deficit is the damped ask lying to this node:
    // downstream is genuinely hungry, the machine has headroom, and the
    // solver just isn't relaying the pull. Its inputs are covered, so this
    // card is where the fix goes — a bottleneck like any other.
    if (deficit) {
      const held = heldClog();
      return held
        ? { kind: "clogged", pct, clog: held, deficit }
        : { kind: "bottleneck", pct, deficit };
    }
    // No headroom figure: it was old-engine capability minus the books'
    // utilization, a percentage of nothing a player can see on the card.
    return { kind: "demand-set", pct };
  }

  // Supply-limited. Whether that MATTERS is a separate question, and the
  // answer is whether anyone is going without: a machine feeding a drawer,
  // a trash can or nothing at all is short on ingredients and short on
  // nobody, which is not a fault to paint red at the top of the board.
  const binding = findBindingInput(project, result, nodeResult, nodeId, incoming);
  // COHERENCE GUARD. The solver can hold a machine below full speed with
  // every input covered - a fair split of contended supply, a loop running
  // at its level - and blaming the least-oversupplied input then produced
  // "gets 2,000/s, wants 100/s, so you are short", which is nonsense. No
  // genuinely short input means no shortage story: the line is pacing it.
  if (!binding || binding.shortfallPerSecond <= RATE_EPSILON) {
    if (!deficit) {
      return { kind: "paced", pct };
    }
    const held = heldClog();
    return held
      ? { kind: "clogged", pct, clog: held, deficit }
      : { kind: "bottleneck", pct, deficit };
  }
  return {
    kind: deficit ? "blocked" : "starved",
    pct,
    binding,
    deficit,
  };
}

/**
 * Every card with a slot still to connect, in one pass over the board.
 *
 * Deliberately not `deriveNodeVerdict` per node: that runs the death-spiral
 * search, and doing it once per card would be O(nodes x board) on something
 * the board-level notice recomputes whenever the plan or the solve changes.
 * The bare-slot test needs neither the spiral nor the solver's numbers, so
 * this walks the edges once and answers in O(nodes + edges).
 */
export function findUnwiredNodeIds(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): string[] {
  // With both board rules on, the solve feeds and drains every bare slot
  // itself; a checklist of things the rules already handled would just nag.
  const rules = getSetupRules(project);
  if (rules.freeInputs && rules.freeOutputs) {
    return [];
  }
  const incomingBy = new Map<string, ProjectEdge[]>();
  const outgoingBy = new Map<string, ProjectEdge[]>();
  for (const edge of project.edges) {
    const into = incomingBy.get(edge.target);
    if (into) {
      into.push(edge);
    } else {
      incomingBy.set(edge.target, [edge]);
    }
    const from = outgoingBy.get(edge.source);
    if (from) {
      from.push(edge);
    } else {
      outgoingBy.set(edge.source, [edge]);
    }
  }

  const ids: string[] = [];
  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const nodeResult = result?.nodes[node.id];
    if (!nodeResult || nodeResult.status === "missing-recipe") {
      continue;
    }
    const incoming = incomingBy.get(node.id) ?? [];
    const outgoing = outgoingBy.get(node.id) ?? [];
    // Same rule as the verdict: a machine whose recipe has no slots at all
    // (a solar panel) has nothing to wire, so the checklist skips it.
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    const hasSlots = (recipe?.inputs.length ?? 0) > 0 || (recipe?.outputs.length ?? 0) > 0;
    if (
      findBareSlots(nodeResult, incoming, outgoing, rules) ||
      (hasSlots && incoming.length === 0 && outgoing.length === 0)
    ) {
      ids.push(node.id);
    }
  }
  return ids;
}

/**
 * The clog, in the reader's units: what the blocked output WOULD make if the
 * plan had its way, what actually leaves, and the gap between them. Measured
 * against demand rather than nameplate, because "you would be at 100% if this
 * had somewhere to go" is only true when something wants the other 100%.
 */
function describeClog(
  nodeResult: NodeThroughputResult,
  utilization: number,
  disposal: number,
): NodeVerdict["clog"] {
  const key = nodeResult.clogOutputKey;
  if (key === undefined) {
    return undefined;
  }
  const flow = nodeResult.outputs[key];
  if (!flow || flow.amountPerSecond <= RATE_EPSILON) {
    return undefined;
  }

  // What the rest of the card wants to run at: the speed it would reach if
  // this one output stopped holding it down.
  const wanted = Math.min(1, clamp01(nodeResult.capableUtilization, 1));
  return {
    resourceKey: key,
    kind: flow.kind,
    displayName: flow.displayName ?? flow.resourceId ?? key,
    madePerSecond: flow.amountPerSecond * wanted,
    takenPerSecond: flow.amountPerSecond * disposal,
    surplusPerSecond: Math.max(0, flow.amountPerSecond * (wanted - disposal)),
    heldBackPct: Math.max(0, Math.round((wanted - utilization) * 1000) / 10),
  };
}

/**
 * Asks that arrive without a wire: this node's own target output, and its
 * share of the plan's target rate. The player IS a taker — a node that misses
 * the rate you dialled for it has someone going without, and reading it as
 * "starved, nothing waiting" would go quiet on exactly the card you are
 * watching. Mirrors `applyProjectTarget` in the solver (only producers with no
 * outgoing line for the resource carry a share of the plan target) so the two
 * cannot disagree about who is on the hook.
 *
 * Built once per (project, result) — the walk is O(nodes + edges) and the
 * lookup that follows is O(1), because this is called once per node.
 */
const targetAskIndexCache = new WeakMap<
  FactoryProject,
  { result: ThroughputResult | undefined; index: Map<string, Map<string, number>> }
>();

function getTargetAskIndex(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): Map<string, Map<string, number>> {
  const cached = targetAskIndexCache.get(project);
  if (cached && cached.result === result) {
    return cached.index;
  }

  const index = new Map<string, Map<string, number>>();
  const add = (nodeId: string, key: string, amountPerSecond: number) => {
    if (amountPerSecond <= RATE_EPSILON) {
      return;
    }
    let byKey = index.get(nodeId);
    if (!byKey) {
      byKey = new Map();
      index.set(nodeId, byKey);
    }
    byKey.set(key, Math.max(byKey.get(key) ?? 0, amountPerSecond));
  };

  const targetRate = project.targetRate;
  const targetKey = targetRate
    ? makeResourceKey(targetRate.kind, targetRate.resourceId)
    : undefined;
  const wiredOut = new Set<string>();
  if (targetKey !== undefined) {
    for (const edge of project.edges) {
      if (makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey) {
        wiredOut.add(edge.source);
      }
    }
  }

  const targetRateNodes: string[] = [];
  for (const node of project.nodes) {
    if (node.targetOutput) {
      add(
        node.id,
        makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId),
        node.targetOutput.amountPerSecond,
      );
    }
    if (
      targetKey !== undefined &&
      !wiredOut.has(node.id) &&
      result?.nodes[node.id]?.outputs[targetKey] !== undefined
    ) {
      targetRateNodes.push(node.id);
    }
  }
  if (targetKey !== undefined && targetRate && targetRateNodes.length > 0) {
    const share = targetRate.amountPerSecond / targetRateNodes.length;
    for (const nodeId of targetRateNodes) {
      add(nodeId, targetKey, share);
    }
  }

  targetAskIndexCache.set(project, { result, index });
  return index;
}

function findWorstOutputDeficit(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeResult: NodeThroughputResult,
  nodeId: string,
  outgoing: ProjectEdge[],
): NodeVerdict["deficit"] {
  if (!result) {
    return undefined;
  }

  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const missingByKey = new Map<string, number>();
  const wantedByKey = new Map<string, number>();
  for (const edge of outgoing) {
    // A buffer absorbing surplus is not hunger; only machine asks count.
    if (storageIds.has(edge.target)) {
      continue;
    }
    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }
    // An output-throttled consumer (disposal its binding limit — the same
    // predicate the CLOGGED branch reads) cannot run faster however much it
    // is fed, so its leftover ask is not hunger this card can answer. Its
    // damped ask never collapses to shipped, and counting it crowned feeders
    // BOTTLENECK at 18% while the real jam sat on the consumer's output side.
    const targetResult = result.nodes[edge.target];
    // A taker stopped by its own setup (no power, a bare slot) is not hungry
    // for anything this card makes; its ask stays on the books at nameplate
    // and crowned feeders BOTTLENECK at 0% for a wire nobody has drawn yet.
    if (
      isStoppedBySetup(
        targetResult,
        incomingByNode(project).get(edge.target) ?? [],
        outgoingByNode(project).get(edge.target) ?? [],
        getSetupRules(project),
      )
    ) {
      continue;
    }
    if (targetResult) {
      const targetDisposal = clamp01(targetResult.disposalUtilization, 1);
      const targetCapable = clamp01(targetResult.capableUtilization, 1);
      if (
        targetDisposal < 1 - VERDICT_EPSILON &&
        targetDisposal < targetCapable - VERDICT_EPSILON
      ) {
        continue;
      }
    }
    const wanted = honestEdgeAskPerSecond(edgeResult, targetResult, edge);
    const missing = Math.max(0, wanted - (edgeResult.transferredPerSecond ?? 0));
    if (missing <= RATE_EPSILON) {
      continue;
    }
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    missingByKey.set(key, (missingByKey.get(key) ?? 0) + missing);
    wantedByKey.set(key, (wantedByKey.get(key) ?? 0) + wanted);
  }

  // Targets are asks with no wire behind them. Folded in with MAX, not sum,
  // exactly as the solver reads them: "make at least this much", never "this
  // much on top of the lines".
  const utilization = clamp01(nodeResult.utilization, 0);
  for (const [key, ask] of getTargetAskIndex(project, result).get(nodeId) ?? []) {
    const nameplate =
      nodeResult.outputs[key as keyof typeof nodeResult.outputs]?.amountPerSecond ?? 0;
    wantedByKey.set(key, Math.max(wantedByKey.get(key) ?? 0, ask));
    const missing = Math.max(0, ask - nameplate * utilization);
    if (missing > RATE_EPSILON) {
      missingByKey.set(key, Math.max(missingByKey.get(key) ?? 0, missing));
    }
  }

  let worst: { key: string; missing: number } | undefined;
  for (const [key, missing] of missingByKey) {
    if (!worst || missing > worst.missing) {
      worst = { key, missing };
    }
  }
  if (!worst) {
    return undefined;
  }

  // Outputs are independent couplings: any number can be over-asked at once.
  // One +N still fixes them all (machines scale every output together), so
  // take the biggest per-output requirement. Measured from FULL BLAST, not
  // from current speed: a half-idle machine's free headroom counts before
  // any new machines do (keeps +N coherent with the ladder's ×ratio).
  const node = project.nodes.find((entry) => entry.id === nodeId);
  const machineCount = Math.max(1, node?.machineCount ?? 1);
  let machinesToAdd: number | undefined;
  let overAskPct: number | undefined;
  for (const [key, wanted] of wantedByKey) {
    const keyFlow = nodeResult.outputs[key as keyof typeof nodeResult.outputs];
    const nameplate = keyFlow?.amountPerSecond ?? 0;
    const perMachine = nameplate / machineCount;
    if (perMachine <= RATE_EPSILON) {
      continue;
    }
    const missingAtFull = Math.max(0, wanted - nameplate);
    if (missingAtFull <= RATE_EPSILON) {
      continue;
    }
    const pastFull = (missingAtFull / nameplate) * 100;
    if (overAskPct === undefined || pastFull > overAskPct) {
      overAskPct = pastFull;
    }
    const toAdd = Math.min(9999, Math.ceil(missingAtFull / perMachine - RATE_EPSILON));
    if (toAdd > 0 && (machinesToAdd === undefined || toAdd > machinesToAdd)) {
      machinesToAdd = toAdd;
    }
  }

  let pluggedOutputs = 0;
  for (const [key, flow] of Object.entries(nodeResult.outputs)) {
    if (flow.amountPerSecond <= RATE_EPSILON) {
      continue;
    }
    const plugged = outgoing.some(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    if (plugged) {
      pluggedOutputs += 1;
    }
  }

  const flow = nodeResult.outputs[worst.key as keyof typeof nodeResult.outputs];
  return {
    resourceKey: worst.key,
    kind: flow?.kind ?? "item",
    displayName: flow?.displayName ?? flow?.resourceId ?? worst.key,
    missingPerSecond: worst.missing,
    machinesToAdd,
    overAskPct,
    hungryOutputs: missingByKey.size,
    pluggedOutputs,
  };
}

function findBindingInput(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeResult: NodeThroughputResult,
  nodeId: string,
  incoming: ProjectEdge[],
): NodeVerdict["binding"] {
  if (!result) {
    return undefined;
  }

  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const outletCounts = countSourceOutlets(project);

  // Jack's definition: "bottleneck = the thing that is setting this
  // machine's usage percent — increase it and the percent moves; increase
  // anything else and it doesn't." Only the HONEST per-line deliverability
  // (the edge-label book: source capacity, buffer-∞) can prove that; the
  // allocation figures get dragged down in lockstep by the ask coupling and
  // tie everything at the machine's own speed. Scan sorted for order
  // independence; keep genuine ties within 1%.
  const candidates: Array<{
    key: string;
    ratio: number;
    supplied: number;
    need: number;
    edges: ProjectEdge[];
  }> = [];
  for (const [key, flow] of Object.entries(nodeResult.inputs).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (flow.amountPerSecond <= RATE_EPSILON) {
      continue;
    }
    const edges = incoming.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    // A bare input delivers nothing and binds hardest of all. It used to be
    // skipped here as hand-fed, which meant the one input actually stopping
    // the machine could never be named.
    if (edges.length === 0) {
      candidates.push({ key, ratio: 0, supplied: 0, need: flow.amountPerSecond, edges });
      continue;
    }
    let supplied = 0;
    for (const edge of edges) {
      supplied += honestInboundAvailablePerSecond(
        project,
        result,
        edge,
        storageIds.has(edge.source),
        edgeSourceHasSoleOutlet(outletCounts, edge),
      );
    }
    // A non-dry buffer line covers whatever is needed — this input can't bind.
    // A DRY one is finite and lands here like any other line, which is the
    // whole point: a shortage that arrives through a buffer is still this
    // input's shortage, and it has to be able to win the crown.
    if (!Number.isFinite(supplied)) {
      continue;
    }
    // On a starving machine, demand is by definition not the limiter, so the
    // honest need is the FULL-BLAST one. Scaling by the solver's damped
    // demand made this circular ("gets 102 of the needed 102").
    const need = flow.amountPerSecond;
    const ratio = need > RATE_EPSILON ? supplied / need : 1;
    candidates.push({ key, ratio, supplied, need, edges });
  }

  let binding: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (!binding || candidate.ratio < binding.ratio) {
      binding = candidate;
    }
  }
  const honestTiedKeys = binding
    ? candidates
        .filter(
          (candidate) =>
            candidate.key !== binding!.key &&
            candidate.ratio <= binding!.ratio + Math.max(0.01, binding!.ratio * 0.01),
        )
        .map((candidate) => candidate.key)
    : [];

  if (!binding) {
    return undefined;
  }

  const flow = nodeResult.inputs[binding.key as keyof typeof nodeResult.inputs];
  const shortfallPerSecond = Math.max(0, binding.need - binding.supplied);
  const upstream = findUpstreamCulprit(
    project,
    result,
    nodeId,
    binding.edges,
    shortfallPerSecond,
    binding.need,
  );
  const tiedKeys = honestTiedKeys;
  const tiedWithNames = tiedKeys
    .map((key) => {
      const tiedFlow = nodeResult.inputs[key as keyof typeof nodeResult.inputs];
      return tiedFlow?.displayName ?? tiedFlow?.resourceId ?? key;
    })
    .filter(Boolean);
  return {
    resourceKey: binding.key,
    kind: flow?.kind ?? "item",
    displayName: flow?.displayName ?? flow?.resourceId ?? binding.key,
    suppliedPerSecond: binding.supplied,
    neededPerSecond: binding.need,
    shortfallPerSecond,
    upstreamName: upstream?.name,
    upstream,
    tiedKeys: tiedKeys && tiedKeys.length > 0 ? tiedKeys : undefined,
    tiedWithNames: tiedWithNames && tiedWithNames.length > 0 ? tiedWithNames : undefined,
  };
}

/**
 * The machine (or buffer) to go fix on a starved line: prefer the edge whose
 * source has nothing left to give, otherwise the biggest supplier. Carries the
 * culprit's own speed so callers can say "it's starving too" instead of
 * uselessly suggesting more machines there.
 */
function findUpstreamCulprit(
  project: FactoryProject,
  result: ThroughputResult,
  nodeId: string,
  edges: ProjectEdge[],
  shortfallPerSecond: number,
  neededPerSecond: number,
): UpstreamCulprit | undefined {
  let pick: ProjectEdge | undefined;
  let pickTransferred = -1;
  for (const edge of edges) {
    const edgeResult = result.edges[edge.id];
    if (edgeResult?.constraint === "supply") {
      pick = edge;
      break;
    }
    const transferred = edgeResult?.transferredPerSecond ?? 0;
    if (transferred > pickTransferred) {
      pick = edge;
      pickTransferred = transferred;
    }
  }
  if (!pick) {
    return undefined;
  }
  if (pick.source === nodeId) {
    return { name: "its own loop", kind: "loop", pct: 100, atFullSpeed: false, hasHeadroom: false };
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === pick.source);
  if (storage) {
    return {
      name: describeStorage(storage, getStorageRole(project, storage.id)),
      kind: "buffer",
      pct: 100,
      atFullSpeed: false,
      hasHeadroom: false,
    };
  }

  const sourceNode = project.nodes.find((entry) => entry.id === pick.source);
  const recipe = sourceNode
    ? project.recipes.find((entry) => entry.id === sourceNode.recipeId)
    : undefined;
  const name = recipe?.machineType || recipe?.name;
  if (!name) {
    return undefined;
  }

  const sourceResult = result.nodes[pick.source];
  const pct = Math.round(clamp01(sourceResult?.utilization, 0) * 1000) / 10;
  const atFullSpeed = pct >= 99.5;
  const hasHeadroom =
    !atFullSpeed && clamp01(sourceResult?.capableUtilization, 1) >= 1 - VERDICT_EPSILON;
  let machinesToAdd: number | undefined;
  if ((atFullSpeed || hasHeadroom) && sourceResult && shortfallPerSecond > RATE_EPSILON) {
    const key = makeResourceKey(pick.resourceKind, pick.resourceId);
    const sourceFlow =
      sourceResult.outputs[key as keyof typeof sourceResult.outputs] ??
      Object.values(sourceResult.outputs).find((entry) => entry.resourceId === pick.resourceId);
    const machineCount = Math.max(1, sourceNode?.machineCount ?? 1);
    const nameplate = sourceFlow?.amountPerSecond ?? 0;
    const perMachine = nameplate / machineCount;
    if (perMachine > RATE_EPSILON) {
      // Measured from the culprit's FULL BLAST: its free headroom counts
      // before any new machines do (coherent with its own ladder).
      const missingAtFull = Math.max(0, neededPerSecond - nameplate);
      const toAdd =
        missingAtFull > RATE_EPSILON
          ? Math.min(9999, Math.ceil(missingAtFull / perMachine - RATE_EPSILON))
          : undefined;
      machinesToAdd = toAdd && toAdd > 0 ? toAdd : undefined;
    }
  }

  return {
    name,
    kind: "machine",
    pct,
    atFullSpeed,
    hasHeadroom,
    machinesToAdd,
    machineCount: Math.max(1, sourceNode?.machineCount ?? 1),
  };
}

/**
 * The plug block seated through the node's wall on an output: the ASKER's
 * story, in the asker's frame. Any number of plugs can be hungry at once —
 * couplings are independent contracts, there is no "worst output".
 */
export interface PortPlug {
  /**
   * hungry  = askers want more and THIS machine is the one to grow
   * blocked = askers want more but this machine is short itself, so the fix
   *           is upstream of it
   * clogged = askers want more and the machine has the inputs for it, but
   *           another of its outputs has nowhere to go. Distinct from hungry
   *           because adding machines here would NOT help: more machines make
   *           more of the stuck output too, so the ceiling moves with them.
   * fed     = every asker gets what it asks for (green)
   * dump    = only dead ends attached — a trash can, or buffers nothing ever
   *           draws from — so there is no ask to satisfy, just a place flow
   *           goes. `dumpKind` says which place, because a tank that fills up
   *           and a can that destroys the flow are not the same news.
   *
   * A buffer that HAS consumers is not a dump: it relays their asks one hop
   * upstream ("a recipe that crafts itself — the input is the output"), so
   * it participates in hungry/fed like any machine asker.
   */
  state: "hungry" | "blocked" | "clogged" | "fed" | "dump";
  /**
   * Where a `dump` actually ends: a trash can (destroyed), a tank (fluid
   * buffer), or a store (item buffer). Absent on every other state.
   */
  dumpKind?: "trash" | "tank" | "store";
  /** One machine's name, "N machines", "via <buffer>", or the dump's name. */
  askerName: string;
  /** Distinct machine consumers on this port (0 when buffers only). */
  askerMachines: number;
  askPerSecond: number;
  getPerSecond: number;
  /** get/ask, clamped 0..1 — the plug bar's fill. */
  coveredFraction: number;
  /** ask/get when hungry (Infinity when nothing flows yet). */
  timesShort?: number;
}

/**
 * A buffer's relayed ask: what everything drawing FROM the buffer honestly
 * wants, one hop through. `share` divides it among the buffer's suppliers by
 * their current contribution (equal split before anything flows).
 */
function relayedBufferAskPerSecond(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  storageId: string,
  supplierRate: number,
): number {
  let consumersAsk = 0;
  let outgoing = 0;
  for (const edge of project.edges) {
    if (edge.source !== storageId) {
      continue;
    }
    outgoing += 1;
    consumersAsk += honestEdgeAskPerSecond(result?.edges[edge.id], result?.nodes[edge.target], edge);
  }
  if (outgoing === 0) {
    return -1;
  }

  let inflowTotal = 0;
  let inflowEdges = 0;
  for (const edge of project.edges) {
    if (edge.target !== storageId) {
      continue;
    }
    inflowEdges += 1;
    inflowTotal += result?.edges[edge.id]?.transferredPerSecond ?? 0;
  }
  const share =
    inflowTotal > RATE_EPSILON ? supplierRate / inflowTotal : 1 / Math.max(1, inflowEdges);
  return consumersAsk * share;
}

/**
 * One rail port per unique resource a node can exchange: the wire, the live
 * rate, and the health readout share a single surface. Ports pool repeated
 * recipe slots exactly the way the solver pools their flows.
 */
export interface RailPort {
  side: "input" | "output";
  key: string;
  kind: ResourceKind;
  resourceId: string;
  displayName: string;
  /** Canonical (index-less) handle id; edges of any vintage resolve onto it. */
  handleId: string;
  /** Recipe entry backing the port, for icon rendering. */
  resource?: ResourceAmount;
  connected: boolean;
  /**
   * Consumed input with no line attached. Nothing declares where it comes
   * from, so the machine cannot run. It was `handFed` back when the planner
   * assumed a bare input arrived by hand forever.
   */
  unsupplied: boolean;
  /**
   * This port's side is answered by a board rule, so a bare slot here is not
   * a to-do item: the solve feeds or drains it. Outputs read this to keep the
   * NO TAKER mark off a slot the plan has an answer for.
   */
  boundaryFree: boolean;
  currentPerSecond: number;
  nameplatePerSecond: number;
  /**
   * The WANT mark on the bar. Outputs: what all consumers would take at THEIR
   * full speed (honest asks, can exceed nameplate). Inputs: the draw at the
   * speed downstream asks of this machine.
   */
  wantedPerSecond: number;
  /**
   * The supply-side ceiling. Outputs: full blast × what the inputs allow.
   * Inputs: what the connected lines could deliver if this machine drank
   * freely (can exceed nameplate — spare upstream).
   */
  couldPerSecond: number;
  fillFraction: number;
  tone: "ok" | "bind" | "hot" | "calm" | "idle" | "slowed";
  /** Outputs only: the asker-side coupling, when anything is plugged in. */
  plug?: PortPlug;
  badge?: { kind: "short" | "asked"; perSecond: number };
  /** Render "current / nameplate" instead of the bare current rate. */
  showNameplate: boolean;
  /**
   * The EU this card spends per unit crossing this port (its EU/t over the
   * port's flow, both from the same books): per unit MADE on an output, per
   * unit EATEN on an input. The "EU" rate unit shows it in place of the
   * rate; every other unit ignores it.
   */
  energyPerUnit?: number;
}

export function buildRailPorts(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
  displayRecipe: Pick<Recipe, "inputs" | "outputs">,
  verdict: NodeVerdict,
): { inputs: RailPort[]; outputs: RailPort[] } {
  const nodeResult = result?.nodes[nodeId];
  const utilization = clamp01(nodeResult?.utilization, 0);
  const demand = clamp01(nodeResult?.demandUtilization, utilization);
  const capable = clamp01(nodeResult?.capableUtilization, 1);
  const incoming = project.edges.filter((edge) => edge.target === nodeId);
  const outgoing = project.edges.filter((edge) => edge.source === nodeId);
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  // A trash can asks for nothing — it eats whatever arrives. Counting it as a
  // machine asker made every trashed output read as a happily fed coupling.
  const trashNodeIds = collectTrashNodeIds(project);
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const outletCounts = countSourceOutlets(project);
  const machineNameOf = (id: string): string => {
    const node = nodesById.get(id);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    return recipe?.machineType ?? recipe?.name ?? "Machine";
  };
  const storageRoles = getStorageRoles(project);
  const storageNameOf = (id: string): string => {
    const storage = storagesById.get(id);
    return storage ? describeStorage(storage, storageRoles.get(id)) : "Drawer";
  };
  const rules = getSetupRules(project);
  const buildSide = (side: "input" | "output"): RailPort[] => {
    const isInput = side === "input";
    // A board rule ANSWERS its whole side: with free inputs on there is no
    // such thing as a slot with nothing to supply it, so the bare-slot marks
    // come off and the port reads as the ordinary working port it now is.
    const freeSide = isInput ? rules.freeInputs : rules.freeOutputs;
    const flows = isInput ? nodeResult?.inputs : nodeResult?.outputs;
    const resources = isInput ? displayRecipe.inputs : displayRecipe.outputs;
    const sideEdges = isInput ? incoming : outgoing;
    const ports: RailPort[] = [];
    const seen = new Set<string>();

    const pushPort = (
      key: string,
      kind: ResourceKind,
      resourceId: string,
      displayName: string | undefined,
      nameplate: number,
    ) => {
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      const resource = resources.find(
        (entry) => entry.kind === kind && entry.id === resourceId,
      );
      if (isInput && resource && !isRecipeInputConsumed(resource)) {
        return;
      }

      const edges = sideEdges.filter(
        (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
      );
      const connected = edges.length > 0;
      let transferred = 0;
      let available = 0;
      let machineAsk = 0;
      let machineGet = 0;
      let storageGet = 0;
      const machineTargets = new Set<string>();
      const relayTargets = new Set<string>();
      const dumpTargets = new Set<string>();
      const trashTargets = new Set<string>();
      for (const edge of edges) {
        const edgeResult = result?.edges[edge.id];
        const rate = edgeResult?.transferredPerSecond ?? 0;
        transferred += rate;
        if (isInput) {
          available += honestInboundAvailablePerSecond(
            project,
            result,
            edge,
            storagesById.has(edge.source),
            edgeSourceHasSoleOutlet(outletCounts, edge),
          );
        } else if (trashNodeIds.has(edge.target)) {
          // The can drinks the leftovers at whatever rate they arrive; there
          // is no ask behind it to be a percentage of.
          storageGet += rate;
          trashTargets.add(edge.target);
        } else if (storagesById.has(edge.target)) {
          const relayed = relayedBufferAskPerSecond(project, result, edge.target, rate);
          if (relayed < 0) {
            // Dead end: nothing draws from the buffer — a dump, not an ask.
            storageGet += rate;
            dumpTargets.add(edge.target);
          } else {
            // The buffer relays its consumers' asks one hop upstream.
            machineAsk += Math.max(relayed, rate);
            machineGet += rate;
            relayTargets.add(edge.target);
          }
        } else {
          machineAsk += honestEdgeAskPerSecond(edgeResult, result?.nodes[edge.target], edge);
          machineGet += rate;
          machineTargets.add(edge.target);
        }
      }
      const wantedByLines = machineAsk + storageGet;

      const isBinding =
        isSupplyShort(verdict.kind) &&
        (verdict.binding?.resourceKey === key || verdict.binding?.tiedKeys?.includes(key) === true);
      const askRate = nameplate * Math.min(demand, 1);

      let tone: RailPort["tone"] = "ok";
      let fillFraction: number;
      let currentPerSecond: number;
      let wantedPerSecond: number;
      let couldPerSecond: number;
      let badge: RailPort["badge"];

      if (isInput) {
        currentPerSecond = connected ? transferred : nameplate * utilization;
        wantedPerSecond = askRate;
        couldPerSecond = connected ? available : nameplate;
        fillFraction = connected
          ? clamp01(askRate > RATE_EPSILON ? available / askRate : 1, 1)
          : 1;
        if (!connected && !freeSide) {
          // Every bare slot marked, not one crowned: they are all equally the
          // reason, and the card's job is to show you the whole list of wires
          // to draw. `idle` was for the old world where a bare input was a
          // standing assumption rather than a stop.
          tone = "bind";
          badge = { kind: "short", perSecond: nameplate };
        } else if (isBinding) {
          tone = "bind";
          badge = { kind: "short", perSecond: verdict.binding?.shortfallPerSecond ?? 0 };
        } else if (verdict.kind === "demand-set") {
          tone = "calm";
        }
      } else {
        currentPerSecond = nameplate * utilization;
        wantedPerSecond = connected ? wantedByLines : 0;
        couldPerSecond = nameplate * capable;
        fillFraction = utilization;
        // The chip is the MACHINE's story only: at full speed it reads green
        // no matter how loudly the plugs beg — "everything here is amazing,
        // it's the plug that says where's my stuff". One machine, one color.
        if (!connected && !freeSide) {
          // The mirror of a bare input: a product with no taker stops the
          // machine just as dead, so it is marked just as loudly. Checked
          // first because it outranks both readings below it.
          tone = "bind";
        } else if (isSupplyShort(verdict.kind)) {
          tone = "slowed";
        } else if (verdict.kind === "demand-set") {
          tone = "calm";
        }
      }

      // The plug: the asker-side coupling, independent per output. Relay
      // buffers count as askers (their consumers' asks pass through); only
      // dead-end buffers are a dump.
      let plug: RailPort["plug"];
      if (!isInput && connected) {
        const demanders = machineTargets.size + relayTargets.size;
        const ask = demanders > 0 ? machineAsk : storageGet;
        const get = demanders > 0 ? machineGet : storageGet;
        const hungry =
          demanders > 0 && ask > get + Math.max(RATE_EPSILON, ask * VERDICT_EPSILON);
        plug = {
          // The plug's state and the card's word are the same fact seen from
          // the two ends: a short plug on a supply-short machine IS what
          // makes that machine blocked, and a short plug on a fed one IS
          // what makes it the bottleneck. They can never disagree.
          state:
            demanders === 0
              ? "dump"
              : hungry
                ? isSupplyShort(verdict.kind)
                  ? "blocked"
                  : verdict.kind === "clogged"
                    ? "clogged"
                    : "hungry"
                : "fed",
          // A can beside a buffer is still a can: destruction is the louder
          // fact, so it names the coupling.
          dumpKind:
            demanders > 0
              ? undefined
              : trashTargets.size > 0
                ? "trash"
                : kind === "fluid"
                  ? "tank"
                  : "store",
          askerName:
            machineTargets.size === 1 && relayTargets.size === 0
              ? machineNameOf([...machineTargets][0]!)
              : machineTargets.size === 0 && relayTargets.size === 1
                ? `via ${storageNameOf([...relayTargets][0]!)}`
                : demanders > 0
                  ? `${demanders} takers`
                  : trashTargets.size > 0 && dumpTargets.size === 0
                    ? trashTargets.size === 1
                      ? "Trash Can"
                      : `${trashTargets.size} trash cans`
                    : dumpTargets.size === 1 && trashTargets.size === 0
                      ? storageNameOf([...dumpTargets][0]!)
                      : `${dumpTargets.size + trashTargets.size} dead ends`,
          askerMachines: machineTargets.size,
          askPerSecond: ask,
          getPerSecond: get,
          coveredFraction: ask > RATE_EPSILON ? clamp01(get / ask, 1) : 1,
          timesShort: hungry ? (get > RATE_EPSILON ? ask / get : Number.POSITIVE_INFINITY) : undefined,
        };
      }

      ports.push({
        side,
        key,
        kind,
        resourceId,
        displayName: displayName ?? resource?.displayName ?? resourceId,
        handleId: makeResourceHandleId(side, { kind, id: resourceId }),
        resource,
        connected,
        unsupplied: isInput && !connected && !freeSide,
        boundaryFree: freeSide,
        currentPerSecond,
        nameplatePerSecond: nameplate,
        wantedPerSecond,
        couldPerSecond,
        fillFraction,
        tone,
        plug,
        badge,
        showNameplate: isInput && isBinding,
        // A flow-less port (no books yet) has no power to divide; a power
        // port IS the EU, so it never reads as EU per EU. Inputs carry it
        // too - the EU spent per unit eaten - drawn in a much quieter gold.
        energyPerUnit:
          kind !== "power" && flows && nodeResult
            ? energyPerUnit(nodeResult.euT, nameplate)
            : undefined,
      });
    };

    if (flows) {
      for (const [key, flow] of Object.entries(flows)) {
        if (flow.amountPerSecond <= RATE_EPSILON) {
          continue;
        }
        pushPort(key, flow.kind, flow.resourceId, flow.displayName, flow.amountPerSecond);
      }
    } else {
      for (const resource of resources) {
        pushPort(
          makeResourceKey(resource.kind, resource.id),
          resource.kind,
          resource.id,
          resource.displayName,
          0,
        );
      }
    }

    return ports;
  };

  return { inputs: buildSide("input"), outputs: buildSide("output") };
}

/**
 * One rung of the "what limits this node, in order" ladder. All rungs share
 * one ruler: 100% = this node's full blast with its current machine count.
 */
export interface LimitRung {
  pct: number;
  label: string;
  /** The lowest rung — the limit the node is standing on right now. */
  now: boolean;
}

/**
 * The node's ceilings, sorted: each connected input's supply, the machine
 * count itself (always 100%), and the point where downstream stops asking.
 * The lowest rung is today's verdict; the rest are the future, in order —
 * so a fix session never needs to re-discover the board after each change.
 */
export function buildLimitLadder(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
): LimitRung[] {
  const nodeResult = result?.nodes[nodeId];
  const node = project.nodes.find((entry) => entry.id === nodeId);
  if (!nodeResult || !node || node.enabled === false) {
    return [];
  }

  const incoming = project.edges.filter((edge) => edge.target === nodeId);
  const outgoing = project.edges.filter((edge) => edge.source === nodeId);
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const outletCounts = countSourceOutlets(project);
  const rungs: LimitRung[] = [];

  // Fleet first: on a 100% tie with a supply rung, "machine count" is the
  // actionable name (dedupe keeps the first of a tie). Custom rate nodes have
  // no fleet — their 100% ceiling is the dial.
  const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
  rungs.push({
    pct: 100,
    label: isCustomRateRecipe(recipe) ? "dialed rate" : "machine count",
    now: false,
  });

  for (const [key, flow] of Object.entries(nodeResult.inputs)) {
    if (flow.amountPerSecond <= RATE_EPSILON) {
      continue;
    }
    const edges = incoming.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    // A bare input is a 0% rung, not an absent one: nothing declares where it
    // comes from, so the machine stands on it until something does.
    if (edges.length === 0) {
      rungs.push({
        pct: 0,
        label: `${flow.displayName ?? flow.resourceId} has no supply`,
        now: false,
      });
      continue;
    }
    let available = 0;
    for (const edge of edges) {
      available += honestInboundAvailablePerSecond(
        project,
        result,
        edge,
        storageIds.has(edge.source),
        edgeSourceHasSoleOutlet(outletCounts, edge),
      );
    }
    const pct = (available / flow.amountPerSecond) * 100;
    // A non-dry buffer feeds on demand — never a rung on the ladder.
    if (!Number.isFinite(pct)) {
      continue;
    }
    rungs.push({
      pct,
      label: `${flow.displayName ?? flow.resourceId} supply`,
      now: false,
    });
  }

  let demandRatio: number | undefined;
  for (const [key, flow] of Object.entries(nodeResult.outputs)) {
    if (flow.amountPerSecond <= RATE_EPSILON) {
      continue;
    }
    // Nothing at all carries this away: a 0% rung, the mirror of a bare input.
    if (!outgoing.some((edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key)) {
      rungs.push({
        pct: 0,
        label: `${flow.displayName ?? flow.resourceId} has nowhere to go`,
        now: false,
      });
      continue;
    }
    const machineEdges = outgoing.filter(
      (edge) =>
        makeResourceKey(edge.resourceKind, edge.resourceId) === key &&
        !storageIds.has(edge.target),
    );
    if (machineEdges.length === 0) {
      continue;
    }
    let wanted = 0;
    for (const edge of machineEdges) {
      wanted += honestEdgeAskPerSecond(result?.edges[edge.id], result?.nodes[edge.target], edge);
    }
    const ratio = wanted / flow.amountPerSecond;
    demandRatio = Math.max(demandRatio ?? 0, ratio);
  }
  if (demandRatio !== undefined) {
    rungs.push({
      pct: demandRatio * 100,
      label: demandRatio > 1 + VERDICT_EPSILON ? "downstream satisfied" : "downstream demand",
      now: false,
    });
  }

  rungs.sort((left, right) => left.pct - right.pct);
  const deduped: LimitRung[] = [];
  for (const rung of rungs) {
    const last = deduped[deduped.length - 1];
    // Rungs within half a percent are the same wall; keep the first name.
    if (last && Math.abs(last.pct - rung.pct) < 0.5) {
      continue;
    }
    deduped.push(rung);
  }
  const capped = deduped.slice(0, 4);
  if (capped.length > 0) {
    capped[0] = { ...capped[0]!, now: true };
  }

  // Running BELOW every limit: the damped ask is holding the machine down
  // (it doesn't know it can ask for more). Say so instead of pretending the
  // lowest rung explains the current speed.
  const utilizationPct = clamp01(nodeResult.utilization, 0) * 100;
  if (capped.length > 0 && utilizationPct < capped[0]!.pct - 0.5) {
    capped[0] = { ...capped[0]!, now: false };
    capped.unshift({ pct: utilizationPct, label: "current: the plan asks for less", now: true });
    if (capped.length > 4) {
      capped.pop();
    }
  }
  return capped;
}

