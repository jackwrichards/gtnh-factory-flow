// The bridge between the 1.7.10 Forge mod (the "hands and eyes") and the agent
// (the "brain + LLM"). Two layers:
//
//   - createAgentHandle: the actual work. Takes a task + world state, runs the
//     LLM over the brain's tools to get a Plan, drives the plan's actions
//     through the Executor, and returns the plan + per-action results. This is
//     the unit you test directly (no sockets needed).
//   - createBridgeServer: a tiny HTTP/JSON wrapper over that handle (POST
//     /task). HTTP/JSON over Node's built-in http — no `ws`/`openai` dependency.
//
// In production the mod POSTs a task and reads back the plan; here the
// StubExecutor stands in for the mod, so the whole path is testable in-process.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createBrain } from "./brain";
import { runAgent } from "./agent-loop";
import type {
  ActionResult,
  DatasetQuery,
  Executor,
  Llm,
  MemoryStore,
  Plan,
  WorldState,
} from "./types";

export interface TaskRequest {
  /** The player's task, in chat. */
  task: string;
  /** Which world this is (the memory key). */
  worldName: string;
  /** Which player asked. */
  playerId?: string;
  /** The world state the mod observed, if it already has it. */
  worldState?: WorldState;
}

export interface TaskResponse {
  plan: Plan;
  /** Per-action results, in the plan's order. */
  results: ActionResult[];
  /** The world state after the plan ran. */
  worldState: WorldState;
  steps: number;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AgentHandle {
  handleTask(request: TaskRequest): Promise<TaskResponse>;
}

export interface CreateHandleOptions {
  llm: Llm;
  dataset: DatasetQuery;
  executor: Executor;
  memory: MemoryStore;
  /** The system prompt: who the NPC is and how it should plan. */
  system: string;
  maxSteps?: number;
  /** Observes each tool call (for logs / streaming back to chat). */
  onStep?: (info: { step: number; toolName: string; preview: string }) => void;
}

/** The testable core: plan a task, then carry out its actions. */
export function createAgentHandle(options: CreateHandleOptions): AgentHandle {
  const { llm, dataset, executor, memory, system, maxSteps, onStep } = options;
  return {
    async handleTask(request): Promise<TaskResponse> {
      const worldName = request.worldName || "default";
      const brain = createBrain({ dataset, executor, memory, worldName });
      const worldState = request.worldState ?? (await executor.getState());

      const { plan, steps, usage } = await runAgent(llm, brain, request.task, worldState, {
        system,
        maxSteps,
        onStep,
      });

      // The agent drives execution: each planned action goes to the Executor
      // (the mod, in production). The NPC's chat line is plan.reply.
      const results: ActionResult[] = [];
      for (const action of plan.actions) {
        results.push(await executor.act(action));
      }
      const after = await executor.getState();
      return { plan, results, worldState: after, steps, usage };
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** A minimal HTTP/JSON server: POST /task -> TaskResponse. */
export function createBridgeServer(handle: AgentHandle, port: number, host = "127.0.0.1") {
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST" || path !== "/task") {
      sendJson(res, 404, { error: "not found — POST /task" });
      return;
    }
    try {
      const raw = await readBody(req);
      const request = JSON.parse(raw) as TaskRequest;
      if (!request.task || !request.worldName) {
        sendJson(res, 400, { error: "task and worldName are required" });
        return;
      }
      const response = await handle.handleTask(request);
      sendJson(res, 200, response);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return new Promise<ReturnType<typeof createHttpServer>>((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

/** The port a bridge server actually bound to (useful when listening on :0). */
export function serverPort(server: { address(): unknown }): number {
  const addr = server.address() as AddressInfo | null;
  return addr ? addr.port : 0;
}
