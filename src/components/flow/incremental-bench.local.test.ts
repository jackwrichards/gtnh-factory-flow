import { appendFileSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { measureRoutes, solveGridRoutes, type GridObstacle, type GridRouteRequest } from "./grid-edge-router";
import { IncrementalRouter, type IncrementalStats } from "./incremental-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";
import { routePoints } from "@/lib/route-metrics";

// Moves each card three cells right and two down, as a drag would (rough
// beats, then the thorough drop), and times the incremental router against a
// full solve of the same board.
function moved(cap: { obstacles: GridObstacle[]; requests: GridRouteRequest[] }, id: string, dx: number, dy: number) {
  const obstacles = cap.obstacles.map((o) =>
    o.id === id ? { ...o, left: o.left + dx, right: o.right + dx, top: o.top + dy, bottom: o.bottom + dy } : o,
  );
  const shift = (ends: GridRouteRequest["sources"], cardId: string | undefined) =>
    cardId === id ? ends.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })) : ends;
  const requests = cap.requests.map((r) => ({
    ...r,
    sources: shift(r.sources, r.sourceCardId),
    targets: shift(r.targets, r.targetCardId),
  }));
  return { obstacles, requests };
}

it("times incremental moves", { timeout: 600000 }, () => {
  for (const name of (process.env.CAPS ?? "").split(",")) {
    const cap = JSON.parse(readFileSync(`${process.env.DIR}/${name}.capture.json`, "utf8"));
    const router = new IncrementalRouter();
    let t = performance.now();
    router.solve(cap.obstacles, cap.requests, DEFAULT_ROUTER_TUNING, { thorough: true });
    const firstMs = performance.now() - t;
    const cards = cap.obstacles.filter((o: GridObstacle) => cap.requests.some((r: GridRouteRequest) => r.sourceCardId === o.id || r.targetCardId === o.id));
    const limit = Number(process.env.MOVES ?? 12);
    let roughMax = 0, roughSum = 0, dropMax = 0, dropSum = 0, fullSum = 0, n = 0, incPts = 0, fullPts = 0;
    for (const card of cards.slice(0, limit)) {
      const steps = [[20, 0], [40, 20], [60, 40]];
      let state = cap;
      for (const [dx, dy] of steps) {
        state = moved(cap, card.id, dx, dy);
        const stats = {} as IncrementalStats;
        t = performance.now();
        router.solve(state.obstacles, state.requests, DEFAULT_ROUTER_TUNING, { thorough: false, stats });
        const ms = performance.now() - t;
        roughMax = Math.max(roughMax, ms);
        roughSum += ms;
      }
      t = performance.now();
      const dropStats = {} as IncrementalStats;
      const inc = router.solve(state.obstacles, state.requests, DEFAULT_ROUTER_TUNING, { thorough: true, stats: dropStats });
      const dropMs = performance.now() - t;
      dropMax = Math.max(dropMax, dropMs);
      if (dropMs > 100) {
        const s = dropStats;
        appendFileSync(
          process.env.OUT ?? "bench.txt",
          `  slow drop ${card.id.slice(0, 14)} ${dropMs.toFixed(0)}ms fresh=${s.fresh} routed=${s.routed} kept=${s.kept} rerouted=${s.rerouted} pops=${s.pops} searches=${s.searches} first=${s.firstPassMs}\n`,
        );
      }
      dropSum += dropMs;
      t = performance.now();
      const full = solveGridRoutes(state.obstacles, state.requests, undefined, DEFAULT_ROUTER_TUNING);
      fullSum += performance.now() - t;
      incPts += routePoints(measureRoutes(inc.values()), DEFAULT_ROUTER_TUNING);
      fullPts += routePoints(measureRoutes(full.values()), DEFAULT_ROUTER_TUNING);
      n += 1;
      // Put it back, as a second drag would.
      router.solve(cap.obstacles, cap.requests, DEFAULT_ROUTER_TUNING, { thorough: true });
    }
    appendFileSync(process.env.OUT ?? "bench.txt",
      `${name} wires=${cap.requests.length} first=${firstMs.toFixed(0)}ms | per move: rough avg ${(roughSum / (3 * n)).toFixed(1)} max ${roughMax.toFixed(0)}ms, drop avg ${(dropSum / n).toFixed(1)} max ${dropMax.toFixed(0)}ms, full avg ${(fullSum / n).toFixed(0)}ms | points inc/full ${(incPts / fullPts).toFixed(3)}
`,
    );
  }
});
