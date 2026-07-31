import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiSize } from "../core/render-model";
import { NEI_DEFAULT_HANDLER_HEIGHT, NEI_DEFAULT_HANDLER_WIDTH } from "../theme/constants";
import { NEI_PALETTE } from "../theme/palette";
import {
  basePanel,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

const BEE_POSITION = { x: 22, y: 28 };
const CATALYST_POSITION = { x: 52, y: 48 };
const OUTPUT_POSITIONS = gridPositions(6, 118, 12, 2, 8);

export const BeeProduceHandler: NeiRecipeHandler = {
  id: "bee-produce",
  label: "Bee Produce",

  canHandle(recipe) {
    return recipe.kind === "bee_produce";
  },

  getDimensions(): NeiSize {
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: NEI_DEFAULT_HANDLER_HEIGHT };
  },

  drawBackground(recipe): NeiDrawCommand[] {
    return [
      basePanel(NEI_DEFAULT_HANDLER_WIDTH, NEI_DEFAULT_HANDLER_HEIGHT),
      { type: "rect", layer: "decoration", x: 6, y: 6, width: 158, height: 70, color: "#d8d0a4" },
      {
        type: "rect",
        layer: "decoration",
        x: 78,
        y: 37,
        width: 30,
        height: 3,
        color: NEI_PALETTE.bee,
      },
      {
        type: "rect",
        layer: "decoration",
        x: 102,
        y: 32,
        width: 6,
        height: 13,
        color: NEI_PALETTE.bee,
      },
      slotCommand({ ...BEE_POSITION, side: "input", kind: "item", slotIndex: 0 }),
      slotCommand({
        ...CATALYST_POSITION,
        side: "catalyst",
        kind: "item",
        slotIndex: 0,
        empty: !recipe.catalysts?.length,
      }),
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
    const bee = recipe.inputs[0];
    return bee
      ? [
          resourceToPositionedStack({
            resource: bee,
            side: "input",
            x: BEE_POSITION.x,
            y: BEE_POSITION.y,
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

  getCatalysts(recipe): NeiPositionedStack[] {
    const catalyst = recipe.catalysts?.[0];
    return catalyst
      ? [
          resourceToPositionedStack({
            resource: catalyst,
            side: "catalyst",
            x: CATALYST_POSITION.x,
            y: CATALYST_POSITION.y,
            slotIndex: 0,
            resourceIndex: 1,
          }),
        ]
      : [];
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const condition = recipe.metadata?.condition;
    return typeof condition === "string"
      ? [
          {
            type: "text",
            layer: "text",
            x: 8,
            y: 72,
            text: condition,
            fontSize: 8,
            color: "#262018",
          },
        ]
      : [];
  },
};
