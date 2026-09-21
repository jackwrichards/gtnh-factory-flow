import { afterEach, describe, expect, it } from "vitest";
import { setActiveRateUnit } from "@/lib/model/rate-unit";
import { formatPoolRate, formatPoolRateBare, formatPoolSignedRate } from "./worksheet-format";

afterEach(() => setActiveRateUnit("second"));

describe("Pool rate display", () => {
  it("distinguishes tiny nonzero rates from zero without long decimals", () => {
    setActiveRateUnit("second");
    expect(formatPoolRateBare(0)).toBe("0");
    expect(formatPoolRateBare(8.4e-9)).toBe("(<.001)");
    expect(formatPoolRateBare(-8.4e-9)).toBe("(−<.001)");
    expect(formatPoolRateBare(0.00099)).toBe("(<.001)");
    expect(formatPoolRateBare(0.001)).toBe("0.001");
    expect(formatPoolRateBare(1234)).toBe("1.23k");
    expect(formatPoolRateBare(Infinity)).toBe("unbounded");
    expect(formatPoolRateBare(1e-9, "power")).toBe("<.01");
  });
  it("applies the cutoff in the selected unit and retains flow direction", () => {
    setActiveRateUnit("tick");
    expect(formatPoolRate(0.000084, "fluid")).toBe("(<.001) L/t");
    expect(formatPoolSignedRate(0.000084, "fluid", -1)).toBe("(−<.001)");
    expect(formatPoolSignedRate(0.000084, "fluid", 1)).toBe("(+<.001)");
    setActiveRateUnit("hour");
    expect(formatPoolRateBare(0.000084, "fluid")).toBe("0.3");
  });
});

it("displays numerical residue as zero in every unit but preserves small rates", () => {
  for (const unit of ["tick", "second", "hour"] as const) {
    setActiveRateUnit(unit);
    expect(formatPoolRateBare(5.169878828456423e-26)).toBe("0");
    expect(formatPoolSignedRate(5.169878828456423e-26, "item", -1)).toBe("0");
    expect(formatPoolRateBare(1e-12)).toBe("(<.001)");
  }
});
