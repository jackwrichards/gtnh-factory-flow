// The hands seam. In production the 1.7.10 Forge mod implements the Executor
// (driven over the HTTP bridge). In tests and in the Phase-0 spike, the
// StubExecutor records each action in memory so we can assert the LLM actually
// planned the right world changes.
import type { Action, ActionResult, Executor, WorldState } from "./types";

export interface RecordedAction {
  index: number;
  action: Action;
  result: ActionResult;
}

export interface StubExecutorOptions {
  /** The world state to report until the actions change it. */
  worldState?: Partial<WorldState>;
}

/** Records every action instead of performing it; reports success. */
export class StubExecutor implements Executor {
  readonly actions: RecordedAction[] = [];
  private world: WorldState;

  constructor(options: StubExecutorOptions = {}) {
    this.world = {
      playerId: options.worldState?.playerId ?? "player",
      playerAt: options.worldState?.playerAt ?? { x: 0, y: 64, z: 0 },
      inventory: options.worldState?.inventory ?? [],
      machines: options.worldState?.machines ?? [],
      note: options.worldState?.note,
    };
  }

  getState(): Promise<WorldState> {
    return Promise.resolve(this.world);
  }

  async act(action: Action): Promise<ActionResult> {
    const result: ActionResult =
      action.type === "say" ? { ok: true, message: `said: ${action.text}` } : { ok: true, message: `${action.type} recorded` };
    this.actions.push({ action, result, index: this.actions.length });
    return result;
  }

  /** The action types, in order — a compact form for test assertions. */
  get types(): string[] {
    return this.actions.map((recorded) => recorded.action.type);
  }
}
