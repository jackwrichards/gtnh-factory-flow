// Test doubles for the agent: an in-memory memory store and a small hand-built
// DatasetQuery so the brain, loop, and bridge can be exercised without the
// published dataset on disk or a live LLM.
import type { Recipe } from "@/lib/model/types";
import type {
  DatasetQuery,
  DatasetRecipeHit,
  DatasetResourceHit,
  MemoryStore,
  WorldMemory,
} from "./types";

/** A memory store that lives in a Map — the shape of FileMemoryStore, no disk. */
export class InMemoryMemoryStore implements MemoryStore {
  private store = new Map<string, WorldMemory>();

  async load(worldName: string): Promise<WorldMemory> {
    return this.store.get(worldName) ?? { worldName, builtMachines: {}, notes: [] };
  }

  async save(memory: WorldMemory): Promise<void> {
    this.store.set(memory.worldName, memory);
  }
}

/** One honest GTNH recipe: a furnace that smelts raw iron ore into an iron ingot. */
export const SMELTER_RECIPE: Recipe = {
  id: "recipe:smelter:iron",
  name: "Smelt Raw Iron Ore",
  kind: "gregtech_machine",
  machineType: "Furnace",
  minimumTier: "ULV",
  durationTicks: 100,
  eut: 8,
  inputs: [{ kind: "item", id: "ore:iron", amount: 1, displayName: "Raw Iron Ore" }],
  outputs: [{ kind: "item", id: "ingot:iron", amount: 1, displayName: "Iron Ingot" }],
};

/** A minimal DatasetQuery over two iron resources and the smelter recipe above. */
export function makeFakeDatasetQuery(): DatasetQuery {
  const resources: DatasetResourceHit[] = [
    { id: "ingot:iron", kind: "item", name: "Iron Ingot", modId: "minecraft", recipeCount: 12 },
    { id: "ore:iron", kind: "item", name: "Raw Iron Ore", modId: "minecraft", recipeCount: 4 },
  ];
  const hits: DatasetRecipeHit[] = [
    {
      id: SMELTER_RECIPE.id,
      name: SMELTER_RECIPE.name,
      recipeMap: "Furnace",
      machineType: "Furnace",
      minimumTier: "ULV",
      durationTicks: 100,
      eut: 8,
      inputs: [{ kind: "item", id: "ore:iron", name: "Raw Iron Ore", amount: 1 }],
      outputs: [{ kind: "item", id: "ingot:iron", name: "Iron Ingot", amount: 1 }],
    },
  ];

  return {
    versionId: "test",

    async searchResources({ query, limit = 10, kind }) {
      const q = query.toLowerCase();
      return resources
        .filter((r) => (!kind || r.kind === kind) && (r.name?.toLowerCase().includes(q) || r.id.includes(q)))
        .slice(0, limit);
    },

    async findRecipes({ resource, mode, limit = 20 }) {
      const makesIt = hits[0].outputs.some((o) => o.id === resource.id && o.kind === resource.kind);
      const usesIt = hits[0].inputs.some((i) => i.id === resource.id && i.kind === resource.kind);
      if (mode === "recipes" && !makesIt) return [];
      if (mode === "uses" && !usesIt) return [];
      return hits.slice(0, limit);
    },

    async getFullRecipe(recipeId) {
      return recipeId === SMELTER_RECIPE.id ? SMELTER_RECIPE : undefined;
    },
  };
}
