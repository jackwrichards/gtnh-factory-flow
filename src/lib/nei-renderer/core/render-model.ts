import type { Recipe, ResourceAmount } from "@/lib/model/types";

export type NeiRecipeKind =
  | "gregtech_machine"
  | "bee_produce"
  | "crop_produce"
  | "essentia_smelting"
  | "custom"
  | "unknown";

export type NeiRenderResourceAmount = ResourceAmount;

export interface NeiRenderAspectAmount {
  aspectId: string;
  name: string;
  amount: number;
  iconPath?: string;
  color?: string;
  tooltip?: string[];
  sourceResource?: ResourceAmount;
}

export interface NeiRecipeRenderModel {
  id: string;
  kind: NeiRecipeKind | string;
  recipeMapId?: string;
  recipeMapName?: string;
  title?: string;

  inputs: NeiRenderResourceAmount[];
  outputs: NeiRenderResourceAmount[];
  catalysts?: NeiRenderResourceAmount[];

  fluidInputs?: NeiRenderResourceAmount[];
  fluidOutputs?: NeiRenderResourceAmount[];

  aspectInputs?: NeiRenderAspectAmount[];
  aspectOutputs?: NeiRenderAspectAmount[];

  durationTicks?: number;
  eut?: number;
  chance?: number;
  specialValue?: number;

  programmedCircuit?: NeiRenderResourceAmount | null;

  metadata?: Record<string, unknown>;
  sourceRecipe?: Recipe;
}

export interface NeiSize {
  width: number;
  height: number;
}

export interface NeiPoint {
  x: number;
  y: number;
}
