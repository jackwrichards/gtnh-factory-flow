// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useFactoryStore } from "@/store/factory-store";
import { getProjectRatioBranches } from "@/lib/model/storage-ratios";
import { RatioWireLabel } from "./RatioWireLabel";

const initial = useFactoryStore.getState();
beforeEach(() => {
  useFactoryStore.setState({
    isReadOnly: false,
    checklistMode: false,
    project: {
      schemaVersion: 1,
      id: "wire-edit",
      name: "Wire",
      recipes: [],
      nodes: [],
      fuelProfiles: [],
      storages: ["source", "a", "b", "other", "product"].map((id) => ({
        id,
        resourceId: "iron",
        kind: "item",
        position: { x: 0, y: 0 },
        bufferMode: "ratio",
      })),
      edges: [
        ["feed", "source", "a"],
        ["wire", "a", "b"],
        ["out", "a", "product"],
        ["in", "other", "b"],
        ["end", "b", "product"],
      ].map(([id, source, target]) => ({
        id,
        source,
        target,
        resourceKind: "item",
        resourceId: "iron",
      })),
    },
  });
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState(initial);
});
const share = (storage: string, side: "input" | "output") =>
  getProjectRatioBranches(useFactoryStore.getState().project, side)
    .get(storage)!
    .find((branch) => branch.edges.some((edge) => edge.id === "wire"))!.share * 100;
function show() {
  render(
    <RatioWireLabel
      edgeId="wire"
      label={{ key: "both", text: "Out 50%\nIn 50%", ratio: 0.5, point: { x: 60, y: 0 } }}
      shares={{ input: 0.5, output: 0.5 }}
    />,
  );
}
it("edits both sides independently, consumes wheel events, and reads fresh percentages during a burst", () => {
  show();
  const output = screen.getByRole("spinbutton", { name: "Outgoing percentage" });
  act(() => {
    for (let i = 0; i < 3; i++) {
      const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
      output.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
  expect(share("a", "output")).toBeCloseTo(53);
  expect(share("b", "input")).toBe(50);
  fireEvent.wheel(screen.getByRole("spinbutton", { name: "Incoming percentage" }), {
    deltaY: 100,
    shiftKey: true,
  });
  expect(share("b", "input")).toBeCloseTo(40);
  expect(share("a", "output")).toBeCloseTo(53);
  act(() => useFactoryStore.getState().undo());
  expect(share("b", "input")).toBe(50);
});
it("supports keyboard steps and clamps at zero and one hundred", () => {
  show();
  const output = screen.getByRole("spinbutton", { name: "Outgoing percentage" });
  for (let i = 0; i < 7; i++) fireEvent.keyDown(output, { key: "ArrowUp", shiftKey: true });
  expect(share("a", "output")).toBeCloseTo(100);
  for (let i = 0; i < 12; i++) fireEvent.wheel(output, { deltaY: 100, shiftKey: true });
  expect(share("a", "output")).toBe(0);
});
it.each(["isReadOnly", "checklistMode"] as const)("does not edit in %s", (key) => {
  show();
  act(() => useFactoryStore.setState({ [key]: true }));
  const output = screen.getByRole("spinbutton", { name: "Outgoing percentage" });
  fireEvent.wheel(output, { deltaY: -100 });
  fireEvent.keyDown(output, { key: "ArrowUp" });
  expect(share("a", "output")).toBe(50);
  expect(output.getAttribute("tabindex")).toBe("-1");
});
