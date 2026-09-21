import type { PoolResourceRule } from "@/lib/model/types";

/** State and effect of the compact Skip button, in the current material scope. */
export function materialRuleHelp(rule: PoolResourceRule | undefined, inGroup: boolean): string {
  if (!rule) return inGroup
    ? "Skip is off. Turn on to share this material with the parent group."
    : "Skip is off. Turn on to allow outside supply and surplus.";
  return inGroup && rule === "share"
    ? "Skip is on: the parent group handles supply and surplus."
    : "Skip is on: outside supply and surplus are allowed.";
}
