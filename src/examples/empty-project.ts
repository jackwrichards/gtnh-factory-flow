import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

export function createEmptyProject(): FactoryProject {
  const now = new Date().toISOString();

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "manual-project",
    name: "GTNH Planner",
    recipes: [],
    nodes: [],
    storages: [],
    edges: [],
    notes: "Dataset-backed plan. Recipes must come from a normalized GTNH dataset.",
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  };
}
