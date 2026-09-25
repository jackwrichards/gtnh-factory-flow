import type { ResourceAmount } from "./types";

/**
 * Inputs the GAME hands out for nothing. GregTech's Rock Breaker lists a
 * placeholder item literally named "IT'S FREE! Place Lava on Side": the
 * recipe wants lava touching the machine, not a stack fed into it, so no
 * pipe, no drawer and no rate can ever be the honest answer for that slot.
 *
 * The board treats such a slot as never consumed - the solver never asks
 * for it, no wire lands on it, no bare-slot mark names it - but the card
 * still DRAWS it, greyed, so the player knows to set the lava down.
 */
export const FREE_INPUT_ITEM_IDS: ReadonlySet<string> = new Set([
  "gregtech:gt.metaitem.02@32765",
]);

/**
 * Items a machine holds in its CONTROLLER slot for good: the Extreme Entity
 * Crusher's Powered Spawner, one resource per mob. Treated exactly like a
 * free input (never supplied, never wired), and drawn the same way, because
 * it is also the only thing on the card that says which mob the machine runs.
 */
const CONTROLLER_SLOT_ID_PREFIXES = ["factoryflow:eec_mob:"];

type InputRef = Pick<ResourceAmount, "id"> & { kind?: string };

export function isControllerSlotInput(resource: InputRef): boolean {
  return (
    (resource.kind === undefined || resource.kind === "item") &&
    CONTROLLER_SLOT_ID_PREFIXES.some((prefix) => resource.id.startsWith(prefix))
  );
}

export function isFreeRecipeInput(resource: InputRef): boolean {
  return (
    ((resource.kind === undefined || resource.kind === "item") && FREE_INPUT_ITEM_IDS.has(resource.id)) ||
    isControllerSlotInput(resource)
  );
}
