# Plan import recognition

Implementation reference for plan codes, links, saved fingerprints and explicit updates.
Core invariants are in [the store instructions](../src/store/CLAUDE.md).

## Exact reopening

Summary hashes select candidates only. `switchToDesign(id, expectedFull)` flushes
pending canvas edits and calls `readDesign(id, expectedFull)`. That read checks the
current fingerprint version, full hash and ownership in the same transaction as the
plan read and closed-tab reopening. The validated body itself lands; no later
unchecked read chooses another body. An already-active match retains its undo
history and view only when its canvas base still matches the validated stored version.
A newer stored version lands together with its base, so later edits cannot save a
stale canvas over it. A mismatch or deletion imports the incoming content separately,
using refreshed summaries for related-version choices.

## Fingerprints and migration

- `planFingerprints` hashes one normalized representation on every plan write (including
  account pulls), in `design-storage.ts`. Simple identifies cards, recipe content and wires;
  full adds authored counts, settings, targets, layout and notes. Root ids, names, stamps,
  personal views, recipe display data and runtime tables do not affect the hashes. Recipe
  references use content so dataset id migrations do not change identity. Summaries carry
  `fingerprints: { version, simple, full }`; metadata-only writes retain the stored hashes.
  Functional recipe metadata (fusion startup energy, EEC parameters, bee lifespan and
  CropsNH traits) participates even on GregTech/legacy recipes. Fingerprint changes bump
  `FINGERPRINT_VERSION`; the migration marker follows that version so old hashes rebuild.
  Functional recipe maps, tiers, profiles, handlers, controls and power settings enter the full
  hash only, so configuration changes remain related versions. Their labels and notes
  stay out. Full node references include those settings so swapping two recipes' settings
  cannot masquerade as the same plan.
  Effective heat/special requirements use the solver's `getRecipeSpecialValue`, including
  its NEI fallback. Input overrides keep resource choices, amounts and flags but drop
  presentation fields, including alternatives' labels and icons. Version 6 backfills both.
- `fingerprint-migration.ts` backfills old records once in the background. The versioned
  localStorage marker records completion/skipped unreadable records; completed records
  make interruptions resumable. Each write checks the plan stamp and originally read
  fingerprints atomically, and never replaces current/newer hashes. Live copies can
  change content without moving the plan stamp. No plan body
  or edit stamp changes. Imports await the migration, then compare stored summary hashes.

## Replacement, cleanup and live delivery

- Full match: open the saved plan. Simple-only match: import separately and offer Keep
  separate or Update saved plan, choosing among matches. Explicit update keeps the saved
  design identity/folder and stores its old contents in a closed "before update" backup.
  The replacement itself is reopened and gets fresh statistics from `solveFreshBooks`,
  awaiting a dedicated worker's result for its exact snapshot. The canvas solver's APIs
  can return stale placeholders even for manual recalculation; never persist those as
  replacement statistics. Solver errors leave the target and incoming version intact.
  Monotonic canvas/navigation revisions, pending switches and the active design guard
  every await before handover, including the first flush. The same guard is captured
  at the update click, before the import queue, incoming read or hash, and passed into
  replacement; verification must never establish a later baseline. An in-flight tab read counts
  as navigation even before the canvas changes. Edits,
  including edits already autosaved, or a tab switch cancel the handover and incoming
  cleanup. If an edit arrives during the atomic write, retain its canvas; the normal
  conflict-save path preserves it against the replacement now in storage.
  The target full hash and atomic save guard must still match. Live/shared plans cannot
  be replaced with a snapshot. The temporary incoming design is removed after success.
  Replacements use `replaceDesignIfUnchanged`: both plan and metadata stamps must match,
  and both stored summary and plan must exist in the same transaction as the write.
  Metadata-only edits cancel replacement; deletion never recreates the target. Ordinary
  autosaves retain `writeDesignIfUnchanged` and its create-if-missing semantics.
  Live status is checked after the solve and again at the actual IndexedDB replacement
  write, after fingerprinting. Joining live need not move either guarded timestamp.
  Incoming cleanup uses `cleanupImportedDesign`, never the normal delete-and-navigate
  action. It keeps active, opening, edited or live plans. Navigation intent is recorded
  before a tab's first read; cleanup rechecks its canvas/navigation revisions and stored
  metadata inside the deletion transaction. A live target also keeps the incoming copy.
  An account-owned target's explicit replacement commits a `liveReplacement` outbox
  in its plan-store record in the same transaction as the replacement. It is never a
  fresh-plan seed. Normal saves retain that outbox; account pulls cannot replace its
  body, and account pushes send only metadata while delivery is pending, even if the
  plan is closed. Joining adopts its fixed batch ids even when the separate live pending database
  cannot be written. Only a server acknowledgement or explicit refusal settles a batch;
  a crash before clearing it safely resends the same id. Joining waits for adoption before
  requesting the first snapshot, so an old account snapshot rebases those edits rather
  than undoing the replacement. Existing unsent target edits require opening it first.
  Account downloads use the same atomic guard; a download begun before a replacement
  or live join cannot restore its old plan. Account agreement stamps are guarded too.
  Web Locks and a promise queue serialize imports. Tests: `open-plan-code.test.ts`,
  `import-fingerprint.test.ts`, `fingerprint-migration.test.ts`, `design-store.test.ts`.
