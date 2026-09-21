import { hasStorageTarget, storageTargetMode } from "../model/storage-target";
import { normalizeProductionGroups, productionGroupTree } from "../model/production-groups";
import {
  getFilledCellFluidEquivalent,
  isFluidEquivalentToFilledCell,
  isRecipeInputConsumed,
  makeResourceKey,
} from "../model/resources";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "../model/recipe-rules";
import { expandSharedMachines, inheritSharedMachineExpansion } from "../model/shared-machine";
import { expandHatchSupplies } from "./hatch-supply";
import { poolSideOf } from "../model/storage-role";
import type {
  FactoryProject,
  FactoryStorage,
  ResourceAmount,
  ResourceKey,
  PoolResourceRule,
  ThroughputResult,
} from "../model/types";
import { getRuntimeCalculationOutputs } from "./runtime-calculation";

/**
 * Pool mode builds hidden storage and wires for each resource scope.
 * Child groups resolve first: paired resources stay local; one-sided ports
 * bubble to the parent. Share skips a local match, while Outside supply
 * adds a private source at that scope. The root preserves flat Pool behavior.
 * Ordinary throughput/LP accounting still handles conservation and surplus.
 * Saved player wires remain untouched and are ignored by this expansion.
 */
export const POOL_STORAGE_PREFIX = "pool:";
export const POOL_EDGE_PREFIX = "pool-edge:";

export function isPoolStorageId(id: string): boolean {
  return id.startsWith(POOL_STORAGE_PREFIX);
}

export function isPoolEdgeId(id: string): boolean {
  return id.startsWith(POOL_EDGE_PREFIX);
}

interface PoolEndpoint {
  id: string;
  storage: boolean;
}
export interface PoolGroupResource {
  groupId?: string;
  key: ResourceKey;
  resource: ResourceAmount;
  rule?: PoolResourceRule;
  route: "local" | "parent" | "outside";
  feeders: PoolEndpoint[];
  takers: PoolEndpoint[];
}
interface PoolExpansion {
  groupResources: PoolGroupResource[];
  project: FactoryProject;
  hiddenStorageIds: string[];
  hiddenEdgeIds: string[];
  /** The cell-fluid bridge tanks: weightless in solve mode, off the board. */
  hiddenNodeIds: string[];
}

/**
 * Every filled-cell item and fluid the plan's machines name in BOTH forms,
 * matched the way the search does (`isFluidEquivalentToFilledCell`: an
 * alternatives entry first, then the cell's name). What the ratio fetch
 * asks the Canner about, and what the expansion bridges once it knows.
 */
export function listPoolCellPairs(
  project: FactoryProject,
): Array<{ cellId: string; fluidId: string }> {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const cells = new Map<string, ResourceAmount>();
  const fluids = new Map<string, ResourceAmount>();
  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
    const slots = [
      ...nodeRecipe.inputs.filter((input) => isRecipeInputConsumed(input)),
      ...(getRuntimeCalculationOutputs(effectiveRecipe, node) ?? effectiveRecipe.outputs),
    ];
    for (const slot of slots) {
      if (slot.kind === "fluid") {
        fluids.set(slot.id, slot);
      } else if (slot.kind === "item" && getFilledCellFluidEquivalent(slot)) {
        cells.set(slot.id, slot);
      }
    }
  }
  const pairs: Array<{ cellId: string; fluidId: string }> = [];
  for (const [cellId, cell] of [...cells].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const [fluidId, fluid] of [...fluids].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (isFluidEquivalentToFilledCell(fluid, cell)) {
        pairs.push({ cellId, fluidId });
        break;
      }
    }
  }
  return pairs;
}

const expansionCache = new WeakMap<FactoryProject, PoolExpansion>();

/** The graph the solve and the diagnoses read: expanded in pool mode, the plan itself otherwise. */
export function getPoolProject(project: FactoryProject): FactoryProject {
  // Shared machines expand first (one hidden node per recipe section), so
  // the pool and every diagnosis see the same graph the solve ran on.
  const expanded = expandSharedMachines(project);
  if (!expanded.poolMode) return expandHatchSupplies(expanded);
  const pool = expandPool(expanded);
  const supplied = expandHatchSupplies(pool.project);
  // Later diagnoses/solves may receive this graph again. Preserve the pool's
  // identity and hidden helper IDs rather than pooling the private sources.
  expansionCache.set(supplied, { ...pool, project: supplied });
  return supplied;
}

export function expandPool(project: FactoryProject): PoolExpansion {
  if (!project.poolMode) {
    return {
      project,
      hiddenStorageIds: [],
      hiddenEdgeIds: [],
      hiddenNodeIds: [],
      groupResources: [],
    };
  }
  const cached = expansionCache.get(project);
  if (cached) return cached;
  const original = project;
  project = normalizeProductionGroups(project);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const wiredIn = new Set(project.edges.map((edge) => edge.target));
  const wiredOut = new Set(project.edges.map((edge) => edge.source));
  interface PoolSide {
    resource: ResourceAmount;
    feeders: PoolEndpoint[];
    takers: PoolEndpoint[];
  }
  // Child scopes match first. Only unmatched resources (or explicit Share)
  // reach the parent. All scopes are solved together by the ordinary LP.
  const scopes = new Map<string | undefined, Map<ResourceKey, PoolSide>>();
  const poolsFor = (groupId?: string) => {
    let pools = scopes.get(groupId);
    if (!pools) {
      pools = new Map();
      scopes.set(groupId, pools);
    }
    return pools;
  };
  const poolFor = (resource: ResourceAmount, groupId?: string): PoolSide => {
    const pools = poolsFor(groupId);
    const key = makeResourceKey(resource.kind, resource.id);
    let pool = pools.get(key);
    if (!pool) {
      pool = { resource, feeders: [], takers: [] };
      pools.set(key, pool);
    }
    return pool;
  };
  for (const node of project.nodes) {
    if (node.enabled === false) continue;
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) continue;
    const contextual = applyRecipeInputOverrides(recipe, node);
    const effective = applyMachineHandlerToRecipe(contextual, node);
    const outputs = getRuntimeCalculationOutputs(effective, node) ?? effective.outputs;
    const seenIn = new Set<ResourceKey>();
    for (const input of contextual.inputs) {
      if (!isRecipeInputConsumed(input) || input.amount <= 0) continue;
      const key = makeResourceKey(input.kind, input.id);
      if (seenIn.has(key)) continue;
      seenIn.add(key);
      poolFor(input, node.productionGroupId).takers.push({ id: node.id, storage: false });
    }
    const seenOut = new Set<ResourceKey>();
    for (const output of outputs) {
      if (output.amount <= 0) continue;
      const key = makeResourceKey(output.kind, output.id);
      if (seenOut.has(key)) continue;
      seenOut.add(key);
      poolFor(output, node.productionGroupId).feeders.push({ id: node.id, storage: false });
    }
  }
  const inputTargetIds = new Set<string>();
  const exactOutputIds = new Set<string>();
  for (const storage of project.storages ?? []) {
    let side = poolSideOf(storage, wiredIn.has(storage.id), wiredOut.has(storage.id));
    const mode = storageTargetMode(storage, side === "source" ? "source" : "product");
    if (side === "drain" && mode === "exact" && hasStorageTarget(storage)
      && (!storage.drainMode || storage.drainMode === "product")) exactOutputIds.add(storage.id);
    if (side === "source" && hasStorageTarget(storage, "source")) inputTargetIds.add(storage.id);
    if (!side) continue;
    const pool = poolFor(
      { ...storage, id: storage.resourceId, amount: 1 },
      storage.productionGroupId,
    );
    (side === "source" ? pool.feeders : pool.takers).push({ id: storage.id, storage: true });
  }
  const storages: FactoryStorage[] = (project.storages ?? []).map((storage) =>
    inputTargetIds.has(storage.id) ? { ...storage, poolSide: "source" } : storage);
  const recipes = [...project.recipes];
  const nodes = [...project.nodes];
  const edges: FactoryProject["edges"] = [];
  const hiddenStorageIds: string[] = [];
  const hiddenEdgeIds: string[] = [];
  const hiddenNodeIds: string[] = [];
  const groupResources: PoolGroupResource[] = [];
  const cellPairs = listPoolCellPairs(project);
  const uniqueStorageId = (wanted: string) => {
    let id = wanted;
    while (storageIds.has(id)) id += ":";
    storageIds.add(id);
    hiddenStorageIds.push(id);
    return id;
  };
  const addEdge = (id: string, source: string, target: string, resource: ResourceAmount) => {
    hiddenEdgeIds.push(id);
    edges.push({ id, source, target, resourceKind: resource.kind, resourceId: resource.id });
  };
  const orderedScopes = [
    ...productionGroupTree(project.productionGroups ?? [])
      .reverse()
      .map(({ group }) => group),
    undefined,
  ];
  for (const group of orderedScopes) {
    const groupId = group?.id;
    const pools = poolsFor(groupId);
    const scopeTag = groupId ? "group:" + encodeURIComponent(groupId) + ":" : "";
    // Bridges belong to the scope in which both forms are available. A
    // child-local material must never leak into a parent's conversion tank.
    for (const pair of cellPairs) {
      const litres = project.poolCellRatios?.[pair.cellId];
      if (!litres || litres <= 0) continue;
      const cell = pools.get(makeResourceKey("item", pair.cellId));
      const fluid = pools.get(makeResourceKey("fluid", pair.fluidId));
      if (!cell || !fluid) continue;
      const directions: Array<"empty" | "fill"> = [
        ...(cell.feeders.length ? ["empty" as const] : []),
        ...(fluid.feeders.length ? ["fill" as const] : []),
      ];
      for (const direction of directions) {
        const empty = direction === "empty";
        const recipeId = "pool-tank-recipe:" + scopeTag + direction + ":" + pair.cellId;
        const nodeId = "pool-tank:" + scopeTag + direction + ":" + pair.cellId;
        const cellSlot = {
          kind: "item" as const,
          id: pair.cellId,
          displayName: cell.resource.displayName,
          amount: 1,
        };
        const fluidSlot = {
          kind: "fluid" as const,
          id: pair.fluidId,
          displayName: fluid.resource.displayName,
          amount: litres,
        };
        const input = empty ? cellSlot : fluidSlot;
        const output = empty ? fluidSlot : cellSlot;
        recipes.push({
          id: recipeId,
          name: "Tank: " + pair.fluidId,
          kind: "custom",
          category: "crossform-tank",
          machineType: "Tank",
          minimumTier: "NONE",
          durationTicks: 1,
          eut: 0,
          inputs: [input],
          outputs: [output],
          source: { recipeMap: "crossform-tank" },
        });
        nodes.push({
          id: nodeId,
          recipeId,
          machineCount: 1000,
          parallel: 1,
          overclockTier: "NONE",
          enabled: true,
          position: { x: 0, y: 0 },
          productionGroupId: groupId,
        });
        hiddenNodeIds.push(nodeId);
        poolFor(input, groupId).takers.push({ id: nodeId, storage: false });
        poolFor(output, groupId).feeders.push({ id: nodeId, storage: false });
      }
    }
    for (const [key, pool] of [...pools].sort(([a], [b]) => a.localeCompare(b))) {
      const { resource } = pool;
      // Electricity never appears from an outside-supply switch.
      const rule =
        resource.kind === "power"
          ? undefined
          : (group ? group.resourceRules : project.poolResourceRules)?.[key];
      const local =
        !group ||
        rule === "import" ||
        (rule !== "share" && pool.feeders.length > 0 && pool.takers.length > 0);
      groupResources.push({
        groupId,
        key,
        resource,
        rule,
        route: !local
          ? "parent"
          : rule === "import" || (!group && rule === "share")
            ? "outside"
            : "local",
        feeders: [...pool.feeders],
        takers: [...pool.takers],
      });
      if (!local) {
        const parent = poolFor(resource, group.parentId);
        parent.feeders.push(...pool.feeders);
        parent.takers.push(...pool.takers);
        continue;
      }
      if (resource.kind === "power" && (!pool.feeders.length || !pool.takers.length)) continue;
      const poolId = uniqueStorageId(POOL_STORAGE_PREFIX + scopeTag + key);
      const hasInputTarget = pool.feeders.some((feeder) => inputTargetIds.has(feeder.id));
      const hasExactOutput = pool.takers.some((taker) => exactOutputIds.has(taker.id));
      // An explicit input rate cannot be topped up by Ignore or banked unused.
      if (!hasInputTarget && (rule === "import" || (!group && rule === "share")) && pool.takers.length) {
        const sourceId = uniqueStorageId(POOL_STORAGE_PREFIX + "import:" + scopeTag + key);
        storages.push({
          id: sourceId,
          kind: resource.kind,
          resourceId: resource.id,
          displayName: resource.displayName,
          position: { x: 0, y: 0 },
        });
        pool.feeders.push({ id: sourceId, storage: true });
      }
      storages.push({
        id: poolId,
        bufferMode: hasInputTarget || hasExactOutput ? "strict" : undefined,
        kind: resource.kind,
        resourceId: resource.id,
        displayName: resource.displayName,
        position: { x: 0, y: 0 },
      });
      for (const feeder of pool.feeders)
        addEdge(POOL_EDGE_PREFIX + "in:" + feeder.id + ":" + key, feeder.id, poolId, resource);
      for (const taker of pool.takers)
        addEdge(POOL_EDGE_PREFIX + "out:" + taker.id + ":" + key, poolId, taker.id, resource);
    }
  }
  const expansion: PoolExpansion = {
    project: { ...project, recipes, nodes, storages, edges },
    hiddenStorageIds,
    hiddenEdgeIds,
    hiddenNodeIds,
    groupResources,
  };
  expansionCache.set(original, expansion);
  expansionCache.set(project, expansion);
  expansionCache.set(expansion.project, expansion);
  inheritSharedMachineExpansion(original, expansion.project);
  return expansion;
}

/** The same scoped ports used by the solver, with their actual solved flows. */
export function getPoolGroupResources(project: FactoryProject, result: ThroughputResult) {
  const expanded = expandPool(expandSharedMachines(project));
  const rows = expanded.groupResources.map((row) => {
    const total = (entries: PoolEndpoint[], side: "in" | "out") =>
      entries.reduce(
        (sum, entry) =>
          sum +
          (result.edges[POOL_EDGE_PREFIX + side + ":" + entry.id + ":" + row.key]
            ?.transferredPerSecond ?? 0),
        0,
      );
    return {
      ...row,
      made: total(row.feeders, "in"),
      used: total(row.takers, "out"),
      product: total(
        row.takers.filter((entry) => entry.storage),
        "out",
      ),
    };
  });
  // Keep saved Ignore switches reachable even after all of their machines move.
  for (const scope of [undefined, ...(project.productionGroups ?? [])]) {
    const rules = scope ? scope.resourceRules : project.poolResourceRules;
    for (const [key, rule] of Object.entries(rules ?? {})) {
      if (rows.some((row) => row.groupId === scope?.id && row.key === key)) continue;
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator);
      if (kind !== "item" && kind !== "fluid") continue;
      const id = key.slice(separator + 1);
      const resource = project.recipes
        .flatMap((recipe) => [...recipe.inputs, ...recipe.outputs])
        .find((slot) => slot.kind === kind && slot.id === id) ?? { kind, id, amount: 1 };
      rows.push({
        groupId: scope?.id,
        key: makeResourceKey(kind, id),
        resource,
        rule,
        route: rule === "share" && scope ? "parent" : "outside",
        feeders: [],
        takers: [],
        made: 0,
        used: 0,
        product: 0,
      });
    }
  }
  return rows;
}
