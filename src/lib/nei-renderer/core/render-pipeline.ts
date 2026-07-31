import type { NeiDrawCommand } from "./commands";
import type { NeiPositionedStack } from "./positioned-stack";
import type { NeiRecipeHandler } from "./recipe-handler";
import type { NeiRecipeRenderModel } from "./render-model";
import { resolveNeiRenderOptions, type NeiRenderOptions } from "./render-options";

export interface NeiSemanticRegion {
  id: string;
  semanticTags: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NeiRenderResult {
  commands: NeiDrawCommand[];
  positionedStacks: NeiPositionedStack[];
  width: number;
  height: number;
  handlerId: string;
  semanticRegions: NeiSemanticRegion[];
  options: NeiRenderOptions;
}

export function renderNeiRecipe(
  recipe: NeiRecipeRenderModel,
  handler: NeiRecipeHandler,
  partialOptions: Partial<NeiRenderOptions> = {},
): NeiRenderResult {
  const options = resolveNeiRenderOptions(partialOptions);
  const ctx = { options };
  const dimensions = handler.getDimensions(recipe, ctx);
  const inputs = handler.getInputs(recipe, ctx);
  const outputs = handler.getOutputs(recipe, ctx);
  const catalysts = handler.getCatalysts?.(recipe, ctx) ?? [];
  const positionedStacks = [...inputs, ...outputs, ...catalysts];
  const commands = applyPresetTransforms(
    [
      ...handler.drawBackground(recipe, ctx),
      ...positionedStacks.map(stackToCommand),
      ...handler.drawForeground(recipe, ctx),
    ],
    positionedStacks,
    dimensions,
    options,
  );

  return {
    commands,
    positionedStacks,
    width: dimensions.width,
    height: dimensions.height,
    handlerId: handler.id,
    semanticRegions: buildSemanticRegions(commands),
    options,
  };
}

function stackToCommand(stack: NeiPositionedStack): NeiDrawCommand {
  const width = stack.width ?? 18;
  const height = stack.height ?? 18;
  const semanticTags = [
    `${stack.side}-slot`,
    stack.kind === "aspect" ? "aspect-slot" : undefined,
    stack.kind === "aspect" && stack.side === "output" ? "essentia-output" : undefined,
    stack.chance !== undefined ? "chance" : undefined,
    ...(stack.semanticTags ?? []),
  ].filter((tag): tag is string => Boolean(tag));

  if (stack.kind === "fluid") {
    return {
      type: "fluid",
      layer: "fluid",
      x: stack.x,
      y: stack.y,
      width,
      height,
      stack,
      semanticTags,
    };
  }

  if (stack.kind === "aspect") {
    return {
      type: "aspect",
      layer: "aspect",
      x: stack.x,
      y: stack.y,
      width,
      height,
      stack,
      semanticTags,
    };
  }

  return {
    type: "item",
    layer: "item",
    x: stack.x,
    y: stack.y,
    width,
    height,
    stack,
    semanticTags,
  };
}

function applyPresetTransforms(
  commands: NeiDrawCommand[],
  stacks: NeiPositionedStack[],
  dimensions: { width: number; height: number },
  options: NeiRenderOptions,
): NeiDrawCommand[] {
  const filtered = commands.filter((command) => {
    const tags = command.semanticTags ?? [];
    if (!options.showChrome && command.layer === "chrome") return false;
    if (!options.showHeader && tags.includes("header")) return false;
    if (!options.showPageBar && tags.includes("page-bar")) return false;
    if (!options.showEmptySlots && tags.includes("empty-slot")) return false;
    if (!options.showStats && command.layer === "stats") return false;
    return true;
  });

  if (!options.showDebugBounds) {
    return filtered;
  }

  return [
    ...filtered,
    {
      type: "rect",
      layer: "debug",
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
      color: "transparent",
      borderColor: "rgba(34, 211, 238, 0.8)",
      semanticTags: ["debug-bound"],
      debugLabel: "recipe",
    },
    ...stacks.map(
      (stack, index): NeiDrawCommand => ({
        type: "text",
        layer: "debug",
        x: stack.x,
        y: stack.y - 8,
        text: `${index}:${stack.side}:${stack.kind}`,
        color: "#00ffff",
        fontSize: 7,
        semanticTags: ["debug-bound"],
      }),
    ),
  ];
}

function buildSemanticRegions(commands: NeiDrawCommand[]): NeiSemanticRegion[] {
  return commands.filter(hasSizedSemanticRegion).map((command, index) => ({
    id: command.id ?? `${command.type}-${index}`,
    semanticTags: command.semanticTags ?? [],
    x: command.x,
    y: command.y,
    width: command.width,
    height: command.height,
  }));
}

function hasSizedSemanticRegion(
  command: NeiDrawCommand,
): command is NeiDrawCommand & { width: number; height: number } {
  return (
    "width" in command &&
    "height" in command &&
    typeof command.width === "number" &&
    typeof command.height === "number" &&
    Boolean(command.semanticTags?.length)
  );
}
