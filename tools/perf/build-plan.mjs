/**
 * Builds a stress plan out of REAL GTNH recipes pulled from the running app's
 * dataset API.
 *
 * Random recipes barely chain (300 recipes drawn from the whole game share
 * almost no resources), so the pool is fetched wide and then a densely
 * connected subgraph is grown out of it: pick the resources with both
 * producers and consumers present, seed from the densest one, and keep adding
 * whichever recipe wires into what is already selected. The result is a plan
 * shaped like a real factory - long chains, hubs, fan-out - not a grid of
 * isolated cards.
 *
 * Usage: node tools/perf/build-plan.mjs --nodes 300 --out plan.json
 */
import { writeFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const NODE_COUNT = Number(args.get("nodes") ?? 300);
const MAX_EDGES = Number(args.get("edges") ?? Number.POSITIVE_INFINITY);
const BASE = args.get("base") ?? "http://localhost:3000";
const OUT = args.get("out") ?? "plan.json";
const VERSION = args.get("version") ?? "local-2.9.0-beta-2";
const POOL = Number(args.get("pool") ?? 4000);
const COLUMNS = Number(args.get("columns") ?? Math.ceil(Math.sqrt(NODE_COUNT)));
const COL_GAP = Number(args.get("colGap") ?? 640);
const ROW_GAP = Number(args.get("rowGap") ?? 560);
const FANOUT = Number(args.get("fanout") ?? 4);

const QUERIES = [
  "", "dust", "plate", "ingot", "circuit", "wire", "rod", "gear", "foil", "bolt",
  "alloy", "steel", "copper", "iron", "aluminium", "titanium", "tungsten",
  "chemical", "acid", "gas", "oil", "polymer", "rubber", "glass", "silicon",
  "water", "hydrogen", "oxygen", "carbon", "sulfur", "nitrogen", "chlorine",
  "ore", "crushed", "purified", "centrifuge", "mixer", "assembler", "smelt",
];

async function fetchPool(limit) {
  const byId = new Map();
  for (const query of QUERIES) {
    for (let offset = 0; offset < 360; offset += 120) {
      if (byId.size >= limit) break;
      const url = `${BASE}/api/datasets/${VERSION}/recipes?query=${encodeURIComponent(query)}&limit=120&offset=${offset}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} -> ${response.status}`);
      const payload = await response.json();
      const page = payload.recipes ?? payload.items ?? payload.results ?? [];
      if (page.length === 0) break;
      for (const recipe of page) {
        if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
      }
    }
    if (byId.size >= limit) break;
  }
  return [...byId.values()];
}

const key = (resource) => `${resource.kind}:${resource.id}`;

const pool = await fetchPool(POOL);
console.error(`pool: ${pool.length} recipes`);

const producers = new Map(); // resourceKey -> recipe[]
const consumers = new Map();
for (const recipe of pool) {
  for (const output of recipe.outputs ?? []) {
    const k = key(output);
    if (!producers.has(k)) producers.set(k, []);
    producers.get(k).push(recipe);
  }
  for (const input of recipe.inputs ?? []) {
    const k = key(input);
    if (!consumers.has(k)) consumers.set(k, []);
    consumers.get(k).push(recipe);
  }
}

// Resources that actually link two recipes in the pool, densest first.
const linkResources = [...producers.keys()]
  .filter((k) => consumers.has(k))
  .sort(
    (a, b) =>
      Math.min(producers.get(b).length, consumers.get(b).length) -
      Math.min(producers.get(a).length, consumers.get(a).length),
  );
console.error(`linking resources: ${linkResources.length}`);
if (linkResources.length === 0) {
  throw new Error("No resource in the pool has both a producer and a consumer.");
}

// Grow the selection: always take a recipe that already wires into the set.
const selected = [];
const selectedIds = new Set();
const frontier = [];
const add = (recipe) => {
  if (selectedIds.has(recipe.id) || selected.length >= NODE_COUNT) return;
  selectedIds.add(recipe.id);
  selected.push(recipe);
  frontier.push(recipe);
};

for (const resourceKey of linkResources) {
  if (selected.length >= NODE_COUNT) break;
  producers.get(resourceKey).slice(0, 2).forEach(add);
  consumers.get(resourceKey).slice(0, 2).forEach(add);

  while (frontier.length > 0 && selected.length < NODE_COUNT) {
    const recipe = frontier.shift();
    for (const output of recipe.outputs ?? []) {
      (consumers.get(key(output)) ?? []).slice(0, 6).forEach(add);
    }
    for (const input of recipe.inputs ?? []) {
      (producers.get(key(input)) ?? []).slice(0, 6).forEach(add);
    }
  }
}
// Top up with anything left if the connected component ran dry.
for (const recipe of pool) {
  if (selected.length >= NODE_COUNT) break;
  add(recipe);
}
console.error(`selected: ${selected.length} recipes`);

const handleId = (side, resource) =>
  `${side}:${resource.kind}:${encodeURIComponent(resource.id)}`;

// One board node per selected recipe, laid out in selection (BFS) order so
// connected machines land near each other and the routes stay local.
const nodes = selected.map((recipe, index) => ({
  id: `stress-node-${index}`,
  recipeId: recipe.id,
  machineCount: 1,
  parallel: 1,
  overclockTier: recipe.minimumTier ?? "LV",
  enabled: true,
  position: {
    x: (index % COLUMNS) * COL_GAP,
    y: Math.floor(index / COLUMNS) * ROW_GAP,
  },
}));

const nodeIdsByInput = new Map(); // resourceKey -> nodeIndex[]
selected.forEach((recipe, index) => {
  for (const input of recipe.inputs ?? []) {
    const k = key(input);
    if (!nodeIdsByInput.has(k)) nodeIdsByInput.set(k, []);
    nodeIdsByInput.get(k).push(index);
  }
});

const edges = [];
const seenPairs = new Set();
selected.forEach((recipe, index) => {
  for (const output of recipe.outputs ?? []) {
    if (edges.length >= MAX_EDGES) return;
    const targets = nodeIdsByInput.get(key(output)) ?? [];
    let taken = 0;
    for (const targetIndex of targets) {
      if (targetIndex === index) continue;
      const pairKey = `${index}->${targetIndex}:${key(output)}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      edges.push({
        id: `stress-edge-${edges.length}`,
        source: nodes[index].id,
        target: nodes[targetIndex].id,
        sourceHandle: handleId("output", output),
        targetHandle: handleId("input", output),
        resourceKind: output.kind,
        resourceId: output.id,
      });
      taken += 1;
      if (taken >= FANOUT || edges.length >= MAX_EDGES) break;
    }
  }
});

const usedRecipeIds = new Set(nodes.map((node) => node.recipeId));
const project = {
  schemaVersion: 1,
  id: `stress-${NODE_COUNT}`,
  name: `Stress ${NODE_COUNT}`,
  recipes: selected.filter((recipe) => usedRecipeIds.has(recipe.id)),
  nodes,
  storages: [],
  annotations: [],
  edges,
  metadata: { source: "perf-stress" },
};

writeFileSync(OUT, JSON.stringify(project));
console.error(`wrote ${OUT}: ${nodes.length} nodes, ${edges.length} edges`);
