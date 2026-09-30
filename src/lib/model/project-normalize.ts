import { normalizeProductionGroups } from "./production-groups";
import { normalizeFullFarms } from "./full-farms";
import {
  normalizeProjectHatchInputs,
  normalizeProjectSingleblockTiers,
} from "@/lib/solver/hatch-input";
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
 * One funnel on purpose, so no load path can skip a migration.
 */
export function normalizeLoadedProject(project: FactoryProject): FactoryProject {
  project = normalizeProductionGroups(project);
  project = repairWiredInputOverrides(project);
  project = normalizeProjectHatchInputs(
    snapProjectToGrid(
      repairPocketReferences(
        unpaintCustomRateCards(
          releaseCustomRates(
            dropDuplicateEdges(
              dropCrossFormConnections(
                migrateTrashCansToDrawers(
                  dropImpossibleEnergyHatchTypes(
                    // Power cards rebuild their synthesized recipe from the
                    // node's settings, so stored plans pick up current
                    // generator math. Must run BEFORE the wire checks: a power
                    // recipe saved slotless would read as a card with no fluid
                    // slot and lose its fuel wire to the cross-form drop.
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
  // After renameOpvTier, so a legacy "OpV" settles as the UXV it means.
  return normalizeProjectSingleblockTiers(project);
}

/**
 * Legacy trash can NODES convert to trash-mode drawers: every wire into a can
 * becomes a wire into a trash drawer of that wire's own resource, one drawer
 * per resource (a can drank anything; a drawer holds one thing). Display
 * fields come from the feeding recipe's output slot. Unwired cans and the
 * placeholder recipes are dropped. Deterministic ids keep this idempotent.
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
 * Drops the legacy `setupRules` and sketch-mode `assumeBoundaries` fields so
 * nothing carries them forward. The board's modes replace them, and
 * `getSetupRules` answers the same for every plan regardless.
 */
function adoptSetupRules(project: FactoryProject): FactoryProject {
  if (project.assumeBoundaries === undefined && project.setupRules === undefined) {
    return project;
  }
  const { assumeBoundaries: _legacy, setupRules: _rules, ...rest } = project;
  return rest;
}

/**
 * Legacy plans may name the 536M EU/t tier "OpV" (a GTCEu name; GTNH calls it
 * UXV). An unrecognised name would drop those machines to their recipe's
 * default voltage and desync every tier dropdown, so it is renamed.
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
 * same two rows carrying the same resource are one line drawn twice, splitting
 * the rate between them. Duplicates arise when two wires spell the same port
 * differently (with and without the recipe's slot index).
 */
function dropDuplicateEdges(project: FactoryProject): FactoryProject {
  const edges = dedupeEdgeWires(project.edges);
  return edges === project.edges ? project : { ...project, edges };
}

/**
 * Legacy custom rate cards may carry the palette's `blue` tag, whose pale
 * panel puts the card's light ink on a light face; clearing it lets them wear
 * their own deep blue. Only that exact tag on those cards is cleared: any
 * other colour was painted on purpose.
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
 * Drops legacy wires and slot overrides that cross item and fluid forms: an
 * item feeds an item slot and a fluid a fluid slot, and crossing the two takes
 * a Canner (or Tank) on the board, as in game. The wire is dropped so the
 * chain reads short where the Canner belongs. Cross-form overrides go too:
 * their amounts were converted at a guessed 1000 L per cell.
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

  // A legacy drawer created from a cell slot was stored as the FLUID: its wire
  // goes, the drawer stays as an unfed tank of that fluid.
  //
  // Only the KIND is compared, never the id. A slot legitimately carries an id
  // the edge does not (an ore dictionary slot fed a concrete item, a chosen
  // alternative), and matching ids would delete honest wires. A card with no
  // slot of the wire's kind is exactly the shape cross-form wires left behind.
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
    // A TRASH CAN has no slots and swallows anything wired to it; its empty
    // slot list is not evidence of a broken wire, and must not fail the
    // check below (that would delete every wire into a can on load).
    if (isTrashRecipe(recipe)) {
      return true;
    }
    const slots = side === "source" ? recipe.outputs : recipe.inputs;
    return slots.some((slot) => slot.kind === kind);
  };

  const edges = project.edges.filter(
    (edge) =>
      // A LOOSE CELL WIRE crosses the forms ON PURPOSE: its resource is one
      // form, its target slot the other, and it carries a fetched Canner
      // ratio. The legacy shape this pass hunts has no `crossForm`.
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
 * A card pointing at a missing board (pocket) would vanish from every view.
 * Dangling `pocketId`s are cleared (the card surfaces on the root board), and
 * a board whose parent is missing or cyclic is re-rooted for the same reason.
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
 * The board is always gridded, so legacy plans with positions at arbitrary
 * pixels land on the grid when opened (and the next autosave keeps them there).
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
 * Pool mode implies solve mode: a plan that says pool without solve (hand-
 * edited or legacy) opens with solve mode on, as the store keeps them.
 */
function requireSolveForPool(project: FactoryProject): FactoryProject {
  if (project.poolMode && !project.solveMode) {
    return { ...project, solveMode: true };
  }
  return project;
}
