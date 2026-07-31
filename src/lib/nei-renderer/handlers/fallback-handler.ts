import type { ResourceAmount, ResourceKind } from "@/lib/model/types";
import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type {
  NeiRecipeRenderModel,
  NeiRenderAspectAmount,
  NeiSize,
} from "../core/render-model";
import { NEI_TEXT_COLORS } from "../theme/constants";
import {
  aspectToPositionedStack,
  basePanel,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

const WIDTH = 196;
const MIN_HEIGHT = 92;
const INPUT_X = 12;
const OUTPUT_X = 112;
const START_Y = 28;
const COLUMNS = 3;
const GAP = 2;

export const FallbackHandler: NeiRecipeHandler = {
  id: "fallback",
  label: "Fallback Recipe",

  canHandle() {
    return true;
  },

  getDimensions(recipe): NeiSize {
    return fallbackDimensions(recipe);
  },

  drawBackground(recipe): NeiDrawCommand[] {
    const dimensions = fallbackDimensions(recipe);
    return [
      basePanel(dimensions.width, dimensions.height),
      {
        type: "rect",
        layer: "decoration",
        x: 4,
        y: 4,
        width: dimensions.width - 8,
        height: 18,
        color: "#9f9f9f",
        borderColor: "#555555",
        semanticTags: ["header"],
      },
      ...inputResources(recipe).map((entry, index) =>
        slotCommand({
          ...positionFor(INPUT_X, index),
          side: "input",
          kind: entry.kind,
          slotIndex: index,
        }),
      ),
      ...outputResources(recipe).map((entry, index) =>
        slotCommand({
          ...positionFor(OUTPUT_X, index),
          side: "output",
          kind: entry.kind,
          slotIndex: index,
        }),
      ),
    ];
  },

  getInputs(recipe): NeiPositionedStack[] {
    return inputResources(recipe).map((entry, index) => {
      const position = positionFor(INPUT_X, index);
      return entry.aspect
        ? aspectToPositionedStack({
            aspect: entry.resource,
            side: "input",
            ...position,
            slotIndex: index,
          })
        : resourceToPositionedStack({
            resource: entry.resource,
            side: "input",
            ...position,
            slotIndex: index,
            resourceIndex: entry.resourceIndex,
          });
    });
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return outputResources(recipe).map((entry, index) => {
      const position = positionFor(OUTPUT_X, index);
      return entry.aspect
        ? aspectToPositionedStack({
            aspect: entry.resource,
            side: "output",
            ...position,
            slotIndex: index,
            semanticTags: ["essentia-output"],
          })
        : resourceToPositionedStack({
            resource: entry.resource,
            side: "output",
            ...position,
            slotIndex: index,
            resourceIndex: entry.resourceIndex,
          });
    });
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const dimensions = fallbackDimensions(recipe);
    return [
      {
        type: "text",
        layer: "text",
        x: 8,
        y: 8,
        width: dimensions.width - 16,
        text: recipe.title ?? recipe.recipeMapName ?? recipe.kind,
        color: NEI_TEXT_COLORS.white,
        fontSize: 8,
        semanticTags: ["header"],
      },
      {
        type: "text",
        layer: "text",
        x: 8,
        y: dimensions.height - 12,
        width: dimensions.width - 16,
        text: `Fallback: ${recipe.kind}`,
        color: NEI_TEXT_COLORS.muted,
        fontSize: 7,
      },
    ];
  },
};

type FallbackResource =
  | {
      kind: ResourceKind;
      resource: ResourceAmount;
      resourceIndex: number;
      aspect: false;
    }
  | {
      kind: "aspect";
      resource: NeiRenderAspectAmount;
      resourceIndex: number;
      aspect: true;
    };

function inputResources(recipe: NeiRecipeRenderModel): FallbackResource[] {
  return [
    ...recipe.inputs.map((resource, resourceIndex) => ({
      kind: resource.kind,
      resource,
      resourceIndex,
      aspect: false as const,
    })),
    ...(recipe.fluidInputs ?? []).map((resource, resourceIndex) => ({
      kind: resource.kind,
      resource,
      resourceIndex,
      aspect: false as const,
    })),
    ...(recipe.aspectInputs ?? []).map((resource, resourceIndex) => ({
      kind: "aspect" as const,
      resource,
      resourceIndex,
      aspect: true as const,
    })),
  ];
}

function outputResources(recipe: NeiRecipeRenderModel): FallbackResource[] {
  return [
    ...recipe.outputs.map((resource, resourceIndex) => ({
      kind: resource.kind,
      resource,
      resourceIndex,
      aspect: false as const,
    })),
    ...(recipe.fluidOutputs ?? []).map((resource, resourceIndex) => ({
      kind: resource.kind,
      resource,
      resourceIndex,
      aspect: false as const,
    })),
    ...(recipe.aspectOutputs ?? []).map((resource, resourceIndex) => ({
      kind: "aspect" as const,
      resource,
      resourceIndex,
      aspect: true as const,
    })),
  ];
}

function fallbackDimensions(recipe: NeiRecipeRenderModel): NeiSize {
  const rows = Math.max(
    rowCount(inputResources(recipe).length),
    rowCount(outputResources(recipe).length),
    1,
  );
  return { width: WIDTH, height: Math.max(MIN_HEIGHT, START_Y + rows * 20 + 24) };
}

function positionFor(x: number, index: number) {
  return gridPositions(index + 1, x, START_Y, COLUMNS, GAP).at(-1) ?? { x, y: START_Y };
}

function rowCount(count: number) {
  return Math.ceil(count / COLUMNS);
}
