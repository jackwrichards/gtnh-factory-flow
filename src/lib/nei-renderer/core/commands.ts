import type { ResourceKind } from "@/lib/model/types";
import type { NeiPositionedStack } from "./positioned-stack";

export type NeiDrawLayer =
  | "chrome"
  | "background"
  | "decoration"
  | "slot"
  | "item"
  | "fluid"
  | "aspect"
  | "progress"
  | "text"
  | "stats"
  | "overlay"
  | "debug";

export type NeiSemanticTag =
  | "header"
  | "page-bar"
  | "empty-slot"
  | "input-slot"
  | "output-slot"
  | "catalyst-slot"
  | "aspect-slot"
  | "essentia-output"
  | "duration"
  | "eut"
  | "chance"
  | "progress-arrow"
  | "machine-info"
  | "thaumcraft-info"
  | "debug-bound"
  | string;

interface BaseCommand {
  type: string;
  layer: NeiDrawLayer;
  x: number;
  y: number;
  id?: string;
  debugLabel?: string;
  semanticTags?: NeiSemanticTag[];
}

export interface NeiTextureCommand extends BaseCommand {
  type: "texture";
  width: number;
  height: number;
  imagePath: string;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  textureWidth?: number;
  textureHeight?: number;
  opacity?: number;
}

export interface NeiSlotCommand extends BaseCommand {
  type: "slot";
  layer: "slot";
  width: number;
  height: number;
  kind: ResourceKind | "special";
  side: "input" | "output" | "catalyst" | "info";
  slotIndex: number;
  framed?: boolean;
  empty?: boolean;
  texturePath?: string;
}

export interface NeiItemCommand extends BaseCommand {
  type: "item";
  layer: "item";
  width: number;
  height: number;
  stack: NeiPositionedStack;
}

export interface NeiFluidCommand extends BaseCommand {
  type: "fluid";
  layer: "fluid";
  width: number;
  height: number;
  stack: NeiPositionedStack;
}

export interface NeiAspectCommand extends BaseCommand {
  type: "aspect";
  layer: "aspect";
  width: number;
  height: number;
  stack: NeiPositionedStack;
}

export interface NeiTextCommand extends BaseCommand {
  type: "text";
  layer: "text" | "stats" | "debug";
  text: string;
  width?: number;
  height?: number;
  color?: string;
  fontSize?: number;
  align?: "left" | "center" | "right";
  tooltip?: string | string[];
}

export interface NeiProgressCommand extends BaseCommand {
  type: "progress";
  layer: "progress";
  width: number;
  height: number;
  direction: "right" | "up" | "circular";
  texture?: string;
  frame?: number;
  progress?: number;
}

export interface NeiRectCommand extends BaseCommand {
  type: "rect";
  width: number;
  height: number;
  color: string;
  borderColor?: string;
  opacity?: number;
}

export type NeiDrawCommand =
  | NeiTextureCommand
  | NeiSlotCommand
  | NeiItemCommand
  | NeiFluidCommand
  | NeiAspectCommand
  | NeiTextCommand
  | NeiProgressCommand
  | NeiRectCommand;
