"use client";

import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

/** Release notes are opt-in through the version chip; unread notes get a dot.
 * Tabs running an older bundle can still offer a reload through useDeployedVersion.
 * The legacy last-seen stamp remains readable for compatibility but opens no UI. */
const LAST_SEEN_KEY = "gtnh-factory-flow.last-seen-version.v1";

/**
 * The version this browser last ran, or nothing if it has never been here.
 * A first visit gets no release notice, which is what the absence means.
 */
export function readLastSeenVersion(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function markVersionSeen(version = APP_VERSION): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // A blocked or full quota must never break the app. The cost is one
    // repeated notice, which is the harmless direction to fail in.
  }
}

/** Newest-first compare of two `1.2.3` strings. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/* ---------------------------------------------------------------------- */
/* The notes, and whether this reader has opened them.                     */
/* ---------------------------------------------------------------------- */

/**
 * The newest release whose NOTES this browser has actually opened.
 *
 * A separate stamp from `LAST_SEEN_KEY` on purpose. That one answers "has
 * this browser run this version", and the release notice writes it on every
 * load - so if the dot read it, the dot could never light: the load that
 * would have raised it has already stamped it away. This one is written by
 * one gesture only, opening the notes, which is the only thing that means
 * they were read.
 */
const NOTES_READ_KEY = "gtnh-factory-flow.changelog-read.v1";

function readNotesRead(): string | undefined {
  try {
    return window.localStorage.getItem(NOTES_READ_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeNotesRead(version: string): void {
  try {
    window.localStorage.setItem(NOTES_READ_KEY, version);
  } catch {
    // A blocked or full quota must never break the app. The cost is a dot
    // that comes back, which is the harmless direction to fail in.
  }
}

/**
 * What has shipped since this browser last opened the notes, newest first.
 *
 * Empty on a FIRST visit, deliberately. Somebody arriving for the first time
 * has no idea what any of it used to do, so a list of changes is noise in
 * front of the thing they came to see: the stamp is written silently instead
 * and they hear about the next release like everyone else.
 */
export function unseenEntries(): ChangelogEntry[] {
  const read = readNotesRead();
  if (!read) {
    writeNotesRead(APP_VERSION);
    return [];
  }
  if (compareVersions(read, APP_VERSION) >= 0) {
    return [];
  }
  return CHANGELOG.filter(
    (entry) =>
      compareVersions(entry.version, read) > 0 &&
      compareVersions(entry.version, APP_VERSION) <= 0,
  );
}

/**
 * The stamp is browser-wide, so the chip and anything else reading it have to
 * agree within the same page. Nothing here is worth a store; it is one string
 * and two readers.
 */
const listeners = new Set<() => void>();

export function subscribeToNotesRead(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opening the notes IS reading them. */
export function markNotesReadAndNotify(version = APP_VERSION): void {
  writeNotesRead(version);
  for (const listener of [...listeners]) {
    listener();
  }
}
