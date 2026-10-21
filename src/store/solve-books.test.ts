import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";

const solver = vi.hoisted(() => ({ calculate: vi.fn() }));
vi.mock("@/lib/solver", () => ({ calculateThroughput: solver.calculate }));
import { createEmptyProject } from "@/examples";
import { registerBooksSink, solveBooks, solveFreshBooks } from "./solve-books";

class WorkerStub {
  static instances: WorkerStub[] = [];
  request?: { key: string; project: FactoryProject };
  onmessage?: (event: { data: { key: string; result?: ThroughputResult; error?: string } }) => void;
  onerror?: (event: { message: string }) => void;
  terminate = vi.fn();
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(request: { key: string; project: FactoryProject }) {
    this.request = request;
  }
}
const books = (totalEuT: number): ThroughputResult => ({
  nodes: {},
  storages: {},
  resources: {},
  edges: {},
  totalEuT,
  totalEuPerSecond: totalEuT * 20,
  bottlenecks: [],
  externalInputs: [],
  unconsumedOutputs: [],
  generatedAt: "test",
});
beforeEach(() => {
  vi.clearAllMocks();
  WorkerStub.instances = [];
  solver.calculate.mockReturnValue(books(999));
  vi.stubGlobal("Worker", WorkerStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("waits for its own snapshot's completed worker result without publishing it to the canvas", async () => {
  const project = createEmptyProject();
  solveBooks(project); // Seed the canvas's last books with unrelated power.
  const sink = vi.fn();
  registerBooksSink(sink);
  const pending = solveFreshBooks(project);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  const worker = WorkerStub.instances[0];
  project.notes = "Edited after request";
  expect(worker.request!.project.notes).not.toBe(project.notes);
  worker.onmessage!({ data: { key: worker.request!.key, result: books(42) } });
  expect((await pending).totalEuT).toBe(42);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(sink).not.toHaveBeenCalled();
});

it.each(["stale", "wrong-key", "error"])("refuses a %s worker response", async (mode) => {
  const pending = solveFreshBooks(createEmptyProject());
  const assertion = expect(pending).rejects.toThrow();
  const worker = WorkerStub.instances[0];
  worker.onmessage!({
    data: {
      key: mode === "wrong-key" ? "another-plan" : worker.request!.key,
      result: { ...books(42), stale: mode === "stale" },
      error: mode === "error" ? "Solver failed" : undefined,
    },
  });
  await assertion;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("terminates a failed worker and rejects the save's solve", async () => {
  const pending = solveFreshBooks(createEmptyProject());
  const assertion = expect(pending).rejects.toThrow("Worker failed");
  WorkerStub.instances[0].onerror!({ message: "Worker failed" });
  await assertion;
  expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce();
});

it("calculates directly when workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  expect((await solveFreshBooks(createEmptyProject())).totalEuT).toBe(999);
  expect(WorkerStub.instances).toHaveLength(0);
});

const RETIRED_KEY = "gtnh-factory-flow.auto-solve.v1";

it("removes the retired manual-recalculation setting when it loads", async () => {
  const store = new Map<string, string>([[RETIRED_KEY, "off"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.resetModules();
  await import("./solve-books");
  expect(store.has(RETIRED_KEY)).toBe(false);
});

it("loads when storage refuses access", async () => {
  vi.stubGlobal("localStorage", {
    removeItem: () => {
      throw new Error("SecurityError");
    },
  });
  vi.resetModules();
  await expect(import("./solve-books")).resolves.toHaveProperty("solveBooks");
});
