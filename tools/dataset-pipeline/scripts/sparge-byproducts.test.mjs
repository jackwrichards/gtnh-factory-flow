import { describe, expect, it } from "vitest";
import { spargeExpectedLitres } from "./sparge-byproducts.mjs";

describe("spargeExpectedLitres (MTESpargeTower.randomizeByproducts)", () => {
  it("averages each helium byproduct near 100.5 L and hands back the rest", () => {
    // RecipeLoaderLFTR: 1,000 L helium, five noble gases, 200 L cap each.
    const { byproducts, gasReturned } = spargeExpectedLitres(1000, 200, 5);
    for (const value of byproducts.slice(0, 4)) {
      expect(value).toBeCloseTo(100.5, 9);
    }
    // Four maximal rolls (1 in 200^4) shrink the fifth cap to 199: well under a nanolitre.
    expect(byproducts[4]).toBe(100.5);
    expect(gasReturned + byproducts.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 9);
  });

  it("keeps the TB recipe's real shrink: 1-20 L five times out of 100 L of fluorine", () => {
    // Four rolls of 20 (1 in 20^4) leave the fifth only 1..19 L.
    const { byproducts, gasReturned } = spargeExpectedLitres(100, 20, 5);
    expect(byproducts[4]).toBe(10.499996875);
    expect(gasReturned).toBe(47.500003125);
  });

  it("prices the shrinking cap exactly when the gas runs short", () => {
    // 12 L of gas, cap 5, three rolls: the third can be squeezed down to 1 L.
    let expected = 0;
    for (let a = 1; a <= 5; a += 1) {
      for (let b = 1; b <= Math.min(5, 12 - a - 1); b += 1) {
        const pAB = (1 / 5) * (1 / Math.min(5, 12 - a - 1));
        const hi = Math.min(5, 12 - a - b - 1);
        expected += pAB * ((hi + 1) / 2);
      }
    }
    expect(spargeExpectedLitres(12, 5, 3).byproducts[2]).toBeCloseTo(expected, 12);
  });
});
