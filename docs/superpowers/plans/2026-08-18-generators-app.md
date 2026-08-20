# Generators (App Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make power a first-class, wireable resource on the board: every running
machine draws `energy:<its grid>` as a real input, generators (delivered by the
dataset pipeline's `generators` domain) produce it as ordinary recipe outputs,
the shopping list shows supply vs demand per grid, and one click adds a
generator sized to close a deficit.

**Architecture:** `ResourceKind` gains `"energy"` — 15 resources, one per
voltage grid (`energy:ulv` … `energy:max`). The solver injects each running
machine's power-report draw as a synthetic `energy:<tier>` input inside
`calculateThroughput`; everything downstream (ports, balances, edges, port
gestures, recipe book) is flow-driven and picks the new kind up with no new
subsystem. Generator entries are ordinary recipe-shaped entries from the
normalizer (pipeline plan,
`docs/superpowers/plans/2026-08-18-generators-dataset-pipeline.md`), so cards,
machine picker, pockets, blueprints, import/export all work unchanged. New
surfaces: the energy port row (bolt glyph), the `PowerBalanceBlock` in the
shopping list, the async `addPowerForTier` store action (dataset-API based —
the browser only holds a trimmed catalog), and the complete removal of the
`fuelProfiles`/`fuelEstimate` scaffolding.

**Tech Stack:** Next.js App Router, TypeScript strict, React Flow, Zustand,
Zod, Vitest; the dataset API (`/api/datasets/[versionId]/recipes`) and the
browser dataset client (`src/lib/datasets/browser-loader.ts`).

**Spec:** `docs/superpowers/specs/2026-08-18-generators-design.md`

## Global Constraints

- Energy is a STRICT kind: `resourceMatchesInput` (`src/lib/model/resources.ts:260`)
  compares kinds first and already handles any non-item kind by literal id
  comparison — it does NOT change. No cross-kind branch anywhere; the
  cells-are-items doctrine extends to power with zero new code.
- No guessed values / no broad fallbacks: an older published dataset WITHOUT
  the `generators` domain registers no energy resources, shows no generator
  machines, and nothing crashes or defaults (graceful absence, spec §4).
- `fuelEstimate`, `fuelProfiles`, `selectedFuelProfileId`, `gtnhFuelProfiles`
  and `normalizeProjectFuelProfiles` are REMOVED, not kept as fallbacks. Old
  plans silently drop the setting (Zod's default strip on the removed schema
  fields is the migration).
- Machine BEHAVIOUR stays as it is: the curated table in
  `src/lib/machines/machine-table.ts` has no generator entries (verified — the
  only turbine/reactor hits are "Sum Turbine Tier" and the Chemical Reactors),
  so generator entries keep their real burn periods and `eut: 0`. Do not add
  table entries.
- Board invariants: no new sizes/offsets on the flow board (port rows stay
  40px `h-[40px]` rows inside `GridBlock`); no O(nodes×edges) per frame;
  routing stays viewport-independent; perf-sensitive changes get the Playwright
  + CDP stress check (Task 8).
- UI recipes are read-only; generator "recipes" are pipeline-derived.
- Work lands on `develop`; `main` is production and is pushed ONLY when the
  user asks for a deploy. One version bump + one player-facing changelog entry
  per deploy (check `https://gtnhplanner.com/api/version` first).
- `npm run typecheck` and `npm run test` must be green after every task
  (baseline at 44c9f86: 871 passed | 1 expected fail, 85 files).
- The pipeline plan is a SEPARATE document and may land before or after this
  one: the app must work against the current (generator-free) published
  dataset. Do not assume the `generators` domain exists in the live dataset
  during development; use synthetic fixtures and the plan-JSON import path.

## Verified no-change list (read before starting — do not "improve" these)

- `src/lib/model/resources.ts` — strict matching already covers energy; the
  search-only equivalents (`getFilledCellFluidEquivalent`,
  `isFluidEquivalentToFilledCell`) are item/fluid rules and stay.
- `src/components/flow/node-verdict.ts` — `buildRailPorts` builds ports FROM
  the solver flows (`nodeResult.inputs`/`outputs`, lines 1196, 1402–1408):
  the synthetic energy flow AUTO-CREATES a `RailPort` with `kind: "energy"`,
  `resourceId` the grid id, `resource: undefined` (no recipe slot to look up,
  line 1214), the canonical handle `makeResourceHandleId(side, {kind, id})`
  (line 1386) and the NO-SUPPLY badge on the unconnected input (1290–1296).
  No change needed; Task 5 adds a test pinning this.
- `src/lib/nei/layout.ts` — energy is not a real in-game slot: it is
  deliberately NOT added to the item/fluid/aspect pools (lines 383–388,
  539–546). The card's energy row is the PORT row (Task 5), which the spec's
  "energy output row (bolt glyph, EU/s, grid tier)" refers to.
- `src/components/flow/MachinePicker.tsx` — generator families appear as
  ordinary per-tier machines ("LV Gas Turbine" …, the pipeline plan's
  hand-built handler templates) with their `minimumTier` chip; no new picker
  code. The `isSteamMachineHandler` "Steam" tag on the Steam Turbine rows is
  correct (it burns steam) and stays.
- `src/lib/solver/machine-count-optimizer.ts` — rescales `machineCount` on
  existing nodes; `addPowerForTier` sets `machineCount` at creation and the
  optimizer never touches a node's recipe, so the two do not interact.
- `src/components/BoardActions.tsx`, `src/components/RecipeBrowser.tsx` — the
  query→match→fetch pattern they already use (`resolveImportedRecipe`
  BoardActions.tsx:789–815, `queryRecipeDatasetRecipes` browser-loader.ts:166–191)
  is what `addPowerForTier` reuses; browseResource with `kind: "energy"`
  reaches the API route unchanged once the route accepts the kind (Task 1).
  "What uses energy:lv" honestly returns empty (no dataset recipe CONSUMES
  energy — consumers draw it via their power report) and needs no special code.
- `src/lib/solver/overclock.ts`, `src/lib/solver/power.ts` — the power MATH
  (draw, hatches, amps, pool, stall) is untouched; the energy input is a
  consequence of the same numbers (spec §6).

---

### Task 1: The `energy` resource kind

**Files:**
- Modify: `src/lib/model/types.ts:8` (`ResourceKind`), `:759-764` + `:773`
  (delete `FuelEstimate` / `fuelEstimate` from `ThroughputResult`)
- Modify: `src/lib/model/schemas.ts:4` (`resourceKindSchema`), `:416-429`
  (delete `fuelProfileSchema`), `:479-480` (delete `fuelProfiles` /
  `selectedFuelProfileId` from `factoryProjectSchema`)
- Modify: `src/lib/datasets/schemas.ts:14` (dataset resource kind), `:41`
  (resource index entry kind)
- Modify: `src/lib/datasets/types.ts:19` (`DatasetResource.kind`), `:32`
  (`DatasetResourceIndexEntry.kind`)
- Modify: `src/app/api/datasets/[versionId]/recipes/route.ts:10`
  (`RECIPE_RESOURCE_KINDS`)
- Create: `src/lib/model/energy.ts`
- Test: `src/lib/model/energy.test.ts` (new)

**Interfaces:**
- Consumes: `GT_VOLTAGE_TIERS` from `src/lib/model/tiers.ts` (15 entries,
  `{ tier: MachineTier, maxEuT }`, ULV … MAX).
- Produces (used by Tasks 3–7):
  - `energyResourceForTier(tier: MachineTier): ResourceAmount` —
    `{ kind: "energy", id: tier.toLowerCase(), amount: 1, displayName:
    \`Energy (${tier})\` }`.
  - `energyTierForId(id: string): MachineTier | undefined` — the tier whose
    lowercased name equals `id`; `undefined` for unknown ids. Never
    `toUpperCase()` on the input: `"luv"` must match `"LuV"`, and `"LuV"`
    must not.

- [ ] **Step 1: Write the failing test**

Create `src/lib/model/energy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { energyResourceForTier, energyTierForId } from "./energy";
import type { MachineTier } from "./types";

describe("energy resources", () => {
  it("parses a grid id back to its tier, case-insensitively on the id", () => {
    expect(energyTierForId("lv")).toBe("LV");
    expect(energyTierForId("max")).toBe("MAX");
    // The trap the lowercased lookup is for: "LuV" lowercases to "luv".
    expect(energyTierForId("luv")).toBe("LuV");
    expect(energyTierForId("LuV")).toBeUndefined();
    expect(energyTierForId("zz")).toBeUndefined();
  });

  it("builds the per-grid resource", () => {
    const tier: MachineTier = "HV";
    const resource = energyResourceForTier(tier);
    expect(resource).toEqual({
      kind: "energy",
      id: "hv",
      amount: 1,
      displayName: "Energy (HV)",
    });
  });

  it("round-trips every grid of the voltage table", () => {
    const { GT_VOLTAGE_TIERS } = require("./tiers");
    for (const { tier } of GT_VOLTAGE_TIERS) {
      expect(energyTierForId(energyResourceForTier(tier).id)).toBe(tier);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/model/energy.test.ts`
Expected: FAIL — `Cannot find module './energy'`.

- [ ] **Step 3: Add the kind and the helper module**

`src/lib/model/types.ts:8` — add `"energy"`:

```ts
export type ResourceKind = "item" | "fluid" | "aspect" | "energy";
```

`src/lib/model/schemas.ts:4` — one change covers every `resourceKindSchema`
use site (resource amounts, alternatives, NEI slots, storage, edges):

```ts
export const resourceKindSchema = z.enum(["item", "fluid", "aspect", "energy"]);
```

`src/lib/datasets/schemas.ts:14` and `:41` — the same kind union gains
`"energy"` (energy resources land in the published catalog and resource
index). `src/lib/datasets/types.ts:19` and `:32` — widen both `kind` fields
to the shared `ResourceKind` if they are inline unions, or add `"energy"` to
the inline union as it stands.

`src/app/api/datasets/[versionId]/recipes/route.ts:10`:

```ts
const RECIPE_RESOURCE_KINDS = new Set<ResourceKind>(["item", "fluid", "aspect", "energy"]);
```

Create `src/lib/model/energy.ts`:

```ts
import { GT_VOLTAGE_TIERS } from "./tiers";
import type { MachineTier, ResourceAmount } from "./types";

/**
 * The board's one resource per power grid: `energy:ulv` … `energy:max`, the
 * lowercased names of the 15 tiers of the voltage table. A machine's grid is
 * decided by its power report (the voltage it actually runs at), and a
 * generator's output grid is decided by the normalizer from the machine's own
 * `maxEuT` — an in-game LV solar unit outputs 1 EU/t and feeds `energy:ulv`.
 *
 * Strict kind, like items and fluids: energy never satisfies a fluid or item
 * slot and they never satisfy energy, and `resourceMatchesInput` already says
 * so by comparing kinds first. No alternatives, no oredict, no cell
 * equivalents.
 */
export function energyResourceForTier(tier: MachineTier): ResourceAmount {
  return {
    kind: "energy",
    id: tier.toLowerCase(),
    amount: 1,
    displayName: `Energy (${tier})`,
  };
}

/**
 * The tier a grid id names. The lookup is on the LOWERCASED tier name, never
 * `toUpperCase()` on the input: "LuV" lowercases to "luv", so matching the
 * input against `tier.toLowerCase()` is the only form that keeps every one of
 * the 15 ids distinct.
 */
export function energyTierForId(id: string): MachineTier | undefined {
  return GT_VOLTAGE_TIERS.find((entry) => entry.tier.toLowerCase() === id)?.tier;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/model/energy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite still green (additive change only)**

Run: `npm run typecheck && npm run test`
Expected: the baseline (871 passed | 1 expected fail). If a test constructs a
`ThroughputResult` literal with a `fuelEstimate` field, note it here — it is
fixed in Task 3, and the typecheck will list every remaining one.

- [ ] **Step 6: Commit**

```bash
git add src/lib/model/types.ts src/lib/model/schemas.ts src/lib/datasets/schemas.ts src/lib/datasets/types.ts src/app/api/datasets/[versionId]/recipes/route.ts src/lib/model/energy.ts src/lib/model/energy.test.ts
git commit -m "The board gains an energy resource, one per power grid"
```

---

### Task 2: Remove the fuel-profile scaffolding

**Files:**
- Delete: `src/lib/model/fuels.ts` (whole file — 55 lines)
- Modify: `src/lib/model/types.ts` (delete `FuelProfile` 502–510,
  `fuelProfiles: FuelProfile[]` 580, `selectedFuelProfileId: string` 581 from
  `FactoryProject`)
- Modify: `src/lib/model/schemas.ts` (delete `fuelProfileSchema` 416–429,
  `fuelProfiles` 479, `selectedFuelProfileId` 480 from
  `factoryProjectSchema`)
- Modify: `src/lib/model/project-normalize.ts:2` (import) and `:21` (the
  `normalizeProjectFuelProfiles(...)` wrapper in the `normalizeLoadedProject`
  chain)
- Modify: `src/lib/import-export/factory-json.ts:2` (import) and `:40`
  (`serializeFactoryProject` wraps `normalizeProjectFuelProfiles(project)`)
- Modify: `src/store/factory-store.ts:437` (action declaration) and
  `:2336-2347` (`selectFuelProfile` implementation)
- Modify: `src/examples/empty-project.ts:1` (import) and `:15-16`
  (`fuelProfiles: gtnhFuelProfiles, selectedFuelProfileId: DEFAULT_FUEL_PROFILE_ID`
  in the empty project literal)
- Modify: `src/agent/brain.ts:293` (drop the `fuelProfiles: [],` line from the
  project literal)
- Modify: `tools/perf/build-plan.mjs:191` (drop the `fuelProfiles: [],` line)
- Modify: every test that constructs `FactoryProject` literals with the
  removed fields — `npm run typecheck` lists them all; known from the sweep:
  `src/store/factory-store.test.ts` (~30 `fuelProfiles: []` sites),
  `src/components/InspectorPanel.test.tsx` (line 5 import + 325–326
  `fuelProfiles: gtnhFuelProfiles, selectedFuelProfileId: "biodiesel"`),
  `src/components/flow/board-dump.test.ts` (100–101),
  `src/components/RecipeBrowser.test.tsx` (119),
  `src/lib/model/project-normalize.test.ts` (83, 164),
  `src/lib/solver/throughput.test.ts` (import line 2),
  `src/lib/solver/selection-flow.test.ts` (import line 2),
  `src/lib/solver/balances.test.ts` (import line 2),
  `src/lib/plan-view.test.ts` (import line 2),
  `src/lib/import-export/factory-json.test.ts`, `src/lib/pocket-connections.test.ts`,
  and the rest the typecheck names (flow-explainers, death-spiral,
  node-verdict, pocket-summary, plan-fingerprint, plan-stats, plan-view,
  allocation, balanced-ring, conservation, loop-priority,
  machine-count-optimizer, platline-latch, power-report, selection-flow,
  sketch-mode, storage-links and friends)
- Check: JSON fixtures under `src/**/__fixtures__` / test data that carry
  `fuelProfiles` (e.g. `pa-cell-loop-plan.json` 2681/2704, `-3x.json` 2682,
  `-1x-strict`/`-3x-strict`) — Zod's strip drops the field on parse, so the
  files may stay; if a test asserts the field round-trips, update the
  assertion to expect it dropped (that IS the migration the spec asks for).

**Interfaces:**
- Consumes: Task 1 (the kind is additive; independent).
- Produces: `FactoryProject` without `fuelProfiles`/`selectedFuelProfileId`;
  `ThroughputResult` without `fuelEstimate` (the solver half of this removal
  is Task 3 — until then `npm run typecheck` will still list
  `src/lib/solver/throughput.ts` and any UI that reads `fuelEstimate`;
  complete the full sweep across Tasks 2+3 in one green typecheck, and only
  commit Task 2 once its file set is clean — see Step 5).

- [ ] **Step 1: Find every use, before touching anything**

```bash
grep -rn "fuelProfile\|fuelEstimate\|gtnhFuelProfiles\|normalizeProjectFuelProfiles\|DEFAULT_FUEL_PROFILE_ID" src tools --include='*.ts' --include='*.tsx' --include='*.mjs' | grep -v node_modules
```

Record the hit list; it is the checklist for this task. (Known hits are
listed in the Files section; the grep is the source of truth — trust the
grep, not this list.)

- [ ] **Step 2: Write the failing migration test first**

Append to `src/lib/model/project-normalize.test.ts` (create the describe if
the file already has one — match its existing style):

```ts
it("drops a pre-generator plan's fuel setting on load", () => {
  // The setting no longer exists: an old plan arrives with it and the Zod
  // parse strips it rather than migrating it, so the next autosave writes a
  // plan without the field.
  const raw = {
    ...makeBaseProject(), // the file's existing project factory
    fuelProfiles: [{ id: "biodiesel", name: "Biodiesel", euPerLiter: 9 }],
    selectedFuelProfileId: "biodiesel",
  };
  const loaded = normalizeLoadedProject(raw as never);
  expect("fuelProfiles" in loaded).toBe(false);
  expect("selectedFuelProfileId" in loaded).toBe(false);
});
```

(`makeBaseProject` is the test file's existing project fixture; if it has a
different name, use that one — the point is the two removed keys.)

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/model/project-normalize.test.ts`
Expected: FAIL — the field is still part of the schema, so `in loaded` is
`true` (or the literal does not typecheck yet — either way it fails).

- [ ] **Step 4: Delete the scaffolding**

In the order that keeps the diff reviewable:

1. `src/lib/model/types.ts` — delete the `FuelProfile` interface (502–510),
   the `fuelProfiles` (580) and `selectedFuelProfileId` (581) fields from
   `FactoryProject`, and the `FuelEstimate` interface (759–764) + the
   `fuelEstimate` field (773) from `ThroughputResult`.
2. `src/lib/model/schemas.ts` — delete `fuelProfileSchema` (416–429) and the
   two `factoryProjectSchema` fields (479–480).
3. Delete `src/lib/model/fuels.ts` (`git rm src/lib/model/fuels.ts`).
4. `src/lib/model/project-normalize.ts` — delete the import (line 2) and
   unwrap the chain (line 21):

   ```ts
   return snapProjectToGrid(
     repairPocketReferences(
       unpaintCustomRateCards(
         releaseCustomRates(
           dropDuplicateEdges(dropCrossFormConnections(project)),
         ),
       ),
     ),
   );
   ```

5. `src/lib/import-export/factory-json.ts` — delete the import (line 2);
   line 40 becomes:

   ```ts
   const validatedProject = factoryProjectSchema.parse(project);
   ```

6. `src/examples/empty-project.ts` — delete the import (line 1) and the two
   literal lines (15–16).
7. `src/store/factory-store.ts` — delete the `selectFuelProfile` declaration
   (line 437) and the implementation (2336–2347).
8. `src/agent/brain.ts:293` and `tools/perf/build-plan.mjs:191` — delete the
   `fuelProfiles: [],` line in each project literal.
9. Every test file from the Step 1 grep: delete the now-dead imports
   (`gtnhFuelProfiles` / `normalizeProjectFuelProfiles`) and the
   `fuelProfiles: []` / `fuelProfiles: gtnhFuelProfiles,
   selectedFuelProfileId: …` literal lines. In
   `src/components/InspectorPanel.test.tsx` that is line 5 plus 325–326.

- [ ] **Step 5: Typecheck, then fix the solver + UI leftovers**

Run: `npm run typecheck`

This now lists every remaining reference: `src/lib/solver/throughput.ts`
(import 13, call 263, function 1033–1066 — removed in Task 3, but if you
prefer a single green commit, remove them here too and let Task 3 start from
the injection alone) and any UI that reads `result.fuelEstimate` (the
shopping list / inspector — delete the read and its rendering; the spec
replaces that figure with the power balance block in Task 6). Fix them all
until `npm run typecheck` is clean.

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: green baseline. Any test that asserted the old fuel-estimate
BEHAVIOUR (a `fuelPerSecond` number, the `L/s` figure) is deleted or
rewritten to assert the field's absence — the spec removed the feature, so
its tests go with it.

- [ ] **Step 7: Commit**

```bash
git add -A src tools/perf
git status   # confirm no unrelated untracked files are staged (never .waylog/, the platline-v4-1.* files, tools/import-export-public.mjs)
git commit -m "Drop the fuel profiles: power is a resource on the board, not a per-project guess"
```

---

### Task 3: The solver bills power as a flow

**Files:**
- Modify: `src/lib/solver/throughput.ts` (imports 1–51; per-node loop 128–198, injection after the input loop that ends at line 161; the supply seed loop in `calculateConnectedInputSupply` at 462–466; return block 256–268)
- Modify: `src/lib/solver/equilibrium.ts` (the bare-input classification loop 576–590; the bare-output loop 607–614)
- Modify: `src/lib/solver/close-boundaries.ts` (output loop 103–111)
- Test: `src/lib/solver/throughput.test.ts`

**Interfaces:**
- Consumes: `energyResourceForTier` from `@/lib/model/energy` (Task 1); `NodePowerReport` from `@/lib/solver/power-report` (`powerReport` at throughput.ts:144–147, fields `state`, `tier`, `drawEuT`); `addFlow` at throughput.ts:290–302 — signature `addFlow(record: FlowRecord, resource: ResourceAmount, amountPerSecond: number)`, merges by resource key.
- Produces: `ThroughputResult.resources` gains `"energy:<tier>"` entries (produced = generator output, consumed = machine draws, net = difference). `nodeResult.inputs`/`nodeResult.outputs` stay full-blast NAMEPLATE (equilibrium only reads them — it never rewrites them), so `"energy:lv"` appears in `nodeResult.inputs` at the node's nameplate draw. This is the stable surface Tasks 5/6/8 read.

**Why the code is what it is:** `powerReport.drawEuT = Math.abs(stats.eut) × parallels` (power-report.ts:113) and the `parallels` there is the same expression as `machineParallelMultiplier` at throughput.ts:138, so `drawEuT × node.machineCount × node.parallel` equals the node's `euT` (throughput.ts:174–175) exactly. The `state === "ok"` gate is the whole stall model: an under-powered machine is equilibrium-pinned to zero, and its draw must vanish with it — a short grid throttles the plant through the same equilibrium that throttles a short fuel line. The `drawEuT > 0` guard drops zero-EU recipes (manual/instant crafting) that `hasPowerReport` still reports.

**The one policy this task rests on — energy is a ledger and a wired supply line, never a BARE constraint.** Injecting the draw into `nodeResult.inputs` is not enough: the solver's bare-input/bare-output rules would otherwise break every existing plan. The bare-input rule (equilibrium.ts:576–590 → `capability = info.bareInputKeys.length > 0 ? 0 : 1` at 1333) would pin every machine on a generator-less board to 0% — the common case, since the injected row appears regardless of dataset. The bare-output rule (equilibrium.ts:607–614 → `disposal = 0` at 1523) would stop every unwired generator (Step 4 removes the sink drawer that used to make it non-bare). The supply seed (throughput.ts:462–466, "Seed every consumed input at zero") would cap every unwired machine at 0 through `selectConnectedInputSupplyLimit` (499). The exclusions (Step 5) keep the WIRED behaviour intact: a generator→machine energy edge still lands in `wiredInputs` (equilibrium.ts:581–582) and in the supply map through the edge loops (throughput.ts:469–494, 581–602), so a fuel-starved generator's 0 transfer still throttles the plant — "a short grid throttles the plant the same way a short fuel line does" is unchanged. The edge machinery itself is already resource-agnostic: `getCompatibleOutputFlowForResource` (equilibrium.ts:2531–2555) finds the generator's output by exact key, and `getEdgeTargetDemandKey` (2494–2507) returns `undefined` for a consumer (no energy slot in its raw recipe) so the caller falls back to `makeResourceKey(edge.resourceKind, edge.resourceId)` — exactly `energy:lv`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/solver/throughput.test.ts` (its fixtures at 490–599: a full `FactoryProject` literal, `fuelProfiles` already swept in Task 2, the `solveClosed(project)` helper at 530, `closeBoundaries` import). Helper for the tests:

```ts
/** A generator node: zero-EU, one energy output, nameplate `powerPerSecond` EU/s. */
function generatorNode(id: string, tierId: string, powerPerSecond: number) {
  return {
    id,
    recipeId: "gen",
    machineCount: 1,
    parallel: 1,
    overclockTier: tierId.toUpperCase(),
    enabled: true,
    position: { x: 0, y: 0 },
  } as FactoryNode;
}

function generatorRecipe(tier: string, powerPerSecond: number) {
  return {
    id: "gen",
    name: "Generator",
    machineType: "Generator",
    minimumTier: tier,
    durationTicks: 20,
    eut: 0,
    machineHandlers: [{ id: "base", label: "Generator", machineType: "Generator", minimumTier: tier, kind: "single" }],
    inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
    // The dataset's energy output is EU PER OPERATION; a 20-tick recipe runs
    // one operation per second, so the amount is the per-second figure as-is
    // (this is the pipeline's `energy = min(euPerOp, maxEuT × period)` clamp,
    // one op per period).
    outputs: [{ kind: "energy", id: tier.toLowerCase(), amount: powerPerSecond, displayName: `Energy (${tier})` }],
  } as unknown as Recipe;
}
```

Tests (a consumer is an ordinary machine: reuse the file's existing `lcr`-style smelting recipe — a 400-tick, 10 EU/t, `minimumTier: "LV"` recipe on a "Furnace" with one item input and one item output):

```ts
describe("power as a flow", () => {
  it("bills a machine's draw as an energy input on its own grid", () => {
    // 10 EU/t: the dataset's eut is per TICK, so a machine drawing 10 EU/t
    // drinks 10 x 20 = 200 EU/s, on LV.
    const project = fullProjectFixture({
      recipes: [smelterRecipe(10, "LV", 20)],
      nodes: [machineNodeFixture("M")],
      edges: [],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    const node = result.nodes["M"]!;
    expect(node.inputs["energy:lv"]).toBeDefined();
    // The nameplate book the Power section already shows (EU/tick).
    expect(node.euT).toBe(10);
    expect(result.resources["energy:lv"].consumedPerSecond).toBeCloseTo(200);
  });

  it("does not bill a stalled machine any draw", () => {
    // The proven under-powered fixture from power-report.test.ts: an HV
    // machine running an MV overclock with a single hatch stalls to zero,
    // and a stalled machine must not still drink.
    const project = fullProjectFixture({
      recipes: [lcrStyleRecipe(480, "HV")],
      nodes: [machineNodeFixture("M", { overclockTier: "MV", energyHatches: 1 })],
      edges: [],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    const node = result.nodes["M"]!;
    expect(node.utilization).toBeCloseTo(0);
    // The state gate is the whole stall model: a machine that cannot run
    // draws NOTHING — not a nameplate figure. The power block (Task 6) sums
    // nodeResult.inputs, so a stalled machine correctly adds zero to the
    // grid's demand, and supplying power un-stalls it through the same
    // equilibrium that un-starves a short fuel line.
    expect(result.resources["energy:mv"]?.consumedPerSecond ?? 0).toBeCloseTo(0);
    expect(node.inputs["energy:mv"]).toBeUndefined();
  });

  it("bills a generator's output as an energy output, with no draw of its own", () => {
    const project = fullProjectFixture({
      recipes: [generatorRecipe("lv", 12800)],
      nodes: [generatorNode("G", "lv", 12800)],
      edges: [],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    const node = result.nodes["G"]!;
    expect(node.inputs["energy:lv"]).toBeUndefined();
    expect(node.outputs["energy:lv"].amountPerSecond).toBeCloseTo(12800);
    expect(result.resources["energy:lv"].producedPerSecond).toBeCloseTo(12800);
  });

  it("moves wired energy from the generator's output to the machine's input", () => {
    const project = fullProjectFixture({
      recipes: [smelterRecipe(10, "LV", 20), generatorRecipe("lv", 12800)],
      nodes: [machineNodeFixture("M"), generatorNode("G", "lv", 12800)],
      edges: [
        {
          id: "power",
          source: "G",
          target: "M",
          resourceKind: "energy",
          resourceId: "lv",
          sourceHandleId: "output:energy:lv",
          targetHandleId: "input:energy:lv",
        },
      ],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    const book = result.resources["energy:lv"];
    expect(book.producedPerSecond).toBeCloseTo(12800);
    expect(book.consumedPerSecond).toBeCloseTo(200); // the smelter's 10 EU/t x 20.
    // The generator is a producer, not a consumer: partial downstream demand
    // must not cap it (the file's existing "free producer surplus" test is
    // the precedent at line 537).
    expect(result.nodes["G"]!.outputs["energy:lv"].amountPerSecond).toBeCloseTo(12800);
  });

  it("does not invent a storage drawer for unwired generator energy", () => {
    const project = fullProjectFixture({
      recipes: [generatorRecipe("lv", 12800)],
      nodes: [generatorNode("G", "lv", 12800)],
      edges: [],
    });
    const closed = closeBoundaries(project);
    // G's benzene still gets its drawer — exactly ONE, the fluid "in" slot.
    // The energy output gets nothing: there is no storage that buffers the
    // grid, and attach() (close-boundaries.ts:60–81) would cast "energy"
    // into FactoryStorage["kind"], which does not have it.
    expect(closed.storages ?? []).toHaveLength(1);
    expect((closed.storages ?? [])[0]).toMatchObject({ kind: "fluid", resourceId: "benzene" });
    expect((closed.edges ?? []).every((edge) => edge.resourceKind !== "energy")).toBe(true);
  });

  it("names the grid a machine actually runs on, even when it mismatches the generator's", () => {
    const project = fullProjectFixture({
      recipes: [smelterRecipe(10, "MV", 20), generatorRecipe("lv", 12800)],
      nodes: [machineNodeFixture("M", { overclockTier: "MV" }), generatorNode("G", "lv", 12800)],
      edges: [],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    // M is an MV machine: it bills energy:mv, and the LV generator's
    // energy:lv output sits unsold on its own line. No grid bridging (a
    // transformer is a machine the player places — Task 7), so the two never
    // meet — and the unsold output must not stall the generator.
    expect(result.nodes["M"]!.inputs["energy:mv"]).toBeDefined();
    expect(result.nodes["M"]!.inputs["energy:lv"]).toBeUndefined();
    expect(result.nodes["G"]!.outputs["energy:lv"].amountPerSecond).toBeCloseTo(12800);
    expect(result.nodes["G"]!.utilization).toBeCloseTo(1);
  });

  it("keeps a generator-less board running at full tilt", () => {
    const project = fullProjectFixture({
      recipes: [smelterRecipe(10, "LV", 20)],
      nodes: [machineNodeFixture("M")],
      edges: [],
    });
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });
    // An unwired energy row is a grid hint, not an empty input bus: the board
    // as drawn (ore from a sketch drawer, no generator, no power wire) runs
    // at 100%. The regression this pins is the bare-input rule applying to
    // the injected row, which would zero EVERY existing plan.
    expect(result.nodes["M"]!.utilization).toBeCloseTo(1);
    expect(result.nodes["M"]!.inputs["energy:lv"]).toBeDefined();
  });
});
```

The four helpers the tests above use, verbatim (add them next to `generatorNode`/`generatorRecipe`; the file's own fixture conventions at 490–599 stay untouched — these are self-contained and use the file's existing imports: `PROJECT_SCHEMA_VERSION`, `Recipe`, `FactoryNode`, `FactoryEdge`, `FactoryProject` — add any of those imports the file is missing):

```ts
function fullProjectFixture({
  recipes,
  nodes,
  edges = [],
}: {
  recipes: Recipe[];
  nodes: FactoryNode[];
  edges?: FactoryEdge[];
}): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "power-flow-project",
    name: "Power flow",
    recipes,
    nodes,
    edges,
  } as unknown as FactoryProject;
}

function machineNodeFixture(id: string, overrides: Partial<FactoryNode> = {}): FactoryNode {
  return {
    id,
    recipeId: "smelt",
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  } as unknown as FactoryNode;
}

function smelterRecipe(eut: number, minimumTier: string, durationTicks: number): Recipe {
  return {
    id: "smelt",
    name: "Smelt",
    machineType: "Furnace",
    minimumTier: minimumTier as MachineTier,
    durationTicks,
    eut,
    machineHandlers: [
      {
        id: "base",
        label: "Furnace",
        machineType: "Furnace",
        minimumTier: minimumTier as MachineTier,
        kind: "single",
      },
    ],
    inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Ore" }],
    outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
  } as unknown as Recipe;
}

// Mirrors lcrRecipe in power-report.test.ts:8-19 — the proven under-powered
// fixture, as a full recipe.
function lcrStyleRecipe(eut: number, minimumTier: string): Recipe {
  return {
    id: "lcr",
    name: "Large Chemical Reactor",
    machineType: "Large Chemical Reactor",
    minimumTier: minimumTier as MachineTier,
    durationTicks: 400,
    eut,
    machineHandlers: [
      {
        id: "base",
        label: "Large Chemical Reactor",
        machineType: "Large Chemical Reactor",
        minimumTier: minimumTier as MachineTier,
        kind: "single",
      },
    ],
    inputs: [{ kind: "item", id: "reagent", amount: 1, displayName: "Reagent" }],
    outputs: [{ kind: "item", id: "product", amount: 1, displayName: "Product" }],
  } as unknown as Recipe;
}
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/lib/solver/throughput.test.ts -t "power as a flow"`
Expected: FAIL — `result.resources["energy:lv"]` is undefined (no injection yet) and the close-boundaries test finds a bogus energy-kind drawer. (Even after Steps 3–4 the draw tests would still fail at `consumedPerSecond ≈ 200`/`producedPerSecond ≈ 12800`: the books multiply by utilization, and the bare-input/bare-output rules would pin the fixtures to 0% until Step 5 lands. That is why the exclusions are part of this task, not a follow-up.)

- [ ] **Step 3: Inject the draw in `calculateThroughput`**

In `src/lib/solver/throughput.ts`:

1. Remove `import type { FuelEstimate } ...` (line 13) if Task 2 left it — it is part of this function's removal.
2. Add the import: `import { energyResourceForTier } from "@/lib/model/energy";`
3. In the per-node loop, AFTER the input loop (which ends at line 161) and BEFORE the output loop (line 163):

```ts
    if (powerReport && powerReport.state === "ok" && powerReport.drawEuT > 0) {
      addFlow(
        inputs,
        energyResourceForTier(powerReport.tier),
        powerReport.drawEuT * node.machineCount * node.parallel * TICKS_PER_SECOND,
      );
    }
```

The arithmetic, verified against the books already in the loop: the dataset's `eut` is EU **per tick**, and the node's `euT` at 174–175 (`overclockedRecipe.eut × machineCount × parallel × machineParallelMultiplier`) is therefore EU/tick — it is the number the Power section of the shopping list already shows. A machine drawing X EU/tick while running draws X × 20 EU per second, so the injected flow is `euT × TICKS_PER_SECOND`. At the injection point (before 174) `euT` is not yet bound, so the same quantity is written from the power report: `powerReport.drawEuT` (power-report.ts:113) is `Math.abs(stats.eut) × parallels`, and its `parallels` is the identical expression to `machineParallelMultiplier` (throughput.ts:138), making `drawEuT × machineCount × parallel` exactly the node's `euT`. `TICKS_PER_SECOND` is already imported (line 24).

Sanity check for the first test: a 20-tick recipe at 10 EU/t, 1 machine, 1 parallel → `euT = 10`, draw = 10 × 20 = **200 EU/s**.

4. Delete the `fuelEstimate: calculateFuelEstimate(project, totalEuT),` line from the return (263) and the `calculateFuelEstimate` function (1033–1066) if Task 2 left either.

- [ ] **Step 4: Skip energy outputs in `closeBoundaries`**

In `src/lib/solver/close-boundaries.ts`, in the output loop (103–111), as the FIRST statement:

```ts
    if (output.kind === "energy") {
      // Energy is a resource on the grid, not a fluid: there is no storage
      // that buffers it, and attach() would cast "energy" into
      // FactoryStorage["kind"], which does not have it.
      continue;
    }
```

The input loop (94–102) is unchanged: no raw recipe carries an energy input, so there is nothing to skip there.

- [ ] **Step 5: Exclude energy from the bare constraints (three sites, no fourth)**

The policy from the task intro, as code. THREE edits:

1. `src/lib/solver/equilibrium.ts`, the bare-input classification loop (576–590). The `needs` map (330, 488–501) holds one entry per (target, resource) pair that has an INCOMING EDGE, so the `else` branch means "nothing feeds this" — and a machine's injected energy row has no recipe slot and no wire in the common case. An unwired draw must not be an empty bus; a wired one already lands in `wiredInputs` (581–582) and keeps throttling:

```ts
      const needKey = `${node.id}|${inputKey}`;
      if (needs.has(needKey)) {
        wiredInputs.push({ needKey, nameplatePerSecond: flow.amountPerSecond });
      } else if (!inputKey.startsWith("energy:")) {
        // Nothing feeds this ingredient. In a closed plan that is not a
        // standing assumption that you carry it in by hand, it is a machine
        // with an empty input bus: it does not run until something declares
        // where the ingredient comes from.
        //
        // The one exception is the grid itself: an unwired energy row is a
        // hint to add a generator, not an empty input bus. A WIRED energy
        // edge lands in wiredInputs above and still throttles — a fuel-
        // starved generator's 0 transfer stops the plant, exactly like a
        // short fuel line.
        bareInputKeys.push(inputKey as ResourceKey);
      }
```

2. `src/lib/solver/equilibrium.ts`, the bare-output loop (607–614), after the EPSILON check (608–610):

```ts
      if (outputKey.startsWith("energy:")) {
        // Energy has no storage to fill: an unsold output is surplus grid
        // power, not a full bus. Stalling here would stop every unwired
        // generator — and Step 4 removed the sink drawer it used to hide
        // behind.
        continue;
      }
```

3. `src/lib/solver/throughput.ts`, the zero-seed loop in `calculateConnectedInputSupply` (462–466):

```ts
    for (const [inputKey, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond > EPSILON) {
        if (inputKey.startsWith("energy:")) {
          // The grid is not a supply line the board must name a source for:
          // an unwired draw is a hint, not a zero-delivery ingredient. A
          // WIRED draw still reaches the map through the edge loop below, so
          // a fuel-starved generator still throttles the plant.
          continue;
        }
        addRequiredRate(supplyByNodeAndResource, node.id, inputKey as ResourceKey, 0);
      }
    }
```

Deliberately NOT touched: the blame ranking in `calculateThroughput` (throughput.ts:732–779) iterates `supplyMap?.keys()` — the very map the seed loop above builds — so with the seed skipped an unwired energy key is simply absent from the map and can never get the blame; a wired energy key is in the map with its honest edge value (the `honestSupplyByNodeAndResource` map at 581–602 is edge-built the same way) and ranks like any other clogged wire. A fourth exclusion here would be dead code.

- [ ] **Step 6: Run the tests, verify they pass**

Run: `npx vitest run src/lib/solver/throughput.test.ts -t "power as a flow"`
Expected: PASS. Then `npm run typecheck` and `npm run test` — green baseline (871 passed | 1 expected fail, 85 files).

- [ ] **Step 7: Commit**

```bash
git add src/lib/solver
git commit -m "The solver bills power as a flow: draws on the machine's own grid, stalls bill nothing, unwired draws never starve"
```

---

### Task 4: Generators are not steam machines

**Files:**
- Modify: `src/lib/model/recipe-rules.ts` (new export near `isSteamMachineHandler` at 66–73; `steamSingleblockDurationTicks` at 96–105)
- Modify: `src/lib/solver/power-report.ts` (imports 1–8; `getNodeSteamReport` gate after 212)
- Test: `src/lib/model/recipe-rules.test.ts` (exists — append)

**Interfaces:**
- Produces: `export function isGeneratorRecipe(recipe: Pick<Recipe, "outputs">): boolean` — true iff any output has `kind === "energy"`. Consumed by both gates in this task, and by Task 8 (the "Add power" button must never treat a generator as a consumer).

**Why the fix is real:** `isSteamMachineHandler` at 66–68 tests `/\bsteam\b/i` against the handler label. A dataset generator handler labelled "LV Steam Turbine" (the normalizer's hand-built tier templates from plan 1) matches it, so `steamSingleblockDurationTicks` would double its burn (base 10 ticks → bronze ×2 → 20, halving the output) and `getNodeSteamReport` would give it a phantom steam line. Generators are on the list of machines whose behaviour comes from the dataset (machine-table.ts has no generator family — verified), and a steam turbine's 10-tick burn is its real period, not a singleblock-steam synthesis.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/model/recipe-rules.test.ts`:

```ts
describe("generator recipes", () => {
  // A steam turbine generator as the pipeline exports it: eut 0, a 10-tick
  // burn, an energy output, and a handler named after the steam form. The
  // handler carries NO durationTicks: the normalizer's template does not,
  // which is exactly what makes the steam-singleblock math reachable.
  const turbine: Recipe = {
    id: "gas-st-lv",
    name: "Gas Turbine",
    machineType: "Gas Turbine",
    minimumTier: "LV",
    durationTicks: 10,
    eut: 0,
    machineHandlers: [
      { id: "lv", label: "LV Steam Turbine", machineType: "Gas Turbine", minimumTier: "LV", kind: "single" },
    ],
    inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
    outputs: [{ kind: "energy", id: "lv", amount: 6400, displayName: "Energy (LV)" }],
  } as unknown as Recipe;

  it("flags a recipe by its energy output", () => {
    expect(isGeneratorRecipe(turbine)).toBe(true);
    expect(isGeneratorRecipe({ outputs: [{ kind: "item", id: "x", amount: 1 }] })).toBe(false);
  });

  it("keeps the real burn period of a steam turbine generator", () => {
    // Without the gate: "LV Steam Turbine" is a steam handler, the handler
    // has no duration, and steamSingleblockDurationTicks doubles the 10-tick
    // base to 20 — halving the EU/s.
    const applied = applyMachineHandlerToRecipe(turbine, { machineHandlerId: "lv" });
    expect(applied.durationTicks).toBe(10);
  });

  it("does not hand a steam turbine generator a steam line", () => {
    // Pins the contract: today an eut-0 guard already returns undefined, but
    // a generator that ever exported a non-zero eut must not show a steam
    // bill — the machine list is what keeps a mechanic off machines without
    // it (AGENTS.md, heat doctrine).
    expect(getNodeSteamReport(turbine, { machineHandlerId: "lv" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/lib/model/recipe-rules.test.ts -t "generator recipes"`
Expected: FAIL — `isGeneratorRecipe` is not exported; the duration test sees 20.

- [ ] **Step 3: Implement the export and the two gates**

`src/lib/model/recipe-rules.ts`, after `isHighPressureSteamHandler` (line 73):

```ts
/**
 * A generator feeds the grid instead of drawing from it: it has an energy
 * OUTPUT, and it is the one recipe shape the steam-singleblock syntheses
 * must not touch — a "Steam Turbine" is a machine name, not a steam machine
 * in the singleblock sense, and its 10-tick burn is real, not a bronze x2.
 */
export function isGeneratorRecipe(recipe: Pick<Recipe, "outputs">): boolean {
  return recipe.outputs.some((output) => output.kind === "energy");
}
```

Gate (a) — `steamSingleblockDurationTicks` (96–105): the guard at line 100 becomes

```ts
  if (handler.kind === "multiblock" || !isSteamMachineHandler(handler) || isGeneratorRecipe(recipe)) {
    return undefined;
  }
```

and the function's `recipe` parameter `Pick<Recipe, ...>` gains `"outputs"` so the call at its sole caller (`applyMachineHandlerToRecipe`, 147–149) still typechecks — it passes the full recipe.

Gate (b) — `src/lib/solver/power-report.ts`, in `getNodeSteamReport` (206–250) directly after the machineType guard (210–212):

```ts
  if (isGeneratorRecipe(recipe)) {
    return undefined;
  }
```

and add `isGeneratorRecipe` to the existing `@/lib/model/recipe-rules` import (1–8). Line 155's `isSteamMachineHandler(handler) ? 0 : ...` eut rule needs NO gate: a generator recipe already carries `eut: 0`, and the forced zero is the right answer for a machine that draws no power.

- [ ] **Step 4: Run the tests, verify they pass; then the full gate**

Run: `npx vitest run src/lib/model/recipe-rules.test.ts` then `npm run typecheck && npm run test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/model/recipe-rules.ts src/lib/model/recipe-rules.test.ts src/lib/solver/power-report.ts
git commit -m "A steam turbine is a generator, not a steam machine: the singleblock syntheses step around energy outputs"
```

---

### Task 5: Energy rows on the card, with EU/s

**Files:**
- Modify: `src/lib/model/rate-unit.ts:34–37` (the whole function)
- Modify (one-line call sites): `src/lib/model/resources.ts:186`, `src/components/flow/flow-explainers.ts:70`, `src/components/InspectorPanel.tsx:80`, `src/components/FactoryFlow.tsx:2446`, `src/components/flow/StorageNode.tsx:859`, `src/components/flow/RecipeNode.tsx:2850`
- Modify: `src/components/flow/RecipeNode.tsx` (lucide import line 13; `GlanceIoRow` icon ternary 1579–1595; `PortRow` icon ternary 2582–2609)
- Test: `src/lib/model/rate-unit.test.ts`, `src/components/flow/node-verdict.test.ts`

**Interfaces:**
- Consumes: the energy RailPort that `buildRailPorts` (node-verdict.ts:1164–1170) already auto-creates from the Task 3 flow — no change to node-verdict.ts. The port has `kind: "energy"`, `resource: undefined` (no displayRecipe slot to look up), handleId `input:energy:lv` (or the generator's `output:energy:lv`), and `unsupplied: true` while unwired.
- Produces: `rateUnitSuffix(kind: string): string` — the widened signature Task 5's call sites all adopt. " EU/t" for `kind === "energy"`.

**Why the port appears with no code:** `buildSide` (node-verdict.ts:1194+) builds ports from the solver's FLOWS, not from recipe slots: the flows at 1196 include the synthetic energy draw, the resource lookup at 1214–1216 finds nothing in the displayRecipe (a machine's raw recipe has no energy input) so `resource` stays `undefined`, and the NO-SUPPLY badge at 1217–1219 fires while unwired. The only new surface is the icon: a bolt, because energy is not an atlas image.

- [ ] **Step 1: Write the failing tests**

`src/lib/model/rate-unit.test.ts` — replace the existing `rateUnitSuffix` assertions (lines 14–15) with:

```ts
  it("suffixes a rate per resource kind", () => {
    expect(rateUnitSuffix("item")).toBe("/t");
    expect(rateUnitSuffix("fluid")).toBe(" L/t");
    // Power reads the way the game quotes it: EU per unit, k/M/G folded
    // downstream by formatCompact.
    expect(rateUnitSuffix("energy")).toBe(" EU/t");
  });
```

`src/components/flow/node-verdict.test.ts` — append to the `buildRailPorts` describe block (the pattern is at 745–746: `deriveNodeVerdict(proj, result, "N")` then `buildRailPorts(proj, result, "N", recipeResources, verdict)`; the file's `flow`/`nodeResult`/`edgeResult`/`project`/`machineNode`/`edge`/`throughput` helpers are at 14–90 — note the `project` helper's `fuelProfiles: []` was swept in Task 2):

```ts
  it("builds an energy port from the synthetic draw, with no recipe slot to look up", () => {
    const proj = project({
      nodes: [machineNode("N"), machineNode("G")],
      edges: [
        { id: "ePower", source: "G", target: "N", resourceKind: "energy", resourceId: "lv" } as FactoryEdge,
      ],
    });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 1,
          inputs: {
            "energy:lv": {
              key: "energy:lv",
              kind: "energy",
              resourceId: "lv",
              displayName: "Energy (LV)",
              amountPerSecond: 20,
            } as unknown as ResourceFlow,
          },
          outputs: {},
        }),
      },
      { ePower: edgeResult({ transferredPerSecond: 20, demandPerSecond: 20 }) },
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(proj, result, "N", { inputs: [], outputs: [] } as never, verdict);

    // The flow alone made the port: canonical handle, named from the flow,
    // wired (the edge carries it), no recipe resource to render an icon from.
    expect(rails.inputs).toHaveLength(1);
    expect(rails.inputs[0]!.kind).toBe("energy");
    expect(rails.inputs[0]!.resourceId).toBe("lv");
    expect(rails.inputs[0]!.resource).toBeUndefined();
    expect(rails.inputs[0]!.handleId).toBe("input:energy:lv");
    expect(rails.inputs[0]!.connected).toBe(true);
  });

  it("flags an unwired energy port unsupplied, like any other unmet input", () => {
    const proj = project({ nodes: [machineNode("N")] });
    const result = throughput(
      {
        N: nodeResult({
          utilization: 0,
          inputs: {
            "energy:lv": {
              key: "energy:lv",
              kind: "energy",
              resourceId: "lv",
              displayName: "Energy (LV)",
              amountPerSecond: 20,
            } as unknown as ResourceFlow,
          },
          outputs: {},
        }),
      },
      {},
    );
    const verdict = deriveNodeVerdict(proj, result, "N");
    const rails = buildRailPorts(proj, result, "N", { inputs: [], outputs: [] } as never, verdict);

    expect(rails.inputs).toHaveLength(1);
    expect(rails.inputs[0]!.unsupplied).toBe(true);
    expect(rails.inputs[0]!.connected).toBe(false);
  });
```

If `ResourceFlow` is not yet imported in the test file, import it from `@/lib/model/types` (the `flow` helper at line 14 already returns that type, so it is one line).

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/lib/model/rate-unit.test.ts src/components/flow/node-verdict.test.ts`
Expected: the rate-unit test FAILs (old boolean signature — `rateUnitSuffix("item")` is a type error or returns the wrong string); the node-verdict tests may already PASS (the ports are built from flows) — that is fine: they pin the shape Task 3's injection must keep feeding.

- [ ] **Step 3: Widen `rateUnitSuffix`**

`src/lib/model/rate-unit.ts:34–37`:

```ts
export function rateUnitSuffix(kind: string): string {
  const { per } = UNITS[state.unit];
  if (kind === "fluid") {
    return ` L/${per}`;
  }
  if (kind === "energy") {
    return ` EU/${per}`;
  }
  return `/${per}`;
}
```

Then the six call sites, each a mechanical `kind === "fluid"` → `kind` (or `edge.resourceKind === "fluid"` → `edge.resourceKind`) swap:

- `src/lib/model/resources.ts:186` — `rateUnitSuffix(flow.kind).trimStart()`
- `src/components/flow/flow-explainers.ts:70` — `rateUnitSuffix(kind)`
- `src/components/InspectorPanel.tsx:80` — `rateUnitSuffix(kind).trim()`
- `src/components/FactoryFlow.tsx:2446` — `rateUnitSuffix(edge.resourceKind).trim()`
- `src/components/flow/StorageNode.tsx:859` — `rateUnitSuffix(kind).trimStart()`
- `src/components/flow/RecipeNode.tsx:2850` — `rateUnitSuffix(kind).trim() || "/s"`

- [ ] **Step 4: Put a bolt on the energy row**

`src/components/flow/RecipeNode.tsx`:

1. Line 13: `import { ChevronDown, Copy, Cpu, Minus, Plus, Sprout, Zap } from "lucide-react";`
2. `GlanceIoRow` (1572–1607): the icon ternary at 1579–1595 (inside the `h-9 w-9` span) gains the energy branch:

```tsx
        {port.resource ? (
          <ResourceIcon ... />
        ) : port.kind === "energy" ? (
          // Energy is not an atlas image: the grid's bolt, in the card's
          // energy colour, is its icon.
          <Zap className="h-6 w-6 text-amber-400" />
        ) : null}
```

3. `PortRow` (2420+): the icon ternary at 2582–2609 (inside the `h-7 w-7` chip):

```tsx
        {port.resource ? (
          <ResourceIcon ... />
        ) : port.kind === "energy" ? (
          <Zap className="h-5 w-5 text-amber-400" />
        ) : (
          <span className="block h-7 w-7 border border-[var(--mc-47)] bg-[var(--mc-55)]" />
        )}
```

(`...` = the existing `ResourceIcon` props, unchanged.) Row heights stay `h-[40px]` / `h-9` — the grid invariant. `ResourceIcon.tsx` gets NO energy branch (it renders dataset resources; energy has no dataset icon).

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npm run test`
Expected: green. (The typecheck is the net for the signature change: any call site that still passes a boolean is named there.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/model/rate-unit.ts src/lib/model/rate-unit.test.ts src/lib/model/resources.ts src/components
git commit -m "Energy rows carry a bolt and read EU per tick, the way the game quotes power"
```

---

### Task 6: The power list gains a grid balance

**Files:**
- Create: `src/components/PowerBalanceBlock.tsx`
- Modify: `src/components/MachineShoppingList.tsx` (import + one JSX line between the Power header close at 302 and the list comment at 303)
- Test: `src/components/PowerBalanceBlock.test.tsx` (new)

**Interfaces:**
- Consumes: `lastResult.nodes` from the store (`lastResult: ThroughputResult`, non-optional, factory-store.ts:175/572); `useWorkspaceView().averageMachineDraw` (`@/lib/workspace-view`, the same `average` the list at MachineShoppingList.tsx:87 reads); `GT_VOLTAGE_TIERS: Array<{ tier: Exclude<MachineTier, "DEMO">; maxEuT: number }>` (tiers.ts:3); `GT_TIER_COLORS: Record<VoltageTier, { background, border, text, shadow }>` (flow/tier-colors.ts:5); `formatCompact` (resources.ts).
- Produces: `<PowerBalanceBlock onAddPower?: (tier: MachineTier) => void />` — display-only in this task; the optional prop is declared now so Task 8's wiring is a two-line diff. `MachineTier` comes from `@/lib/model/types`.

**Why the block only reads the books:** Task 3 made the solver bill every draw as an `energy:<tier>` input and every generator output as one, so "what does the LV grid need and what does it get" is a sum over `nodeResult.inputs`/`nodeResult.outputs` — the same nameplate figures the Power section already shows, scaled by utilization when the list is in average mode. Nothing in this component decides anything; it cannot drift from the solver.

- [ ] **Step 1: Write the failing test**

`src/components/PowerBalanceBlock.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { NodeThroughput, ResourceFlow, ThroughputResult } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { PowerBalanceBlock } from "./PowerBalanceBlock";

function energyFlow(tierId: string, amountPerSecond: number): ResourceFlow {
  return {
    key: `energy:${tierId}`,
    kind: "energy",
    resourceId: tierId,
    displayName: `Energy (${tierId.toUpperCase()})`,
    amountPerSecond,
  } as unknown as ResourceFlow;
}

function machineResult(
  id: string,
  utilization: number,
  inputs: Record<string, number> = {},
  outputs: Record<string, number> = {},
): NodeThroughput {
  const flow = (amounts: Record<string, number>): Record<string, ResourceFlow> =>
    Object.fromEntries(
      Object.entries(amounts).map(([key, amount]) => [key, energyFlow(key.slice("energy:".length), amount)]),
    );
  return {
    nodeId: id,
    recipeId: "r",
    recipeName: "Machine",
    enabled: true,
    operationRatePerSecond: 1,
    inputs: flow(inputs),
    outputs: flow(outputs),
    euT: 0,
    powerStalled: false,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 0,
    utilization,
    theoreticalMachinesRequired: 0,
    status: "underutilized",
    warnings: [],
  };
}

function seed(nodes: NodeThroughput[]) {
  useFactoryStore.setState({
    lastResult: {
      ...useFactoryStore.getState().lastResult,
      nodes: Object.fromEntries(nodes.map((node) => [node.nodeId, node])),
    } as ThroughputResult,
  });
}

describe("PowerBalanceBlock", () => {
  beforeEach(() => {
    useFactoryStore.setState({ selectedBoardIds: [] });
  });

  it("sums the whole grid: one demand row reads a deficit", () => {
    seed([machineResult("M", 1, { "energy:lv": 200 })]);
    render(<PowerBalanceBlock />);

    expect(screen.getByText("Grids")).toBeDefined();
    // 200 in, 0 out: the collapsed line says the number short, not the net.
    expect(screen.getByText(/−200/)).toBeDefined();
  });

  it("shows a per-grid row when opened, and calls a covered grid supplied", () => {
    seed([
      machineResult("G", 1, {}, { "energy:lv": 12800 }),
      machineResult("M", 1, { "energy:lv": 200 }),
    ]);
    render(<PowerBalanceBlock />);

    expect(screen.getByText("Grids")).toBeDefined();
    fireEvent.click(screen.getByText("Grids"));

    expect(screen.getByText("LV")).toBeDefined();
    expect(screen.getByText(/12\.8K in \/ 200 out/)).toBeDefined();
    expect(screen.getByText("supplied")).toBeDefined();
  });

  it("stays out of the list when nothing trades energy", () => {
    seed([machineResult("M", 1)]);
    render(<PowerBalanceBlock />);

    expect(screen.queryByText("Grids")).toBeNull();
  });
});
```

If `NodeThroughput` is not the export name (check `src/lib/model/types.ts:698` area — the interface holding `status: "disabled" | ...` and `inputs: Record<string, ResourceFlow>`), use the real name in the imports.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/components/PowerBalanceBlock.test.tsx`
Expected: FAIL — module `./PowerBalanceBlock` does not exist.

- [ ] **Step 3: Implement the block**

`src/components/PowerBalanceBlock.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatCompact } from "@/lib/model/resources";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import { useWorkspaceView } from "@/lib/workspace-view";
import { useFactoryStore } from "@/store/factory-store";
import { GT_TIER_COLORS } from "./flow/tier-colors";

/**
 * Supply versus demand, per grid. The solver bills every machine's draw as an
 * energy input and every generator's output as energy (throughput.ts), so
 * this block only reads the books — it decides nothing. Collapsed it is one
 * line (the net); open, one row per grid that trades.
 */
export function PowerBalanceBlock({ onAddPower }: { onAddPower?: (tier: MachineTier) => void }) {
  const lastResult = useFactoryStore((state) => state.lastResult);
  const average = useWorkspaceView().averageMachineDraw;
  const [open, setOpen] = useState(false);

  const rows = GT_VOLTAGE_TIERS.map(({ tier }) => {
    const key = `energy:${tier.toLowerCase()}`;
    let demand = 0;
    let supply = 0;
    for (const node of Object.values(lastResult.nodes)) {
      if (node.status === "missing-recipe") {
        continue;
      }
      const utilization = average ? Math.min(1, Math.max(0, node.utilization)) : 1;
      demand += (node.inputs[key]?.amountPerSecond ?? 0) * utilization;
      supply += (node.outputs[key]?.amountPerSecond ?? 0) * utilization;
    }
    return { tier, demand, supply };
  }).filter((row) => row.demand > 0 || row.supply > 0);

  if (rows.length === 0) {
    return null;
  }

  const net = rows.reduce((sum, row) => sum + row.supply - row.demand, 0);

  return (
    <div className="border-b border-[var(--mc-47)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--mc-ink-muted)]">
          Grids
        </span>
        {net >= 0 ? (
          <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-400">
            {net > 0 ? `+${formatCompact(net)} EU/s` : "balanced"}
          </span>
        ) : (
          <span className="ml-auto rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-red-400">
            −{formatCompact(-net)} EU/s
          </span>
        )}
      </button>
      {open ? (
        <div className="px-2 pb-1.5">
          {rows.map(({ tier, demand, supply }) => {
            const color = GT_TIER_COLORS[tier];
            return (
              <div key={tier} className="flex items-center gap-2 py-1 text-[12px] tabular-nums">
                <span
                  className="w-11 shrink-0 rounded px-1 text-center text-[11px] font-bold"
                  style={{ backgroundColor: `${color.background}1f`, color: color.text }}
                >
                  {tier}
                </span>
                <span className="text-[var(--mc-ink-muted)]">
                  {formatCompact(supply)} in / {formatCompact(demand)} out
                </span>
                {supply >= demand ? (
                  <span className="ml-auto shrink-0 text-[11px] font-bold text-emerald-400">supplied</span>
                ) : (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] font-bold text-red-400">
                      −{formatCompact(demand - supply)} EU/s
                    </span>
                    {onAddPower ? (
                      <button
                        type="button"
                        onClick={() => onAddPower(tier)}
                        className="rounded bg-[var(--mc-71)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--mc-ink)]"
                      >
                        Add power
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

(`onAddPower` is declared but never passed yet: no button is reachable until Task 8 wires the store action, and the component keeps rendering exactly what Task 6's tests assert.)

- [ ] **Step 4: Mount it under the Power header**

`src/components/MachineShoppingList.tsx`: add the import with the other component imports, and between the Power header's closing `</div>` (line 302) and the list comment (line 303):

```tsx
      <PowerBalanceBlock />
```

The list's `totalMachines === 0 → null` gate (246–248) still covers it: no machines, no block. A generator is a machine, so a generator-only plan shows its grid rows.

- [ ] **Step 5: Run the test, then the full gate**

Run: `npx vitest run src/components/PowerBalanceBlock.test.tsx` then `npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/PowerBalanceBlock.tsx src/components/PowerBalanceBlock.test.tsx src/components/MachineShoppingList.tsx
git commit -m "The power list reads the grid books: one line for the net, one row per grid"
```

---

### Task 7: A wire of energy passes validation and survives reload

**Files:**
- Modify: `src/store/factory-store.ts` (import at the top; `nodeEnergyTier` helper before `buildEdgeBetweenNodes` at 3117; energy clause in `buildEdgeBetweenNodes` after the node guard at 3219–3221 and BEFORE the explicit-handle branch at 3223; synthetic pairing in `buildCompatibleEdgesBetweenNodes` after the slot `forEach` (3332) and before the dedupe `return` (3337); `parseResourceHandleId` gate at 3474–3478)
- Modify: `src/lib/model/edge-identity.ts:19–23` (`canonicalizeResourceHandleId` gate)
- Modify: `src/lib/model/project-normalize.ts` (`endpointHandles` at 123–144, energy special case after the trash check at 139–141 and before the slot check at 142–143)
- Test: `src/store/factory-store.test.ts`, `src/lib/model/project-normalize.test.ts`

**Interfaces:**
- Consumes: `hasPowerReport(recipe)` / `getNodePowerReport(recipe, node).tier` (`@/lib/solver/power-report`, 81–89 / 91–132); `makeResourceHandleId` (3453–3459, unchanged — no slot index for energy); the energy output from Task 1's schema + the pipeline's `displayName: "Energy (TIER)"`.
- Produces: an edge is legal iff the SOURCE recipe outputs `energy:X` and the TARGET's `nodeEnergyTier === X` — no grid bridging (a transformer is a machine the player places themselves), and no `selectedResource` required. Both `connectNodes` (the drag, 2062) and `autoConnectNode` (placement, 2200) create them.

**Why the clause sits where it does:** a hand-dragged energy wire carries both handles, so control would fall into the explicit branch at 3223 — whose `getExplicitTargetInput` (3272–3297) looks for a matching INPUT SLOT on the target. A consumer has no energy slot (the draw is synthesized by the solver), so the branch would return `undefined` and the drag would die. The energy clause must therefore run first; `getExplicitTargetInput` itself stays untouched (single caller, 3224). And `project-normalize` would otherwise delete every power wire on load: its slot check at 143 asks the raw recipe for an energy input and finds none — the same trap the trash-can special case above it documents.

- [ ] **Step 1: Write the failing tests**

`src/store/factory-store.test.ts` (follow the file's existing store-seeding style; these build a two-machine project and drive the public actions):

```ts
const genRecipe = {
  id: "gen",
  name: "Generator",
  machineType: "Generator",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 0,
  machineHandlers: [{ id: "lv", label: "LV", machineType: "Generator", minimumTier: "LV", kind: "single" }],
  inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
  outputs: [{ kind: "energy", id: "lv", amount: 12800, displayName: "Energy (LV)" }],
} as unknown as Recipe;

const smelterRecipe = (eut: number, minimumTier: "LV" | "MV") =>
  ({
    id: "smelt",
    name: "Smelt",
    machineType: "Furnace",
    minimumTier,
    durationTicks: 20,
    eut,
    machineHandlers: [{ id: "base", label: "Furnace", machineType: "Furnace", minimumTier, kind: "single" }],
    inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Ore" }],
    outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
  }) as unknown as Recipe;

function machineNode(id: string, recipeId: string, overrides: Partial<FactoryNode> = {}) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  } as FactoryNode;
}

// The store's initial datasetManifest is undefined (factory-store.ts:542) and
// addPowerForTier no-ops at the version check before anything else: tests that
// must get PAST that check spread this in.
function testDataset() {
  return {
    datasetManifest: {
      schemaVersion: 1,
      versions: [
        {
          id: "test-version",
          gtnhVersion: "test",
          channel: "stable",
          publishedAt: "2026-08-18T00:00:00.000Z",
          manifestPath: "test/manifest.json",
          recipeDatasetPath: "test/recipe-dataset.json",
          sourceInfo: {},
        },
      ],
    } as unknown as DatasetManifest,
    selectedDatasetVersionId: "test-version",
  };
}

describe("wiring energy", () => {
  function seedPowerProject(consumerTier: "LV" | "MV" = "LV", consumerEut = 10) {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-wire-project",
      name: "Power wire",
      recipes: [genRecipe, smelterRecipe(consumerEut, consumerTier)],
      nodes: [
        machineNode("G", "gen"),
        machineNode("M", "smelt", { overclockTier: consumerTier }),
      ],
      edges: [],
    };
    useFactoryStore.setState({ project, lastResult: calculateThroughput(project) });
  }

  it("wires a generator to a machine on the same grid, with canonical handles", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    const edge = useFactoryStore.getState().project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("G");
    expect(edge!.target).toBe("M");
    expect(edge!.resourceId).toBe("lv");
    expect(edge!.sourceHandle).toBe("output:energy:lv");
    expect(edge!.targetHandle).toBe("input:energy:lv");
  });

  it("refuses a grid mismatch: no transformer, no bridging", () => {
    seedPowerProject("MV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("refuses to feed a machine that draws nothing", () => {
    seedPowerProject("LV", 0);
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });

  it("auto-connects power when a machine lands next to a same-grid generator", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().autoConnectNode("M");

    const edge = useFactoryStore.getState().project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("G");
  });

  it("toggles an identical energy wire off on a second drag", () => {
    seedPowerProject("LV");
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });
    useFactoryStore.getState().connectNodes("G", "M", { kind: "energy", id: "lv" });

    expect(useFactoryStore.getState().project.edges).toHaveLength(0);
  });
});
```

(`connectNodes` re-solves `lastResult` itself — connectNodesBatch at 2106–2110 — so the solve running on a project that carries an energy edge is exercised by every test above. The toggle test passes with or without the `canonicalizeResourceHandleId` gate, because both drags mint identical index-less handles (`output:energy:lv` / `input:energy:lv`) and `findDuplicateEdge` sees them as one wire either way; the gate is for uniformity — keeping `isSameEdgeWire`'s row-identity rule consistent with the slot-indexed spellings item/fluid use, which energy never produces.)

`src/lib/model/project-normalize.test.ts` — append to its existing chain tests (the file already drives `normalizeLoadedProject`):

```ts
it("keeps a power wire on load: a consumer's raw recipe has no energy slot", () => {
  const project: FactoryProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "power-load",
    name: "Power load",
    recipes: [
      { id: "gen", name: "Generator", machineType: "Generator", minimumTier: "LV", durationTicks: 20, eut: 0,
        machineHandlers: [], inputs: [], outputs: [{ kind: "energy", id: "lv", amount: 12800, displayName: "Energy (LV)" }] } as unknown as Recipe,
      { id: "smelt", name: "Smelt", machineType: "Furnace", minimumTier: "LV", durationTicks: 20, eut: 10,
        machineHandlers: [], inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Ore" }], outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }] } as unknown as Recipe,
    ],
    nodes: [
      { id: "G", recipeId: "gen", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 0, y: 0 } } as unknown as FactoryNode,
      { id: "M", recipeId: "smelt", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 440, y: 0 } } as unknown as FactoryNode,
    ],
    edges: [
      { id: "power", source: "G", target: "M", resourceKind: "energy", resourceId: "lv",
        sourceHandle: "output:energy:lv", targetHandle: "input:energy:lv", label: "Energy (LV)" },
    ],
  };

  const normalized = normalizeLoadedProject(project);
  expect(normalized.edges.map((edge) => edge.id)).toContain("power");
});
```

`DatasetManifest` (used by `testDataset` above) is imported from `@/lib/datasets`; the file's existing type imports cover the project/node/recipe types only.

- [ ] **Step 2: Run them, verify they fail**

Run: `npx vitest run src/store/factory-store.test.ts src/lib/model/project-normalize.test.ts`
Expected: the wire tests FAIL (no edge created — the general path finds no item/fluid match); the normalize test FAILS (the edge is dropped by the slot check at project-normalize.ts:142–143).

- [ ] **Step 3: Teach the store about energy wires**

`src/store/factory-store.ts`:

1. Imports (top of file, with the other `@/lib` imports):

```ts
import { getNodePowerReport, hasPowerReport } from "@/lib/solver/power-report";
```

2. A private helper, directly above `buildEdgeBetweenNodes` (3117):

```ts
/**
 * The grid a card actually draws from — its power report's tier, lower-cased
 * into an energy id ("LuV" → "luv"; never toUpperCase, the id is the id).
 * Machines without a power report (manual/instant, zero-EU) draw no energy
 * and can never be an energy wire's end.
 */
function nodeEnergyTier(recipe: Recipe, node: FactoryNode): string | undefined {
  if (!hasPowerReport(recipe)) {
    return undefined;
  }
  return getNodePowerReport(recipe, node).tier.toLowerCase();
}
```

3. In `buildEdgeBetweenNodes`, after the node guard (3219–3221) and BEFORE the explicit-handle branch (3223):

```ts
  // A wire of energy has no recipe slot to match on either end: the source
  // must output it, the target must draw from that same grid. No bridging —
  // a transformer is a machine the player places, not a property of the wire.
  const sourceEnergy = sourceRecipe.outputs.find((output) => output.kind === "energy");
  const targetTier = nodeEnergyTier(targetRecipe, targetNode);
  if (sourceEnergy && targetTier === sourceEnergy.id) {
    return {
      id: createId("edge"),
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: makeResourceHandleId("output", sourceEnergy),
      targetHandle: makeResourceHandleId("input", { kind: "energy", id: targetTier }),
      resourceKind: "energy",
      resourceId: sourceEnergy.id,
      label: sourceEnergy.displayName ?? `Energy (${targetTier.toUpperCase()})`,
    };
  }
```

4. In `buildCompatibleEdgesBetweenNodes`, after the slot `forEach` (3332) and before the `return dedupeEdgeWires(edges)` (3337):

```ts
  // The one pairing slots cannot express: power. A generator's energy output
  // meets the target's grid when the target draws from that same tier.
  const sourceEnergy = sourceRecipe.outputs.find((output) => output.kind === "energy");
  const targetTier = nodeEnergyTier(targetRecipe, targetNode);
  if (sourceEnergy && targetTier === sourceEnergy.id) {
    edges.push({
      id: createId("edge"),
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: makeResourceHandleId("output", sourceEnergy),
      targetHandle: makeResourceHandleId("input", { kind: "energy", id: targetTier }),
      resourceKind: "energy",
      resourceId: sourceEnergy.id,
      label: sourceEnergy.displayName ?? `Energy (${targetTier.toUpperCase()})`,
    });
  }
```

5. The `parseResourceHandleId` gate (3474–3478) gains `energy`:

```ts
    (kind !== "item" && kind !== "fluid" && kind !== "energy") ||
```

- [ ] **Step 4: Teach the identity and the loader**

`src/lib/model/edge-identity.ts:19–23` — same gate change:

```ts
    (kind !== "item" && kind !== "fluid" && kind !== "energy") ||
```

(energy has no slot index, but canonicalizing it like item/fluid keeps `isSameEdgeWire`'s row-identity rule uniform — and it is what makes the toggle-off test pass.)

`src/lib/model/project-normalize.ts`, in `endpointHandles`, after the trash check (139–141) and before the slot check (142–143):

```ts
    // A generator's energy output and a machine's draw have no recipe slot to
    // check: the draw is synthesized by the solver, so the slot check below
    // would delete every power wire on load — the same trap the trash check
    // above documents. Re-implement the power-report's kind guard here (eut
    // and duration are all it needs; importing the solver into the model
    // would be a layering cycle).
    if (kind === "energy") {
      if (side === "source") {
        return recipe.outputs.some((slot) => slot.kind === "energy");
      }
      return Math.abs(recipe.eut) > 0 && recipe.durationTicks > 0;
    }
```

- [ ] **Step 5: Run the tests, then the full gate**

Run: `npx vitest run src/store/factory-store.test.ts src/lib/model/project-normalize.test.ts src/lib/model/edge-identity.test.ts` (if the last has no test file, its coverage rides on the toggle test) then `npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/store/factory-store.ts src/lib/model/edge-identity.ts src/lib/model/project-normalize.ts
git commit -m "A wire of energy: same grid only, no slot to match, and it survives reload"
```

---

### Task 8: "Add power" closes the gap with a real generator

**Files:**
- Modify: `src/store/factory-store.ts` (new imports; exported `pickPowerRecipe`; `addPowerForTier` action — interface entry after `connectNodesBatch` (409–420), implementation after `connectNodesBatch` (2112))
- Modify: `src/components/MachineShoppingList.tsx` (pass the action into `<PowerBalanceBlock>`)
- Test: `src/store/factory-store.test.ts`

**Interfaces:**
- Consumes: `queryRecipeDatasetRecipes(DEFAULT_DATASET_MANIFEST_URL, version, { query: "", resource: { kind: "energy", id }, mode: "recipes", maxTier: "all", offset: 0, limit: 120 })` and `getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, recipeId)` (`@/lib/datasets/browser-loader`, 166–191 / 100–135); `DEFAULT_DATASET_MANIFEST_URL` (`@/lib/datasets`); `state.datasetManifest?.versions` + `state.selectedDatasetVersionId` (121/124); `mergeRecipe` (already used at 2494); `snapPositionToGrid` (already imported, 35); the 440px anchor pattern (2532–2536); `PowerBalanceBlock` from Task 6.
- Produces: `export function pickPowerRecipe(summaries: RecipeSummary[], tierId: string): RecipeSummary | undefined` — pure, deterministic; `addPowerForTier: (tier: MachineTier) => Promise<void>`.

**Why it queries the API instead of the loaded dataset:** the browser's `dataset` is the trimmed catalog — `recipes: []` — so "the best LV generator" must come from the same `/api/datasets/<version>/recipes` endpoint the recipe book searches (the `resolveImportedRecipe` pattern, BoardActions.tsx:793–815). The winner is by EU per second (`energyOutput.amount × 20 / durationTicks`), ties by the lexicographically smaller name — deterministic across reloads. The build is sized to the NAMEPLATE gap (the same figure the block shows in default mode; a machine at 0% utilization still needs its full grid when it does run). Placement is the anchor-with-440px pattern: recipe dedupe via `mergeRecipe`, one explicit energy edge (recipe placement creates no edges of its own), and the standard `withProjectHistory` return shape (2500–2507).

- [ ] **Step 1: Write the failing tests**

`src/store/factory-store.test.ts`. The store imports the two loader functions in Step 3, so mock them at the top of the file (if the file already has other `vi.mock` calls, keep this one consistent with them):

```ts
import { getRecipeDatasetRecipe, queryRecipeDatasetRecipes } from "@/lib/datasets/browser-loader";
import { vi } from "vitest";

vi.mock("@/lib/datasets/browser-loader", () => ({
  getRecipeDatasetRecipe: vi.fn(),
  queryRecipeDatasetRecipes: vi.fn(),
}));
```

Tests (reuse the `genRecipe`/`smelterRecipe`/`machineNode`/`seedPowerProject` helpers Task 7 added; a `RecipeSummary` literal helper for the pure test):

```ts
function powerSummary(overrides: { id: string; name: string; amount: number; durationTicks: number }): RecipeSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    recipeMap: "Generator",
    machineType: "Generator",
    minimumTier: "LV",
    durationTicks: overrides.durationTicks,
    eut: 0,
    inputs: [{ kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" }],
    outputs: [{ kind: "energy", id: "lv", amount: overrides.amount, displayName: "Energy (LV)" }],
    slots: [],
  } as unknown as RecipeSummary;
}

describe("pickPowerRecipe", () => {
  it("picks the highest EU per second", () => {
    const slow = powerSummary({ id: "slow", name: "Slow", amount: 2048, durationTicks: 80 }); // 512/s
    const fast = powerSummary({ id: "fast", name: "Fast", amount: 2048, durationTicks: 20 }); // 2048/s
    expect(pickPowerRecipe([slow, fast], "lv")?.id).toBe("fast");
  });

  it("breaks ties by the smaller name, whatever the order", () => {
    const gamma = powerSummary({ id: "gamma", name: "Gamma", amount: 4096, durationTicks: 40 }); // 2048/s
    const alpha = powerSummary({ id: "alpha", name: "Alpha", amount: 8192, durationTicks: 80 }); // 2048/s
    expect(pickPowerRecipe([gamma, alpha], "lv")?.id).toBe("alpha");
    expect(pickPowerRecipe([alpha, gamma], "lv")?.id).toBe("alpha");
  });

  it("skips recipes that emit no energy on that grid or have no duration", () => {
    const otherGrid = powerSummary({ id: "other", name: "Other", amount: 4096, durationTicks: 20 });
    otherGrid.outputs[0] = { kind: "energy", id: "mv", amount: 4096, displayName: "Energy (MV)" };
    const instant = powerSummary({ id: "instant", name: "Instant", amount: 4096, durationTicks: 0 });
    const good = powerSummary({ id: "good", name: "Good", amount: 2048, durationTicks: 20 });
    expect(pickPowerRecipe([otherGrid, instant, good], "lv")?.id).toBe("good");
  });
});

describe("addPowerForTier", () => {
  beforeEach(() => {
    vi.mocked(queryRecipeDatasetRecipes).mockReset();
    vi.mocked(getRecipeDatasetRecipe).mockReset();
  });

  it("places the best generator, sized to the nameplate gap, wired to the biggest draw", async () => {
    const generator: Recipe = {
      ...genRecipe,
      id: "gas-st-lv",
      name: "Gas Turbine",
      minimumTier: "LV",
      durationTicks: 10,
      machineHandlers: [{ id: "lv", label: "LV Gas Turbine", machineType: "Gas Turbine", minimumTier: "LV", kind: "single" }],
      outputs: [{ kind: "energy", id: "lv", amount: 12800, displayName: "Energy (LV)" }],
    } as unknown as Recipe;
    vi.mocked(queryRecipeDatasetRecipes).mockResolvedValue({
      recipes: [
        powerSummary({ id: "gas-st-lv", name: "Gas Turbine", amount: 12800, durationTicks: 10 }),
        powerSummary({ id: "solar-lv", name: "Solar", amount: 2048, durationTicks: 20 }),
      ],
      total: 2,
      recipeMaps: ["Generator"],
      offset: 0,
      limit: 120,
      hasMore: false,
    });
    vi.mocked(getRecipeDatasetRecipe).mockResolvedValue(generator);

    // A SMELTER-ONLY board: the nameplate gap is 10 EU/t x 20 = 200 EU/s and
    // nothing covers it. (seedPowerProject carries the 12800 EU/s generator,
    // so its grid is already covered — the OTHER no-op, asserted in the
    // "already covered" test below.) The store's initial datasetManifest is
    // undefined (factory-store.ts:542), so the action would no-op at the
    // version check before the deficit is read: seed one version too.
    const seed: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-add",
      name: "Add power",
      recipes: [smelterRecipe(10, "LV")],
      nodes: [machineNode("M", "smelt")],
      edges: [],
    };
    useFactoryStore.setState({
      project: seed,
      lastResult: calculateThroughput(seed),
      ...testDataset(),
    });
    await useFactoryStore.getState().addPowerForTier("LV");

    const project = useFactoryStore.getState().project;
    expect(project.nodes).toHaveLength(2);
    const placed = project.nodes.find((node) => node.recipeId === "gas-st-lv");
    expect(placed).toBeDefined();
    expect(placed!.machineCount).toBe(1); // ceil(200 / 25600 per machine)
    expect(placed!.overclockTier).toBe("LV");
    const edge = project.edges.find((entry) => entry.resourceKind === "energy");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe(placed!.id);
    expect(edge!.target).toBe("M");
    // The new card is the selection, and the solve ran on the new project.
    expect(useFactoryStore.getState().selectedNodeId).toBe(placed!.id);
    expect(useFactoryStore.getState().lastResult.nodes[placed!.id]).toBeDefined();
  });

  it("does nothing when the grid is already covered", async () => {
    vi.mocked(queryRecipeDatasetRecipes).mockResolvedValue({
      recipes: [powerSummary({ id: "gas-st-lv", name: "Gas Turbine", amount: 12800, durationTicks: 10 })],
      total: 1,
      recipeMaps: ["Generator"],
      offset: 0,
      limit: 120,
      hasMore: false,
    });
    vi.mocked(getRecipeDatasetRecipe).mockResolvedValue(genRecipe);

    // A generator already on the board: supply covers the 200/s draw. The
    // testDataset spread is what carries this PAST the version check, so the
    // no-op asserted here is the deficit check, not the missing-manifest one.
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "covered",
      name: "Covered",
      recipes: [genRecipe, smelterRecipe(10, "LV")],
      nodes: [machineNode("G", "gen"), machineNode("M", "smelt")],
      edges: [],
    };
    useFactoryStore.setState({ project, lastResult: calculateThroughput(project), ...testDataset() });

    await useFactoryStore.getState().addPowerForTier("LV");
    expect(useFactoryStore.getState().project.nodes).toHaveLength(2);
    expect(queryRecipeDatasetRecipes).not.toHaveBeenCalled();
  });

  it("does nothing when the dataset is not loaded", async () => {
    seedPowerProject("LV");
    useFactoryStore.setState({ datasetManifest: undefined });
    await useFactoryStore.getState().addPowerForTier("LV");
    expect(useFactoryStore.getState().project.nodes).toHaveLength(2);
    expect(queryRecipeDatasetRecipes).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them, verify they fail**

Run: `npx vitest run src/store/factory-store.test.ts -t "addPowerForTier"`
Expected: FAIL — `pickPowerRecipe` / `addPowerForTier` are not (yet) exported.

- [ ] **Step 3: Implement**

`src/store/factory-store.ts`:

1. Imports (top of file):

```ts
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { getRecipeDatasetRecipe, queryRecipeDatasetRecipes } from "@/lib/datasets/browser-loader";
import type { RecipeSummary } from "@/lib/datasets";
```

2. The pure picker (module scope, near the other exported helpers):

```ts
/**
 * The best generator for a grid, by EU per second, ties by the smaller name:
 * deterministic across reloads, which a "place the first hit" is not.
 */
export function pickPowerRecipe(
  summaries: RecipeSummary[],
  tierId: string,
): RecipeSummary | undefined {
  let best: { summary: RecipeSummary; rate: number } | undefined;
  for (const summary of summaries) {
    const energy = summary.outputs.find(
      (output) => output.kind === "energy" && output.id === tierId,
    );
    if (!energy || summary.durationTicks <= 0) {
      continue;
    }
    const rate = (energy.amount * 20) / summary.durationTicks;
    if (!best || rate > best.rate || (rate === best.rate && summary.name < best.summary.name)) {
      best = { summary, rate };
    }
  }
  return best?.summary;
}
```

3. The interface entry, after `connectNodesBatch` (409–420):

```ts
  /**
   * Close a grid's power gap with one machine: the best generator the dataset
   * offers for that tier, sized to the nameplate deficit, wired to the
   * node with the largest draw on that grid. No-op when the dataset is not
   * loaded, no generator exists for the tier, or the grid is already covered.
   */
  addPowerForTier: (tier: MachineTier) => Promise<void>;
```

4. The implementation, after `connectNodesBatch` (2112):

```ts
  addPowerForTier: async (tier) => {
    const state = get();
    const version = state.datasetManifest?.versions.find(
      (entry) => entry.id === state.selectedDatasetVersionId,
    );
    if (!version) {
      return;
    }

    const tierId = tier.toLowerCase();
    const key = `energy:${tierId}`;

    // The nameplate gap the power block shows: a machine at 0% still needs
    // its full grid when it does run, so the build is sized to the books,
    // not to today's utilization.
    let deficit = 0;
    for (const node of Object.values(state.lastResult.nodes)) {
      if (node.status === "missing-recipe") {
        continue;
      }
      deficit += (node.inputs[key]?.amountPerSecond ?? 0) - (node.outputs[key]?.amountPerSecond ?? 0);
    }
    if (deficit <= 0) {
      return;
    }

    const candidates = await queryRecipeDatasetRecipes(DEFAULT_DATASET_MANIFEST_URL, version, {
      query: "",
      resource: { kind: "energy", id: tierId },
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 120,
    });
    const winner = pickPowerRecipe(candidates.recipes, tierId);
    if (!winner) {
      return;
    }

    const recipe = await getRecipeDatasetRecipe(DEFAULT_DATASET_MANIFEST_URL, version, winner.id);
    const energyOutput = recipe.outputs.find((output) => output.kind === "energy");
    const perMachinePerSecond =
      energyOutput && recipe.durationTicks > 0
        ? (energyOutput.amount * 20) / recipe.durationTicks
        : 0;
    if (perMachinePerSecond <= 0) {
      return;
    }

    // The wire lands on the node drinking hardest from this grid.
    let anchor: FactoryNode | undefined;
    let anchorDraw = 0;
    for (const node of state.project.nodes) {
      const draw = state.lastResult.nodes[node.id]?.inputs[key]?.amountPerSecond ?? 0;
      if (draw > anchorDraw) {
        anchor = node;
        anchorDraw = draw;
      }
    }
    if (!anchor) {
      return;
    }

    const node: FactoryNode = {
      id: createId("node"),
      recipeId: recipe.id,
      machineCount: Math.max(1, Math.ceil(deficit / perMachinePerSecond)),
      parallel: 1,
      overclockTier: recipe.minimumTier,
      enabled: true,
      position: snapPositionToGrid({ x: anchor.position.x - 440, y: anchor.position.y }),
      pocketId: state.activePocketId,
    };

    const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
    const edge: FactoryEdge = {
      id: createId("edge"),
      source: node.id,
      target: anchor.id,
      sourceHandle: makeResourceHandleId("output", { kind: "energy", id: tierId }),
      targetHandle: makeResourceHandleId("input", { kind: "energy", id: tierId }),
      resourceKind: "energy",
      resourceId: tierId,
      label: energyOutput?.displayName ?? `Energy (${tier})`,
    };
    const project = touchProject({
      ...state.project,
      recipes: recipeAlreadyInProject
        ? state.project.recipes.map((entry) => (entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry))
        : [...state.project.recipes, recipe],
      nodes: [...state.project.nodes, node],
      edges: [...state.project.edges, edge],
    });

    set(
      withProjectHistory(state, {
        project,
        selectedNodeId: node.id,
        selectedRecipeId: recipe.id,
        placedBoardIds: [node.id],
        placedBoardToken: state.placedBoardToken + 1,
        lastResult: calculateThroughput(project),
      }),
    );
  },
```

Type note: if `FactoryNode.overclockTier` is the wider `string` union, `recipe.minimumTier` assigns without a cast; if it is exactly `MachineTier` and `Recipe.minimumTier` is `string`, the cast is `recipe.minimumTier as MachineTier`. The typecheck in Step 4 says which.

- [ ] **Step 4: Wire the button**

`src/components/MachineShoppingList.tsx` — the Task 6 mount becomes:

```tsx
      <PowerBalanceBlock onAddPower={(tier) => void useFactoryStore.getState().addPowerForTier(tier)} />
```

`useFactoryStore` is already imported there (line 22). The `void` marks the promise intentionally fire-and-forget: the block has no spinner, and a failed fetch (dataset down) is a no-op the player can retry by clicking again.

- [ ] **Step 5: Run the tests, then the full gate**

Run: `npx vitest run src/store/factory-store.test.ts` then `npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/store/factory-store.ts src/components/MachineShoppingList.tsx
git commit -m "Add power: the best generator for the grid, sized to the gap, wired to the biggest draw"
```

---

### Task 9: Verify, write the changelog, ship to develop

**Files:**
- Modify: `src/lib/changelog.ts:74–85` (rewrite the top entry)
- (No other source changes — this task proves the feature end to end.)

**Interfaces:**
- Consumes: everything from Tasks 1–8; the stress workflow documented in `ARCHITECTURE.md` (Playwright + CDP profiler).
- Produces: a pushed `develop` branch the dataset pipeline (plan 1, Task 7) will build on, and a player-facing changelog entry.

**Why the version number stays put:** `https://gtnhplanner.com/api/version` reports 2.17.0 while `version.ts` says 2.17.1 — the 2.17.1 entry has NOT shipped, so per AGENTS.md the new work folds into the top entry and the number does not move. The deploy step (a later user request) will bump to 2.18.0 after re-checking `/api/version`.

- [ ] **Step 1: Full gate**

Run: `npm run typecheck && npm run test`
Expected: green (871 passed | 1 expected fail is the baseline; the new tests add to the pass count). If any test outside this feature broke, fix it before continuing — do not carry a red baseline into the screenshot pass.

- [ ] **Step 2: Browser pass (Playwright)**

Run the app (`npm run dev` or the project's standard dev command) and drive it with the Playwright MCP tools:

1. **A generator lands and feeds a machine.** Open the recipe book, search "Gas Turbine" (the dataset is still generator-free until plan 1 publishes, so use a SYNTHETIC plan for the board visuals — see step 2). Screenshot the board: the machine's energy row shows the bolt, the EU/t rate, and the NO-SUPPLY badge while unwired.
2. **Synthetic generator plan, old dataset.** Load a plan whose JSON carries a generator recipe with an `energy` output and a machine, via the app's plan import (the app must not crash on the new kind against a dataset that has no energy resources — Task 1's "graceful absence" constraint): the node renders, its energy output row shows the bolt, and the recipe book still works. Screenshot.
3. **The power list.** With the plan loaded, open the side panel: the Grids row shows the deficit; expand it (screenshot); on a covered grid, "supplied".
4. **Add power** (only once the dataset with generators is live — after plan 1 Task 7; if it is not live yet, verify the button is present and the no-op path does not crash, and record that the live check is deferred to the dataset step).
5. **Reload round-trip.** Reload the page; the energy wire survives (Task 7's normalize test, now in the browser).

Save screenshots next to `docs/superpowers/plans/` (e.g. `2026-08-18-generators-app/screenshots/`) and name them by step.

- [ ] **Step 3: CDP stress before/after**

Per `ARCHITECTURE.md`'s stress workflow: run the profiler pass on a large plan (the repo's standard stress plan) on this branch and against its parent (`git stash` the branch tip or use the last develop commit before Task 1), and compare. The feature's per-frame surface is the energy row on each card (one extra RailPort) and the power block (one component) — expect no change in routing solve time (routes are viewport-independent and the grid router is untouched) and a small, bounded render cost. If the before/after shows a regression beyond the extra rows, fix it before shipping; record both numbers in the commit body.

- [ ] **Step 4: Rewrite the top changelog entry**

`src/lib/changelog.ts:74–85` becomes (headline + exactly four one-sentence notes; the four old side-panel notes fold into the last one; the version stays 2.17.1 until the deploy step):

```ts
  {
    version: "2.17.1",
    date: "2026-08-19",
    headline: "Generators",
    notes: [
      "Power is a real resource on the board: every machine shows the grid it draws from, and you can wire it in.",
      "Add a generator with one click: the power list shows what each grid needs and what it gets, with a button to close the gap.",
      "The fuel estimate is gone — your plan's power comes from real GTNH generators, from gas and steam turbines to fission, fusion, solar and RTG.",
      "The resource and power lists lost their stray scroll bars, and power lines lost their hover popups.",
    ],
  },
```

- [ ] **Step 5: Commit and push develop**

```bash
git add -A src docs/superpowers/plans
git status   # the usual exclusions: never .waylog/, the platline-v4-1.* files, tools/import-export-public.mjs
git commit -m "Generators: power is a resource on the board, with a one-click generator for any grid

Stress: <before> vs <after> (from step 3). Changelog 2.17.1 rewritten
for the release; the version number moves at deploy."
git push origin develop
```

Push `develop` only — `main` is production and ships on a later, explicit request (which is also when the 2.17.1 → 2.18.0 bump happens, after re-checking `https://gtnhplanner.com/api/version`).

---

## Self-Review Notes

- **Spec coverage:** energy kind (T1) · fuel removal (T2) · solver billing + stall + close-boundaries (T3) · steam-misfire gate (T4) · card rows + EU/s + bolt (T5) · power list block (T6) · edge validation + reload survival (T7) · one-click generator (T8) · verification + changelog + push (T9). The dataset half (17 machine families, oracle, pipeline run, published-dataset checks) lives in `2026-08-18-generators-dataset-pipeline.md` and runs BEFORE step 4 of Task 9 makes sense live.
- **Type consistency:** `energyResourceForTier`/`energyTierForId` (T1) are the only energy constructors; T3/5/6/7/8 all consume them or the raw `energy:<tier>` key. `pickPowerRecipe(summaries, tierId)` and `addPowerForTier(tier: MachineTier)` are named identically at declaration and call. `PowerBalanceBlock`'s `onAddPower` is declared in T6 and only passed in T8.
- **Ordering:** T2 removes `fuelProfiles` from `FactoryProject`; T3's tests must therefore be written on the post-T2 type (the plan says so in T3's fixture note). T7's toggle test depends on T7's own canonicalize gate — both land in the same commit, so the test and the gate ship together.

