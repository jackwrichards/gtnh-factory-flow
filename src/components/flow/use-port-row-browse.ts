"use client";

import { isFromBrowseMenu, useBrowseMenu, type BrowseMode as PortBrowseMode } from "@/components/browse-menu";
import { isEchoOfTouch } from "@/lib/pointer-kind";
import { wasRecentWireDrop } from "./connection-drag";
import { clearHoveredPortBrowse, setHoveredPortBrowse } from "./port-browse";

/**
 * What a port row does when you point at it.
 *
 * It used to be the little item icon and nothing else: a 28px square inside a
 * 40px row, carrying click-for-recipes and right-click-for-uses, while the rest
 * of the row — the name, the rate, the bar — was only a wire drag. Aiming at the
 * icon to ask "what makes this?" is a game of darts, and on a touchscreen the
 * icon has no right button to press and no hover to reveal itself.
 *
 * So the whole row answers now, and every input device gets a way in:
 *   click       recipes that make it
 *   right click recipes that use it
 *   drag        a wire, exactly as before
 *   R / U       the same two, for the row under the pointer
 *   tap         a menu offering both, for a finger
 *   press       the same menu, early enough to slide onto one and let go
 */
export function usePortRowBrowse({
  nodeId,
  port,
  browse,
}: {
  nodeId: string;
  /** A machine port row or a drawer's port chip: all the hook reads. */
  port: { displayName: string; handleId: string };
  browse: (mode: PortBrowseMode) => void;
}) {
  // The press gesture, the menu it opens and the one-answer-per-gesture rule are
  // shared with the items column — see browse-menu.tsx. What stays here is what is
  // particular to a port: the mouse's two buttons, the keyboard's two keys, and
  // the fact that a drag from here is a wire.
  const { pressHandlers, isPressing, menu, wasDragged, wasTouch, openFromTap } = useBrowseMenu({
    name: port.displayName,
    onPick: browse,
    onPressBecomesMenu: ({ x, y }) => {
      // React Flow began pulling a wire the instant the finger landed — it has no
      // way to know a press was coming — and the finger is now going to travel
      // down onto a menu item. Left alone it would drop that wire wherever the
      // finger let go. `mouseup` on the document is what its connection listens
      // for, so this is the wire being put down where it started, which wires
      // nothing.
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    },
  });

  const handlers = {
    onPointerEnter: () => {
      setHoveredPortBrowse({ nodeId, handleId: port.handleId, open: browse });
    },
    onPointerLeave: () => {
      clearHoveredPortBrowse(nodeId, port.handleId);
      pressHandlers.onPointerCancel();
    },
    onPointerDown: pressHandlers.onPointerDown,
    onPointerMove: pressHandlers.onPointerMove,
    onPointerUp: pressHandlers.onPointerUp,
    onPointerCancel: pressHandlers.onPointerCancel,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (isFromBrowseMenu(event)) {
        return;
      }
      // A finger gets the menu — a tap and a press open the same two answers, the
      // press just gets there early enough to slide onto one. Opening the book
      // straight off a tap would be guessing which of the two was meant.
      //
      // `isEchoOfTouch`, not the pointerdown this row saw: the click a tap
      // synthesises claims to be a mouse, and on some engines so does the
      // pointerdown before it, so only the timing gives them away.
      if (wasTouch() || isEchoOfTouch()) {
        if (openFromTap({ x: event.clientX, y: event.clientY })) {
          event.stopPropagation();
        }
        return;
      }
      // Dropping a wire back on the row it came from is a pointerdown and a
      // pointerup on one element, which is also the definition of a click.
      if (wasDragged() || wasRecentWireDrop()) {
        return;
      }
      event.stopPropagation();
      browse("recipes");
    },
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      if (isFromBrowseMenu(event)) {
        return;
      }
      // Android raises this on a long press too, where the menu is the answer.
      event.preventDefault();
      event.stopPropagation();
      if (wasTouch() || isEchoOfTouch()) {
        return;
      }
      browse("uses");
    },
  };

  return { handlers, menu, isPressing };
}
