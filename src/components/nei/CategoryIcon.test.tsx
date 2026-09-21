// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
  it("keeps the old sprite until the next has decoded, then promotes the mounted image", async () => {
    const original = structuredClone(category);
    const { container } = render(<ResourceIcon resource={category} showName tooltip={false} />);
    const text = container.textContent;
    expect(text).toContain("Any wooden planks");
    const oak = container.querySelector("img")!;
    act(() => advanceAlternativeCycleForTests());
    const pending = container.querySelector('[data-category-frame="loading"]')!;
    const spruce = pending.querySelector("img")!;
    expect(spruce.getAttribute("src")).toBe("/spruce.png");
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(oak);
    expect((pending as HTMLElement).style.opacity).toBe("0");
    let decode!: () => void;
    spruce.decode = vi.fn(() => new Promise<void>((resolve) => { decode = resolve; }));
    await act(async () => { fireEvent.load(spruce); });
    expect(container.querySelector('[data-category-frame="incoming"]')).toBeNull();
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(oak);
    await act(async () => { decode(); });
    const incoming = container.querySelector('[data-category-frame="incoming"]')!;
    expect(incoming.querySelector("img")).toBe(spruce);
    expect(container.querySelector('[data-category-frame="outgoing"] img')).toBe(oak);
    // jsdom lacks AnimationEvent, so React registers its WebKit fallback.
    fireEvent(incoming, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(container.querySelectorAll('[data-category-frame="current"]')).toHaveLength(1);
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(spruce);
    expect(container.textContent).toBe(text);
    expect(category).toEqual(original);
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelector('[data-category-frame="loading"] img')).toBe(oak);
    await act(async () => { fireEvent.load(oak); });
    fireEvent(container.querySelector('[data-category-frame="incoming"]')!, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(oak);
  });
  it("keeps the current sprite when the incoming image fails", () => {
    const { container } = render(<ResourceIcon resource={category} tooltip={false} />);
    const oak = container.querySelector("img");
    act(() => advanceAlternativeCycleForTests());
    fireEvent.error(container.querySelector('[data-category-frame="loading"] img')!);
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(oak);
    expect(container.querySelector('[data-category-frame="incoming"]')).toBeNull();
    act(() => advanceAlternativeCycleForTests());
    expect(container.querySelectorAll('[data-category-frame="current"]')).toHaveLength(1);
    expect(container.querySelector("img")).toBe(oak);
  });
  it("ignores a stale decode after the next cycle has cancelled that image", async () => {
    const { container } = render(<ResourceIcon resource={category} tooltip={false} />);
    const oak = container.querySelector("img");
    act(() => advanceAlternativeCycleForTests());
    const spruce = container.querySelector('[data-category-frame="loading"] img')! as HTMLImageElement;
    let decode!: () => void;
    spruce.decode = () => new Promise<void>((resolve) => { decode = resolve; });
    await act(async () => { fireEvent.load(spruce); });
    act(() => advanceAlternativeCycleForTests());
    await act(async () => { decode(); });
    expect(container.querySelectorAll('[data-category-frame="current"]')).toHaveLength(1);
    expect(container.querySelector('[data-category-frame="current"] img')).toBe(oak);
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
    expect(container.querySelector('[data-category-frame="loading"] img')?.getAttribute("src")).toBe("/spruce.png");
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
