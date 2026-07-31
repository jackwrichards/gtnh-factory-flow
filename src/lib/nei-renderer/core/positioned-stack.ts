import type { NeiRenderAspectAmount, NeiRenderResourceAmount } from "./render-model";

export type NeiPositionedStackSide = "input" | "output" | "catalyst" | "info";
export type NeiPositionedStackKind = "item" | "fluid" | "aspect" | "special";

export interface NeiPositionedStack {
  resource: NeiRenderResourceAmount | NeiRenderAspectAmount;
  side: NeiPositionedStackSide;
  kind: NeiPositionedStackKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  slotIndex: number;
  resourceIndex?: number;
  chance?: number;
  consumed?: boolean;
  groupId?: string;
  semanticTags?: string[];
}
