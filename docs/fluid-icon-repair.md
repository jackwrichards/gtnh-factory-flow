# Repairing faint fluid icons without Minecraft

The existing exported PNGs contain the fluid color and texture. Repair them with:

```powershell
node tools/dataset-pipeline/scripts/normalize-fluid-icon-alpha.mjs public/datasets/gtnh/local-2.9.0-beta-2 --rename
```

Always use `--rename` for a version that has been served before. Texture URLs are
cached as immutable for a year. This option gives all referenced rendered fluid
icons filenames derived from their current bytes, including opaque images that
were previously repaired in place. Old PNGs remain available for cached plans.
The pass updates the resource index, recipe artifacts and shards. Repeating it
leaves the resulting files unchanged. Item artwork is not normalized.

`generate-dataset.mjs` uses this mode too. Manual WSL rebuilds must copy the current
scripts into the snapshot and run this step after building indexes and before
publishing; do not just copy the raw rendered-icons directory over repaired art.

The manifest checksum must also change. `rebuild-manifest.mjs` now uses
`dataset-checksum.mjs` to fingerprint the resource index, recipe index, lookup
index and full recipes. Previously it hashed only the lookup index, so icon-only
changes left the immutable API URLs unchanged.

For publishing (only after an explicit request):

1. Back up the published dataset artifacts and manifest.
2. Upload the newly named PNGs first, then the changed compressed artifacts and
   shards, to `/opt/shared/gtnh-datasets/<id>/`.
3. Copy both `rebuild-manifest.mjs` and `dataset-checksum.mjs` to the server's
   pipeline scripts, rebuild its manifest, and restart `gtnh-flow`.
4. Verify the live manifest checksum, oxygen/hydrogen resource and recipe paths,
   and the pixels of the newly referenced PNGs. Existing URLs should still work.

Only 2.9 is supported. Do not run manifest discovery over a local root containing
retired 2.8.4 and publish that manifest. For a local repair, update only the existing
supported entry using `computeDatasetChecksum(datasetDir)`; leave the version list
unchanged. Localhost may proxy datasets to production through
`GTNH_DATASET_BACKEND_URL`, so repairing local files alone does not necessarily
change what its browser serves.
