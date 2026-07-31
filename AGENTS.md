# AGENTS.md

Working notes for future agents on GTNH Factory Flow.

## Project Shape

- App: Next.js App Router, TypeScript strict mode, Tailwind, React Flow, Zustand, Zod, Vitest.
- Domain model lives under `src/lib/model/`; solver logic lives under `src/lib/solver/`.
- Dataset tooling lives under `tools/dataset-pipeline/scripts/`.
- Raw exporter data must be normalized before it reaches UI or solver code.
- UI recipes are read-only. Do not add manual recipe editing unless explicitly requested.

## Branches, Deploy, Dataset

- Default working branch for feature work is `develop`.
- `main` is production. Push/merge there only when the user asks for main/prod deployment.
- `https://dev-gtnh.samiracle.fr/` is the develop deployment.
- `https://gtnh.samiracle.fr/` is production.
- Pushing code can deploy the app, but dataset changes require the dataset pipeline.
- To regenerate both datasets:

```bash
gh workflow run "GTNH dataset pipeline" --ref develop -f channel=both -f publish=true -f force_rebuild=true
```

- Watch long runs instead of assuming success:

```bash
gh run watch <run-id> --exit-status
```

- After imports, verify the published manifest and, when relevant, inspect the published gzipped dataset, not only CI status.
- Stable and daily both matter. If the user says relaunch/import dataset, usually run both unless they explicitly narrow it.
- The server should be prewarmed on startup. Slow first API calls usually mean prewarm/deploy service behavior regressed, not that the client should wait longer.

## Dataset Import Principles

- Prefer data exported from NEI/RecEx/runtime over manual fallback tables.
- Avoid broad fallback logic on `dev`; the user explicitly wants bad fallback noise removed.
- Do not parse arbitrary tooltips globally. Tooltip parsing is acceptable only when scoped to reliable objects, especially multiblock controllers exported with `mb`.
- RecEx patching for multiblock detection is in `tools/dataset-pipeline/scripts/patch-recex-autorun.mjs`.
- Normalization of RecEx exports is in `tools/dataset-pipeline/scripts/normalize-recex-export.mjs`.
- `mb` means the exported item is a multiblock MetaTileEntity. Use this to scope multiblock parameter parsing.
- Machine catalysts/handlers should come from NEI/runtime data, not hand-written category lists.
- Machine family merging should fold tier variants together:
  - Example: Fluid Extractor includes tiered Fluid Extractors, Liquefying Suckers, and Large Fluid Extractor as the same recipe family where the dataset supports it.
  - Example: Centrifuge should fold tiered centrifuge variants and leave distinct real families such as Steam Separator.
- If there is only one real machine family in a recipe group, keep the recipe map/base name as the primary visible name.

## Ore Dictionary And Concrete Items

- Concrete items must carry ore dictionary membership in the dataset.
- Uses for a concrete item must include:
  - exact concrete recipes, e.g. `item:spruce_log`
  - compatible oredict recipes, e.g. `item:oredict:logWood`
  - explicit alternatives containing that concrete item
- When a user opens recipes/uses from a concrete item, preserve that concrete context in rendered slots.
- Oredict recipes selected from a concrete item must render/link as that concrete item when compatible. Spruce Log must not silently become Oak Log after node creation, refresh, or reload.
- Tooltips should not show noisy ore dictionary internals when the node was created from a concrete item context unless that is explicitly useful.
- Resource matching/handles must use the effective rendered recipe/resource, including concrete oredict overrides, not only the raw recipe.

## NEI Layout And Slots

- Prefer NEI-exported slot positions and progress bars over reconstructed layouts.
- Empty NEI slots still matter and must remain visible.
- Non-consumed slots (`NC`) should stay visible generally; only hide `NC` for specific cases explicitly requested, such as TGS tool placeholders.
- Do not replace real slots with `"..."`, `"-"`, or fake labels when a concrete item context exists. Render the actual selected alternative.
- Arrows/progress indicators should come from the NEI layout when available.
- Recipe book search must query the API, not only filter the first loaded page. Pagination must continue beyond the first page, especially for cases like Coke Oven charcoal/nitrogen recipes.

## Machine Configs And Multiblocks

- Machine config controls are structured data, not frontend hardcoding. Use `machineConfigControls`.
- Existing supported tier effects include:
  - `parallelMultiplier`
  - `durationMultiplier`
  - `eutMultiplier`
  - `outputMultiplier`
  - `heat`
- Multiple config dimensions can stack on one node. Do not model `coilTier` and `pipeCasingTier` as mutually exclusive.
- Keep legacy `coilTier` compatibility, but prefer generalized `machineConfigTiers`.
- Show the parallel slot as a non-clickable slot when imported parallel count is greater than 1; keep it as the rightmost config slot.
- Disable tier controls when the selected machine/handler is not affected by voltage tier.
- Manual/instant crafting tables without time/tier behavior should not appear as timed machine choices.
- If no duration is available for a manual/instant machine, treat it as instant rather than inventing fake `0 EU / 1s` timed behavior.
- Pyrolyse Oven coil behavior comes from multiblock tooltip/code formula: `Speed is 50% times Coil Tier`, exported as a `heatingCoil` control with `durationMultiplier`.
- Industrial Coke Oven / other multiblocks can have casing-based parameters. Parse them only from multiblock-scoped exported data.
- Mega/Dangote-style machines may define fixed high parallel counts. These should be represented in machine config output.
- TGS is special:
  - Output is affected by voltage tier and selected tools.
  - If no relevant tool is selected for an output category, multiplier is effectively zero.
  - Tool choices are per empty TGS input slot; each slot should offer the valid tool categories through an icon menu.
  - TGS tool icons should be real item icons, not text labels.

## Frontend State And Recipe Context

- Node creation from recipe book must preserve selected context/resource overrides.
- Refresh/reload must not re-resolve oredict slots back to the first alternative.
- Changing a machine config such as TGS tools must not drop unrelated links or resource overrides.
- When selected handler changes through the machine dropdown/multi-arrow UI, carry handler-specific tier/config behavior with it.
- Images/icons in recipe nodes should use dataset resources/atlas paths. If they exist in prod but not dev, suspect deployment/static asset path/build mismatch before changing recipe logic.

## Routing Links

- Link routing must be deterministic for the same graph state, independent of zoom level.
- Route candidates should be scored; avoid hardcoded special-case paths.
- Score priorities:
  - heavily penalize self-folding/backtracking routes
  - minimize pixels crossing node/card rectangles
  - avoid passing close to other links, with roughly an 8 px clearance target
  - minimize intersections with other links
  - minimize turn count
  - minimize total path length
- Tie-breaking must be stable. Sort/index links before solving so zoom/dezoom or render order does not change chosen paths.
- Top vs bottom exits/entries should be chosen by scoring, not fixed to always top.
- Drawers/storage nodes can enter/exit from top or bottom when that gives a better score.

## Import/Export Plans

- Plan import/export must preserve item/fluid identity. `fluid.*` showing in UI usually means fluid IDs were imported without resolving display resource metadata.
- When importing image-embedded or JSON plans, preserve node recipe overrides, selected machine handler, tier/config selections, and concrete oredict alternatives.
- Creating a storage/drawer by dragging from a recipe slot must create both the storage node and the edge.

## Performance

- Performance is a first-class requirement, especially on the flow board. Read
  `ARCHITECTURE.md` (root) before touching board, routing, or rendering code —
  it documents the invariants (viewport-independent routing, published
  geometry, content-keyed cache invalidation, identity reuse, frozen drags,
  localized route scoring) and the Playwright + CDP profiler stress workflow.
- Anything O(nodes) per frame is suspect; anything O(nodes × edges) per frame
  is a bug. No DOM measurement per edge/per frame. Hover must not rebuild the
  board.
- Perf-sensitive changes need a before/after check with the stress workflow,
  not just green tests.

## Verification

- For code changes:

```bash
npm run typecheck
npm run test
```

- Run targeted synthetic dataset checks for normalizer changes when possible.
- For frontend behavior, use browser/Playwright screenshots when the bug is visual or interaction-based.
- For dataset changes, verify actual published `recipes.json.gz` or indexes after pipeline publish.

## Git Hygiene

- The worktree may contain unrelated/untracked files. Do not include them unless the user asked.
- Known local files that have appeared and should usually be ignored:
  - `platline-v4-1.generated.json`
  - `platline-v4-1.link-report.txt`
  - `platline-v4-1.linked.json`
  - `tools/import-export-public.mjs`
- Commit and push completed requested code changes unless the user explicitly says not to.
- Never reset or revert unrelated user changes.

