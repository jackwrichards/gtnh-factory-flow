import { afterEach, describe, expect, it } from "vitest";

import { formatSlotRate, formatSlotRateOrNull } from "@/components/flow/flow-explainers";
import { rateUnitMultiplier, rateUnitSuffix, setActiveRateUnit } from "./rate-unit";

afterEach(() => {
  setActiveRateUnit("second");
});

describe("rate units", () => {
  it("reads a tick as a twentieth of a second", () => {
    setActiveRateUnit("tick");
    expect(rateUnitMultiplier()).toBeCloseTo(0.05);
    // 2,000 L/s of nitrobenzene is the figure the game itself quotes per tick.
    expect(formatSlotRate(2000, "fluid")).toBe("100 L/t");
  });

  it("suffixes a rate per resource kind", () => {
    setActiveRateUnit("tick");
    expect(rateUnitSuffix("item")).toBe("/t");
    expect(rateUnitSuffix("fluid")).toBe(" L/t");
    // Power reads the way the game quotes it: EU per unit, k/M/G folded
    // downstream by formatCompact.
    expect(rateUnitSuffix("energy")).toBe(" EU/t");
  });

  it("keeps a slow line visible per tick", () => {
    // A chanced output at 0.004/s is a line that runs. Per tick it is twenty
    // times smaller, and a noise floor meant to hide zero must not swallow it.
    setActiveRateUnit("second");
    expect(formatSlotRateOrNull(0.004, "item")).toBe("0.004/s");
    setActiveRateUnit("tick");
    expect(formatSlotRateOrNull(0.004, "item")).toBe("0.0002/t");
  });
});
