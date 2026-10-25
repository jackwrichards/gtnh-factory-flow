import type { FactoryNode, FactoryProject, Recipe } from "@/lib/model/types";
import {
  applyMachineHandlerToRecipe,
  applyRecipeInputOverrides,
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
  getRecipeSpecialValue,
} from "@/lib/model";
import { rememberSetting, settingMemoryMachine } from "@/lib/model/setting-memory";
import { getMachineBehaviour } from "@/lib/machines/machine-table";
import { isHeatOverclockMachine } from "@/lib/solver/heat";

/**
 * A card's settings as the gear sheet lists them and the strip shows them (the mod's `SettingControls` and
 * `SettingPins`): the machine's controls, the coil first on a heat recipe, each a list of options (only those that
 * are valid: a coil hot enough for the recipe). Pins are kept per machine in the plan (`project.settingPins`); a
 * machine never pinned shows its defaults, the coil.
 */
export interface SettingOption {
  key: string;
  label: string;
  /** The option's own block or item, drawn beside it. */
  icon?: string;
}

export interface SettingControl {
  /** `heatingCoil` for the coil, else the machine control's id. */
  id: string;
  group: string;
  label: string;
  value: string;
  icon?: string;
  /** The recipe cannot run at this value (a coil too cold). */
  warn: boolean;
  options: SettingOption[];
  currentKey: string;
  pinDefault: boolean;
}

export const COIL_ID = "heatingCoil";

/** A crop card's harvesters, a number setting pinned until unpinned: typed or stepped, it sets the seeds. */
export const CROP_MACHINES_ID = "cropMachines";

/** A setting that is a number the card works out, not a machine control: the well is typed into. */
export interface NumberSetting {
  id: string;
  label: string;
  /** As the well and the chip print it. */
  value: string;
  /** What an opened well starts with. */
  text: string;
  pinDefault: boolean;
  commit: (text: string) => void;
  step: (direction: -1 | 1) => void;
}

export function settingControls(recipe: Recipe, node: FactoryNode): SettingControl[] {
  try {
    return computeControls(recipe, node);
  } catch {
    return [];
  }
}

function computeControls(recipe: Recipe, node: FactoryNode): SettingControl[] {
  const effective = applyMachineHandlerToRecipe(applyRecipeInputOverrides(recipe, node), node);
  const out: SettingControl[] = [];
  const coil = getRecipeCoilTierControl(effective, node);
  if (coil) {
    const special = getRecipeSpecialValue(effective);
    const behaviour = getMachineBehaviour(effective.machineType);
    const heat = (coil.current.heat ?? 0) * (behaviour?.heat?.coilHeatMultiplier ?? 1);
    out.push({
      id: COIL_ID,
      group: "Machine",
      label: coil.label,
      value: coil.current.label,
      icon: coil.current.resource?.iconPath,
      warn: isHeatOverclockMachine(effective.machineType) && special !== undefined && special >= 0 && heat < special,
      options: coil.tiers.map((tier) => ({ key: tier.key, label: tier.label, icon: tier.resource?.iconPath })),
      currentKey: coil.current.key,
      pinDefault: true,
    });
  }
  for (const control of getRecipeMachineConfigTierControls(effective, node)) {
    if (control.id === COIL_ID || /^(machineParallel|voltageParallel)/.test(control.id)) continue;
    if (control.tiers.length <= 1) continue;
    out.push({
      id: control.id,
      group: "Machine",
      label: control.label,
      value: control.current.label,
      icon: control.current.resource?.iconPath,
      warn: false,
      options: control.tiers.map((tier) => ({ key: tier.key, label: tier.label, icon: tier.resource?.iconPath })),
      currentKey: control.current.key,
      pinDefault: false,
    });
  }
  return out;
}

/** The heat the recipe asks of the coil, in kelvin, when the machine reads it. */
export function recipeHeatNeed(recipe: Recipe, node: FactoryNode): number | undefined {
  try {
    return computeHeatNeed(recipe, node);
  } catch {
    return undefined;
  }
}

function computeHeatNeed(recipe: Recipe, node: FactoryNode): number | undefined {
  const effective = applyMachineHandlerToRecipe(applyRecipeInputOverrides(recipe, node), node);
  const special = getRecipeSpecialValue(effective);
  return isHeatOverclockMachine(effective.machineType) && special !== undefined && special > 0 ? special : undefined;
}

/** The key a machine's pins are kept under (the mod keys them by machine name). */
export function pinMachineKey(recipe: Recipe, node: FactoryNode): string {
  return settingMemoryMachine(recipe, node);
}

export function isPinned(
  project: Pick<FactoryProject, "settingPins">,
  machine: string,
  control: Pick<SettingControl, "id" | "pinDefault">,
): boolean {
  const kept = project.settingPins?.[machine];
  return kept === undefined ? control.pinDefault : kept.includes(control.id);
}

/** The keys a machine would have pinned after toggling one control. Pass every pinnable setting: one left out unpins. */
export function toggledPins(
  project: Pick<FactoryProject, "settingPins">,
  machine: string,
  controls: Array<Pick<SettingControl, "id" | "pinDefault">>,
  toggled: string,
): string[] {
  return controls
    .filter((control) => (control.id === toggled ? !isPinned(project, machine, control) : isPinned(project, machine, control)))
    .map((control) => control.id);
}

/** The patch that sets a control to an option, and the memory of it. */
export function settingPatch(
  recipe: Recipe,
  node: FactoryNode,
  controlId: string,
  optionKey: string,
): Partial<FactoryNode> {
  rememberSetting(settingMemoryMachine(recipe, node), controlId, optionKey);
  return controlId === COIL_ID
    ? { coilTier: optionKey }
    : { machineConfigTiers: { ...(node.machineConfigTiers ?? {}), [controlId]: optionKey } };
}

/** The next (or previous) option, wrapping, as a chip's click and wheel step. */
export function steppedOption(control: SettingControl, direction: -1 | 1): SettingOption | undefined {
  if (control.options.length <= 1) return undefined;
  const index = Math.max(0, control.options.findIndex((option) => option.key === control.currentKey));
  return control.options[(index + direction + control.options.length) % control.options.length];
}
