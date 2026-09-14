"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import type { ResourceAmount } from "@/lib/model/types";
import { resourceLabel } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "../nei/ResourceIcon";
import { WorksheetOrderContext } from "./worksheet-drag";

type Payload =
  | { kind: "machines" | "products" | "resources"; id: string; label: string }
  | { resource: ResourceAmount };
const DragContext = createContext({
  begin: (_event: ReactPointerEvent<HTMLElement>, _payload: Payload) => {},
  suppressClick: (_element: HTMLElement): boolean => false,
});
export const useWorksheetPointerDrag = () => useContext(DragContext);

/** A floating preview, like the recipe picker, without a browser drag image. */
export function WorksheetPointerDrag({ children }: { children: ReactNode }) {
  const { readOnly, move } = useContext(WorksheetOrderContext);
  const [preview, setPreview] = useState<{ payload: Payload; x: number; y: number }>();
  const cancel = useRef<(() => void) | undefined>(undefined);
  const draggedSource = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  const begin = useCallback(
    (event: ReactPointerEvent<HTMLElement>, payload: Payload) => {
      cancel.current?.();
      draggedSource.current = undefined;
      // Resource swipes remain scrolling/long-press; grips support touch drag.
      if (
        readOnly ||
        event.button !== 0 ||
        ("resource" in payload && event.pointerType !== "mouse")
      )
        return;
      const source = event.currentTarget;
      const root = source.closest<HTMLElement>(".pool-worksheet");
      if (!root) return;
      const pointerId = event.pointerId;
      const startX = event.clientX,
        startY = event.clientY;
      let x = startX,
        y = startY,
        active = false,
        frame = 0;
      let target: HTMLElement | undefined;
      let after = false;
      const clearTarget = () => {
        target?.removeAttribute("data-order-drop");
        target?.removeAttribute("data-resource-drop");
        target = undefined;
      };
      const locate = () => {
        clearTarget();
        const hit = document.elementFromPoint(x, y);
        if ("resource" in payload) {
          const candidate = hit?.closest<HTMLElement>(
            ".pool-sheet-products, [data-pool-products-toggle]",
          );
          if (candidate && root.contains(candidate)) {
            target = candidate;
            target.dataset.resourceDrop = "true";
          }
        } else {
          const candidate = hit?.closest<HTMLElement>("[data-pool-order-kind]");
          if (
            candidate &&
            root.contains(candidate) &&
            candidate.dataset.poolOrderKind === payload.kind &&
            candidate.dataset.poolOrderId !== payload.id
          ) {
            target = candidate;
            const rect = target.getBoundingClientRect();
            after = y > rect.top + rect.height / 2;
            target.dataset.orderDrop = after ? "after" : "before";
          }
        }
      };
      const tick = () => {
        const hit = document.elementFromPoint(x, y);
        const scroller = hit?.closest<HTMLElement>(
          ".pool-sheet-scroll, .pool-products-scroll, .pool-resources-scroll",
        );
        if (scroller && root.contains(scroller)) {
          const rect = scroller.getBoundingClientRect();
          const delta = y < rect.top + 30 ? -8 : y > rect.bottom - 30 ? 8 : 0;
          if (delta) {
            scroller.scrollTop += delta;
            locate();
          }
        }
        frame = requestAnimationFrame(tick);
      };
      const finish = () => {
        cancelAnimationFrame(frame);
        clearTarget();
        source.removeAttribute("data-pool-drag-source");
        document.body.removeAttribute("data-pool-dragging");
        if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", finish);
        setPreview(undefined);
        cancel.current = undefined;
      };
      const onMove = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        x = next.clientX;
        y = next.clientY;
        if (!active && Math.hypot(x - startX, y - startY) < 6) return;
        if (!active) {
          active = true;
          draggedSource.current = source;
          source.setPointerCapture?.(pointerId);
          source.dataset.poolDragSource = "true";
          document.body.dataset.poolDragging = "true";
          frame = requestAnimationFrame(tick);
        }
        next.preventDefault();
        locate();
        setPreview({ payload, x, y });
      };
      const onUp = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        if (active && !useFactoryStore.getState().isReadOnly) {
          x = next.clientX;
          y = next.clientY;
          locate();
          if (target) {
            if ("resource" in payload)
              useFactoryStore.getState().addPoolStorage(payload.resource, "drain");
            else move(payload.kind, payload.id, target.dataset.poolOrderId!, after);
          }
        }
        finish();
      };
      const onKey = (next: KeyboardEvent) => {
        if (next.key === "Escape") {
          next.preventDefault();
          finish();
        }
      };
      cancel.current = finish;
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", finish);
    },
    [readOnly, move],
  );
  const context = useMemo(
    () => ({ begin, suppressClick: (element: HTMLElement) => draggedSource.current === element }),
    [begin],
  );
  return (
    <DragContext.Provider value={context}>
      {children}
      {preview
        ? createPortal(
            <div
              className="pool-drag-preview"
              style={{
                left: Math.max(8, Math.min(preview.x + 12, window.innerWidth - 248)),
                top: Math.min(preview.y + 12, window.innerHeight - 48),
              }}
              aria-hidden="true"
            >
              {"resource" in preview.payload ? (
                <ResourceIcon
                  resource={preview.payload.resource}
                  bare
                  size="sm"
                  showAmount={false}
                  tooltip={false}
                  className="!h-7 !w-7"
                />
              ) : (
                <GripVertical size={20} />
              )}
              <span>
                {"resource" in preview.payload
                  ? resourceLabel(preview.payload.resource)
                  : preview.payload.label}
              </span>
            </div>,
            document.body,
          )
        : null}
    </DragContext.Provider>
  );
}
