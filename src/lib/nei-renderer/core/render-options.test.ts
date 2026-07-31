import { describe, expect, it } from "vitest";
import { resolveNeiRenderOptions } from "./render-options";

describe("resolveNeiRenderOptions", () => {
  it("resolves readable and explicit overrides", () => {
    expect(resolveNeiRenderOptions({ preset: "readable", showEmptySlots: false })).toMatchObject({
      preset: "readable",
      showChrome: false,
      showStats: true,
      showEmptySlots: false,
      textMode: "readable",
      aspectDisplay: "badge",
    });
  });

  it("enables debug bounds for debug preset", () => {
    expect(resolveNeiRenderOptions({ preset: "debug" }).showDebugBounds).toBe(true);
  });
});
