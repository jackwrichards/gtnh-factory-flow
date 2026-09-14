import type { FactoryEdge, ResourceKey } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model";
import { parseResourceHandleId } from "./resource-handles";

type InputEdge = Pick<FactoryEdge, "resourceKind" | "resourceId" | "targetHandle" | "crossForm">;

/** The wire's rates use its source form; the receiving slot uses its own. */
function crossFormInput(edge: InputEdge) {
  const ratio = edge.crossForm?.litresPerCell;
  if (!ratio || ratio <= 0 || !Number.isFinite(ratio)) return undefined;
  const target = parseResourceHandleId(edge.targetHandle);
  if (target?.side !== "input") return undefined;
  if (edge.resourceKind === "fluid" && target.kind === "item") {
    return { key: makeResourceKey(target.kind, target.resourceId), scale: 1 / ratio };
  }
  if (edge.resourceKind === "item" && target.kind === "fluid") {
    return { key: makeResourceKey(target.kind, target.resourceId), scale: ratio };
  }
  return undefined;
}

export function inputEdgeResourceKey(edge: InputEdge): ResourceKey {
  return crossFormInput(edge)?.key ?? makeResourceKey(edge.resourceKind, edge.resourceId);
}

export function inputEdgeRate(edge: InputEdge, sourceRate: number): number {
  return sourceRate * (crossFormInput(edge)?.scale ?? 1);
}
