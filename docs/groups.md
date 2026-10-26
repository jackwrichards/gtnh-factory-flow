# Groups (the website's boards and pockets, back in both planners)

Written 2026-10-14 (G1). One file, copied verbatim in both repos (mod `docs/design/groups.md`, website `docs/groups.md`); change both together.

A group is a named, coloured frame round part of a plan: select some things, make them a group, move them as one,
collapse the group down to a summary card and open it again. It is the website's old "board" (its type still says
`pocket`), restyled in the clean card's look. Groups take no part in the solve: the graph the solver sees is flat.

## The model

The website keeps its `FactoryPocket` (`src/lib/model/types.ts`) exactly as it was, so every plan with boards loads
untouched: members carry `pocketId`, boards nest through `parentPocketId`, `expanded` is open, `size` is the frame,
`position` its top-left corner, `theme` and `pattern` its old paper (kept, no longer drawn).

The mod's `data/flowchart/BoardGroup` (in `Graph.boardGroups`, saved with the plan under `boardGroups`) holds the same:

| Mod (`BoardGroup`) | Plan JSON (`pockets[]`) | Notes |
| --- | --- | --- |
| `id` (UUID), `ffId` | `id` | `ffId` keeps the website's id (`pocket-...`) so a plan goes back out under the same ids; a group made in the mod writes `pocket-<uuid>` |
| `name` | `name` | a new group is "Group N" (N = groups on the plan + 1) |
| `color` | `colorTag` | one of the 22 colour tags (`NoteColors` / `GT_NODE_COLORS`); null = see Colours |
| `parent` | `parentPocketId` | nesting; null = the board itself |
| `x`, `y`, `width`, `height` | `position`, `size` | the frame. The mod keeps absolute board px; the JSON's are relative to the parent's frame, in the same px (one to one since 2026-10-15) |
| `collapsed` | `expanded` (negated) | collapsed shows the summary card at the frame's corner; absent `expanded` = collapsed, as before |
| `theme`, `pattern` | `theme`, `pattern` | kept for the round trip, never drawn |
| member's `group` (on `Node`, `Drawer`, `Note`) | member's `pocketId` | on `nodes[]`, `storages[]`, `annotations[]`; member positions in the JSON are relative to the group's frame corner |

Rules both planners keep:

- **One group each.** A card, drawer, note or group is in at most one group. Every recipe of a shared machine is in
  the shared card's group.
- **The frame holds its members.** After every edit a group's frame grows to hold its members' boxes plus 10 px of
  padding and its 20 px title strip, to the pixel (the mod's `BoardGroup.PAD`, the website's `group-model.ts`
  `FRAME`, so an edit on either side leaves the same frame); a new group's corner sits on the 10 px grid. It never
  shrinks by itself, resizing stops at that box, and opening a collapsed group leaves its members where they were.
  (The website keeps member positions frame-relative, so it shifts the members when the frame grows up or left; the
  mod keeps absolute positions and moves the frame's corner. Same picture.)
- **Legacy pockets** (no `size`: members in a space of their own): on open (website) or import (mod) the members are
  moved so their box sits a cell inside the frame under its title strip, at `position`, and the frame is sized to fit.
  Written back, they carry a `size` and frame-relative positions, as the website writes any board it has opened.
- Nested groups are drawn and kept (a collapsed group hides the groups inside it too). Grouping never nests by accident:
  see Making a group.
- Unknown pocket fields are kept on the website; the mod keeps the fields above.

## Colours

The group colour is the `colorTag`'s swatch. A pocket without one takes its paper's colour:

| theme | slate | blueprint | chalkboard | graphite | gunmetal | midnight | charcoal | void | parchment | paper |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tag | steel | azure | green | brown | light_gray | blue | onyx | black | amber | white |

and one without a theme takes the paper its id gives it (`paperForBoardId`: Java's `String.hashCode` of the id, the
same sum, `abs(hash) % 8` into `slate, blueprint, chalkboard, graphite, gunmetal, midnight, charcoal, void`), then
the table. A new group takes the first of `light_blue, lime, orange, magenta, yellow, cyan, pink, purple, scarlet,
emerald, azure, amber` that no group on the plan wears (the first again when all are worn). The Colour menu offers the
sticky note's eleven.

## The look (the clean card's: flat, square, 1 px chrome, Monocraft)

Sizes in board px, the website's and the mod's one to one since 2026-10-15 (the website's `group-model.ts` `GROUP`). `C` is the group colour (`mix(a, b, t)` is `t` of `a`, as `Hyb.mix`),
`mix(a, b, t)` the float32 mix (`Hyb.mix` / `mixHex`).

- **Open group.** The body is `C` at alpha `0x14` (8%) over the board; a 1 px border `mix(canvas, C, 0.6)`, the
  selection cyan when selected. Along the top inside it, a **title strip** 20 px tall, filled
  `mix(C, surface #23252A, 0.3)`, with a 1 px rule under it in `mix(canvas, C, 0.6)`. In the strip, 6 px in: the name
  in ink (`#E8E9EE`), then, muted (`#9A9CA4`), `N machines` (left out at 0). At its right end, 3 px in, the
  **collapse key**: a 14 px square key (the card's key tokens: face `#26282D`, hover `#2D2F35`, 1 px edge `#111317`)
  showing a minus. Wires and cards draw over the body; the strip draws under cards.
- **Collapsed group (the summary card).** 320 wide (a card's width) at the frame's corner. Face `#23252A`, 1 px
  border `mix(canvas, C, 0.6)` (selection cyan when selected). The same title strip on top with a plus on the key.
  Under it a 14 px line, muted: `N machines` and, when any, the EU/t (`1.2k EU/t`), 6 px in. Then the rows, 20 px
  each: what goes in on the left half (16 px icon 6 px in, the rate after it in ink), what comes out on the right
  half (icon at the half plus 6, rate after it), as many rows as the longer list, 4 px padding under the last. With
  neither: one row, muted, `Nothing goes in or out.`
- **Rates** read as the overview's do (the board's unit, /s or /t, the same number format).
- **Wires to a collapsed group** dock on the summary card, routed to its edge as a wire to a card is (anywhere on
  the box's edge, the router's choice): a wire between a member and something outside runs to the summary instead.
  Wires with both ends inside are not drawn. Drawers outside linked to ports inside count as wires; one wire per
  member port, so two members fed from one card show two wires.
- **Minimap**: an open group is its frame, `C` at 25% with a 1 px border in `C`; a collapsed one is the summary card's
  box in `mix(C, surface, 0.3)`.

## What the summary says (solved flows)

From the plan-wide solve, never a solve of the group alone. Over the members (nested groups included):

- **Machines**: every machine card's build count (its solved count rounded up; a pinned count as pinned), shared
  machines once. Drawers, notes and planning cards (custom rate, fluid tank) are not machines.
- **EU/t**: the members' power as the overview counts it (what they draw at their solved speed).
- **In and out**: per resource, the members' solved consumption minus their solved production (count times
  per-machine rate, the card's own numbers). More consumed is an input (that net rate), more made an output. Busiest
  first. The old summary counted every machine at its full rate; that is gone.

## Making and changing a group

| Do | What happens |
| --- | --- |
| Select (marquee or Shift-click), then the **Group** key in the selection bar (beside "Combine N into one machine") or **Ctrl+G** (Ctrl+G works on one thing too) | A group round the selection where it stands (nothing moves): frame = the members' box plus a cell, the title strip above. The selection becomes the group. Sound: `board.merge`. |
| Click the title strip's name, or Rename in its menu | Rename in place (Enter sets, Escape cancels; empty keeps the old name). |
| Drag the title strip (or the summary card) | Moves the group and everything in it, nested groups included. Drops follow the board's rules (a 3 px slop, the grid, never onto a card). A carried group keeps its parent. |
| Drag a frame's edge or corner (4 px either side of the border) | Resizes it; it never cuts a member off. |
| The collapse key; double-click the summary card; Collapse / Expand in its menu | Collapse or expand. |
| Delete key on a selected group | Deletes the group and its contents (undo brings them back). |
| Copy and paste | Website: a copied group takes its contents with it. The mod copies what is selected, without the group. |

**Making a group never nests by accident.** If every selected thing is in the same group, the new group goes inside
it; otherwise the selected things leave their groups and the new group sits on the board. Selected groups go inside
the new group.

Undo covers every change (one step each). A collapsed group's members cannot be selected, hovered or dragged; select-all
and the marquee skip them; they still solve.

## Dragging in and out

What is in a group is always plain: its members sit on its tinted body inside its border; everything else is on the
bare board.

- While a card, drawer or note is carried, the group under the **pointer's aim** (the carried thing's centre, before
  the board slides it clear of what is in the way) lights up: its body brighter with a 2 px inner line in its colour,
  its strip brighter, its border white. Coming over a new group ticks once (`wire.snap`, 0.6). The group it would leave
  dims.
- Let go and it is in the lit group: the frame grows to hold it (even a full group takes it, the thing landing where
  the board slid it), with `board.merge` pitched up (1.12). Let go over no group and it leaves its group, with
  `board.merge` pitched down (0.85, quieter).
- Frames are no walls on a plan board: a card is never stopped at a border, only by other cards.
- A carried group never joins another by being dropped on it; nest groups by grouping a selection inside a group.

## Menus

Every right-click menu and every key menu on the board is one menu in one skin (the mod's `PickList`: square, 1 px
chrome, the game font; the website's `clean/menus/BoardMenu`). Rows are the same words on both sides. A "..." row
opens a short list with the current choice ticked; red rows lose something and sit under a rule.

| Right-click on | Rows |
| --- | --- |
| The board | Add sticky note, Add box, Add arrow (website: New product drawer) |
| A card (anywhere but an item) | the card's actions key rows: Clone node, (mod: Show in the world, Remove from the world, once placed), Delete node |
| A drawer | its rule key's rows (Any, At least, Exactly, At most, the current one ticked; Void it (trash) / Keep it (product)), Delete drawer |
| A sticky note | Write on it, Colour..., Bigger text, Smaller text, Delete note |
| A box or zone / an arrow | Colour..., Fill..., Border..., Marks..., Delete box / Colour..., Thickness..., Heads..., Delete arrow |
| A group (title strip, border, summary card) | Rename, Collapse or Expand, Colour..., Ungroup (keeps contents), Delete group and contents |
| A wire (website) | Add a drawer here, Delete wire |
| An item (a port's or a drawer's resource icon) | not a menu: it looks the item up, recipes (uses with Shift), as R and U do |

There is no "Add to group" row anywhere: things go in and out of groups by dragging, and groups are made with the
Group key or Ctrl+G.

## Arrange

Arrange keeps a group together: each top-level group is one block of its frame's size (or the summary card's when
collapsed), its insides untouched, placed with the ungrouped cards. Wires into a group count as wires into its block
for the placing; the website's router judge still routes them to the card inside. On the website a plan with groups
asks first (the Arrange key's menu): Keep groups, or Ungroup all, which takes every group apart and arranges all the
cards (undo brings the groups back).

## Where it lives

| | Mod | Website |
| --- | --- | --- |
| Model | `data/flowchart/BoardGroup`, `Groups` (membership, nesting, hiding, fit), `Graph.boardGroups`, `Node.group`, `Drawer.group`, `Note.group` | `FactoryPocket`, `pocketId` (unchanged); `clean/group/group-model.ts` (make, fit, colours) |
| Edits | `ui/group/GroupEdits` (group, rename, recolour, collapse, resize, ungroup, delete with contents, a drop's landing) | store: `groupSelection`, `renamePocket`, `paintPocket`, `minimizePocket`, `expandPocket`, `dissolvePocket`, `moveBoardItems(moves, fit)` |
| Drawn | `ui/group/GroupCard` (strip, keys, edges, summary card, menu), `GroupPaint`, `GroupSummary`; bodies under the wires in `BoardCanvas.paintGroupBodies` | `clean/group/CleanGroupFrame`, `CleanGroupSummary`, `GroupFloor` (the body), `GroupSwitch`, `group-summary.ts`, `group.css` |
| Dragging in and out | `BoardCanvas.aim` (the aimed group), `endMove` → `GroupEdits.land` | `clean/group/group-drop.ts` (lit target, sounds, `groupUnder`), FactoryFlow's drag handlers |
| Making | `SelectionBar` (Group key), Ctrl+G in `BoardScreen` | `SelectionBar` in FactoryFlow (Group key), Ctrl+G |
| Menus | `ui/popup/PickList` everywhere (`GroupCard.openMenu`, `RecipeCard.openActionsAt`, `DrawerCard.ruleRows`, `NoteCard.openMenu`, `BoardCanvas.openBoardMenu`) | `clean/menus/BoardMenu` everywhere (`GroupMenu`, `CardRows`, the drawer's, `NoteMenu`, `AnnotationMenu`, `BoardContextMenu`) |
| Wires | `ui/canvas/WireLayer` (`groupBox`: a collapsed group's box takes what it hides) | the old minimized board's inert handles (`board-card-in`, `board-card-out`) |
| Arrange | `BoardCanvas.arrange` (a top-level group is one box), `collectArrange` moves its contents with it | "Keep boards" always on for plan boards |
| Plan JSON | `importer/FfPlanParser` (`FfPlan.boards`, `boardOf`), `FfConverter.placeBoards`, `library/PlanExport` (`pockets`, `pocketId`); shared plans `cloud/map` (`PlanRead.pockets`, `Fresh`: each place from its pocket's frame, the game's data on each pocket) | native |
| Minimap | `ui/world/Minimap.drawGroups` via `PlanSnapshot.groups` | `clean/minimap/minimap-scene.ts`, `minimap-draw.ts` |
| Tests | `GroupsTest`, `GroupsRoundTripTest` (two public posts with boards, and a round trip), `FfPlanParserTest` | `group-model.test.ts` |
