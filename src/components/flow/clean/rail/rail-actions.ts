import { RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { openLibrary } from "@/lib/library/library-tab";
import type { FactoryNode, FactoryProject } from "@/lib/model/types";
import { nextPinRule, pinRuleOf, withPinRule } from "@/lib/model/pin-rule";
import type { TargetMode } from "@/lib/model/storage-target";
import { useFactoryStore } from "@/store/factory-store";
import { liveUndoHandler, quietly } from "@/store/live-edit-gate";
import { solveBooks } from "@/store/solve-books";
import { RULE_STEPS } from "../../rate-rule";
import {
  canonicalOf,
  flowHandle,
  splitResultNodeId,
  type RailDrawer,
  type RailLine,
} from "./rail-model";
import { allAt, evenShares, nudged } from "./rail-math";
import type { SpareView } from "./spare-model";

/**
 * Everything the overview rail does to the plan, in one place. Ordinary edits
 * go through the store's own actions (one undo step each). The only direct
 * writes are a spare's split while its bar is in hand, which re-solves as it
 * moves and makes one undo step when let go (`previewSpare`, `commitSpare`).
 */

const state = () => useFactoryStore.getState();
const HISTORY_LIMIT = 100;

function locked(): boolean {
  return state().isReadOnly;
}

// ---------------------------------------------------------------------------
// Drawers
// ---------------------------------------------------------------------------

/**
 * A drawer's rate (per second, magnitude). Typing a rate on Any picks the rule
 * the player almost always means: exactly for a source, at least for a
 * product. Zero clears the rule back to Any.
 */
export function setDrawerRate(
  drawer: Pick<RailDrawer, "id" | "source" | "rule" | "role">,
  perSecond: number,
): void {
  if (locked()) return;
  const store = state();
  if (drawer.role === "byproduct" && perSecond > 0) store.setStorageDrainMode(drawer.id, "product");
  if (!(perSecond > 0)) {
    store.setStorageRule(drawer.id, "ignore", 0);
    return;
  }
  const rule: TargetMode =
    drawer.rule === "ignore" ? (drawer.source ? "exact" : "at-least") : drawer.rule;
  store.setStorageRule(drawer.id, rule, perSecond);
}

export function setDrawerRule(
  drawer: Pick<RailDrawer, "id" | "ratePerSecond" | "role">,
  rule: TargetMode,
): void {
  if (locked()) return;
  const store = state();
  if (drawer.role === "byproduct" && rule !== "ignore")
    store.setStorageDrainMode(drawer.id, "product");
  if (rule === "ignore") {
    store.setStorageTargetMode(drawer.id, "ignore");
    return;
  }
  store.setStorageRule(drawer.id, rule, drawer.ratePerSecond);
}

/** The rule key's wheel and right click: the next or previous rule. */
export function stepDrawerRule(drawer: RailDrawer, direction: 1 | -1): void {
  const at = RULE_STEPS.indexOf(drawer.rule);
  const next = RULE_STEPS[(at + direction + RULE_STEPS.length) % RULE_STEPS.length]!;
  setDrawerRule(drawer, next);
}

// ---------------------------------------------------------------------------
// Ports set to a rate on their cards, and open ports
// ---------------------------------------------------------------------------

/**
 * Sets a port's rate as the card does: one port rate at a time on a card, and
 * a rate lets go of a pinned count. Zero lets the plan decide again.
 */
export function setPortRate(nodeId: string, handle: string, perSecond: number): void {
  if (locked()) return;
  if (!(perSecond > 0)) {
    state().updateNode(nodeId, { portRates: undefined });
    return;
  }
  state().updateNode(nodeId, {
    portRates: { [handle]: perSecond },
    solvePin: undefined,
    solvePinExact: undefined,
  });
}

/**
 * A rate typed on a line nothing sets: on its one open port it is that port's
 * rate, as typed on the card; on several, one drawer takes them all at that
 * rate. Returns whether anything was done.
 */
export function setLineRate(line: RailLine, source: boolean, perSecond: number): boolean {
  if (locked() || !(perSecond > 0)) return false;
  const open = line.open;
  if (open.length === 1) {
    const only = open[0]!;
    setPortRate(only.nodeId, only.handle, perSecond);
    return true;
  }
  if (open.length < 2) return false;
  const first = open[0]!;
  const project = state().project;
  const anchor = project.nodes.find((node) => node.id === first.nodeId);
  const position = anchor
    ? { x: anchor.position.x + (source ? -240 : 420), y: anchor.position.y }
    : { x: 40, y: 40 };
  const before = new Set((project.storages ?? []).map((s) => s.id));
  state().addStorageForConnection(
    line.resource as never,
    open.map((o) => o.nodeId),
    source ? "input" : "output",
    position,
    first.handle,
  );
  const made = (state().project.storages ?? []).find((s) => !before.has(s.id));
  if (!made) return false;
  // The drawer was made by the action above (one undo step); its rate joins that step.
  const project2 = state().project;
  const rule: TargetMode = source ? "exact" : "at-least";
  const next: FactoryProject = {
    ...project2,
    storages: project2.storages?.map((s) =>
      s.id === made.id
        ? { ...s, targetMode: rule, targetPerSecond: source ? -perSecond : perSecond }
        : s,
    ),
  };
  writeProject(next, false);
  return true;
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

/**
 * Sets a machine's count, or (0 or less) clears it: Any, while the plan decides how many. The rule stays as it is; a
 * card on Any becomes Up to, as on the card.
 */
export function pinCount(nodeId: string, count: number): void {
  if (locked()) return;
  const node = state().project.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const rule = pinRuleOf(node);
  // Already so: nothing to write (an open box sets as it goes, then once more as it is let go of).
  const pinned = (node.solvePin ?? 0) > 0;
  if (count > 0 ? pinned && node.solvePin === count : !pinned) return;
  const next = withPinRule(node, rule === "any" ? "upTo" : rule, count > 0 ? count : undefined);
  state().updateNode(nodeId, {
    solvePin: next.solvePin,
    solvePinExact: next.solvePinExact,
    ...(count > 0 ? { portRates: undefined } : {}),
  });
}

/** A machine's count fields as they are, for `restorePin`. */
export type PinSnapshot = Pick<FactoryNode, "solvePin" | "solvePinExact">;

export function pinSnapshot(nodeId: string): PinSnapshot | undefined {
  const node = state().project.nodes.find((n) => n.id === nodeId);
  return node ? { solvePin: node.solvePin, solvePinExact: node.solvePinExact } : undefined;
}

/** Puts a machine's count back as `pinSnapshot` took it (Escape on a box that set as it went). */
export function restorePin(nodeId: string, snapshot: PinSnapshot | undefined): void {
  if (locked() || !snapshot) return;
  state().updateNode(nodeId, snapshot);
}

/**
 * Steps a machine's count rule (Any, Up to, Exactly); `count` is what a card with no count is set to.
 */
export function stepPinRule(nodeId: string, count: number): void {
  if (locked()) return;
  const node = state().project.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const rule = nextPinRule(pinRuleOf(node));
  const next = withPinRule(node, rule, rule === "any" ? undefined : (node.solvePin ?? count));
  state().updateNode(nodeId, {
    solvePin: next.solvePin,
    solvePinExact: next.solvePinExact,
    ...(rule === "any" ? {} : { portRates: undefined }),
  });
}

// ---------------------------------------------------------------------------
// Going to things on the board
// ---------------------------------------------------------------------------

const walks = new Map<string, number>();

/** Frames a card (or cards) on the board. */
export function frameCards(ids: string[]): void {
  state().frameBoardNodes(ids, { maxZoom: 1 });
}

/** Whether framing all of `ids` at once leaves the board at a zoom worth reading (>= 0.5). */
export function framesReadably(ids: string[]): boolean {
  if (ids.length <= 1) return true;
  const project = state().project;
  const points = ids
    .map(
      (id) =>
        project.nodes.find((n) => n.id === id)?.position ??
        project.storages?.find((s) => s.id === id)?.position,
    )
    .filter((p): p is { x: number; y: number } => p !== undefined);
  if (points.length < 2) return true;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs) + RECIPE_NODE_WIDTH;
  const height = Math.max(...ys) - Math.min(...ys) + 240;
  const viewW = typeof window === "undefined" ? 1200 : Math.max(400, window.innerWidth - 560);
  const viewH = typeof window === "undefined" ? 700 : Math.max(300, window.innerHeight - 140);
  return Math.min(viewW / width, viewH / height) >= 0.5;
}

/** Cards that make or use a resource, in board order. */
export function cardsOfResource(key: string): string[] {
  const { project, lastResult } = state();
  if (!lastResult) return [];
  const aliases = new Map<string, string>();
  const out = new Set<string>();
  for (const node of Object.values(lastResult.nodes)) {
    const { cardId } = splitResultNodeId(node.nodeId);
    const hit = [...Object.values(node.inputs), ...Object.values(node.outputs)].some(
      (flow) => canonicalOf(aliases, flow.key) === key,
    );
    if (hit && project.nodes.some((n) => n.id === cardId)) out.add(cardId);
  }
  return [...out];
}

/** Frames the next card that makes or uses a resource, going round each time. */
export function walkResource(key: string): boolean {
  const cards = cardsOfResource(key);
  if (cards.length === 0) return false;
  const at = ((walks.get(key) ?? -1) + 1) % cards.length;
  walks.set(key, at);
  frameCards([cards[at]!]);
  return true;
}

/** Frames the next of a list of cards, going round each time (`id` names the walk). */
export function walkCards(id: string, cards: string[]): boolean {
  if (cards.length === 0) return false;
  const at = ((walks.get(id) ?? -1) + 1) % cards.length;
  walks.set(id, at);
  frameCards([cards[at]!]);
  return true;
}

/** Right click on a resource row: the public setups that make it. */
export function showSetupsMaking(line: Pick<RailLine, "label">): void {
  openLibrary({ kind: "public", search: line.label });
}

export { flowHandle };

// ---------------------------------------------------------------------------
// Spares
// ---------------------------------------------------------------------------

function withSpare(
  project: FactoryProject,
  key: string,
  map: Record<string, number> | undefined,
): FactoryProject {
  const rest = { ...(project.spareShares ?? {}) };
  if (map === undefined) delete rest[key];
  else rest[key] = map;
  const next: FactoryProject = {
    ...project,
    spareShares: Object.keys(rest).length > 0 ? rest : undefined,
  };
  if (next.spareShares === undefined) delete (next as { spareShares?: unknown }).spareShares;
  return next;
}

/**
 * A write to the project the store has no action for. `push`: one undo step of its own. A live plan keeps no
 * snapshots (its undo is the recorded inverses of this person's edits, live-edit-gate.ts).
 */
function writeProject(project: FactoryProject, push: boolean): void {
  const stamped: FactoryProject = {
    ...project,
    metadata: { ...project.metadata, updatedAt: new Date().toISOString() },
  };
  const snapshot = push && !liveUndoHandler();
  useFactoryStore.setState((s) => ({
    project: stamped,
    lastResult: solveBooks(stamped),
    ...(snapshot
      ? { undoHistory: [...s.undoHistory, s.project].slice(-HISTORY_LIMIT), redoHistory: [] }
      : {}),
  }));
}

/** On a live plan a split in hand is not sent: only where it is let go is (one edit, one undo step). */
function inHand(write: () => void): void {
  if (liveUndoHandler()) quietly(write);
  else write();
}

export function spareMap(spare: SpareView, shares: readonly number[]): Record<string, number> {
  const map: Record<string, number> = {};
  spare.bearers.forEach((b, i) => {
    map[b.key] = shares[i] ?? 0;
  });
  return map;
}

/** Sets a leftover's split as one undoable edit. */
export function setSpareShares(spare: SpareView, shares: readonly number[]): void {
  if (locked()) return;
  writeProject(withSpare(state().project, spare.key, spareMap(spare, shares)), true);
}

/** Puts a leftover back where the solver puts it, as one undoable edit. */
export function clearSpare(spare: SpareView): void {
  if (locked() || state().project.spareShares?.[spare.key] === undefined) return;
  writeProject(withSpare(state().project, spare.key, undefined), true);
}

export const splitSpareEvenly = (spare: SpareView) =>
  setSpareShares(spare, evenShares(spare.bearers.length));
export const putSpareAt = (spare: SpareView, index: number) =>
  setSpareShares(spare, allAt(spare.bearers.length, index));
export { nudged };

/** A split while its bar is in hand: the plan re-solves as it moves and no undo step is made. */
export function previewSpare(spare: SpareView, shares: readonly number[]): void {
  if (locked()) return;
  inHand(() => writeProject(withSpare(state().project, spare.key, spareMap(spare, shares)), false));
}

/**
 * The bar is let go. `base` is the project as it was when it was taken: if the
 * split moved, that is the one undo step; if not, the plan goes back to it.
 */
export function endSpareDrag(base: FactoryProject, moved: boolean): void {
  if (liveUndoHandler()) {
    // The splits in hand were quiet. Others' edits that landed meanwhile stay; only the splits go out, as one edit.
    const held = state().project;
    const withShares = (spareShares: FactoryProject["spareShares"]): FactoryProject => {
      const next: FactoryProject = { ...held, spareShares };
      if (spareShares === undefined) delete (next as { spareShares?: unknown }).spareShares;
      return next;
    };
    quietly(() => writeProject(withShares(base.spareShares), false));
    if (moved) writeProject(withShares(held.spareShares), false);
    return;
  }
  if (!moved) {
    if (state().project !== base) writeProject(base, false);
    return;
  }
  useFactoryStore.setState((s) => ({
    undoHistory: [...s.undoHistory, base].slice(-HISTORY_LIMIT),
    redoHistory: [],
  }));
}

export function currentProject(): FactoryProject {
  return state().project;
}
