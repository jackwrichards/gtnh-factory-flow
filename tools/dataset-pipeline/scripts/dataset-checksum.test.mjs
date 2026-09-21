import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { computeDatasetChecksum } from "./dataset-checksum.mjs";
const folders = [];
afterEach(() => {
  for (const dir of folders.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it("invalidates cached API responses when only artwork or recipe bodies change", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dataset-checksum-"));
  folders.push(dir);
  const files = [
    "resource-index.json.gz",
    "recipe-index.json.gz",
    "recipe-lookup-index.json.gz",
    "recipes.json.gz",
  ];
  for (const file of files) fs.writeFileSync(path.join(dir, file), "original");
  const original = await computeDatasetChecksum(dir);
  expect(await computeDatasetChecksum(dir)).toBe(original);
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file), "updated");
    expect(await computeDatasetChecksum(dir)).not.toBe(original);
    fs.writeFileSync(path.join(dir, file), "original");
  }
  expect(await computeDatasetChecksum(dir)).toBe(original);
});
