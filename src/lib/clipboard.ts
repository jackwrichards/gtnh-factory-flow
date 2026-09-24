"use client";

/**
 * Write text to the system clipboard, with the old selection-based path behind
 * it: the async API needs a secure context, and a plan opened from a file or
 * over plain http has none. Reports whether it landed rather than throwing,
 * because the caller's whole job is to say so on the button.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.append(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      scratch.remove();
      return copied;
    } catch {
      return false;
    }
  }
}
