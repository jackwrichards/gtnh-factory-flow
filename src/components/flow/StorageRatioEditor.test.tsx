// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { StorageRatioEditor } from "./StorageRatioEditor";
import { openRatioEditor } from "./ratio-editor";
import * as boardSounds from "@/lib/board-sounds";

const initial = useFactoryStore.getState();
function board(): FactoryProject {
  return {
    schemaVersion: 1,
    id: "split-ui",
    name: "Split",
    recipes: [],
    nodes: [],
    fuelProfiles: [],
    storages: ["feed", "split", "Plate", "Rod"].map((id) => ({
      id,
      kind: "item",
      resourceId: "iron",
      displayName: id,
      bufferMode: "ratio",
      drainMode: id === "Rod" ? "byproduct" : "product",
      position: { x: 0, y: 0 },
    })),
    edges: [
      { id: "feed", source: "feed", target: "split", resourceKind: "item", resourceId: "iron" },
      ...["Plate", "Rod"].map((target) => ({
        id: target,
        source: "split",
        target,
        resourceKind: "item" as const,
        resourceId: "iron",
      })),
    ],
  };
}
beforeEach(() => {
  vi.spyOn(boardSounds, "playBoardSound").mockImplementation(() => {});
  HTMLDialogElement.prototype.show = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  useFactoryStore.setState({ project: board(), isReadOnly: false, checklistMode: false });
});
afterEach(() => {
  cleanup();
  useFactoryStore.getState().setRateUnit(initial.rateUnit);
  useFactoryStore.setState(initial);
  vi.restoreAllMocks();
});

it("uses the shared mouse fade and page sounds without fading touch or the rate toolbar", () => {
  render(
    <>
      <div data-board-toolbar>
        <button>Rate menu</button>
      </div>
      <StorageRatioEditor />
    </>,
  );
  act(() => openRatioEditor("split"));
  expect(boardSounds.playBoardSound).toHaveBeenCalledWith("pageOpen");
  const panel = screen.getByRole("dialog");
  panel.getBoundingClientRect = () => ({
    left: 100,
    top: 100,
    right: 500,
    bottom: 500,
    width: 400,
    height: 400,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  const move = (x: number, pointerType: string, target: Element = document.body) => {
    const event = new MouseEvent("pointermove", { clientX: x, clientY: 200, bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    fireEvent(target, event);
  };
  move(800, "touch");
  expect(panel.style.opacity).toBe("");
  // It opens centred, away from the drawer's pencil: moving off the pencil
  // must not count as leaving the panel (Jack, 2026-09-23).
  move(900, "mouse");
  move(1000, "mouse");
  expect(screen.getByRole("dialog")).toBe(panel);
  expect(panel.style.opacity).toBe("");
  move(300, "mouse", panel);
  move(580, "mouse");
  expect(Number(panel.style.opacity)).toBeGreaterThan(0);
  expect(Number(panel.style.opacity)).toBeLessThan(1);
  move(800, "mouse", screen.getByRole("button", { name: "Rate menu" }));
  expect(panel.style.opacity).toBe("");
  fireEvent.pointerDown(screen.getByRole("button", { name: "Rate menu" }));
  expect(screen.getByRole("dialog")).toBe(panel);
  move(720, "mouse");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(vi.mocked(boardSounds.playBoardSound).mock.calls.map(([kind]) => kind)).toEqual([
    "pageOpen",
    "pageClose",
  ]);
});

it("shows actual transfers including stopped branches, and follows the rate unit", () => {
  const project = board();
  const edgeResults = Object.fromEntries(
    project.edges.map((edge) => [
      edge.id,
      {
        edgeId: edge.id,
        resource: {
          key: "item:iron" as const,
          kind: "item" as const,
          resourceId: "iron",
          amountPerSecond: 100,
        },
        transferredPerSecond: edge.id === "feed" ? 8 : edge.id === "Rod" ? 6 : 0,
        demandPerSecond: 100,
        nameplateDemandPerSecond: 100,
        sourceCapacityPerSecond: 100,
        isLimited: true,
        constraint: "supply" as const,
      },
    ]),
  );
  useFactoryStore.setState({
    project,
    lastResult: {
      ...initial.lastResult,
      edges: edgeResults,
      storages: {
        split: {
          storageId: "split",
          kind: "item",
          resourceId: "iron",
          storedAmount: 0,
          capacity: 100,
          producedPerSecond: 8,
          consumedPerSecond: 6,
          netPerSecond: 2,
          status: "filling",
        },
      },
    },
  });
  useFactoryStore.getState().setRateUnit("second");
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  expect(screen.getByLabelText("Product current outgoing rate").textContent).toBe("0/s");
  expect(screen.getByLabelText("Byproduct current outgoing rate").textContent).toBe("6/s");
  expect(screen.getByLabelText("Source current incoming rate").textContent).toBe("8/s");
  expect(screen.getByLabelText("Setup output current outgoing rate").textContent).toBe("2/s");
  act(() => useFactoryStore.getState().setRateUnit("minute"));
  expect(screen.getByLabelText("Source current incoming rate").textContent).toBe("480/min");
  expect(screen.getByLabelText("Product current outgoing rate").textContent).toBe("0/min");
  act(() =>
    useFactoryStore.setState({
      lastResult: {
        ...useFactoryStore.getState().lastResult,
        edges: { ...edgeResults, Plate: { ...edgeResults.Plate, transferredPerSecond: 1 } },
      },
    }),
  );
  expect(screen.getByLabelText("Product current outgoing rate").textContent).toBe("60/min");
});

it("only opens explicitly, commits on Close, and reopens saved percentages", () => {
  render(<StorageRatioEditor />);
  act(() => useFactoryStore.getState().updateStorage("split", { bufferMode: "strict" }));
  act(() => useFactoryStore.getState().updateStorage("split", { bufferMode: "ratio" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => openRatioEditor("split"));
  expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
  expect(screen.getByRole("button", { name: "Equal split incoming" })).toBeTruthy();
  expect(screen.getByText("Source")).toBeTruthy();
  expect(screen.queryByText("Plate drawer")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  const input = screen.getByRole("spinbutton", { name: "Product output percentage" });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "75" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => openRatioEditor("split"));
  expect(
    (screen.getByRole("spinbutton", { name: "Product output percentage" }) as HTMLInputElement)
      .value,
  ).toBe("75");
  expect(
    (screen.getByRole("spinbutton", { name: "Byproduct output percentage" }) as HTMLInputElement)
      .value,
  ).toBe("25");
  expect(
    (screen.getByRole("spinbutton", { name: "Setup output percentage" }) as HTMLInputElement).value,
  ).toBe("0");
});

it("scrolls percentages within 0–100, rejects invalid input, and closes on Escape cancel", () => {
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  const input = screen.getByRole("spinbutton", {
    name: "Byproduct output percentage",
  }) as HTMLInputElement;
  fireEvent.wheel(input, { deltaY: -100, shiftKey: true });
  expect(input.value).toBe("60");
  for (let i = 0; i < 7; i++) fireEvent.wheel(input, { deltaY: 100, shiftKey: true });
  expect(input.value).toBe("0");
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "-5" } });
  fireEvent.blur(input);
  expect(input.value).toBe("0");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("cannot open while locked and clears an editor when its project changes", () => {
  render(<StorageRatioEditor />);
  act(() => useFactoryStore.setState({ isReadOnly: true }));
  act(() => openRatioEditor("split"));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => useFactoryStore.setState({ isReadOnly: false, checklistMode: true }));
  act(() => openRatioEditor("split"));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => useFactoryStore.setState({ checklistMode: false }));
  act(() => openRatioEditor("split"));
  act(() => useFactoryStore.setState({ project: { ...board(), id: "other" } }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => useFactoryStore.setState({ project: board() }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps legacy ratio precision when a percentage field is only focused", () => {
  const project = board();
  project.edges.find((edge) => edge.id === "Plate")!.ratioWeight = 1;
  project.edges.find((edge) => edge.id === "Rod")!.ratioWeight = 2;
  useFactoryStore.setState({ project });
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  const input = screen.getByRole("spinbutton", { name: "Product output percentage" });
  act(() => input.focus());
  act(() => input.blur());
  expect(useFactoryStore.getState().project).toBe(project);
  expect(screen.getByRole("heading", { name: "Incoming" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Outgoing" })).toBeTruthy();
  expect(screen.queryByText("100%")).toBeNull();
});

it("steps the current draft with the buttons and arrow keys", () => {
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  const input = screen.getByRole("spinbutton", {
    name: "Product output percentage",
  }) as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Increase Product output percentage" }));
  expect(input.value).toBe("61");
  fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
  expect(input.value).toBe("51");
  act(() => input.blur());
  expect(input.value).toBe("51");
});

it("zeros a branch, redistributes its share, and disables the zero button", () => {
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  const input = screen.getByRole("spinbutton", {
    name: "Product output percentage",
  }) as HTMLInputElement;
  const zero = screen.getByRole("button", {
    name: "Zero Product output percentage",
  }) as HTMLButtonElement;
  expect(zero.disabled).toBe(false);
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "80" } });
  fireEvent.click(zero);
  act(() => input.blur());
  expect(input.value).toBe("0");
  expect(zero.disabled).toBe(true);
  expect(
    (screen.getByRole("spinbutton", { name: "Byproduct output percentage" }) as HTMLInputElement)
      .value,
  ).toBe("100");
  expect(
    (screen.getByRole("button", { name: "Zero Setup output percentage" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
