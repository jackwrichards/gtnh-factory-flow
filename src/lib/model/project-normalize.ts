import type { FactoryProject } from "./types";
import { isCustomRateRecipe, releaseCustomRates } from "./custom-rate";
import { dedupeEdgeWires } from "./edge-identity";
import { isTrashRecipe } from "./trash";
import { snapPositionToGrid, snapSizeUpToGrid } from "@/lib/board-grid";

/**
 * Everything a project must go through on its way in, whether it arrives from
 * IndexedDB, a JSON import, an embedded plan image or the community hub.
 *
 * One funnel on purpose. These repairs were previously applied by whoever
 * remembered to call them, which is how a load path ends up quietly skipping a
 * migration — every caller now gets the full set by construction.
 */
export function normalizeLoadedProject(project: FactoryProject): FactoryProject {
  return snapProjectToGrid(
    repairPocketReferences(
      unpaintCustomRateCards(
        releaseCustomRates(
          dropDuplicateEdges(dropCrossFormConnections(renameOpvTier(dropLegacyFuelSettings(project)))),
        ),
      ),
    ),
  );
}

/**
 * Plans saved while the app estimated power from a fuel guess carry `fuelProfiles`
 * and `selectedFuelProfileId` - a per-project fuel table and a selection in it.
 * Power is a resource on the board now, and no code reads the fields; they are
 * gone from the type, but a plan loaded from storage or shared as a blueprint
 * still carries them, and a plain spread would ride them into the next save and
 * export. The funnel drops them like every other dead setting.
 */
function dropLegacyFuelSettings(project: FactoryProject): FactoryProject {
  const {
    fuelProfiles,
    selectedFuelProfileId,
    ...rest
  } = project as typeof project & {
    fuelProfiles?: unknown;
    selectedFuelProfileId?: string;
  };
  if (fuelProfiles === undefined && selectedFuelProfileId === undefined) {
    return project;
  }
  return rest as FactoryProject;
}

/**
 * The 536M EU/t tier spent a while misnamed "OpV" (a GTCEu name; GTNH calls it
 * UXV). Plans saved back then still say it on their cards, and a name nothing
 * recognises would drop those machines to their recipe's default voltage and
 * desync every tier dropdown. Same voltage, today's name.
 */
function renameOpvTier(project: FactoryProject): FactoryProject {
  let changed = false;
  const nodes = project.nodes.map((node) => {
    if (node.overclockTier !== "OpV") {
      return node;
    }
    changed = true;
    return { ...node, overclockTier: "UXV" as const };
  });
  return changed ? { ...project, nodes } : project;
}

/**
 * Drops wires that another wire on the board already draws.
 *
 * A card shows one port row per resource per side, so two wires between the
 * same two rows carrying the same resource are one line drawn twice: they sit on
 * the same pixels and split the rate between them, so each pill reads half of
 * what is really moving. Boards collected them because a hand-drawn wire and an
 * auto-connected one spelled the same port differently - one with the recipe's
 * slot index, one without - and nothing recognised the pair as the same wire.
 */
function dropDuplicateEdges(project: FactoryProject): FactoryProject {
  const edges = dedupeEdgeWires(project.edges);
  return edges === project.edges ? project : { ...project, edges };
}

/**
 * Custom rate cards shipped for one version painted with the palette's `blue`,
 * whose panel is pale enough to put the card's light ink on a light face. They
 * now wear the app's own deep blue, which is not a paint tag at all, so the
 * cards made in that version have their tag cleared and pick the new face up.
 *
 * Only exactly that tag on exactly those cards: a card painted any other
 * colour was painted on purpose and keeps it.
 */
function unpaintCustomRateCards(project: FactoryProject): FactoryProject {
  const customRecipeIds = new Set(
    project.recipes.filter(isCustomRateRecipe).map((recipe) => recipe.id),
  );
  if (customRecipeIds.size === 0) {
    return project;
  }
  let changed = false;
  const nodes = project.nodes.map((node) => {
    if (node.colorTag !== "blue" || !customRecipeIds.has(node.recipeId)) {
      return node;
    }
    changed = true;
    const unpainted = { ...node };
    delete unpainted.colorTag;
    return unpainted;
  });
  return changed ? { ...project, nodes } : project;
}

/**
 * Plans made while a filled cell could satisfy a fluid slot carry wires and
 * slot overrides that cross the two forms. Those connections no longer exist:
 * an item feeds an item slot and a fluid a fluid slot, and crossing the two
 * takes a Canner on the board like it does in game.
 *
 * The wire is dropped rather than quietly left carrying nothing, so the chain
 * reads as short by exactly the amount the missing Canner would carry, and the
 * gap is where to put one. Overrides that renamed a slot into the other form go
 * with them — they also held an amount converted at a guessed 1000 L per cell,
 * so leaving them behind would keep that guess in the numbers.
 */
function dropCrossFormConnections(project: FactoryProject): FactoryProject {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  let nodesChanged = false;
  const nodes = project.nodes.map((node) => {
    const overrides = node.recipeInputOverrides;
    const recipe = overrides ? recipesById.get(node.recipeId) : undefined;
    if (!overrides || !recipe) {
      return node;
    }

    let changed = false;
    const kept: NonNullable<typeof overrides> = {};
    for (const [slot, override] of Object.entries(overrides)) {
      const input = recipe.inputs[Number(slot)];
      if (override && input && override.kind !== input.kind) {
        changed = true;
        continue;
      }
      kept[slot] = override;
    }

    if (!changed) {
      return node;
    }
    nodesChanged = true;
    return { ...node, recipeInputOverrides: kept };
  });

  // A drawer created from a cell slot was stored as the FLUID, so its wire and
  // the card itself are both in the wrong form. The wire goes; the drawer stays
  // and is simply a tank of that fluid with nothing feeding it.
  //
  // Only the KIND is compared, never the id. A slot legitimately carries an id
  // the edge does not — an ore dictionary slot fed a concrete item, a slot with
  // a chosen alternative — and dropping those would delete honest wires. What
  // cannot happen is a card with no fluid slot at all on the end of a fluid
  // wire, and that is exactly the shape cross-form connections left behind.
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const endpointHandles = (id: string, side: "source" | "target", kind: string): boolean => {
    const storage = storagesById.get(id);
    if (storage) {
      return storage.kind === kind;
    }
    const node = project.nodes.find((entry) => entry.id === id);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    if (!recipe) {
      // A pocket card, or a recipe this plan does not carry. Not ours to judge.
      return true;
    }
    // A TRASH CAN has no slots at all and swallows anything wired to it. Its
    // emptiness is what it IS, not evidence of a broken wire - and asking an
    // empty slot list whether it holds a slot of some kind always answers no,
    // so this check used to delete every wire into a can on load. Somebody
    // would pipe an output into the void, save, reload, and find the line gone.
    if (isTrashRecipe(recipe)) {
      return true;
    }
    // A generator's energy output and a machine's draw have no recipe slot to
    // check: the draw is synthesized by the solver, so the slot check below
    // would delete every power wire on load — the same trap the trash check
    // above documents. Re-implement the power-report's kind guard here (eut
    // and duration are all it needs; importing the solver into the model
    // would be a layering cycle).
    if (kind === "energy") {
      if (side === "source") {
        return recipe.outputs.some((slot) => slot.kind === "energy");
      }
      return Math.abs(recipe.eut) > 0 && recipe.durationTicks > 0;
    }
    const slots = side === "source" ? recipe.outputs : recipe.inputs;
    return slots.some((slot) => slot.kind === kind);
  };

  const edges = project.edges.filter(
    (edge) =>
      endpointHandles(edge.source, "source", edge.resourceKind) &&
      endpointHandles(edge.target, "target", edge.resourceKind),
  );

  if (!nodesChanged && edges.length === project.edges.length) {
    return project;
  }
  return { ...project, nodes, edges };
}

/**
 * A card pointing at a pocket that no longer exists would vanish from every
 * view — not on the root board, not inside any pocket. Dangling `pocketId`s
 * are cleared (the card surfaces on the root board), and a pocket whose
 * parent is missing or cyclic is re-rooted for the same reason.
 */
function repairPocketReferences(project: FactoryProject): FactoryProject {
  const pockets = project.pockets ?? [];
  if (
    pockets.length === 0 &&
    !project.nodes.some((node) => node.pocketId) &&
    !project.storages?.some((storage) => storage.pocketId) &&
    !project.annotations?.some((annotation) => annotation.pocketId)
  ) {
    return project;
  }

  const pocketIds = new Set(pockets.map((pocket) => pocket.id));
  const repairedPockets = pockets.map((pocket) => {
    if (!pocket.parentPocketId) {
      return pocket;
    }
    // Walk the parent chain; a missing link or a loop back to this pocket
    // means the chain never reaches the root board.
    let parentId: string | undefined = pocket.parentPocketId;
    const seen = new Set<string>([pocket.id]);
    while (parentId) {
      if (!pocketIds.has(parentId) || seen.has(parentId)) {
        return { ...pocket, parentPocketId: undefined };
      }
      seen.add(parentId);
      parentId = pockets.find((entry) => entry.id === parentId)?.parentPocketId;
    }
    return pocket;
  });

  const clearDangling = <T extends { pocketId?: string }>(item: T): T =>
    item.pocketId && !pocketIds.has(item.pocketId) ? { ...item, pocketId: undefined } : item;

  return {
    ...project,
    pockets: repairedPockets,
    nodes: project.nodes.map(clearDangling),
    storages: project.storages?.map(clearDangling),
    annotations: project.annotations?.map(clearDangling),
  };
}

/**
 * Every plan made before the board had a grid arrives with positions at
 * arbitrary pixels. There is no "unsnapped" board any more, so rather than
 * leave old plans looking ragged next to new ones, they land on the grid the
 * first time they are opened — and stay there, since the load is what the next
 * autosave writes back.
 */
function snapProjectToGrid(project: FactoryProject): FactoryProject {
  return {
    ...project,
    nodes: project.nodes.map((node) => ({
      ...node,
      position: snapPositionToGrid(node.position),
    })),
    edges: project.edges.map((edge) =>
      edge.waypoints && edge.waypoints.length > 0
        ? { ...edge, waypoints: edge.waypoints.map((point) => snapPositionToGrid(point)) }
        : edge,
    ),
    storages: project.storages?.map((storage) => ({
      ...storage,
      position: snapPositionToGrid(storage.position),
    })),
    annotations: project.annotations?.map((annotation) => ({
      ...annotation,
      position: snapPositionToGrid(annotation.position),
      size: {
        width: snapSizeUpToGrid(annotation.size.width),
        height: snapSizeUpToGrid(annotation.size.height),
      },
    })),
    pockets: project.pockets?.map((pocket) => ({
      ...pocket,
      position: snapPositionToGrid(pocket.position),
    })),
  };
}
