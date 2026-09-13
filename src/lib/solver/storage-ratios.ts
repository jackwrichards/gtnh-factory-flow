import type { FactoryProject } from "@/lib/model/types";
import { getProjectRatioBranches, ratioExportShare } from "@/lib/model/storage-ratios";
import type { LinearProgram } from "./simplex";

/** Fixed shares of the drawer's total outflow. Missing/disabled destinations
 * count as zero capacity, so they hold the split instead of donating it. */
export function storageRatioEqualities(
  project: FactoryProject,
  flowVars: Map<string, number>,
): LinearProgram["equalities"] {
  const rows: LinearProgram["equalities"] = [];
  const outputs = getProjectRatioBranches(project);
  const inputs = getProjectRatioBranches(project, "input");
  for (const branches of [...outputs.values(), ...inputs.values()]) {
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
  // Export is the only permitted fill: outflow = inflow × (1 - export).
  // This also allows 100% export with all connected output flows shut.
  for (const storage of project.storages ?? []) {
    const exported = ratioExportShare(storage);
    const outgoing = outputs.get(storage.id);
    if (!exported || !outgoing) continue;
    const coefficients = new Map<number, number>();
    for (const branch of outgoing)
      for (const edge of branch.edges) {
        const v = flowVars.get(edge.id);
        if (v !== undefined) coefficients.set(v, (coefficients.get(v) ?? 0) + 1);
      }
    for (const branch of inputs.get(storage.id) ?? [])
      for (const edge of branch.edges) {
        const v = flowVars.get(edge.id);
        if (v !== undefined) coefficients.set(v, (coefficients.get(v) ?? 0) - (1 - exported));
      }
    if (coefficients.size) rows.push({ coefficients, rhs: 0 });
  }
  return rows;
}
