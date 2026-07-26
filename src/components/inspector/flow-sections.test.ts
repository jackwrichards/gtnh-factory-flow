import { describe, expect, it } from "vitest";
import type { ResourceBalance } from "@/lib/model/types";
import {
  buildFlowRows,
  filterFlowBalances,
  findRowIndexAtOffset,
  getFlowRowValue,
  measureFlowRows,
  type FlowSection,
  type FlowSectionId,
} from "./flow-sections";

const HEIGHTS = { header: 30, item: 48, empty: 38 };

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
    ...overrides,
  };
}

function makeSection(id: FlowSectionId, items: ResourceBalance[]): FlowSection {
  return {
    id,
    label: id,
    hint: "",
    empty: `no ${id}`,
    tone: id,
    sign: id === "need" ? -1 : id === "output" ? 1 : 0,
    items,
    totalCount: items.length,
  };
}

const NONE_COLLAPSED = { need: false, output: false, internal: false };

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
  const balance = makeBalance({
    producedPerSecond: 120,
    consumedPerSecond: 360,
    deficitPerSecond: 240,
    surplusPerSecond: 64,
  });

  it("reports the shortfall for a need", () => {
    expect(getFlowRowValue("need", balance)).toBe(240);
  });

  it("reports the surplus for an output", () => {
    expect(getFlowRowValue("output", balance)).toBe(64);
  });

  it("reports throughput for an internal resource", () => {
    expect(getFlowRowValue("internal", balance)).toBe(360);
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
