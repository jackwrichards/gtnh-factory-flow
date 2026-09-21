import { effectiveBufferMode } from "@/lib/model/storage-role";
import { isInputRate, storageTargetMode, targetModeHelp, TARGET_MODE_LABELS } from "@/lib/model/storage-target";
import type {
  FactoryProject,
  FactoryStorage,
  StorageBufferMode,
  StorageThroughputResult,
  ThroughputResult,
} from "@/lib/model/types";
import type { StorageRole } from "@/lib/model/storage-role";
import { getCategoryPresentation } from "@/lib/model/category-presentation";
import { resourceLabel } from "@/lib/model/resources";
import { deriveNodeVerdict } from "./node-verdict";
import { formatSlotRate } from "./flow-explainers";
import { tooltipMode, type RecipeTooltipView, type TooltipAction } from "./recipe-tooltip-data";

/**
 * The drawer's hover, in the same panel and vocabulary as the cards: the
 * resource, the role word, and rows of figures. No sentence explains what a
 * role does - the word and the numbers are the explanation. A sentence only
 * appears for a requirement (an unwired drawer) or a named cause (what
 * limits a product that misses its amount).
 */

const ROLE_WORD: Record<StorageRole, string> = {
  source: "Source",
  product: "Product",
  byproduct: "Byproduct",
  trash: "Trash",
  buffer: "Buffer",
  idle: "Drawer",
};

const EPS = 1e-6;
const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(EPS, 0.005 * Math.max(Math.abs(a), Math.abs(b)));

/** What limits the machines feeding this drawer, when one of them says so. */
function feederCause(project: FactoryProject, result: ThroughputResult | undefined, storageId: string): string | undefined {
  if (!result) return undefined;
  const feeders = new Set<string>();
  for (const edge of project.edges) {
    if (edge.target === storageId) feeders.add(edge.source);
  }
  for (const nodeId of feeders) {
    if (!project.nodes.some((node) => node.id === nodeId)) continue;
    const verdict = deriveNodeVerdict(project, result, nodeId);
    if ((verdict.kind === "starved" || verdict.kind === "blocked") && verdict.binding) {
      return `${verdict.binding.displayName} supply limits production.`;
    }
  }
  return undefined;
}

export function buildStorageTooltip(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  storage: FactoryStorage,
  role: StorageRole,
): RecipeTooltipView {
  const mode = tooltipMode(project);
  const strict = role === "buffer" && effectiveBufferMode(storage, project.solveMode === true) === "strict";
  const figures: StorageThroughputResult | undefined = result?.storages[storage.id];
  const rate = (value: number) => formatSlotRate(value, storage.kind);
  const view: RecipeTooltipView = {
    title: resourceLabel(getCategoryPresentation(project.recipes, storage.kind, storage.resourceId)
      ?? { id: storage.resourceId, displayName: storage.displayName }),
    subtitle: role === "buffer" && storage.bufferMode === "ratio" ? "Buffer · Ratio" : strict ? "Buffer · Strict" : ROLE_WORD[role],
    rows: [],
    // A drawer is a port with no rows to browse: dragging is its one gesture,
    // and in pool mode a drag lands nothing.
    actions: mode === "pool" ? [] : [{ gesture: "drag", label: "Drag to connect" }],
  };

  if (role === "idle") {
    return mode === "pool"
      ? { ...view, subtitle: "Drawer · Not pooled" }
      : { ...view, requirement: "You must connect it." };
  }
  if (mode === "pool" && role !== "product" && role !== "source") {
    // Only source/product drawers are live in Pool; other drawers stand inert.
    return { ...view, subtitle: `${view.subtitle} · Not pooled` };
  }
  if (!figures) {
    return { ...view, reason: "Calculation unavailable." };
  }

  const inRate = figures.producedPerSecond;
  const outRate = figures.consumedPerSecond;
  switch (role) {
    case "source": {
      const target = storage.targetPerSecond;
      const rule = storageTargetMode(storage, "source");
      if (mode !== "build" && target !== undefined) {
        view.rows.push({ label: rule === "ignore" ? "Saved target" : TARGET_MODE_LABELS[rule], value: rate(Math.abs(target)) });
        if (figures.targetUnreachable) view.reason = "No machine count meets this input rate with the current wires and targets.";
      }
      view.rows.push({ label: "Supplied", value: rate(outRate) });
      break;
    }
    case "product": {
      const target = storage.targetPerSecond;
      if (mode !== "build" && storageTargetMode(storage, role) === "ignore") {
        view.subtitle = "Ignored target";
        view.reason = "The saved amount does not drive production.";
        view.rows = target !== undefined ? [{ label: "Saved target", value: rate(target) }] : [];
        if ((target ?? 0) >= 0) view.rows.push({ label: "Produced", value: rate(inRate) });
        break;
      }
      if (mode !== "build" && target !== undefined && target < 0) {
        view.subtitle = "Input goal";
        view.rows = [{ label: "Consume", value: rate(-target) }, { label: "Consumed", value: rate(outRate) }];
        if (figures.targetUnreachable) view.reason = "No machine count consumes the requested input amount.";
        break;
      }
      const hasTarget = mode !== "build" && target !== undefined && (target > 0 || storageTargetMode(storage, role) === "exact");
      if (hasTarget) view.rows.push({ label: storageTargetMode(storage, role) === "exact" ? "Exactly" : "Required", value: rate(target) });
      view.rows.push({ label: "Produced", value: rate(inRate) });
      if (hasTarget && target > inRate + EPS && differs(target, inRate)) {
        view.rows.push({ label: "Shortfall", value: rate(target - inRate) });
        view.reason = figures.targetUnreachable
          ? "No machine count reaches the required amount."
          : feederCause(project, result, storage.id);
      }
      break;
    }
    case "byproduct":
      view.rows = [{ label: "Produced", value: rate(inRate) }];
      break;
    case "trash":
      view.rows = [{ label: "Discarded", value: rate(inRate) }];
      break;
    case "buffer": {
      view.rows = [
        { label: "In", value: rate(inRate) },
        { label: "Out", value: rate(outRate) },
      ];
      const net = inRate - outRate;
      if (differs(inRate, outRate)) {
        view.rows.push(net > 0 ? { label: "Stored", value: `+${rate(net)}` } : { label: "Drawn", value: `-${rate(-net)}` });
      }
      break;
    }
  }
  return view;
}

/** The required-amount field: the number, and what is reachable when it is not. */
export function buildTargetTooltip(storage: FactoryStorage, figures: StorageThroughputResult | undefined, poolMode = false, input = isInputRate(storage)): RecipeTooltipView {
  const target = storage.targetPerSecond;
  const rate = (value: number) => formatSlotRate(value, storage.kind);
  const rule = storageTargetMode(storage, input ? "source" : "product");
  const ignored = rule === "ignore";
  const exact = rule === "exact";
  const rows = target !== undefined ? [{ label: ignored ? "Saved target" : input ? (rule === "exact" ? "Consume" : TARGET_MODE_LABELS[rule]) : exact ? "Exactly" : "Required", value: rate(ignored ? target : Math.abs(target)) }] : [];
  if (figures?.targetUnreachable && figures.producedPerSecond >= 0) {
    rows.push({ label: "Reachable", value: rate(input ? figures.consumedPerSecond : figures.producedPerSecond) });
  }
  return { title: ignored ? "Ignored target" : input ? "Input goal" : exact ? "Exact output goal" : "Required amount", reason: targetModeHelp(rule, input), rows, bullets: ["Middle-click to clear the rate."], actions: [{ gesture: "left", label: "Edit amount" }] };
}

const NEXT_ACTION = (next: string): TooltipAction[] => [{ gesture: "left", label: `Switch to ${next}` }];

export function buildDrainKeyTooltip(role: StorageRole, next: string): RecipeTooltipView {
  return { title: ROLE_WORD[role], rows: [], actions: NEXT_ACTION(next) };
}

export function buildBufferKeyTooltip(mode: StorageBufferMode): RecipeTooltipView {
  if (mode === "ratio") return { title: "Ratio", subtitle: "Incoming, outgoing and setup output", rows: [], actions: NEXT_ACTION("overflow") };
  return mode === "strict"
    ? { title: "Strict", subtitle: "Surplus stalls the feeder", rows: [], actions: NEXT_ACTION("ratio") }
    : { title: "Non-strict", subtitle: "Surplus stored", rows: [], actions: NEXT_ACTION("strict") };
}
