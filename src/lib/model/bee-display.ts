import type { Recipe } from "./types";

const BEE_FRAME_SLOTS: Record<string, { x: number; y: number }> = {
  beeFrameSlot1: { x: 66, y: 23 },
  beeFrameSlot2: { x: 66, y: 52 },
  beeFrameSlot3: { x: 66, y: 81 },
};

export function stripBeeFrameSlotInputs(recipe: Recipe): Recipe {
  const inputs = recipe.inputs.filter((input) => !isBeeFrameSlotInput(input));
  const neiSlots = recipe.nei?.slots?.filter((slot) => !isBeeFrameSlotPosition(slot));
  const recipeChanged = inputs.length !== recipe.inputs.length;
  const neiChanged = neiSlots?.length !== recipe.nei?.slots?.length;

  if (!recipeChanged && !neiChanged) {
    return recipe;
  }

  return {
    ...recipe,
    inputs,
    nei: recipe.nei
      ? {
          ...recipe.nei,
          slots: neiSlots,
        }
      : recipe.nei,
  };
}

function isBeeFrameSlotInput(input: Recipe["inputs"][number]) {
  return /^factoryflow:bee_frame_slot_\d+$/.test(input.id);
}

function isBeeFrameSlotPosition(slot: NonNullable<NonNullable<Recipe["nei"]>["slots"]>[number]) {
  return Object.values(BEE_FRAME_SLOTS).some(
    (position) => position.x === slot.x && position.y === slot.y,
  );
}

