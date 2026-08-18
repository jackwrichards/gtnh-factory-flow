// Entry point for the gtnh-agent service: wires the real LLM, the real dataset
// (via the repo's query layer), the per-world memory, and an Executor together,
// then starts the HTTP bridge the mod talks to.
//
// Run from the repo root (so the published dataset at public/datasets/gtnh is
// found):  npm run agent
//
//   GTNH_AGENT_LLM_BASE_URL=http://127.0.0.1:8000/v1 \
//   GTNH_AGENT_LLM_MODEL=qwen3-27b \
//   GTNH_AGENT_LLM_API_KEY=... \
//   GTNH_AGENT_PORT=8080 \
//   npm run agent
//
// The Executor here is the in-process StubExecutor — the Phase-0 spike is
// self-contained (you can watch a plan "execute" against the stub). In
// production the mod is the Executor (see the README), so replace this.
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { DatasetManifest } from "@/lib/datasets/types";
import { prewarmDatasetVersion } from "@/lib/server/dataset-query";
import { createRealDatasetQuery } from "./dataset-adapter";
import { createAgentHandle, createBridgeServer, serverPort } from "./bridge";
import { createOpenAiLlm } from "./llm";
import { FileMemoryStore } from "./memory";
import { StubExecutor } from "./executor";
import type { DatasetQuery, Llm, MemoryStore } from "./types";

const DATASET_ROOT = path.join(process.cwd(), "public", "datasets", "gtnh");

/**
 * The NPC's planning doctrine. Deliberately bounded: it reasons only over real
 * GTNH recipes, checks its own layouts with the solver, plans from the actual
 * world state, and proposes only the coarse actions the mod can carry out.
 */
export const SYSTEM_PROMPT = [
  "You are a helpful NPC living in a GTNH (GregTech: New Horizons) world, working alongside a player.",
  "You can look up real GTNH recipes, check whether a proposed machine layout is balanced and powered, read the current world state, and remember facts about this world across sessions.",
  "",
  "How to plan:",
  "1. Ground the task first. If the player names an item or fluid, call search_resources to get its exact {kind, id}. Then find_recipes (mode 'recipes') to see what actually makes it, and which machines/tiers/inputs are involved. Prefer the cheapest workable machine and tier.",
  "2. If the task needs a multi-machine line, design it as nodes (each with a real recipeId from find_recipes) and edges (wiring one node's output into another's input), and call analyze_factory to check the balance. Fix the mustSupply list by adding the machines that make those resources, and re-check. Do not commit to a layout the solver flags as unbalanced or missing recipes.",
  "3. Read the world with world_state (and recall memory) so you plan from what the player actually has and where the base is.",
  "4. Turn the finished design into the coarsest set of world actions you can (goto / place / mine / insert / run / collect / pickup / say / wait). Use a machine's coordinates only from world_state — never invent coordinates for something not in the world state.",
  "5. Remember durable facts about the player (their base, preferred coils or machine families) with remember; read them with recall at the start of a task.",
  "",
  "Stay bounded: do one concrete, checkable task well rather than many vague ones. If the task is too open-ended, say what you would do and ask the player to pick a starting point. If the player is short of a resource, list it in `needs` and say so in the reply.",
  "Always finish by calling finish_plan with a clear, in-character chat `reply` and the ordered `actions` (an empty list for a pure question).",
].join("\n");

export interface AgentServerConfig {
  /** Your local Qwen endpoint, e.g. "http://127.0.0.1:8000/v1" (vLLM) or "http://127.0.0.1:11434/v1" (Ollama). */
  llmBaseUrl: string;
  /** The served model name, e.g. "qwen3-27b". */
  llmModel: string;
  llmApiKey?: string;
  llmTemperature?: number;
  /** Pin a dataset version; defaults to the manifest's latest stable. */
  datasetVersion?: string;
  port?: number;
  host?: string;
  memoryDir?: string;
  maxSteps?: number;
  onStep?: (info: { step: number; toolName: string; preview: string }) => void;
  log?: (message: string) => void;
}

export interface RunningAgent {
  server: Server;
  port: number;
  versionId: string;
}

/** The dataset version to use: the pinned one, else the manifest's latest stable. */
export async function resolveDatasetVersion(override?: string): Promise<string> {
  if (override) return override;
  const manifestPath = path.join(DATASET_ROOT, "datasets.manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as DatasetManifest;
  const versionId = manifest.latestStableVersion ?? manifest.latestDailyVersion ?? manifest.versions[0]?.id;
  if (!versionId) {
    throw new Error(`No dataset version found in ${manifestPath} (run the dataset pipeline first).`);
  }
  return versionId;
}

/** Build the real dependencies and start the bridge. Import-safe: no side effects unless main(). */
export async function startAgentServer(config: AgentServerConfig): Promise<RunningAgent> {
  const log = config.log ?? console.log;

  const versionId = await resolveDatasetVersion(config.datasetVersion);
  const dataset: DatasetQuery = createRealDatasetQuery(versionId);
  const llm: Llm = createOpenAiLlm({
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    apiKey: config.llmApiKey,
    temperature: config.llmTemperature,
  });
  const memory: MemoryStore = new FileMemoryStore({ dir: config.memoryDir });
  // Spike: in-process stub. Production: the mod (see README).
  const executor = new StubExecutor();

  // Prewarm on startup so the first task does not pay the cold-read cost —
  // the same "server should be prewarmed on startup" rule the app follows.
  try {
    await prewarmDatasetVersion(versionId);
    log(`dataset prewarmed (${versionId})`);
  } catch (err) {
    log(`dataset prewarm failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const handle = createAgentHandle({
    llm,
    dataset,
    executor,
    memory,
    system: SYSTEM_PROMPT,
    maxSteps: config.maxSteps,
    onStep: config.onStep,
  });

  const server = await createBridgeServer(handle, config.port ?? 8080, config.host ?? "127.0.0.1");
  const port = serverPort(server);
  log(`gtnh-agent listening on http://${config.host ?? "127.0.0.1"}:${port} (dataset ${versionId})`);
  return { server, port, versionId };
}

async function main(): Promise<void> {
  const base = process.env.GTNH_AGENT_LLM_BASE_URL;
  const model = process.env.GTNH_AGENT_LLM_MODEL;
  if (!base || !model) {
    console.error("Set GTNH_AGENT_LLM_BASE_URL and GTNH_AGENT_LLM_MODEL (e.g. http://127.0.0.1:8000/v1 and qwen3-27b).");
    process.exit(1);
  }
  await startAgentServer({
    llmBaseUrl: base,
    llmModel: model,
    llmApiKey: process.env.GTNH_AGENT_LLM_API_KEY,
    datasetVersion: process.env.GTNH_AGENT_DATASET_VERSION,
    port: process.env.GTNH_AGENT_PORT ? Number(process.env.GTNH_AGENT_PORT) : 8080,
    host: process.env.GTNH_AGENT_HOST ?? "127.0.0.1",
    memoryDir: process.env.GTNH_AGENT_MEMORY_DIR,
    maxSteps: process.env.GTNH_AGENT_MAX_STEPS ? Number(process.env.GTNH_AGENT_MAX_STEPS) : 12,
    onStep: (info) => console.log(`  [step ${info.step}] ${info.toolName}: ${info.preview}`),
  });
}

// Only auto-start when this file is the entry point (not when tests import it).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
