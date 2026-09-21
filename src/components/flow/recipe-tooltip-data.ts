import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { getStorageRoles } from "@/lib/model/storage-role";
import { isRecipeInputConsumed } from "@/lib/model/resources";
import { getPoolProject } from "@/lib/solver/pool-mode";
import { hasAnySolveNumbers } from "@/lib/solver/throughput";
import type { NodeVerdict, RailPort } from "./node-verdict";
import { formatPct, formatSlotRate } from "./flow-explainers";

export type TooltipMode = "build" | "solve" | "pool";
export type TooltipTone = "neutral" | "good" | "warning";
export interface TooltipAction {
  gesture: "left" | "right" | "drag" | "wheel";
  label: string;
}
export interface RecipeTooltipView {
  title: string;
  subtitle?: string;
  mode?: TooltipMode;
  status?: { label: string; tone: TooltipTone };
  rows: Array<{ label: string; value: string }>;
  /**
   * A before/after ladder, three aligned columns, drawn before the rows: the
   * calculator's own table so a hover and the panel read the same way.
   */
  table?: {
    head: readonly [string, string, string];
    rows: Array<{ label: string; before: string; after: string; emphasis?: boolean }>;
  };
  reason?: string;
  /** Short lines in order, cause before consequence before what to do. */
  bullets?: readonly string[];
  requirement?: string;
  actions?: readonly TooltipAction[];
}

export function tooltipMode(project: Pick<FactoryProject, "poolMode" | "solveMode">): TooltipMode {
  return project.poolMode ? "pool" : project.solveMode ? "solve" : "build";
}

const BROWSE_ACTIONS: readonly TooltipAction[] = [
  { gesture: "left", label: "Recipes" },
  { gesture: "right", label: "Uses" },
];
const contextCache = new WeakMap<FactoryProject, {
  products: Set<string>;
  imports: Set<string>;
  hasTargets: boolean;
}>();

// Computed once per immutable project, not once per pointer movement or card.
function context(project: FactoryProject) {
  const cached = contextCache.get(project);
  if (cached) return cached;
  const products = new Set<string>();
  const imports = new Set<string>();
  if (project.poolMode) {
    const roles = getStorageRoles(project);
    for (const storage of project.storages ?? []) {
      if (roles.get(storage.id) === "product") products.add(`${storage.kind}:${storage.resourceId}`);
    }
    const expanded = getPoolProject(project);
    const expandedRoles = getStorageRoles(expanded);
    const originalIds = new Set((project.storages ?? []).map((s) => s.id));
    for (const storage of expanded.storages ?? []) {
      if (!originalIds.has(storage.id) && expandedRoles.get(storage.id) === "source") {
        imports.add(`${storage.kind}:${storage.resourceId}`);
      }
    }
  }
  const value = { products, imports, hasTargets: hasAnySolveNumbers(project) };
  contextCache.set(project, value);
  return value;
}

export function resourceTooltipActions(project: FactoryProject, port: RailPort): readonly TooltipAction[] {
  if (port.free || (port.resource && !isRecipeInputConsumed(port.resource) && port.side === "input")) {
    return [];
  }
  if (project.poolMode) {
    return port.side === "output" && !context(project).products.has(`${port.kind}:${port.resourceId}`)
      ? [...BROWSE_ACTIONS, { gesture: "drag", label: "Drag out for a product drawer" }]
      : BROWSE_ACTIONS;
  }
  return [...BROWSE_ACTIONS, { gesture: "drag", label: "Drag to connect" }];
}

export function buildStatusTooltip(verdict: NodeVerdict, mode: TooltipMode): RecipeTooltipView {
  const view: RecipeTooltipView = { title: "Machine status", mode, rows: [] };
  const binding = verdict.binding;
  switch (verdict.kind) {
    case "off": return { ...view, title: "Disabled" };
    case "no-recipe": return { ...view, title: "No recipe", requirement: "You must select a recipe." };
    case "unwired": {
      if (mode === "pool") return { ...view, title: "Supply unavailable", reason: "Shared resource supply is unavailable." };
      const slots = [...(verdict.bare?.inputs ?? []), ...(verdict.bare?.outputs ?? [])];
      return { ...view, title: "Unconnected slots",
        reason: slots.length <= 2 ? slots.map(s => s.displayName).join(", ") || undefined : `${slots.length} slots are unconnected.`,
        requirement: "You must connect the required inputs and outputs." };
    }
    case "blocked":
    case "starved":
      return { ...view, title: "Input shortage", reason: binding ? `${binding.displayName} limits production.${binding.tiedWithNames?.length ? ` Also limited by ${binding.tiedWithNames.join(", ")}.` : ""}` : "Input supply limits production.",
        rows: binding ? [
          { label: "Required", value: formatSlotRate(binding.neededPerSecond, binding.kind) },
          { label: "Available supply", value: formatSlotRate(binding.suppliedPerSecond, binding.kind) },
        ] : [] };
    case "bottleneck": return { ...view, title: "Capacity exceeded", reason: verdict.deficit ? `${verdict.deficit.displayName} demand exceeds capacity.` : "Demand exceeds machine capacity.",
      rows: verdict.deficit ? [{ label: "Shortfall", value: formatSlotRate(verdict.deficit.missingPerSecond, verdict.deficit.kind) }] : [] };
    case "clogged": return { ...view, title: "Output limited", reason: verdict.clog?.stoppedTakerName
      ? `${verdict.clog.stoppedTakerName} has stopped.`
      : verdict.clog?.heldTakerName ? `${verdict.clog.heldTakerName} limits ${verdict.clog.displayName} output.`
      : `${verdict.clog?.displayName ?? "Output"} cannot be removed at full rate.` };
    case "dead-loop": return { ...view, title: "Recycling deficit", reason: "The recycling loop cannot sustain its required inputs." };
    case "clog-lock": return { ...view, title: "Recycling output blocked", reason: "Surplus output prevents the recycling loop from running." };
    case "demand-set": return { ...view, title: verdict.pct <= 0.05 ? "No demand" : "Demand met", reason: "Production matches current demand." };
    case "paced": return { ...view, title: "Production balanced", reason: "Supply and demand determine the operating rate." };
    case "busy": return { ...view, title: "Machine time shared", reason: verdict.busy
      ? `${verdict.busy.sharerName} takes ${verdict.busy.sharerPct}% of this machine's time.`
      : "Other recipes on this machine take its time.",
      requirement: "Add machines to run every recipe at full rate." };
    case "balanced": return { ...view, title: "Full capacity", reason: "Current demand is met." };
  }
}

export function buildPortTooltip(
  project: FactoryProject, result: ThroughputResult | undefined,
  nodeId: string, port: RailPort, verdict: NodeVerdict,
): RecipeTooltipView {
  const mode = tooltipMode(project);
  const isInput = port.side === "input";
  const view: RecipeTooltipView = {
    title: port.displayName, subtitle: isInput ? "Input" : "Output", rows: [],
    actions: resourceTooltipActions(project, port),
  };
  if (port.free || (isInput && port.resource && !isRecipeInputConsumed(port.resource))) {
    return { ...view, subtitle: "Required resource", reason: "Not consumed." };
  }
  const ctx = context(project);
  if (mode !== "build" && !ctx.hasTargets) {
    return { ...view, status: { label: "No target", tone: "neutral" }, requirement: "Set an input/output rate or pin a machine count." };
  }
  const nodeResult = result?.nodes[nodeId];
  if (!nodeResult) return { ...view, reason: "Calculation unavailable." };
  if (!nodeResult.enabled) return { ...view, status: { label: "Disabled", tone: "neutral" } };
  if (mode !== "pool" && !port.connected && !port.boundaryFree) {
    return { ...view, status: { label: "Unconnected", tone: "warning" }, requirement: `You must connect this ${port.side}.` };
  }
  const rate = (value: number) => formatSlotRate(value, port.kind);
  const binding = verdict.binding?.resourceKey === port.key;
  const imported = mode === "pool" && isInput && ctx.imports.has(`${port.kind}:${port.resourceId}`);
  if (isInput) {
    view.subtitle = imported ? "Imported input" : "Input";
    if (binding && (verdict.kind === "starved" || verdict.kind === "blocked") && verdict.binding) {
      view.status = { label: "Supply limited", tone: "warning" };
      view.rows = [
        { label: "Required", value: rate(verdict.binding.neededPerSecond) },
        { label: "Available supply", value: rate(verdict.binding.suppliedPerSecond) },
      ];
      view.reason = "Input supply limits production.";
    } else {
      view.rows = [{ label: imported ? "Imported" : "Consumed", value: rate(port.currentPerSecond) }];
      if (mode === "build" && port.currentPerSecond < port.nameplatePerSecond * 0.995) {
        view.rows.push({ label: "At full capacity", value: rate(port.nameplatePerSecond) });
      }
      if (imported) view.reason = "No producer is present in this plan.";
      else if (mode === "pool") view.reason = "Supplied by the shared resource pool.";
    }
  } else {
    const chance = port.resource && "chance" in port.resource ? port.resource.chance : undefined;
    view.rows = [{ label: typeof chance === "number" && chance < 1 ? "Average output" : "Produced", value: rate(port.currentPerSecond) }];
    // The pool's aggregate demand belongs to the whole pool, not this producer.
    if (mode === "pool") view.reason = "Output enters the shared resource pool.";
    else if (port.wantedPerSecond > port.currentPerSecond * 1.005) {
      view.rows.push({ label: "Required downstream", value: rate(port.wantedPerSecond) });
    }
  }
  if (nodeResult.powerStalled) view.reason = "Power configuration prevents operation.";
  else if (verdict.kind === "clogged") view.reason = buildStatusTooltip(verdict, mode).reason;
  else if (!binding && (verdict.kind === "starved" || verdict.kind === "blocked")) {
    view.reason = `${verdict.binding?.displayName ?? "Another input"} limits production.`;
  }
  return view;
}

export function buildDemandTooltip(port: RailPort): RecipeTooltipView {
  const plug = port.plug;
  const rate = (value: number) => formatSlotRate(value, port.kind);
  if (!plug) return { title: port.displayName, subtitle: "Demand", rows: [] };
  const dumping = plug.state === "dump";
  return {
    title: port.displayName, subtitle: dumping ? "Destination" : "Downstream demand",
    rows: dumping ? [{ label: plug.dumpKind === "trash" ? "Discarded" : "Transferred", value: rate(plug.getPerSecond) }]
      : [{ label: "Required", value: rate(plug.askPerSecond) }, { label: "Delivered", value: rate(plug.getPerSecond) }],
    reason: plug.state === "blocked" ? "Upstream supply limits delivery."
      : plug.state === "clogged" ? "Another output limits production."
      : plug.state === "hungry" ? "Demand exceeds available capacity."
      : plug.askerName ? `Consumer: ${plug.askerName}` : undefined,
  };
}

export function buildCountTooltip(needed: number | undefined, pinned?: number): RecipeTooltipView {
  const isPinned = pinned !== undefined && pinned > 0;
  const value = isPinned ? pinned : needed;
  const count = (n: number) => n > 0 && n < 0.001 ? "<0.001" : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const whole = value === undefined ? 0 : value > 0 ? Math.max(1, Math.ceil(value - 0.000001)) : 0;
  return {
    title: isPinned ? "Pinned machines" : "Required machines",
    rows: value === undefined ? [] : [
      { label: isPinned ? "Fixed count" : "Calculated count", value: count(value) },
      ...(value > 0 && Math.abs(whole - value) > 0.000001 ? [
        { label: "Whole machines", value: String(whole) },
        { label: "Average utilization", value: `${formatPct(value / whole * 100)}%` },
      ] : []),
    ],
    reason: value === undefined ? "Calculation unavailable." : value <= 0 ? "No production target requires this machine." : undefined,
    actions: [{ gesture: "left", label: isPinned ? "Edit pin" : "Pin count" }],
  };
}
