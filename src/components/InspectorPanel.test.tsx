// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  afterEach(() => {
    cleanup();
    useFactoryStore.getState().setRateUnit("second");
    useFactoryStore.getState().setPowerDisplayUnit("eu");
  });

  it("updates memoized resource rows when time and power units change without a new solve", async () => {
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 10 })] });
    useFactoryStore.setState({ lastResult: { ...useFactoryStore.getState().lastResult, totalEuT: 100 } });
    const books = useFactoryStore.getState().lastResult;
    const { container } = render(<InspectorPanel />);
    const reading = () => container.querySelector('[data-resource-row="item:resource_1"] .inspector-resource-rate')?.textContent;
    await waitFor(() => expect(reading()).toContain("10/s"));
    act(() => useFactoryStore.getState().setRateUnit("minute"));
    await waitFor(() => expect(reading()).toContain("600/min"));
    act(() => useFactoryStore.getState().setRateUnit("eu"));
    await waitFor(() => expect(reading()).toContain("200EU/Item"));
    act(() => useFactoryStore.getState().setPowerDisplayUnit("LV"));
    await waitFor(() => expect(reading()).toContain("6.25A LV/Item"));
    act(() => useFactoryStore.getState().setPowerDisplayUnit("HV"));
    await waitFor(() => expect(reading()).toContain("0.39A HV/Item"));
    act(() => useFactoryStore.getState().setPowerDisplayUnit("MAX"));
    await waitFor(() => expect(reading()).toContain("<0.01A MAX/Item"));
    expect(useFactoryStore.getState().lastResult).toBe(books);
  });

  it.each([[10, 4, "−6"], [4, 10, "+6"], [4, 4, "0"]] as const)(
    "shows raw input %s and output %s and switches all sections to net %s",
    async (input, output, net) => {
      const balance = makeBalance(1, { deficitPerSecond: input, surplusPerSecond: output });
      seedResult({ externalInputs: [balance], unconsumedOutputs: [balance] });
      const { container } = render(<InspectorPanel />);
      await waitFor(() => {
        const rows = container.querySelectorAll('[data-resource-row="item:resource_1"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector(".inspector-resource-rate")?.textContent).toContain(String(input));
        expect(rows[1].querySelector(".inspector-resource-rate")?.textContent).toContain(String(output));
        for (const row of rows) expect(row.querySelector(".inspector-resource-net")).toBeNull();
      });
      fireEvent.click(screen.getByRole("button", { name: "Show net rates" }));
      await waitFor(() => {
        const rows = container.querySelectorAll('[data-resource-row="item:resource_1"]');
        expect(rows).toHaveLength(1);
        for (const row of rows) {
          expect(row.querySelector(".inspector-resource-rate")).toBeNull();
          expect(row.querySelector(".inspector-resource-net")?.textContent).toContain(net);
        }
        expect(screen.getByText("Inputs").closest("button")?.textContent).toMatch(input > output ? /Inputs\s*1/ : /Inputs\s*0/);
        expect(screen.getByText("Outputs").closest("button")?.textContent).toMatch(input > output ? /Outputs\s*0/ : /Outputs\s*1/);
      });
      expect(screen.getByRole("button", { name: "Show net rates" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Show raw rates" }));
      await waitFor(() => expect(container.querySelectorAll(".inspector-resource-rate")).toHaveLength(2));
    },
  );

  it("does not sign values that round to zero in either rate display", async () => {
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 1e-16 })] });
    const { container } = render(<InspectorPanel />);
    await waitFor(() => expect(container.querySelector(".inspector-resource-rate")?.textContent).toMatch(/^0/));
    fireEvent.click(screen.getByRole("button", { name: "Show net rates" }));
    await waitFor(() => expect(container.querySelector(".inspector-resource-net")?.textContent).toMatch(/^0/));
    expect(container.textContent).not.toContain("−0");
  });

  it("shows the three groups at once, with Internal folded by default", () => {
    seedResult({
      externalInputs: [makeBalance(1, { deficitPerSecond: 240 })],
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
      internal: [makeInternal(3, 480)],
    });

    render(<InspectorPanel />);

    expect(screen.getByText("Inputs")).toBeDefined();
    expect(screen.getByText("Outputs")).toBeDefined();
    expect(screen.getByText("Internal")).toBeDefined();
    expect(screen.getByText("Resource 1")).toBeDefined();
    expect(screen.getByText("Resource 2")).toBeDefined();
    // Internal is the long tail and the group that means "nothing to see",
    // so it starts folded; one click on its header opens it.
    expect(screen.queryByText("Internal 3")).toBeNull();
    fireEvent.click(screen.getByText("Internal").closest("button")!);
    expect(screen.getByText("Internal 3")).toBeDefined();
  });

  // One Outputs section: the old Products/Byproducts split is gone, so spare
  // output nothing claims still lands in plain sight under Outputs.
  it("files unclaimed spare output under the one Outputs section", () => {
    seedResult({
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
    });

    render(<InspectorPanel />);

    expect(screen.getByText("Outputs")).toBeDefined();
    expect(screen.queryByText("Products")).toBeNull();
    expect(screen.queryByText("Byproducts")).toBeNull();
    expect(screen.getByText("Resource 2")).toBeDefined();
  });

  it("signs needs negative and outputs positive", () => {
    seedResult({
      externalInputs: [makeBalance(1, { deficitPerSecond: 240 })],
      unconsumedOutputs: [makeBalance(2, { producedPerSecond: 64, surplusPerSecond: 64 })],
    });

    render(<InspectorPanel />);

    expect(screen.getAllByText(/−240/)).toHaveLength(1);
    expect(screen.getAllByText(/\+64/)).toHaveLength(1);
  });

  it("windows a large plan instead of rendering every row", () => {
    // The panel has to stay cheap at hundreds of resources; rendering them all
    // is the thing this replaced. Inputs, because that group starts open.
    withViewport(600, () => {
      seedResult({
        externalInputs: Array.from({ length: 400 }, (_, index) =>
          makeBalance(index, { deficitPerSecond: 100 }),
        ),
      });

      const { container } = render(<InspectorPanel />);
      const rowCount = container.querySelectorAll("[data-resource-row]").length;

      // 600px of viewport over 30px rows is ~20 visible, plus overscan at each end.
      expect(rowCount).toBeGreaterThan(15);
      expect(rowCount).toBeLessThan(60);
    });
  });

  it("keeps a section header pinned when scrolled deep into a long group", () => {
    withViewport(600, () => {
      seedResult({
        externalInputs: Array.from({ length: 400 }, (_, index) =>
          makeBalance(index, { deficitPerSecond: 100 }),
        ),
      });

      const { container } = render(<InspectorPanel />);
      const scroller = container.querySelector(".overflow-y-auto")!;
      fireEvent.scroll(scroller, { target: { scrollTop: 5000 } });

      // Far past the header's own row, so it only survives via the pinned copy.
      expect(screen.getAllByText("Inputs").length).toBeGreaterThan(0);
      expect(screen.queryByText("Resource 0")).toBeNull();
    });
  });

  it("collapses a section to its header", async () => {
    seedResult({ externalInputs: [makeBalance(1, { deficitPerSecond: 100 })] });

    render(<InspectorPanel />);
    expect(screen.getByText("Resource 1")).toBeDefined();

    // The row folds away over a short presence tween rather than popping,
    // so give the fold its moment before asserting it finished.
    fireEvent.click(screen.getByText("Inputs").closest("button")!);
    await waitFor(() => expect(screen.queryByText("Resource 1")).toBeNull());
    expect(screen.getByText("Inputs")).toBeDefined();
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
    expect(screen.getByText(/Nothing coming out yet/)).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: "Resource 1" }));

    expect(useFactoryStore.getState().selectedFlowResourceKey).toBeUndefined();
  });

  describe("drawer rates in Solve", () => {
    /** Ore into ingots, a source drawer feeding the ore and `products`
     * product drawers taking the ingots. */
    function seedDrawers({ products = 1, solve = true }: { products?: number; solve?: boolean } = {}) {
      const productIds = Array.from({ length: products }, (_, index) => `ingots-${index}`);
      const project: FactoryProject = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: "panel-drawers",
        name: "Panel drawers",
        solveMode: solve,
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
        ],
        nodes: [
          { id: "smelter", recipeId: "smelt", machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x: 0, y: 0 } },
        ],
        storages: [
          { id: "ore-in", kind: "item", resourceId: "ore", displayName: "Ore", position: { x: -200, y: 0 } },
          ...productIds.map((id, index) => ({ id, kind: "item" as const, resourceId: "ingot", displayName: "Ingot", position: { x: 200, y: index * 100 } })),
        ],
        edges: [
          { id: "ore-edge", source: "ore-in", target: "smelter", resourceKind: "item", resourceId: "ore" },
          ...productIds.map((id) => ({ id: `edge-${id}`, source: "smelter", target: id, resourceKind: "item" as const, resourceId: "ingot" })),
        ],
        fuelProfiles: gtnhFuelProfiles,
        selectedFuelProfileId: "biodiesel",
      };
      useFactoryStore.setState({
        project,
        isReadOnly: false,
        lastResult: calculateThroughput(project, { generatedAt: "fixed" }),
        selectedBoardIds: [],
      });
    }
    const rowOf = (container: HTMLElement, key: string) =>
      container.querySelector<HTMLElement>(`[data-resource-row="${key}"]`)!;

    it("puts a lone drawer's rule and rate on its resource row, Inputs and Outputs alike", () => {
      seedDrawers();
      const { container } = render(<InspectorPanel />);
      const ore = within(rowOf(container, "item:ore"));
      const ingot = within(rowOf(container, "item:ingot"));
      expect(ore.getByRole("button", { name: /^Rule for Ore: Exactly/ }).textContent).toBe("=");
      expect(ore.getByRole("button", { name: "Required amount" })).toBeDefined();
      expect(ingot.getByRole("button", { name: /^Rule for Ingot: At least/ }).textContent).toBe("≥");
      expect(ingot.getByRole("button", { name: "Required amount" })).toBeDefined();
      // One thing, one line: no branch row under either.
      expect(screen.queryByRole("button", { name: /^Locate/ })).toBeNull();
    });

    it("types a source's rate on its row", () => {
      seedDrawers();
      const { container } = render(<InspectorPanel />);
      fireEvent.click(within(rowOf(container, "item:ore")).getByRole("button", { name: "Required amount" }));
      const input = within(rowOf(container, "item:ore")).getByRole("textbox", { name: "Required amount" });
      fireEvent.change(input, { target: { value: "4" } });
      fireEvent.blur(input);
      expect(useFactoryStore.getState().project.storages!.find((s) => s.id === "ore-in")!.targetPerSecond).toBe(-4);
    });

    it("hangs a branch row under the resource for each of several drawers", () => {
      seedDrawers({ products: 2 });
      const { container } = render(<InspectorPanel />);
      expect(within(rowOf(container, "item:ingot")).queryByRole("button", { name: /^Rule for/ })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Locate product drawer" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: /^Rule for Ingot/ })).toHaveLength(2);
    });

    it("sets nothing from the panel in Build", () => {
      seedDrawers({ solve: false });
      render(<InspectorPanel />);
      expect(screen.queryByRole("button", { name: /^Rule for/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Required amount" })).toBeNull();
      expect(screen.getByRole("img", { name: "Product" })).toBeDefined();
    });
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
      expect(screen.getByText("Ore")).toBeDefined();
      // Made and eaten in-plan, so it sits under Internal, not Need — and
      // Internal starts folded.
      expect(screen.queryByText("Ingot")).toBeNull();
      fireEvent.click(screen.getByText("Internal").closest("button")!);
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
      expect(container.querySelector("section.inspector-selection-scope")).not.toBeNull();
    });
  });
});
