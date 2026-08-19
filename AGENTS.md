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
- The chip opens the changelog, so every release needs ONE entry in
  `src/lib/changelog.ts`. Write it for players, not developers: what changed on
  THEIR board, a headline plus at most four notes. Every note is one short
  sentence. No second sentence saying what it used to do, no reasoning, no
  jargon ("solver", "refactor", "edge role"). Newest first.
- Default working branch for feature work is `develop`.
- `main` is production. Push/merge there only when the user asks for main/prod deployment.
- `https://gtnhplanner.com/` is production for this repo.
- `origin` is `jackwrichards/gtnh-factory-flow` (this project). `upstream` is
  `Samiracle64/gtnh-factory-flow`, the repo this was originally forked from -
  it is not a push target and the two have long since diverged.
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

## Cells Are Items

- A filled cell is an ordinary ITEM. It does not satisfy its fluid's slot, and
  the fluid does not satisfy the cell's. `resourceMatchesInput` compares kinds
  strictly; do not reintroduce a cross-kind branch.
- Crossing the two forms takes a Canner on the board, exactly as it does in
  game. There are ~4,000 Canner recipes in the dataset (~1,150 fill, ~1,150
  empty), so the bridge is always a placeable machine, and GT registers ~3,000
  recipe shapes in BOTH forms so most chains just need the matching variant.
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

## Machine Configs And Multiblocks

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
  - Still on scraped data, deliberately: the 11 fusion reactors (need
    `fixedVoltageTier` and their own overclock), and the machines whose
    coefficients read recipe metadata or the recipe type (Nano Forge, PCB
    Factory, Naquadah Fuel Refinery, Component Assembly Line, Dangote
    Distillus, Precise Auto-Assembler, QFT, Eye of Harmony).
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

## Tabs, Cameras And Where A Plan Lands

- The Welcome tab's `active` flag is per browser SESSION
  (`sessionStorage`, `src/lib/tour/welcome-tab.ts`). A reload is not a fresh
  visit: it must leave you on the tab you were on. `open` and `showOnStartup`
  are permanent.
- Each design tab remembers its own camera:
  `src/lib/designs/design-camera.ts`, localStorage keyed by design id. It is
  deliberately NOT part of the plan - a shared setup carries positions and view
  settings and no viewport, so someone opening one gets it framed.
  - Not recorded inside a pocket (those coordinates are their own space, and a
    plan always loads at the top level) and not recorded during a design
    handover, which is what the latch in that file is for.
  - A tab with no camera stored yet is framed, which is what every tab used to
    get.
- The board has NO `fitView` prop, on purpose. React Flow's fit-on-init waits
  for cards to be measured, so on a page load it fires after the plan arrives
  and stamps over the restored camera. The app frames for itself on every path
  that puts cards on the board (design store, plan import, blueprint paste,
  tours); do not add the prop back.

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

## Board Gestures

- A port ROW answers, not its little item icon: left click opens what makes the
  resource, right click what uses it, R and U do the same for the row under the
  pointer (`port-browse.ts` holds the pointed-at row imperatively — do not
  subscribe cards to it), a long press opens a two-item menu for a finger, and a
  drag still wires. The icon is art with `pointer-events-none`; the full-row
  React Flow handle underneath it takes the drag.
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
  from it. Read the "board grid" section of `ARCHITECTURE.md` before changing
  any size, offset, or padding on the flow board.
- The grid is always on. There is no snap toggle and no grid button; do not
  reintroduce one.
- Node positions, node sizes, and port row centres must all be multiples of
  `BOARD_GRID`. Verify with a Playwright measurement, not by eye.
- Blocks whose height depends on content use `GridBlock` in `RecipeNode.tsx`:
  round up to the next cell, never compress to fit.

## Routing Links

- Wires are routed by the grid router (`src/components/flow/grid-edge-router.ts`),
  one A* solve over every edge at once. Do not reintroduce per-edge candidate
  scoring or hardcoded special-case paths.
- Routes travel on 20px grid lines and never come within one cell of any card.
  The only exception is the port stub — the final hop across a card's margin
  into the port itself.
- A grid line is a lane with 16 usable px. Wire widths are fractions of a lane
  (`LANE_FRACTIONS`); wires that fit side by side share a lane with a 2px gap,
  packed around the line's centre. Riding a shared lane is slightly cheaper
  than an empty one, so wires travel together and split near destinations.
- Wires never overlap outside port stubs. Overfull lanes cost heavily, so a
  latecomer takes the next line over; only at a port, where any number of
  wires can converge on one row, may they stack — and only on the stub.
- Docking is a VIEW toggle (the anchor button, on by default): free mode
  attaches a wire wherever on the perimeter routes cheapest (any side,
  corners and their two neighbouring cells excluded, centre-biased, dock
  points claimed so no two wires share one); port mode pins wires to the
  classic fixed ports - inputs left, outputs right, storage side centres.
  Ports always remain where wires START (drag from a chip) and where the
  numbers live.
- Routing must stay deterministic for the same graph state, independent of
  zoom and render order (edges are solved in routeIndex order).
- Edge rate labels are a VIEW mode, off by default: the tag button in the
  board toolbar shows lean rate pills on the lines. No dragging, no popover.

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

