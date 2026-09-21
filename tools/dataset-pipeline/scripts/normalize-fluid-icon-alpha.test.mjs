import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

const folders = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function fixture(alpha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluid-icon-alpha-"));
  folders.push(dir);
  const rendered = path.join(dir, "textures", "rendered");
  fs.mkdirSync(rendered, { recursive: true });
  fs.mkdirSync(path.join(dir, "recipes-shards"));
  const png = new PNG({ width: 4, height: 4 });
  for (const pixel of [5, 6, 9, 10]) {
    png.data.set([0, 31, 40, alpha], pixel * 4);
  }
  const original = PNG.sync.write(png);
  const basename = "oxygen-111111111111.png";
  const iconPath = `/datasets/gtnh/test/textures/rendered/${basename}`;
  const itemPath = "/datasets/gtnh/test/textures/rendered/item-111111111111.png";
  fs.writeFileSync(path.join(rendered, basename), original);
  fs.writeFileSync(path.join(rendered, "item-111111111111.png"), original);
  // A basename must match exactly, not the suffix of another fluid's name.
  const otherPath = "/datasets/gtnh/test/textures/rendered/liquid_oxygen-111111111111.png";
  const data = {
    resources: [
      { kind: "fluid", id: "oxygen", iconPath },
      { kind: "item", id: "item", iconPath: itemPath },
    ],
    recipes: [{ outputs: [{ kind: "fluid", id: "oxygen", iconPath }], unrelatedPath: otherPath }],
  };
  const artifacts = [
    "resource-index.json.gz",
    "recipe-index.json.gz",
    "recipe-lookup-index.json.gz",
    "recipes.json",
    "recipes.json.gz",
    "recipes-shards/00000.json",
    "recipes-shards/00000.json.gz",
  ];
  for (const file of artifacts) {
    const bytes = Buffer.from(JSON.stringify(data));
    fs.writeFileSync(path.join(dir, file), file.endsWith(".gz") ? gzipSync(bytes) : bytes);
  }
  return { dir, rendered, original, basename, iconPath, itemPath, otherPath, artifacts };
}
function run(dir) {
  return execFileSync(
    process.execPath,
    ["tools/dataset-pipeline/scripts/normalize-fluid-icon-alpha.mjs", dir, "--rename"],
    { encoding: "utf8" },
  );
}
function read(dir, file) {
  const bytes = fs.readFileSync(path.join(dir, file));
  return JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
}

describe("fluid icon repair for immutable texture URLs", () => {
  it.each([17, 51, 126, 195, 255])(
    "repairs or readdresses alpha %i captures in every artifact without losing old URLs",
    (alpha) => {
      const f = fixture(alpha);
      run(f.dir);
      const newPath = read(f.dir, f.artifacts[0]).resources[0].iconPath;
      expect(newPath).not.toBe(f.iconPath);
      const bytes = fs.readFileSync(path.join(f.rendered, path.basename(newPath)));
      expect(newPath).toContain(crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12));
      const png = PNG.sync.read(bytes);
      expect(png.data[5 * 4 + 3]).toBe(alpha < 51 ? 255 : alpha);
      expect(png.data[3]).toBe(0); // Keep the export's transparent padding.
      if (alpha === 17) expect(png.data[5 * 4 + 2]).toBeGreaterThan(100);
      else expect(bytes).toEqual(f.original); // Readable translucency and already-repaired pixels are preserved exactly.
      expect(fs.readFileSync(path.join(f.rendered, f.basename))).toEqual(f.original);
      expect(fs.readFileSync(path.join(f.rendered, "item-111111111111.png"))).toEqual(f.original);
      for (const artifact of f.artifacts) {
        const data = read(f.dir, artifact);
        expect(data.resources[0].iconPath).toBe(newPath);
        expect(data.recipes[0].outputs[0].iconPath).toBe(newPath);
        expect(data.resources[1].iconPath).toBe(f.itemPath);
        expect(data.recipes[0].unrelatedPath).toBe(f.otherPath);
      }
      const snapshots = f.artifacts.map((file) => fs.readFileSync(path.join(f.dir, file)));
      expect(run(f.dir)).toContain("0 URLs refreshed");
      f.artifacts.forEach((file, i) =>
        expect(fs.readFileSync(path.join(f.dir, file))).toEqual(snapshots[i]),
      );
    },
  );
});
