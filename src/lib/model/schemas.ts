import { z } from "zod";
import { PROJECT_SCHEMA_VERSION } from "./types";

export const resourceKindSchema = z.enum(["item", "fluid", "aspect", "energy"]);
export const resourceIconAtlasRefSchema = z.object({
  imagePath: z.string().min(1),
  atlasWidth: z.number().int().positive(),
  atlasHeight: z.number().int().positive(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dominantColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
/**
 * A plan's (or post's) one-item face. Deliberately lenient: it only ever
 * renders as an icon, and a strict field must never sink a whole plan load.
 */
export const entryIconSchema = z.object({
  kind: z.enum(["item", "fluid"]),
  resourceId: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  iconPath: z.string().max(500).optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: z.string().max(32).optional(),
});

export const dominantColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();
export const factoryNodeColorTagSchema = z.enum([
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
  // The system swatches: the app's own semantic inks and card greys.
  "scarlet",
  "amber",
  "emerald",
  "azure",
  "steel",
  "onyx",
]);

export const resourceAmountSchema = z.object({
  kind: resourceKindSchema,
  id: z.string().min(1, "Resource id is required"),
  amount: z.number().positive("Amount must be greater than zero"),
  displayName: z.string().min(1).optional(),
  iconPath: z.string().min(1).optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  modId: z.string().min(1).optional(),
  tooltip: z.array(z.string()).optional(),
  neiSlot: z
    .object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
    })
    .optional(),
  alternatives: z
    .array(
      z.object({
        kind: resourceKindSchema,
        id: z.string().min(1),
        displayName: z.string().min(1).optional(),
        iconPath: z.string().min(1).optional(),
        iconAtlas: resourceIconAtlasRefSchema.optional(),
        dominantColor: dominantColorSchema,
        modId: z.string().min(1).optional(),
        tooltip: z.array(z.string()).optional(),
        amount: z.number().positive().optional(),
      }),
    )
    .optional(),
});

export const recipeInputSchema = resourceAmountSchema.extend({
  optional: z.boolean().optional(),
  consumed: z.boolean().optional(),
});

export const recipeOutputSchema = resourceAmountSchema.extend({
  chance: z.number().min(0).max(1).optional(),
  byproduct: z.boolean().optional(),
});

export const runtimeCalculationResourceSchema = z.object({
  kind: resourceKindSchema,
  id: z.string().min(1),
  amount: z.number().positive(),
  chance: z.number().min(0).max(1).optional(),
});

export const runtimeCalculationVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  machineHandlerId: z.string().min(1).optional(),
  overclockTier: z.string().min(1).optional(),
  coilTier: z.string().min(1).optional(),
  machineConfigTiers: z.record(z.string().min(1), z.string().min(1)).optional(),
  durationTicks: z.number().int().positive("Duration must be at least 1 tick"),
  eut: z.number().min(0, "EU/t must be zero or positive"),
  parallel: z.number().positive().optional(),
  inputs: z.array(runtimeCalculationResourceSchema).optional(),
  outputs: z.array(runtimeCalculationResourceSchema).optional(),
  notes: z.string().optional(),
});

export const runtimeCalculationSchema = z.object({
  sourceKind: z.enum([
    "gregtech-processing-logic",
    "gregtech-overclock-calculator",
    "gregtech-recipe-baseline",
    "thaumcraft-runtime",
    "passive-bee",
    "passive-crop",
    "synthetic-passive-bootstrap",
  ]),
  sourceClass: z.string().min(1).optional(),
  sourceVersion: z.string().min(1).optional(),
  recipeMap: z.string().min(1).optional(),
  status: z.enum(["computed", "partial", "missing"]),
  oracleEligible: z.boolean(),
  strict: z.boolean().optional(),
  generatedAt: z.string().optional(),
  variants: z.array(runtimeCalculationVariantSchema),
  warnings: z.array(z.string()).optional(),
});

export const machineProfileSchema = z.object({
  machineType: z.string().min(1),
  minimumTier: z.string().min(1),
  durationTicks: z.number().int().positive("Duration must be at least 1 tick").optional(),
  eut: z.number().min(0, "EU/t must be zero or positive").optional(),
  maxParallel: z.number().positive().optional(),
  eutLimit: z.number().positive().optional(),
  perfectOverclock: z.boolean().optional(),
  notes: z.string().optional(),
});

export const machineConfigControlSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  minimumKey: z.string().min(1),
  defaultKey: z.string().min(1).optional(),
  tiers: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        heat: z.number().int().positive().optional(),
        durationMultiplier: z.number().positive().optional(),
        eutMultiplier: z.number().positive().optional(),
        outputMultiplier: z.number().nonnegative().optional(),
        parallelMultiplier: z.number().positive().optional(),
        parallelPerVoltageTier: z.number().positive().optional(),
        parallelVoltageBase: z.number().nonnegative().optional(),
        resource: resourceAmountSchema,
      }),
    )
    .min(1),
});

export const machineHandlerSchema = machineProfileSchema.extend({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["single", "multiblock", "crafting", "automation"]).optional(),
  machineConfigControls: z.array(machineConfigControlSchema).optional(),
});

export const recipeSchema = z.object({
  id: z.string().min(1, "Recipe id is required"),
  name: z.string().min(1, "Recipe name is required"),
  kind: z
    .enum([
      "gregtech_machine",
      "bee_produce",
      "crop_produce",
      "ore_vein",
      "small_ore",
      "underground_fluid",
      "essentia_smelting",
      "custom",
      "unknown",
    ])
    .optional(),
  category: z.string().min(1).optional(),
  machineType: z.string().min(1, "Machine type is required"),
  minimumTier: z.string().min(1, "Minimum tier is required"),
  durationTicks: z.number().int().positive("Duration must be at least 1 tick"),
  eut: z.number().min(0, "EU/t must be zero or positive"),
  inputs: z.array(recipeInputSchema),
  // Zero outputs is legal: the crop-farm placeholder recipe
  // (factoryflow:crop-farm:empty) has none until a crop is picked, and it
  // stays in project.recipes, which made plans containing a crop farm fail
  // validation on community upload and JSON import.
  outputs: z.array(recipeOutputSchema),
  programmedCircuit: z.string().optional(),
  specialValue: z.number().optional(),
  notes: z.string().optional(),
  machineProfile: machineProfileSchema.optional(),
  machineHandlers: z.array(machineHandlerSchema).optional(),
  machineConfigControls: z.array(machineConfigControlSchema).optional(),
  runtimeCalculation: runtimeCalculationSchema.optional(),
  isDemo: z.boolean().optional(),
  source: z
    .object({
      datasetVersionId: z.string().optional(),
      recipeMap: z.string().optional(),
      sourceMod: z.string().optional(),
      exporter: z.enum(["nesql", "recex", "nerd", "gtnh-oracle", "unknown"]).optional(),
      rawRecipeId: z.string().optional(),
      sourceIdentifier: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string().min(1), z.unknown()).optional(),
  nei: z
    .object({
      iconPath: z.string().optional(),
      source: z.string().optional(),
      handlerClass: z.string().optional(),
      canvas: z.object({ width: z.number(), height: z.number() }).optional(),
      backgroundImage: z.string().optional(),
      itemInputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      itemOutputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      fluidInputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      fluidOutputGrid: z.object({ width: z.number(), height: z.number() }).optional(),
      slotCapacity: z
        .object({
          maxItemInputs: z.number().int().min(0).optional(),
          maxItemOutputs: z.number().int().min(0).optional(),
          maxFluidInputs: z.number().int().min(0).optional(),
          maxFluidOutputs: z.number().int().min(0).optional(),
        })
        .optional(),
      slots: z
        .array(
          z.object({
            side: z.enum(["input", "output"]),
            kind: resourceKindSchema,
            slotIndex: z.number().int().min(0),
            x: z.number().int().min(0),
            y: z.number().int().min(0),
          }),
        )
        .optional(),
      progressBars: z
        .array(
          z.object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            direction: z.enum(["right", "up", "circular"]),
            texture: z.string().optional(),
          }),
        )
        .optional(),
      additionalInfo: z.array(z.string()).optional(),
      requiresCleanroom: z.boolean().optional(),
      requiresLowGravity: z.boolean().optional(),
    })
    .optional(),
});

export const targetRateSchema = z.object({
  kind: resourceKindSchema,
  resourceId: z.string().min(1),
  amountPerSecond: z.number().positive("Target rate must be greater than zero"),
  displayName: z.string().optional(),
});

export const factoryNodeSchema = z.object({
  id: z.string().min(1),
  recipeId: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  customRate: z
    .object({
      perSecond: z.number().min(0),
      mode: z.enum(["supply", "request"]),
    })
    .optional(),
  machineCount: z.number().min(0),
  parallel: z
    .number()
    .positive()
    .transform((value) => Math.max(1, Math.round(value))),
  overclockTier: z.string().min(1),
  energyHatches: z
    .number()
    .int()
    .min(1)
    .max(64)
    .optional(),
  machineHandlerId: z.string().min(1).optional(),
  coilTier: z.string().min(1).optional(),
  machineConfigTiers: z.record(z.string().min(1), z.string().min(1)).optional(),
  settingsCollapsed: z.boolean().optional(),
  recipeInputOverrides: z.record(z.string().min(1), recipeInputSchema).optional(),
  targetOutput: targetRateSchema.optional(),
  enabled: z.boolean(),
  pocketId: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const factoryStorageSchema = z.object({
  id: z.string().min(1),
  kind: resourceKindSchema,
  resourceId: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  capacity: z.number().positive().optional(),
  // Absent on every plan written before drains had a mode, and absent is
  // `product` - the pulling one - so nothing anybody has saved changes pace.
  drainMode: z.enum(["product", "byproduct"]).optional(),
  // Absent means `overflow`: every buffer catches surplus unless the player
  // deliberately sets it strict.
  bufferMode: z.enum(["overflow", "strict"]).optional(),
  pocketId: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const factoryAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["box", "arrow", "text", "zone", "image"]),
  colorTag: factoryNodeColorTagSchema.optional(),
  text: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }),
  arrowDirection: z.enum(["down-right", "down-left", "up-right", "up-left"]).optional(),
  // Zone outlines: bounded so an imported plan cannot carry a pathological
  // vertex soup; a drawn zone simplifies to a handful of corners.
  points: z.array(z.object({ x: z.number(), y: z.number() })).max(64).optional(),
  // Bounded so an imported plan cannot carry a note that swallows the board.
  fontSize: z.number().min(8).max(96).optional(),
  // Image annotations: only ever rendered as an <img> src. Bounded, and http
  // or a data URI only, so a plan cannot smuggle a javascript: URL.
  imageUrl: z
    .string()
    .max(2048)
    .regex(/^(https?:\/\/|data:image\/)/)
    .optional(),
  style: z
    .object({
      border: z.enum(["solid", "dashed", "none"]).optional(),
      borderColor: factoryNodeColorTagSchema.optional(),
      fill: z
        .enum(["tint", "solid", "paper", "dots", "grid", "graph", "ruled", "hatch", "none"])
        .optional(),
      fillColor: factoryNodeColorTagSchema.optional(),
      // A canvas theme id; unknown ids quietly fall back at render time.
      fillTheme: z.string().max(32).optional(),
      marks: z.enum(["none", "dots", "grid", "graph", "ruled", "hatch"]).optional(),
    })
    .optional(),
  pocketId: z.string().min(1).optional(),
});

export const factoryPocketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  parentPocketId: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const factoryEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  resourceKind: resourceKindSchema,
  resourceId: z.string().min(1),
  label: z.string().optional(),
  ratePerSecond: z.number().positive().optional(),
  labelOffset: z.object({ x: z.number(), y: z.number() }).optional(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});

export const fuelProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    fuelFluidId: z.string().min(1),
    euPerLiter: z.number().positive().optional(),
    euPerBucket: z.number().positive().optional(),
    isDemo: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine((fuel) => fuel.euPerLiter !== undefined || fuel.euPerBucket !== undefined, {
    message: "Fuel profile needs euPerLiter or euPerBucket",
    path: ["euPerLiter"],
  });

/**
 * The author's workspace arrangement, carried by shared setups only.
 *
 * Every field is optional and loosely typed on purpose. This has to survive a
 * round trip through `factoryProjectSchema.parse` (which strips what it does
 * not know) and the server's own re-validation, and a plan saved by a newer
 * build must not be rejected wholesale because it mentions a view setting this
 * one has never heard of. Unknown values are dropped when the view is APPLIED,
 * where the real constants live, rather than being policed here.
 */
export const planViewStateSchema = z.object({
  canvasPattern: z.string().optional(),
  canvasTheme: z.string().optional(),
  lineHeatMode: z.boolean().optional(),
  lineThicknessMode: z.boolean().optional(),
  freeDockMode: z.boolean().optional(),
  lineLabelsMode: z.boolean().optional(),
  linePulseMode: z.boolean().optional(),
  calmMode: z.boolean().optional(),
  glanceMode: z.string().optional(),
  rateUnit: z.enum(["tick", "second", "minute", "hour"]).optional(),
  leftPanelOpen: z.boolean().optional(),
  rightPanelOpen: z.boolean().optional(),
  showHiddenResources: z.boolean().optional(),
  favouritesOnly: z.boolean().optional(),
  trendsOpen: z.boolean().optional(),
  hiddenResourceKeys: z.array(z.string()).optional(),
  favouriteResourceKeys: z.array(z.string()).optional(),
});

export const factoryProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  // No length cap: the inputs cap at the community limits, and a strict field
  // here would sink a whole plan load over its blurb.
  description: z.string().optional(),
  icon: entryIconSchema.optional(),
  view: planViewStateSchema.optional(),
  targetRate: targetRateSchema.optional(),
  // Sketch mode: solve as if every bare slot had its boundary drawer.
  assumeBoundaries: z.boolean().optional(),
  recipes: z.array(recipeSchema),
  nodes: z.array(factoryNodeSchema),
  storages: z.array(factoryStorageSchema).optional().default([]),
  annotations: z.array(factoryAnnotationSchema).optional().default([]),
  pockets: z.array(factoryPocketSchema).optional().default([]),
  edges: z.array(factoryEdgeSchema),
  fuelProfiles: z.array(fuelProfileSchema),
  selectedFuelProfileId: z.string().optional(),
  notes: z.string().optional(),
  metadata: z
    .object({
      isDemo: z.boolean().optional(),
      source: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      communityPlanId: z.string().optional(),
      communityFingerprint: z.string().optional(),
    })
    .optional(),
});

export type FactoryProjectInput = z.input<typeof factoryProjectSchema>;

/**
 * A captured board selection (the clipboard/blueprint payload): validated
 * server-side before a blueprint is stored, so a hand-crafted upload cannot
 * smuggle malformed cards into every design that later pastes it.
 */
export const boardSelectionPayloadSchema = z.object({
  nodes: z.array(factoryNodeSchema),
  storages: z.array(factoryStorageSchema),
  annotations: z.array(factoryAnnotationSchema),
  pockets: z.array(factoryPocketSchema),
  edges: z.array(factoryEdgeSchema),
  recipes: z.array(recipeSchema),
});
