import type { FactoryProject } from "@/lib/model/types";
import { getProjectRatioBranches } from "@/lib/model/storage-ratios";
import type { LinearProgram } from "./simplex";

/** Fixed shares of the drawer's total outflow. Missing/disabled destinations
 * count as zero capacity, so they hold the split instead of donating it. */
export function storageRatioEqualities(
  project: FactoryProject,
  flowVars: Map<string, number>,
): LinearProgram["equalities"] {
  const rows: LinearProgram["equalities"] = [];
  for (const branches of getProjectRatioBranches(project).values()) {
    const reference = branches.reduce(
      (best, branch) => (branch.share > best.share ? branch : best),
      branches[0],
    );
    if (!reference) continue;
    for (const branch of branches) {
      if (branch === reference && branch.share > 0) continue;
      const coefficients = new Map<number, number>();
      for (const edge of branch.edges) {
        const v = flowVars.get(edge.id);
        if (v !== undefined) coefficients.set(v, 1);
      }
      if (reference.share > 0) {
        for (const edge of reference.edges) {
          const v = flowVars.get(edge.id);
          if (v !== undefined)
            coefficients.set(v, (coefficients.get(v) ?? 0) - branch.share / reference.share);
        }
      }
      if (coefficients.size) rows.push({ coefficients, rhs: 0 });
    }
  }
  return rows;
}
