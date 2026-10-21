// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNetworkStore } from "@/store/network-store";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { syncNetworks } from "./sync";
import type { StoredCatalogue } from "./storage";
import type { PlanNetwork } from "./model";
import { readLibraryTabState } from "@/lib/library/library-tab";

const disk = vi.hoisted(() => new Map<string, StoredCatalogue>());
vi.mock("./storage", () => ({
  readCatalogue: async (account: string) => disk.get(account),
  writeCatalogue: async (value: StoredCatalogue, token?: string) => {
    if (disk.get(value.account)?.token !== token) throw new Error("Changed in another tab");
    disk.set(value.account, structuredClone(value));
  },
}));
const network = (id: string): PlanNetwork => ({
  id,
  name: id,
  included: true,
  members: [],
  sharing: {},
});
const response = (revision: number, networks: PlanNetwork[]) =>
  Response.json({ revision, networks });

beforeEach(async () => {
  disk.clear();
  vi.restoreAllMocks();
  useCommunityAuthStore.setState({ user: { username: "owner" }, hasHydrated: true });
  await useNetworkStore.getState().load("owner");
});

describe("network persistence and sync", () => {
  it("reports pending local writes until the whole edit queue has settled", async () => {
    const first = useNetworkStore.getState().edit(() => [network("first")]);
    const second = useNetworkStore.getState().edit((entries) => [...entries, network("second")]);
    expect(useNetworkStore.getState().saving).toBe(2);
    await Promise.all([first, second]);
    expect(useNetworkStore.getState().saving).toBe(0);
    expect(disk.get("owner")!.networks.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("shows an active sync only while its request is pending", async () => {
    let reply!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    );
    const pending = syncNetworks();
    expect(useNetworkStore.getState().syncing).toBeTruthy();
    reply(response(0, []));
    await pending;
    expect(useNetworkStore.getState().syncing).toBeUndefined();
  });
  it("returns to the parent after deleting a subnet, and to Networks after deleting a root", async () => {
    const store = useNetworkStore.getState();
    await store.edit(() => [network("parent"), { ...network("child"), parentId: "parent" }]);
    store.open("child");
    await store.remove("child");
    expect(useNetworkStore.getState().activeId).toBe("parent");
    expect(readLibraryTabState().active).toBe(false);
    expect(useNetworkStore.getState().openIds).toContain("parent");
    await store.remove("parent");
    expect(readLibraryTabState()).toEqual({ active: true, view: { kind: "networks" } });
  });
  it("keeps edits made during a successful save pending on the acknowledged revision", async () => {
    await useNetworkStore.getState().edit(() => [network("first-edit")]);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(0, []))
      .mockImplementationOnce(async () => {
        await useNetworkStore.getState().edit(() => [network("newer-edit")]);
        return response(1, [network("first-edit")]);
      });
    await syncNetworks();
    expect(useNetworkStore.getState().catalogue).toMatchObject({
      revision: 1,
      dirty: true,
      networks: [network("newer-edit")],
    });
    expect(useNetworkStore.getState().conflict).toBeUndefined();
  });
  it("persists moves without allowing repeated plan references", async () => {
    const store = useNetworkStore.getState();
    await store.edit(() => [{ ...network("a"), groups: ["Empty group"] }, network("b")]);
    const member = { designId: "line", name: "Oxygen", included: true };
    await store.addMember("a", member);
    await store.edit((entries) =>
      entries.map((entry) => ({
        ...entry,
        members: entry.members.map((plan) => ({
          ...plan,
          group: "Oxygen lines",
          portSelection: ["machine-output"],
        })),
      })),
    );
    await store.addMember("b", member);
    expect(
      useNetworkStore.getState().catalogue!.networks.map((entry) => entry.members.length),
    ).toEqual([0, 1]);
    await store.load("owner");
    expect(useNetworkStore.getState().catalogue!.networks[0].groups).toEqual(["Empty group"]);
    expect(useNetworkStore.getState().catalogue!.networks[1].members).toEqual([
      { ...member, group: "Oxygen lines", portSelection: ["machine-output"] },
    ]);
  });
  it("keeps a network open if its deletion cannot be saved", async () => {
    const store = useNetworkStore.getState();
    await store.edit(() => [network("a")]);
    store.open("a");
    disk.set("owner", { ...useNetworkStore.getState().catalogue!, token: "another-tab" });
    await store.remove("a");
    expect(useNetworkStore.getState().activeId).toBe("a");
    expect(useNetworkStore.getState().catalogue!.networks).toHaveLength(1);
    expect(useNetworkStore.getState().error).toBeTruthy();
  });
  it("pulls remote data without scheduling a push of the pull", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(3, [network("remote")]));
    await syncNetworks();
    expect(useNetworkStore.getState().catalogue).toMatchObject({
      revision: 3,
      dirty: false,
      networks: [network("remote")],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("pushes only edited topology and marks the acknowledged revision clean", async () => {
    await useNetworkStore.getState().edit(() => [network("local")]);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(0, []))
      .mockResolvedValueOnce(response(1, [network("local")]));
    await syncNetworks();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
      revision: 0,
      networks: [network("local")],
    });
    expect(disk.get("owner")).toMatchObject({ revision: 1, dirty: false });
  });
  it("keeps conflicting local work through reload until a deliberate resolution", async () => {
    await useNetworkStore.getState().edit(() => [network("local")]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(2, [network("remote")]));
    await syncNetworks();
    expect(useNetworkStore.getState().conflict).toEqual([network("local")]);
    expect(disk.get("owner:recovery")).toMatchObject({ dirty: true, networks: [network("local")] });
    expect(useNetworkStore.getState().catalogue!.networks).toEqual([network("remote")]);
    await useNetworkStore.getState().resolveConflict(true);
    expect(useNetworkStore.getState().catalogue).toMatchObject({
      dirty: true,
      revision: 2,
      networks: [network("local")],
    });
    expect(disk.get("owner:recovery")!.dirty).toBe(false);
  });
  it("retains local edits when the account write races another device", async () => {
    await useNetworkStore.getState().edit(() => [network("local")]);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(0, []))
      .mockResolvedValueOnce(Response.json({ error: "conflict" }, { status: 409 }))
      .mockResolvedValueOnce(response(1, [network("winner")]));
    await syncNetworks();
    expect(useNetworkStore.getState().conflict).toEqual([network("local")]);
    await useNetworkStore.getState().resolveConflict(false);
    expect(useNetworkStore.getState().catalogue).toMatchObject({
      dirty: false,
      networks: [network("winner")],
    });
  });
  it("preserves an attempted edit when another browser tab has written first", async () => {
    const before = disk.get("owner")!;
    disk.set("owner", { ...before, token: "other-tab", networks: [network("other")] });
    await useNetworkStore.getState().edit(() => [network("my-edit")]);
    expect(useNetworkStore.getState().conflict).toEqual([network("my-edit")]);
    expect(useNetworkStore.getState().catalogue!.networks).toEqual([network("other")]);
  });
  it("still uploads the accepted browser-tab version when it has unsynced changes", async () => {
    const before = useNetworkStore.getState().catalogue!;
    disk.set("owner", {
      ...before,
      token: "other-tab",
      dirty: true,
      networks: [network("accepted-edit")],
    });
    await useNetworkStore.getState().edit(() => [network("discarded-edit")]);
    expect(useNetworkStore.getState().conflict).toBeTruthy();
    await useNetworkStore.getState().resolveConflict(false);
    expect(useNetworkStore.getState().catalogue!.dirty).toBe(true);
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(0, []))
      .mockResolvedValueOnce(response(1, [network("accepted-edit")]));
    await syncNetworks();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).networks).toEqual([
      network("accepted-edit"),
    ]);
    expect(disk.get("owner")).toMatchObject({ dirty: false, revision: 1 });
  });
  it("leaves unsynced edits intact on failure and ignores replies after an account switch", async () => {
    await useNetworkStore.getState().edit(() => [network("local")]);
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    await syncNetworks();
    expect(useNetworkStore.getState().catalogue!.dirty).toBe(true);
    expect(useNetworkStore.getState().error).toBe("offline");
    fetcher.mockImplementationOnce(async () => {
      await useNetworkStore.getState().load("other-account");
      return response(9, [network("private")]);
    });
    await syncNetworks();
    expect(useNetworkStore.getState().catalogue!.account).toBe("other-account");
    expect(useNetworkStore.getState().catalogue!.networks).toEqual([]);
  });
});
