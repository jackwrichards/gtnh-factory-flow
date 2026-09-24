"use client";

import { LocateFixed } from "lucide-react";
import type { FactoryStorage } from "@/lib/model/types";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { RuleButton, useTableRule } from "../flow/rate-rule";
import { TargetLine } from "../flow/StorageNode";
import { formatSignedRate } from "./flow-rate";

/** Your rate as the row's own rate reads, less its sign and unit: the rule
 * mark stands in front of it and the row's rate, unit and all, beside it. */
const bareRate = (perSecond: number, kind: string) => formatSignedRate(perSecond, kind, 0);

/**
 * A source or product drawer's rule and rate, set from the resources panel in
 * Solve (Jack, 2026-09-23): Pool's rule button wearing its mark alone, then
 * the rate line. A resource with ONE such drawer carries these on its own
 * row, so one thing reads on one line - `bare` there, so the name keeps its
 * room; several drawers get a branch row each, with room for the full line.
 */
export function DrawerRateControls({ storage, input, bare = false }: { storage: FactoryStorage; input: boolean; bare?: boolean }) {
  useRateDisplayUnits();
  const result = useFactoryStore((s) => s.lastResult.storages[storage.id]);
  const rule = useTableRule({
    storage,
    role: input ? "source" : "product",
    name: storage.displayName ?? storage.resourceId,
  });
  return (
    <span className="inspector-drawer-rate">
      <RuleButton rule={rule} variant="mark" />
      <TargetLine
        inlinePencil
        bare={bare}
        storage={storage}
        result={result}
        input={input}
        formatDisplayRate={bare ? bareRate : undefined}
      />
    </span>
  );
}

/** One of several drawers behind a resource row, hung under it as a branch. */
export function DrawerTargetRow({ storage, input, isLast }: { storage: FactoryStorage; input: boolean; isLast: boolean }) {
  const locked = useFactoryStore((s) => s.isReadOnly || !(s.project.solveMode || s.project.poolMode));
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
        className="flex h-5 w-5 items-center justify-center text-neutral-500 hover:text-neutral-100"
        title="Locate this drawer on the board"
        aria-label={input ? "Locate source drawer" : "Locate product drawer"}
        onClick={() => useFactoryStore.getState().focusBoardNode(storage.id)}
      >
        <LocateFixed className="h-3 w-3" />
      </button>
      <span className="ml-auto flex">
        <DrawerRateControls storage={storage} input={input} />
      </span>
    </div>
  );
}
