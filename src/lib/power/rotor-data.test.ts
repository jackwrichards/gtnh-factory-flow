import { describe, expect, it } from "vitest";
import { findRotor, powerPlannerData, rotorDurability } from "./planner-data";

const f32 = Math.fround;
const SIZE_DAMAGE = [0, 2.5, 5, 7.5];

/**
 * TurbineStatCalculator's loose columns in Java float, from the tool quality and
 * the rotor's own tight flows: base efficiency is 0.5F + (0.5F + damage + quality)
 * x 0.1F, loose efficiency rounds base x 85 on the float product, loose flows scale
 * the tight flow by 1.1 / 1.05 / 1.03 to the power (base - 0.8) x 20.
 */
function javaLoose(quality: number, size: number) {
  const base = f32(0.5 + f32(f32(0.5 + f32(SIZE_DAMAGE[size] + quality)) * f32(0.1)));
  const loose = f32(f32(-0.2) + Math.round(f32(base * 85)) * 0.01);
  const exponent = f32(f32(base - f32(0.8)) * 20);
  return {
    base,
    steamEfficiency: f32(loose * f32(0.9)),
    gasEfficiency: f32(loose * f32(0.95)),
    plasmaEfficiency: loose,
    steamFlow: (tight: number) => f32(f32(3 * tight) * f32(Math.pow(f32(1.1), exponent))),
    gasFlow: (tight: number) => f32(f32(2 * tight) * f32(Math.pow(f32(1.05), exponent))),
    plasmaFlow: (tight: number) => f32(f32(2 * tight) * f32(Math.pow(f32(1.03), exponent))),
  };
}

describe("rotor catalog follows the pack's Java", () => {
  it("every rotor's loose columns and overflow tier match TurbineStatCalculator", () => {
    for (const rotor of powerPlannerData.rotors) {
      const quality = Math.round((rotor.steam.efficiencyTight[0]! - 0.55) / 0.1);
      expect(rotor.overflowTier, rotor.name).toBe(1 + Math.min(2, Math.trunc(quality / 3)));
      for (let size = 0; size < 4; size++) {
        const tight = rotor.steam.efficiencyTight[size]!;
        expect(tight, rotor.name).toBeCloseTo(0.5 + (0.5 + SIZE_DAMAGE[size] + quality) * 0.1, 9);
        const java = javaLoose(quality, size);
        const label = `${rotor.name} size ${size}`;
        expect(rotor.steam.efficiencyLoose[size], label).toBe(java.steamEfficiency);
        expect(rotor.gas.efficiencyLoose[size], label).toBe(java.gasEfficiency);
        expect(rotor.plasma.efficiencyLoose[size], label).toBe(java.plasmaEfficiency);
        expect(rotor.steam.optimalLoose[size], label).toBe(java.steamFlow(rotor.steam.optimalTight[size]!));
        expect(rotor.gas.optimalLoose[size], label).toBe(java.gasFlow(rotor.gas.optimalTight[size]!));
        expect(rotor.plasma.optimalLoose[size], label).toBe(java.plasmaFlow(rotor.plasma.optimalTight[size]!));
        expect(rotor.plasma.euAtOptimalTight?.[size], label).toBe(f32(rotor.plasma.optimalTight[size]! * java.base));
      }
    }
  });

  it("loose efficiency at a float tie rounds down like the game (81%, not 81.9%)", () => {
    // Base 1.3 is 1.2999999523 in float, so Math.round(base * 85) is 110.
    expect(Math.round(findRotor("Manyullyn").steam.efficiencyLoose[1]! * 1000)).toBe(810);
    expect(Math.round(findRotor("Nickel-Zinc Ferrite").plasma.efficiencyLoose[3]! * 1000)).toBe(900);
    // Base 2.1 likewise: 1.58, not 1.59.
    expect(Math.round(findRotor("HSS-S").plasma.efficiencyLoose[3]! * 1000)).toBe(1580);
  });

  it("High Durability Compound Steel uses its Werkstoff stats", () => {
    // WerkstoffLoader.HDCS: durability 291, speed 49.99, quality 13.
    const rotor = findRotor("High Durability Compound Steel");
    expect(rotor.durability).toBe(29_100);
    expect(rotorDurability(rotor, 3)).toBe(116_400);
    expect(rotor.overflowTier).toBe(3);
    expect(rotor.steam.optimalTight).toEqual([2499.54541015625, 4999.0908203125, 7498.63671875, 9998.181640625]);
    expect(rotor.plasma.optimalTight[0]).toBe(104980.90625);
  });

  it("Atomic Separation Catalyst uses Orundum's mass of 196", () => {
    // GGMaterial.atomicSeparationCatalyst: durability 2590, speed 33.4, quality 10.
    const rotor = findRotor("Atomic Separation Catalyst");
    expect(rotor.durability).toBe(259_000);
    expect(rotor.overflowTier).toBe(3);
    expect(rotor.gas.optimalTight).toEqual([1670.0001220703125, 3340.000244140625, 5010, 6680.00048828125]);
  });

  it("Universium has tool quality 30", () => {
    // MaterialsInit.loadUniversium: setTool(10_485_760, 30, 1.0f).
    const rotor = findRotor("Universium");
    rotor.steam.efficiencyTight.forEach((value, size) => expect(value).toBeCloseTo([3.55, 3.8, 4.05, 4.3][size], 9));
    expect(rotor.steam.optimalTight).toEqual([50, 100, 150, 200]);
    expect(rotor.durability).toBe(1_048_576_000);
  });
});
