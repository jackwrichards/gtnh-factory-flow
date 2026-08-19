import type {
  FactoryNode,
  MachineConfigControl,
  MachineConfigTierOption,
  MachineHandler,
  Recipe,
} from "./types";
import {
  getMachineHiddenControlIds,
  getMachineTableControls,
  machineTableSeedsFromBase,
} from "@/lib/machines/machine-table";

export interface MachineConfigTierControl {
  id: string;
  label: string;
  minimum: MachineConfigTierOption;
  current: MachineConfigTierOption;
  tiers: MachineConfigTierOption[];
  resource: MachineConfigTierOption["resource"];
}

export function expandMachineRecipeVariants(recipes: Recipe[]): Recipe[] {
  return recipes;
}

export function getRecipeMachineHandlers(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
): MachineHandler[] {
  // Dataset handler lists are authoritative and always start with the map's
  // primary machine. Synthesizing an extra entry from the recipe map name
  // would duplicate it under the category name ("Blast Furnace" next to the
  // real Electric Blast Furnace), so the fallback only exists for recipes
  // without exported handlers.
  const handlersByFamily = new Map<string, MachineHandler>();
  for (const handler of recipe.machineHandlers ?? []) {
    const normalized = normalizeMachineHandler(handler);
    const familyId = slug(normalized.label);
    if (!handlersByFamily.has(familyId)) {
      handlersByFamily.set(familyId, normalized);
    }
  }
  if (handlersByFamily.size > 0) {
    return [...handlersByFamily.values()];
  }

  const baseMachineType = machineHandlerFamilyLabel(recipe.machineType);
  return [
    {
      id: slug(baseMachineType),
      label: baseMachineType,
      machineType: baseMachineType,
      minimumTier: recipe.minimumTier,
      kind: "single",
    },
  ];
}

/**
 * Steam-line machines: they consume steam, never EU. Audited against all 836
 * exported catalysts: every machine named "Steam ..." or "High Pressure ..."
 * is a steam MTE without a Voltage IN tooltip line, and no EU machine
 * matches either pattern ("High Pressure Alloy Smelter" is the one steam
 * machine that omits the word steam).
 */
export function isSteamMachineHandler(handler: Pick<MachineHandler, "label">): boolean {
  return /\bsteam\b/i.test(handler.label) || /\bhigh pressure\b/i.test(handler.label);
}

/** The steel-cased half of the steam line: twice the speed, twice the steam. */
export function isHighPressureSteamHandler(handler: Pick<MachineHandler, "label">): boolean {
  return /\bhigh pressure\b/i.test(handler.label);
}

/**
 * GT's fixed furnace recipe. The dataset exports smelting off the vanilla map
 * (200 ticks, 0 EU), but every GT furnace actually runs this instead - the
 * Electric Furnace handler carries these numbers as absolute stats, and the
 * steam furnaces' math below seeds from them too.
 */
export const GT_FURNACE_RECIPE_TICKS = 128;
export const GT_FURNACE_RECIPE_EUT = 4;

/** Whether this recipe is vanilla-map smelting (see GT_FURNACE_RECIPE_TICKS). */
export function isSmeltingRecipeMap(recipe: Pick<Recipe, "machineType" | "source">): boolean {
  return /^(?:smelting|furnace)$/i.test(recipeMapName(recipe).trim());
}

/**
 * Steam singleblocks run the LV recipe on borrowed math the dataset does not
 * carry: SteamOverclockDescriber gives a bronze machine (x1 EU, x2 duration)
 * and a high pressure one (x2 EU, x1 duration). Their handlers export no
 * durationTicks of their own, so without this every steam machine showed the
 * LV duration - twice its real speed.
 */
function steamSingleblockDurationTicks(
  recipe: Pick<Recipe, "machineType" | "source" | "durationTicks">,
  handler: MachineHandler,
): number | undefined {
  if (handler.kind === "multiblock" || !isSteamMachineHandler(handler)) {
    return undefined;
  }
  const base = isSmeltingRecipeMap(recipe) ? GT_FURNACE_RECIPE_TICKS : recipe.durationTicks;
  return isHighPressureSteamHandler(handler) ? base : base * 2;
}

export function getSelectedMachineHandler(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
  node: Pick<FactoryNode, "machineHandlerId">,
): MachineHandler {
  const handlers = getRecipeMachineHandlers(recipe);
  return handlers.find((handler) => handler.id === node.machineHandlerId) ?? handlers[0];
}

export function getAdjacentMachineHandler(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
  currentId: string | undefined,
  direction: -1 | 1,
): MachineHandler {
  const handlers = getRecipeMachineHandlers(recipe);
  const currentIndex = Math.max(
    0,
    handlers.findIndex((handler) => handler.id === currentId),
  );
  const nextIndex = (currentIndex + direction + handlers.length) % handlers.length;
  return handlers[nextIndex] ?? handlers[0];
}

export function applyMachineHandlerToRecipe(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId">,
): Recipe {
  const handlers = getRecipeMachineHandlers(recipe);
  const handler = handlers.find((entry) => entry.id === node.machineHandlerId) ?? handlers[0];
  const machineConfigControls = handler.machineConfigControls ?? recipe.machineConfigControls;
  // Oracle runtime variants are computed in-game for the recipe map's
  // default machine; a different selected machine must fall back to the
  // static overclock math seeded with the handler's own duration/EU.
  const runtimeCalculation = handler.id === handlers[0].id ? recipe.runtimeCalculation : undefined;
  // The curated table states speed and power against the recipe map's base
  // numbers, while the dataset bakes its scraped multipliers into each
  // handler's own durationTicks/eut (a Volcanus handler carries the EBF
  // recipe pre-multiplied by x0.8 duration and x0.9 EU). Keeping both applies
  // the bonus twice, so a handler whose machine the table covers seeds from
  // the base recipe instead.
  const seedsFromBase = machineTableSeedsFromBase(handler.machineType);
  const handlerDurationTicks = seedsFromBase
    ? steamSingleblockDurationTicks(recipe, handler)
    : (handler.durationTicks ?? steamSingleblockDurationTicks(recipe, handler));
  const handlerEut = seedsFromBase ? undefined : handler.eut;
  // Steam machines burn steam, not EU. Their handlers carry no EU override,
  // so without this they would inherit the electric recipe's EU draw and the
  // planner would bill phantom power for them. The litres they do burn are
  // billed by getNodeSteamReport in power-report.ts.
  const eut = isSteamMachineHandler(handler) ? 0 : (handlerEut ?? recipe.eut);
  return {
    ...recipe,
    runtimeCalculation,
    machineType: handler.machineType,
    minimumTier: handler.minimumTier,
    durationTicks: handlerDurationTicks ?? recipe.durationTicks,
    eut,
    machineConfigControls,
    machineProfile: {
      ...recipe.machineProfile,
      machineType: handler.machineType,
      minimumTier: handler.minimumTier,
      durationTicks: handlerDurationTicks ?? recipe.machineProfile?.durationTicks,
      eut: handlerEut ?? recipe.machineProfile?.eut,
      maxParallel: handler.maxParallel ?? recipe.machineProfile?.maxParallel,
      eutLimit: handler.eutLimit ?? recipe.machineProfile?.eutLimit,
      perfectOverclock: handler.perfectOverclock ?? recipe.machineProfile?.perfectOverclock,
      kind: handler.kind ?? recipe.machineProfile?.kind,
      notes: handler.notes ?? recipe.machineProfile?.notes,
    },
  };
}

export function isRecipeTierAdjustable(
  recipe: Pick<Recipe, "machineType" | "source" | "nei">,
): boolean {
  const recipeMap = recipeMapName(recipe);

  return !isTieredMachineRecipeMap(recipeMap) && getRecipeSpecialValue(recipe) === undefined;
}

export function getRecipeCoilTierControl(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: { coilTier?: string },
) {
  const control =
    getMachineTableControls(recipe.machineType).find((entry) => entry.id === "heatingCoil") ??
    findMachineConfigControl(recipe, "heatingCoil");
  return control ? resolveMachineConfigTierControl(control, node.coilTier) : undefined;
}

export function getRecipeMachineConfigTierControls(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
): MachineConfigTierControl[] {
  const controls = dropHiddenControls(
    mergeMachineConfigControls(
      recipe.machineConfigControls ?? [],
      getMachineTableControls(recipe.machineType),
    ),
    recipe.machineType,
  );

  return controls
    .filter((control) => control.id !== "heatingCoil")
    .map((control) =>
      resolveMachineConfigTierControl(control, node.machineConfigTiers?.[control.id]),
    )
    .filter((control): control is MachineConfigTierControl => Boolean(control));
}

/**
 * The curated machine table wins over anything the dataset scraped, and adds
 * knobs the dataset has no control for at all. Dataset controls the table does
 * not mention are kept, so a machine can be partly covered.
 */
function mergeMachineConfigControls(
  fromDataset: MachineConfigControl[],
  fromTable: MachineConfigControl[],
): MachineConfigControl[] {
  if (fromTable.length === 0) {
    return fromDataset;
  }

  const tableIds = new Set(fromTable.map((control) => control.id));
  return [...fromDataset.filter((control) => !tableIds.has(control.id)), ...fromTable];
}

function dropHiddenControls(
  controls: MachineConfigControl[],
  machineType: string | undefined,
): MachineConfigControl[] {
  const hidden = getMachineHiddenControlIds(machineType);
  return hidden.length === 0
    ? controls
    : controls.filter((control) => !hidden.includes(control.id));
}

export function getAdjacentMachineConfigTier(
  control: MachineConfigTierControl,
  direction: -1 | 1,
): string {
  const currentIndex = control.tiers.findIndex((entry) => entry.key === control.current.key);
  const minimumIndex = control.tiers.findIndex((entry) => entry.key === control.minimum.key);
  const nextIndex = Math.min(
    control.tiers.length - 1,
    Math.max(Math.max(0, minimumIndex), currentIndex + direction),
  );
  return control.tiers[nextIndex]?.key ?? control.current.key;
}

function isTieredMachineRecipeMap(recipeMap: string): boolean {
  const normalized = normalizeRecipeMapName(recipeMap);
  return (
    normalized === "blast furnace" ||
    normalized === "electric blast furnace" ||
    normalized === "pyrolyse oven" ||
    normalized === "cracker" ||
    normalized === "chemical plant" ||
    normalized === "distillation tower" ||
    normalized === "vacuum freezer" ||
    normalized === "fusion reactor"
  );
}

export function getRecipeSpecialValue(recipe: Pick<Recipe, "nei">): number | undefined {
  for (const entry of recipe.nei?.additionalInfo ?? []) {
    const match = /special\s+value\s*:\s*(-?\d+)/i.exec(entry);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

function findMachineConfigControl(
  recipe: Pick<Recipe, "machineConfigControls">,
  id: string,
): MachineConfigControl | undefined {
  return recipe.machineConfigControls?.find((control) => control.id === id);
}

function resolveMachineConfigTierControl(
  control: MachineConfigControl,
  selectedKey: string | undefined,
): MachineConfigTierControl | undefined {
  const minimum = control.tiers.find((tier) => tier.key === control.minimumKey) ?? control.tiers[0];
  if (!minimum) {
    return undefined;
  }

  const minimumIndex = control.tiers.findIndex((tier) => tier.key === minimum.key);
  const tiers = control.tiers.slice(Math.max(0, minimumIndex));
  const selected = tiers.find((tier) => tier.key === selectedKey);
  const defaultTier = tiers.find((tier) => tier.key === control.defaultKey);
  const current = selected ?? defaultTier ?? minimum;

  return {
    id: control.id,
    label: control.label,
    minimum,
    current,
    tiers,
    resource: current.resource,
  };
}

function recipeMapName(recipe: Pick<Recipe, "machineType" | "source">): string {
  return recipe.source?.recipeMap ?? recipe.machineType;
}

function normalizeMachineHandler(handler: MachineHandler): MachineHandler {
  const familyLabel = machineHandlerFamilyLabel(handler.label);
  return {
    ...handler,
    label: familyLabel,
    machineType: machineHandlerFamilyLabel(handler.machineType),
  };
}

function machineHandlerFamilyLabel(label: string): string {
  const tierlessLabel = label
    .replace(/\s+\((?:ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\)$/i, "")
    .replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, "")
    .trim();
  const directAlias = MACHINE_HANDLER_FAMILY_ALIASES.get(normalizeMachineLabel(tierlessLabel));
  if (directAlias) {
    return directAlias;
  }

  const familyLabel = tierlessLabel
    .replace(/^(?:Basic|Advanced|Elite|Ultimate|Epic|MAX|Turbo|Quick|Instant|Universal)\s+/i, "")
    .trim();
  return MACHINE_HANDLER_FAMILY_ALIASES.get(normalizeMachineLabel(familyLabel)) ?? familyLabel;
}

const MACHINE_HANDLER_FAMILY_ALIASES = new Map([
  ["alloy integrator", "Alloy Smelter"],
  ["amplifabricator", "Matter Amplifier"],
  ["amplicreator", "Matter Amplifier"],
  ["assembling machine", "Assembler"],
  ["assembly constructor", "Assembler"],
  ["atom stimulator", "Electric Furnace"],
  ["blaze sweatshop t-6350", "Thermal Centrifuge"],
  ["can operator", "Canner"],
  ["centrifuge", "Centrifuge"],
  ["chemical dunktron", "Chemical Bath"],
  ["chemical perforer", "Chemical Reactor"],
  ["chemical performer", "Chemical Reactor"],
  ["circuit assembling machine", "Circuit Assembler"],
  // "Just a Furnace with a different Design" per its own tooltip; the Ore
  // Washer mapping was a slip that only surfaced once smelting recipes
  // started carrying furnace machine handlers.
  ["electric oven", "Electric Furnace"],
  ["electron excitement processor", "Electric Furnace"],
  ["exact photon cannon", "Laser Engraver"],
  ["extractinator", "Extractor"],
  ["fermentation hastener", "Fermenter"],
  ["fire cyclone", "Thermal Centrifuge"],
  ["fluid petrificator", "Fluid Solidifier"],
  ["fraction splitter", "Distillery"],
  ["heat infuser", "Fluid Heater"],
  ["impact modulator", "Forge Hammer"],
  ["ionizer", "Electrolyzer"],
  ["liquid can actuator", "Fluid Canner"],
  ["liquefying sucker", "Fluid Extractor"],
  ["magnetar separator", "Electromagnetic Separator"],
  ["magnetism inducer", "Electromagnetic Polarizer"],
  ["matter constrictor", "Compressor"],
  ["matter organizer", "Mixer"],
  ["molecular cyclone", "Centrifuge"],
  ["molecular disintegrator e-4908", "Electrolyzer"],
  ["molecular separator", "Centrifuge"],
  ["molecular tornado", "Centrifuge"],
  ["object divider", "Cutting Machine"],
  ["oblitterator", "Recycler"],
  ["ore washing machine", "Ore Washer"],
  ["ore washing plant", "Ore Washer"],
  ["polarizer", "Electromagnetic Polarizer"],
  ["precision laser engraver", "Laser Engraver"],
  ["pressure cooker", "Autoclave"],
  ["pulsation filter", "Sifter"],
  ["pulverizer", "Macerator"],
  ["repurposed laundry-washer i-360", "Ore Washer"],
  ["scrap-o-matic", "Recycler"],
  ["shape driver", "Extruder"],
  ["shape eliminator", "Macerator"],
  ["short circuit heater", "Arc Furnace"],
  ["sifting machine", "Sifter"],
  ["singularity compressor", "Compressor"],
  ["surface shifter", "Forming Press"],
  ["the oblitterator", "Recycler"],
  ["turn-o-matic", "Lathe"],
  ["ufo engine", "Microwave"],
  ["unboxinator", "Unpackager"],
  ["vacuum extractor", "Extractor"],
  ["wire transfigurator", "Wiremill"],
]);

function slug(value: string): string {
  return normalizeRecipeMapName(value).replace(/[^a-z0-9]+/g, "-");
}

function normalizeMachineLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeRecipeMapName(recipeMap: string): string {
  return recipeMap
    .trim()
    .toLowerCase()
    .replace(/\brecipes?\b/g, "")
    .replace(/\brecipe\s+map\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
