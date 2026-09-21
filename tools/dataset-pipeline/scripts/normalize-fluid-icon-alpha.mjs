import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { PNG } from "pngjs";

/**
 * Make ghost fluids visible: turn nearly invisible fluid icons into solid chips
 * of their own colour.
 *
 * The oracle exporter captures fluid icons exactly as the game draws them,
 * and the game draws gases at 10-30% opacity riding a dim noise texture. The
 * hue in those pixels is the fluid's real tint - oxygen teal, hydrogen red -
 * but at that alpha and brightness the capture simply vanishes on the
 * planner's dark board. This pass rebuilds only nearly invisible FLUID icons as
 * an opaque chip: the capture's average colour lifted to a readable
 * luminance, shaded by the original alpha pattern so it still reads as a
 * liquid. Readable translucent fluids such as water retain their exact pixels.
 * Item icons are never touched: some are legitimately translucent,
 * and none of them hide behind a fluid's render alpha.
 *
 * Two modes:
 *
 * - In-place (default), for a dataset BUILD. Nothing has shipped yet, and a
 *   new dataset version gets fresh texture URLs anyway, so the files can be
 *   rewritten under their own names. Use only for an unpublished version.
 *   generate-dataset.mjs uses --rename even during builds, because a version
 *   may be rebuilt and its URLs may already be cached.
 *
 * - `--rename`, for a dataset that may ALREADY BE PUBLISHED. Textures are served
 *   `immutable, max-age=1yr`, so a browser that has seen the ghost keeps it
 *   for a year no matter what the file says now. The fixed icon therefore
 *   gets a NEW name (content-hash suffix, same length as the old one), the
 *   old file stays behind for stale caches, and every reference in the
 *   compressed artifacts is patched byte-for-byte - same-length names make
 *   that safe without parsing half a gigabyte of JSON.
 *   Already-opaque icons also get content-hashed names: an earlier in-place
 *   repair may have fixed the local pixels while the old URL still serves a
 *   faint capture from another server or a browser cache.
 *
 * Usage: normalize-fluid-icon-alpha.mjs <dataset-dir> [--rename]
 */

const args = process.argv.slice(2);
const rename = args.includes("--rename");
const datasetDir = args.find((arg) => !arg.startsWith("--"));

if (!datasetDir || !fs.existsSync(datasetDir)) {
  throw new Error("Usage: normalize-fluid-icon-alpha.mjs <dataset-dir> [--rename]");
}

/**
 * Only fix captures below 20% mean opacity. Ordinary translucency is part
 * of the artwork: water is about 50% opaque and must remain unchanged.
 */
const MIN_MEAN_ALPHA = 51;
/**
 * Where a translucent fluid's colour is lifted to. The capture's hue is the
 * game's real tint - oxygen teal, hydrogen red - but it rides a dim noise
 * texture, so the honest colour arrives too dark to read on a dark board.
 */
const TARGET_LUMINANCE = 0.45;
/**
 * Cap on the lift, so a genuinely dark fluid stays a dark fluid: crude oil
 * comes out near-black instead of being hoisted to grey.
 */
const MAX_LUMINANCE_GAIN = 10;

/** How a texture reference starts inside every dataset artifact. */
const RENDERED_PREFIX = Buffer.from("textures/rendered/");

const renderedDir = path.join(datasetDir, "textures", "rendered");
const indexFiles = ["resource-index.json.gz", "recipe-index.json.gz"]
  .map((name) => path.join(datasetDir, name))
  .filter((file) => fs.existsSync(file));

if (indexFiles.length === 0) {
  throw new Error(
    `No resource-index.json.gz or recipe-index.json.gz in ${datasetDir}; ` +
      "run this after the indexes are built.",
  );
}
if (!fs.existsSync(renderedDir)) {
  console.log("No rendered texture directory; nothing to normalize.");
  process.exit(0);
}

// Every icon file any FLUID resource points at, wherever it appears: the
// resource catalog, recipe summaries, recipe map icons, machine handlers.
const fluidIconBasenames = new Set();
for (const file of indexFiles) {
  collectFluidIcons(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()));
}
console.log(`${fluidIconBasenames.size} fluid icon files referenced by ${datasetDir}.`);

const renames = new Map();
let normalized = 0;
let alreadyVisible = 0;
let missing = 0;
const report = [];

for (const basename of [...fluidIconBasenames].sort()) {
  const filePath = path.join(renderedDir, basename);
  if (!fs.existsSync(filePath)) {
    missing += 1;
    continue;
  }

  const originalBuffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(originalBuffer);
  const applied = normalizeFluidPng(png);
  if (!applied) {
    alreadyVisible += 1;
    if (!rename) continue;
  } else {
    normalized += 1;
    report.push(`${basename}: ${applied}`);
  }

  const buffer = applied ? PNG.sync.write(png) : originalBuffer;

  if (!rename) {
    fs.writeFileSync(filePath, buffer);
    continue;
  }

  const suffixMatch = basename.match(/^(.*-)[0-9a-f]{12}\.png$/);
  if (!suffixMatch) {
    // Without the hash suffix there is no same-length name to swap in, so the
    // byte patch cannot carry it. Fix the pixels anyway for uncached readers.
    if (applied) {
      console.warn(`No hash suffix on ${basename}; normalized in place instead of renaming.`);
      fs.writeFileSync(filePath, buffer);
    }
    continue;
  }

  const newBasename = `${suffixMatch[1]}${crypto
    .createHash("sha1")
    .update(buffer)
    .digest("hex")
    .slice(0, 12)}.png`;
  if (newBasename === basename) continue;
  // The ghost file stays: a browser holding a cached recipe response may still
  // ask for the old name, and a missing icon is worse than a faint one.
  fs.writeFileSync(path.join(renderedDir, newBasename), buffer);
  renames.set(basename, newBasename);
}

console.log(
  `Normalized ${normalized} fluid icons ` +
    `(${alreadyVisible} already visible, ${missing} missing files; ${renames.size} URLs refreshed).`,
);
for (const line of report) {
  console.log(`  ${line}`);
}

if (renames.size > 0) {
  const artifacts = [
    "resource-index.json.gz",
    "recipe-index.json.gz",
    "recipe-lookup-index.json.gz",
    "recipes.json.gz",
    "recipes.json",
    ...listShardFiles(),
  ];
  for (const artifact of artifacts) {
    patchArtifact(path.join(datasetDir, artifact));
  }
}

/**
 * Turn one translucent fluid icon into a solid chip of its own colour, in
 * place: the alpha-weighted average of the capture's pixels is the fluid's
 * true tint, it gets lifted to a readable luminance, and the capture's alpha
 * pattern is kept as shading so the chip still moves like a texture. Returns
 * a short description of what was done, or undefined when the icon already
 * reads fine - which is also what makes the pass idempotent, since a treated
 * icon comes out fully opaque and measures healthy on the next run.
 */
function normalizeFluidPng(png) {
  const { data, width, height } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let painted = 0;
  let alphaSum = 0;
  let maxAlpha = 0;
  let weightedRed = 0;
  let weightedGreen = 0;
  let weightedBlue = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha === 0) {
        continue;
      }
      painted += 1;
      alphaSum += alpha;
      if (alpha > maxAlpha) {
        maxAlpha = alpha;
      }
      const weight = alpha / 255;
      weightedRed += data[index] * weight;
      weightedGreen += data[index + 1] * weight;
      weightedBlue += data[index + 2] * weight;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (painted === 0) {
    // A fully blank capture has nothing to recover; inventing pixels from
    // nothing is the dataset lying about what the exporter saw.
    return undefined;
  }

  const meanAlpha = alphaSum / painted;
  if (meanAlpha >= MIN_MEAN_ALPHA) {
    return undefined;
  }

  const totalWeight = alphaSum / 255;
  const base = [
    weightedRed / totalWeight,
    weightedGreen / totalWeight,
    weightedBlue / totalWeight,
  ];
  const luminance = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255;
  const gain =
    luminance < TARGET_LUMINANCE
      ? Math.min(TARGET_LUMINANCE / Math.max(luminance, 0.02), MAX_LUMINANCE_GAIN)
      : 1;
  const bright = base.map((channel) => Math.min(255, channel * gain));

  // Fill the icon's own bounding box only: the canvas padding around the
  // fluid square stays transparent, so the icon keeps its shape instead of
  // becoming a full card.
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * width + x) * 4;
      const shade = 0.78 + 0.27 * (data[index + 3] / maxAlpha);
      data[index] = Math.min(255, Math.round(bright[0] * shade));
      data[index + 1] = Math.min(255, Math.round(bright[1] * shade));
      data[index + 2] = Math.min(255, Math.round(bright[2] * shade));
      data[index + 3] = 255;
    }
  }

  return `chipped at mean alpha ${(meanAlpha / 255).toFixed(2)}, luminance x${gain.toFixed(1)}`;
}

function collectFluidIcons(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFluidIcons(entry);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (
    value.kind === "fluid" &&
    typeof value.iconPath === "string" &&
    value.iconPath.includes("/textures/rendered/")
  ) {
    fluidIconBasenames.add(path.posix.basename(value.iconPath));
  }
  for (const entry of Object.values(value)) {
    collectFluidIcons(entry);
  }
}

function listShardFiles() {
  const shardsDir = path.join(datasetDir, "recipes-shards");
  if (!fs.existsSync(shardsDir)) {
    return [];
  }
  return fs
    .readdirSync(shardsDir)
    .filter((name) => name.endsWith(".json.gz") || name.endsWith(".json"))
    .map((name) => path.posix.join("recipes-shards", name));
}

/**
 * Swap every renamed basename inside one artifact. One scan finds each
 * rendered-texture reference and looks its basename up in the rename map -
 * never the other way around, which both avoids a pass per renamed file and
 * cannot clip a longer name that merely ends with a renamed one (fluids that
 * share a texture share its content-hash suffix, so `latte-<hash>.png` is a
 * real suffix of `sweet_latte-<hash>.png`). Old and new names are the same
 * length, so the patch mutates the decompressed buffer in place; only an
 * artifact that actually changed is recompressed and rewritten.
 */
function patchArtifact(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const isGz = filePath.endsWith(".gz");
  const buffer = isGz ? zlib.gunzipSync(fs.readFileSync(filePath)) : fs.readFileSync(filePath);

  let replaced = 0;
  let position = 0;
  while ((position = buffer.indexOf(RENDERED_PREFIX, position)) !== -1) {
    position += RENDERED_PREFIX.length;
    let end = position;
    while (end < buffer.length && buffer[end] !== 0x22 && end - position < 200) {
      end += 1;
    }
    const replacement = renames.get(buffer.toString("utf8", position, end));
    if (replacement) {
      buffer.write(replacement, position);
      replaced += 1;
    }
    position = end;
  }
  if (replaced === 0) {
    return;
  }

  fs.writeFileSync(
    filePath,
    isGz ? zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_COMPRESSION }) : buffer,
  );
  console.log(`Patched ${replaced} references in ${path.relative(datasetDir, filePath)}.`);
}
