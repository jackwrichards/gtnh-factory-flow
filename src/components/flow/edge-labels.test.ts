import { describe, expect, it } from "vitest";
import {
  describeEdgeRate,
  formatEdgeRateLabel,
  isEdgeStarved,
  isEdgeSurplus,
  type EdgeLabelInput,
} from "./edge-labels";

function makeEdge(overrides: Partial<EdgeLabelInput> = {}): EdgeLabelInput {
  return {
    demand: 100,
    unit: "/s",
    isLimited: false,
    isSupplyCapped: false,
    ...overrides,
  };
}

describe("isEdgeStarved", () => {
  it("returns without recursing", () => {
    // Guards the self-call that once made every edge render blow the stack.
    expect(isEdgeStarved(makeEdge())).toBe(false);
  });

  it("flags supply-capped edges", () => {
    expect(isEdgeStarved(makeEdge({ isSupplyCapped: true }))).toBe(true);
  });

  it("still honours the legacy isLimited flag", () => {
    expect(isEdgeStarved(makeEdge({ isLimited: true }))).toBe(true);
  });

  it("handles missing data", () => {
    expect(isEdgeStarved(undefined)).toBe(false);
  });
});

describe("formatEdgeRateLabel", () => {
  it("shows a plain rate when the consumer is fed", () => {
    expect(formatEdgeRateLabel(makeEdge({ demand: 100 }))).toBe("100/s");
  });

  it("shows the flow and how satisfied the consumer is when starved", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({ demand: 1, transferred: 1, nameplateDemand: 100, isSupplyCapped: true }),
      ),
    ).toBe("1/s · 1%");
  });

  it("keeps the fluid unit spaced", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({
          demand: 12,
          transferred: 12,
          nameplateDemand: 480,
          unit: "L/s",
          isSupplyCapped: true,
        }),
      ),
    ).toBe("12 L/s · 3%");
  });

  it("does not show a ratio when the shortfall is negligible", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({ demand: 100, transferred: 100, nameplateDemand: 100, isSupplyCapped: true }),
      ),
    ).toBe("100/s");
  });

  it("does not show a ratio for demand-capped edges with slack", () => {
    // Running below nameplate is normal when the plan simply wants less, and
    // must not be dressed up as a problem.
    expect(formatEdgeRateLabel(makeEdge({ demand: 5, nameplateDemand: 100 }))).toBe("5/s");
  });

  it("prefers bundle totals over the individual edge", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({
          demand: 1,
          nameplateDemand: 100,
          isSupplyCapped: true,
          bundle: { demand: 3, nameplateDemand: 300, isSupplyCapped: true },
        }),
      ),
    ).toBe("3/s · 1%");
  });

  it("returns an empty string without data", () => {
    expect(formatEdgeRateLabel(undefined)).toBe("");
  });
});

describe("surplus", () => {
  it("shows the flow with the producer's used share when the line has headroom", () => {
    // The producer could make 10 but only 2 is taken, so the line runs at 20% -
    // the same number the machine's usage cell shows.
    const edge = makeEdge({ demand: 2, sourceCapacity: 10 });
    expect(isEdgeSurplus(edge)).toBe(true);
    expect(formatEdgeRateLabel(edge)).toBe("2/s · 20%");
  });

  it("still shows 100% at 1:1, just not as surplus", () => {
    const edge = makeEdge({ demand: 10, sourceCapacity: 10 });
    expect(isEdgeSurplus(edge)).toBe(false);
    expect(formatEdgeRateLabel(edge)).toBe("10/s · 100%");
  });

  it("never shows a percent from an infinite source like a drawer", () => {
    const edge = makeEdge({ demand: 4, sourceCapacity: Number.POSITIVE_INFINITY });
    expect(isEdgeSurplus(edge)).toBe(false);
    expect(formatEdgeRateLabel(edge)).toBe("4/s");
  });

  it("never shows surplus on a starved edge, the shortfall percent wins", () => {
    const edge = makeEdge({
      demand: 1,
      transferred: 1,
      nameplateDemand: 100,
      sourceCapacity: 10,
      isSupplyCapped: true,
    });
    expect(isEdgeSurplus(edge)).toBe(false);
    expect(formatEdgeRateLabel(edge)).toBe("1/s · 1%");
  });

  it("shows nothing on a dead line", () => {
    // "0 / 10" in green would read as praise for a line carrying nothing.
    expect(isEdgeSurplus(makeEdge({ demand: 0, sourceCapacity: 10 }))).toBe(false);
  });

  it("uses the bundle's shared capacity for single-target bundles", () => {
    const edge = makeEdge({
      demand: 1,
      sourceCapacity: undefined,
      bundle: { demand: 3, sourceCapacity: 12, isSupplyCapped: false },
    });
    expect(formatEdgeRateLabel(edge)).toBe("3/s · 25%");
  });

  it("stays quiet when capacity was withheld for a split producer", () => {
    expect(isEdgeSurplus(makeEdge({ demand: 5 }))).toBe(false);
    expect(formatEdgeRateLabel(makeEdge({ demand: 5 }))).toBe("5/s");
  });
});

describe("describeEdgeRate", () => {
  it("explains a starved line from the consumer's side", () => {
    expect(
      describeEdgeRate(
        makeEdge({ demand: 2, transferred: 2, nameplateDemand: 10, isSupplyCapped: true }),
      ),
    ).toBe("The machine this feeds wants 10/s but only gets 2/s. It needs more supply.");
  });

  it("explains a surplus line from the producer's side, with the spare amount", () => {
    expect(describeEdgeRate(makeEdge({ demand: 2, sourceCapacity: 10 }))).toBe(
      "The maker can produce 10/s but only 2/s is used. 8/s is spare.",
    );
  });

  it("explains a perfectly matched line", () => {
    expect(describeEdgeRate(makeEdge({ demand: 10, sourceCapacity: 10 }))).toBe(
      "All of the maker's 10/s is being used. Supply and demand match.",
    );
  });

  it("falls back to the plain rate when there is nothing to compare", () => {
    expect(describeEdgeRate(makeEdge({ demand: 4 }))).toBe("Carrying 4/s.");
    expect(describeEdgeRate(undefined)).toBe("");
  });
});
