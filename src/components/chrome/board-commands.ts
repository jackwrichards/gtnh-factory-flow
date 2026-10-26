"use client";

import { useSyncExternalStore } from "react";
import { playEditSfx, playSfxDegree } from "@/lib/sound/sfx";

/**
 * What the top bar asks of the board. FactoryFlow registers these while it is
 * mounted (a few lines), so the bar never reaches into its internals: Arrange
 * and Fit are the board's own functions, and the arrange's progress comes back
 * as one fraction for the key's label ("Arranging 40%", the mod's).
 */
export interface BoardCommands {
  /** `ungroup`: every group is taken apart first and all the cards are laid out; otherwise a group moves as one block. */
  arrange: (options?: { ungroup?: boolean }) => void;
  cancelArrange: () => void;
  fit: () => void;
  /** Opens the board's empty-board menu at a screen point, its new things landing in the middle of the view. */
  openBoardMenu?: (at: { x: number; y: number }) => void;
}

export interface ArrangeState {
  running: boolean;
  /** 0 to 1, never going back while one runs. */
  fraction: number;
  /** A stop was asked; the key says "Stopping" until the worker lets go. */
  stopping: boolean;
}

const IDLE: ArrangeState = { running: false, fraction: 0, stopping: false };

let commands: BoardCommands | undefined;
let arrange: ArrangeState = IDLE;
/** The arrange's progress in tenths that have ticked, and when the last did (the mod's `tickArrange`). */
let arrangeTicked = 0;
let arrangeTickAt = 0;
const ARRANGE_TICK_MS = 90;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function registerBoardCommands(next: BoardCommands): () => void {
  commands = next;
  return () => {
    if (commands === next) commands = undefined;
  };
}

export function getBoardCommands(): BoardCommands | undefined {
  return commands;
}

/** The board reports the arrange in flight (undefined when none is). */
export function reportArrange(progress: { step: number; done: number; total: number } | undefined, steps: number) {
  if (!progress) {
    if (arrange !== IDLE) {
      // Landing has its own sound; a stopped arrange lands nothing.
      if (!arrange.stopping) playEditSfx("board.sweep");
      arrangeTicked = 0;
      arrange = IDLE;
      emit();
    }
    return;
  }
  const within = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const fraction = Math.max(arrange.running ? arrange.fraction : 0, Math.min(1, (progress.step + within) / steps));
  if (arrange.running && arrange.fraction === fraction) return;
  // A tick for every tenth it gets along, a note higher each time, spaced so a quick one does not rattle.
  const tenth = Math.floor(fraction * 10);
  const now = typeof performance === "undefined" ? 0 : performance.now();
  if (!arrange.stopping && tenth > arrangeTicked && now - arrangeTickAt >= ARRANGE_TICK_MS) {
    arrangeTicked = tenth;
    arrangeTickAt = now;
    playSfxDegree("ui.tick", 0.8, tenth - 4);
  }
  arrange = { running: true, fraction, stopping: arrange.running ? arrange.stopping : false };
  emit();
}

export function markArrangeStopping() {
  if (!arrange.running || arrange.stopping) return;
  arrange = { ...arrange, stopping: true };
  emit();
}

/** The key's label: "Arrange", "Arranging 40%" or "Stopping". */
export function arrangeLabel(state: ArrangeState): string {
  if (!state.running) return "Arrange";
  return state.stopping ? "Stopping" : `Arranging ${Math.round(state.fraction * 100)}%`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useArrangeState(): ArrangeState {
  return useSyncExternalStore(subscribe, () => arrange, () => IDLE);
}

/** Arrange, or stop the one running (the key is both). */
export function pressArrange(options?: { ungroup?: boolean }) {
  if (!commands) return;
  if (arrange.running) {
    markArrangeStopping();
    commands.cancelArrange();
  } else {
    commands.arrange(options);
  }
}
