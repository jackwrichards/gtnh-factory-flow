import {
  getChanceMultiplier,
  isRecipeInputConsumed,
  makeResourceKey,
  primaryOutput,
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
import { getStorageRoles } from "../model/storage-role";
import { calculateEffectiveBalances, splitBalances } from "./balances";
import {
  addRequiredRate,
  clampUtilization,
  getCompatibleOutputFlowForKey,
  getEdgeTargetDemandKey,
  selectProjectTargetNodes,
  solveEquilibrium,
  type EquilibriumSolution,
} from "./equilibrium";
import { getMachineOutputMultiplier, getMachineParallelMultiplier } from "./machine-effects";
import { getOverclockedRecipeStats } from "./overclock";
import {
  describePowerStall,
  getNodePowerReport,
  hasPowerReport,
  isPowerStalled,
} from "./power-report";
import {
  getRuntimeCalculationOutputs,
  runtimeCalculationWarning,
  selectRuntimeCalculationVariant,
} from "./runtime-calculation";
import { closeBoundaries } from "./close-boundaries";

const EPSILON = 0.000001;

interface SolverOptions {
  generatedAt?: string;
}

type FlowRecord = Record<ResourceKey, ResourceFlow>;

export function calculateThroughput(
  project: FactoryProject,
  options: SolverOptions = {},
): ThroughputResult {
  // Sketch mode: the player asked the plan to assume its own boundary, so
  // every bare input gets a virtual source and every bare output a virtual
  // drain before the solve. The virtual drawers never reach the board - they
  // exist only inside this result - and a boundary the player DID declare
  // still wins, because closeBoundaries only fills slots with no wire on
  // them. Quick math first, honest wiring when it matters.
  if (project.assumeBoundaries) {
    project = closeBoundaries(project);
  }
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
    // A build the game would refuse to start produces nothing - GT has no
    // slow mode - but it is a machine at 0%, not a blank card: rates stay
    // nameplate so ports and wires keep their shape, and the equilibrium pins
    // the node to zero the same way a bare slot does. The card's power cell
    // is what says why.
    const powerReport = hasPowerReport(nodeRecipe)
      ? getNodePowerReport(nodeRecipe, node)
      : undefined;
    const powerStall = powerReport && isPowerStalled(powerReport) ? powerReport : undefined;
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
        getChanceMultiplier(effectiveRecipe, output) *
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
      powerStalled: Boolean(powerStall),
      requiredRatePerSecond: 0,
      maxRatePerSecond: 0,
      utilization: 0,
      theoreticalMachinesRequired: 0,
      status: "underutilized",
      warnings: [
        powerStall ? describePowerStall(powerStall) : undefined,
        runtimeCalculationWarning(effectiveRecipe, node),
      ].filter((warning): warning is string => Boolean(warning)),
    };
  }

  // The equilibrium engine owns the iteration: every node starts at full
  // blast and descends to the largest self-consistent answer, so mutually
  // starved gridlocks ("no apples because no bananas because no apples")
  // are unreachable by construction. See equilibrium.ts for the mechanics.
  const equilibrium = solveEquilibrium(project, nodes, storagesById);
  const edgeResults: Record<string, EdgeThroughput> = {};
  writeEdgeResultsFromEquilibrium(project, nodes, edgeResults, equilibrium);
  finalizeNodeReports(project, recipesById, nodes, edgeResults, storagesById, equilibrium);
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
    calculateEffectiveBalances(project, nodes, edgeResults),
  ) as Record<ResourceKey, ResourceBalance>;
  const { externalInputs, unconsumedOutputs } = splitBalances(Object.values(resourceResults));

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

    if (allocation.role === "storage-transfer") {
      // A drawer-to-drawer line. Carried is what settled across it; demand is
      // the receiver's pull (carried plus its unserved share), so a dry chain
      // reads limited; availability doubles as the feeder's capacity, which
      // classifies a shortfall as SUPPLY - the feeder has nothing left - and
      // never as the receiver merely wanting less.
      edgeResults[edge.id] = buildEdgeResult(
        edge,
        allocation.resourceKey,
        allocation.demandPerSecond,
        allocation.transferredPerSecond,
        {
          nameplateDemandPerSecond: allocation.demandPerSecond,
          sourceCapacityPerSecond: allocation.availablePerSecond,
          availablePerSecond: allocation.availablePerSecond,
        },
      );
      continue;
    }

    if (allocation.role === "storage-sink" || allocation.role === "trash") {
      // A sink line carries whatever the producer had left over; its demand
      // additionally carries the tank's unmet pull-through so a dry buffer
      // reads as "wants more" instead of silently starving its drinkers.
      // A trash line is the same shape minus the pull-through: its nameplate
      // ask equals what it carries, so no verdict, plug, or ladder can ever
      // read hunger (or shortfall) off a voided output.
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
    } else if (storageIds.has(edge.source) && storageIds.has(edge.target)) {
      // A drawer-to-drawer line: outflow for the feeder, inflow for the fed,
      // so both tiles' net figures carry the move.
      updateStorageFlow(storages[edge.target], edgeResult.transferredPerSecond, 0);
      updateStorageFlow(storages[edge.source], 0, edgeResult.transferredPerSecond);
    }
  }

  // Each drawer reports ITS OWN wires. This used to sum every drawer holding
  // the same item and stamp the total back onto all of them, so two carbon
  // source drawers both showed the combined figure and a source parked near an
  // unrelated product drawer of the same item quoted that chain's throughput as
  // its own. Project-wide totals are a real question, but they are answered by
  // `balances.ts` for the sidebar, not by making every card lie about itself.
  for (const storageResult of Object.values(storages)) {
    finalizeStorageFlow(storageResult);
  }
}

function calculateConnectedInputSupply(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
): Map<string, Map<ResourceKey, number>> {
  const supplyByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const storageRoles = getStorageRoles(project);

  // Seed every consumed input at zero, so an ingredient with no feeder is a
  // real supply limit rather than an absent one. The old convention read a
  // bare input as hand-stocked and infinite; a closed plan has to name the
  // source. Edges below add to these.
  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    if (!nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
      continue;
    }
    for (const [inputKey, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond > EPSILON) {
        addRequiredRate(supplyByNodeAndResource, node.id, inputKey as ResourceKey, 0);
      }
    }
  }

  for (const edge of project.edges) {
    if (storagesById.has(edge.target)) {
      continue;
    }

    const targetDemandKey =
      getEdgeTargetDemandKey(project, edge) ?? makeResourceKey(edge.resourceKind, edge.resourceId);
    const edgeResult = edgeResults[edge.id];
    // A SOURCE drawer is infinite BY CONSTRUCTION - nothing feeds it, so it
    // is the plan's declared import and can never be a ceiling. Its line only
    // ever carries what was asked of it, and reading that back as
    // availability would cap the consumer at exactly 1, erasing every "you
    // would need 2x the machines" reading, which is the whole point of an
    // unclamped utilization.
    //
    // Only a SOURCE. A buffer is capped by its own inflow and a dry one is a
    // real ceiling, so it has to keep reporting what it can actually deliver.
    const available =
      storageRoles.get(edge.source) === "source"
        ? Number.POSITIVE_INFINITY
        : // Availability, not consumption: capability and the utilization clamp
          // must see what the line COULD carry, or demand throttles would bleed
          // into capability and ratchet it down.
          (edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0);
    addRequiredRate(supplyByNodeAndResource, edge.target, targetDemandKey, available);
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
  equilibrium: EquilibriumSolution,
): void {
  const requiredByNodeAndResource = new Map<string, Map<ResourceKey, number>>();
  const inputSupplyByNodeAndResource = calculateConnectedInputSupply(
    project,
    nodes,
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
    // CONSERVATION, before anything else looks at the number. The report picks
    // the output that needs the machine FASTEST; disposal is the output that
    // can shift the least, and a machine cannot outrun the slowest way it has
    // of getting rid of what it makes. Applied here as well as in the engine
    // because this pass re-derives utilization from scratch, and the two must
    // never print different percentages for the same card.
    const disposalLimit = equilibrium.disposalByNode.get(node.id);
    if (disposalLimit !== undefined && disposalLimit < utilizationReport.utilization) {
      utilizationReport.utilization = disposalLimit;
      utilizationReport.requiredRatePerSecond = utilizationReport.maxRatePerSecond * disposalLimit;
      utilizationReport.theoreticalMachinesRequired = node.machineCount * disposalLimit;
    }
    nodeResult.disposalUtilization = clampUtilization(disposalLimit ?? 1);
    nodeResult.clogOutputKey = equilibrium.clogOutputByNode.get(node.id);

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

    // THE SETTLEMENT's bound (see equilibrium.ts): what the wires really
    // delivered. The clamps above read wants and clog-blind capability, so a
    // consumer of a merely-CLOGGED (not small) supplier passed them at 100%
    // while its wire carried a trickle, and every book multiplied off that.
    // Applied against the CLAMPED reading so an over-asked node keeps its
    // >100% bottleneck figure when it really does run flat out.
    const actualLimit = equilibrium.actualByNode.get(node.id);
    const actualBound =
      actualLimit !== undefined &&
      actualLimit < Math.min(1, utilizationReport.utilization) - EPSILON;
    if (actualBound) {
      utilizationReport.utilization = actualLimit;
      utilizationReport.requiredRatePerSecond = utilizationReport.maxRatePerSecond * actualLimit;
      utilizationReport.theoreticalMachinesRequired = node.machineCount * actualLimit;
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
        // No honest entry at all means no incoming wire: a bare input delivers
        // nothing, so it ranks bottom and gets the blame it deserves. It used
        // to rank top (Infinity, hand-fed) and could never be crowned.
        const honest = honestMap?.get(key);
        const ratio = honest === undefined ? 0 : honest / flow.amountPerSecond;
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
          // Same convention as above: a bare input delivers 0, and two bare
          // inputs are genuinely tied rather than both unmeasurable.
          const honest = honestMap?.get(key) ?? 0;
          if (honest / flow.amountPerSecond <= bestRatio + tieWindow) {
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
    // A node the settlement throttled below every ranking above still needs
    // its binder named: the honest book sees clog-blind capability, so the
    // input that really pulled it down comes from the delivered book.
    if (limitingKey === undefined && actualBound) {
      limitingKey = equilibrium.actualLimitingInputByNode.get(node.id);
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
    // A power-stalled build sits at zero whatever the flows would allow: the
    // game refuses to start it. The nameplate rates above keep the card's
    // shape; this is the one place the stillness is stamped on.
    if (nodeResult.powerStalled) {
      nodeResult.utilization = 0;
      nodeResult.capableUtilization = 0;
      nodeResult.demandUtilization = 0;
      nodeResult.requiredRatePerSecond = 0;
      nodeResult.theoreticalMachinesRequired = 0;
    }
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
  // Same pick as the engine's, from the same function, so the two can never
  // disagree about who owes the dialled rate. A drain or a can on the target
  // output does not take a node off the hook: see selectProjectTargetNodes.
  const targetNodes = selectProjectTargetNodes(project, nodes, targetKey);
  if (targetNodes.length === 0) {
    return;
  }

  const targetShare = project.targetRate.amountPerSecond / targetNodes.length;

  for (const node of targetNodes) {
    // MAX, not sum. "Make at least this much", never "this much on top of
    // what the lines already take" - the same reading the engine's target
    // floors use, and the same one `node.targetOutput` gets a few lines
    // below. Summing is what made a target look doubled once its output was
    // routed anywhere, which the old rule worked around by exempting those
    // nodes from the target altogether.
    const byResource = requiredByNodeAndResource.get(node.id);
    if (byResource) {
      byResource.set(targetKey, Math.max(byResource.get(targetKey) ?? 0, targetShare));
    } else {
      requiredByNodeAndResource.set(node.id, new Map([[targetKey, targetShare]]));
    }
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

