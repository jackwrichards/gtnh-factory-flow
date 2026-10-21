/**
 * Board-wide keyboard shortcuts must never fire while the user is typing:
 * Delete means "delete a character", Ctrl+Z means "undo my typing", Ctrl+C
 * means "copy my text". Anything that handles board keys checks here first.
 */
export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** Covering pages keep the canvas mounted, but must never send it keyboard or clipboard edits. */
export function listenForBoardInput<K extends "keydown" | "paste">(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  isCovered: () => boolean,
  capture = false,
): () => void {
  const listener = (event: WindowEventMap[K]) => {
    if (!isCovered()) handler(event);
  };
  window.addEventListener(type, listener, capture);
  return () => window.removeEventListener(type, listener, capture);
}
