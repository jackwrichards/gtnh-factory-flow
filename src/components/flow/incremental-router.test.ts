import { describe, expect, it } from "vitest";
import {
  cardRimDocks,
  solveGridRoutes,
  type GridObstacle,
  type GridRoutedEdge,
  type GridRouteRequest,
} from "./grid-edge-router";
import { IncrementalRouter, rectDifference, type IncrementalStats } from "./incremental-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";

function card(id: string, x: number, y: number, width = 360, height = 160): GridObstacle {
  return { id, left: x, top: y, right: x + width, bottom: y + height };
}

/** A wire between two cards, docking anywhere on their rims, as the board asks. */
function wire(edgeId: string, from: GridObstacle, to: GridObstacle, extra: Partial<GridRouteRequest> = {}): GridRouteRequest {
  return {
    edgeId,
    order: 0,
    sources: cardRimDocks(from),
    targets: cardRimDocks(to),
    sourceCardId: from.id,
    targetCardId: to.id,
    strokeWidth: 4,
    ...extra,
  };
}

/** A row of producer/consumer pairs far apart, plus one lone pair to move. */
function board(moverX = 0) {
  const cards: GridObstacle[] = [];
  const wires: GridRouteRequest[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = card(`a${i}`, 0, i * 400);
    const b = card(`b${i}`, 800, i * 400);
    cards.push(a, b);
    wires.push(wire(`w${i}`, a, b, { order: i }));
  }
  const m = card("m", 2000 + moverX, 0);
  const n = card("n", 2800, 0);
  cards.push(m, n);
  wires.push(wire("wm", m, n, { order: 9 }));
  return { cards, wires };
}

function solveWith(router: IncrementalRouter, scene: { cards: GridObstacle[]; wires: GridRouteRequest[] }, thorough = true) {
  const stats = {} as IncrementalStats;
  const routes = router.solve(scene.cards, scene.wires, DEFAULT_ROUTER_TUNING, { thorough, stats });
  return { routes, stats };
}

const pointsOf = (route: GridRoutedEdge | undefined) => JSON.stringify(route?.points);

describe("IncrementalRouter", () => {
  it("routes the whole board the first time, the same as a full solve", () => {
    const router = new IncrementalRouter();
    const scene = board();
    const { routes, stats } = solveWith(router, scene);
    expect(stats.fresh).toBe(true);
    const full = solveGridRoutes(scene.cards, scene.wires, undefined, DEFAULT_ROUTER_TUNING);
    for (const [id, route] of full) {
      expect(pointsOf(routes.get(id))).toBe(pointsOf(route));
    }
  });

  it("routes again only the wire at a card that moved, and keeps the rest exactly", () => {
    const router = new IncrementalRouter();
    const before = solveWith(router, board()).routes;
    const { routes, stats } = solveWith(router, board(200));
    expect(stats.fresh).toBe(false);
    expect(stats.routed).toBe(1);
    expect(stats.kept).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      expect(pointsOf(routes.get(`w${i}`))).toBe(pointsOf(before.get(`w${i}`)));
    }
    expect(pointsOf(routes.get("wm"))).not.toBe(pointsOf(before.get("wm")));
  });

  it("routes again a kept wire that a card now stands across", () => {
    const router = new IncrementalRouter();
    const scene = board();
    solveWith(router, scene);
    // A new card dropped right between a0 and b0, on their wire's line.
    const blocker = card("x", 440, 0, 200, 160);
    const { routes, stats } = solveWith(router, { cards: [...scene.cards, blocker], wires: scene.wires });
    expect(stats.fresh).toBe(false);
    expect(stats.routed).toBe(1);
    const w0 = routes.get("w0")!;
    // The new route keeps clear of the blocker.
    for (let i = 1; i < w0.points.length; i += 1) {
      const a = w0.points[i - 1];
      const b = w0.points[i];
      const inside = (p: { x: number; y: number }) =>
        p.x > blocker.left && p.x < blocker.right && p.y > blocker.top && p.y < blocker.bottom;
      expect(inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(false);
    }
  });

  it("routes again a kept wire that hugged a card that left", () => {
    const router = new IncrementalRouter();
    const scene = board();
    const blocker = card("x", 440, 0, 200, 160);
    solveWith(router, { cards: [...scene.cards, blocker], wires: scene.wires });
    const { stats } = solveWith(router, scene);
    expect(stats.routed).toBe(1);
  });

  it("routes rough wires again on the thorough solve that follows, even with nothing moved", () => {
    const router = new IncrementalRouter();
    solveWith(router, board());
    solveWith(router, board(200), false);
    const { stats } = solveWith(router, board(200), true);
    expect(stats.fresh).toBe(false);
    expect(stats.routed).toBe(1);
  });

  it("solves afresh when most of the board moved, or the dials changed", () => {
    const router = new IncrementalRouter();
    const scene = board();
    solveWith(router, scene);
    const shifted = {
      cards: scene.cards.map((c) => ({ ...c, left: c.left + 40, right: c.right + 40 })),
      wires: scene.wires.map((w) => ({
        ...w,
        sources: w.sources.map((e) => ({ ...e, x: e.x + 40 })),
        targets: w.targets.map((e) => ({ ...e, x: e.x + 40 })),
      })),
    };
    expect(solveWith(router, shifted).stats.fresh).toBe(true);
    const stats = {} as IncrementalStats;
    router.solve(shifted.cards, shifted.wires, { ...DEFAULT_ROUTER_TUNING, turn90: 81 }, { thorough: true, stats });
    expect(stats.fresh).toBe(true);
  });

  it("routes again a wire whose request changed, and forgets wires that are gone", () => {
    const router = new IncrementalRouter();
    const scene = board();
    solveWith(router, scene);
    const wires = scene.wires
      .filter((w) => w.edgeId !== "w4")
      .map((w) => (w.edgeId === "w1" ? { ...w, waypoints: [{ x: 600, y: 700 }] } : w));
    const { routes, stats } = solveWith(router, { cards: scene.cards, wires });
    expect(stats.routed).toBe(1);
    expect(routes.has("w4")).toBe(false);
  });

  it("starts from a stored state: the same board routes nothing again", () => {
    const first = new IncrementalRouter();
    const before = solveWith(first, board()).routes;
    const stored = JSON.parse(JSON.stringify(first.snapshot()));
    const second = new IncrementalRouter();
    second.restore(stored);
    const { routes, stats } = solveWith(second, board());
    expect(stats.fresh).toBe(false);
    expect(stats.routed).toBe(0);
    expect(pointsOf(routes.get("w2"))).toBe(pointsOf(before.get("w2")));
  });

  it("keeps a route whose width changed, drawn at the new width", () => {
    const router = new IncrementalRouter();
    const scene = board();
    const before = solveWith(router, scene).routes;
    const wires = scene.wires.map((w) => (w.edgeId === "w1" ? { ...w, strokeWidth: 8 } : w));
    const { routes, stats } = solveWith(router, { cards: scene.cards, wires });
    expect(stats.routed).toBe(0);
    expect(routes.get("w1")!.width).toBe(8);
    expect(routes.get("w1")!.vertices).toEqual(before.get("w1")!.vertices);
  });
});

describe("rectDifference", () => {
  it("is both rectangles when they are apart", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 20, top: 0, right: 30, bottom: 10 };
    expect(rectDifference(a, b)).toEqual([a, b]);
  });

  it("is the new row when a rectangle grows downward", () => {
    const a = { left: 0, top: 0, right: 100, bottom: 100 };
    const b = { left: 0, top: 0, right: 100, bottom: 140 };
    expect(rectDifference(a, b)).toEqual([{ left: 0, top: 100, right: 100, bottom: 140 }]);
  });
});

describe("square ends", () => {
  it("meets a drawer square to its side even when the wire turns diagonal later", () => {
    const machine = card("m", 0, 0, 360, 160);
    const drawer = card("d", 900, 600, 120, 40);
    const landing = (square: boolean) => {
      const request = wire("w", machine, drawer, { targetSquare: square });
      const points = solveGridRoutes([machine, drawer], [request], undefined, DEFAULT_ROUTER_TUNING).get("w")!.points;
      const last = points[points.length - 1];
      const before = points[points.length - 2];
      return last.x === before.x || last.y === before.y ? "square" : "slant";
    };
    // Free to, the wire lands on the drawer's corner at 45°; square, it does not.
    expect(landing(false)).toBe("slant");
    expect(landing(true)).toBe("square");
  });
});
