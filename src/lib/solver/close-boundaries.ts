import { makeResourceKey } from "../model/resources";
import type { FactoryProject, FactoryStorage, ResourceKey } from "../model/types";

/**
 * Close a plan's boundary: a SOURCE drawer on every ingredient nobody makes,
 * a DRAIN drawer on every product nobody takes.
 *
 * The board itself never does this - declaring the boundary is the player's
 * job, and a card with a bare slot reads UNWIRED until they do. This is for
 * the places where a sub-plan is lifted OUT of a board that had already
 * declared it, and the cut has to be healed or the answer is a flat zero:
 *
 * - `calculateSelectionFlow`, which promises to solve a selection "as if it
 *   were the whole board". Severing the wires is the whole mechanism there,
 *   so without this every scoped solve starves at the cut, which is the exact
 *   opposite of the question the flow panel is asking.
 * - solver fixtures whose subject is something else entirely (allocation,
 *   balances, overclocks) and which have always taken for granted that raw
 *   materials turn up and products go away.
 *
 * It adds nothing to the resource books: `calculateEffectiveBalances` sums
 * node inputs and outputs only, so an ingredient fed by a SOURCE still reads
 * as something the plan NEEDS and a product sent to a DRAIN still reads as
 * something it puts OUT. The panels are unchanged; only the starving stops.
 *
 * Do NOT use it on a board a player is editing, and not in tests that are
 * ABOUT the boundary: those wire their own drawers, because which drawer sits
 * where is the thing they are checking.
 */
export function closeBoundaries(project: FactoryProject): FactoryProject {
  const storages: FactoryStorage[] = [...(project.storages ?? [])];
  const edges = [...project.edges];
  const storageIds = new Set(storages.map((storage) => storage.id));

  const wired = (nodeId: string, side: "in" | "out", key: ResourceKey) =>
    edges.some(
      (edge) =>
        (side === "in" ? edge.target : edge.source) === nodeId &&
        makeResourceKey(edge.resourceKind, edge.resourceId) === key,
    );

  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  // Stacked beside the machine they serve rather than piled on the origin:
  // sources off to its left, drains off to its right, which is the direction
  // the board already reads in. On grid, so the router keeps its endpoints.
  const placed = new Map<string, number>();
  const positionFor = (nodeId: string, side: "in" | "out") => {
    const anchor = nodesById.get(nodeId)?.position ?? { x: 0, y: 0 };
    const lane = `${nodeId}|${side}`;
    const index = placed.get(lane) ?? 0;
    placed.set(lane, index + 1);
    return {
      x: anchor.x + (side === "in" ? -260 : 460),
      y: anchor.y + index * 160,
    };
  };

  let seq = 0;
  const attach = (
    nodeId: string,
    side: "in" | "out",
    kind: FactoryStorage["kind"],
    resourceId: string,
  ) => {
    seq += 1;
    let id = `boundary-${side}-${seq}`;
    while (storageIds.has(id)) {
      seq += 1;
      id = `boundary-${side}-${seq}`;
    }
    storageIds.add(id);
    storages.push({ id, kind, resourceId, position: positionFor(nodeId, side) });
    edges.push({
      id: `boundary-edge-${side}-${seq}`,
      source: side === "in" ? id : nodeId,
      target: side === "in" ? nodeId : id,
      resourceKind: kind,
      resourceId,
    });
  };

  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    // Straight off the recipe rather than a solved result, so this can run
    // before the solver does. Non-consumed inputs are not ingredients and
    // never need a feeder.
    for (const input of recipe.inputs) {
      if (input.consumed === false || (input.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(input.kind, input.id);
      if (!wired(node.id, "in", key)) {
        attach(node.id, "in", input.kind as FactoryStorage["kind"], input.id);
      }
    }
    for (const output of recipe.outputs) {
      if (output.kind === "energy") {
        // Energy is a resource on the grid, not a fluid: there is no storage
        // that buffers it, and attach() would cast "energy" into
        // FactoryStorage["kind"], which does not have it.
        continue;
      }
      if ((output.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(output.kind, output.id);
      if (!wired(node.id, "out", key)) {
        attach(node.id, "out", output.kind as FactoryStorage["kind"], output.id);
      }
    }
  }

  return { ...project, storages, edges };
}
