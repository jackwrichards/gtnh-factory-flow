import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { gunzipSync, gzipSync } from "node:zlib";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

const datasetPath = process.argv[2];

if (!datasetPath) {
  throw new Error("Usage: build-resource-index.mjs <recipes.json|recipes.json.gz>");
}

const dataset = await readDataset(datasetPath);
dataset.resourceIndex = buildResourceIndex(dataset);
await writeDataset(datasetPath, dataset);

console.log(`Wrote resourceIndex with ${dataset.resourceIndex.length} resources.`);

async function readDataset(filePath) {
  if (!filePath.endsWith(".gz")) {
    return readLineDelimitedDataset(filePath);
  }

  const data = await fs.readFile(filePath);
  const source = gunzipSync(data).toString("utf8");
  return JSON.parse(source);
}

async function readLineDelimitedDataset(filePath) {
  const dataset = {};
  const wantedArrays = new Set([
    "resources",
    "recipes",
    "recipeMaps",
    "recipeMapIcons",
    "machineHandlerIcons",
  ]);
  let currentArrayKey;
  let skippingArray = false;
  let skippingObject = false;

  const lines = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "{" || line === "}") {
      continue;
    }

    if (currentArrayKey || skippingArray) {
      if (line === "]," || line === "]") {
        currentArrayKey = undefined;
        skippingArray = false;
        continue;
      }

      if (currentArrayKey) {
        dataset[currentArrayKey].push(parseJsonLineValue(line));
      }
      continue;
    }

    if (skippingObject) {
      if (line === "}," || line === "}") {
        skippingObject = false;
      }
      continue;
    }

    const match = /^("(?:(?:\\.)|[^"\\])*"):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = JSON.parse(match[1]);
    const value = match[2].replace(/,$/, "");
    if (value === "[") {
      if (wantedArrays.has(key)) {
        dataset[key] = [];
        currentArrayKey = key;
      } else {
        skippingArray = true;
      }
      continue;
    }

    if (value === "{") {
      skippingObject = true;
      continue;
    }

    dataset[key] = JSON.parse(value);
  }

  return dataset;
}

function parseJsonLineValue(line) {
  return JSON.parse(line.replace(/,$/, ""));
}

async function writeDataset(filePath, dataset) {
  if (filePath.endsWith(".gz")) {
    const json = `${JSON.stringify(dataset)}\n`;
    await fs.writeFile(filePath, gzipSync(json, { level: 9 }));
    return;
  }

  await writeDatasetJson(filePath, dataset);
}

function buildResourceIndex(dataset) {
  const resourcesByKey = new Map(
    (dataset.resources ?? []).map((resource) => [resourceKey(resource), resource]),
  );
  const index = new Map();

  for (const recipe of dataset.recipes ?? []) {
    for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      const key = resourceKey(resource);
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        mergeResourceIcon(existing, resource, resourcesByKey.get(key));
        continue;
      }

      const indexed = resourcesByKey.get(key);
      index.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? indexed?.displayName,
        iconPath: currentIconPath(resource.iconPath, indexed?.iconPath),
        iconAtlas: indexed?.iconAtlas ?? resource.iconAtlas,
        dominantColor:
          indexed?.dominantColor ??
          resource.dominantColor ??
          indexed?.iconAtlas?.dominantColor ??
          resource.iconAtlas?.dominantColor,
        recipeCount: 1,
        tooltip: resource.tooltip ?? indexed?.tooltip,
        oreDictionary: resource.oreDictionary ?? indexed?.oreDictionary,
        alternatives: resource.alternatives ?? indexed?.alternatives,
      });
    }
  }

  addFluidCellAlternatives(index, dataset.recipes ?? []);

  return [...index.values()].sort((left, right) => right.recipeCount - left.recipeCount);
}

function addFluidCellAlternatives(index, recipes) {
  for (const recipe of recipes) {
    if (!isFluidCannerRecipe(recipe)) {
      continue;
    }

    const fillFluid = (recipe.inputs ?? []).find((resource) => resource.kind === "fluid");
    const fillCell = (recipe.outputs ?? []).find((resource) => isFilledCell(resource));
    if (fillFluid && fillCell && hasEmptyCell(recipe.inputs ?? [])) {
      linkAlternatives(index, fillCell, fillFluid);
    }

    const emptyFluid = (recipe.outputs ?? []).find((resource) => resource.kind === "fluid");
    const emptyCell = (recipe.inputs ?? []).find((resource) => isFilledCell(resource));
    if (emptyFluid && emptyCell && hasEmptyCell(recipe.outputs ?? [])) {
      linkAlternatives(index, emptyCell, emptyFluid);
    }
  }
}

function linkAlternatives(index, cell, fluid) {
  const cellEntry = index.get(resourceKey(cell));
  const fluidEntry = index.get(resourceKey(fluid));
  if (!cellEntry || !fluidEntry) {
    return;
  }

  addAlternative(cellEntry, fluidEntry, getAlternativeUnitAmount(cell, fluid));
  addAlternative(fluidEntry, cellEntry, getAlternativeUnitAmount(fluid, cell));
}

function addAlternative(resource, alternative, amount) {
  const alternatives = resource.alternatives ?? [];
  if (
    alternatives.some((entry) => entry.kind === alternative.kind && entry.id === alternative.id)
  ) {
    return;
  }

  resource.alternatives = [
    ...alternatives,
    {
      kind: alternative.kind,
      id: alternative.id,
      displayName: alternative.displayName,
      iconPath: alternative.iconPath,
      iconAtlas: alternative.iconAtlas,
      dominantColor: alternative.dominantColor ?? alternative.iconAtlas?.dominantColor,
      tooltip: alternative.tooltip,
      amount,
    },
  ];
}

function getAlternativeUnitAmount(resource, alternative) {
  if (!(resource.amount > 0) || !(alternative.amount > 0)) {
    return undefined;
  }
  return alternative.amount / resource.amount;
}

function isFluidCannerRecipe(recipe) {
  return (recipe.source?.recipeMap ?? recipe.recipeMap ?? recipe.machineType) === "Fluid Canner";
}

function isFilledCell(resource) {
  return resource.kind === "item" && /(^|\s)Cell$/i.test(resource.displayName ?? "");
}

function hasEmptyCell(resources) {
  return resources.some(
    (resource) => resource.kind === "item" && /^Empty Cell$/i.test(resource.displayName ?? ""),
  );
}

function mergeResourceIcon(target, resource, indexed) {
  if (!target.displayName) {
    target.displayName = resource.displayName ?? indexed?.displayName;
  }
  if (!target.iconPath) {
    target.iconPath = currentIconPath(resource.iconPath, indexed?.iconPath);
  }
  if (!target.iconAtlas) {
    target.iconAtlas = indexed?.iconAtlas ?? resource.iconAtlas;
  }
  if (!target.dominantColor) {
    target.dominantColor =
      indexed?.dominantColor ??
      resource.dominantColor ??
      indexed?.iconAtlas?.dominantColor ??
      resource.iconAtlas?.dominantColor;
  }
  if (!target.oreDictionary) {
    target.oreDictionary = resource.oreDictionary ?? indexed?.oreDictionary;
  }
  if (!target.tooltip) {
    target.tooltip = resource.tooltip ?? indexed?.tooltip;
  }
  if (!target.alternatives) {
    target.alternatives = resource.alternatives ?? indexed?.alternatives;
  }
}

function currentIconPath(resourceIconPath, indexedIconPath) {
  if (isLegacyRenderedIconPath(resourceIconPath)) {
    return indexedIconPath;
  }

  return indexedIconPath ?? resourceIconPath;
}

function isLegacyRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}
