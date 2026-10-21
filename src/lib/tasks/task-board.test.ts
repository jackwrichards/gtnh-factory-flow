import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import type { FactoryProject, PlanTaskStatus } from "@/lib/model/types";
import { factoryProjectSchema } from "@/lib/model/schemas";
import {
  addBlocker,
  addTask,
  addTaskSourcePlan,
  addTaskComment,
  addTaskItem,
  addThing,
  blockersOf,
  cardLine,
  commentsOfTask,
  deleteTask,
  deleteTaskItem,
  inColumnShort,
  inColumnText,
  itemsOfTask,
  looseLinks,
  moveTask,
  moveTaskItem,
  moveTaskItemTo,
  moveTaskTo,
  placeText,
  removeBlocker,
  removeThing,
  shownKind,
  shownPriority,
  TASK_STATUSES,
  taskCardCounts,
  taskProgress,
  tasksIn,
  timeDotColor,
  timeDotCount,
  titleForCards,
  unblockedBy,
  updateTask,
  updateTaskItem,
  wouldLoop,
} from "./task-board";
import { chainIds, taskChains } from "./task-chain";

const NOW = "2026-10-14T12:00:00.000Z";
const LATER = "2026-10-16T12:00:00.000Z";

function board(): FactoryProject {
  let project: FactoryProject = { ...createEmptyProject(), primaryView: "tasks" };
  for (const title of ["One", "Two", "Three"]) {
    project = addTask(project, { title }, NOW).project;
  }
  return project;
}

const titles = (project: FactoryProject, status: "todo" | "doing" | "blocked" | "done") =>
  tasksIn(project, status).map((task) => task.title);

describe("whole-plan task identification", () => {
  it("keeps explicit plan sources through renames and checklist removal, without repeating a plan", () => {
    const made = addTask(createEmptyProject(), { title: "Copper line" });
    let project = addTaskSourcePlan(made.project, made.id, { plan: "copper", name: "Copper line" });
    expect(addTaskSourcePlan(project, made.id, { plan: "copper", name: "Copper line" })).toBe(project);
    project = addTaskSourcePlan(project, made.id, { plan: "power", name: "Power line" });
    project = addThing(project, made.id, { id: "machine", text: "Bender", kind: "machine", link: { plan: "copper", node: "n1" } });
    project = updateTask(project, made.id, { title: "Build the factory" });
    project = removeThing(project, "machine");
    expect(project.tasks?.[0]).toMatchObject({ title: "Build the factory", sourcePlans: [
      { plan: "copper", name: "Copper line" }, { plan: "power", name: "Power line" },
    ] });
    expect(project.taskItems).toEqual([]);
  });
});

describe("the task board's edits", () => {
  it("adds tasks to the bottom of To do, and leaves the plan alone for an empty title", () => {
    const project = board();
    expect(titles(project, "todo")).toEqual(["One", "Two", "Three"]);
    expect(addTask(project, { title: "   " }).project).toBe(project);
    expect(factoryProjectSchema.safeParse(project).success).toBe(true);
  });

  it("moves a task within its column and to another, writing only its own key", () => {
    let project = board();
    const [one, two, three] = tasksIn(project, "todo");
    const before = project;
    project = moveTask(project, three!.id, "todo", 0);
    expect(titles(project, "todo")).toEqual(["Three", "One", "Two"]);
    // The others are untouched objects: a move is one field of one task.
    expect(project.tasks!.find((task) => task.id === one!.id)).toBe(
      before.tasks!.find((task) => task.id === one!.id),
    );
    project = moveTask(project, two!.id, "done", 0, NOW);
    expect(titles(project, "todo")).toEqual(["Three", "One"]);
    expect(titles(project, "done")).toEqual(["Two"]);
    expect(project.tasks!.find((task) => task.id === two!.id)!.doneAt).toBe(NOW);
    project = moveTask(project, two!.id, "doing", 5);
    expect(project.tasks!.find((task) => task.id === two!.id)!.doneAt).toBeUndefined();
    // Dropped where it already is: the same plan.
    expect(moveTask(project, two!.id, "doing", 0)).toBe(project);
  });

  it("keeps a checklist in order, ticks and reorders lines, and counts them on the card", () => {
    let project = board();
    const task = tasksIn(project, "todo")[0]!;
    for (const text of ["Mine ore", "Smelt", "Build"]) {
      project = addTaskItem(project, task.id, text);
    }
    const [mine, smelt] = itemsOfTask(project, task.id);
    project = updateTaskItem(project, smelt!.id, { done: true });
    project = moveTaskItem(project, mine!.id, 1);
    expect(itemsOfTask(project, task.id).map((item) => item.text)).toEqual([
      "Smelt",
      "Mine ore",
      "Build",
    ]);
    project = deleteTaskItem(project, mine!.id);
    project = addTaskComment(project, task.id, "On it", { id: "u1", username: "ann" }, NOW);
    expect(taskCardCounts(project, task.id)).toEqual({ items: 2, done: 1, comments: 1 });
    expect(commentsOfTask(project, task.id)[0]).toMatchObject({ by: "u1", byName: "ann", at: NOW });
    expect(factoryProjectSchema.safeParse(project).success).toBe(true);
  });

  it("sets and clears a task's fields, and deleting it takes its checklist and comments", () => {
    let project = board();
    const task = tasksIn(project, "todo")[0]!;
    project = updateTask(project, task.id, {
      text: "Notes",
      assignees: ["u1", "u1"],
      nodeIds: ["n1"],
    });
    expect(project.tasks!.find((entry) => entry.id === task.id)).toMatchObject({
      text: "Notes",
      assignees: ["u1"],
      nodeIds: ["n1"],
    });
    expect(updateTask(project, task.id, { text: "Notes" })).toBe(project);
    project = updateTask(project, task.id, { text: "", assignees: [] });
    const cleared = project.tasks!.find((entry) => entry.id === task.id)!;
    expect("text" in cleared).toBe(false);
    expect("assignees" in cleared).toBe(false);
    project = addTaskItem(project, task.id, "Line");
    project = addTaskComment(project, task.id, "Hi", { id: "u1", username: "ann" });
    project = deleteTask(project, task.id);
    expect(project.tasks!.some((entry) => entry.id === task.id)).toBe(false);
    expect(project.taskItems).toEqual([]);
    expect(project.taskComments).toEqual([]);
  });
});

describe("as the game's task board", () => {
  const add = (project: FactoryProject, id: string, status: PlanTaskStatus = "todo") =>
    addTask(project, { title: id, id, status }, NOW).project;
  const many = (ids: string[]) =>
    ids.reduce((project, id) => add(project, id), createEmptyProject());
  const task = (project: FactoryProject, id: string) =>
    project.tasks!.find((entry) => entry.id === id)!;

  it("runs its columns Blocked, To do, Doing, Done", () => {
    expect(TASK_STATUSES).toEqual(["blocked", "todo", "doing", "done"]);
  });

  it("stamps a move to another column, and leaves the stamp on a move within one", () => {
    let project = many(["a", "b"]);
    expect(task(project, "a").movedAt).toBe(NOW);
    project = moveTask(project, "a", "todo", 5, LATER);
    expect(task(project, "a").movedAt).toBe(NOW);
    project = moveTask(project, "a", "doing", 0, LATER);
    expect(task(project, "a").movedAt).toBe(LATER);
    project = moveTaskTo(project, "a", "done", LATER);
    expect(task(project, "a")).toMatchObject({ status: "done", doneAt: LATER });
  });

  it("writes Medium as no priority", () => {
    let project = many(["a"]);
    expect(shownPriority(task(project, "a"))).toBe("medium");
    project = updateTask(project, "a", { priority: "high" });
    expect(task(project, "a").priority).toBe("high");
    project = updateTask(project, "a", { priority: "medium" });
    expect("priority" in task(project, "a")).toBe(false);
    expect(shownPriority({ priority: "urgent" as never })).toBe("medium");
  });

  it("lets a task wait on others but never in a loop, and deleting one takes it off every list", () => {
    let project = many(["a", "b", "c", "d"]);
    project = addBlocker(project, "b", "a");
    project = addBlocker(project, "c", "b");
    const before = project;
    // Itself, twice, directly back, back down the chain and a task not on the board are all refused.
    for (const [from, to] of [
      ["a", "a"],
      ["b", "a"],
      ["a", "b"],
      ["a", "c"],
      ["a", "gone"],
    ] as const) {
      expect(addBlocker(project, from, to)).toBe(before);
    }
    expect(wouldLoop(project, "a", "c")).toBe(true);
    project = addBlocker(project, "c", "d");
    expect(blockersOf(project, "c").map((entry) => entry.id)).toEqual(["b", "d"]);
    expect(unblockedBy(project, "a").map((entry) => entry.id)).toEqual(["b"]);
    project = deleteTask(project, "b");
    expect(task(project, "c").blockedBy).toEqual(["d"]);
    project = removeBlocker(project, "c", "d");
    expect("blockedBy" in task(project, "c")).toBe(false);
    expect(factoryProjectSchema.safeParse(project).success).toBe(true);
  });

  it("shows each thing as its kind, an older line as a machine or words, and counts an older task's loose cards", () => {
    let project = addTask(createEmptyProject(), {
      title: "Old",
      id: "t",
      links: [
        { plan: "p", node: "n1" },
        { plan: "p", node: "n2" },
      ],
    }).project;
    project = addThing(project, "t", {
      kind: "machine",
      text: "2× Mixer",
      link: { plan: "p", node: "n1" },
      id: "m",
    });
    const place = { x: 1, y: 2, z: 3, dim: 0, dimName: "Overworld", world: "w", label: "Ore" };
    project = addThing(project, "t", { kind: "location", text: placeText(place), place, id: "l" });
    project = addTaskItem(project, "t", "Words");
    project = addThing(project, "t", { kind: "picture", text: "Screenshot", id: "s" });
    expect(itemsOfTask(project, "t").map(shownKind)).toEqual(["machine", "location", "", ""]);
    expect(placeText(place)).toBe("Ore at 1 2 3 in Overworld");
    expect(looseLinks(project, "t")).toEqual([{ plan: "p", node: "n2" }]);
    expect(taskProgress(project, "t")).toEqual({ done: 0, all: 5 });
    // Taking a machine off takes the task's link to its card too, so it does not come back loose.
    project = removeThing(project, "m");
    expect(task(project, "t").links).toEqual([{ plan: "p", node: "n2" }]);
    expect(taskProgress(project, "t")).toEqual({ done: 0, all: 4 });
    expect(
      shownKind({ id: "x", taskId: "t", text: "x", done: false, order: "a", nodeId: "n" }),
    ).toBe("machine");
  });

  it("moves a thing to a place among the others", () => {
    let project = many(["t"]);
    for (const text of ["A", "B", "C"]) project = addTaskItem(project, "t", text);
    const [first] = itemsOfTask(project, "t");
    project = moveTaskItemTo(project, first!.id, 2);
    expect(itemsOfTask(project, "t").map((item) => item.text)).toEqual(["B", "C", "A"]);
  });

  it("counts days in a column as dots: one a day to four, amber from a week, red from two, none in Done", () => {
    const day = 24 * 60 * 60 * 1000;
    const at = Date.parse(NOW);
    const sat = { id: "a", title: "a", status: "doing", order: "a", movedAt: NOW } as const;
    expect(timeDotCount(sat, at + 0.5 * day)).toBe(0);
    expect(timeDotCount(sat, at + 2 * day)).toBe(2);
    expect(timeDotCount(sat, at + 30 * day)).toBe(4);
    expect(timeDotCount({ ...sat, status: "done" }, at + 30 * day)).toBe(0);
    expect(timeDotColor(3)).toBe("#6b6f7a");
    expect(timeDotColor(7)).toBe("#f5b83d");
    expect(timeDotColor(14)).toBe("#e5484d");
    expect(inColumnText(sat, at + 5 * day)).toBe("In Doing for 5 days");
    expect(inColumnShort(sat, at + 1 * day)).toBe("In Doing 1 day");
    expect(inColumnShort({ ...sat, movedAt: undefined, createdAt: NOW }, at)).toBe(
      "In Doing under a day",
    );
  });

  it("lays chains out in layers with the unlinked at the end, as the game does", () => {
    let project = many([
      "ore",
      "dust",
      "ingot",
      "plate",
      "wire",
      "motor",
      "lone",
      "x",
      "y",
      "coal",
    ]);
    for (const [from, to] of [
      ["dust", "ore"],
      ["ingot", "dust"],
      ["plate", "ingot"],
      ["wire", "ingot"],
      ["motor", "plate"],
      ["motor", "wire"],
      ["y", "x"],
      ["ingot", "coal"],
    ] as const) {
      project = addBlocker(project, from, to);
    }
    const layout = taskChains(project);
    expect(layout.chains.map((chain) => chain.layers)).toEqual([
      [["ore"], ["dust", "coal"], ["ingot"], ["plate", "wire"], ["motor"]],
      [["x"], ["y"]],
    ]);
    expect(layout.loose).toEqual(["lone"]);
    // A loop two people closed at once still lays out, each task once.
    project = {
      ...project,
      tasks: project.tasks!.map((entry) =>
        entry.id === "ore" ? { ...entry, blockedBy: ["motor"] } : entry,
      ),
    };
    const ids = [...taskChains(project).chains.flatMap(chainIds), ...taskChains(project).loose];
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });
});

describe("tasks made from cards", () => {
  it("titles a task from its machines", () => {
    expect(titleForCards(["Electric Blast Furnace"])).toBe("Build Electric Blast Furnace");
    expect(titleForCards(["Mixer", "Mixer", "Centrifuge"])).toBe("Build Mixer and Centrifuge");
    expect(titleForCards(["A", "B", "C", "D"])).toBe("Build A and 3 more");
  });

  it("writes a checklist line with how many to build and the tier", () => {
    expect(cardLine({ name: "Electric Blast Furnace", tier: "HV", count: 4 })).toBe(
      "4× Electric Blast Furnace (HV)",
    );
    expect(cardLine({ name: "Mixer", count: 0 })).toBe("Mixer");
  });

  it("keeps links on a new task and its lines, once each", () => {
    const link = { plan: "p", node: "n1" };
    const made = addTask(createEmptyProject(), {
      title: "Build",
      links: [link, link, { plan: "p", node: "n2" }],
    });
    expect(made.project.tasks![0]!.links).toEqual([link, { plan: "p", node: "n2" }]);
    const withLine = addTaskItem(made.project, made.id, "2× Mixer", link);
    expect(withLine.taskItems![0]!.link).toEqual(link);
    const cleared = updateTask(withLine, made.id, { links: [] });
    expect(cleared.tasks![0]!.links).toBeUndefined();
  });
});
