// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  mockForced,
  mockLeftovers,
  mockUnneeded,
} from "@/lib/solver/plan/__fixtures__/mock-extras";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { formatCompact } from "@/lib/model/resources";
import type { PlanNote } from "@/lib/solver/plan/types";
import { useFactoryStore } from "@/store/factory-store";
import { writeDeviceSettings } from "@/lib/device-settings";
import { OverviewRail } from "./OverviewRail";
import { pinCount } from "./rail-actions";
import { PlanNoticeStack } from "./NoticeBar";
import { RAIL_VIEW_STORAGE_KEY, resetRailViewForTests, writeRailView } from "./rail-view";
import { SparePopupHost, closeSparePopup, openSparePopupForPort } from "./SparePopup";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));

/**
 * The mock answers stand in for the solver: every solve hands back the answer the test loaded, its leftovers
 * following the stored split as the real solver's would.
 */
const solver = vi.hoisted(() => ({
  answer: undefined as undefined | ThroughputResult,
}));
vi.mock("@/store/solve-books", async (original) => {
  const real = await original<typeof import("@/store/solve-books")>();
  return {
    ...real,
    solveBooks: (project: FactoryProject): ThroughputResult => {
      const base = solver.answer;
      if (!base) return real.solveBooks(project);
      const stored = project.spareShares ?? {};
      const leftovers = (base.plan?.leftovers ?? []).map((l) => {
        const split = stored[l.key];
        if (!split) return l;
        const total = l.bearers.reduce((t, b) => t + (split[b.portKey] ?? 0), 0) || 1;
        return {
          ...l,
          custom: true,
          bearers: l.bearers.map((b) => ({ ...b, share: (split[b.portKey] ?? 0) / total })),
        };
      });
      return { ...base, plan: base.plan ? { ...base.plan, leftovers } : undefined };
    },
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function load(mock: typeof mockLeftovers, result: ThroughputResult = mock.result) {
  solver.answer = result;
  useFactoryStore.setState({
    project: mock.project,
    lastResult: result,
    isReadOnly: false,
    undoHistory: [],
    redoHistory: [],
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetRailViewForTests();
  useFactoryStore.getState().setRateUnit("second");
  useFactoryStore.getState().setPowerDisplayUnit("eu");
});
const realFrame = useFactoryStore.getState().frameBoardNodes;
afterEach(() => {
  useFactoryStore.setState({ frameBoardNodes: realFrame });
  closeSparePopup();
  cleanup();
  useFactoryStore.getState().setRateUnit("second");
  useFactoryStore.getState().setPowerDisplayUnit("eu");
});

it("repaints memoized rates, rules and section units without changing the solve", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const row = container.querySelector('[data-resource-row="item:Iron Ingot"]')!;
  const number = row.querySelector(".rail-num")!;
  const box = row.querySelector(".rail-box")!;
  const before = useFactoryStore.getState();
  const perSecond = Number(box.textContent);
  const amount = Number(number.textContent);
  const sign = number.textContent!.startsWith("+") ? "+" : "";
  expect(perSecond).toBeGreaterThan(0);

  for (const [unit, multiplier, suffix] of [
    ["minute", 60, "/min"],
    ["hour", 3600, "/hr"],
    ["tick", 0.05, "/t"],
    ["second", 1, "/s"],
  ] as const) {
    act(() => useFactoryStore.getState().setRateUnit(unit));
    expect(box.textContent).toBe(formatCompact(perSecond * multiplier));
    expect(number.textContent).toBe(`${sign}${formatCompact(amount * multiplier)}`);
    expect(container.querySelector(".rail-sec-end")!.textContent).toBe(suffix);
    expect(useFactoryStore.getState().project).toBe(before.project);
    expect(useFactoryStore.getState().lastResult).toBe(before.lastResult);
    expect(useFactoryStore.getState().undoHistory).toBe(before.undoHistory);
  }
});

it("repaints memoized machine power when the power unit changes", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const power = container.querySelector('[data-rail-machine="comp"] .rail-eu')!;
  expect(power.textContent).toContain("EU/t");
  act(() => useFactoryStore.getState().setPowerDisplayUnit("LV"));
  expect(power.textContent).toContain("A LV");
  act(() => useFactoryStore.getState().setPowerDisplayUnit("eu"));
  expect(power.textContent).toContain("EU/t");
});

it("lists the plan's sections, lines and machines", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const titles = [...container.querySelectorAll(".rail-sec-title")].map((e) => e.textContent);
  expect(titles).toEqual(["INPUTS", "OUTPUTS", "INTERNAL", "MACHINES"]);
  expect(screen.getByText("Copper Dust")).toBeTruthy();
  expect(screen.getByText("Tin Ore")).toBeTruthy();
  // Spare blocks: "Forced" with Split and Auto, once for the imports and once for the surplus.
  expect(container.querySelectorAll(".rail-spare")).toHaveLength(2);
  expect(screen.getAllByText("Split")).toHaveLength(2);
  // The machine group and its four lines.
  expect(container.querySelectorAll(".rail-machine")).toHaveLength(4);
  expect(container.querySelector(".rail-chips .cc-chip")?.textContent).toBe("LV");
});

it("opens with INTERNAL folded, as the mod does", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const folded = [...container.querySelectorAll(".rail-sec")]
    .filter((e) => e.hasAttribute("data-folded"))
    .map((e) => e.querySelector(".rail-sec-title")?.textContent);
  expect(folded).toEqual(["INTERNAL"]);
});

it("folds to a strip and remembers it per device", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  fireEvent.click(screen.getByLabelText("Fold the overview"));
  expect(container.querySelector(".rail-strip")).toBeTruthy();
  expect(JSON.parse(window.localStorage.getItem(RAIL_VIEW_STORAGE_KEY)!).open).toBe(false);
  // Back open.
  fireEvent.click(screen.getByLabelText("Open the overview"));
  expect(container.querySelector(".rail-root")).toBeTruthy();
  // A section folds and stays folded.
  fireEvent.click(container.querySelector(".rail-sec")!);
  expect(JSON.parse(window.localStorage.getItem(RAIL_VIEW_STORAGE_KEY)!).folded).toEqual([
    "INTERNAL",
    "INPUTS",
  ]);
  cleanup();
  resetRailViewForTests();
  const again = render(<OverviewRail />);
  expect(again.container.querySelector(".rail-sec")?.getAttribute("data-folded")).toBe("");
});

it("opens folded away when asked to stay open (the compact drawer)", () => {
  load(mockLeftovers);
  writeRailView({ open: false });
  const { container } = render(<OverviewRail forceOpen />);
  expect(container.querySelector(".rail-root")).toBeTruthy();
});

it("shows as the strip when the window folds it, whatever the player's own fold, and a click on it tells the workspace", () => {
  load(mockLeftovers);
  const onOpen = vi.fn();
  const { container } = render(<OverviewRail open={false} onOpen={onOpen} />);
  expect(container.querySelector(".rail-strip")).toBeTruthy();
  expect(container.querySelector(".rail-root")).toBeNull();
  fireEvent.click(screen.getByLabelText("Open the overview"));
  expect(onOpen).toHaveBeenCalledTimes(1);
  // The click is also the player's own open: nothing about the fold they made is overwritten by the window's.
  expect(JSON.parse(window.localStorage.getItem(RAIL_VIEW_STORAGE_KEY)!).open).toBe(true);
});

it("open from the workspace overrides the stored fold, and the drawer still opens it regardless", () => {
  load(mockLeftovers);
  writeRailView({ open: false });
  const shown = render(<OverviewRail open />);
  expect(shown.container.querySelector(".rail-root")).toBeTruthy();
  cleanup();
  const drawer = render(<OverviewRail open={false} forceOpen />);
  expect(drawer.container.querySelector(".rail-root")).toBeTruthy();
});

it("lights a resource on the board while its row is hovered", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const row = container.querySelector('[data-resource-row="item:Copper Dust"]')!;
  fireEvent.pointerEnter(row);
  expect(useFactoryStore.getState().hoveredFlowResourceKey).toBe("item:Copper Dust");
  fireEvent.pointerLeave(row);
  expect(useFactoryStore.getState().hoveredFlowResourceKey).toBeUndefined();
});

it("frames the next card that makes or uses a resource on click and on middle click, going round", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const row = container.querySelector('[data-resource-row="item:Tin Dust"]')!;
  const framed: string[][] = [];
  const unsubscribe = useFactoryStore.subscribe((state) => {
    const request = state.boardFocusRequest;
    if (request && framed.length < 10 && request.nodeIds.length > 0) {
      const last = framed.at(-1);
      if (!last || last[0] !== request.nodeIds[0] || request.token !== (framed.length ? -1 : 0))
        framed.push(request.nodeIds);
    }
  });
  fireEvent.click(row);
  fireEvent(row, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  fireEvent.click(row);
  unsubscribe();
  // Two crushers make Tin Dust: one, the other, then round to the first again.
  expect(framed.map((ids) => ids[0])).toEqual(["crush", "crush2", "crush"]);
});

it("splits a spare evenly in one undo step, and Auto puts it back", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const importing = container.querySelectorAll(".rail-spare")[0]!;
  const split = [...importing.querySelectorAll(".rail-key")].find(
    (k) => k.textContent === "Split",
  )!;
  fireEvent.click(split);
  const state = useFactoryStore.getState();
  expect(Object.values(state.project.spareShares ?? {})).toEqual([
    { "alloy|i|input:item:Copper%20Dust": 0.5, "alloy2|i|input:item:Copper%20Dust": 0.5 },
  ]);
  expect(state.undoHistory).toHaveLength(1);
  // Undo gives the stored 25/75 back.
  act(() => useFactoryStore.getState().undo());
  expect(Object.values(useFactoryStore.getState().project.spareShares ?? {})[0]).toEqual({
    "alloy|i|input:item:Copper%20Dust": 0.25,
    "alloy2|i|input:item:Copper%20Dust": 0.75,
  });
});

it("puts all of a spare at a place when its row is clicked, and Auto clears the choice", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const importing = container.querySelectorAll(".rail-spare")[0]!;
  const rows = importing.querySelectorAll(".rail-spare-row");
  fireEvent.click(rows[1]!);
  expect(Object.values(useFactoryStore.getState().project.spareShares!)[0]).toEqual({
    "alloy|i|input:item:Copper%20Dust": 0,
    "alloy2|i|input:item:Copper%20Dust": 1,
  });
  const auto = [
    ...container.querySelectorAll(".rail-spare")[0]!.querySelectorAll(".rail-key"),
  ].find((k) => k.textContent === "Auto")!;
  expect(auto.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(auto);
  expect(useFactoryStore.getState().project.spareShares).toBeUndefined();
  expect(useFactoryStore.getState().undoHistory).toHaveLength(2);
});

it("greys Auto until the split is custom", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const outputs = container.querySelectorAll(".rail-spare")[1]!;
  const auto = [...outputs.querySelectorAll(".rail-key")].find((k) => k.textContent === "Auto")!;
  expect(auto.getAttribute("aria-disabled")).toBe("true");
});

it("holds a spare's bar in hand: no undo step while it moves, one when let go", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const bar = container.querySelector(".rail-spare-bar") as HTMLElement;
  bar.getBoundingClientRect = () => ({
    left: 100,
    width: 78,
    top: 0,
    right: 178,
    bottom: 20,
    height: 20,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  bar.setPointerCapture = () => {};
  bar.releasePointerCapture = () => {};
  fireEvent.pointerDown(bar, { button: 0, clientX: 105, pointerId: 1 });
  fireEvent.pointerMove(bar, { clientX: 139, pointerId: 1 });
  const mid = useFactoryStore.getState();
  expect(
    Object.values(mid.project.spareShares!)[0]!["alloy|i|input:item:Copper%20Dust"],
  ).toBeCloseTo(0.5, 9);
  expect(mid.undoHistory).toHaveLength(0);
  fireEvent.pointerMove(bar, { clientX: 178, pointerId: 1 });
  fireEvent.pointerUp(bar, { clientX: 178, pointerId: 1 });
  const end = useFactoryStore.getState();
  expect(Object.values(end.project.spareShares!)[0]!["alloy|i|input:item:Copper%20Dust"]).toBe(1);
  expect(end.undoHistory).toHaveLength(1);
  act(() => useFactoryStore.getState().undo());
  expect(
    Object.values(useFactoryStore.getState().project.spareShares!)[0]![
      "alloy|i|input:item:Copper%20Dust"
    ],
  ).toBe(0.25);
});

it("lets go of a bar that did not move: nothing to undo", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  // The surplus's first place already bears all of it: a press at the far end and a release makes no edit.
  const bar = container
    .querySelectorAll(".rail-spare")[1]!
    .querySelector(".rail-spare-bar") as HTMLElement;
  bar.getBoundingClientRect = () => ({
    left: 100,
    width: 80,
    top: 0,
    right: 180,
    bottom: 20,
    height: 20,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  bar.setPointerCapture = () => {};
  bar.releasePointerCapture = () => {};
  fireEvent.pointerDown(bar, { button: 0, clientX: 190, pointerId: 1 });
  fireEvent.pointerUp(bar, { clientX: 190, pointerId: 1 });
  expect(useFactoryStore.getState().undoHistory).toHaveLength(0);
  // Back to what it was: the stored split of the other spare is untouched, the surplus has none.
  expect(Object.keys(useFactoryStore.getState().project.spareShares!)).toHaveLength(1);
});

function typeInto(container: HTMLElement, key: string, text: string) {
  const row = container.querySelector(`[data-resource-row="${key}"]`)!;
  fireEvent.click(row.querySelector(".rail-box")!);
  const input = container.querySelector("input.rail-box-edit") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

it("types a rate on a line nothing sets: its one open port takes it, as on the card", () => {
  load(mockForced);
  const { container } = render(<OverviewRail />);
  const clay = container.querySelector('[data-resource-row="item:Clay"]')!;
  expect(clay.querySelector(".rail-rule")?.textContent).toBe("~");
  expect(clay.querySelector(".rail-box")?.textContent).toBe("Set");
  typeInto(container, "item:Clay", "2");
  const wash = useFactoryStore.getState().project.nodes.find((n) => n.id === "wash")!;
  expect(wash.portRates).toEqual({ "output:item:Clay": 2 });
  expect(wash.solvePin).toBeUndefined();
  expect(useFactoryStore.getState().undoHistory).toHaveLength(1);
});

it("lists a port set to a rate on its card under its resource, and its key lets the plan decide", () => {
  const project = structuredClone(mockForced.project);
  project.nodes.find((n) => n.id === "wash")!.portRates = { "output:item:Clay": 2 };
  load({ ...mockForced, project });
  const { container } = render(<OverviewRail />);
  const clay = container.querySelector('[data-resource-row="item:Clay"]')!;
  expect(clay.querySelector(".rail-rule")?.textContent).toBe("=");
  expect(clay.querySelector(".rail-box")?.textContent).toBe("2");
  fireEvent.click(clay.querySelector(".rail-rule")!);
  expect(
    useFactoryStore.getState().project.nodes.find((n) => n.id === "wash")!.portRates,
  ).toBeUndefined();
});

it("makes one drawer for a line with several open ports, wired to all of them", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const before = useFactoryStore.getState().project;
  typeInto(container, "item:Tin Dust", "3");
  const after = useFactoryStore.getState().project;
  const made = after.storages!.filter((s) => !before.storages!.some((b) => b.id === s.id));
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({
    resourceId: "Tin Dust",
    targetMode: "at-least",
    targetPerSecond: 3,
  });
  const wired = after.edges
    .filter((e) => e.target === made[0]!.id)
    .map((e) => e.source)
    .sort();
  expect(wired).toEqual(["crush", "crush2"]);
});

it("shows a drawer's rule and rate, and a click types a new one", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const iron = container.querySelector('[data-resource-row="item:Iron Ingot"]')!;
  expect(iron.querySelector(".rail-rule")?.textContent).toBe("≤");
  expect(iron.querySelector(".rail-box")?.textContent).toBe("12");
  fireEvent.click(iron.querySelector(".rail-box")!);
  const input = container.querySelector("input.rail-box-edit") as HTMLInputElement;
  expect(input.value).toBe("12");
  fireEvent.change(input, { target: { value: "1.5k" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const storage = useFactoryStore.getState().project.storages!.find((s) => s.id === "iron")!;
  expect(Math.abs(storage.targetPerSecond!)).toBe(1500);
  expect(storage.targetMode).toBe("at-most");
});

it("ignores text that is not a number", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const iron = container.querySelector('[data-resource-row="item:Iron Ingot"]')!;
  fireEvent.click(iron.querySelector(".rail-box")!);
  const input = container.querySelector("input.rail-box-edit") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "lots" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useFactoryStore.getState().undoHistory).toHaveLength(0);
  expect(container.querySelector("input.rail-box-edit")).toBeNull();
});

it("pins a machine's count from its line and lets it go again", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const machine = container.querySelector(".rail-machine")!;
  const comp = () => useFactoryStore.getState().project.nodes.find((n) => n.id === "comp")!;
  // A set count reads as Up to: the key steps to Exactly, then lets the plan decide.
  expect(machine.querySelector(".rail-rule")?.textContent).toBe("≤");
  fireEvent.click(machine.querySelector(".rail-rule")!);
  expect(comp()).toMatchObject({ solvePin: 6, solvePinExact: true });
  fireEvent.click(machine.querySelector(".rail-rule")!);
  expect(comp().solvePin).toBeUndefined();
  expect(comp().solvePinExact).toBeUndefined();
});

it("writes a typed machine count through the card's rule", () => {
  load(mockUnneeded);
  pinCount("comp", 9);
  const comp = () => useFactoryStore.getState().project.nodes.find((n) => n.id === "comp")!;
  expect(comp()).toMatchObject({ solvePin: 9 });
  expect(comp().solvePinExact).toBeUndefined();
  useFactoryStore.getState().updateNode("comp", { solvePinExact: true });
  pinCount("comp", 4);
  expect(comp()).toMatchObject({ solvePin: 4, solvePinExact: true });
  pinCount("comp", 0);
  expect(comp().solvePin).toBeUndefined();
  expect(comp().solvePinExact).toBeUndefined();
  // Any becomes Up to.
  pinCount("comp", 5);
  expect(comp().solvePinExact).toBeUndefined();
  expect(comp().solvePin).toBe(5);
});

it("shows what runs of what is set for an Up to card", () => {
  load(mockUnneeded);
  const result = {
    ...mockUnneeded.result,
    plan: {
      ...mockUnneeded.result.plan!,
      upTo: { comp: { capacity: 6, reached: 4.5, reason: "STARVED" as const } },
    },
  };
  act(() => {
    useFactoryStore.setState({ lastResult: result });
  });
  const { container } = render(<OverviewRail />);
  const machine = container.querySelector(".rail-machine")!;
  expect(machine.querySelector(".rail-count")?.textContent).toBe("×4.5");
  expect(machine.querySelector(".rail-count")?.getAttribute("data-reason")).toBe("STARVED");
  expect(machine.querySelector(".rail-box")?.textContent).toContain("6");
});

it("steps a drawer's rule with a right click and picks one from its menu", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const iron = container.querySelector('[data-resource-row="item:Iron Ingot"]')!;
  fireEvent.contextMenu(iron.querySelector(".rail-rule")!);
  // at-most steps back to exactly.
  expect(
    useFactoryStore.getState().project.storages!.find((s) => s.id === "iron")!.targetMode,
  ).toBe("exact");
  fireEvent.click(iron.querySelector(".rail-rule")!);
  const items = document.querySelectorAll(".cm-row");
  expect([...items].map((i) => i.textContent)).toEqual([
    "Any~",
    "At least≥",
    "Exactly=",
    "At most≤",
  ]);
  fireEvent.click(items[1]!);
  expect(
    useFactoryStore.getState().project.storages!.find((s) => s.id === "iron")!.targetMode,
  ).toBe("at-least");
});

it("opens a card's Forced row as the spare popup when its leftover has a choice", () => {
  load(mockLeftovers);
  const { container } = render(<SparePopupHost />);
  expect(container.querySelector(".rail-popup")).toBeNull();
  // The input port of the first alloy smelter is one of the two places.
  const portKey = "alloy|i|input:item:Copper%20Dust";
  act(() => {
    expect(openSparePopupForPort(portKey, 100, 100)).toBe(true);
  });
  const popup = document.querySelector(".rail-popup")!;
  expect(popup).toBeTruthy();
  expect(popup.textContent).toContain("(here)");
  expect(popup.textContent).toContain("or put a drawer here");
  act(() => closeSparePopup());
  expect(document.querySelector(".rail-popup")).toBeNull();
  // A port that is not part of a choice opens nothing.
  expect(openSparePopupForPort("nobody|i|input:item:x", 1, 1)).toBe(false);
});

it("hangs a hovered place's ports on the hover scope", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  const row = container.querySelectorAll(".rail-spare")[0]!.querySelectorAll(".rail-spare-row")[1]!;
  fireEvent.pointerEnter(row);
  expect(useFactoryStore.getState().hoveredFlowScope).toEqual({
    edges: {},
    ports: { "alloy2|input:item:Copper%20Dust": true },
    nodes: { alloy2: true },
  });
  fireEvent.pointerLeave(row);
  expect(useFactoryStore.getState().hoveredFlowScope).toBeUndefined();
});

it("leaves the old modes' result alone: no plan extras, no spare blocks", () => {
  load(mockForced, { ...mockForced.result, plan: undefined });
  const { container } = render(<OverviewRail />);
  expect(container.querySelectorAll(".rail-spare")).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

const note = (message: PlanNote["message"], ...args: PlanNote["args"]): PlanNote => ({
  message,
  args,
});

it("shows the notices bar: a row per notice, at most four, the rest counted", () => {
  const many: PlanNote[] = Array.from({ length: 6 }, (_, i) =>
    note("DRAWER_NOT_CONNECTED", `Thing ${i}`, `id${i}`),
  );
  load(mockUnneeded, {
    ...mockUnneeded.result,
    plan: { ...mockUnneeded.result.plan!, unmetDrawers: [], notes: many },
  });
  const { container } = render(<PlanNoticeStack />);
  const rows = [...container.querySelectorAll(".rail-notice")];
  expect(rows).toHaveLength(5);
  expect(rows[0]!.textContent).toContain(
    "The Thing 0 drawer has a rate, but nothing is wired to it",
  );
  expect(rows[4]!.textContent).toBe("+2 more");
});

it("frames what a notice is about when Show me is pressed, one card at a time when they are far apart", () => {
  load(mockUnneeded);
  const frame = vi.fn();
  useFactoryStore.setState({ frameBoardNodes: frame });
  const { container } = render(<PlanNoticeStack />);
  fireEvent.click(container.querySelector(".rail-notice-show")!);
  expect(frame).toHaveBeenCalledWith(["steel"], expect.anything());
});

it("shows no bar for a plan with nothing to say", () => {
  load(mockForced);
  const { container } = render(<PlanNoticeStack />);
  expect(container.querySelector(".rail-notice")).toBeNull();
});

it("keeps a control's clicks to itself: the row does not walk to a card or open the library", () => {
  load(mockUnneeded);
  const frame = vi.fn();
  useFactoryStore.setState({ frameBoardNodes: frame });
  const { container } = render(<OverviewRail />);
  const iron = container.querySelector('[data-resource-row="item:Iron Ingot"]')!;
  fireEvent.click(iron.querySelector(".rail-box")!);
  const input = container.querySelector("input.rail-box-edit") as HTMLInputElement;
  fireEvent.click(input);
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.contextMenu(iron.querySelector(".rail-box, .rail-rule")!);
  expect(frame).not.toHaveBeenCalled();
  // The row itself still walks.
  fireEvent.click(iron);
  expect(frame).toHaveBeenCalledTimes(1);
});

it("steps a rate with the wheel: shown at once, one undo step when the wheel goes still", () => {
  vi.useFakeTimers();
  try {
    load(mockUnneeded);
    const { container } = render(<OverviewRail />);
    const box = container.querySelector(
      '[data-resource-row="item:Iron Ingot"] .rail-box',
    ) as HTMLElement;
    const wheel = (deltaY: number, init: WheelEventInit = {}) =>
      act(() => {
        box.dispatchEvent(
          new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true, ...init }),
        );
      });
    wheel(-100);
    wheel(-100);
    expect(box.textContent).toBe("14");
    // Nothing is in the plan yet.
    expect(useFactoryStore.getState().undoHistory).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const storage = useFactoryStore.getState().project.storages!.find((s) => s.id === "iron")!;
    expect(Math.abs(storage.targetPerSecond!)).toBe(14);
    expect(useFactoryStore.getState().undoHistory).toHaveLength(1);
    // Shift takes steps of a hundred.
    wheel(-100, { shiftKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(
      Math.abs(
        useFactoryStore.getState().project.storages!.find((s) => s.id === "iron")!.targetPerSecond!,
      ),
    ).toBe(114);
  } finally {
    vi.useRealTimers();
  }
});

it("steps nothing with the wheel when Scroll changes values is off: the list keeps the wheel", () => {
  writeDeviceSettings({ scrollChangesValues: false });
  try {
    load(mockUnneeded);
    const { container } = render(<OverviewRail />);
    const box = container.querySelector(
      '[data-resource-row="item:Iron Ingot"] .rail-box',
    ) as HTMLElement;
    const before = box.textContent;
    const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      box.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(box.textContent).toBe(before);
    expect(useFactoryStore.getState().undoHistory).toHaveLength(0);
  } finally {
    writeDeviceSettings({ scrollChangesValues: true });
  }
});

it("lets a wheel that is scrolling the list keep scrolling it past a box", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const list = container.querySelector(".rail-list") as HTMLElement;
  const box = container.querySelector(
    '[data-resource-row="item:Iron Ingot"] .rail-box',
  ) as HTMLElement;
  // The first notch lands on empty list: it scrolls, and records that it did.
  list.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
  const second = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  box.dispatchEvent(second);
  // Within 400 ms of a scroll the box does not take it: the event is left alone.
  expect(second.defaultPrevented).toBe(false);
});

it("steps a machine's tier from its line as the card does", () => {
  load(mockUnneeded);
  const { container } = render(<OverviewRail />);
  const chip = container.querySelector('[data-rail-machine="comp"] .cc-chip') as HTMLElement;
  expect(chip.textContent).toBe("LV");
  const was = () =>
    useFactoryStore.getState().project.nodes.find((n) => n.id === "comp")!.overclockTier;
  fireEvent.click(chip);
  expect(was()).not.toBe("LV");
});
