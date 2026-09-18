"use client";

import { createContext, useContext } from "react";
import { GripVertical } from "lucide-react";
import { useWorksheetPointerDrag } from "./worksheet-pointer-drag";

type ListKind = "machines" | "products" | "resources";

export const WorksheetOrderContext = createContext<{
  readOnly: boolean;
  ids: Record<ListKind, string[]>;
  move: (kind: ListKind, from: string, to: string, after: boolean) => boolean;
}>({
  readOnly: true,
  ids: { machines: [], products: [], resources: [] },
  move: () => false,
});

export function orderWorksheetEntries<T>(
  entries: T[],
  order: string[] = [],
  key: (entry: T) => string,
): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...entries].sort(
    (a, b) => (ranks.get(key(a)) ?? Infinity) - (ranks.get(key(b)) ?? Infinity),
  );
}

export function moveWorksheetEntry(
  ids: string[],
  from: string,
  to: string,
  after: boolean,
): string[] {
  if (from === to || !ids.includes(from) || !ids.includes(to)) return ids;
  const next = ids.filter((id) => id !== from);
  next.splice(next.indexOf(to) + Number(after), 0, from);
  return next;
}

export function OrderHandle({ kind, id, label }: { kind: ListKind; id: string; label: string }) {
  const { readOnly, ids, move } = useContext(WorksheetOrderContext);
  const { begin } = useWorksheetPointerDrag();
  if (readOnly) return null;
  return (
    <button
      type="button"
      draggable={false}
      className="pool-order-handle"
      aria-label={`Reorder ${label}`}
      title={kind === "machines" ? "Drag to reorder or move into a group · Arrow keys move up or down" : "Drag to reorder · Arrow keys move up or down"}
      onPointerDown={(event) => begin(event, { kind, id, label })}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        const index = ids[kind].indexOf(id);
        const down = event.key === "ArrowDown";
        const target = ids[kind][index + (down ? 1 : -1)];
        if (target) move(kind, id, target, down);
      }}
    >
      <GripVertical aria-hidden />
    </button>
  );
}

export function useOrderTarget(kind: ListKind, id: string) {
  return { "data-pool-order-kind": kind, "data-pool-order-id": id };
}
