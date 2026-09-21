import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const channel = requiredEnv("GTNH_CHANNEL");
const versionId = requiredEnv("GTNH_VERSION_ID");
const versionLabel = requiredEnv("GTNH_VERSION_LABEL");
const sourceKind = requiredEnv("GTNH_SOURCE_KIND");
const sourceRef = requiredEnv("GTNH_SOURCE_REF");
const sourceUrl = process.env.GTNH_SOURCE_URL;
const defaultExportCommand =
  process.env.GTNH_CLIENT_EXPORT_COMMAND ||
  "bash tools/dataset-pipeline/scripts/run-gtnh-oracle-export.sh";
const splitServerClientExport = envFlag(
  "GTNH_SPLIT_SERVER_CLIENT_EXPORT",
  !process.env.GTNH_CLIENT_EXPORT_COMMAND,
);
const datasetsRoot = process.env.GTNH_DATASETS_ROOT ?? path.join("public", "datasets", "gtnh");
const outDir = path.join(datasetsRoot, versionId);
const pipelineDir = ".pipeline";
const serverInstanceDir = path.join(pipelineDir, "server-instance", versionId);
const clientInstanceDir = path.join(pipelineDir, "client-instance", versionId);
const rawExportDir = path.join(pipelineDir, "raw-export", versionId);

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(pipelineDir, { recursive: true });
await fs.mkdir(serverInstanceDir, { recursive: true });
await fs.mkdir(clientInstanceDir, { recursive: true });
await fs.mkdir(rawExportDir, { recursive: true });

const pipelineRecord = {
  schemaVersion: 1,
  status: "started",
  channel,
  versionId,
  versionLabel,
  sourceKind,
  sourceRef,
  sourceUrl,
  generatedAt: new Date().toISOString(),
};

const { spawn } = await import("node:child_process");

if (splitServerClientExport) {
  console.log(`Running split server/client exporter for ${versionId}.`);
  await runExporter("server oracle export", {
    GTNH_INSTANCE_DIR: serverInstanceDir,
    GTNH_EXPORT_PACK_KIND: process.env.GTNH_SERVER_EXPORT_PACK_KIND ?? "server",
    GTNH_EXPORT_PHASE: "server",
    GTNH_RENDER_STACK_ICONS: "false",
    JAVA_TOOL_OPTIONS: stripJavaProperty(process.env.JAVA_TOOL_OPTIONS, "gtnh.oracle.renderIcons"),
  });

  const clientIconDecision = await shouldRunClientIconPass();
  if (clientIconDecision.runClient) {
    console.log(`Running client icon export for ${versionId}: ${clientIconDecision.reason}`);
    await runExporter("client icon export", {
      GTNH_INSTANCE_DIR: clientInstanceDir,
      GTNH_EXPORT_PACK_KIND: "client",
      GTNH_EXPORT_PHASE: "client",
      GTNH_RENDER_STACK_ICONS: process.env.GTNH_RENDER_STACK_ICONS ?? "true",
    });
  } else {
    console.log(`Skipping client icon export for ${versionId}: ${clientIconDecision.reason}`);
    if (clientIconDecision.previousDatasetDir) {
      await reusePreviousIcons(clientIconDecision.previousDatasetDir);
    }
  }
} else {
  console.log(`Running configured exporter for ${versionId}.`);
  await runExporter("configured export", {
    GTNH_INSTANCE_DIR: clientInstanceDir,
  });
}
console.log(`Exporter finished for ${versionId}.`);

const recipeDatasetPath = path.join(outDir, "recipes.json");
if (!existsSync(recipeDatasetPath)) {
  throw new Error(
    `Exporter command completed but did not create ${recipeDatasetPath}. The app expects a normalized RecipeDataset JSON file named recipes.json.`,
  );
}

console.log(`Validating dataset for ${versionId}.`);
const datasetStats = await readDatasetStatsAndValidate(recipeDatasetPath);
const postProcessMaxDatasetBytes = positiveIntEnv(
  "GTNH_ICON_POST_PROCESS_MAX_DATASET_BYTES",
  450_000_000,
);
const recipeDatasetSizeBytes = (await fs.stat(recipeDatasetPath)).size;
if (recipeDatasetSizeBytes <= postProcessMaxDatasetBytes) {
  console.log(`Pruning rendered icons for ${versionId}.`);
  await pruneRenderedIcons(recipeDatasetPath, path.join(outDir, "textures", "rendered"));
  console.log(`Finalizing rendered icons for ${versionId}.`);
  await finalizeRenderedIcons(recipeDatasetPath, outDir);
} else {
  console.log(
    `Skipping rendered icon cleanup/finalization for ${versionId}: dataset is ${recipeDatasetSizeBytes} bytes.`,
  );
}
console.log(`Building resource index for ${versionId}.`);
await buildResourceIndex(recipeDatasetPath);
console.log(`Building recipe index for ${versionId}.`);
await buildRecipeIndex(recipeDatasetPath, outDir);
// After the indexes so the pass can read fluid references from them. Content
// hash the repaired icons and update every artifact, including recipes.json:
// rebuilding an existing version must not reuse an immutable ghost-icon URL.
console.log(`Normalizing fluid icon alpha for ${versionId}.`);
await normalizeFluidIconAlpha(outDir);

const compressedRecipeDatasetPath = `${recipeDatasetPath}.gz`;
const uncompressedSizeBytes = (await fs.stat(recipeDatasetPath)).size;
console.log(`Compressing dataset for ${versionId}.`);
await gzipFile(recipeDatasetPath, compressedRecipeDatasetPath);
await fs.rm(recipeDatasetPath, { force: true });

console.log(`Writing pipeline record for ${versionId}.`);
await writePipelineRecord({
  ...pipelineRecord,
  status: "generated",
  ...datasetStats,
  recipeDatasetPath: compressedRecipeDatasetPath,
  uncompressedSizeBytes,
  compressedSizeBytes: (await fs.stat(compressedRecipeDatasetPath)).size,
});

function validateDataset(dataset) {
  if (dataset.schemaVersion !== 1) {
    throw new Error("recipes.json must be a RecipeDataset with schemaVersion 1.");
  }
  if (dataset.datasetVersionId !== versionId) {
    throw new Error(
      `recipes.json datasetVersionId must be ${versionId}, got ${dataset.datasetVersionId}.`,
    );
  }
  if (dataset.gtnhVersion !== versionLabel) {
    throw new Error(
      `recipes.json gtnhVersion must be ${versionLabel}, got ${dataset.gtnhVersion}.`,
    );
  }
  if (!dataset.sourceInfo || dataset.sourceInfo.sourceId === "unknown") {
    throw new Error("recipes.json sourceInfo.sourceId must identify nesql, recex, nerd, or gtnh-oracle.");
  }
  if (!Array.isArray(dataset.resources)) {
    throw new Error("recipes.json resources must be an array.");
  }
  if (!Array.isArray(dataset.recipes) || dataset.recipes.length === 0) {
    throw new Error("recipes.json recipes must be a non-empty array from the GTNH export.");
  }
  if (!Array.isArray(dataset.recipeMaps)) {
    throw new Error("recipes.json recipeMaps must be an array.");
  }
  if (!dataset.oreDictionary || typeof dataset.oreDictionary !== "object") {
    throw new Error("recipes.json oreDictionary must be an object.");
  }
}

async function readDatasetStatsAndValidate(datasetPath) {
  const dataset = {};
  const counts = {
    recipeCount: 0,
    resourceCount: 0,
    recipeMapCount: 0,
  };
  const countedArrays = new Map([
    ["recipes", "recipeCount"],
    ["resources", "resourceCount"],
    ["recipeMaps", "recipeMapCount"],
  ]);
  let currentArrayKey;
  let skippingArray = false;
  let skippingObject = false;

  const lines = readline.createInterface({
    input: createReadStream(datasetPath, { encoding: "utf8" }),
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
        counts[countedArrays.get(currentArrayKey)] += 1;
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
      if (countedArrays.has(key)) {
        dataset[key] = [];
        currentArrayKey = key;
      } else {
        skippingArray = true;
      }
      continue;
    }

    if (value === "{") {
      dataset[key] = {};
      skippingObject = true;
      continue;
    }

    dataset[key] = JSON.parse(value);
  }

  validateDataset({
    ...dataset,
    recipes: new Array(counts.recipeCount),
    resources: new Array(counts.resourceCount),
    recipeMaps: new Array(counts.recipeMapCount),
  });

  return counts;
}

async function writePipelineRecord(record) {
  await fs.writeFile(
    path.join(pipelineDir, `${versionId}.pipeline.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

async function pruneRenderedIcons(datasetPath, renderedDir) {
  if (!existsSync(renderedDir)) {
    return;
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/prune-blank-rendered-icons.mjs", datasetPath, renderedDir],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PRUNE_ATLAS_LIKE_ICONS: "true",
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Rendered icon pruning failed with exit code ${exitCode}.`);
  }
}

async function finalizeRenderedIcons(datasetPath, datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/finalize-rendered-icons.mjs", datasetPath, datasetOutDir],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Standalone icon finalization failed with exit code ${exitCode}.`);
  }
}

async function buildResourceIndex(datasetPath) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/build-resource-index.mjs", datasetPath],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Resource index build failed with exit code ${exitCode}.`);
  }
}

async function buildRecipeIndex(datasetPath, datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/build-recipe-index.mjs", datasetPath, datasetOutDir],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Recipe index build failed with exit code ${exitCode}.`);
  }
}

async function normalizeFluidIconAlpha(datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/normalize-fluid-icon-alpha.mjs", datasetOutDir, "--rename"],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Fluid icon alpha normalization failed with exit code ${exitCode}.`);
  }
}

async function runExporter(label, envOverrides = {}) {
  const exitCode = await new Promise((resolve) => {
    const childEnv = removeUndefined({
      ...process.env,
      GTNH_DATASET_OUT_DIR: outDir,
      GTNH_DATASET_VERSION_ID: versionId,
      GTNH_DATASET_CHANNEL: channel,
      GTNH_DATASET_VERSION_LABEL: versionLabel,
      GTNH_RAW_EXPORT_DIR: rawExportDir,
      GTNH_SOURCE_KIND: sourceKind,
      GTNH_SOURCE_REF: sourceRef,
      ...(sourceUrl ? { GTNH_SOURCE_URL: sourceUrl } : {}),
      ...envOverrides,
    });
    const child = spawn(defaultExportCommand, {
      shell: true,
      stdio: "inherit",
      env: childEnv,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
}

async function shouldRunClientIconPass() {
  if (!envFlag("GTNH_RENDER_STACK_ICONS", true)) {
    return { runClient: false, reason: "GTNH_RENDER_STACK_ICONS is disabled." };
  }
  if (envFlag("GTNH_FORCE_CLIENT_ICON_EXPORT", false)) {
    return { runClient: true, reason: "GTNH_FORCE_CLIENT_ICON_EXPORT is enabled." };
  }

  const currentFingerprint = await readJsonIfExists(
    path.join(outDir, "textures", "server-asset-fingerprint.json"),
  );
  if (!currentFingerprint?.hash) {
    return { runClient: true, reason: "server asset fingerprint is missing." };
  }

  const previousDatasetDir = await findPreviousDatasetDir();
  if (!previousDatasetDir) {
    return { runClient: true, reason: "no previous same-channel dataset is available." };
  }

  const previousFingerprint = await readJsonIfExists(
    path.join(previousDatasetDir, "textures", "server-asset-fingerprint.json"),
  );
  if (!previousFingerprint?.hash) {
    return {
      runClient: true,
      reason: "previous same-channel server asset fingerprint is missing.",
      previousDatasetDir,
    };
  }
  if (previousFingerprint.hash !== currentFingerprint.hash) {
    return {
      runClient: true,
      reason: "server asset fingerprint changed.",
      previousDatasetDir,
    };
  }

  return {
    runClient: false,
    reason: "server asset fingerprint is unchanged.",
    previousDatasetDir,
  };
}

async function findPreviousDatasetDir() {
  const previousRoot = process.env.GTNH_PREVIOUS_DATASETS_ROOT;
  if (!previousRoot) {
    return undefined;
  }
  const manifest = await readJsonIfExists(path.join(previousRoot, "datasets.manifest.json"));
  const versions = (manifest?.versions ?? [])
    .filter((version) => version.channel === channel && version.id !== versionId)
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
  for (const version of versions) {
    const candidate = path.join(previousRoot, version.id);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function reusePreviousIcons(previousDatasetDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      [
        "tools/dataset-pipeline/scripts/reuse-previous-icons.mjs",
        path.join(outDir, "recipes.json"),
        previousDatasetDir,
        outDir,
      ],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Previous icon reuse failed with exit code ${exitCode}.`);
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function stripJavaProperty(value, propertyName) {
  if (!value) {
    return value;
  }
  const propertyPattern = new RegExp(`(?:^|\\s)-D${escapeRegExp(propertyName)}(?:=[^\\s]*)?`, "g");
  return value.replace(propertyPattern, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function envFlag(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }
  return /^(1|true|yes|on)$/i.test(rawValue);
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

async function gzipFile(inputPath, outputPath) {
  await pipeline(
    createReadStream(inputPath),
    createGzip({ level: 9 }),
    createWriteStream(outputPath),
  );
}
