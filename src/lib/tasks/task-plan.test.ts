import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import { syncTaskPlan } from "./task-plan";
import { cardLine, taskProgress } from "./task-board";
import type { FactoryProject, PlanTaskItem } from "@/lib/model/types";

const source = { plan: "p", name: "Copper" };
const task = {
  id: "t",
  title: "My build",
  text: "Keep this note",
  status: "doing" as const,
  order: "a0",
  sourcePlans: [source, { plan: "other", name: "Other plan" }],
};
const item = (id: string, node: string, text: string, plan = "p"): PlanTaskItem => ({
  id,
  taskId: "t",
  text,
  done: true,
  order: `a${id}`,
  kind: "machine",
  link: { plan, node },
});
const cards = [
  { nodeId: "same", name: "Bender", tier: "LV", count: 2 },
  { nodeId: "changed", name: "Mixer", tier: "MV", count: 3 },
  { nodeId: "new", name: "Furnace", tier: "LV", count: 1 },
];
function project(): FactoryProject {
  return {
    ...createEmptyProject(),
    primaryView: "tasks",
    tasks: [task],
    taskItems: [
      item("0", "same", "2× Bender (LV)"),
      item("1", "changed", "1× Mixer (LV)"),
      item("2", "removed", "1× Pump (LV)"),
      item("3", "x", "Other machine", "other"),
      { id: "4", taskId: "t", text: "Personal note", done: true, order: "a4" },
    ],
  };
}
describe("refreshing a task from its plan", () => {
  it.each([
    ["8× Bender (LV)", 3, "Bender", "LV", true, true],
    ["8× Bender (LV)", 0, "Bender", "LV", true, true],
    ["8× Bender (LV)", 8, "Bender", "LV", true, true],
    ["3× Bender (LV)", 8, "Bender", "LV", true, false],
    ["8× Mixer (LV)", 3, "Bender", "LV", true, false],
    ["8× Bender (MV)", 3, "Bender", "LV", true, false],
    ["8× Bender (LV)", 3, "Bender", "LV", false, false],
    ["Bender (LV)", 3, "Bender", "LV", true, false],
  ])("refreshes %s to %s %s (%s), checked=%s -> %s", (text, count, name, tier, done, expected) => {
    const before = project();
    before.taskItems = [{ ...item("0", "same", text), done }];
    const after = syncTaskPlan(before, "t", source, ["p"], [{ nodeId: "same", name, tier, count }]);
    expect(after.taskItems?.[0]).toMatchObject({
      id: "0",
      text: cardLine({ count, name, tier }),
      done: expected,
    });
  });

  it("updates the source machines without disturbing other plans, notes or task details", () => {
    const before = project();
    const after = syncTaskPlan(before, "t", { ...source, name: "Renamed copper" }, ["p"], cards);
    expect(after.taskItems?.find((row) => row.id === "0")).toBe(before.taskItems?.[0]);
    expect(after.taskItems?.find((row) => row.id === "1")).toMatchObject({
      text: "3× Mixer (MV)",
      done: false,
      order: "a1",
    });
    expect(after.taskItems?.some((row) => row.id === "2")).toBe(false);
    expect(after.taskItems?.find((row) => row.link?.node === "new")).toMatchObject({
      text: "1× Furnace (LV)",
      done: false,
    });
    expect(after.taskItems?.find((row) => row.id === "3")).toBe(before.taskItems?.[3]);
    expect(after.taskItems?.find((row) => row.id === "4")).toBe(before.taskItems?.[4]);
    expect(after.tasks?.[0]).toMatchObject({
      title: "My build",
      text: "Keep this note",
      status: "doing",
      sourcePlans: [
        { plan: "p", name: "Renamed copper" },
        { plan: "other", name: "Other plan" },
      ],
    });
    expect(taskProgress(after, "t")).toEqual({ done: 3, all: 5 });
    expect(syncTaskPlan(after, "t", { ...source, name: "Renamed copper" }, ["p"], cards)).toBe(
      after,
    );
  });
  it("can refresh an empty plan and clears obsolete legacy links without removing unrelated content", () => {
    const before = project();
    before.tasks = [{ ...task, links: [{ plan: "p", node: "removed" }] }];
    const after = syncTaskPlan(before, "t", source, ["p"], []);
    expect(after.taskItems?.map((row) => row.id)).toEqual(["3", "4"]);
    expect(taskProgress(after, "t")).toEqual({ done: 2, all: 2 });
    expect(after.tasks?.[0].sourcePlans).toEqual(task.sourcePlans);
  });
  it("recognizes local/account aliases and collapses duplicate machine rows", () => {
    const before = project();
    before.taskItems = [
      item("0", "same", "2× Bender (LV)"),
      item("1", "same", "2× Bender (LV)", "account:p"),
    ];
    const after = syncTaskPlan(
      before,
      "t",
      { plan: "account:p", name: "Copper" },
      ["p", "account:p"],
      [cards[0]],
    );
    expect(after.taskItems).toHaveLength(1);
    expect(after.taskItems?.[0]).toMatchObject({
      id: "0",
      done: true,
      link: { plan: "account:p", node: "same" },
    });
    expect(after.tasks?.[0].sourcePlans?.[0].plan).toBe("account:p");
  });
  it("replaces legacy links from every source alias without phantom progress", () => {
    const before = project();
    before.tasks = [
      {
        ...task,
        links: [
          { plan: "p", node: "same" },
          { plan: "account:p", node: "same" },
          { plan: "other", node: "x" },
        ],
      },
    ];
    before.taskItems = [item("0", "same", "2× Bender (LV)")];
    const source = { plan: "account:p", name: "Copper" };
    const after = syncTaskPlan(before, "t", source, ["p", "account:p"], [cards[0]]);
    expect(after.tasks?.[0].links).toEqual([{ plan: "other", node: "x" }]);
    expect(after.taskItems).toHaveLength(1);
    expect(taskProgress(after, "t")).toEqual({ done: 1, all: 2 });
    expect(syncTaskPlan(after, "t", source, ["p", "account:p"], [cards[0]])).toBe(after);
    const onlySource = { ...after, tasks: after.tasks?.map((task) => ({ ...task, links: [] })) };
    expect(taskProgress(onlySource, "t")).toEqual({ done: 1, all: 1 });
  });
  it("never turns a missing or unrelated task into a full-plan task", () => {
    const before = project();
    expect(syncTaskPlan(before, "missing", source, ["p"], cards)).toBe(before);
    expect(syncTaskPlan(before, "t", { plan: "unrelated", name: "No" }, [], cards)).toBe(before);
  });
});
