import type {
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

export interface NodeVerdict {
  kind: NodeVerdictKind;
  /** Clamped display percentage, 0-100. */
  pct: number;
  /** Starved: the input that pins the machine below what's asked of it. */
  binding?: {
    resourceKey: string;
    kind: ResourceKind;
    displayName: string;
    /** Rate still missing versus the demanded speed. */
    shortfallPerSecond: number;
    /** Who to fix: the machine/buffer on the short line, if identifiable. */
    upstreamName?: string;
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
      (edgeResult.demandPerSecond ?? 0) - (edgeResult.transferredPerSecond ?? 0),
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
  return {
    resourceKey: binding.key,
    kind: flow?.kind ?? "item",
    displayName: flow?.displayName ?? flow?.resourceId ?? binding.key,
    shortfallPerSecond: Math.max(0, binding.need - binding.supplied),
    upstreamName: nameUpstreamCulprit(project, result, nodeId, binding.edges),
  };
}

/**
 * The machine (or buffer) to go fix on a starved line: prefer the edge whose
 * source has nothing left to give, otherwise the biggest supplier.
 */
function nameUpstreamCulprit(
  project: FactoryProject,
  result: ThroughputResult,
  nodeId: string,
  edges: ProjectEdge[],
): string | undefined {
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
    return "its own loop";
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === pick.source);
  if (storage) {
    return `${storage.displayName ?? storage.resourceId} (buffer)`;
  }

  const sourceNode = project.nodes.find((entry) => entry.id === pick.source);
  const recipe = sourceNode
    ? project.recipes.find((entry) => entry.id === sourceNode.recipeId)
    : undefined;
  return recipe?.machineType || recipe?.name || undefined;
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
  fillFraction: number;
  tone: "ok" | "bind" | "hot" | "calm" | "idle";
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
      for (const edge of edges) {
        const edgeResult = result?.edges[edge.id];
        transferred += edgeResult?.transferredPerSecond ?? 0;
        available += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
      }

      const isBinding = verdict.kind === "starved" && verdict.binding?.resourceKey === key;
      const isDeficit = verdict.kind === "choke" && verdict.deficit?.resourceKey === key;
      const askRate = nameplate * Math.min(demand, 1);

      let tone: RailPort["tone"] = "ok";
      let fillFraction: number;
      let currentPerSecond: number;
      let badge: RailPort["badge"];

      if (isInput) {
        currentPerSecond = connected ? transferred : nameplate * utilization;
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
        fillFraction = utilization;
        if (isDeficit) {
          tone = "hot";
          badge = {
            kind: "asked",
            perSecond: currentPerSecond + (verdict.deficit?.missingPerSecond ?? 0),
          };
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

