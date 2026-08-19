# Generators: Dataset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export every GTNH core power machine (five basic generator families, steam turbine, solar, RTG, Fusion Computers 1-5, Large Fusion Computers 1-5, fission reactor, Large/XL turbines, UCFE, supercritical turbine, boilers) from the LIVE game as a new `generators` oracle domain, and normalize it into recipe-shaped generator entries plus ordinary boiler production recipes.

**Architecture:** The Forge oracle mod (`gtnh-calc-oracle`, runs inside the real GTNH 1.7.10 client in the pipeline's docker image) gains one new live-methods domain. It enumerates `GregTechAPI.METATILEENTITIES` (the same pattern the oracle already uses), matches the in-scope machine classes, and reads each machine's own live numbers — `maxEUOutput()`, `getFuelValue(fuel)`, the fuel books' `mSpecialValue` — so every exported figure is what the game itself computes. The fuel books these machines burn (gasTurbineFuels, dieselFuels, ...) are *value definitions* (mDuration 0) and never pass the gregtech domain's `mDuration <= 0` recipe guard — that is why a new domain is required rather than a guard tweak. `normalize-oracle-export.mjs` then shapes each (machine, tier, fuel) entry into a zero-EU-draw recipe with one `energy` output, and boiler entries become ordinary fuel + water → steam production recipes. The app-side work is a separate plan (`2026-08-18-generators-app.md`).

**Tech Stack:** Java 8 / Forge 1.7.10 (oracle mod; compiled against the GT5 API — direct `GTRecipe`/`RecipeMap` access is already used by the exporter — plus the existing reflection helpers for MTEs), Node `.mjs` (normalizer), Vitest (subprocess fixture tests), GitHub Actions ("GTNH dataset pipeline").

**Spec:** `docs/superpowers/specs/2026-08-18-generators-design.md` — §2 (machine table with the game citations the oracle calls), §3 (oracle pass + export shape), §3.4 (normalizer rules), §3.5 (pipeline verification).

## Global Constraints

- **Provenance doctrine (spec §3.1):** every exported number is a live read from the running game. No transcribed value tables, no hardcoded coefficients. A number that cannot be read is a `skipped` entry or a `warning` — never a silent default.
- **The `mDuration <= 0` guard stays** (normalize-oracle-export.mjs:210). Generator/boiler fuel books are value definitions and must NOT start appearing as gregtech recipes.
- **15-tier table, one source of truth:** ordinal 0 = ULV (8 EU/t) … 13 = OpV (536870912), 14 = MAX. The same table exists in the oracle (`GT_VOLTAGE_NAMES`/`GT_VOLTAGES`, lines 64-70) and the normalizer (`GT_VOLTAGE_NAMES`, line 20; `voltageTierForEu`, line 2028). The energy resource id is the LOWERCASED tier name — `"luv"`, because `GT_VOLTAGE_NAMES` says `"LuV"` and `"LuV".toUpperCase()` is `"LUV"`. Any id→tier mapping in this plan uses table lookup, never `toUpperCase()`.
- **The energy output's id comes from `maxEuT`**, the machine's live `maxEUOutput()`, via `voltageTierForEu` — NOT from the machine's own tier. The in-game LV solar's `maxEUOutput()` is overridden to 1 by the game code, so it feeds `energy:ulv`. The amount is `min(euPerOperation, maxEuT × periodTicks)`; the fuel input is `consumedPerOperation × min(1, (maxEuT × periodTicks) / euPerOperation)`.
- **Fission fallback is flagged, not mixed:** an entry whose EU value came from the fuel book's `mSpecialValue` instead of the live reactor methods carries `source: "fission-fallback"`; the report surfaces it (spec §3.4).
- **Generator recipes are `eut: 0`** — a generator draws nothing, and `eut: 0` keeps the solver's `hasPowerReport` off it (it is a producer, not a consumer). Boilers are also `eut: 0` production recipes with no energy and no `metadata.generator`.
- **One commit per task; `npm run test` green before each commit.** Normalizer changes are verified as a subprocess over fixtures (the existing `normalize()` harness) — the normalizer is never imported. Oracle tasks end with a gradle compile check (`tools/dataset-pipeline/gtnh-calc-oracle/gradlew compileJava`; on this Windows box `gradlew.bat`). If the GTNH convention plugin cannot resolve offline here, record that and let the pipeline docker build (Task 8) act as the compile gate.
- **Live accessor names:** the method/field names in the Java below are the spec §2 citations (`maxEUOutput`, `getFuelValue`, `getEfficiency`, `processFuel`, `getProductionPerSecond`, `FUSION_THRESHOLD`, `mEUt`, `mSpecialValue`, `mSteam`, `mProcessingEnergy`, `updateFuel`, `maxEUStore`, `getEmptyContainer`, `mTier`). The oracle is reflection-based by design: a name that does not resolve returns null → per-machine/per-fuel `skipped` entry + named warning. If a first pipeline run shows a family-wide miss, the warning names the exact machine and accessor; verify it against the 1.7.10 GT5 source in the oracle's gradle dependencies and rename the single call. Do not add speculative multi-name fallbacks (AGENTS.md: no broad fallback logic).
- **This plan touches `tools/dataset-pipeline/` only.** No `src/` changes, no version bump, no changelog (the app plan and the deploy own those). Never commit the unrelated untracked files (`.waylog/`, `platline-v4-1.*`, `tools/import-export-public.mjs`).

## File Structure

- `tools/dataset-pipeline/scripts/normalize-oracle-export.test.mjs` — gains a `GENERATORS_EXPORT` fixture + describe block. This fixture is the CONTRACT for the oracle's JSON shape (Task 1 writes it first; Tasks 2-6 emit exactly this).
- `tools/dataset-pipeline/scripts/normalize-oracle-export.mjs` — gains: dispatch line (after line 89), module state `generatorNotes`/`generatorMachines` (after line 63), `dataset.generators` (after line 112), `generatorRecipeCount`/`generatorWarnings` in `writeOracleReport` (line 1843), and the new functions `normalizeGenerators`/`energyAmount`/`shapeGeneratorEntry`/`shapeBoilerEntry` (inserted after `normalizeMining`).
- `tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java` — gains: `exportGenerators` + the `GeneratorFamily` base class + one inner class per family, registered in `export()` after `domains.add(exportMining(adapters));` (line 103).
- `tools/dataset-pipeline/scripts/machine-configs.mjs` — UNCHANGED. Its `instantiateRecipeMachineHandlers` and `registerMachineHandlerIcons` are reused as-is; the normalizer hand-builds the tier variant templates (the parenthesized-suffix `TIER_SUFFIX_PATTERN` at machine-configs.mjs:245 does not parse prefix-tiered names like "LV Gas Turbine", so `buildMachineHandlerTemplates` is deliberately bypassed).

---

### Task 1: Normalizer — the `generators` domain becomes recipes (TDD)

**Files:**
- Modify: `tools/dataset-pipeline/scripts/normalize-oracle-export.test.mjs` (append fixture + describe block)
- Modify: `tools/dataset-pipeline/scripts/normalize-oracle-export.mjs` (dispatch, state, dataset field, report fields, four new functions)

**Interfaces:**
- Consumes: `resourceAmount(raw, options)` (line 1494 — kind-gated to item/fluid/aspect, so energy uses its own helper), `addRecipe` (1452), `addResource` (1641, kind-agnostic), `recipeId(...parts)` (1927), `voltageTierForEu(eut)` (2028), `positiveInt`/`positiveNumber` (2065/2070), `text` (2090), `slug` (2083), `GT_VOLTAGE_NAMES` (20), `registerMachineHandlerIcons(templates)` (65), `instantiateRecipeMachineHandlers(templates, recipe)` (machine-configs.mjs:997), `setRecipeMapIcon` (1367), `findDomain` (1923).
- Produces: normalized generator recipes (`id` suffix `generators:<machineId>:<tier>:<fuelKey>`, `eut: 0`, one `energy` output, `metadata.generator {machine, tier, maxEuT, periodTicks, euPerOperation, source}`); boiler recipes (no energy, no `metadata.generator`); `dataset.generators {machines: [{id, name, entryCount, skipped}], warnings: [string]}`; report fields `generatorRecipeCount`, `generatorWarnings`.

- [ ] **Step 1: Write the failing test (fixture + assertions)**

Append to `tools/dataset-pipeline/scripts/normalize-oracle-export.test.mjs` (after the mining describe block):

```js
/**
 * A slice of the generators domain the oracle exports from the live power
 * machines. Values are synthetic, chosen so every shaping rule is pinned:
 *
 *   Gas Turbine           per-fuel values on the fuel, an over-cap fuel
 *                         clamped to the LV grid (fuel and energy together),
 *                         a cell fuel with an empty container out
 *   Solar Generator       fuelless, entry-level period/eu; the in-game LV
 *                         unit's maxEUOutput() is overridden to 1, so an
 *                         LV machine feeds energy:ulv
 *   RTG                   one pellet per 24000-tick day, the entry's tier
 *                         follows the fuel's own output voltage
 *   Large Fusion MK-IV    a combined burn: entry-level eu, two fuels, a
 *                         plasma byproduct in extraOutputs
 *   Nuclear Reactor       a fission entry flagged as the mSpecialValue
 *                         fallback
 *   UCFE                  a promoter fluid riding in as an extra input
 *   Boiler                an ordinary fuel + water -> steam production
 *                         recipe, no energy, no generator metadata
 *   Broken Generator      no usable catalysts: dropped with a warning
 */
const GENERATORS_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-08-18T05:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 0,
  domains: [
    {
      id: "generators",
      machines: [
        {
          id: "gas_turbine",
          name: "Gas Turbine",
          sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2301", 1, "LV Gas Turbine"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
              tier: 1,
            },
            {
              resource: item("gregtech:gt.blockmachines@2302", 1, "MV Gas Turbine"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEGasTurbine",
              tier: 2,
            },
          ],
          entries: [
            {
              tier: 1,
              fuels: [
                {
                  kind: "fluid",
                  id: "benzene",
                  amount: 1,
                  displayName: "Benzene",
                  periodTicks: 10,
                  consumedPerOperation: 4,
                  euPerOperation: 512,
                  maxEuT: 32,
                  containerOut: item("gregtech:gt.metaitem.unified@7000", 1, "Empty Cell"),
                },
              ],
            },
          ],
        },
        {
          id: "solar_generator",
          name: "Solar Generator",
          sourceClass: "gregtech.api.metatileentity.basic.MTESolarGenerator",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2030", 1, "LV Solar Generator"),
              sourceClass: "gregtech.api.metatileentity.basic.MTESolarGenerator",
              tier: 1,
            },
          ],
          entries: [
            { tier: 1, periodTicks: 20, maxEuT: 1, euPerOperation: 20, fuelless: true, fuels: [] },
          ],
        },
        {
          id: "rtg",
          name: "RTG",
          sourceClass: "gtplusplus.api.metatileentity.MTERTGenerator",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2900", 1, "RTG"),
              sourceClass: "gtplusplus.api.metatileentity.MTERTGenerator",
              tier: 1,
            },
          ],
          entries: [
            {
              tier: 1,
              fuels: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32766",
                  amount: 1,
                  displayName: "Uranium-235 Pellet",
                  periodTicks: 24000,
                  consumedPerOperation: 1,
                  euPerOperation: 288000,
                  maxEuT: 32,
                },
              ],
            },
          ],
        },
        {
          id: "large_fusion_computer",
          name: "Large Fusion Computer",
          sourceClass: "goodgenerator.power.machine.MTELargeFusionComputer",
          catalysts: [
            {
              resource: item("goodgenerator:goodgenerator@104", 1, "Large Fusion Computer MK-IV"),
              sourceClass: "goodgenerator.power.machine.MTELargeFusionComputer",
              tier: 12,
            },
          ],
          entries: [
            {
              tier: 12,
              periodTicks: 100,
              maxEuT: 134217728,
              euPerOperation: 2500000,
              fuels: [
                fluid("deuterium", 4, "Deuterium"),
                fluid("tritium", 4, "Tritium"),
              ],
              extraOutputs: [item("gregtech:gt.metaitem.02@32400", 1, "Plasma Cell")],
            },
          ],
        },
        {
          id: "nuclear_reactor",
          name: "Nuclear Reactor",
          sourceClass: "gtplusplus.api.metatileentity.MTENuclearReactor",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2901", 1, "Nuclear Reactor"),
              sourceClass: "gtplusplus.api.metatileentity.MTENuclearReactor",
              tier: 8,
            },
          ],
          entries: [
            {
              tier: 8,
              source: "fission-fallback",
              fuels: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32768",
                  amount: 1,
                  displayName: "Uranium-235 Fuel Rod",
                  periodTicks: 10,
                  consumedPerOperation: 1,
                  euPerOperation: 102400,
                  maxEuT: 524288,
                },
              ],
            },
          ],
        },
        {
          id: "universal_chemical_fuel_engine",
          name: "Universal Chemical Fuel Engine",
          sourceClass: "goodgenerator.power.machine.MTEUniversalChemicalFuelEngineLegacy",
          catalysts: [
            {
              resource: item("goodgenerator:goodgenerator@64", 1, "Universal Chemical Fuel Engine"),
              sourceClass: "goodgenerator.power.machine.MTEUniversalChemicalFuelEngineLegacy",
              tier: 5,
            },
          ],
          entries: [
            {
              tier: 5,
              promoter: {
                kind: "fluid",
                id: "combustion_promoter",
                amount: 1,
                displayName: "Combustion Promoter",
                litersPerLiterFuel: 1,
              },
              fuels: [
                {
                  kind: "fluid",
                  id: "rocket_fuel",
                  amount: 1,
                  displayName: "Rocket Fuel",
                  periodTicks: 20,
                  consumedPerOperation: 2,
                  euPerOperation: 5120,
                  maxEuT: 2048,
                },
              ],
            },
          ],
        },
        {
          id: "boiler",
          name: "Boiler",
          sourceClass: "gregtech.api.metatileentity.basic.MTEBoiler",
          catalysts: [
            {
              resource: item("gregtech:gt.blockmachines@2010", 1, "Bronze Boiler"),
              sourceClass: "gregtech.api.metatileentity.basic.MTEBoiler",
              tier: 0,
            },
          ],
          entries: [
            {
              kind: "boiler",
              tier: 0,
              periodTicks: 10,
              steamPerOperation: 10,
              waterPerOperation: 10,
              measurementTicks: 2000,
              steam: fluid("steam", 1, "Steam"),
              water: fluid("water", 1, "Water"),
              fuels: [{ kind: "fluid", id: "crude_oil", amount: 1, displayName: "Crude Oil", consumedPerOperation: 0.5 }],
            },
          ],
        },
        {
          id: "broken_generator",
          name: "Broken Generator",
          sourceClass: "nowhere.MTEBrokenGenerator",
          catalysts: [],
          entries: [{ tier: 1, fuels: [] }],
        },
      ],
    },
  ],
};

describe("generators domain becomes recipes", () => {
  let dataset;

  beforeAll(() => {
    dataset = normalize(GENERATORS_EXPORT);
  });

  afterAll(() => {
    dataset = undefined;
  });

  it("turns a (machine, tier, fuel) entry into a zero-draw generator recipe", () => {
    const recipe = dataset.recipes.find((entry) => entry.id.endsWith("gas-turbine:lv-benzene"));

    expect(recipe).toBeDefined();
    expect(recipe.eut).toBe(0);
    expect(recipe.durationTicks).toBe(10);
    expect(recipe.minimumTier).toBe("LV");
    expect(recipe.machineType).toBe("Gas Turbine");
    expect(recipe.name).toBe("Gas Turbine: Benzene");
    // 512 EU per 10 ticks of benzene, but the LV grid takes 32 EU/t x 10 =
    // 320: the burn is clamped to what the grid accepts, fuel and energy
    // together (4 L x 320/512 = 2.5 L).
    expect(recipe.inputs).toEqual([
      { kind: "fluid", id: "benzene", amount: 2.5, displayName: "Benzene" },
    ]);
    expect(recipe.outputs.map((output) => [output.kind, output.id, output.amount])).toEqual([
      ["energy", "lv", 320],
      ["item", "gregtech:gt.metaitem.unified@7000", 1],
    ]);
    expect(recipe.metadata.generator).toEqual({
      machine: "Gas Turbine",
      tier: "LV",
      maxEuT: 32,
      periodTicks: 10,
      euPerOperation: 512,
      source: "oracle",
    });
  });

  it("lists the tiered variants as machine handler options", () => {
    const recipe = dataset.recipes.find((entry) => entry.id.endsWith("gas-turbine:lv-benzene"));

    expect(
      recipe.machineHandlers.map((handler) => [handler.label, handler.minimumTier, handler.id]),
    ).toEqual([
      ["LV Gas Turbine", "LV", "gas-turbine-lv"],
      ["MV Gas Turbine", "MV", "gas-turbine-mv"],
    ]);
  });

  it("derives the energy id from the live maxEUOutput, not the machine tier", () => {
    // The LV solar's maxEUOutput() is 1 (the game's own override), so an LV
    // machine feeds the ULV grid.
    const solar = dataset.recipes.find((entry) => entry.id.endsWith("solar-generator:lv-none"));

    expect(solar).toBeDefined();
    expect(solar.name).toBe("Solar Generator");
    expect(solar.minimumTier).toBe("LV");
    expect(solar.inputs).toEqual([]);
    expect(solar.durationTicks).toBe(20);
    expect(solar.outputs).toEqual([{ kind: "energy", id: "ulv", amount: 20, displayName: "Energy (ULV)" }]);
    expect(solar.machineHandlers).toBeUndefined();
  });

  it("burns one RTG pellet per 24000-tick day", () => {
    const rtg = dataset.recipes.find((entry) => entry.id.endsWith("rtg:lv-gregtech-gt-metaitem-01-32766"));

    expect(rtg).toBeDefined();
    expect(rtg.durationTicks).toBe(24000);
    expect(rtg.inputs).toEqual([
      { kind: "item", id: "gregtech:gt.metaitem.01@32766", amount: 1, displayName: "Uranium-235 Pellet" },
    ]);
    expect(rtg.outputs).toEqual([{ kind: "energy", id: "lv", amount: 288000, displayName: "Energy (LV)" }]);
  });

  it("keeps a combined fusion burn as one recipe with both fuels and the plasma byproduct", () => {
    const fusion = dataset.recipes.find((entry) => entry.id.endsWith("large-fusion-computer:uxv-deuterium-tritium"));

    expect(fusion).toBeDefined();
    expect(fusion.durationTicks).toBe(100);
    expect(fusion.minimumTier).toBe("UXV");
    expect(fusion.name).toBe("Large Fusion Computer: Deuterium + Tritium");
    expect(fusion.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["deuterium", 4],
      ["tritium", 4],
    ]);
    expect(fusion.outputs.map((output) => [output.kind, output.id, output.amount])).toEqual([
      ["energy", "uxv", 2500000],
      ["item", "gregtech:gt.metaitem.02@32400", 1],
    ]);
  });

  it("flags the fission fallback in the entry's metadata", () => {
    const fission = dataset.recipes.find((entry) => entry.id.endsWith("nuclear-reactor:uv-gregtech-gt-metaitem-01-32768"));

    expect(fission).toBeDefined();
    expect(fission.durationTicks).toBe(10);
    expect(fission.outputs).toEqual([{ kind: "energy", id: "uv", amount: 102400, displayName: "Energy (UV)" }]);
    expect(fission.metadata.generator.source).toBe("fission-fallback");
  });

  it("scales the UCFE promoter to the (clamped) fuel input", () => {
    const ucfe = dataset.recipes.find((entry) => entry.id.endsWith("universal-chemical-fuel-engine:ev-rocket-fuel"));

    expect(ucfe).toBeDefined();
    expect(ucfe.durationTicks).toBe(20);
    expect(ucfe.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["rocket_fuel", 2],
      ["combustion_promoter", 2],
    ]);
    expect(ucfe.outputs).toEqual([{ kind: "energy", id: "ev", amount: 5120, displayName: "Energy (EV)" }]);
  });

  it("shapes boiler entries as ordinary production recipes", () => {
    const boiler = dataset.recipes.find((entry) => entry.id.endsWith("boiler:boiler-crude-oil"));

    expect(boiler).toBeDefined();
    expect(boiler.name).toBe("Boiler: Crude Oil");
    expect(boiler.eut).toBe(0);
    expect(boiler.durationTicks).toBe(10);
    expect(boiler.minimumTier).toBe("ULV");
    expect(boiler.inputs.map((input) => [input.id, input.amount])).toEqual([
      ["water", 10],
      ["crude_oil", 0.5],
    ]);
    expect(boiler.outputs).toEqual([{ kind: "fluid", id: "steam", amount: 10, displayName: "Steam" }]);
    expect(boiler.metadata?.generator).toBeUndefined();
  });

  it("drops a machine without usable catalysts and says so in the report", () => {
    expect(dataset.recipes.filter((entry) => entry.machineType === "Broken Generator")).toEqual([]);
    expect(dataset.generators.warnings).toEqual([
      "generators: Broken Generator exported no usable catalysts; machine dropped",
    ]);
    expect(dataset.generators.machines.map((machine) => machine.id)).not.toContain("broken_generator");
    expect(dataset.generators.machines.map((machine) => [machine.id, machine.entryCount])).toEqual([
      ["gas_turbine", 1],
      ["solar_generator", 1],
      ["rtg", 1],
      ["large_fusion_computer", 1],
      ["nuclear_reactor", 1],
      ["universal_chemical_fuel_engine", 1],
      ["boiler", 1],
    ]);
  });

  it("adds the energy resources to the catalog without icons", () => {
    const energy = dataset.resources
      .filter((entry) => entry.kind === "energy")
      .map((entry) => [entry.id, entry.displayName, entry.iconPath])
      .sort();

    expect(energy).toEqual([
      ["ev", "Energy (EV)", undefined],
      ["lv", "Energy (LV)", undefined],
      ["ulv", "Energy (ULV)", undefined],
      ["uv", "Energy (UV)", undefined],
      ["uxv", "Energy (UXV)", undefined],
    ]);
  });

  it("registers every generator machine as a recipe map", () => {
    expect(dataset.recipeMaps).toEqual(
      expect.arrayContaining([
        "Gas Turbine",
        "Solar Generator",
        "RTG",
        "Large Fusion Computer",
        "Nuclear Reactor",
        "Universal Chemical Fuel Engine",
        "Boiler",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- normalize-oracle-export
```

Expected: FAIL — the new describe's first test fails (`recipe` is undefined; the export has no `generators` domain so no such recipe exists). The existing two describe blocks still pass.

- [ ] **Step 3: Implement the normalizer**

In `tools/dataset-pipeline/scripts/normalize-oracle-export.mjs`:

3a. Module state — after the `machineHandlerIcons` declaration (line 63):

```js
// The generators domain's own bookkeeping: one row per machine for
// dataset.generators, and every validation note for the oracle report.
const generatorNotes = [];
const generatorMachines = [];
```

3b. Dispatch — after `normalizeMining(findDomain("mining"));` (line 89):

```js
normalizeGenerators(findDomain("generators"));
```

3c. Dataset object — after the `machineHandlerIcons` entry (line 112), before `generatedAt`:

```js
  generators:
    findDomain("generators") !== undefined
      ? {
          machines: generatorMachines,
          warnings: [...generatorNotes],
        }
      : undefined,
```

3d. Report — in `writeOracleReport` (line 1818), before `const report = {`:

```js
  const generatorRecipes = dataset.recipes.filter((recipe) =>
    String(recipe.source?.rawRecipeId ?? "").startsWith("generators:"),
  );
```

and inside the report object, after `recipeCount` (line 1850):

```js
    generatorRecipeCount: generatorRecipes.length,
    generatorWarnings: [...generatorNotes],
```

3e. The four new functions — insert after the `normalizeMining` function:

```js
// ---------------------------------------------------------------------------
// Generators domain. The fuel books behind the power machines
// (gasTurbineFuels and friends) are value definitions, not timed recipes:
// they never pass the gregtech domain's `mDuration <= 0` guard, so the
// oracle ships the live per-machine burn facts in this domain instead. Each
// (machine, tier, fuel) entry becomes a recipe here: `eut: 0` (a generator
// draws nothing, which also keeps `hasPowerReport` off it), the fuel clamped
// to what the grid accepts, one `energy` output, and free-form
// `metadata.generator` for the card. Boilers are production machines, not
// generators: their entries become ordinary fuel + water -> steam recipes
// with no energy and no metadata.
// ---------------------------------------------------------------------------

function normalizeGenerators(domain) {
  for (const rawMachine of domain?.machines ?? []) {
    const machineId = text(rawMachine.id, "");
    const machineName = text(rawMachine.name, machineId);
    if (!machineId || !machineName) {
      generatorNotes.push("generators: machine without an id or name dropped");
      continue;
    }
    const catalysts = (rawMachine.catalysts ?? [])
      .map((catalyst) => ({
        raw: catalyst?.resource,
        normalized: resourceAmount(catalyst?.resource),
        tier: positiveInt(catalyst?.tier, undefined),
      }))
      .filter((catalyst) => catalyst.normalized !== undefined);
    if (catalysts.length === 0) {
      generatorNotes.push(`generators: ${machineName} exported no usable catalysts; machine dropped`);
      continue;
    }

    // The variant list comes from each catalyst's live mTier, not its name:
    // generator machines are prefix-tiered ("LV Gas Turbine"), which the
    // parenthesized-suffix family folding in buildMachineHandlerTemplates
    // does not parse, so the templates are built by hand here. A catalyst
    // without a tier (the single-machine families: UCFE, the turbines)
    // contributes no variant.
    const templates = catalysts
      .filter((catalyst) => catalyst.tier !== undefined && catalyst.tier < GT_VOLTAGE_NAMES.length)
      .map((catalyst) => ({
        id: slug(`${machineName} ${GT_VOLTAGE_NAMES[catalyst.tier]}`),
        label: text(catalyst.raw.displayName, machineName),
        kind: "single",
        machineType: machineName,
        minimumTier: GT_VOLTAGE_NAMES[catalyst.tier],
        catalystResource: catalyst.raw,
        isPrimary: false,
      }));
    if (templates.length > 1) {
      // The family's face is its lowest-tier variant, as in
      // buildMachineHandlerTemplates.
      templates
        .slice()
        .sort(
          (a, b) =>
            GT_VOLTAGE_NAMES.indexOf(a.minimumTier) - GT_VOLTAGE_NAMES.indexOf(b.minimumTier),
        )[0].isPrimary = true;
    }
    registerMachineHandlerIcons(templates);

    let entryCount = 0;
    for (const rawEntry of rawMachine.entries ?? []) {
      const shaped =
        rawEntry?.kind === "boiler"
          ? shapeBoilerEntry(machineId, machineName, rawEntry)
          : shapeGeneratorEntry(machineId, machineName, rawEntry, templates);
      for (const recipe of shaped) {
        addRecipe(recipe);
        entryCount += 1;
      }
    }

    recipeMaps.add(machineName);
    setRecipeMapIcon(machineName, catalysts[0].raw);
    generatorMachines.push({
      id: machineId,
      name: machineName,
      entryCount,
      skipped: (rawMachine.skipped ?? []).map((entry) => text(entry?.reason, "unspecified")),
    });
  }
}

// resourceAmount is kind-gated (item/fluid/aspect), so the energy output gets
// its own builder: id is the lowercased grid tier, no icon (the app draws a
// bolt for kind "energy").
function energyAmount(tierName, amount) {
  const value = positiveNumber(amount, undefined);
  if (value === undefined) {
    return undefined;
  }
  return {
    kind: "energy",
    id: tierName.toLowerCase(),
    amount: value,
    displayName: `Energy (${tierName})`,
  };
}

function shapeGeneratorEntry(machineId, machineName, rawEntry, templates) {
  const tier = positiveInt(rawEntry?.tier, undefined);
  if (tier === undefined || tier >= GT_VOLTAGE_NAMES.length) {
    generatorNotes.push(`generators: ${machineName} entry without a usable tier ordinal dropped`);
    return [];
  }
  const tierName = GT_VOLTAGE_NAMES[tier];
  const isFuelless = rawEntry.fuelless === true;
  const rawFuels = (rawEntry.fuels ?? []).map((fuel) => ({
    raw: fuel,
    normalized: resourceAmount(fuel),
  }));
  if (rawFuels.some((entry) => entry.normalized === undefined)) {
    generatorNotes.push(`generators: ${machineName} ${tierName} entry has an unreadable fuel; entry dropped`);
    return [];
  }
  if (!isFuelless && rawFuels.length === 0) {
    generatorNotes.push(`generators: ${machineName} ${tierName} entry lists no fuels; entry dropped`);
    return [];
  }

  // periodTicks / maxEuT / euPerOperation live on the fuel for the
  // one-fuel-per-burn machines and on the entry for fuelless (solar) and
  // combined-burn (fusion) entries; the export ships either, so the entry
  // level is read first.
  const entryFacts = {
    periodTicks: positiveInt(rawEntry.periodTicks, undefined),
    maxEuT: positiveNumber(rawEntry.maxEuT, undefined),
    euPerOperation: positiveNumber(rawEntry.euPerOperation, undefined),
  };
  const combined = !isFuelless && entryFacts.euPerOperation !== undefined;

  const recipes = [];
  const burns = combined ? [rawFuels] : rawFuels.map((entry) => [entry]);
  for (const entryFuels of burns) {
    const facts = entryFuels.map(({ raw }) => ({
      periodTicks: positiveInt(entryFacts.periodTicks ?? raw.periodTicks, undefined),
      maxEuT: positiveNumber(entryFacts.maxEuT ?? raw.maxEuT, undefined),
      euPerOperation: positiveNumber(entryFacts.euPerOperation ?? raw.euPerOperation, undefined),
      consumed: positiveNumber(raw.consumedPerOperation, undefined),
    }));
    // euPerOperation < 1 is an oracle bug, not a value: no machine produces
    // a fraction of an EU per operation.
    if (
      facts.some(
        (f) =>
          f.periodTicks === undefined ||
          f.maxEuT === undefined ||
          f.euPerOperation === undefined ||
          f.consumed === undefined ||
          f.euPerOperation < 1,
      )
    ) {
      generatorNotes.push(
        `generators: ${machineName} ${tierName} entry carries unusable burn facts; entry dropped`,
      );
      return [];
    }

    // The machine burns only what it can deliver: the burn is gated by its
    // own buffer, so an over-cap fuel burns at the reduced rate that matches
    // the grid, fuel and energy clamped together. A combined burn's buffer
    // is orders of magnitude above its output, so the fraction stays 1 in
    // practice; the uniform rule keeps this one code path.
    const fuelInputs = facts.map((f, index) => ({
      ...entryFuels[index].normalized,
      amount: f.consumed * Math.min(1, (f.maxEuT * f.periodTicks) / f.euPerOperation),
    }));
    const primary = combined || entryFuels.length === 0 ? entryFacts : facts[0];
    const energy = energyAmount(
      voltageTierForEu(primary.maxEuT),
      Math.min(primary.euPerOperation, primary.maxEuT * primary.periodTicks),
    );
    if (!energy) {
      generatorNotes.push(`generators: ${machineName} ${tierName} entry produced no energy output; entry dropped`);
      return [];
    }
    const outputs = [
      energy,
      // containerOut (the empty cell a cell fuel returns) belongs to a
      // single-fuel burn only.
      ...(!combined && entryFuels.length === 1 && entryFuels[0].raw.containerOut
        ? [resourceAmount(entryFuels[0].raw.containerOut)].filter(Boolean)
        : []),
      ...(rawEntry.extraOutputs ?? []).map((extra) => resourceAmount(extra)).filter(Boolean),
    ];

    let inputs = fuelInputs;
    if (rawEntry.promoter) {
      const promoter = resourceAmount(rawEntry.promoter);
      const litersPerLiterFuel = positiveNumber(rawEntry.promoter.litersPerLiterFuel, 0);
      if (promoter && litersPerLiterFuel > 0 && fuelInputs.length > 0) {
        inputs = [...fuelInputs, { ...promoter, amount: litersPerLiterFuel * fuelInputs[0].amount }];
      } else {
        generatorNotes.push(
          `generators: ${machineName} ${tierName} entry names a promoter without a usable fluid or ratio; promoter dropped`,
        );
      }
    }

    const fuelKey = entryFuels.map((entry) => entry.normalized.id).join("+") || "none";
    const name =
      entryFuels.length > 0
        ? `${machineName}: ${entryFuels.map((entry) => entry.normalized.displayName).join(" + ")}`
        : machineName;

    recipes.push({
      id: recipeId("generators", machineId, `${tierName.toLowerCase()}:${slug(fuelKey)}`),
      name,
      kind: "gregtech_machine",
      category: "gregtech",
      machineType: machineName,
      minimumTier: tierName,
      durationTicks: primary.periodTicks,
      eut: 0,
      inputs,
      outputs,
      machineHandlers:
        templates.length >= 2
          ? instantiateRecipeMachineHandlers(templates, {
              minimumTier: tierName,
              durationTicks: primary.periodTicks,
              eut: 0,
              machineConfigControls: [],
            })
          : undefined,
      notes: "Exported by the GTNH calculation oracle from live generator machine methods.",
      source: {
        datasetVersionId,
        recipeMap: machineName,
        exporter: "gtnh-oracle",
        rawRecipeId: `generators:${machineId}:${tierName.toLowerCase()}:${slug(fuelKey)}`,
      },
      metadata: {
        generator: {
          machine: machineName,
          tier: tierName,
          maxEuT: primary.maxEuT,
          periodTicks: primary.periodTicks,
          euPerOperation: primary.euPerOperation,
          source: text(rawEntry.source, "oracle"),
        },
      },
    });
  }
  return recipes;
}

function shapeBoilerEntry(machineId, machineName, rawEntry) {
  const periodTicks = positiveInt(rawEntry?.periodTicks, undefined);
  const steamPerOperation = positiveNumber(rawEntry?.steamPerOperation, undefined);
  const steam = resourceAmount(rawEntry?.steam);
  const water = resourceAmount(rawEntry?.water);
  if (periodTicks === undefined || steamPerOperation === undefined || !steam || !water) {
    // A boiler entry that cannot be explained (no water, no steam, no
    // period) is a measurement failure, not a real value.
    generatorNotes.push(`generators: ${machineName} boiler entry is malformed; entry dropped`);
    return [];
  }
  const waterPerOperation = positiveNumber(rawEntry.waterPerOperation, steamPerOperation);
  const inputs = [{ ...water, amount: waterPerOperation }];
  const outputs = [{ ...steam, amount: steamPerOperation }];
  const fuelNames = [];
  for (const rawFuel of rawEntry.fuels ?? []) {
    const consumed = positiveNumber(rawFuel.consumedPerOperation, undefined);
    const fuel = resourceAmount(rawFuel);
    if (!fuel || consumed === undefined || consumed <= 0) {
      // A zero-fuel variant (the solar boiler) is legitimate with an empty
      // fuel list; a LISTED fuel that measures zero is a measurement
      // failure.
      generatorNotes.push(
        `generators: ${machineName} boiler fuel ${resourceLabel(rawFuel)} measured no consumption; entry dropped`,
      );
      return [];
    }
    inputs.push({ ...fuel, amount: consumed });
    fuelNames.push(fuel.displayName);
  }
  const fuelKey = fuelNames.length > 0 ? fuelNames[0] : "no-fuel";
  return [
    {
      id: recipeId("generators", machineId, `boiler:${slug(fuelKey)}`),
      name: fuelNames.length > 0 ? `${machineName}: ${fuelNames[0]}` : machineName,
      kind: "gregtech_machine",
      category: "gregtech",
      machineType: machineName,
      minimumTier: "ULV",
      durationTicks: periodTicks,
      eut: 0,
      inputs,
      outputs,
      notes: "Exported by the GTNH calculation oracle from live boiler machine methods.",
      source: {
        datasetVersionId,
        recipeMap: machineName,
        exporter: "gtnh-oracle",
        rawRecipeId: `generators:${machineId}:boiler:${slug(fuelKey)}`,
      },
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- normalize-oracle-export
```

Expected: PASS — all three describe blocks (recipe slots, mining, generators).

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run test
git add tools/dataset-pipeline/scripts/normalize-oracle-export.mjs tools/dataset-pipeline/scripts/normalize-oracle-export.test.mjs
git commit -m "Normalize the generators domain into zero-draw generator recipes and boiler production recipes"
```

---

### Task 2: Oracle — scaffolding plus the five basic fuel-burning families

**Files:**
- Modify: `tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java`

**Interfaces:**
- Consumes (existing, verified in this file): `map()` (LinkedHashMap), `iterable(Object)`, `itemStack(ItemStack)`, `fluidStack(FluidStack)`, `invokeBest(Object, String, Object[])` (name+arity lookup, null on miss), `readField(Object, String)` (walks the superclass chain), `readStaticField(Class, String)`, `readIntField(Object, String)` (−1 when absent), `asNumber(Object)` (Number or null), `domain(String)` (id slugger), `adapter(String id, String status, boolean detected, int subjectCount, int recipeCount, long started, String warning)`, the `GT_VOLTAGE_NAMES`/`GT_VOLTAGES` constants (lines 64-70), and direct GT5 API access (`GTRecipe`, `RecipeMap` — the gregtech domain at lines 167-236 already uses both).
- Produces: `exportGenerators(List<Map> adapters)` (registered in `export()`), `generatorFamilies()`, the `GeneratorFamily` base class, the `BasicGeneratorFamily` inner class, and the static helpers `invokeTyped`/`newInstance`/`writeField`/`fluidField`/`fuelOf`/`displayNameOf`/`voltageOrdinalForEu`. The JSON emitted for a basic family must match the Task 1 `GENERATORS_EXPORT` fixture: machine `{id, name, sourceClass, catalysts [{resource, sourceClass, tier}], entries [{tier, fuels [{kind, id, amount, displayName, periodTicks, consumedPerOperation, euPerOperation, maxEuT, containerOut?}]}], skipped? [{reason}]}`.

- [ ] **Step 1: Register the domain in `export()`**

After `domains.add(exportMining(adapters));` (line 103):

```java
        domains.add(exportGenerators(adapters));
```

- [ ] **Step 2: Add the static helpers**

Insert immediately after the existing `asNumber` helper (in the helper block; keep the raw-`Map` style the file already uses):

```java
    // ---------------------------------------------------------------------
    // Generators domain. The fuel books behind the power machines
    // (gasTurbineFuels and friends) are value definitions — mDuration 0 —
    // so they can never pass the gregtech domain's recipe guard. This
    // domain reads each machine's own live numbers instead: maxEUOutput(),
    // getFuelValue(fuel), the fuel book's mSpecialValue. Every figure in
    // the export is what the running game computes; a figure that cannot
    // be read is a skipped entry or a warning, never a default.
    // ---------------------------------------------------------------------

    private Map exportGenerators(List<Map> adapters) {
        long started = System.currentTimeMillis();
        List<String> notes = new ArrayList<String>();
        List<Object> machines = new ArrayList<Object>();
        for (GeneratorFamily family : generatorFamilies()) {
            machines.addAll(family.export(notes));
        }

        String warning = null;
        if (!notes.isEmpty()) {
            StringBuilder joined = new StringBuilder();
            for (String note : notes) {
                if (joined.length() > 0) {
                    joined.append("; ");
                }
                joined.append(note);
            }
            warning = joined.toString();
        }
        Map generators = map();
        generators.put("machines", machines);
        adapters.add(adapter("generators", machines.isEmpty() ? "empty" : "ok", true,
            machines.size(), 0, started, warning));
        return generators;
    }

    /**
     * One family per in-scope power machine, in spec §2 order. A machine
     * missing from the pack is a warning, not an error.
     */
    private static List<GeneratorFamily> generatorFamilies() {
        List<GeneratorFamily> families = new ArrayList<GeneratorFamily>();
        families.add(new BasicGeneratorFamily("gas_turbine", "Gas Turbine", "MTEGasTurbine", "gasTurbineFuels"));
        families.add(new BasicGeneratorFamily("semi_fluid_generator", "Semi Fluid Generator", "MTESemiFluidGenerator", "semiFluidFuels"));
        families.add(new BasicGeneratorFamily("combustion_generator", "Combustion Generator", "MTEDieselGenerator", "dieselFuels"));
        families.add(new BasicGeneratorFamily("thermal_generator", "Thermal Generator", "MTEGeothermalGenerator", "hotFuels"));
        families.add(new BasicGeneratorFamily("plasma_generator", "Plasma Generator", "MTEPlasmaGenerator", "plasmaFuels"));
        return families;
    }

    /**
     * Same as invokeBest, but the candidate method must also accept the
     * static type of the argument. GT5's fuel machines overload
     * getFuelValue for ItemStack and FluidStack — identical arity, so
     * name+arity alone is ambiguous and invokeBest would pick at random.
     */
    private static Object invokeTyped(Object target, String methodName, Object arg) {
        if (target == null || arg == null) {
            return null;
        }
        try {
            for (java.lang.reflect.Method method : target.getClass().getMethods()) {
                if (method.getName().equals(methodName)
                    && method.getParameterTypes().length == 1
                    && method.getParameterTypes()[0].isAssignableFrom(arg.getClass())) {
                    method.setAccessible(true);
                    return method.invoke(target, arg);
                }
            }
        } catch (Exception e) {
            // The caller treats null as "not readable".
        }
        return null;
    }

    /**
     * A fresh MTE instance. The registry instances in
     * GregTechAPI.METATILEENTITIES are live machine objects, and per-fuel
     * reads can mutate them, so family code works on fresh instances and
     * never on registry objects.
     */
    private static Object newInstance(Class<?> clazz, List<String> notes) {
        try {
            return clazz.getConstructor(int.class, String.class, String.class)
                .newInstance(0, "gtnh-oracle", "gtnh-oracle");
        } catch (Exception e) {
            notes.add(clazz.getSimpleName() + " could not be instantiated for live reads: " + e);
            return null;
        }
    }

    /**
     * The mirror of readField: set a private field somewhere in the
     * superclass chain. The boiler measurement uses it to supply a fresh
     * machine's tanks.
     */
    private static boolean writeField(Object target, String fieldName, Object value) {
        if (target == null) {
            return false;
        }
        for (Class<?> clazz = target.getClass(); clazz != null; clazz = clazz.getSuperclass()) {
            try {
                java.lang.reflect.Field field = clazz.getDeclaredField(fieldName);
                field.setAccessible(true);
                field.set(target, value);
                return true;
            } catch (NoSuchFieldException ignored) {
                // try the next superclass
            } catch (Exception e) {
                return false;
            }
        }
        return false;
    }

    /** A FluidStack somewhere in the superclass chain, or null. */
    private static FluidStack fluidField(Object target, String fieldName) {
        Object value = readField(target, fieldName);
        return value instanceof FluidStack ? (FluidStack) value : null;
    }

    /** The first input of a fuel book recipe: the book's fuel. */
    private static Object fuelOf(GTRecipe recipe) {
        if (recipe.mFluidInputs != null && recipe.mFluidInputs.length > 0 && recipe.mFluidInputs[0] != null) {
            return recipe.mFluidInputs[0];
        }
        if (recipe.mInputs != null && recipe.mInputs.length > 0 && recipe.mInputs[0] != null) {
            return recipe.mInputs[0];
        }
        return null;
    }

    private static String displayNameOf(Object value) {
        if (value instanceof FluidStack) {
            return ((FluidStack) value).getName();
        }
        if (value instanceof ItemStack) {
            return ((ItemStack) value).getDisplayName();
        }
        return String.valueOf(value);
    }

    /**
     * The smallest grid tier that can carry `eu` EU/t. Used for
     * per-fuel entries whose output voltage follows the fuel (RTG,
     * UCFE) rather than the machine.
     */
    private static int voltageOrdinalForEu(double eu) {
        for (int i = 0; i < GT_VOLTAGES.length; i++) {
            if (eu <= GT_VOLTAGES[i]) {
                return i;
            }
        }
        return GT_VOLTAGES.length - 1;
    }
```

- [ ] **Step 3: Add the `GeneratorFamily` base class**

Insert as a new inner class after the existing inner classes (raw `Map` style, as in the rest of the file):

```java
    private abstract static class GeneratorFamily {
        final String id;
        final String name;
        final String sourceClass;

        GeneratorFamily(String id, String name, String sourceClass) {
            this.id = id;
            this.name = name;
            this.sourceClass = sourceClass;
        }

        List<Map> export(List<String> notes) {
            List<Map> machines = new ArrayList<Map>();
            Object registry;
            try {
                registry = readStaticField(Class.forName("gregtech.api.GregTechAPI"), "METATILEENTITIES");
            } catch (Exception e) {
                notes.add(id + ": GregTechAPI.METATILEENTITIES not readable: " + e);
                return machines;
            }
            if (registry == null) {
                notes.add(id + ": GregTechAPI.METATILEENTITIES is null");
                return machines;
            }
            boolean any = false;
            for (Object mte : iterable(registry)) {
                if (mte == null || !matches(mte.getClass().getSimpleName())) {
                    continue;
                }
                any = true;
                Map machine = exportOne(mte, notes);
                if (machine != null) {
                    machines.add(machine);
                }
            }
            if (!any) {
                notes.add(id + ": no " + sourceClass + " machines in GregTechAPI.METATILEENTITIES");
            }
            return machines;
        }

        /** BoilerFamily matches by contains(); every other family by equals. */
        boolean matches(String simpleName) {
            return simpleName.equals(sourceClass);
        }

        String machineId(Object mte) {
            return id;
        }

        String machineName(Object mte) {
            return name;
        }

        Map exportOne(Object mte, List<String> notes) {
            Map catalyst = catalyst(mte, notes);
            if (catalyst == null) {
                return null;
            }
            Map machine = map();
            machine.put("id", machineId(mte));
            machine.put("name", machineName(mte));
            machine.put("sourceClass", mte.getClass().getName());
            List<Object> catalysts = new ArrayList<Object>();
            catalysts.add(catalyst);
            machine.put("catalysts", catalysts);
            List<Object> entries = new ArrayList<Object>();
            machine.put("entries", entries);
            fillEntries(mte, machine, entries, notes);
            return machine;
        }

        /**
         * The machine's item form plus its live mTier. A missing or
         * out-of-range tier is omitted — the normalizer treats a tiered
         * catalyst as a variant-list entry, and a machine with no tiers
         * (UCFE, the turbines) contributes no variants.
         */
        Map catalyst(Object mte, List<String> notes) {
            Object stack = invokeBest(mte, "getStackForm", new Object[]{Long.valueOf(1L)});
            if (!(stack instanceof ItemStack)) {
                notes.add(id + ": " + mte.getClass().getSimpleName() + " has no getStackForm(1L) item form");
                return null;
            }
            Map catalyst = map();
            catalyst.put("resource", itemStack((ItemStack) stack));
            catalyst.put("sourceClass", mte.getClass().getName());
            int tier = readIntField(mte, "mTier");
            if (tier >= 0 && tier < GT_VOLTAGE_NAMES.length) {
                catalyst.put("tier", Integer.valueOf(tier));
            }
            return catalyst;
        }

        /**
         * The machine's fuel book as a live list of GTRecipe, sorted by
         * the fuel's display name so the export is deterministic. The
         * books are value definitions (mDuration 0) — read here precisely
         * because they can never be recipes.
         */
        List<Object> fuelBook(String mapField, List<String> notes) {
            List<Object> recipes = new ArrayList<Object>();
            Object backend;
            try {
                backend = readStaticField(Class.forName("gregtech.api.util.GT_Recipe_Map"), mapField);
            } catch (Exception e) {
                notes.add(id + ": fuel book " + mapField + " not readable: " + e);
                return recipes;
            }
            if (backend == null) {
                notes.add(id + ": fuel book " + mapField + " is null");
                return recipes;
            }
            Object list = invokeBest(backend, "getAllRecipes", new Object[0]);
            if (list == null) {
                notes.add(id + ": fuel book " + mapField + " exposes no getAllRecipes()");
                return recipes;
            }
            for (Object recipe : iterable(list)) {
                recipes.add(recipe);
            }
            java.util.Collections.sort(recipes, new java.util.Comparator<Object>() {
                @Override
                public int compare(Object a, Object b) {
                    Object fuelA = a instanceof GTRecipe ? fuelOf((GTRecipe) a) : null;
                    Object fuelB = b instanceof GTRecipe ? fuelOf((GTRecipe) b) : null;
                    return displayNameOf(fuelA).compareTo(displayNameOf(fuelB));
                }
            });
            return recipes;
        }

        Double maxEuOutput(Object mte, List<String> notes) {
            return asNumber(invokeBest(mte, "maxEUOutput", new Object[0]));
        }

        /**
         * Record a skip on the machine (the normalizer lists it) and in
         * the family notes (the report carries them).
         */
        void skip(Map machine, List<String> notes, String reason) {
            notes.add(reason);
            @SuppressWarnings("unchecked")
            List<Object> skipped = (List<Object>) machine.get("skipped");
            if (skipped == null) {
                skipped = new ArrayList<Object>();
                machine.put("skipped", skipped);
            }
            Map entry = map();
            entry.put("reason", reason);
            skipped.add(entry);
        }

        abstract void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes);
    }
```

- [ ] **Step 4: Add `BasicGeneratorFamily` (the five shared families)**

```java
    /**
     * The five basic fuel-burning machines (gas / semi fluid /
     * combustion / thermal / plasma) share MTEBasicGenerator semantics:
     * every 10 ticks they burn 1 unit of fuel from their book at the
     * value the machine's own getFuelValue computes — the family
     * modifiers (the combustion x3 vanilla-fuel fallback, the thermal
     * 5000-by-tier cap and 100-minus-7-by-tier efficiency) are already
     * in that number — and output up to maxEUOutput(). The export is
     * the machine's uncapped potential, one entry per machine instance
     * carrying every fuel; the normalizer clamps the burn to what the
     * grid carries and splits the entry into one recipe per fuel.
     */
    private static class BasicGeneratorFamily extends GeneratorFamily {
        private final String mapField;

        BasicGeneratorFamily(String id, String name, String sourceClass, String mapField) {
            super(id, name, sourceClass);
            this.mapField = mapField;
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            List<Object> book = fuelBook(mapField, notes);
            if (book.isEmpty()) {
                return;
            }
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            Map entry = map();
            int tier = readIntField(mte, "mTier");
            entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
            List<Object> fuels = new ArrayList<Object>();
            for (Object recipeObj : book) {
                if (!(recipeObj instanceof GTRecipe)) {
                    continue;
                }
                GTRecipe recipe = (GTRecipe) recipeObj;
                Object fuel = fuelOf(recipe);
                if (fuel == null) {
                    skip(machine, notes, id + ": " + mapField + " recipe without a first input");
                    continue;
                }
                Double value = asNumber(invokeTyped(mte, "getFuelValue", fuel));
                if (value == null || value <= 0) {
                    skip(machine, notes,
                        id + ": " + displayNameOf(fuel) + " burns for 0 on " + mte.getClass().getSimpleName());
                    continue;
                }
                Map fuelEntry = map();
                if (fuel instanceof FluidStack) {
                    fuelEntry.putAll(fluidStack((FluidStack) fuel));
                } else {
                    fuelEntry.putAll(itemStack((ItemStack) fuel));
                }
                fuelEntry.put("amount", Double.valueOf(1.0));
                fuelEntry.put("periodTicks", Integer.valueOf(10));
                fuelEntry.put("consumedPerOperation", Double.valueOf(10.0));
                fuelEntry.put("euPerOperation", Double.valueOf(value * 10.0));
                fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
                if (recipe.mOutputs != null && recipe.mOutputs.length > 0 && recipe.mOutputs[0] != null) {
                    fuelEntry.put("containerOut", itemStack(recipe.mOutputs[0]));
                }
                fuels.add(fuelEntry);
            }
            entry.put("fuels", fuels);
            entries.add(entry);
        }
    }
```

- [ ] **Step 5: Compile**

```bash
cd tools/dataset-pipeline/gtnh-calc-oracle && ./gradlew compileJava
```

(Windows box: `gradlew.bat compileJava`.) Expected: BUILD SUCCESSFUL. If the `com.gtnewhorizons.gtnhconvention` plugin cannot resolve offline on this machine, record that once in the task log and proceed — the pipeline docker build (Task 7) is then the compile gate, and any Java error there names the line.

- [ ] **Step 6: Commit**

```bash
git add tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java
git commit -m "Oracle: export the generators domain for the five basic fuel-burning machine families"
```

---

### Task 3: Oracle — steam turbine, solar, RTG

**Files:**
- Modify: `tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java`

**Interfaces:**
- Consumes: everything Task 2 produced (`GeneratorFamily`, `fuelBook`, `invokeTyped`, `maxEuOutput`, `skip`, `fluidField`, the helper block) plus `net.minecraftforge.fluids.FluidRegistry` (already imported, line 32).
- Produces: `SteamTurbineFamily`, `SolarFamily`, `RtgFamily` inner classes, each added to `generatorFamilies()`.

- [ ] **Step 1: Add the three families**

Insert after `BasicGeneratorFamily`:

```java
    /**
     * The steam turbine has no fuel book: it burns the live
     * FluidRegistry's "steam", and the machine's own getFuelValue prices
     * it (spec: 3). The per-tick feed is the machine's own
     * getEfficiency() (spec: 6 + tier), so a 10-tick burn consumes ten
     * feeds and produces value x feed x 10.
     *
     * Unit note: the feed is read per tick. If the first pipeline run's
     * numbers land 10x off the in-game tooltip, the feed is per-operation
     * and the two x 10 factors below are the one place to fix.
     */
    private static class SteamTurbineFamily extends GeneratorFamily {
        SteamTurbineFamily() {
            super("steam_turbine", "Steam Turbine", "MTESteamTurbine");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            net.minecraftforge.fluids.Fluid steam = net.minecraftforge.fluids.FluidRegistry.getFluid("steam");
            if (steam == null) {
                notes.add(id + ": the live FluidRegistry has no fluid named \"steam\"");
                return;
            }
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            Double value = asNumber(invokeTyped(mte, "getFuelValue", new FluidStack(steam, 1)));
            if (value == null || value <= 0) {
                skip(machine, notes, id + ": the live machine burns steam for 0");
                return;
            }
            Double feed = asNumber(invokeBest(mte, "getEfficiency", new Object[0]));
            if (feed == null || feed <= 0) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live getEfficiency()");
                return;
            }
            Map entry = map();
            int tier = readIntField(mte, "mTier");
            entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
            List<Object> fuels = new ArrayList<Object>();
            Map fuelEntry = map();
            fuelEntry.putAll(fluidStack(new FluidStack(steam, 1)));
            fuelEntry.put("amount", Double.valueOf(1.0));
            fuelEntry.put("consumedPerOperation", Double.valueOf(feed * 10.0));
            fuelEntry.put("periodTicks", Integer.valueOf(10));
            fuelEntry.put("euPerOperation", Double.valueOf(value * feed * 10.0));
            fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
            fuels.add(fuelEntry);
            entry.put("fuels", fuels);
            entries.add(entry);
        }
    }

    /**
     * The solar generator burns nothing. The in-game unit outputs
     * maxEUOutput() every 20 ticks and is always on; note the LV solar's
     * maxEUOutput() is overridden to 1 in game code, and the live read
     * carries that into the export — the normalizer's energy id follows
     * maxEuT, not the machine tier, so an LV solar feeds energy:ulv.
     */
    private static class SolarFamily extends GeneratorFamily {
        SolarFamily() {
            super("solar_generator", "Solar Generator", "MTESolarGenerator");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null || maxEuT <= 0) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            Map entry = map();
            int tier = readIntField(mte, "mTier");
            entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
            entry.put("periodTicks", Integer.valueOf(20));
            entry.put("maxEuT", Double.valueOf(maxEuT));
            entry.put("euPerOperation", Double.valueOf(maxEuT * 20.0));
            entry.put("fuelless", Boolean.TRUE);
            entry.put("fuels", new ArrayList<Object>());
            entries.add(entry);
        }
    }

    /**
     * The RTG burns one fuel at a time, one per 24000-tick day. The
     * per-fuel value is the book's total (mSpecialValue); the grid it
     * feeds is the fuel's own output voltage, so the export is one entry
     * per fuel and the entry tier follows the fuel's rate
     * (voltageOrdinalForEu), not the machine's.
     */
    private static class RtgFamily extends GeneratorFamily {
        RtgFamily() {
            super("rtg", "RTG", "MTERTGenerator");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            List<Object> book = fuelBook("rtgFuels", notes);
            if (book.isEmpty()) {
                return;
            }
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            for (Object recipeObj : book) {
                if (!(recipeObj instanceof GTRecipe)) {
                    continue;
                }
                GTRecipe recipe = (GTRecipe) recipeObj;
                Object fuel = fuelOf(recipe);
                Double total = asNumber(recipe.mSpecialValue);
                if (fuel == null || total == null || total <= 0) {
                    skip(machine, notes, id + ": rtgFuels entry without a usable fuel or total value");
                    continue;
                }
                double rate = Math.min(maxEuT, total / 24000.0);
                Map entry = map();
                entry.put("tier", Integer.valueOf(voltageOrdinalForEu(rate)));
                List<Object> fuels = new ArrayList<Object>();
                Map fuelEntry = map();
                if (fuel instanceof FluidStack) {
                    fuelEntry.putAll(fluidStack((FluidStack) fuel));
                } else {
                    fuelEntry.putAll(itemStack((ItemStack) fuel));
                }
                fuelEntry.put("amount", Double.valueOf(1.0));
                fuelEntry.put("periodTicks", Integer.valueOf(24000));
                fuelEntry.put("consumedPerOperation", Double.valueOf(1.0));
                fuelEntry.put("euPerOperation", Double.valueOf(total));
                fuelEntry.put("maxEuT", Double.valueOf(rate));
                fuels.add(fuelEntry);
                entry.put("fuels", fuels);
                entries.add(entry);
            }
        }
    }
```

- [ ] **Step 2: Register the families**

In `generatorFamilies()`, after the plasma generator line:

```java
        families.add(new SteamTurbineFamily());
        families.add(new SolarFamily());
        families.add(new RtgFamily());
```

- [ ] **Step 3: Compile**

```bash
cd tools/dataset-pipeline/gtnh-calc-oracle && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL (or, if the plugin still cannot resolve offline, the recorded fallback: Task 7's docker build is the compile gate).

- [ ] **Step 4: Commit**

```bash
git add tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java
git commit -m "Oracle: export the steam turbine, solar and RTG generators from live machine methods"
```

---

### Task 4: Oracle — fusion computers (both) and the fission reactor

**Files:**
- Modify: `tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java`

**Interfaces:**
- Consumes: Task 2's scaffolding; `readStaticField(Class, String)` for the machines' static `FUSION_THRESHOLD`; `GTRecipe` field access (`mEUt`, `mDuration`, `mInputs`, `mOutputs`, `mSpecialValue`) already proven by the gregtech domain.
- Produces: `FusionFamily` (instantiated twice — one per machine class) and `FissionFamily`, each registered in `generatorFamilies()`.

- [ ] **Step 1: Add `FusionFamily`**

Insert after `RtgFamily`:

```java
    /**
     * The fusion computers (MTEFusionComputer and
     * MTELargeFusionComputer) burn the fusionRecipes book (205 entries:
     * deuterium + tritium cells) and the book's mEUt is negated in the
     * export, so -mEUt x mDuration is the energy one burn produces.
     * Each machine class is one machine map carrying one catalyst per
     * live MK instance — the normalizer turns those catalysts into the
     * MK variant list — and a computer only powers when it can store its
     * own threshold, so the live FUSION_THRESHOLD and maxEUStore() gate
     * each instance. The byproduct (the plasma cell) rides out in
     * extraOutputs.
     */
    private static class FusionFamily extends GeneratorFamily {
        FusionFamily(String id, String name, String sourceClass) {
            super(id, name, sourceClass);
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            Object threshold;
            try {
                threshold = readStaticField(mte.getClass(), "FUSION_THRESHOLD");
            } catch (Exception e) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live FUSION_THRESHOLD: " + e);
                return;
            }
            Double thresholdEu = asNumber(threshold);
            if (thresholdEu == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " FUSION_THRESHOLD is null");
                return;
            }
            Double store = asNumber(invokeBest(mte, "maxEUStore", new Object[0]));
            if (store == null || store < thresholdEu) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName()
                    + " maxEUStore() below FUSION_THRESHOLD; the computer outputs nothing");
                return;
            }
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                return;
            }
            List<Object> book = fuelBook("fusionRecipes", notes);
            if (book.isEmpty()) {
                return;
            }
            int tier = readIntField(mte, "mTier");
            for (Object recipeObj : book) {
                if (!(recipeObj instanceof GTRecipe)) {
                    continue;
                }
                GTRecipe recipe = (GTRecipe) recipeObj;
                if (recipe.mInputs == null) {
                    skip(machine, notes, id + ": fusionRecipes entry without item inputs");
                    continue;
                }
                List<Object> fuels = new ArrayList<Object>();
                for (ItemStack stack : recipe.mInputs) {
                    if (stack == null) {
                        continue;
                    }
                    Map fuelEntry = map();
                    fuelEntry.putAll(itemStack(stack));
                    fuelEntry.put("amount", Double.valueOf(stack.stackSize));
                    fuels.add(fuelEntry);
                }
                if (fuels.isEmpty()) {
                    skip(machine, notes, id + ": fusionRecipes entry whose inputs are all null");
                    continue;
                }
                double energy = -recipe.mEUt * (double) recipe.mDuration;
                if (energy <= 0) {
                    skip(machine, notes, id + ": fusionRecipes entry with a non-negative mEUt; no energy to export");
                    continue;
                }
                Map entry = map();
                entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
                entry.put("periodTicks", Integer.valueOf(recipe.mDuration));
                entry.put("maxEuT", Double.valueOf(maxEuT));
                entry.put("euPerOperation", Double.valueOf(energy));
                entry.put("fuels", fuels);
                if (recipe.mOutputs != null) {
                    List<Object> extras = new ArrayList<Object>();
                    for (ItemStack stack : recipe.mOutputs) {
                        if (stack != null) {
                            extras.add(itemStack(stack));
                        }
                    }
                    if (!extras.isEmpty()) {
                        entry.put("extraOutputs", extras);
                    }
                }
                entries.add(entry);
            }
        }
    }
```

- [ ] **Step 2: Add `FissionFamily`**

```java
    /**
     * The fission reactor (a gtplusplus multiblock). The per-fuel burn
     * duration is the live getFuelDuration(fuel) — a fuel whose duration
     * cannot be read is skipped, never given an invented duration. The
     * per-fuel value is the live getFuelValue(fuel) where it resolves,
     * otherwise the book's mSpecialValue — the one flagged fallback the
     * spec allows, stamped source "fission-fallback" so the report can
     * surface it.
     */
    private static class FissionFamily extends GeneratorFamily {
        FissionFamily() {
            super("nuclear_reactor", "Nuclear Reactor", "MTENuclearReactor");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            List<Object> book = fuelBook("fissionFuelProcessingRecipes", notes);
            if (book.isEmpty()) {
                return;
            }
            int tier = readIntField(mte, "mTier");
            for (Object recipeObj : book) {
                if (!(recipeObj instanceof GTRecipe)) {
                    continue;
                }
                GTRecipe recipe = (GTRecipe) recipeObj;
                Object fuel = fuelOf(recipe);
                if (fuel == null) {
                    skip(machine, notes, id + ": fission fuel book entry without a first input");
                    continue;
                }
                Double burnTicks = asNumber(invokeTyped(mte, "getFuelDuration", fuel));
                if (burnTicks == null || burnTicks <= 0) {
                    skip(machine, notes, id + ": no live getFuelDuration(" + displayNameOf(fuel)
                        + "); the duration is not exported and the fuel is skipped");
                    continue;
                }
                Double liveValue = asNumber(invokeTyped(mte, "getFuelValue", fuel));
                double energy;
                String source;
                if (liveValue != null && liveValue > 0) {
                    energy = liveValue * burnTicks;
                    source = "oracle";
                } else {
                    Double special = asNumber(recipe.mSpecialValue);
                    if (special == null || special <= 0) {
                        skip(machine, notes, id + ": " + displayNameOf(fuel)
                            + " has no live value and no book special value");
                        continue;
                    }
                    energy = special;
                    source = "fission-fallback";
                }
                Map entry = map();
                entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
                entry.put("source", source);
                List<Object> fuels = new ArrayList<Object>();
                Map fuelEntry = map();
                if (fuel instanceof FluidStack) {
                    fuelEntry.putAll(fluidStack((FluidStack) fuel));
                } else {
                    fuelEntry.putAll(itemStack((ItemStack) fuel));
                }
                fuelEntry.put("amount", Double.valueOf(1.0));
                fuelEntry.put("periodTicks", Double.valueOf(burnTicks));
                fuelEntry.put("consumedPerOperation", Double.valueOf(1.0));
                fuelEntry.put("euPerOperation", Double.valueOf(energy));
                fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
                fuels.add(fuelEntry);
                entry.put("fuels", fuels);
                entries.add(entry);
            }
        }
    }
```

- [ ] **Step 3: Register the families**

In `generatorFamilies()`, after the RTG line:

```java
        families.add(new FusionFamily("fusion_computer", "Fusion Computer", "MTEFusionComputer"));
        families.add(new FusionFamily("large_fusion_computer", "Large Fusion Computer", "MTELargeFusionComputer"));
        families.add(new FissionFamily());
```

- [ ] **Step 4: Compile**

```bash
cd tools/dataset-pipeline/gtnh-calc-oracle && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL (or the recorded docker-gate fallback).

- [ ] **Step 5: Commit**

```bash
git add tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java
git commit -m "Oracle: export the fusion computers and the fission reactor"
```

---

### Task 5: Oracle — large/XL turbines, UCFE, supercritical, boilers

**Files:**
- Modify: `tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java`

**Interfaces:**
- Consumes: Task 2's scaffolding (`newInstance`, `writeField`, `fluidField`, `voltageOrdinalForEu`, `fuelBook`, `invokeTyped`, `invokeBest`, `domain`).
- Produces: `LargeTurbineFamily` (×2), `UcfeFamily`, `SupercriticalFamily`, `BoilerFamily`, each registered in `generatorFamilies()`. With this task the family list is complete (17 family instances: 5 basic + steam + solar + RTG + 2 fusion + fission + 2 turbine + UCFE + supercritical + boiler).

- [ ] **Step 1: Add `LargeTurbineFamily`**

Insert after `FissionFamily`:

```java
    /**
     * The large and XL turbines burn from the machine's own live fuel
     * table (the static FUELS), five variants per machine (gas, steam,
     * high pressure steam, supercritical steam, plasma). The value is
     * the machine's own getFuelValue, the cap is the machine's own
     * maxEUOutput, and the entry tier is the machine's supported output
     * grid. The table is never guessed: a machine without a readable
     * FUELS table is a skipped machine, not a hardcoded fuel list.
     */
    private static class LargeTurbineFamily extends GeneratorFamily {
        LargeTurbineFamily(String id, String name, String sourceClass) {
            super(id, name, sourceClass);
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            Double maxEuT = maxEuOutput(mte, notes);
            if (maxEuT == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live maxEUOutput()");
                return;
            }
            Object fuelsTable;
            try {
                fuelsTable = readStaticField(mte.getClass(), "FUELS");
            } catch (Exception e) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live FUELS table: " + e);
                return;
            }
            if (fuelsTable == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " FUELS is null");
                return;
            }
            int tier = readIntField(mte, "mTier");
            for (Object fuel : iterable(fuelsTable)) {
                if (fuel == null || !(fuel instanceof FluidStack) && !(fuel instanceof ItemStack)) {
                    skip(machine, notes, id + ": unexpected fuel type "
                        + (fuel == null ? "null" : fuel.getClass().getName()) + " in " + mte.getClass().getSimpleName() + " FUELS");
                    continue;
                }
                Double value = asNumber(invokeTyped(mte, "getFuelValue", fuel));
                if (value == null || value <= 0) {
                    skip(machine, notes, id + ": " + displayNameOf(fuel) + " burns for 0 on " + mte.getClass().getSimpleName());
                    continue;
                }
                Map entry = map();
                entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
                List<Object> fuels = new ArrayList<Object>();
                Map fuelEntry = map();
                if (fuel instanceof FluidStack) {
                    fuelEntry.putAll(fluidStack((FluidStack) fuel));
                } else {
                    fuelEntry.putAll(itemStack((ItemStack) fuel));
                }
                fuelEntry.put("amount", Double.valueOf(1.0));
                fuelEntry.put("periodTicks", Integer.valueOf(10));
                fuelEntry.put("consumedPerOperation", Double.valueOf(10.0));
                fuelEntry.put("euPerOperation", Double.valueOf(value * 10.0));
                fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
                fuels.add(fuelEntry);
                entry.put("fuels", fuels);
                entries.add(entry);
            }
        }
    }
```

- [ ] **Step 2: Add `UcfeFamily`**

```java
    /**
     * The UCFE (GoodGenerator) burns from three books (diesel, gas
     * turbine, rocket) with a per-book bonus, takes a promoter, and the
     * grid it feeds follows the fuel. Everything is read on a fresh
     * machine instance per fuel — the registry instance is never
     * mutated: the fuel is loaded (mFuel), the machine is asked to
     * process (processFuel, the spec-cited machine method), and the
     * instance's own maxEUOutput() with the fuel loaded is the per-fuel
     * grid. The promoter is the promoter-tank delta across the
     * processing call (mPromoter before/after); where the machine
     * exposes no usable promoter state the entry is exported without a
     * promoter — a warning is recorded, the ratio is never defaulted.
     *
     * The accessor names (mFuel, mPromoter, processFuel) are the
     * spec's citations of the machine's methods. The oracle is
     * reflection-based: a name that does not resolve produces a skip
     * naming the machine and the accessor. If the first pipeline run
     * shows a family-wide UCFE miss, the warning says exactly what to
     * rename — check the 1.7.10 GoodGenerator source in the oracle's
     * gradle dependencies. The spec's formula (FuelAmount x
     * mSpecialValue x bonus / 20) describes what the game computes; it
     * is never re-derived here.
     */
    private static class UcfeFamily extends GeneratorFamily {
        UcfeFamily() {
            super("universal_chemical_fuel_engine", "Universal Chemical Fuel Engine",
                "MTEUniversalChemicalFuelEngineLegacy");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            for (String mapField : new String[]{"dieselFuels", "gasTurbineFuels", "rocketFuels"}) {
                for (Object recipeObj : fuelBook(mapField, notes)) {
                    if (!(recipeObj instanceof GTRecipe)) {
                        continue;
                    }
                    GTRecipe recipe = (GTRecipe) recipeObj;
                    Object fuel = fuelOf(recipe);
                    if (fuel == null) {
                        skip(machine, notes, id + ": " + mapField + " entry without a first input");
                        continue;
                    }
                    fillFuel(mte, machine, entries, notes, fuel);
                }
            }
        }

        private void fillFuel(Object mte, Map machine, List<Object> entries, List<String> notes, Object fuel) {
            Object fresh = newInstance(mte.getClass(), notes);
            if (fresh == null) {
                return;
            }
            Object fuelTank = fuel instanceof FluidStack
                ? (Object) new FluidStack((FluidStack) fuel, 1000000)
                : new ItemStack((ItemStack) fuel, 1000000);
            if (!writeField(fresh, "mFuel", fuelTank)) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live mFuel field");
                return;
            }
            FluidStack promoterBefore = fluidField(fresh, "mPromoter");
            double promoterStart = promoterBefore == null ? 0 : promoterBefore.amount;
            Double value = asNumber(invokeBest(fresh, "processFuel", new Object[0]));
            FluidStack promoterAfter = fluidField(fresh, "mPromoter");
            double promoterEnd = promoterAfter == null ? 0 : promoterAfter.amount;
            if (value == null || value <= 0) {
                skip(machine, notes, id + ": no live processFuel() on " + mte.getClass().getSimpleName()
                    + " for " + displayNameOf(fuel));
                return;
            }
            Double maxEuT = asNumber(invokeBest(fresh, "maxEUOutput", new Object[0]));
            if (maxEuT == null || maxEuT <= 0) {
                skip(machine, notes, id + ": no live maxEUOutput() on a fuel-loaded " + mte.getClass().getSimpleName());
                return;
            }
            double consumed = fuel instanceof FluidStack
                ? (double) ((FluidStack) fuel).amount
                : (double) ((ItemStack) fuel).stackSize;

            Map entry = map();
            // The entry's tier is the grid this fuel feeds: the live
            // maxEUOutput() of a fuel-loaded instance (the per-fuel grid),
            // the same rule the RTG applies to its fuel-capped maxEuT.
            entry.put("tier", Integer.valueOf(voltageOrdinalForEu(maxEuT)));
            List<Object> fuels = new ArrayList<Object>();
            Map fuelEntry = map();
            if (fuel instanceof FluidStack) {
                fuelEntry.putAll(fluidStack((FluidStack) fuel));
            } else {
                fuelEntry.putAll(itemStack((ItemStack) fuel));
            }
            fuelEntry.put("amount", Double.valueOf(1.0));
            fuelEntry.put("periodTicks", Integer.valueOf(20));
            fuelEntry.put("consumedPerOperation", Double.valueOf(consumed));
            fuelEntry.put("euPerOperation", Double.valueOf(value));
            fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
            fuels.add(fuelEntry);
            entry.put("fuels", fuels);

            double promoterUsed = promoterStart - promoterEnd;
            if (promoterAfter != null && promoterUsed > 0 && consumed > 0) {
                Map promoter = map();
                promoter.putAll(fluidStack(new FluidStack(promoterAfter.getFluid(), 1)));
                promoter.put("litersPerLiterFuel", Double.valueOf(promoterUsed / consumed));
                entry.put("promoter", promoter);
            } else {
                notes.add(id + ": " + mte.getClass().getSimpleName() + " exposes no usable promoter state for "
                    + displayNameOf(fuel) + "; the entry is exported without a promoter");
            }
            entries.add(entry);
        }
    }
```

- [ ] **Step 3: Add `SupercriticalFamily`**

```java
    /**
     * The supercritical fluid turbine (GoodGenerator). It burns the
     * live FluidRegistry's supercritical steam; the value and the cap
     * are the fresh fuel-loaded instance's own live numbers (the
     * machine method the spec cites, and its maxEUOutput — the
     * maxPower cap), so no formula is re-derived. The byproduct is 1:1
     * superheated steam, a spec-cited machine constant.
     */
    private static class SupercriticalFamily extends GeneratorFamily {
        SupercriticalFamily() {
            super("supercritical_fluid_turbine", "Supercritical Fluid Turbine",
                "MTESupercriticalFluidTurbineLegacy");
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            net.minecraftforge.fluids.Fluid fuel = net.minecraftforge.fluids.FluidRegistry.getFluid("supercritical_steam");
            if (fuel == null) {
                notes.add(id + ": the live FluidRegistry has no fluid named \"supercritical_steam\"");
                return;
            }
            Object fresh = newInstance(mte.getClass(), notes);
            if (fresh == null) {
                return;
            }
            if (!writeField(fresh, "mFuel", new FluidStack(fuel, 1000000))) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live mFuel field");
                return;
            }
            Double value = asNumber(invokeBest(fresh, "processFuel", new Object[0]));
            if (value == null || value <= 0) {
                skip(machine, notes, id + ": no live processFuel() on " + mte.getClass().getSimpleName());
                return;
            }
            Double maxEuT = asNumber(invokeBest(fresh, "maxEUOutput", new Object[0]));
            if (maxEuT == null || maxEuT <= 0) {
                skip(machine, notes, id + ": no live maxEUOutput() on a fuel-loaded " + mte.getClass().getSimpleName());
                return;
            }
            int tier = readIntField(mte, "mTier");
            Map entry = map();
            entry.put("tier", Integer.valueOf(tier < 0 ? 0 : tier));
            List<Object> fuels = new ArrayList<Object>();
            Map fuelEntry = map();
            fuelEntry.putAll(fluidStack(new FluidStack(fuel, 1)));
            fuelEntry.put("amount", Double.valueOf(1.0));
            fuelEntry.put("periodTicks", Integer.valueOf(10));
            fuelEntry.put("consumedPerOperation", Double.valueOf(10.0));
            fuelEntry.put("euPerOperation", Double.valueOf(value));
            fuelEntry.put("maxEuT", Double.valueOf(maxEuT));
            fuels.add(fuelEntry);
            entry.put("fuels", fuels);

            net.minecraftforge.fluids.Fluid superheated = net.minecraftforge.fluids.FluidRegistry.getFluid("superheated_steam");
            if (superheated != null) {
                List<Object> extras = new ArrayList<Object>();
                Map byproduct = map();
                byproduct.putAll(fluidStack(new FluidStack(superheated, 1)));
                byproduct.put("amount", Double.valueOf(10.0));
                extras.add(byproduct);
                entry.put("extraOutputs", extras);
            } else {
                notes.add(id + ": the live FluidRegistry has no fluid named \"superheated_steam\"; the byproduct is omitted");
            }
            entries.add(entry);
        }
    }
```

- [ ] **Step 4: Add `BoilerFamily`**

```java
    /**
     * Boilers (bronze / steel / lava / solar + the large boiler) are
     * production machines: water + fuel -> the live mSteam fluid. One
     * live instance is one machine map — id from the live display name,
     * name the live display name — and the "Boiler" name match catches
     * them all without a guessed list. Fuel consumption is MEASURED: a
     * fresh instance is supplied (fuel full, water full, steam empty),
     * ticked for a 2000-tick steady-state window, and the entry records
     * the window (measurementTicks) and the measured amount per
     * 10-tick operation. A fuel that does not burn on this boiler is
     * not listed (the solar boiler legitimately has none); a machine
     * that cannot be ticked, has no mSteam, or reports no steam is a
     * skipped machine, never a default.
     */
    private static class BoilerFamily extends GeneratorFamily {
        private static final int MEASUREMENT_TICKS = 2000;

        BoilerFamily() {
            super("boiler", "Boiler", "Boiler");
        }

        @Override
        boolean matches(String simpleName) {
            return simpleName.contains("Boiler");
        }

        @Override
        String machineId(Object mte) {
            String label = liveDisplayName(mte);
            return domain(label != null ? label : mte.getClass().getSimpleName());
        }

        @Override
        String machineName(Object mte) {
            String label = liveDisplayName(mte);
            return label != null ? label : mte.getClass().getSimpleName();
        }

        private static String liveDisplayName(Object mte) {
            Object stack = invokeBest(mte, "getStackForm", new Object[]{Long.valueOf(1L)});
            return stack instanceof ItemStack ? ((ItemStack) stack).getDisplayName() : null;
        }

        /**
         * The result of a single-fuel boiler measurement. A fuel that
         * does not burn is not a failure (a solar boiler legitimately
         * has none); a machine that cannot be ticked is.
         */
        private static final class Measurement {
            static final Measurement NOT_A_FUEL = new Measurement(0, 0);
            static final Measurement MACHINE_BROKEN = new Measurement(-1, -1);

            final double steamPerSecond;
            final double consumedPerOperation;

            Measurement(double steamPerSecond, double consumedPerOperation) {
                this.steamPerSecond = steamPerSecond;
                this.consumedPerOperation = consumedPerOperation;
            }
        }

        /**
         * Run a fresh boiler on one fuel for the 2000-tick window and
         * report the live steam production (getProductionPerSecond,
         * L/s) and the fuel consumed per 10-tick operation. Named
         * fields mFuel / mWater / mSteam and the onPostTickServer tick
         * method are the 1.7.10 boiler source's; if a miss warning
         * fires on the first pipeline run, rename the single string
         * after checking the source. A world-access NPE during ticking
         * is a machine failure — the documented fallback is to reuse
         * the crop-tile world-nulling Proxy pattern earlier in this
         * file.
         */
        private Measurement measure(Object mte, Map machine, List<String> notes,
                net.minecraftforge.fluids.Fluid water, FluidStack steamType, Object fuel) {
            Object fresh = newInstance(mte.getClass(), notes);
            if (fresh == null) {
                return Measurement.MACHINE_BROKEN;
            }
            Object fuelTank = fuel instanceof FluidStack
                ? (Object) new FluidStack((FluidStack) fuel, 1000000)
                : new ItemStack((ItemStack) fuel, 1000000);
            if (!writeField(fresh, "mFuel", fuelTank)
                || !writeField(fresh, "mWater", new FluidStack(water, 1000000))
                || !writeField(fresh, "mSteam", new FluidStack(steamType.getFluid(), 0))) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName()
                    + " has no usable live mFuel/mWater/mSteam fields");
                return Measurement.MACHINE_BROKEN;
            }
            double fuelStart = amountOf(fuelTank);
            Exception tickError = null;
            for (long tick = 0; tick < MEASUREMENT_TICKS; tick++) {
                try {
                    invokeBest(fresh, "onPostTickServer",
                        new Object[]{Long.valueOf(tick), Long.valueOf(tick)});
                } catch (Exception e) {
                    tickError = e;
                    break;
                }
            }
            if (tickError != null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName()
                    + " could not be ticked for the fuel measurement (" + tickError + "); the boiler is skipped");
                return Measurement.MACHINE_BROKEN;
            }
            Double perSecond = asNumber(invokeBest(fresh, "getProductionPerSecond", new Object[0]));
            if (perSecond == null || perSecond <= 0) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName()
                    + " reports no live getProductionPerSecond()");
                return Measurement.MACHINE_BROKEN;
            }
            double consumedPerTick =
                (fuelStart - amountOf(readField(fresh, "mFuel"))) / (double) MEASUREMENT_TICKS;
            if (consumedPerTick <= 0) {
                return Measurement.NOT_A_FUEL;
            }
            return new Measurement(perSecond, consumedPerTick * 10.0);
        }

        private static double amountOf(Object tank) {
            if (tank instanceof FluidStack) {
                return (double) ((FluidStack) tank).amount;
            }
            if (tank instanceof ItemStack) {
                return (double) ((ItemStack) tank).stackSize;
            }
            return 0;
        }

        @Override
        void fillEntries(Object mte, Map machine, List<Object> entries, List<String> notes) {
            net.minecraftforge.fluids.Fluid water = net.minecraftforge.fluids.FluidRegistry.getFluid("water");
            if (water == null) {
                skip(machine, notes, id + ": the live FluidRegistry has no fluid named \"water\"");
                return;
            }
            FluidStack steamType = fluidField(mte, "mSteam");
            if (steamType == null) {
                skip(machine, notes, id + ": " + mte.getClass().getSimpleName() + " has no live mSteam field");
                return;
            }
            List<Object> books = new ArrayList<Object>();
            books.addAll(fuelBook("denseLiquidFuels", notes));
            books.addAll(fuelBook("thermalBoilerRecipes", notes));

            List<Object> fuels = new ArrayList<Object>();
            Double steamPerSecond = null;
            for (Object recipeObj : books) {
                if (!(recipeObj instanceof GTRecipe)) {
                    continue;
                }
                GTRecipe recipe = (GTRecipe) recipeObj;
                Object fuel = fuelOf(recipe);
                if (fuel == null) {
                    continue;
                }
                Measurement measurement = measure(mte, machine, notes, water, steamType, fuel);
                if (measurement == Measurement.MACHINE_BROKEN) {
                    return;
                }
                if (measurement == Measurement.NOT_A_FUEL) {
                    continue;
                }
                if (steamPerSecond == null) {
                    steamPerSecond = measurement.steamPerSecond;
                }
                Map fuelEntry = map();
                if (fuel instanceof FluidStack) {
                    fuelEntry.putAll(fluidStack((FluidStack) fuel));
                } else {
                    fuelEntry.putAll(itemStack((ItemStack) fuel));
                }
                fuelEntry.put("amount", Double.valueOf(1.0));
                fuelEntry.put("consumedPerOperation", Double.valueOf(measurement.consumedPerOperation));
                fuels.add(fuelEntry);
            }
            if (steamPerSecond == null) {
                // No fuel burned. A fuelless boiler (solar) is
                // legitimate and still reports its steam; a machine
                // that does not report steam cannot be explained and is
                // skipped.
                Object probe = newInstance(mte.getClass(), notes);
                if (probe == null) {
                    return;
                }
                Double probeSteam = asNumber(invokeBest(probe, "getProductionPerSecond", new Object[0]));
                if (probeSteam == null || probeSteam <= 0) {
                    skip(machine, notes, id + ": " + mte.getClass().getSimpleName()
                        + " produced no measurable steam; the boiler is skipped");
                    return;
                }
                steamPerSecond = probeSteam;
            }
            // A 10-tick operation is half a second: L/s / 2. Water is
            // 1:1 with the live steam (spec).
            double steamPerOperation = steamPerSecond / 2.0;
            Map entry = map();
            entry.put("kind", "boiler");
            entry.put("tier", Integer.valueOf(0));
            entry.put("periodTicks", Integer.valueOf(10));
            entry.put("steamPerOperation", Double.valueOf(steamPerOperation));
            entry.put("waterPerOperation", Double.valueOf(steamPerOperation));
            entry.put("measurementTicks", Integer.valueOf(MEASUREMENT_TICKS));
            Map steam = map();
            steam.putAll(fluidStack(new FluidStack(steamType.getFluid(), 1)));
            entry.put("steam", steam);
            Map waterMap = map();
            waterMap.putAll(fluidStack(new FluidStack(water, 1)));
            entry.put("water", waterMap);
            entry.put("fuels", fuels);
            entries.add(entry);
        }
    }
```

- [ ] **Step 5: Register the families (the list is now complete)**

In `generatorFamilies()`, after the fission line:

```java
        families.add(new LargeTurbineFamily("large_turbine", "Large Turbine", "MTELargeTurbine"));
        families.add(new LargeTurbineFamily("xl_turbine", "XL Turbine", "MTEXLTurbine"));
        families.add(new UcfeFamily());
        families.add(new SupercriticalFamily());
        families.add(new BoilerFamily());
```

- [ ] **Step 6: Compile**

```bash
cd tools/dataset-pipeline/gtnh-calc-oracle && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL (or the recorded docker-gate fallback).

- [ ] **Step 7: Re-run the normalizer suite and commit**

The normalizer is untouched by this task, but the gate is green before every commit:

```bash
npm run test
git add tools/dataset-pipeline/gtnh-calc-oracle/src/main/java/dev/gtnhplanner/calcoracle/GtnhCalcOracleExporter.java
git commit -m "Oracle: export the large turbines, UCFE, supercritical turbine and boilers"
```

---

### Task 6: Local verification and commit the plan

- [ ] **Step 1: Full suite green**

```bash
npm run typecheck
npm run test
```

Expected: typecheck clean; `871 passed | 1 expected fail` (the baseline from `44c9f86` plus the new generators describe block — the count moves, the baseline stays green).

- [ ] **Step 2: Commit this plan**

```bash
git add docs/superpowers/plans/2026-08-18-generators-dataset-pipeline.md
git commit -m "Plan: generators dataset pipeline implementation"
```

Never include the unrelated untracked files (`.waylog/`, `platline-v4-1.*`, `tools/import-export-public.mjs`).

---

### Task 7: Run the pipeline and verify the PUBLISHED dataset

This is the long one. The docker build in this run is also the compile gate for the whole Java change if the local gradle could not resolve the GTNH convention plugin.

- [ ] **Step 1: Push develop and trigger the pipeline**

```bash
git push origin develop
gh workflow run "GTNH dataset pipeline" --ref develop -f channel=both -f publish=true -f force_rebuild=true
```

Record the run id. Then watch it — do not assume success:

```bash
gh run watch <run-id> --exit-status
```

- [ ] **Step 2: If the build fails in the oracle step**

Read the Java error (it names the file and line). A missing accessor is not a compile error (reflection); a type error or a bad import is. Fix minimally — one-line renames for accessor names after checking the 1.7.10 source in the oracle's gradle dependencies — recompile locally where possible, push, re-run. A failure in `exportGenerators` at runtime shows up in the run log's oracle output; the adapter status `error` plus its warnings name the family and the exact call.

- [ ] **Step 3: Verify the published dataset, not the CI status**

After publish, for BOTH channels (stable and daily):

1. Verify the published manifest lists the new dataset version.
2. Fetch and inspect the published gzipped dataset (`recipes.json.gz` / the dataset's `recipes` payload) — the normalizer output:
   - `generators` is present with `machines` non-empty for every in-scope family: gas_turbine, semi_fluid_generator, combustion_generator, thermal_generator, plasma_generator, steam_turbine, solar_generator, rtg, fusion_computer, large_fusion_computer, nuclear_reactor, large_turbine, xl_turbine, universal_chemical_fuel_engine, supercritical_fluid_turbine, and the boiler machines.
   - Generator recipes: `eut: 0`, one `energy` output whose `id` is a lowercased tier, `source.rawRecipeId` prefixed `generators:`, `metadata.generator` with `maxEuT`/`periodTicks`/`euPerOperation`/`source`.
   - Boilers: ordinary recipes (water input, non-zero steam output, fuel input with a measured `consumedPerOperation`, NO energy, NO `metadata.generator`).
   - The gregtech domain is UNCHANGED in shape: no new zero-duration "recipe" entries from the fuel books (the `mDuration <= 0` guard held).
   - Fusion recipe count still 205 in the gregtech domain (fusion recipes were never the generators' business).
3. Check `oracle-report.json` in the run artifacts: `generatorRecipeCount` non-zero, `generatorWarnings` — every warning is a named machine + accessor, and there is no family-wide miss (a whole family absent means its accessor name or class name was wrong).

- [ ] **Step 4: Spot-check numbers against the in-game tooltips**

Pick a small set — at least one per family type — and compare the exported entry to the machine's in-game tooltip:

- LV Gas Turbine on a common fuel (e.g. crude oil / seed oil gas): EU/t and L/s against the tooltip.
- LV Solar Generator: it must output 1 EU/t (the game's override) — this pins the maxEuT-based energy id (`energy:ulv` for an LV machine).
- One steam turbine tier (feed = 6 + tier), one RTG pellet (one per day, the fuel's own grid), one fusion computer MK (energy = mEUt × duration, the plasma byproduct present).
- The fission reactor: if any entry carries `source: "fission-fallback"`, say so in the report — that is the flagged fallback, visible by design.
- One boiler: steam L/s and fuel L/s against the tooltip, and the `measurementTicks` provenance present.

**Named accessors to confirm on this first run** (each lives in the warning stream if it missed; the fix is always a one-line rename after checking the 1.7.10 source, never a guessed formula):

| Family | Accessor | If it misses |
|---|---|---|
| basic 5 + turbines | `getFuelValue(ItemStack/FluidStack)` (via `invokeTyped`) | rename to the real per-fuel value method |
| steam turbine | `getEfficiency()` | feed is the `× 10` factor's basis; a 10x tooltip delta means per-operation, fix the two `× 10`s |
| fusion ×2 | `FUSION_THRESHOLD` (static), `maxEUStore()`, `maxEUOutput()` | rename; a family-wide miss = wrong class name |
| fission | `getFuelDuration(fuel)`, `getFuelValue(fuel)`, `maxEUOutput()` | rename; duration miss → fuel skipped (by design) |
| UCFE / supercritical | `mFuel`, `mPromoter`, `processFuel()`, `maxEUOutput()` | rename; promoter miss → promoter dropped with a warning (by design) |
| large/XL turbine | `FUELS` (static), `getFuelValue`, `maxEUOutput` | rename; a multi-grid hatch output would show up as wrong `energy` ids here |
| boilers | `mFuel` / `mWater` / `mSteam`, `onPostTickServer`, `getProductionPerSecond` | rename; a world NPE during ticking → reuse the crop-tile world-nulling Proxy pattern (earlier in the exporter) and re-run |
| boilers | lava boiler exported FUELLESS? | check manually; if the lava book is not among `denseLiquidFuels`/`thermalBoilerRecipes`, add the live lava fuel book to the list |

The final report to the user must list which families' numbers landed as expected and which need an in-game confirmation pass.

- [ ] **Step 5: Fix-forward if a number is wrong**

A wrong number is a one-line change in the family that emitted it (the value line, a `× 10`, an accessor name) — never a new fallback. Re-run the pipeline (`force_rebuild=true`, both channels) and re-verify from step 3.

---

## Self-review notes

- **Spec coverage:** §2 every in-scope machine has a family (basic 5, steam, solar, RTG, fusion 1-5, large fusion 1-5, fission, large + XL turbines, UCFE, supercritical, boilers as production recipes); reactor mods and wind are excluded by not having families. §3 live-methods domain, one entry per (variant, grid, fuel) where the grid follows the fuel (RTG/UCFE per-fuel entries; fusion one entry per MK instance with its own live tier). §3.2 export shape matches the Task 1 fixture field-for-field. §3.3 guard untouched. §3.4 normalizer rules implemented in Task 1 (clamping, maxEuT-based energy id, fission flag, boiler shaping, warnings). §3.5 verification = Task 7.
- **Placeholder scan:** none — every Java body is complete; the only "if it misses" branches are the documented one-line renames, which the provenance doctrine requires rather than forbids.
- **Type consistency:** `GeneratorFamily.export(List<String>)` is used by `exportGenerators`; `fillEntries(Object, Map, List<Object>, List<String>)` is the one abstract and every family implements it with that exact signature; `Measurement`'s three states are the only return convention of `measure`; the normalizer's `rawEntry.source` read matches the fission family's `entry.put("source", ...)`; the fixture's `promoter.litersPerLiterFuel` matches `UcfeFamily`'s `promoter.put("litersPerLiterFuel", ...)`; the boiler's `measurementTicks` matches both sides.
- **Known first-run risk:** accessor names are the spec's citations, verified only by the pipeline's warning stream. That is the design — the oracle is reflection-based, the doctrine forbids guessed values, and every miss is named, not silent.

