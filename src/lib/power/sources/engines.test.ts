import { describe, expect, it } from "vitest";
import { powerPlannerData } from "../planner-data";
import { getPowerSource } from "../registry";
import { buildPowerSettingsReader } from "../types";

/**
 * Golden values are the pack's Java (GT5U 5.09.54.20), ported independently
 * of this code; where the workbook differs, the Java wins.
 */
function compute(sourceId: string, settings: Record<string, string> = {}) {
  const source = getPowerSource(sourceId);
  if (!source) {
    throw new Error(`No power source ${sourceId}`);
  }
  return source.compute(buildPowerSettingsReader(source, settings));
}

function input(model: ReturnType<typeof compute>, name: string) {
  return model.inputs.find((flow) => flow.name === name)?.perSecond;
}

describe("combustion engines burn whole litres per tick", () => {
  it("floors the ECE's jet fuel A to 4 L/t", () => {
    const model = compute("extreme-combustion-engine", { fuel: "Jet Fuel A" });
    expect(model.euPerTick).toBe(10_900);
    expect(input(model, "Jet Fuel A")).toBe(80);
  });

  it("adds the weighted extra litre to boosted high octane gasoline", () => {
    // floor(4096 / 2500) = 1, plus frac(6144 / floor(2500 x 1.5)) = 0.6384.
    const model = compute("large-combustion-engine", { fuel: "High Octane Gasoline", boost: "1" });
    expect(model.euPerTick).toBe(6144);
    expect(input(model, "High Octane Gasoline")).toBeCloseTo(1.6384 * 20, 9);
  });

  it("floors the semifluid burner against 2048, and 4096 when boosted", () => {
    const plain = compute("large-semifluid-generator", { fuel: "Heavy Fuel" });
    expect(input(plain, "Heavy Fuel")).toBe(100);
    const boosted = compute("large-semifluid-generator", { fuel: "Heavy Fuel", boost: "1" });
    expect(boosted.euPerTick).toBe(6144);
    expect(input(boosted, "Heavy Fuel")).toBe(220);
    expect(input(boosted, "Oxygen")).toBe(80);
  });

  it("gates lubricant 14 times per 1002 ticks", () => {
    const model = compute("large-combustion-engine", { fuel: "Diesel", boost: "1" });
    expect(input(model, "Lubricant")).toBeCloseTo((2 * 14 * 20) / 1002, 12);
  });

  it("offers only fuels the pack registers", () => {
    const names = powerPlannerData.semifluidFuels.map((fuel) => fuel.name);
    expect(names).not.toContain("Manure Slurry");
    expect(names).not.toContain("Raw Animal Waste");
    expect(powerPlannerData.ucfeFuels.filter((fuel) => fuel.name === "Ether")).toHaveLength(1);
  });
});

describe("large rocket engine", () => {
  it("burns once per 21 ticks but spreads the energy over 20", () => {
    // Below the knee: 300 L/s burns 315 L per 21 ticks, P = 1536 x 315 / 20.
    const low = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: "300" });
    expect(low.euPerTick).toBeCloseTo(1.6384 * ((1536 * 315) / 20), 6);
    // Past it (P = 40,320): the game truncates to 59,858.
    const model = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: "500" });
    expect(Math.abs(model.euPerTick - 59_858)).toBeLessThan(5);
  });

  it("boost meters the falloff on a third of the fuel, with no step at the knee", () => {
    const boosted = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: "1500", boost: "1" });
    expect(Math.abs(boosted.euPerTick - 179_576) / 179_576).toBeLessThan(1e-4);
    const deep = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: "4000", boost: "1" });
    expect(Math.abs(deep.euPerTick - 312_921) / 312_921).toBeLessThan(1e-4);
    const knee = (90_000 * 20) / (1536 * 1.05);
    const below = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: String(knee - 0.01), boost: "1" });
    const above = compute("large-rocket-engine", { fuel: "RP-1 (red)", throttle: String(knee + 0.01), boost: "1" });
    expect(above.euPerTick).toBeGreaterThan(below.euPerTick);
  });
});

describe("large neutralization engine", () => {
  it("loses an arm on a roll of 45 x (tier + 2) per minute", () => {
    const model = compute("large-neutralization-engine", { arms: "16", armTier: "Amount (MV)" });
    expect(model.stats.find((stat) => stat.label === "Avg lifespan")?.value).toBe("8 min");
  });

  it("offers LV robot arms", () => {
    const source = getPowerSource("large-neutralization-engine")!;
    const armTier = source.settings.find((setting) => setting.id === "armTier");
    expect(armTier?.type === "select" && armTier.options[0]?.key).toBe("Amount (LV)");
    expect(armTier?.type === "select" && armTier.defaultKey).toBe("Amount (HV)");
  });

  it("burns one francium hydroxide dust per 241 ticks", () => {
    const model = compute("large-neutralization-engine", { base: "Francium Hydroxide" });
    expect(input(model, "Francium Hydroxide Dust")).toBeCloseTo(20 / 241, 12);
  });
});

describe("unlock chips follow the controller recipe", () => {
  it("puts the SOFCs at HV and LuV", () => {
    expect(getPowerSource("solid-oxide-fuel-cell-1")?.unlock).toBe("HV");
    expect(getPowerSource("solid-oxide-fuel-cell-2")?.unlock).toBe("LuV");
  });
});
