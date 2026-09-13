// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useFactoryStore } from "@/store/factory-store";
import { getProjectRatioBranches } from "@/lib/model/storage-ratios";
import { RatioSetupOutput, RatioWireLabel } from "./RatioWireLabel";

const initial = useFactoryStore.getState();

it("updates the number's contrast when the arrow fill changes", () => {
  const props = {
    edgeId: "wire",
    label: { key: "output", text: "50%", ratio: 0.5, point: { x: 0, y: 0 } },
    shares: { output: 0.5 },
  };
  const { container, rerender } = render(<RatioWireLabel {...props} arrowFill="#121212" />);
  expect((container.firstElementChild as HTMLElement).style.color).toBe("rgb(255, 255, 255)");
  rerender(<RatioWireLabel {...props} arrowFill="#eeeeee" />);
  expect((container.firstElementChild as HTMLElement).style.color).toBe("rgb(0, 0, 0)");
});
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

it("previews the full split on hover and keeps every percentage live while scrolling", async () => {
  show();
  const output = screen.getByRole("spinbutton", { name: "Outgoing percentage" });
  fireEvent.mouseMove(output, { clientX: 300, clientY: 300, buttons: 0 });
  const preview = await screen.findByRole("tooltip", { name: "Ratio split" });
  const incoming = within(preview).getByRole("region", { name: "Incoming" });
  const outgoing = within(preview).getByRole("region", { name: "Outgoing" });
  expect(within(incoming).getByText("Source")).toBeTruthy();
  expect(within(incoming).getByText("100%")).toBeTruthy();
  expect(within(outgoing).getAllByText("50%")).toHaveLength(2);
  expect(within(outgoing).getByText("Setup output")).toBeTruthy();
  expect(within(preview).getByRole("img", { name: "Mouse wheel" })).toBeTruthy();
  expect(within(preview).getByText("↑ +1% · ↓ −1%")).toBeTruthy();
  fireEvent.wheel(output, { deltaY: -100 });
  expect(within(outgoing).getByText("51%")).toBeTruthy();
  expect(within(outgoing).getByText("49%")).toBeTruthy();
  expect(screen.getByRole("tooltip")).toBe(preview);
  fireEvent.mouseLeave(output.closest("[data-tooltip-root]")!);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("shows the destination drawer's split when hovering an incoming percentage", async () => {
  show();
  const input = screen.getByRole("spinbutton", { name: "Incoming percentage" });
  fireEvent.mouseMove(input, { clientX: 300, clientY: 300, buttons: 0 });
  const preview = await screen.findByRole("tooltip");
  expect(
    within(within(preview).getByRole("region", { name: "Incoming" })).getAllByText("50%"),
  ).toHaveLength(2);
  expect(
    within(within(preview).getByRole("region", { name: "Outgoing" })).getByText("100%"),
  ).toBeTruthy();
});

it("opens the same overview from Setup output and updates it as export changes", async () => {
  render(<RatioSetupOutput storageId="a" percentage={0} />);
  const output = screen.getByRole("spinbutton", { name: "Setup output percentage" });
  fireEvent.mouseMove(output, { clientX: 300, clientY: 300, buttons: 0 });
  const preview = await screen.findByRole("tooltip");
  fireEvent.wheel(output, { deltaY: -100, shiftKey: true });
  expect(within(preview).getByText("10%")).toBeTruthy();
  expect(within(preview).getAllByText("45%")).toHaveLength(2);
});

it("scrolls Setup output on the drawer and redistributes its wired outgoing shares", () => {
  render(<RatioSetupOutput storageId="a" percentage={0} />);
  const control = screen.getByRole("spinbutton", { name: "Setup output percentage" });
  expect(control.hasAttribute("title")).toBe(false);
  fireEvent.wheel(control, { deltaY: -100, shiftKey: true });
  expect(
    useFactoryStore.getState().project.storages?.find((s) => s.id === "a")?.ratioExportPercent,
  ).toBe(10);
  expect(share("a", "output")).toBeCloseTo(45);
  expect(share("b", "input")).toBe(50);
  act(() => useFactoryStore.getState().undo());
  expect(share("a", "output")).toBe(50);
});
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
