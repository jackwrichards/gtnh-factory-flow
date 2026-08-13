// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gtnhFuelProfiles } from "@/lib/model/fuels";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryProject,
  type ResourceBalance,
} from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver";
import { closeBoundaries } from "@/lib/solver/close-boundaries";
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
    importedPerSecond: 0,
    productPerSecond: 0,
    byproductPerSecond: 0,
    bufferFillPerSecond: 0,
    minedPerSecond: 0,
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
      selectedBoardIds: [],
    });
    seedResult({});
  });

  // This project's vitest config sets neither `globals` nor a setup file, so
  // testing-library's automatic cleanup never registers and renders would
  // otherwise pile up in the same document.
  afterEach(cleanup);

  it("shows all four groups at once, without tab switching", () => {
    seedResult({
      externalInputs: [makeBalance(1, { deficitPerSecond: 240 })],
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
      internal: [makeInternal(3, 480)],
    });

    render(<InspectorPanel />);

    expect(screen.getByText("Inputs")).toBeDefined();
    expect(screen.getByText("Products")).toBeDefined();
    expect(screen.getByText("Byproducts")).toBeDefined();
    expect(screen.getByText("Internal")).toBeDefined();
    expect(screen.getByText("Resource 1")).toBeDefined();
    expect(screen.getByText("Resource 2")).toBeDefined();
    expect(screen.getByText("Internal 3")).toBeDefined();
  });

  // Nothing left over is a byproduct: it is coming out and no product drawer
  // claimed it. Calling it a product because a drawer has not been placed yet
  // would decide what the factory is for on the reader's behalf.
  it("files unclaimed spare output under byproducts", () => {
    seedResult({
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
    });

    render(<InspectorPanel />);

    const headers = screen.getAllByText(/^(Products|Byproducts)$/).map((el) => el.textContent);
    expect(headers).toEqual(["Products", "Byproducts"]);
    expect(screen.getByText("Nothing asked for yet.")).toBeDefined();
    expect(screen.getByText("Resource 2")).toBeDefined();
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
      const rowCount = container.querySelectorAll("[data-resource-row]").length;

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
    const header = screen.getByText("Inputs").closest("button")!;
    expect(within(header).getByText("2")).toBeDefined();
  });

  it("explains an empty group rather than showing a blank area", () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/Nothing missing/)).toBeDefined();
    expect(screen.getByText(/Nothing left over/)).toBeDefined();
  });

  it("lights a resource on the canvas while it is pointed at", () => {
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 240 })] });

    render(<InspectorPanel />);
    const row = screen.getByText("Resource 1").closest("[data-resource-row]")!;

    fireEvent.mouseEnter(row);
    expect(useFactoryStore.getState().hoveredFlowResourceKey).toBe("item:resource_1");
  });

  it("does not latch a resource on when it is clicked", () => {
    // Clicking used to lock the highlight on, which left the board blinking
    // until the row was found again and clicked off. Pointing is the whole
    // gesture now.
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 240 })] });

    render(<InspectorPanel />);
    fireEvent.click(screen.getByText("Resource 1").closest("button")!);

    expect(useFactoryStore.getState().selectedFlowResourceKey).toBeUndefined();
  });

  describe("scoped to a board selection", () => {
    /** Ore into ingots into plates, so ingots are internal plan-wide. */
    function seedChain() {
      const project: FactoryProject = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: "panel-scope-project",
        name: "Panel scope",
        recipes: [
          {
            id: "smelt",
            name: "Smelt",
            machineType: "Furnace",
            minimumTier: "LV",
            durationTicks: 20,
            eut: 30,
            inputs: [{ kind: "item", id: "ore", amount: 1, displayName: "Ore" }],
            outputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
          },
          {
            id: "bend",
            name: "Bend",
            machineType: "Bender",
            minimumTier: "LV",
            durationTicks: 20,
            eut: 30,
            inputs: [{ kind: "item", id: "ingot", amount: 1, displayName: "Ingot" }],
            outputs: [{ kind: "item", id: "plate", amount: 1, displayName: "Plate" }],
          },
        ],
        nodes: [
          {
            id: "smelter",
            recipeId: "smelt",
            machineCount: 1,
            parallel: 1,
            overclockTier: "LV",
            enabled: true,
            position: { x: 0, y: 0 },
          },
          {
            id: "bender",
            recipeId: "bend",
            machineCount: 1,
            parallel: 1,
            overclockTier: "LV",
            enabled: true,
            position: { x: 200, y: 0 },
          },
        ],
        edges: [
          {
            id: "smelter-to-bender",
            source: "smelter",
            target: "bender",
            resourceKind: "item",
            resourceId: "ingot",
          },
        ],
        fuelProfiles: gtnhFuelProfiles,
        selectedFuelProfileId: "biodiesel",
      };

      // Boundary closed: this is about how the panel GROUPS a plan's books,
      // not about where ore comes from, and an unwired chain reads zero now.
      // Ore still lands in Need and plate in Output - drawers add nothing to
      // the books. See close-boundaries.ts.
      const closed = closeBoundaries(project);
      useFactoryStore.setState({
        project: closed,
        lastResult: calculateThroughput(closed, { generatedAt: "fixed" }),
        selectedBoardIds: [],
      });
    }

    it("shows the whole plan until cards are selected", () => {
      seedChain();
      render(<InspectorPanel />);

      expect(screen.queryByText("Selection")).toBeNull();
      // Made and eaten in-plan, so it sits under Internal, not Need.
      expect(screen.getByText("Ore")).toBeDefined();
      expect(screen.getByText("Ingot")).toBeDefined();
    });

    it("re-books the groups over the selection alone", () => {
      seedChain();
      useFactoryStore.setState({ selectedBoardIds: ["bender"] });
      render(<InspectorPanel />);

      // The smelter is outside the box, so its ingots now have to arrive from
      // somewhere: Need gains the ingot and loses the ore the smelter ate.
      const needHeader = screen.getByText("Inputs").closest("button")!;
      expect(within(needHeader).getByText("1")).toBeDefined();
      expect(screen.getByText("Ingot")).toBeDefined();
      expect(screen.queryByText("Ore")).toBeNull();
      expect(screen.getByText("Selection")).toBeDefined();
      expect(screen.getByText("1 machine")).toBeDefined();
    });

    it("rings the whole panel while scoped, not just the strip", () => {
      seedChain();
      useFactoryStore.setState({ selectedBoardIds: ["bender"] });
      const { container } = render(<InspectorPanel />);

      // The mode has to be readable from anywhere in the list, so the ring
      // belongs to the panel that wraps every group.
      expect(container.querySelector("section.ring-purple-500\\/60")).not.toBeNull();
    });
  });
});
