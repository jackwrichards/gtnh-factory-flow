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
  types (recipe, storage, annotation), the machine picker (tab strip + glance
  bar + compare table in `MachinePicker.tsx`), deterministic orthogonal edge
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

5. **Drags are frozen, drops reconcile.** While a node is dragged
   (`activelyDraggedNodeIds`), untouched edges keep their cached routes and do
   not re-render; edges on the dragged node fall back to cheap estimated
   endpoints and simple routing so they follow the pointer. The one full
   precise reroute happens on drop, against freshly published geometry.

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
  Playwright: edges follow a dragged node and reroute precisely on drop;
  untouched edges' paths do not change during someone else's drag; a node
  resize reroutes its edges; labels and arrowheads sit on their paths.

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
