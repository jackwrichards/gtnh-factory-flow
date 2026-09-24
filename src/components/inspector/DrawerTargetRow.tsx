"use client";

import { LocateFixed } from "lucide-react";
import type { FactoryStorage } from "@/lib/model/types";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { RateBox, RuleButton, useRateRule } from "../flow/rate-rule";

/**
 * A source or product drawer, hung under its resource's row like a file in a
 * folder (Jack, 2026-09-23): locate, then the drawer's own rule and rate - the
 * rule button wearing its word as in Pool, and your rate in the drawer's
 * sunken box. They behave exactly as on the drawer: the same hook sets them.
 */
export function DrawerTargetRow({ storage, input, isLast }: { storage: FactoryStorage; input: boolean; isLast: boolean }) {
  useRateDisplayUnits();
  const locked = useFactoryStore((s) => s.isReadOnly || !(s.project.solveMode || s.project.poolMode));
  const result = useFactoryStore((s) => s.lastResult.storages[storage.id]);
  const rule = useRateRule({
    storage,
    role: input ? "source" : "product",
    result,
    flowing: Math.abs(result?.netPerSecond ?? 0),
  });
  if (locked) return null;
  return (
    <div
      className="inspector-drawer-target relative flex h-7 items-center gap-2 pl-8 pr-2"
      data-tone={input ? "need" : "output"}
    >
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-3 top-0 w-4 text-neutral-600">
        <span className={`absolute left-0 top-0 w-px bg-current ${isLast ? "h-1/2" : "bottom-0"}`} />
        <span className="absolute left-0 top-1/2 h-px w-3 bg-current" />
      </span>
      <button
        type="button"
        className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500 hover:text-neutral-100"
        title="Locate this drawer on the board"
        aria-label={input ? "Locate source drawer" : "Locate product drawer"}
        onClick={() => useFactoryStore.getState().focusBoardNode(storage.id)}
      >
        <LocateFixed className="h-3 w-3" />
      </button>
      <span className="inspector-drawer-rate ml-auto">
        <RuleButton rule={{ ...rule, name: storage.displayName ?? storage.resourceId }} variant="table" />
        <RateBox rule={rule} />
      </span>
    </div>
  );
}
