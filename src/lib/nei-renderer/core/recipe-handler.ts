import type { NeiDrawCommand } from "./commands";
import type { NeiPositionedStack } from "./positioned-stack";
import type { NeiRecipeRenderModel, NeiSize } from "./render-model";
import type { NeiRenderOptions } from "./render-options";

export interface NeiRenderContext {
  options: NeiRenderOptions;
}

export interface NeiRecipeHandler<TRecipe = NeiRecipeRenderModel> {
  id: string;
  label: string;

  canHandle(recipe: TRecipe): boolean;

  getDimensions(recipe: TRecipe, ctx: NeiRenderContext): NeiSize;

  drawBackground(recipe: TRecipe, ctx: NeiRenderContext): NeiDrawCommand[];

  getInputs(recipe: TRecipe, ctx: NeiRenderContext): NeiPositionedStack[];

  getOutputs(recipe: TRecipe, ctx: NeiRenderContext): NeiPositionedStack[];

  getCatalysts?(recipe: TRecipe, ctx: NeiRenderContext): NeiPositionedStack[];

  drawForeground(recipe: TRecipe, ctx: NeiRenderContext): NeiDrawCommand[];
}
