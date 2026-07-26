/**
 * Custom cursor for node-paint mode: a brush whose bristle tip carries the
 * colour being painted, plus a bold colour chip beside it, so the cursor
 * itself says exactly what a click will apply. Erase mode (no swatch) renders
 * a white tip and a crossed-out chip.
 *
 * 32x32 is the largest cursor size Windows/Chromium reliably honour. The
 * hotspot sits at the brush tip (bottom-left), matching where users expect
 * the click to land.
 */

const CURSOR_CACHE = new Map<string, string>();

let deleteCursor: string | undefined;

/** Bold red X with a white halo; hotspot at its centre, where the click lands. */
export function getDeleteCursor() {
  if (deleteCursor) {
    return deleteCursor;
  }

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'>` +
    `<path d='M5 5 L21 21 M21 5 L5 21' stroke='#f8fafc' stroke-width='9' stroke-linecap='round'/>` +
    `<path d='M5 5 L21 21 M21 5 L5 21' stroke='#dc2626' stroke-width='5' stroke-linecap='round'/>` +
    `</svg>`;
  deleteCursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 13 13, not-allowed`;
  return deleteCursor;
}

export function getPaintBrushCursor(swatch?: string) {
  const key = swatch ?? "";
  const cached = CURSOR_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const tipFill = swatch ?? "#f8fafc";
  const chip = swatch
    ? `<rect x='18' y='19' width='12' height='12' fill='${swatch}' stroke='#1f2937' stroke-width='2'/>`
    : `<rect x='18' y='19' width='12' height='12' fill='#f8fafc' stroke='#1f2937' stroke-width='2'/>` +
      `<path d='M20.5 21.5 L27.5 28.5 M27.5 21.5 L20.5 28.5' stroke='#b91c1c' stroke-width='2.5' stroke-linecap='round'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
    // White casing behind everything keeps the cursor legible on dark nodes.
    `<path d='M13 19 L29 3' stroke='#f8fafc' stroke-width='9' stroke-linecap='round'/>` +
    `<path d='M2 30 L9.5 15 L16.5 22 Z' fill='#f8fafc' stroke='#f8fafc' stroke-width='5' stroke-linejoin='round'/>` +
    // Handle.
    `<path d='M13 19 L29 3' stroke='#1f2937' stroke-width='5' stroke-linecap='round'/>` +
    // Bristle tip carrying the active paint colour.
    `<path d='M2 30 L9.5 15 L16.5 22 Z' fill='${tipFill}' stroke='#1f2937' stroke-width='2' stroke-linejoin='round'/>` +
    // Colour chip with a white halo so it pops on any background.
    `<rect x='16.5' y='17.5' width='15' height='15' fill='#f8fafc'/>` +
    chip +
    `</svg>`;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 30, crosshair`;
  CURSOR_CACHE.set(key, cursor);
  return cursor;
}
