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
  };
  /** Choke: the worst unmet downstream ask across this node's outputs. */
  deficit?: {
    resourceKey: string;
    kind: ResourceKind;
    displayName: string;
    missingPerSecond: number;
    /** Machines to add so the ask is met; undefined when not computable. */
    machinesToAdd?: number;
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
 * design, to stay stable), so on a supply-capped line the only honest ask is
 * the nameplate one. Everything the UI says about hunger must go through
 * here — never through the damped figure directly.
 */
export function honestEdgeAskPerSecond(edgeResult: EdgeThroughput | undefined): number {
  if (!edgeResult) {
    return 0;
  }
  if (edgeResult.constraint === "supply") {
    return Math.max(edgeResult.nameplateDemandPerSecond ?? 0, edgeResult.demandPerSecond ?? 0);
  }
  return edgeResult.demandPerSecond ?? 0;
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
    const headroomPct = Math.max(0, Math.round((Math.min(capable, 1) - utilization) * 1000) / 10);
    return { kind: "demand-set", pct, headroomPct, deficit };
  }

  return {
    kind: "starved",
    pct,
    binding: findBindingInput(project, result, nodeResult, nodeId, incoming, demand),
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
  for (const edge of outgoing) {
    // A buffer absorbing surplus is not hunger; only machine asks count.
    if (storageIds.has(edge.target)) {
      continue;
    }
    const edgeResult = result.edges[edge.id];
    if (!edgeResult) {
      continue;
    }
    const missing = Math.max(
      0,
      honestEdgeAskPerSecond(edgeResult) - (edgeResult.transferredPerSecond ?? 0),
    );
    if (missing <= RATE_EPSILON) {
      continue;
    }
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    missingByKey.set(key, (missingByKey.get(key) ?? 0) + missing);
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

  const flow = nodeResult.outputs[worst.key as keyof typeof nodeResult.outputs];
  const node = project.nodes.find((entry) => entry.id === nodeId);
  const machineCount = Math.max(1, node?.machineCount ?? 1);
  const perMachine = flow ? flow.amountPerSecond / machineCount : 0;
  const machinesToAdd =
    perMachine > RATE_EPSILON
      ? Math.min(9999, Math.ceil(worst.missing / perMachine - RATE_EPSILON))
      : undefined;

  return {
    resourceKey: worst.key,
    kind: flow?.kind ?? "item",
    displayName: flow?.displayName ?? flow?.resourceId ?? worst.key,
    missingPerSecond: worst.missing,
    machinesToAdd: machinesToAdd && machinesToAdd > 0 ? machinesToAdd : undefined,
  };
}

function findBindingInput(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeResult: NodeThroughputResult,
  nodeId: string,
  incoming: ProjectEdge[],
  demand: number,
): NodeVerdict["binding"] {
  if (!result) {
    return undefined;
  }

  let binding:
    | { key: string; ratio: number; supplied: number; need: number; edges: ProjectEdge[] }
    | undefined;
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
      const edgeResult = result.edges[edge.id];
      supplied += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
    }
    const need = flow.amountPerSecond * Math.min(Math.max(demand, 0), 1);
    const ratio = need > RATE_EPSILON ? supplied / need : 1;
    if (!binding || ratio < binding.ratio) {
      binding = { key, ratio, supplied, need, edges };
    }
  }

  if (!binding) {
    return undefined;
  }

  const flow = nodeResult.inputs[binding.key as keyof typeof nodeResult.inputs];
  const shortfallPerSecond = Math.max(0, binding.need - binding.supplied);
  const upstream = findUpstreamCulprit(project, result, nodeId, binding.edges, shortfallPerSecond);
  return {
    resourceKey: binding.key,
    kind: flow?.kind ?? "item",
    displayName: flow?.displayName ?? flow?.resourceId ?? binding.key,
    suppliedPerSecond: binding.supplied,
    neededPerSecond: binding.need,
    shortfallPerSecond,
    upstreamName: upstream?.name,
    upstream,
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
    return { name: "its own loop", kind: "loop", pct: 100, atFullSpeed: false };
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === pick.source);
  if (storage) {
    return {
      name: `${storage.displayName ?? storage.resourceId} (buffer)`,
      kind: "buffer",
      pct: 100,
      atFullSpeed: false,
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
  let machinesToAdd: number | undefined;
  if (atFullSpeed && sourceResult && shortfallPerSecond > RATE_EPSILON) {
    const key = makeResourceKey(pick.resourceKind, pick.resourceId);
    const sourceFlow =
      sourceResult.outputs[key as keyof typeof sourceResult.outputs] ??
      Object.values(sourceResult.outputs).find((entry) => entry.resourceId === pick.resourceId);
    const machineCount = Math.max(1, sourceNode?.machineCount ?? 1);
    const perMachine = sourceFlow ? sourceFlow.amountPerSecond / machineCount : 0;
    if (perMachine > RATE_EPSILON) {
      const toAdd = Math.min(9999, Math.ceil(shortfallPerSecond / perMachine - RATE_EPSILON));
      machinesToAdd = toAdd > 0 ? toAdd : undefined;
    }
  }

  return { name, kind: "machine", pct, atFullSpeed, machinesToAdd };
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
      let wantedByLines = 0;
      for (const edge of edges) {
        const edgeResult = result?.edges[edge.id];
        transferred += edgeResult?.transferredPerSecond ?? 0;
        available += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
        if (!isInput) {
          wantedByLines += honestEdgeAskPerSecond(edgeResult);
        }
      }

      const isBinding = verdict.kind === "starved" && verdict.binding?.resourceKey === key;
      const isDeficit = verdict.kind === "choke" && verdict.deficit?.resourceKey === key;
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
        if (isDeficit) {
          tone = "hot";
          badge = {
            kind: "asked",
            perSecond: currentPerSecond + (verdict.deficit?.missingPerSecond ?? 0),
          };
        } else if (verdict.kind === "starved") {
          // The whole machine is slowed by an input; its outputs run slow too.
          tone = "slowed";
        } else if (verdict.kind === "demand-set") {
          tone = "calm";
        }
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
      const edgeResult = result?.edges[edge.id];
      available += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
    }
    rungs.push({
      pct: (available / flow.amountPerSecond) * 100,
      label: `${flow.displayName ?? flow.resourceId} supply`,
      now: false,
    });
  }

  rungs.push({ pct: 100, label: "machine count", now: false });

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
      wanted += honestEdgeAskPerSecond(result?.edges[edge.id]);
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
  return capped;
}

