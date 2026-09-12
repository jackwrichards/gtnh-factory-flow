# AGENTS.md

Working notes for future agents on GTNH Factory Flow.

## Project Shape

- App: Next.js App Router, TypeScript strict mode, Tailwind, React Flow, Zustand, Zod, Vitest.
- Domain model lives under `src/lib/model/`; solver logic lives under `src/lib/solver/`.
- Dataset tooling lives under `tools/dataset-pipeline/scripts/`.
- Raw exporter data must be normalized before it reaches UI or solver code.
- UI recipes are read-only. Do not add manual recipe editing unless explicitly requested.

## Branches, Deploy, Dataset

- App version lives in `src/lib/version.ts` (`APP_VERSION`) and renders as a
  chip in the header. ONE bump per RELEASE - a deploy to the live site - never
  one per commit. Minor for a release carrying features (1.1.0), patch for one
  that is only fixes (1.0.1).
  - Check what `https://gtnhplanner.com/api/version` reports before bumping.
    Behind `version.ts` means the release has not shipped yet: fold the new
    work into the top changelog entry and leave the number alone. Equal to
    `version.ts` means everything is live, so this is a new release: bump, and
    open one new entry.
- THE CHANGELOG IS BACK ON THE CHIP (Jack, 2026-09-09: players went looking
  for what's new and found nothing to press). It was deleted on 2026-09-08
  and `ChangelogDialog.tsx` is restored from that commit. A plain click on
  the header's version chip opens it, shift-click still opens the dev menu,
  and the chip wears a DOT for a shipped release whose notes this browser
  has not opened. The sheet opens on the releases this reader missed and
  keeps the rest behind "Full history"; `src/lib/changelog.ts` is what it
  reads, so every release still needs its entry, same rules as before.
  There is no What's new button on the right of the bar - the chip is the
  one door, and two labelled buttons made the bar too wide.
  - THE DOT HAS ITS OWN STAMP, `changelog-read.v1`, written ONLY by opening
    the notes. It cannot read `last-seen-version.v1`: the release notice
    writes that on every load, so the very load that should have raised the
    dot would have put it out first. A first visit stamps silently and shows
    no dot - somebody who has never seen the app does not want a history.
- What ANNOUNCES a release is the NOTICE, `src/lib/release-spotlight.ts`
  plus `ReleaseSpotlight.tsx`: a window that arrives ONCE, on the first visit
  after a release, carrying a line per change (icon plus a spec-sheet TITLE,
  no sentences) and a close key. A release with no entry in
  `RELEASE_SPOTLIGHTS` shows nothing at all, which is the per-release opt-in.
  A brand new browser never sees one; a returning one does; closing it files
  it in `seen-spotlights.v1` and it never returns. The number it prints
  (`release: "3.0"`) is hard coded per notice. Preview it from the dev menu's
  "Release popup". Its own file carries the writing rules; read them before
  touching the copy.
- `main` is the ONLY branch, by explicit decision (2026-08-19): all work lands
  on it, and stale feature branches were deleted after verifying main carried
  every patch. Do not accumulate long-lived branches; the unmerged
  reachability-wizard work survives as the tag `archive/reachability-wizard`.
- Pushing `main` does not deploy gtnhplanner.com by itself; deploys are asked
  for explicitly.
- CI (`.github/workflows/ci.yml`) runs typecheck + the full vitest suite on
  every PR and push to main. The suite is expected GREEN; there are no
  tolerated failures. A test pinning player-facing copy must be updated in the
  same change that rewords the copy.
- `https://gtnhplanner.com/` is production for this repo.
- `origin` is `jackwrichards/gtnh-factory-flow` (this project). `upstream` is
  `Samiracle64/gtnh-factory-flow`, the repo this was originally forked from -
  it is not a push target and the two have long since diverged.
- Pushing code can deploy the app, but dataset changes require a dataset
  rebuild - and the GitHub "GTNH dataset pipeline" workflow is a DECOY, like
  the deploy workflows: the repo has no self-hosted runner, so every run
  queues until the next half-hourly cron supersedes it. Established
  2026-08-23; do not dispatch it and wait.
- Datasets are really rebuilt by hand in this PC's WSL (Ubuntu):
  - `~/gtnh-factory-flow` is a git-less SNAPSHOT of the repo. Copy any
    changed pipeline scripts into it first or the rebuild runs old code.
  - Raw oracle exports (the expensive Minecraft part, reusable as long as
    the pack versions stand) live at
    `~/gtnh-factory-flow/.pipeline/raw-export/<id>/oracle-export.json` with
    `rendered-icons/` beside them.
  - `~/run-both.sh` (and the fuller `~/rebuild-cokeoven.sh`) run
    normalize-oracle-export.mjs, build-resource-index.mjs,
    build-recipe-index.mjs (recipe index + lookup index + shards), then gzip,
    into `~/gtnh-export/datasets/gtnh/<id>` (2.9) and
    `~/gtnh-export/datasets-284/gtnh/<id>` (2.8.4).
  - 2.8.4 support is DROPPED (Jack, 2026-08-26): only 2.9 is supported. Its
    dataset was retired from the droplet to
    `/opt/shared/gtnh-datasets-retired/` and removed from the manifest and
    the systemd prewarm. Do not rebuild, republish, or re-prewarm it.
  - `~/copy-datasets.sh` copies the results into the Windows repo's
    `public/datasets/gtnh`.
  - Publish: scp the changed files (gzips, shards, oracle-report) to the
    droplet's `/opt/shared/gtnh-datasets/<id>/`, rebuild
    `datasets.manifest.json` with rebuild-manifest.mjs, then
    `systemctl restart gtnh-flow`. Only textures are cache-immutable, so
    replacing dataset gzips in place is safe.
- After a publish, verify the live manifest and, when relevant, inspect the
  published gzipped dataset, not only local output.
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

## Cells Are Items

- A filled cell is an ordinary ITEM. It does not satisfy its fluid's slot, and
  the fluid does not satisfy the cell's. `resourceMatchesInput` compares kinds
  strictly; do not reintroduce a cross-kind branch.
- Crossing the two forms takes a machine on the board, exactly as it does in
  game. There are ~4,000 Canner recipes in the dataset (~1,150 fill, ~1,150
  empty), so the bridge is always a placeable machine, and GT registers ~3,000
  recipe shapes in BOTH forms so most chains just need the matching variant.
- The TANK (Jack, 2026-08-23) is the free version of that bridge: the
  pipeline mirrors every fluid-touching Canner recipe into a synthesized
  "Tank" map (`addTankRecipe` in `normalize-oracle-export.mjs`) at 0 EU and
  1 tick - the same "instant" shape hand-crafting wears, machine count still
  scales it. It keeps the REAL slots, empty cells included: the game never
  deletes an emptied cell and neither does the planner. It waives only the
  Canner's power and time. Do NOT go further than this by default - an
  auto-inserted converter that discarded empty cells was designed and
  rejected in the same session.
- LOOSE CELL WIRES is the one step beyond it, ALWAYS ON since 2026-09-06
  (it was an opt-in rule in the setup-rules sheet, which is gone; see "The
  Three Modes"): a filled cell and its fluid wire
  straight together, EITHER WAY ROUND - cell output onto fluid input, fluid
  output onto cell input - and the gesture behaves like any compatible pair
  (green wash, whole-card drops, drags started from either end). The wire
  itself is still same-kind (its resource is the SOURCE's own form; the far
  form is named by its target handle) and carries the Canner's
  litres-per-cell on `edge.crossForm`, fetched at wire time - no ratio
  found, no wire. `getCrossFormCellMatch` in resources.ts is the one
  pair-matching question. The solver bridges the forms through a hidden free
  Tank (`expandCrossFormEdges` in throughput.ts, converting whichever way
  the wire runs) that never reaches the board or the result.
  `resourceMatchesInput` stays strict; the rule lives in the gesture
  (`handleConnect` / `isCompatibleResourceConnection`, plus the whole-card
  drop path `findNodeDropTargetOnSide` / `isCompatibleDraggedResourceTarget`
  / `handleConnectEnd` - drawers stay strict), edge survival
  (`isFactoryEdgeStillValid`, `dropCrossFormConnections`), and the
  expansion - nowhere else. The pair-match reuses the search's name-tolerant
  `isFluidEquivalentToFilledCell` (fluid ids rarely spell their names:
  "Molten Cast Iron" is `molten.castiron`); a false name match still wires
  nothing because the ratio fetch looks the pair up by exact ids. Residual
  quirk: a same-named different-id fluid (TCon `iron.molten` vs GT
  `molten.iron`) can wash green during the drag and then refuse silently
  when no Canner recipe links the exact pair.
- The old behaviour auto-converted at a guessed 1000 L per cell. It made chains
  look complete while omitting a real machine, empty cells and the power to run
  them, and it reported item production in litres. It also inflated cell inputs
  1000x. All of that is gone; do not rebuild it.
- The ONE surviving cross-form rule is SEARCH: `getFilledCellFluidEquivalent`
  and `isFluidEquivalentToFilledCell` widen what the recipe book shows. They
  wire nothing and convert no amounts, and carry no litres-per-cell ratio.
- `dropCrossFormConnections` in `project-normalize.ts` drops legacy cross-form
  wires and slot overrides on load. It compares KINDS only, never ids, because
  a slot legitimately carries an id the edge does not (oredict, chosen
  alternatives) and matching on id would delete honest wires.
- Note for anyone tempted by the Fluid Canner indexing that used to live in
  `build-resource-index.mjs`/`enrich.ts`: it matched `recipeMap === "Fluid
  Canner"` while the dataset says `"Canner"`, so it produced zero links in
  every published dataset. It was removed as dead code, not as a behaviour
  change.

## NEI Layout And Slots

- Prefer NEI-exported slot positions and progress bars over reconstructed layouts.
- Empty NEI slots still matter and must remain visible.
- Non-consumed slots (`NC`) should stay visible generally; only hide `NC` for specific cases explicitly requested, such as TGS tool placeholders.
- Do not replace real slots with `"..."`, `"-"`, or fake labels when a concrete item context exists. Render the actual selected alternative.
- Arrows/progress indicators should come from the NEI layout when available.
- Recipe book search must query the API, not only filter the first loaded page. Pagination must continue beyond the first page, especially for cases like Coke Oven charcoal/nitrogen recipes.

## The Recipe Search (One Screen)

- The recipe book popup is `RecipeSearchOverlay.tsx`: results over a detached
  STENCIL card (takes on the left, makes on the right). Each side reads
  ANY / ALL / ONLY, ALL the default: any = touches one of these, all = every
  one of them with extras allowed, only = exactly these and nothing else.
  ONLY's nothing-else half is verified against recipe bodies server-side
  (`recipeIsOnlyMatch`), capped at `ONLY_VERIFY_LIMIT` candidates - past the
  cap it degrades to all. Non-consumed inputs (circuits, catalysts) never
  count against takes-ONLY. There is no NEI canvas in it, no makes/uses
  mode switch and no category rail - machine chips with counts do that job,
  "All" (every map at once) being the default. Left click on an item
  anywhere still opens it with one MAKES condition, right click one TAKES;
  `browseResource`/`clearResourceBrowser` remain the only doors in and out,
  and `RecipeBrowser.tsx` still owns all query state (the stencil is edits
  keyed by the browse that seeded them, so a new browse always starts over).
- A query is `clauses` (`role:kind:id` wire form, `recipe-query.ts`) plus
  `takesOp`/`makesOp`/`allMaps` on the same recipes API. The server side is
  set algebra over the lookup index (`getClauseLookupRecipesByMap`): any =
  union, all = intersection, sides intersect. Every clause resource gets the
  concrete-context rewrite (`applyClauseResourceContexts`), and the legacy
  resource+mode wire form is exactly a one-clause query.
- The machine chips are a MULTI-SELECT (Jack, 2026-08-23): every map is
  selected by default, a chip click toggles just that map, and All is
  select-all/select-none - unselecting one map unlights All but keeps the
  rest. The selection persists (`gtnh-factory-flow.machine-map-selection.v1`,
  exclusions survive searches where the map never appears) and rides the
  recipes API as `mapMode=exclude|include` plus repeated `map=` params;
  the map list and per-map counts always cover everything that matched, so
  an unselected chip keeps its count. There is no per-map scoping any more
  and no crafting-map special case: Shaped/Shapeless Crafting are ordinary
  maps whose machine is GT++'s Auto Workbench, synthesized in
  `recipe-rules.ts` (LV seed 64t/32EU; the "Auto Workbench" machine-table
  entry caps its perfect overclocks at EV's one craft per tick - transcribed
  from MTEElectricAutoWorkbench: flat 2048 EU per craft), with the instant
  hand-craft as the second handler. Purging the crafting maps from the
  dataset itself is a pipeline decision that has NOT been made.
- Result cards merge duplicate slot entries (nine planks is one line, x9) and
  oredict slots wear their first concrete face; both are display-only.
  Chips that satisfy a stencil condition ring cyan; chips browse on
  click/right-click like port rows. The stencil's arrow SWAPS the two sides.
- WHERE AN ADD LANDS: every spawn runs `nearestFreeSpot` over
  `projectBlockerRects` (cards, drawers, minimized board cards, and open
  frames as whole rects - nothing spawns inside a board uninvited) and the
  camera flies to it (`boardFocusRequest`). An add whose browse came from a
  card's PORT (`anchorNodeId`) goes through `addConnectedRecipeNodeToState`:
  beside the anchor, upstream when the click asked who makes, and WIRED on
  the clicked resource alone (`buildResourceEdgesBetweenNodes`) - never on
  byproducts, and not at all when the pick no longer touches that resource.
- HISTORY (Jack, 2026-09-02): the search keeps BACK and FORWARD stacks in
  the store (`recipeBrowserBack` / `recipeBrowserForward`, `browseBack` /
  `browseForward`). Every page change while it is open - a chip click, a
  refactor press - files the page it replaces; a fresh browse drops the
  forward branch like a browser; asking for the page already open files
  nothing; closing the search clears both. Buttons sit by the name filter
  (head row start on a phone); Alt+Left / Alt+Right walk them, and a bare
  Backspace outside a text box goes back too.
- A result card's MACHINE TILE is a key: click hides that machine's recipes
  (the same toggle as darkening its chip; a generator card's tile hides the
  Generators chip). Right click the card - or hold the tile on a finger -
  for the card menu: add to board, hide these, only these
  (`onSelectOnlyRecipeMap`, an include-selection of one map), show every
  machine. `useLongPress` in the overlay is the one held-press rule, shared
  with the chips.
- The tier ceiling filters GENERATOR cards too, by their `unlock` chip
  (`powerUnlockWithinTier`); a source with no tier chip is never filtered.
- The search SOUNDS, the one screen off the canvas that does (Jack asked,
  2026-09-02; the "canvas only" rule in the sounds memory stands everywhere
  else): `pageOpen` on mount, `pageTurn` on every browse-key change (chip,
  refactor, back, forward), `pageClose` only on the close paths (an add
  closes silently - the card landing is its sound), `tick` for every switch
  (machine chips, All, rate pills, any/all/only, tier select, swap),
  `stencilAdd` / `stencilRemove` for conditions. All brush-first and quiet.
- REFACTOR: the card header's refresh button (`beginRecipeRefactor`) reopens
  the search seeded with every consumed input and every output of that card,
  and the add REPLACES the card in place (`refactorNodeWithRecipe`): wires
  whose resource still has a port on the new recipe re-dock onto its slots,
  the rest drop, position/count/board stay. When NO wire would survive, the
  old card stays and the pick lands beside it instead. All one undo step.

## Machine Configs And Multiblocks

- Electric singleblock tiers come from the oracle's actual catalysts. Group
  voltage-input singleblocks by exported Java class plus their explicit
  `Machine Type` tooltip; use the lowest-tier item's family name. Display
  names change within one family (Chemical Reactor becomes Chemical Performer
  at UV), so stripping Basic/Elite/Epic alone splits the real progression.
  The 2.9 export and GT5U registration code end that family at UMV's Epic
  Chemical Performer IV, not ZPM and not MAX. GTNH's global ordinal sequence
  is UIV, UMV, UXV, MAX; OpV is only a legacy spelling, not an extra ordinal.
  `machine-configs.mjs` exports the pipeline's shared voltage list. Keep a
  lone capped singleblock handler when normalizing, or its `maximumTier`
  disappears. Both calculated and runtime-exported overclocks honor that cap;
  the generic OverclockCalculator's longer ladder does not create machines.
  See `tools/dataset-pipeline/scripts/singleblock-tiers.test.mjs` and its real
  catalyst fixture. Multiblocks and steam machines keep separate identities.
  `availableTiers` carries every registered singleblock voltage into handlers,
  effective recipes and saved plans. Both the UI and solver must use it:
  Cold Trap and Reactor Processing Unit have IV and ZPM blocks but no LuV.
  Do not interpolate nonexistent intermediate machines. The full 53-map
  fixture and `docs/singleblock-tier-audit.md` cover all 53 exported electric
  processing families, including Circuit Assembler's real MAX endpoint.
  Furnace's smelting adapter must preserve the electric template's tier
  metadata when replacing its base stats. A multiblock whose name collides
  with a singleblock gets a distinct ID across maps (Ore Washing Plant);
  never apply the singleblock name aliases to an explicit multiblock handler.
  When a voltage-input singleblock omits Machine Type, use its exported
  recipe-map membership with its class: Basic and Chemical Dehydrator are
  one MV–ZPM chain, confirmed by GregtechDehydrator's identical backend/slots.
- Machine BEHAVIOUR (speed, EU discount, parallels, overclock style) comes from
  the curated table in `src/lib/machines/machine-table.ts`, transcribed from
  ShadowTheAge's MIT calculator (`https://github.com/ShadowTheAge/gtnh`,
  `src/machines.ts`), which was verified against the mod source machine by
  machine. The table wins over anything the dataset scraped. Machines absent
  from it fall back to the dataset, so partial coverage is safe.
  - Do NOT add entries by guessing. Transcribe from the reference and note the
    two indexing differences: their voltage tiers start at LV = 0 (ours at
    ULV = 0, so their `voltageTier + 1` is our ordinal), and their `speed` is a
    throughput multiplier while we store a duration multiplier (`1 / speed`).
  - EVERY entry is machine-checked against
    `src/lib/machines/__fixtures__/reference-coefficients.json`, which is the
    reference's own definitions evaluated over a grid of tiers and choices.
    `machine-table.test.ts` documents how to regenerate it. Add an entry, run
    that test, and it will tell you if the transcription is wrong. Two earlier
    hand-ports had silent errors that this caught.
  - A table entry may declare `controls`, which are ordinary
    `MachineConfigControl`s merged over the dataset's, so a machine can offer a
    knob the dataset has none for (electrodes, sawblades, anvils) and the
    existing config UI renders it unchanged.
  - `ctx.tier(id)` is the option's position; `ctx.value(id)` is the number
    behind a count knob (laser amperage, parallels). The reference states some
    choices as raw counts with a minimum, and its formulas read the count, so
    those must use `value`.
  - Fusion reactors use `src/lib/machines/fusion.ts`, independently of the
    generic voltage overclocker: fixed reactor tier, 2/2 OCs on I-III,
    4/4 on IV-V, capped by reactor mark minus recipe fusion tier. Compact
    reactors have 64 base parallels and startup-dependent extraPara bonuses.
    Startup charging is excluded from steady-state EU/t but its threshold
    remains essential for eligibility AND compact parallels (strict < bonus
    boundaries, inclusive <= tier boundaries). `metadata.fusionStartupEu`
    is exported from FUSION_THRESHOLD, not mSpecialValue; exact runtime
    recipe fingerprints in `machines/data/fusion-startups.json` repair old
    exports/plans. Regenerate with `tools/audits/extract-fusion-startups.mjs`.
    NEVER strip Roman numerals from fusion controller names: I/II/III and
    IV/V are separate machines. Fusion hatch controls are fixed; EU/t draw
    remains visible. Draconic Evolution Fusion Crafter is unrelated.
  - Still on scraped data, deliberately: the machines whose
    coefficients read recipe metadata or the recipe type (Nano Forge, PCB
    Factory, Component Assembly Line, QFT, Eye of Harmony).
    PrAss is now curated in both modes; see below. The Naquadah Fuel Refinery
    graduated off that list: its recipe metadata is the special value (the
    minimum field restriction coil tier), which `ctx.recipeSpecialValue`
    now carries into the table, and a control may declare
    `minimumFromSpecialValue` to make the recipe's special value its
    per-recipe minimum tier.
  - Steam machines are handled in code, not scraped. The 8 steam multiblocks
    (Steam Grinder/Squasher/Separator/Purifier/Presser/Blender/Fuser/Hearth)
    are table entries: `1.6 / tierMachine` duration, 8 parallels, no
    overclock, a shared `steamPressure` control (bronze/high pressure).
    Steam SINGLEBLOCK handlers export no stats, so `recipe-rules.ts`
    synthesizes bronze x2 / high pressure x1 duration. Smelting seeds from
    GT's fixed 128t/4EU furnace recipe, not the exported 200t/0EU vanilla
    smelt (the Hearth's odd 0.9765625 speed constant is that, pre-divided).
    Steam LITRES are `getNodeSteamReport` in power-report.ts: singles pay
    2 L/EU at (x1 bronze / x2 HP) EU, multis pay 1 L/EU on
    `recipe EU x 1.25 x tierMachine` per parallel. EU stays zeroed on steam
    cards; do not bill both.
  - The dataset pipeline BAKES its scraped multipliers into each handler's
    own `durationTicks`/`eut` (a Volcanus handler carries the EBF recipe
    pre-multiplied by x0.8/x0.9; the steam multis' bake was outright wrong,
    the tooltip's HP figure). `machineTableSeedsFromBase` therefore makes
    every table machine that declares `speed` or `power` ignore baked handler
    stats and seed from the recipe's base. Entries WITHOUT speed/power (Multi
    Smelter) keep handler stats - the Electric Furnace family's are ABSOLUTE
    (128t/4EU) and correct.
  - Tooltip scraping in `tools/dataset-pipeline/scripts/machine-configs.mjs`
    still supplies the control DEFINITIONS (which knobs exist, their icons and
    tier lists). It should no longer be trusted for effect VALUES: it once
    stamped a heat capacity on every coil, which handed four machines
    overclocks they do not get.
- Dangote Distillus is curated in both modes (`dangote-distillus.test.ts`),
  selected by the original `source.recipeMap` carried into `MachineContext`.
  MTEAdvDistillationTower gives Tower mode 12 parallels and 3x speed, while
  Distillery mode gets 2x speed, 15% EU and 8 parallels per summed-voltage
  ordinal assuming the maximum 12-layer height. Ordinary hatches may stack;
  multi-amp/laser hatches are unsupported. Old baked handler stats and fixed
  parallel controls must not override this, nor may runtime ladders hide amps.
- Parallels are paid for with power BEFORE overclocks, and only the leftover
  voltage buys overclock steps. See `src/lib/solver/overclock.ts`. Heat
  overclocks belong to the Electric Blast Furnace, Volcanus, the Exothermic
  Hearth and the Utupu-Tanuri (our "Multiblock Dehydrator") and nothing else.
- A recipe runs in WHOLE TICKS. Over one tick GT truncates, which favours the
  player. Under one tick a multiblock banks the leftover speed as parallels
  while a singleblock wastes it, so duration is only floored at 1 for
  singleblocks. `canSubTick` in `overclock.ts` decides, and note the trap it
  documents: when a recipe carries no handlers, `getRecipeMachineHandlers`
  invents one stamped `kind: "single"` as a placeholder, which is NOT evidence.
- Recipes carrying `runtimeCalculation` are NOT authoritative for multiblocks.
  That export is the game's `OverclockCalculator` alone; it never saw
  `GTParallelHelper`, so all 202,322 of them say `parallel: 1` and 145,231
  flatline at one tick. `prefersCuratedMachineMath` makes the curated table win
  for machines it covers. Everything else still uses the runtime data.
- A special value of 0 can be a REAL heat requirement, not a gap: dehydrator
  recipes start from 0 K. Do not reintroduce a `specialValue > 0` guard; the
  machine list is what keeps heat off machines with no heat mechanic.
- Where the reference punts and the wiki gives a real mechanic, follow the
  wiki. It asks the player for the Utupu-Tanuri's heat difference because it
  cannot read the requirement, and spends it as speed; the wiki says energy
  discount plus perfect overclocks, and that is what we implement. Machines
  that diverge on purpose are listed in `machine-table.test.ts`.
- Machine config controls are structured data, not frontend hardcoding. Use `machineConfigControls`.
- HILE's `laserSource` is one real voltage/amperage hatch choice (`hile.ts`),
  replacing the duplicate `laserAmperage` knob. Source amps give floored
  cube-root parallels; source tier + 1 independently gates recipes and caps
  overclocks. It supplies no operating power. Glass is assumed to match the
  source tier. Legacy amperage-only choices resolve to the lowest registered
  source tier carrying those amps; do not infer its voltage from energy hatches.
- PrAss is curated in two modes: `Precise Auto-Assembler MT-3662` is the normal
  Assembler handler (2x speed; Imprecise/Mk-I..IV unit casings give 16..256
  parallels), while `Precise Assembler` is the dedicated precise recipe map
  (base speed, one parallel, unit casing minimum from recipe special value).
  Both support ordinary volts/amps controls and zero input tier skips.
  `prassMachineCasing` caps working voltage before amps; UHV removes the cap
  and is the legacy default. The normal handler's UHV controller unlock is not
  a minimum hatch voltage. EV+ glass is assumed. See precise-assembler.test.ts.
  - The legacy `Coke Oven` alias also matches the unpowered brick oven.
    Its missing `cokeOvenSlices` control means NO overclocks and one parallel;
    leftover voltage settings on old nodes must not accelerate it. The
    Industrial Coke Oven keeps ordinary overclocks with the slices control.
    Issue #58's supplied plan stores an explicit 4096 EU/t budget (2A EV),
    not a lone 1A EV hatch; do not globally halve saved power budgets to fix
    that report. See `docs/machine-feedback-audit.md`.
  - Utupu-Tanuri is BOTH `Multiblock Dehydrator` and `Vacuum Furnace` in
    the dataset. Keep both aliases on the same table entry: the latter's
    17 recipes previously bypassed the coils and used runtime-only math.
    `minimumHeatFromSpecialValue` floors its coil picker at recipe heat
    (zero for dehydration, e.g. 7200 K for sulfur froth). The vacuum-furnace
    structure render was incorrect and removed; use the real controller icon
    until an accurate render is available. See `utupu-tanuri.test.ts`.
- Neutron Activator pipe height is an integer count, minimum 4 with NO machine
  height cap. `speedingPipeCasing` keeps its existing saved key; its control's
  `numeric` metadata enables typing and stepping rather than a finite ladder.
  `neutron-activator.ts` follows MTENeutronActivator / ParallelHelper: Java's
  0.9f per extra layer, CEIL duration above one tick, FLOOR reciprocal parallels
  below one tick (custom supplier path), bounded by Java's max parallel integer.
  Do not substitute the generic floor-ticks / ceil-parallels rule. Accelerator
  hatch power and neutron-energy regulation remain unmodelled; valid products
  assume the neutron kinetic energy is in the recipe's allowed range.
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

## Shared Machines (One Card, Several Recipes)

- A card can run SEVERAL recipes on ONE machine (Jack, 2026-09-07), the way
  a Large Chemical Reactor fed for two reactions does in the game. The
  model is `src/lib/model/shared-machine.ts`: section 0 is the card's own
  `recipeId`, sections 1..n are `FactoryNode.extraRecipes`
  (`{ recipeId, recipeInputOverrides? }`). Machine count, tier, power
  budget and every config knob are the card's and shared; slots, wires,
  oredict picks and verdicts are per section.
- ADDRESSING: a section's port handles wear an `r<n>:` prefix on the
  ordinary handle id (`sectionHandleId` / `splitSectionHandleId`);
  `canonicalizeResourceHandleId` keeps the prefix and both handle parsers
  return `section`. A section's solve node is `card#r<n>`
  (`sectionNodeId` / `parseSectionNodeId` / `sectionOwnerId`). Anything
  that resolves "the recipe at this handle" must read the section
  (`sectionNodeView`), never `node.recipeId` alone: the store's edge
  builders, `getResourceForHandle`, the drop target, the load funnel and
  the import remap all do.
- SOLVE: `expandSharedMachines` (memoized, expands to itself) stands each
  extra section up as a hidden node with the card's settings and re-points
  its wires, prefix stripped. It runs first in `calculateThroughput` and
  inside `getPoolProject`, so every diagnosis sees it. The ONE coupling is
  the time row in equations-core (`listSharedMachineGroups`): the
  sections' acts sum to at most one, because each act is that section's
  share of the machine's time. Solve mode's pin is one equality over the
  group. NOTHING ELSE is coupled, on purpose: GT5U's ProcessingLogic walks
  every matching recipe and skips one that fails on output space or
  voltage, so a starved or clogged section just hands its time to the
  others. Section results stay in `result.nodes` under their own ids.
- VERDICT: a section held under its own ceiling because the machine's time
  is spent reads BUSY (`findBusySharer`), naming the section that took the
  most; more machines is the fix. `findUnwiredNodeIds` answers with the
  card, never a section id. The machine list's usage is the sections'
  shares added up, PEAK the hungriest section's draw, AVERAGE each
  section's draw weighted by its share.
- The inspector's MACHINES list is ONE ROW PER CARD (Jack, 2026-09-11),
  including identical recipes and power configurations. Keep the existing
  machine-name headers and indented count/power rows; each card gets its own
  child row, with no recipe/item subtitle. Never combine cards' figures.
  `buildMachineList` in `src/lib/model/machine-list.ts` supplies its figures:
  Build uses the card's machineCount; Solve/Pool use the sum of that card's
  sections' theoreticalMachinesRequired, keeping fractions and zero-demand
  cards. Parallel processing scales power, not the physical machine count.
  Shared cards remain one row, with peak draw from the hungriest section and
  average draw weighted by each section's required count/time share. Crop
  cards still count their harvesters, not seeds. Row clicks focus that one
  card; checklist clicks affect that card alone.
- CARD: every section gets a `SectionLabelRow` (name, share, verdict word,
  remove key) over rails of its own; the picture stays with the first, the
  rest get the bare arrow. The machine menu lists the INTERSECTION of the
  sections' handlers (`getSharedMachineHandlers`), no twins section on a
  shared card, and an "Add a recipe this machine runs" row that opens the
  search PINNED (`browseMachineRecipes`).
- SEARCH PIN: `recipeBrowserMachinePin` on the store, opened on the
  stand-in resource `MACHINE_PIN_RESOURCE_ID` with an empty stencil. The
  browser scopes the maps to the pin (`effectiveMapSelection`, the stored
  chip selection stands aside), never sends the stand-in as a resource,
  and the add goes through `addRecipeToNode` (refused, with a chip
  apology, when no machine runs both). The overlay shows the pin as a
  plain card at the head of the stencil: picture, name, "Pinned", nothing
  to press. There is no manual way to pin.
- `removeRecipeSection` drops the section's wires and renumbers later
  sections' handles; removing section 0 promotes the next. Refactor swaps
  section 0 only. Generators, crop farms and custom rate cards never share.
  `src/lib/model/shared-machine.test.ts` is the exam.

## Frontend State And Recipe Context

- Node creation from recipe book must preserve selected context/resource overrides.
- Refresh/reload must not re-resolve oredict slots back to the first alternative.
- Changing a machine config such as TGS tools must not drop unrelated links or resource overrides.
- When selected handler changes through the machine dropdown/multi-arrow UI, carry handler-specific tier/config behavior with it.
- Images/icons in recipe nodes should use dataset resources/atlas paths. If they exist in prod but not dev, suspect deployment/static asset path/build mismatch before changing recipe logic.

## Tabs, Cameras And Where A Plan Lands

- The guided tours were REMOVED (Jack, 2026-09-02) to make room for a new
  tutorial; nothing under `src/lib/tour` or `src/components/tour`
  survives. The board's "?" help corner stays, built from
  `src/components/help/card-parts.tsx`, and it finds what it rings by the
  `data-help-anchor` attribute (formerly `data-tour-anchor`).
- The Welcome tab was REBUILT the same day (`src/components/welcome/`):
  a hero with the three ways to start, the three moves, your designs, the
  community's top six setups (opened into a fresh tab) and the latest
  changelog entry, over `WelcomeBackdrop` - a canvas of ghost cards and
  wires with packets riding them, paused while hidden, still under reduced
  motion. Its state is `src/lib/welcome/welcome-tab.ts`, same storage keys
  as before: `active` is per browser SESSION (a reload leaves you on the tab
  you were on), `open` and `showOnStartup` are permanent.
- The help sheet (`BoardHelp.tsx`) is a COMPUTED layout: every card is
  `CARD_W` (280) wide and cards live in flex columns hung from one ring
  each. Since 2026-09-07 (Jack's rapid-fire pass): board-left under the
  build toolbar (Units and history); the CENTRE under the mode switch,
  ONE "Build, Solve, Pool" card, never three; board-right under the tool
  row (Board tools) and over the framing dock (Viewport); the corner stack
  over the "?" (Mouse and keyboard, Plan details, arrowed down at the plan
  bar); TWO FOOT lanes along the board's bottom middle between those
  (Machine controls + Board windows, Drawers and tanks + Plan diagnostics -
  the legends live on the board, never over the inspector); the browser
  column leads with a LIBRARY card arrowed across the seam at the Library
  pill, then Resources, then Recipe search; the inspector carries Inputs
  and outputs at its top and Machines over the machine list (anchor
  `machines` on MachineShoppingList, under the totals when the list is
  empty). The drawer rows wear the board's own silhouettes in its tints
  (`DrawerShapeGlyph`), not word chips. Fallbacks in `layoutGlance`: no
  room for a centre lane beside the build column takes the build lane and
  sends Units to the corner stack; no foot lane hangs the foot cards under
  the centre; and estimated stacks that would land on each other report
  `fits: false`. Do not go back to per-card offsets. Copy is terse
  engineering text, no quips (Jack, 2026-09-06). The spread only shows
  from 1920x1080 CSS px (`GLANCE_MIN_VW/VH`, so browser zoom counts
  by itself; Jack, 2026-09-07: under 1080p it crams, switch to the panel
  liberally); smaller windows get the one-column hover panel, phones the
  full-screen sheet. `compact` is `isCompact` ALONE - the paint fold
  no longer flips a desktop window into the phone sheet.
  `help-fit-probe.local.mjs <WxH> <out.png>` screenshots it.
- Each design tab remembers its own camera:
  `src/lib/designs/design-camera.ts`, localStorage keyed by design id. It is
  deliberately NOT part of the plan - a shared setup carries positions and view
  settings and no viewport, so someone opening one gets it framed.
  - Not recorded during a design handover, which is what the latch in that
    file is for.
  - A tab with no camera stored yet is framed, which is what every tab used to
    get.
- The board has NO `fitView` prop, on purpose. React Flow's fit-on-init waits
  for cards to be measured, so on a page load it fires after the plan arrives
  and stamps over the restored camera. The app frames for itself on every path
  that puts cards on the board (design store, plan import, blueprint paste);
  do not add the prop back.

## Boards (And Their Minimized State, Formerly Pockets)

- A board is the ONLY container: a `FactoryPocket` record, two states.
  `expanded: true` plus a `size` renders it as a window frame (`BoardNode`)
  with its members inside; minimized it renders as a SUMMARY CARD
  (`PocketNode`). That card is ALL a "pocket" is now - there is no dive-in
  view, no breadcrumbs, no Esc-up, no violet room, no unpack button, and no
  convergence rewiring anywhere. Old plans load their pockets as minimized
  boards.
- A MINIMIZED BOARD IS A SUMMARY, NOT A MACHINE. It has NO PORTS: you
  cannot drop a wire on it (`findNodeDropTarget` returns undefined, so it
  washes red like any card refusing a resource), no drag starts on it, and
  `connectResourceEdges` refuses any end that names one. It stacks two
  readings and a stat line, and every figure comes from the PLAN-WIDE
  solve (`computePocketSummaries`). To change anything you open the
  window.
  - NEEDS / MAKES: the board read as a little factory, WIRES IGNORED -
    the members' flows netted against each other, so a board whose own
    mine feeds its own macerator asks the world for no ore. These are
    FULL SPEED figures on purpose: a board stalled because a need is
    unmet must still say what it is missing, and scaling by utilization
    erases exactly that line.
  - COMING IN / GOING OUT: what actually crosses the border on wires
    right now, one line per resource per direction with its wire count.
  - Only the BALANCE is painted: red ground under NEEDS, green under
    MAKES, each with a centred title chip. The wire crossings are plain
    paper - colouring them too made the card two stacks of the same two
    colours saying different things. A ground ends with its own last
    line (`items-start`), never running down past the taller column, and
    a rule (one cell, charged for in `pocketCardHeight`) separates the
    two sections. NO CAP and no "and N more" - a summary that hides half
    of itself is not one - so the card grows a row per line and
    `sectionCells` charges for every one of them.
  - The footer is what is inside: machines, cards, EU/t.
  - The card used to run a SCOPED solve over its members with the outside
    world unhooked and wear the result as input/output rails. It read like
    a machine and lied like one: a board holding its own source was told it
    was starving, a board exporting a byproduct was told it was clogged.
    That whole apparatus is gone - the scoped solve, `buildPocketRailPorts`,
    `resolvePocketPortHandleId`, the port fan-out
    (`resolvePocketMemberIds`, `listPocketPortResources`,
    `getPocketResourceForHandle`). Do not rebuild it.
  - Crossing wires still land on the card, as ANY-SIDE endpoints (like a
    drawer's), on two inert handles that exist only because React Flow will
    not draw an edge without one. Several wires carrying one resource across
    one border are still drawn as ONE line (the channel grouping, now keyed
    on resource alone) and counted as one summary row with its wire count.
  - `pocketCardHeight` is the one place the card's height is decided, so
    the auto-arranger can size a minimized board from
    `countPocketCrossings` before it has ever been measured.
- The canvas always shows the ROOT plus the contents of every open board,
  recursively (`computeBoardLevelView` in `src/lib/model/board-windows.ts`:
  shown levels, representatives, frame rects, drop-owner picking).
  Double-click or the restore button opens a minimized board in place;
  Ctrl+G wraps a selection in an OPEN board fitted around it, moving
  nothing and touching no wire.
- While open, member positions are FRAME-RELATIVE and members are React
  Flow children (`parentId`), which is what makes a dragged title bar carry
  the household. Everything downstream speaks flow space:
  `publishBoardGeometry` and `cameraCards` resolve the parent chain once.
- Wires belong to cards. An open board's members wire directly, and the
  frame is invisible to wire GESTURES (drops land on the cards inside) -
  but to ROUTING a frame is as solid as a card: foreign wires go around it
  with the same one-cell clearance, and only wires whose endpoints live
  inside it are exempt (`throughBoardIds` on the route inputs,
  `exemptObstacleIds` in grid-edge-router.ts) - they have to cross the
  border to exist. Frames publish through `publishedBoardFrameBounds`,
  separate from the card set, and exemptions ride the solve signature so
  adopting a card reroutes its wires without anything moving. A wire whose far
  end is a MINIMIZED board lands on the summary card as an any-side
  endpoint, and same-resource crossings collapse into one drawn channel -
  presentation, never stored rewiring.
- Membership changes by drop (`handleNodeDragStop`): a card WHOLLY inside a
  frame's floor joins that board (deepest frame wins), a card dragged clear
  of every frame leaves its board and surfaces on the canvas
  (`pickBoardOwnerFor`). Coordinates convert so nothing moves on screen,
  and the frame NEVER grows to swallow a drop - a board's walls are the
  player's to set, and a drop that would not fit simply lands outside.
  Drawing a board with the toolbar tool adopts the cards it covers; a
  drawer spawned off a member's port joins the member's board.
- Opening a legacy pocket (`size` absent - the "coordinates are their own
  old space" signal) rebases members to fit the frame and drops waypoints
  on wires touching them; minimize mirrors the waypoint rule.
- AUTO-ARRANGE DUMPS EVERY BOARD FIRST (Jack, 2026-09-08: the arrange
  "should have no respect for player-made boards"; this reverses the
  2026-08-29 lock, which was itself a reversal of an earlier dump - the
  history is in git, not here). `flattenBoards` (src/lib/model) surfaces
  every member where its frame stood (fitted frames add their corner,
  nested frames every corner up the chain, legacy pockets surface verbatim)
  and the arrange lays out one flat set of cards; `applyBoardArrangement`
  gets `removeBoards` = every board id, so the boards go in the arrange's
  own undo entry and the members ride `moves`.
- THE ARRANGE LOADER (Jack, 2026-09-08: "one master progress bar with
  steps"): `ARRANGE_STEPS` in arrange-job.ts names the six steps (lay out,
  search, route the candidates, polish first, polish second, choose); every
  progress message carries its `step`, the bar fills across all six with an
  equal share each, the steps are listed under it with the current one lit,
  and the search reports every 250 annealing trials so the bar moves
  through it. CANCEL: `cancelArrange()` in arrange-solve.ts TERMINATES the
  worker (it runs the job synchronously and cannot hear a message mid-job)
  and rejects the pending promise with `ArrangeCancelled`; the next arrange
  starts a fresh worker. The main-thread fallback cannot be stopped, so its
  result is dropped instead. tools/audit-board.mjs waits for the loader
  (role=status, aria-live=polite) to detach; keep those attributes.
- KEEP BOARDS ON REARRANGE is the switch (the arrange SHEET: one setting,
  no subtext, and the Arrange button under it). A browser preference
  (`gtnh-factory-flow.arrange-keep-boards.v1`, OFF by default), never part
  of the plan. ON is the old lock: a board someone drew is sealed - its
  contents are never rearranged, its frame keeps its size, name, paper and
  ink - and the arrange only PLACES the board, one solid meta card in the
  root pass. Waypoints pinned on wires wholly inside one kept board ride
  the board's move. The "Rearrange inside boards" setting is gone; the
  `tidyBoardInteriors` option on `computeAutoArrangement` is always false
  now and only the code path remains.
- NO ZONES (Jack, 2026-09-08: "drop island support, board wrapping and
  whatnot"). The arrange no longer wraps islands in fresh "Zone N" boards;
  `addBoards` / `setOwners` from `computeAutoArrangement` are always empty
  now (the plumbing stays for the locked-board bookkeeping).
- ISLANDS ARE EMERGENT (Jack, 2026-09-08, branch arrange-emergent-islands:
  "how do we make this behaviour emergent?"). The rule that cut a branch
  hanging on by a wire or two off as its own island (`splitLooseClusters`,
  `ISLAND_CUT_MAX`, the `islands` taste) is GONE; one connected web is one
  island, and disconnected webs are still separate blocks. What parts a
  cluster from the main body is `src/lib/board-arrange-air.ts`: two cards
  three or more wire hops apart (a one-partner drawer standing in for its
  machine) are STRANGERS, and every card pays `islandAir` points per pixel
  its NEAREST stranger stands closer than six cells. Partners attract
  through their wire's length, two-hop cards are neutral, so a dense
  cluster on one bridge wire drifts out until the bridge's extra length
  balances the air, and a lone card stays put. Per card, not per pair, so
  the dial means the same on nine cards as on ninety. The term is in the
  objective EVERYWHERE the arranger decides - the optimiser's proxy, the
  finalists' judged points, the polish, plain-vs-challenger - so the judge
  never undoes what the search found; the dev menu's SCORE stays pure
  routing points. Without a router judge, `arrangeBoard` now picks between
  the plain pass and the challenger by `scoreLayoutProxy`. The optimiser's
  state grew a per-column horizontal pad (islands part sideways too) and a
  group move (a card and its partners shift together). Dial: `islandAir`
  (Arrange group of the dev menu, default 0.5, 0 packs tight); the worker
  gets the host's tuning through `ArrangeInput.tuning`. Cost on the oil
  board (a single dense community, where air only hurts): 12,842 pts at 0,
  ~13,500 at 0.5, ~14,900 at 1. Exam: "emergent islands" in
  board-arrange.test.ts (a hub feeding two clusters stands them apart;
  dial 0 packs them).
- THE ARRANGE IS BENCHMARKED, and the benchmark is Jack's (2026-09-08):
  total crossings of the board's real wires first, total wire length
  second, readability assumed to follow. COUNT CROSSINGS THE RIGHT WAY:
  `src/lib/route-metrics.ts` (`measureWireRoutes`, and the router's
  `measureRoutes` is it) counts every point where two wires' rays
  alternate - crossings AT BENDS and where a run ends on another wire
  included; a segment-only counter that skipped endpoints said 2 where
  Jack counted 24 on the same board. `tools/audit-board.mjs <plan> <out>
  [--arrange]` loads a plan in the real app, presses the real Arrange, and
  prints the two integers from the DISPLAYED routes (docs/route-audit.md);
  Jack's counts agree with it. Jack's hand-arranged oil board is the
  reference: 1 crossing, 12,745 px (`artifacts/route-audit/oil-manual`).
- THE FREE PLACEMENT (Jack, 2026-09-08: "get rid of the grid thinking ...
  a lot of considerations when we place a thing ... future thinking"):
  `src/lib/board-arrange-free.ts` is a THIRD candidate beside the column
  passes, and on big boards it is the one that wins. Stress SGD over
  graph distance (a card ten hops away stands ten cards away, partners
  touch) gives the structure; the cards are settled on the cell grid;
  then simulated annealing over FREE moves (beside a partner with port
  rows aligned, nudge, swap, a machine with its own drawers as one, a
  whole side of a bridge wire as one) scored INCREMENTALLY in the
  router's points plus the stranger air, plus three readability terms
  the router does not price: TIDY (a card's edge lining up with a
  neighbour's, or a shared port row), FLOW (a wire's target less than a
  card's width right of its source pays per pixel, and a backward wire a
  flat price: a crossing's worth, nearly four between two machines, a
  token one inside a cycle - an oil board is mostly recycle loops), and
  a little sprawl. The one lattice kept: MACHINES STAND IN COLUMNS at a
  pitch of one machine width plus a drawer corridor, drawers in the
  corridors; rows are any cell. The search runs twice like a chip
  placer - free to any cell first (the structure), then legalised onto
  the columns and repaired with a cooler search - because searching on
  the lattice from the start found layouts a fifth worse. The three
  candidates are judged by the real router, the best two polished, the
  better polished board wins on points; every dial is in `FREE_DIALS`.
  DRAWERS ARE PLACED BY PATTERN, not searched (Jack, same day, holding
  his hand layout against the arranger's: "shouldn't all the products
  just be in a row next to each other"): a drawer wired to ONE machine
  is its bud and stands in a touching LINE on its side (supplies left,
  products right, port order, centred on the ports); a drawer wired to
  exactly TWO machines stands in a line BETWEEN them (the corridor when
  side by side, a row in the gap when stacked); lines meeting in one
  corridor stack; a drawer whose place is taken is freed to the search.
  `planPatterns` / `derivePatterns` / `settleWithPatterns` in
  board-arrange-free.ts; the search moves machines and the drawers
  follow. Costs points (the oil berry board 9 -> 17 crossings) and Jack
  called the result good.
  Harnesses (local, off the suite): `arrange-capture.local.test.ts`
  (CAPTURE=an audit.json: arranges offline, REPORT=, OUT=layout) and
  `free-explain.local.test.ts` (LAYOUTS=: every objective term and the
  router's verdict per layout). Numbers, oil berry board (44 machines,
  36 drawers, 104 wires, `artifacts/route-audit/oilberry-*`): the app's
  Arrange gave 38 crossings / 41,965 px / 93,549 pts; the free placement
  9 / 23,223 / 42,099. Jack's small oil board: 1 crossing / 5,564 px
  (his hand layout 3 / 6,880). Cost: the arrange takes ~80 s on the big
  board, ~20 s of it the free search.
- HOW `arrangeBoard` WORKS NOW: the plain column pass AND a challenger
  (`board-arrange-optimize.ts`: annealing over column order / offsets /
  row air / satellite slides / column hops / moves to a partner's side,
  against a PROXY that scores in the router's own points - see below) are
  each POLISHED (`polishWithJudge`) and the better finished board wins by
  the judge, ON POINTS ALONE (Jack, 2026-09-08: a crossing is already
  priced into the points at the crossing dial, and "if it leads to edges
  taking the huge long way all the way around the whole board, it looks
  stupid" - his 3-crossing board beat the arranger's 0-crossing one on
  points). The polish runs even at zero crossings, blaming the cards on
  the longest wires. The polish is what a hand does: the real router says
  where wires still cross, the cards on those wires are tried elsewhere -
  beside a partner on any side (the far end of the crossing wire weighs
  four times), level with a partner in their own column, or SWAPPED with
  a card in their column - buds (drawers serving only that machine)
  riding along, each try judged by the router. Quick verdicts pin every
  wire the move does not touch and re-solve the rest (`route-judge.ts`,
  the router's `pinned` argument, results carrying `vertices`/docks for
  the purpose); a winning move gets the full verdict and becomes the
  base. Budget 100 quick verdicts per polish. The host judge is
  `buildArrangeJudge` in FactoryFlow -> `makeRouteJudge`, on the
  published route inputs; no judge (boards on the level) -> plain pass.
- LAYERING RULES LEARNED FROM JACK'S OIL BOARD: two machines feeding the
  same drawer stand on OPPOSITE sides of it (`splitCoFeeders`: the one
  with fewer other rightward wires has its drawer wires turned round for
  the ranking, so it ranks past the drawers); shared drawers sit between
  their partners (`relaxSharedStorages`).
- VERSUS MODE: the dev menu's Score section (shift-click the version
  chip) shows crossings / points / wires of the displayed board, "Copy
  layout" puts a LAYOUT STRING on the clipboard (`board-layout-string.ts`
  v2: plan id, score, every card's cell rect, every wire with port rows
  and width), "Paste layout" applies one. `src/lib/versus.local.test.ts`
  (LAYOUT=file OUT=file, local config) scores a layout string offline and
  writes the arranger's answer beside it; `score-layout.local.test.ts`
  scores one. Compact taste is 1/2/2/1/0 cells (row/section/column/
  satellite pad/stack), what Jack's hand draws.
- POINTS ARE WEIGHTED BY FLOW (Jack, 2026-09-08: "edges with more items/s
  or L/s are more expensive to traverse ... like laying the bedrock
  first"). `wireWeight(width)` in route-metrics.ts is 0.5 + width/8: the
  quietest wire on the board (4 px) weighs 1, the busiest (16 px) 2.5. A
  wire's length and bends count its weight times over and a crossing
  weighs the heavier of the two wires (`weighted*` fields on
  `RouteMeasure`; `routePoints` reads those). Every `GridRoutedEdge`
  carries its `width` so the judge, the router's own retainBest and the
  dev menu's score all weigh the same way; the arranger's proxy already
  weighted links by log10 of the flow. Effect on the numbers: a board's
  points rose by roughly the average weight (Jack's oil-jack4 8,388 ->
  12,401 at 3 crossings), so compare boards only at one metric version.
- THE PROXY SPEAKS POINTS (Jack, 2026-09-08: "bring the points into
  stage one"). `board-arrange-optimize.ts` scores a trial layout the way
  the router will: every wire's proxy path (rim point FACING the far card
  - side chosen by the gap between the two rectangles, never by the far
  centre, and facing sides with overlapping dock ranges line up on one
  row for the straight shot; clean stubs only as far as half the room
  ahead; one centred diagonal) priced as length + bends at turn45/turn90 +
  a detour estimate per card it would run through (two corners plus half
  the card's shorter side), all times the wire's `wireWeight`; crossings
  at the crossing dial weighing the heavier wire. NEVER pin the proxy to
  fixed port rows again - docking is free, and pinning drew a 30-cell
  zigzag where the router draws 5 cells straight and ranked Jack's layout
  below the arranger's. `src/lib/proxy-score.local.test.ts`
  (LAYOUTS=a,b,... PERWIRE=1) prints proxy vs router per layout and per
  wire; on the oil board the proxy is now within ~5% of the router on
  every layout tried. Finalists are one per column STRUCTURE (six), the
  real router judges them on points (the host's judge, shifted to the
  island's current corner) and the fewest real points wins.
- THE SEARCH MAY DRAW LEVEL WITH A DRAWER: a machine may hop into any
  column flow allows, and may share a column with a drawer it trades with
  (`mayStandIn`, `reach` 0 for a storage partner, 1 for a machine) but
  never pass beyond it; a drawer may stand anywhere between its first and
  last partner's column, those included. This is what lets two machines
  trading through drawers stack in one column with the drawers in the gap
  between them - Jack's oil board - and it took the arranger's answer from
  18k to 12.8k points in one step.
- Numbers on the oil board at the shipped dials (2026-09-08, weighted
  points): Jack's hand layout `artifacts/route-audit/oil-jack4.layout.json`
  3 crossings / 12,401 pts / 6,880 px; the arranger's answer
  (`oil-answer9`) 4 / 12,842 pts / 6,940 px, structurally his board, in
  ~19 s offline. Before the proxy rework the answer was 3 / 18,809 /
  10,400. Open: the last crossing, time.
- The board title bar has a paint button (palette in a NodeToolbar portal,
  because the frame's own layer sits under the cards); the paint TOOL works
  on boards too. Both go through `paintPocket`.
- A board is drawn on PAPER: `pocket.theme` is a canvas theme id, and it
  gives the floor its base colour, its grain and its own grid dots on the
  20px pitch (`chromeFor` in BoardNode.tsx cuts the title bar from the same
  paper). The title bar's paper button picks one; the arrange assigns from
  `ZONE_PAPERS`, skipping papers other boards already wear. `colorTag`
  still works (the paint tool) and wins when there is no theme.
  The resize grip's floor is the members' extent plus a cell - a frame can
  never be made smaller than what it holds.
- The paper is painted by `BoardFloors`, ONE viewport portal at z -4, not
  by the board's node. A board's chrome sits at 15 (over the wires at 10,
  under the cards at 20) so its bar and rim OCCLUDE the wires crossing
  them, while the floor stays under those wires - one node cannot be in
  two places in the stack, and React Flow pins every child node above its
  parent, so a floor child could not go below either. The layer reads live
  positions from the node lookup, so paper tracks a dragged frame exactly.
  Open boards therefore also un-seal the edge/node layers
  (`factory-flow-board--edges-under`, always on now that line thickness
  is always on).
- The marching dashes are a CANVAS painted over everything, so anything the
  wires go under has to be punched back out of it. A board's bar and rim are
  in that set in EVERY mode (`boardChromeOccluders`, fed from
  `publishedBoardFrameBounds` and copied into the GIF capture's
  `occlusionRects`) - unlike the cards, which only occlude when thickness
  mode runs the wires beneath them. Only the chrome strips are erased, never
  the whole frame: the floor is a layer UNDER the wires, so the dashes cross
  it, and a frame dragged by its bar erases the same strips at its live
  position rather than blanking its own interior.
- Two mirrored routing rules keep wires honest about rooms
  (grid-edge-router.ts). A wire leaving a board pays `COST_INSIDE_EXEMPT`
  per pixel spent inside it, so it makes for the nearest border instead of
  riding the frame's own edge line on the way out. A wire whose BOTH ends
  sit in a frame (`homeObstacleIds` — the shared prefix of the two
  endpoints' ancestor chains, `exemptObstacleIds` being their union) pays
  `COST_OUTSIDE_HOME` for every pixel spent OUTSIDE it, so it never ducks
  out of its own board and back in. The second rule exists because the
  first one alone made leaving cheaper than staying.
- A board has NO DEFAULT COLOUR - the house purple it used to fall back to
  is gone (`src/lib/model/board-paper.ts`). A board created now stores a
  paper nobody else on the plan is WEARING, picked at random
  (`pickBoardPaper` in `createBoard`/`wrapSelectionInBoard`), and a board
  with no stored paper - every pocket made before papers existed - is drawn
  in `paperForBoardId`, hashed from its own id so it looks the same on
  every reload and needs no migration. The picker's clear button hands a
  board back to that id colour rather than to a house one. The MINIMIZED
  card wears the same paper (`boardChrome`, exported from BoardNode):
  folding a board must not turn it into a different-coloured object, and
  the paper is how you recognise which board it is. The house purple it
  used to wear is gone from there too.
- Only DARK papers are offered (`BOARD_PAPERS` filters the light canvas
  themes out, and `BOARD_PAPER_IDS` - which `ZONE_PAPERS` now is - lists
  the dark ids): a pale sheet under the
  board's dark cards reads as a hole in the plan. A board already carrying
  a light theme still renders it. `pocket.pattern` rules that paper with
  the same six the canvas offers (`boardRuling` draws them as CSS layers,
  and the picker previews each one at a 7px cell). The picker's popover is
  `align="end"` — it belongs under the button that opens it, which sits at
  the right end of a bar that can be very wide.
- The frame line is `BOARD_EDGE` (4px), and the title bar wears the same
  weight in the same colour so the window reads as one object: a 2px line
  vanished at the zooms a board is actually read at.
- `dissolvePocket` is the DUMP: the frame goes and its cards stay exactly
  where they were (frame-relative positions get the frame's corner added
  back when the board carries a `size`). Its button lives on both the open
  title bar and the minimized card.
- NOTHING SOLID OVERLAPS. `board-placement.ts` is the magnet, and it runs
  LIVE: `handleNodesChange` rewrites each drag frame's position to the
  nearest free grid spot, so a card is never allowed onto an occupied spot
  rather than being tidied up after release (the drop keeps the same call
  as a safety net for drops that never saw a drag frame). Blockers are
  computed ONCE per drag in `handleNodeDragStart` — nothing they depend on
  can change mid-drag — and differ by kind: a CARD is blocked by other
  cards but never by frames (a frame is a room you drag into, and the drop
  decides membership); a FRAME is blocked by other frames and by every card
  that is not its own. Annotations are ink and never block anything.
- NOTHING STRADDLES A WALL. Every open frame is also a REGION to the magnet
  (`PlacementRegion`: the whole frame as `outer`, the floor under the title
  bar as `inner`), and a card position that touches `outer` without fitting
  inside `inner` is refused exactly like an occupied spot. So a card clicks
  IN or clicks OUT as the hand crosses the wall, whichever side is nearer,
  and the drop can then read membership as plain containment instead of
  guessing from a centre point. A frame being dragged is not asked to be in
  or out of anything, and a frame carried by the same drag is not a wall to
  the cards riding with it.
- Board frames resize from all four edges and all four corners
  (`RESIZE_GRIPS`), each with a generous hit box straddling the wall, plus
  permanent corner brackets. A wall never cuts into the board's own cards
  and never crosses anything outside — the same no-overlap rule the drag
  magnet enforces. Dragging the TOP or LEFT wall moves the origin, so
  members are shifted by the same step the other way and stay put on the
  canvas: live through `board-resize.ts` (the frame publishes, the board
  applies both halves to its node state on one frame) and committed by
  `setPocketFrame`, one undo entry, nothing written until the pointer lifts.
- A board SELECTS like anything else: `selectable: true`, so a marquee
  drawn round one picks up the frame (and, being a marquee, the cards
  inside it too) and it wears the same purple ring every selected card
  wears (`SELECTION_RING`). The frame used to be unselectable because a
  selected frame AND its selected members both took the drag delta, so
  the household moved twice as far as the hand. `dragPassengersRef` is
  the fix: at drag start, any held card whose board is held too is a
  PASSENGER, and its own position changes are dropped for the length of
  the drag - the frame carries it, and its stored frame-relative position
  is already right.
- NOTHING SITS IN TWO BOARDS AT ONCE. `wrapSelectionInBoard` refuses a
  selection where anything already has an owner or IS a board, and the
  board hides the wrap button for such a selection (`selectionCanWrap`),
  so Ctrl+G and the button agree. Boards inside boards is a real feature
  and a separate decision; it must not happen by accident from a marquee.

## Interface Size (100% Is The Baseline)

- In Solve/Pool, Outputs lists each actual product drawer as an always-open
  branch with the same `TargetLine` rate/pencil editor used on the canvas.
  Rates align right; branches have no invented drawer names. Locate identifies
  the matching canvas drawer. Byproducts/exports have no target controls.
  Build/read-only views show a subtle product marker instead. Target editing
  retains the existing shared-target behavior for matching product drawers.
  Product rows participate in virtual-list height calculations.

- The right inspector is 280 shell pixels wide on desktop and as a drawer.
  Resources and Machines share the dark styling in `inspector/panel.css`.
  Resources use 28px ledger rows with simultaneous Raw and Net columns;
  Net is surplus minus deficit, while Raw keeps each boundary side intact.
  Keep virtual list measurements in sync with CSS. Machines use the same
  compact rows with Peak/Average columns. Each machine has a full-width name
  above its build rows; multiblocks show amperage and tier (typed EU/t budgets
  display equivalent amps at that tier). Peak/Average share the Machines
  heading. Resource section headers run edge to edge with no top divider.
  Resource tools live in the header.
  Resource height follows visible rows (capped when Machines is present), so
  a short resource list gives spare height to the machine list.

- The left items panel is 256 shell pixels wide (desktop and mobile drawer
  cap), fitting four 58px-minimum item columns. Keep drawer measurement and
  desktop grid widths in sync.

- Build/Solve/Pool use icons only on snug or compact windows; wider windows
  keep the words. When Build tools folds, the mode switch and Pool product
  key move inside it, freeing the centre. The key width and drag hit-testing
  must use the same pitch.

- The default is 10% smaller than the previous baseline (Jack, 2026-09-10),
  still labelled 100%. `src/lib/ui-scale.ts` owns it: a Settings
  stepper (Size, minus/plus, 60-200% in tens, Reset) stores a PERCENT of
  the default (`gtnh-factory-flow.ui-scale.v1`), and the factor is
  percent x `UI_SCALE_BASE` (1.17) - or x `UI_SCALE_PHONE_BASE` (0.9)
  on a viewport that is compact at 1:1. The boot script in layout.tsx
  (`uiScaleBootScript`, ui-scale-boot.ts, hook-free so the server layout
  may import it) stamps `--ui-scale` / `--ui-scale-inverse` and the
  `data-compact` / `data-snug` attributes before first paint;
  `UiScaleRestore` keeps them live.
- HOW: CSS `zoom` on the app shell (`.ui-scale-shell`, the FactoryPlannerApp
  root), and the BOARD UNZOOMS ITSELF (`.ui-scale-shell .react-flow` at the
  inverse) because React Flow measures cards and the pointer in two pixel
  spaces once zoom is involved (probed 2026-09-07: fit framed a plan at a
  third of its size, wheel zoom drifted, drags ran fast). The board carries
  the factor through its camera instead: `boardMaxZoom()` /
  `boardCameraMaxZoom()` in board-camera.ts, the glance thresholds in
  node-detail.ts compare `zoom / boardZoomScale()`, the timelapse range
  scales at read time. `BOARD_MIN_ZOOM` is not scaled. Never CSS-zoom the
  board.
- TWO PIXEL SPACES, and every measurement must say which: REAL px are
  `clientX`, `getBoundingClientRect`, `window.innerWidth`, anything inside
  `.react-flow`, and anything portaled to `document.body` (outside the
  shell); SHELL px are `offsetWidth`/`clientWidth`/`scrollLeft`/style
  lengths/ResizeObserver rects/CSS lengths inside the shell. The ratio is
  `getUiScale()`. A portal to the body keeps its fixed positioning box in
  real px and wears `.ui-zoom` on its VISUAL box. Pointer deltas applied to
  shell state divide by the scale; containment tests need nothing.
- VIEWPORT UNITS are not divided by zoom, so `100vh` inside the shell is
  taller than the window: use `--ui-vh` / `--ui-vw` / `--ui-dvh`
  (`max-h-[calc(88*var(--ui-vh))]`), never a bare vh/vw in the shell or in
  a `.ui-zoom` box.
- The `compact:` and `snug:` Tailwind variants key on the html attributes,
  NOT on media queries: the breakpoints (viewport-breakpoints.ts, 900 /
  560 / 1280) are shell px, so compact-view.ts builds its media queries
  from the live factor. `getUiScale()` is 1 wherever matchMedia is missing
  (server, jsdom), so tests see an unzoomed world.

## Compact Mode (Phones And Small Windows)

- `src/lib/compact-view.ts` owns the switch: `useIsCompactViewport()` /
  `isCompactViewport()`, true under 900px wide OR 560px tall (a phone held
  sideways is 932x430 and needs the same layout). `globals.css` defines a
  Tailwind `compact:` variant on the same two numbers for style-only changes.
  Change one, change the other.
- Ask the MEDIA QUERY, never `window.innerWidth`: a mobile browser widens the
  layout viewport when content overflows it, so a 390px phone can report 935 and
  answer the question backwards. This is what used to open both side columns on
  the one device with room for neither.
- Compact replaces the three-column grid with the board plus two drawers
  (`PanelDrawer`), the top bar with one menu (`AppMenu`), and each board toolbar
  with one folded button (`ToolGroup` in `FactoryFlow.tsx`, one open at a time,
  all three triggers on the top line and every fold-out on the line below).
- The drawers track the finger: the live offset is written to the `translate`
  property, not `transform`, because Tailwind's own translate utilities use
  `translate` and the two COMPOSE. A drag holds the panel mounted past the moment
  it closes, which is what there is to animate.
- Do not put minimum heights in the way of a short window; pair them with
  `compact:min-h-0` as the shell, the board and both panels do.
- The two TOP TOOLBARS fold by the BOARD's width, not the window's
  (`src/components/flow/toolbar-fold.ts`, `useToolbarFold` on `boardRef`):
  both side columns open leave a 1400px window a 722px board, and the two
  rows want 833px, so the paint tray sat buried under POWER. The paint row
  folds first (under 881px), the build row next (under 721px), and under
  452px the WHOLE paint row (bin, rules, arrange, view) folds into the brush
  so both rows stay on one line - a second line read as a blank band. State holds only the fold, never the width; the width rides
  the element as `--board-width`, which caps the unfolded rows. Compact
  still folds both regardless. Re-measure the row widths in that file if a
  key is added to either toolbar.

## Board Gestures

- Checklist mode (`ChecklistMode.tsx`) lives in View options, with a labelled
  on/off control and inline progress/reset. Its active
  tool is session state; `project.checklist` saves checked card and edge ids.
  It only changes presentation, never machine settings or production, and
  supports undo/reset. The Machines list checks the cards in each build row.
  Checks dim to 7% while the mode is on; leaving reveals the board and keeps
  progress. Capture blocks editing clicks, but middle mouse and wheel MUST
  reach the camera. Checklist wires use the FULL live route at every zoom,
  in an invisible hit layer above port hit boxes: normal 26px endpoint trimming
  erases short targets; visible wires must keep their ordinary depth.
  THE BOARD SAYS ONE THING UNDER THE POINTER while it is on (Jack,
  2026-09-08): what a click would mark, in green - a card wears a 3px
  outline, a wire lights its own hit target (checklist.css) - and nothing
  else. The port rows' flow glow is off and every wheel knob on a card is
  dead: both read `checklistLocked()` in RecipeNode at event time, so no
  card subscribes to the mode. Any new knob on a card needs the same guard.

- A port ROW answers, not its little item icon: left click opens what makes the
  resource, right click what uses it, R and U do the same for the row under the
  pointer (`port-browse.ts` holds the pointed-at row imperatively — do not
  subscribe cards to it), a long press opens a two-item menu for a finger, and a
  drag still wires. The icon is art with `pointer-events-none`; the full-row
  React Flow handle underneath it takes the drag.
- THE HOVER HIGHLIGHT is `src/components/flow/flow-scope.ts`, one module
  for a port row and a drawer alike: the wires on the thing you point at,
  each far-end port, and the cards involved. Two rules it must keep
  (Jack, 2026-09-08): a wire belongs to the SECTION its handle names, so
  one recipe's port on a shared card never lights another's wires; and a
  DRAWER PASSES IT ALONG - the walk carries on through drawers in the
  direction the hover asked about (both ways from a drawer itself) and
  stops at the first machine, so a buffer reads as the junction it is.
  `flow-scope.test.ts` pins both.
- Touch gestures on the board live in `board-touch-gestures.ts`, in native
  capture-phase listeners: React Flow's pan sits on the pane below, and stopping
  the event before it gets there is the only way to take a gesture off it
  mid-flight. Double tap zooms, double tap and slide keeps zooming (both anchored
  on the tap point), and a swipe in from the outer third of either side pulls that
  drawer out. Claiming an edge swipe restores the viewport captured at touchstart,
  so opening a drawer never leaves the board panned.
- A drawer follows the finger through `panel-pull.ts`: the gesture starts on the
  board, the drawer does the moving, and the registry is how the two meet.
- On compact, a card is draggable only while selected (`withTouchDragRule` in
  `FactoryFlow.tsx`, plus `nodesDraggable={!isCompact}`). Apply it where the
  selection changes, never per drag frame.

## The Board Grid

- `src/lib/board-grid.ts` owns `BOARD_GRID = 20` and every card size derived
  from it. A recipe card is 19 cells (380px) wide: since 2026-09-06 the
  machine PICTURE sits between the two rails, where the arrow was (inputs
  left, outputs right, no arrow), on a window that is 2 port rows tall at
  the least (`PICTURE_MIN_HEIGHT`) and never sets the card's height itself;
  calm mode keeps the bare arrow. THREE cells came off the card on
  2026-09-09 (22 to 21 to 20 to 19) and the picture was never touched: it
  is the flex-1 middle at 96px throughout, and every cell came out of the
  two item chips (140 to 112) and the output coupling (34 to 30). Re-check
  that 96 first if the width moves again.
  - A name too long for the chip WRAPS to two 10px lines
    (`.flow-port-name`, a CSS clamp - no text measurement on a board of a
    hundred cards) instead of ending in three dots. The clamp is ALL that
    class does: the size, the weight and the leading are utilities ON the
    element, because a name that depends on a stylesheet rule for its size
    renders at the inherited 16px and bursts out of the chip whenever that
    rule is late (it did, 2026-09-09).
  - THE NAME COLUMN IS THE PRICE, and it is down to 70px. Measured over
    three real boards (platline, farm-power, oil-community; 219 distinct
    names) at the 10px type: 5 clipped at 21 cells, 12 at 20, 17 at 19.
    The chip's whole stack then went down a point - name and rate 10px to
    9px, the bar 4px to 3px - which put 19 cells back to 12 clipped, the
    same as 20 cells was, and gave the row 8px of air instead of 4 (the
    text was crowding the top and the bar the bottom). SMALLER TYPE BUYS
    WIDTH: it is worth a whole cell, so reach for it before the picture.
    Re-measure with `name-clip-probe.local.mjs` if any of these move.
  - The stack is name (2 lines x 9) + rate (9) + 2 + bar (3) = 32 in the
    40px row. `chip-fit-probe.local.mjs` reports the tightest row's air
    and the SERVED bar height, so a stale stylesheet cannot be mistaken
    for a layout result.
  Read the "board grid" section of `ARCHITECTURE.md` before changing any
  size, offset, or padding on the flow board.
- The grid is always on. There is no snap toggle and no grid button; do not
  reintroduce one.
- Node positions, node sizes, and port row centres must all be multiples of
  `BOARD_GRID`. Verify with a Playwright measurement, not by eye.
- Blocks whose height depends on content use `GridBlock` in `RecipeNode.tsx`:
  round up to the next cell, never compress to fit.

## Routing Links

- Wires are routed by the grid router (`src/components/flow/grid-edge-router.ts`),
  ONE solve over every edge at once (Jack's remaster, 2026-09-08: "true
  cooperation between edge drawing"). Do not reintroduce per-edge candidate
  scoring or hardcoded special-case paths.
- THE WIRES PLAN TOGETHER, in three moves, all in `solveGridRoutes`:
  - DOCKS FIRST (`planDocks`): every card's wires are looked at together.
    A wire's ideal exit is the rim point nearest its far end (nearest
    point, NOT a ray from the centre - a tall card's centre sends wires
    out the wrong side). Siblings are sorted round the rim by that point,
    ties at a corner by the bearing of their destinations, and MATCHED onto
    the card's real docks in that order (`assignDocks`, a monotone DP
    matching) so no two of them need to cross each other to leave. Two
    wires between the same pair of cards are ordered one way at one card
    and the other at the other, so they run parallel. The plan is soft: a
    dock costs `dockPlanBias` per pixel of rim from the planned one, docks
    past `dockPlanWindow` are set aside (the whole rim comes back for a
    wire that cannot route from the near ones), and a dock another wire
    already uses costs `dockShare` - never a ban, so wires may stack onto
    one side of a drawer when that routes best (Jack, 2026-09-08).
  - FIRST PASS, BEDROCK FIRST (Jack, 2026-09-08): the THICKEST wires -
    the ones carrying the most - take the open lines first, then, at one
    width, the longest: a long wire takes the open lines and the short
    ones fit in around it, which nests a fan to a row of drawers instead
    of having the last one climb across all the others. The trickles find
    their way round the trunk lines afterwards.
  - THE BOARD KEPT is the one with the fewest POINTS (`retainBest`,
    `routePoints` over `measureWireRoutes`), the same number the arrange
    and the dev menu's score read.
  - NEGOTIATION: any wire that ended up crossing another (or overflowing a
    lane) is ripped up and routed again against the whole finished board,
    and every spot wires cross at gets dearer each round (`escalate`, a
    history count in the vertex word). Then SWAPS: two wires leaving one
    card that still cross trade planned docks and both route again, kept
    only if the board's crossings fall - a wall beside a card inverts the
    bearing order and neither wire can fix that alone. Budgeted at
    `negotiationBudget` reroutes per wire (floor 12), `negotiationRounds`
    rounds, and a wire whose reroute gives the same route is `stuck` and
    left alone. Lanes are re-packed from scratch at the end so a wire that
    packed beside a neighbour that later moved is not left off-centre.
- The search is an 8-direction A* over the uniform 20px grid inside a
  window (the wire's box plus `windowPad` cells, grown on failure):
  horizontal, vertical and the two 45° diagonals, a diagonal step costing
  `diagonalLength` (root two) straights, no corner cutting (a diagonal
  needs both orthogonal neighbours free), never within one cell of a card
  (the margin boundary line itself is legal). The port stub is the only
  margin crossing. The heuristic is octile distance plus one bend when the
  goal is not straight ahead - with turns priced, distance alone let the
  search sweep the whole window. Steps are priced once per attempt into a
  pooled memo; occupancy (lane widths, passers, negotiation history) is
  dense typed arrays over the board's extent, not maps - four map lookups
  per priced step was most of a big board's solve.
- EXITS AND LANDINGS (rewritten 2026-09-08 with Jack): a wire may leave
  a dock along the port's normal OR 45° to either side of it (three
  `EndVertex` variants per dock, each with its own apron); a diagonal
  exit or landing costs `turn45`, the bend it is, priced at the dock.
  Since 2026-09-09, diagonal runs need at least TWO grid cells: diagonal
  exits/landings must reach their clean point, and the search enters an
  interior diagonal with two checked steps before extending it one at a
  time. Tight connections use square elbows; one-cell diagonal shots are
  forbidden. THE
  CLEAN RUN is the apron and the cells after it up to the clean point
  (`cleanCells` out from the card edge): a TURN made on it, by a wire
  that left from that start (`cleanZone`, keyed by start variant through
  `startOf`), costs `earlyTurn` on top of the turn; the landing side
  mirrors it (the clean point must be reached heading in, the apron takes
  any other arrival at the surcharge, and with no room for a clean run a
  straight arrival at the apron is free). A wire that never turns there
  pays nothing, so a straight shot to a card two cells away IS a straight
  line. It used to charge the surcharge for STARTING at the apron, which
  made a two-cell straight shot dearer than leaving by another side (the
  bug Jack saw: one cell straight, two cells out-the-side-and-turn).
  TOUCHING DOCKS (`directDock`): two cards one grid space apart have no
  vertex between them, so a source dock whose apron IS a facing target
  dock connects there without a search - the only special case.
  That one-cell shortcut is straight only; longer diagonals compete with
  square routes through the ordinary search.
  Jack's follow-up (2026-09-09): diagonals are reserved for trips whose
  CARD RIMS are at least six grid spaces apart (`diagonalDistanceCells`),
  measured before dock selection, never by the detour's length. Long trips
  may still leave at 45 degrees immediately. Nearby cards route square.
  Freely selected docks on BENT routes now prefer six grid spaces of total
  horizontal + vertical separation (`dockTravelCells`, `crampedDockCost`), so the exit
  and entrance move along the rims to leave visible wire and arrow room.
  Straight shots are EXEMPT (Jack's next correction, 2026-09-09): aligned
  facing docks one or two cells apart connect directly. Exempt the actual
  straight path, not merely aligned docks when an obstacle forces a detour.
  It is a soft cost, not a forced loop or a reason to disconnect a wire;
  fixed endpoints, pinned trips and self loops retain their own rules.
- SELF LOOPS dock freely like everything else, but route with 90° TURNS
  ONLY (`straightOnly` in routeWithinWindow: no diagonal exits, landings or
  runs - a loop that left at 45° and turned back on itself read as a
  scribble on the card's own edge) and must land at least one cell
  (`SELF_LOOP_CELLS`) from where they left (`landsTooClose` at goal
  acceptance), or the loop collapses to a stub. Both Jack, 2026-09-08.
- TURNS COST: a 45° bend `turn45` (35), a 90° corner `turn90` (80), a
  reversal `reverse` (100,000 since 2026-09-08 - all but forbidden, Jack:
  "only if they literally have to"; only a pinned dot can force one), 135°
  forbidden. Jack's
  rules (2026-09-08): turning should cost a lot, a diagonal costs its true
  length, least turns wins, no wiggling left-right to shave a cell.
- CROSSINGS COST `crossing` (400) each, counted at grid vertices an
  earlier wire passes straight through (run ends are corners and do not
  count; a stub's apron vertex DOES, or a wire riding a card's margin line
  crossed every stub for free) and, for two diagonals, at cell centres.
- THE DIALS ARE EXPLAINED FOR A PLAYER (Jack, 2026-09-08): every
  `RouterTuningField` carries `hint` (what it is), `low` and `high` (what
  turning it down or up does), and the dev menu prints all three under
  each slider. The menu has two headings: WIRE ROUTING (Turns, Crossings,
  Negotiation, Docks, Costs, Search - every dial re-routes the board) and
  AUTO ARRANGE (the Arrange group: islandAir, searchTrials, finalists,
  polishBudget, arrangeRowGap, arrangeColumnGap, arrangeDrawerGap - shape
  the Arrange button only). `routerTuningKey` leaves the Arrange group out,
  so an arrange dial never re-solves a wire. The three spacing dials
  override the taste only when moved off their defaults
  (`applyArrangeDials`); the arranger reads the rest through
  `ARRANGE_PRICES` (polish budget, search trials, finalists).
- EVERY DIAL IS LIVE: `src/components/flow/router-tuning.ts` is the one
  `RouterTuning` object the router, the worker job and the dev menu
  share; `DEFAULT_ROUTER_TUNING` is the shipped behaviour. The dev menu
  (shift-click the version chip) has a slider and a number box per dial,
  Undo/Redo (Ctrl+Z / Ctrl+Shift+Z while the palette has focus, a slider
  drag folding into one step) and "Re-route all wires". Overrides persist
  per device (`gtnh-factory-flow.router-tuning.v1`), never in a plan, and
  ride the solve signature so a change re-solves the board.
- A grid line is a lane with 16 usable px (10 on a diagonal). Wire widths
  are fractions of a lane (`LANE_FRACTIONS`); wires that fit side by side
  share a lane with a 2px gap, packed around the line's centre, a joiner
  on the side of its own next turn. Sharing costs slightly MORE than an
  empty lane, so ribbons form a lane apart; a full lane costs heavily, so
  overlap is never chosen while a detour exists. Only port stubs stack.
- ONE WIRE PER MATERIAL BETWEEN TWO CARDS (Jack, 2026-09-08): the view's
  channel grouping in FactoryFlow (`channelEdgeIdsByRepresentative`) now
  keys on source card, target card and resource alone - a shared machine's
  two benzene recipes into one card, or into two benzene slots, draw as one
  wire with the summed rate; the flat edges stay distinct underneath for
  the solve, and deleting the wire deletes them all.
- DOCKING IS ALWAYS FREE (Jack, 2026-09-08: "get rid of the free docking
  setting"). Every wire, self loops included, offers its card's whole
  perimeter, one dock per grid line, only the corner cell itself excluded
  (`keepOutFor` in FactoryFlow: one cell on any card two cells or wider).
  The anchor toggle, `freeDockMode` on the board view / plan view, the
  fixed-port resolver branch and the dock-flip warning are GONE; old plans
  carrying the key parse (unknown keys strip). Ports remain where wires
  START (drag from a chip) and where the numbers live.
- Crossing hops (`pointsToHoppedSvgPath`) bump over any pair of
  non-parallel segments, diagonals included: a run bumps toward the upper
  side of its own line (a vertical run toward the right).
- Routing must stay deterministic for the same graph state, independent of
  zoom and render order.
- Boards past `ASYNC_ROUTE_EDGE_LIMIT` wires solve in a Web Worker
  (`grid-route-solve.ts`); the render serves the installed routes until
  the answer lands. Same pure function, same routes, same tuning; only the
  thread differs. Do not put a flat pop cap back in the A*: the cap scales
  with the window, and a wire that fails is walled in (`SEALED`), not out
  of budget. See the routing section of ARCHITECTURE.md.
- BENCHING: `window.__gtnhRouteSolve` holds the last solve's exact
  obstacles and requests; `route-capture.local.mjs <plan.json> <out.json>`
  dumps it for a plan file, `router-replay.local.test.ts` (CAPTURE=...,
  ROUTES=1) replays one and counts geometric crossings, and
  `.router-corpus/` holds captures of real community boards. Corpus on
  2026-09-08 vs the old Hanan router: crossings 4->0, 9->0, 45->20,
  23->5, 6->1, 43->28, 634->314; time roughly 2.5x (farm-power 1.7s->4.6s,
  in the worker; hv-oil 51->133ms).
- LINE THICKNESS IS ALWAYS ON (Jack, 2026-09-08: "line thickness will be
  perma enabled"). Every wire is drawn and routed at `laneWidthForHeat`
  of its flow; the switch, `lineThicknessMode` on the board view and plan
  view, and the thin-mode styling (starved dashes, per-kind widths,
  z-index lift, search-emphasised drawer wires) are GONE; wires always sit
  under the cards (`factory-flow-board--edges-under`). Old plans carrying
  the key parse (unknown keys strip).
- DIRECTION ARROWS (Jack, 2026-09-08: "very visible, but still look good
  and be the same colour as the edge"): FILLED arrowheads (`getRouteArrows`
  in FactoryFlow) in the wire's colour lifted brighter, outlined in a DEEP
  shade of the same colour (never black: a black edge read as spots ahead
  of the tip where it crossed the pipe) over a soft offset drop shadow,
  sized to the stroke and a little wider than it, one near each end and one
  every 8 cells along a long run, each kept wholly on one straight run.
  They stay at a GLANCE (`EDGE_DETAIL_ARROWS` is in the glance level) and
  draw double size there.
- CALM MODE IS SESSION ONLY, and that is a SAFETY rule, not a preference
  (Jack, 2026-09-09: "they're stuck, they can't undo it. This is an
  emergency"). `calmMode` on the board view is never read from storage and
  never written to it (`board-view.ts`); only the image export turns it on,
  for the length of a capture. The board's own switch for it went on
  2026-09-08, so a stored `true` was a room with no door - and the export
  persisted `true` and put it back in a `finally`, which never runs if the
  tab closes mid-capture. Players were stranded in softened status colours
  for good. A reload is now always the way out.
  `board-view.test.ts` pins both halves; do not make it a stored setting
  again unless the board carries a visible switch that turns it off.
- LINE LABELS ARE GONE (Jack, 2026-09-08: "dropping support for line
  labels ... permanently for everyone"): no rate pills on wires, no tag
  button, no `lineLabelsMode` on the board view, no `labelOffset` on an
  edge. Old plans and view blobs carrying the keys parse (unknown keys
  strip); `lineLabelsMode` stays in the plan-view type as a historical
  field nothing reads. The ports carry the numbers.
  Ratio drawers are the narrow exception (Jack's revision, 2026-09-12):
  every outgoing wire shows its share right beside the source exit, never
  midway down the wire. These are plain percentages, not editable pills.
- THE BOARD MENU (Jack, 2026-09-08): ONE right-click menu for the whole
  board, `src/components/flow/BoardContextMenu.tsx`, on React Flow's
  `onPaneContextMenu` / `onNodeContextMenu` / `onEdgeContextMenu`. The
  void: "New product drawer" (the pool key's item picker at the pointer,
  `addPoolStorage(resource, "drain", position)` - a drain drawer survives
  the orphan sweep and is one product drawer per resource only in pool
  mode). A machine or drawer: Clone, Delete. A wire: "Add a drawer here"
  (`insertStorageOnEdge`: the wire goes, a drawer of its resource stands
  where you clicked, one wire runs in and one out; a drawn channel of
  several flat edges all run through the one drawer) and Delete wire.
  Controls with a right click of their own (port rows, tier chips, count
  steppers) prevent the event's default and the board handlers skip a
  prevented event; boards, annotations and trash cans get no menu. Plain
  words, no tooltips, no submenus. The menu chrome is the library's
  (`LibraryMenu` / `MenuItem` in library-menu.tsx). Probe:
  `menu-probe.local.mjs <plan.json> <prefix>` (note the pane is a
  million px square under the scroll camera: aim by the `.react-flow`
  wrapper's box, never the pane's).

## Import/Export Plans

- Public setups open through `openCommunityPost`: owned posts resume their
  linked personal design; other authors' posts open a VIEW-ONLY session.
  `design-store.publicView` is transient, with no active design id or library
  record. Never autosave or flush its canvas into a personal design.
- `PublicViewBar` offers "Open a copy", which creates an unlinked, private
  personal design. Only that explicit action adds the viewed setup to the
  library. Closing the viewer returns to the previous personal design.
- `factory-store` guards project edits while `isReadOnly`; loading a personal
  design releases it. System dataset hydration and opening/folding board
  windows may update the transient view, without edit history. The UI lock
  (`use-viewer-lock.ts`) leaves marked board navigation available. Resource
  clicks and shortcuts must not open recipe search in view mode;
  `data-viewer-inspect` must never wrap resource ports or editing controls.
- A viewer keeps its public URL across reloads; making a copy removes it.
  An owner's posted design still follows autosaves through `post-follow.ts`.

- Plan import/export must preserve item/fluid identity. `fluid.*` showing in UI usually means fluid IDs were imported without resolving display resource metadata.
- When importing image-embedded or JSON plans, preserve node recipe overrides, selected machine handler, tier/config selections, and concrete oredict alternatives.
- Creating a storage/drawer by dragging from a recipe slot must create both the storage node and the edge.

## Performance

- Shared-design autosave (`post-follow.ts`) syncs the plan and metadata,
  NEVER a live-board photograph. The old 30-second preview timer forced
  glance/presentation mode and paused motion during capture, making the
  board visibly shrink and stall every minute while editing a shared plan
  (Jack, 2026-09-09). Hidden tabs could prolong it while capture waited for
  paint. Photos are taken on explicit sharing/export only; automatic saves
  keep the last shared photograph. Do not restore timed live-board capture.

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

## The Equation Books (solver rebuild, branch solver-equations)

- The BOOKS - every act, edge flow and eaten total - come from ONE direct LP
  solve in `src/lib/solver/equations-core.ts`, wired into `throughput.ts`
  behind `const EQUATION_BOOKS = true` (one-line revert). The iterative
  engine in `equilibrium.ts` still runs and keeps the DIAGNOSIS: capability,
  clog names, "one wire fixes it". If the core returns non-optimal the old
  books stand, so a solve failure degrades, never crashes.
- The doctrine (Jack, 2026-08-19): if it would fail in the game it fails in
  the planner, and otherwise EVERYTHING RUNS - a fed machine with somewhere
  to put its output never idles. Sources are inputs; products, byproducts
  and OVERSPILLING drawers are outputs. A plain buffer banks its surplus
  (visible +N/s); `bufferMode: "strict"` opts back into the clog. A
  byproduct pill changes bookkeeping, never pace. Targets are display
  arithmetic, not rows - a target-driven >100% figure survives in finalize,
  a demand-driven one does not.
- RATIO is the buffer's third mode (Jack, 2026-09-12), after non-strict
  (`overflow`) and strict. Same card size and any-side wiring. `ratioWeight`
  on each outgoing edge stores nonnegative parts (absent = 1, zero closes a
  branch); percentages normalize across the current outgoing connections.
  One drawn channel is one branch: shared-recipe slot edges to the same card
  share a combined allocation, not a fixed internal recipe mix. The model
  helper is `model/storage-ratios.ts`; both Build and Solve use the same
  equality rows in `solver/storage-ratios.ts`. Ratio buffers cannot bank:
  a saturated/blocked positive branch holds the split and throttles upstream.
  Pool ignores the saved manual split, like its other manual wires. Switching
  away preserves weights; removing a wire renormalizes the remaining ones.
  Inserting another drawer on a branch carries its parts onto the upstream
  replacement wire. The editor changes a whole drawn channel in one undo step.
  Ratio keeps the ordinary drawer colour, with a double rim and fork. No
  combined percentage or bar on the card: EVERY outgoing share is printed at
  its wire's exit. The bottom-centre pencil opens `StorageRatioEditor.tsx`, a
  compact sheet matching Settings (grey plate, bevels, output/parts/share rows).
  Switching modes NEVER opens it. No full-screen editor, blue tint, coloured
  bars, flow rates or extra settings.
- The drain pill cycles THREE ways since 2026-08-23: product, byproduct,
  trash. A TRASH drawer is the byproduct's shape (free disposal, no demand)
  with the books voided (`applyTrashedOutputBalances` covers it alongside
  the legacy trash can nodes): what it eats is neither shipped nor spare.
  The toolbar's trash can spawner is gone, and old plans CONVERT on load:
  `migrateTrashCansToDrawers` in project-normalize.ts turns every wired can
  into trash-mode drawers (one per resource, since a can drank anything and
  a drawer holds one thing) and drops unwired cans. The can node type,
  `connectTrash` and the solver's trash-role plumbing remain as dead-path
  safety for projects that never pass the normalize funnel.
- Stage chain, each optimum locked as a row before the next: max total act;
  progressive max-min FAIRNESS over acts (the game's round-robin split - a
  big asker cannot crush a small one); recycle-before-import; ship-before-
  banking (min pool fill); min total flow (canonical determinism). There is
  deliberately NO product-purpose stage - it starved real machines to fatten
  export drawers - and no "least machinery" stage - it idled machines the
  game would run.
- EQUAL-FILL rows encode round-robin as physics: machine co-consumers of one
  output port fill at the same per-pull rate (a sibling's share of its pull
  never exceeds a clean co-consumer's act). This is what makes a TAPPED
  break-even ring die instead of pretending its tap never pulls - the LP
  contains that fantasy point and these rows exclude it. Consumers the
  diagnosis marks output-throttled (disposal < 1), power-stalled or
  bare-ported are exempt (their chest fills; the port serves the others).
  Only OUTPUT-side figures may drive the exemption - using supply-aware
  capability exempted the starving tap itself.
- The LP engine is the homegrown two-phase dense simplex in
  `src/lib/solver/simplex.ts` (Dantzig entering rule, permanent Bland
  fallback after a 60-pivot degenerate stall, row equilibration,
  deterministic). Its one historical bug - degenerate artificials surviving
  phase 1 through slack columns, then silently regrowing in phase 2 - is
  fixed and pinned by the doctrine exam. Known straggler: ONE community
  board ("Total Oil Products", 73 machines of heavily degenerate oil
  chains) exhausts the iteration cap and falls back to the old books; the
  other 153/154 solve, and HiGHS solved it in the lab if a second-opinion
  engine is ever wanted in production.
  `src/lib/solver/equations-doctrine.test.ts` is the exam,
  `src/lib/solver/simplex.test.ts` pins the engine itself, and
  `docs/solver-equations.md` is the design page. The one surviving lab tool
  is the tick simulator (`src/lib/solver-lab/simulate.ts`), the independent
  "what does the game literally do" oracle; the lab's duplicate model
  builder and its HiGHS adapter were deleted with the `highs` dependency
  once the production core existed. Scratch harnesses belong in
  `*.local.test.*` files, which the vitest config excludes from the suite.
- The two ring DIAGNOSES (`death-spiral.ts`, `clog-lock.ts`) stand down
  for an UNFINISHED SETUP (Jack, 2026-09-02): a member with no power or a
  bare slot (`findBareSlots` in `bare-slots.ts`, rules-aware) is what stops
  a ring, so it is never a dead loop; and a clog-lock vent whose every
  machine taker (through drawers) is dead even in the vented world is
  withdrawn and the world re-solved until nothing more falls, so a machine
  feeding a stopped card is never "choking on its surplus". The verdict
  then reads the neighbours honestly: a card at 0% whose takers have all
  stopped is CLOGGED with `clog.stoppedTakerName` ("X has stopped. Its own
  card says why."), a stopped-by-setup taker's ask is never a deficit
  (no BOTTLENECK at 0%), and the sole-outlet supply uplift is refused for
  a feeder that cannot ramp, so the fed card reads STARVED and names it.
- Power stalls are pinned to act 0 INSIDE the LP so the outage propagates by
  conservation. Balance dust snaps at 1e-5 relative (`balances.ts`) because
  LP flows carry solver-precision dust proportional to board scale.

## The Three Modes (Build, Solve, Pool) And The Rules That Went

- The board-wide POWER DISPLAY selector is restored (Jack, 2026-09-11):
  beside the rate key, EU/t or amps of a chosen voltage tier, with click
  selection and wheel stepping. It is separate from each machine's hatch
  voltage and amperage controls. `powerDisplayUnit` and `useRateDisplayUnits`
  repaint the numbers without changing the project or solving again.
  Browser preference: `gtnh-factory-flow.power-display-unit.v1`.
  Nonzero power readings below 0.01 display `<0.01`; zero stays zero.
  Memoized inspector rows subscribe to both display dials themselves.
  Do not remove this display setting when changing machine power controls.
  Toolbar folding now has an intermediate `modeIconsOnly` stage based on
  BOARD width. Its size budget separates rem-sized controls (Firefox text
  zoom/default fonts) from fixed-pixel mode/power keys; trays and mode keys
  cannot flex-shrink. Test expanded checklist and manual recalculate too.

- TOOLBAR LAYOUT since the rework (Jack, 2026-09-06): LEFT row = undo
  pair, rate keys, pool mode's product tray (`PoolSpawnKeys`, the whole
  tray slides in only while pool is on, so no empty plate shows). RIGHT
  row, left to right = the MODE SWITCH tray, the paint tray (palette,
  paint, image), arrange, the view tray (annotation tools drop-down, view
  options), and the BIN last of everything. The mute key and the "Watch
  it build" door left the board for the Settings dialog (Sound section,
  a Watch it build section). The generator, custom rate and crop farm
  spawners left the build tray for the top of the items column
  (`SpawnKeys`, dressed like the columns' hide keys: no ground, plain
  hover, no colour). Fold widths are MEASURED numbers in toolbar-fold.ts;
  re-measure with a probe after touching either row.
- The board has THREE MODES on one switch (`ModeKeys` in FactoryFlow.tsx:
  three plated keys, the engaged one pressed, icons coloured in every
  state, and a thin bar in the engaged mode's colour sliding along the
  bottom edge; `setBoardMode` in the store),
  exactly one lit, each handing the planner more of the work (Jack,
  2026-09-06): BUILD - you set machines, counts and wires, the board
  reports what flows; SOLVE - you set machines and wires and type what
  you want, the board counts the machines; POOL - you set machines and
  type what you want, the board counts, wires and imports. Under the hood
  build is both flags off, solve is `solveMode`, pool is `solveMode` plus
  `poolMode`, so old plans open in the right position. Each mode has its
  own sound (`buildOn`, `solveOn`, `poolOn`) - three separate things, not
  a ladder. Build's icon is Blocks (Jack rejected the hammer).
- THE SETUP RULES ARE GONE (Jack, 2026-09-06): no sheet, no key, no
  `setSetupRules`. Free inputs and free outputs were what the modes now
  do (build and solve are closed setups, pool imports and banks by
  itself), and LOOSE CELL WIRES IS ALWAYS ON. `getSetupRules` still
  exists because ~20 callers ask it, and answers every plan the same:
  `{freeInputs: false, freeOutputs: false, looseCellWires: true}`. The
  load funnel drops stored `setupRules` and the legacy `assumeBoundaries`
  (`adoptSetupRules` in project-normalize.ts); the schema still accepts
  them so old JSON parses. A test that needs an open boundary calls
  `closeBoundaries` itself. `src/lib/solver/setup-rules.test.ts` pins all
  of this. Community plans saved with free inputs/outputs on now solve
  as closed setups - a known, decided consequence.
- `FactoryProject.poolMode` (Jack, 2026-09-05) is the DEEPER SOLVE MODE:
  pool implies solve, and leaving solve leaves it too. You pin product
  amounts or machine counts; the plan does the rest - counts, imports,
  outputs, wiring. ONE
  shared pool per resource: every machine output feeds it, every consumed
  input drinks from it, surplus banks, and anything NOBODY makes is
  imported and listed under INPUTS (the pool is a source). Wires DO NOT
  EXIST in it: the solve drops them whole and the board fades the wire
  layers (`pool-mode.css`, `factory-flow-board--pool`); they come back
  untouched when the mode goes off. Port-to-port drags land nothing.
- The mechanism is `expandPool` in `src/lib/solver/pool-mode.ts`: hidden
  drawers (`pool:<key>`) and wires (`pool-edge:...`) added to the project
  before the solve, so conservation, fairness, recycle-before-import and
  banking apply unchanged. A pool with feeders and takers is an overflow
  buffer; feeders only, a PRODUCT drain (not byproduct - a byproduct asks
  for nothing and a machine whose only outlet asks for nothing read "on
  demand" when it was really starved); takers only, a SOURCE (the import).
  The expansion is cached per project object and the expanded project
  expands to itself; the solve keeps the hidden edges and storages in the
  result so the rails can read them.
- Everything that walks the graph asks `getPoolProject(project)` first:
  `deriveNodeVerdict`, `findUnwiredNodeIds`, `buildRailPorts`,
  `buildLimitLadder`, `findDeathSpirals`, `findClogLocks`. A starved card
  looks THROUGH a pool to the machine feeding it (`findUpstreamCulprit`).
- Drawers carry over: a drawer's pool side is `FactoryStorage.poolSide`
  when set, else what its (ignored) wires said it was for (`poolSideOf`:
  fed only = drain, drawn only = source, a buffer has no side and is idle).
  A DRAIN drawer is the plan's declared product (its `drainMode` still says
  product/byproduct/trash, and `targetPerSecond` is the solve ask). There
  is NO source key (Jack, 2026-09-05): the pool imports by itself, so a
  source drawer says nothing. New product drawers come from the build
  tray's one pool key (`PoolSpawnKeys` -> `addPoolStorage`, through the
  recipe search's `ItemPickerPopover`) or a drag off a port into empty
  space (`addStorageForConnection`, side from the port, no wire).
- CELLS AND FLUIDS are bridged inside the pool: `listPoolCellPairs` names
  every cell/fluid pair the plan's slots carry in both forms (the search's
  `isFluidEquivalentToFilledCell` match), the board fetches each cell's
  litres from the Canner (`fetchLitresPerCell`, `setPoolCellRatios`, stored
  on the plan as `poolCellRatios`, never guessed), and the expansion adds
  the loose-wire rule's hidden free Tank per direction - only FROM a side
  something real feeds, so a form nobody makes still imports instead of
  two tanks feeding each other.
- Chrome: the pool key is the third of the `ModeKeys` (Waves icon). Each
  lit key has its own colour and nothing else changes: build gold
  `#f5b642`, solve violet `#c78bff` (cyan clashed with pool), pool blue `#6f9cff` (the product key on
  the build tray lights the same blue while its picker is open). There is
  NO room light for any mode (Jack, 2026-09-06; the solve and pool auras
  were removed). Sounds: `buildOn` a latch (tick, then a wooden knock),
  `solveOn` the shimmer, `poolOn` a drop into water (a bent-up plink and
  its echo, all high and glassy - the low-swell version "sounded like a
  fart" and must not come back). The wire layers fade under
  `factory-flow-board--pool` (pool-mode.css).
  `src/lib/solver/pool-mode.test.ts` is the exam.

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

