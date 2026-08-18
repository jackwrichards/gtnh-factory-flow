// The generic agentic tool-calling loop. It is model- and task-agnostic: give
// it an Llm, a Brain (its tools), a task, and a world state, and it drives the
// LLM through tool calls until the model ends the task (by calling finish_plan
// or answering in prose). The LLM does the slow reasoning; the tools do the
// deterministic GTNH lookups and the solver check.
import type {
  Action,
  Brain,
  Llm,
  LlmMessage,
  Plan,
  ResourceRef,
  WorldState,
} from "./types";

export interface RunAgentOptions {
  /** The system prompt: who the NPC is and how it should plan. */
  system: string;
  /** Hard stop, in LLM round-trips, so a stuck model can't spin forever. */
  maxSteps?: number;
  /** Observes each tool call (for logs / streaming back to chat). */
  onStep?: (info: { step: number; toolName: string; preview: string }) => void;
}

export interface AgentRunResult {
  plan: Plan;
  steps: number;
  usage?: { promptTokens: number; completionTokens: number };
}

function buildTaskMessage(task: string, world: WorldState): string {
  const inventory = world.inventory.length
    ? world.inventory.map((item) => `${item.name ?? item.id} x${item.amount}`).join(", ")
    : "(nothing)";
  const machines = world.machines.length
    ? world.machines.map((machine) => `${machine.machineType} at ${machine.at.x},${machine.at.y},${machine.at.z}`).join("; ")
    : "(none nearby)";
  const note = world.note ? ` Mod note: ${world.note}.` : "";
  return [
    `Task: ${task}`,
    "",
    "World state:",
    `- player at ${world.playerAt.x}, ${world.playerAt.y}, ${world.playerAt.z}`,
    `- player inventory: ${inventory}`,
    `- nearby machines: ${machines}`,
    note,
    "",
    "Plan this task. Use the tools to ground it in real GTNH recipes and a real machine " +
      "layout before you commit. End by calling finish_plan with your chat reply and the " +
      "ordered world actions (use an empty actions list for a pure question).",
  ].join("\n");
}

// finish_plan's execute already returns a well-formed Plan; this is only a
// safety net if the model somehow ends without that tool (defensive, not the
// expected path).
function normalizePlan(result: unknown): Plan {
  const o = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return {
    reply: typeof o.reply === "string" ? o.reply : "",
    actions: (Array.isArray(o.actions) ? o.actions : []) as Action[],
    needs: Array.isArray(o.needs) ? (o.needs as ResourceRef[]) : undefined,
    notes: typeof o.notes === "string" ? o.notes : undefined,
  };
}

/** Drive the LLM over the brain's tools until it produces a Plan. */
export async function runAgent(
  llm: Llm,
  brain: Brain,
  task: string,
  worldState: WorldState,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  const tools = brain.tools();
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const maxSteps = options.maxSteps ?? 12;

  const messages: LlmMessage[] = [
    { role: "system", content: options.system },
    { role: "user", content: buildTaskMessage(task, worldState) },
  ];

  let steps = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  while (steps < maxSteps) {
    const response = await llm.chat(messages, tools);
    if (response.usage) {
      promptTokens += response.usage.promptTokens;
      completionTokens += response.usage.completionTokens;
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });
      for (const call of response.toolCalls) {
        const tool = toolByName.get(call.name);
        let result: unknown;
        if (!tool) {
          result = {
            error: `Unknown tool "${call.name}". Available tools: ${[...toolByName.keys()].join(", ")}.`,
          };
        } else {
          try {
            result = await tool.execute(call.args);
          } catch (err) {
            // A bad tool result must not kill the loop — feed it back so the
            // model can recover.
            result = { error: `Tool "${call.name}" threw: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        const rendered = JSON.stringify(result);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: rendered });
        options.onStep?.({ step: steps + 1, toolName: call.name, preview: rendered.slice(0, 160) });

        if (call.name === "finish_plan") {
          return { plan: normalizePlan(result), steps: steps + 1, usage: { promptTokens, completionTokens } };
        }
      }
      steps += 1;
      continue;
    }

    // No tool call: the model answered in prose. Treat it as a finished,
    // answer-only plan (no world actions).
    if (response.content) {
      return {
        plan: { reply: response.content, actions: [] },
        steps: steps + 1,
        usage: { promptTokens, completionTokens },
      };
    }

    // Neither a tool call nor content — nothing to progress with; stop.
    steps += 1;
  }

  return {
    plan: {
      reply: "I ran out of planning steps before I could finish. Break the task into a smaller piece and ask again.",
      actions: [],
    },
    steps,
    usage: { promptTokens, completionTokens },
  };
}
