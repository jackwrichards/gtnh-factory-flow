import { z } from "zod";
import { dominantColorSchema, recipeSchema, resourceIconAtlasRefSchema } from "../model/schemas";

export const datasetSourceInfoSchema = z.object({
  sourceId: z.enum(["nesql", "recex", "nerd", "gtnh-oracle", "unknown"]),
  sourceVersion: z.string().optional(),
  generatedAt: z.string(),
  gitCommit: z.string().optional(),
  notes: z.string().optional(),
});

export const datasetResourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["item", "fluid", "aspect"]),
  displayName: z.string().min(1),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  modId: z.string().optional(),
  tooltip: z.array(z.string()).optional(),
  oreDictionary: z.array(z.string()).optional(),
  alternatives: z
    .array(
      z.object({
        kind: z.enum(["item", "fluid", "aspect"]),
        id: z.string().min(1),
        displayName: z.string().min(1).optional(),
        iconPath: z.string().optional(),
        iconAtlas: resourceIconAtlasRefSchema.optional(),
        dominantColor: dominantColorSchema,
        modId: z.string().optional(),
        tooltip: z.array(z.string()).optional(),
        amount: z.number().positive().optional(),
      }),
    )
    .optional(),
});

export const datasetResourceIndexEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["item", "fluid", "aspect"]),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  recipeCount: z.number().int().min(0),
  oreDictionary: z.array(z.string()).optional(),
  alternatives: datasetResourceSchema.shape.alternatives,
});

export const recipeMapIconEntrySchema = z.object({
  recipeMap: z.string().min(1),
  resource: z.object({
    id: z.string().min(1),
    kind: z.enum(["item", "fluid", "aspect"]),
    amount: z.number().positive().optional(),
    displayName: z.string().min(1).optional(),
    iconPath: z.string().optional(),
    iconAtlas: resourceIconAtlasRefSchema.optional(),
    dominantColor: dominantColorSchema,
    modId: z.string().optional(),
    tooltip: z.array(z.string()).optional(),
  }),
});

export const machineHandlerIconEntrySchema = z.object({
  familyId: z.string().min(1),
  resource: recipeMapIconEntrySchema.shape.resource,
});

export const recipeDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersionId: z.string().min(1),
  gtnhVersion: z.string().min(1),
  sourceInfo: datasetSourceInfoSchema,
  resources: z.array(datasetResourceSchema).default([]),
  resourceIndex: z.array(datasetResourceIndexEntrySchema).optional(),
  recipes: z.array(recipeSchema),
  oreDictionary: z.record(z.string(), z.array(z.string())),
  recipeMaps: z.array(z.string()),
  recipeMapIcons: z.array(recipeMapIconEntrySchema).optional(),
  machineHandlerIcons: z.array(machineHandlerIconEntrySchema).optional(),
  generatedAt: z.string(),
});

export const datasetVersionSchema = z.object({
  id: z.string().min(1),
  gtnhVersion: z.string().min(1),
  channel: z.enum(["stable", "daily", "experimental"]),
  publishedAt: z.string(),
  manifestPath: z.string(),
  recipeDatasetPath: z.string(),
  resourceIndexPath: z.string().optional(),
  recipeIndexPath: z.string().optional(),
  recipeLookupIndexPath: z.string().optional(),
  checksumSha256: z.string().optional(),
  sourceInfo: datasetSourceInfoSchema,
});

export const datasetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  latestStableVersion: z.string().optional(),
  latestDailyVersion: z.string().optional(),
  versions: z.array(datasetVersionSchema),
});
