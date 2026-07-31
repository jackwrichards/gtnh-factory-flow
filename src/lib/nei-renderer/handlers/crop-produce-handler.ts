import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiSize } from "../core/render-model";
import { NEI_DEFAULT_HANDLER_HEIGHT, NEI_DEFAULT_HANDLER_WIDTH } from "../theme/constants";
import {
  basePanel,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

const CROP_POSITION = { x: 22, y: 28 };
const OUTPUT_POSITIONS = gridPositions(4, 116, 20, 2, 8);

const SCENE = { x: 16, width: 148, grassY: 44, dirtY: 53, dirtHeight: 13 };

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): NeiDrawCommand {
  return { type: "rect", layer: "decoration", x, y, width, height, color };
}

/** A little pixel plant standing on the grass line: stem, leaves, bright tip. */
function plant(x: number, height: number, stem: string, leaf: string, tip: string) {
  const top = SCENE.grassY - height;
  return [
    rect(x, top + 2, 2, height - 2, stem),
    rect(x - 3, top + 4, 3, 2, leaf),
    rect(x + 2, top + 7, 3, 2, leaf),
    ...(height > 10 ? [rect(x - 3, top + 10, 3, 2, leaf)] : []),
    rect(x - 1, top, 4, 2, tip),
  ];
}

function farmScene(): NeiDrawCommand[] {
  const { x, width, grassY, dirtY, dirtHeight } = SCENE;
  return [
    // Grass block seen from the side: sunlit lip, turf, shaded underside.
    rect(x, grassY, width, 2, "#86c45c"),
    rect(x, grassY + 2, width, 5, "#5a963e"),
    rect(x, grassY + 7, width, 2, "#47792f"),
    // Tilled dirt with darker furrows and a few lighter crumbs.
    rect(x, dirtY, width, dirtHeight, "#6b4a30"),
    rect(x + 10, dirtY + 3, 3, 2, "#57391f"),
    rect(x + 34, dirtY + 8, 3, 2, "#57391f"),
    rect(x + 61, dirtY + 4, 3, 2, "#57391f"),
    rect(x + 90, dirtY + 9, 3, 2, "#57391f"),
    rect(x + 118, dirtY + 3, 3, 2, "#57391f"),
    rect(x + 140, dirtY + 7, 3, 2, "#57391f"),
    rect(x + 22, dirtY + 6, 2, 2, "#7d5a3c"),
    rect(x + 50, dirtY + 2, 2, 2, "#7d5a3c"),
    rect(x + 76, dirtY + 7, 2, 2, "#7d5a3c"),
    rect(x + 104, dirtY + 5, 2, 2, "#7d5a3c"),
    rect(x + 130, dirtY + 9, 2, 2, "#7d5a3c"),
    rect(x, dirtY + dirtHeight, width, 2, "#4a3120"),
    // A little crop row growing between the seed slot and the drop slots.
    ...plant(52, 10, "#3e8527", "#62c84e", "#8ce06f"),
    ...plant(70, 14, "#3e8527", "#62c84e", "#8ce06f"),
    ...plant(88, 8, "#b8962e", "#d4b03e", "#e8cf6a"),
    ...plant(104, 12, "#3e8527", "#62c84e", "#8ce06f"),
    // Berry accents so the strip reads alive rather than flat.
    rect(60, grassY - 2, 2, 2, "#e05c5c"),
    rect(97, grassY - 3, 2, 2, "#e05c5c"),
    // Crop sticks flanking the planted seed slot.
    rect(25, 18, 2, 10, "#9c7444"),
    rect(35, 18, 2, 10, "#9c7444"),
    rect(25, 18, 2, 2, "#b48c56"),
    rect(35, 18, 2, 2, "#b48c56"),
    // Harvest crate framing the four drop slots.
    rect(112, 10, 52, 58, "#5f4426"),
    rect(114, 12, 48, 54, "#8a6b43"),
    rect(114, 40, 48, 4, "#77552f"),
  ];
}

function sceneLabels(): NeiDrawCommand[] {
  return [
    {
      type: "text",
      layer: "text",
      x: 16,
      y: 56,
      width: 30,
      text: "Seed",
      fontSize: 6,
      align: "center",
      color: "#f3e6c4",
    },
    {
      type: "text",
      layer: "text",
      x: 114,
      y: 13,
      width: 48,
      text: "Drops",
      fontSize: 6,
      align: "center",
      color: "#f3e6c4",
    },
  ];
}

export const CropProduceHandler: NeiRecipeHandler = {
  id: "crop-produce",
  label: "Crop Produce",

  canHandle(recipe) {
    return recipe.kind === "crop_produce";
  },

  getDimensions(): NeiSize {
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: NEI_DEFAULT_HANDLER_HEIGHT };
  },

  drawBackground(recipe): NeiDrawCommand[] {
    return [
      basePanel(NEI_DEFAULT_HANDLER_WIDTH, NEI_DEFAULT_HANDLER_HEIGHT),
      ...farmScene(),
      ...sceneLabels(),
      slotCommand({ ...CROP_POSITION, side: "input", kind: "item", slotIndex: 0 }),
      ...OUTPUT_POSITIONS.map((position, index) =>
        slotCommand({
          ...position,
          side: "output",
          kind: "item",
          slotIndex: index,
          empty: index >= recipe.outputs.length,
        }),
      ),
    ];
  },

  getInputs(recipe): NeiPositionedStack[] {
    const crop = recipe.inputs[0];
    return crop
      ? [
          resourceToPositionedStack({
            resource: crop,
            side: "input",
            x: CROP_POSITION.x,
            y: CROP_POSITION.y,
            slotIndex: 0,
            resourceIndex: 0,
          }),
        ]
      : [];
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return recipe.outputs.slice(0, OUTPUT_POSITIONS.length).map((resource, index) =>
      resourceToPositionedStack({
        resource,
        side: "output",
        x: OUTPUT_POSITIONS[index].x,
        y: OUTPUT_POSITIONS[index].y,
        slotIndex: index,
        resourceIndex: index,
      }),
    );
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const soil = recipe.metadata?.soil;
    return typeof soil === "string"
      ? [{ type: "text", layer: "text", x: 8, y: 72, text: soil, fontSize: 8, color: "#1f2c18" }]
      : [];
  },
};
