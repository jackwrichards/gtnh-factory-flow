import { afterEach, describe, expect, it } from "vitest";
import { setActiveRateUnit } from "@/lib/model/rate-unit";
import { formatPoolRate, formatPoolRateBare, formatPoolSignedRate } from "./worksheet-format";

afterEach(() => setActiveRateUnit("second"));

describe("Pool rate display", () => {
  it("distinguishes tiny nonzero rates from zero without long decimals", () => {
    setActiveRateUnit("second");
    expect(formatPoolRateBare(0)).toBe("0");
    expect(formatPoolRateBare(8.4e-9)).toBe("<.00001");
    expect(formatPoolRateBare(-8.4e-9)).toBe(">-.00001");
    expect(formatPoolRateBare(0.00001)).toBe("0.00001");
    expect(formatPoolRateBare(1234)).toBe("1.23k");
    expect(formatPoolRateBare(Infinity)).toBe("unbounded");
    expect(formatPoolRateBare(1e-9, "power")).toBe("<.01");
  });
  it("applies the cutoff in the selected unit and retains flow direction", () => {
    setActiveRateUnit("tick");
    expect(formatPoolRate(0.000084, "fluid")).toBe("<.00001 L/t");
    expect(formatPoolSignedRate(0.000084, "fluid", -1)).toBe("−<.00001");
    expect(formatPoolSignedRate(0.000084, "fluid", 1)).toBe("+<.00001");
    setActiveRateUnit("hour");
    expect(formatPoolRateBare(0.000084, "fluid")).toBe("0.3");
  });
});
