# gtnh-npc — the visible body for the GTNH AI NPC

A **server-side-only** Forge **1.7.10** mod (Java 8, Forge `10.13.4.1614`). It has no
intelligence of its own: it holds a visible vanilla mob, reads a bit of local state,
forwards your task to the **gtnh-agent** over HTTP, and carries out the ordered
actions it returns. All the GTNH knowledge and planning lives in the Node agent
(see `src/agent/` in this repo).

This is the "hands and eyes" half of the planner/executor split. The agent is the
slow, smart brain (your local Qwen 27B over the repo's dataset + solver); this mod
is the fast, physical hands.

## Layout

| File | Role |
|------|------|
| `GtnhNpcMod.java` | `@Mod` entry point; registers the controller on the mod event bus. |
| `NpcEntity.java` | The visible body — a named, no-AI vanilla **villager**. The one seam to swap for a tamed wolf/parrot. |
| `NpcController.java` | Owns the NPC + current plan; fires tasks to the agent on a worker thread and advances the plan one action per tick on the main thread. |
| `ChatCommand.java` | `/gtnhnpc <task>` — joins the line into one task and hands it over. |
| `AgentBridgeClient.java` | The one HTTP call: `POST /task`, read the plan back (Gson, no extra deps). |
| `ActionExecutor.java` | Carries out `place` / `mine` / `pickup` (generic world work) and delegates `insert` / `run` / `collect` to the machine operator. |
| `MachineOperator.java` | The GT-specific seam. `NoopMachineOperator` is the honest stand-in until a real GT TileEntity driver is written. |
| `WorldStateCollector.java` | The "eyes": player position + inventory now; nearby GT machines are a TODO. |
| `AgentTypes.java` | Plain POJOs matching the agent's JSON exactly (see `src/agent/types.ts`, `bridge.ts`). |

## How a task flows

```
/gtnhnpc build me a furnace      (ChatCommand)
        |  joins the line, hands to controller
        v
NpcController.submitTask         (main thread)
        |  collects WorldState, POSTs {task, worldName, worldState}
        v
  AgentBridgeClient  ----HTTP---->  gtnh-agent  (Node)  ----  Qwen 27B + dataset + solver
        ^                                |
        |  TaskResponse {plan, ...}      v
NpcController.onAgentResponse   (hopped back to main thread via addScheduledTask)
        |  sets the plan; the tick loop then runs it
        v
one action per tick: goto / say / wait / place / mine / insert / run / collect / pickup
```

The agent's reply is spoken in chat; each action that fails is spoken too, so the
NPC tells you when it cannot do something (e.g. it cannot map a resource id to a
placeable block yet).

## Building (ForgeGradle 2.x, Java 8)

This targets the **old** Forge toolchain. You need Java 8 and the ForgeGradle 2.1
snapshot on the maven below.

```bash
cd gtnh-npc
gradle setupDecompWorkspace   # first time: decompiles the 1.7.10 MC source
gradle build                  # jar -> build/libs/gtnh-npc-0.1.0.jar
```

Drop the jar in your server's `mods/` folder (the agent does not need to be a
client mod — this is server-side only).

> Not compile-verified in the repo's dev environment (no ForgeGradle/Java 8/Minecraft
> decompile here). The 1.7.10 API calls are chosen to be the stable mapped names, but
> expect to fix up the odd method-name difference when you build on your toolchain.

## Configuration

Two things live as constants in `NpcController` for now — make them a real FML
config file when you want per-server tuning:

- `AGENT_BASE_URL` — where the agent listens. Default `http://127.0.0.1:8787`
  (the agent's default port). If the agent runs on another host, point it there.
- `WORLD_NAME` — the memory key. Default `default`; wire it to your actual save name.
- `HOME` — where the NPC first appears.

## What works now vs. later (honest)

**Works now (vanilla, no GT dependency):**
- A visible, named villager that stands still and moves on `goto` (teleport).
- The `/gtnhnpc <task>` command and the full agent round-trip.
- `say`, `wait`, `goto`, and generic `mine` (breaks a block).
- `place` and item resolution — *where the id maps* to a Minecraft item.

**Intentionally deferred (marked `TODO(1.7.10)` in the code):**
- `insert` / `run` / `collect` — need the GregTech TileEntity API (`MachineOperator`).
- `pickup` — ground items into the NPC's inventory.
- `goto` as a visible walk (pathfind) instead of a teleport.
- `WorldStateCollector.machines` — scanning for nearby GT machines.
- Mapping the agent's **dataset** item ids to Minecraft item-registry ids (the
  single seam that gates `place` of real GT items).
- A real FML config file for the URL / world name / spawn.
