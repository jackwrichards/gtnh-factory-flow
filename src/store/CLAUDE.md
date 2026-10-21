# Stores, designs and plans (src/store)

`factory-store.ts` owns the project graph, solve results, selection and undo.
`design-store.ts` owns the design library (IndexedDB) and tabs. Related code:
`src/lib/designs/`, `src/lib/library/`, `src/lib/import-export/`, `src/lib/community/`.

The plan of record is IndexedDB; localStorage `project.v2` is only a one-shot seed.
Load migrations are not Zod-guarded: open each design under its own guard and never make
an unreadable design active.

## Two tabs share one library

Every save goes through `persistCanvas` in design-store.ts:
- A tab remembers the stored version its canvas came from (`canvasBase`). A save lands
  only if storage still holds that version, checked and written in one IndexedDB
  transaction (`writeDesignIfUnchanged`).
- A tab writes only what it was edited into (`isEditingInThisTab`): a background tab
  changes its plan by itself (recipe refresh) and must never echo that back. Changes
  made while a plan is being put up (`showProject`) never count.
- A stale tab holding its own edits saves them as "<name> (conflict copy)" and says so
  (`TabConflictNotice`). Nothing is lost either way.
- Saves are queued (`persistQueue`) so one tab never conflicts with itself, and
  `writeDesignSummary` keeps the stored plan stamps (`keepStoredPlanMarks`). Copy names
  come from `conflictCopyName` (counted, never stacked, clipped to 80 characters).
- Tabs announce saves over a BroadcastChannel (`design-tab-sync.ts`); a visible tab with
  no edits reloads at once, a hidden one checks when it comes back into view.
- Exam: the "two browser tabs" block of `design-store.test.ts`.

## Plans arriving and leaving

- Arriving plans create a NEW design, except exact content matches from codes and `#p=`
  links, which reopen a saved design. File imports and community copies remain new designs.
  Nothing calls `setProject` over the open design.
- Every plan write computes versioned simple/full fingerprints. Simple identifies
  the graph and recipes; full adds authored configuration, counts and layout.
  Names, personal views and presentation data do not identify content. Fingerprint
  changes bump `FINGERPRINT_VERSION` and trigger a resumable background backfill.
  Migration never changes plan bodies/stamps or overwrites newer live fingerprints.
- Summary matches are candidates: validate the actual record before exact reopening.
  A simple-only match opens separately and offers an explicit update or Keep separate.
  Updates preserve identity and metadata, keep a closed backup, and save fresh statistics.
  Edits, navigation, deletion, metadata changes and live ownership must be guarded
  through verification, replacement and cleanup. Keep incoming copies with newer work.
- Account replacements commit their live delivery intent atomically with the plan.
  Live snapshots and account sync must never undo that intent; retries are idempotent.
- Implementation and failure handling: [plan import reference](../../docs/plan-imports.md).
  Tests: `open-plan-code.test.ts`, `import-fingerprint.test.ts`,
  `fingerprint-migration.test.ts`, `design-store.test.ts`, `live-session.test.ts`.
- The Share menu has the mod's rows in its words: Copy plan link (`<origin>/#p=gtnh1.<deflate-raw
  base64url JSON>`, `plan-code.ts`), Copy plan code (the code alone), Export plan file, Open in
  the mod. The arrival code is captured at module load (`src/lib/open-plan-code.ts`) because
  the address is rewritten later. The mod writes the same codes (its `FfPlanCode.encode`) and
  opens the site at `#p=` from its own Share menu.
- Open in the mod (`src/lib/mod-link/`, `components/chrome/share-actions.ts`) POSTs the code to
  the running game on 127.0.0.1:25640-25649 (the mod's `client/WebsiteListener`, which answers
  this site's origins only and asks the player before opening anything). Probed as the menu
  opens, except where the browser would ask the player first (Local Network Access); any
  failure copies the code for the mod's + tab instead.
- Plans are slimmed by dropping GregTech `runtimeCalculation` tables
  (`withoutRuntimeTables`), but only for recipes this page has seen the dataset carry
  (`isRestorableRecipe`); the landing refresh re-fetches bare recipes (`recipesToRefresh`).
  Account sync pushes the same slim plan.
- Import/export preserves resource identity (`fluid.*` in the UI means fluid metadata was
  not resolved), recipe overrides, chosen handlers, tier/config and concrete oredict picks.
- Recipe ids are not stable across exports: import keeps an id the dataset still has and
  re-finds a missing one by CONTENT (`resolve-recipes`, then a name search scored by
  content). Never accept a name match alone.

## Library posts are copies

- A post is like an uploaded file. Someone else's post opens as a NEW design with no link
  to it (`openCommunityPost`, `untagCommunityPlan`); there is no view-only mode. Your own
  post opens as your design, linked (`metadata.communityPlanId`).
- Nothing syncs a design to its post. Share's Save to library posts it, Update in library
  pushes the plan as it is now (votes kept), Save as new post makes another
  (`SharePlanDialog` `mode`, `chrome/library-rows.ts`, the same rows as the mod).
- The old view-only session (`design-store.publicView`, `PublicViewBar`, `isReadOnly`) is no
  longer entered by any path.

## Account sync (src/lib/library/library-sync.ts)

- The Supabase instance is small. Pushes wait for 5 s of quiet (30 s max while editing,
  at once when the tab hides). Only a LOCAL change schedules a push, judged by
  `libraryChangeSignature`, never by array identity; a run never schedules the next one.
- A design the server refused is not resent until its stamp moves. Names are clipped to
  80 characters. Hidden tabs skip the poll. Visible tabs poll every 2 min (up to 16 min
  after failed runs); focusing a tab syncs at most once in 30 s.

## Recipe browser state

`browseResource`, `browseBack` / `browseForward`, `recipeBrowserMachinePin`,
`beginRecipeRefactor` live in factory-store; the rules are in `src/components/CLAUDE.md`.

## One mode

There is one board mode, plan mode. Every plan lands through the store (`markHydratedProject`,
`loadViewedProject`, `setProject`), and `normalizeLoadedProject` ends in `openAsPlan`
(`src/lib/solver/plan/to-plan.ts`): Build and Solve plans by `convertBuildToPlan`, Pool plans wired per resource first
(`pool-to-plan.ts`, with a `planNotice` for the player). The parsers (JSON, plan links, community posts) keep the saved
mode on purpose, so the one conversion at landing can also say what it lost. A load never writes: storage keeps the old
shape until the player's first edit saves the converted plan (both `planMode` and `solveMode` are written, so older
builds open it as Solve). Tests of the old Build/Solve/Pool code call `allowLegacyModesForTests()`.
Server stats convert the same way (`normalizeLoadedProject` in the community routes).
## Live plans (live-session.ts)

All of it is off unless `NEXT_PUBLIC_LIVE_URL` is set (`isLiveConfigured`, read by its literal name so Next.js
inlines it) and someone is signed in: no socket, no Share, no Shared with me, no task board, no presence. Merging it
changes nothing until then. Architecture and protocol: `docs/live.md`.

- Which designs are live: the one on the canvas, when it is ours and the account has it (`remoteUpdatedAt`; its doc
  is `<my id>:<design id>`, my id from the service's `welcome`, cached per username for offline starts) or a copy of
  a plan shared with us (`DesignSummary.cloud`, local id `shared-<owner>-<design>`). A new design goes live once the
  account sync has pushed it, and its snapshot undo history ends there.
- THE FUNNEL. Every project change not made `quietly` (`live-edit-gate.ts`) is a person's edit: the plan before and
  after are shaped (`src/lib/live/live-shape.ts`) and diffed into a batch in the client engine (confirmed +
  pending). Shaping leaves out what is not a person's doing: `metadata` (stamps, the owner's post link), `name` (the
  account row's), `view` (each person's dressing), `poolCellRatios` (fetched) and GregTech `runtimeCalculation`
  tables. Landing a plan, the recipe refresh, fetched data, a community link and applied remote ops are quiet. A
  new store action that writes derived data into the project must be quiet too, or every client sends it. The recipe
  refresh re-keys a game card's recipe (`gtnhplanner:<card>`) to the dataset's on this screen only, so an edit
  naming a recipe the shared plan lacks carries a put of it (`withRecipesTheyName`). A copy or paste drops
  `gtnhplanner` (the game's data is the original's: its placed machines, its own settings).
- ARRIVING. Someone else's batch, a refusal, a fresh snapshot, an undo: the engine's view before and after is diffed
  and only that lands, through `applyLiveOps` (same objects for untouched things, re-solved like any edit). It is the
  same design changing, never an arriving plan: the import rules above are untouched
  (opening a shared plan the first time is the arrival, `openSharedDesign`).
- ONE MODE. A live plan lands through `applyLiveOps`, not the loading funnel, so that action converts a plan not in
  plan mode yet (an older build's, or the game's, which writes Solve plans) as every landing plan is
  (`normalizeLoadedProjectWithNotice`) and hands the before and after back; the session sends the conversion as an
  edit undo never takes back (`localOps(..., { undoable: false })`). The load-never-writes rule does not hold here:
  a conversion kept on one screen would read everyone else's edits against a different plan. A plan already in plan
  mode converts only its loose cell wires (to tank cards, `convertCellWiresWithNotice`), never the whole funnel, which
  would move the game's own things.
- UNDO on a live plan applies the recorded inverses of this person's own edits (`LiveClientState.undo`), sent as a
  new batch. `withProjectHistory` keeps no snapshots while a live handler is set, and entering or leaving live empties
  the snapshot history: a snapshot restored over a live plan would wipe everyone else's edits. Undo buttons and their
  sounds read `liveUndo` when it is set. Writes outside the store's actions follow the same rule (the overview's
  leftover splits, `rail-actions.ts`: no snapshot while live, and a split in hand is quiet until it is let go).
- OFFLINE. Edits wait in pending, kept in IndexedDB (`live-pending-store.ts`, its own database) per plan and tab, and
  go when the connection is back (backoff, `online`, the tab coming back); a closed tab's leftovers are adopted by the
  next tab to open that plan (Web Locks tell which tabs are gone). Batches are paced under the service's rate and
  split under its size limit.
- TABS: each tab joins for itself (one account may be in a room more than once). No tab depends on another staying
  open, and each has its own pending edits and undo; the cost is a socket per tab (the service allows 16 an
  account). Presence from your own account (another tab, the game) is not drawn.
- THE LOCAL COPY. A design open live is the service's plan; its record here is this device's copy, for opening
  offline. Autosave writes it unguarded (`persistLiveCopy`: no version check, no conflict copy, sync stamps kept),
  and the tab sync never reloads it from storage.
- IN THE ACCOUNT FROM THE START. Signed in with live configured, a design that appears (new, task board, import, paste,
  link, library copy) is created in the account at once (`library-sync.ts`: a new unsynced design runs a sync with no
  quiet period, `markDesignFresh`), and it joins its live room as soon as the row exists. A plan made moments ago takes the
  canvas over the account's first snapshot once (`Room.fresh`/`seed`): the account read the saved record, which can be
  behind the canvas; nothing else ever lets the canvas overrule a snapshot. No timer pushes a plan open live.
- SHARING NOTICES. The service's `shared` frame (to every socket of an added account, in the room or not) shows the notice
  with Open and refreshes the account list; `unshared` refreshes it (the sync drops copies no longer listed). Each plan is
  announced once a session (the service may repeat one); an `unshared` lets the next share be announced.
- ACCOUNT SYNC never sends the body of a plan open live, here or in another tab (`isDesignOpenLive`, a localStorage
  mark refreshed while open), and a pull of one moves only its metadata. A push answered 409 `{ live: true }` goes
  again without the plan: not an error, not a conflict copy. Copies of shared plans are never pushed as ours; the
  account lists them under `shared` (`cloud-library.ts`), and a copy no longer listed is removed.
- Removed from a plan, or the plan deleted: the copy goes and a notice says so (`useLiveSession.notice`).
- Tests: `live-session.test.ts` (a fake service speaking the protocol with the real engine),
  `src/lib/library/library-sync-live.test.ts`. In the real app: `scratch/probes/live-*.mjs` on `npm run dev:local`
  (development builds expose the stores as `window.__gtnhLive`, with `drop()` to cut the socket).

## Task boards (src/lib/tasks)

- Tasks, checklist lines and comments are things of their own (`tasks`, `taskItems`, `taskComments`), so two
  people ticking two lines or moving two cards never write the same field. Order is a fractional key
  (`order-key.ts`): a move writes one key between its new neighbours, nothing else.
- Every task edit goes through `editTasks` with a pure edit from `task-board.ts`: one undo step and one live batch.
  Tasks never feed the solve.
- A comment's `by`, `byName` and `at` are the live service's to write on a live plan; on a plan of this device
  alone they are yours (`local` / "You" when signed out). A closed design with tasks is never thrown away as blank.
- A task board is a design whose plan has `primaryView: "tasks"` (copied to `DesignSummary.taskBoard`); it always shows its
  tasks and no other plan does. The open task's box, New task and each board's view (Board or Chain, remembered per board
  in this browser) are `task-board-ui.ts`. Thing and task links are `{ plan, node }` (`task-links.ts`); the older
  same-plan `nodeIds`/`nodeId` read as links to the plan holding the task.
- The game is the reference (its `TaskEdits`, `TaskChain`, `Tasks`): columns run Blocked, To do, Doing, Done; a move
  to another column stamps `movedAt`; Medium is written as no `priority`; `addBlocker` refuses itself, a repeat and a
  loop down the chain, and deleting a task takes its id out of every `blockedBy`; `removeThing` takes an older task's
  link to the same card with it; an older task's links that no thing names count as things not done (`looseLinks`,
  `taskProgress`). `task-chain.ts` lays the chain view out exactly as the game's TaskChain (its test is the game's).
- Add to a task (`make-task.ts`) edits the board itself (opened, edited through `editTasks`, then the plan comes back once
  the live service has the batch), so a live board sends it as anyone's edit; never write a board's stored record
  behind its live room.
