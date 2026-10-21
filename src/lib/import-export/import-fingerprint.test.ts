import { describe, expect, it } from "vitest";
import { createEmptyProject, loadBiodieselDemoProject } from "@/examples";
import { planFingerprints } from "./import-fingerprint";
import type { FactoryNode, Recipe } from "../model/types";
import { getOverclockedRecipeStats } from "../solver/overclock";

function recipeFixture(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

function nodeFixture(recipeId: string, overrides: Partial<FactoryNode> = {}): FactoryNode {
  return {
    id: "card",
    recipeId,
    machineCount: 1,
    parallel: 1,
    enabled: true,
    overclockTier: "LV",
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("two plan fingerprints", () => {
  // These hashes pin saved-plan compatibility while the canonicalization is optimized.
  it.each([
    {
      mode: "plan",
      planMode: true,
      solveMode: true,
      poolMode: false,
      simple: "b88743ff9f2ede8f1086297b6677811b826f93e51946912b32894b68766ca121",
      full: "3b0f265d973eea6a7f3bbf2d4987248ddfc675bc4ff10f3cebb54b4e90da32da",
    },
    {
      mode: "build",
      planMode: false,
      solveMode: false,
      poolMode: false,
      simple: "b88743ff9f2ede8f1086297b6677811b826f93e51946912b32894b68766ca121",
      full: "cdf83cc7b75d0169aff825a40f1b7c4b020be2a83c9adcd1f8dd69ba888461cd",
    },
    {
      mode: "solve",
      planMode: false,
      solveMode: true,
      poolMode: false,
      simple: "b88743ff9f2ede8f1086297b6677811b826f93e51946912b32894b68766ca121",
      full: "104fb73f74619c1d6d24057164c48336847dcec5da8a48aae625de96b852a069",
    },
    {
      mode: "pool",
      planMode: false,
      solveMode: true,
      poolMode: true,
      simple: "54bcf200b5a4a454aa7662a0cb6c0bd80bcb0f5ae9e041ceca506905bdd62cd1",
      full: "f110d6aa7891a50f27dd6207129fbd29c28159123ed156ebca011c27cf306776",
    },
  ])(
    "retains version 6 hashes when opening $mode plans",
    async ({ mode, simple, full, ...flags }) => {
      void mode;
      expect(await planFingerprints({ ...loadBiodieselDemoProject(), ...flags })).toEqual({
        version: 6,
        simple,
        full,
      });
    },
  );

  it("includes the effective heat requirement read from NEI by the solver", async () => {
    const recipe = recipeFixture({
      id: "heat",
      name: "Heat recipe",
      machineType: "Zyngen",
      durationTicks: 400,
      eut: 16,
      nei: { additionalInfo: ["Special value: 0"] },
      machineConfigControls: [
        {
          id: "heatingCoil",
          label: "Coil",
          minimumKey: "cupronickel",
          tiers: [
            {
              key: "cupronickel",
              label: "Cupronickel",
              heat: 1801,
              resource: { kind: "item", id: "coil", amount: 1 },
            },
          ],
        },
      ],
    });
    const node = nodeFixture(recipe.id, {
      overclockTier: "MV",
      coilTier: "cupronickel",
    });
    const hotter = { ...recipe, nei: { additionalInfo: ["Special value: 3000"] } };
    expect(getOverclockedRecipeStats(recipe, node).durationTicks).not.toBe(
      getOverclockedRecipeStats(hotter, node).durationTicks,
    );
    const project = { ...createEmptyProject(), nodes: [node], recipes: [recipe] };
    const original = await planFingerprints(project);
    const changed = await planFingerprints({ ...project, recipes: [hotter] });
    expect(changed.simple).toBe(original.simple);
    expect(changed.full).not.toBe(original.full);
    expect(
      await planFingerprints({
        ...project,
        recipes: [
          { ...recipe, nei: { additionalInfo: ["A refreshed tooltip", "Special value: 0"] } },
        ],
      }),
    ).toEqual(original);
  });

  it.each(["primary", "extra"])(
    "ignores %s override presentation but keeps functional choices",
    async (section) => {
      const base = loadBiodieselDemoProject();
      const overrides = {
        "0": {
          kind: "item" as const,
          id: "minecraft:iron_ingot",
          amount: 1,
          displayName: "Old",
          iconPath: "old.png",
          alternatives: [
            {
              kind: "item" as const,
              id: "minecraft:gold_ingot",
              displayName: "Old alternative",
              iconPath: "old-alt.png",
            },
          ],
        },
      };
      const project = {
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            ...(section === "primary"
              ? { recipeInputOverrides: overrides }
              : {
                  extraRecipes: [{ recipeId: base.recipes[0].id, recipeInputOverrides: overrides }],
                }),
          },
        ],
      };
      const refreshed = structuredClone(project);
      const input =
        section === "primary"
          ? refreshed.nodes[0].recipeInputOverrides!["0"]
          : refreshed.nodes[0].extraRecipes![0].recipeInputOverrides!["0"];
      input.displayName = "New";
      input.iconPath = "new.png";
      input.alternatives![0].displayName = "New alternative";
      input.alternatives![0].iconPath = "new-alt.png";
      const original = await planFingerprints(project);
      expect(await planFingerprints(refreshed)).toEqual(original);
      input.amount = 2;
      const functional = await planFingerprints(refreshed);
      expect(functional.simple).toBe(original.simple);
      expect(functional.full).not.toBe(original.full);
    },
  );

  it("distinguishes functional recipe maps while ignoring source provenance", async () => {
    const recipe = recipeFixture({
      id: "map",
      name: "Map mode",
      machineType: "Mega Distillation Tower",
      durationTicks: 200,
      eut: 30,
      source: { recipeMap: "Distillation Tower" },
    });
    const node = nodeFixture(recipe.id);
    const distillery = { ...recipe, source: { recipeMap: "Distillery" } };
    expect(getOverclockedRecipeStats(recipe, node)).toMatchObject({ durationTicks: 133, eut: 27 });
    expect(getOverclockedRecipeStats(distillery, node)).toMatchObject({
      durationTicks: 100,
      eut: 15,
    });
    const project = { ...createEmptyProject(), nodes: [node], recipes: [recipe] };
    const original = await planFingerprints(project);
    const changed = await planFingerprints({ ...project, recipes: [distillery] });
    expect(changed.simple).toBe(original.simple);
    expect(changed.full).not.toBe(original.full);
    expect(
      await planFingerprints({
        ...project,
        recipes: [
          {
            ...recipe,
            source: {
              ...recipe.source,
              datasetVersionId: "refreshed",
              rawRecipeId: "new-id",
              exporter: "unknown",
            },
          },
        ],
      }),
    ).toEqual(original);
  });
  it("recognizes functional recipe settings as related versions", async () => {
    const base = loadBiodieselDemoProject();
    const original = await planFingerprints(base);
    const recipe = base.recipes[0];
    const controls = [
      {
        id: "coil",
        label: "Coil",
        minimumKey: "basic",
        tiers: [
          {
            key: "basic",
            label: "Basic",
            durationMultiplier: 0.5,
            resource: { kind: "item" as const, id: "minecraft:iron_ingot", amount: 1 },
          },
        ],
      },
    ];
    for (const settings of [
      { minimumTier: "UHV" },
      { maximumTier: "UHV" },
      { availableTiers: ["LV", "HV"] },
      {
        machineProfile: {
          machineType: recipe.machineType,
          minimumTier: "LV",
          perfectOverclock: true,
        },
      },
      {
        machineHandlers: [
          {
            id: "custom",
            label: "Custom",
            machineType: recipe.machineType,
            minimumTier: "LV",
            maxParallel: 64,
            machineConfigControls: controls,
          },
        ],
      },
      { machineConfigControls: controls },
      { power: { sourceId: "generator", euPerTick: 100, stats: [] } },
    ]) {
      const changed = await planFingerprints({
        ...base,
        recipes: [{ ...recipe, ...settings }, ...base.recipes.slice(1)],
      });
      expect(changed.simple).toBe(original.simple);
      expect(changed.full).not.toBe(original.full);
    }
  });

  it("ignores presentation within functional recipe settings", async () => {
    const base = loadBiodieselDemoProject();
    const recipe = {
      ...base.recipes[0],
      machineProfile: { machineType: "Assembler", minimumTier: "LV", notes: "Old notes" },
      machineHandlers: [
        {
          id: "handler",
          label: "Old label",
          machineType: "Assembler",
          minimumTier: "LV",
          notes: "Old notes",
        },
      ],
      machineConfigControls: [
        {
          id: "coil",
          label: "Old label",
          minimumKey: "a",
          tiers: [
            {
              key: "a",
              label: "Old tier",
              resource: {
                kind: "item" as const,
                id: "minecraft:iron_ingot",
                amount: 1,
                displayName: "Old resource",
              },
            },
          ],
        },
      ],
      power: {
        sourceId: "generator",
        euPerTick: 100,
        stats: [{ label: "Old", value: "1" }],
        warnings: ["Old"],
      },
    };
    const refreshed = {
      ...recipe,
      machineProfile: { ...recipe.machineProfile, notes: "New" },
      machineHandlers: recipe.machineHandlers.map((handler) => ({
        ...handler,
        label: "New",
        notes: "New",
      })),
      machineConfigControls: recipe.machineConfigControls.map((control) => ({
        ...control,
        label: "New",
        tiers: control.tiers.map((tier) => ({
          ...tier,
          label: "New",
          resource: { ...tier.resource, displayName: "New" },
        })),
      })),
      power: { ...recipe.power, stats: [], warnings: [] },
    };
    expect(await planFingerprints({ ...base, recipes: [recipe] })).toEqual(
      await planFingerprints({ ...base, recipes: [refreshed] }),
    );
  });

  it("keeps full recipe settings associated with their cards", async () => {
    const base = loadBiodieselDemoProject();
    const recipe = base.recipes[0];
    const first = { ...recipe, id: "a", minimumTier: "LV" };
    const second = { ...recipe, id: "b", minimumTier: "HV" };
    const project = {
      ...base,
      edges: [],
      recipes: [first, second],
      nodes: [
        { ...base.nodes[0], id: "first", recipeId: "a" },
        { ...base.nodes[0], id: "second", recipeId: "b" },
      ],
    };
    const original = await planFingerprints(project);
    const swapped = await planFingerprints({
      ...project,
      recipes: [
        { ...first, minimumTier: "HV" },
        { ...second, minimumTier: "LV" },
      ],
    });
    expect(swapped.simple).toBe(original.simple);
    expect(swapped.full).not.toBe(original.full);
  });

  it.each(["gregtech_machine", "unknown", undefined] as const)(
    "includes functional metadata on %s recipes",
    async (kind) => {
      const recipe = recipeFixture({
        id: "functional",
        name: "Functional recipe",
        kind,
        machineType: "Fusion Reactor",
      });
      for (const [first, second] of [
        [{ fusionStartupEu: 1_000_000 }, { fusionStartupEu: 2_000_000 }],
        [{ eec: { maxHealth: 20, outputs: [] } }, { eec: { maxHealth: 40, outputs: [] } }],
        [{ beeLifespan: 20 }, { beeLifespan: 40 }],
        [{ cropsNh: { growth: 1 } }, { cropsNh: { growth: 2 } }],
      ]) {
        const base = {
          ...createEmptyProject(),
          nodes: [nodeFixture(recipe.id)],
        };
        const a = await planFingerprints({ ...base, recipes: [{ ...recipe, metadata: first }] });
        const b = await planFingerprints({ ...base, recipes: [{ ...recipe, metadata: second }] });
        expect(a.simple).not.toBe(b.simple);
        expect(a.full).not.toBe(b.full);
      }
    },
  );

  it("ignores presentation metadata while retaining functional GregTech metadata", async () => {
    const recipe = recipeFixture({
      id: "fusion",
      name: "Fusion",
      kind: "gregtech_machine",
      machineType: "Fusion Reactor",
      metadata: { fusionStartupEu: 1_000_000 },
    });
    const base = createEmptyProject();
    expect(await planFingerprints({ ...base, recipes: [recipe] })).toEqual(
      await planFingerprints({
        ...base,
        recipes: [
          {
            ...recipe,
            metadata: {
              ...recipe.metadata,
              displayName: "A refreshed label",
              iconPath: "new.png",
              neiRecipe: { label: "new" },
            },
          },
        ],
      }),
    );
  });
  it("ignores names, export ids, save stamps and display settings", async () => {
    const original = loadBiodieselDemoProject();
    const changed = {
      ...original,
      id: "new-export",
      name: "Renamed",
      metadata: { updatedAt: "later" },
      view: { rateUnit: "minute" as const },
    };
    expect(await planFingerprints(changed)).toEqual(await planFingerprints(original));
  });
  it("classifies machine counts, targets and layout changes as another version", async () => {
    const original = loadBiodieselDemoProject();
    for (const changed of [
      {
        ...original,
        nodes: original.nodes.map((node, index) =>
          index ? node : { ...node, machineCount: node.machineCount + 1 },
        ),
      },
      {
        ...original,
        nodes: original.nodes.map((node, index) =>
          index ? node : { ...node, position: { x: node.position.x + 32, y: node.position.y } },
        ),
      },
      { ...original, notes: "Another version" },
    ]) {
      const a = await planFingerprints(original),
        b = await planFingerprints(changed);
      expect(b.simple).toBe(a.simple);
      expect(b.full).not.toBe(a.full);
    }
  });
  it("classifies different recipes or connections as a different plan", async () => {
    const original = loadBiodieselDemoProject();
    for (const changed of [
      {
        ...original,
        recipes: original.recipes.map((recipe, index) =>
          index ? recipe : { ...recipe, eut: recipe.eut + 1 },
        ),
      },
      { ...original, edges: [] },
    ])
      expect((await planFingerprints(changed)).simple).not.toBe(
        (await planFingerprints(original)).simple,
      );
  });
  it("survives recipe id refresh, presentation data and GregTech runtime table refresh", async () => {
    const original = loadBiodieselDemoProject();
    const changed = {
      ...original,
      nodes: original.nodes.map((node) => ({ ...node, recipeId: "dataset:" + node.recipeId })),
      recipes: original.recipes.map((recipe) => ({
        ...recipe,
        id: "dataset:" + recipe.id,
        name: "A refreshed label",
        runtimeCalculation: {
          sourceKind: "gregtech-overclock-calculator" as const,
          status: "computed" as const,
          oracleEligible: true,
          variants: [],
        },
      })),
    };
    expect(await planFingerprints(changed)).toEqual(await planFingerprints(original));
  });
  it("is deterministic when keyed entity arrays are reordered", async () => {
    const original = loadBiodieselDemoProject();
    expect(
      await planFingerprints({
        ...original,
        nodes: [...original.nodes].reverse(),
        recipes: [...original.recipes].reverse(),
        edges: [...original.edges].reverse(),
      }),
    ).toEqual(await planFingerprints(original));
    expect((await planFingerprints(createEmptyProject())).full).toMatch(/^[a-f0-9]{64}$/);
  });
});
