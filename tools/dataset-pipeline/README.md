# Dataset Pipeline

This directory contains the CI-side GTNH dataset pipeline. It detects GTNH stable/daily
versions, invokes a real GTNH build/exporter runner, validates the normalized output, and
publishes only real generated datasets.

Responsibilities:

- Detect GTNH stable and daily versions.
- Download or locate a clean GTNH client/server build.
- Run the GTNH Calculation Oracle outside the browser and outside the deployed app.
- Normalize raw exporter output into the internal `RecipeDataset` model.
- Compress and checksum generated JSON.
- Publish datasets to the persistent dataset root, then expose them publicly at
  `/datasets/gtnh/<version>/`.
- Generate diffs between dataset versions.

The web app automatically reads `/datasets/gtnh/datasets.manifest.json` or the URL from
`NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL`. Private GitHub repositories are suitable for
pipeline source code and CI artifacts, but browser-readable datasets must be published to
a public/static location or served through an authenticated backend.

## GitHub Action

The repository includes `.github/workflows/gtnh-dataset-pipeline.yml`.

It currently:

- Runs automatically from `repository_dispatch` events named `gtnh-daily-published`,
  `gtnh-stable-published`, or `gtnh-version-published`. A dispatch payload can include
  `channel: "daily"`, `channel: "stable"`, or `channel: "both"` to limit detection.
- Polls GitHub every 30 minutes when no upstream dispatch is sent.
- Detects the latest stable release from `GTNewHorizons/GT-New-Horizons-Modpack`.
- Detects the latest successful daily build from `GTNewHorizons/DreamAssemblerXXL`.
- Creates one build job per detected channel.
- Installs a headless runtime with Xvfb for exporters that need a Minecraft client GUI.
- Runs `tools/dataset-pipeline/scripts/run-gtnh-oracle-export.sh` by default.
- Expects the exporter to write `recipes.json` to `$GTNH_DATASET_OUT_DIR`.
- Builds and injects `tools/dataset-pipeline/gtnh-calc-oracle`, a small Forge 1.7.10
  oracle mod that exports live GTNH registries and queues only actually referenced
  `ItemStack`/`FluidStack` PNGs in
  `$GTNH_DATASET_OUT_DIR/textures/rendered`.
- Extracts matched real PNG textures from the selected GTNH mods for any remaining
  resources into `$GTNH_DATASET_OUT_DIR/textures`.
- Rebuilds `datasets.manifest.json` in the configured dataset root.

Production uses the self-hosted runner path:

```bash
$HOME/data/gtnh-factory-flow/datasets/gtnh
```

Each deployed release symlinks `public/datasets/gtnh` to that directory. The dataset
volume is ignored by git; generated recipes and PNGs should not be committed.

`GTNH_CLIENT_EXPORT_COMMAND` can override the default runner. The override must run the
real selected GTNH build/exporter and produce a normalized `RecipeDataset`, not raw
exporter output and not a public dump.

`GTNH_PACK_LOCAL_ZIP` points the runner at an already-downloaded GTNH pack zip instead of
resolving and downloading one from upstream. This is intended for local runs against a
specific build (for example a beta the detector would not select), and it skips all
upstream version resolution.

The command receives:

- `GTNH_DATASET_OUT_DIR` - write normalized `recipes.json` here.
- `GTNH_RAW_EXPORT_DIR` - optional raw oracle output staging directory.
- `GTNH_INSTANCE_DIR` - optional GTNH client instance/cache directory.
- `GTNH_DATASET_VERSION_ID` - normalized id such as `stable-2.8.4`.
- `GTNH_DATASET_VERSION_LABEL` - upstream GTNH version label.
- `GTNH_DATASET_CHANNEL` - `stable` or `daily`.
- `GTNH_SOURCE_KIND`, `GTNH_SOURCE_REF`, `GTNH_SOURCE_URL` - detected upstream source.

If the runner fails or produces no recipes, the workflow fails before publishing. This is
deliberate: the site must not expose empty placeholder datasets as GTNH versions.

## Oracle Notes

The default exporter is the in-repo `gtnhcalcoracle` Forge mod. It launches inside the
selected GTNH runtime and writes a versioned `dev.gtnhplanner.oracle.v1` JSON export under
`GTNH-Calc-Oracle`. The Node normalizer consumes that oracle format directly; it does not
patch or depend on RecEx.

## Texture Icons

`apply-texture-icons.mjs` scans the selected instance's mod jars and uses only real PNG
assets from `assets/<modid>/textures/items`, `blocks`, and `fluids`. Matched icons are
copied under `/datasets/gtnh/<version>/textures/` and referenced through `iconPath`.

Before the static scan runs, the oracle mod queues stack/fluid icon keys while writing
oracle JSON. When `GTNH_RENDER_STACK_ICONS=true`, after the recipe JSON is complete the client
opens a temporary GUI screen, renders just those queued item/fluid icons in batches,
filters blank and Minecraft missing-texture outputs, reuses a shared cache across
stable/daily when the rendered filename key matches, then the Node pipeline publishes
the referenced PNGs as standalone files under `textures/icons/`.

Useful knobs:

- `GTNH_RENDER_STACK_ICONS=true|false` enables the Forge 1.7.10 exporter.
- `GTNH_ICON_EXPORT_BATCH_SIZE=64` controls how many icons are rendered per client frame.
- `GTNH_ATLAS_ICON_SIZE=256` controls the rendered icon size. The historical name is
  kept because the Minecraft renderer and cache already use it.
- `GTNH_ICON_CACHE_DIR=$HOME/.cache/gtnh-factory-flow/icons/<size>` stores rendered
  icons reused between stable and daily when the item/fluid key resolves to the same
  stack/fluid key. In CI it is mounted from the self-hosted runner's persistent
  `$HOME/data/gtnh-factory-flow/icon-cache/<size>` directory, so `actions/checkout`
  and Docker container cleanup cannot delete it between builds.
- `GTNH_ATLAS_MAX_SIZE` and `GTNH_ATLAS_KEEP_RENDERED` are legacy knobs for the old
  atlas packer. The default pipeline now removes `textures/rendered/` after writing
  `textures/icons/*.png`.
- `GTNH_RENDERED_ICON_DIR` is set by the runner and receives PNGs plus `icon-map.json`.

The scripts do not synthesize missing icons. If a stack cannot be rendered by the GTNH
client and no exact texture exists in the mods, that resource stays iconless.
