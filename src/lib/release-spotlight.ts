import { compareVersions } from "@/lib/whats-new";

/**
 * The release NOTICE: the one thing that is allowed to arrive uninvited.
 *
 * It is what ANNOUNCES a release: a line per change, an icon and a TITLE
 * each, no sentences, read in about four seconds and closed.
 *
 * It is no longer the only way to hear about one. The version chip opens the
 * full changelog again and wears a dot for a release it has not been opened
 * for (Jack, 2026-09-09: players went looking for what's new and found
 * nothing to press). The two do different jobs and the difference is the
 * whole point of keeping both: the notice ARRIVES, once, and is spent; the
 * chip WAITS to be asked, and holds everything back to the beginning. A
 * release that does not earn a notice still gets an entry and a dot.
 *
 * ONE PER RELEASE, AND ONLY WHEN THE RELEASE EARNS IT. A version with no entry
 * in `RELEASE_SPOTLIGHTS` shows nothing at all - a bug-fix release should not
 * stop anybody's work. That choice is made per release, on purpose: the notice
 * is a favour the reader grants us and it stops being one the third time it
 * arrives to announce nothing.
 *
 * RULES FOR WRITING ONE:
 * - Titles, not sentences, and written the way a spec sheet is written:
 *   "Multiple recipes per machine", not "One machine, several recipes", and
 *   never "You can now run several recipes on one machine." Flat, technical,
 *   no voice. Jack, 2026-09-08: they should read scientific.
 * - Four words is long. "Faster performance" is a whole line.
 * - Eight lines is the ceiling, and the ceiling is not a target.
 * - Say what changed on THEIR board, never how it was built. No "solver", no
 *   "refactor", no version-control words. Same doctrine as changelog.ts.
 * - No em dashes.
 */
export type SpotlightIcon =
  | "modes"
  | "shared"
  | "checklist"
  | "menu"
  | "arrange"
  | "wires"
  | "size"
  | "speed"
  | "search"
  | "power"
  | "board"
  | "sparkle";

/** Which of the app's own colours the tile's icon wears. */
export type SpotlightTint = "cyan" | "gold" | "violet" | "blue" | "green" | "amber";

export interface SpotlightItem {
  icon: SpotlightIcon;
  /** A title. Not a sentence, and never punctuated as one. */
  title: string;
  tint?: SpotlightTint;
}

export interface ReleaseSpotlight {
  /** Must match a CHANGELOG entry, and must be a version that actually ships. */
  version: string;
  /**
   * The number as the notice PRINTS it, beside the app's name: "3.0".
   *
   * Written out rather than derived from `version` (Jack, 2026-09-08: "just
   * hard code three point o"). A release is called 3.0 out loud and 3.0.0 in
   * the code, and which figures get dropped is a naming decision per release,
   * not arithmetic. Falls back to the full version when absent.
   */
  release?: string;
  /** The poster's own headline. Short. */
  title: string;
  /**
   * One line under the headline. Usually left OFF: a notice whose lines are
   * already the whole story does not need a sentence introducing them, and
   * every attempt at one has read like marketing.
   */
  subtitle?: string;
  items: SpotlightItem[];
}

export const RELEASE_SPOTLIGHTS: ReleaseSpotlight[] = [
  {
    version: "3.2.0",
    release: "3.2.0",
    title: "Pool workspace and splitters",
    items: [
      { icon: "board", title: "Pool recipe table", tint: "blue" },
      { icon: "wires", title: "Ratio splitters", tint: "cyan" },
      { icon: "power", title: "Resource and power summaries", tint: "amber" },
      { icon: "menu", title: "Collapsible mobile summaries", tint: "violet" },
      { icon: "size", title: "Compact workspace controls", tint: "green" },
    ],
  },
  {
    version: "3.0.0",
    release: "3.0",
    title: "The biggest update yet",
    items: [
      { icon: "modes", title: "New modes: Build, Solve, Pool", tint: "gold" },
      { icon: "shared", title: "Multiple recipes per machine", tint: "blue" },
      { icon: "checklist", title: "Checklist mode", tint: "green" },
      { icon: "power", title: "Multiblock power improved", tint: "amber" },
      { icon: "arrange", title: "Auto arrange improved", tint: "cyan" },
      { icon: "wires", title: "Wire routing improved", tint: "cyan" },
      { icon: "size", title: "Bigger interface", tint: "violet" },
      { icon: "speed", title: "Faster performance", tint: "green" },
    ],
  },
];

/**
 * The dev menu's "Preview the release popup" asks for it by event, so nothing
 * outside the header has to own the poster's state. Detail: the version to
 * preview, or nothing for the newest one written.
 */
export const PREVIEW_RELEASE_SPOTLIGHT_EVENT = "gtnh-preview-release-spotlight";

/**
 * Which notices this browser has already been shown, kept apart from the
 * version stamp in whats-new.ts.
 *
 * They answer different questions. The stamp says which version this browser
 * last ran; this says which notices have actually been put in front of the
 * person using it.
 */
const SEEN_KEY = "gtnh-factory-flow.seen-spotlights.v1";

export function readSeenSpotlights(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function markSpotlightSeen(version: string): void {
  try {
    const seen = readSeenSpotlights();
    if (!seen.includes(version)) {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, version]));
    }
  } catch {
    // Blocked storage must never break the app. The cost is one repeated
    // notice, which is the harmless direction to fail in.
  }
}

/**
 * The poster to show right now, or nothing.
 *
 * Newest first among the ones that qualify, and only one ever shows: somebody
 * back after three releases gets the latest notice, not a stack of them.
 *
 * A FIRST VISIT gets nothing (`lastSeenVersion` absent). They have never seen
 * the old behaviour, so "what changed" is noise in front of the thing they came
 * for.
 */
export function pickSpotlight({
  lastSeenVersion,
  seen,
  appVersion,
  spotlights = RELEASE_SPOTLIGHTS,
}: {
  lastSeenVersion?: string;
  seen: readonly string[];
  appVersion: string;
  spotlights?: readonly ReleaseSpotlight[];
}): ReleaseSpotlight | undefined {
  if (!lastSeenVersion) {
    return undefined;
  }
  const candidates = spotlights.filter(
    (spotlight) =>
      !seen.includes(spotlight.version) &&
      compareVersions(spotlight.version, lastSeenVersion) > 0 &&
      compareVersions(spotlight.version, appVersion) <= 0,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.reduce((newest, spotlight) =>
    compareVersions(spotlight.version, newest.version) > 0 ? spotlight : newest,
  );
}
