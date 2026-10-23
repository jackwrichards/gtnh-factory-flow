/**
 * A card's machine count rule (docs/up-to.md): Any (the plan picks), Up to N (what you have) or Exactly N. Stored as
 * `solvePin` (the count) and `solvePinExact` (Exactly); every reader and writer goes through here so the card, the
 * overview and the solver adapter agree.
 *
 * As a drawer's rate: no count is Any, a count typed in is Up to, and Exactly is picked from the rule menu. A cleared
 * count is Any again, and the next count typed is Up to.
 */
import { isCustomRateRecipe } from "./custom-rate";
import type { FactoryNode, Recipe } from "./types";

export type PinRule = "any" | "upTo" | "exact";

/** The words the board shows for each rule. */
export const PIN_RULE_LABEL: Record<PinRule, string> = {
  any: "Any",
  upTo: "Up to",
  exact: "Exactly",
};

/** The order a click on the rule word steps through. */
export const PIN_RULE_ORDER: readonly PinRule[] = ["any", "upTo", "exact"];

type Pinned = Pick<FactoryNode, "solvePin" | "solvePinExact">;

/**
 * The rule: Any whenever no count is set (the plan picks), else Up to or Exactly. A custom rate card's set count is
 * always Exactly (its dial).
 */
export function pinRuleOf(node: Pinned, recipe?: Pick<Recipe, "machineType">): PinRule {
  if (!((node.solvePin ?? 0) > 0)) return "any";
  if (isCustomRateRecipe(recipe)) return "exact";
  return node.solvePinExact === true ? "exact" : "upTo";
}

/** The next rule after `rule` in `PIN_RULE_ORDER`. */
export function nextPinRule(rule: PinRule): PinRule {
  return PIN_RULE_ORDER[(PIN_RULE_ORDER.indexOf(rule) + 1) % PIN_RULE_ORDER.length]!;
}

/**
 * The node with `rule` and `count` set: Any clears the count; Up to sets the count; Exactly sets the count and the
 * flag. A count that is not a positive number clears it (Any). Fields not involved are kept as they are; an older
 * plan's `solvePinAny` is dropped.
 */
export function withPinRule<N extends Pinned>(
  node: N,
  rule: PinRule,
  count: number | undefined,
): N {
  const { solvePin: _pin, solvePinExact: _exact, solvePinAny: _any, ...rest } = node as N & {
    solvePinAny?: unknown;
  };
  if (rule === "any" || !(count !== undefined && Number.isFinite(count) && count > 0)) return rest as N;
  return (
    rule === "exact"
      ? { ...rest, solvePin: count, solvePinExact: true }
      : { ...rest, solvePin: count }
  ) as N;
}
