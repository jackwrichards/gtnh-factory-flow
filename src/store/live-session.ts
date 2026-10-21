"use client";

import { create } from "zustand";
import { LiveClientState, type PendingBatch } from "@/lib/live/client-state";
import { THIS_TAB_ID } from "@/lib/designs/design-tab-sync";
import {
  readDesignLiveReplacement,
  settleDesignLiveReplacement,
  type LiveReplacementOutbox,
} from "@/lib/designs/design-storage";
import { isLiveConfigured, liveSocketAddress } from "@/lib/live/live-config";
import {
  aliveTabs,
  deletePending,
  holdTabLock,
  pendingKey,
  readPending,
  writePending,
} from "@/lib/live/live-pending-store";
import { clearPresence, notePresence, setPresentPeople } from "@/lib/live/live-presence";
import { liveShape, withRecipesTheyName } from "@/lib/live/live-shape";
import { diffPlans, type LiveOp, type LivePlan } from "@/lib/live/ops";
import {
  docKey,
  LIVE_LIMITS,
  LIVE_PING_INTERVAL_MS,
  LIVE_PROTOCOL_VERSION,
  parseDocKey,
  type LiveCursor,
  type LiveMember,
  type LivePerson,
  type ServerFrame,
} from "@/lib/live/protocol";
import type { FactoryProject } from "@/lib/model/types";
import { APP_VERSION } from "@/lib/version";
import { useCommunityAuthStore } from "./community-auth-store";
import { useDesignStore } from "./design-store";
import { useFactoryStore } from "./factory-store";
import { syncLibraryNow } from "@/lib/library/library-sync";
import { openSharedPlan } from "@/lib/library/open-shared";
import { leaveLibrary } from "@/lib/library/library-tab";
import {
  clearDesignOpenLive,
  isQuietChange,
  markDesignOpenLive,
  setLiveDesignId,
  setLiveUndoHandler,
  takeDesignFresh,
} from "./live-edit-gate";

/**
 * Live editing for the open design. One WebSocket per browser tab to the live
 * service; the design on the canvas joins its room when it is a cloud plan:
 * one of ours the account already holds, or one shared with us.
 *
 * THE FUNNEL. Every project change that is not made `quietly`
 * (live-edit-gate.ts) is a person's edit: the plan before and after it are
 * shaped (`liveShape`: derived data left out) and diffed, and the ops become
 * a batch in the client engine (`LiveClientState`: confirmed + pending), sent
 * at once or kept until the connection is back. Pending batches are kept in
 * IndexedDB (`live-pending-store.ts`) until the service confirms them.
 *
 * WHAT ARRIVES. A batch from someone else, a refusal of ours, a fresh
 * snapshot after a reconnect or an undo: the engine's view before and after
 * is diffed and only that difference lands on the canvas
 * (`applyLiveOps`), so every untouched card keeps its identity and the books
 * re-solve as for any edit. A live change is the same design changing, not a
 * plan arriving: nothing here opens a new design or replaces the open one.
 *
 * UNDO undoes only this person's edits: the recorded inverse goes out as a new
 * batch (`LiveClientState.undo`). The store keeps no snapshots meanwhile.
 *
 * TABS. Each tab joins for itself (the service takes one account in a room
 * more than once): no tab depends on another staying open, and a tab's
 * pending edits are its own. A closed tab's leftover edits are adopted by the
 * next tab to open that plan (Web Locks tell which tabs are gone).
 *
 * Off entirely when NEXT_PUBLIC_LIVE_URL is unset or nobody is signed in.
 */

export type LiveStatus = "off" | "connecting" | "live" | "offline";

export interface LiveNotice {
  id: number;
  text: string;
  /** A key beside the words (Open, for a plan just shared with you). */
  action?: { label: string; run: () => void };
}

export interface LiveSessionState {
  /** The open design's live state: not live, joining, live, or waiting for the connection. */
  status: LiveStatus;
  /** The local design on the canvas that is live, and its doc key. */
  designId?: string;
  doc?: string;
  me?: { id: string; username: string; color: string };
  role?: "owner" | "editor";
  owner?: LiveMember;
  members: LiveMember[];
  /** Everyone else in the plan now: one entry per account, you left out. */
  present: LivePerson[];
  /** This tab's edits the service has not confirmed yet. */
  pending: number;
  notice?: LiveNotice;
}

export const useLiveSession = create<LiveSessionState>(() => ({
  status: "off",
  members: [],
  present: [],
  pending: 0,
}));

export function dismissLiveNotice(): void {
  useLiveSession.setState({ notice: undefined });
}

/** Shows a notice above the board (Add to a task's "Added ... to ...", with Open). */
export function showLiveNotice(text: string, action?: LiveNotice["action"]): void {
  useLiveSession.setState({ notice: { ...noticeOf(text), ...(action ? { action } : {}) } });
}

/** The parts of a WebSocket the session uses (a fake in tests). */
export interface LiveSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface LiveSessionOptions {
  createSocket?: (url: string) => LiveSocketLike;
  url?: () => string | undefined;
}

const OPEN = 1;
/** Batches sent a second: under the service's 30, so a burst waits rather than being refused. */
const BATCHES_PER_SECOND = 25;
/** A batch's ops as JSON in UTF-8 bytes, kept well under the service's 256 KB frame. */
const BATCH_BYTES = 200_000;
const BATCH_OPS = Math.min(4000, LIVE_LIMITS.opsPerBatch);
/** A join the service was too busy for goes again after this, plus up to as much again. */
const JOIN_RETRY_MS = 2000;

/** A string's length in UTF-8 bytes, as the service counts a frame. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair: one four-byte character.
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
/** Presence a second while the pointer moves on the board. */
const PRESENCE_INTERVAL_MS = 100;
const OPEN_MARK_MS = 15_000;
const ME_CACHE_KEY = "gtnh-factory-flow.live-me.v1";

interface Room {
  doc: string;
  designId: string;
  engine: LiveClientState;
  /** The snapshot arrived on the current connection. */
  joined: boolean;
  joinSent: boolean;
  pendingLoaded: boolean;
  role?: "owner" | "editor";
  owner?: LiveMember;
  members: LiveMember[];
  present: LivePerson[];
  /**
   * A plan just made here, its row created a moment ago: its first snapshot is what the account read, which may be
   * behind the canvas (`seed`, the canvas when the room was made). The canvas wins, once.
   */
  fresh: boolean;
  seed: LivePlan;
}

let noticeCount = 0;

function noticeOf(text: string): LiveNotice {
  noticeCount += 1;
  return { id: noticeCount, text };
}

function readCachedMe(
  username: string,
): { id: string; username: string; color: string } | undefined {
  try {
    const raw = window.localStorage.getItem(ME_CACHE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { id?: string; username?: string; color?: string })
      : undefined;
    return parsed?.username === username && parsed.id && parsed.color
      ? { id: parsed.id, username, color: parsed.color }
      : undefined;
  } catch {
    return undefined;
  }
}

/** This account's id, once the service has said it (or from the last time on this device); undefined signed out. */
export function myAccountId(): string | undefined {
  const known = useLiveSession.getState().me;
  if (known) {
    return known.id;
  }
  const username = useCommunityAuthStore.getState().user?.username;
  return username ? readCachedMe(username)?.id : undefined;
}

function writeCachedMe(me: { id: string; username: string; color: string }): void {
  try {
    window.localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  } catch {
    // Offline starts then wait for the first welcome.
  }
}

/** Ops in batches the service takes: each under the size and count limits. */
export function chunkOps(ops: LiveOp[], maxBytes = BATCH_BYTES, maxOps = BATCH_OPS): LiveOp[][] {
  const chunks: LiveOp[][] = [];
  let current: LiveOp[] = [];
  let size = 0;
  for (const op of ops) {
    const opSize = utf8Length(JSON.stringify(op)) + 1;
    if (current.length > 0 && (size + opSize > maxBytes || current.length >= maxOps)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(op);
    size += opSize;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export class LiveSession {
  private ws?: LiveSocketLike;
  private welcomed = false;
  private me?: { id: string; username: string; color: string };
  private username?: string;
  private authRefused = false;
  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  /** Asks to join again after the service said it was busy. */
  private joinTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private markTimer?: ReturnType<typeof setInterval>;
  private room?: Room;
  /** Docs the service refused to open (gone, not ours): not asked again this session. */
  private readonly refusedDocs = new Set<string>();
  private outbox: string[] = [];
  private sentAt: number[] = [];
  private pumpTimer?: ReturnType<typeof setTimeout>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private bindQueued = false;
  private cursor: LiveCursor | null = null;
  private presenceTimer?: ReturnType<typeof setTimeout>;
  private presenceAt = 0;
  private presenceDirty = false;
  private stopped = false;
  private readonly teardowns: Array<() => void> = [];
  private readonly createSocket: (url: string) => LiveSocketLike;
  private readonly url: () => string | undefined;

  constructor(options: LiveSessionOptions = {}) {
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as LiveSocketLike);
    this.url = options.url ?? liveSocketAddress;
  }

  start(): () => void {
    holdTabLock(THIS_TAB_ID);
    this.teardowns.push(useCommunityAuthStore.subscribe(() => this.onAuth()));
    this.teardowns.push(
      useDesignStore.subscribe((state, previous) => {
        if (
          state.activeDesignId !== previous.activeDesignId ||
          state.designs !== previous.designs ||
          state.publicView !== previous.publicView
        ) {
          this.queueBinding();
        }
      }),
    );
    this.teardowns.push(
      useFactoryStore.subscribe((state, previous) => {
        if (state.project !== previous.project && !isQuietChange()) {
          this.onLocalEdit(
            previous.project as unknown as LivePlan,
            state.project as unknown as LivePlan,
          );
        }
        if (state.selectedBoardIds !== previous.selectedBoardIds) {
          this.queuePresence();
        }
      }),
    );
    if (typeof window !== "undefined") {
      const onOnline = () => this.reconnectNow();
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          this.reconnectNow();
        }
      };
      const onHide = () => this.persistNow();
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("pagehide", onHide);
      this.teardowns.push(() => {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("pagehide", onHide);
      });
    }
    this.onAuth();
    return () => this.stop();
  }

  stop(): void {
    this.stopped = true;
    this.teardowns.splice(0).forEach((teardown) => teardown());
    this.unbind();
    this.disconnect();
  }

  // -------------------------------------------------------------------------
  // The connection

  private onAuth(): void {
    const username = useCommunityAuthStore.getState().user?.username;
    if (username === this.username) {
      return;
    }
    this.username = username;
    this.authRefused = false;
    this.me = username ? readCachedMe(username) : undefined;
    this.disconnect();
    if (username) {
      this.connect();
    }
    this.queueBinding();
  }

  private connect(): void {
    if (this.stopped || this.ws || !this.username || this.authRefused) {
      return;
    }
    const url = this.url();
    if (!url) {
      return;
    }
    let ws: LiveSocketLike;
    try {
      ws = this.createSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => {
      this.sendRaw({
        t: "hello",
        v: LIVE_PROTOCOL_VERSION,
        client: "web",
        clientVersion: APP_VERSION,
      });
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws || typeof event.data !== "string") {
        return;
      }
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      this.onFrame(frame);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) {
        return;
      }
      this.onClosed(event.code);
    };
    ws.onerror = () => undefined;
    this.publish();
  }

  private disconnect(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.joinTimer);
    this.joinTimer = undefined;
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    const ws = this.ws;
    this.ws = undefined;
    this.welcomed = false;
    this.outbox = [];
    if (this.room) {
      this.room.joined = false;
      this.room.joinSent = false;
      // Who is here is unknown until the next snapshot.
      this.room.present = [];
    }
    clearPresence();
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close(1000, "bye");
      } catch {
        // Already closed.
      }
    }
    this.publish();
  }

  private onClosed(code: number): void {
    this.ws = undefined;
    this.welcomed = false;
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    clearTimeout(this.joinTimer);
    this.joinTimer = undefined;
    this.outbox = [];
    if (this.room) {
      this.room.joined = false;
      this.room.joinSent = false;
      // Who is here is unknown until the next snapshot.
      this.room.present = [];
    }
    clearPresence();
    if (code === 4001) {
      // Not signed in as far as the service can tell: wait for a new sign-in.
      this.authRefused = true;
    } else {
      this.scheduleReconnect();
    }
    this.publish();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer || !this.username || this.authRefused) {
      return;
    }
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retries, 5)) + Math.random() * 400;
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  /** The connection drops as if the network went (development probes). */
  dropConnection(): void {
    const ws = this.ws;
    if (!ws) {
      return;
    }
    ws.onclose = null;
    ws.onmessage = null;
    try {
      ws.close(4000, "dropped");
    } catch {
      // Already closed.
    }
    this.onClosed(1006);
  }

  /** The network or the tab came back: try at once rather than wait out the backoff. */
  reconnectNow(): void {
    if (this.ws || this.stopped || !this.username || this.authRefused) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.connect();
  }

  private sendRaw(frame: object): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) {
      return false;
    }
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Frames from the service

  private onFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "welcome":
        this.welcomed = true;
        this.retries = 0;
        this.me = frame.you;
        writeCachedMe(frame.you);
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendRaw({ t: "ping" }), LIVE_PING_INTERVAL_MS);
        this.bindNow();
        this.joinIfReady();
        this.publish();
        return;
      case "snapshot":
        this.onSnapshot(frame);
        return;
      case "ops":
        this.onOps(frame);
        return;
      case "presence":
        if (frame.doc === this.room?.doc && frame.who !== this.me?.id) {
          notePresence(frame.conn, frame.cursor, frame.sel);
        }
        return;
      case "present":
        if (frame.doc === this.room?.doc) {
          this.room.present = frame.present;
          this.notePeople();
          this.publish();
        }
        return;
      case "members":
        if (frame.doc === this.room?.doc) {
          this.room.members = frame.members;
          this.publish();
        }
        return;
      case "kicked":
        if (frame.doc === this.room?.doc) {
          this.onKicked(frame.reason);
        }
        return;
      case "shared":
        this.onShared(frame);
        return;
      case "unshared":
        this.announced.delete(frame.doc);
        // The list of plans shared with this account follows at once; a copy
        // of the plan on this device goes with it (the sync drops copies the
        // account no longer lists).
        void syncLibraryNow();
        return;
      case "error":
        this.onError(frame);
        return;
      case "pong":
        return;
    }
  }

  /** Plans already announced this session: the service may say one twice (a notice it had to try again). */
  private readonly announced = new Set<string>();

  /** Someone shared a plan with this account: the list refreshes and a notice offers to open it. */
  private onShared(frame: Extract<ServerFrame, { t: "shared" }>): void {
    const key = parseDocKey(frame.doc);
    void syncLibraryNow();
    if (!key || this.announced.has(frame.doc)) {
      return;
    }
    this.announced.add(frame.doc);
    const name = frame.name || "a plan";
    const ref = { ownerId: key.ownerId, ownerName: frame.owner.username, designId: key.designId };
    useLiveSession.setState({
      notice: {
        ...noticeOf(`${frame.owner.username} shared ${name} with you`),
        action: {
          label: "Open",
          run: () => {
            dismissLiveNotice();
            leaveLibrary();
            openSharedPlan(ref, frame.name).catch((error: unknown) => {
              useLiveSession.setState({
                notice: noticeOf(error instanceof Error ? error.message : "The plan could not be opened."),
              });
            });
          },
        },
      },
    });
  }

  private onSnapshot(frame: Extract<ServerFrame, { t: "snapshot" }>): void {
    const room = this.room;
    if (!room || frame.doc !== room.doc) {
      return;
    }
    const before = room.engine.view;
    if (room.fresh) {
      // The first snapshot of a plan made here moments ago: what the canvas held beyond it is this person's edit,
      // sent first, ahead of anything done since the room was made.
      room.fresh = false;
      const snapshotPlan = liveShape(frame.plan);
      const ops = withRecipesTheyName(diffPlans(snapshotPlan, room.seed), snapshotPlan, room.seed);
      if (ops.length > 0) {
        const later = room.engine.pending.slice();
        room.engine = new LiveClientState({ seq: frame.seq, plan: snapshotPlan });
        for (const chunk of chunkOps(ops)) {
          room.engine.localOps(chunk, { undoable: false, keepRedo: true });
        }
        room.engine.adopt(later);
      }
    }
    const resend = room.engine.resync({ seq: frame.seq, plan: liveShape(frame.plan) });
    room.joined = true;
    room.role = frame.role;
    room.owner = frame.owner;
    room.members = frame.members;
    room.present = frame.present;
    this.notePeople();
    this.land(before, room.engine.view);
    for (const batch of resend) {
      this.queueBatch(room, batch);
    }
    this.queuePresence();
    this.publish();
  }

  private onOps(frame: Extract<ServerFrame, { t: "ops" }>): void {
    const room = this.room;
    if (!room || frame.doc !== room.doc || !room.joined) {
      return;
    }
    const before = room.engine.view;
    const result = room.engine.receive(frame);
    this.land(before, room.engine.view);
    if (result.own) {
      void settleDesignLiveReplacement(room.designId, room.doc, frame.cid).catch(() => undefined);
      this.schedulePersist();
    }
    if (result.gap) {
      // Missed batches: ask for the whole plan again (join answers a snapshot).
      this.sendRaw({ t: "join", doc: room.doc });
    }
    this.publish();
  }

  private onError(frame: Extract<ServerFrame, { t: "error" }>): void {
    const room = this.room;
    if (frame.code === "auth") {
      this.authRefused = true;
      return;
    }
    if (!room || frame.doc !== room.doc) {
      return;
    }
    if (frame.cid) {
      if (frame.code === "rate") {
        // Not applied, but nothing wrong with it: it goes again shortly.
        const batch = room.engine.pending.find((pending) => pending.cid === frame.cid);
        if (batch) {
          setTimeout(() => {
            if (this.room === room && room.engine.pending.includes(batch)) {
              this.queueBatch(room, batch);
            }
          }, 1000);
        }
        return;
      }
      const before = room.engine.view;
      if (room.engine.refuse(frame.cid)) {
        void settleDesignLiveReplacement(room.designId, room.doc, frame.cid).catch(() => undefined);
        this.land(before, room.engine.view);
        this.schedulePersist();
        useLiveSession.setState({ notice: noticeOf(`An edit was not saved: ${frame.msg}`) });
        this.publish();
      }
      return;
    }
    if (!room.joined && (frame.code === "forbidden" || frame.code === "not_found")) {
      this.onRefusedDoc(room, frame.code);
    } else if (!room.joined && frame.code === "rate") {
      // The service is busy, or this account has too many plans open: ask
      // again shortly on this connection.
      room.joinSent = false;
      clearTimeout(this.joinTimer);
      this.joinTimer = setTimeout(
        () => {
          this.joinTimer = undefined;
          if (this.room === room) {
            this.joinIfReady();
          }
        },
        JOIN_RETRY_MS + Math.random() * JOIN_RETRY_MS,
      );
    }
  }

  /** The service will not open this plan for us: gone, or no longer shared. */
  private onRefusedDoc(room: Room, code: "forbidden" | "not_found"): void {
    this.refusedDocs.add(room.doc);
    const design = useDesignStore.getState().designs.find((entry) => entry.id === room.designId);
    this.unbind();
    if (design?.cloud) {
      useLiveSession.setState({
        notice: noticeOf(
          code === "forbidden"
            ? `${design.name} is no longer shared with you.`
            : `${design.name} was deleted.`,
        ),
      });
      void useDesignStore.getState().removeDesign(design.id, { fromSync: true });
    }
    this.publish();
  }

  private onKicked(reason: "unshared" | "deleted"): void {
    const room = this.room;
    if (!room) {
      return;
    }
    this.refusedDocs.add(room.doc);
    const design = useDesignStore.getState().designs.find((entry) => entry.id === room.designId);
    void deletePending(pendingKey(room.doc, THIS_TAB_ID));
    room.engine.pending.length = 0;
    this.unbind();
    const name = design?.name ?? "This plan";
    // Leaving a plan on purpose drops this tab from it too: that is no news.
    const left = reason === "unshared" && leavingDocs.delete(room.doc);
    if (!left) {
      useLiveSession.setState({
        notice: noticeOf(
          reason === "unshared" ? `You were removed from ${name}.` : `${name} was deleted.`,
        ),
      });
    }
    if (design && (design.cloud || reason === "deleted")) {
      void useDesignStore.getState().removeDesign(design.id, { fromSync: true });
    }
    this.publish();
  }

  /** Who is here, for the faces and the presence layer. */
  private notePeople(): void {
    const room = this.room;
    if (!room) {
      clearPresence();
      return;
    }
    setPresentPeople(
      room.present
        .filter((person) => person.id !== this.me?.id)
        .map((person) => ({
          conn: person.conn,
          who: person.id,
          username: person.username,
          color: person.color,
          client: person.client,
        })),
      undefined,
    );
  }

  // -------------------------------------------------------------------------
  // Which design is live

  private queueBinding(): void {
    if (this.bindQueued) {
      return;
    }
    this.bindQueued = true;
    // After the design store has put the plan on the canvas: it names the
    // design first and lands its plan in the same task.
    queueMicrotask(() => {
      this.bindQueued = false;
      this.bindNow();
    });
  }

  private target(): { doc: string; designId: string } | undefined {
    if (!isLiveConfigured() || !this.username || this.stopped) {
      return undefined;
    }
    const { activeDesignId, designs, publicView } = useDesignStore.getState();
    this.forgetRefusalsOfGoneDesigns(designs);
    if (publicView || !activeDesignId || useFactoryStore.getState().isReadOnly) {
      return undefined;
    }
    const design = designs.find((entry) => entry.id === activeDesignId);
    if (!design) {
      return undefined;
    }
    let doc: string | undefined;
    if (design.cloud) {
      doc = docKey(design.cloud.ownerId, design.cloud.designId);
    } else if (this.me && design.remoteUpdatedAt) {
      doc = docKey(this.me.id, design.id);
    }
    return doc && !this.refusedDocs.has(doc) ? { doc, designId: design.id } : undefined;
  }

  /**
   * A refusal holds while the design it was about is still here. Once that
   * design is gone (a removed member's copy, a deleted plan), a design for the
   * same plan is a new one: shared again and opened, it joins.
   */
  private forgetRefusalsOfGoneDesigns(
    designs: ReadonlyArray<{ id: string; cloud?: { ownerId: string; designId: string } }>,
  ): void {
    for (const doc of this.refusedDocs) {
      const key = parseDocKey(doc);
      const stillHere =
        key !== undefined &&
        designs.some((design) =>
          design.cloud
            ? design.cloud.ownerId === key.ownerId && design.cloud.designId === key.designId
            : design.id === key.designId,
        );
      if (!stillHere) {
        this.refusedDocs.delete(doc);
      }
    }
  }

  private bindNow(): void {
    const target = this.target();
    if (target?.doc === this.room?.doc && target?.designId === this.room?.designId) {
      return;
    }
    this.unbind();
    if (target) {
      this.bind(target.doc, target.designId);
    }
    this.publish();
  }

  private bind(doc: string, designId: string): void {
    const project = useFactoryStore.getState().project;
    const room: Room = {
      doc,
      designId,
      engine: new LiveClientState({ seq: 0, plan: liveShape(project) }),
      joined: false,
      joinSent: false,
      pendingLoaded: false,
      members: [],
      present: [],
      fresh: takeDesignFresh(designId),
      seed: liveShape(project),
    };
    this.room = room;
    setLiveDesignId(designId);
    setLiveUndoHandler({ undo: () => this.undo(false), redo: () => this.undo(true) });
    useFactoryStore.getState().setLiveUndo({ canUndo: false, canRedo: false });
    markDesignOpenLive(designId);
    clearInterval(this.markTimer);
    this.markTimer = setInterval(() => markDesignOpenLive(designId), OPEN_MARK_MS);
    // Pending imports and offline edits must be applied before any snapshot
    // arrives, rather than briefly replacing the canvas with the old account copy.
    void this.adoptPending(room)
      .then(() => {
        if (this.room === room) {
          room.pendingLoaded = true;
          this.persistNow();
          this.joinIfReady();
        }
      })
      .catch(() => {
        if (this.room === room) {
          useLiveSession.setState({
            notice: noticeOf("Saved edits could not be loaded. Reload this plan to reconnect."),
          });
        }
      });
  }

  private unbind(): void {
    const room = this.room;
    if (!room) {
      return;
    }
    this.persistNow();
    if (room.joinSent) {
      this.sendRaw({ t: "leave", doc: room.doc });
    }
    this.room = undefined;
    this.outbox = [];
    clearInterval(this.markTimer);
    this.markTimer = undefined;
    clearDesignOpenLive(room.designId);
    setLiveDesignId(undefined);
    setLiveUndoHandler(undefined);
    useFactoryStore.getState().setLiveUndo(undefined);
    clearPresence();
  }

  private joinIfReady(): void {
    const room = this.room;
    if (!room || !room.pendingLoaded || room.joinSent || !this.welcomed) {
      return;
    }
    room.joinSent = this.sendRaw({ t: "join", doc: room.doc });
  }

  /** Edits a closed tab of ours left for this plan: shown and sent with ours. */
  private async adoptPending(room: Room): Promise<void> {
    const [entries, replacement] = await Promise.all([
      readPending(room.doc),
      readDesignLiveReplacement(room.designId),
    ]);
    const alive = await aliveTabs();
    // This tab's own entry is left from an earlier visit to the plan (its
    // engine went when the tab moved to another design); others are tabs gone.
    const orphans = entries.filter(
      (entry) => entry.tabId === THIS_TAB_ID || (alive !== undefined && !alive.has(entry.tabId)),
    );
    const replacementBatches = replacement?.doc === room.doc ? replacement.pending : [];
    if ((orphans.length === 0 && replacementBatches.length === 0) || this.room !== room) {
      return;
    }
    const before = room.engine.view;
    const current = room.engine.pending.slice();
    const batches = [...replacementBatches, ...orphans.flatMap((entry) => entry.pending)];
    const unique = [...new Map(batches.map((batch) => [batch.cid, batch])).values()];
    const added = room.engine.adopt(unique);
    // Edits made while the database read waited are newer than saved edits.
    room.engine.pending = [...added, ...current];
    this.land(before, room.engine.view);
    await Promise.all(
      orphans
        .filter((entry) => entry.tabId !== THIS_TAB_ID)
        .map((entry) => deletePending(entry.key).catch(() => undefined)),
    );
    if (this.room === room) {
      this.persistNow();
    }
    if (room.joined) {
      added.forEach((batch) => this.queueBatch(room, batch));
    }
    this.publish();
  }

  // -------------------------------------------------------------------------
  // Edits

  private onLocalEdit(previous: LivePlan, next: LivePlan): void {
    const room = this.room;
    if (!room || useDesignStore.getState().activeDesignId !== room.designId) {
      return;
    }
    const shaped = liveShape(next);
    const ops = withRecipesTheyName(diffPlans(liveShape(previous), shaped), room.engine.view, shaped);
    if (ops.length === 0) {
      return;
    }
    for (const chunk of chunkOps(ops)) {
      const batch = room.engine.localOps(chunk);
      if (batch) {
        this.queueBatch(room, batch);
      }
    }
    this.schedulePersist();
    this.publish();
  }

  /** Undo (or redo) this person's last own edit: its recorded inverse goes out as a new edit. */
  private undo(redo: boolean): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const before = room.engine.view;
    const batch = redo ? room.engine.redo() : room.engine.undo();
    if (!batch) {
      return;
    }
    this.land(before, room.engine.view);
    this.queueBatch(room, batch);
    this.schedulePersist();
    this.publish();
  }

  /** What changed between two views lands on the canvas, quietly. */
  private land(before: LivePlan, after: LivePlan): void {
    if (before === after) {
      return;
    }
    const ops = diffPlans(before, after);
    if (ops.length > 0) {
      const conversion = useFactoryStore.getState().applyLiveOps(ops);
      if (conversion) {
        this.sendConversion(conversion.before, conversion.after);
      }
    }
  }

  /**
   * A plan that landed in an old mode was converted to the one board mode on
   * the canvas (applyLiveOps): the conversion goes out as an edit undo never
   * takes back, so everyone in the plan reads the same converted plan.
   */
  private sendConversion(before: FactoryProject, after: FactoryProject): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const ops = diffPlans(liveShape(before), liveShape(after));
    if (ops.length === 0) {
      return;
    }
    for (const chunk of chunkOps(ops)) {
      const batch = room.engine.localOps(chunk, { undoable: false, keepRedo: true });
      if (batch) {
        this.queueBatch(room, batch);
      }
    }
    this.schedulePersist();
  }

  private queueBatch(room: Room, batch: PendingBatch): void {
    if (!room.joined) {
      // It waits in pending; the next snapshot sends it.
      return;
    }
    const text = JSON.stringify(room.engine.frame(room.doc, batch));
    if (utf8Length(text) > LIVE_LIMITS.batchBytes) {
      // One op alone over the limit: the service would refuse it (or drop the
      // socket, and it would go again on every reconnect). It never happened.
      const before = room.engine.view;
      if (room.engine.refuse(batch.cid)) {
        void settleDesignLiveReplacement(room.designId, room.doc, batch.cid).catch(() => undefined);
        this.land(before, room.engine.view);
        this.schedulePersist();
        useLiveSession.setState({
          notice: noticeOf("An edit was not saved: it is too big to send."),
        });
        this.publish();
      }
      return;
    }
    this.outbox.push(text);
    this.pump();
  }

  /** Sends what waits, at most BATCHES_PER_SECOND. */
  private pump(): void {
    if (this.pumpTimer) {
      return;
    }
    const ws = this.ws;
    while (this.outbox.length > 0) {
      if (!ws || ws.readyState !== OPEN) {
        this.outbox = [];
        return;
      }
      const now = Date.now();
      this.sentAt = this.sentAt.filter((at) => now - at < 1000);
      if (this.sentAt.length >= BATCHES_PER_SECOND) {
        this.pumpTimer = setTimeout(
          () => {
            this.pumpTimer = undefined;
            this.pump();
          },
          1000 - (now - this.sentAt[0]!) + 5,
        );
        return;
      }
      const text = this.outbox.shift()!;
      try {
        ws.send(text);
      } catch {
        this.outbox = [];
        return;
      }
      this.sentAt.push(now);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistNow();
    }, 200);
  }

  private persistNow(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const room = this.room;
    if (!room || (!room.pendingLoaded && room.engine.pending.length === 0)) {
      return;
    }
    void writePending(room.doc, THIS_TAB_ID, room.engine.pending.slice(), {
      preserveStored: !room.pendingLoaded,
    }).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Presence

  /** The pointer on the board, in the plan's coordinates; null when it left. At most 10 a second go out. */
  setCursor(cursor: LiveCursor | null): void {
    if (
      cursor === this.cursor ||
      (cursor && this.cursor && cursor.x === this.cursor.x && cursor.y === this.cursor.y)
    ) {
      return;
    }
    this.cursor = cursor;
    this.queuePresence();
  }

  private queuePresence(): void {
    if (!this.room?.joined) {
      return;
    }
    this.presenceDirty = true;
    if (this.presenceTimer) {
      return;
    }
    const wait = this.presenceAt + PRESENCE_INTERVAL_MS - Date.now();
    if (wait > 0) {
      this.presenceTimer = setTimeout(() => {
        this.presenceTimer = undefined;
        this.sendPresence();
      }, wait);
      return;
    }
    this.sendPresence();
  }

  private sendPresence(): void {
    const room = this.room;
    if (!room?.joined || !this.presenceDirty) {
      return;
    }
    this.presenceDirty = false;
    this.presenceAt = Date.now();
    const sel = useFactoryStore.getState().selectedBoardIds.slice(0, LIVE_LIMITS.selectionIds);
    this.sendRaw({ t: "presence", doc: room.doc, cursor: this.cursor, sel });
  }

  // -------------------------------------------------------------------------

  private publish(): void {
    const room = this.room;
    const connected = Boolean(this.ws && this.welcomed);
    const status: LiveStatus = !room
      ? "off"
      : room.joined && connected
        ? "live"
        : this.ws
          ? "connecting"
          : "offline";
    const people = new Map<string, LivePerson>();
    for (const person of room?.present ?? []) {
      if (person.id !== this.me?.id && !people.has(person.id)) {
        people.set(person.id, person);
      }
    }
    useLiveSession.setState({
      status,
      designId: room?.designId,
      doc: room?.doc,
      me: this.me,
      role: room?.role,
      owner: room?.owner,
      members: room?.members ?? [],
      present: [...people.values()],
      pending: room?.engine.pending.length ?? 0,
    });
    if (room) {
      useFactoryStore
        .getState()
        .setLiveUndo({ canUndo: room.engine.canUndo, canRedo: room.engine.canRedo });
    }
  }
}

let session: LiveSession | undefined;

/** An explicit replacement is an edit to an existing room, never a fresh-plan seed. */
export async function prepareImportedReplacement(
  designId: string,
  before: FactoryProject,
  after: FactoryProject,
): Promise<LiveReplacementOutbox> {
  const username = useCommunityAuthStore.getState().user?.username;
  const owner = myAccountId();
  if (!username || !owner)
    throw new Error(
      "Connect to your account before updating this plan. Keep the imported plan separately.",
    );
  const doc = docKey(owner, designId);
  const [entries, replacement] = await Promise.all([
    readPending(doc),
    readDesignLiveReplacement(designId),
  ]);
  if (replacement || entries.some((entry) => entry.pending.length > 0)) {
    throw new Error(
      "That plan has unsent edits. Open it before updating it. Your imported plan was kept separately.",
    );
  }
  const previous = liveShape(before);
  const next = liveShape(after);
  const engine = new LiveClientState({ seq: 0, plan: previous });
  for (const ops of chunkOps(withRecipesTheyName(diffPlans(previous, next), previous, next))) {
    engine.localOps(ops);
  }
  if (useCommunityAuthStore.getState().user?.username !== username || myAccountId() !== owner) {
    throw new Error("Your account changed. Your imported plan was kept separately.");
  }
  return { doc, pending: engine.pending };
}

/** Mounted once by the app shell. Does nothing unless live plans are configured. */
export function startLiveSessions(options?: LiveSessionOptions): () => void {
  if (!isLiveConfigured() || session) {
    return () => undefined;
  }
  const started = new LiveSession(options);
  session = started;
  const stop = started.start();
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    // Development only: the two-browser probes read and drive the stores here.
    (window as unknown as { __gtnhLive?: unknown }).__gtnhLive = {
      session: useLiveSession,
      factory: useFactoryStore,
      design: useDesignStore,
      drop: () => started.dropConnection(),
    };
  }
  return () => {
    stop();
    if (session === started) {
      session = undefined;
    }
  };
}

/** Plans this browser is leaving on purpose, by doc key: being dropped from one tells nobody anything. */
const leavingDocs = new Set<string>();

/** Call before leaving a plan shared with you (its Leave keys): the drop that follows is not news. */
export function noteLeavingPlan(ownerId: string, designId: string): void {
  leavingDocs.add(docKey(ownerId, designId));
}

/** The board's presence layer reports the pointer here. */
export function reportLiveCursor(cursor: LiveCursor | null): void {
  session?.setCursor(cursor);
}
