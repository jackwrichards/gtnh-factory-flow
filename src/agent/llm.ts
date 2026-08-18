// The LLM abstraction's two implementations.
//
//   - createOpenAiLlm: the real one. Talks to your local Qwen 27B over its
//     OpenAI-compatible /chat/completions endpoint (vLLM or Ollama) with tool
//     calling. It uses the global fetch — no `openai`/`ws` dependency.
//   - createStubLlm: a scripted stand-in for tests, so the agentic loop is
//     exercised without a model.
import type { Llm, LlmMessage, LlmResponse, LlmTool } from "./types";

export interface OpenAiLlmConfig {
  /** e.g. "http://127.0.0.1:8000/v1" (vLLM) or "http://127.0.0.1:11434/v1" (Ollama). */
  baseUrl: string;
  apiKey?: string;
  /** The served model name, e.g. "qwen3-27b". */
  model: string;
  /** Planning wants low temperature; keep it near-deterministic. */
  temperature?: number;
  /** Per-response generation cap, when the endpoint honours it. */
  maxTokens?: number;
  /** Abort after this many ms so a stuck endpoint can't hang a task. */
  timeoutMs?: number;
}

function safeParseObject(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toOpenAiTool(tool: LlmTool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAiMessages(messages: LlmMessage[]) {
  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content ?? "" };
    }
    return { role: message.role, content: message.content ?? "" };
  });
}

/** The real LLM: your local Qwen 27B behind an OpenAI-compatible endpoint. */
export function createOpenAiLlm(config: OpenAiLlmConfig): Llm {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    async chat(messages, tools): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: toOpenAiMessages(messages),
        temperature: config.temperature ?? 0.2,
      };
      if (tools.length > 0) body.tools = tools.map(toOpenAiTool);
      if (config.maxTokens) body.max_tokens = config.maxTokens;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 120_000);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`LLM endpoint ${res.status}: ${text.slice(0, 400)}`);
        }
        const data: any = await res.json();
        const message = data?.choices?.[0]?.message ?? {};
        const toolCalls = Array.isArray(message.tool_calls)
          ? (message.tool_calls as any[]).map((tc) => ({
              id: tc.id ?? "",
              name: tc?.function?.name ?? "",
              args: safeParseObject(tc?.function?.arguments),
            }))
          : undefined;

        return {
          content: typeof message.content === "string" ? message.content : undefined,
          toolCalls,
          usage: data?.usage
            ? {
                promptTokens: data.usage.prompt_tokens ?? 0,
                completionTokens: data.usage.completion_tokens ?? 0,
              }
            : undefined,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * A scripted LLM for tests: it hands back a queued LlmResponse per chat() call.
 * Lets the loop, the bridge, and the plan-execution path be tested without a
 * model. Items may be responses or zero-arg functions (for responses that need
 * to reference the call index).
 */
export function createStubLlm(responses: Array<LlmResponse | (() => LlmResponse)>): Llm {
  let index = 0;
  return {
    async chat(_messages: LlmMessage[], _tools: LlmTool[]): Promise<LlmResponse> {
      const next = responses[index] ?? { content: "done" };
      index += 1;
      return typeof next === "function" ? next() : next;
    },
  };
}
