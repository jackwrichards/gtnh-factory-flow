import { describe, expect, it } from "vitest";
import {
  LANE_CAPACITY,
  WIRE_NODE_MARGIN,
  cardRimDocks,
  laneWidthForHeat,
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridPoint,
  type GridRouteRequest,
} from "./grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";

/** A recipe-card-shaped obstacle on the grid. */
function card(id: string, x: number, y: number, width = 360, height = 160): GridObstacle {
  return { id, left: x, top: y, right: x + width, bottom: y + height };
}

function request(partial: Partial<GridRouteRequest> & Pick<GridRouteRequest, "edgeId">): GridRouteRequest {
  return {
    order: 0,
    sources: [],
    targets: [],
    strokeWidth: 4,
    ...partial,
  };
}

function segments(points: GridPoint[]) {
  const list: Array<{ a: GridPoint; b: GridPoint }> = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    list.push({ a: points[i], b: points[i + 1] });
  }
  return list;
}

/** Does any segment enter the obstacle's margin-inflated interior? */
function violatesMargin(points: GridPoint[], obstacle: GridObstacle, skipEnds = 1): boolean {
  const left = obstacle.left - WIRE_NODE_MARGIN;
  const right = obstacle.right + WIRE_NODE_MARGIN;
  const top = obstacle.top - WIRE_NODE_MARGIN;
  const bottom = obstacle.bottom + WIRE_NODE_MARGIN;
  const all = segments(points);
  // Stubs at either end legitimately cross their own card's margin.
  const middle = all.slice(skipEnds, all.length - skipEnds);
  // Liang-Barsky against the OPEN rectangle: a segment that only touches
  // the margin's boundary (or skims its corner on a diagonal) is legal.
  return middle.some(({ a, b }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-9) {
        return q > 0;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    const inside =
      clip(-dx, a.x - left) && clip(dx, right - a.x) && clip(-dy, a.y - top) && clip(dy, bottom - a.y);
    return inside && t1 - t0 > 1e-6;
  });
}

/** Proper crossings between segments of different wires; touches and shared ends do not count. */
function countCrossings(routes: Map<string, { points: GridPoint[] }>): number {
  const segs: Array<{ id: string; a: GridPoint; b: GridPoint }> = [];
  for (const [id, route] of routes) {
    for (const seg of segments(route.points)) {
      segs.push({ id, ...seg });
    }
  }
  const cross = (o: GridPoint, a: GridPoint, b: GridPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  let count = 0;
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i];
      const t = segs[j];
      if (s.id === t.id) continue;
      const d1 = cross(s.a, s.b, t.a);
      const d2 = cross(s.a, s.b, t.b);
      const d3 = cross(t.a, t.b, s.a);
      const d4 = cross(t.a, t.b, s.b);
      const eps = 0.5;
      if (
        ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
        ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Every segment runs along the grid: horizontal, vertical, or a true 45° diagonal. */
function isOrthogonal(points: GridPoint[]): boolean {
  return segments(points).every(({ a, b }) => {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx < 0.01 || dy < 0.01 || Math.abs(dx - dy) < 0.01;
  });
}

describe("laneWidthForHeat", () => {
  it("quantizes to lane fractions and never exceeds the lane", () => {
    expect(laneWidthForHeat(0)).toBe(4);
    expect(laneWidthForHeat(0.1)).toBe(5);
    expect(laneWidthForHeat(0.25)).toBe(6);
    expect(laneWidthForHeat(0.5)).toBe(8);
    expect(laneWidthForHeat(0.75)).toBe(10);
    expect(laneWidthForHeat(0.9)).toBe(12);
    expect(laneWidthForHeat(1)).toBe(LANE_CAPACITY);
    expect(laneWidthForHeat(2)).toBe(LANE_CAPACITY);
  });

  it("gives adjacent heats distinct widths across the whole range", () => {
    // Eight steps, evenly indexed: a step exists roughly every 0.14 of heat.
    const widths = new Set<number>();
    for (let heat = 0; heat <= 1.0001; heat += 1 / 14) {
      widths.add(laneWidthForHeat(heat));
    }
    expect(widths.size).toBe(8);
  });
});

describe("solveGridRoutes", () => {
  it("routes a facing pair straight across", () => {
    const a = card("a", 0, 0);
    const b = card("b", 480, 0);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 480, y: 60, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points[0]).toEqual({ x: 360, y: 60 });
    expect(points[points.length - 1]).toEqual({ x: 480, y: 60 });
    expect(isOrthogonal(points)).toBe(true);
    // Straight shot: no vertical wandering.
    expect(points.every((point) => Math.abs(point.y - 60) < 0.01)).toBe(true);
  });

  it("keeps one cell of clearance around a blocking card", () => {
    const a = card("a", 0, 0);
    const blocker = card("blocker", 480, -20, 360, 200);
    const b = card("b", 960, 0);
    const routes = solveGridRoutes(
      [a, blocker, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 960, y: 60, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThan(2);
    expect(isOrthogonal(points)).toBe(true);
    expect(violatesMargin(points, blocker, 0)).toBe(false);
    expect(violatesMargin(points, a)).toBe(false);
    expect(violatesMargin(points, b)).toBe(false);
  });

  it("travels on grid lines outside the port stubs", () => {
    const a = card("a", 0, 0);
    const b = card("b", 700, 400);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 700, y: 460, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    // Interior corners land on grid multiples (lane offsets are 0 for a lone
    // wire, so the drawn lines ARE the grid lines).
    for (const point of points.slice(1, -1)) {
      const onGridX = Math.abs(point.x % 20) < 0.01 || Math.abs((point.x % 20) - 20) < 0.01;
      const onGridY =
        Math.abs(point.y - 60) < 0.01 ||
        Math.abs(point.y - 460) < 0.01 ||
        Math.abs(point.y % 20) < 0.01 ||
        Math.abs((point.y % 20) - 20) < 0.01;
      expect(onGridX || Math.abs(point.x - 360) < 0.01 || Math.abs(point.x - 700) < 0.01).toBe(true);
      expect(onGridY).toBe(true);
    }
  });

  it("lets two wires share a lane side by side without overlapping", () => {
    const a = card("a", 0, 0);
    const b = card("b", 1000, 600);
    // Two ports on each card wired straight across the same diagonal — their
    // best corridors coincide, so they should ride together, offset apart.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          order: 0,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1000, y: 660, side: "left" }],
        }),
        request({
          edgeId: "e2",
          order: 1,
          sources: [{ x: 360, y: 100, side: "right" }],
          targets: [{ x: 1000, y: 700, side: "left" }],
        }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    expect(isOrthogonal(first)).toBe(true);
    expect(isOrthogonal(second)).toBe(true);

    // No two parallel interior segments may sit on the same coordinate: lane
    // sharing must have offset one of them.
    const firstVerticalXs = segments(first)
      .filter(({ a: p, b: q }) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 1)
      .map(({ a: p }) => p.x);
    const secondVerticalXs = segments(second)
      .filter(({ a: p, b: q }) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 1)
      .map(({ a: p }) => p.x);
    for (const x1 of firstVerticalXs) {
      for (const x2 of secondVerticalXs) {
        if (Math.abs(x1 - x2) < 10) {
          // Same lane: they must be offset by at least the stroke width.
          expect(Math.abs(x1 - x2)).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("fans same-port wires apart right after the apron", () => {
    const a = card("a", 0, 0);
    const b = card("b", 900, 0, 360, 300);
    // Two wires out of the SAME output, into two different inputs far away.
    // They used to draw on literally the same line for the whole shared run;
    // now they may only coincide inside the port stub zone (a couple of
    // cells around the shared anchor).
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          order: 0,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 900, y: 60, side: "left" }],
        }),
        request({
          edgeId: "e2",
          order: 1,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 900, y: 260, side: "left" }],
        }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    const horizontalRuns = (points: GridPoint[]) =>
      segments(points)
        .filter(({ a: p, b: q }) => Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 1)
        .map(({ a: p, b: q }) => ({ y: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) }));
    const STUB_ZONE = 360 + 2 * WIRE_NODE_MARGIN;
    for (const runA of horizontalRuns(first)) {
      for (const runB of horizontalRuns(second)) {
        const overlapLo = Math.max(runA.lo, runB.lo, STUB_ZONE);
        const overlapHi = Math.min(runA.hi, runB.hi);
        if (overlapHi - overlapLo > 4 && Math.abs(runA.y - runB.y) < 1.9) {
          throw new Error(
            `stacked runs: y=${runA.y} vs y=${runB.y} over x ${overlapLo}..${overlapHi}`,
          );
        }
      }
    }
  });

  it("claims docks so parallel wires attach at different points", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    // Both cards offer a few perimeter docks (the host offers the whole
    // ring); two wires between the same pair must not share an attachment.
    const ring = (rect: GridObstacle): GridRouteRequest["sources"] => {
      const docks: GridRouteRequest["sources"] = [];
      for (let y = rect.top; y <= rect.bottom; y += 40) {
        docks.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" });
      }
      for (let x = rect.left; x <= rect.right; x += 40) {
        docks.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" });
      }
      return docks;
    };
    const routes = solveGridRoutes(
      [a, b],
      [
        request({ edgeId: "e1", order: 0, sources: ring(a), targets: ring(b) }),
        request({ edgeId: "e2", order: 1, sources: ring(a), targets: ring(b) }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    const key = (p: GridPoint) => `${Math.round(p.x)},${Math.round(p.y)}`;
    expect(key(first[0])).not.toBe(key(second[0]));
    expect(key(first[first.length - 1])).not.toBe(key(second[second.length - 1]));
  });

  it("prefers penalty-free docks when routes cost the same", () => {
    const a = card("a", 0, 0);
    const b = card("b", 600, 0);
    // Facing cards: every right-side dock of A pairs with a left-side dock
    // of B at identical route cost, so the centre bias (penalties) must be
    // the tiebreak — without it the corner-most seed wins on heap order.
    const docks = (x: number, side: "left" | "right", center: number) => {
      const list: GridRouteRequest["sources"] = [];
      for (let y = 40; y <= 120; y += 40) {
        list.push({ x, y, side, penalty: Math.abs(y - center) * 0.25 });
      }
      return list;
    };
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: docks(360, "right", 80),
          targets: docks(600, "left", 80),
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points[0].y).toBe(80);
    expect(points[points.length - 1].y).toBe(80);
  });

  it("routes through user waypoints in order", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    // A straight shot would run along y=60; the waypoint drags the wire down
    // through (580, 400) first.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 800, y: 60, side: "left" }],
          waypoints: [{ x: 580, y: 400 }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(isOrthogonal(points)).toBe(true);
    // The wire must pass within a lane's width of the pinned dot.
    const nearWaypoint = points.some(
      (point) => Math.abs(point.x - 580) <= 10 && Math.abs(point.y - 400) <= 10,
    );
    expect(nearWaypoint).toBe(true);
  });

  it("doubles back to honour waypoint order rather than skipping a stop", () => {
    const a = card("a", 0, 0);
    const b = card("b", 1200, 0);
    // First stop DOWNSTREAM, second stop back UPSTREAM: the wire must visit
    // them in that order, out and back, not silently drop the excursion.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1200, y: 60, side: "left" }],
          waypoints: [
            { x: 1000, y: 300 },
            { x: 500, y: 300 },
          ],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(isOrthogonal(points)).toBe(true);
    const indexNear = (x: number, y: number) =>
      points.findIndex((point) => Math.abs(point.x - x) <= 10 && Math.abs(point.y - y) <= 10);
    const firstStop = indexNear(1000, 300);
    const secondStop = indexNear(500, 300);
    expect(firstStop).toBeGreaterThan(-1);
    expect(secondStop).toBeGreaterThan(-1);
    expect(firstStop).toBeLessThan(secondStop);
  });

  it("ignores a waypoint sealed inside a card rather than failing", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 800, y: 60, side: "left" }],
          // Dead centre of card B: unreachable.
          waypoints: [{ x: 980, y: 80 }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(points)).toBe(true);
  });

  it("is deterministic", () => {
    const obstacles = [card("a", 0, 0), card("b", 700, 300), card("c", 200, 400)];
    const requests = [
      request({
        edgeId: "e1",
        order: 0,
        sources: [{ x: 360, y: 60, side: "right" as const }],
        targets: [{ x: 700, y: 360, side: "left" as const }],
      }),
      request({
        edgeId: "e2",
        order: 1,
        sources: [{ x: 360, y: 100, side: "right" as const }],
        targets: [{ x: 200, y: 480, side: "right" as const }],
      }),
    ];
    const first = solveGridRoutes(obstacles, requests);
    const second = solveGridRoutes(obstacles, requests);
    expect(JSON.stringify([...first.entries()])).toBe(JSON.stringify([...second.entries()]));
  });

  it("picks the best storage side from candidates", () => {
    const a = card("a", 0, 0);
    const drawer: GridObstacle = { id: "d", left: 600, top: 20, right: 740, bottom: 180 };
    const routes = solveGridRoutes(
      [a, drawer],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [
            { x: 600, y: 100, side: "left" },
            { x: 740, y: 100, side: "right" },
            { x: 660, y: 20, side: "top" },
            { x: 660, y: 180, side: "bottom" },
          ],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    // The producer sits to the drawer's left: the wire should dock on the
    // drawer's left face, not loop around to the far side.
    const end = points[points.length - 1];
    expect(end.x).toBe(600);
    expect(end.y).toBe(100);
  });

  it("returns a fallback polyline rather than nothing when boxed in", () => {
    // A target completely walled off by touching cards.
    const walls = [
      card("w1", 400, -400, 60, 1200),
      card("w2", 400, 800, 1200, 60),
    ];
    const routes = solveGridRoutes(
      [card("a", 0, 0), ...walls],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 2000, y: 2000, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(points)).toBe(true);
  });

  it("a board frame turns foreign wires away like a card", () => {
    // Two facing cards with an open board frame standing between them.
    const a = card("a", 0, 0);
    const b = card("b", 1200, 0);
    const frame: GridObstacle = { id: "frame", left: 480, top: -200, right: 840, bottom: 360 };
    const foreign = solveGridRoutes(
      [a, b, frame],
      [
        request({
          edgeId: "foreign",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1200, y: 60, side: "left" }],
        }),
      ],
    ).get("foreign")!.points;
    expect(isOrthogonal(foreign)).toBe(true);
    expect(violatesMargin(foreign, frame, 0)).toBe(false);
  });

  it("a member's wire crosses its own frame and leaves by the shortest way", () => {
    // A card outside, a member card inside the frame's right half: the wire
    // must cross the border (the frame cannot block its own member's wire)
    // and must not run the length of the frame's rim to get there.
    const outside = card("outside", 0, 0);
    const frame: GridObstacle = { id: "frame", left: 480, top: -200, right: 1400, bottom: 600 };
    const member = card("member", 1000, 0);
    const points = solveGridRoutes(
      [outside, frame, member],
      [
        request({
          edgeId: "member",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1000, y: 60, side: "left" }],
          exemptObstacleIds: ["frame"],
        }),
      ],
    ).get("member")!.points;

    expect(isOrthogonal(points)).toBe(true);
    // It arrives: the frame never blocks a wire that belongs to it.
    expect(points[points.length - 1]).toEqual({ x: 1000, y: 60 });

    // And it spends only the crossing inside the frame — the straight run
    // from the border to the card, not a lap of the rim. Each segment is
    // clipped to the frame so a run that enters part-way counts only the
    // part that is actually in there.
    let insideLength = 0;
    for (const { a: from, b: to } of segments(points)) {
      const overlap = (lo: number, hi: number, min: number, max: number) =>
        Math.max(0, Math.min(hi, max) - Math.max(lo, min));
      const spanX = overlap(
        Math.min(from.x, to.x),
        Math.max(from.x, to.x),
        frame.left,
        frame.right,
      );
      const spanY = overlap(
        Math.min(from.y, to.y),
        Math.max(from.y, to.y),
        frame.top,
        frame.bottom,
      );
      // One of the two is zero on an orthogonal run; a run is inside only
      // while its fixed coordinate is inside as well.
      if (from.y === to.y && from.y >= frame.top && from.y <= frame.bottom) {
        insideLength += spanX;
      } else if (from.x === to.x && from.x >= frame.left && from.x <= frame.right) {
        insideLength += spanY;
      }
    }
    // The card's left edge is 520 past the border; a cell of slack covers
    // the dock stub. A wire that ran the rim would be several times this.
    expect(insideLength).toBeLessThanOrEqual(1000 - 480 + WIRE_NODE_MARGIN);
  });

  it("a wire between two cards on one board never leaves it", () => {
    // Two members side by side inside a roomy frame. The frame is exempt
    // for this wire AND holds both its ends, so the route has to stay in:
    // ducking out to the open board and back is what this forbids.
    const frame: GridObstacle = { id: "frame", left: 0, top: 0, right: 1400, bottom: 500 };
    const left = card("left", 100, 160);
    const right = card("right", 900, 160);
    const points = solveGridRoutes(
      [frame, left, right],
      [
        request({
          edgeId: "inner",
          sources: [{ x: 460, y: 220, side: "right" }],
          targets: [{ x: 900, y: 220, side: "left" }],
          exemptObstacleIds: ["frame"],
          homeObstacleIds: ["frame"],
        }),
      ],
    ).get("inner")!.points;

    expect(isOrthogonal(points)).toBe(true);
    // Every corner of the route sits inside the room it belongs to.
    expect(
      points.every(
        (point) =>
          point.x >= frame.left &&
          point.x <= frame.right &&
          point.y >= frame.top &&
          point.y <= frame.bottom,
      ),
    ).toBe(true);
  });
});

/** The whole rim as candidate docks, the way the board offers it in free-dock mode. */
function rim(obstacle: GridObstacle): GridEndpoint[] {
  const out: GridEndpoint[] = [];
  const keepOut = 40;
  for (let x = obstacle.left + keepOut; x <= obstacle.right - keepOut; x += 20) {
    out.push({ x, y: obstacle.top, side: "top" }, { x, y: obstacle.bottom, side: "bottom" });
  }
  for (let y = obstacle.top + keepOut; y <= obstacle.bottom - keepOut; y += 20) {
    out.push({ x: obstacle.left, y, side: "left" }, { x: obstacle.right, y, side: "right" });
  }
  return out;
}


describe("wires plan together", () => {
  it("a fan of four products leaves a tall card without crossing", () => {
    // Jack's distillation tower board (2026-09-07): a tall card at the
    // bottom left, three product drawers along the top and one to the
    // right. Routed one at a time each wire left by the right side and the
    // top-bound ones climbed across the one heading right. Zero crossings
    // is possible here and is what the plan must find.
    const tower = card("tower", -320, 400, 600, 500);
    const creosote = card("creosote", 200, 80, 140, 120);
    const phenol = card("phenol", 400, 80, 140, 120);
    const benzene = card("benzene", 560, 80, 140, 120);
    const naphtha = card("naphtha", 480, 320, 140, 120);
    const obstacles = [tower, creosote, phenol, benzene, naphtha];
    const requests = [creosote, phenol, benzene, naphtha].map((drawer, index) =>
      request({
        edgeId: `to-${drawer.id}`,
        order: index,
        sources: rim(tower),
        targets: rim(drawer),
        strokeWidth: 8,
        sourceCardId: tower.id,
        targetCardId: drawer.id,
      }),
    );
    const solved = solveGridRoutes(obstacles, requests);
    for (const routed of solved.values()) {
      expect(routed.points.length).toBeGreaterThanOrEqual(2);
      expect(isOrthogonal(routed.points)).toBe(true);
      for (const obstacle of obstacles) {
        expect(violatesMargin(routed.points, obstacle)).toBe(false);
      }
    }
    expect(countCrossings(solved)).toBe(0);
    // The wire heading straight over the top leaves by the top.
    expect(solved.get("to-creosote")!.points[0].y).toBe(tower.top);
    // The wire heading right leaves by the right.
    expect(solved.get("to-naphtha")!.points[0].x).toBe(tower.right);
  });

  it("two wires between the same pair of cards run parallel, never swapped", () => {
    const left = card("left", 0, 0);
    const right = card("right", 600, 0);
    const obstacles = [left, right];
    const requests = ["a", "b"].map((id, index) =>
      request({
        edgeId: id,
        order: index,
        sources: rim(left),
        targets: rim(right),
        strokeWidth: 8,
        sourceCardId: left.id,
        targetCardId: right.id,
      }),
    );
    const solved = solveGridRoutes(obstacles, requests);
    expect(countCrossings(solved)).toBe(0);
  });

  it("a later wire can move an earlier one out of its way", () => {
    // A leaves first, straight down from the card's centre; B then has to
    // get from the card's left end to a drawer below-right of A's target.
    // Alone, B would cross A. Negotiation moves whichever of them costs
    // less to move, and the board ends with no crossing.
    const top = card("top", 0, 0, 440, 160);
    const near = card("near", 100, 400, 140, 120);
    const far = card("far", 400, 600, 140, 120);
    const obstacles = [top, near, far];
    const requests = [
      request({ edgeId: "a", order: 0, sources: rim(top), targets: rim(near), strokeWidth: 8, sourceCardId: "top", targetCardId: "near" }),
      request({ edgeId: "b", order: 1, sources: rim(top), targets: rim(far), strokeWidth: 8, sourceCardId: "top", targetCardId: "far" }),
    ];
    const solved = solveGridRoutes(obstacles, requests);
    expect(countCrossings(solved)).toBe(0);
  });
});

describe("exits and landings", () => {
  it("two cards a cell apart take the straight shot", () => {
    const machine = card("machine", 0, 0, 440, 300);
    const drawer = card("drawer", 460, 100, 100, 80);
    const solved = solveGridRoutes(
      [machine, drawer],
      [
        request({
          edgeId: "e1",
          sources: rim(machine),
          targets: rim(drawer),
          sourceCardId: "machine",
          targetCardId: "drawer",
        }),
      ],
    );
    const points = solved.get("e1")!.points;
    expect(points).toHaveLength(2);
    expect(points[0].x).toBe(440);
    expect(points[1].x).toBe(460);
    expect(points[0].y).toBe(points[1].y);
  });

  it("aligned ports go straight rather than out at 45 and back", () => {
    // Out at 45°, one bend, straight in must never beat the straight shot.
    const a = card("a", 0, 0, 440, 300);
    const b = card("b", 600, 0, 440, 300);
    const solved = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 440, y: 140, side: "right" }],
          targets: [{ x: 600, y: 140, side: "left" }],
        }),
      ],
    );
    const points = solved.get("e1")!.points;
    expect(points.every((point) => Math.abs(point.y - 140) < 0.01)).toBe(true);
  });
});

describe("straight shots and self loops", () => {
  it("a one-cell diagonal gap uses a visible square elbow", () => {
    const route = solveGridRoutes([], [request({
      edgeId: "short",
      sources: [{ x: 0, y: 0, side: "right" }],
      targets: [{ x: 20, y: 20, side: "top" }],
    })]).get("short")!;
    expect(route.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]);
  });

  it("nearby staggered cards keep their connection and use square bends", () => {
    const a = card("a", 0, 0, 440, 300);
    const b = card("b", 460, 300, 100, 80);
    const route = solveGridRoutes([a, b], [request({
      edgeId: "short",
      sources: [{ x: 440, y: 280, side: "right" }],
      targets: [{ x: 480, y: 300, side: "top" }],
      sourceCardId: "a", targetCardId: "b",
    })]).get("short")!;
    expect(route.points.length).toBeGreaterThan(2);
    expect(segments(route.points).every(({ a, b }) => a.x === b.x || a.y === b.y)).toBe(true);
  });

  it("diagonal runs span at least two cells, while long diagonals remain available", () => {
    let diagonalCount = 0;
    for (const y of [20, 40, 60, 100, 160]) {
      const route = solveGridRoutes([], [request({
        edgeId: "diagonal",
        sources: [{ x: 0, y: 0, side: "right" }],
        targets: [{ x: 200, y, side: "left" }],
      })]).get("diagonal")!;
      expect(route.points.length).toBeGreaterThan(1);
      for (const { a, b } of segments(route.points)) {
        if (a.x === b.x || a.y === b.y) continue;
        diagonalCount += 1;
        expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(40);
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(40);
      }
    }
    expect(diagonalCount).toBeGreaterThan(0);
  });

  it("two cards two cells apart take the straight shot", () => {
    const machine = card("machine", 0, 0, 440, 300);
    const drawer = card("drawer", 480, 100, 100, 80);
    const solved = solveGridRoutes(
      [machine, drawer],
      [
        request({
          edgeId: "e1",
          sources: rim(machine),
          targets: rim(drawer),
          sourceCardId: "machine",
          targetCardId: "drawer",
        }),
      ],
    );
    const points = solved.get("e1")!.points;
    expect(points).toHaveLength(2);
    expect(points[0].x).toBe(440);
    expect(points[1].x).toBe(480);
    expect(points[0].y).toBe(points[1].y);
  });

  it("neighbouring cards cannot earn diagonals by moving their docks farther apart", () => {
    const a = card("a", 0, 0, 440, 300);
    const b = card("b", 460, 320, 360, 300);
    const points = solveGridRoutes([a, b], [request({
      edgeId: "roof", sources: rim(a), targets: rim(b), sourceCardId: "a", targetCardId: "b",
    })]).get("roof")!.points;
    expect(points.length).toBeGreaterThan(2);
    expect(segments(points).every(({ a, b }) => a.x === b.x || a.y === b.y)).toBe(true);
    expect(segments(points).some(({ a, b }) => Math.hypot(a.x - b.x, a.y - b.y) >= 40)).toBe(true);
    const first = points[0], last = points[points.length - 1];
    expect(Math.abs(last.x - first.x) + Math.abs(last.y - first.y)).toBeGreaterThanOrEqual(120);
  });

  it("reserves diagonals for trips of at least six grid spaces, including at the docks", () => {
    for (const cells of [3, 4, 5, 6, 20, 100]) {
      const points = solveGridRoutes([], [request({
        edgeId: "trip", sources: [{ x: 0, y: 0, side: "right" }],
        targets: [{ x: cells * 20, y: cells * 20, side: "left" }],
      })]).get("trip")!.points;
      expect(points.length).toBeGreaterThan(1);
      const diagonal = segments(points).filter(({ a, b }) => a.x !== b.x && a.y !== b.y);
      if (cells < 6) expect(diagonal).toHaveLength(0);
      else {
        expect(diagonal.length).toBeGreaterThan(0);
        // Long trips may leave diagonally immediately.
        expect(points[1].x).not.toBe(points[0].x);
        expect(points[1].y).not.toBe(points[0].y);
      }
    }
  });

  it("keeps a one-cell connection when only fixed facing docks are available", () => {
    const points = solveGridRoutes([], [request({
      edgeId: "fixed", sources: [{ x: 0, y: 0, side: "right" }],
      targets: [{ x: 20, y: 0, side: "left" }],
    })]).get("fixed")!.points;
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });

  it("can turn off the breathing-room preference with the routing dial", () => {
    const a = card("a", 0, 0, 440, 300), b = card("b", 460, 300, 100, 80);
    const points = solveGridRoutes([a, b], [request({
      edgeId: "short", sources: rim(a), targets: rim(b), sourceCardId: "a", targetCardId: "b",
    })], undefined, { ...DEFAULT_ROUTER_TUNING, dockTravelCells: 0, earlyTurn: 0 }).get("short")!.points;
    const first = points[0], last = points[points.length - 1];
    expect(Math.abs(last.x - first.x) + Math.abs(last.y - first.y)).toBeLessThan(120);
  });

  it("a straight shot of any length beats leaving by another side", () => {
    const machine = card("machine", 0, 0, 440, 300);
    const drawer = card("drawer", 640, 100, 100, 80);
    const solved = solveGridRoutes(
      [machine, drawer],
      [
        request({
          edgeId: "e1",
          sources: rim(machine),
          targets: rim(drawer),
          sourceCardId: "machine",
          targetCardId: "drawer",
        }),
      ],
    );
    const points = solved.get("e1")!.points;
    expect(points.length).toBe(2);
    expect(points[0].y).toBe(points[1].y);
  });

  it("a card wired to itself docks freely, turns only at 90 degrees, and lands a cell or more from its exit", () => {
    const machine = card("machine", 0, 0, 440, 300);
    const solved = solveGridRoutes(
      [machine],
      [
        request({
          edgeId: "loop",
          sources: rim(machine),
          targets: rim(machine),
          sourceCardId: "machine",
          targetCardId: "machine",
        }),
      ],
    );
    const points = solved.get("loop")!.points;
    expect(points.length).toBeGreaterThanOrEqual(3);
    const first = points[0];
    const last = points[points.length - 1];
    expect(Math.max(Math.abs(first.x - last.x), Math.abs(first.y - last.y))).toBeGreaterThanOrEqual(20);
    // Ninety-degree turns only: every run is horizontal or vertical.
    expect(isOrthogonal(points)).toBe(true);
  });
});

describe("docks on cards off the grid", () => {
  /** Distance from a point to the rect's border: 0 when the point lies on it. */
  function borderGap(point: GridPoint, rect: GridObstacle): number {
    const outside = Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom),
    );
    if (outside > 0) return outside;
    return Math.min(point.x - rect.left, rect.right - point.x, point.y - rect.top, rect.bottom - point.y);
  }

  function routeLength(points: GridPoint[]): number {
    return segments(points).reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
  }

  it("docks each side on the first grid line at or outside it, and the drawn stub reaches the border", () => {
    // A card in a group whose corner sits on the mod's 10 px grid: half a cell off.
    const docks = cardRimDocks({ left: 10, top: -170, right: 330, bottom: 30 });
    const bySide = (side: GridEndpoint["side"]) => docks.filter((dock) => dock.side === side);
    expect(bySide("top").every((dock) => dock.y === -180 && dock.stubDepth === 10)).toBe(true);
    expect(bySide("bottom").every((dock) => dock.y === 40 && dock.stubDepth === 10)).toBe(true);
    expect(bySide("left").every((dock) => dock.x === 0 && dock.stubDepth === 10)).toBe(true);
    expect(bySide("right").every((dock) => dock.x === 340 && dock.stubDepth === 10)).toBe(true);
    // Docks along a side stay within the card's own span.
    expect(bySide("top").every((dock) => dock.x > 10 && dock.x < 330)).toBe(true);
    expect(bySide("left").every((dock) => dock.y > -170 && dock.y < 30)).toBe(true);
  });

  it("a clean drawer's 116 x 48 box docks outside its right and bottom sides", () => {
    const docks = cardRimDocks({ left: 0, top: 0, right: 116, bottom: 48 });
    const on = (side: GridEndpoint["side"]) => docks.filter((dock) => dock.side === side);
    expect(on("right").every((dock) => dock.x === 120 && dock.stubDepth === 4)).toBe(true);
    expect(on("bottom").every((dock) => dock.y === 60 && dock.stubDepth === 12)).toBe(true);
    expect([...on("top"), ...on("left")].every((dock) => dock.stubDepth === undefined)).toBe(true);
  });

  it("a card on the grid docks on its border with no stub", () => {
    const box = card("c", 0, 0, 320, 200);
    const docks = cardRimDocks(box);
    expect(docks.every((dock) => dock.stubDepth === undefined)).toBe(true);
    expect(docks.every((dock) => borderGap(dock, box) === 0)).toBe(true);
  });

  it("a card half a cell off the grid still sends its wire out of its top to the card above", () => {
    const above = card("above", 0, -400, 320, 160);
    const below = card("below", 0, -130, 320, 200);
    const solved = solveGridRoutes(
      [above, below],
      [
        request({
          edgeId: "up",
          sources: cardRimDocks(below),
          targets: cardRimDocks(above),
          sourceCardId: "below",
          targetCardId: "above",
        }),
      ],
    );
    const points = solved.get("up")!.points;
    expect(points[0].y).toBe(-130);
    expect(borderGap(points[points.length - 1], above)).toBe(0);
    expect(routeLength(points)).toBeLessThanOrEqual(140);
  });

  it("every wire end sits on its card's border, whatever the card's size", () => {
    const drawer = card("drawer", 0, 0, 116, 48);
    const machine = card("machine", 300, -100, 320, 330);
    const under = card("under", -40, 160, 320, 200);
    const wire = (edgeId: string, order: number, from: GridObstacle, to: GridObstacle) =>
      request({
        edgeId,
        order,
        sources: cardRimDocks(from),
        targets: cardRimDocks(to),
        sourceCardId: from.id,
        targetCardId: to.id,
      });
    const ends: Array<[string, GridObstacle, GridObstacle]> = [
      ["out", drawer, machine],
      ["down", drawer, under],
      ["back", machine, under],
    ];
    const solved = solveGridRoutes(
      [drawer, machine, under],
      ends.map(([id, from, to], order) => wire(id, order, from, to)),
    );
    for (const [id, from, to] of ends) {
      const points = solved.get(id)!.points;
      expect(borderGap(points[0], from), id).toBe(0);
      expect(borderGap(points[points.length - 1], to), id).toBe(0);
    }
  });

  it("a drawer less than a cell above a card connects straight across the gap", () => {
    const drawer = card("drawer", 0, -220, 116, 48);
    const machine = card("machine", -60, -160, 320, 200);
    const solved = solveGridRoutes(
      [drawer, machine],
      [
        request({
          edgeId: "e",
          sources: cardRimDocks(drawer),
          targets: cardRimDocks(machine),
          sourceCardId: "drawer",
          targetCardId: "machine",
        }),
      ],
    );
    const points = solved.get("e")!.points;
    expect(points.length).toBe(2);
    expect(points[0].x).toBe(points[1].x);
    expect(points[0].y).toBe(-172);
    expect(points[1].y).toBe(-160);
  });
});
