import { describe, expect, it } from "vitest";
import { getPowerSource } from "../registry";
import { buildPowerSettingsReader } from "../types";

/**
 * Golden values follow the pack's GT5U Java (tag 5.09.54.20): MTELargeTurbine*,
 * MTEXLTurbine* and MTEMultiBlockBase.doRandomMaintenanceDamage.
 */
function compute(sourceId: string, settings: Record<string, string>) {
  const source = getPowerSource(sourceId);
  if (!source) {
    throw new Error(`No power source ${sourceId}`);
  }
  return source.compute(buildPowerSettingsReader(source, settings));
}

function statValue(model: ReturnType<typeof compute>, label: string) {
  return model.stats.find((line) => line.label === label)?.value;
}

describe("turbine formulas", () => {
  it("gives a rotor too weak for its gas one rotor's optimal EU/t at 1 L/t, XL included", () => {
    // Stainless Steel Large: 1,050 L/t x 145% = 1,522 EU/t, under one litre of nitrobenzene.
    const rotor = { rotor: "Stainless Steel", size: "Large", fuel: "Nitrobenzene" };
    const xl = compute("xl-turbo-gas-turbine", rotor);
    expect(xl.euPerTick).toBe(1_522);
    expect(xl.inputs[0]).toMatchObject({ name: "Nitrobenzene", perSecond: 20 });
    expect(xl.warnings?.[0]).toMatch(/1 L\/t for one rotor's 1,522 EU\/t/);
    // The check reads the tight stats, so the fitting changes nothing.
    const loose = compute("xl-turbo-gas-turbine", { ...rotor, fitting: "loose" });
    expect(loose.euPerTick).toBe(1_522);
    expect(loose.inputs[0].perSecond).toBe(20);
    const large = compute("large-gas-turbine", rotor);
    expect(large.euPerTick).toBe(1_522);
    expect(large.inputs[0].perSecond).toBe(20);
  });

  it("makes nothing when the Large gas optimum truncates to 0 L/t", () => {
    // Carbon Large: 150 EU/t / 160 EU/L truncates to 0 L/t, while 150 x 125% clears the weak-rotor check.
    const model = compute("large-gas-turbine", {
      rotor: "Carbon",
      size: "Large",
      fuel: "Refinery Gas",
    });
    expect(model.euPerTick).toBe(0);
    expect(model.inputs[0].perSecond).toBe(0);
    expect(model.warnings?.[0]).toMatch(/0 L\/t/);
  });

  it("truncates the XL plasma optimum and keeps the Large plasma's ceil", () => {
    const rotor = { rotor: "Naquadah Alloy", size: "Huge", fuel: "Americium Plasma" };
    // 16 x 67,200 x 20 / 501,760 = 42.9 L/s: the XL takes 42.
    const xl = compute("xl-turbo-plasma-turbine", rotor);
    expect(xl.inputs[0].perSecond).toBe(42);
    expect(xl.euPerTick).toBe(1_896_652);
    expect(statValue(xl, "Optimal flow")).toBe("42 L/s");
    // 2.68 L/s on the Large rounds up to 3.
    const large = compute("large-plasma-generator", rotor);
    expect(large.inputs[0].perSecond).toBe(3);
    // Under 1 L/s the XL takes nothing.
    const none = compute("xl-turbo-plasma-turbine", {
      rotor: "Carbon",
      size: "Small",
      fuel: "Celestial Tungsten Plasma",
    });
    expect(none.euPerTick).toBe(0);
    expect(none.outputs).toEqual([]);
  });

  it("feeds dense steam in whole litres and scores them against the unrounded optimum", () => {
    const rotor = { rotor: "Duranium", size: "Large", grade: "Dense SC Steam" };
    // 16 x 76,800 = 1,228,800 L/t of steam, 1,228.8 dense litres.
    const best = compute("xl-turbo-sc-steam-turbine", rotor);
    expect(best.inputs[0].perSecond).toBe(1_229 * 20);
    expect(best.euPerTick).toBe(2_641_920);
    expect(best.outputs[0]).toMatchObject({ name: "Dense SH Steam", perSecond: 1_229 * 20 });
    const short = compute("xl-turbo-sc-steam-turbine", {
      ...rotor,
      flowMode: "custom",
      customFlow: "1228",
    });
    expect(short.euPerTick).toBe(2_638_480);
    // HSS-E Small: 25.6 dense litres, fed 26.
    const small = compute("xl-turbo-sc-steam-turbine", { ...rotor, rotor: "HSS-E", size: "Small" });
    expect(small.inputs[0].perSecond).toBe(26 * 20);
    expect(small.euPerTick).toBe(31_991);
  });

  it("does not run rotors under 100% base efficiency in the Large SC turbine", () => {
    const weak = compute("large-sc-steam-turbine", { rotor: "Carbon", size: "Small" });
    expect(weak.euPerTick).toBe(0);
    expect(weak.inputs[0].perSecond).toBe(0);
    expect(weak.warnings?.[0]).toMatch(/under 100%/);
    // Exactly 100% runs.
    const even = compute("large-sc-steam-turbine", { rotor: "Carbon", size: "Normal" });
    expect(even.euPerTick).toBe(100);
  });

  it("wears rotors at the Java's damage rolls", () => {
    // One roll per 1002 ticks landing half the time, per rotor on the XL.
    const lifespan = (id: string, settings: Record<string, string>) =>
      statValue(compute(id, settings), "Rotor lifespan");
    const hssE = { rotor: "HSS-E", size: "Huge" };
    expect(lifespan("large-plasma-generator", { ...hssE, fuel: "Helium Plasma" })).toBe("41.43h");
    expect(lifespan("xl-turbo-steam-turbine", { ...hssE, grade: "Steam" })).toBe("295h");
    // MTEXLTurbineGas skips 1 roll in 4 in either fitting.
    expect(lifespan("xl-turbo-gas-turbine", { ...hssE, fuel: "Nitrobenzene" })).toBe("260h");
    // SC: 2 per roll tight, a coin flip of 0 or 1 loose.
    const scRotor = { rotor: "MAR-Ce-M200 Steel", size: "Large" };
    expect(lifespan("large-sc-steam-turbine", scRotor)).toBe("1677h");
    expect(lifespan("large-sc-steam-turbine", { ...scRotor, fitting: "loose" })).toBe("2155h");
    // Steam: a loose rotor skips 1 roll in 4.
    const steamRotor = { rotor: "Shadow Metal", size: "Small" };
    expect(lifespan("large-steam-turbine", steamRotor)).toBe("430h");
    expect(lifespan("large-steam-turbine", { ...steamRotor, fitting: "loose" })).toBe("345h");
  });

  it("clamps XL output at the int limit", () => {
    const model = compute("xl-turbo-hp-steam-turbine", {
      rotor: "Shirabon",
      size: "Huge",
      grade: "SH Steam",
      fitting: "loose",
    });
    expect(model.euPerTick).toBe(2_147_483_640);
  });
});
