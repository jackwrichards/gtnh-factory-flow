import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRenderContext, NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiRecipeRenderModel, NeiSize } from "../core/render-model";
import { NEI_TEXT_COLORS } from "../theme/constants";
import { NEI_TEXTURES } from "../theme/textures";
import {
  aspectToPositionedStack,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

type EssentiaLayoutMode = "native" | "readable" | "compact";

interface EssentiaLayout {
  mode: EssentiaLayoutMode;
  dimensions: NeiSize;
  input: { x: number; y: number };
  arrow: { x: number; y: number; width: number; height: number };
  aspectSlots: Array<{ x: number; y: number }>;
  visibleAspectCount: number;
  overflowCount: number;
}

const NATIVE_ASPECT_SLOTS = gridPositions(6, 112, 18, 3, 2);
const COMPACT_ASPECT_SLOTS = gridPositions(4, 92, 14, 2, 2);

export const EssentiaSmeltingHandler: NeiRecipeHandler = {
  id: "essentia-smelting",
  label: "Essentia Smelting",

  canHandle(recipe) {
    return recipe.kind === "essentia_smelting";
  },

  getDimensions(recipe, ctx): NeiSize {
    return getEssentiaLayout(recipe, ctx).dimensions;
  },

  drawBackground(recipe, ctx): NeiDrawCommand[] {
    const layout = getEssentiaLayout(recipe, ctx);
    const aspectCount = recipe.aspectOutputs?.length ?? 0;

    return [
      {
        type: "texture",
        layer: "background",
        x: 0,
        y: 0,
        width: layout.dimensions.width,
        height: layout.dimensions.height,
        imagePath: NEI_TEXTURES.gregtechRecipeBackground,
        semanticTags: ["thaumcraft-info"],
      },
      {
        type: "progress",
        layer: "progress",
        x: layout.arrow.x,
        y: layout.arrow.y,
        width: layout.arrow.width,
        height: layout.arrow.height,
        direction: "right",
        texture: "arrow",
        semanticTags: ["progress-arrow", "thaumcraft-info"],
      },
      slotCommand({ ...layout.input, side: "input", kind: "item", slotIndex: 0 }),
      ...layout.aspectSlots.map((position, index) =>
        slotCommand({
          ...position,
          side: "output",
          kind: "aspect",
          slotIndex: index,
          empty: index >= aspectCount,
          framed: true,
        }),
      ),
    ];
  },

  getInputs(recipe, ctx): NeiPositionedStack[] {
    const input = recipe.inputs[0];
    if (!input) {
      return [];
    }

    const layout = getEssentiaLayout(recipe, ctx);
    return [
      resourceToPositionedStack({
        resource: input,
        side: "input",
        x: layout.input.x,
        y: layout.input.y,
        slotIndex: 0,
        resourceIndex: 0,
      }),
    ];
  },

  getOutputs(recipe, ctx): NeiPositionedStack[] {
    const layout = getEssentiaLayout(recipe, ctx);
    return (recipe.aspectOutputs ?? [])
      .slice(0, layout.visibleAspectCount)
      .map((aspect, index) =>
        aspectToPositionedStack({
          aspect,
          side: "output",
          x: layout.aspectSlots[index].x,
          y: layout.aspectSlots[index].y,
          slotIndex: index,
          semanticTags: ["essentia-output"],
        }),
      );
  },

  drawForeground(recipe, ctx): NeiDrawCommand[] {
    const layout = getEssentiaLayout(recipe, ctx);
    const aspects = recipe.aspectOutputs ?? [];

    if (layout.mode === "readable") {
      return aspects.map((aspect, index): NeiDrawCommand => {
        const position = layout.aspectSlots[index];
        return {
          type: "text",
          layer: "text",
          x: position.x + 24,
          y: position.y + 4,
          width: layout.dimensions.width - position.x - 32,
          text: `${aspect.name} x${aspect.amount}`,
          color: "#22122f",
          fontSize: 9,
          semanticTags: ["essentia-output", "thaumcraft-info"],
        };
      });
    }

    if (layout.overflowCount <= 0) {
      return [];
    }

    return [
      {
        type: "text",
        layer: "text",
        x: layout.mode === "compact" ? 122 : 148,
        y: layout.mode === "compact" ? 56 : 64,
        width: 32,
        text: `+${layout.overflowCount}`,
        color: NEI_TEXT_COLORS.thaumcraft,
        fontSize: 9,
        semanticTags: ["essentia-output", "thaumcraft-info"],
      },
    ];
  },
};

function getEssentiaLayout(recipe: NeiRecipeRenderModel, ctx: NeiRenderContext): EssentiaLayout {
  const mode = getEssentiaLayoutMode(ctx);
  const aspectCount = recipe.aspectOutputs?.length ?? 0;

  if (mode === "compact") {
    const visibleAspectCount = Math.min(aspectCount, COMPACT_ASPECT_SLOTS.length);
    return {
      mode,
      dimensions: { width: 150, height: 72 },
      input: { x: 12, y: 26 },
      arrow: { x: 58, y: 27, width: 20, height: 18 },
      aspectSlots: COMPACT_ASPECT_SLOTS,
      visibleAspectCount,
      overflowCount: Math.max(0, aspectCount - visibleAspectCount),
    };
  }

  if (mode === "readable") {
    const rowCount = Math.max(1, aspectCount);
    const aspectSlots = gridPositions(rowCount, 112, 18, 1, 2);
    return {
      mode,
      dimensions: { width: 244, height: Math.max(96, 36 + rowCount * 20) },
      input: { x: 24, y: 38 },
      arrow: { x: 72, y: 38, width: 20, height: 18 },
      aspectSlots,
      visibleAspectCount: aspectCount,
      overflowCount: 0,
    };
  }

  const visibleAspectCount = Math.min(aspectCount, NATIVE_ASPECT_SLOTS.length);
  return {
    mode,
    dimensions: { width: 176, height: 92 },
    input: { x: 24, y: 36 },
    arrow: { x: 76, y: 36, width: 20, height: 18 },
    aspectSlots: NATIVE_ASPECT_SLOTS,
    visibleAspectCount,
    overflowCount: Math.max(0, aspectCount - visibleAspectCount),
  };
}

function getEssentiaLayoutMode(ctx: NeiRenderContext): EssentiaLayoutMode {
  if (ctx.options.preset === "compact" || ctx.options.preset === "flow-node") {
    return "compact";
  }

  if (
    ctx.options.preset === "readable" ||
    ctx.options.aspectDisplay === "text" ||
    ctx.options.aspectDisplay === "badge"
  ) {
    return "readable";
  }

  return "native";
}
