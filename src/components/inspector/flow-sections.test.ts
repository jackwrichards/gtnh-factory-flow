import { describe, expect, it } from "vitest";
import type { ResourceBalance } from "@/lib/model/types";
import {
  applyNetFlow,
  applyResourceMarks,
  buildFlowRows,
  filterFlowBalances,
  findRowIndexAtOffset,
  getFlowRowValue,
  measureFlowRows,
  type FlowSection,
  type FlowSectionId,
  type ResourceMarks,
} from "./flow-sections";

const HEIGHTS = { header: 30, item: 48, empty: 38, chart: 60 };

function makeBalance(overrides: Partial<ResourceBalance> = {}): ResourceBalance {
  return {
    key: "item:iron_ore",
    kind: "item",
    resourceId: "iron_ore",
    displayName: "Iron Ore",
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

function makeSection(id: FlowSectionId, items: ResourceBalance[]): FlowSection {
  return {
    id,
    label: id,
    empty: `no ${id}`,
    tone: id,
    sign: id === "need" ? -1 : id === "internal" ? 0 : 1,
    items,
    totalCount: items.length,
  };
}

const NONE_COLLAPSED = { need: false, gather: false, output: false, internal: false };

describe("buildFlowRows", () => {
  it("emits a header followed by each item", () => {
    const rows = buildFlowRows(
      [makeSection("need", [makeBalance({ key: "item:a" }), makeBalance({ key: "item:b" })])],
      NONE_COLLAPSED,
    );

    expect(rows.map((row) => row.type)).toEqual(["header", "item", "item"]);
  });

  it("keeps only the header for a collapsed section", () => {
    // Folding a 200-row group has to cost nothing to render, which is the whole
    // reason collapsing exists on a plan this size.
    const items = Array.from({ length: 200 }, (_, index) =>
      makeBalance({ key: `item:${index}` as ResourceBalance["key"] }),
    );
    const rows = buildFlowRows([makeSection("internal", items)], {
      ...NONE_COLLAPSED,
      internal: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("header");
  });

  it("emits a placeholder row for an expanded but empty section", () => {
    const rows = buildFlowRows([makeSection("output", [])], NONE_COLLAPSED);
    expect(rows.map((row) => row.type)).toEqual(["header", "empty"]);
  });

  it("gives every row a unique key across sections", () => {
    const shared = makeBalance({ key: "item:shared" });
    const rows = buildFlowRows(
      [makeSection("need", [shared]), makeSection("internal", [shared])],
      NONE_COLLAPSED,
    );

    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});

describe("measureFlowRows", () => {
  it("accumulates offsets by row type and reports the total", () => {
    const rows = buildFlowRows(
      [makeSection("need", [makeBalance({ key: "item:a" }), makeBalance({ key: "item:b" })])],
      NONE_COLLAPSED,
    );
    const { offsets, totalHeight } = measureFlowRows(rows, HEIGHTS);

    expect(offsets.slice(0, 3)).toEqual([0, 30, 78]);
    expect(totalHeight).toBe(126);
  });

  it("ends with a sentinel offset equal to the total", () => {
    const rows = buildFlowRows([makeSection("output", [])], NONE_COLLAPSED);
    const { offsets, totalHeight } = measureFlowRows(rows, HEIGHTS);

    expect(offsets).toHaveLength(rows.length + 1);
    expect(offsets[rows.length]).toBe(totalHeight);
  });

  it("handles an empty row list", () => {
    const { offsets, totalHeight } = measureFlowRows([], HEIGHTS);
    expect(totalHeight).toBe(0);
    expect(offsets).toEqual([0]);
  });
});

describe("findRowIndexAtOffset", () => {
  const offsets = [0, 30, 78, 126, 174];

  it("returns the first row at the top", () => {
    expect(findRowIndexAtOffset(offsets, 0)).toBe(0);
  });

  it("returns the row containing a mid-row scroll position", () => {
    expect(findRowIndexAtOffset(offsets, 40)).toBe(1);
    expect(findRowIndexAtOffset(offsets, 77)).toBe(1);
  });

  it("advances exactly on a row boundary", () => {
    expect(findRowIndexAtOffset(offsets, 78)).toBe(2);
  });

  it("clamps past the end rather than running off the array", () => {
    expect(findRowIndexAtOffset(offsets, 100_000)).toBe(offsets.length - 2);
  });

  it("clamps a negative scroll position from overscroll", () => {
    expect(findRowIndexAtOffset(offsets, -50)).toBe(0);
  });
});

describe("getFlowRowValue", () => {
  // One resource wearing all three hats at once, which is legal: it is
  // imported at a source drawer, some is caught by a product drawer, and the
  // rest lands in a byproduct drawer.
  const balance = makeBalance({
    producedPerSecond: 120,
    consumedPerSecond: 360,
    deficitPerSecond: 240,
    importedPerSecond: 240,
    surplusPerSecond: 64,
    productPerSecond: 40,
    byproductPerSecond: 24,
  });

  it("reports the shortfall for a need", () => {
    expect(getFlowRowValue("need", balance)).toBe(240);
  });

  // One Outputs figure: product drawers, byproduct drawers and unclaimed
  // surplus are one answer to "how much leaves the line".
  it("reports the whole surplus for an output", () => {
    expect(getFlowRowValue("output", balance)).toBe(64);
  });

  it("reports throughput for an internal resource", () => {
    expect(getFlowRowValue("internal", balance)).toBe(360);
  });
});

describe("applyNetFlow", () => {
  const need = (key: ResourceBalance["key"], deficit: number, surplus = 0) =>
    makeBalance({ key, deficitPerSecond: deficit, surplusPerSecond: surplus });
  const output = (key: ResourceBalance["key"], surplus: number, deficit = 0) =>
    makeBalance({ key, surplusPerSecond: surplus, deficitPerSecond: deficit });

  it("leaves one-sided items alone", () => {
    const needs = [need("item:coal", 5)];
    const outputs = [output("item:steel", 3)];
    const netted = applyNetFlow(needs, outputs);

    expect(netted.needs).toEqual(needs);
    expect(netted.outputs).toEqual(outputs);
  });

  it("collapses a two-sided item onto the side its sign says", () => {
    // The same balance object sits in both raw lists, as splitBalances files it.
    const shortChlorine = makeBalance({
      key: "item:cl-short",
      deficitPerSecond: 10,
      surplusPerSecond: 4,
    });
    const spareChlorine = makeBalance({
      key: "item:cl-spare",
      deficitPerSecond: 3,
      surplusPerSecond: 8,
    });
    const netted = applyNetFlow([shortChlorine, spareChlorine], [shortChlorine, spareChlorine]);

    expect(netted.needs).toEqual([
      expect.objectContaining({ key: "item:cl-short", deficitPerSecond: 6, surplusPerSecond: 0 }),
    ]);
    expect(netted.outputs).toEqual([
      expect.objectContaining({ key: "item:cl-spare", surplusPerSecond: 5, deficitPerSecond: 0 }),
    ]);
  });

  it("keeps an exactly covered item listed as an output at zero", () => {
    // "You do not need to source this" said out loud, instead of the item
    // silently vanishing from both lists.
    const covered = makeBalance({ key: "item:even", deficitPerSecond: 7, surplusPerSecond: 7 });
    const netted = applyNetFlow([covered], [covered]);

    expect(netted.needs).toEqual([]);
    expect(netted.outputs).toEqual([
      expect.objectContaining({ key: "item:even", surplusPerSecond: 0, deficitPerSecond: 0 }),
    ]);
  });

  it("re-ranks each netted list by its new size", () => {
    const big = makeBalance({ key: "item:big", deficitPerSecond: 2, surplusPerSecond: 20 });
    const small = output("item:small", 9);
    const netted = applyNetFlow([big], [small, big]);

    expect(netted.outputs.map((entry) => entry.key)).toEqual(["item:big", "item:small"]);
  });
});

describe("filterFlowBalances", () => {
  const items = [
    makeBalance({ key: "item:iron_ore", resourceId: "iron_ore", displayName: "Iron Ore" }),
    makeBalance({ key: "fluid:water", resourceId: "water", displayName: "Water" }),
  ];

  it("returns everything for a blank filter", () => {
    expect(filterFlowBalances(items, "   ")).toBe(items);
  });

  it("matches on display name, case-insensitively", () => {
    expect(filterFlowBalances(items, "IRON")).toEqual([items[0]]);
  });

  it("matches on resource id when the display name does not", () => {
    expect(filterFlowBalances(items, "water")).toEqual([items[1]]);
  });

  it("matches on the resource key so a kind prefix narrows the list", () => {
    expect(filterFlowBalances(items, "fluid:")).toEqual([items[1]]);
  });

  it("returns nothing when there is no match", () => {
    expect(filterFlowBalances(items, "titanium")).toEqual([]);
  });
});

describe("applyResourceMarks", () => {
  const iron = makeBalance({ key: "item:iron", displayName: "Iron" });
  const copper = makeBalance({ key: "item:copper", displayName: "Copper" });
  const water = makeBalance({ key: "fluid:water", displayName: "Water" });
  const items = [iron, copper, water];

  const marks = (overrides: Partial<ResourceMarks> = {}): ResourceMarks => ({
    hidden: new Set(),
    favourites: new Set(),
    showHidden: false,
    favouritesOnly: false,
    ...overrides,
  });

  it("leaves an unmarked list exactly as the solver ranked it", () => {
    expect(applyResourceMarks(items, marks())).toEqual(items);
  });

  it("drops hidden resources", () => {
    expect(applyResourceMarks(items, marks({ hidden: new Set(["fluid:water"]) }))).toEqual([
      iron,
      copper,
    ]);
  });

  it("keeps hidden resources listed when showing them is on", () => {
    const shown = applyResourceMarks(
      items,
      marks({ hidden: new Set(["fluid:water"]), showHidden: true }),
    );

    // Still in place, not moved to the end: the row greys out where it sits so
    // it can be found and unhidden.
    expect(shown).toEqual(items);
  });

  it("floats favourites to the top without reordering the rest", () => {
    expect(applyResourceMarks(items, marks({ favourites: new Set(["fluid:water"]) }))).toEqual([
      water,
      iron,
      copper,
    ]);
  });

  it("keeps the solver's ranking among several favourites", () => {
    const marked = applyResourceMarks(
      items,
      marks({ favourites: new Set(["fluid:water", "item:iron"]) }),
    );

    expect(marked).toEqual([iron, water, copper]);
  });

  it("lists only favourites when that filter is on", () => {
    expect(
      applyResourceMarks(items, marks({ favouritesOnly: true, favourites: new Set(["item:iron"]) })),
    ).toEqual([iron]);
  });

  it("hides a starred resource if one ever ends up in both lists", () => {
    // Cannot happen through the UI - starring unhides, and a starred row has
    // no hide button - so this only pins down that there is no tie-break here.
    // The two marks are kept exclusive where they are WRITTEN, not read.
    const marked = applyResourceMarks(
      items,
      marks({ hidden: new Set(["fluid:water"]), favourites: new Set(["fluid:water"]) }),
    );

    expect(marked).toEqual([iron, copper]);
  });
});
