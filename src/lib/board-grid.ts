/**
 * The board grid.
 *
 * One number governs the whole canvas: the background pattern, the snap step,
 * every card's width and height, and the vertical pitch of the port rows. If a
 * card is a whole number of cells tall and sits on a cell corner, then every
 * one of its ports lands on a grid line too — which is the point. Wires can
 * then run along the same lines the cards are built from.
 *
 * The rules, in order of importance:
 *
 *  1. Node positions are multiples of `BOARD_GRID`.
 *  2. Node widths and heights are multiples of `BOARD_GRID`.
 *  3. A port row is `PORT_ROW_HEIGHT` tall (two cells), and the block above
 *     the rails is a whole number of `HEAD_ROW_HEIGHT` (also two cells), so
 *     port centres land on a grid line: head + 20 + 40i.
 *
 * Rule 3 is why the head, the footer and the config panels have fixed heights
 * rather than sizing to their content. Content that used to set the height now
 * sits inside a box whose height the grid sets.
 */

/** The cell. Everything on the board is a whole number of these. */
export const BOARD_GRID = 20;

/** Snap a scalar to the nearest grid line. */
export function snapToGrid(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/** Snap a board position to the nearest cell corner. */
export function snapPositionToGrid<T extends { x: number; y: number }>(position: T): T {
  return { ...position, x: snapToGrid(position.x), y: snapToGrid(position.y) };
}

/** Grow a measurement to the next whole cell (never shrink — content must fit). */
export function snapSizeUpToGrid(value: number): number {
  return Math.max(BOARD_GRID, Math.ceil(value / BOARD_GRID) * BOARD_GRID);
}

/** `n` cells, in pixels. */
export function cells(n: number): number {
  return n * BOARD_GRID;
}

/* ---------------------------------------------------------------------- */
/* Card geometry — the sizes every node component builds itself out of.    */
/* ---------------------------------------------------------------------- */

/** Every recipe card is this wide. 19 cells.
 *
 * The machine PICTURE sits between the two rails (2026-09-06), where the
 * arrow was, and it is the flex-1 middle: 96px, the size a structure render
 * reads at. THREE cells came back off the card on 2026-09-09 without ever
 * touching it - 22 to 21 to 20 to 19 - and every one of them came out of the
 * two item chips and the output coupling instead: 140 to 112 a chip, 34 to
 * 30 the coupling. The picture has been 96px throughout, which is the
 * measurement to re-check first if this number moves again.
 *
 * What pays for it is the NAME, which wraps to two lines rather than
 * truncating. The chip's name column is down to 70px, so a name past about
 * 22 characters now clips on the second line; the hover carries the whole
 * one. That is the trade, and it is the reason not to take a fourth cell.
 */
export const RECIPE_NODE_WIDTH = cells(19); // 380

/** Card padding either side of the rails (inside the 2px frame). */
export const RECIPE_NODE_PAD_X = 8;

/** Inner width available to the rails after frame and padding. */
export const RECIPE_RAIL_AREA_WIDTH = RECIPE_NODE_WIDTH - 2 * (2 + RECIPE_NODE_PAD_X); // 360

/** The input chip, and the chip half of an output row. */
export const PORT_CHIP_WIDTH = 112;

/** The `→` divider between the two rails. */
export const RAIL_DIVIDER_WIDTH = 16;

/** Chip + 2px gap + the 30px coupling (`.flow-plug` in globals.css). */
export const OUTPUT_RAIL_WIDTH = PORT_CHIP_WIDTH + 2 + 30; // 144

/** One port row. Two cells, so a rail of any length stays on the grid. */
export const PORT_ROW_HEIGHT = cells(2); // 40

/**
 * The floor under the machine picture, which is the flex-1 middle between
 * the two rails and grows with them. TWO port rows (2026-09-09): at three
 * it stood a whole row taller than the rails on the commonest card of all,
 * the one input and two outputs, and the picture floated in a window with
 * nothing under it. Two rows against the picture's 96px reads square.
 *
 * It must stay a whole number of CELLS or a short card lands off the grid.
 */
export const PICTURE_MIN_HEIGHT = PORT_ROW_HEIGHT * 2; // 80

/** The title row. */
export const HEAD_ROW_HEIGHT = cells(2); // 40

/** The stat footer. */
export const FOOTER_HEIGHT = cells(2); // 40

/** One row of a machine-config panel (label over a dropdown). */
export const CONFIG_PANEL_ROW_HEIGHT = cells(3); // 60

/**
 * Drawers and tanks: a low horizontal face, with artwork beside the name and
 * rate. Nine cells by four; shared by placement, routing, and drag previews.
 */
export const STORAGE_NODE_WIDTH = cells(9); // 180
export const STORAGE_NODE_HEIGHT = cells(4); // 80

/** Trash cans, same tile. */
export const TRASH_NODE_WIDTH = cells(4); // 80
export const TRASH_NODE_HEIGHT = cells(4); // 80

/**
 * The board window: a pocket standing OPEN on its parent board. The title bar
 * is one head row (two cells), so a frame on a cell corner keeps every member
 * inside it on the grid — member positions are relative to the frame's
 * top-left corner, not to the content area under the bar.
 */
export const BOARD_WINDOW_TITLE_HEIGHT = cells(2); // 40
export const BOARD_WINDOW_DEFAULT_SIZE = { width: cells(24), height: cells(16) }; // 480×320
export const BOARD_WINDOW_MIN_WIDTH = cells(10); // 200
export const BOARD_WINDOW_MIN_HEIGHT = cells(6); // 120
/** Air between the frame and the members fitted into it on expand. */
export const BOARD_WINDOW_FIT_PAD = cells(1); // 20

/** Default sizes for the annotation shapes, all whole cells. */
export const ANNOTATION_DEFAULT_BOX = { width: cells(14), height: cells(9) }; // 280×180
export const ANNOTATION_DEFAULT_TEXT = { width: cells(12), height: cells(4) }; // 240×80
export const ANNOTATION_DEFAULT_ARROW = { width: cells(10), height: cells(1) }; // 200×20
export const ANNOTATION_MIN_BOX = cells(2); // 40
export const ANNOTATION_MIN_ARROW = cells(1); // 20
export const ANNOTATION_MIN_TEXT = { width: cells(5), height: cells(2) }; // 100×40
