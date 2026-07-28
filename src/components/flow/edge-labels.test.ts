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

  it("reads 100% when the shortfall is negligible", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({ demand: 100, transferred: 100, nameplateDemand: 100, isSupplyCapped: true }),
      ),
    ).toBe("100/s · 100%");
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
  it("shows can-deliver over need: offering 10 to a machine needing 2 reads 500%", () => {
    const edge = makeEdge({ demand: 2, sourceCapacity: 10 });
    expect(isEdgeSurplus(edge)).toBe(true);
    expect(formatEdgeRateLabel(edge)).toBe("2/s · 500%");
  });

  it("making 10 for a machine taking 1 reads 1000%", () => {
    expect(formatEdgeRateLabel(makeEdge({ demand: 1, sourceCapacity: 10 }))).toBe("1/s · 1000%");
  });

  it("able to make 1 for a machine needing 2 reads 50%, and counts as starved", () => {
    const edge = makeEdge({ demand: 1, nameplateDemand: 2, sourceCapacity: 1 });
    expect(formatEdgeRateLabel(edge)).toBe("1/s · 50%");
    expect(isEdgeStarved(edge)).toBe(true);
    expect(isEdgeSurplus(edge)).toBe(false);
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

  it("uses the line's real capacity against the need on a starved edge", () => {
    // The consumer wants 100 and the line could carry 10 of it: 10%, not the
    // 1% currently trickling through.
    const edge = makeEdge({
      demand: 1,
      transferred: 1,
      nameplateDemand: 100,
      sourceCapacity: 10,
      isSupplyCapped: true,
    });
    expect(isEdgeSurplus(edge)).toBe(false);
    expect(formatEdgeRateLabel(edge)).toBe("1/s · 10%");
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
    expect(formatEdgeRateLabel(edge)).toBe("3/s · 400%");
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
    ).toBe(
      "The machine this feeds needs 10/s but this line can only deliver 2/s. It takes 5× the current supply to fill it.",
    );
  });

  it("explains a surplus line from the maker's side, with the spare amount", () => {
    expect(describeEdgeRate(makeEdge({ demand: 2, sourceCapacity: 10 }))).toBe(
      "The maker can send 10/s but only 2/s is needed. 8/s is spare.",
    );
  });

  it("explains a perfectly matched line", () => {
    expect(describeEdgeRate(makeEdge({ demand: 10, sourceCapacity: 10 }))).toBe(
      "The maker sends exactly the 10/s that is needed.",
    );
  });

  it("speaks about storage when the line ends in a barrel", () => {
    expect(
      describeEdgeRate(
        makeEdge({
          demand: 3,
          transferred: 3,
          nameplateDemand: 111,
          isSupplyCapped: true,
          isStorageTarget: true,
        }),
      ),
    ).toBe(
      "Machines pulling from this storage need 111/s but this line only brings 3/s. It takes 37× the current supply to keep up.",
    );
    expect(describeEdgeRate(makeEdge({ demand: 5, sourceCapacity: 5, isStorageTarget: true }))).toBe(
      "Storage takes everything the maker sends: 5/s.",
    );
  });

  it("falls back to the plain rate when there is nothing to compare", () => {
    expect(describeEdgeRate(makeEdge({ demand: 4 }))).toBe("Carrying 4/s.");
    expect(describeEdgeRate(undefined)).toBe("");
  });
});
