// Shared types for the GTNH agent service.
//
// This is the seam between the three pieces of the NPC: the BRAIN (the repo's
// GTNH dataset + solver, exposed as tools), the LLM (the local Qwen 27B, driven
// through a tool-calling loop), and the HANDS (an Executor that acts on the
// world — a thin 1.7.10 Forge mod in production, a stub in tests).
//
// Keeping these types here lets each piece be built and tested in isolation:
// the brain is tested against a fake DatasetQuery, the loop against a stub LLM,
// the executor recorded in-memory, the bridge by calling handleTask directly.

import type { Recipe } from "@/lib/model/types";

export type ResourceKind = "item" | "fluid" | "aspect";

/** A reference to a GTNH resource, as the LLM names it. */
export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  name?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One thing the mod can do with the world. Deliberately coarse and bounded —
 * these are the primitives the LLM is allowed to ask for, and the set is what
 * keeps v1 honest (no "do whatever"). A real 1.7.10 Forge mod implements
 * each; the stub records them.
 */
export type Action =
  | { type: "goto"; at: Vec3 }
  | { type: "place"; item: ResourceRef; at: Vec3; facing?: number }
  | { type: "mine"; at: Vec3 }
  | { type: "insert"; machine: Vec3; item: ResourceRef; amount: number; slot?: number }
  | { type: "run"; machine: Vec3 }
  | { type: "collect"; machine: Vec3; slot?: number }
  | { type: "pickup"; at: Vec3 }
  | { type: "say"; text: string }
  | { type: "wait"; ticks: number };

export interface ActionResult {
  ok: boolean;
  /** What the mod reports back — success, or why it could not do the action. */
  message: string;
}

/** A machine as the mod sees it: a placed block with a recipe map and progress. */
export interface MachineState {
  id: string;
  machineType: string;
  at: Vec3;
  /** Present when the machine is mid-recipe. */
  progressTicks?: number;
  /** Present when the machine is running and how fast. */
  eut?: number;
  note?: string;
}

/** What the mod reports about the world, sent with every task. */
export interface WorldState {
  /** The player the task came from. */
  playerId: string;
  playerAt: Vec3;
  /** Items the player is carrying, by id and count. */
  inventory: Array<{ id: string; kind: ResourceKind; amount: number; name?: string }>;
  /** Machines the mod can see near the NPC. */
  machines: MachineState[];
  /** Free-form context the mod adds (e.g. "no power at this site"). */
  note?: string;
}

/** The structured answer the LLM ends with. */
export interface Plan {
  /** What the NPC says in chat. */
  reply: string;
  /** The ordered steps to carry out (may be empty for a pure answer). */
  actions: Action[];
  /** Resources the plan needs but the player is short on. */
  needs?: ResourceRef[];
  notes?: string;
}

// ---- LLM abstraction -------------------------------------------------------

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LlmResponse {
  content?: string;
  toolCalls?: LlmToolCall[];
  /** Token usage, when the endpoint reports it. */
  usage?: { promptTokens: number; completionTokens: number };
}

export interface Llm {
  chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse>;
}

// ---- Brain abstraction -----------------------------------------------------

/**
 * The slice of the dataset the brain needs. `server.ts` implements this over
 * the real `@/lib/server/dataset-query` functions; tests implement it in-memory
 * so the tool logic can be exercised without a published dataset on disk.
 */
export interface DatasetQuery {
  readonly versionId: string;
  searchResources(request: {
    query: string;
    limit?: number;
    kind?: ResourceKind;
  }): Promise<DatasetResourceHit[]>;
  findRecipes(request: {
    resource: ResourceRef;
    mode: "recipes" | "uses";
    limit?: number;
  }): Promise<DatasetRecipeHit[]>;
  /** The full recipe object — the shape the solver needs, and what the brain projects. */
  getFullRecipe(recipeId: string): Promise<Recipe | undefined>;
}

export interface DatasetResourceHit {
  id: string;
  kind: ResourceKind;
  name?: string;
  modId?: string;
  /** How many recipes touch it — the dataset's "common" signal. */
  recipeCount?: number;
}

export interface DatasetRecipeHit {
  id: string;
  name: string;
  recipeMap: string;
  machineType: string;
  minimumTier: string;
  durationTicks: number;
  eut: number;
  inputs: Array<Pick<ResourceRef, "kind" | "id" | "name"> & { amount: number }>;
  outputs: Array<Pick<ResourceRef, "kind" | "id" | "name"> & { amount: number; chance?: number }>;
}

export interface DatasetRecipeDetail extends DatasetRecipeHit {
  notes?: string;
  /** The machine's config knobs, when it has any (coils, electrodes, tools). */
  machineConfigControls?: unknown;
  machineHandlers?: unknown;
}

/**
 * The brain: a ready-to-pass set of LlmTool definitions backed by a
 * DatasetQuery, the solver, an Executor (for world_state) and a memory store.
 */
export interface Brain {
  tools(): LlmTool[];
}

export interface LlmTool {
  name: string;
  description: string;
  /** A JSON Schema object describing `args`, as OpenAI tool-calling expects. */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

// ---- Hands abstraction -----------------------------------------------------

export interface Executor {
  /** Perform one action on the world and report what happened. */
  act(action: Action): Promise<ActionResult>;
  /** The current world state, as the mod reports it. */
  getState(): Promise<WorldState>;
}

// ---- Memory abstraction ----------------------------------------------------

/**
 * What the agent remembers about a world, across sessions. This is the
 * "it learns how you play" part: the pre-loaded GTNH knowledge is the brain,
 * this is the per-world note it keeps.
 */
export interface WorldMemory {
  worldName: string;
  /** Where the player's base is, so "go home" and "build at the base" resolve. */
  base?: Vec3;
  /** Machine families the player has built: machineType -> count. */
  builtMachines: Record<string, number>;
  /** Free-form notes: preferences, "player uses HVA coils", etc. */
  notes: string[];
  updatedAt?: string;
}

export interface MemoryStore {
  load(worldName: string): Promise<WorldMemory>;
  save(memory: WorldMemory): Promise<void>;
}
