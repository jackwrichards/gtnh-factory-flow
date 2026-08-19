import { describe, expect, it } from "vitest";
import { energyResourceForTier, energyTierForId } from "./energy";
import { GT_VOLTAGE_TIERS } from "./tiers";
import type { MachineTier } from "./types";

describe("energy resources", () => {
  it("parses a grid id back to its tier, case-insensitively on the id", () => {
    expect(energyTierForId("lv")).toBe("LV");
    expect(energyTierForId("max")).toBe("MAX");
    // The trap the lowercased lookup is for: "LuV" lowercases to "luv".
    expect(energyTierForId("luv")).toBe("LuV");
    expect(energyTierForId("LuV")).toBeUndefined();
    expect(energyTierForId("zz")).toBeUndefined();
  });

  it("builds the per-grid resource", () => {
    const tier: MachineTier = "HV";
    const resource = energyResourceForTier(tier);
    expect(resource).toEqual({
      kind: "energy",
      id: "hv",
      amount: 1,
      displayName: "Energy (HV)",
    });
  });

  it("round-trips every grid of the voltage table", () => {
    for (const { tier } of GT_VOLTAGE_TIERS) {
      expect(energyTierForId(energyResourceForTier(tier).id)).toBe(tier);
    }
  });
});
