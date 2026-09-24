// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyProject } from "@/examples";
import { useFactoryStore } from "@/store/factory-store";
import { DrawerTargetRow } from "./DrawerTargetRow";

const initial = useFactoryStore.getState();
beforeEach(() => {
  const project = createEmptyProject();
  project.poolMode = true;
  project.solveMode = true;
  project.storages = ["a", "b"].map((id) => ({ id, kind: "item", resourceId: "product", poolSide: "drain", targetPerSecond: 2, position: { x: 0, y: 0 } }));
  useFactoryStore.getState().markHydratedProject(project);
  useFactoryStore.getState().setRateUnit("minute");
});
afterEach(() => {
  cleanup();
  useFactoryStore.getState().setRateUnit(initial.rateUnit);
  useFactoryStore.setState(initial);
});
function Harness() {
  const storage = useFactoryStore((s) => s.project.storages![0]);
  return <DrawerTargetRow storage={storage} input={false} isLast />;
}
describe("inspector drawer target", () => {
  it("uses the drawer editor, converts units, preserves linked targets and supports undo", () => {
    render(<Harness />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Required amount" }));
    const input = screen.getByRole("textbox", { name: "Required amount" });
    fireEvent.change(input, { target: { value: "3.6k" } });
    fireEvent.blur(input);
    expect(useFactoryStore.getState().project.storages!.map(s => s.targetPerSecond)).toEqual([60, 60]);
    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().project.storages!.map(s => s.targetPerSecond)).toEqual([2, 2]);
  });
  it("sets the rule with Pool's rule button, shown by its mark", () => {
    render(<Harness />);
    const rule = screen.getByRole("button", { name: /^Rule for product: At least/ });
    expect(rule.textContent).toBe("≥");
    fireEvent.click(rule);
    fireEvent.click(screen.getByRole("option", { name: /Exactly/ }));
    expect(useFactoryStore.getState().project.storages![0].targetMode).toBe("exact");
    expect(screen.getByRole("button", { name: /^Rule for product: Exactly/ }).textContent).toBe("=");
  });
  it("does not expose an editor in build mode or read-only viewing", () => {
    useFactoryStore.setState({ isReadOnly: true });
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole("button", { name: "Required amount" })).toBeNull();
    useFactoryStore.setState({ isReadOnly: false, project: { ...useFactoryStore.getState().project, solveMode: false, poolMode: false } });
    rerender(<Harness />);
    expect(screen.queryByRole("button", { name: "Required amount" })).toBeNull();
  });
});
