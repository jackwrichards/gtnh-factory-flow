import type { FactoryProject, NodeThroughputResult, ResourceKind } from "@/lib/model/types";
import { inputEdgeResourceKey } from "./input-edge";
import { makeResourceKey } from "@/lib/model";
import type { ResolvedSetupRules } from "@/lib/model/setup-rules";

type ProjectEdge = FactoryProject["edges"][number];

const RATE_EPSILON = 1e-6;

export interface BareSlot {
  resourceKey: string;
  kind: ResourceKind;
  displayName: string;
}

export interface BareSlots {
  inputs: BareSlot[];
  outputs: BareSlot[];
}

/**
 * Every slot on a card with no wire on it, both ends, under the board's
 * rules: a side the rules answer (free inputs, free outputs) has nothing bare
 * to report, because the solve already fed or drained it. Shared by the
 * verdict (which marks them) and the death-spiral detector (which must not
 * call a ring dead when one of its members is simply not wired up yet).
 */
export function findBareSlots(
  nodeResult: NodeThroughputResult,
  incoming: ProjectEdge[],
  outgoing: ProjectEdge[],
  rules: ResolvedSetupRules,
): BareSlots | undefined {
  const describe = (
    flow: { kind: ResourceKind; resourceId: string; displayName?: string },
    key: string,
  ): BareSlot => ({ resourceKey: key, kind: flow.kind, displayName: flow.displayName ?? flow.resourceId });

  const wiredOn = (edges: ProjectEdge[], key: string) =>
    edges.some((edge) => makeResourceKey(edge.resourceKind, edge.resourceId) === key);

  const inputs: BareSlot[] = [];
  if (!rules.freeInputs) {
    for (const [key, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond > RATE_EPSILON && !incoming.some((edge) => inputEdgeResourceKey(edge) === key)) {
        inputs.push(describe(flow, key));
      }
    }
  }

  const outputs: BareSlot[] = [];
  if (!rules.freeOutputs) {
    for (const [key, flow] of Object.entries(nodeResult.outputs)) {
      // An unwired EU port is not a bare slot: unbanked power dissipates in
      // game, so the closed-plan rule waives it (as the solver cores do).
      if (flow.kind === "power") {
        continue;
      }
      if (flow.amountPerSecond > RATE_EPSILON && !wiredOn(outgoing, key)) {
        outputs.push(describe(flow, key));
      }
    }
  }

  return inputs.length > 0 || outputs.length > 0 ? { inputs, outputs } : undefined;
}
