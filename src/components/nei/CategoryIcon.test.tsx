// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceIcon } from "./ResourceIcon";
import { advanceAlternativeCycleForTests, resetAlternativeCycleForTests, ALTERNATIVE_CYCLE_INTERVAL_MS } from "@/lib/nei/alternative-cycle";

const category = {
  kind: "item" as const, id: "oredict:plankWood", amount: 3,
  displayName: "Ore Dictionary: plankWood",
  alternatives: [
    { kind: "item" as const, id: "oak", displayName: "Oak Planks", iconPath: "/oak.png", amount: 1 },
    { kind: "item" as const, id: "spruce", displayName: "Spruce Planks", iconPath: "/spruce.png", amount: 4 },
    { kind: "fluid" as const, id: "water", iconPath: "/water.png" },
  ],
};
afterEach(() => { cleanup(); resetAlternativeCycleForTests(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("category preview icons", () => {
  it("cycles artwork only, leaving the category label, quantity, and input data stable", () => {
    const original = structuredClone(category);
    const { container } = render(<ResourceIcon resource={category} showName tooltip={false} />);
    const text = container.textContent;
    expect(text).toContain("Any wooden planks");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/oak.png");
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/spruce.png");
    expect(container.textContent).toBe(text);
    expect(category).toEqual(original);
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/oak.png");
  });
  it("never cycles a concrete item just because it lists substitutes", () => {
    const { container } = render(<ResourceIcon resource={{ ...category, id: "oak", iconPath: "/oak.png", displayName: "Oak Planks" }} tooltip={false} />);
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/oak.png");
  });
  it("shares one clock and releases it when the last icon unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(<><ResourceIcon resource={category} /><ResourceIcon resource={category} /></>);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(ALTERNATIVE_CYCLE_INTERVAL_MS));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("respects reduced motion and still shows a real member", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<ResourceIcon resource={category} tooltip={false} />);
    act(() => vi.advanceTimersByTime(ALTERNATIVE_CYCLE_INTERVAL_MS * 3));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/oak.png");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps CSS-hidden card detail still until it becomes visible", () => {
    const { container } = render(<div style={{ visibility: "hidden" }}><ResourceIcon resource={category} tooltip={false} /></div>);
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/oak.png");
    (container.firstElementChild as HTMLElement).style.visibility = "visible";
    act(() => advanceAlternativeCycleForTests(2));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/spruce.png");
  });
  it("unsubscribes offscreen icons and cleans up the shared visibility observer", () => {
    vi.useFakeTimers();
    let report: IntersectionObserverCallback;
    let target: Element;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { report = callback; }
      observe(element: Element) { target = element; }
      unobserve() {}
      disconnect = disconnect;
    });
    const { unmount } = render(<ResourceIcon resource={category} tooltip={false} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => report([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(vi.getTimerCount()).toBe(1);
    act(() => report([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
