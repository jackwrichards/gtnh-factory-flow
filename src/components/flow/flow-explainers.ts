import type { EdgeThroughput, FactoryProject, ThroughputResult } from "@/lib/model/types";
import { formatNumberWithThousands, formatRate, makeResourceKey } from "@/lib/model";
import { rateUnitMultiplier, rateUnitSuffix } from "@/lib/model/rate-unit";
import { parseResourceHandleId } from "./resource-handles";
import { honestEdgeAskPerSecond, type NodeVerdict, type RailPort } from "./node-verdict";

const PLUG_STATE_WORD = {
  hungry: "HUNGRY",
  blocked: "BLOCKED UPSTREAM",
  fed: "FED",
  dump: "DUMP",
} as const;

const PLUG_STATE_TONE = {
  hungry: "amber",
  blocked: "red",
  fed: "green",
  dump: "dim",
} as const;

/**
 * Plain-English explainers for ports and lines. Copy rules, per the design
 * contract: one line for what's happening, one for why, one for what to do.
 * Everyday words, numbers bold(ed by the renderer), never a wall of text —
 * written for a first-time player as much as for a glance.
 *
 * Everything here reads the honest full-blast figures (nameplate asks,
 * availability), never the solver's damped converged demand.
 */

type ProjectEdge = FactoryProject["edges"][number];

const EPS = 1e-6;
/** Ratios this close to 1 are float noise, not a real difference. */
const TOL = 0.005;

export function formatSlotRate(value: number, kind: string): string {
  const scaled = value * rateUnitMultiplier();
  // Three decimals below 0.01 so slow drips (crop drops, chanced outputs)
  // don't render as a flat 0.00/s.
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : scaled >= 0.01 ? 2 : 3;
  return `${formatRate(scaled, digits)}${rateUnitSuffix(kind === "fluid")}`;
}

export function formatSlotRateBare(value: number): string {
  const scaled = value * rateUnitMultiplier();
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : scaled >= 0.01 ? 2 : 3;
  return formatRate(scaled, digits);
}

/**
 * Noise floor: anything that would render as a bare zero doesn't render at
 * all. This is what kills "−0.000 kL/s" badges forever.
 */
export function formatSlotRateOrNull(value: number, kind: string): string | null {
  if (!Number.isFinite(value) || value * rateUnitMultiplier() < 0.0005) {
    return null;
  }
  return formatSlotRate(value, kind);
}

/** Display percent: whole numbers, capped so drawers can't print 41200%. */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value);
  return rounded > 999 ? "999+" : String(rounded);
}

/** "×6.2" style multiplier for asks bigger than the machine. */
export function formatTimes(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio >= 9999.5) {
    // Real magnitudes teach better than a cap, but four digits is the limit
    // of useful; beyond that (or a zero-flow division) it's just "hopeless".
    return "×9999+";
  }
  return ratio >= 10
    ? `×${formatNumberWithThousands(String(Math.round(ratio)))}`
    : `×${formatRate(ratio, 1)}`;
}

/** Whether an edge plugs into a port carrying this resource on this side. */
export function edgeTouchesResource(
  edge: ProjectEdge,
  side: "input" | "output",
  kind: string,
  resourceId: string,
): boolean {
  const handle = side === "input" ? edge.targetHandle : edge.sourceHandle;
  const parsed = parseResourceHandleId(handle);
  if (parsed && parsed.kind === kind && parsed.resourceId === resourceId) {
    return true;
  }
  return edge.resourceKind === kind && edge.resourceId === resourceId;
}

export interface PortLineRow {
  name: string;
  ratePerSecond: number;
  isStorage: boolean;
  /** Input rows: whether this line's source has nothing left to give. */
  supplyCapped?: boolean;
  /** Input rows: the source machine's own speed (undefined for buffers). */
  sourcePct?: number;
  /** Output rows: the consumer's honest ask through this line. */
  wantedPerSecond?: number;
}

export interface PortBreakdown {
  rows: PortLineRow[];
  routedPerSecond: number;
  /** Output side: what machine consumers honestly want (buffers excluded). */
  wantedByMachinesPerSecond: number;
  /** Output side: what buffers currently soak up. */
  storageTakePerSecond: number;
}

/**
 * Per-line detail for a port: who is on the other end, what flows, and the
 * far machine's own state. Lines match by resource — directly or through the
 * edge's stored handle — so legacy per-slot handles and oredict concretions
 * all land on the pooled port.
 */
export function buildPortBreakdown(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
  port: Pick<RailPort, "side" | "kind" | "resourceId">,
): PortBreakdown | undefined {
  if (!result) {
    return undefined;
  }

  const isInput = port.side === "input";
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));

  const rows: PortLineRow[] = [];
  let routed = 0;
  let wantedByMachines = 0;
  let storageTake = 0;
  for (const edge of project.edges) {
    if ((isInput ? edge.target : edge.source) !== nodeId) {
      continue;
    }
    if (!edgeTouchesResource(edge, port.side, port.kind, port.resourceId)) {
      continue;
    }

    const otherId = isInput ? edge.source : edge.target;
    const storage = storagesById.get(otherId);
    const otherNode = nodesById.get(otherId);
    const otherRecipe = otherNode ? recipesById.get(otherNode.recipeId) : undefined;
    const name = storage
      ? `${storage.displayName ?? storage.resourceId} (buffer)`
      : (otherRecipe?.machineType ?? otherRecipe?.name ?? "Machine");
    const edgeResult = result.edges[edge.id];
    const rate = edgeResult?.transferredPerSecond ?? 0;
    routed += rate;

    if (isInput) {
      const sourceResult = storage ? undefined : result.nodes[otherId];
      rows.push({
        name,
        ratePerSecond: rate,
        isStorage: Boolean(storage),
        supplyCapped: edgeResult?.constraint === "supply",
        sourcePct:
          sourceResult && Number.isFinite(sourceResult.utilization)
            ? Math.round(Math.min(Math.max(sourceResult.utilization, 0), 1) * 1000) / 10
            : undefined,
      });
    } else {
      const wanted = storage
        ? rate
        : honestEdgeAskPerSecond(edgeResult, result.nodes[edge.target], edge);
      if (storage) {
        storageTake += rate;
      } else {
        wantedByMachines += wanted;
      }
      rows.push({ name, ratePerSecond: rate, isStorage: Boolean(storage), wantedPerSecond: wanted });
    }
  }

  if (rows.length === 0) {
    return undefined;
  }
  rows.sort((left, right) => right.ratePerSecond - left.ratePerSecond);
  return {
    rows,
    routedPerSecond: routed,
    wantedByMachinesPerSecond: wantedByMachines,
    storageTakePerSecond: storageTake,
  };
}

export interface PortStory {
  stateWord: string;
  tone: "red" | "amber" | "green" | "steel" | "dim";
  /** The number rows under the bar: label → value. */
  rows: Array<{ k: string; v: string }>;
  /** Per-line list ("Supplied by 2 lines" / "Feeding 3 lines"). */
  lineRows?: { title: string; rows: Array<{ name: string; note?: string; rate: string }> };
  /** The plain answer: what's happening, why. */
  lines: string[];
  action?: { text: string; tone: "fix" | "fine" | "note" };
}

/** The everyday-English story a port hover tells. */
export function explainPort(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
  port: RailPort,
  verdict: NodeVerdict,
): PortStory {
  const breakdown = buildPortBreakdown(project, result, nodeId, port);
  return port.side === "input"
    ? explainInputPort(port, verdict, breakdown)
    : explainOutputPort(port, verdict, breakdown);
}

/**
 * The plug hover, minimum viable: who asks, `asks X · gets Y` per line, one
 * line saying why the chip shows its percent, one fix. Nothing else.
 */
export function explainPlug(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  nodeId: string,
  port: RailPort,
): PortStory | undefined {
  const plug = port.plug;
  if (!plug || port.side !== "output") {
    return undefined;
  }

  const fmt = (value: number) => formatSlotRate(value, port.kind);
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));

  const rows: Array<{ name: string; note?: string; rate: string }> = [];
  for (const edge of project.edges) {
    if (edge.source !== nodeId || !edgeTouchesResource(edge, "output", port.kind, port.resourceId)) {
      continue;
    }
    const edgeResult = result?.edges[edge.id];
    const gets = edgeResult?.transferredPerSecond ?? 0;
    const storage = storagesById.get(edge.target);
    if (storage) {
      const storageName = `${storage.displayName ?? storage.resourceId}`;
      const hasConsumers = project.edges.some((candidate) => candidate.source === edge.target);
      if (!hasConsumers) {
        rows.push({ name: storageName, note: "dead end", rate: fmt(gets) });
        continue;
      }
      let consumersAsk = 0;
      let consumers = 0;
      for (const out of project.edges) {
        if (out.source !== edge.target) {
          continue;
        }
        consumers += 1;
        consumersAsk += honestEdgeAskPerSecond(result?.edges[out.id], result?.nodes[out.target], out);
      }
      rows.push({
        name: `via ${storageName}`,
        note: `${consumers} taker${consumers === 1 ? "" : "s"}`,
        rate: `ask ${formatSlotRateBare(consumersAsk)} · in ${formatSlotRateBare(gets)}`,
      });
      continue;
    }
    const targetNode = nodesById.get(edge.target);
    const recipe = targetNode ? recipesById.get(targetNode.recipeId) : undefined;
    const targetResult = result?.nodes[edge.target];
    const pct =
      targetResult && Number.isFinite(targetResult.utilization)
        ? Math.round(Math.min(Math.max(targetResult.utilization, 0), 1) * 100)
        : undefined;
    rows.push({
      name: recipe?.machineType ?? recipe?.name ?? "Machine",
      note: pct !== undefined ? `at ${pct}%` : undefined,
      rate: `asks ${formatSlotRateBare(
        honestEdgeAskPerSecond(edgeResult, targetResult, edge),
      )} · gets ${formatSlotRateBare(gets)}`,
    });
  }

  const machineCount = Math.max(1, nodesById.get(nodeId)?.machineCount ?? 1);
  const perMachine = port.nameplatePerSecond / machineCount;
  // From FULL BLAST: free headroom counts before new machines do.
  const missingAtFull = Math.max(0, plug.askPerSecond - port.nameplatePerSecond);
  const toAdd =
    perMachine > EPS && missingAtFull > EPS
      ? Math.min(9999, Math.ceil(missingAtFull / perMachine - EPS))
      : undefined;

  const lineRows = rows.length > 0 ? { title: "Plugged in", rows } : undefined;
  const coveredPct = formatPct(plug.coveredFraction * 100);

  let lines: string[];
  let action: PortStory["action"];
  switch (plug.state) {
    case "hungry":
      lines = [`${coveredPct}% = asked ${fmt(plug.askPerSecond)}, this puts in ${fmt(plug.getPerSecond)}.`];
      action = {
        text: toAdd ? `→ +${toAdd} machines here (or higher tier).` : "→ Add machines here.",
        tone: "fix",
      };
      break;
    case "blocked":
      lines = [`${coveredPct}% = asked ${fmt(plug.askPerSecond)}, this puts in ${fmt(plug.getPerSecond)}.`];
      action = { text: "→ This machine is starving — fix its red input first.", tone: "fix" };
      break;
    case "fed":
      lines = [`100% = every ask met (${fmt(plug.askPerSecond)}).`];
      break;
    case "dump":
      lines = [`Dead end: ${fmt(plug.getPerSecond)} goes in, nothing draws from it.`];
      break;
  }

  return {
    stateWord: PLUG_STATE_WORD[plug.state],
    tone: PLUG_STATE_TONE[plug.state],
    rows: [],
    lineRows,
    lines,
    action,
  };
}

function supplierNote(row: PortLineRow): string | undefined {
  if (row.isStorage) {
    return "buffer";
  }
  if (row.sourcePct === undefined) {
    return undefined;
  }
  return row.sourcePct >= 99.5 ? "at full speed" : `runs at ${formatPct(row.sourcePct)}%`;
}

function explainOutputPort(
  port: RailPort,
  verdict: NodeVerdict,
  breakdown: PortBreakdown | undefined,
): PortStory {
  const current = port.currentPerSecond;
  const nameplate = port.nameplatePerSecond;
  const wanted = port.wantedPerSecond;
  const fmt = (value: number) => formatSlotRate(value, port.kind);
  const machineWant = breakdown?.wantedByMachinesPerSecond ?? 0;
  const storageTake = breakdown?.storageTakePerSecond ?? 0;

  // Minimum viable: the chip already shows the rate and the bar; the hover
  // owes one line of why (the machine's story) and at most one action. The
  // asker list lives on the plug's hover, not here.
  if (!port.connected) {
    if (current <= EPS) {
      return { stateWord: "IDLE", tone: "dim", rows: [], lines: ["Not running."] };
    }
    return {
      stateWord: "LEFTOVER",
      tone: "dim",
      rows: [],
      lines: [`${fmt(current)} vanishes — nothing wired.`],
      action: { text: "→ Wire a buffer to keep it.", tone: "note" },
    };
  }

  if (verdict.kind === "starved") {
    if (wanted > nameplate * (1 + TOL)) {
      return {
        stateWord: "SQUEEZED",
        tone: "red",
        rows: [],
        lines: [`At ${formatPct(verdict.pct)}% (starving) — and plugs want ${fmt(wanted)}, over its ${fmt(nameplate)} max.`],
        action: { text: "→ Fix the red input first; add machines after.", tone: "fix" },
      };
    }
    return {
      stateWord: "SLOWED",
      tone: "red",
      rows: [],
      lines: [
        `At ${formatPct(verdict.pct)}% — ${verdict.binding?.displayName ?? "an ingredient"} is the bottleneck (red input).`,
      ],
      action: { text: "→ Fix the red input; this follows.", tone: "fix" },
    };
  }

  if (machineWant < current - Math.max(EPS, current * TOL)) {
    const spare = current - machineWant;
    return {
      stateWord: "EXTRA",
      tone: "green",
      rows: [],
      lines: [
        `Makes ${fmt(current)}, plugs take ${fmt(machineWant)} — ${fmt(spare)} ${
          storageTake >= spare - EPS ? "goes to the buffer" : "vanishes"
        }.`,
      ],
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "CALM",
      tone: "steel",
      rows: [],
      lines: [`At ${formatPct(verdict.pct)}% — all that's asked. Could do ${fmt(nameplate)}.`],
    };
  }

  if (port.plug?.state === "hungry") {
    const times = nameplate > EPS ? formatTimes(port.plug.askPerSecond / nameplate) : "×?";
    return {
      stateWord: "DONE",
      tone: "green",
      rows: [],
      lines: [`Full speed. The plug wants ${times} more — hover the plug for the fix.`],
    };
  }

  return {
    stateWord: "DONE",
    tone: "green",
    rows: [],
    lines: ["Full speed, everything gets used."],
  };
}

function explainInputPort(
  port: RailPort,
  verdict: NodeVerdict,
  breakdown: PortBreakdown | undefined,
): PortStory {
  const need = port.nameplatePerSecond;
  const could = port.couldPerSecond;
  const fmt = (value: number) => formatSlotRate(value, port.kind);
  const couldPct = need > EPS ? (could / need) * 100 : 0;

  // Minimum viable: the supplier list with rates, one line of why, one fix.
  const lineRows =
    breakdown && breakdown.rows.length > 0
      ? {
          title: "Supplied by",
          rows: breakdown.rows.map((row) => ({
            name: row.name,
            note: supplierNote(row),
            rate: fmt(row.ratePerSecond),
          })),
        }
      : undefined;

  if (port.handFed) {
    return {
      stateWord: "HAND-FED",
      tone: "dim",
      rows: [],
      lines: [`Nothing wired — the planner assumes hand-feeding (${fmt(need)} at max).`],
      action: { text: "→ Wire a source to check it.", tone: "note" },
    };
  }

  if (
    verdict.kind === "starved" &&
    (verdict.binding?.resourceKey === port.key ||
      verdict.binding?.tiedKeys?.includes(port.key) === true)
  ) {
    const binding = verdict.binding;
    const upstream = binding.upstream;
    const tieNote = binding.tiedWithNames?.length
      ? ` Tied with ${
          binding.resourceKey === port.key
            ? binding.tiedWithNames.join(", ")
            : [binding.displayName, ...binding.tiedWithNames.filter((name) => name !== port.displayName)].join(", ")
        } — the figures can't split them.`
      : "";
    const whyLine = `Bottleneck: gets ${fmt(binding.suppliedPerSecond)} of ${fmt(binding.neededPerSecond)} — machine at ${formatPct(verdict.pct)}%.${tieNote}`;
    const action: PortStory["action"] = {
      tone: "fix",
      text:
        upstream?.kind === "loop"
          ? "→ Fed by its own loop — prime it from a buffer."
          : upstream?.kind === "buffer"
            ? `→ ${upstream.name} is running dry — feed it faster.`
            : upstream?.atFullSpeed
              ? `→ ${upstream.name} is maxed — add ${upstream.machinesToAdd ? `+${upstream.machinesToAdd}` : "more"} there.`
              : upstream?.hasHeadroom
                ? `→ ${upstream.name} can make more — add ${upstream.machinesToAdd ? `+${upstream.machinesToAdd}` : "machines"} there.`
                : upstream
                  ? `→ ${upstream.name} at ${formatPct(upstream.pct)}% — it's starving too, fix above it.`
                  : "→ Add more of the machine making it.",
    };
    return { stateWord: "BOTTLENECK", tone: "red", rows: [], lineRows, lines: [whyLine], action };
  }

  if (verdict.kind === "starved") {
    const bindingName = verdict.binding?.displayName ?? "another ingredient";
    const bufferFed = !Number.isFinite(couldPct);
    return {
      stateWord: "NOT THE PROBLEM",
      tone: "steel",
      rows: [],
      lineRows,
      lines: [
        bufferFed
          ? `Not the limit — ${bindingName} is. This is buffer-fed: delivers on demand, never the cap.`
          : `Not the limit — ${bindingName} is.`,
      ],
      action:
        !bufferFed && couldPct < 99.5
          ? {
              text: `→ After that's fixed, THIS becomes the next bottleneck, at ${formatPct(couldPct)}%.`,
              tone: "note",
            }
          : undefined,
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "THROTTLED",
      tone: "steel",
      rows: [],
      lineRows,
      lines: [`Machine throttled to ${formatPct(verdict.pct)}% by demand — supply is fine.`],
    };
  }

  const bufferFed = !Number.isFinite(couldPct);
  return {
    stateWord: "COVERED",
    tone: "green",
    rows: [],
    lineRows,
    lines: [
      bufferFed
        ? "Fully supplied — buffer on tap, delivers on demand."
        : couldPct > 105
          ? `Fully supplied — lines could bring ${formatTimes(could / Math.max(need, EPS))}.`
          : "Fully supplied.",
    ],
  };
}

export interface EdgeStory {
  stateWord: string;
  tone: PortStory["tone"];
  carriesText: string;
  from: { name: string; note?: string };
  to: Array<{ name: string; text: string }>;
  lines: string[];
  action?: PortStory["action"];
}

/**
 * The line's story, told from BOTH ends: what the maker puts in and why that
 * amount, what each receiver wanted, and who is holding the flow back. For a
 * bundled label the receivers list carries every member line.
 */
export function buildEdgeStory(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  edgeIds: string[],
): EdgeStory | undefined {
  if (!result) {
    return undefined;
  }
  const edgesById = new Map(project.edges.map((entry) => [entry.id, entry]));
  const edges = edgeIds
    .map((id) => edgesById.get(id))
    .filter((entry): entry is ProjectEdge => Boolean(entry));
  if (edges.length === 0) {
    return undefined;
  }

  const first = edges[0]!;
  const kind = first.resourceKind;
  const fmt = (value: number) => formatSlotRate(value, kind);
  const storagesById = new Map((project.storages ?? []).map((storage) => [storage.id, storage]));
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const machineName = (nodeId: string): string => {
    const node = nodesById.get(nodeId);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    return recipe?.machineType ?? recipe?.name ?? "Machine";
  };

  let carries = 0;
  for (const edge of edges) {
    carries += result.edges[edge.id]?.transferredPerSecond ?? 0;
  }

  // ---- the giving end -------------------------------------------------
  const sourceStorage = storagesById.get(first.source);
  const sourceResult = result.nodes[first.source];
  const giverName = sourceStorage
    ? `${sourceStorage.displayName ?? sourceStorage.resourceId} (buffer)`
    : machineName(first.source);
  let giverNote: string | undefined;
  let giverAtFullSpeed = false;
  let giverPct = 100;
  if (sourceStorage) {
    giverNote = "sends what it holds";
  } else if (sourceResult) {
    const utilization = Number.isFinite(sourceResult.utilization)
      ? Math.min(Math.max(sourceResult.utilization, 0), 1)
      : 0;
    const capable = Number.isFinite(sourceResult.capableUtilization)
      ? Math.min(Math.max(sourceResult.capableUtilization ?? 1, 0), 1)
      : 1;
    giverPct = Math.round(utilization * 1000) / 10;
    giverAtFullSpeed = giverPct >= 99.5;
    giverNote = giverAtFullSpeed
      ? "at full speed"
      : capable < 0.995
        ? `runs at ${formatPct(giverPct)}% — missing ingredients too`
        : `runs at ${formatPct(giverPct)}% — could send more if asked`;
  }

  // ---- the receiving end(s) -------------------------------------------
  const to: EdgeStory["to"] = [];
  let wantedByMachines = 0;
  let getsByMachines = 0;
  let machineReceivers = 0;
  let lastMachineReceiver: string | undefined;
  for (const edge of edges) {
    const edgeResult = result.edges[edge.id];
    const gets = edgeResult?.transferredPerSecond ?? 0;
    const targetStorage = storagesById.get(edge.target);
    if (targetStorage) {
      to.push({
        name: `${targetStorage.displayName ?? targetStorage.resourceId} (buffer)`,
        text: `takes whatever arrives — ${fmt(gets)}`,
      });
      continue;
    }

    const wanted = honestEdgeAskPerSecond(edgeResult, result.nodes[edge.target], edge);
    wantedByMachines += wanted;
    getsByMachines += gets;
    machineReceivers += 1;
    const receiverName = machineName(edge.target);
    lastMachineReceiver = receiverName;

    const siblings = project.edges.filter(
      (candidate) =>
        candidate.target === edge.target &&
        edgeTouchesResource(candidate, "input", edge.resourceKind, edge.resourceId),
    ).length;
    let shareNote = "";
    if (siblings > 1) {
      const targetResult = result.nodes[edge.target];
      const key = makeResourceKey(edge.resourceKind, edge.resourceId);
      const totalNeed =
        targetResult?.inputs[key as keyof typeof targetResult.inputs]?.amountPerSecond ??
        Object.values(targetResult?.inputs ?? {}).find(
          (flow) => flow.resourceId === edge.resourceId,
        )?.amountPerSecond;
      shareNote = totalNeed
        ? ` — its share of ${fmt(totalNeed)} over ${siblings} lines`
        : ` — one of ${siblings} lines`;
    }

    to.push({
      name: receiverName,
      text:
        wanted > gets + Math.max(EPS, wanted * TOL)
          ? `wants ${fmt(wanted)}, gets ${fmt(gets)}${shareNote}`
          : `gets the ${fmt(gets)} it asks for${shareNote}`,
    });
  }

  // ---- the verdict ------------------------------------------------------
  const supplyCapped = edges.some(
    (edge) =>
      !storagesById.has(edge.target) && result.edges[edge.id]?.constraint === "supply",
  );

  if (supplyCapped) {
    const coverPct =
      wantedByMachines > EPS ? (getsByMachines / wantedByMachines) * 100 : 100;
    const receiverPhrase =
      machineReceivers === 1 && lastMachineReceiver
        ? `the ${lastMachineReceiver}`
        : `the ${machineReceivers} machines it feeds`;
    const lines = [
      `This line carries everything its maker has — ${fmt(carries)} — but that covers only ${formatPct(coverPct)}% of what ${receiverPhrase} wants.`,
    ];
    let action: EdgeStory["action"];
    if (sourceStorage) {
      lines.push("The buffer can't refill as fast as it drains.");
      action = { text: `→ Feed ${giverName} faster, or add another source.`, tone: "fix" };
    } else if (giverAtFullSpeed) {
      lines.push(`The ${giverName} is already at full speed.`);
      const missing = Math.max(0, wantedByMachines - getsByMachines);
      const sourceNode = nodesById.get(first.source);
      const key = makeResourceKey(first.resourceKind, first.resourceId);
      const sourceFlow =
        sourceResult?.outputs[key as keyof typeof sourceResult.outputs] ??
        Object.values(sourceResult?.outputs ?? {}).find(
          (flow) => flow.resourceId === first.resourceId,
        );
      const perMachine = sourceFlow
        ? sourceFlow.amountPerSecond / Math.max(1, sourceNode?.machineCount ?? 1)
        : 0;
      const toAdd =
        perMachine > EPS && missing > EPS
          ? Math.min(9999, Math.ceil(missing / perMachine - EPS))
          : undefined;
      action = {
        text: toAdd ? `→ Add +${toAdd} ${giverName}.` : `→ Add more ${giverName}.`,
        tone: "fix",
      };
    } else {
      lines.push(`And the ${giverName} runs at just ${formatPct(giverPct)}% — it's missing ingredients too.`);
      action = {
        text: `→ The real fix is upstream of the ${giverName} — follow the chain.`,
        tone: "fix",
      };
    }
    return {
      stateWord: "BOTTLENECK",
      tone: "red",
      carriesText: fmt(carries),
      from: { name: giverName, note: giverNote },
      to,
      lines,
      action,
    };
  }

  if (machineReceivers === 0) {
    return {
      stateWord: "TO BUFFER",
      tone: "steel",
      carriesText: fmt(carries),
      from: { name: giverName, note: giverNote },
      to,
      lines: [`Flows into the buffer at ${fmt(carries)}.`],
    };
  }

  const lines = [`Delivers exactly what's asked: ${fmt(carries)}.`];
  const outlets = project.edges.filter(
    (candidate) =>
      candidate.source === first.source &&
      edgeTouchesResource(candidate, "output", first.resourceKind, first.resourceId),
  ).length;
  let capacity = 0;
  for (const edge of edges) {
    capacity = Math.max(capacity, result.edges[edge.id]?.sourceCapacityPerSecond ?? 0);
  }
  if (!sourceStorage && outlets === edges.length && capacity > carries * 1.05) {
    lines.push(`The ${giverName} could send ${fmt(capacity)} — ${fmt(capacity - carries)} spare.`);
  }
  return {
    stateWord: "OK",
    tone: "green",
    carriesText: fmt(carries),
    from: { name: giverName, note: giverNote },
    to,
    lines,
    action: { text: "Nothing to fix.", tone: "fine" },
  };
}
