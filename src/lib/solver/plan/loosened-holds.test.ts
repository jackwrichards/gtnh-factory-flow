/**
 * Least flow with the push's bands and the drawer stages' caps held exactly can find no point: each value held was read
 * off a point HiGHS keeps only to its own tolerance (a drawer stage's point had an Up to card 5e-7 under its band), and
 * together they did not meet. The pass then tries least flow once more with the holds loosened by the conservation
 * tolerance (`loosened`). `__fixtures__/up-to/oil-line-up-to-one.json` is a shared oil line whose saltwater electrolyzer
 * needs 0.3 machines: under Any and Up to 2 it solved, under Up to 1, 0.5 or 0.31 it failed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { activeLpEngine, initLpEngine } from "../lp-engine";
import { setColumnOrder } from "./lp";
import { solvePlan } from "./solve-plan";
import type { SolveInput } from "./types";

beforeAll(async () => {
  await initLpEngine();
  expect(activeLpEngine()).toBe("highs");
});

afterEach(() => setColumnOrder("forward"));

const ELECTROLYZER = "node-2964b946-4f03-45bc-b142-ee4b5da3a671";

const oilLine = (capacity: number): SolveInput => {
  const plan = JSON.parse(
    readFileSync(path.join(__dirname, "__fixtures__", "up-to", "oil-line-up-to-one.json"), "utf8"),
  ) as SolveInput;
  return {
    ...plan,
    pools: plan.pools.map((p) => (p.machines.includes(ELECTROLYZER) ? { ...p, capacity } : p)),
  };
};

describe("held levels read off a slightly inexact point never fail the plan", () => {
  for (const order of ["forward", "reverse"] as const) {
    it.each([1, 0.5, 0.31, 2])(`Up to %s solves at the 0.3 machines it needs (${order} columns)`, (capacity) => {
      setColumnOrder(order);
      const answer = solvePlan(oilLine(capacity));
      expect(answer.kind).toBe("solved");
      if (answer.kind !== "solved") return;
      expect(answer.solution.notes.map((n) => n.message)).not.toContain("BALANCE_FAILED");
      expect(answer.solution.machineCounts[ELECTROLYZER]).toBeCloseTo(0.3, 5);
    });
  }
});
