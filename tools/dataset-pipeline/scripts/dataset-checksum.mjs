import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/** Include resource art and recipe bodies, not just the resource-to-recipe lookup. */
export async function computeDatasetChecksum(datasetDir) {
  const hash = createHash("sha256");
  for (const name of [
    "resource-index.json.gz",
    "recipe-index.json.gz",
    "recipe-lookup-index.json.gz",
    "recipes.json.gz",
  ]) {
    // Hash each artifact separately so boundaries are unambiguous and memory
    // stays bounded even for the full recipe dataset.
    const artifact = createHash("sha256");
    for await (const chunk of createReadStream(path.join(datasetDir, name))) artifact.update(chunk);
    hash.update(name).update("\0").update(artifact.digest());
  }
  return hash.digest("hex");
}
