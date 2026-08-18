# Generators: Real Energy Generation in Factory Flow

Date: 2026-08-18
Status: approved (design), pending implementation plan
Branch: `develop`

## 1. Background

The 2.15.0–2.16.1 releases shipped the power *consumption* side of the app:
per-node EU/t reports, power tooltips, and a shopping list with machine tiers
and power. The board has no way to *generate* power. The only "fuel" concept
is an invisible per-project estimate (`gtnhFuelProfiles` in
`src/lib/model/fuels.ts` — benzene / biodiesel / steam guesses) that
`calculateFuelEstimate` (`src/lib/solver/throughput.ts:1005`) converts total
EU demand into a made-up L/s number. The dataset contains **zero** generator
fuel entries: 31 recipe maps — every generator fuel map — export as empty,
because the oracle's `mDuration <= 0` guard in
`GtnhCalcOracleExporter.exportGregtech` drops them — they are fuel *value*
definitions (`mDuration` 0; the burn cycle lives in the machine code, not the
recipe) — and the steam turbine has no recipe map at all.

Goal: implement all GregTech-core energy generation with **real game
numbers**, so a player can power a board with actual machines and actual
fuel chains.

### Locked decisions (user, 2026-08-18)

| Decision | Choice |
|---|---|
| Scope | GregTech core machines: Gas Turbine, Steam Turbine, Semifluid / Combustion / "Thermal" / Plasma generators, Fission Reactor, Fusion Reactor, Solar, RTG. Reactor mods (Naquadah, HTGR, LTFR, Solar Tower, Magic Energy Absorber) excluded. |
| Data source | **Fix the oracle export.** The dataset pipeline (live GTNH client) is the source of truth; no curated in-app table. |
| Power model | **Wireable EU resource** — energy is a first-class resource on the board, not a per-node attribute. |
| Optimizer | Proposes generators to close a board's power deficit, with their fuel added to the required inputs. |
| Old fuel estimate | Replaced and removed, not kept as a fallback. |

### Scope flags from game-source investigation

- **"Thermal Generator" and "Geothermal Generator" are the same machine**
  (`MTEGeothermalGenerator`; its fuel map is the "Thermal Generator Fuels"
  map `gt.recipe.thermalgeneratorfuel`). One machine, not two.
- **There is no wind generator in GTNH.** The only "wind" machine is the
  BartWorks windmill, a kinetic-powered macerator (a processing machine).
  "Wind" is dropped from scope; the spec says so rather than shipping a fake.
- **Boilers ride the same path, not a new one.** The boiler fuel maps
  (`denseLiquidFuels` = "Semifluid Boiler Fuels", `thermalBoilerRecipes`)
  are also empty: like the generator fuel maps they are `FuelBackend` value
  definitions, not timed recipes — and the steam rate lives in the machine
  code (`getProductionPerSecond()`, consumed 1:1 with water, produced every
  10 ticks). So the boiler family (the small boilers and the Large Boiler
  multiblock) is covered by the **same live-methods oracle pass** as the
  generators, and normalizes to an **ordinary production recipe** (fuel +
  water in, steam out — no energy, no `generator` metadata). The Steam
  Turbine therefore gets a real steam source on the board; no new app code
  beyond what the generator feature already builds.

## 2. The in-scope machines (game source of record)

All from `GTNewHorizons/GT5-Unofficial` (the live GTNH mod source). The
oracle calls these machines' own live methods; the table is context for the
implementer, **not** a transcription source — numbers never enter the app
by hand.

| Machine | Class | Fuel source | Output rule (game) |
|---|---|---|---|
| Gas Turbine | `MTEGasTurbine` | `RecipeMaps.gasTurbineFuels` ("Gas Turbine Fuel") | base generator formula: `mSpecialValue × efficiency(tier) × consumedPerOperation / 100`, every 10 ticks |
| Steam Turbine | `MTESteamTurbine` | **no recipe map** (hardcoded steam) | `getFuelValue(steam) = 3`, consumed = `getEfficiency() = 6 + tier` |
| Semifluid Generator | `MTESemiFluidGenerator` (gtPlusPlus) | `RecipeMaps.semiFluidFuels` ("Semifluid Generator Fuels") | base generator formula |
| Combustion Generator | `MTEDieselGenerator` | `RecipeMaps.dieselFuels` ("Combustion Generator Fuels") | base formula, `max(value, vanillaFuelValue × 3)` |
| Thermal (= Geothermal) Generator | `MTEGeothermalGenerator` (gtPlusPlus) | `RecipeMaps.hotFuels` ("Thermal Generator Fuels") | cap `5000 × tier`, efficiency `100 − 7 × tier` |
| Plasma Generator | `MTEPlasmaGenerator` | `RecipeMaps.plasmaFuels` ("Plasma Generator Fuels") | base generator formula |
| RTG | `MTERTGenerator` (gtPlusPlus) | `RecipeMaps.rtgFuels` ("RTG") | day-based burn (`mDayTick < 24000`), base generator formula |
| Solar Generator | `MTESolarGenerator` | **no fuel** | `maxEUOutput() = V[tier]` flat, always on |
| Fusion Reactor | `MTEFusionComputer` (1–5) | `RecipeMaps.fusionRecipes` — **already exported, 205 real entries** (mEUt, duration, `FUSION_THRESHOLD`) | the game negates `mEUt` (`if (mEUt > 0) mEUt = -mEUt`); per-computer facts from the live computer |
| Fission Reactor | `MTENuclearReactor` (gtPlusPlus, multiblock) | `RecipeMaps.fissionFuelProcessingRecipes` (`gt.recipe.fissionfuel`, "Nuclear Fission") | live reactor methods; flagged fallback to the map's `mSpecialValue` if the multiblock cannot be instantiated for a call |
| Boilers (steam source) | `MTEBoiler` family (Bronze/Steel/Lava/Solar variants) + the Large Boiler multiblock | `denseLiquidFuels` ("Semifluid Boiler Fuels") / `thermalBoilerRecipes` — value definitions | fuel + water (1:1) in, `getProductionPerSecond()` L/s of steam out — a production machine, not a generator |

All fuel-burning generators share `MTEBasicGenerator` semantics: output is
capped at `maxEUOutput() = V[mTier]`; fuel burns on a 10-tick cycle (or the
machine's own cycle); item/cell fuels return an empty container
(`getEmptyContainer` from the fuel map's output(0)).

## 3. Data pipeline

### 3.1 Oracle — new "generators" domain

Alongside the existing `OverclockCalculator` runtime pass, the exporter gains
a generator pass. For each in-scope family, for each voltage tier present in
the live game (the oracle enumerates real meta items — no hard-coded tier
lists), it instantiates the machine and calls its own methods:

- **Fuel-burning machines**: for each fuel in the machine's recipe map,
  `getFuelValue(fuel)`, the consumed-per-operation amount, and
  `maxEUOutput()`. The diesel generator's vanilla-fuel ×3 fallback is
  included for free because the live method is called.
- **Steam Turbine**: no map — call `getFuelValue(steam)` directly. This is
  why the fix is a new domain, not a guard tweak: a machine with no map can
  never be exported by reading maps.
- **Solar**: no fuel — per tier, `maxEUOutput()` only.
- **Fusion**: the 205 fuel recipes are already exported; the pass adds
  per-computer facts (which computer tier runs which fuel, EU rate, plasma
  output) by asking the live computer.
- **Fission**: the `fissionfuel` map supplies the fuels; per-fuel output from
  the reactor's live methods, with a **flagged** fallback to
  `mSpecialValue` if instantiation for the call fails (the export records
  which values came from the fallback).
- **Boilers**: for each boiler variant, per fuel in its fuel map, the live
  `getProductionPerSecond()` (steam out), the water consumption (1:1 with
  steam), and the steam kind (steam vs. superheated, per the variant).
  Exported with the same shape; the normalizer turns it into an ordinary
  production recipe, not a generator entry.

**Provenance doctrine** (mirrors the machine table's "no guessed entries"):
every number in the export is computed by the live game. There is no
transcription fixture to maintain because there is no transcription.

### 3.2 Export shape

Per machine family:

```json
{
  "machine": "Gas Turbine",
  "entries": [
    {
      "tier": 1,
      "fuels": [
        {
          "kind": "fluid",
          "id": "fluid.benzene",
          "displayName": "Benzene",
          "periodTicks": 10,
          "consumedPerOperation": 4,
          "euPerOperation": 512,
          "maxEuT": 128,
          "containerOut": { "kind": "item", "id": "item.gregtech.cell_empty" }
        }
      ]
    }
  ]
}
```

- `tier` uses the app's voltage ordinal convention (ULV = 0, LV = 1, …
  MAX = 11); the oracle maps from the game's `mTier` with the documented
  off-by-one.
- Solar entries have `fuels: []` and a per-tier `euPerSecond`.
- Fusion entries reference the existing exported fusion recipe ids plus the
  per-computer rate facts.
- `containerOut` is present only when the fuel map's recipe has an output(0)
  (cell fuels → empty cell; fluid fuels → absent).

### 3.3 The `mDuration <= 0` guard

The guard stays. Every in-scope fuel map (generator fuels, boiler fuels)
consists of *value definitions*, not timed recipes — the burn/production
rates live in the machine code, not in `mDuration`. Letting duration-0
recipes into the recipe index would break solver and UI, so none of these
maps are exported as recipes at all. The semantic facts travel in the
generators domain instead (3.1), and the **normalizer** turns them into
recipe-shaped entries (3.4). The original "fix the oracle export" ask
resolves to: a new live-methods domain, not a guard tweak.

### 3.4 Normalizer — generator domain → recipe-shaped entries

`normalize-oracle-export.mjs` gains the `generators` domain:

- Each (machine, tier, fuel) becomes a recipe-shaped entry:
  - `durationTicks: 20` (normalized 1-second cycle),
  - fuel amount = per-second consumption (`consumedPerOperation × 20 / periodTicks`),
  - `eut` = per-second EU, **clamped to `maxEuT`** (the steady-state output a
    generator can actually push to its grid),
  - `generator` metadata: `{ machine, tier, maxEuT, periodTicks,
    euPerOperation, source: "oracle" | "fission-fallback" }`.
- Each such entry is a **machine handler option** for that machine family at
  that tier: the machine picker shows the family, the tier choice picks the
  grid, the fuel choice picks the entry (the node selecting its recipe —
  existing mechanism).
- **Boilers**: same 1-second shaping, but the result is an ordinary
  production recipe — fuel + water inputs, steam output, **no** `generator`
  metadata, no energy. It appears in the machine picker and recipe book like
  any other machine.

**Validation (no silent fallbacks, per the dataset doctrine):**

- unknown machine id (not in the machine catalog) → warning, entry dropped;
- per-second EU above `V[tier]` after clamping would still be possible only
  from a bad `maxEuT` → warning (an oracle bug, not a real value);
- empty `fuels` on a fuel-burning machine (non-solar) → warning;
- a boiler entry with no water input or zero steam output → warning;
- fission fallback values are recorded and surfaced in the export, not
  silently mixed.

### 3.5 Pipeline verification

After `gh workflow run "GTNH dataset pipeline" --ref develop -f channel=both
-f publish=true -f force_rebuild=true` and `gh run watch`:

- inspect the **published** gzipped datasets (not just CI status):
  `generators` domain present and non-zero for every in-scope family;
  boiler entries present as ordinary recipes with a water input and non-zero
  steam output;
- spot-check a few numbers against the in-game machine tooltips (transport
  check — the oracle *is* the game);
- fusion entries unchanged (205, same values).

## 4. Model

- `ResourceKind` (`src/lib/model/types.ts:8`) gains `"energy"`.
- Resources: `energy:lv` … `energy:max` — one per grid, keyed by the app's
  voltage ordinal (LV = 1). Single identity: no alternatives, no oredict, no
  cell equivalents.
- `resourceMatchesInput` (`src/lib/model/resources.ts:264`) already compares
  kinds strictly — energy can never satisfy a fluid or item slot, and they
  can never satisfy energy. The cells-are-items doctrine extends to power
  with zero new code.
- Rate unit: EU/s with the existing k/M/G EU formatting from the power
  tooltips.
- The dataset's `generators` domain is **optional in the Zod schema**: an
  older dataset without it registers no energy resources, shows no generator
  machines, and nothing else changes. Graceful absence, no fallback values.
- Energy entries join the **resource index** so port-row gestures (R/U,
  left/right click) and recipe-book search work on power: "what makes
  energy:lv" lists the LV generators.
- There is no in-game "EU" item icon: energy uses the app's existing bolt
  glyph from the power UI, not a dataset atlas path.

## 5. Node model

**A generator is a recipe node, not a new node type.** The normalized
1-second entries are ordinary recipes (fuel in → energy out, plus
`containerOut` where present). Consequences:

- generator cards are ordinary NEI machine cards;
- fuel choice = the node's recipe choice (existing mechanism);
- pockets, plan import/export, blueprints, tooltips, compact mode: unchanged;
- the only new surface is the energy port row and the inverted power report.

## 6. Solver

- The existing power math (`src/lib/solver/power.ts`,
  `src/lib/solver/power-report.ts`) remains the source of truth for **how
  much** a machine draws (machine-table EU/t × parallels × overclocks,
  hatch/amp pool rules). That number is now also the node's **input
  requirement** on `energy:<its grid tier>`.
- Energy flows through the throughput/balance machinery exactly like any
  rate fluid. No new solver subsystem — one new resource kind.
- The per-node power **report stays** as the player-facing surface
  (hatches, amps, pool, "you'd need an HV hatch at 2A"), but the node's
  *state* (ok / under-powered) is derived from whether the solver satisfies
  that energy port. The report becomes an annotation on the port.
- "Over-tier" becomes what it physically is: an `energy:<tier>` deficit the
  board can't fill — shown as a shortage, with a tooltip note that stepping
  voltage (transformers) is not modeled.
- **Optimizer**: energy deficits close like any resource deficit. The
  "producers of energy:lv" are generator entries; proposing a generator adds
  its fuel to the board's required inputs, which can recurse into a
  production chain (the optimizer may propose the gas turbine *and* the
  benzene chain feeding it).
- **`fuelEstimate` is deleted**: `calculateFuelEstimate`
  (`src/lib/solver/throughput.ts:1005`), `gtnhFuelProfiles`
  (`src/lib/model/fuels.ts`), the project fuel-profile setting, and
  `normalizeProjectFuelProfiles` in `project-normalize.ts` (old plans
  silently drop the setting). Power demand is real generator fuel on the
  board. One source of truth.
- Edge cases: generators with no consumers → energy *surplus* in the
  shopping list; tier mismatch → honest deficit; zero-EU nodes (crops,
  apiary, …) get no energy port, matching today's `hasPowerReport`
  exclusions.

## 7. UI

- **Generator card**: ordinary machine card — fuel input row (icon + rate),
  energy output row (bolt glyph, EU/s, grid tier). Tooltip: produced EU/t,
  the `V[tier]` grid cap (shown when the fuel's burn rate is capped by it),
  burn period.
- **Consumer card**: one energy *input* row ("8.4 kEU/t on HV"). Existing
  power tooltip content stays; the row is the port-browse / recipe-book
  target.
- **Machine picker**: generator families appear as ordinary machines with
  tier choices. Nothing new.
- **Shopping list** (`src/components/MachineShoppingList.tsx`): a new
  **power balance block** above the machine list — per grid tier, supply
  (generators) vs demand (consumers), surplus/deficit chip in the existing
  chip styles, plus a collapsed one-line net summary. Optimizer-proposed
  generators land in the existing machine list. Compact mode: it lives in
  the shopping-list drawer — no new layout.
- **Recipe book**: "what makes energy:lv" works through the existing flow.
- **Out of scope, stated where it bites**: transformers (tier mismatch is an
  honest deficit; tooltip says stepping voltage isn't modeled), reactor mods,
  wind (no such machine), XP/pollution byproducts.

## 8. Release

The dataset and the app ship separately; the ordering is designed for:

1. **Oracle + normalizer first** → rebuild both channels → verify the
   published datasets (3.5).
2. **App second** — safe either way because the domain is optional: an old
   dataset shows no generators, no energy resources, no crash.
3. **One release, one bump, one entry** — check
   `https://gtnhplanner.com/api/version` first; minor bump (feature
   release); player-facing entry: headline "Generators" ("You can place real
   power generators: gas & steam turbines, the fluid generators, fission,
   fusion, solar and RTG.") plus at most three one-line notes (power is now
   a real resource you can wire; the shopping list shows supply vs demand
   per grid; the old fuel estimate is replaced by real generator fuel).

## 9. Testing

- **Pipeline**: synthetic generator-domain fixtures → normalizer tests
  (1-second shaping, clamp to `V[tier]`, warnings for cap violation /
  unknown machine id / empty fuel list / malformed boiler entry, fission
  fallback flagged, boiler entry normalizes to an ordinary recipe with a
  water input and no `generator` metadata); published-dataset inspection
  after publish.
- **Model**: energy key parse; strict kind matching in both directions;
  rate formatting.
- **Solver**: generator covers a consumer (no deficit); tier mismatch →
  deficit; surplus reported; output capped at `V[tier]`; `fuelEstimate`
  gone with no call sites left.
- **Optimizer**: a power deficit yields a proposed generator and its fuel in
  the required inputs, with recursion into the fuel's production chain.
- **UI (Playwright)**: generator card, energy port rows, power balance
  block, "what makes energy:lv", compact drawer.
- **Perf**: Playwright + CDP stress workflow before/after — no new node
  type, but extra port rows change card geometry, so the board invariants
  (viewport-independent routing, published geometry, no O(nodes×edges) per
  frame) get the usual check.
- `npm run typecheck` and `npm run test` throughout.

## 10. Invariants kept

- Cells are items: energy is a new strict kind; no cross-kind branch
  anywhere.
- No broad fallback logic on dev: warnings, not defaults.
- Board perf invariants and grid rules untouched (no new sizes/offsets;
  port rows are ordinary content rows inside `GridBlock`).
- UI recipes read-only: generator "recipes" are pipeline-derived, not
  editable.
- One version bump + one player-facing changelog entry per release; feature
  work on `develop`; the dataset pipeline verifies the published artifacts.
