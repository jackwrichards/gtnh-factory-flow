// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { StorageRatioEditor } from "./StorageRatioEditor";
import { openRatioEditor } from "./ratio-editor";

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
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  useFactoryStore.setState({ project: board(), isReadOnly: false, checklistMode: false });
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState(initial);
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
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
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
