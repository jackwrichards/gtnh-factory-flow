// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { useNetworkStore } from "@/store/network-store";
import { readDesign } from "@/lib/designs/design-storage";
import { node, project, recipe } from "@/lib/solver/plan/adapter/test-kit";
import { resolveProjectRecipes } from "@/lib/datasets/refresh-project-recipes";
import type { DatasetVersion } from "@/lib/datasets/types";
import type { Recipe } from "@/lib/model/types";
import { memberKey, type PlanFlows } from "./model";
import { useNetworkCalculations } from "./calculation";

vi.mock("@/lib/designs/design-storage", async (original) => ({
  ...(await original<typeof import("@/lib/designs/design-storage")>()),
  readDesign: vi.fn(),
}));
vi.mock("@/lib/datasets/refresh-project-recipes", async (original) => ({
  ...(await original<typeof import("@/lib/datasets/refresh-project-recipes")>()),
  resolveProjectRecipes: vi.fn(),
}));

const posted = vi.fn();
const workers: ControlledWorker[] = [];
class ControlledWorker {
  onmessage?: (event: { data: { result?: PlanFlows; error?: string } }) => void;
  onerror = () => {};
  postMessage = posted;
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  deliver(result: PlanFlows) {
    this.onmessage?.({ data: { result } });
  }
}

beforeEach(() => {
  posted.mockClear();
  vi.mocked(resolveProjectRecipes).mockReset().mockResolvedValue({ refreshed: [], migration: {} });
  useFactoryStore.setState({ datasetManifest: undefined });
  vi.stubGlobal("Worker", ControlledWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function queuedMembers(prefix: string) {
  const members = ["first", "second", "third"].map((suffix) => ({
    designId: `${prefix}-${suffix}`,
    name: suffix,
    included: true,
  }));
  const records = members.map((member) => ({
    id: member.designId,
    name: member.name,
    createdAt: "a",
    updatedAt: "a",
    closed: true,
    project: project({ recipes: [], nodes: [], extra: { name: member.name } }),
  }));
  vi.mocked(readDesign).mockImplementation(async (id) =>
    records.find((record) => record.id === id),
  );
  useDesignStore.setState({ designs: records, activeDesignId: "other" });
  useNetworkStore.setState({
    catalogue: {
      account: "local",
      token: prefix,
      revision: 0,
      dirty: false,
      networks: [{ id: "n", name: "Network", members, sharing: {}, included: true }],
    },
  });
  return members;
}

const emptyFlow: PlanFlows = { materials: [], power: { used: 0, made: 0 } };
const datasetVersion: DatasetVersion = {
  id: "network-test-dataset",
  gtnhVersion: "2.9",
  channel: "stable",
  publishedAt: "a",
  manifestPath: "manifest.json",
  recipeDatasetPath: "recipes.json",
  sourceInfo: { sourceId: "unknown", generatedAt: "a" },
};

function storedRecipeMember(id: string, storedRecipe: Recipe, withDataset = true) {
  const member = queuedMembers(id)[0];
  const stored = {
    id: member.designId,
    name: member.name,
    createdAt: "a",
    updatedAt: "a",
    closed: true,
    project: project({ recipes: [storedRecipe], nodes: [node("game-card", storedRecipe.id)] }),
  };
  vi.mocked(readDesign).mockResolvedValue(stored);
  useDesignStore.setState({ designs: [stored], activeDesignId: "other" });
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          id: "n",
          name: "Network",
          members: [member],
          sharing: {},
          included: true,
        },
      ],
    },
  }));
  if (withDataset)
    useFactoryStore.setState({
      datasetManifest: { schemaVersion: 1, versions: [datasetVersion] },
      dataset: undefined,
    });
  return member;
}

describe("closed network member calculations", () => {
  it.each([true, false])(
    "calculates an unmatched complete game recipe with dataset available: %s",
    async (withDataset) => {
      const stored = {
        ...recipe("gtnhplanner:complete-game-card", [["ore", 1]], [["dust", 2]]),
        source: { sourceMod: "GTNH Planner", datasetVersionId: datasetVersion.id },
      };
      const member = storedRecipeMember(`game-body-${withDataset}`, stored, withDataset);
      const hook = renderHook(() => useNetworkCalculations(0));
      await waitFor(() => expect(posted).toHaveBeenCalledOnce());
      expect(posted.mock.calls[0][0].recipes[0]).toMatchObject(stored);
      expect(resolveProjectRecipes).toHaveBeenCalledTimes(withDataset ? 1 : 0);
      await act(async () => workers.at(-1)!.deliver(emptyFlow));
      expect(hook.result.current.get(memberKey(member))).toEqual(emptyFlow);
      hook.unmount();
    },
  );

  it("restores a slim dataset recipe and migrates the machine before calculating", async () => {
    const stored = {
      ...recipe("old-dataset-id", [], [["oxygen", 1]]),
      source: { datasetVersionId: datasetVersion.id },
    };
    const restored: Recipe = {
      ...stored,
      id: "new-dataset-id",
      durationTicks: 40,
      runtimeCalculation: {
        sourceKind: "gregtech-overclock-calculator",
        status: "computed",
        oracleEligible: true,
        variants: [{ id: "lv", durationTicks: 40, eut: 30 }],
      },
    };
    storedRecipeMember("migrated-recipe", stored);
    vi.mocked(resolveProjectRecipes).mockResolvedValue({
      refreshed: [restored],
      migration: { [stored.id]: restored.id },
    });
    const hook = renderHook(() => useNetworkCalculations(0));
    await waitFor(() => expect(posted).toHaveBeenCalledOnce());
    expect(posted.mock.calls[0][0].recipes[0]).toMatchObject(restored);
    expect(posted.mock.calls[0][0].nodes[0].recipeId).toBe(restored.id);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    hook.unmount();
  });

  it.each([true, false])(
    "rejects an unrestored dataset recipe with dataset available: %s",
    async (withDataset) => {
      const member = storedRecipeMember(
        `missing-dataset-${withDataset}`,
        {
          ...recipe("dataset-only-id", [], [["oxygen", 1]]),
          source: { datasetVersionId: datasetVersion.id },
        },
        withDataset,
      );
      const hook = renderHook(() => useNetworkCalculations(0));
      await waitFor(() =>
        expect(hook.result.current.get(memberKey(member))?.error).toBe(
          withDataset
            ? "Recipes could not be restored. Retry when the dataset is available."
            : "Recipe dataset unavailable",
        ),
      );
      expect(posted).not.toHaveBeenCalled();
      hook.unmount();
    },
  );

  it("rejects a game recipe whose saved body is incomplete", async () => {
    const member = storedRecipeMember("incomplete-game", {
      ...recipe("gtnhplanner:incomplete", [], [["oxygen", 1]]),
      durationTicks: 0,
      source: { datasetVersionId: datasetVersion.id },
    });
    const hook = renderHook(() => useNetworkCalculations(0));
    await waitFor(() =>
      expect(hook.result.current.get(memberKey(member))?.error).toBe(
        "Recipes could not be restored. Retry when the dataset is available.",
      ),
    );
    expect(posted).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("calculates a closed legacy cell wire after normalization inserts a standalone tank", async () => {
    const maker = { ...recipe("cell-maker", [], [["water-cell", 1]]), isDemo: true };
    const member = storedRecipeMember("legacy-cell-wire", maker, false);
    const stored = (await readDesign(member.designId))!;
    const taker = {
      ...recipe("water-user", [], [["sponge", 1]]),
      isDemo: true,
      inputs: [{ kind: "fluid" as const, id: "water", amount: 1000 }],
    };
    vi.mocked(readDesign).mockResolvedValue({
      ...stored,
      project: project({
        recipes: [maker, taker],
        nodes: [node("maker", maker.id), node("taker", taker.id)],
        edges: [
          {
            id: "cell-wire",
            source: "maker",
            target: "taker",
            sourceHandle: "output:item:water-cell",
            targetHandle: "input:fluid:water",
            resourceKind: "item",
            resourceId: "water-cell",
            crossForm: { litresPerCell: 1000 },
          },
        ],
      }),
    });
    const hook = renderHook(() => useNetworkCalculations(0));
    await waitFor(() => expect(posted).toHaveBeenCalledOnce());
    const sent = posted.mock.calls[0][0];
    expect(sent.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^fluid-tank:cell-wire:/),
          source: expect.objectContaining({ recipeMap: "Tank" }),
          durationTicks: 1,
          eut: 0,
        }),
      ]),
    );
    expect(sent.edges.every((edge: { crossForm?: unknown }) => !edge.crossForm)).toBe(true);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    expect(hook.result.current.get(memberKey(member))).toEqual(emptyFlow);
    hook.unmount();
  });
  it("caches unchanged plans, ignores display dials, marks changed figures stale, and exposes unavailable members", async () => {
    const deliver = (result: PlanFlows) => workers.at(-1)!.deliver(result);
    const member = { designId: "closed-calculation", name: "Closed line", included: true };
    const summary = {
      id: member.designId,
      name: member.name,
      createdAt: "a",
      updatedAt: "a",
      closed: true,
    };
    let stored = {
      ...summary,
      project: project({
        recipes: [{ ...recipe("demo", [], [["oxygen", 1]]), isDemo: true }],
        nodes: [],
      }),
    };
    vi.mocked(readDesign).mockImplementation(async () => stored);
    useDesignStore.setState({ designs: [summary], activeDesignId: "other" });
    useNetworkStore.setState({
      catalogue: {
        account: "local",
        token: "t",
        revision: 0,
        dirty: false,
        networks: [{ id: "n", name: "Network", members: [member], sharing: {}, included: true }],
      },
    });
    const initial: PlanFlows = {
      materials: [
        {
          key: "item:oxygen",
          kind: "item",
          resourceId: "oxygen",
          label: "Oxygen",
          supply: 1,
          demand: 0,
        },
      ],
      power: { used: 0, made: 0 },
    };
    const hook = renderHook(() => useNetworkCalculations(0));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    await act(async () => deliver(initial));
    expect(hook.result.current.get(memberKey(member))).toEqual(initial);
    act(() => useFactoryStore.setState({ rateUnit: "minute" }));
    hook.rerender();
    expect(posted).toHaveBeenCalledTimes(1);
    await act(async () =>
      useNetworkStore.setState((state) => ({
        catalogue: {
          ...state.catalogue!,
          networks: state.catalogue!.networks.map((network) => ({
            ...network,
            members: network.members.map((plan) => ({ ...plan, portSelection: [] })),
          })),
        },
      })),
    );
    expect(hook.result.current.get(memberKey(member))).toEqual(initial);
    expect(posted).toHaveBeenCalledTimes(1);
    await act(async () => useDesignStore.setState({ designs: [{ ...summary }] }));
    await waitFor(() => expect(hook.result.current.get(memberKey(member))?.stale).not.toBe(true));
    expect(posted).toHaveBeenCalledTimes(1);
    stored = { ...stored, updatedAt: "b", project: { ...stored.project, name: "Changed line" } };
    await act(async () => useDesignStore.setState({ designs: [{ ...summary, updatedAt: "b" }] }));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2));
    expect(hook.result.current.get(memberKey(member))?.stale).toBe(true);
    const changed = { ...initial, materials: [{ ...initial.materials[0], supply: 2 }] };
    await act(async () => deliver(changed));
    expect(hook.result.current.get(memberKey(member))?.materials[0].supply).toBe(2);
    await act(async () => useDesignStore.setState({ designs: [] }));
    await waitFor(() =>
      expect(hook.result.current.get(memberKey(member))?.error).toBe("Plan unavailable"),
    );
    expect(posted).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("calculates every member sequentially and continues after a rejected worker result", async () => {
    const members = queuedMembers("rejected");
    const hook = renderHook(() => useNetworkCalculations(0));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    const failed = workers.at(-1)!;
    await act(async () => failed.onmessage?.({ data: { error: "Invalid plan" } }));
    expect(failed.terminate).toHaveBeenCalledOnce();
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(2));
    expect(hook.result.current.get(memberKey(members[0]))?.error).toBe("Invalid plan");
    expect(workers.at(-1)).not.toBe(failed);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(3));
    expect(hook.result.current.get(memberKey(members[1]))).toEqual(emptyFlow);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    expect(hook.result.current.get(memberKey(members[2]))).toEqual(emptyFlow);
    expect(posted.mock.calls.map(([value]) => value.name)).toEqual(["first", "second", "third"]);
    hook.unmount();
  });

  it("times out a stuck member and restarts the worker for the remaining members", async () => {
    const members = queuedMembers("timeout");
    vi.useFakeTimers();
    const hook = renderHook(() => useNetworkCalculations(0));
    await act(async () => {});
    expect(posted).toHaveBeenCalledTimes(1);
    const stuck = workers.at(-1)!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(179_999);
    });
    expect(posted).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(stuck.terminate).toHaveBeenCalledOnce();
    expect(hook.result.current.get(memberKey(members[0]))?.error).toBe(
      "Calculation timed out. Retry this plan.",
    );
    expect(posted).toHaveBeenCalledTimes(2);
    expect(workers.at(-1)).not.toBe(stuck);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    expect(posted).toHaveBeenCalledTimes(3);
    await act(async () => workers.at(-1)!.deliver(emptyFlow));
    expect(hook.result.current.get(memberKey(members[2]))).toEqual(emptyFlow);
    hook.unmount();
  });

  it("serializes concurrent consumers without dropping queued members", async () => {
    const members = queuedMembers("concurrent");
    const first = renderHook(() => useNetworkCalculations(0));
    const second = renderHook(() => useNetworkCalculations(0));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    for (let completed = 0; completed < 6; completed++) {
      expect(posted).toHaveBeenCalledTimes(completed + 1);
      await act(async () => workers.at(-1)!.deliver(emptyFlow));
    }
    expect(posted.mock.calls.map(([value]) => value.name)).toEqual([
      "first",
      "first",
      "second",
      "second",
      "third",
      "third",
    ]);
    for (const member of members) {
      expect(first.result.current.get(memberKey(member))).toEqual(emptyFlow);
      expect(second.result.current.get(memberKey(member))).toEqual(emptyFlow);
    }
    first.unmount();
    second.unmount();
  });
});
