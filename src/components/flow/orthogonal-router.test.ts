import { describe, expect, it } from "vitest";
import {
  findOrthogonalRoute,
  polylineCrossesRect,
  type RouteRect,
} from "./orthogonal-router";

const WINDOW: RouteRect = { left: -200, right: 1400, top: -200, bottom: 1200 };

function route(
  obstacles: RouteRect[],
  source = { x: 0, y: 300, axis: "h" as const },
  target = { x: 1000, y: 300, axis: "h" as const },
) {
  return findOrthogonalRoute({ source, target, obstacles, window: WINDOW });
}

function expectClean(points: ReturnType<typeof route>, obstacles: RouteRect[]) {
  expect(points).toBeDefined();
  for (const rect of obstacles) {
    expect(polylineCrossesRect(points!, rect)).toBe(false);
  }
}

describe("findOrthogonalRoute", () => {
  it("routes straight when nothing blocks", () => {
    const points = route([]);
    expect(points).toEqual([
      { x: 0, y: 300 },
      { x: 1000, y: 300 },
    ]);
  });

  it("goes around a single blocking rect", () => {
    const obstacles = [{ left: 400, right: 600, top: 100, bottom: 500 }];
    const points = route(obstacles);
    expectClean(points, obstacles);
  });

  it("bends as often as needed through a staircase of blockers", () => {
    // Two overlapping-in-y walls offset in x: no single jog clears both, the
    // path must snake. This is exactly the shape the candidate-menu router
    // crossed nodes on.
    const obstacles = [
      { left: 300, right: 460, top: -200, bottom: 420 },
      { left: 620, right: 780, top: 180, bottom: 1200 },
    ];
    const points = route(obstacles);
    expectClean(points, obstacles);
    // Needs at least three turns (down/right/up-or-similar snake).
    expect(points!.length).toBeGreaterThanOrEqual(5);
  });

  it("threads a dense field without touching anything", () => {
    const obstacles: RouteRect[] = [];
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 3; row += 1) {
        obstacles.push({
          left: 150 + column * 220,
          right: 150 + column * 220 + 160,
          top: row * 260 - 100,
          bottom: row * 260 + 120,
        });
      }
    }
    const points = route(obstacles, { x: 0, y: 150, axis: "h" }, { x: 1200, y: 150, axis: "h" });
    expectClean(points, obstacles);
  });

  it("returns undefined when the target is boxed in", () => {
    const obstacles = [
      { left: 900, right: 1100, top: 200, bottom: 220 },
      { left: 900, right: 1100, top: 380, bottom: 400 },
      { left: 900, right: 920, top: 200, bottom: 400 },
      { left: 1080, right: 1100, top: 200, bottom: 400 },
    ];
    const points = route(obstacles, { x: 0, y: 300, axis: "h" }, { x: 1000, y: 300, axis: "h" });
    expect(points).toBeUndefined();
  });

  it("is deterministic", () => {
    const obstacles = [
      { left: 300, right: 460, top: -200, bottom: 420 },
      { left: 620, right: 780, top: 180, bottom: 1200 },
    ];
    expect(route(obstacles)).toEqual(route(obstacles));
  });

  it("takes an adjacent lane instead of running on top of an existing wire", () => {
    // A rival wire runs exactly along the naive straight route. The lane
    // vertices contributed by congestion segments must let the path shift
    // beside it rather than stack on it.
    const congestion = [{ start: { x: 0, y: 300 }, end: { x: 1000, y: 300 } }];
    const points = findOrthogonalRoute({
      source: { x: 0, y: 300, axis: "h" },
      target: { x: 1000, y: 300, axis: "h" },
      obstacles: [],
      window: WINDOW,
      congestion,
      nearness: { distance: 8, costPerPixel: 6 },
    });
    expect(points).toBeDefined();
    let overlapOn300 = 0;
    for (let index = 1; index < points!.length; index += 1) {
      const a = points![index - 1]!;
      const b = points![index]!;
      if (Math.abs(a.y - 300) < 0.01 && Math.abs(b.y - 300) < 0.01) {
        overlapOn300 += Math.abs(b.x - a.x);
      }
    }
    expect(overlapOn300).toBeLessThan(80);
  });

  it("avoids crossing existing edge segments when a clean lane exists", () => {
    // A vertical rival segment sits mid-way; with crossing penalised the
    // router should prefer dodging over it when that is cheap.
    const congestion = [{ start: { x: 500, y: 100 }, end: { x: 500, y: 500 } }];
    const withCongestion = findOrthogonalRoute({
      source: { x: 0, y: 300, axis: "h" },
      target: { x: 1000, y: 300, axis: "h" },
      obstacles: [],
      window: WINDOW,
      congestion,
      crossingCost: 100000,
    });
    expect(withCongestion).toBeDefined();
    // Either it found a way around the finite segment or accepted the cost -
    // with an effectively infinite cost it must go around: no point of the
    // path may cross x=500 between y=100..500.
    for (let index = 1; index < withCongestion!.length; index += 1) {
      const a = withCongestion![index - 1]!;
      const b = withCongestion![index]!;
      if (a.y === b.y && Math.min(a.x, b.x) < 500 && Math.max(a.x, b.x) > 500) {
        expect(a.y > 500 || a.y < 100).toBe(true);
      }
    }
  });
});
