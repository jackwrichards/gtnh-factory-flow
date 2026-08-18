# gtnh-agent — the brain of the GTNH AI NPC

The Node/TS service that makes up the "brain + LLM" half of the NPC. It reuses this
repo's **1.7.10 GTNH dataset** and **solver** as tools a local LLM can call, plans a
bounded task over them, and speaks a small HTTP/JSON protocol to the **gtnh-npc**
Forge mod (the "hands and eyes") that carries the plan out in the world.

This is the **planner/executor split**: a slow, smart model reasons over a few
high-level steps per build; a deterministic executor does the fast, repeatable
physical work. The agent is the planner; the mod is the executor.

```
                    ┌────────────────────────── this repo ──────────────────────────┐
 /gtnhnpc "build   │  src/agent  (Node/TS)          public/datasets/gtnh            │
  me a furnace" ──▶│  ┌───────────────────────┐      (1.7.10 recipe/machine/ore-dict)│
   (chat)          │  │ brain: dataset +      │◀──────────────────────┐             │
        │          │  │   solver as tools     │                        │             │
        │          │  └───────────┬───────────┘                        │             │
        │          │              │ tool loop                          │             │
        │          │  ┌───────────▼───────────┐    Qwen 27B            │             │
        │          │  │ agent-loop ──────────▶│──▶ (your local endpoint)             │
        │          │  │  + finish_plan        │◀── tool calls / reply ─             │
        │          │  └───────────┬───────────┘                        │             │
        │          │              │ ordered Plan                        │             │
        │          │  ┌───────────▼───────────┐  POST /task            │             │
        │          │  │ bridge (HTTP/JSON)────│────────────────────────┘             │
        │          │  └───────────┬───────────┘                                     │
        │          │              │ action primitives                                 │
        └──────────┼──────────────┼──────────────────────────────────────────────────┘
                   │              ▼
              gtnh-npc (Forge 1.7.10 mod) executes: goto/place/mine/insert/run/...
```

## What it does

- **Loads the published GTNH dataset** at `public/datasets/gtnh` (the same one the
  planner app ships) and prewarms it on startup.
- **Exposes 8 tools** to the model: `search_resources`, `find_recipes`, `get_recipe`,
  `analyze_factory` (runs the repo's throughput solver over a proposed layout),
  `world_state`, `remember`, `recall`, `finish_plan`.
- **Runs the agentic tool loop** against your **Qwen 27B** (OpenAI-compatible
  endpoint) until it calls `finish_plan`, yielding a chat `reply` + an ordered
  list of `actions`.
- **Drives the plan through an `Executor`** and returns the plan + per-action
  results over HTTP.
- **Keeps per-world memory** (base location, what's built, preferences) in a small
  JSON file, so it remembers across sessions.

## Layout

| File | Role |
|------|------|
| `server.ts` | Entry point. Wires the real LLM + dataset + memory, prewarms, starts the bridge. |
| `brain.ts` | The tools (dataset + solver as `LlmTool`s). The GTNH knowledge layer. |
| `agent-loop.ts` | The generic tool-calling loop; ends on `finish_plan`. |
| `llm.ts` | `createOpenAiLlm` (global `fetch`, no `openai` dep) + `createStubLlm` for tests. |
| `bridge.ts` | `createAgentHandle` (plan then execute — the testable core) + `createBridgeServer` (HTTP). |
| `executor.ts` | `Executor` interface + `StubExecutor` (records actions in memory). |
| `memory.ts` | `FileMemoryStore` — per-world JSON, atomic write. |
| `dataset-adapter.ts` | The real `DatasetQuery` over the repo's `@/lib/server/dataset-query`. |
| `fakes.ts` | In-memory dataset + memory for tests (no published dataset needed). |
| `types.ts` | The shared wire types (this is the contract the mod's `AgentTypes.java` mirrors). |
| `*.test.ts` | Unit tests — all green, no live LLM or dataset required. |

## Prerequisites

1. **A published dataset** in `public/datasets/gtnh`. The agent reads
   `datasets.manifest.json` for the version. Generate one with the pipeline (from
   the repo root):

   ```bash
   gh workflow run "GTNH dataset pipeline" --ref develop -f channel=both -f publish=true -f force_rebuild=true
   ```

2. **A local Qwen endpoint that supports tool calling**, exposed OpenAI-style:
   - **vLLM** — start with tool calling on, e.g.
     `vllm serve <model> --enable-auto-tool-choice --tool-call-parser hermes`
     (the exact parser flag depends on your Qwen build; the point is the endpoint
     must emit OpenAI-style `tool_calls`). Listens at `http://127.0.0.1:8000/v1`.
   - **Ollama** — `OLLAMA_MODELS=... ollama serve`; the OpenAI-compatible endpoint
     is `http://127.0.0.1:11434/v1`, model `qwen3-27b` (or your tag).

   **Spike first:** before wiring the full loop, send a one-shot
   `/chat/completions` with one tool and confirm your endpoint returns a clean
   `tool_call`. That's the whole risk of the local-model plan.

## Run the agent

From the repo root (so `public/datasets/gtnh` is found):

```bash
# vLLM
GTNH_AGENT_LLM_BASE_URL=http://127.0.0.1:8000/v1 \
GTNH_AGENT_LLM_MODEL=qwen3-27b \
GTNH_AGENT_LLM_API_KEY=sk-no-key \
npm run agent

# Ollama
GTNH_AGENT_LLM_BASE_URL=http://127.0.0.1:11434/v1 \
GTNH_AGENT_LLM_MODEL=qwen3-27b \
npm run agent
```

It prints the dataset version it loaded and the port it's listening on
(default **8080**). The env vars:

| Var | Default | Meaning |
|-----|---------|---------|
| `GTNH_AGENT_LLM_BASE_URL` | — (required) | The OpenAI-compatible base, e.g. `http://127.0.0.1:8000/v1`. |
| `GTNH_AGENT_LLM_MODEL` | — (required) | The served model name, e.g. `qwen3-27b`. |
| `GTNH_AGENT_LLM_API_KEY` | none | Any key the endpoint wants (local ones usually accept anything). |
| `GTNH_AGENT_PORT` | `8080` | The bridge port the mod POSTs to. |
| `GTNH_AGENT_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` if the mod runs on another host. |
| `GTNH_AGENT_DATASET_VERSION` | latest stable | Pin a dataset version id. |
| `GTNH_AGENT_MEMORY_DIR` | `./gtnh-agent-memory` | Where per-world memory JSON lives. |
| `GTNH_AGENT_MAX_STEPS` | `12` | Max tool-loop steps before the agent reports it ran out. |

## The bridge (what the mod calls)

- `POST /task` — body `{ "task": string, "worldName": string, "playerId"?: string, "worldState"?: WorldState }`
  → `200` `{ "plan", "results", "worldState", "steps", "usage?" }`.
- `GET /health` → `200 { "ok": true }`.
- `400` on a missing `task`/`worldName`; `404` elsewhere.

`WorldState`, `Plan`, `Action`, `TaskResponse` are defined in
[`types.ts`](./types.ts) and mirrored 1:1 by the mod's
[`AgentTypes.java`](../../gtnh-npc/src/main/java/com/gtnhnpc/AgentTypes.java).
`Action` is a flat discriminated union on `type`
(`goto | place | mine | insert | run | collect | pickup | say | wait`).

Point the mod at this port: `NpcController.AGENT_BASE_URL` (default
`http://127.0.0.1:8787` — set it to match `GTNH_AGENT_PORT`).

## Spike vs. production (the Executor)

The agent drives the plan through an `Executor` (`act(action)`, `getState()`).

- **Phase-0 spike (what `npm run agent` runs today):** an in-process
  `StubExecutor` — the plan "executes" against a stub and you watch the
  round-trip end-to-end (LLM → tools → solver → plan → actions) with no Minecraft
  in the loop. This is how you prove the Qwen tool-calling path and the brain work.
- **Production:** the **gtnh-npc** mod *is* the executor — it POSTs the task,
  receives the plan, and carries each action out in the world. To switch, the mod
  (or a thin shim) becomes the thing that calls `executor.act` per action. The
  brain/loop/bridge are unchanged.

## Tests

No live LLM or published dataset needed — the brain is tested against an in-memory
fake dataset, the loop against a stub LLM, the bridge by calling `handleTask`
directly (and over real HTTP on an ephemeral port), memory on a temp dir:

```bash
npm run test -- src/agent
```

## End-to-end (Phase 0)

1. Run the agent (spike mode) with your Qwen endpoint.
2. From a small client, `POST /task` with `worldName: "default"` and a task like
   `build me a single-block furnace from these materials` and a minimal `worldState`.
3. Confirm the response `plan` names real GTNH recipes and the `actions` are the
   coarse primitives — and that `analyze_factory` was called (visible in the
   `[step N]` log lines) with a layout the solver accepted.

That one task, done cleanly, is the whole Phase-0 gate before the real executor
primitives and more task types land.
