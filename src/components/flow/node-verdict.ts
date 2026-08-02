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
import { makeResourceHandleId } from "./resource-handles";

type ProjectEdge = FactoryProject["edges"][number];

/**
 * The node-level verdict that replaces the bare "Usage %": one state derived
 * from the solver's three separate facts (utilization, what the inputs would
 * allow, what downstream asks), plus the cause and the concrete next action.
 *
 * Color doctrine: the verdict color means "where to act", never "how big the
 * number is". Starved = act upstream, choke = act on this node, demand-set =
 * no action anywhere (healthy part load), balanced = done.
 */
export type NodeVerdictKind =
  | "off"
  | "no-recipe"
  | "unwired"
  | "starved"
  | "choke"
  | "demand-set"
  | "balanced";

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
}

export interface NodeVerdict {
  kind: NodeVerdictKind;
  /** Clamped display percentage, 0-100. */
  pct: number;
  /** Starved: the input that pins the machine below what's asked of it. */
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
  /** Choke: the worst unmet downstream ask across this node's outputs. */
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
    /** How many outputs are over-asked right now (they're independent). */
    hungryOutputs: number;
    /** How many outputs have anything plugged in at all. */
    pluggedOutputs: number;
  };
  /** Demand-set: percentage points the node could climb if asked. */
  headroomPct?: number;
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
    if (!demandSet && capable < 1 - VERDICT_EPSILON) {
      return Math.max(nameplate, damped);
    }
  }
  return damped;
}

/**
 * What a supply line could deliver. A buffer grants whatever is asked, and the
 * damped ask can be ~nothing — so a buffer line must never read as a ceiling
 * unless the solver actually marked it dry (constraint "supply"). Infinity
 * here means "not a cap"; callers skip or clamp it for display.
 */
export function honestEdgeAvailablePerSecond(
  edgeResult: EdgeThroughput | undefined,
  sourceIsStorage: boolean,
): number {
  if (sourceIsStorage && edgeResult?.constraint !== "supply") {
    return Number.POSITIVE_INFINITY;
  }
  return edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
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
  const pct = Math.round(utilization * 1000) / 10;

  const incoming = project.edges.filter((edge) => edge.target === nodeId);
  const outgoing = project.edges.filter((edge) => edge.source === nodeId);
  if (incoming.length === 0 && outgoing.length === 0) {
    return { kind: "unwired", pct };
  }

  const deficit = findWorstOutputDeficit(project, result, nodeResult, nodeId, outgoing);

  if (utilization >= 1 - VERDICT_EPSILON) {
    return deficit ? { kind: "choke", pct, deficit } : { kind: "balanced", pct };
  }

  // Below full speed there is always a cause. Downstream owns it only when
  // demand is the strictly smaller limit; a tie means something upstream
  // ultimately caps the line, so the arrow should point that way.
  if (demand < capable - VERDICT_EPSILON && demand < 1 - VERDICT_EPSILON) {
    // "Demand-set" with a real deficit is the damped ask lying to this node:
    // downstream is genuinely hungry, the machine has headroom, and the
    // solver just isn't relaying the pull. That's a can't-keep-up seat —
    // adding machines (or tiers) here is what actually moves it.
    if (deficit) {
      return { kind: "choke", pct, deficit };
    }
    const headroomPct = Math.max(0, Math.round((Math.min(capable, 1) - utilization) * 1000) / 10);
    return { kind: "demand-set", pct, headroomPct };
  }

  return {
    kind: "starved",
    pct,
    binding: findBindingInput(project, result, nodeResult, nodeId, incoming),
    deficit,
  };
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
    const wanted = honestEdgeAskPerSecond(edgeResult, result.nodes[edge.target]);
    const missing = Math.max(0, wanted - (edgeResult.transferredPerSecond ?? 0));
    if (missing <= RATE_EPSILON) {
      continue;
    }
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    missingByKey.set(key, (missingByKey.get(key) ?? 0) + missing);
    wantedByKey.set(key, (wantedByKey.get(key) ?? 0) + wanted);
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
  let binding:
    | { key: string; ratio: number; supplied: number; need: number; edges: ProjectEdge[] }
    | undefined;

  // Jack's definition, verbatim: "bottleneck = the thing that is setting
  // this machine's usage percent." The solver knows which input that was —
  // it took the min itself — so trust its report and never out-guess it
  // with a ratio scan over damped per-edge figures.
  const solverPick = nodeResult.limitingInputKey;
  if (solverPick) {
    const flow = nodeResult.inputs[solverPick];
    const edges = incoming.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === solverPick,
    );
    if (flow && flow.amountPerSecond > RATE_EPSILON && edges.length > 0) {
      let supplied = 0;
      for (const edge of edges) {
        const edgeResult = result.edges[edge.id];
        // Raw figures here — this is the basis the solver actually used.
        supplied += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
      }
      binding = { key: solverPick, ratio: 0, supplied, need: flow.amountPerSecond, edges };
    }
  }

  if (!binding) {
    // Fallback ratio scan for results that predate the solver's own report.
    for (const [key, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond <= RATE_EPSILON) {
        continue;
      }
      const edges = incoming.filter(
        (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
      );
      // Unconnected inputs are hand-fed by convention and never bind.
      if (edges.length === 0) {
        continue;
      }
      let supplied = 0;
      for (const edge of edges) {
        supplied += honestEdgeAvailablePerSecond(
          result.edges[edge.id],
          storageIds.has(edge.source),
        );
      }
      // A non-dry buffer line covers whatever is needed — this input can't bind.
      if (!Number.isFinite(supplied)) {
        continue;
      }
      // On a starving machine, demand is by definition not the limiter, so the
      // honest need is the FULL-BLAST one. Scaling by the solver's damped
      // demand made this circular ("gets 102 of the needed 102").
      const need = flow.amountPerSecond;
      const ratio = need > RATE_EPSILON ? supplied / need : 1;
      if (!binding || ratio < binding.ratio) {
        binding = { key, ratio, supplied, need, edges };
      }
    }
  }

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
  const tiedKeys = nodeResult.limitingInputTiedKeys?.filter((key) => key !== binding!.key);
  const tiedWithNames = tiedKeys
    ?.map((key) => {
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
      name: `${storage.displayName ?? storage.resourceId} (buffer)`,
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

  return { name, kind: "machine", pct, atFullSpeed, hasHeadroom, machinesToAdd };
}

/**
 * The plug block seated through the node's wall on an output: the ASKER's
 * story, in the asker's frame. Any number of plugs can be hungry at once —
 * couplings are independent contracts, there is no "worst output".
 */
export interface PortPlug {
  /**
   * hungry  = askers want more and THIS machine is the one to grow (amber)
   * blocked = askers want more but this machine is starving itself (red)
   * fed     = every asker gets what it asks for (green)
   * dump    = only dead-end buffers attached — nothing ever draws from
   *           them, so there is no ask to satisfy, just a place flow goes
   *
   * A buffer that HAS consumers is not a dump: it relays their asks one hop
   * upstream ("a recipe that crafts itself — the input is the output"), so
   * it participates in hungry/fed like any machine asker.
   */
  state: "hungry" | "blocked" | "fed" | "dump";
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
    consumersAsk += honestEdgeAskPerSecond(result?.edges[edge.id], result?.nodes[edge.target]);
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
  /** Consumed input with no line attached: assumed supplied by hand. */
  handFed: boolean;
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
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const machineNameOf = (id: string): string => {
    const node = nodesById.get(id);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    return recipe?.machineType ?? recipe?.name ?? "Machine";
  };
  const storageNameOf = (id: string): string => {
    const storage = storagesById.get(id);
    return storage ? `${storage.displayName ?? storage.resourceId} (buffer)` : "Buffer";
  };

  const buildSide = (side: "input" | "output"): RailPort[] => {
    const isInput = side === "input";
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
      for (const edge of edges) {
        const edgeResult = result?.edges[edge.id];
        const rate = edgeResult?.transferredPerSecond ?? 0;
        transferred += rate;
        if (isInput) {
          available += honestEdgeAvailablePerSecond(edgeResult, storagesById.has(edge.source));
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
          machineAsk += honestEdgeAskPerSecond(edgeResult, result?.nodes[edge.target]);
          machineGet += rate;
          machineTargets.add(edge.target);
        }
      }
      const wantedByLines = machineAsk + storageGet;

      const isBinding =
        verdict.kind === "starved" &&
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
        if (!connected) {
          tone = "idle";
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
        if (verdict.kind === "starved") {
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
          // Blocked only when this machine is genuinely starving (fix its
          // red input first). Anything else with a hungry plug — full speed
          // OR damped-ask headroom — is an act-HERE seat: hungry.
          state:
            demanders === 0
              ? "dump"
              : hungry
                ? verdict.kind === "starved"
                  ? "blocked"
                  : "hungry"
                : "fed",
          askerName:
            machineTargets.size === 1 && relayTargets.size === 0
              ? machineNameOf([...machineTargets][0]!)
              : machineTargets.size === 0 && relayTargets.size === 1
                ? `via ${storageNameOf([...relayTargets][0]!)}`
                : demanders > 0
                  ? `${demanders} takers`
                  : dumpTargets.size === 1
                    ? storageNameOf([...dumpTargets][0]!)
                    : `${dumpTargets.size} buffers`,
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
        handFed: isInput && !connected,
        currentPerSecond,
        nameplatePerSecond: nameplate,
        wantedPerSecond,
        couldPerSecond,
        fillFraction,
        tone,
        plug,
        badge,
        showNameplate: isInput && isBinding,
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
  const rungs: LimitRung[] = [];

  // Fleet first: on a 100% tie with a supply rung, "machine count" is the
  // actionable name (dedupe keeps the first of a tie).
  rungs.push({ pct: 100, label: "machine count", now: false });

  for (const [key, flow] of Object.entries(nodeResult.inputs)) {
    if (flow.amountPerSecond <= RATE_EPSILON) {
      continue;
    }
    const edges = incoming.filter(
      (edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );
    // Hand-fed inputs never limit: the planner assumes they always arrive.
    if (edges.length === 0) {
      continue;
    }
    let available = 0;
    for (const edge of edges) {
      available += honestEdgeAvailablePerSecond(result?.edges[edge.id], storageIds.has(edge.source));
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
      wanted += honestEdgeAskPerSecond(result?.edges[edge.id], result?.nodes[edge.target]);
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
    capped.unshift({ pct: utilizationPct, label: "current — the plan under-asks it", now: true });
    if (capped.length > 4) {
      capped.pop();
    }
  }
  return capped;
}

