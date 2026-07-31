"use client";

import { useMemo } from "react";
import type { MachineHandlerIconEntry } from "@/lib/datasets/types";
import { useFactoryStore } from "@/store/factory-store";

export type MachineHandlerIcon = MachineHandlerIconEntry["resource"];

/**
 * Machine handler family icons, shipped in the dataset catalog
 * (machineHandlerIcons: familyId -> the family's lowest-tier item). Keyed by
 * handler id, which is the family slug on both sides of the pipeline.
 */
export function useMachineHandlerIcons(): ReadonlyMap<string, MachineHandlerIcon> {
  const entries = useFactoryStore((state) => state.dataset?.machineHandlerIcons);
  return useMemo(
    () => new Map((entries ?? []).map((entry) => [entry.familyId, entry.resource])),
    [entries],
  );
}
