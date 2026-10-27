"use client";

import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { Cursor, draws, sleep, type MouseGlyph } from "./cursor";
import * as input from "./input";
import type { Mods } from "./input";
import { currentDesignId, resetBorrowedSettings, restoreProject, returnToDesign } from "./sandbox";
import { bringIntoView, centreOf, ensureHittable, scrollToShow, settled, type Target } from "./targets";
import { getTour, resetTour, setTour } from "./tour-store";
import { setSfxHurried } from "@/lib/sound/sfx";

/**
 * Plays the script a step at a time. A step acts something out (the cursor glides, clicks, drags, types, presses
 * keys through real events) and then waits on its note until the player says next. Hurrying (next part way, a
 * jump, Back replaying a step) runs the same actions without their glides but never faster than the page draws:
 * the pointer still rests until the page has drawn twice with it there, on a target that has stopped moving.
 */

export type Pt = { x: number; y: number };
/** What an action points at: an element now, or a spot on the page. */
export type Aim = Target | (() => Pt | null);

export class Aborted extends Error {}

/**
 * What a step waits for never came (a target not found, a recipe list that never showed): the rest of the step would
 * act on nothing, each action waiting out its own bound, so the step stops there and shows its note.
 */
export class Missed extends Error {}

export interface Ctx {
  cursor: Cursor;
  /** Hurried: glides and waits shrink, settling does not. */
  fast: boolean;
  dead: () => boolean;
  stepIndex: number;
}

export type Action = (c: Ctx) => Promise<void>;

export interface NoteSpec {
  text: string;
  /** What the note points at (framed in gold); none says it in the middle of the screen. */
  at?: Aim;
  /** The thing shows bare, without the gold frame. */
  bare?: boolean;
  /** A note about nothing in particular (lines with mouse glyphs): placed on the screen, not at a thing. */
  nothing?: boolean;
  /** Which lines of a nothing-note are lit (the one the tour is showing). */
  lit?: number;
}

export interface Step {
  id: string;
  actions: Action[];
  note: NoteSpec;
}

const warnings: string[] = [];
export function tourWarnings(): readonly string[] {
  return warnings;
}

function warn(ctx: { stepIndex: number }, message: string): void {
  const text = `[tour] step ${ctx.stepIndex + 1}: ${message}`;
  warnings.push(text);
  console.warn(text);
}

function guard(c: Ctx): void {
  if (c.dead()) throw new Aborted();
}

async function resolve(aim: Aim, c: Ctx, label: string, timeoutMs = 3500): Promise<{ el?: Element; pt: Pt }> {
  const t0 = performance.now();
  for (;;) {
    guard(c);
    const got = aim();
    if (got instanceof Element) {
      const el = await settled(() => (aim() instanceof Element ? (aim() as Element) : null), 1500);
      if (el) {
        guard(c);
        await bringIntoView(el);
        await scrollToShow(el);
        await ensureHittable(el);
        const settledEl = (await settled(() => (aim() instanceof Element ? (aim() as Element) : null), 1500)) ?? el;
        return { el: settledEl, pt: centreOf(settledEl) };
      }
    } else if (got) {
      return { pt: got };
    }
    if (performance.now() - t0 > timeoutMs) {
      warn(c, `${label}: not found`);
      throw new Missed(label);
    }
    await draws(1);
  }
}

/** Waits until nothing on the page has changed for a moment (a menu opening, a card landing, a solve). */
export function quiet(maxMs = 700, calmMs = 90): Promise<void> {
  return new Promise((resolveQuiet) => {
    let timer = window.setTimeout(done, calmMs);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, calmMs);
    });
    const cap = window.setTimeout(done, maxMs);
    function done() {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(cap);
      resolveQuiet();
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

const scale = (c: Ctx, ms: number) => (c.fast ? Math.min(ms, 30) : ms);

// region Actions

export const A = {
  /** The cursor to the thing. */
  go:
    (aim: Aim, label = "target"): Action =>
    async (c) => {
      const at = await resolve(aim, c, label);
      await c.cursor.glide(at.pt.x, at.pt.y);
      input.moveTo(at.pt);
      await draws(2);
    },

  click:
    (aim: Aim, o: { button?: 0 | 1 | 2; mods?: Mods; label?: string; caps?: string[]; double?: boolean } = {}): Action =>
    async (c) => {
      const at = await resolve(aim, c, o.label ?? "click target");
      await c.cursor.glide(at.pt.x, at.pt.y);
      guard(c);
      if (o.caps) c.cursor.caps(o.caps);
      c.cursor.badge(o.button === 2 ? "right" : o.button === 1 ? "middle" : "left");
      await sleep(scale(c, 110));
      c.cursor.ripple(o.button === 2 ? "right" : o.button === 1 ? "middle" : "left");
      if (o.double) input.doubleClick(at.pt, o.mods);
      else input.click(at.pt, o.button ?? 0, o.mods);
      await draws(2);
      await sleep(scale(c, 140));
      c.cursor.badge(null);
      c.cursor.caps(null);
      await quiet();
    },

  right: (aim: Aim, o: { mods?: Mods; label?: string } = {}): Action => A.click(aim, { ...o, button: 2 }),

  /** Clicks a text box and types into it, a letter at a time; the old text goes first. */
  type:
    (aim: Aim, text: string, o: { enter?: boolean; label?: string; keep?: boolean } = {}): Action =>
    async (c) => {
      const at = await resolve(aim, c, o.label ?? "text box");
      await c.cursor.glide(at.pt.x, at.pt.y);
      c.cursor.ripple();
      input.click(at.pt);
      await draws(2);
      let box: HTMLInputElement | HTMLTextAreaElement | null =
        document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
          ? document.activeElement
          : null;
      // The box itself, or one inside what was aimed at, when the click left the focus elsewhere.
      if (!box && at.el) {
        box =
          at.el instanceof HTMLInputElement || at.el instanceof HTMLTextAreaElement
            ? at.el
            : at.el.querySelector("input, textarea");
        box?.focus({ preventScroll: true });
      }
      if (!box) {
        // The click may have swapped a button for a box; give it a frame or two.
        await draws(3);
        box =
          document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
            ? document.activeElement
            : null;
      }
      if (!box) {
        warn(c, `${o.label ?? "text box"}: nothing took the typing`);
        throw new Missed(o.label ?? "text box");
      }
      if (!o.keep) input.clearText(box);
      for (const ch of text) {
        guard(c);
        input.typeChar(ch, box);
        await sleep(scale(c, 70));
      }
      await draws(2);
      if (o.enter) {
        input.pressKey("Enter");
        await draws(2);
      }
      await quiet();
    },

  /** A key (or keys) pressed, with caps beside the cursor; held for `hold` ms when it should be. */
  key:
    (key: string, o: { mods?: Mods; caps?: string[]; hold?: number } = {}): Action =>
    async (c) => {
      c.cursor.show();
      c.cursor.caps(o.caps ?? [key.length === 1 ? key.toUpperCase() : key]);
      await sleep(scale(c, 160));
      input.keyDown(key, o.mods);
      if (o.hold) await sleep(scale(c, o.hold));
      input.keyUp(key, o.mods);
      await draws(2);
      await sleep(scale(c, 120));
      c.cursor.caps(null);
      await quiet();
    },

  /** A key held while another action runs (Shift for a click that adds to the selection). */
  withKey:
    (key: string, inner: Action[], o: { caps?: string[] } = {}): Action =>
    async (c) => {
      const mods = key === "Shift" ? { shift: true } : key === "Control" ? { ctrl: true } : {};
      c.cursor.caps(o.caps ?? [key]);
      input.keyDown(key, mods);
      try {
        for (const a of inner) await a(c);
      } finally {
        input.keyUp(key);
        c.cursor.caps(null);
      }
    },

  wheel:
    (aim: Aim, deltaY: number, o: { mods?: Mods; times?: number; label?: string } = {}): Action =>
    async (c) => {
      const at = await resolve(aim, c, o.label ?? "wheel target");
      await c.cursor.glide(at.pt.x, at.pt.y);
      c.cursor.wheelArrow(deltaY > 0 ? 1 : -1);
      for (let i = 0; i < (o.times ?? 1); i++) {
        guard(c);
        input.wheel(at.pt, deltaY, o.mods);
        await sleep(scale(c, 120));
      }
      await draws(2);
      c.cursor.badge(null);
      c.cursor.caps(null);
      await quiet();
    },

  /** A left drag from one thing to another (or to a spot), as a hand makes it: press, glide, let go. */
  drag:
    (from: Aim, to: Aim, o: { button?: 0 | 1; mods?: Mods; label?: string; caps?: string[] } = {}): Action =>
    async (c) => {
      const a = await resolve(from, c, `${o.label ?? "drag"} start`);
      await c.cursor.glide(a.pt.x, a.pt.y);
      c.cursor.badge(o.button === 1 ? "middle" : "left");
      if (o.caps) c.cursor.caps(o.caps);
      await sleep(scale(c, 120));
      input.press(a.pt, o.button ?? 0, o.mods);
      await draws(1);
      c.cursor.onMove = (x, y) => input.moveTo({ x, y }, o.mods);
      let b: { el?: Element; pt: Pt };
      try {
        b = await resolve(to, c, `${o.label ?? "drag"} end`);
      } catch (error) {
        // Nowhere to take it: let go where it was picked up.
        c.cursor.onMove = undefined;
        input.release(a.pt, o.button ?? 0, o.mods, false);
        throw error;
      }
      try {
        // A first nudge past the slop so the press reads as a drag at once, then the glide.
        input.moveTo({ x: a.pt.x + 6, y: a.pt.y + 6 }, o.mods);
        await c.cursor.glide(b.pt.x, b.pt.y, c.fast ? undefined : 650);
        input.moveTo(b.pt, o.mods);
        await draws(2);
      } finally {
        c.cursor.onMove = undefined;
      }
      input.release(b.pt, o.button ?? 0, o.mods, false);
      await draws(2);
      c.cursor.badge(null);
      c.cursor.caps(null);
      await quiet();
    },

  /** A tile of the items column (browser drag and drop) carried to the board. */
  dragItem:
    (from: Aim, to: Aim, o: { label?: string } = {}): Action =>
    async (c) => {
      const a = await resolve(from, c, `${o.label ?? "item"} start`);
      if (!a?.el) return;
      await c.cursor.glide(a.pt.x, a.pt.y);
      c.cursor.badge("left");
      await sleep(scale(c, 120));
      const b = await resolve(to, c, `${o.label ?? "item"} drop`);
      await c.cursor.glide(b.pt.x, b.pt.y, c.fast ? undefined : 700);
      input.dragDrop(a.el, a.pt, b.pt);
      await draws(2);
      c.cursor.badge(null);
      await quiet();
    },

  /** Several actions as one. */
  seq:
    (...actions: Action[]): Action =>
    async (c) => {
      for (const a of actions) await a(c);
    },

  /** Runs an action only when the condition holds when it is reached (a key that may or may not be showing). */
  when:
    (cond: () => boolean, action: Action): Action =>
    async (c) => {
      if (cond()) await action(c);
    },

  /** Scrolls the thing into view in its list (no cursor). */
  show:
    (aim: Aim): Action =>
    async (c) => {
      const at = await resolve(aim, c, "thing to show");
      void at;
    },

  badge:
    (kind: MouseGlyph | null): Action =>
    async (c) => {
      c.cursor.badge(kind);
    },

  wait:
    (ms: number): Action =>
    async (c) => {
      await sleep(scale(c, ms));
    },

  /** Anything that is not a hand: setting up the plan, closing things. */
  run:
    (fn: (c: Ctx) => void | Promise<void>): Action =>
    async (c) => {
      guard(c);
      await fn(c);
      await draws(2);
      await quiet();
    },

  /** Waits for something the planner does by itself (a solve, a recipe list). */
  until:
    (predicate: () => boolean, label: string, timeoutMs = 6000): Action =>
    async (c) => {
      const t0 = performance.now();
      while (!predicate()) {
        guard(c);
        if (performance.now() - t0 > timeoutMs) {
          warn(c, `${label}: never came`);
          throw new Missed(label);
        }
        await draws(1);
      }
      await draws(2);
    },

  /** The cursor off to the side, so the note reads and nothing is under it. */
  aside:
    (): Action =>
    async (c) => {
      if (c.fast) {
        c.cursor.hide();
        return;
      }
      await c.cursor.stepAside();
    },
};

// endregion

// region The director

export interface DirectorHooks {
  onNote: (note: NoteSpec | null) => void;
  onLeave: () => void;
}

interface Start {
  project: ReturnType<typeof useFactoryStore.getState>["project"];
  /** The design the step began on: the tour's plan, or a task board it made. */
  designId?: string;
  /** Keep task boards that already existed at this step, removing only later tour creations. */
  designIds: string[];
}

export class Director {
  private steps: Step[];
  private cursor: Cursor;
  private hooks: DirectorHooks;
  private token = 0;
  private fast = false;
  private starts = new Map<number, Start>();
  private busy = false;

  /** Replayed creation steps make fresh design ids, so later checkpoints must be captured again. */
  private forgetAfter(index: number): void {
    for (const saved of this.starts.keys()) if (saved > index) this.starts.delete(saved);
  }

  constructor(steps: Step[], cursor: Cursor, hooks: DirectorHooks) {
    this.steps = steps;
    this.cursor = cursor;
    this.hooks = hooks;
    // Catching up to a step is silent; played at its own pace, the tour sounds as the player would.
    setSfxHurried(() => this.busy && this.fast);
  }

  get length(): number {
    return this.steps.length;
  }

  /** Hurry the step in play to its note. */
  hurry(): void {
    this.fast = true;
    this.cursor.fast = true;
  }

  /** Plays step `index`. `fast` replays it hurried (Back, a jump). */
  async play(index: number, fast = false): Promise<void> {
    const token = ++this.token;
    const step = this.steps[index];
    if (!step) return;
    this.fast = fast;
    this.cursor.fast = fast;
    this.busy = true;
    this.hooks.onNote(null);
    setTour({ phase: "playing", index, total: this.steps.length, noteReady: false });
    // The plans at the start of every step, so Back can put them back.
    if (!this.starts.has(index)) this.starts.set(index, {
        project: structuredClone(useFactoryStore.getState().project),
        designId: currentDesignId(),
        designIds: useDesignStore.getState().designs.map((design) => design.id),
      });
    const isFast = () => this.fast;
    const ctx: Ctx = {
      cursor: this.cursor,
      get fast() {
        return isFast();
      },
      stepIndex: index,
      dead: () => token !== this.token,
    };
    try {
      input.resetPointerState();
      for (const action of step.actions) {
        if (ctx.dead()) return;
        await action(ctx);
      }
      if (ctx.dead()) return;
      this.cursor.caps(null);
      this.cursor.badge(null);
      this.cursor.hide();
      await draws(2);
      this.hooks.onNote(step.note);
      setTour({ phase: "waiting", noteReady: true });
    } catch (error) {
      if (error instanceof Aborted) return;
      // A miss is warned where it happened; anything else is a fault.
      if (!(error instanceof Missed)) {
        warn({ stepIndex: index }, `failed: ${error instanceof Error ? error.message : String(error)}`);
        console.error(error);
      }
      if (!ctx.dead()) {
        this.hooks.onNote(step.note);
        setTour({ phase: "waiting", noteReady: true });
      }
    } finally {
      if (token === this.token) this.busy = false;
    }
  }

  async next(): Promise<void> {
    const { index, phase } = getTour();
    if (phase === "idle") return;
    if (phase === "playing") {
      this.hurry();
      return;
    }
    if (index + 1 >= this.steps.length) {
      this.hooks.onLeave();
      return;
    }
    await this.play(index + 1);
  }

  /** Back: the plans as that step started, then the step again, hurried. */
  async back(): Promise<void> {
    const { index } = getTour();
    if (index <= 0) return;
    this.token++;
    const target = index - 1;
    const start = this.starts.get(target);
    this.forgetAfter(target);
    this.closeThings();
    if (start) {
      await returnToDesign(start.designId, start.designIds);
      restoreProject(start.project);
    }
    await draws(3);
    await this.play(target, true);
  }

  /** Jumps to a step: the nearest saved start before it, then the steps between, hurried. */
  async jump(index: number): Promise<void> {
    this.token++;
    const from = Math.max(0, Math.min(this.steps.length - 1, index));
    let begin = from;
    while (begin > 0 && !this.starts.has(begin)) begin--;
    const start = this.starts.get(begin);
    this.forgetAfter(begin);
    this.closeThings();
    if (start) {
      await returnToDesign(start.designId, start.designIds);
      restoreProject(start.project);
    }
    await draws(3);
    for (let i = begin; i < from; i++) {
      await this.play(i, true);
      // play() leaves the note up; carry straight on.
      if (getTour().phase === "idle") return;
    }
    await this.play(from, from !== begin);
  }

  /** Stops what is playing; the player's own things are put back by the sandbox. */
  stop(): void {
    this.token++;
    this.busy = false;
    this.cursor.caps(null);
    this.cursor.badge(null);
    this.cursor.hide();
    this.hooks.onNote(null);
    resetTour();
  }

  get playing(): boolean {
    return this.busy;
  }

  /** Menus and boxes a step may leave open, shut before a replay. */
  private closeThings(): void {
    const factory = useFactoryStore.getState();
    factory.clearResourceBrowser();
    resetBorrowedSettings();
    input.pressKey("Escape");
  }
}

// endregion
