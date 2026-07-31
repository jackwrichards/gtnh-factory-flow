import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiSize } from "../core/render-model";
import {
  frameToPositionedStack,
  frameToSlotCommand,
  gregtechLayout,
  panelBackground,
  progressCommandsFromLayout,
} from "./command-helpers";

export const GregTechMachineHandler: NeiRecipeHandler = {
  id: "gregtech-machine",
  label: "GregTech Machine",

  canHandle(recipe) {
    return recipe.kind === "gregtech_machine";
  },

  getDimensions(recipe): NeiSize {
    return gregtechLayout(recipe).canvas;
  },

  drawBackground(recipe): NeiDrawCommand[] {
    const layout = gregtechLayout(recipe);
    const commands: NeiDrawCommand[] = [];

    if (layout.chrome === "gregtech") {
      commands.push(
        ...panelBackground(layout.canvas.width, layout.canvas.height, ["machine-info"]),
      );
    }

    commands.push(
      ...layout.decorations.map((decoration, index): NeiDrawCommand => {
        if (decoration.kind === "texture") {
          return {
            type: "texture",
            layer: "decoration",
            x: decoration.x,
            y: decoration.y,
            width: decoration.width,
            height: decoration.height,
            imagePath: decoration.imagePath,
            textureWidth: decoration.textureWidth,
            textureHeight: decoration.textureHeight,
            sourceX: decoration.sourceX,
            sourceY: decoration.sourceY,
            sourceWidth: decoration.sourceWidth,
            sourceHeight: decoration.sourceHeight,
            opacity: decoration.opacity,
            id: `decoration-${index}`,
          };
        }

        return {
          type: "rect",
          layer: "decoration",
          x: decoration.x,
          y: decoration.y,
          width: decoration.width,
          height: decoration.height,
          color: decoration.color,
          id: `decoration-${index}`,
        };
      }),
      ...progressCommandsFromLayout(recipe),
      ...layout.frames.map((frame) =>
        frameToSlotCommand(frame, layout.unframedSlotKinds.includes(frame.kind)),
      ),
    );

    return commands;
  },

  getInputs(recipe): NeiPositionedStack[] {
    return gregtechLayout(recipe).frames.flatMap((frame) => {
      if (frame.side !== "input") return [];
      const stack = frameToPositionedStack(frame);
      return stack ? [stack] : [];
    });
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return gregtechLayout(recipe).frames.flatMap((frame) => {
      if (frame.side !== "output") return [];
      const stack = frameToPositionedStack(frame);
      return stack ? [stack] : [];
    });
  },

  drawForeground(): NeiDrawCommand[] {
    return [];
  },
};
