# Domain model (src/lib/model)

Types, Zod schemas, resource keys, recipe rules, and the load funnel
(`project-normalize.ts`) every saved or imported plan passes through.

## Cells are items

- A filled cell is an ordinary ITEM; it never satisfies its fluid's slot or the reverse.
  `resourceMatchesInput` compares kinds strictly. Don't add a cross-kind branch.
- Crossing forms takes a machine, as in the game (thousands of Canner recipes). The
  pipeline also mirrors fluid Canner recipes into a free "Tank" map (0 EU, 1 tick, real
  slots including empty cells).
- No wire crosses forms: a cell and its fluid meet only in a fluid tank card
  (`fluid-tank.ts`), as in the mod. A cell port and a fluid port never take or glow for
  each other's wires.
- Older plans carry loose cell wires (`edge.crossForm`: the Canner's litres per cell).
  `convertLooseCellWires` (cell-wires.ts) makes each a tank card between its two ends where
  a plan lands: the funnel, `applyLiveOps`, a paste, Pool's bridges. Ids come from the wire,
  so two screens write the same tank. Parsers (`keepMode`) leave them for the landing,
  which says so (`planNotice`). Exam: `cell-wires.test.ts` (numbers recorded from the old
  hidden tank).
- Never auto-convert at a guessed 1000 L per cell: it hid a real machine, its empty cells
  and its power.
- `isFluidEquivalentToFilledCell` (name-tolerant) is shared by search and Pool's cell
  pairs. It converts nothing.
- `dropCrossFormConnections` compares KINDS only, never ids (slots legitimately carry ids
  the edge does not). It lets `crossForm` wires through for the conversion.

## Ore dictionary and concrete items

- Concrete items carry their oredict membership. Uses of a concrete item include exact
  recipes, compatible oredict recipes and alternatives that contain it.
- A recipe picked from a concrete item keeps that concrete item in its slots through
  creation, refresh and reload (Spruce Log never silently becomes Oak Log). Handles and
  matching use the effective rendered resource, overrides included.
- Unresolved oredict slots cycle their ART only; names stay "Any ...", and rates, wire
  colours, handles and solver identity stay fixed. Never store animation frames or invent a
  concrete source for an icon (`category-presentation.ts`).
- A slot never switches to its own recipe's product (`switchesSlotToOwnProduct`): a pick
  from "what makes X" leaves X out of the inputs, and the funnel lets go of saved ones
  and the wires that fed them.

## Shared machines (shared-machine.ts)

- One card can run several recipes on one machine. Section 0 is `recipeId`; sections
  1..n are `FactoryNode.extraRecipes`. Count, tier, power and knobs are shared; slots,
  wires and oredict picks are per section.
- Addressing: section handles wear an `r<n>:` prefix (`sectionHandleId` /
  `splitSectionHandleId`); a section's solve node is `card#r<n>` (`sectionNodeId`).
  Anything resolving "the recipe at this handle" reads the section (`sectionNodeView`),
  never `node.recipeId` alone.
- `removeRecipeSection` (a factory-store action) drops the section's wires and renumbers
  later ones; removing section 0 promotes the next. A card that owns its recipe never
  shares (`ownsItsRecipe`: generators, crop farms, custom rate, fluid tanks, the EEC).
  Exam: `shared-machine.test.ts`.

## Boards and lists

- `board-windows.ts` (`computeBoardLevelView`) decides what the canvas shows: the root plus
  every open board, recursively. `board-paper.ts` picks papers (`pickBoardPaper`,
  `paperForBoardId`). `flattenBoards` surfaces members where their frames stood.
- `machine-list.ts` (`buildMachineList`): one row per card. Build counts the card's
  `machineCount`; Solve / Pool sum its sections' required machines, fractions kept.

## The load funnel (project-normalize.ts)

`normalizeLoadedProject` snaps positions to the grid and migrates legacy shapes (trash
cans to trash drawers, stored setup rules dropped, unratioed cross-form wires and overrides
dropped, loose cell wires to tank cards). Unknown keys
are stripped by the Zod schema on import, paste and server paths, not here; IndexedDB
loads are not schema-parsed. Old plans must keep opening: add a migration rather than
breaking a schema.

## Cloud plan additions (schemas.ts)

- `gtnhplanner` on the project, nodes, storages, edges and annotations is the in-game
  planner's own data: opaque here, kept exactly as written through every edit, at most
  64 KB a thing. Never strip it or rebuild these things field by field.
- `primaryView` ("plan" or "tasks") and the task board: `tasks`, `taskItems` (checklist
  lines, their own things so two people can tick two at once) and `taskComments`, bounded
  by `PLAN_TASK_LIMITS`. Live editing treats each as a collection (`src/lib/live/ops.ts`).
- Exam: `plan-additions.test.ts` (schema, export and import, plan links) and the library
  PUT's `route.test.ts`.
