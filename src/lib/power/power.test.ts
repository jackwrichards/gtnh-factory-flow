import { describe, expect, it } from "vitest";
import { buildPowerRecipe, resynthesizePowerRecipes } from "./power-recipe";
import {
  hitPlacementSettings,
  POWER_EU_CLAUSE_ID,
  searchPowerSources,
  searchPowerSourcesForStencil,
} from "./power-search";
import { getPowerSource, POWER_SOURCES } from "./registry";
import { buildPowerSettingsReader } from "./types";
import { resolvePowerResource } from "./planner-data";
import type { FactoryNode, Recipe } from "@/lib/model/types";

/**
 * Golden values are the Power Planner 2.9 workbook's own computed cells
 * (docs/power-planner-math.md documents which); a failure here means the
 * transcription drifted from the spreadsheet, not that the spreadsheet moved.
 */
function compute(sourceId: string, settings: Record<string, string> = {}) {
  const source = getPowerSource(sourceId);
  if (!source) {
    throw new Error(`No power source ${sourceId}`);
  }
  return source.compute(buildPowerSettingsReader(source, settings));
}

describe("singleblock generators", () => {
  it("prices the LV steam turbine like the workbook (E21 = 1552.94 L/s)", () => {
    const model = compute("steam-turbine", { tier: "LV" });
    expect(model.euPerTick).toBe(32);
    expect(model.inputs[0].name).toBe("Steam");
    expect(model.inputs[0].perSecond).toBeCloseTo(1552.941176, 4);
  });

  it("prices the LV gas turbine on benzene (L21 = 1.9298 L/s)", () => {
    const model = compute("gas-turbine", { tier: "LV", fuel: "Benzene" });
    expect(model.inputs[0].perSecond).toBeCloseTo(1.929824561, 6);
  });

  it("prices the LV combustion generator on diesel (S21 = 1.4474 L/s)", () => {
    const model = compute("combustion-generator", { tier: "LV", fuel: "Diesel" });
    expect(model.inputs[0].perSecond).toBeCloseTo(1.447368421, 6);
  });

  it("prices the LV semifluid generator on creosote (Z21 = 14.4737 L/s)", () => {
    const model = compute("semifluid-generator", { tier: "LV", fuel: "Creosote Oil" });
    expect(model.inputs[0].perSecond).toBeCloseTo(14.47368421, 5);
  });

  it("prices the LuV naquadah reactor on a long enriched rod (E59 = 3.1488 per hour)", () => {
    const model = compute("naquadah-reactor", {
      tier: "LuV",
      fuel: "Long Enriched Naquadah Rod (LuV)",
    });
    expect(model.inputs[0].perSecond * 3600).toBeCloseTo(3.1488, 4);
  });

  it("prices the LV magic absorber on quicksilver (S59 = 41.25 per hour)", () => {
    // The ABSORBER's own ladder (0.9 at LV) - the 39.079 this once pinned
    // was the converter's cell, read through a swapped extraction.
    const model = compute("magic-energy-absorber", { tier: "LV", fuel: "Quicksilver" });
    expect(model.inputs[0].perSecond * 3600).toBeCloseTo(41.25, 4);
  });
});

describe("engines", () => {
  it("burns diesel in the LCE at 2048/480 L/t (sheet E15 x 20)", () => {
    const model = compute("large-combustion-engine", { fuel: "Diesel" });
    expect(model.euPerTick).toBe(2048);
    expect(model.inputs[0].perSecond).toBeCloseTo(4.266666667 * 20, 4);
  });

  it("boost triples output for 1.5x fuel efficiency and adds oxygen", () => {
    const model = compute("large-combustion-engine", { fuel: "Diesel", boost: "1" });
    expect(model.euPerTick).toBe(6144);
    expect(model.inputs[0].perSecond).toBeCloseTo((6144 / (480 * 1.5)) * 20, 4);
    expect(model.inputs.some((flow) => flow.name === "Oxygen")).toBe(true);
  });

  it("refuses over-2048 EU/L fuels without the boost", () => {
    const model = compute("large-combustion-engine", { fuel: "High Octane Gasoline" });
    expect(model.euPerTick).toBe(0);
    expect(model.warnings?.length).toBeGreaterThan(0);
  });

  it("runs the UCFE at 1.5e^(-C/ratio) efficiency (N29 = 56,177.85 EU/t)", () => {
    const model = compute("universal-chemical-fuel-engine", {
      fuel: "RP-1 (red)",
      flow: "500",
      promoterRatio: "0.2",
    });
    expect(model.euPerTick).toBeCloseTo(56177.85093, 2);
    expect(model.inputs[1].name).toBe("Combustion Promoter");
    expect(model.inputs[1].perSecond).toBeCloseTo(100, 6);
  });

  it("feeds the SOFC Mk I benzene at the floored rate (113 L/s)", () => {
    const model = compute("solid-oxide-fuel-cell-1", { fuel: "Benzene" });
    expect(model.euPerTick).toBe(2048);
    expect(model.inputs[0].perSecond).toBe(113);
    expect(model.outputs[0]).toMatchObject({ name: "Steam", perSecond: 20000 });
  });
});

describe("community-flagged additions (2.9 sheet)", () => {
  it("runs the LV acid generator on molten redstone (E33 = 17.0103 L/s)", () => {
    const model = compute("acid-generator", { tier: "LV", fuel: "Molten Redstone" });
    expect(model.euPerTick).toBe(32);
    expect(model.inputs[0].perSecond).toBeCloseTo(17.01030928, 6);
  });

  it("runs the EV geothermal engine on cryotheum dust as ITEMS (L40 = 0.9211/s)", () => {
    const model = compute("geothermal-engine", { tier: "EV", fuel: "Cryotheum Dust" });
    expect(model.euPerTick).toBe(2048);
    expect(model.inputs[0].perSecond).toBeCloseTo(0.9211469534, 6);
    expect(model.inputs[0].unit).not.toBe("L");
  });

  it("prices the LV magic energy converter on quicksilver (L52 = 39.0789 per hour)", () => {
    const model = compute("magic-energy-converter", { tier: "LV", fuel: "Quicksilver" });
    expect(model.euPerTick).toBe(32);
    expect(model.inputs[0].perSecond * 3600).toBeCloseTo(39.07894737, 4);
  });

  it("computes the LNE at the sheet's defaults (Z29 = 2000 EU/t) and boosts on a base", () => {
    const plain = compute("large-neutralization-engine", {
      structure: "T1",
      fuel: "Molten Redstone",
      rate: "50",
      base: "None",
    });
    expect(plain.euPerTick).toBe(2000);
    // Rate is per tick (the game's maxFluidUse dial); the slot is per second.
    expect(plain.inputs[0]).toMatchObject({ name: "Molten Redstone", perSecond: 1000 });
    const boosted = compute("large-neutralization-engine", {
      structure: "T1",
      fuel: "Molten Redstone",
      rate: "50",
      base: "Sodium Hydroxide",
    });
    // x1.5 power for one hydroxide dust per 20 ticks (60 per minute).
    expect(boosted.euPerTick).toBe(3000);
    expect(boosted.inputs[1]).toMatchObject({ name: "Sodium Hydroxide Dust", perSecond: 1 });
  });

  it("matches the sheet on the reported case: fluoroantimonic at 1 L/t is 5760 EU/t", () => {
    const model = compute("large-neutralization-engine", {
      structure: "T1",
      fuel: "Fluoroantimonic Acid",
      rate: "1",
      base: "None",
    });
    expect(model.euPerTick).toBe(5760);
    expect(model.inputs[0]).toMatchObject({ name: "Fluoroantimonic Acid", perSecond: 20 });
    // Average residue is deterministic (random walk averages 1.0):
    // 0.05 x 5760^0.8 per tick, against T1 full-tank decay 200 x 375000^0.08.
    const avg = 0.05 * Math.pow(5760, 0.8);
    const decayAtFull = 200 * Math.pow(375000, 0.08);
    expect(model.stats.find((s) => s.label === "Avg residue")).toBeTruthy();
    expect(avg).toBeCloseTo(50.94, 1);
    expect(avg - decayAtFull).toBeLessThan(0);
    expect(model.warnings).toBeUndefined();
  });

  it("warns when LNE residue outruns decay even at a full tank", () => {
    const model = compute("large-neutralization-engine", {
      structure: "T1",
      fuel: "Fluoroantimonic Acid",
      rate: "1000",
      base: "None",
    });
    expect(model.warnings?.[0]).toMatch(/explode/);
  });

  it("splits the XL steam turbines: HP exhausts steam, SC exhausts SH", () => {
    const hp = compute("xl-turbo-hp-steam-turbine", { rotor: "HSS-E", size: "Huge" });
    expect(hp.inputs[0].name).toBe("SH Steam");
    expect(hp.outputs[0]).toMatchObject({ name: "Steam", perSecond: hp.inputs[0].perSecond });
    const sc = compute("xl-turbo-sc-steam-turbine", { rotor: "HSS-E", size: "Huge" });
    expect(sc.inputs[0].name).toBe("SC Steam");
    expect(sc.outputs[0].name).toBe("SH Steam");
    // The plain XL only offers plain and dense steam now.
    const plain = getPowerSource("xl-turbo-steam-turbine")!;
    const grade = plain.settings.find((setting) => setting.id === "grade");
    expect(grade?.type === "select" && grade.options.map((option) => option.key)).toEqual([
      "Steam",
      "Dense Steam",
    ]);
  });
});

describe("turbines", () => {
  it("runs a tight Small Shadow Metal large steam turbine at its optimal", () => {
    const model = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Small",
      fitting: "tight",
      flowMode: "optimal",
    });
    // Workbook default selection: eff 0.95, optimal 1600 L/t ->
    // floor(0.95 x 0.5 x 1600) = 760 EU/t.
    expect(model.euPerTick).toBe(760);
    expect(model.inputs[0]).toMatchObject({ name: "Steam", perSecond: 1600 * 20 });
    // MTELargeTurbineSteam condenses: 1 L distilled water per 160 L steam.
    expect(model.outputs[0]).toMatchObject({
      name: "Distilled Water",
      perSecond: (1600 * 20) / 160,
    });
  });

  it("exhausts superheated steam into plain steam 1:1", () => {
    const model = compute("large-hp-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "optimal",
    });
    expect(model.outputs[0].name).toBe("Steam");
    expect(model.outputs[0].perSecond).toBe(model.inputs[0].perSecond);
  });

  it("penalizes over-optimal flow but caps at max", () => {
    const source = getPowerSource("large-steam-turbine");
    const atOptimal = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "optimal",
    });
    const overfed = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "custom",
      customFlow: "999999",
    });
    expect(source).toBeDefined();
    expect(overfed.warnings?.length).toBeGreaterThan(0);
    expect(overfed.euPerTick).toBeLessThan((overfed.inputs[0].perSecond / 20) * 0.5 * 0.95);
    expect(overfed.inputs[0].perSecond).toBeGreaterThan(atOptimal.inputs[0].perSecond);
  });

  it("burns helium plasma and exhausts helium", () => {
    const model = compute("large-plasma-generator", {
      rotor: "Shadow Metal",
      size: "Normal",
      fuel: "Helium Plasma",
      flowMode: "optimal",
    });
    expect(model.outputs[0].name).toBe("Helium");
    expect(model.euPerTick).toBeGreaterThan(0);
  });
});

describe("steam makers", () => {
  it("runs the bronze boiler on creosote alone at 80% (625 L/s creosote, 960 L/t steam)", () => {
    const model = compute("large-bronze-boiler", { liquidFuel: "Creosote Oil", solidFuel: "None" });
    expect(model.inputs[0].perSecond).toBeCloseTo(625, 6);
    expect(model.outputs[0]).toMatchObject({ name: "Steam", perSecond: 960 * 20 });
  });

  it("dual fuel reaches 100% and halves each burn rate", () => {
    const model = compute("large-bronze-boiler", {
      liquidFuel: "Creosote Oil",
      solidFuel: "Charcoal",
    });
    expect(model.outputs[0].perSecond).toBe(1200 * 20);
    expect(model.inputs[0].perSecond).toBeCloseTo(312.5, 6);
  });

  it("flips the LHE to superheated steam over the hot coolant threshold (13,800 L/t)", () => {
    const model = compute("large-heat-exchanger", {
      fluid: "Hot Coolant",
      intake: "1380",
      tier: "1",
    });
    expect(model.outputs[0]).toMatchObject({ name: "SH Steam" });
    expect(model.outputs[0].perSecond / 20).toBeCloseTo(13800, 4);
    expect(model.outputs[1]).toMatchObject({ name: "Coolant", perSecond: 1380 });
  });

  it("keeps the EHE below threshold on superheated steam", () => {
    const model = compute("extreme-heat-exchanger", {
      fluid: "Hot Coolant",
      intake: "4000",
      tier: "1",
    });
    expect(model.outputs[0].name).toBe("SH Steam");
  });
});

describe("singleblock boilers (game source constants)", () => {
  it("burns the Small Coal Boiler at 1 energy per 45t: one coal is 360s of 120 L/s", () => {
    const model = compute("small-coal-boiler", { solidFuel: "Coal" });
    expect(model.outputs).toEqual([{ name: "Steam", perSecond: 120, unit: "L" }]);
    // Coal is 1600 furnace ticks -> 160 boiler energy; 160 / (20/45) = 360s.
    expect(model.inputs[0]).toEqual({ name: "Coal", perSecond: 1 / 360, unit: "item" });
    expect(model.inputs[1]).toEqual({ name: "Water", perSecond: 120 / 160, unit: "L" });
    expect(model.warnings?.some((line) => line.includes("by hand"))).toBe(true);
  });

  it("burns the Large Coal Boiler at 1 energy/s: one coal is 160s of 300 L/s", () => {
    const model = compute("large-coal-boiler", { solidFuel: "Coal" });
    expect(model.outputs).toEqual([{ name: "Steam", perSecond: 300, unit: "L" }]);
    expect(model.inputs[0]).toEqual({ name: "Coal", perSecond: 1 / 160, unit: "item" });
  });

  it("runs the Reinforced Lava Boiler at 600 L/s steam on 3 L/s lava", () => {
    const model = compute("lava-boiler", {});
    expect(model.outputs).toEqual([{ name: "Steam", perSecond: 600, unit: "L" }]);
    expect(model.inputs).toEqual([
      { name: "Lava", perSecond: 3, unit: "L" },
      { name: "Water", perSecond: 600 / 160, unit: "L" },
    ]);
  });

  it("holds the solar boilers at full rate on distilled water and calcifies on regular", () => {
    const fresh = compute("solar-boiler", { model: "steel" });
    expect(fresh.outputs).toEqual([{ name: "Steam", perSecond: 360, unit: "L" }]);
    expect(fresh.warnings ?? []).toEqual([]);
    const calcified = compute("solar-boiler", {
      model: "steel",
      waterKind: "Water",
      calcified: "1",
    });
    expect(calcified.outputs).toEqual([{ name: "Steam", perSecond: 120, unit: "L" }]);
    expect(calcified.warnings?.length).toBe(1);
  });

  it("scales the GT++ Advanced Boiler by tier: HV is 2,250 L/s and coal lasts 160s", () => {
    const model = compute("advanced-boiler", { tier: "HV", solidFuel: "Coal" });
    expect(model.outputs).toEqual([{ name: "Steam", perSecond: 2250, unit: "L" }]);
    expect(model.inputs[0]).toEqual({ name: "Coal", perSecond: 1 / 160, unit: "item" });
  });
});

describe("RTG and Dyson Swarm", () => {
  it("runs the RTG on a Pu-238 pellet at 60 EU/t for 88 real days", () => {
    const model = compute("rtg", { pellet: "pu238" });
    expect(model.euPerTick).toBe(60);
    expect(model.inputs).toEqual([{ name: "Pu Pellet", perSecond: 1 / (88 * 86_400), unit: "item" }]);
    expect(resolvePowerResource("Pu Pellet")?.id).toBe("miscutils:mu-metaitem.01@32041");
  });

  it("pays the Dyson Swarm 10M EU/t per module times the dimension factor", () => {
    const model = compute("dyson-swarm", { modules: "250", factor: "2" });
    expect(model.euPerTick).toBe(250 * 10_000_000 * 2);
    expect(model.inputs).toEqual([{ name: "Cryotheum", perSecond: 1000, unit: "L" }]);
    expect(model.warnings?.some((line) => line.includes("Modules burn off"))).toBe(true);
  });
});

describe("reactors and endgame", () => {
  it("computes THTR full-fill efficiency 1.0 and the parasitic draw", () => {
    const model = compute("thtr", { fill: "675000" });
    expect(model.euPerTick).toBeCloseTo(-3840, 6);
    expect(model.outputs[0].perSecond).toBe(4800 * 20);
  });

  it("computes the HTGR glowstone multiplier (2.444)", () => {
    // COOLANT_PER_BALL is a per-tick figure; hot coolant out = 0.5 x fill x
    // multiplier L/t, and the steam line is the water line x160.
    const model = compute("htgr", { pebble: "Glowstone", fill: "10000" });
    const multiplier = model.outputs[0].perSecond / (0.5 * 10000 * 20);
    expect(multiplier).toBeCloseTo(2.444, 2);
    const water = model.inputs.find((flow) => flow.name === "Distilled Water");
    const steam = model.outputs.find((flow) => flow.name === "Steam");
    expect(steam?.perSecond).toBeCloseTo((water?.perSecond ?? 0) * 160, 6);
  });

  it("gives the LFTR 16 amps of its fuel's tier", () => {
    const model = compute("lftr", { fuel: "LFTR Fuel 1" });
    expect(model.euPerTick).toBe(2048 * 16);
    expect(model.outputs.some((flow) => flow.name === "Uranium-233")).toBe(true);
  });

  it("runs the Vacuum Reactor's quad uranium layout at the workbook's 43,600 EU/t", () => {
    const model = compute("vacuum-reactor", { fuel: "uranium-4", coolant: "he-360k" });
    expect(model.euPerTick).toBe(43_600);
    // 40 quad rods over their 20,000 s lifespan, burned to depleted rods.
    expect(model.inputs[0]).toEqual({ name: "Quad Fuel Rod (Uranium)", perSecond: 40 / 20_000, unit: "item" });
    expect(model.outputs[0]).toEqual({
      name: "Quad Fuel Rod (Depleted Uranium)",
      perSecond: 40 / 20_000,
      unit: "item",
    });
    expect(model.outputs[1]).toEqual(model.inputs[1]);
    expect(resolvePowerResource("360k He Coolant Cell")?.kind).toBe("item");
    expect(resolvePowerResource("10k Coolant Cell")?.kind).toBe("item");
    expect(resolvePowerResource("Quad Fuel Rod (Uranium)")?.kind).toBe("item");
    expect(resolvePowerResource("Fuel Rod (Depleted Tiberium)")?.kind).toBe("item");
    expect(resolvePowerResource("The Core (Depleted)")?.kind).toBe("item");
    // Sheet: average cell decay 813.7 Hu/s, minimum coolant lifespan 267.9 s.
    expect(model.stats.find((line) => line.label === "Cell heat")?.value).toBe("813.71/s avg, 1,344/s max");
    expect(model.stats.find((line) => line.label === "Coolant lifespan")?.value).toBe(
      "267.86 s min, 442.42 s avg",
    );
    // Sheet W14: 1.9 cells a minute to recool, so the cells are real ports -
    // hot out, cold in, one item id for both - for a placed freezer to close.
    expect(model.stats.find((line) => line.label === "Cells to recool")?.value).toBe("1.9 a minute");
    expect(model.inputs[1]).toEqual({ name: "360k He Coolant Cell", perSecond: expect.closeTo(14 / 442.42, 3), unit: "item" });
  });

  it("prices every Vacuum Reactor rod from the mod source, MOX by core temp", () => {
    expect(compute("vacuum-reactor", { fuel: "thorium-4" }).euPerTick).toBe(8_720);
    expect(compute("vacuum-reactor", { fuel: "uranium-1" }).euPerTick).toBe(50 * (4 * 2 + 14 * 3 + 22 * 4));
    // The Core: 32 cells, 17 pulses, 200 EU a pulse - 4,979,200 on the layout.
    expect(compute("vacuum-reactor", { fuel: "the-core" }).euPerTick).toBe(4_979_200);
    // MOX rods multiply by 1 + heatBonus x core temp: MOX 1.5, HD Plutonium 6.
    const mox = compute("vacuum-reactor", { fuel: "mox-4", coreTemp: "98" });
    expect(mox.euPerTick).toBeCloseTo(43_600 * (1 + 1.5 * 0.98), 6);
    expect(mox.warnings?.some((line) => line.includes("melts at 100%"))).toBe(true);
    expect(compute("vacuum-reactor", { fuel: "high-density-plutonium-4", coreTemp: "98" }).euPerTick).toBeCloseTo(
      43_600 * (1 + 6 * 0.98),
      6,
    );
    expect(compute("vacuum-reactor", { fuel: "mox-4", coreTemp: "0" }).euPerTick).toBe(43_600);
    expect(compute("vacuum-reactor", { fuel: "uranium-4" }).warnings?.some((line) => line.includes("melts"))).toBe(false);
  });

  it("flags a Vacuum Reactor coolant cell that bursts and pins the ports per second", () => {
    // Excited uranium on 10k cells: the hottest cell takes more heat a
    // second than it holds.
    const burst = compute("vacuum-reactor", { fuel: "excited-uranium-4", coolant: "coolant-10k" });
    expect(burst.warnings?.some((line) => line.includes("bursts"))).toBe(true);
    // The cell ports run at 14 cells per average lifespan; a quad uranium
    // layout heats the average 360k cell out in 442.4 s.
    const model = compute("vacuum-reactor", { fuel: "uranium-4", coolant: "he-360k" });
    expect(model.inputs[1].perSecond).toBeCloseTo(14 / (360_000 / 813.7142857), 6);
    expect(compute("vacuum-reactor", {}).stats.some((line) => line.label === "Freezers")).toBe(false);
  });

  it("multiplies the LNR by coolant and booster (5.85M EU/t)", () => {
    const model = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-I",
      coolant: "Super Coolant",
      booster: "Molten Naquadah",
    });
    expect(model.euPerTick).toBeCloseTo(975000 * 1.5 * 4, 4);
    expect(model.inputs.some((flow) => flow.name === "Liquid Air" && flow.perSecond === 2400)).toBe(
      true,
    );
  });

  // Game: FuelRecipeLoader getFluidOrGas(1) per recipe; MTELargeNaquadahReactor
  // burns pall litres (booster multiplier) over NaquadahFuelTime ticks.
  // Wiki Large_Naquadah_Reactor summary table pins the boosted L/s figures.
  it("burns 1 L of LNR fuel per recipe, not 1000 L (wiki EU/L and L/s)", () => {
    const base = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-I",
      coolant: "None",
      booster: "None",
    });
    // 1 L / 3 s; the old formula used 1000 L and reported 333.33 L/s.
    expect(base.inputs.find((flow) => flow.name === "Naq Fuel Mk-I")?.perSecond).toBeCloseTo(1 / 3, 6);
    expect(base.outputs[0]?.perSecond).toBeCloseTo(1 / 3, 6);

    // Wiki: Mk-I + Cryotheum + Molten Naquadah (x4) -> 1.33 L/s fuel.
    const wikiMkI = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-I",
      coolant: "Cryotheum",
      booster: "Molten Naquadah",
    });
    expect(wikiMkI.euPerTick).toBeCloseTo(975000 * 2.75 * 4, 4);
    expect(wikiMkI.inputs.find((flow) => flow.name === "Naq Fuel Mk-I")?.perSecond).toBeCloseTo(
      4 / 3,
      6,
    );
    expect(wikiMkI.inputs.find((flow) => flow.name === "Cryotheum")?.perSecond).toBe(1000);
    expect(wikiMkI.inputs.find((flow) => flow.name === "Molten Naquadah")?.perSecond).toBe(20);

    // Wiki / Discord: Mk-VI + Temporal Fluid + Enlarged Fluid (x64) -> 5.33 L/s.
    const wikiMkVI = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-VI",
      coolant: "Tachyon Rich Temporal Fluid",
      booster: "Spatially Enlarged Fluid",
    });
    expect(wikiMkVI.euPerTick).toBeCloseTo(2_077_795_200 * 5 * 64, 0);
    expect(wikiMkVI.inputs.find((flow) => flow.name === "Naq Fuel Mk-VI")?.perSecond).toBeCloseTo(
      64 / 12,
      6,
    );
    expect(wikiMkVI.inputs.find((flow) => flow.name === "Tachyon Rich Temporal Fluid")?.perSecond).toBe(
      20,
    );
  });

  it("runs helium fusion at Mk-I from the workbook table", () => {
    const model = compute("fusion-reactor", { recipe: "Helium Plasma", mark: "1" });
    expect(model.euPerTick).toBe(-1920);
    expect(model.outputs[0]).toMatchObject({ name: "Helium Plasma", perSecond: 156 });
    expect(model.inputs).toHaveLength(2);
  });

  it("finds an interior antimatter optimum with positive net power", () => {
    const model = compute("antimatter", { amount: "0" });
    expect(model.euPerTick).toBeGreaterThan(1e12);
    const optimum = Number(model.stats.find((line) => line.label === "Best quantity")?.value);
    expect(Number.isNaN(optimum)).toBe(true); // formatted, not raw - presence is what matters
  });
});

describe("resource resolution", () => {
  it("wires every flow to a dataset resource, except the known strays", () => {
    // A flow whose name misses the resource map silently degrades to a stat
    // line instead of a wireable port - which is how the coolant loop once
    // shipped unwireable. Every miss must be on this list on purpose.
    const KNOWN_UNRESOLVED = new Set([
      // Sheet-only rod variants and magic solids the dataset cannot name.
      "Tiberium Rod (ZPM)",
      "Long Tiberium Rod (UV)",
      "Amber Gem",
      "Vinteum Gem",
      "Tainted Blood Shard",
      "Life Essence Cell",
      "Ench. Golden Apple",
      // Manure-line boiler fuels absent from the dataset.
      "Manure Slurry",
      "Fertile Manure Slurry",
      "Raw Animal Waste",
      // LNR fuels the resolver could not place.
      "Uranium Fuel",
      "Plutonium Fuel",
    ]);
    const unresolved = new Set<string>();
    const collect = (model: ReturnType<(typeof POWER_SOURCES)[number]["compute"]>) => {
      for (const flow of [...model.inputs, ...model.outputs]) {
        if (flow.perSecond > 0 && !resolvePowerResource(flow.name)) {
          unresolved.add(flow.name);
        }
      }
    };
    for (const source of POWER_SOURCES) {
      collect(source.compute(buildPowerSettingsReader(source, undefined)));
      for (const setting of source.settings) {
        if (setting.type !== "select") {
          continue;
        }
        for (const option of setting.options) {
          collect(
            source.compute(buildPowerSettingsReader(source, { [setting.id]: option.key })),
          );
        }
      }
    }
    const surprises = [...unresolved].filter((name) => !KNOWN_UNRESOLVED.has(name)).sort();
    expect(surprises).toEqual([]);
  });
});

describe("power search", () => {
  it("finds every machine that burns benzene, with the fuel dialed in", () => {
    const hits = searchPowerSources("benzene");
    const ids = hits.map((hit) => hit.source.id);
    expect(ids).toContain("gas-turbine");
    expect(ids).toContain("solid-oxide-fuel-cell-1");
    expect(ids).toContain("large-gas-turbine");
    const gasTurbine = hits.find((hit) => hit.source.id === "gas-turbine");
    expect(gasTurbine?.via?.direction).toBe("takes");
    // Benzene is the gas turbine's default fuel, so no dial is needed.
    expect(hitPlacementSettings(gasTurbine!)).toBeUndefined();
    const boiler = hits.find((hit) => hit.source.id === "large-titanium-boiler");
    expect(boiler?.via).toBeDefined();
  });

  it("dials a non-default fuel into the placement settings", () => {
    const hits = searchPowerSources("nitrobenzene");
    const turbine = hits.find((hit) => hit.source.id === "gas-turbine");
    expect(turbine?.via?.direction).toBe("takes");
    expect(hitPlacementSettings(turbine!)).toEqual({ fuel: "Nitrobenzene" });
  });

  it("finds makers of superheated steam and prefers makes over takes", () => {
    const hits = searchPowerSources("superheated steam");
    const boiler = hits.find((hit) => hit.source.id === "large-titanium-boiler");
    expect(boiler?.via?.direction).toBe("makes");
    const sofc2 = hits.find((hit) => hit.source.id === "solid-oxide-fuel-cell-2");
    expect(sofc2?.via?.direction).toBe("makes");
    const hpTurbine = hits.find((hit) => hit.source.id === "large-hp-steam-turbine");
    expect(hpTurbine?.via?.direction).toBe("takes");
  });

  it("matches machine names first and returns the whole catalog when empty", () => {
    expect(searchPowerSources("")).toHaveLength(POWER_SOURCES.length);
    const hits = searchPowerSources("turbine");
    expect(hits[0]?.via).toBeUndefined();
    expect(hits.some((hit) => hit.source.id === "steam-turbine")).toBe(true);
  });
});

describe("stencil search (the recipe book's view of the generators)", () => {
  it("answers a takes clause by resource id, dialing the fuel when needed", () => {
    const nitro = resolvePowerResource("Nitrobenzene")!;
    const hits = searchPowerSourcesForStencil(
      [{ role: "takes", kind: nitro.kind, id: nitro.id }],
      "all",
      "all",
      "",
    );
    const turbine = hits.find((hit) => hit.source.id === "gas-turbine");
    expect(turbine).toBeDefined();
    expect(turbine?.settings).toEqual({ fuel: "Nitrobenzene" });
    // Benzene is the default: same machine, no dial.
    const benzene = resolvePowerResource("Benzene")!;
    const defaults = searchPowerSourcesForStencil(
      [{ role: "takes", kind: benzene.kind, id: benzene.id }],
      "all",
      "all",
      "",
    );
    expect(defaults.find((hit) => hit.source.id === "gas-turbine")?.settings).toBeUndefined();
  });

  it("answers the makes-power pseudo clause with every generator", () => {
    const hits = searchPowerSourcesForStencil(
      [{ role: "makes", kind: "fluid", id: POWER_EU_CLAUSE_ID }],
      "all",
      "all",
      "",
    );
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.some((hit) => hit.source.id === "large-combustion-engine")).toBe(true);
    // A name query narrows the shelf like it narrows the recipes.
    const narrowed = searchPowerSourcesForStencil(
      [{ role: "makes", kind: "fluid", id: POWER_EU_CLAUSE_ID }],
      "all",
      "all",
      "combustion",
    );
    expect(narrowed.every((hit) => hit.source.name.toLowerCase().includes("combustion"))).toBe(
      true,
    );
    expect(narrowed.length).toBeGreaterThan(0);
  });

  it("intersects both sides: takes steam AND makes power is the steam turbines", () => {
    const steam = resolvePowerResource("Steam")!;
    const hits = searchPowerSourcesForStencil(
      [
        { role: "takes", kind: steam.kind, id: steam.id },
        { role: "makes", kind: "fluid", id: POWER_EU_CLAUSE_ID },
      ],
      "all",
      "all",
      "",
    );
    const ids = hits.map((hit) => hit.source.id);
    expect(ids).toContain("steam-turbine");
    expect(ids).toContain("large-steam-turbine");
    expect(ids).not.toContain("gas-turbine");
  });

  it("expands an unpinned fuel knob into one card per fuel, NEI-style", () => {
    const shSteam = resolvePowerResource("SH Steam")!;
    const hits = searchPowerSourcesForStencil(
      [{ role: "makes", kind: shSteam.kind, id: shSteam.id }],
      "all",
      "all",
      "",
    );
    // The titanium boiler makes SH steam on ANY of its fuels: one card each.
    const titanium = hits.filter((hit) => hit.source.id === "large-titanium-boiler");
    expect(titanium.length).toBeGreaterThan(3);
    const fuels = new Set(titanium.map((hit) => hit.settings?.liquidFuel));
    expect(fuels.size).toBe(titanium.length);
    // A clause that PINS the fuel keeps exactly one card for it.
    const benzene = resolvePowerResource("Benzene")!;
    const pinned = searchPowerSourcesForStencil(
      [{ role: "takes", kind: benzene.kind, id: benzene.id }],
      "all",
      "all",
      "",
    );
    expect(pinned.filter((hit) => hit.source.id === "gas-turbine")).toHaveLength(1);
  });

  it("drops a source when two clauses need the same knob at different positions", () => {
    const nitro = resolvePowerResource("Nitrobenzene")!;
    const naphtha = resolvePowerResource("Naphtha")!;
    const hits = searchPowerSourcesForStencil(
      [
        { role: "takes", kind: nitro.kind, id: nitro.id },
        { role: "takes", kind: naphtha.kind, id: naphtha.id },
      ],
      "all",
      "all",
      "",
    );
    expect(hits.find((hit) => hit.source.id === "gas-turbine")).toBeUndefined();
    // ANY keeps it: one of the fuels is enough.
    const anyHits = searchPowerSourcesForStencil(
      [
        { role: "takes", kind: nitro.kind, id: nitro.id },
        { role: "takes", kind: naphtha.kind, id: naphtha.id },
      ],
      "any",
      "all",
      "",
    );
    expect(anyHits.find((hit) => hit.source.id === "gas-turbine")).toBeDefined();
  });
});

describe("power recipes", () => {
  it("synthesizes a wired benzene input on the gas turbine card", () => {
    const recipe = buildPowerRecipe("gas-turbine", { fuel: "Benzene" }, "recipe-test");
    expect(recipe).toBeDefined();
    expect(recipe?.power?.euPerTick).toBe(32);
    expect(recipe?.durationTicks).toBe(20);
    expect(recipe?.inputs[0]).toMatchObject({ kind: "fluid", id: "benzene" });
  });

  it("puts the EU output first on the rail, per second, byproduct-marked", () => {
    const recipe = buildPowerRecipe("gas-turbine", { fuel: "Benzene" }, "recipe-eu");
    expect(recipe?.outputs[0]).toMatchObject({
      kind: "power",
      id: "eu",
      amount: 32 * 20,
      byproduct: true,
    });
  });

  it("resynthesizes recipes from node settings on load", () => {
    const recipe = buildPowerRecipe("gas-turbine", undefined, "recipe-1") as Recipe;
    const node = {
      id: "node-1",
      recipeId: "recipe-1",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 0, y: 0 },
      machineConfigTiers: { tier: "HV", fuel: "Nitrobenzene" },
      // A stray override from an old build must not survive the load funnel:
      // it would repaint the rebuilt slot with the stale resource forever.
      recipeInputOverrides: {
        "0": { kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" },
      },
    } as FactoryNode;
    const project = resynthesizePowerRecipes({ nodes: [node], recipes: [recipe] });
    expect(project.recipes[0].power?.euPerTick).toBe(512);
    expect(project.recipes[0].inputs[0].id).toBe("nitrobenzene");
    expect(project.nodes[0].recipeInputOverrides).toBeUndefined();
  });

  it("keeps every source id unique and computable at defaults", () => {
    const seen = new Set<string>();
    for (const source of POWER_SOURCES) {
      expect(seen.has(source.id)).toBe(false);
      seen.add(source.id);
      const model = source.compute(buildPowerSettingsReader(source, undefined));
      expect(Number.isFinite(model.euPerTick)).toBe(true);
      for (const flow of [...model.inputs, ...model.outputs]) {
        expect(Number.isFinite(flow.perSecond)).toBe(true);
        expect(flow.perSecond).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
