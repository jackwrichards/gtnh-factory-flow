import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { gunzipSync, gzipSync } from "node:zlib";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error("Usage: build-recipe-index.mjs <recipes.json> <dataset-out-dir>");
}

const shardSize = positiveIntEnv("GTNH_RECIPE_SHARD_SIZE", 5000);
const dataset = await readDataset(datasetPath);
const versionId = dataset.datasetVersionId;
const shardDir = path.join(datasetOutDir, "recipes-shards");
const resourcesByKey = buildResourcesByKey(dataset);

if (!versionId) {
  throw new Error("Dataset must include datasetVersionId.");
}

await fs.rm(shardDir, { recursive: true, force: true });
await fs.mkdir(shardDir, { recursive: true });

const shards = [];
for (
  let start = 0, shardIndex = 0;
  start < dataset.recipes.length;
  start += shardSize, shardIndex += 1
) {
  const end = Math.min(dataset.recipes.length, start + shardSize);
  const fileName = `shard-${String(shardIndex).padStart(4, "0")}.json.gz`;
  const publicPath = `/datasets/gtnh/${versionId}/recipes-shards/${fileName}`;
  const shard = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    shardIndex,
    start,
    end,
    recipes: dataset.recipes.slice(start, end),
  };

  await fs.writeFile(path.join(shardDir, fileName), gzipSync(JSON.stringify(shard), { level: 9 }));
  shards.push({ id: String(shardIndex), path: publicPath, start, end });
}

const recipeIndex = {
  schemaVersion: 1,
  datasetVersionId: versionId,
  gtnhVersion: dataset.gtnhVersion,
  sourceInfo: dataset.sourceInfo,
  recipeMaps: dataset.recipeMaps ?? [],
  generatedAt: dataset.generatedAt,
  recipeCount: dataset.recipes.length,
  shardSize,
  shards,
  recipes: dataset.recipes.map(toRecipeSummary),
  searchText: dataset.recipes.map((recipe) => buildRecipeSearchText(recipe, resourcesByKey)),
  tierIndexes: dataset.recipes.map(tierIndex),
  iconScores: dataset.recipes.map((recipe) => recipeIconScore(recipe, resourcesByKey)),
};

const recipeLookupIndex = buildRecipeLookupIndex(dataset.recipes, recipeIndex, resourcesByKey);
const resourceCatalog = {
  schemaVersion: 1,
  datasetVersionId: versionId,
  gtnhVersion: dataset.gtnhVersion,
  sourceInfo: dataset.sourceInfo,
  resources: dataset.resources ?? [],
  resourceIndex: dataset.resourceIndex ?? [],
  recipeMaps: dataset.recipeMaps ?? [],
  recipeMapIcons: dataset.recipeMapIcons ?? [],
  machineHandlerIcons: dataset.machineHandlerIcons ?? [],
  generatedAt: dataset.generatedAt,
  recipeCount: dataset.recipes.length,
  shardSize,
  shards,
};

const resourceIndexPath = path.join(datasetOutDir, "resource-index.json.gz");
const indexPath = path.join(datasetOutDir, "recipe-index.json.gz");
const lookupIndexPath = path.join(datasetOutDir, "recipe-lookup-index.json.gz");
await fs.writeFile(resourceIndexPath, gzipSync(JSON.stringify(resourceCatalog), { level: 9 }));
await fs.writeFile(indexPath, gzipSync(JSON.stringify(recipeIndex), { level: 9 }));
await fs.writeFile(lookupIndexPath, gzipSync(JSON.stringify(recipeLookupIndex), { level: 9 }));

console.log(
  `Wrote resource catalog, recipe index with ${recipeIndex.recipes.length} summaries, compact lookup index, and ${shards.length} shard(s).`,
);

function buildRecipeLookupIndex(recipes, recipeIndex, resourcesByKey = new Map()) {
  const recipeMaps = [
    ...new Set((recipeIndex.recipes ?? []).map((recipe) => recipe.recipeMap).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const recipeMapIds = new Map(recipeMaps.map((recipeMap, index) => [recipeMap, index]));
  const recipeIds = [];
  const tierIndexes = [];
  const iconScores = [];
  const searchText = [];
  const entries = new Map();

  recipes.forEach((recipe, index) => {
    const summary = recipeIndex.recipes[index];
    const recipeMapId = recipeMapIds.get(summary?.recipeMap);
    if (recipeMapId === undefined) {
      return;
    }

    recipeIds[index] = recipe.id;
    tierIndexes[index] = recipeIndex.tierIndexes[index] ?? tierIndex(summary ?? recipe);
    iconScores[index] = recipeIndex.iconScores[index] ?? recipeIconScore(summary ?? recipe);
    searchText[index] = recipeIndex.searchText[index] ?? buildRecipeSearchText(recipe);

    for (const output of recipe.outputs ?? []) {
      addLookupRecipe(entries, output, "recipes", recipeMapId, index);
      for (const alternative of resourceAlternatives(output, resourcesByKey)) {
        addLookupRecipe(entries, alternative, "recipes", recipeMapId, index);
      }
    }
    for (const input of recipe.inputs ?? []) {
      addLookupRecipe(entries, input, "uses", recipeMapId, index);
      for (const alternative of resourceAlternatives(input, resourcesByKey)) {
        addLookupRecipe(entries, alternative, "uses", recipeMapId, index);
      }
    }
  });

  for (const recipesByMap of entries.values()) {
    for (const recipeIndexes of recipesByMap.values()) {
      recipeIndexes.sort((left, right) => iconScores[right] - iconScores[left] || left - right);
    }
  }

  return {
    schemaVersion: 1,
    datasetVersionId: recipeIndex.datasetVersionId,
    recipeCount: recipeIndex.recipeCount,
    shards: recipeIndex.shards,
    recipeMaps,
    recipeIds,
    tierIndexes,
    iconScores,
    searchText,
    entries: [...entries.entries()].map(([key, recipesByMap]) => [
      key,
      [...recipesByMap.entries()],
    ]),
  };
}

function resourceAlternatives(resource, resourcesByKey) {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  return resource.alternatives ?? indexed?.alternatives ?? [];
}

function addLookupRecipe(entries, resource, mode, recipeMapId, recipeIndex) {
  const key = `${mode}:${resource.kind}:${resource.id}`;
  let recipesByMap = entries.get(key);
  if (!recipesByMap) {
    recipesByMap = new Map();
    entries.set(key, recipesByMap);
  }

  let recipeIndexes = recipesByMap.get(recipeMapId);
  if (!recipeIndexes) {
    recipeIndexes = [];
    recipesByMap.set(recipeMapId, recipeIndexes);
  }

  recipeIndexes.push(recipeIndex);
}

function buildResourcesByKey(dataset) {
  return new Map(
    [...(dataset.resourceIndex ?? []), ...(dataset.resources ?? [])].map((resource) => [
      `${resource.kind}:${resource.id}`,
      resource,
    ]),
  );
}

function buildRecipeSearchText(recipe, resourcesByKey = new Map()) {
  return normalizeText(
    [
      recipe.name,
      recipe.machineType,
      recipe.source?.recipeMap ?? recipe.recipeMap,
      ...(recipe.inputs ?? []).flatMap((resource) => resourceSearchTerms(resource, resourcesByKey)),
      ...(recipe.outputs ?? []).flatMap((resource) =>
        resourceSearchTerms(resource, resourcesByKey),
      ),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function resourceSearchTerms(resource, resourcesByKey) {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  return [
    resource.displayName,
    indexed?.displayName,
    resource.id,
    resource.kind,
    ...(resource.tooltip ?? []),
    ...(indexed?.tooltip ?? []),
  ].filter(Boolean);
}

function recipeIconScore(recipe, resourcesByKey = new Map()) {
  return [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])].reduce(
    (score, resource) => score + (resourceHasIcon(resource, resourcesByKey) ? 1 : 0),
    0,
  );
}

function resourceHasIcon(resource, resourcesByKey) {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  return Boolean(
    resource.iconPath || resource.iconAtlas || indexed?.iconPath || indexed?.iconAtlas,
  );
}

function normalizeText(value) {
  return value.trim().toLowerCase();
}

function tierIndex(recipe) {
  const tiers = [
    "ULV",
    "LV",
    "MV",
    "HV",
    "EV",
    "IV",
    "LuV",
    "ZPM",
    "UV",
    "UHV",
    "UEV",
    "UIV",
    "UMV",
    "UXV",
    "OpV",
    "MAX",
  ];
  const explicitTierIndex = tiers.indexOf(recipe.minimumTier);
  if (explicitTierIndex !== -1) {
    return explicitTierIndex;
  }

  const eut = Math.abs(Number(recipe.eut) || 0);
  const voltages = [
    8,
    32,
    128,
    512,
    2048,
    8192,
    32768,
    131072,
    524288,
    2097152,
    8388608,
    33554432,
    134217728,
    536870912,
    Number.MAX_SAFE_INTEGER,
  ];
  return Math.max(
    0,
    voltages.findIndex((voltage) => eut <= voltage),
  );
}

function toRecipeSummary(recipe, index) {
  return {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    category: recipe.category,
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    specialValue: recipe.specialValue,
    source: recipe.source?.recipeMap ? { recipeMap: recipe.source.recipeMap } : undefined,
    metadata: recipe.metadata,
    shardIndex: Math.floor(index / shardSize),
  };
}

function compactNei(nei) {
  if (!nei) {
    return undefined;
  }

  return removeUndefined({
    source: nei.source,
    handlerClass: nei.handlerClass,
    canvas: nei.canvas,
    backgroundImage: nei.backgroundImage,
    itemInputGrid: nei.itemInputGrid,
    itemOutputGrid: nei.itemOutputGrid,
    fluidInputGrid: nei.fluidInputGrid,
    fluidOutputGrid: nei.fluidOutputGrid,
    slotCapacity: nei.slotCapacity,
    slots: nei.slots,
    progressBars: nei.progressBars,
    requiresCleanroom: nei.requiresCleanroom,
    requiresLowGravity: nei.requiresLowGravity,
  });
}

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
    "resourceIndex",
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

function toCompactResource(resource) {
  return removeUndefined({
    kind: resource.kind,
    id: resource.id,
    amount: resource.amount,
    optional: resource.optional,
    consumed: resource.consumed,
    chance: resource.chance,
    byproduct: resource.byproduct,
    neiSlot: resource.neiSlot,
  });
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function positiveIntEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
