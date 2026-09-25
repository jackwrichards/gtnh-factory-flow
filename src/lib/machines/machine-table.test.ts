import { describe, expect, it } from "vitest";
import {
  getMachineBehaviour,
  HEAT_OVERCLOCK,
  machineTableNames,
  normalizeMachineName,
  OVERCLOCK,
  resolveCoefficient,
  resolveOverclockSpec,
} from "./machine-table";
import referenceCoefficients from "./__fixtures__/reference-coefficients.json";
import {
  buildMachineContext,
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
  getMachineStructuralParallels,
} from "@/lib/solver/machine-effects";
import {
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
} from "@/lib/model/recipe-rules";
import type { MachineConfigControl, Recipe } from "@/lib/model/types";

interface ReferenceSample {
  voltageTier: number;
  choiceValue: number;
  speed: number | string;
  power: number | string;
  parallels: number | string;
  overclocker:
    | { kind: string; maxPerfect?: number | "inf"; maxNormal?: number | "inf"; multiplier?: number }
    | string
    | null;
}

interface ReferenceEntry {
  choiceKeys: string[];
  samples: ReferenceSample[];
}

function close(a: number, b: number, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

function resource() {
  return { kind: "item" as const, id: "x", amount: 1, consumed: false };
}

function coilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    tiers: [
      // Deliberately carrying the wrong scraped effects, to prove the table wins.
      {
        key: "cupronickel",
        label: "Cupronickel",
        heat: 1801,
        durationMultiplier: 99,
        resource: resource(),
      },
      {
        key: "kanthal",
        label: "Kanthal",
        heat: 2701,
        durationMultiplier: 99,
        resource: resource(),
      },
      {
        key: "nichrome",
        label: "Nichrome",
        heat: 3601,
        durationMultiplier: 99,
        resource: resource(),
      },
      { key: "tpv", label: "TPV-Alloy", heat: 4501, durationMultiplier: 99, resource: resource() },
    ],
  };
}

function pipeControl(): MachineConfigControl {
  return {
    id: "pipeCasing",
    label: "Pipe Casing",
    minimumKey: "bronze",
    tiers: [
      { key: "bronze", label: "Bronze", parallelMultiplier: 99, resource: resource() },
      { key: "steel", label: "Steel", parallelMultiplier: 99, resource: resource() },
      { key: "titanium", label: "Titanium", parallelMultiplier: 99, resource: resource() },
    ],
  };
}

const chemPlant = {
  machineType: "Chemical Plant",
  minimumTier: "HV",
  eut: 480,
  machineConfigControls: [coilControl(), pipeControl()],
} as unknown as Recipe;

describe("curated machine table", () => {
  it("is keyed by our names and by the reference's names", () => {
    expect(getMachineBehaviour("Chemical Plant")?.overclock).toEqual(OVERCLOCK.normal());
    expect(getMachineBehaviour("ExxonMobil Chemical Plant")?.overclock).toEqual(OVERCLOCK.normal());
    expect(getMachineBehaviour("Blast Furnace")?.overclock).toBe(HEAT_OVERCLOCK);
    expect(getMachineBehaviour("Electric Blast Furnace")?.overclock).toBe(HEAT_OVERCLOCK);
    expect(getMachineBehaviour("Large Chemical Reactor")?.overclock).toEqual(OVERCLOCK.perfect());
  });

  it("overrides the effects the dataset scraped off tooltips", () => {
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // The controls above claim a 99x duration and 99 parallels. The table's
    // numbers are the ones that count: TPV coils are 200% speed, titanium pipe
    // casings are six parallels.
    expect(getMachineDurationMultiplier(chemPlant, node)).toBeCloseTo(0.5, 10);
    expect(getMachineParallelMultiplier(chemPlant, node)).toBe(6);
    expect(getMachineEutMultiplier(chemPlant, node)).toBe(1);
  });

  it("reads coil and pipe casing tiers as zero-based indices", () => {
    const bronzeCupronickel = {
      overclockTier: "IV",
      coilTier: "cupronickel",
      machineConfigTiers: { pipeCasing: "bronze" },
    };

    // Cupronickel is 50% speed, so the recipe takes twice as long.
    expect(getMachineDurationMultiplier(chemPlant, bronzeCupronickel)).toBeCloseTo(2, 10);
    expect(getMachineParallelMultiplier(chemPlant, bronzeCupronickel)).toBe(2);
  });

  it("scales voltage-driven parallels off our ULV-based tier ordinal", () => {
    // The reference counts LV as 0, we count it as 1. Zhuhai is
    // ((theirTier + 1) + 1) * 2, which is (ourTier + 1) * 2.
    const zhuhai = getMachineBehaviour("Zhuhai - Fishing Port");
    expect(
      resolveCoefficient(zhuhai?.parallels, { tier: () => 0, value: () => 0, voltageTier: 1 }, 1),
    ).toBe(4);
    expect(
      resolveCoefficient(zhuhai?.parallels, { tier: () => 0, value: () => 0, voltageTier: 8 }, 1),
    ).toBe(18);

    // Density^2 is floor((theirTier + 1) / 2) + 1 = floor(ourTier / 2) + 1.
    const density = getMachineBehaviour("Density^2");
    for (const [ordinal, expected] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
    ]) {
      expect(
        resolveCoefficient(
          density?.parallels,
          { tier: () => 0, value: () => 0, voltageTier: ordinal },
          1,
        ),
      ).toBe(expected);
    }
  });

  it("reproduces the reference's own numbers for every machine it claims", () => {
    // `reference-coefficients.json` is ShadowTheAge's machines.ts evaluated over
    // a grid of voltage tiers and choice indices. Regenerate it by dropping a
    // probe into that repo's src/ that walks `machines`, calls GetParameter for
    // speed/power/parallels and describes the overclocker, then running jest.
    //
    // Their voltageTier counts LV as 0; ours counts ULV as 0, so a sample's
    // voltageTier maps to ours by adding one.
    const reference = referenceCoefficients as Record<string, ReferenceEntry>;
    const problems: string[] = [];
    let checked = 0;

    // Machines we deliberately model differently from the reference, with the
    // reason recorded on their table entry. Most of these were re-verified
    // against the GT5-Unofficial source directly (see the entries' comments);
    // several exist because GTNH rewrote the machine after the reference was
    // written, so the reference tracks a class that is no longer craftable.
    const DIVERGES_FROM_REFERENCE = new Set([
      // Two recipe-map modes; Java charges 15% EU in distillery mode, not
      // the reference's 85%. Source boundaries covered in dangote-distillus.test.ts.
      "Dangote Distillus",
      // Java's 0.9f, ceil ticks and the custom supplier's floored parallels.
      // Covered at recipe-rate boundaries in neutron-activator.test.ts.
      "Neutron Activator",
      // Real hatch combinations and the independent source-voltage OC cap;
      // the reference only asks for raw amps. See hile.test.ts.
      "Hyper-Intensity Laser Engraver",
      "Utupu-Tanuri",
      "Zyngen",
      "Exothermic Hearth",
      "Endothermic Fridge",
      "Cryogenic Freezer",
      "Mega Oil Cracker",
      "Mega Alloy Blast Smelter",
      "Mega Distillation Tower",
      "Large Thermal Refinery",
      "Industrial Wire Factory",
      "Amazon Warehousing Depot",
      "Industrial Mixing Machine",
      "Multiblock Mixer",
      "Industrial Sledgehammer",
      "Industrial Precision Lathe",
      "Industrial Arc Furnace",
      "Industrial Coke Oven",
      "Coke Oven",
      "Hot Isostatic Pressurization Unit",
      "Spinmatron-2737",
      "Source Chamber",
      "Target Chamber",
      // The steam multiblocks were rewritten (single controller, casing-tier
      // pressure, flat 1.6 / tierMachine); the reference still models the old
      // upgrade ladder. Transcribed from MTESteamMacerator and siblings.
      "Steam Grinder",
      "Steam Squasher",
      "Steam Separator",
      "Steam Purifier",
      "Steam Presser",
      "Steam Blender",
      "Steam Fuser",
      "Steam Hearth",
    ]);

    for (const [name, entry] of Object.entries(reference)) {
      const behaviour = getMachineBehaviour(name);
      if (!behaviour || DIVERGES_FROM_REFERENCE.has(name)) {
        continue;
      }

      for (const sample of entry.samples) {
        if (
          typeof sample.speed !== "number" ||
          typeof sample.power !== "number" ||
          typeof sample.parallels !== "number"
        ) {
          continue;
        }

        const ctx = {
          tier: () => sample.choiceValue,
          value: () => sample.choiceValue,
          voltageTier: sample.voltageTier + 1,
        };
        const at = `${name} @tier${sample.voltageTier} choice${sample.choiceValue}`;

        const speed = resolveCoefficient(behaviour.speed, ctx, 1);
        const power = resolveCoefficient(behaviour.power, ctx, 1);
        const parallels = resolveCoefficient(behaviour.parallels, ctx, 1);
        const spec = resolveOverclockSpec(behaviour, ctx);

        if (!close(speed, sample.speed)) problems.push(`${at}: speed ${speed} vs ${sample.speed}`);
        if (!close(parallels, sample.parallels)) {
          problems.push(`${at}: parallels ${parallels} vs ${sample.parallels}`);
        }
        // The heat machines are the one place the two models put a number in
        // different homes: the reference folds the coil heat EU discount into
        // `power`, while we apply it in the heat path in overclock.ts, where
        // the recipe's heat requirement is known. Their `power` is therefore
        // expected to differ, and is checked by the overclock tests instead.
        if (spec !== HEAT_OVERCLOCK && !close(power, sample.power)) {
          problems.push(`${at}: power ${power} vs ${sample.power}`);
        }
        const expected = sample.overclocker;
        if (spec !== HEAT_OVERCLOCK && expected && typeof expected === "object") {
          if (expected.kind === "null") {
            // Their NullOverclocker and our zero-step rule say the same thing.
            if (spec && (spec.maxPerfect !== 0 || spec.maxNormal !== 0)) {
              problems.push(`${at}: expected no overclocks, got ${JSON.stringify(spec)}`);
            }
          } else {
            const maxPerfect = expected.maxPerfect === "inf" ? Infinity : expected.maxPerfect;
            const maxNormal = expected.maxNormal === "inf" ? Infinity : expected.maxNormal;
            if (
              spec?.maxPerfect !== maxPerfect ||
              spec?.maxNormal !== maxNormal ||
              spec?.multiplier !== expected.multiplier
            ) {
              problems.push(
                `${at}: overclock ${JSON.stringify(spec)} vs ${JSON.stringify(expected)}`,
              );
            }
          }
        }
        checked++;
      }
    }

    expect(problems.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });

  it("only claims machines with a recorded provenance", () => {
    const referenceNames = new Set(
      Object.keys(referenceCoefficients as Record<string, unknown>).map(normalizeMachineName),
    );
    // Entries transcribed straight from the GT5-Unofficial source rather than
    // the reference calculator; each one's table comment cites its class.
    const SOURCE_VERIFIED = new Set(
      [
        "Mega Blast Furnace",
        "Arc Furnace",
        "Short Circuit Heater",
        // The plain parallels-per-voltage-tier batch, from
        // gregtech.common.tileentities.machines.multi (MTEIndustrialChemicalBath
        // and siblings); the reference calculator never covered these.
        "Industrial Chemical Bath",
        "Industrial Bending Machine",
        "Industrial 3D Copying Machine",
        "Mass Solidifier",
        "L.A.T.E.X.",
        // The steam multiblocks, from MTESteamMacerator and its siblings in
        // gregtech.common.tileentities.machines.multi.steam.
        "Steam Grinder",
        "Steam Squasher",
        "Steam Separator",
        "Steam Purifier",
        "Steam Presser",
        "Steam Blender",
        "Steam Fuser",
        "Steam Hearth",
        // GT++'s Electric Auto Workbench, from MTEElectricAutoWorkbench in
        // gtPlusPlus.xmod.gregtech.common.tileentities.automation; not a
        // recipe-map machine, so the reference never covered it.
        "Auto Workbench",
        // MTEPreciseAssembler's dedicated precise mode has no speed/parallels bonus.
        "Precise Assembler",
      ].map(normalizeMachineName),
    );
    // Every entry must trace back to a reference definition or a direct source
    // transcription, under its own name or an alias - nothing is invented.
    const untraceable = machineTableNames().filter((name) => {
      const behaviour = getMachineBehaviour(name);
      const candidates = [name, ...(behaviour?.aliases ?? [])].map(normalizeMachineName);
      return !candidates.some(
        (candidate) => referenceNames.has(candidate) || SOURCE_VERIFIED.has(candidate),
      );
    });

    expect(untraceable).toEqual([]);
  });

  it("runs the steam multiblocks at 62.5% basic and 125% high pressure", () => {
    // MTESteamMacerator and siblings: duration x 1.6 / tierMachine, 8 fixed
    // parallels, no overclocking. The macerator's 300-tick recipe runs in 480
    // ticks on a bronze build and 240 on high pressure.
    // eut 0, as every steam recipe reads by the time effects run: the handler
    // zeroes EU (they burn steam), which is also what frees all 8 parallels
    // from the powered-parallel cap.
    const grinder = {
      machineType: "Steam Grinder",
      minimumTier: "ULV",
      eut: 0,
      machineConfigControls: [],
    } as unknown as Recipe;
    const bronze = { machineConfigTiers: {} };
    const highPressure = { machineConfigTiers: { steamPressure: "high" } };

    expect(getMachineDurationMultiplier(grinder, bronze)).toBeCloseTo(1.6, 10);
    expect(getMachineDurationMultiplier(grinder, highPressure)).toBeCloseTo(0.8, 10);
    expect(getMachineParallelMultiplier(grinder, bronze)).toBe(8);
    const spec = resolveOverclockSpec(getMachineBehaviour("Steam Grinder"), {
      tier: () => 0,
      value: () => 0,
      voltageTier: 1,
    });
    expect(spec).toEqual(OVERCLOCK.none());

    // The Steam Hearth's map is vanilla smelting: the machine runs GT's fixed
    // 128-tick furnace recipe while the dataset's base is the 200-tick vanilla
    // smelt, so its multiplier lands the shown duration on the game's own 204
    // ticks basic and 102 high pressure.
    const hearth = { ...grinder, machineType: "Steam Hearth" } as Recipe;
    expect(200 * getMachineDurationMultiplier(hearth, bronze)).toBeCloseTo(204.8, 10);
    expect(200 * getMachineDurationMultiplier(hearth, highPressure)).toBeCloseTo(102.4, 10);
  });

  it("gives the Naquadah Fuel Refinery field restriction coils, not heating coils", () => {
    // MTENaquadahFuelRefinery: 4 parallels per coil tier, one perfect
    // overclock per coil tier above the recipe's minimum (its special value),
    // no voltage overclocking. The dataset scraped the tooltip's "Coil Tier"
    // as the heating coil ladder; that knob must be replaced, not shown.
    const nfr = {
      machineType: "Naquadah Fuel Refinery",
      minimumTier: "UHV",
      eut: 0,
      nei: { additionalInfo: ["Special value: 2"] },
      machineConfigControls: [coilControl()],
    } as unknown as Recipe;

    // The scraped heating coil is hidden and the real coils take its place,
    // offered from the recipe's own minimum tier upward.
    const controls = getRecipeMachineConfigTierControls(nfr, { machineConfigTiers: {} });
    expect(controls.map((control) => control.id)).toEqual(["fieldRestrictionCoil"]);
    expect(getRecipeCoilTierControl(nfr, {})).toBeUndefined();
    expect(controls[0].tiers.map((tier) => tier.key)).toEqual(["t2", "t3", "t4"]);
    expect(controls[0].current.key).toBe("t2");

    // Parallels count the coil's position on the FULL ladder even though the
    // recipe's minimum hides the rungs below it: T2 default is 8, T4 is 16.
    expect(getMachineParallelMultiplier(nfr, { machineConfigTiers: {} })).toBe(8);
    expect(
      getMachineParallelMultiplier(nfr, { machineConfigTiers: { fieldRestrictionCoil: "t4" } }),
    ).toBe(16);

    // T4 coils on a T2-minimum recipe are two perfect overclocks; at the
    // minimum there are none, and extra voltage alone buys nothing.
    const behaviour = getMachineBehaviour("Naquadah Fuel Refinery");
    expect(
      resolveOverclockSpec(
        behaviour,
        buildMachineContext(nfr, { machineConfigTiers: { fieldRestrictionCoil: "t4" } }),
      ),
    ).toEqual(OVERCLOCK.perfect(2));
    expect(
      resolveOverclockSpec(behaviour, buildMachineContext(nfr, { machineConfigTiers: {} })),
    ).toEqual(OVERCLOCK.perfect(0));
  });

  it("leaves machines it does not cover on the dataset's own values", () => {
    expect(getMachineBehaviour("Some Machine We Have Not Verified")).toBeUndefined();

    const unlisted = { ...chemPlant, machineType: "Some Machine We Have Not Verified" } as Recipe;
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // Falls back to the scraped 99s rather than silently reading as 1.
    expect(getMachineDurationMultiplier(unlisted, node)).toBe(99);
    expect(getMachineParallelMultiplier(unlisted, node)).toBe(17);
  });
});

describe("pipe casings", () => {
  // The dataset's scraped knob: the fluid pipe ladder with two rungs no
  // machine takes, handed to every machine whose tooltip says "Pipe Casing".
  const SCRAPED_KEYS = ["bronze", "steel", "titanium", "tungstensteel", "ptfe", "pbi"];
  function scrapedPipeControl(): MachineConfigControl {
    return {
      id: "pipeCasing",
      label: "Pipe Casing",
      minimumKey: "bronze",
      defaultKey: "bronze",
      tiers: SCRAPED_KEYS.map((key) => ({
        key,
        label: key,
        parallelMultiplier: 99,
        resource: resource(),
      })),
    };
  }
  const recipeFor = (machineType: string) =>
    ({
      machineType,
      minimumTier: "LV",
      eut: 16,
      machineConfigControls: [scrapedPipeControl()],
    }) as unknown as Recipe;
  const controlIds = (recipe: Recipe, tiers: Record<string, string> = {}) =>
    getRecipeMachineConfigTierControls(recipe, { machineConfigTiers: tiers }).map(
      (control) => control.id,
    );

  it("gives the lathe item pipe casings, tin to black plutonium (MTEMultiLathe)", () => {
    const lathe = recipeFor("Industrial Precision Lathe");
    const [control, ...rest] = getRecipeMachineConfigTierControls(lathe, {});

    expect(rest).toEqual([]);
    expect(control.id).toBe("itemPipeCasing");
    expect(control.tiers.map((tier) => tier.label)).toEqual([
      "Tin",
      "Brass",
      "Electrum",
      "Platinum",
      "Osmium",
      "Quantium",
      "Fluxed Electrum",
      "Black Plutonium",
    ]);
    expect(control.tiers[0].resource.id).toBe("gregtech:gt.blockcasings11");
    expect(control.tiers[7].resource.id).toBe("gregtech:gt.blockcasings11@7");
    expect(control.tiers[7].resource.displayName).toBe("Black Plutonium Item Pipe Casing");

    // getMaxParallelRecipes: pipeTier * 8, tin = 1.
    const parallels = (key: string) =>
      getMachineStructuralParallels(lathe, { machineConfigTiers: { itemPipeCasing: key } });
    expect(parallels("tin")).toBe(8);
    expect(parallels("black-plutonium")).toBe(64);
  });

  it("carries a lathe saved on the old knob to the item pipe with the same parallels", () => {
    const lathe = recipeFor("Industrial Precision Lathe");
    SCRAPED_KEYS.forEach((key, position) => {
      const node = { machineConfigTiers: { pipeCasing: key } };
      expect(getMachineStructuralParallels(lathe, node)).toBe((position + 1) * 8);
    });
    expect(
      getRecipeMachineConfigTierControls(lathe, { machineConfigTiers: { pipeCasing: "pbi" } })[0]
        .current.key,
    ).toBe("quantium");

    // A pick made on the real knob wins over whatever the old one says.
    expect(
      getMachineStructuralParallels(lathe, {
        machineConfigTiers: { pipeCasing: "pbi", itemPipeCasing: "tin" },
      }),
    ).toBe(8);
  });

  it("never offers PTFE or PBI pipe casings, which no structure accepts", () => {
    for (const machine of ["Chemical Plant", "Industrial Autoclave"]) {
      const control = getRecipeMachineConfigTierControls(recipeFor(machine), {}).find(
        (entry) => entry.id === "pipeCasing",
      );
      expect(control?.tiers.map((tier) => tier.key)).toEqual([
        "bronze",
        "steel",
        "titanium",
        "tungstensteel",
      ]);
      expect(control?.tiers[3].resource.id).toBe("gregtech:gt.blockcasings2@15");
    }

    // A plan saved on either keeps the best real casing, tungstensteel.
    const chemPlantRecipe = recipeFor("Chemical Plant");
    for (const key of ["ptfe", "pbi"]) {
      expect(
        getMachineStructuralParallels(chemPlantRecipe, { machineConfigTiers: { pipeCasing: key } }),
      ).toBe(8);
      expect(
        getMachineEutMultiplier(recipeFor("Industrial Autoclave"), {
          machineConfigTiers: { pipeCasing: key },
        }),
      ).toBeCloseTo(8 / 12, 10);
    }
  });

  it("hides the scraped pipe knob on machines that have no fluid pipes", () => {
    for (const machine of [
      "Dissection Apparatus",
      "Industrial Wire Factory",
      "Amazon Warehousing Depot",
      "Industrial Mixing Machine",
    ]) {
      expect(controlIds(recipeFor(machine))).toEqual(["itemPipeCasing"]);
    }
    expect(controlIds(recipeFor("Steam Blender"))).toEqual(["steamPressure"]);
    expect(controlIds(recipeFor("Industrial Autoclave"))).toEqual([
      "pipeCasing",
      "itemPipeCasing",
    ]);
  });
});
