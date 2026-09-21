import type { PoolResourceRule } from "@/lib/model/types";

/** Keep hover help brief; the Material rules guide carries the example. */
export function materialRuleHelp(rule: PoolResourceRule | undefined, inGroup: boolean): string {
  if (!rule) return "Match: balance made and used.";
  return inGroup && rule === "share" ? "Ignore: share with parent." : "Ignore: allow supply and surplus.";
}
