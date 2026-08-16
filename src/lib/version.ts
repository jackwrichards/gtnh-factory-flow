/**
 * The user-facing app version, shown as a chip in the header.
 *
 * ONE bump per RELEASE, where a release is a deploy to the live site - never
 * one per commit. Ten commits between deploys still ship as a single version,
 * with a single changelog entry covering the lot: minor for a release carrying
 * features (1.1.0), patch for one that is only fixes (1.0.1). Started at 1.0.0
 * the day the equilibrium solver shipped (2026-08-02).
 *
 * So: check `https://gtnhplanner.com/api/version` first. If it is BEHIND this
 * number, the release is still waiting to ship - fold the new work into the
 * entry already at the top and leave the number alone. If it MATCHES,
 * everything here is live and the next change starts a new release.
 *
 * The chip opens the changelog, so every bump needs an entry in
 * `src/lib/changelog.ts` written for players, not for developers, and kept to
 * a headline plus a few one-line notes.
 */
export const APP_VERSION = "2.15.0";
