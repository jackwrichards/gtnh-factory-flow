/** Shared order keeps the drawer's split bar and editor destinations aligned. */
export const RATIO_COLORS = ["#67e8f9", "#fbbf24", "#c4b5fd", "#86efac", "#fda4af", "#93c5fd"];

export function ratioColor(index: number): string {
  return RATIO_COLORS[index % RATIO_COLORS.length];
}
