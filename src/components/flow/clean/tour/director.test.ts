// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor";
import { A, Director, type Step } from "./director";
import * as input from "./input";
import { getTour, resetTour } from "./tour-store";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import * as sandbox from "./sandbox";

/** jsdom has no layout: give elements a box and make the hit test find the one under a point. */
function box(el: HTMLElement, x: number, y: number, w: number, h: number) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) });
}

function mount(): {
  layer: HTMLElement;
  button: HTMLElement;
  field: HTMLInputElement;
  clicks: number[];
} {
  document.body.innerHTML = "";
  const layer = document.createElement("div");
  const button = document.createElement("div");
  button.setAttribute("role", "button");
  button.id = "go";
  box(button, 100, 100, 40, 20);
  const field = document.createElement("input");
  field.id = "box";
  box(field, 300, 100, 100, 20);
  document.body.append(layer, button, field);
  const clicks: number[] = [];
  button.addEventListener("click", () => clicks.push(1));
  const all = [button, field];
  document.elementsFromPoint = (x: number, y: number) =>
    all.filter((e) => {
      const r = e.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  return { layer, button, field, clicks };
}

describe("the tour's hands", () => {
  beforeEach(() => resetTour());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("clicks what is under the point with the events a mouse makes, in order", () => {
    const { button } = mount();
    const seen: string[] = [];
    for (const t of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      button.addEventListener(t, () => seen.push(t));
    }
    input.click({ x: 110, y: 110 });
    expect(seen).toEqual(["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("makes a right click a contextmenu on the same element", () => {
    const { button } = mount();
    const seen: string[] = [];
    button.addEventListener("contextmenu", () => seen.push("contextmenu"));
    button.addEventListener("click", () => seen.push("click"));
    input.click({ x: 110, y: 110 }, 2);
    expect(seen).toEqual(["contextmenu"]);
  });

  it("types a letter at a time so a controlled box sees every input event", () => {
    const { field } = mount();
    const values: string[] = [];
    field.addEventListener("input", () => values.push(field.value));
    field.focus();
    for (const ch of "10.5") input.typeChar(ch, field);
    expect(values).toEqual(["1", "10", "10.", "10.5"]);
    input.clearText(field);
    expect(field.value).toBe("");
  });

  it("never lands on the tour's own layers", () => {
    const { button } = mount();
    const shield = document.createElement("div");
    shield.dataset.tour = "shield";
    document.body.append(shield);
    box(shield, 0, 0, 2000, 2000);
    const before = document.elementsFromPoint;
    document.elementsFromPoint = (x, y) => [shield, ...before.call(document, x, y)];
    expect(input.hitTest(110, 110)).toBe(button);
  });
});

describe("the director", () => {
  beforeEach(() => resetTour());

  it("recaptures later checkpoints after a replay creates a new task board id", async () => {
    const designs = useDesignStore.getState();
    const factory = useFactoryStore.getState();
    const returning = vi.spyOn(sandbox, "returnToDesign");
    const { layer } = mount();
    let made = 0;
    const summary = (id: string) => ({ id, name: id, createdAt: "now", updatedAt: "now" });
    useDesignStore.setState({ activeDesignId: "source", designs: [summary("source")] });
    const steps: Step[] = [
      {
        id: "create",
        actions: [
          A.run(() => {
            const id = `board-${++made}`;
            useDesignStore.setState({
              activeDesignId: id,
              designs: [summary("source"), summary(id)],
            });
          }),
        ],
        note: { text: "Created." },
      },
      { id: "update", actions: [A.wait(1)], note: { text: "Updated." } },
      { id: "end", actions: [A.wait(1)], note: { text: "Done." } },
    ];
    const director = new Director(steps, new Cursor(layer), {
      onNote: () => undefined,
      onLeave: () => undefined,
    });
    try {
      await director.play(0, true);
      await director.play(1, true);
      await director.back();
      await director.play(1, true);
      await director.play(2, true);
      await director.back();
      expect(returning).toHaveBeenLastCalledWith("board-2", ["source", "board-2"]);
    } finally {
      director.stop();
      returning.mockRestore();
      useDesignStore.setState(designs, true);
      useFactoryStore.setState(factory, true);
    }
  });

  it("plays a step's actions, then waits on its note", async () => {
    const { layer, clicks } = mount();
    const cursor = new Cursor(layer);
    cursor.fast = true;
    const notes: Array<string | null> = [];
    const step: Step = {
      id: "t",
      actions: [A.click(() => document.getElementById("go"), { label: "go" }), A.type(() => document.getElementById("box"), "42", { label: "box" })],
      note: { text: "Done *here*." },
    };
    const director = new Director([step], cursor, { onNote: (n) => notes.push(n ? n.text : null), onLeave: () => undefined });
    await director.play(0, true);
    expect(clicks).toHaveLength(1);
    expect((document.getElementById("box") as HTMLInputElement).value).toBe("42");
    expect(getTour()).toMatchObject({ phase: "waiting", index: 0, noteReady: true });
    expect(notes).toEqual([null, "Done *here*."]);
  });

  it("warns and shows the note when a thing never shows, rather than hang", async () => {
    const { layer } = mount();
    const cursor = new Cursor(layer);
    cursor.fast = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const step: Step = { id: "t", actions: [A.click(() => null, { label: "ghost" })], note: { text: "Next." } };
    const director = new Director([step], cursor, { onNote: () => undefined, onLeave: () => undefined });
    await director.play(0, true);
    expect(getTour().phase).toBe("waiting");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost: not found"));
    warn.mockRestore();
  }, 10000);

  it("stops a step at a wait that never comes, skipping the actions that would wait on it", async () => {
    const { layer } = mount();
    const cursor = new Cursor(layer);
    cursor.fast = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const after = vi.fn();
    const notes: Array<string | null> = [];
    const step: Step = {
      id: "t",
      actions: [A.until(() => false, "the recipe", 50), A.run(after), A.click(() => null, { label: "ghost" })],
      note: { text: "Here." },
    };
    const director = new Director([step], cursor, { onNote: (n) => notes.push(n ? n.text : null), onLeave: () => undefined });
    const t0 = performance.now();
    await director.play(0, true);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(after).not.toHaveBeenCalled();
    expect(getTour()).toMatchObject({ phase: "waiting", noteReady: true });
    expect(notes).toEqual([null, "Here."]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("the recipe: never came"));
    warn.mockRestore();
  });

  it("steps to the next and leaves after the last", async () => {
    const { layer } = mount();
    const cursor = new Cursor(layer);
    cursor.fast = true;
    const left = vi.fn();
    const steps: Step[] = [
      { id: "a", actions: [A.wait(1)], note: { text: "One." } },
      { id: "b", actions: [A.wait(1)], note: { text: "Two." } },
    ];
    const director = new Director(steps, cursor, { onNote: () => undefined, onLeave: left });
    await director.play(0, true);
    await director.next();
    expect(getTour().index).toBe(1);
    await director.next();
    expect(left).toHaveBeenCalledTimes(1);
  });
});
