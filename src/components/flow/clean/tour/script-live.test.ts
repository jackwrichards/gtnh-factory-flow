// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/store/factory-store", () => ({ useFactoryStore: { getState: () => ({}) } }));
vi.mock("@/store/design-store", () => ({ useDesignStore: { getState: () => ({ designs: [] }) } }));

afterEach(() => vi.unstubAllEnvs());

it.each([false, true])(
  "shows the plan-task walkthrough only with live plans (enabled=%s)",
  async (enabled) => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LIVE_URL", enabled ? "ws://localhost:3001" : "");
    const { STEPS } = await import("./script");
    const planTasks = STEPS.filter((step) => step.id.startsWith("plan-task"));
    expect(planTasks.map((step) => step.id)).toEqual(
      enabled ? ["plan-task", "plan-task-link", "plan-task-update"] : [],
    );
    if (enabled) {
      expect(STEPS.findIndex((step) => step.id === "plan-task")).toBe(
        STEPS.findIndex((step) => step.id === "task") + 1,
      );
      expect(planTasks.map((step) => step.note.text)).toEqual([
        "Right-click a *plan tab* and choose *Add plan as a task* to put all its machines in one checklist.",
        "The *Plan* link opens this task's source plan. Its checklist holds every machine to build.",
        "After editing the plan, *Update a task* refreshes its machines. Same or smaller amounts keep checkmarks. More machines or a changed machine or tier clear them.",
      ]);
    }
  },
);
