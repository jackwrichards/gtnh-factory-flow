"use client";

import { createContext, useContext, type DragEvent } from "react";
import { GripVertical } from "lucide-react";

type ListKind = "machines" | "products" | "resources" | "panels";
const ORDER_TYPE = "application/x-gtnh-pool-order";
export const WorksheetOrderContext = createContext<{
  readOnly: boolean;
  ids: Record<ListKind, string[]>;
  move: (kind: ListKind, from: string, to: string, after: boolean) => void;
}>({
  readOnly: true,
  ids: { machines: [], products: [], resources: [], panels: [] },
  move: () => {},
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
  if (readOnly) return null;
  return (
    <button
      type="button"
      draggable
      className="pool-order-handle"
      aria-label={`Reorder ${label}`}
      title="Drag to reorder · Arrow keys move up or down"
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(ORDER_TYPE, JSON.stringify({ kind, id }));
      }}
      onDragEnd={(event) => {
        event.currentTarget
          .closest(".pool-worksheet")
          ?.querySelectorAll<HTMLElement>("[data-order-drop]")
          .forEach((target) => {
            delete target.dataset.orderDrop;
          });
      }}
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
  const { readOnly, move } = useContext(WorksheetOrderContext);
  const mark = (event: DragEvent<HTMLElement>) => {
    if (readOnly || !event.dataTransfer.types.includes(ORDER_TYPE)) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dataset.orderDrop =
      event.clientY > box.y + box.height / 2 ? "after" : "before";
  };
  return {
    onDragOver: mark,
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      delete event.currentTarget.dataset.orderDrop;
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const after = event.currentTarget.dataset.orderDrop === "after";
      delete event.currentTarget.dataset.orderDrop;
      if (readOnly) return;
      try {
        const source = JSON.parse(event.dataTransfer.getData(ORDER_TYPE));
        if (source.kind !== kind || typeof source.id !== "string") return;
        event.preventDefault();
        event.stopPropagation();
        move(kind, source.id, id, after);
      } catch {
        /* A resource drop belongs to the Products zone. */
      }
    },
  };
}
