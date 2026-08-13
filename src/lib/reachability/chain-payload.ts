import { makeResourceHandleId } from "@/components/flow/resource-handles";
import { resourceMatchesInput } from "@/lib/model/resources";
import { BOARD_GRID } from "@/lib/board-grid";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryStorage,
  Recipe,
  ResourceAmount,
} from "@/lib/model/types";

/**
 * Turns a witness chain (deepest step first: producers before what consumes
 * them) into a paste payload the board can land in one commit: recipe cards
 * in columns by depth, every satisfied input wired to its producer, source
 * drawers for the resources the player granted as roots, and drain drawers
 * on every output row nothing consumes - a bare output row stops its machine
 * in this solver, so an unwired byproduct would strand the whole chain at
 * zero.
 *
 * Ids are placeholders; pasteBoardItems mints real ones and remaps the edges.
 * Positions are relative; placePayload centres the whole payload on the
 * viewport and snaps it.
 */

export interface ChainPlacementStep {
  recipe: Recipe;
  depth: number;
}

export interface ChainPlacementPayload {
  nodes: FactoryNode[];
  storages: FactoryStorage[];
  annotations: [];
  pockets: [];
  edges: FactoryEdge[];
  recipes: Recipe[];
}

const COLUMN_PITCH = BOARD_GRID * 32; // 640: an 18-cell card, its drains, and a lane of air
const ROW_PITCH = BOARD_GRID * 17; // 340: the generous card-height estimate plus air
const DRAIN_OFFSET_X = BOARD_GRID * 23; // 460, the house offset for a drain beside its machine
const DRAIN_PITCH_Y = BOARD_GRID * 5; // 100: a drawer is 80 tall
const SOURCE_OFFSET_X = -BOARD_GRID * 13; // -260, the house offset for a source

interface PlacedStep {
  nodeId: string;
  recipe: Recipe;
  column: number;
  position: { x: number; y: number };
  overrides: NonNullable<FactoryNode["recipeInputOverrides"]>;
  consumedOutputKeys: Set<string>;
}

export function buildChainPlacementPayload(
  steps: ChainPlacementStep[],
  rootResourceKeys: string[],
): ChainPlacementPayload {
  const maxDepth = steps.reduce((max, step) => Math.max(max, step.depth), 0);
  const placed: PlacedStep[] = [];
  const edges: FactoryEdge[] = [];
  const storages: FactoryStorage[] = [];
  const recipesById = new Map<string, Recipe>();
  const roots = new Set(rootResourceKeys);
  const rootedInputs: Array<{ consumer: PlacedStep; input: ResourceAmount }> = [];
  let edgeCounter = 0;
  let storageCounter = 0;

  for (const step of steps) {
    recipesById.set(step.recipe.id, step.recipe);
    placed.push({
      nodeId: `chain-node-${placed.length}`,
      recipe: step.recipe,
      column: maxDepth - step.depth,
      position: { x: 0, y: 0 },
      overrides: {},
      consumedOutputKeys: new Set(),
    });
  }

  // Wire each input to the first earlier step producing something it takes.
  // Steps arrive producers-first, so "earlier in the list" is "upstream".
  for (let consumerIndex = 0; consumerIndex < placed.length; consumerIndex++) {
    const consumer = placed[consumerIndex];
    consumer.recipe.inputs.forEach((input, inputIndex) => {
      let wired = false;
      for (let providerIndex = 0; providerIndex < consumerIndex && !wired; providerIndex++) {
        const provider = placed[providerIndex];
        for (const output of provider.recipe.outputs) {
          const match = matchOutputToInput(output, input);
          if (!match) {
            continue;
          }
          if (!match.exact) {
            // The slot accepts a family (an oredict group, substitutes); pin
            // it to the thing this chain actually delivers, exactly as
            // placing from a concrete recipe-book context would.
            consumer.overrides[String(inputIndex)] = {
              ...input,
              kind: output.kind,
              id: output.id,
              displayName: output.displayName ?? input.displayName,
              iconPath: output.iconPath ?? input.iconPath,
              iconAtlas: output.iconAtlas ?? input.iconAtlas,
              dominantColor: output.dominantColor ?? input.dominantColor,
              alternatives: undefined,
            };
          }
          const resource = { kind: output.kind, id: output.id };
          provider.consumedOutputKeys.add(`${output.kind}:${output.id}`);
          edges.push({
            id: `chain-edge-${edgeCounter++}`,
            source: provider.nodeId,
            target: consumer.nodeId,
            sourceHandle: makeResourceHandleId("output", resource),
            targetHandle: makeResourceHandleId("input", resource),
            resourceKind: output.kind,
            resourceId: output.id,
          });
          wired = true;
          break;
        }
      }
      if (wired) {
        return;
      }
      // No step makes it; if the player granted it as a root, a source
      // drawer will say so on the board (created once positions are known).
      // Anything else stays honestly unwired.
      const inputKey = `${input.kind}:${input.id}`;
      if (roots.has(inputKey) && input.consumed !== false) {
        rootedInputs.push({ consumer, input });
      }
    });
  }

  // Positions, wiring known: a card's slot in its column has to clear its own
  // drain stack, or a many-output step buries the card below it.
  const yCursorByColumn = new Map<number, number>();
  for (const step of placed) {
    const drainCount = step.recipe.outputs.filter(
      (output) => !step.consumedOutputKeys.has(`${output.kind}:${output.id}`),
    ).length;
    const y = yCursorByColumn.get(step.column) ?? 0;
    step.position = { x: step.column * COLUMN_PITCH, y };
    yCursorByColumn.set(
      step.column,
      y + Math.max(ROW_PITCH, drainCount * DRAIN_PITCH_Y + BOARD_GRID * 3),
    );
  }

  for (const { consumer, input } of rootedInputs) {
    const storage: FactoryStorage = {
      id: `chain-source-${storageCounter++}`,
      kind: input.kind,
      resourceId: input.id,
      displayName: input.displayName,
      iconPath: input.iconPath,
      iconAtlas: input.iconAtlas,
      dominantColor: input.dominantColor,
      position: {
        x: consumer.position.x + SOURCE_OFFSET_X,
        y: consumer.position.y + sourceStackOffset(storages, consumer.position.x + SOURCE_OFFSET_X),
      },
    };
    storages.push(storage);
    edges.push({
      id: `chain-edge-${edgeCounter++}`,
      source: storage.id,
      target: consumer.nodeId,
      targetHandle: makeResourceHandleId("input", { kind: input.kind, id: input.id }),
      resourceKind: input.kind,
      resourceId: input.id,
    });
  }

  // Every output row without a taker gets a drain: the target's row is the
  // plan's product, the rest are byproducts to haul away.
  const targetNodeId = placed.length > 0 ? placed[placed.length - 1].nodeId : undefined;
  for (const step of placed) {
    let drainIndex = 0;
    for (const output of step.recipe.outputs) {
      const key = `${output.kind}:${output.id}`;
      if (step.consumedOutputKeys.has(key)) {
        continue;
      }
      const storage: FactoryStorage = {
        id: `chain-drain-${storageCounter++}`,
        kind: output.kind,
        resourceId: output.id,
        drainMode: step.nodeId === targetNodeId && drainIndex === 0 ? "product" : "byproduct",
        displayName: output.displayName,
        iconPath: output.iconPath,
        iconAtlas: output.iconAtlas,
        dominantColor: output.dominantColor,
        position: {
          x: step.position.x + DRAIN_OFFSET_X,
          y: step.position.y + drainIndex * DRAIN_PITCH_Y,
        },
      };
      storages.push(storage);
      edges.push({
        id: `chain-edge-${edgeCounter++}`,
        source: step.nodeId,
        target: storage.id,
        sourceHandle: makeResourceHandleId("output", { kind: output.kind, id: output.id }),
        resourceKind: output.kind,
        resourceId: output.id,
      });
      drainIndex++;
      step.consumedOutputKeys.add(key);
    }
  }

  const nodes: FactoryNode[] = placed.map((step) => ({
    id: step.nodeId,
    recipeId: step.recipe.id,
    machineCount: 1,
    parallel: 1,
    overclockTier: step.recipe.minimumTier,
    enabled: true,
    position: step.position,
    recipeInputOverrides: Object.keys(step.overrides).length > 0 ? step.overrides : undefined,
  }));

  return {
    nodes,
    storages,
    annotations: [],
    pockets: [],
    edges,
    recipes: [...recipesById.values()],
  };
}

function sourceStackOffset(storages: FactoryStorage[], consumerX: number): number {
  const columnX = consumerX + SOURCE_OFFSET_X;
  const inColumn = storages.filter((storage) => storage.position.x === columnX).length;
  return inColumn * DRAIN_PITCH_Y;
}

function matchOutputToInput(
  output: ResourceAmount,
  input: ResourceAmount,
): { exact: boolean } | undefined {
  if (resourceMatchesInput(output, input)) {
    return { exact: output.kind === input.kind && output.id === input.id };
  }
  // Ore dictionary slots ship without inline alternatives (membership lives
  // in the catalog); both sides carry their group names, so an overlapping
  // name is the recipe saying "any of these".
  if (output.kind !== input.kind || input.kind !== "item") {
    return undefined;
  }
  const inputGroups = oreDictionaryNames(input);
  if (inputGroups.length === 0) {
    return undefined;
  }
  const outputGroups = new Set(oreDictionaryNames(output));
  return inputGroups.some((name) => outputGroups.has(name)) ? { exact: false } : undefined;
}

function oreDictionaryNames(resource: ResourceAmount): string[] {
  const carried = (resource as { oreDictionary?: unknown }).oreDictionary;
  const names = Array.isArray(carried)
    ? carried.filter((name): name is string => typeof name === "string")
    : [];
  if (resource.kind === "item" && resource.id.startsWith("oredict:")) {
    names.push(resource.id.slice("oredict:".length));
  }
  return names;
}
