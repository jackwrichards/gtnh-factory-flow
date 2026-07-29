import type {
  FactoryNode,
  MachineConfigControl,
  MachineConfigTierOption,
  MachineHandler,
  Recipe,
} from "./types";

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
  const baseMachineType = machineHandlerFamilyLabel(recipe.machineType);
  const baseHandler: MachineHandler = {
    id: slug(baseMachineType),
    label: baseMachineType,
    machineType: baseMachineType,
    minimumTier: recipe.minimumTier,
    kind: "single",
  };
  const handlersByFamily = new Map<string, MachineHandler>([[slug(baseMachineType), baseHandler]]);
  for (const handler of recipe.machineHandlers ?? []) {
    const normalized = normalizeMachineHandler(handler);
    const familyId = slug(normalized.label);
    if (!handlersByFamily.has(familyId)) {
      handlersByFamily.set(familyId, normalized);
    }
  }

  return [...handlersByFamily.values()];
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
  return {
    ...recipe,
    runtimeCalculation,
    machineType: handler.machineType,
    minimumTier: handler.minimumTier,
    durationTicks: handler.durationTicks ?? recipe.durationTicks,
    eut: handler.eut ?? recipe.eut,
    machineConfigControls,
    machineProfile: {
      ...recipe.machineProfile,
      machineType: handler.machineType,
      minimumTier: handler.minimumTier,
      durationTicks: handler.durationTicks ?? recipe.machineProfile?.durationTicks,
      eut: handler.eut ?? recipe.machineProfile?.eut,
      maxParallel: handler.maxParallel ?? recipe.machineProfile?.maxParallel,
      eutLimit: handler.eutLimit ?? recipe.machineProfile?.eutLimit,
      perfectOverclock: handler.perfectOverclock ?? recipe.machineProfile?.perfectOverclock,
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
  const importedControl = findMachineConfigControl(recipe, "heatingCoil");
  return importedControl
    ? resolveMachineConfigTierControl(importedControl, node.coilTier)
    : undefined;
}

export function getRecipeMachineConfigTierControls(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
): MachineConfigTierControl[] {
  const importedControls = recipe.machineConfigControls
    ?.filter((control) => control.id !== "heatingCoil")
    .map((control) =>
      resolveMachineConfigTierControl(control, node.machineConfigTiers?.[control.id]),
    )
    .filter((control): control is MachineConfigTierControl => Boolean(control));
  if (importedControls?.length) {
    return importedControls;
  }
  return [];
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
  ["electric oven", "Ore Washer"],
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
