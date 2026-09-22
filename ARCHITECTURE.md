# GTNH Factory Flow — Architecture & Performance Guide

This document explains how the whole project fits together and codifies the
performance rules the codebase is built around. Read it before making changes
that touch the flow board, the routing system, or the dataset pipeline.
`README.md` covers setup and licensing; `AGENTS.md` covers working conventions;
this file covers *how it works and why it stays fast*.

## What the app is

A production-chain planner for GregTech: New Horizons. Users search real GTNH
recipes, place them as NEI-style machine nodes on an infinite canvas, wire
outputs to inputs, and the solver computes throughput, machine counts,
utilization, EU/t, bottlenecks, and surplus/deficit — live, for the whole
graph. Plans persist locally (IndexedDB, multiple designs), can be exported and
imported as validated JSON, and can be shared through the community hub
(Supabase-backed).

The live deployment is https://gtnhplanner.com (DigitalOcean droplet, Caddy +
systemd, zero-downtime deploys via `/opt/deploy.sh`).

## The three layers

### 1. Dataset pipeline (offline, `tools/dataset-pipeline/`)

Real recipe data never comes from wikis or hand-written tables. A Forge mod
(`gtnh-calc-oracle`) runs inside an actual GTNH client, exports every recipe
map, NEI layout, machine catalyst, multiblock config, and crop registry, and
renders real item icons. Node scripts then normalize that raw export:

- `normalize-oracle-export.mjs` — raw oracle JSON → normalized `RecipeDataset`
  (recipe maps, machine handler families, `machineHandlerIcons`, furnace
  folding, oredict membership).
- `machine-configs.mjs` — machine handler templates: tier variants folded into
  families, catalyst items, absolute duration/EUt overrides, config controls
  (coils, parallels, casings) as structured data.
- `build-resource-index.mjs` / `build-recipe-index.mjs` — search and lookup
  indexes, shipped gzipped.

Datasets live outside git (`public/datasets/gtnh/` locally,
`/opt/shared/gtnh-datasets` on the droplet) and are versioned per GTNH release
(stable + daily channels) with a manifest. The browser only ever consumes the
normalized model — raw exporter output must never reach UI or solver code.

### 2. Domain and solver (`src/lib/`)

- `model/` — normalized types, Zod schemas, recipe rules (overclocking, machine
  handler application, steam detection, tier gating), fuels, resource keys.
- `solver/` — pure TypeScript throughput solver. No DOM, no React; takes a
  project graph, returns per-node/per-edge/per-storage results. Runs on every
  graph mutation, so it must stay allocation-light and side-effect free.
- `datasets/` — dataset schemas and browser cache; `server/dataset-query.ts`
  answers search/catalog/recipe API routes from preloaded indexes.

### 3. UI (`src/app/`, `src/components/`, `src/store/`)

Next.js App Router + Tailwind + Zustand. The two big surfaces:

- **Recipe finder** (`RecipeBrowser.tsx`) — NEI-style search, category rail,
  machine strips, paginated API-backed browsing.
- **Flow board** (`components/flow/`) — React Flow canvas with custom node
  types (recipe, storage, annotation), the machine picker (the chevron menu
  under the name bar, `MachineMenu` in `MachinePicker.tsx`), deterministic orthogonal edge
  routing with obstacle avoidance, edge labels, and the paint/annotation tools.

State: `store/factory-store.ts` owns the project graph, solver results, and
selection/hover state. Designs persist to IndexedDB
(`lib/designs/design-storage.ts`); the active design id sits in localStorage.

## How the flow board stays fast

This is the part of the codebase where performance is a hard requirement, not
a nice-to-have. The board must stay smooth on weak PCs with 100+ heavy NEI
nodes. Everything below was validated with profiled stress tests (120 nodes /
60 edges at 6× CPU throttle); keep it true.

### The core invariants

1. **Routing is viewport-independent.** Routes may only depend on flow-space
   geometry: node positions, node sizes, endpoints. Never on zoom, pan, or
   which nodes happen to be mounted. `onlyRenderVisibleElements` culls
   off-screen nodes from the DOM, so *anything* derived from the DOM is
   secretly viewport-dependent — that class of bug caused full-board reroutes
   on every pan frame.

2. **Geometry is published, not measured ad hoc.** `publishBoardGeometry` in
   `FactoryFlow.tsx` snapshots every node's position + measured size into
   module state (`publishedBoardGeometryById` / `publishedBoardBounds`). The
   route obstacle sweep and slot endpoints read from that snapshot. It
   refreshes only when the geometry *fingerprint* changes — and explicitly on
   drag-drop, because React Flow streams the final position into state during
   the last drag frame, so the fingerprint alone cannot see the drop.

3. **Caches are invalidated by content, not by churn.** `flowNodes` changes
   identity constantly (hover zIndex, solver results, drag frames). None of
   that moves geometry. Invalidation keys on fingerprints of what actually
   matters: positions + rounded sizes. React Flow's `measured` sizes must be
   preserved when rebuilding node objects from the project, or every rebuild
   looks like a board-wide resize.

4. **Identity is currency.** React Flow re-renders what changes identity.
   - Node `data` goes through `reuseObjectIdentity` (shallow).
   - Edge objects go through `reuseDeepObjectIdentity` (structural), with a
     `layoutEpoch` field as the deliberate cache-bust for real size changes.
   - Node components use custom `memo` comparators on exactly the props they
     read (`data`, `selected`, size for annotations) because React Flow passes
     live position props that would defeat the default comparison every drag
     frame.
   - Static children of `FactoryFlow` (toolbars) are memoized with stable
     callbacks — FactoryFlow re-renders every drag frame and takes
     non-memoized children with it.

5. **Drags are frozen, drops reconcile.** While a node (or an edge waypoint
   dot) is dragged, EVERY wire keeps its last solved route - no pointer-
   chasing approximation; a preview that guesses differently from the
   drop's real solve reads as the board lying. The one full reroute
   happens on drop, against freshly published geometry.

6. **Route scoring is local.** Candidates are scored only against obstacles
   and edge segments inside the candidates' own reach envelope (padded by the
   scorer's clearance). Scores are identical to scoring the whole board;
   the cost is not. Never reintroduce O(all nodes × all edges) scoring.

7. **Slot endpoints survive unmounts.** Measured slot points are cached
   *relative to their node*, keyed by node size (a slot can't move within its
   node unless the node changes size). Absolute positions come from the
   published geometry, so endpoints stay stable while a node is culled.
   DOM probes are scoped to the node element and bail immediately when the
   node isn't mounted; misses are never cached.

8. **Board-wide hover effects are painted, not rendered.** The zoomed-out hop
   map (`hop-map.ts`) colours every card by its wire distance from the hovered
   one. It writes CSS custom properties straight onto the node elements and
   lets rules in `globals.css` do the painting; the first cut subscribed each
   card to the map through `useSyncExternalStore` and cost 5× the frame rate
   (363 → 66 fps, 156 nodes at 4× throttle) purely in reconciliation. If an
   effect touches every node at once, it does not belong in React. The map is
   also gated on the glance detail step, settles before it paints, and is
   dropped on pan/zoom, because culled nodes cannot be painted.

### The board grid

`src/lib/board-grid.ts` owns one number, `BOARD_GRID = 20`, and every size on
the canvas is derived from it. This is an invariant, not a preference — there
is no snap toggle any more.

1. **Positions are cell corners.** React Flow snaps drags; the store snaps
   every programmatic placement (creation, clone, wire-drop); and
   `normalizeLoadedProject` snaps whole plans on the way in, so old designs
   land on the grid the first time they are opened.
2. **Card sizes are whole cells.** Recipe cards are a fixed 360 wide. Drawers
   and tanks are 180×80, with artwork beside their name and rate.
3. **Port rows are the vertical unit.** A port row is 40px (two cells) with no
   gaps between rows, and the head above the rails is one 40px title row
   (the machine tab strip that used to add rows above it is gone). Port
   centres therefore land on grid lines at `head + 20 + 40i`, which is what
   makes slot endpoints grid-aligned.
4. **The recipe card's frame is an inset shadow, not a border.** A real border
   sits outside the content box and would push every row 2px off the grid.
5. **Content-driven blocks grow, never compress.** The footer and the config
   panels hold text whose height depends on the recipe, so they use
   `GridBlock`: a ResizeObserver rounds them UP to the next whole cell. It
   fires on content change only — never per frame — but do not reach for it
   where the height is already deterministic.

Anything that sets a width, height, or offset on the board should be a
multiple of `BOARD_GRID` or built from the tokens in `board-grid.ts`.

Wires live on the grid too (`grid-edge-router.ts`): a pure, deterministic
A* over the Hanan lines of the margin-inflated cards, solved for ALL edges
at once so lanes can be shared. Each 20px line is a lane with 16 usable px;
wire widths are lane fractions, side-by-side sharing is slightly cheaper
than an empty lane (that is what forms ribbons), overflow is expensive
(that is what prevents overlap), and only port stubs may stack. The host
side (`ensureGridSolve` in FactoryFlow) publishes the edge list from the
`flowEdges` memo, resolves measured port anchors, fingerprints everything
(sweep hash + endpoints + widths — never hover state), and parks routes in
`directRouteCache`; a stamp/epoch gate keeps the check O(1) per edge
render. Mid-drag, boards that can afford it rerun the REAL solve on a
throttle (`LIVE_DRAG_SOLVE_MS`) so wires follow the held card to exactly
where they will rest — never a pointer-chasing guess — and the route morph
(`board-motion.tsx`) glides between beats. The board decides affordability
itself, never a toggle: annotation-only drags never solve (ink is not an
obstacle), boards past `LIVE_DRAG_ROUTE_EDGE_LIMIT` freeze outright, and
each solve is timed through to paint — one over `LIVE_DRAG_BUDGET_MS`
freezes later drags until the board shrinks well below the size that
lagged. Frozen means what it always did: cached routes until the drop.

The solve itself has three things keeping it cheap on a big board, all in
`grid-edge-router.ts`: lane occupancy is keyed by packed integers, not
strings (a string per cell per ask was most of the cost of a 150-wire
board); every RUN between two neighbouring window vertices is priced once
per attempt (blocked, or distance x lane factor x frame penalty) and every
leg, direction and revisit reads it back; and the A* pop cap scales with
the window (`MIN_ASTAR_POPS` or two pops per state, whichever is larger).
The old flat 40k cap was smaller than a busy board's window, so long wires
between boards failed on size alone, grew the window, failed again, and
were drawn as L's through cards after a quarter second each. A wire whose
end is walled in (a drawer packed against its neighbours) is found by a
cost-free flood before the A* spends anything, and `SEALED` skips the
window growth, because growth adds lines only outside the current window.

Past `ASYNC_ROUTE_EDGE_LIMIT` wires the solve leaves the main thread
(`grid-route-solve.ts`, `grid-route.worker.ts`), the same shape as the LP
worker in `solve-books.ts`: the render keeps serving the routes already
installed (`gridSolveSignature` does not move until the answer lands),
`installSolvedRoutes` parks the result and re-issues the edges, and the
route morph glides them over. One job in flight, only the newest waiting
job kept, and a sequence number per request so a late answer never lands
over a fresher one. Endpoints ride as one Float64Array because a request
carries a card's whole perimeter as candidate docks. Small boards still
solve synchronously in render so their wires never lag a frame behind the
held card; the routing invariant is untouched because the worker runs the
same pure function on the same flow-space inputs.

### Rules of thumb for new board code

- Never call `querySelectorAll`/`getBoundingClientRect` per edge, per node, or
  per frame. Measure once, cache by content key, read from the cache.
- Never subscribe a per-node/per-edge component to a value that changes every
  frame (raw zoom, pointer position). Derive a coarse threshold (see
  `edge-detail.ts`) or read on demand via the store API.
- Hover state must not rebuild the world. If a hover changes one node's
  z-index, exactly one wrapper should re-render.
- Anything O(nodes) per frame is suspect; anything O(nodes × edges) per frame
  is a bug.
- After touching board internals, re-verify the behavioral contracts with
  Playwright: on a small board, mid-drag routes are real solved routes that
  track the held card and match the drop's final solve; on a board past
  `LIVE_DRAG_ROUTE_EDGE_LIMIT` wires, edges hold their routes during a drag
  and reroute precisely on drop; a node resize reroutes its edges; labels
  and arrowheads sit on their paths.

### How to profile (the stress workflow)

Dev-mode React inflates everything (`jsxDEV`, prop validation) — production is
meaningfully faster — but relative regressions still show. The workflow that
found every issue so far:

1. Build a seed plan through the UI, dump it from IndexedDB
   (`gtnh-factory-flow-designs` → `design-plans`).
2. Clone the cluster N times with fresh ids, write it back, reload.
3. Drive pan / zoom / drag / hover with Playwright while sampling the CDP
   `Profiler` (250µs) and rAF frame deltas, optionally with
   `Emulation.setCPUThrottlingRate` (6–20×) to simulate weak hardware.
4. Aggregate self-time per function; if route scoring functions
   (`scoreEdgeRoute`, `segmentsIntersect`, …) appear during pan/zoom/hover,
   something is invalidating caches that shouldn't be.

## Deployment & data flow in production

- Droplet: `gtnh-flow` (DigitalOcean), Caddy on :80/:443 → Next.js on :3000,
  systemd unit `gtnh-flow.service`, releases under `/opt/releases/` with a
  `/opt/gtnh-flow` symlink; `/opt/deploy.sh` clones `main`, builds beside the
  live app, swaps the symlink (≈5s restart + ~60s prewarm).
- Shutdown is bounded by `TimeoutStopSec=10s` in
  `/etc/systemd/system/gtnh-flow.service.d/shutdown.conf`. The old 90-second
  default let a stuck Next.js shutdown cause Cloudflare host errors during
  the September 11 release. Dataset prewarming still runs after startup.
- Datasets are runtime files in `/opt/shared/gtnh-datasets`, symlinked into
  each release after build; they are uploaded separately from code deploys.
- Community hub (accounts, shared plans, votes) uses Supabase via
  `/api/community/*`; analytics via self-hosted Umami.

## Testing

- `npm run typecheck` and `npm run test` (Vitest, ~336 tests) must pass before
  any commit.
- Visual/interaction changes are verified with Playwright screenshots at
  http://localhost:3000 — the board is interaction-heavy and unit tests cannot
  see routing, layering, or hover behavior.
- Dataset/normalizer changes get targeted synthetic checks plus a rebuild of
  both dataset versions before shipping.
