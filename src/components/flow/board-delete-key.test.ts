// @vitest-environment jsdom
/**
 * Delete and Backspace on the real board: they take what is selected on the board and nothing else. The store's
 * selectedNodeId (set to the first card by every landing and every delete, and to the card a port's recipe search
 * was opened from) is never drawn, and keys on it deleted cards nobody saw selected, one a press, wires and all,
 * leaving their recipes behind. The recipe search walks back on a bare Backspace while it covers the board.
 */
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewProject } from "@/examples";
import { leaveLibrary, openLibrary } from "@/lib/library/library-tab";
import type { FactoryEdge, FactoryNode, FactoryProject, Recipe } from "@/lib/model/types";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";
import { useFactoryStore } from "@/store/factory-store";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false, useIsCompactViewport: () => false }));

import { FactoryFlow } from "./FactoryFlow";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

function recipe(id: string, input: string | undefined, output: string): Recipe {
  return {
    id,
    name: `Recipe ${id}`,
    machineType: "Macerator",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 2,
    inputs: input ? [{ kind: "item", id: input, amount: 1, displayName: input }] : [],
    outputs: [{ kind: "item", id: output, amount: 1, displayName: output }],
  };
}

function node(id: string, recipeId: string, x: number): FactoryNode {
  return { id, recipeId, machineCount: 1, parallel: 1, overclockTier: "LV", enabled: true, position: { x, y: 0 } };
}

function wire(id: string, source: string, target: string, resource: string): FactoryEdge {
  return {
    id,
    source,
    target,
    sourceHandle: `output:item:${resource}:0`,
    targetHandle: `input:item:${resource}:0`,
    resourceKind: "item",
    resourceId: resource,
  } as FactoryEdge;
}

/** Six machines in a chain, m0 the oldest. */
function chainPlan(): FactoryProject {
  const steps = [0, 1, 2, 3, 4, 5];
  return {
    ...createNewProject(),
    id: "delete-key",
    name: "Delete key",
    recipes: steps.map((i) => recipe(`r${i}`, i === 0 ? undefined : `res${i - 1}`, `res${i}`)),
    nodes: steps.map((i) => node(`m${i}`, `r${i}`, i * 400)),
    edges: steps.slice(1).map((i) => wire(`w${i}`, `m${i - 1}`, `m${i}`, `res${i - 1}`)),
  };
}

const ALL = ["m0", "m1", "m2", "m3", "m4", "m5"];
const cards = () => useFactoryStore.getState().project.nodes.map((entry) => entry.id);

function press(key: string) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The board as the app has it: mounted first, then a design lands on it (page load, tab switch). */
function boardWithPlan() {
  render(createElement(FactoryFlow));
  act(() => useFactoryStore.getState().markHydratedProject(chainPlan()));
  expect(cards()).toEqual(ALL);
}

/** A selection on the board, as a marquee or a press leaves it (handed over the way a paste hands its own). */
function selectOnBoard(ids: string[]) {
  act(() => {
    useFactoryStore.getState().setPendingBoardSelection(ids);
    useFactoryStore.getState().updateNode("m0", { colorTag: "red" });
  });
}

beforeEach(() => {
  leaveWelcomeTab();
  leaveLibrary();
});
afterEach(() => {
  cleanup();
  act(() => useFactoryStore.getState().clearResourceBrowser());
  leaveLibrary();
});

describe("the board's Delete and Backspace", () => {
  it("delete nothing nobody selected: after a plan lands, and after a card is deleted from its menu", () => {
    boardWithPlan();
    press("Backspace");
    press("Delete");
    expect(cards()).toEqual(ALL);

    // The card's menu deletes m3; nothing else is armed by it.
    act(() => useFactoryStore.getState().deleteNode("m3"));
    press("Delete");
    press("Backspace");
    expect(cards()).toEqual(["m0", "m1", "m2", "m4", "m5"]);
    // Its recipe stays, as every delete leaves it; only m3 went.
    expect(useFactoryStore.getState().project.recipes).toHaveLength(6);
  });

  it("take exactly what is selected on the board, with its wires", () => {
    boardWithPlan();
    selectOnBoard(["m3", "m4"]);
    press("Delete");
    expect(cards()).toEqual(["m0", "m1", "m2", "m5"]);
    expect(useFactoryStore.getState().project.edges.map((edge) => edge.id)).toEqual(["w1", "w2"]);
  });

  it("leave the board alone while the recipe search covers it, whose Backspace walks back", () => {
    boardWithPlan();
    selectOnBoard(["m3", "m4", "m5"]);
    // Opened from m4's port (the search's anchor), then a page further on.
    act(() => {
      useFactoryStore.getState().browseResource({ kind: "item", id: "res3", anchorNodeId: "m4" } as never, "recipes");
      useFactoryStore.getState().browseResource({ kind: "item", id: "res1" } as never, "recipes");
    });
    press("Backspace");
    press("Backspace");
    press("Delete");
    expect(cards()).toEqual(ALL);
  });

  it("leave the board alone while the Library covers it", () => {
    boardWithPlan();
    selectOnBoard(["m2"]);
    act(() => openLibrary());
    press("Backspace");
    expect(cards()).toEqual(ALL);
  });

  it("delete nothing after Escape lets go of the selection", () => {
    boardWithPlan();
    selectOnBoard(["m1", "m2"]);
    press("Escape");
    expect([...document.querySelectorAll(".react-flow__node.selected")]).toEqual([]);
    press("Delete");
    expect(cards()).toEqual(ALL);
  });
});
