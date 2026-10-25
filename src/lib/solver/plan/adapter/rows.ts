import { canonicalizeResourceHandleId } from "../../../model/edge-identity";
import {
  getChanceMultiplier,
  isRecipeInputConsumed,
  makeResourceKey,
  resourceMatchesInput,
} from "../../../model/resources";
import { splitSectionHandleId } from "../../../model/shared-machine";
import type {
  FactoryEdge,
  Recipe,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "../../../model/types";
import { makePortKey } from "../port-key";
import type { PortKey } from "../types";

/** One port row of a machine, as the engine sees it (`index` is its position). */
export interface PortRow {
  input: boolean;
  index: number;
  key: ResourceKey;
  kind: ResourceKind;
  resourceId: string;
  displayName?: string;
  /** Section-free canonical handle id, `output:item:foo`. */
  handle: string;
  portKey: PortKey;
  /** Units per craft the engine is told (chance and multiplier are 1). */
  amount: number;
  flow: ResourceFlow;
}

export function rowHandle(side: "input" | "output", kind: ResourceKind, resourceId: string): string {
  return `${side}:${kind}:${encodeURIComponent(resourceId)}`;
}

export function buildRows(
  nodeId: string,
  input: boolean,
  flows: Record<string, ResourceFlow>,
  amountOf: (flow: ResourceFlow) => number,
): PortRow[] {
  return Object.values(flows).map((flow, index) => {
    const handle = rowHandle(input ? "input" : "output", flow.kind, flow.resourceId);
    return {
      input,
      index,
      key: flow.key ?? makeResourceKey(flow.kind, flow.resourceId),
      kind: flow.kind,
      resourceId: flow.resourceId,
      displayName: flow.displayName,
      handle,
      portKey: makePortKey(nodeId, input ? "i" : "o", handle),
      amount: amountOf(flow),
      flow,
    };
  });
}

/**
 * The row of an input a wire lands on: the first row, in recipe order, that
 * the wire's resource satisfies (same kind and id, a damage-equal item, or an
 * ore dictionary alternative). The old solvers resolve it from the recipe
 * (`getEdgeTargetDemandKey`); the report's rows are built from the same slots
 * in the same order, so the first match is the same row.
 */
export function inputRowFor(rows: readonly PortRow[], edge: FactoryEdge): PortRow | undefined {
  const exact = rows.find(
    (row) => row.kind === edge.resourceKind && row.resourceId === edge.resourceId,
  );
  if (exact) {
    return exact;
  }
  const resource = { kind: edge.resourceKind, id: edge.resourceId };
  return rows.find((row) =>
    resourceMatchesInput(resource, {
      kind: row.kind,
      id: row.resourceId,
      displayName: row.displayName,
      alternatives: row.flow.alternatives,
    }),
  );
}

/** The row a wire leaves from: `getCompatibleOutputFlow`, as rows. */
export function outputRowFor(rows: readonly PortRow[], edge: FactoryEdge): PortRow | undefined {
  return inputRowFor(rows, edge);
}

/** `r2:output:item:foo:3` -> section 2 and the canonical `output:item:foo`. */
export function canonicalPortRateHandle(handleId: string): { section: number; handle: string } {
  const { section, handleId: bare } = splitSectionHandleId(handleId);
  return { section, handle: canonicalizeResourceHandleId(bare) ?? bare ?? handleId };
}

/**
 * Raw per-craft amounts of a recipe for a machine with no built count and no
 * per-craft amounts from the nameplate loop (tests that build the report by
 * hand): consumed inputs, outputs at their chance. Output multipliers of
 * machine effects are not applied here.
 */
export function rawPerCraft(recipe: Recipe | undefined): { inputs: Map<ResourceKey, number>; outputs: Map<ResourceKey, number> } {
  const inputs = new Map<ResourceKey, number>();
  const outputs = new Map<ResourceKey, number>();
  if (!recipe) {
    return { inputs, outputs };
  }
  for (const input of recipe.inputs) {
    if (isRecipeInputConsumed(input)) {
      const key = makeResourceKey(input.kind, input.id);
      inputs.set(key, (inputs.get(key) ?? 0) + input.amount);
    }
  }
  for (const output of recipe.outputs) {
    const key = makeResourceKey(output.kind, output.id);
    outputs.set(key, (outputs.get(key) ?? 0) + output.amount * getChanceMultiplier(recipe, output));
  }
  return { inputs, outputs };
}
