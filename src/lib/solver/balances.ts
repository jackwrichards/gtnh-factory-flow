import { makeResourceKey } from "../model/resources";
import type {
  EdgeThroughput,
  FactoryProject,
  FactoryStorage,
  NodeThroughputResult,
  ResourceAmount,
  ResourceBalance,
  ResourceKey,
} from "../model/types";
import { collectTrashNodeIds } from "../model/trash";
import { getStorageRoles } from "../model/storage-role";
import { isMiningSourceRecipe } from "../model/mining-source";
import { clampUtilization } from "./equilibrium";

const EPSILON = 0.000001;

/**
 * The resource books: what a plan makes, what it eats, and therefore what it is
 * short of or has spare. Deliberately a bag-of-cards sum rather than a walk of
 * the wires — two machines making and eating the same item balance out whether
 * or not a line runs between them.
 *
 * Lives apart from the solver proper because the flow panel derives the same
 * three groups from a selection's own solve (see `selection-flow.ts`), and the
 * two views must never disagree about what counts as a need, an output, or an
 * internal loop.
 */
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
    importedPerSecond: 0,
    productPerSecond: 0,
    byproductPerSecond: 0,
    bufferFillPerSecond: 0,
    minedPerSecond: 0,
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

/**
 * How close to zero a leftover has to be before it is float dust rather than a
 * real shortfall or surplus.
 *
 * It has to SCALE with the flows, which a fixed epsilon does not. A machine
 * that is throttled has its intake recomputed as `need * (supply / need)`, and
 * in floating point that is not `supply` - it is one unit in the last place
 * away from it. Every other source of this residue is the same shape: a
 * rounding step on the rates themselves. So the leftover is proportional to
 * how big the rates are, and a flat 1e-6 tolerance quietly changed meaning
 * with the size of the plan. At 12,000/s it caught the dust; by the time a
 * line moves enough for one ULP to clear 1e-6, the same harmless rounding
 * surfaced as a resource sitting in Need at "-0.0000012/s" with nothing
 * actually wrong.
 *
 * 1e-9 of throughput is roughly ten million ULPs of headroom - room for the
 * residue to accumulate across a large board - while still being far below any
 * imbalance a player could create on purpose. Being short by one part in a
 * billion is not being short.
 */
const ABSOLUTE_SETTLE_EPSILON = 0.000001;
const RELATIVE_SETTLE_EPSILON = 1e-9;

function settleTolerance(balance: ResourceBalance): number {
  const scale = Math.max(balance.producedPerSecond, balance.consumedPerSecond);
  return Math.max(ABSOLUTE_SETTLE_EPSILON, scale * RELATIVE_SETTLE_EPSILON);
}

/**
 * Snap dust to exactly zero, once, where the books are closed.
 *
 * Done here rather than in each reader so every surface agrees: the three
 * panel groups, the trend charts that plot `netPerSecond`, and anything added
 * later all see a balanced resource as balanced rather than each applying its
 * own threshold and drifting apart.
 */
function settleBalances(balances: Map<ResourceKey, ResourceBalance>): void {
  for (const balance of balances.values()) {
    // The boundary figures are sums of real transfers rather than a difference
    // of two large numbers, so they carry far less residue - but they are
    // still rates, and a drawer moving a millionth of an item per second is
    // dust. Snapped on the same scaled tolerance, each on its own, because
    // they no longer derive from `net` and one being dust says nothing about
    // the others.
    const tolerance = settleTolerance(balance);
    if (balance.importedPerSecond !== 0 && balance.importedPerSecond <= tolerance) {
      balance.importedPerSecond = 0;
    }
    if (balance.productPerSecond !== 0 && balance.productPerSecond <= tolerance) {
      balance.productPerSecond = 0;
    }
    if (balance.byproductPerSecond !== 0 && balance.byproductPerSecond <= tolerance) {
      balance.byproductPerSecond = 0;
    }
    if (balance.bufferFillPerSecond !== 0 && balance.bufferFillPerSecond <= tolerance) {
      balance.bufferFillPerSecond = 0;
    }
    if (balance.minedPerSecond !== 0 && balance.minedPerSecond <= tolerance) {
      balance.minedPerSecond = 0;
    }
    balance.deficitPerSecond = balance.importedPerSecond;
    balance.surplusPerSecond =
      balance.productPerSecond + balance.byproductPerSecond + balance.bufferFillPerSecond;

    if (balance.netPerSecond !== 0 && Math.abs(balance.netPerSecond) <= tolerance) {
      balance.netPerSecond = 0;
    }
  }
}

export function calculateEffectiveBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
): Map<ResourceKey, ResourceBalance> {
  const balances = new Map<ResourceKey, ResourceBalance>();
  const miningRecipeIds = new Set<string>();
  for (const recipe of project.recipes) {
    if (isMiningSourceRecipe(recipe)) {
      miningRecipeIds.add(recipe.id);
    }
  }

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
      // The same flow, filed a second time under "a player mined this". Kept
      // as its own column rather than reclassifying production so every
      // existing reader of produced/consumed stays balanced.
      if (miningRecipeIds.has(node.recipeId)) {
        const balance = ensureBalance(balances, {
          kind: output.kind,
          id: output.resourceId,
          displayName: output.displayName,
          amount: 0,
        });
        balance.minedPerSecond += output.amountPerSecond * utilization;
      }
    }
  }

  applyTrashedOutputBalances(project, edgeResults, balances);
  applyBoundaryDrawerBalances(project, edgeResults, balances);
  // Last, so it also settles whatever the passes above left behind.
  settleBalances(balances);

  return balances;
}

/**
 * What the plan IMPORTS and what it SHIPS OUT, read off the boundary drawers.
 *
 * These used to be inferred by netting the machine books: produced minus
 * consumed, positive is spare, negative is short. That was right when a
 * drawer was magic and unwired surplus quietly evaporated - two machines
 * making and eating the same item did balance out whether or not a line ran
 * between them. In a closed plan it is no longer true. An unwired output
 * stops its machine and an unwired input starves one, so material only moves
 * where a wire says it does, and the boundary is a set of drawers a player
 * placed on purpose.
 *
 * The difference shows the moment one resource sits on both ends. Import 10
 * carbon at a source drawer, catch 4 spare carbon at a byproduct drawer, and
 * netting reported a single need for 6 - quietly asserting that the spare
 * feeds the need, across a gap with no wire in it. Now it reports both: bring
 * 10 in, take 4 away. Wiring them together is a thing the player can do, and
 * then the books say so because the flows actually changed.
 *
 * Products and byproducts are counted apart for the same reason. One resource
 * can have a product drawer AND a byproduct drawer - some of it is what the
 * factory is for and the rest is what it could not help making - so each gets
 * its own figure instead of a winner-takes-all label.
 */
function applyBoundaryDrawerBalances(
  project: FactoryProject,
  edgeResults: Record<string, EdgeThroughput>,
  balances: Map<ResourceKey, ResourceBalance>,
): void {
  const storages = project.storages ?? [];
  const roles = getStorageRoles(project);
  const storagesById = new Map(storages.map((storage) => [storage.id, storage]));

  const boundaryResource = (storage: FactoryStorage, label?: string): ResourceAmount => ({
    kind: storage.kind,
    id: storage.resourceId,
    displayName: storage.displayName ?? label,
    amount: 0,
  });

  // A buffer's spillover is a per-DRAWER figure, not a per-wire one: a
  // pass-through tank (8/s in, 8/s out) holds level and contributes nothing,
  // while one catching more than its takers drink is accumulating real
  // material. Inflow minus outflow, floored at zero, per drawer.
  const bufferNetById = new Map<string, number>();

  for (const edge of project.edges) {
    const transferredPerSecond = edgeResults[edge.id]?.transferredPerSecond ?? 0;
    if (transferredPerSecond <= EPSILON) {
      continue;
    }

    // Leaving a SOURCE drawer: the plan declared this an import.
    const from = storagesById.get(edge.source);
    if (from && roles.get(from.id) === "source") {
      ensureBalance(balances, boundaryResource(from, edge.label)).importedPerSecond +=
        transferredPerSecond;
    }
    if (from && roles.get(from.id) === "buffer") {
      bufferNetById.set(from.id, (bufferNetById.get(from.id) ?? 0) - transferredPerSecond);
    }

    // Landing in a DRAIN drawer: the plan declared this an export, and which
    // of the two kinds is the player's own answer on the drawer's pill.
    const into = storagesById.get(edge.target);
    const intoRole = into ? roles.get(into.id) : undefined;
    if (into && (intoRole === "product" || intoRole === "byproduct")) {
      const balance = ensureBalance(balances, boundaryResource(into, edge.label));
      if (intoRole === "product") {
        balance.productPerSecond += transferredPerSecond;
      } else {
        balance.byproductPerSecond += transferredPerSecond;
      }
    }
    if (into && intoRole === "buffer") {
      bufferNetById.set(into.id, (bufferNetById.get(into.id) ?? 0) + transferredPerSecond);
    }
  }

  // Whatever a buffer caught beyond what its takers drank piles up in the
  // tank: a positive on the plan's books, next to products and byproducts. A
  // STRICT buffer never runs net-positive (it hands surplus back as a clog),
  // so it naturally reports nothing here.
  for (const [storageId, net] of bufferNetById) {
    if (net <= EPSILON) {
      continue;
    }
    const storage = storagesById.get(storageId);
    if (!storage) {
      continue;
    }
    ensureBalance(balances, boundaryResource(storage)).bufferFillPerSecond += net;
  }

  // The boundary figures REPLACE the netted ones, so a resource can be short
  // and spare at once. `netPerSecond` is left alone: the trend charts plot it
  // and it still answers the different question of whether the machines
  // themselves are in balance.
  for (const balance of balances.values()) {
    balance.deficitPerSecond = balance.importedPerSecond;
    balance.surplusPerSecond =
      balance.productPerSecond + balance.byproductPerSecond + balance.bufferFillPerSecond;
  }
}

/**
 * Whatever flows into a trash can never existed as far as the plan's books
 * are concerned: it leaves the produced column (floored at zero, so a mid-
 * convergence overshoot can never mint a phantom deficit) and therefore
 * never appears in the unconsumed-outputs panel.
 */
function applyTrashedOutputBalances(
  project: FactoryProject,
  edgeResults: Record<string, EdgeThroughput>,
  balances: Map<ResourceKey, ResourceBalance>,
): void {
  const trashNodeIds = collectTrashNodeIds(project);
  if (trashNodeIds.size === 0) {
    return;
  }

  for (const edge of project.edges) {
    if (!trashNodeIds.has(edge.target)) {
      continue;
    }
    const transferredPerSecond = edgeResults[edge.id]?.transferredPerSecond ?? 0;
    if (transferredPerSecond <= EPSILON) {
      continue;
    }
    subtractBalanceProduction(
      balances,
      {
        kind: edge.resourceKind,
        id: edge.resourceId,
        displayName: edge.label,
        amount: 0,
      },
      transferredPerSecond,
    );
  }
}

/**
 * The two headline lists the books imply: what has to be imported, and what
 * nothing downstream drinks.
 */
export function splitBalances(balances: Iterable<ResourceBalance>): {
  externalInputs: ResourceBalance[];
  unconsumedOutputs: ResourceBalance[];
} {
  const all = [...balances];
  return {
    externalInputs: all
      .filter((balance) => balance.deficitPerSecond > EPSILON)
      .sort((a, b) => b.deficitPerSecond - a.deficitPerSecond),
    unconsumedOutputs: all
      .filter((balance) => balance.surplusPerSecond > EPSILON)
      .sort((a, b) => b.surplusPerSecond - a.surplusPerSecond),
  };
}

/**
 * Made and used in equal measure inside the scope — the "Internal" group.
 * Derived here rather than in the panel so the three groups always partition
 * the same book.
 */
export function selectInternalBalances(balances: Iterable<ResourceBalance>): ResourceBalance[] {
  return [...balances]
    .filter(
      (balance) =>
        // Made by MACHINES: a resource whose entire production is mined off
        // source cards is not internal automation - it is filed under Gather.
        balance.producedPerSecond - balance.minedPerSecond > EPSILON &&
        balance.consumedPerSecond > 0 &&
        balance.deficitPerSecond <= EPSILON &&
        balance.surplusPerSecond <= EPSILON,
    )
    .sort((left, right) => right.consumedPerSecond - left.consumedPerSecond);
}

/**
 * The "go get this" list: everything mining source cards are being asked to
 * supply, at the rate the plan actually draws. Its own group beside Inputs
 * because both are demands on the player - one bought at a drawer, one dug
 * out of the ground.
 */
export function selectGatheredBalances(balances: Iterable<ResourceBalance>): ResourceBalance[] {
  return [...balances]
    .filter((balance) => balance.minedPerSecond > EPSILON)
    .sort((left, right) => right.minedPerSecond - left.minedPerSecond);
}
