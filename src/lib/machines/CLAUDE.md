# Machine math (src/lib/machines)

Game source for checking mechanics: GT5-Unofficial and friends at `C:\Users\jack\gtnh-sources`;
the reference calculator (ShadowTheAge/gtnh, MIT) at `C:\Users\jack\gtnh-reference`.
Source beats the wiki, the workbook and the reference. Engine truth is
`OverclockCalculator`, `ParallelHelper`, `ProcessingLogic` and each MTE's
`createProcessingLogic`; GT++ `*Legacy` classes are fossils. Java `int *= float`
computes in float: replicate it.

## The machine table

- `machine-table.ts` holds curated behaviour (speed, EU discount, parallels, overclock
  style, extra `controls`), transcribed from the reference's `src/machines.ts`. It wins
  over scraped data; machines absent from it fall back to the dataset.
- Never add an entry by guessing. Their voltage tiers start at LV = 0 (ours at ULV = 0, so
  their `voltageTier + 1` is our ordinal), and their `speed` is throughput (ours is a
  duration multiplier, `1 / speed`). `machine-table.test.ts` checks every entry against
  `__fixtures__/reference-coefficients.json` and says how to regenerate it; run it.
- `ctx.tier(id)` is an option's position; `ctx.value(id)` is the number behind a count
  knob. Formulas that read a count must use `value`.
- A table machine that declares `speed` or `power` seeds from the recipe's base stats
  (`machineTableSeedsFromBase`): the pipeline bakes scraped multipliers into handler
  stats. Entries without them keep handler stats (the Electric Furnace family's are absolute).
- For table machines, scraped tooltips supply only control DEFINITIONS (which knobs,
  icons, tier lists). Table-less machines still run on scraped effect values
  (`machine-effects.ts`); don't trust those when adding an entry. Where the reference
  punts, follow the mod source; deliberate divergences are listed in `machine-table.test.ts`.
- Still on scraped data on purpose: Nano Forge, PCB Factory, Component Assembly Line, QFT,
  Eye of Harmony (their coefficients read recipe metadata).

## Overclocks and ticks (src/lib/solver/overclock.ts)

- Parallels are paid for with power BEFORE overclocks; only leftover voltage buys steps.
- Heat overclocks: only the `HEAT_OVERCLOCK` entries (EBF, Mega EBF, Volcanus, Exothermic
  Hearth, Zyngen, Utupu-Tanuri). A special value of 0 can be a real heat requirement
  (dehydrators).
- Recipes run in whole ticks. Over one tick GT truncates. Under one tick a multiblock
  banks leftover speed as parallels and a singleblock wastes it (`canSubTick`). A recipe
  with no handlers gets an invented `kind: "single"` placeholder, which is not evidence.
- `runtimeCalculation` in the dataset is `OverclockCalculator` alone (never saw
  `GTParallelHelper`), so it is not authoritative for multiblocks: `prefersCuratedMachineMath`.
- Singleblock tiers come from real catalysts (`availableTiers`). Never interpolate a
  machine that doesn't exist (Cold Trap has IV and ZPM, no LuV).

## Hatch power (src/lib/solver/hatch-input.ts)

- A fresh multiblock seeds the recipe's minimum tier and full-parallel supply in WHOLE amps.
  A tier change lifts a supply under 1A to 1A (`ampsForNewTier`).
- Switching single <-> multi keeps the voltage (`carryMachineVoltage`): single to multi is
  one 1A hatch at the single's tier, floored at the recipe's draw tier; never rerun the
  full-parallel seed on a switch (voltage-scaled parallels chase it up the tiers).

## Specific machines (most have a test named after them; the rest are in machine-table.test.ts)

- Fusion (`fusion.ts`): fixed reactor tier; 2/2 OCs on I-III, 4/4 on IV-V, capped by mark
  minus recipe tier; compact reactors run 64 parallels per mark above the recipe's startup
  band (strict `<` for bonuses, `<=` for tiers). Startup EU is the recipe's
  `metadata.fusionStartupEu` (from FUSION_THRESHOLD); `data/fusion-startups.json`
  fingerprints repair old exports (regenerate with `tools/audits/extract-fusion-startups.mjs`).
  Never strip Roman numerals from fusion controller names.
- Extreme Entity Crusher (`extreme-entity-crusher.ts`): one recipe per mob, replayed from
  kubatech (kill ticks, its own perfect OC with 20-tick floor, infernals as expected value
  in float math, Well of Suffering, Looting, void). `fullPowerPool`. Mob swaps go through
  `swapMachineRecipe` in place; an EEC card never takes a second recipe.
- Dangote Distillus: Tower mode 12 parallels x3 speed; Distillery mode x2 speed, 15% EU,
  8 parallels per summed-voltage ordinal at max height. Selected by `source.recipeMap`.
- Precise Assembler (PrAss): normal Assembler handler x2 speed with unit-casing parallels;
  the dedicated precise map runs base speed, one parallel, casing minimum from special value.
- HILE (`hile.ts`): one `laserSource` voltage/amp choice; cube-root parallels; supplies no power.
- Neutron Activator (`neutron-activator.ts`): integer pipe height >= 4, 0.9f per extra
  layer, CEIL duration above one tick, FLOOR parallels below. Not the generic rule.
- Extreme Heat Exchanger: a fixed 20-tick cycle (`cycleTicks`) replaces the recipe's
  duration everywhere, search card included; its recipe amounts are per second. The
  dataset's 1 tick is Java's 0 clamped.
- Utupu-Tanuri is both `Multiblock Dehydrator` and `Vacuum Furnace`; keep both aliases on
  one entry (`minimumHeatFromSpecialValue`).
- Naquadah Fuel Refinery: special value = minimum coil tier (`minimumFromSpecialValue`).
- Pipe casings are two families: `pipeCasing` (FLUID, Bronze-Tungstensteel: Chemical
  Plant, Multi Autoclave) and `itemPipeCasing` (ITEM, Tin-Black Plutonium: lathe, mixer,
  wire factory, dissection, Amazon depot, which hide the fluid knob via `hidesControls`).
  The Industrial Autoclave takes both (fluid pipe = EU discount, item pipe = parallels).
- Coke Oven alias matches the brick oven too: no `cokeOvenSlices` control means no
  overclocks and one parallel.
- Steam: the 8 steam multis are table entries (8 parallels, no OC, shared pressure
  control); steam singleblocks are synthesized in `src/lib/model/recipe-rules.ts`. EU stays
  zero on steam cards; litres are billed instead, never both.
- Crafting maps run on GT++'s Auto Workbench (synthesized in `recipe-rules.ts`, flat 2048 EU
  per craft) with instant hand-craft as the second handler.
- TGS: output depends on tier and tools chosen per empty input slot (real item icons); no
  relevant tool for an output means zero.

## Config controls

- Controls are structured data (`machineConfigControls`), never frontend special cases.
  Several dimensions stack on one node (coil + pipe casing). Prefer `machineConfigTiers`;
  keep legacy `coilTier` loading.
- Disable tier controls a handler ignores. Manual/instant crafting tables are not timed
  machines; with no duration they are instant, never a fake `0 EU / 1s`.
- Keep knob captions short (`CAPTIONS` in `SettingTile.tsx`); tiles are 96px minimum and
  truncate.
- A recipe's special value means different things per map; never read it as heat
  globally. Multiblock-ness comes from the exported `multiblock` flag, the source class or
  a "Controller Block" tooltip line (`machine-configs.mjs`), never from the map.
- Exotic (multi-amp, laser) hatches: one per machine, and their amps never raise the
  parallel ordinal.
- Crops (CropsNH): chance is display-only, already baked into the amount. The wiki's
  Industrial Farm table is wrong; the mod source is right.
