/** Ref callback for dropdown filters. Touch opens the list first; tapping
 * the filter explicitly opens the keyboard. Desktop keeps type-to-search,
 * without scrolling the board or page just to focus the input. */
export function focusDropdownFilter(input: HTMLInputElement | null): void {
  if (!input || window.matchMedia?.("(any-pointer: coarse)").matches) return;
  input.focus({ preventScroll: true });
}
