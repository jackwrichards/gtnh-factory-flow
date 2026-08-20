import { GT_VOLTAGE_TIERS } from "./tiers";
import type { MachineTier, ResourceAmount } from "./types";

/**
 * The board's one resource per power grid: `energy:ulv` … `energy:max`, the
 * lowercased names of the 15 tiers of the voltage table. A machine's grid is
 * decided by its power report (the voltage it actually runs at), and a
 * generator's output grid is decided by the normalizer from the machine's own
 * `maxEuT` — an in-game LV solar unit outputs 1 EU/t and feeds `energy:ulv`.
 *
 * Strict kind, like items and fluids: energy never satisfies a fluid or item
 * slot and they never satisfy energy, and `resourceMatchesInput` already says
 * so by comparing kinds first. No alternatives, no oredict, no cell
 * equivalents.
 */
export function energyResourceForTier(tier: MachineTier): ResourceAmount {
  return {
    kind: "energy",
    id: tier.toLowerCase(),
    amount: 1,
    displayName: `Energy (${tier})`,
  };
}

/**
 * The tier a grid id names. The lookup is on the LOWERCASED tier name, never
 * `toUpperCase()` on the input: "LuV" lowercases to "luv", so matching the
 * input against `tier.toLowerCase()` is the only form that keeps every one of
 * the 15 ids distinct.
 */
export function energyTierForId(id: string): MachineTier | undefined {
  return GT_VOLTAGE_TIERS.find((entry) => entry.tier.toLowerCase() === id)?.tier;
}
