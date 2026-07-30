import type {
  Recipe,
  RecipeInput,
  RecipeOutput,
  ResourceAmount,
  ResourceIconAtlasRef,
} from "../model/types";

export interface DatasetSourceInfo {
  sourceId: "nesql" | "recex" | "nerd" | "gtnh-oracle" | "unknown";
  sourceVersion?: string;
  generatedAt: string;
  gitCommit?: string;
  notes?: string;
}

export interface DatasetResource {
  id: string;
  kind: "item" | "fluid" | "aspect";
  displayName: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  modId?: string;
  tooltip?: string[];
  oreDictionary?: string[];
  alternatives?: ResourceAmount["alternatives"];
}

export interface DatasetResourceIndexEntry {
  id: string;
  kind: "item" | "fluid" | "aspect";
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  tooltip?: string[];
  recipeCount: number;
  oreDictionary?: string[];
  alternatives?: ResourceAmount["alternatives"];
}

export interface RecipeMapIconEntry {
  recipeMap: string;
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "modId" | "tooltip"
  > &
    Partial<Pick<ResourceAmount, "amount">>;
}

/** The item that represents a machine handler family (its lowest-tier variant). */
export interface MachineHandlerIconEntry {
  familyId: string;
  resource: RecipeMapIconEntry["resource"];
}

export interface DatasetVersion {
  id: string;
  gtnhVersion: string;
  channel: "stable" | "daily" | "experimental";
  publishedAt: string;
  manifestPath: string;
  recipeDatasetPath: string;
  resourceIndexPath?: string;
  recipeIndexPath?: string;
  recipeLookupIndexPath?: string;
  checksumSha256?: string;
  sourceInfo: DatasetSourceInfo;
}

export interface DatasetManifest {
  schemaVersion: 1;
  latestStableVersion?: string;
  latestDailyVersion?: string;
  versions: DatasetVersion[];
}

export interface RecipeDataset {
  schemaVersion: 1;
  datasetVersionId: string;
  gtnhVersion: string;
  sourceInfo: DatasetSourceInfo;
  resources: DatasetResource[];
  resourceIndex?: DatasetResourceIndexEntry[];
  recipes: Recipe[];
  oreDictionary: Record<string, string[]>;
  recipeMaps: string[];
  recipeMapIcons?: RecipeMapIconEntry[];
  machineHandlerIcons?: MachineHandlerIconEntry[];
  generatedAt: string;
}

export interface RecipeSummary {
  id: string;
  name: string;
  kind?: Recipe["kind"];
  category?: string;
  recipeMap: string;
  machineType: string;
  minimumTier: string;
  durationTicks: number;
  eut: number;
  programmedCircuit?: string;
  specialValue?: number;
  machineHandlers?: Recipe["machineHandlers"];
  machineConfigControls?: Recipe["machineConfigControls"];
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  source?: Recipe["source"];
  metadata?: Recipe["metadata"];
  nei?: Recipe["nei"];
  slots: RecipeSummarySlot[];
}

export interface RecipeSummarySlot {
  side: "input" | "output";
  kind: "item" | "fluid";
  resourceIndex: number;
  x: number;
  y: number;
}
