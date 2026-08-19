import type { EdgeThroughput, FactoryProject, ThroughputResult } from "@/lib/model/types";
import { formatCompact, formatNumberWithThousands, formatRate, makeResourceKey } from "@/lib/model";
import { rateUnitMultiplier, rateUnitPrecisionScale, rateUnitSuffix } from "@/lib/model/rate-unit";
import { describeStorage, getStorageRoles } from "@/lib/model/storage-role";
import { parseResourceHandleId } from "./resource-handles";
import {
  honestEdgeAskPerSecond,
  isSupplyShort,
  type NodeVerdict,
  type RailPort,
} from "./node-verdict";

const PLUG_STATE_WORD = {
  hungry: "HUNGRY",
  blocked: "BLOCKED UPSTREAM",
  clogged: "HELD BY A CLOG",
  fed: "FED",
  dump: "DUMP",
} as const;

/**
 * A dead end is named by the end it reaches, not by the word "dump" — only
 * the trash can actually destroys anything, and a player reading DUMP over a
 * tank they deliberately wired has been told their plan is wrong.
 */
const PLUG_DUMP_WORD = {
  trash: "TRASH",
  tank: "DRAIN",
  store: "DRAIN",
} as const;

/**
 * A plug takes the colour of the card it sits on, because it is the same
 * fact: a short plug on a fed machine IS the bottleneck (red, act here), and
 * a short plug on a supply-short one IS what makes that card blocked (amber,
 * act upstream). One colour per card, whatever surface is carrying it.
 */
const PLUG_STATE_TONE = {
  hungry: "red",
  blocked: "amber",
  // Steel, matching the card: a clog is a fact about the plan, not a fault,
  // and it must not join the two states that really are on the to-do list.
  clogged: "steel",
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

/**
 * Port rates go through the compact ladder: a mega multiblock moving
 * 1,440,000 L/s has to fit a 118px chip, and a chanced output at 0.004/s has
 * to stay visible instead of rounding to a flat 0.00.
 */
export function formatSlotRate(value: number, kind: string): string {
  return `${formatSlotRateBare(value)}${rateUnitSuffix(kind)}`;
}

export function formatSlotRateBare(value: number): string {
  return formatCompact(value * rateUnitMultiplier());
}

/**
 * Noise floor: anything that would render as a bare zero doesn't render at
 * all. This is what kills "−0.000 kL/s" badges forever.
 */
export function formatSlotRateOrNull(value: number, kind: string): string | null {
  if (!Number.isFinite(value) || value * rateUnitMultiplier() < 0.0005 * rateUnitPrecisionScale()) {
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
  const storageRoles = getStorageRoles(project);
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
      ? describeStorage(storage, storageRoles.get(otherId))
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

/**
 * A port hover, cut to the bone: the state, and one sentence saying why it
 * reads that way.
 *
 * It used to carry a table of numbers, a list of every line plugged in with
 * its own rate and the far machine's speed, and an arrowed instruction. All of
 * that is a report, and a hover is not a report - the pointer is already
 * moving by the time anyone has read the second row. The rate is on the port
 * itself, the lines are visible on the board, and the marks say where to act;
 * what only the hover can give you is the word and the reason.
 */
export interface PortStory {
  stateWord: string;
  /** `gold` is the quiet one: short, but costing nobody anything. */
  tone: "red" | "amber" | "gold" | "green" | "steel" | "dim";
  /** One sentence. Two at the absolute most, and never a list. */
  lines: string[];
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
  // Named when there is one taker, counted when there are several. The old
  // version built a table row per line carrying each taker's own ask, its own
  // rate and its own speed - four numbers a piece, on a hover.
  const to = plug.askerMachines === 1 || plug.askerName ? ` (${plug.askerName})` : "";

  // One sentence per state: what the takers asked for, what arrives, and the
  // one thing about THIS state you could not work out from those two numbers.
  const short = `Asked ${fmt(plug.askPerSecond)}, gets ${fmt(plug.getPerSecond)}${to}.`;
  let lines: string[];
  switch (plug.state) {
    case "hungry":
      lines = [short];
      break;
    case "blocked":
      lines = [`${short} The machine is short itself, so the fix is upstream.`];
      break;
    case "clogged":
      // Worth its own clause: the obvious reading of a short plug is "add
      // machines here", and that is the one thing that cannot help, because
      // more machines make more of the stuck output too.
      lines = [`${short} More machines here would not help: another output has nowhere to go.`];
      break;
    case "fed":
      lines = [`Every taker gets what it asked for${to}.`];
      break;
    case "dump":
      lines =
        plug.dumpKind === "trash"
          ? [`${fmt(plug.getPerSecond)} goes in and is destroyed.`]
          : [`${fmt(plug.getPerSecond)} goes in and stays there. Nothing draws from it.`];
      break;
  }

  return {
    stateWord:
      plug.state === "dump"
        ? PLUG_DUMP_WORD[plug.dumpKind ?? "store"]
        : PLUG_STATE_WORD[plug.state],
    tone: PLUG_STATE_TONE[plug.state],
    lines,
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
      return { stateWord: "IDLE", tone: "dim", lines: ["Not running."] };
    }
    return {
      stateWord: "LEFTOVER",
      tone: "dim",

      lines: [`${fmt(current)} vanishes: nothing is wired.`],
    };
  }

  if (isSupplyShort(verdict.kind)) {
    const tone = verdict.kind === "blocked" ? "amber" : "gold";
    const bindingName = verdict.binding?.displayName ?? "an ingredient";

    // Starved: the machine runs slow and not one asker minds. Report the
    // speed, name what sets it, and offer no fix — there is nothing to fix.
    if (verdict.kind === "starved") {
      return {
        stateWord: "SLOWED",
        tone,

        lines: [`At ${formatPct(verdict.pct)}%: ${bindingName} sets that. Nothing is waiting on it.`],
      };
    }

    if (wanted > nameplate * (1 + TOL)) {
      return {
        stateWord: "SQUEEZED",
        tone,

        lines: [`At ${formatPct(verdict.pct)}% on ${bindingName}. Plugs want ${fmt(wanted)}, over its ${fmt(nameplate)} max.`],
      };
    }
    return {
      stateWord: "SLOWED",
      tone,

      lines: [`At ${formatPct(verdict.pct)}%: ${bindingName} runs short, so this does too.`],
    };
  }

  if (machineWant < current - Math.max(EPS, current * TOL)) {
    const spare = current - machineWant;
    return {
      stateWord: "EXTRA",
      tone: "green",

      lines: [
        `Makes ${fmt(current)}, plugs take ${fmt(machineWant)}. The spare ${fmt(spare)} ${
          storageTake >= spare - EPS ? "goes to the buffer" : "vanishes"
        }.`,
      ],
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "CALM",
      tone: "steel",

      lines: [`At ${formatPct(verdict.pct)}%: all that is asked. Could do ${fmt(nameplate)}.`],
    };
  }

  if (port.plug?.state === "hungry") {
    const times = nameplate > EPS ? formatTimes(port.plug.askPerSecond / nameplate) : "×?";
    return {
      stateWord: "DONE",
      tone: "green",

      lines: [`Full speed. The plug wants ${times} more: hover it for the fix.`],
    };
  }

  return {
    stateWord: "DONE",
    tone: "green",
    lines: ["Full speed, everything gets used."],
  };
}

function explainInputPort(
  port: RailPort,
  verdict: NodeVerdict,
  breakdown: PortBreakdown | undefined,
): PortStory {
  const need = port.nameplatePerSecond;
  const fmt = (value: number) => formatSlotRate(value, port.kind);
  // Who feeds it, named only when naming is cheap. One feeder is worth a name;
  // five are worth a count, and the wires themselves are on the board.
  const feeders = breakdown?.rows.length ?? 0;
  const from =
    feeders === 1 ? ` from ${breakdown!.rows[0]!.name}` : feeders > 1 ? ` from ${feeders} lines` : "";

  if (port.unsupplied) {
    return {
      stateWord: "NO SUPPLY",
      tone: "amber",
      lines: [`Nothing is wired here. It needs ${fmt(need)} to run.`],
    };
  }

  const isBinding =
    verdict.binding?.resourceKey === port.key ||
    verdict.binding?.tiedKeys?.includes(port.key) === true;

  if (isSupplyShort(verdict.kind) && isBinding && verdict.binding) {
    return {
      stateWord: verdict.kind === "blocked" ? "BLOCKED" : "STARVED",
      tone: verdict.kind === "blocked" ? "amber" : "gold",
      lines: [
        `Gets ${fmt(verdict.binding.suppliedPerSecond)} of the ${fmt(need)} it wants${from}. This is what holds the machine at ${formatPct(verdict.pct)}%.`,
      ],
    };
  }

  if (isSupplyShort(verdict.kind)) {
    // Its own word, not just COVERED. On a card that IS short of something,
    // the useful thing to say about the ingredient that is fine is that it is
    // not the one to go and fix.
    return {
      stateWord: "NOT THE LIMIT",
      tone: "steel",
      lines: [
        `Fully supplied${from}. ${verdict.binding?.displayName ?? "Another ingredient"} is what holds this machine back, not this one.`,
      ],
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "COVERED",
      tone: "steel",
      lines: [
        `Fully supplied${from}. The machine runs at ${formatPct(verdict.pct)}% because that is all anything downstream asks for.`,
      ],
    };
  }

  return {
    stateWord: "COVERED",
    tone: "green",
    lines: [`Gets the ${fmt(need)} it wants${from}.`],
  };
}

export interface EdgeStory {
  stateWord: string;
  tone: PortStory["tone"];
  carriesText: string;
  from: { name: string; note?: string };
  to: Array<{ name: string; text: string }>;
  lines: string[];
  /** A wire's hover names both ends and the rate; it hands out no homework. */
  action?: { text: string; tone: "fix" | "fine" | "note" };
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
  const storageRoles = getStorageRoles(project);
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
    ? describeStorage(sourceStorage, storageRoles.get(first.source))
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
        ? `runs at ${formatPct(giverPct)}%, missing ingredients too`
        : `runs at ${formatPct(giverPct)}%, could send more if asked`;
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
        name: describeStorage(targetStorage, storageRoles.get(edge.target)),
        text: `takes whatever arrives: ${fmt(gets)}`,
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
        ? `, its share of ${fmt(totalNeed)} over ${siblings} lines`
        : `, one of ${siblings} lines`;
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
      `Carries all ${fmt(carries)} its maker has. That covers only ${formatPct(coverPct)}% of what ${receiverPhrase} wants.`,
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
      lines.push(`The ${giverName} runs at only ${formatPct(giverPct)}%: it is missing ingredients too.`);
      action = {
        text: `→ The fix is upstream of the ${giverName}.`,
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
    lines.push(`The ${giverName} could send ${fmt(capacity)}, with ${fmt(capacity - carries)} spare.`);
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
