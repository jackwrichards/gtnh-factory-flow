import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@/examples";
import type { FactoryProject, Recipe } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { useLiveSession } from "@/store/live-session";
import { addCardsToTask, planCardsForTask } from "./make-task";

vi.mock("./open-link", () => ({
  activateDesign: vi.fn(async (design: { id: string }) => {
    useDesignStore.setState({ activeDesignId: design.id });
    if (design.id === "board") {
      useFactoryStore.setState({ project: { ...createEmptyProject(), primaryView: "tasks" } });
    }
  }),
}));

const factory = useFactoryStore.getState();
const designs = useDesignStore.getState();
afterEach(() => {
  useFactoryStore.setState(factory, true);
  useDesignStore.setState(designs, true);
  useLiveSession.setState({ notice: undefined });
});

function plan(): FactoryProject {
  const recipe: Recipe = {
    id: "plate",
    name: "Copper Plate",
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [],
    outputs: [],
  };
  return {
    ...createEmptyProject(),
    recipes: [recipe],
    nodes: [2, 3.2, 1].map((machineCount, at) => ({
      id: `n${at}`,
      recipeId: recipe.id,
      machineCount,
      parallel: 1,
      enabled: at !== 2,
      overclockTier: "LV",
      position: { x: at * 400, y: 0 },
    })),
  };
}

describe("adding a whole plan as a task", () => {
  it("includes every machine card regardless of selection, keeping repeated machines and rounding quantities up", () => {
    useFactoryStore.setState({ project: plan(), selectedBoardIds: ["n0"] });
    expect(planCardsForTask().sort((a, b) => a.nodeId.localeCompare(b.nodeId))).toEqual([
      { nodeId: "n0", name: "Bender", tier: "LV", count: 2 },
      { nodeId: "n1", name: "Bender", tier: "LV", count: 4 },
    ]);
  });

  it("creates one task named after the plan with separate linked checklist lines", async () => {
    useFactoryStore.setState({ project: plan() });
    const cards = planCardsForTask();
    const stamp = "2026-10-18T00:00:00Z";
    useDesignStore.setState({
      activeDesignId: "plan",
      designs: [
        { id: "plan", name: "Copper line", createdAt: stamp, updatedAt: stamp },
        { id: "board", name: "Build list", taskBoard: true, createdAt: stamp, updatedAt: stamp },
      ],
    });
    useLiveSession.setState({ status: "off" });
    const id = await addCardsToTask(cards, "board", undefined, {
      source: { designId: "plan", name: "Copper line", cards },
    });
    const project = useFactoryStore.getState().project;
    expect(project.tasks).toHaveLength(1);
    expect(project.tasks?.[0]).toMatchObject({
      id,
      title: "Copper line",
      status: "todo",
      sourcePlans: [{ plan: "plan", name: "Copper line" }],
    });
    expect(
      project.taskItems
        ?.map((item) => ({ text: item.text, node: item.link?.node, done: item.done }))
        .sort((a, b) => a.node!.localeCompare(b.node!)),
    ).toEqual([
      { text: "2× Bender (LV)", node: "n0", done: false },
      { text: "4× Bender (LV)", node: "n1", done: false },
    ]);
    expect(project.taskItems?.every((item) => item.link?.plan === "plan")).toBe(true);
    expect(useDesignStore.getState().activeDesignId).toBe("plan");
  });

  it("keeps machine-only tasks unmarked", async () => {
    useFactoryStore.setState({ project: plan() });
    const stamp = "2026-10-18T00:00:00Z";
    useDesignStore.setState({
      activeDesignId: "plan",
      designs: [
        { id: "plan", name: "Copper line", createdAt: stamp, updatedAt: stamp },
        { id: "board", name: "Build list", taskBoard: true, createdAt: stamp, updatedAt: stamp },
      ],
    });
    useLiveSession.setState({ status: "off" });
    await addCardsToTask(planCardsForTask(), "board");
    expect(useFactoryStore.getState().project.tasks?.[0]).not.toHaveProperty("sourcePlans");
  });
});
