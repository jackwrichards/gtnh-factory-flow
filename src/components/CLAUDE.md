# App UI (src/components)

The board has its own notes in `flow/CLAUDE.md`, the Pool worksheet in `pool/CLAUDE.md`.

## Interface scale: two pixel spaces

- `src/lib/ui-scale.ts` owns the size setting (60-200% of a default that is itself
  `UI_SCALE_BASE`, or `UI_SCALE_PHONE_BASE` on compact screens). A boot script in
  `layout.tsx` stamps `--ui-scale`, `data-compact` and `data-snug` before first paint.
- The app shell is CSS-`zoom`ed (`.ui-scale-shell`); the board UNZOOMS itself and carries
  the factor through its camera (`boardMaxZoom`, `boardZoomScale`). Never CSS-zoom the
  board: React Flow then measures cards and the pointer in two different spaces.
- Every measurement must know its space. REAL px: `clientX`, `getBoundingClientRect`,
  `window.innerWidth`, anything inside `.react-flow`, anything portaled to `document.body`.
  SHELL px: `offsetWidth`, `clientWidth`, `scrollLeft`, style lengths, ResizeObserver rects.
  The ratio is `getUiScale()`. Body portals keep real-px positioning and wear `.ui-zoom`.
- Viewport units are not divided by zoom: inside the shell use `--ui-vh` / `--ui-vw` /
  `--ui-dvh`, never bare `vh` / `vw`.
- The `compact:` / `snug:` Tailwind variants key on the html attributes, not media
  queries. `getUiScale()` is 1 where `matchMedia` is missing (server, jsdom).

## Compact mode (phones, small windows)

- `src/lib/compact-view.ts`: compact when the window is phone-sized in REAL px (under 900 wide or 560 tall;
  the Size setting can lower that, never raise it, so a bigger Size cannot turn a desktop window into a phone), or when
  the shell leaves under 800 x 440 shell px for the columns. A desktop window of 1280 x 720 or more is never compact at
  any Size (Large leaves 842 x 473). The boot script in `layout.tsx` repeats the rule (`ui-scale-boot.ts`); a test pins
  that the two agree. Ask the media query, never `window.innerWidth`, which mobile browsers widen when content overflows.
- Compact swaps the three columns for the board plus two drawers (`PanelDrawer`, their two keys join the top bar, which
  wraps its tabs above its keys), each toolbar for one folded button. Drawers track the finger by
  writing `translate`, not `transform`: Tailwind's translate utilities set `translate`, and
  a `transform` would compose with it and double the offset. Pair any min-height with
  `compact:min-h-0`.

## Recipe search (RecipeSearchOverlay.tsx)

- `RecipeBrowser.tsx` owns the query state. `browseResource` / `clearResourceBrowser` are
  the only doors in and out. A query is clauses (`recipe-query.ts`) plus ANY / ALL / ONLY
  per side; the server does the set algebra (`src/lib/server/CLAUDE.md`).
- It is NEI's recipe window in the panel's skin (`nei/nei-recipe.css`, NEI GTNH's GuiRecipe in website units): a tab
  per machine on the window's top edge (Generators first when any answer), paged by its own < > when they overflow; the
  machine's name and the page between NEI's arrows; the magnifier opens the name filter in the page row; the machines
  that run the open tab in a sunk column inside the window, left of the page (their tiers from `machineHandlerIcons`);
  back, forward, the rate reading and the tier ceiling along the foot; the stencil on its own card underneath. The
  window is at most 900 x 800 shell px, with room round it.
- One tab at a time, never stored: `RecipeBrowser` keeps the open tab per browse and asks the server for that map alone
  (`mapSelection` include); the first tab needs no query of its own, as the server lists recipes in tab order. Counts
  always cover everything that matched.
- A recipe is the card it becomes on the board, its machine left out (`nei/lookup-card.tsx` on the clean card's own
  classes): consumed inputs, kept ones (molds, lenses: dimmed, "not used up") and the power tile down the left, outputs
  down the right, the arrow where the machine's well would be, the plus, the time, the circuit badge and the tier chip in
  the head. A chanced output reads its average (1 at 25% is 0.25), the chance only in its tooltip. A page is as many
  cards as fit, counted by the tab's tallest card (`cardCellHeight`); rows size to their own cards. A page asks for more
  until it is full (`onLoadMore` only advances from a page that has landed, `landedRecipePageKeyRef`); the wheel over it
  and PageUp / PageDown turn it.
- A row's text is its amount then its name (units are `::after`), so a card's text runs its rows together (the tour finds
  recipes by it). A click asks what makes it, a right click what uses it, R and U over it the same, Shift+right click or
  a held press opens the menu (find, add to takes or makes, the row's other forms); pressed and moved it lifts onto the
  stencil.
- Back/forward stacks live in the store (`browseBack` / `browseForward`); Alt+arrows and
  a bare Backspace walk them.
- An add lands at `nearestFreeSpot` and the camera follows. An add started from a card's
  port wires only the clicked resource (`addConnectedRecipeNodeToState`). Refactor
  (`beginRecipeRefactor` -> `refactorNodeWithRecipe`) replaces the card in place,
  re-docking wires whose resource survives; if none would survive, it lands beside instead.
- The tier ceiling also filters generator cards by their `unlock` chip, client side
  (`powerUnlockWithinTier`); a source with no chip is never filtered.
- A machine pin (`recipeBrowserMachinePin`, a card's "Add another recipe") scopes the maps to one machine and adds the
  pick as a section of that card (`addRecipeToNode`). It sits on the stencil with its unpin key (`clearMachinePin`; the
  stencil's conditions stay); a browse inside the open search keeps it, closing drops it. With an empty stencil and no
  name typed nothing is asked: the machine is the one tab and the page asks for an item on Takes or Makes. Exam:
  `RecipeBrowser.pin.test.tsx`.
## Inspector and panels

- Right resource column 234 shell px, left items panel 256 (classic boards and the phone's drawers; fixed).
- A plan board's two side columns (the overview, the items list; swapped by Settings, Item browser) are resizable and
  give way to the board. A handle on each column's board-side edge (`PanelHandle`: drag, double-click for the default,
  arrow keys) sets its width, kept per device (`overviewWidth` 336 by default, 224 to 480; `itemsWidth` 256, 108 to 420,
  which is three item columns). Widths are shell px and the pointer is real px: divide by `getUiScale()`. The grid is
  written straight onto `main` (`usePanelFit`, from the pure `fitPanels` in `src/lib/workspace-columns.ts`), never through
  React per frame or per drag step (a drag writes only the dragged width and saves on release), and `BoardColumn` is
  memoised so a fold never rebuilds the board. The board keeps `BOARD_MIN_WIDTH` (the toolbar's one row with its labels)
  while a column can still give way: both shrink toward their least in proportion to what they have over it, then the
  items list folds to its strip, then the overview. The window's fold is derived state (`itemsAutoFolded`); the player's
  own folds (`leftPanelOpen`, the rail's `open`) are never written by it, so a column comes back as the window widens.
  A click on a strip, or a resource browsed (`requestPanelOpen`, `src/lib/panel-force.ts`), opens a window-folded column
  anyway and the other gives way. The overview's machine lines fit their text to the rail's measured width. Re-measure
  `BOARD_MIN_WIDTH` when a key is added to the board toolbar.
- The items column is NEI's list (`ResourceIndexPane`, `nei/nei.css`): page keys and n/m at the top, 32 px slots
  of art alone, a Minecraft tooltip at once (`nei/McTip`), R/U over a slot, filters and sort in one menu key. Its
  search field (`searchAt`) is a body portal at the bottom middle of the screen; on a phone, under Welcome or the
  library, and while the recipe search is open it sits at the column's foot instead. The server answers at most
  120 resources a query, so a taller page asks in pieces. Every `MinecraftTooltip` and title tooltip wears `.mc-tip`.
  Keep virtual-list row heights in sync with the CSS (`inspector/panel.css`).
- Resources show Raw or Net, switched in the first section header (Raw by default). In
  Solve, drawer rate rows hang under their resource like files in a folder
  (`BoundaryDrawers` in `inspector/flow-sections.ts`).
- The machine list is one row per CARD, never merged (`buildMachineList` in
  `src/lib/model/machine-list.ts`).
- Power display (EU/t or amps at a tier) and rate units are view dials read through
  `useRateDisplayUnits`; memoized rows subscribe to both themselves.

## Shared UI behaviour

- Dropdowns dismiss through `useDropdownDismiss`: the mouse fade counts from the nearest
  point the pointer has reached, so a panel that opens away from the pointer can be
  walked to. `fadeKeep` names the element a menu hangs from.
- Tooltips never keep themselves open: `pointer-events-none`, close as soon as the
  pointer leaves the control. Above-card tooltips anchor to their control when no card
  exists (the Pool worksheet).
- React's wheel handlers are passive: a control that adjusts on wheel needs a native
  non-passive listener to `preventDefault` the page scroll.
- Every control that changes a value on the wheel asks `wheelChangesValues()`
  (`device-settings.ts`) first and returns before `preventDefault` or `stopPropagation`, so with
  "Scroll changes values" off the wheel scrolls or zooms instead. A focused number input is
  let go of (`blur()`) on the wheel then. Lists that scroll and pages that turn are not values.
- Build heavy hover content lazily (pass a thunk).
- Rendered item textures keep the art in the middle half of the image; draw them at 2x
  the box.
- The font is a setting (`src/lib/app-font.ts`), Inter by default. The pixel font's hard
  text shadow and unsmoothed edges are `--pixel-text-shadow` / `--pixel-font-smoothing`,
  set only under it (globals.css); never hard-code them on a component.
- `DesignTabs` effects that grab refs must depend on `isHydrated`.
- Sounds are the in-game planner's own files played by its rules (`src/lib/sound/`, its
  `CLAUDE.md` has what plays where). Firefox flushes audio at the end of a task, so the
  player schedules from a task of its own there.
- The Welcome tab (`welcome/`, state in `src/lib/welcome/welcome-tab.ts`) keeps its
  backdrop paused while hidden.

## Live plans in the UI (live/, tasks/)

Everything here renders only with `isLiveConfigured()`; without it the app looks exactly as before. Store rules are
in `src/store/CLAUDE.md` (Live plans, Task boards).

- The mod's top bar (`chrome/ModBar.tsx`) holds the ACCOUNT's things only, in this order: the plan tabs and +, the live
  state as a dot and the faces of who else is here (`LivePresence`: one square per account, initials in their colour; a
  tip says Live, Connecting or Offline with edits waiting), Library, Share, the account key, feedback, settings, help.
  The account key (`chrome/AccountKey.tsx`) reads "Sign in" signed out (it opens `SignInPanel`, the form that used to
  hang in the Library) and is the account's face (initials in its colour) signed in, with a menu of the username and
  Sign out. The Library has no sign-in key, only a line "Signed in as X". The Share menu's first row is Share with
  people... (`PlanShareDialog`: people who edit this plan with you; greyed signed out, "Sign in to share"); the library
  rows say Publish to library... for a plan not posted yet (`chrome/library-rows.ts`, the dialog's title too). Never fold
  one into the other. Without live plans every row and label is as before. The + tab menu has New task board.
  `PlanIdentityDrawer`, `DesignTabs` and `BoardActions` keep their live keys but are not on the desktop board.
- What edits or views the board is the BOARD TOOLBAR (`chrome/BoardToolbar.tsx`): no band. Its keys float over the
  board's top edge (it sits inside the board's box, so the board fills the whole middle column and nothing is reserved;
  not while the Library or Welcome covers it). Left group: Non-recipe, undo, redo. Right group: Arrange, Fit, the rate
  unit, EU/t, Avg; same order and words as the game's (`chrome/bar-parts.tsx` has the key and the fit hook both bars
  share). Too narrow for one row, the right group drops to a second row, still right. The strip takes no presses
  (`pointer-events: none`), only the keys do. A task board shows its own header the same way (title and count as plain
  words left; Board / Chain and New task right; `TaskBoard` leaves room at its top). The Non-recipe picker opens below the
  keys (`header[data-board-toolbar]`). Arrange is its label's width, 90 only while it shows progress.
- The desktop top bar is one row and hides nothing in a menu (`useTopBarFit` in `bar-parts.tsx`, steps in the pure,
  tested `chrome/top-bar-fold.ts`, `data-fit` roomy / icons / tight). The tabs give way first (the strip scrolls; the open
  plan's tab and the + never go: the `.mt` min-width, and `ModTabs` scrolls the open tab back into view when the strip
  resizes). With under two full tabs and the + of room, Plans, Share and Sign in become icon keys like feedback, settings
  and help (tips lead with the name; `AccountKey` takes `pictures`); with under one tab and the + the gaps tighten and the
  live faces are two and a +N. Each step is judged by the tab strip's measured width, undone by the room the earlier dress
  would leave (what the step gave is measured when it is taken), and starts again from the widest dress when what the bar
  holds changes. A new key needs nothing here: the strip's width sees it.
- A phone's bar (compact) keeps its words and wraps its tabs above its keys; its give-way is `useBarFit` (bar px,
  `BAR_FIT_TOP`; the toolbar's `STRIP_FIT`): tight tightens the keys (Non-recipe shows its bolt alone, Arrange takes its
  label's width, the faces are two and a +N). The board toolbar's groups wrap their keys, so a narrow board never cuts one off.
- Share dialog: the owner is listed first; the owner adds people by name (search asks once typing pauses, 250 ms,
  and drops the answer to an older query) and removes them; someone it is shared with sees everyone and can leave.
  Plans are in the account from the moment they exist (`src/store/CLAUDE.md`), so it never waits on a save. Changes arrive
  through the live room too (`members`).
- The Library's Shared with me (a third shelf of `chrome/ModLibrary.tsx`, always there when signed in, "Nothing shared
  with you yet" when empty; a rail entry of the compact `LibraryPage`) lists plans others shared with you (from the
  account sync, refreshed at once by the live service's `shared` and `unshared` frames), each tile naming its owner,
  with everyone's faces; opening one makes or reuses this device's copy and it opens live (`lib/library/open-shared.ts`).
  Copies never show among My plans. The same frame shows the notice "<owner> shared <plan> with you" with an Open key
  (`LiveNotice`, above the board and the Library alike).
- Presence is `flow/LivePresenceLayer.tsx`, a layer of its own inside the viewport: others' pointers (arrow and name
  tag in their colour) and outlines round what they have selected, in the plan's coordinates, sized by
  `1 / --board-zoom` to stay one size on screen (each layer registers for the variable, `virtual/zoom-var.ts`, as the
  board no longer carries it). It reads `live-presence.ts` (outside every board store), so a
  pointer moving re-renders that layer only; this tab's pointer is a native listener feeding the session, which sends
  at most 10 a second.
- A task board is a plan of its own kind (`primaryView: "tasks"`): its tasks cover the board like the Library (the board
  stays mounted) and the overview's room too (no overview on a task board, the game's), a plan that is not one never
  shows tasks, and nothing switches between the two. + > New task board makes one. Its tab and Library tile wear a faint
  violet (#A78BFA at 9%) and the 7x8 checklist icon (`pixel-icons.tsx` `ChecklistIcon`, the game's runs); the tile says
  "N tasks" (`DesignStats.tasks`).
- `src/components/tasks/` is the game's ui/task drawn in its GUI pixels (8 px font, the views zoomed 2 / 1.17 like the top
  bar: `tasks.css`, `task-box.css`). The game's screenshots are the reference, side by side at GUI scale 2.
  - `TaskBoard`: four columns (Blocked, To do, Doing, Done) with a dot, count and + (makes a task there and opens it);
    cards with the column's colour down the left, the first screenshot on top, title, priority arrow (`task-look.tsx`),
    faces (the game's initials: one letter for one word), a dot a day in the column (amber 7, red 14, none in Done),
    things done of all and comments. A press carries a card past 6 GUI px (pointer events, so mouse, pen and probes
    behave alike); a dashed gap shows where it lands. Right-click: Open, Move to, Delete task.
  - `TaskBox`: the task in a box over the board (a body portal), laid out as Jira's issue view; below 400 GUI px the
    side column goes under the title. Things: machine (icon, its words, "On <plan>", a key that shows it on its plan),
    location (block, dimension, a Copy key for x y z), screenshot (thumbnail, big on a click), older words (click to
    rewrite); drag to reorder, right-click for more. The website adds no locations or screenshots: the hint says
    "Add machines from a card's menu." Waiting on's Add refuses a loop with "That task already waits on this one."
  - `TaskChainView`: the list (folds below 560 GUI px) and the map (pans, zooms by steps about the mouse, Fit), from
    `lib/tasks/task-chain.ts`.
  - `AddToTask`: the two menus of Add to a task (`openAddToTask`), opened from a right click on cards, a card's actions
    key and a right click on an overview machine line. `make-task.ts` makes the edit on the board and brings the plan
    back, then a notice (`showLiveNotice`) says "Added X to 'task'" with Open.
    A plan tab's Add plan as a task uses the same menus, naming a new task after the plan and including every entry
    from its machine list with rounded-up quantities and links back to the cards. The checklist is a snapshot.
    Whole-plan additions also record `task.sourcePlans`. Only these tasks show a Plan link and source name on their
    card and in their box, with a compact Plan link in Chain view. It opens the source plan; pressing it never opens
    or drags the task. Machine links alone never imply a full plan. A source plan's tab menu offers Update a task
    when linked whole-plan tasks exist. It refreshes that plan's machine rows in one undoable live edit: unchanged
    or smaller quantities for the same machine and tier keep their checkmarks; increases or machine/tier changes
    are unchecked. New machines are added and removed machines are taken off. Other plans, notes, task titles and
    status are kept. Add and Update share a solved-plan snapshot: both wait for current solve numbers and cancel if
    the source design changes. Refresh replaces that source's legacy task links with checklist rows, including
    local/account aliases, so progress counts each machine once.
    The live-enabled tour keeps the machine-task example, then shows Add plan as a task, its Plan link and Update
    a task, including the checkmark rule. Tour replay keeps boards present at the step's checkpoint and removes
    only later tour-created boards; plan tabs are found by the sandbox's id rather than a player's matching name.
  - A link opens the plan and centres the card (`lib/tasks/open-link.ts`) or says "That plan is gone". A card wears the
    dot of its most pressing task (blocked, then doing, to do, done; `lib/tasks/task-link-index.ts`, from the task
    boards on this device, counting machine things and older task links).
- Notices from the live plan (an edit refused, removed from a plan) show above the board (`LiveNotice`).
