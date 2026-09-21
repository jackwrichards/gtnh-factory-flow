import type { PoolResourceRule } from "@/lib/model/types";

/** State and effect of the compact Balance button, in the current material scope. */
export function materialRuleHelp(rule: PoolResourceRule | undefined, inGroup: boolean): string {
  if (!rule) return inGroup
    ? "Balance on. Turn off to share with the parent group."
    : "Balance on. Turn off to allow outside supply and surplus.";
  return inGroup && rule === "share"
    ? "Balance off: the parent group handles supply and surplus."
    : "Balance off: outside supply and surplus are allowed.";
}
