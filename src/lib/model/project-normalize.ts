import { normalizeProductionGroups } from "./production-groups";
import { normalizeFullFarms } from "./full-farms";
import { normalizeProjectHatchInputs } from "@/lib/solver/hatch-input";
import type { FactoryProject } from "./types";
import { energyHatchTypeExistsAtTier } from "@/lib/machines/energy-hatches";
import { normalizeProjectFuelProfiles } from "./fuels";
import { isCustomRateRecipe, releaseCustomRates } from "./custom-rate";
import { dedupeEdgeWires } from "./edge-identity";
import { isTrashRecipe } from "./trash";
import { resynthesizePowerRecipes } from "@/lib/power/power-recipe";
import { snapPositionToGrid, snapSizeUpToGrid } from "@/lib/board-grid";
import { sectionNodeView, splitSectionHandleId } from "./shared-machine";
import { repairWiredInputOverrides } from "./edge-input-overrides";

/**
 * Everything a project must go through on its way in, whether it arrives from
 * IndexedDB, a JSON import, an embedded plan image or the community hub.
 *
 * One funnel on purpose. These repairs were previously applied by whoever
 * remembered to call them, which is how a load path ends up quietly skipping a
 * migration — every caller now gets the full set by construction.
 */
export function normalizeLoadedProject(project: FactoryProject): FactoryProject {
  project = normalizeProductionGroups(project);
  project = repairWiredInputOverrides(project);
  return normalizeProjectHatchInputs(
    snapProjectToGrid(
      repairPocketReferences(
        unpaintCustomRateCards(
          releaseCustomRates(
            dropDuplicateEdges(
              dropCrossFormConnections(
                migrateTrashCansToDrawers(
                  dropImpossibleEnergyHatchTypes(
                    // Power cards rebuild their synthesized recipe from the
                    // node's settings, so stored plans pick up corrected
                    // generator math. BEFORE the wire checks: a power recipe
                    // saved slotless would otherwise read as a card with no
                    // fluid slot and lose its fuel wire to the cross-form drop.
                    resynthesizePowerRecipes(
                      normalizeProjectFuelProfiles(
                        normalizeFullFarms(renameOpvTier(adoptSetupRules(requireSolveForPool(project)))),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    true,
  );
}

/**
 * The trash can NODE became the trash position on a drawer's drain pill
 * (2026-08-23), so old plans convert on the way in: every wire into a can
 * becomes a wire into a trash-mode drawer of that wire's own resource, one
 * drawer per resource (a can drank anything; a drawer holds one thing).
 * Display fields come from the feeding recipe's own output slot, so the
 * drawer wears the real icon. Cans with no wires did nothing and are
 * dropped, along with the placeholder recipes. Deterministic ids keep the
 * migration idempotent and stable across reloads.
 */
function migrateTrashCansToDrawers(project: FactoryProject): FactoryProject {
  const trashRecipeIds = new Set(
    project.recipes.filter((recipe) => isTrashRecipe(recipe)).map((recipe) => recipe.id),
  );
  if (trashRecipeIds.size === 0) {
    return project;
  }
  const trashNodes = project.nodes.filter((node) => trashRecipeIds.has(node.recipeId));
  if (trashNodes.length === 0) {
    return {
      ...project,
      recipes: project.recipes.filter((recipe) => !isTrashRecipe(recipe)),
    };
  }

  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const storages = [...(project.storages ?? [])];
  const edges = [...project.edges];

  for (const can of trashNodes) {
    const drawerByResource = new Map<string, string>();
    let placed = 0;
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index]!;
      if (edge.target !== can.id) {
        continue;
      }
      const resourceKey = `${edge.resourceKind}:${edge.resourceId}`;
      let drawerId = drawerByResource.get(resourceKey);
      if (!drawerId) {
        drawerId = `trash-${can.id}-${placed}`;
        // The wire knows the ids; the feeder's own output slot knows the face.
        const sourceNode = nodesById.get(edge.source);
        const sourceRecipe = sourceNode ? recipesById.get(sourceNode.recipeId) : undefined;
        const face = sourceRecipe?.outputs.find(
          (output) => output.kind === edge.resourceKind && output.id === edge.resourceId,
        );
        storages.push({
          id: drawerId,
          kind: edge.resourceKind,
          resourceId: edge.resourceId,
          drainMode: "trash",
          colorTag: can.colorTag,
          displayName: face?.displayName ?? edge.label,
          iconPath: face?.iconPath,
          iconAtlas: face?.iconAtlas,
          dominantColor: face?.dominantColor,
          pocketId: can.pocketId,
          // The can's spot, then a tile-height step per extra resource.
          position: { x: can.position.x, y: can.position.y + placed * 100 },
        });
        drawerByResource.set(resourceKey, drawerId);
        placed += 1;
      }
      edges[index] = {
        ...edge,
        target: drawerId,
        targetHandle: `input:${edge.resourceKind}:${encodeURIComponent(edge.resourceId)}`,
      };
    }
  }

  const trashNodeIds = new Set(trashNodes.map((node) => node.id));
  return {
    ...project,
    recipes: project.recipes.filter((recipe) => !isTrashRecipe(recipe)),
    nodes: project.nodes.filter((node) => !trashNodeIds.has(node.id)),
    storages,
    edges: edges.filter((edge) => !trashNodeIds.has(edge.source) && !trashNodeIds.has(edge.target)),
  };
}

/**
 * A hatch family that does not exist at the node's tier - a laser below IV, a
 * multi-amp hatch below EV - cannot be built, so an imported or hand-edited
 * plan carrying one falls back to the plain pair instead of modelling
 * impossible amps.
 */
function dropImpossibleEnergyHatchTypes(project: FactoryProject): FactoryProject {
  let changed = false;
  const nodes = project.nodes.map((node) => {
    if (
      node.energyHatchType === undefined ||
      energyHatchTypeExistsAtTier(node.energyHatchType, node.overclockTier)
    ) {
      return node;
    }
    changed = true;
    const { energyHatchType, ...rest } = node;
    return rest;
  });
  return changed ? { ...project, nodes } : project;
}

/**
 * Sketch mode was both board rules at once - every bare input fed, every bare
 * output exported - so a plan saved under it opens with both on. The old flag
 * is dropped here rather than kept in step, because the rules are now the only
 * thing the solve reads and two fields saying the same thing drift.
 */
function adoptSetupRules(project: FactoryProject): FactoryProject {
  // THE RULES ARE GONE (2026-09-06): the board's modes do their job and
  // loose cell wires is always on. Both stored forms are dropped on the way
  // in so nothing carries them forward; `getSetupRules` ignores them anyway.
  if (project.assumeBoundaries === undefined && project.setupRules === undefined) {
    return project;
  }
  const { assumeBoundaries: _legacy, setupRules: _rules, ...rest } = project;
  return rest;
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
  const endpointHandles = (
    id: string,
    side: "source" | "target",
    kind: string,
    handleId: string | undefined,
  ): boolean => {
    const storage = storagesById.get(id);
    if (storage) {
      return storage.kind === kind;
    }
    // The wire's handle names which recipe of a shared machine it lands on;
    // that section's slots are the ones to ask.
    const card = project.nodes.find((entry) => entry.id === id);
    const node = card ? sectionNodeView(card, splitSectionHandleId(handleId).section) : undefined;
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
    const slots = side === "source" ? recipe.outputs : recipe.inputs;
    return slots.some((slot) => slot.kind === kind);
  };

  const edges = project.edges.filter(
    (edge) =>
      // A LOOSE CELL WIRE crosses the forms ON PURPOSE (SetupRules.
      // looseCellWires): its resource is one form, its target slot the
      // other, and its stored Canner ratio is fetched, never guessed. The
      // legacy shape this pass hunts had no such field.
      edge.crossForm !== undefined ||
      (endpointHandles(edge.source, "source", edge.resourceKind, edge.sourceHandle) &&
        endpointHandles(edge.target, "target", edge.resourceKind, edge.targetHandle)),
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
      ...(pocket.size
        ? {
            size: {
              width: snapSizeUpToGrid(pocket.size.width),
              height: snapSizeUpToGrid(pocket.size.height),
            },
          }
        : undefined),
    })),
  };
}

/**
 * Pool mode is the deeper solve mode: a plan that says pool without solve
 * (hand-edited, or saved by a build where the rule did not exist yet)
 * opens with solve mode on, exactly as the store keeps them.
 */
function requireSolveForPool(project: FactoryProject): FactoryProject {
  if (project.poolMode && !project.solveMode) {
    return { ...project, solveMode: true };
  }
  return project;
}
