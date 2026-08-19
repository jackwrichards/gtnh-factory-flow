// The brain: a ready-to-pass set of LlmTool definitions that let the LLM
// KNOW how to play GTNH. It is backed by three things, each an injectable port:
//   - the DatasetQuery (the repo's recipe/resource search, via dataset-adapter)
//   - the solver (calculateThroughput) for "is this layout balanced / what do I still need"
//   - the Executor (world_state) and the MemoryStore (recall / remember)
//
// The LLM reasons over these tools to turn a player's task into a concrete,
// ordered plan. It does not act directly — it calls finish_plan, and the loop
// hands the resulting actions to the Executor.
import { calculateThroughput } from "@/lib/solver";
import type {
  FactoryEdge,
  FactoryNode,
  FactoryProject,
  Recipe,
} from "@/lib/model/types";
import type {
  Action,
  Brain,
  DatasetQuery,
  DatasetRecipeDetail,
  Executor,
  LlmTool,
  MemoryStore,
  ResourceKind,
  ResourceRef,
  Vec3,
} from "./types";

// ---- arg coercion (LLM output is untrusted) -------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}
function asResourceRef(v: unknown): ResourceRef | undefined {
  const o = asObject(v);
  if (!o) return undefined;
  const kind = o.kind;
  const id = asString(o.id);
  if (kind !== "item" && kind !== "fluid" && kind !== "aspect" || !id) return undefined;
  return { kind, id, name: asString(o.name) };
}
function asVec3(v: unknown): Vec3 | undefined {
  const o = asObject(v);
  if (!o) return undefined;
  const x = asNumber(o.x);
  const y = asNumber(o.y);
  const z = asNumber(o.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}
function asAction(v: unknown): Action | undefined {
  const o = asObject(v);
  if (!o) return undefined;
  const type = asString(o.type);
  switch (type) {
    case "goto": {
      const at = asVec3(o.at);
      return at ? { type: "goto", at } : undefined;
    }
    case "place": {
      const at = asVec3(o.at);
      const item = asResourceRef(o.item);
      if (!at || !item) return undefined;
      const facing = asNumber(o.facing);
      return { type: "place", item, at, facing };
    }
    case "mine": {
      const at = asVec3(o.at);
      return at ? { type: "mine", at } : undefined;
    }
    case "insert": {
      const machine = asVec3(o.machine);
      const item = asResourceRef(o.item);
      const amount = asNumber(o.amount);
      if (!machine || !item || amount === undefined) return undefined;
      const slot = asNumber(o.slot);
      return { type: "insert", machine, item, amount, slot };
    }
    case "run": {
      const machine = asVec3(o.machine);
      return machine ? { type: "run", machine } : undefined;
    }
    case "collect": {
      const machine = asVec3(o.machine);
      const slot = asNumber(o.slot);
      return machine ? { type: "collect", machine, slot } : undefined;
    }
    case "pickup": {
      const at = asVec3(o.at);
      return at ? { type: "pickup", at } : undefined;
    }
    case "say": {
      const text = asString(o.text);
      return text ? { type: "say", text } : undefined;
    }
    case "wait": {
      const ticks = asNumber(o.ticks);
      return ticks ? { type: "wait", ticks } : undefined;
    }
    default:
      return undefined;
  }
}

// ---- JSON schemas (OpenAI tool-calling shape) -----------------------------

const RESOURCE_REF_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["item", "fluid", "aspect"] },
    id: { type: "string", description: "The resource id, e.g. 'gregtech:gt.metaitem.unified.2161'." },
    name: { type: "string", description: "Human name, when known." },
  },
  required: ["kind", "id"],
};

const VEC3_SCHEMA = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  required: ["x", "y", "z"],
};

const ACTION_SCHEMA = {
  type: "object",
  description:
    "One world action. Fields used depend on `type`: goto/mine/pickup use `at`; place uses `at`+`item`(+`facing`); insert uses `machine`+`item`+`amount`(+`slot`); run/collect use `machine`; say uses `text`; wait uses `ticks`.",
  properties: {
    type: {
      type: "string",
      enum: ["goto", "place", "mine", "insert", "run", "collect", "pickup", "say", "wait"],
    },
    at: VEC3_SCHEMA,
    machine: VEC3_SCHEMA,
    item: RESOURCE_REF_SCHEMA,
    amount: { type: "number" },
    facing: { type: "number", description: "0-15, facing direction for a placed block." },
    slot: { type: "number" },
    text: { type: "string" },
    ticks: { type: "number" },
  },
  required: ["type"],
};

// ---- recipe projection for the LLM ----------------------------------------

function toRecipeDetail(recipe: Recipe): DatasetRecipeDetail {
  return {
    id: recipe.id,
    name: recipe.name,
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    // Same agent-boundary cast as dataset-adapter.ts: an energy row (a
    // generator's output) reaches the LLM as data; the agent's types stay
    // their own item/fluid/aspect vocabulary.
    inputs: recipe.inputs.map((input) => ({
      kind: input.kind as ResourceKind,
      id: input.id,
      name: input.displayName,
      amount: input.amount,
    })),
    outputs: recipe.outputs.map((output) => ({
      kind: output.kind as ResourceKind,
      id: output.id,
      name: output.displayName,
      amount: output.amount,
      chance: output.chance,
    })),
    notes: recipe.notes,
    machineConfigControls: recipe.machineConfigControls,
    machineHandlers: recipe.machineHandlers,
  };
}

// ---- analyze_factory: build a project, run the solver ---------------------

interface FactoryNodeSpec {
  id: string;
  recipeId: string;
  machineCount?: number;
  parallel?: number;
  overclockTier?: string;
}
interface FactoryEdgeSpec {
  from: string;
  to: string;
  kind: ResourceKind;
  id: string;
  ratePerSecond?: number;
}
interface FactoryTarget {
  kind: ResourceKind;
  id: string;
  name?: string;
  amountPerSecond?: number;
}

function asFactorySpec(args: Record<string, unknown>) {
  const nodes: FactoryNodeSpec[] = [];
  for (const n of asArray(args.nodes) ?? []) {
    const o = asObject(n);
    if (!o) continue;
    const id = asString(o.id);
    const recipeId = asString(o.recipeId);
    if (!id || !recipeId) continue;
    nodes.push({
      id,
      recipeId,
      machineCount: asNumber(o.machineCount),
      parallel: asNumber(o.parallel),
      overclockTier: asString(o.overclockTier),
    });
  }

  const edges: FactoryEdgeSpec[] = [];
  for (const e of asArray(args.edges) ?? []) {
    const o = asObject(e);
    if (!o) continue;
    const from = asString(o.from);
    const to = asString(o.to);
    const id = asString(o.id);
    const kind = asString(o.kind);
    if (!from || !to || !id || (kind !== "item" && kind !== "fluid" && kind !== "aspect")) continue;
    edges.push({ from, to, kind, id, ratePerSecond: asNumber(o.ratePerSecond) });
  }

  const targetRaw = asObject(args.target);
  let target: FactoryTarget | undefined;
  if (targetRaw) {
    const kind = asString(targetRaw.kind);
    const id = asString(targetRaw.id);
    if (kind && id && (kind === "item" || kind === "fluid" || kind === "aspect")) {
      target = { kind, id, name: asString(targetRaw.name), amountPerSecond: asNumber(targetRaw.amountPerSecond) };
    }
  }

  return { nodes, edges, target };
}

async function buildProject(dataset: DatasetQuery, spec: {
  nodes: FactoryNodeSpec[];
  edges: FactoryEdgeSpec[];
  target: FactoryTarget | undefined;
}): Promise<FactoryProject> {
  const recipes: Recipe[] = [];
  const seen = new Set<string>();
  for (const node of spec.nodes) {
    if (seen.has(node.recipeId)) continue;
    const recipe = await dataset.getFullRecipe(node.recipeId);
    if (recipe) {
      recipes.push(recipe);
      seen.add(node.recipeId);
    }
  }

  const nodeObjs: FactoryNode[] = spec.nodes.map((node, index) => ({
    id: node.id,
    recipeId: node.recipeId,
    machineCount: node.machineCount ?? 1,
    parallel: node.parallel ?? 1,
    overclockTier: node.overclockTier ?? "LV",
    enabled: true,
    position: { x: (index % 6) * 240, y: Math.floor(index / 6) * 240 },
  }));

  const edgeObjs: FactoryEdge[] = spec.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.from,
    target: edge.to,
    resourceKind: edge.kind,
    resourceId: edge.id,
    ratePerSecond: edge.ratePerSecond,
  }));

  return {
    schemaVersion: 1,
    id: "agent-plan",
    name: "agent plan",
    recipes,
    nodes: nodeObjs,
    edges: edgeObjs,
    targetRate: spec.target
      ? {
          kind: spec.target.kind,
          resourceId: spec.target.id,
          amountPerSecond: spec.target.amountPerSecond ?? 0,
          displayName: spec.target.name,
        }
      : undefined,
  };
}

// ---- the brain ------------------------------------------------------------

export interface BrainDeps {
  dataset: DatasetQuery;
  executor: Executor;
  memory: MemoryStore;
  /** Which world the memory store is bound to. */
  worldName: string;
}

/** Assemble the LLM's tools from the injected brain dependencies. */
export function createBrain(deps: BrainDeps): Brain {
  const { dataset, executor, memory, worldName } = deps;

  const tools: LlmTool[] = [
    {
      name: "search_resources",
      description:
        "Search the GTNH item/fluid database by name. Use to turn a player's words ('steel ingot', 'any lv circuit', 'water') into a concrete resource {kind, id}. Returns the best matches with how many recipes touch each.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The item or fluid name to search for." },
          kind: { type: "string", enum: ["item", "fluid"] },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = asString(args.query) ?? "";
        const kindRaw = asString(args.kind);
        const kind = kindRaw === "item" || kindRaw === "fluid" ? kindRaw : undefined;
        const found = await dataset.searchResources({ query, limit: 8, kind });
        if (found.length === 0) {
          return { found: [], note: `No resources matched "${query}". Try a shorter or more generic name.` };
        }
        return { found };
      },
    },
    {
      name: "find_recipes",
      description:
        "List the GTNH recipes that MAKE a resource (mode='recipes') or USE it (mode='uses'). Returns the machine (recipeMap), tier, time, power, and each recipe's inputs/outputs. This is how you trace what a thing is made from and in what machines.",
      parameters: {
        type: "object",
        properties: {
          resource: RESOURCE_REF_SCHEMA,
          mode: {
            type: "string",
            enum: ["recipes", "uses"],
            description: "'recipes' = what produces it, 'uses' = what consumes it.",
          },
        },
        required: ["resource", "mode"],
      },
      execute: async (args) => {
        const resource = asResourceRef(args.resource);
        const mode = asString(args.mode);
        if (!resource) return { error: "resource must be {kind: 'item'|'fluid'|'aspect', id}." };
        if (mode !== "recipes" && mode !== "uses") return { error: "mode must be 'recipes' or 'uses'." };
        const found = await dataset.findRecipes({ resource, mode, limit: 15 });
        if (found.length === 0) return { found: [], note: `No ${mode} found for ${resource.name ?? resource.id}.` };
        return { found };
      },
    },
    {
      name: "get_recipe",
      description:
        "Full detail for one recipe by id (from find_recipes): exact inputs/outputs with amounts, power, time, and the machine's config knobs (coils, electrodes, tools).",
      parameters: {
        type: "object",
        properties: { recipeId: { type: "string" } },
        required: ["recipeId"],
      },
      execute: async (args) => {
        const recipeId = asString(args.recipeId);
        if (!recipeId) return { error: "recipeId is required." };
        const recipe = await dataset.getFullRecipe(recipeId);
        if (!recipe) return { error: `No recipe with id ${recipeId}.` };
        return toRecipeDetail(recipe);
      },
    },
    {
      name: "analyze_factory",
      description:
        "Check a proposed machine layout against the GTNH solver. Nodes are machines to run (each needs an id, a recipeId from find_recipes, and machineCount/parallel); edges wire one node's output into another's input; target is the resource + rate you want. Returns total power, whether the target is met, bottlenecks, missing recipes, the resources you must still supply (mustSupply), and byproducts. Use this to sanity-check a build before you finish.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["item", "fluid", "aspect"] },
              id: { type: "string" },
              name: { type: "string" },
              amountPerSecond: { type: "number" },
            },
            required: ["kind", "id"],
          },
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "A short id so edges can point at this node." },
                recipeId: { type: "string" },
                machineCount: { type: "number" },
                parallel: { type: "number" },
                overclockTier: { type: "string" },
              },
              required: ["id", "recipeId"],
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                kind: { type: "string", enum: ["item", "fluid", "aspect"] },
                id: { type: "string" },
                ratePerSecond: { type: "number" },
              },
              required: ["from", "to", "kind", "id"],
            },
          },
        },
        required: ["nodes"],
      },
      execute: async (args) => {
        const spec = asFactorySpec(args);
        if (spec.nodes.length === 0) {
          return { error: "nodes is required — at least one machine to run." };
        }
        const project = await buildProject(dataset, spec);
        const result = calculateThroughput(project);

        const target = spec.target;
        const targetBalance = target
          ? Object.values(result.resources).find(
              (r) => r.kind === target.kind && r.resourceId === target.id,
            )
          : undefined;
        const targetProduced = targetBalance?.producedPerSecond ?? 0;
        const wanted = target?.amountPerSecond ?? 0;

        // The layout's OPEN boundary, at nameplate rate: what it must be fed
        // from outside (net external input) and what it dumps (net external
        // output). Derived from the machine graph, not the drawer books — a
        // bare slot is a physical need the player must fill even before a
        // source drawer is drawn, and a bare output is real material to haul.
        const EPS = 0.0001;
        const net = new Map<string, { kind: ResourceKind; id: string; name?: string; perSecond: number }>();
        const touch = (kind: ResourceKind, id: string, name: string | undefined, delta: number) => {
          const key = `${kind}:${id}`;
          const entry = net.get(key) ?? { kind, id, name, perSecond: 0 };
          if (name && !entry.name) entry.name = name;
          entry.perSecond += delta;
          net.set(key, entry);
        };
        for (const node of Object.values(result.nodes)) {
          if (node.status === "missing-recipe") continue;
          // The solver's flows now carry energy rows (one per machine's grid).
          // They reach the LLM as data - an "energy:lv" row in mustSupply is
          // exactly the "add a generator" signal - via the same boundary cast
          // dataset-adapter.ts uses; the agent's types stay their own.
          for (const flow of Object.values(node.inputs)) {
            touch(flow.kind as ResourceKind, flow.resourceId, flow.displayName, -flow.amountPerSecond);
          }
          for (const flow of Object.values(node.outputs)) {
            touch(flow.kind as ResourceKind, flow.resourceId, flow.displayName, flow.amountPerSecond);
          }
        }
        const mustSupply = [...net.values()]
          .filter((r) => r.perSecond <= -EPS)
          .map((r) => ({ kind: r.kind, id: r.id, name: r.name, perSecond: -r.perSecond }));
        const byproducts = [...net.values()]
          .filter((r) => r.perSecond >= EPS)
          .map((r) => ({ kind: r.kind, id: r.id, name: r.name, perSecond: r.perSecond }));

        return {
          ok: true,
          totalEuPerSecond: result.totalEuPerSecond,
          target: target
            ? {
                id: target.id,
                producedPerSecond: targetProduced,
                wantedPerSecond: wanted,
                met: wanted <= 0 || targetProduced >= wanted - 0.0001,
              }
            : undefined,
          bottlenecks: result.bottlenecks.map((b) => ({
            kind: b.kind,
            severity: b.severity,
            message: b.message,
            requiredPerSecond: b.requiredPerSecond,
            capacityPerSecond: b.capacityPerSecond,
          })),
          missingRecipes: Object.values(result.nodes)
            .filter((n) => n.status === "missing-recipe")
            .map((n) => ({ recipeId: n.recipeId, recipeName: n.recipeName })),
          mustSupply,
          byproducts,
        };
      },
    },
    {
      name: "world_state",
      description:
        "What the mod currently sees: the player's position and inventory, and the machines near the NPC. Call this before acting so the plan is grounded in what actually exists (e.g. the player already has the items, or a machine is already placed).",
      parameters: { type: "object", properties: {} },
      execute: async () => executor.getState(),
    },
    {
      name: "recall",
      description:
        "Read what the agent already remembers about this world: the player's base location, machines they have built, and notes (preferences, choices). Call it early so you build on what is known.",
      parameters: { type: "object", properties: {} },
      execute: async () => memory.load(worldName),
    },
    {
      name: "remember",
      description:
        "Save a note about this world so it persists across sessions (e.g. 'player prefers HVA coils', 'base is a 3x3 EBF row'). Optionally record that a machine was just built.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string" },
          builtMachine: { type: "string", description: "A machineType to increment the built count for." },
        },
        required: ["note"],
      },
      execute: async (args) => {
        const note = asString(args.note);
        if (!note) return { error: "note is required." };
        const mem = await memory.load(worldName);
        mem.notes.push(note);
        const built = asString(args.builtMachine);
        if (built) {
          mem.builtMachines[built] = (mem.builtMachines[built] ?? 0) + 1;
        }
        mem.updatedAt = new Date().toISOString();
        await memory.save(mem);
        return { ok: true, saved: note };
      },
    },
    {
      name: "finish_plan",
      description:
        "End the task. Submit the plan: what to say in chat (reply) and the ordered world actions to carry out (use an empty list for a pure question). List any resources still needed in `needs`. Call this exactly once, at the end.",
      parameters: {
        type: "object",
        properties: {
          reply: { type: "string", description: "What the NPC says in chat." },
          actions: { type: "array", items: ACTION_SCHEMA },
          needs: { type: "array", items: RESOURCE_REF_SCHEMA },
          notes: { type: "string" },
        },
        required: ["reply", "actions"],
      },
      execute: async (args) => {
        const reply = asString(args.reply) ?? "";
        const actions = (asArray(args.actions) ?? [])
          .map(asAction)
          .filter((a): a is Action => a !== undefined);
        const needs = (asArray(args.needs) ?? [])
          .map(asResourceRef)
          .filter((n): n is ResourceRef => n !== undefined);
        const notes = asString(args.notes);
        return { reply, actions, needs, notes };
      },
    },
  ];

  return { tools: () => tools };
}
