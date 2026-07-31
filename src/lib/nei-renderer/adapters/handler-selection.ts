import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiRecipeRenderModel } from "../core/render-model";
import { BeeProduceHandler } from "../handlers/bee-produce-handler";
import { CropProduceHandler } from "../handlers/crop-produce-handler";
import { EssentiaSmeltingHandler } from "../handlers/essentia-smelting-handler";
import { FallbackHandler } from "../handlers/fallback-handler";
import { GregTechMachineHandler } from "../handlers/gregtech-machine-handler";

export const defaultNeiRecipeHandlers: NeiRecipeHandler[] = [
  BeeProduceHandler,
  CropProduceHandler,
  EssentiaSmeltingHandler,
  GregTechMachineHandler,
  FallbackHandler,
];

export function selectNeiRecipeHandler(
  recipe: NeiRecipeRenderModel,
  handlers: NeiRecipeHandler[] = defaultNeiRecipeHandlers,
): NeiRecipeHandler {
  const handler = handlers.find((candidate) => candidate.canHandle(recipe));
  return handler ?? FallbackHandler;
}
