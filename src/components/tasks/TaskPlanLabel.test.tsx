// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskPlanLabel } from "./TaskPlanLabel";
import { openTaskPlan } from "@/lib/tasks/open-link";

vi.mock("@/lib/tasks/open-link", () => ({ openTaskPlan: vi.fn(async () => true) }));

afterEach(cleanup);
const task = { id: "task", title: "Build the factory", status: "todo" as const, order: "a0" };

it("identifies a full-plan task by type and source even after its title changes", () => {
  render(
    <TaskPlanLabel task={{ ...task, sourcePlans: [{ plan: "copper", name: "Copper line" }] }} />,
  );
  expect(screen.getByText("Plan")).toBeTruthy();
  expect(screen.getByText("Copper line")).toBeTruthy();
});

it("does not mark a normal task just because it has machine links", () => {
  const { container } = render(
    <TaskPlanLabel task={{ ...task, links: [{ plan: "copper", node: "n1" }] }} />,
  );
  expect(container.innerHTML).toBe("");
});

it("identifies multiple whole plans in compact chain badges", () => {
  render(
    <TaskPlanLabel
      compact
      task={{
        ...task,
        sourcePlans: [
          { plan: "copper", name: "Copper line" },
          { plan: "power", name: "Power line" },
        ],
      }}
    />,
  );
  expect(screen.getAllByText("Plan")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Open plan Copper line" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open plan Power line" })).toBeTruthy();
});

it("opens the source plan without opening or dragging the enclosing task", async () => {
  const clicked = vi.fn();
  const pressed = vi.fn();
  const keyed = vi.fn();
  render(
    <div onClick={clicked} onPointerDown={pressed} onKeyDown={keyed}>
      <TaskPlanLabel task={{ ...task, sourcePlans: [{ plan: "copper", name: "Copper line" }] }} />
    </div>,
  );
  const key = screen.getByRole("button", { name: "Open plan Copper line" });
  fireEvent.pointerDown(key);
  fireEvent.keyDown(key, { key: "Enter" });
  fireEvent.click(key);
  await waitFor(() => expect(openTaskPlan).toHaveBeenCalledWith("copper"));
  expect(clicked).not.toHaveBeenCalled();
  expect(pressed).not.toHaveBeenCalled();
  expect(keyed).not.toHaveBeenCalled();
});
