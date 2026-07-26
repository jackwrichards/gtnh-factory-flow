import {
  isRecipeInputConsumed,
  parseResourceKey,
  resourceLabel,
} from "@/lib/model/resources";
import { plannerResourceSatisfiesInput } from "./resource-matching";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryProject,
  Recipe,
  ResourceKey,
} from "@/lib/model/types";
import { optimizeMachineCountsForProject } from "@/lib/solver/machine-count-optimizer";
import type { GapFillPlan, PlannerResource, StepInputSource } from "./types";

/** The stockpile's single outgoing anchor; every supply edge leaves from it. */
export const STOCKPILE_SUPPLY_HANDLE = "stockpile:supply";
/** The request's single incoming anchor. */
export const REQUEST_DEMAND_HANDLE = "request:demand";

export const GAP_FILL_COLUMN_PITCH = 460;
export const GAP_FILL_ROW_PITCH = 380;

export interface MaterializedGapFill {
  project: FactoryProject;
  newNodeIds: string[];
  rootNodeId?: string;
  touchedExistingNodeIds: string[];
}

/**
 * Turns a solved plan into ordinary graph: nodes in layered columns walking
 * left from the request, every leaf wired into a stockpile, machine counts
 * scaled to the requested rate. Everything it adds is plain project data —
 * after this runs there is no special gap-fill state left to maintain.
 */
export function materializeGapFillPlan(
  project: FactoryProject,
  stockpileId: string,
  requestId: string,
  plan: GapFillPlan<Recipe>,
): MaterializedGapFill {
  const request = (project.requests ?? []).find((entry) => entry.id === requestId);
  if (!request) {
    return { project, newNodeIds: [], touchedExistingNodeIds: [] };
  }

  const stockpileIds = new Set((project.stockpiles ?? []).map((entry) => entry.id));
  const fallbackStockpileId = stockpileIds.has(stockpileId)
    ? stockpileId
    : (project.stockpiles ?? [])[0]?.id;

  const depths = computeStepDepths(plan);
  const nodeIdsByStep = plan.steps.map(() => createGapFillId("node"));
  const newNodes: FactoryNode[] = plan.steps.map((step, stepIndex) => ({
    id: nodeIdsByStep[stepIndex],
    recipeId: step.recipe.id,
    machineCount: Math.max(1, step.machineCount),
    parallel: 1,
    overclockTier: step.recipe.minimumTier,
    recipeInputOverrides: buildStepInputOverrides(step.recipe, step.inputs),
    enabled: true,
    position: { x: 0, y: 0 },
  }));
  positionNodesInLayers(newNodes, depths, request.position);

  const newEdges: FactoryEdge[] = [];
  const touchedExistingNodeIds = new Set<string>();

  for (const [stepIndex, step] of plan.steps.entries()) {
    for (const input of step.inputs) {
      const source = input.source;
      if (source.type === "missing") {
        continue;
      }

      const resource = source.resource;
      if (source.type === "supply") {
        const supplyStockpileId = resolveStockpileId(resource, stockpileIds, fallbackStockpileId);
        if (!supplyStockpileId) {
          continue;
        }

        newEdges.push({
          id: createGapFillId("edge"),
          source: supplyStockpileId,
          target: nodeIdsByStep[stepIndex],
          sourceHandle: STOCKPILE_SUPPLY_HANDLE,
          resourceKind: resource.kind,
          resourceId: resource.id,
          label: resourceLabel(resource),
        });
        continue;
      }

      if (source.type === "existing") {
        touchedExistingNodeIds.add(source.nodeId);
        newEdges.push({
          id: createGapFillId("edge"),
          source: source.nodeId,
          target: nodeIdsByStep[stepIndex],
          resourceKind: resource.kind,
          resourceId: resource.id,
          label: resourceLabel(resource),
        });
        continue;
      }

      const output = parseResourceKey(source.outputKey as ResourceKey);
      newEdges.push({
        id: createGapFillId("edge"),
        source: nodeIdsByStep[source.stepIndex],
        target: nodeIdsByStep[stepIndex],
        resourceKind: output.kind,
        resourceId: output.resourceId,
        label: resourceLabel({ id: output.resourceId, displayName: resource.displayName }),
      });
    }
  }

  // Wire the goal itself: from the produced chain's root, or straight off an
  // existing node for the zero-step "tap what you already make" plan.
  const rootNodeId = nodeIdsByStep[0];
  if (plan.steps.length > 0) {
    newEdges.push({
      id: createGapFillId("edge"),
      source: rootNodeId,
      target: request.id,
      targetHandle: REQUEST_DEMAND_HANDLE,
      resourceKind: request.kind,
      resourceId: request.resourceId,
      label: resourceLabel({ id: request.resourceId, displayName: request.displayName }),
    });
  } else {
    for (const draw of plan.stats.existingDraws) {
      touchedExistingNodeIds.add(draw.nodeId);
      newEdges.push({
        id: createGapFillId("edge"),
        source: draw.nodeId,
        target: request.id,
        targetHandle: REQUEST_DEMAND_HANDLE,
        resourceKind: request.kind,
        resourceId: request.resourceId,
        label: resourceLabel({ id: request.resourceId, displayName: request.displayName }),
      });
    }
  }

  const knownRecipeIds = new Set(project.recipes.map((recipe) => recipe.id));
  const addedRecipes: Recipe[] = [];
  for (const step of plan.steps) {
    if (!knownRecipeIds.has(step.recipe.id)) {
      knownRecipeIds.add(step.recipe.id);
      addedRecipes.push(step.recipe);
    }
  }

  const merged: FactoryProject = {
    ...project,
    recipes: [...project.recipes, ...addedRecipes],
    nodes: [...project.nodes, ...newNodes],
    edges: [...project.edges, ...dedupeAgainstExisting(project.edges, newEdges)],
  };

  return {
    project: applyScopedMachineCounts(merged, new Set(nodeIdsByStep), touchedExistingNodeIds),
    newNodeIds: nodeIdsByStep,
    rootNodeId: plan.steps.length > 0 ? rootNodeId : undefined,
    touchedExistingNodeIds: [...touchedExistingNodeIds],
  };
}

/**
 * Distance from the request, so consumers sit right and producers walk left.
 * A shared producer serving two columns lands in the deeper (leftmost) one.
 */
function computeStepDepths(plan: GapFillPlan<Recipe>): number[] {
  const depths: number[] = plan.steps.map((_, index) => (index === 0 ? 0 : 1));
  const maxPasses = plan.steps.length + 1;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const [stepIndex, step] of plan.steps.entries()) {
      for (const input of step.inputs) {
        if (input.source.type !== "step") {
          continue;
        }

        const required = depths[stepIndex] + 1;
        if (depths[input.source.stepIndex] < required) {
          depths[input.source.stepIndex] = required;
          changed = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  return depths;
}

function positionNodesInLayers(
  nodes: FactoryNode[],
  depths: number[],
  anchor: { x: number; y: number },
): void {
  const stepsByDepth = new Map<number, number[]>();
  for (const [stepIndex, depth] of depths.entries()) {
    stepsByDepth.set(depth, [...(stepsByDepth.get(depth) ?? []), stepIndex]);
  }

  for (const [depth, stepIndexes] of stepsByDepth) {
    stepIndexes.forEach((stepIndex, row) => {
      nodes[stepIndex].position = {
        x: anchor.x - (depth + 1) * GAP_FILL_COLUMN_PITCH,
        y: anchor.y + (row - (stepIndexes.length - 1) / 2) * GAP_FILL_ROW_PITCH,
      };
    });
  }
}

/**
 * When a chosen source is a concrete member of an oredict (or alternative)
 * slot, pin the node to that concrete resource — the same behaviour as
 * hand-connecting an edge, so Spruce Log does not render as "Any Log".
 */
function buildStepInputOverrides(
  recipe: Recipe,
  inputs: Array<{ inputIndex: number; source: StepInputSource }>,
): FactoryNode["recipeInputOverrides"] {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};

  for (const { inputIndex, source } of inputs) {
    if (source.type === "missing") {
      continue;
    }

    const input = recipe.inputs[inputIndex];
    const resource = source.resource;
    if (
      !input ||
      !isRecipeInputConsumed(input) ||
      (input.kind === resource.kind && input.id === resource.id) ||
      !plannerResourceSatisfiesInput(resource, input)
    ) {
      continue;
    }

    const alternative = input.alternatives?.find(
      (entry) => entry.kind === resource.kind && entry.id === resource.id,
    );
    overrides[String(inputIndex)] = {
      ...input,
      ...alternative,
      kind: resource.kind,
      id: resource.id,
      amount: input.amount,
      displayName: resource.displayName ?? alternative?.displayName ?? input.displayName,
      iconPath: resource.iconPath ?? alternative?.iconPath ?? input.iconPath,
      iconAtlas: resource.iconAtlas ?? alternative?.iconAtlas ?? input.iconAtlas,
      dominantColor: resource.dominantColor ?? alternative?.dominantColor ?? input.dominantColor,
      alternatives: undefined,
    };
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function resolveStockpileId(
  resource: PlannerResource,
  stockpileIds: Set<string>,
  fallbackStockpileId: string | undefined,
): string | undefined {
  if (resource.stockpileId && stockpileIds.has(resource.stockpileId)) {
    return resource.stockpileId;
  }

  return fallbackStockpileId;
}

function dedupeAgainstExisting(existing: FactoryEdge[], added: FactoryEdge[]): FactoryEdge[] {
  const seen = new Set(existing.map(edgeIdentity));
  const deduped: FactoryEdge[] = [];

  for (const edge of added) {
    const identity = edgeIdentity(edge);
    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    deduped.push(edge);
  }

  return deduped;
}

function edgeIdentity(edge: FactoryEdge): string {
  return `${edge.source}|${edge.target}|${edge.resourceKind}|${edge.resourceId}`;
}

/**
 * Runs the machine-count optimizer over the merged project but only keeps its
 * answer for nodes this materialization created or tapped. Bystander nodes
 * keep whatever count the user set; a tapped existing node only ever scales
 * up, never down, since its other consumers may not be represented as demand.
 */
function applyScopedMachineCounts(
  project: FactoryProject,
  newNodeIds: Set<string>,
  touchedExistingNodeIds: Set<string>,
): FactoryProject {
  const optimized = optimizeMachineCountsForProject(project);

  return {
    ...project,
    nodes: project.nodes.map((node) => {
      const optimizedCount = optimized.machineCounts.get(node.id);
      if (optimizedCount === undefined) {
        return node;
      }

      if (newNodeIds.has(node.id)) {
        return optimizedCount === node.machineCount
          ? node
          : { ...node, machineCount: optimizedCount };
      }

      if (touchedExistingNodeIds.has(node.id) && optimizedCount > node.machineCount) {
        return { ...node, machineCount: optimizedCount };
      }

      return node;
    }),
  };
}

function createGapFillId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
