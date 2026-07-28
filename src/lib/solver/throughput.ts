import {
  getChanceMultiplier,
  getFilledCellFluidEquivalent,
  isRecipeInputConsumed,
  makeResourceKey,
  primaryOutput,
  resourceMatchesInput,
  resourceLabel,
} from "../model/resources";
import type {
  BottleneckReport,
  EdgeThroughput,
  FactoryProject,
  FactoryStorage,
  FuelEstimate,
  NodeThroughputResult,
  Recipe,
  ResourceAmount,
  ResourceBalance,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
  StorageThroughputResult,
  ThroughputResult,
} from "../model/types";
import { TICKS_PER_SECOND } from "../model/types";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "../model/recipe-rules";
import { getMachineOutputMultiplier, getMachineParallelMultiplier } from "./machine-effects";
import { getOverclockedRecipeStats } from "./overclock";
import {
  getRuntimeCalculationOutputs,
  runtimeCalculationWarning,
  selectRuntimeCalculationVariant,
} from "./runtime-calculation";

const EPSILON = 0.000001;

interface SolverOptions {
  generatedAt?: string;
}

type FlowRecord = Record<ResourceKey, ResourceFlow>;

export function calculateThroughput(
  project: FactoryProject,
  options: SolverOptions = {},
): ThroughputResult {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodes: Record<string, NodeThroughputResult> = {};
  const storages: Record<string, StorageThroughputResult> = {};
  const bottlenecks: BottleneckReport[] = [];
  let totalEuT = 0;
  const projectStorages = project.storages ?? [];
  const storagesById = new Map(projectStorages.map((storage) => [storage.id, storage]));

  for (const storage of projectStorages) {
    storages[storage.id] = {
      storageId: storage.id,
      kind: storage.kind,
      resourceId: storage.resourceId,
      displayName: storage.displayName,
      storedAmount: 0,
      capacity: storage.capacity ?? getDefaultStorageCapacity(storage),
      producedPerSecond: 0,
      consumedPerSecond: 0,
      netPerSecond: 0,
      status: "empty",
    };
  }

  for (const node of project.nodes) {
    const recipe = recipesById.get(node.recipeId);

    if (!recipe) {
      nodes[node.id] = {
        nodeId: node.id,
        recipeId: node.recipeId,
        recipeName: "Missing recipe",
        enabled: node.enabled,
        operationRatePerSecond: 0,
        inputs: {},
        outputs: {},
        euT: 0,
        requiredRatePerSecond: 0,
        maxRatePerSecond: 0,
        utilization: 0,
        theoreticalMachinesRequired: 0,
        status: "missing-recipe",
        warnings: [`Recipe "${node.recipeId}" does not exist.`],
      };
      bottlenecks.push({
        id: `missing-recipe:${node.id}`,
        kind: "missing-recipe",
        severity: "critical",
        message: `Node ${node.id} references missing recipe ${node.recipeId}.`,
        nodeId: node.id,
      });
      continue;
    }

    if (!node.enabled) {
      nodes[node.id] = buildDisabledNodeResult(node.id, recipe);
      continue;
    }

    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
    const overclockedRecipe = getOverclockedRecipeStats(nodeRecipe, node);
    const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
    const runtimeOutputs = getRuntimeCalculationOutputs(effectiveRecipe, node);
    const machineParallelMultiplier =
      runtimeVariant?.parallel ?? getMachineParallelMultiplier(effectiveRecipe, node);
    const operationRatePerSecond =
      (node.machineCount * node.parallel * machineParallelMultiplier * TICKS_PER_SECOND) /
      overclockedRecipe.durationTicks;
    const inputs: FlowRecord = {};
    const outputs: FlowRecord = {};

    for (const input of nodeRecipe.inputs) {
      if (!isRecipeInputConsumed(input)) {
        continue;
      }

      const amountPerSecond = input.amount * operationRatePerSecond;
      addFlow(inputs, input, amountPerSecond);
    }

    for (const output of runtimeOutputs ?? effectiveRecipe.outputs) {
      const amountPerSecond =
        output.amount *
        getChanceMultiplier(output) *
        (runtimeOutputs
          ? 1
          : getMachineOutputMultiplier(effectiveRecipe, node, output, overclockedRecipe.tier)) *
        operationRatePerSecond;
      addFlow(outputs, output, amountPerSecond);
    }

    const euT =
      overclockedRecipe.eut * node.machineCount * node.parallel * machineParallelMultiplier;
    totalEuT += euT;

    nodes[node.id] = {
      nodeId: node.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      enabled: true,
      operationRatePerSecond,
      inputs,
      outputs,
      euT,
      requiredRatePerSecond: 0,
      maxRatePerSecond: 0,
      utilization: 0,
      theoreticalMachinesRequired: 0,
      status: "underutilized",
      warnings: [runtimeCalculationWarning(effectiveRecipe, node)].filter(
        (warning): warning is string => Boolean(warning),
      ),
    };
  }

  const incomingEdgeCounts = countIncomingEdgesByTargetResource(project);
  const requiredByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const edgeResults: Record<string, EdgeThroughput> = {};
  const storageOutgoingDemand = calculateStorageOutgoingDemand(project, nodes, projectStorages);
  const storageIncomingCounts = countIncomingEdgesToStorageResource(project, projectStorages);
  const storageIncomingTransferred = new Map<string, number>();

  for (const edge of project.edges) {
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);

    if (sourceStorage || targetStorage) {
      if (sourceStorage && targetStorage) {
        continue;
      }

      if (targetStorage) {
        const sourceResult = nodes[edge.source];
        const countKey = `${targetStorage.id}|${key}`;
        const targetDemand = storageOutgoingDemand.get(key) ?? 0;
        const targetCount = storageIncomingCounts.get(key) ?? 1;
        const sourceCapacity = getCompatibleOutputFlow(sourceResult, edge)?.amountPerSecond ?? 0;
        const demandedPerSecond = targetDemand / targetCount;
        const displayedDemandPerSecond = Math.max(sourceCapacity, demandedPerSecond);
        const transferredPerSecond = Math.min(sourceCapacity, displayedDemandPerSecond);

        if (demandedPerSecond > EPSILON) {
          addRequiredRate(requiredByNodeAndResource, edge.source, key, demandedPerSecond);
        }
        storageIncomingTransferred.set(
          countKey,
          (storageIncomingTransferred.get(countKey) ?? 0) + transferredPerSecond,
        );
        updateStorageFlow(storages[targetStorage.id], transferredPerSecond, 0);
        edgeResults[edge.id] = buildEdgeResult(
          edge,
          key,
          displayedDemandPerSecond,
          transferredPerSecond,
        );
        continue;
      }

      if (sourceStorage) {
        const targetResult = nodes[edge.target];
        const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
        const targetDemand = targetResult?.inputs[targetDemandKey]?.amountPerSecond ?? 0;
        const demandPerSecond = targetDemand / targetCount;
        const transferredPerSecond = demandPerSecond;

        updateStorageFlow(storages[sourceStorage.id], 0, transferredPerSecond);
        edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, transferredPerSecond);
        continue;
      }
    }

    const sourceResult = nodes[edge.source];
    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
    const targetDemand = targetResult?.inputs[targetDemandKey]?.amountPerSecond ?? 0;
    const demandPerSecond = targetDemand / targetCount;
    const sourceCapacity = getCompatibleOutputFlow(sourceResult, edge)?.amountPerSecond ?? 0;
    const transferredPerSecond = Math.min(sourceCapacity, demandPerSecond);

    addRequiredRate(requiredByNodeAndResource, edge.source, key, demandPerSecond);

    edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, transferredPerSecond);
  }

  aggregateStorageFlowsByResource(projectStorages, storages);

  for (const storageResult of Object.values(storages)) {
    finalizeStorageFlow(storageResult);
  }

  applyProjectTarget(project, nodes, requiredByNodeAndResource);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    const recipe = recipesById.get(node.recipeId);

    if (!nodeResult || !recipe || nodeResult.status === "missing-recipe") {
      continue;
    }

    if (!node.enabled) {
      continue;
    }

    const requiredByResource = new Map(requiredByNodeAndResource.get(node.id));

    if (node.targetOutput) {
      const targetKey = makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId);
      const previous = requiredByResource.get(targetKey) ?? 0;
      requiredByResource.set(targetKey, Math.max(previous, node.targetOutput.amountPerSecond));
    }

    const outputFlows = Object.values(nodeResult.outputs);
    if (requiredByResource.size === 0 && outputFlows.length > 0) {
      const output = primaryOutput(recipe);
      if (output) {
        const key = makeResourceKey(output.kind, output.id);
        requiredByResource.set(key, nodeResult.outputs[key]?.amountPerSecond ?? 0);
      }
    }

    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const overclockedRecipe = {
      ...applyMachineHandlerToRecipe(nodeRecipe, node),
      ...getOverclockedRecipeStats(nodeRecipe, node),
      outputs: applyOutputMultipliers(nodeRecipe, node),
    };
    const utilizationReport = selectLimitingOutput(
      overclockedRecipe,
      node,
      nodeResult,
      requiredByResource,
    );
    nodeResult.requiredRatePerSecond = utilizationReport.requiredRatePerSecond;
    nodeResult.maxRatePerSecond = utilizationReport.maxRatePerSecond;
    nodeResult.utilization = utilizationReport.utilization;
    nodeResult.theoreticalMachinesRequired = utilizationReport.theoreticalMachinesRequired;
    nodeResult.limitingResource = utilizationReport.limitingResource;
    nodeResult.status = getNodeStatus(nodeResult.utilization);
  }

  const maxUtilizationPasses = Math.max(1, project.nodes.length + 1);
  for (let pass = 0; pass < maxUtilizationPasses; pass += 1) {
    refreshEdgeResultsFromNodeUtilization(
      project,
      recipesById,
      projectStorages,
      nodes,
      edgeResults,
      incomingEdgeCounts,
      storagesById,
    );
    if (
      !refreshNodeUtilizationFromEdgeResults(project, recipesById, nodes, edgeResults, storagesById)
    ) {
      break;
    }
  }
  refreshEdgeResultsFromNodeUtilization(
    project,
    recipesById,
    projectStorages,
    nodes,
    edgeResults,
    incomingEdgeCounts,
    storagesById,
  );
  refreshStorageResultsFromEdges(projectStorages, storages, project.edges, edgeResults);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    const recipe = recipesById.get(node.recipeId);
    if (!nodeResult || !recipe || nodeResult.status !== "bottleneck") {
      continue;
    }

    bottlenecks.push({
      id: `node-capacity:${node.id}`,
      kind: "node-capacity",
      severity: "critical",
      message: `${recipe.name} needs ${nodeResult.requiredRatePerSecond.toFixed(
        2,
      )}/s but can produce ${nodeResult.maxRatePerSecond.toFixed(2)}/s.`,
      nodeId: node.id,
      resource: nodeResult.limitingResource,
      requiredPerSecond: nodeResult.requiredRatePerSecond,
      capacityPerSecond: nodeResult.maxRatePerSecond,
    });
  }

  const resourceResults = Object.fromEntries(
    calculateEffectiveBalances(project, nodes, edgeResults, storagesById),
  ) as Record<ResourceKey, ResourceBalance>;
  const externalInputs = Object.values(resourceResults)
    .filter((balance) => balance.deficitPerSecond > EPSILON)
    .sort((a, b) => b.deficitPerSecond - a.deficitPerSecond);
  const unconsumedOutputs = Object.values(resourceResults)
    .filter((balance) => balance.surplusPerSecond > EPSILON)
    .sort((a, b) => b.surplusPerSecond - a.surplusPerSecond);

  for (const balance of externalInputs) {
    bottlenecks.push({
      id: `resource-deficit:${balance.key}`,
      kind: "resource-deficit",
      severity: "critical",
      message: `${balance.displayName ?? balance.resourceId} is short by ${balance.deficitPerSecond.toFixed(
        2,
      )}/s.`,
      resource: {
        key: balance.key,
        kind: balance.kind,
        resourceId: balance.resourceId,
        displayName: balance.displayName,
        amountPerSecond: balance.deficitPerSecond,
      },
      requiredPerSecond: balance.consumedPerSecond,
      capacityPerSecond: balance.producedPerSecond,
    });
  }

  return {
    nodes,
    storages,
    resources: resourceResults,
    edges: edgeResults,
    totalEuT,
    totalEuPerSecond: totalEuT * TICKS_PER_SECOND,
    fuelEstimate: calculateFuelEstimate(project, totalEuT),
    bottlenecks,
    externalInputs,
    unconsumedOutputs,
    generatedAt: options.generatedAt ?? project.metadata?.updatedAt ?? "unspecified",
  };
}

function buildDisabledNodeResult(nodeId: string, recipe: Recipe): NodeThroughputResult {
  return {
    nodeId,
    recipeId: recipe.id,
    recipeName: recipe.name,
    enabled: false,
    operationRatePerSecond: 0,
    inputs: {},
    outputs: {},
    euT: 0,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization: 0,
    theoreticalMachinesRequired: 0,
    status: "disabled",
    warnings: [],
  };
}

function addFlow(record: FlowRecord, resource: ResourceAmount, amountPerSecond: number): void {
  const key = makeResourceKey(resource.kind, resource.id);
  const existing = record[key];

  record[key] = {
    key,
    kind: resource.kind,
    resourceId: resource.id,
    displayName: resource.displayName,
    alternatives: resource.alternatives ?? existing?.alternatives,
    amountPerSecond: (existing?.amountPerSecond ?? 0) + amountPerSecond,
  };
}

function ensureBalance(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
): ResourceBalance {
  const key = makeResourceKey(resource.kind, resource.id);
  const existing = balances.get(key);

  if (existing) {
    return existing;
  }

  const balance: ResourceBalance = {
    key,
    kind: resource.kind,
    resourceId: resource.id,
    displayName: resource.displayName,
    producedPerSecond: 0,
    consumedPerSecond: 0,
    netPerSecond: 0,
    surplusPerSecond: 0,
    deficitPerSecond: 0,
  };
  balances.set(key, balance);
  return balance;
}

function addBalanceProduction(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.producedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function subtractBalanceProduction(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.producedPerSecond = Math.max(0, balance.producedPerSecond - amountPerSecond);
  updateBalanceNet(balance);
}

function addBalanceConsumption(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.consumedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function updateBalanceNet(balance: ResourceBalance): void {
  balance.netPerSecond = balance.producedPerSecond - balance.consumedPerSecond;
  balance.surplusPerSecond = Math.max(0, balance.netPerSecond);
  balance.deficitPerSecond = Math.max(0, -balance.netPerSecond);
}

function calculateEffectiveBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
): Map<ResourceKey, ResourceBalance> {
  const balances = new Map<ResourceKey, ResourceBalance>();

  for (const node of Object.values(nodes)) {
    if (!node.enabled || node.status === "missing-recipe") {
      continue;
    }

    const utilization = clampUtilization(node.utilization);
    for (const input of Object.values(node.inputs)) {
      addBalanceConsumption(
        balances,
        {
          kind: input.kind,
          id: input.resourceId,
          displayName: input.displayName,
          amount: 0,
        },
        input.amountPerSecond * utilization,
      );
    }

    for (const output of Object.values(node.outputs)) {
      addBalanceProduction(
        balances,
        {
          kind: output.kind,
          id: output.resourceId,
          displayName: output.displayName,
          amount: 0,
        },
        output.amountPerSecond * utilization,
      );
    }
  }

  applyConvertedStorageOutputBalances(project, nodes, edgeResults, storagesById, balances);

  return balances;
}

function applyConvertedStorageOutputBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
  balances: Map<ResourceKey, ResourceBalance>,
): void {
  for (const edge of project.edges) {
    if (!storagesById.has(edge.target) || storagesById.has(edge.source)) {
      continue;
    }

    const transferredPerSecond = edgeResults[edge.id]?.transferredPerSecond ?? 0;
    if (transferredPerSecond <= EPSILON) {
      continue;
    }

    const sourceResult = nodes[edge.source];
    const output = sourceResult
      ? Object.values(sourceResult.outputs).find(
          (candidate) =>
            candidate.kind !== edge.resourceKind &&
            resourceMatchesInput(
              { kind: edge.resourceKind, id: edge.resourceId },
              {
                kind: candidate.kind,
                id: candidate.resourceId,
                displayName: candidate.displayName,
              },
            ),
        )
      : undefined;
    if (!sourceResult || !output) {
      continue;
    }

    const outputResource = {
      kind: output.kind,
      id: output.resourceId,
      displayName: output.displayName,
      alternatives: output.alternatives,
      amount: transferredPerSecond,
    };
    const edgeResource = {
      kind: edge.resourceKind,
      id: edge.resourceId,
      displayName: edge.label,
      amount: transferredPerSecond,
    };

    if (edge.resourceKind === "fluid" && output.kind === "item") {
      const fluid = getFilledCellFluidEquivalent(outputResource);
      if (fluid?.id !== edge.resourceId || !fluid.amount || fluid.amount <= 0) {
        continue;
      }

      const cellAmountPerSecond = transferredPerSecond * (output.amountPerSecond / fluid.amount);
      subtractBalanceProduction(balances, outputResource, cellAmountPerSecond);
      addBalanceProduction(balances, edgeResource, transferredPerSecond);
    }
  }
}

function countIncomingEdgesByTargetResource(project: FactoryProject): Map<string, number> {
  const counts = new Map<string, number>();

  for (const edge of project.edges) {
    const key =
      getEdgeTargetDemandKey(project, edge) ?? makeResourceKey(edge.resourceKind, edge.resourceId);
    const countKey = `${edge.target}|${key}`;
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
  }

  return counts;
}

function getEdgeTargetDemandKey(project: FactoryProject, edge: FactoryProject["edges"][number]) {
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

function countIncomingEdgesToStorageResource(
  project: FactoryProject,
  storages: FactoryStorage[],
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const storagesById = new Map(storages.map((storage) => [storage.id, storage]));
  const counts = new Map<string, number>();

  for (const edge of project.edges) {
    const storage = storagesById.get(edge.target);
    if (!storageIds.has(edge.target) || !storage) {
      continue;
    }

    const key = makeResourceKey(storage.kind, storage.resourceId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function calculateStorageIncomingSupply(
  project: FactoryProject,
  storages: FactoryStorage[],
  edgeResults: Record<string, EdgeThroughput>,
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const storagesById = new Map(storages.map((storage) => [storage.id, storage]));
  const supply = new Map<string, number>();

  for (const edge of project.edges) {
    if (storageIds.has(edge.source) || !storageIds.has(edge.target)) {
      continue;
    }

    const storage = storagesById.get(edge.target);
    if (!storage) {
      continue;
    }

    const key = makeResourceKey(storage.kind, storage.resourceId);
    supply.set(key, (supply.get(key) ?? 0) + (edgeResults[edge.id]?.transferredPerSecond ?? 0));
  }

  return supply;
}

/**
 * Max-min fair split of a producer's real output among competing machine
 * consumers (progressive filling): everyone gets an equal share until their
 * demand is met, small consumers are satisfied first, and nobody is starved
 * to feed a giant. Returns each edge's allocation plus its cap - the most it
 * could claim right now, which is its allocation plus any unclaimed leftover
 * when it is already satisfied.
 */
function allocateMaxMinShares(
  availablePerSecond: number,
  demands: Array<{ edgeId: string; demandPerSecond: number }>,
): Map<string, { allocatedPerSecond: number; capPerSecond: number }> {
  const shares = new Map<string, { allocatedPerSecond: number; capPerSecond: number }>();
  const sorted = [...demands].sort((left, right) => left.demandPerSecond - right.demandPerSecond);
  let remaining = Math.max(0, availablePerSecond);

  sorted.forEach((entry, index) => {
    const equalShare = remaining / (sorted.length - index);
    const allocated = Math.min(Math.max(entry.demandPerSecond, 0), equalShare);
    remaining -= allocated;
    shares.set(entry.edgeId, { allocatedPerSecond: allocated, capPerSecond: allocated });
  });

  // Whatever nobody claimed stays on offer to every satisfied edge.
  for (const [edgeId, share] of shares) {
    const demand = demands.find((entry) => entry.edgeId === edgeId)?.demandPerSecond ?? 0;
    if (share.allocatedPerSecond + EPSILON >= demand) {
      shares.set(edgeId, { ...share, capPerSecond: share.allocatedPerSecond + remaining });
    }
  }

  return shares;
}

function refreshEdgeResultsFromNodeUtilization(
  project: FactoryProject,
  recipesById: Map<string, Recipe>,
  projectStorages: FactoryStorage[],
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  incomingEdgeCounts: Map<string, number>,
  storagesById: Map<string, FactoryStorage>,
): void {
  const storageIncomingCounts = countIncomingEdgesToStorageResource(project, projectStorages);
  const storageSinkCounts = countStorageSinkEdgesBySourceResource(project, storagesById);
  const storageOutgoingDemand = calculateEffectiveStorageOutgoingDemand(
    project,
    nodes,
    projectStorages,
  );
  const storageIncomingSupply = calculateStorageIncomingSupply(
    project,
    projectStorages,
    edgeResults,
  );
  const directDemandBySourceResource = calculateDirectConsumerDemandBySourceResource(
    project,
    nodes,
    incomingEdgeCounts,
    storagesById,
  );
  // Ration each machine producer's real output among its machine consumers
  // with max-min fairness, so one 10/s output cannot feed two machines 10/s
  // each. Storage stays out of the ration entirely: it has the lowest
  // priority and only ever sees what direct consumers leave behind.
  const machineDemandsBySourceResource = new Map<
    string,
    Array<{ edgeId: string; demandPerSecond: number }>
  >();
  const rationAvailableBySourceResource = new Map<string, number>();
  for (const edge of project.edges) {
    if (storagesById.has(edge.source) || storagesById.has(edge.target)) {
      continue;
    }

    const sourceResult = nodes[edge.source];
    const targetResult = nodes[edge.target];
    if (!sourceResult || !targetResult) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
    const demandPerSecond =
      getEffectiveFlowRate(targetResult.inputs[targetDemandKey], targetResult.utilization) /
      targetCount;
    const groupKey = `${edge.source}|${key}`;
    const group = machineDemandsBySourceResource.get(groupKey) ?? [];
    group.push({ edgeId: edge.id, demandPerSecond });
    machineDemandsBySourceResource.set(groupKey, group);
    if (!rationAvailableBySourceResource.has(groupKey)) {
      rationAvailableBySourceResource.set(
        groupKey,
        getEffectiveFlowRate(getCompatibleOutputFlow(sourceResult, edge), sourceResult.utilization),
      );
    }
  }

  const rationByEdge = new Map<string, { allocatedPerSecond: number; capPerSecond: number }>();
  for (const [groupKey, demands] of machineDemandsBySourceResource) {
    const available = rationAvailableBySourceResource.get(groupKey) ?? 0;
    if (!Number.isFinite(available)) {
      continue;
    }

    for (const [edgeId, share] of allocateMaxMinShares(available, demands)) {
      rationByEdge.set(edgeId, share);
    }
  }

  for (const edge of project.edges) {
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);

    if (sourceStorage && targetStorage) {
      continue;
    }

    const sourceResult = nodes[edge.source];
    const targetResult = nodes[edge.target];
    const sourceFullCapacity =
      sourceStorage || !sourceResult
        ? Number.POSITIVE_INFINITY
        : (getCompatibleOutputFlow(sourceResult, edge)?.amountPerSecond ?? 0);
    const targetCount = targetStorage
      ? (storageIncomingCounts.get(key) ?? 1)
      : (incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1);
    const storageHasIncomingSupply = sourceStorage && (storageIncomingCounts.get(key) ?? 0) > 0;
    const storageTotalDemand = sourceStorage ? (storageOutgoingDemand.get(key) ?? 0) : 0;
    const storageAvailableSupply = sourceStorage ? (storageIncomingSupply.get(key) ?? 0) : 0;
    const storageEdgeDemand =
      sourceStorage && targetResult
        ? getEffectiveFlowRate(targetResult.inputs[targetDemandKey], targetResult.utilization) /
          targetCount
        : 0;
    const sourceEffectiveCapacity = sourceStorage
      ? storageHasIncomingSupply
        ? storageTotalDemand > EPSILON
          ? storageAvailableSupply * (storageEdgeDemand / storageTotalDemand)
          : storageAvailableSupply
        : Number.POSITIVE_INFINITY
      : !sourceResult
        ? Number.POSITIVE_INFINITY
        : getEffectiveFlowRate(
            getCompatibleOutputFlow(sourceResult, edge),
            sourceResult.utilization,
          );
    const sourceStorageCapacityBase = targetStorage ? sourceFullCapacity : sourceEffectiveCapacity;
    const ration = rationByEdge.get(edge.id);
    const sourceCapacity = targetStorage
      ? Math.max(
          0,
          sourceStorageCapacityBase -
            (directDemandBySourceResource.get(`${edge.source}|${key}`) ?? 0),
        ) / (storageSinkCounts.get(`${edge.source}|${key}`) ?? 1)
      : ration
        ? Math.min(sourceEffectiveCapacity, ration.capPerSecond)
        : sourceEffectiveCapacity;
    const targetDemand = targetStorage
      ? sourceCapacity
      : !targetResult
        ? sourceCapacity
        : getEffectiveFlowRate(targetResult.inputs[targetDemandKey], targetResult.utilization) /
          targetCount;
    const demandPerSecond = Number.isFinite(targetDemand) ? targetDemand : 0;
    const transferredPerSecond = Math.min(sourceCapacity, demandPerSecond);
    const settledTransferred = Number.isFinite(transferredPerSecond)
      ? transferredPerSecond
      : demandPerSecond;
    // Unscaled by utilisation, unlike demandPerSecond above. A tank accepts
    // whatever it is given, so it is never short of its nameplate.
    const nameplateDemandPerSecond =
      targetStorage || !targetResult
        ? settledTransferred
        : (targetResult.inputs[targetDemandKey]?.amountPerSecond ?? 0) / targetCount;

    edgeResults[edge.id] = buildEdgeResult(edge, key, demandPerSecond, settledTransferred, {
      nameplateDemandPerSecond,
      // Total output rather than this edge's share of it. When a producer feeds
      // several consumers that understates how maxed out it is, so the split
      // case falls back to "demand" - under-flagging rather than crying wolf.
      // The rationed per-edge share travels separately as fairSharePerSecond.
      sourceCapacityPerSecond: sourceFullCapacity,
      fairSharePerSecond: ration?.capPerSecond,
    });
  }
}

function canRunForStorageSurplus(
  project: FactoryProject,
  recipesById: Map<string, Recipe>,
  nodeId: string,
): boolean {
  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = node ? recipesById.get(node.recipeId) : undefined;
  if (!node || !recipe || !node.enabled) {
    return false;
  }

  return applyRecipeInputOverrides(recipe, node).inputs.every(
    (input) => !isRecipeInputConsumed(input),
  );
}

function calculateDirectConsumerDemandBySourceResource(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  incomingEdgeCounts: Map<string, number>,
  storagesById: Map<string, FactoryStorage>,
): Map<string, number> {
  const demand = new Map<string, number>();

  for (const edge of project.edges) {
    if (storagesById.has(edge.source) || storagesById.has(edge.target)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
    const edgeDemand =
      getEffectiveFlowRate(targetResult?.inputs[targetDemandKey], targetResult?.utilization ?? 0) /
      targetCount;
    const sourceKey = `${edge.source}|${key}`;
    demand.set(sourceKey, (demand.get(sourceKey) ?? 0) + edgeDemand);
  }

  return demand;
}

function countStorageSinkEdgesBySourceResource(
  project: FactoryProject,
  storagesById: Map<string, FactoryStorage>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const edge of project.edges) {
    if (storagesById.has(edge.source) || !storagesById.has(edge.target)) {
      continue;
    }

    const key = `${edge.source}|${makeResourceKey(edge.resourceKind, edge.resourceId)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function refreshStorageResultsFromEdges(
  projectStorages: FactoryStorage[],
  storages: Record<string, StorageThroughputResult>,
  edges: FactoryProject["edges"],
  edgeResults: Record<string, EdgeThroughput>,
): void {
  const storageIds = new Set(projectStorages.map((storage) => storage.id));

  for (const storage of projectStorages) {
    const result = storages[storage.id];
    if (!result) {
      continue;
    }

    result.producedPerSecond = 0;
    result.consumedPerSecond = 0;
    result.netPerSecond = 0;
    result.storedAmount = 0;
    result.status = "empty";
  }

  for (const edge of edges) {
    const edgeResult = edgeResults[edge.id];
    if (!edgeResult) {
      continue;
    }

    if (storageIds.has(edge.target) && !storageIds.has(edge.source)) {
      updateStorageFlow(storages[edge.target], edgeResult.transferredPerSecond, 0);
    } else if (storageIds.has(edge.source) && !storageIds.has(edge.target)) {
      updateStorageFlow(storages[edge.source], 0, edgeResult.transferredPerSecond);
    }
  }

  aggregateStorageFlowsByResource(projectStorages, storages);

  for (const storageResult of Object.values(storages)) {
    finalizeStorageFlow(storageResult);
  }
}

function calculateConnectedInputSupply(
  project: FactoryProject,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
): Map<string, Map<ResourceKey, number>> {
  const supplyByNodeAndResource = new Map<string, Map<ResourceKey, number>>();

  for (const edge of project.edges) {
    if (storagesById.has(edge.target)) {
      continue;
    }

    const targetDemandKey =
      getEdgeTargetDemandKey(project, edge) ?? makeResourceKey(edge.resourceKind, edge.resourceId);
    addRequiredRate(
      supplyByNodeAndResource,
      edge.target,
      targetDemandKey,
      edgeResults[edge.id]?.transferredPerSecond ?? 0,
    );
  }

  return supplyByNodeAndResource;
}

function selectConnectedInputSupplyLimit(
  nodeResult: NodeThroughputResult,
  supplyByResource: Map<ResourceKey, number> | undefined,
): number | undefined {
  let limit: number | undefined;

  for (const [resourceKey, suppliedPerSecond] of supplyByResource ?? []) {
    const inputFlow = nodeResult.inputs[resourceKey];
    if (!inputFlow || inputFlow.amountPerSecond <= EPSILON) {
      continue;
    }

    const inputLimit = suppliedPerSecond / inputFlow.amountPerSecond;
    limit = limit === undefined ? inputLimit : Math.min(limit, inputLimit);
  }

  return limit;
}

function refreshNodeUtilizationFromEdgeResults(
  project: FactoryProject,
  recipesById: Map<string, Recipe>,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
): boolean {
  const requiredByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const inputSupplyByNodeAndResource = calculateConnectedInputSupply(
    project,
    edgeResults,
    storagesById,
  );
  const projectStorages = project.storages ?? [];
  const storageOutgoingDemand = calculateEffectiveStorageOutgoingDemand(
    project,
    nodes,
    projectStorages,
  );
  const storageIncomingCounts = countIncomingEdgesToStorageResource(project, projectStorages);
  let changed = false;

  for (const edge of project.edges) {
    if (storagesById.has(edge.source)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    if (storagesById.has(edge.target)) {
      const requiredRate = canRunForStorageSurplus(project, recipesById, edge.source)
        ? (storageOutgoingDemand.get(key) ?? 0) / (storageIncomingCounts.get(key) ?? 1)
        : (edgeResults[edge.id]?.transferredPerSecond ?? 0);
      if (requiredRate > EPSILON) {
        addRequiredRate(requiredByNodeAndResource, edge.source, key, requiredRate);
      }
      continue;
    }

    const edgeResult = edgeResults[edge.id];
    if (!edgeResult) {
      continue;
    }

    addRequiredRate(requiredByNodeAndResource, edge.source, key, edgeResult.demandPerSecond);
  }
  applyProjectTarget(project, nodes, requiredByNodeAndResource);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    const recipe = recipesById.get(node.recipeId);
    if (!node.enabled || !nodeResult || !recipe || nodeResult.status === "missing-recipe") {
      continue;
    }

    const requiredByResource = new Map(requiredByNodeAndResource.get(node.id));
    if (node.targetOutput) {
      const targetKey = makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId);
      requiredByResource.set(
        targetKey,
        Math.max(requiredByResource.get(targetKey) ?? 0, node.targetOutput.amountPerSecond),
      );
    }

    const outputFlows = Object.values(nodeResult.outputs);
    if (requiredByResource.size === 0 && outputFlows.length > 0) {
      const output = primaryOutput(recipe);
      if (output) {
        const key = makeResourceKey(output.kind, output.id);
        requiredByResource.set(key, nodeResult.outputs[key]?.amountPerSecond ?? 0);
      }
    }

    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const overclockedRecipe = {
      ...applyMachineHandlerToRecipe(nodeRecipe, node),
      ...getOverclockedRecipeStats(nodeRecipe, node),
      outputs: applyOutputMultipliers(nodeRecipe, node),
    };
    const utilizationReport = selectLimitingOutput(
      overclockedRecipe,
      node,
      nodeResult,
      requiredByResource,
    );
    const inputSupplyLimit = selectConnectedInputSupplyLimit(
      nodeResult,
      inputSupplyByNodeAndResource.get(node.id),
    );
    if (inputSupplyLimit !== undefined && inputSupplyLimit < utilizationReport.utilization) {
      utilizationReport.utilization = inputSupplyLimit;
      utilizationReport.requiredRatePerSecond =
        utilizationReport.maxRatePerSecond * inputSupplyLimit;
      utilizationReport.theoreticalMachinesRequired = node.machineCount * inputSupplyLimit;
      if (utilizationReport.limitingResource) {
        utilizationReport.limitingResource = {
          ...utilizationReport.limitingResource,
          amountPerSecond: utilizationReport.requiredRatePerSecond,
        };
      }
    }

    if (
      Math.abs(nodeResult.utilization - utilizationReport.utilization) > EPSILON ||
      Math.abs(
        nodeResult.theoreticalMachinesRequired - utilizationReport.theoreticalMachinesRequired,
      ) > EPSILON
    ) {
      changed = true;
    }

    nodeResult.requiredRatePerSecond = utilizationReport.requiredRatePerSecond;
    nodeResult.maxRatePerSecond = utilizationReport.maxRatePerSecond;
    nodeResult.utilization = utilizationReport.utilization;
    nodeResult.theoreticalMachinesRequired = utilizationReport.theoreticalMachinesRequired;
    nodeResult.limitingResource = utilizationReport.limitingResource;
    nodeResult.status = getNodeStatus(nodeResult.utilization);
  }

  return changed;
}

function getEffectiveFlowRate(flow: ResourceFlow | undefined, utilization: number): number {
  return (flow?.amountPerSecond ?? 0) * clampUtilization(utilization);
}

function getCompatibleOutputFlow(
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

function getCompatibleOutputFlowForKey(
  nodeResult: NodeThroughputResult,
  resourceKey: ResourceKey,
): ResourceFlow | undefined {
  return getCompatibleOutputFlowForResource(nodeResult, resourceFromKey(resourceKey));
}

function getCompatibleOutputFlowForResource(
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

function resourceFromKey(resourceKey: ResourceKey): Pick<ResourceAmount, "kind" | "id"> {
  const separatorIndex = resourceKey.indexOf(":");
  return {
    kind: resourceKey.slice(0, separatorIndex) as ResourceKind,
    id: resourceKey.slice(separatorIndex + 1),
  };
}

function clampUtilization(utilization: number): number {
  if (!Number.isFinite(utilization)) {
    return 1;
  }

  return Math.min(Math.max(utilization, 0), 1);
}

function calculateStorageOutgoingDemand(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  storages: FactoryStorage[],
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const demand = new Map<string, number>();
  const incomingEdgeCounts = countIncomingEdgesByTargetResource(project);
  const feedbackGraph = buildStorageFeedbackGraph(project, storages);
  const storageResourceKeys = new Map(
    storages.map((storage) => [storage.id, makeResourceKey(storage.kind, storage.resourceId)]),
  );

  for (const edge of project.edges) {
    if (!storageIds.has(edge.source)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    if (canReachStorageResource(feedbackGraph, storageResourceKeys, edge.target, key)) {
      continue;
    }

    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
    const targetDemand = targetResult?.inputs[targetDemandKey]?.amountPerSecond ?? 0;
    const demandPerSecond = targetDemand / targetCount;
    demand.set(key, (demand.get(key) ?? 0) + demandPerSecond);
  }

  return demand;
}

function calculateEffectiveStorageOutgoingDemand(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  storages: FactoryStorage[],
): Map<string, number> {
  const storageIds = new Set(storages.map((storage) => storage.id));
  const demand = new Map<string, number>();
  const incomingEdgeCounts = countIncomingEdgesByTargetResource(project);

  for (const edge of project.edges) {
    if (!storageIds.has(edge.source)) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const targetResult = nodes[edge.target];
    const targetCount = incomingEdgeCounts.get(`${edge.target}|${targetDemandKey}`) ?? 1;
    const demandPerSecond =
      getEffectiveFlowRate(targetResult?.inputs[targetDemandKey], targetResult?.utilization ?? 0) /
      targetCount;
    demand.set(key, (demand.get(key) ?? 0) + demandPerSecond);
  }

  return demand;
}

function buildStorageFeedbackGraph(
  project: FactoryProject,
  storages: FactoryStorage[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const storageIds = new Set(storages.map((storage) => storage.id));
  const storagesByResource = new Map<ResourceKey, FactoryStorage[]>();
  const producerStorageIds = new Set<string>();
  const consumerStorageIds = new Set<string>();

  for (const node of project.nodes) {
    adjacency.set(node.id, []);
  }
  for (const storage of storages) {
    adjacency.set(storage.id, []);
    const key = makeResourceKey(storage.kind, storage.resourceId);
    storagesByResource.set(key, [...(storagesByResource.get(key) ?? []), storage]);
  }

  for (const edge of project.edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) {
      continue;
    }

    adjacency.get(edge.source)?.push(edge.target);

    const sourceIsStorage = storageIds.has(edge.source);
    const targetIsStorage = storageIds.has(edge.target);
    if (targetIsStorage && !sourceIsStorage) {
      producerStorageIds.add(edge.target);
    }
    if (sourceIsStorage && !targetIsStorage) {
      consumerStorageIds.add(edge.source);
    }
  }

  for (const storagesForResource of storagesByResource.values()) {
    for (const producer of storagesForResource) {
      if (!producerStorageIds.has(producer.id)) {
        continue;
      }

      for (const consumer of storagesForResource) {
        if (producer.id !== consumer.id && consumerStorageIds.has(consumer.id)) {
          adjacency.get(producer.id)?.push(consumer.id);
        }
      }
    }
  }

  return adjacency;
}

function canReachStorageResource(
  adjacency: Map<string, string[]>,
  storageResourceKeys: Map<string, ResourceKey>,
  startId: string,
  resourceKey: ResourceKey,
): boolean {
  const visited = new Set<string>();
  const stack = [...(adjacency.get(startId) ?? [])];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    if (storageResourceKeys.get(currentId) === resourceKey) {
      return true;
    }

    stack.push(...(adjacency.get(currentId) ?? []));
  }

  return false;
}

function buildEdgeResult(
  edge: { id: string; resourceKind: ResourceKind; resourceId: string; label?: string },
  key: ResourceKey,
  demandPerSecond: number,
  transferredPerSecond: number,
  capacities?: {
    nameplateDemandPerSecond: number;
    sourceCapacityPerSecond: number;
    fairSharePerSecond?: number;
  },
): EdgeThroughput {
  // Falling back to the converged demand keeps callers that have no nameplate
  // context reporting "full" rather than inventing a shortfall.
  const nameplateDemandPerSecond = capacities?.nameplateDemandPerSecond ?? demandPerSecond;
  const sourceCapacityPerSecond = capacities?.sourceCapacityPerSecond ?? transferredPerSecond;

  return {
    edgeId: edge.id,
    resource: {
      key,
      kind: edge.resourceKind,
      resourceId: edge.resourceId,
      displayName: edge.label,
      amountPerSecond: transferredPerSecond,
    },
    demandPerSecond,
    transferredPerSecond,
    isLimited: transferredPerSecond + EPSILON < demandPerSecond,
    nameplateDemandPerSecond,
    sourceCapacityPerSecond,
    fairSharePerSecond: capacities?.fairSharePerSecond,
    constraint: classifyEdgeConstraint(
      transferredPerSecond,
      nameplateDemandPerSecond,
      sourceCapacityPerSecond,
    ),
  };
}

function classifyEdgeConstraint(
  transferredPerSecond: number,
  nameplateDemandPerSecond: number,
  sourceCapacityPerSecond: number,
): EdgeThroughput["constraint"] {
  if (transferredPerSecond + EPSILON >= nameplateDemandPerSecond) {
    return "full";
  }

  // The consumer is short. Blame the producer only when it has nothing left to
  // give; otherwise both ends have slack and the plan simply wants less.
  return transferredPerSecond + EPSILON >= sourceCapacityPerSecond ? "supply" : "demand";
}

function getDefaultStorageCapacity(storage: FactoryStorage): number {
  return storage.kind === "fluid" ? 4_000_000 : 262_144;
}

function updateStorageFlow(
  storage: StorageThroughputResult | undefined,
  producedPerSecond: number,
  consumedPerSecond: number,
) {
  if (!storage) {
    return;
  }

  storage.producedPerSecond += producedPerSecond;
  storage.consumedPerSecond += consumedPerSecond;
}

function aggregateStorageFlowsByResource(
  projectStorages: FactoryStorage[],
  storages: Record<string, StorageThroughputResult>,
) {
  const aggregateByResource = new Map<
    ResourceKey,
    Pick<
      StorageThroughputResult,
      "capacity" | "producedPerSecond" | "consumedPerSecond" | "netPerSecond" | "storedAmount"
    >
  >();

  for (const storage of projectStorages) {
    const result = storages[storage.id];
    if (!result) {
      continue;
    }

    const key = makeResourceKey(storage.kind, storage.resourceId);
    const aggregate = aggregateByResource.get(key);
    if (aggregate) {
      aggregate.capacity += result.capacity;
      aggregate.producedPerSecond += result.producedPerSecond;
      aggregate.consumedPerSecond += result.consumedPerSecond;
    } else {
      aggregateByResource.set(key, {
        capacity: result.capacity,
        producedPerSecond: result.producedPerSecond,
        consumedPerSecond: result.consumedPerSecond,
        netPerSecond: 0,
        storedAmount: 0,
      });
    }
  }

  for (const aggregate of aggregateByResource.values()) {
    aggregate.netPerSecond = aggregate.producedPerSecond - aggregate.consumedPerSecond;
    aggregate.storedAmount = Math.max(0, Math.min(aggregate.capacity, aggregate.netPerSecond));
  }

  for (const storage of projectStorages) {
    const result = storages[storage.id];
    const aggregate = aggregateByResource.get(makeResourceKey(storage.kind, storage.resourceId));
    if (!result || !aggregate) {
      continue;
    }

    result.capacity = aggregate.capacity;
    result.producedPerSecond = aggregate.producedPerSecond;
    result.consumedPerSecond = aggregate.consumedPerSecond;
    result.netPerSecond = aggregate.netPerSecond;
    result.storedAmount = aggregate.storedAmount;
  }
}

function finalizeStorageFlow(storage: StorageThroughputResult) {
  storage.netPerSecond = storage.producedPerSecond - storage.consumedPerSecond;
  storage.storedAmount = Math.max(0, Math.min(storage.capacity, storage.netPerSecond));

  if (storage.producedPerSecond <= EPSILON && storage.consumedPerSecond <= EPSILON) {
    storage.status = "empty";
  } else if (Math.abs(storage.netPerSecond) <= EPSILON) {
    storage.status = "balanced";
  } else if (storage.netPerSecond > 0) {
    storage.status = "filling";
  } else {
    storage.status = "draining";
  }
}

function addRequiredRate(
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
  nodeId: string,
  resourceKey: ResourceKey,
  amountPerSecond: number,
): void {
  const nodeRequirements = requiredByNodeAndResource.get(nodeId) ?? new Map<ResourceKey, number>();
  nodeRequirements.set(resourceKey, (nodeRequirements.get(resourceKey) ?? 0) + amountPerSecond);
  requiredByNodeAndResource.set(nodeId, nodeRequirements);
}

function applyProjectTarget(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
): void {
  if (!project.targetRate) {
    return;
  }

  const targetKey = makeResourceKey(project.targetRate.kind, project.targetRate.resourceId);
  const producers = project.nodes.filter((node) => nodes[node.id]?.outputs[targetKey]);

  if (producers.length === 0) {
    return;
  }

  const nodesWithNoOutgoingTargetEdge = producers.filter(
    (node) =>
      !project.edges.some(
        (edge) =>
          edge.source === node.id &&
          makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey,
      ),
  );
  const targetNodes = nodesWithNoOutgoingTargetEdge;
  if (targetNodes.length === 0) {
    return;
  }

  const targetShare = project.targetRate.amountPerSecond / targetNodes.length;

  for (const node of targetNodes) {
    addRequiredRate(requiredByNodeAndResource, node.id, targetKey, targetShare);
  }
}

function selectLimitingOutput(
  recipe: Recipe,
  node: Pick<FactoryProject["nodes"][number], "parallel" | "machineCount" | "machineConfigTiers">,
  nodeResult: NodeThroughputResult,
  requiredByResource: Map<ResourceKey, number>,
): {
  requiredRatePerSecond: number;
  maxRatePerSecond: number;
  utilization: number;
  theoreticalMachinesRequired: number;
  limitingResource?: ResourceFlow;
} {
  let best = {
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization: 0,
    theoreticalMachinesRequired: 0,
    limitingResource: undefined as ResourceFlow | undefined,
  };

  for (const [resourceKey, requiredRatePerSecond] of requiredByResource) {
    const outputFlow = getCompatibleOutputFlowForKey(nodeResult, resourceKey);
    if (!outputFlow) {
      continue;
    }

    const utilization =
      outputFlow.amountPerSecond > EPSILON
        ? requiredRatePerSecond / outputFlow.amountPerSecond
        : requiredRatePerSecond > EPSILON
          ? Number.POSITIVE_INFINITY
          : 0;

    if (utilization >= best.utilization) {
      best = {
        requiredRatePerSecond,
        maxRatePerSecond: outputFlow.amountPerSecond,
        utilization,
        theoreticalMachinesRequired: node.machineCount * utilization,
        limitingResource: {
          ...outputFlow,
          amountPerSecond: requiredRatePerSecond,
        },
      };
    }
  }

  if (!best.limitingResource) {
    const output = primaryOutput(recipe);
    if (!output) {
      return best;
    }

    const key = makeResourceKey(output.kind, output.id);
    const outputFlow = nodeResult.outputs[key];
    if (!outputFlow) {
      return best;
    }

    best = {
      requiredRatePerSecond: outputFlow.amountPerSecond,
      maxRatePerSecond: outputFlow.amountPerSecond,
      utilization: outputFlow.amountPerSecond > EPSILON ? 1 : 0,
      theoreticalMachinesRequired: node.machineCount,
      limitingResource: outputFlow,
    };
  }

  return best;
}

function applyOutputMultipliers(recipe: Recipe, node: FactoryProject["nodes"][number]) {
  const effectiveRecipe = applyMachineHandlerToRecipe(recipe, node);
  const runtimeOutputs = getRuntimeCalculationOutputs(effectiveRecipe, node);
  if (runtimeOutputs) {
    return runtimeOutputs;
  }
  const overclockedRecipe = getOverclockedRecipeStats(recipe, node);
  return effectiveRecipe.outputs.map((output) => {
    const multiplier = getMachineOutputMultiplier(
      effectiveRecipe,
      node,
      output,
      overclockedRecipe.tier,
    );
    return multiplier === 1 ? output : { ...output, amount: output.amount * multiplier };
  });
}

function getNodeStatus(utilization: number): NodeThroughputResult["status"] {
  if (utilization > 1 + EPSILON) {
    return "bottleneck";
  }

  if (utilization >= 0.9 && utilization <= 1 + EPSILON) {
    return "balanced";
  }

  return "underutilized";
}

function calculateFuelEstimate(
  project: FactoryProject,
  totalEuT: number,
): FuelEstimate | undefined {
  const selectedFuel = project.fuelProfiles.find(
    (fuel) => fuel.id === project.selectedFuelProfileId,
  );

  if (!selectedFuel) {
    return undefined;
  }

  const totalEuPerSecond = totalEuT * TICKS_PER_SECOND;

  if (selectedFuel.euPerLiter) {
    return {
      fuelProfile: selectedFuel,
      totalEuPerSecond,
      fuelPerSecond: totalEuPerSecond / selectedFuel.euPerLiter,
      unit: "L/s",
    };
  }

  if (selectedFuel.euPerBucket) {
    return {
      fuelProfile: selectedFuel,
      totalEuPerSecond,
      fuelPerSecond: totalEuPerSecond / selectedFuel.euPerBucket,
      unit: "buckets/s",
    };
  }

  return undefined;
}

export function getResourceDisplayName(
  kind: ResourceKind,
  resourceId: string,
  project: FactoryProject,
): string {
  for (const recipe of project.recipes) {
    const resource = [...recipe.inputs, ...recipe.outputs].find(
      (entry) => entry.kind === kind && entry.id === resourceId,
    );
    if (resource) {
      return resourceLabel(resource);
    }
  }

  return resourceId;
}
