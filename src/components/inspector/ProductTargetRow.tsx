"use client";

import { LocateFixed } from "lucide-react";
import type { FactoryStorage } from "@/lib/model/types";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { StorageTargetRule } from "../flow/StorageTargetRule";
import { TargetLine } from "../flow/StorageNode";

export function ProductTargetRow({ storage, isLast }: { storage: FactoryStorage; isLast: boolean }) {
  useRateDisplayUnits();
  const locked = useFactoryStore((s) => s.isReadOnly || !(s.project.solveMode || s.project.poolMode));
  const result = useFactoryStore((s) => s.lastResult.storages[storage.id]);
  if (locked) return null;
  return (
    <div className="inspector-product-target relative flex h-7 items-center gap-2 pl-8 pr-2">
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-3 top-0 w-4 text-neutral-600">
        <span className={`absolute left-0 top-0 w-px bg-current ${isLast ? "h-1/2" : "bottom-0"}`} />
        <span className="absolute left-0 top-1/2 h-px w-3 bg-current" />
      </span>
      <button type="button" className="flex h-5 w-5 items-center justify-center text-neutral-500 hover:text-neutral-100"
        title="Locate this product on the board" aria-label="Locate product drawer"
        onClick={() => useFactoryStore.getState().focusBoardNode(storage.id)}>
        <LocateFixed className="h-3 w-3" />
      </button>
      <StorageTargetRule storage={storage} input={false} className="ml-auto max-w-[80px] bg-transparent text-[10px] text-fg-muted [&_option]:bg-[var(--surface)]" />
      <div className="relative mr-4" title="Product target"><TargetLine storage={storage} result={result} /></div>
    </div>
  );
}
