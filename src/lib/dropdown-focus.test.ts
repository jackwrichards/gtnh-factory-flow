// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusDropdownFilter } from "./dropdown-focus";

afterEach(() => vi.unstubAllGlobals());

describe("dropdown filter focus", () => {
  it("leaves the keyboard closed on touch, including a desktop-mode phone", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const input = document.createElement("input");
    const focus = vi.spyOn(input, "focus");
    focusDropdownFilter(input);
    expect(window.matchMedia).toHaveBeenCalledWith("(any-pointer: coarse)");
    expect(focus).not.toHaveBeenCalled();
  });

  it("focuses desktop search without scrolling its ancestors", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const input = document.createElement("input");
    const focus = vi.spyOn(input, "focus");
    focusDropdownFilter(input);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
