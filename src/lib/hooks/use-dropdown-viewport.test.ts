// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDropdownViewport } from "./use-dropdown-viewport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("tracks a keyboard that changes only the visual viewport and removes its listeners", () => {
  const visual = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 430, height: 900 });
  vi.stubGlobal("visualViewport", visual);
  const remove = vi.spyOn(visual, "removeEventListener");
  const { result, unmount } = renderHook(useDropdownViewport);
  expect(result.current.height).toBe(900);
  act(() => {
    visual.height = 500;
    visual.dispatchEvent(new Event("resize"));
  });
  expect(result.current.height).toBe(500);
  act(() => {
    visual.offsetTop = 120;
    visual.dispatchEvent(new Event("scroll"));
  });
  expect(result.current.top).toBe(120);
  unmount();
  expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
});
