import { afterEach, describe, expect, it } from "vitest";
import type { ResourceBalance, ResourceKey, ThroughputResult } from "./model/types";
import {
  getResourceTrends,
  recordResourceTrend,
  resetResourceTrends,
  selectTrendSeries,
  TREND_HISTORY_LIMIT,
} from "./resource-trends";

function balance(key: ResourceKey, netPerSecond: number): ResourceBalance {
  return {
    key,
    kind: "item",
    resourceId: key.split(":")[1] ?? key,
    producedPerSecond: Math.max(0, netPerSecond),
    consumedPerSecond: Math.max(0, -netPerSecond),
    netPerSecond,
    surplusPerSecond: Math.max(0, netPerSecond),
    deficitPerSecond: Math.max(0, -netPerSecond),
    importedPerSecond: Math.max(0, -netPerSecond),
    productPerSecond: Math.max(0, netPerSecond),
    byproductPerSecond: 0,
    bufferFillPerSecond: 0,
    minedPerSecond: 0,
  };
}

/** Only `resources` is read, so the rest of the result can stay a stub. */
function result(...balances: ResourceBalance[]): ThroughputResult {
  return {
    resources: Object.fromEntries(balances.map((entry) => [entry.key, entry])),
  } as unknown as ThroughputResult;
}

// The record is module state, so every test starts from a clean chart.
afterEach(resetResourceTrends);

describe("resource trends", () => {
  it("records one point per edit that moves a number", () => {
    recordResourceTrend(result(balance("item:iron", 1)));
    recordResourceTrend(result(balance("item:iron", 4)));
    recordResourceTrend(result(balance("item:iron", -2)));

    expect(selectTrendSeries(readHistory(), "item:iron")).toEqual([1, 4, -2]);
  });

  it("ignores a re-solve that changed nothing", () => {
    recordResourceTrend(result(balance("item:iron", 1)));
    // Switching the rate unit re-solves purely to refresh formatting, and
    // dragging a card commits a project that moves no rates at all.
    recordResourceTrend(result(balance("item:iron", 1)));
    recordResourceTrend(result(balance("item:iron", 1)));

    expect(selectTrendSeries(readHistory(), "item:iron")).toEqual([1]);
  });

  it("counts a resource appearing or vanishing as a change", () => {
    recordResourceTrend(result(balance("item:iron", 1)));
    recordResourceTrend(result(balance("item:iron", 1), balance("item:copper", 3)));
    recordResourceTrend(result(balance("item:iron", 1)));

    expect(readHistory()).toHaveLength(3);
    // A resource gone from the plan reads as zero, which is what deleting the
    // machine that made it actually did to your supply.
    expect(selectTrendSeries(readHistory(), "item:copper")).toEqual([0, 3, 0]);
  });

  it("keeps a resource's history from before it was starred", () => {
    recordResourceTrend(result(balance("item:iron", 1), balance("item:copper", 5)));
    recordResourceTrend(result(balance("item:iron", 2), balance("item:copper", 6)));

    // Nothing about recording depends on what is starred, so starring copper
    // now still shows both points.
    expect(selectTrendSeries(readHistory(), "item:copper")).toEqual([5, 6]);
  });

  it("drops the oldest edits past the limit", () => {
    for (let index = 0; index < TREND_HISTORY_LIMIT + 15; index += 1) {
      recordResourceTrend(result(balance("item:iron", index)));
    }

    const series = selectTrendSeries(readHistory(), "item:iron");
    expect(series).toHaveLength(TREND_HISTORY_LIMIT);
    expect(series[series.length - 1]).toBe(TREND_HISTORY_LIMIT + 14);
    expect(series[0]).toBe(15);
  });

  it("starts over when the chart is reset", () => {
    recordResourceTrend(result(balance("item:iron", 1)));
    resetResourceTrends();

    expect(readHistory()).toEqual([]);
  });
});

/** The same array `useResourceTrends` hands React. */
const readHistory = getResourceTrends;
