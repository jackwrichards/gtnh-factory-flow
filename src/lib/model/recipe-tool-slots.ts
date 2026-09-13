import type { Recipe } from "./types";
import type { MachineConfigTierControl } from "./recipe-rules";

export function isTreeGrowthSimulatorToolControl(control: MachineConfigTierControl) {
  return (
    /^tgsToolSlot\d+$/.test(control.id) ||
    (control.id.startsWith("tgs") && control.id.endsWith("Tool"))
  );
}

const TREE_GROWTH_SIMULATOR_TOOL_SLOTS: Record<string, { x: number; y: number }> = {
  tgsToolSlot1: { x: 36, y: 36 },
  tgsToolSlot2: { x: 54, y: 36 },
  tgsToolSlot3: { x: 36, y: 54 },
  tgsToolSlot4: { x: 54, y: 54 },
  tgsLogTool: { x: 36, y: 36 },
  tgsSaplingTool: { x: 54, y: 36 },
  tgsLeavesTool: { x: 36, y: 54 },
  tgsFruitTool: { x: 54, y: 54 },
};

export function applyTreeGrowthSimulatorToolInputs(
  recipe: Recipe,
  controls: MachineConfigTierControl[],
): Recipe {
  if (controls.length === 0) {
    return recipe;
  }

  const inputs = recipe.inputs.map((input) => {
    const matchingControl = controls.find((control) => {
      const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
      return position?.x === input.neiSlot?.x && position.y === input.neiSlot?.y;
    });

    if (!matchingControl) {
      return input;
    }
    const resource = getTreeGrowthSimulatorSlotResource(matchingControl);

    return {
      ...input,
      ...resource,
      amount: 1,
      optional: true,
      consumed: false,
      neiSlot: input.neiSlot,
    };
  });

  return { ...recipe, inputs };
}

export function isTreeGrowthSimulatorEmptyTool(control: MachineConfigTierControl) {
  return (
    control.current.key === "none" ||
    getTreeGrowthSimulatorToolCategory(control.current.key) !==
      getTreeGrowthSimulatorSlotCategory(control.id)
  );
}

export function getTreeGrowthSimulatorSlotResource(control: MachineConfigTierControl) {
  if (!isTreeGrowthSimulatorEmptyTool(control)) {
    return control.resource;
  }

  return control.tiers.find((tier) => tier.key === "none")?.resource ?? control.resource;
}

export function getTreeGrowthSimulatorToolCategory(key: string): string | undefined {
  const [category] = key.split(":");
  return category && category !== "none" ? category : undefined;
}

export function getTreeGrowthSimulatorSlotCategory(controlId: string): string | undefined {
  switch (controlId) {
    case "tgsToolSlot1":
    case "tgsLogTool":
      return "log";
    case "tgsToolSlot2":
    case "tgsSaplingTool":
      return "sapling";
    case "tgsToolSlot3":
    case "tgsLeavesTool":
      return "leaves";
    case "tgsToolSlot4":
    case "tgsFruitTool":
      return "fruit";
    default:
      return undefined;
  }
}

export function getTreeGrowthSimulatorSlotTiers(control: MachineConfigTierControl) {
  const category = getTreeGrowthSimulatorSlotCategory(control.id);
  if (!category) {
    return control.tiers;
  }

  return control.tiers.filter(
    (tier) => tier.key === "none" || getTreeGrowthSimulatorToolCategory(tier.key) === category,
  );
}
