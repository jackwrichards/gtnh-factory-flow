"use client";

import { acknowledgeNetworkSave, useNetworkStore } from "@/store/network-store";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { catalogueSchema } from "./model";
import { randomUUID } from "@/lib/random-id";
import { readCatalogue, writeCatalogue } from "./storage";

async function remote(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Your networks could not be synced.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0)
    throw new Error("Invalid network revision.");
  return { revision: body.revision as number, networks: catalogueSchema.parse(body.networks) };
}

/** A rejected device write retains its local topology until the player chooses which complete version to keep. */
export async function syncNetworks(): Promise<void> {
  const state = useNetworkStore.getState();
  const user = useCommunityAuthStore.getState().user?.username;
  const before = state.catalogue;
  if (!user || !before || before.account !== user || !state.ready || state.conflict) return;
  const requestId = randomUUID();
  useNetworkStore.setState({ syncing: requestId });
  const current = () =>
    useNetworkStore.getState().catalogue?.token === before.token &&
    useCommunityAuthStore.getState().user?.username === user;
  try {
    let saved = await remote(
      await fetch("/api/library/networks", {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      }),
    );
    if (!current()) return;
    let conflict = before.dirty && before.revision !== saved.revision;
    if (before.dirty && !conflict) {
      const response = await fetch("/api/library/networks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: before.revision, networks: before.networks }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 409) {
        saved = await remote(
          await fetch("/api/library/networks", {
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          }),
        );
        conflict = true;
      } else {
        saved = await remote(response);
        await acknowledgeNetworkSave(user, before.revision, before.token, saved.revision);
        return;
      }
    }
    if (!current()) return;
    if (!before.dirty && before.revision === saved.revision) {
      useNetworkStore.setState({ error: undefined });
      return;
    }
    // Keep the local candidate on disk too, so reloading never loses a conflict.
    if (conflict) {
      const recovery = { ...before, account: `${user}:recovery`, token: randomUUID() };
      const existing = await readCatalogue(recovery.account);
      await writeCatalogue(recovery, existing?.token);
    }
    const next = { ...before, ...saved, token: randomUUID(), dirty: false };
    await writeCatalogue(next, before.token);
    if (!current()) return;
    useNetworkStore.setState({
      catalogue: next,
      conflict: conflict ? before.networks : undefined,
      error: conflict
        ? "Your networks changed on another device. Choose which version to keep."
        : undefined,
    });
  } catch (error) {
    if (current())
      useNetworkStore.setState({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    // A completed older request must not clear a newer request's indicator.
    if (useNetworkStore.getState().syncing === requestId)
      useNetworkStore.setState({ syncing: undefined });
  }
}

export function startNetworkSession(): () => void {
  let stopped = false;
  let generation = 0;
  let username: string | undefined;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  const sync = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await syncNetworks();
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };
  const onUser = async () => {
    const auth = useCommunityAuthStore.getState();
    if (!auth.hasHydrated) return;
    const user = auth.user?.username;
    if (initialized && username === user) return;
    initialized = true;
    username = user;
    const request = ++generation;
    await useNetworkStore.getState().load(user ?? "local");
    if (stopped || request !== generation) return;
    await sync();
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), 1500);
  };
  const visible = () => {
    if (document.visibilityState !== "hidden") void sync();
  };
  const refresh = async () => {
    const state = useNetworkStore.getState();
    if (!state.catalogue || !state.ready) return;
    const saved = await readCatalogue(state.catalogue.account).catch(() => undefined);
    if (saved && saved.token !== state.catalogue.token && !state.catalogue.dirty)
      useNetworkStore.setState({ catalogue: saved });
  };
  void onUser();
  const unsubscribe = useCommunityAuthStore.subscribe(() => void onUser());
  window.addEventListener("gtnh-networks-changed", changed);
  window.addEventListener("online", visible);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", visible);
  const poll = setInterval(visible, 30_000);
  return () => {
    stopped = true;
    ++generation;
    unsubscribe();
    clearTimeout(timer);
    clearInterval(poll);
    window.removeEventListener("gtnh-networks-changed", changed);
    window.removeEventListener("online", visible);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", visible);
  };
}
