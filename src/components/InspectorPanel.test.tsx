// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResourceBalance } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { InspectorPanel } from "./InspectorPanel";

function makeBalance(index: number, overrides: Partial<ResourceBalance> = {}): ResourceBalance {
  return {
    key: `item:resource_${index}`,
    kind: "item",
    resourceId: `resource_${index}`,
    displayName: `Resource ${index}`,
    producedPerSecond: 0,
    consumedPerSecond: 0,
    netPerSecond: 0,
    surplusPerSecond: 0,
    deficitPerSecond: 0,
    ...overrides,
  };
}

function seedResult({
  externalInputs = [],
  unconsumedOutputs = [],
  internal = [],
}: {
  externalInputs?: ResourceBalance[];
  unconsumedOutputs?: ResourceBalance[];
  internal?: ResourceBalance[];
}) {
  const resources: Record<string, ResourceBalance> = {};
  for (const balance of internal) {
    resources[balance.key] = balance;
  }

  const state = useFactoryStore.getState();
  useFactoryStore.setState({
    lastResult: {
      ...state.lastResult,
      resources: resources as typeof state.lastResult.resources,
      externalInputs,
      unconsumedOutputs,
      bottlenecks: [],
    },
  });
}

/**
 * Runs `body` with a real viewport height.
 *
 * jsdom reports every element as zero-height and ships no ResizeObserver, so the
 * list would otherwise measure a viewport of nothing and render only its
 * overscan — an assertion against that would prove nothing about windowing.
 */
function withViewport(height: number, body: () => void) {
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const originalObserver = globalThis.ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => height,
  });
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: () => void) {}
    observe() {
      this.callback();
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  try {
    body();
  } finally {
    globalThis.ResizeObserver = originalObserver;
    if (originalHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalHeight);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  }
}

/** Internal rows must be produced and consumed in equal measure to qualify. */
function makeInternal(index: number, rate: number) {
  return makeBalance(index, {
    key: `item:internal_${index}`,
    resourceId: `internal_${index}`,
    displayName: `Internal ${index}`,
    producedPerSecond: rate,
    consumedPerSecond: rate,
  });
}

describe("InspectorPanel", () => {
  beforeEach(() => {
    useFactoryStore.setState({
      selectedFlowResourceKey: undefined,
      hoveredFlowResourceKey: undefined,
    });
    seedResult({});
  });

  // This project's vitest config sets neither `globals` nor a setup file, so
  // testing-library's automatic cleanup never registers and renders would
  // otherwise pile up in the same document.
  afterEach(cleanup);

  it("shows all three groups at once, without tab switching", () => {
    seedResult({
      externalInputs: [makeBalance(1, { deficitPerSecond: 240 })],
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
      internal: [makeInternal(3, 480)],
    });

    render(<InspectorPanel />);

    expect(screen.getByText("Need")).toBeDefined();
    expect(screen.getByText("Output")).toBeDefined();
    expect(screen.getByText("Internal")).toBeDefined();
    expect(screen.getByText("Resource 1")).toBeDefined();
    expect(screen.getByText("Resource 2")).toBeDefined();
    expect(screen.getByText("Internal 3")).toBeDefined();
  });

  it("signs needs negative and outputs positive", () => {
    seedResult({
      externalInputs: [makeBalance(1, { deficitPerSecond: 240 })],
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
    });

    render(<InspectorPanel />);

    expect(screen.getByText(/−240/)).toBeDefined();
    expect(screen.getByText(/\+64/)).toBeDefined();
  });

  it("windows a large plan instead of rendering every row", () => {
    // The panel has to stay cheap at hundreds of resources; rendering them all
    // is the thing this replaced.
    withViewport(600, () => {
      seedResult({ internal: Array.from({ length: 400 }, (_, index) => makeInternal(index, 100)) });

      const { container } = render(<InspectorPanel />);
      const rowCount = container.querySelectorAll("button[title]").length;

      // 600px of viewport over 30px rows is ~20 visible, plus overscan at each end.
      expect(rowCount).toBeGreaterThan(15);
      expect(rowCount).toBeLessThan(60);
    });
  });

  it("keeps a section header pinned when scrolled deep into a long group", () => {
    withViewport(600, () => {
      seedResult({ internal: Array.from({ length: 400 }, (_, index) => makeInternal(index, 100)) });

      const { container } = render(<InspectorPanel />);
      const scroller = container.querySelector(".overflow-y-auto")!;
      fireEvent.scroll(scroller, { target: { scrollTop: 5000 } });

      // Far past the header's own row, so it only survives via the pinned copy.
      expect(screen.getByText("Internal")).toBeDefined();
      expect(screen.queryByText("Internal 0")).toBeNull();
    });
  });

  it("collapses a section to its header", () => {
    seedResult({ internal: [makeInternal(1, 100), makeInternal(2, 200)] });

    render(<InspectorPanel />);
    expect(screen.getByText("Internal 1")).toBeDefined();

    fireEvent.click(screen.getByText("Internal").closest("button")!);
    expect(screen.queryByText("Internal 1")).toBeNull();
    expect(screen.getByText("Internal")).toBeDefined();
  });

  it("keeps section counts on the header while filtering", () => {
    seedResult({
      externalInputs: [
        makeBalance(1, { displayName: "Iron Ore", deficitPerSecond: 240 }),
        makeBalance(2, { displayName: "Copper Ore", deficitPerSecond: 120 }),
      ],
    });

    render(<InspectorPanel />);
    const header = screen.getByText("Need").closest("button")!;
    expect(within(header).getByText("2")).toBeDefined();
  });

  it("explains an empty group rather than showing a blank area", () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/Nothing missing/)).toBeDefined();
    expect(screen.getByText(/Nothing left over/)).toBeDefined();
  });

  it("selects a resource so the canvas can highlight it", () => {
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 240 })] });

    render(<InspectorPanel />);
    fireEvent.click(screen.getByText("Resource 1").closest("button")!);

    expect(useFactoryStore.getState().selectedFlowResourceKey).toBe("item:resource_1");
  });
});
