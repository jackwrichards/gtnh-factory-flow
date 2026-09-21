import type { PoolResourceRule } from "@/lib/model/types";

/** Keep hover help brief; the Material rules guide carries the example. */
export function materialRuleHelp(rule: PoolResourceRule | undefined, inGroup: boolean): string {
  if (!rule) return "Match made and used amounts.";
  return inGroup && rule === "share" ? "Share with the parent group." : "Allow outside supply and surplus.";
}
