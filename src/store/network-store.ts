"use client";

import { create } from "zustand";
import { randomUUID } from "@/lib/random-id";
import {
  catalogueSchema,
  memberKey,
  removeNetwork,
  type NetworkMember,
  type PlanNetwork,
} from "@/lib/networks/model";
import { readCatalogue, writeCatalogue, type StoredCatalogue } from "@/lib/networks/storage";
import { leaveLibrary, openLibrary } from "@/lib/library/library-tab";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";

interface NetworkState {
  catalogue?: StoredCatalogue;
  activeId?: string;
  openIds: string[];
  error?: string;
  conflict?: PlanNetwork[];
  ready: boolean;
  saving: number;
  syncing?: string;
  load: (account: string) => Promise<void>;
  edit: (change: (networks: PlanNetwork[]) => PlanNetwork[]) => Promise<void>;
  create: (name: string, parentId?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addMember: (id: string, member: NetworkMember) => Promise<void>;
  open: (id: string) => void;
  close: (id: string) => void;
  leave: () => void;
  resolveConflict: (useLocal: boolean) => Promise<void>;
}

let queue = Promise.resolve();
let loadSequence = 0;
export const useNetworkStore = create<NetworkState>((set, get) => ({
  openIds: [],
  ready: false,
  saving: 0,
  load: async (account) => {
    const sequence = ++loadSequence;
    set({
      ready: false,
      saving: 0,
      syncing: undefined,
      error: undefined,
      conflict: undefined,
      activeId: undefined,
      openIds: [],
    });
    try {
      let catalogue = await readCatalogue(account);
      // Signing in carries this browser's initial networks with its initial plans.
      if (!catalogue && account !== "local") {
        const local = await readCatalogue("local");
        if (local?.networks.length) {
          catalogue = { ...local, account, token: randomUUID(), revision: 0, dirty: true };
          await writeCatalogue(catalogue);
        }
      }
      catalogue ??= { account, token: randomUUID(), networks: [], revision: 0, dirty: false };
      if (!(await readCatalogue(account))) await writeCatalogue(catalogue);
      const recovery = await readCatalogue(`${account}:recovery`);
      if (sequence === loadSequence)
        set({
          catalogue,
          ready: true,
          conflict: recovery?.dirty ? recovery.networks : undefined,
          error: recovery?.dirty
            ? "Unsynced network changes are available. Choose which version to keep."
            : undefined,
        });
    } catch (error) {
      if (sequence === loadSequence) set({ error: String(error), ready: false });
    }
  },
  edit: (change) => {
    const account = get().catalogue?.account;
    const sequence = loadSequence;
    set((state) => ({ saving: state.saving + 1 }));
    const run = queue.then(async () => {
      const state = get();
      if (state.catalogue?.account !== account) return;
      if (!state.ready || !state.catalogue || state.conflict)
        throw new Error("Reload or resolve your network changes first.");
      const previous = state.catalogue;
      const networks = catalogueSchema.parse(change(previous.networks));
      const next = { ...previous, networks, token: randomUUID(), dirty: true };
      set({ catalogue: next, error: undefined });
      try {
        await writeCatalogue(next, previous.token);
      } catch (error) {
        const latest = await readCatalogue(previous.account);
        if (latest) {
          const recovery = { ...next, account: `${previous.account}:recovery` };
          const savedRecovery = await readCatalogue(recovery.account);
          await writeCatalogue(recovery, savedRecovery?.token);
          if (get().catalogue?.account === previous.account)
            set({ catalogue: latest, conflict: next.networks });
        }
        throw error;
      }
      if (get().catalogue?.account !== previous.account) return;
      window.dispatchEvent(new Event("gtnh-networks-changed"));
    });
    queue = run
      .catch((error) => {
        if (get().catalogue?.account === account)
          set({ error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (sequence === loadSequence) set((state) => ({ saving: Math.max(0, state.saving - 1) }));
      });
    return queue;
  },
  create: async (name, parentId) => {
    const id = randomUUID();
    await get().edit((networks) => [
      ...networks,
      {
        id,
        name: name.trim() || "New network",
        parentId,
        included: true,
        members: [],
        sharing: {},
      },
    ]);
    if (get().catalogue?.networks.some((network) => network.id === id)) get().open(id);
  },
  remove: async (id) => {
    let parentId: string | undefined;
    await get().edit((networks) => {
      parentId = networks.find((network) => network.id === id)?.parentId;
      return removeNetwork(networks, id);
    });
    if (!get().catalogue?.networks.some((network) => network.id === id)) {
      get().close(id);
      if (parentId) get().open(parentId);
      else openLibrary({ kind: "networks" });
    }
  },
  addMember: (id, member) =>
    get().edit((networks) => {
      const previous = networks
        .flatMap((network) => network.members)
        .find((entry) => memberKey(entry) === memberKey(member));
      return networks.map((network) => ({
        ...network,
        members: [
          ...network.members.filter((entry) => memberKey(entry) !== memberKey(member)),
          ...(network.id === id ? [{ ...previous, ...member }] : []),
        ],
      }));
    }),
  open: (id) => {
    leaveWelcomeTab();
    leaveLibrary();
    set({ activeId: id, openIds: [...new Set([...get().openIds, id])] });
  },
  close: (id) => {
    const openIds = get().openIds.filter((entry) => entry !== id);
    set({ openIds, activeId: get().activeId === id ? openIds.at(-1) : get().activeId });
  },
  leave: () => set({ activeId: undefined }),
  resolveConflict: async (useLocal) => {
    const state = get();
    if (!state.catalogue || !state.conflict) return;
    const next = {
      ...state.catalogue,
      networks: useLocal ? state.conflict : state.catalogue.networks,
      // The accepted browser-tab version can still be waiting for its cloud save.
      dirty: useLocal || state.catalogue.dirty,
      token: randomUUID(),
    };
    try {
      await writeCatalogue(next, state.catalogue.token);
      const recovery = await readCatalogue(`${next.account}:recovery`);
      if (recovery)
        await writeCatalogue({ ...recovery, dirty: false, token: randomUUID() }, recovery.token);
      if (get().catalogue?.account !== next.account) return;
      set({ catalogue: next, conflict: undefined, error: undefined });
      window.dispatchEvent(new Event("gtnh-networks-changed"));
    } catch (error) {
      if (get().catalogue?.account === next.account)
        set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));

/** Owned-plan deletion removes membership; lost shared-plan access deliberately leaves an unavailable member. */
export async function forgetNetworkPlan(designId: string): Promise<void> {
  const state = useNetworkStore.getState();
  if (
    !state.ready ||
    !state.catalogue?.networks.some((network) =>
      network.members.some((member) => !member.ownerId && member.designId === designId),
    )
  )
    return;
  await state.edit((networks) =>
    networks.map((network) => ({
      ...network,
      members: network.members.filter((member) => member.ownerId || member.designId !== designId),
    })),
  );
}

/** An acknowledgement advances the base revision without clearing edits made while that save was in flight. */
export function acknowledgeNetworkSave(
  account: string,
  baseRevision: number,
  sentToken: string,
  revision: number,
): Promise<void> {
  const run = queue.then(async () => {
    const state = useNetworkStore.getState();
    const before = state.catalogue;
    if (!before || before.account !== account || before.revision !== baseRevision || state.conflict)
      return;
    const next = { ...before, token: randomUUID(), revision, dirty: before.token !== sentToken };
    await writeCatalogue(next, before.token);
    if (useNetworkStore.getState().catalogue?.token !== before.token) return;
    useNetworkStore.setState({ catalogue: next, error: undefined });
    if (next.dirty) window.dispatchEvent(new Event("gtnh-networks-changed"));
  });
  queue = run.catch((error) => {
    if (useNetworkStore.getState().catalogue?.account === account)
      useNetworkStore.setState({ error: error instanceof Error ? error.message : String(error) });
  });
  return queue;
}
