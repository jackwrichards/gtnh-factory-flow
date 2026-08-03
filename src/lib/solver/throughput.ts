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
import {
  addRequiredRate,
  clampUtilization,
  getCompatibleOutputFlowForKey,
  getEdgeTargetDemandKey,
  solveEquilibrium,
  type EquilibriumSolution,
} from "./equilibrium";
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

  // The equilibrium engine owns the iteration: every node starts at full
  // blast and descends to the largest self-consistent answer, so mutually
  // starved gridlocks ("no apples because no bananas because no apples")
  // are unreachable by construction. See equilibrium.ts for the mechanics.
  const equilibrium = solveEquilibrium(project, nodes, storagesById);
  const edgeResults: Record<string, EdgeThroughput> = {};
  writeEdgeResultsFromEquilibrium(project, nodes, edgeResults, equilibrium);
  finalizeNodeReports(project, recipesById, nodes, edgeResults, storagesById);
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


/**
 * Writes displayed edge results from the equilibrium engine's allocations.
 * Transfers, availability, and demand come straight from the converged
 * fixed point; this layer only adds the display-facing nameplate share.
 */
function writeEdgeResultsFromEquilibrium(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  equilibrium: EquilibriumSolution,
): void {
  for (const edge of project.edges) {
    const allocation = equilibrium.edgeAllocations.get(edge.id);
    if (!allocation) {
      continue;
    }

    if (allocation.role === "storage-sink") {
      // A sink line carries whatever the producer had left over; its demand
      // additionally carries the tank's unmet pull-through so a dry buffer
      // reads as "wants more" instead of silently starving its drinkers.
      edgeResults[edge.id] = buildEdgeResult(
        edge,
        allocation.resourceKey,
        allocation.demandPerSecond,
        allocation.transferredPerSecond,
        {
          nameplateDemandPerSecond: allocation.transferredPerSecond,
          sourceCapacityPerSecond: allocation.sourceCapacityPerSecond,
          availablePerSecond: allocation.transferredPerSecond,
        },
      );
      continue;
    }

    // A line's honest nameplate ask is what it carries plus its share of
    // whatever the consumer still lacks at full speed - zero shortfall means
    // every line reads as doing its job (a trickle source beside a firehose
    // is not "starving" anyone).
    const targetResult = nodes[edge.target];
    const targetCount = equilibrium.needEdgeCounts.get(allocation.needKey) ?? 1;
    const nameplateNeed = targetResult?.inputs[allocation.targetDemandKey]?.amountPerSecond ?? 0;
    const nameplateShortShare =
      Math.max(0, nameplateNeed - (equilibrium.eatenByNeed.get(allocation.needKey) ?? 0)) /
      targetCount;
    const nameplateDemandPerSecond = !targetResult
      ? allocation.transferredPerSecond
      : allocation.transferredPerSecond + nameplateShortShare;

    edgeResults[edge.id] = buildEdgeResult(
      edge,
      allocation.resourceKey,
      allocation.demandPerSecond,
      allocation.transferredPerSecond,
      {
        nameplateDemandPerSecond,
        // Total output rather than this edge's share of it. When a producer
        // feeds several consumers that understates how maxed out it is, so the
        // split case falls back to "demand" - under-flagging, not crying wolf.
        sourceCapacityPerSecond: allocation.sourceCapacityPerSecond,
        availablePerSecond: allocation.availablePerSecond,
      },
    );
  }
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
      // Availability, not consumption: capability and the utilization clamp
      // must see what the line COULD carry, or demand throttles would bleed
      // into capability and ratchet it down.
      edgeResults[edge.id]?.availablePerSecond ?? edgeResults[edge.id]?.transferredPerSecond ?? 0,
    );
  }

  return supplyByNodeAndResource;
}

function selectConnectedInputSupplyLimit(
  nodeResult: NodeThroughputResult,
  supplyByResource: Map<ResourceKey, number> | undefined,
): { limit: number; resourceKey: ResourceKey; tiedKeys: ResourceKey[] } | undefined {
  // Sorted by key so the answer can never depend on edge-array order —
  // deleting and re-adding a wire must not move the bottleneck.
  const entries = [...(supplyByResource ?? [])].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  let limit: number | undefined;
  let limitKey: ResourceKey | undefined;
  for (const [resourceKey, suppliedPerSecond] of entries) {
    const inputFlow = nodeResult.inputs[resourceKey];
    if (!inputFlow || inputFlow.amountPerSecond <= EPSILON) {
      continue;
    }

    const inputLimit = suppliedPerSecond / inputFlow.amountPerSecond;
    if (limit === undefined || inputLimit < limit) {
      limit = inputLimit;
      limitKey = resourceKey;
    }
  }
  if (limit === undefined || limitKey === undefined) {
    return undefined;
  }

  // Inputs within 1% of the minimum are the SAME wall as far as the damped
  // figures can tell — crowning exactly one would be float-dust theater.
  const tieWindow = Math.max(EPSILON, limit * 0.01);
  const tiedKeys: ResourceKey[] = [];
  for (const [resourceKey, suppliedPerSecond] of entries) {
    if (resourceKey === limitKey) {
      continue;
    }
    const inputFlow = nodeResult.inputs[resourceKey];
    if (!inputFlow || inputFlow.amountPerSecond <= EPSILON) {
      continue;
    }
    if (suppliedPerSecond / inputFlow.amountPerSecond <= limit + tieWindow) {
      tiedKeys.push(resourceKey);
    }
  }

  return { limit, resourceKey: limitKey, tiedKeys };
}

/**
 * Final reporting pass over the converged equilibrium: recomputes each
 * node's displayed figures (required rate, limiting output, blame) from the
 * written edge results. At the fixed point these formulas reproduce the
 * engine's utilizations exactly - this pass only owns the storytelling.
 */
function finalizeNodeReports(
  project: FactoryProject,
  recipesById: Map<string, Recipe>,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
): void {
  const requiredByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const inputSupplyByNodeAndResource = calculateConnectedInputSupply(
    project,
    edgeResults,
    storagesById,
  );
  // HONEST per-input deliverability, for REPORTING the bottleneck only. The
  // allocation figures set the actual utilization (that stays), but the ask
  // coupling drags innocent inputs' allocations down to the binder's level —
  // crowning from them misleads the UI and the honest-ask gate (apples get
  // blamed for an orange shortage). Honest = source capacity when this line
  // is the producer's sole outlet, Infinity for a non-dry buffer, allocation
  // otherwise.
  const outletCounts = new Map<string, number>();
  for (const edge of project.edges) {
    const outletKey = `${edge.source}|${edge.resourceKind}|${edge.resourceId}`;
    outletCounts.set(outletKey, (outletCounts.get(outletKey) ?? 0) + 1);
  }
  const honestSupplyByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  for (const edge of project.edges) {
    if (storagesById.has(edge.target)) {
      continue;
    }
    const targetDemandKey =
      getEdgeTargetDemandKey(project, edge) ?? makeResourceKey(edge.resourceKind, edge.resourceId);
    const edgeResult = edgeResults[edge.id];
    let honest: number;
    if (storagesById.has(edge.source) && edgeResult?.constraint !== "supply") {
      honest = Number.POSITIVE_INFINITY;
    } else {
      const allocated =
        edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
      const soleOutlet =
        (outletCounts.get(`${edge.source}|${edge.resourceKind}|${edge.resourceId}`) ?? 0) === 1;
      honest =
        soleOutlet && edgeResult?.sourceCapacityPerSecond !== undefined
          ? Math.max(allocated, edgeResult.sourceCapacityPerSecond)
          : allocated;
    }
    addRequiredRate(honestSupplyByNodeAndResource, edge.target, targetDemandKey, honest);
  }
  // Sink edges carry their demand (absorption plus the tank's unmet pull)
  // in demandPerSecond just like machine edges, so one uniform sum covers
  // both - the old leftover-echo special case is gone with the engine.
  for (const edge of project.edges) {
    if (storagesById.has(edge.source)) {
      continue;
    }

    const edgeResult = edgeResults[edge.id];
    if (!edgeResult) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
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
    // A pure sink — inputs but no outputs, e.g. a request-mode custom rate
    // node — has no output demand to pace it. It always wants full blast;
    // only input supply below can throttle it.
    if (
      Object.keys(nodeResult.outputs).length === 0 &&
      Object.keys(nodeResult.inputs).length > 0
    ) {
      utilizationReport.utilization = 1;
      utilizationReport.theoreticalMachinesRequired = node.machineCount;
    }
    const demandOnlyUtilization = utilizationReport.utilization;
    const inputSupply = selectConnectedInputSupplyLimit(
      nodeResult,
      inputSupplyByNodeAndResource.get(node.id),
    );
    const inputSupplyLimit = inputSupply?.limit;
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

    const capableUtilization = clampUtilization(inputSupplyLimit ?? 1);
    // THE bottleneck, reported from the HONEST book: rank every connected
    // input by honest deliverability ÷ full-blast need, sorted keys for
    // order independence, real ties within 1%. The allocation min still
    // sets the utilization above; this only decides who gets blamed — and
    // who gets to beg at nameplate through the honest-ask gate.
    let limitingKey: ResourceKey | undefined;
    let limitingTied: ResourceKey[] | undefined;
    if (inputSupply && inputSupply.limit < 1 - EPSILON) {
      const honestMap = honestSupplyByNodeAndResource.get(node.id);
      const supplyMap = inputSupplyByNodeAndResource.get(node.id);
      const keys = [...(supplyMap?.keys() ?? [])].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      let bestRatio = Number.POSITIVE_INFINITY;
      for (const key of keys) {
        const flow = nodeResult.inputs[key];
        if (!flow || flow.amountPerSecond <= EPSILON) {
          continue;
        }
        const honest = honestMap?.get(key);
        const ratio =
          honest === undefined ? Number.POSITIVE_INFINITY : honest / flow.amountPerSecond;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          limitingKey = key;
        }
      }
      if (limitingKey !== undefined && Number.isFinite(bestRatio)) {
        const tieWindow = Math.max(0.01, bestRatio * 0.01);
        const tied: ResourceKey[] = [];
        for (const key of keys) {
          if (key === limitingKey) {
            continue;
          }
          const flow = nodeResult.inputs[key];
          if (!flow || flow.amountPerSecond <= EPSILON) {
            continue;
          }
          const honest = honestMap?.get(key);
          if (honest !== undefined && honest / flow.amountPerSecond <= bestRatio + tieWindow) {
            tied.push(key);
          }
        }
        limitingTied = tied.length > 0 ? tied : undefined;
      } else {
        // Every input honestly covers the need (or nothing is measurable):
        // fall back to the allocation's own argmin rather than blame no one.
        limitingKey = inputSupply.resourceKey;
        limitingTied = inputSupply.tiedKeys.length > 0 ? inputSupply.tiedKeys : undefined;
      }
    }
    nodeResult.limitingInputKey = limitingKey;
    nodeResult.limitingInputTiedKeys = limitingTied;
    const demandUtilization = clampUtilization(demandOnlyUtilization);
    nodeResult.capableUtilization = capableUtilization;
    nodeResult.demandUtilization = demandUtilization;

    nodeResult.requiredRatePerSecond = utilizationReport.requiredRatePerSecond;
    nodeResult.maxRatePerSecond = utilizationReport.maxRatePerSecond;
    nodeResult.utilization = utilizationReport.utilization;
    nodeResult.theoreticalMachinesRequired = utilizationReport.theoreticalMachinesRequired;
    nodeResult.limitingResource = utilizationReport.limitingResource;
    nodeResult.status = getNodeStatus(nodeResult.utilization);
  }
}

function buildEdgeResult(
  edge: { id: string; resourceKind: ResourceKind; resourceId: string; label?: string },
  key: ResourceKey,
  demandPerSecond: number,
  transferredPerSecond: number,
  capacities?: {
    nameplateDemandPerSecond: number;
    sourceCapacityPerSecond: number;
    availablePerSecond?: number;
  },
): EdgeThroughput {
  // Falling back to the converged demand keeps callers that have no nameplate
  // context reporting "full" rather than inventing a shortfall.
  const nameplateDemandPerSecond = capacities?.nameplateDemandPerSecond ?? demandPerSecond;
  const sourceCapacityPerSecond = capacities?.sourceCapacityPerSecond ?? transferredPerSecond;

  return {
    availablePerSecond: capacities?.availablePerSecond ?? transferredPerSecond,
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

