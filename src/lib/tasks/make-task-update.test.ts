import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@/examples";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { useLiveSession } from "@/store/live-session";
import { addCardsToTask, captureTaskPlan, relatedPlanTasks, updateTaskFromPlan } from "./make-task";
import { calculateThroughput } from "@/lib/solver/throughput";

const projects: Record<string, FactoryProject> = {};
vi.mock("./open-link", () => ({
  activateDesign: vi.fn(async (design: { id: string }) => {
    const active = useDesignStore.getState().activeDesignId;
    if (active) projects[active] = useFactoryStore.getState().project;
    useDesignStore.setState({ activeDesignId: design.id });
    useFactoryStore.setState({ project: projects[design.id] });
  }),
}));
vi.mock("@/lib/designs/design-storage", async (original) => ({
  ...(await original<typeof import("@/lib/designs/design-storage")>()),
  readDesign: vi.fn(async (id: string) => ({ id, project: projects[id] })),
}));
const factory = useFactoryStore.getState();
const designs = useDesignStore.getState();
const live = useLiveSession.getState();
const task = {
  id: "task",
  title: "My build",
  status: "doing" as const,
  order: "a0",
  sourcePlans: [{ plan: "source", name: "Copper" }],
};
beforeEach(() => {
  const recipe: Recipe = {
    id: "plate",
    name: "Plate",
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [],
    outputs: [],
  };
  projects.source = {
    ...createEmptyProject(),
    recipes: [recipe],
    nodes: [
      {
        id: "node",
        recipeId: recipe.id,
        machineCount: 5,
        parallel: 1,
        enabled: true,
        overclockTier: "LV",
        position: { x: 0, y: 0 },
      },
    ],
  };
  projects.board = {
    ...createEmptyProject(),
    primaryView: "tasks",
    tasks: [
      task,
      { ...task, id: "normal", sourcePlans: undefined, links: [{ plan: "source", node: "node" }] },
    ],
    taskItems: [
      {
        id: "item",
        taskId: "task",
        text: "2× Bender (LV)",
        kind: "machine",
        done: true,
        order: "a0",
        link: { plan: "source", node: "node" },
      },
    ],
  };
  useDesignStore.setState({
    activeDesignId: "source",
    designs: [
      { id: "source", name: "Renamed copper", createdAt: "now", updatedAt: "now" },
      {
        id: "board",
        name: "Build list",
        taskBoard: true,
        closed: true,
        createdAt: "now",
        updatedAt: "now",
      },
    ],
  });
  useFactoryStore.setState({
    project: projects.source,
    lastResult: { ...factory.lastResult, stale: false },
    undoHistory: [],
    redoHistory: [],
  });
  useLiveSession.setState({ status: "off" });
});
afterEach(() => {
  vi.useRealTimers();
  useDesignStore.setState(designs, true);
  useFactoryStore.setState(factory, true);
  useLiveSession.setState(live, true);
});
describe("capturing a whole plan for Add and Update", () => {
  it("waits for fresh solved quantities before capturing the source", async () => {
    vi.useFakeTimers();
    const project = { ...projects.source!, solveMode: true, planMode: true };
    const fresh = calculateThroughput(project);
    fresh.nodes.node!.theoreticalMachinesRequired = 5;
    useFactoryStore.setState({ project, lastResult: { ...fresh, nodes: {}, stale: true } });
    let captured = false;
    const pending = captureTaskPlan().then((source) => {
      captured = true;
      return source;
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(captured).toBe(false);
    useFactoryStore.setState({ lastResult: { ...fresh, stale: false } });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      designId: "source",
      name: "Renamed copper",
      cards: [{ nodeId: "node", count: 5 }],
    });
  });
  it("aborts if the player switches plans during calculation", async () => {
    vi.useFakeTimers();
    useFactoryStore.setState({ lastResult: { ...factory.lastResult, stale: true } });
    const pending = captureTaskPlan();
    useDesignStore.setState({ activeDesignId: "board" });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeUndefined();
    expect(useLiveSession.getState().notice).toBeUndefined();
  });
  it("refuses stale quantities after the timeout and explains why", async () => {
    vi.useFakeTimers();
    useFactoryStore.setState({ lastResult: { ...factory.lastResult, stale: true } });
    const pending = captureTaskPlan();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeUndefined();
    expect(useLiveSession.getState().notice?.text).toBe(
      "This plan is still calculating. Try again when it finishes.",
    );
  });
  it("never adds a captured plan under a different source design", async () => {
    const source = await captureTaskPlan();
    expect(source).toBeDefined();
    useDesignStore.setState({ activeDesignId: "board" });
    expect(await addCardsToTask(source!.cards, "board", undefined, { source })).toBeUndefined();
    expect(projects.board!.tasks).toHaveLength(2);
  });
});
describe("updating a linked task from the plan", () => {
  it("finds full-plan tasks on closed boards without offering ordinary machine tasks", async () => {
    expect((await relatedPlanTasks("source")).map((entry) => [entry.id, entry.boardId])).toEqual([
      ["task", "board"],
    ]);
  });
  it("edits the task through its board in one undo step and returns to the source plan", async () => {
    expect(await updateTaskFromPlan("board", "task")).toBe("task");
    expect(projects.board.taskItems?.[0]).toMatchObject({
      id: "item",
      text: "5× Bender (LV)",
      done: false,
    });
    expect(projects.board.tasks?.[0]).toMatchObject({
      title: "My build",
      status: "doing",
      sourcePlans: [{ plan: "source", name: "Renamed copper" }],
    });
    expect(useDesignStore.getState().activeDesignId).toBe("source");
    expect(useFactoryStore.getState().undoHistory).toHaveLength(1);
    await updateTaskFromPlan("board", "task");
    expect(projects.board.taskItems).toHaveLength(1);
    expect(useFactoryStore.getState().undoHistory).toHaveLength(1);
  });
  it("updates an empty plan without creating a replacement for a deleted task", async () => {
    projects.source = { ...projects.source, nodes: [] };
    useFactoryStore.setState({ project: projects.source });
    await updateTaskFromPlan("board", "task");
    expect(projects.board.taskItems).toEqual([]);
    projects.board = { ...projects.board, tasks: [] };
    expect(await updateTaskFromPlan("board", "task")).toBeUndefined();
    expect(projects.board.tasks).toEqual([]);
    expect(useDesignStore.getState().activeDesignId).toBe("source");
  });
});
