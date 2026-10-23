import { describe, expect, it } from "vitest";
import { CUSTOM_RATE_MACHINE_TYPE } from "./custom-rate";
import { nextPinRule, pinRuleOf, withPinRule } from "./pin-rule";

describe("pin rule", () => {
  it("reads Any, Up to and Exactly from the count and the flag", () => {
    expect(pinRuleOf({})).toBe("any");
    expect(pinRuleOf({ solvePin: 0 })).toBe("any");
    expect(pinRuleOf({ solvePin: 4 })).toBe("upTo");
    expect(pinRuleOf({ solvePin: 4, solvePinExact: false })).toBe("upTo");
    expect(pinRuleOf({ solvePin: 4, solvePinExact: true })).toBe("exact");
    // A flag without a count is still Any.
    expect(pinRuleOf({ solvePinExact: true })).toBe("any");
  });

  it("keeps a custom rate card's count exact", () => {
    expect(pinRuleOf({ solvePin: 1 }, { machineType: CUSTOM_RATE_MACHINE_TYPE })).toBe("exact");
  });

  it("steps Any, Up to, Exactly and round again", () => {
    expect(nextPinRule("any")).toBe("upTo");
    expect(nextPinRule("upTo")).toBe("exact");
    expect(nextPinRule("exact")).toBe("any");
  });

  it("writes the two fields and nothing else", () => {
    const node = { id: "n", solvePin: 3, solvePinExact: true, other: 1 };
    expect(withPinRule(node, "any", 3)).toEqual({ id: "n", other: 1 });
    expect(withPinRule(node, "upTo", 5)).toEqual({ id: "n", other: 1, solvePin: 5 });
    const bare: { id: string; solvePin?: number; solvePinExact?: boolean; solvePinAny?: boolean } = {
      id: "n",
      solvePinAny: true,
    };
    expect(withPinRule(bare, "exact", 2)).toEqual({ id: "n", solvePin: 2, solvePinExact: true });
    // No count is Any, and an older plan's Any mark is dropped.
    expect(withPinRule(node, "upTo", 0)).toEqual({ id: "n", other: 1 });
    expect(withPinRule(node, "exact", undefined)).toEqual({ id: "n", other: 1 });
    expect(withPinRule(bare, "upTo", undefined)).toEqual({ id: "n" });
  });
});
