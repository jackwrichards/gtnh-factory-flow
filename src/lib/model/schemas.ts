import { z } from "zod";
import { PROJECT_SCHEMA_VERSION } from "./types";

export const resourceKindSchema = z.enum(["item", "fluid", "aspect", "power"]);
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

/** The in-game planner's data on one thing, serialized: what one card may carry. */
export const GTNHPLANNER_DATA_MAX_BYTES = 64 * 1024;

const utf8 = new TextEncoder();

/** A value's size as JSON in UTF-8 bytes. */
export function jsonByteLength(value: unknown): number {
  return utf8.encode(JSON.stringify(value) ?? "").length;
}

/** How deep opaque data (the game's, a recipe's metadata) may nest, in arrays and objects. */
export const OPAQUE_DATA_MAX_DEPTH = 63;

/**
 * True when `value` nests no deeper than `levels` arrays and objects. Stops
 * at the first level too deep, so it never recurses past `levels`.
 */
export function nestsAtMost(value: unknown, levels: number): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (levels <= 0) {
    return false;
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.every((child) => nestsAtMost(child, levels - 1));
}

/**
 * Opaque data: any JSON object, nested to a bounded depth so nothing stored
 * is pathologically deep. Later checks are skipped when it fails: they
 * serialize the value.
 */
const opaqueDataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => nestsAtMost(value, OPAQUE_DATA_MAX_DEPTH), {
    message: `Nested more than ${OPAQUE_DATA_MAX_DEPTH} levels deep`,
    abort: true,
  });

/**
 * The in-game planner's own data for a thing or the whole plan: opaque here
 * and kept exactly as written, so a website edit never loses what the game
 * stored. Bounded so one card cannot carry megabytes.
 */
export const gtnhplannerDataSchema = opaqueDataSchema.refine(
  (value) => jsonByteLength(value) <= GTNHPLANNER_DATA_MAX_BYTES,
  {
    message: `The game's data on one thing is limited to ${GTNHPLANNER_DATA_MAX_BYTES / 1024} KB`,
  },
);

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
  consumeChance: z.number().min(0).max(1).optional(),
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
  maximumTier: z.string().min(1).optional(),
  availableTiers: z.array(z.string().min(1)).optional(),
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
  numeric: z
    .object({
      min: z.number(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
    })
    .optional(),
  minimumHeatFromSpecialValue: z.boolean().optional(),
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
  maximumTier: z.string().min(1).optional(),
  availableTiers: z.array(z.string().min(1)).optional(),
  durationTicks: z.number().int().positive("Duration must be at least 1 tick"),
  eut: z.number().min(0, "EU/t must be zero or positive"),
  inputs: z.array(recipeInputSchema),
  // Zero outputs is legal: the crop-farm placeholder recipe
  // (factoryflow:crop-farm:empty) has none until a crop is picked, and it
  // stays in project.recipes.
  outputs: z.array(recipeOutputSchema),
  programmedCircuit: z.string().optional(),
  specialValue: z.number().optional(),
  notes: z.string().optional(),
  machineProfile: machineProfileSchema.optional(),
  machineHandlers: z.array(machineHandlerSchema).optional(),
  machineConfigControls: z.array(machineConfigControlSchema).optional(),
  // Power cards (src/lib/power): the generator behind a synthesized recipe.
  power: z
    .object({
      sourceId: z.string().min(1),
      euPerTick: z.number(),
      stats: z.array(z.object({ label: z.string(), value: z.string() })),
      warnings: z.array(z.string()).optional(),
    })
    .optional(),
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
  metadata: z
    .record(z.string().min(1), z.unknown())
    .refine((value) => nestsAtMost(value, OPAQUE_DATA_MAX_DEPTH), {
      message: `Nested more than ${OPAQUE_DATA_MAX_DEPTH} levels deep`,
    })
    .optional(),
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
  productionGroupId: z.string().min(1).optional(),
  id: z.string().min(1),
  recipeId: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  customRate: z
    .object({
      perSecond: z.number().min(0),
      mode: z.enum(["supply", "request"]),
    })
    .optional(),
  cropFullFarmCount: z.number().int().min(1).optional(),
  machineCount: z.number().min(0),
  parallel: z
    .number()
    .positive()
    .transform((value) => Math.max(1, Math.round(value))),
  overclockTier: z.string().min(1),
  energyHatches: z.number().int().min(1).max(64).optional(),
  energyHatchType: z.string().min(1).optional(),
  powerEuT: z.number().nonnegative().finite().optional(),
  hatchVoltageTier: z
    .enum([
      "ULV",
      "LV",
      "MV",
      "HV",
      "EV",
      "IV",
      "LuV",
      "ZPM",
      "UV",
      "UHV",
      "UEV",
      "UIV",
      "UMV",
      "UXV",
      "MAX",
    ])
    .optional(),
  hatchAmps: z.number().nonnegative().finite().optional(),
  powerInputMode: z.enum(["amps", "eut"]).optional(),
  machineHandlerId: z.string().min(1).optional(),
  coilTier: z.string().min(1).optional(),
  machineConfigTiers: z.record(z.string().min(1), z.string().min(1)).optional(),
  settingsCollapsed: z.boolean().optional(),
  hatchSupplies: z.array(z.enum(["water", "air"])).optional(),
  recipeInputOverrides: z.record(z.string().min(1), recipeInputSchema).optional(),
  // More recipes the same machine runs (shared-machine.ts), sections 1..n.
  extraRecipes: z
    .array(
      z.object({
        recipeId: z.string().min(1),
        recipeInputOverrides: z.record(z.string().min(1), recipeInputSchema).optional(),
      }),
    )
    .optional(),
  // The machine count the player set: Up to by default, Exactly with solvePinExact; absent = Any, the solver's choice.
  solvePin: z.number().nonnegative().optional(),
  solvePinExact: z.boolean().optional(),
  // Plan mode's port-rate pins by canonical handle id, units per second.
  portRates: z
    .record(z.string().min(1).max(512), z.number().positive().finite())
    .refine((rates) => Object.keys(rates).length <= 256, "Too many port rates.")
    .optional(),
  targetOutput: targetRateSchema.optional(),
  enabled: z.boolean(),
  pocketId: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  gtnhplanner: gtnhplannerDataSchema.optional(),
});

export const factoryStorageSchema = z.object({
  productionGroupId: z.string().min(1).optional(),
  id: z.string().min(1),
  kind: resourceKindSchema,
  resourceId: z.string().min(1),
  colorTag: factoryNodeColorTagSchema.optional(),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: dominantColorSchema,
  capacity: z.number().positive().optional(),
  // Absent means `product` (the pulling one), as on legacy plans.
  drainMode: z.enum(["product", "byproduct", "trash"]).optional(),
  // Absent means `overflow` in Build and `strict` in Solve (effectiveBufferMode).
  bufferMode: z.enum(["overflow", "strict", "ratio"]).optional(),
  ratioExportPercent: z.number().min(0).max(100).optional(),
  // Pool mode: which side of the shared pool an unwired drawer sits on.
  poolSide: z.enum(["source", "drain"]).optional(),
  // Solve mode's requirement on a product drawer; absent = unconstrained.
  targetPerSecond: z.number().finite().optional(),
  targetMode: z.enum(["at-least", "at-most", "exact", "ignore"]).optional(),
  poolTargetMode: z.enum(["at-least", "exact", "ignore"]).optional(),
  pocketId: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  gtnhplanner: gtnhplannerDataSchema.optional(),
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
  arrowHeads: z.enum(["end", "both"]).optional(),
  arrowWidth: z.number().min(1).max(8).optional(),
  // Zone outlines: bounded so an imported plan cannot carry a pathological
  // vertex soup; a drawn zone simplifies to a handful of corners.
  points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .max(64)
    .optional(),
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
  gtnhplanner: gtnhplannerDataSchema.optional(),
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
  // Standing open as a board window; absent = minimized summary card.
  expanded: z.boolean().optional(),
  size: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  // A canvas theme id; unknown ids quietly fall back at render time.
  theme: z.string().max(32).optional(),
  // A canvas pattern id; unknown ids fall back to the default ruling.
  pattern: z.string().max(16).optional(),
  gtnhplanner: gtnhplannerDataSchema.optional(),
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
  ratioWeight: z.number().nonnegative().optional(),
  ratioInputWeight: z.number().nonnegative().optional(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  // An older build's loose cell wire, turned into a fluid tank on landing; see FactoryEdge.crossForm.
  crossForm: z.object({ litresPerCell: z.number().positive() }).optional(),
  gtnhplanner: gtnhplannerDataSchema.optional(),
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
 * Every field is optional and loosely typed on purpose: it must survive
 * `factoryProjectSchema.parse` (which strips unknown keys) and server
 * re-validation, and a plan from a newer build must not be rejected over a
 * view setting this one does not know. Unknown values are dropped when the
 * view is APPLIED, where the real constants live.
 */
export const planViewStateSchema = z.object({
  canvasPattern: z.string().optional(),
  canvasTheme: z.string().optional(),
  lineHeatMode: z.boolean().optional(),
  fixedEdgeWidth: z.boolean().optional(),
  linePulseMode: z.boolean().optional(),
  calmMode: z.boolean().optional(),
  glanceMode: z.string().optional(),
  rateUnit: z.enum(["tick", "second", "minute", "hour", "eu"]).optional(),
  leftPanelOpen: z.boolean().optional(),
  rightPanelOpen: z.boolean().optional(),
  showHiddenResources: z.boolean().optional(),
  favouritesOnly: z.boolean().optional(),
  trendsOpen: z.boolean().optional(),
  hiddenResourceKeys: z.array(z.string()).optional(),
  favouriteResourceKeys: z.array(z.string()).optional(),
});

/** The task board's bounds: what one task, checklist line or comment may hold. */
export const PLAN_TASK_LIMITS = {
  idLength: 200,
  titleLength: 120,
  textLength: 4000,
  itemTextLength: 200,
  commentTextLength: 2000,
  orderLength: 128,
  accountIdLength: 64,
  accountNameLength: 64,
  assignees: 50,
  nodeIds: 500,
  /** The tasks one task may wait on. */
  blockedBy: 500,
  stampLength: 40,
  /** A location's label, as the game clips it. */
  placeLabelLength: 60,
  /** A dimension's name or a world's key (`server:<16 hex>`, `world:<uuid>`). */
  placeNameLength: 120,
  /**
   * A screenshot's thumbnail, a JPEG data URL: the game keeps the JPEG under 40 KB (about 54,000 characters in
   * base64); this leaves room and still keeps one thing well under a live batch's 256 KB.
   */
  pictureThumbLength: 96_000,
  pictureFileLength: 200,
  /** A quest's name and quest line, and its icon's item key. */
  questTextLength: 200,
  questIconLength: 512,
} as const;

const taskIdSchema = z.string().min(1).max(PLAN_TASK_LIMITS.idLength);
const accountIdSchema = z.string().min(1).max(PLAN_TASK_LIMITS.accountIdLength);
const stampSchema = z.string().max(PLAN_TASK_LIMITS.stampLength);
// A fractional index: sorts as a string, and a move writes a key between two others.
const orderKeySchema = z.string().min(1).max(PLAN_TASK_LIMITS.orderLength);

const planTaskLinkSchema = z.object({
  // Empty reads as the plan holding the task (the game's older spelling).
  plan: z.string().max(PLAN_TASK_LIMITS.idLength),
  node: taskIdSchema,
});

export const planTaskSchema = z.object({
  id: taskIdSchema,
  title: z.string().min(1).max(PLAN_TASK_LIMITS.titleLength),
  text: z.string().max(PLAN_TASK_LIMITS.textLength).optional(),
  status: z.enum(["todo", "doing", "blocked", "done"]),
  order: orderKeySchema,
  assignees: z.array(accountIdSchema).max(PLAN_TASK_LIMITS.assignees).optional(),
  links: z.array(planTaskLinkSchema).max(PLAN_TASK_LIMITS.nodeIds).optional(),
  nodeIds: z.array(taskIdSchema).max(PLAN_TASK_LIMITS.nodeIds).optional(),
  createdBy: accountIdSchema.optional(),
  createdAt: stampSchema.optional(),
  doneAt: stampSchema.optional(),
  /** No priority is Medium; the game writes none for Medium. */
  priority: z.enum(["high", "medium", "low"]).optional(),
  /** When it last changed column; a task without one counts from `createdAt`. */
  movedAt: stampSchema.optional(),
  /** Tasks of the same board it waits on, by id. */
  blockedBy: z.array(taskIdSchema).max(PLAN_TASK_LIMITS.blockedBy).optional(),
});

/** A spot in a game world: a block, its dimension, the world it belongs to, an optional label. */
export const planPlaceSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  dim: z.number().int(),
  dimName: z.string().max(PLAN_TASK_LIMITS.placeNameLength),
  world: z.string().max(PLAN_TASK_LIMITS.placeNameLength),
  label: z.string().max(PLAN_TASK_LIMITS.placeLabelLength).optional(),
});

/**
 * A screenshot taken in the game: its thumbnail as an image data URL (only a data URL, so drawing it never reaches
 * another site), the full shot's size, when, and the full shot's file in the screenshots folder of the game that
 * took it.
 */
export const planPictureSchema = z.object({
  thumb: z
    .string()
    .max(PLAN_TASK_LIMITS.pictureThumbLength)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  w: z.number().int().min(0),
  h: z.number().int().min(0),
  takenAt: stampSchema,
  file: z.string().max(PLAN_TASK_LIMITS.pictureFileLength).optional(),
});

/**
 * A quest in the game's quest book, the game's only: its id there, with its name, icon (an item key) and quest line.
 * Kept as it came, so a plan the website saves keeps the game's quests.
 */
export const planQuestSchema = z.object({
  id: taskIdSchema,
  name: z.string().max(PLAN_TASK_LIMITS.questTextLength),
  icon: z.string().max(PLAN_TASK_LIMITS.questIconLength).optional(),
  line: z.string().max(PLAN_TASK_LIMITS.questTextLength).optional(),
});

/**
 * One thing on a task, each with its own checkbox: a machine (a card on a plan, `link`), a location (`place`) or a
 * screenshot (`picture`). An older checklist line has no kind. `text` is always the thing in words.
 */
export const planTaskItemSchema = z.object({
  id: taskIdSchema,
  taskId: taskIdSchema,
  // "quest" is the game's only: the website shows it as its words and keeps `quest` as it came.
  kind: z.enum(["machine", "location", "picture", "quest"]).optional(),
  text: z.string().min(1).max(PLAN_TASK_LIMITS.itemTextLength),
  done: z.boolean(),
  order: orderKeySchema,
  link: planTaskLinkSchema.optional(),
  nodeId: taskIdSchema.optional(),
  place: planPlaceSchema.optional(),
  picture: planPictureSchema.optional(),
  quest: planQuestSchema.optional(),
});

export const planTaskCommentSchema = z.object({
  id: taskIdSchema,
  taskId: taskIdSchema,
  by: accountIdSchema,
  byName: z.string().max(PLAN_TASK_LIMITS.accountNameLength),
  at: stampSchema,
  text: z.string().min(1).max(PLAN_TASK_LIMITS.commentTextLength),
});

export const productionGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).optional(),
  resourceRules: z.record(z.string(), z.enum(["share", "import"])).optional(),
});

export const factoryProjectSchema = z.object({
  productionGroups: z.array(productionGroupSchema).optional(),
  poolResourceRules: z.record(z.string(), z.enum(["share", "import"])).optional(),
  checklist: z.object({ cards: z.array(z.string()), edges: z.array(z.string()) }).optional(),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  // No length cap: the inputs cap at the community limits, and a strict field
  // here would sink a whole plan load over its blurb.
  description: z.string().optional(),
  icon: entryIconSchema.optional(),
  view: planViewStateSchema.optional(),
  targetRate: targetRateSchema.optional(),
  // Legacy setup rules: still parsed so old JSON validates, dropped on load.
  setupRules: z
    .object({
      freeInputs: z.boolean().optional(),
      freeOutputs: z.boolean().optional(),
    })
    .optional(),
  // Legacy sketch mode, dropped on load.
  assumeBoundaries: z.boolean().optional(),
  // Solve mode: product amounts are the question, machine counts the answer.
  solveMode: z.boolean().optional(),
  // Pool mode: every resource is shared, no wires needed.
  poolMode: z.boolean().optional(),
  // Plan mode: the merged board (implies solveMode).
  planMode: z.boolean().optional(),
  // Plan mode's stored leftover splits: leftover key -> bearer key -> share.
  spareShares: z
    .record(
      z.string().min(1).max(4096),
      z
        .record(z.string().min(1).max(512), z.number().min(0).max(1))
        .refine((shares) => Object.keys(shares).length <= 64, "Too many bearers."),
    )
    .refine((leftovers) => Object.keys(leftovers).length <= 1024, "Too many leftovers.")
    .optional(),
  // Plan mode's setting pins: machine name -> the setting keys its cards show as chips.
  settingPins: z
    .record(z.string().min(1).max(256), z.array(z.string().min(1).max(128)).max(64))
    .refine((pins) => Object.keys(pins).length <= 512, "Too many pinned machines.")
    .optional(),
  // Pool mode's cell-to-fluid ratios, litres per filled cell by cell id.
  poolCellRatios: z.record(z.string(), z.number().positive()).optional(),
  recipes: z.array(recipeSchema),
  nodes: z.array(factoryNodeSchema),
  storages: z.array(factoryStorageSchema).optional().default([]),
  annotations: z.array(factoryAnnotationSchema).optional().default([]),
  pockets: z.array(factoryPocketSchema).optional().default([]),
  edges: z.array(factoryEdgeSchema),
  fuelProfiles: z.array(fuelProfileSchema),
  selectedFuelProfileId: z.string().optional(),
  notes: z.string().optional(),
  // The in-game planner's data for the whole plan, kept as written.
  gtnhplanner: gtnhplannerDataSchema.optional(),
  // Which view the plan opens on; a task board is a plan with "tasks".
  primaryView: z.enum(["plan", "tasks"]).optional(),
  tasks: z.array(planTaskSchema).optional(),
  taskItems: z.array(planTaskItemSchema).optional(),
  taskComments: z.array(planTaskCommentSchema).optional(),
  metadata: z
    .object({
      isDemo: z.boolean().optional(),
      source: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      communityPlanId: z.string().optional(),
    })
    .optional(),
});

/**
 * A captured board selection (the clipboard/blueprint payload): validated
 * server-side before a blueprint is stored, so a hand-crafted upload cannot
 * smuggle malformed cards into every design that later pastes it.
 */
export const boardSelectionPayloadSchema = z.object({
  productionGroups: factoryProjectSchema.shape.productionGroups,
  nodes: z.array(factoryNodeSchema),
  storages: z.array(factoryStorageSchema),
  annotations: z.array(factoryAnnotationSchema),
  pockets: z.array(factoryPocketSchema),
  edges: z.array(factoryEdgeSchema),
  recipes: z.array(recipeSchema),
});
