import { Fragment, type ReactNode } from "react";
import { useFactoryStore } from "@/store/factory-store";
import type { RecipeTooltipView, TooltipAction } from "./recipe-tooltip-data";

const GESTURE_NAME: Record<TooltipAction["gesture"], string> = {
  left: "Left click",
  right: "Right click",
  wheel: "Mouse wheel",
  drag: "Drag",
};

/**
 * One mouse, drawn at text height so the button it lights is legible at
 * the size the panel is actually read at. Left and right fill their half
 * of the top; wheel fills the wheel; drag adds the arrow under it.
 */
export function MouseIcon({ gesture }: { gesture: TooltipAction["gesture"] }) {
  return (
    <svg aria-hidden="true" width="20" height="24" viewBox="0 0 20 24" fill="none" className="shrink-0 text-fg-muted">
      <rect x="3" y="1" width="14" height="16" rx="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 1v7.5M3 8.5h14" stroke="currentColor" strokeWidth="1.4" />
      {gesture === "left" && <path d="M4.2 7.7V6.6c0-2.4 1.8-4.1 4.6-4.5V7.7Z" fill="currentColor" />}
      {gesture === "right" && <path d="M15.8 7.7V6.6c0-2.4-1.8-4.1-4.6-4.5V7.7Z" fill="currentColor" />}
      {gesture === "wheel" && <rect x="8.5" y="3" width="3" height="4.5" rx="1.5" fill="currentColor" />}
      {gesture === "drag" && <path d="M3 21h14m-3-2.5 3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" />}
    </svg>
  );
}

/** Read-only gesture legend; actions remain on the hovered control. */
export function TooltipActions({ actions }: { actions: readonly TooltipAction[] }) {
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  // The viewer permits inspection, but none of these editing/browsing gestures.
  if (readOnly || !actions.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-y-1 border-t border-line pt-2.5 text-fg-subtle" data-tooltip-actions="">
      {actions.map((action) => (
        <span key={`${action.gesture}-${action.label}`} className="flex items-center gap-2">
          <span role="img" aria-label={GESTURE_NAME[action.gesture]}>
            <MouseIcon gesture={action.gesture} />
          </span>
          <span>{action.label}</span>
        </span>
      ))}
    </div>
  );
}

export function RecipeTooltip({ view, children }: { view: RecipeTooltipView; children?: ReactNode }) {
  const modeColor = view.mode === "pool" ? "text-[#6f9cff]" : view.mode === "solve" ? "text-[#c78bff]" : "text-[#f5b642]";
  // ONE body size (14/20) everywhere but the heading; the panel is as wide
  // as its longest line and no wider, capped so a paragraph still wraps.
  // The footer stacks one gesture per line so it never sets that width.
  return (
    <div className="w-max max-w-[300px] text-sm leading-5 text-fg-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 break-words text-base font-semibold leading-6 text-fg">{view.title}</div>
        {view.mode && <span className={`shrink-0 capitalize ${modeColor}`}>{view.mode}</span>}
      </div>
      {(view.subtitle || view.status) && <div className="flex flex-wrap justify-between gap-x-3 text-fg-muted">
        <span>{view.subtitle}</span>
        {view.status && <span className={view.status.tone === "warning" ? "text-amber-300" : view.status.tone === "good" ? "text-green-300" : "text-fg-muted"}>{view.status.label}</span>}
      </div>}
      {view.table && <div className="mt-2 grid grid-cols-[minmax(0,1fr)_max-content_max-content] gap-x-4 gap-y-0.5">
        {view.table.head.map((cell, index) => <span key={cell} className={`text-xs uppercase tracking-wider text-fg-muted ${index > 0 ? "text-right" : ""}`}>{cell}</span>)}
        {view.table.rows.map(row => <Fragment key={row.label}>
          <span className={`min-w-0 truncate ${row.emphasis ? "border-t border-line pt-0.5 font-semibold text-fg" : "text-fg-muted"}`}>{row.label}</span>
          <span className={`whitespace-nowrap text-right tabular-nums text-fg-muted ${row.emphasis ? "border-t border-line pt-0.5" : ""}`}>{row.before}</span>
          <span className={`whitespace-nowrap text-right font-medium tabular-nums text-fg ${row.emphasis ? "border-t border-line pt-0.5 font-semibold" : ""}`}>{row.after}</span>
        </Fragment>)}
      </div>}
      {view.rows.length > 0 && <dl className="mt-2 space-y-0.5">
        {view.rows.map(row => <div key={row.label} className="flex items-baseline justify-between gap-5">
          <dt className="min-w-0 text-fg-muted">{row.label}</dt>
          <dd className="whitespace-nowrap text-right font-medium tabular-nums text-fg">{row.value}</dd>
        </div>)}
      </dl>}
      {view.reason && <p className="mt-2">{view.reason}</p>}
      {view.bullets && view.bullets.length > 0 && <ul className="mt-2 space-y-0.5">
        {view.bullets.map((line) => <li key={line} className="flex gap-2"><span aria-hidden className="shrink-0 text-fg-muted">•</span><span>{line}</span></li>)}
      </ul>}
      {view.requirement && <p className="mt-2 text-fg">{view.requirement}</p>}
      {children}
      {view.actions && <TooltipActions actions={view.actions} />}
    </div>
  );
}
