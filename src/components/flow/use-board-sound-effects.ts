"use client";

import { useEffect } from "react";
import type { FactoryProject, StorageBufferMode } from "@/lib/model/types";
import { playBoardSound, primeBoardSounds } from "@/lib/board-sounds";
import { useFactoryStore } from "@/store/factory-store";

/**
 * Plays the board's interface sounds by WATCHING the project rather than by
 * instrumenting call sites. Every way a card can land (recipe book add,
 * drawer drag, paste, refactor, undo) funnels through the store, so a diff
 * of ids between one project and the next catches all of them - including
 * paths added later, which is the point.
 *
 * SOUNDS ARE FOR THE CANVAS ONLY (Jack, 2026-08-28): cards landing and
 * leaving, wires connecting and cutting, boards folding and unfolding,
 * card settings changing, bulk changes. Navigation and chrome are silent -
 * no tab sounds, no button sounds. Two guards enforce that beyond the
 * id-diff itself:
 * - A project id change is navigation and plays nothing, and it opens a
 *   short QUIET WINDOW: loading machinery (migrations, icon refreshes,
 *   dataset touch-ups) often rewrites the plan right after a switch, and
 *   none of that is the player's hand.
 * - The config signature ignores cosmetic fields (positions, icons,
 *   colors, tooltips, names), so a refresh that re-resolves art can never
 *   fake a settings change.
 *
 * Undo and redo are deliberately NOT special-cased: undoing a delete diffs
 * as an add and thumps like one, which is what the hand just did.
 */

interface ProjectSoundSnapshot {
  projectId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  /** Boards standing open as windows; folding and unfolding sound. */
  openPocketIds: Set<string>;
  /** Drawer ids, to tell a supply spawn from a catch spawn. */
  storageIds: Set<string>;
  storageModes: Map<string, StorageBufferMode>;
  /** Edge endpoints, to see which way a freshly spawned drawer faces. */
  edgeEnds: Map<string, { source: string; target: string }>;
  /** POWER wires, for the zap: connecting electricity sounds electric. */
  powerEdgeIds: Set<string>;
  /**
   * Every card serialized through the cosmetic filter: machine counts,
   * tiers, drain pills, config choices survive; positions and art do not.
   * When the structure is unchanged but this moved, a knob was turned
   * somewhere and the adjust tap plays. A project write only happens per
   * user action, so the stringify cost is nothing.
   */
  configSignature: string;
}

/**
 * Fields that change without the player turning any knob: drag positions,
 * icon re-resolution, display names, paint. None of them may sound.
 */
const COSMETIC_KEYS = new Set([
  "position",
  "iconPath",
  "iconAtlas",
  "dominantColor",
  "tooltip",
  "displayName",
  "colorTag",
]);

function signatureReplacer(key: string, value: unknown): unknown {
  return COSMETIC_KEYS.has(key) ? undefined : value;
}

export function snapshotProject(project: FactoryProject): ProjectSoundSnapshot {
  const nodeIds = new Set<string>();
  const signatureParts: string[] = [];
  for (const node of project.nodes) {
    nodeIds.add(node.id);
    signatureParts.push(JSON.stringify(node, signatureReplacer));
  }
  const storageIds = new Set<string>();
  const storageModes = new Map<string, StorageBufferMode>();
  for (const storage of project.storages ?? []) {
    nodeIds.add(storage.id);
    storageIds.add(storage.id);
    storageModes.set(storage.id, storage.bufferMode ?? "overflow");
    signatureParts.push(JSON.stringify(storage, signatureReplacer));
  }
  const edgeIds = new Set<string>();
  const edgeEnds = new Map<string, { source: string; target: string }>();
  const powerEdgeIds = new Set<string>();
  for (const edge of project.edges) {
    edgeIds.add(edge.id);
    edgeEnds.set(edge.id, { source: edge.source, target: edge.target });
    if (edge.resourceKind === "power") {
      powerEdgeIds.add(edge.id);
    }
  }
  const openPocketIds = new Set<string>();
  for (const pocket of project.pockets ?? []) {
    if (pocket.expanded) {
      openPocketIds.add(pocket.id);
    }
  }
  return {
    projectId: project.id,
    nodeIds,
    edgeIds,
    openPocketIds,
    storageIds,
    storageModes,
    edgeEnds,
    powerEdgeIds,
    configSignature: signatureParts.join("\n"),
  };
}

/**
 * What the ear would consider "the plan changed", as one comparable string.
 * The gesture failure-check needs this instead of a reference compare: a
 * refused drawer spawn (storage endpoint conflict) COMMITS a rebuilt,
 * content-identical project - reference-new, nothing actually different -
 * and reading that as success silenced the exact failure it was.
 */
export function projectSoundFingerprint(project: FactoryProject): string {
  const snap = snapshotProject(project);
  return [
    [...snap.nodeIds].sort().join(","),
    [...snap.edgeIds].sort().join(","),
    [...snap.openPocketIds].sort().join(","),
    snap.configSignature,
  ].join("|");
}

function countMissing(from: Set<string>, inSet: Set<string>): number {
  let count = 0;
  for (const id of from) {
    if (!inSet.has(id)) {
      count += 1;
    }
  }
  return count;
}

/** At or past this many changed ids, one change is a bulk change. */
const BULK_THRESHOLD = 8;

/**
 * Which place voice a landing gets. When everything that landed is drawers,
 * the new wire's direction tells supply from catch: a wire OUT of the new
 * drawer is "who supplies this" answered (placeSource, stepping up), a wire
 * INTO it is a product getting banked (placeProduct, stepping down).
 * Machine cards and mixed paste-ins keep the plain flat thump.
 */
function placeKindFor(
  prev: ProjectSoundSnapshot,
  next: ProjectSoundSnapshot,
): "place" | "placeProduct" | "placeSource" {
  const newSolids: string[] = [];
  for (const id of next.nodeIds) {
    if (!prev.nodeIds.has(id)) {
      newSolids.push(id);
    }
  }
  if (newSolids.length === 0 || !newSolids.every((id) => next.storageIds.has(id))) {
    return "place";
  }
  for (const [id, ends] of next.edgeEnds) {
    if (prev.edgeEnds.has(id)) {
      continue;
    }
    if (newSolids.includes(ends.source)) {
      return "placeSource";
    }
    if (newSolids.includes(ends.target)) {
      return "placeProduct";
    }
  }
  return "place";
}

export function playProjectDiff(prev: ProjectSoundSnapshot, next: ProjectSoundSnapshot): void {
  const addedNodes = countMissing(next.nodeIds, prev.nodeIds);
  const removedNodes = countMissing(prev.nodeIds, next.nodeIds);
  const addedEdges = countMissing(next.edgeIds, prev.edgeIds);
  const removedEdges = countMissing(prev.edgeIds, next.edgeIds);

  const total = addedNodes + removedNodes + addedEdges + removedEdges;
  if (total >= BULK_THRESHOLD) {
    playBoardSound("sweep");
    return;
  }

  // Nothing structural moved: a board folded or unfolded, or a card's
  // settings changed (machine count, drain pill, config). One sound.
  if (total === 0) {
    if (countMissing(next.openPocketIds, prev.openPocketIds) > 0) {
      playBoardSound("open");
    } else if (countMissing(prev.openPocketIds, next.openPocketIds) > 0) {
      playBoardSound("close");
    } else if (next.configSignature !== prev.configSignature) {
      const modes = [...next.storageModes].filter(([id, mode]) => prev.storageModes.get(id) !== mode);
      if (modes.length === 1) {
        const sound = { overflow: "drawerOverflow", strict: "drawerStrict", ratio: "drawerRatio" } as const;
        playBoardSound(sound[modes[0][1]]);
      } else {
        playBoardSound(modes.length > 1 ? "sweep" : "adjust");
      }
    }
    return;
  }

  // ONE sound per transaction. A refactor adds and removes in the same
  // step, and playing place AND delete together came out twice as loud as
  // either action alone - which read as broken volume, not as two events.
  // Priority: what arrived beats what left, cards beat wires.
  // Except ELECTRICITY: a gesture that lands a power wire zaps, whatever
  // else came with it - the EU drag that spawns a drawer is still, to the
  // hand, "I connected power to something".
  let addedPowerEdge = false;
  for (const edgeId of next.powerEdgeIds) {
    if (!prev.edgeIds.has(edgeId)) {
      addedPowerEdge = true;
      break;
    }
  }
  // And its complement: a gesture that takes a power wire out (cutting it,
  // or deleting the EU drawer it fed) discharges instead of the ordinary
  // delete thud.
  let removedPowerEdge = false;
  for (const edgeId of prev.powerEdgeIds) {
    if (!next.edgeIds.has(edgeId)) {
      removedPowerEdge = true;
      break;
    }
  }
  if (addedPowerEdge) {
    playBoardSound("zap");
  } else if (removedPowerEdge) {
    playBoardSound("zapOff");
  } else if (addedNodes > 0) {
    playBoardSound(placeKindFor(prev, next));
  } else if (removedNodes > 0) {
    playBoardSound("delete");
  } else if (addedEdges > 0) {
    playBoardSound("connect");
  } else if (removedEdges > 0) {
    playBoardSound("unwire");
  }
}

/**
 * How long after a plan switch the board stays quiet. Loading machinery
 * rewrites the project in the moments after a switch; the player's own
 * first action after picking a tab comes later than this.
 */
const QUIET_AFTER_SWITCH_MS = 1200;

export function useBoardSoundEffects(): void {
  useEffect(() => {
    let snapshot = snapshotProject(useFactoryStore.getState().project);
    let quietUntil = 0;

    const unsubscribe = useFactoryStore.subscribe((state, prevState) => {
      if (state.project === prevState.project) {
        return;
      }
      const next = snapshotProject(state.project);
      const prev = snapshot;
      snapshot = next;
      // A different plan arriving is navigation, not an action - and the
      // writes that trail it (migrations, refreshes) are not one either.
      if (next.projectId !== prev.projectId) {
        quietUntil = performance.now() + QUIET_AFTER_SWITCH_MS;
        return;
      }
      if (performance.now() < quietUntil) {
        return;
      }
      playProjectDiff(prev, next);
    });

    // Warm the audio path on the first gesture so the first REAL sound
    // never plays into a cold output stream (Chrome parks the hardware
    // stream during silence and eats short notes while it wakes).
    const prime = () => primeBoardSounds();
    window.addEventListener("pointerdown", prime, { once: true, passive: true });

    return () => {
      unsubscribe();
      window.removeEventListener("pointerdown", prime);
    };
  }, []);
}
