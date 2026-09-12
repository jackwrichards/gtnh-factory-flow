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

it("only opens explicitly, commits on Done, and reopens saved parts", () => {
  render(<StorageRatioEditor />);
  act(() => useFactoryStore.getState().updateStorage("split", { bufferMode: "strict" }));
  act(() => useFactoryStore.getState().updateStorage("split", { bufferMode: "ratio" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => openRatioEditor("split"));
  expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
  const input = screen.getByRole("spinbutton", { name: "Plate drawer parts" });
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => openRatioEditor("split"));
  expect(
    (screen.getByRole("spinbutton", { name: "Plate drawer parts" }) as HTMLInputElement).value,
  ).toBe("1000");
  expect(screen.getAllByRole("status")[0].textContent).toBe("99.9%");
});

it("scrolls parts with a zero floor, rejects invalid input, and closes on Escape cancel", () => {
  render(<StorageRatioEditor />);
  act(() => openRatioEditor("split"));
  const input = screen.getByRole("spinbutton", { name: "Rod drawer parts" }) as HTMLInputElement;
  fireEvent.wheel(input, { deltaY: -100, shiftKey: true });
  expect(input.value).toBe("11");
  fireEvent.wheel(input, { deltaY: 100, shiftKey: true });
  fireEvent.wheel(input, { deltaY: 100, shiftKey: true });
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
