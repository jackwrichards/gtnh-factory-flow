"use client";
import { useState } from "react";
import { Copy, Menu, Plus, RefreshCw, Skull, Trash2 } from "lucide-react";
import { MenuShell } from "./EnergyHatchMenu";
export function CardActionsMenu({
  onDelete,
  onClone,
  onRefactor,
  onAddRecipe,
  onChangeMob,
}: {
  onDelete: () => void;
  onClone: () => void;
  onRefactor: () => void;
  onAddRecipe?: () => void;
  /** An Extreme Entity Crusher swaps the spawner in its controller slot. */
  onChangeMob?: () => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; top: number; bottom: number; hangsFrom?: Element }>();
  return (
    <div className="relative">
      <button
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        data-hatch-menu-anchor
        onClick={(e) => {
          e.stopPropagation();
          const card = e.currentTarget.closest("[data-node-glance-root]") ?? undefined;
          const r = (card ?? e.currentTarget).getBoundingClientRect();
          setAnchor(
            anchor ? undefined : { x: r.left, top: r.top, bottom: r.bottom, hangsFrom: card },
          );
        }}
        className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
      >
        <Menu className="h-3.5 w-3.5" />
      </button>
      {anchor ? (
        <MenuShell anchor={anchor} align="left" width={224} maxHeight={240} onClose={() => setAnchor(undefined)}>
          <div
            role="menu"
            aria-label="Card actions"
            className="text-[13px] leading-[18px]"
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              e.stopPropagation();
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
              );
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
          >
            {[
              ...(onChangeMob ? [{ label: "Change mob", icon: Skull, run: onChangeMob }] : []),
              { label: "Clone node", icon: Copy, run: onClone },
              { label: "Replace the recipe", icon: RefreshCw, run: onRefactor },
              ...(onAddRecipe
                ? [{ label: "Add another recipe", icon: Plus, run: onAddRecipe }]
                : []),
              { label: "Delete node", icon: Trash2, run: onDelete },
            ].map(({ label, icon: Icon, run }, index) => (
              <button
                key={label}
                role="menuitem"
                autoFocus={index === 0}
                onClick={() => {
                  setAnchor(undefined);
                  run();
                }}
                className="flex min-h-8 w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--mc-ink)] hover:bg-[var(--mc-93)] focus-visible:bg-[var(--mc-93)] focus-visible:outline-none"
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="min-w-0">{label}</span>
              </button>
            ))}
          </div>
        </MenuShell>
      ) : null}
    </div>
  );
}
