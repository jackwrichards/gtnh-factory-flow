import type { EdgeThroughput, FactoryProject, ThroughputResult } from "@/lib/model/types";
import { formatNumberWithThousands, formatRate, makeResourceKey } from "@/lib/model";
import { parseResourceHandleId } from "./resource-handles";
import { honestEdgeAskPerSecond, type NodeVerdict, type RailPort } from "./node-verdict";

const PLUG_STATE_WORD = {
  hungry: "HUNGRY",
  blocked: "BLOCKED UPSTREAM",
  fed: "FED",
  soak: "TAKES THE REST",
} as const;

const PLUG_STATE_TONE = {
  hungry: "amber",
  blocked: "red",
  fed: "green",
  soak: "steel",
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
  const unit = kind === "fluid" ? " L/s" : "/s";
  // Three decimals below 0.01 so slow drips (crop drops, chanced outputs)
  // don't render as a flat 0.00/s.
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 0.01 ? 2 : 3;
  return `${formatRate(value, digits)}${unit}`;
}

export function formatSlotRateBare(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 0.01 ? 2 : 3;
  return formatRate(value, digits);
}

/**
 * Noise floor: anything that would render as a bare zero doesn't render at
 * all. This is what kills "−0.000 kL/s" badges forever.
 */
export function formatSlotRateOrNull(value: number, kind: string): string | null {
  if (!Number.isFinite(value) || value < 0.0005) {
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
      const wanted = storage ? rate : honestEdgeAskPerSecond(edgeResult);
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
    : explainOutputPort(project, nodeId, port, verdict, breakdown);
}

/**
 * The plug hover: the ASKER's story at full length — who is plugged in, what
 * they ask, what they get, and the fix. The little sentences live here now
 * that the plug block itself is only two lines tall.
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
      rows.push({
        name: `${storage.displayName ?? storage.resourceId} (buffer)`,
        note: "takes the rest",
        rate: fmt(gets),
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
      note: pct !== undefined ? `runs at ${pct}%` : undefined,
      rate: fmt(honestEdgeAskPerSecond(edgeResult)),
    });
  }

  const machineCount = Math.max(1, nodesById.get(nodeId)?.machineCount ?? 1);
  const perMachine = port.nameplatePerSecond / machineCount;
  const missing = Math.max(0, plug.askPerSecond - plug.getPerSecond);
  const toAdd =
    perMachine > EPS && missing > EPS
      ? Math.min(9999, Math.ceil(missing / perMachine - EPS))
      : undefined;

  const baseRows: PortStory["rows"] = [
    { k: plug.state === "soak" ? "Soaks up" : "Asks", v: fmt(plug.askPerSecond) },
    {
      k: "Gets",
      v: `${fmt(plug.getPerSecond)} (${formatPct(plug.coveredFraction * 100)}%)`,
    },
  ];
  if (missing > EPS) {
    baseRows.push({ k: "Short", v: fmt(missing) });
  }
  const lineRows =
    rows.length > 0
      ? { title: `${rows.length} line${rows.length === 1 ? "" : "s"} plugged in`, rows }
      : undefined;

  const single = plug.askerMachines === 1;
  const askerPhrase = single ? `The ${plug.askerName}` : `The ${plug.askerName}`;
  let lines: string[];
  let action: PortStory["action"];
  switch (plug.state) {
    case "hungry":
      lines = [
        `${askerPhrase} ask${single ? "s" : ""} for ${fmt(plug.askPerSecond)}, but this machine can only put in ${fmt(plug.getPerSecond)}.`,
        single
          ? `That covers ${formatPct(plug.coveredFraction * 100)}% of what it wants from this line.`
          : `Together they get ${formatPct(plug.coveredFraction * 100)}% of what they want.`,
      ];
      action = {
        text: toAdd
          ? `→ Add +${toAdd} of this machine, or use a higher tier.`
          : "→ Add more of this machine, or use a higher tier.",
        tone: "fix",
      };
      break;
    case "blocked":
      lines = [
        `${askerPhrase} ask${single ? "s" : ""} for ${fmt(plug.askPerSecond)}, but this machine can only put in ${fmt(plug.getPerSecond)}.`,
        "And this machine is starving itself — it can't run faster no matter how loud they ask.",
      ];
      action = {
        text: "→ Fix this machine's red input first; add machines after, if it's still short.",
        tone: "fix",
      };
      break;
    case "fed":
      lines = [`Everyone plugged in gets exactly what they ask: ${fmt(plug.askPerSecond)}.`];
      action = { text: "Nothing to fix.", tone: "fine" };
      break;
    case "soak":
      lines = [
        `${plug.askerName} takes whatever comes out — ${fmt(plug.getPerSecond)}. A buffer is never hungry.`,
      ];
      break;
  }

  return {
    stateWord: PLUG_STATE_WORD[plug.state],
    tone: PLUG_STATE_TONE[plug.state],
    rows: baseRows,
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
  project: FactoryProject,
  nodeId: string,
  port: RailPort,
  verdict: NodeVerdict,
  breakdown: PortBreakdown | undefined,
): PortStory {
  const current = port.currentPerSecond;
  const nameplate = port.nameplatePerSecond;
  const wanted = port.wantedPerSecond;
  const could = port.couldPerSecond;
  const fmt = (value: number) => formatSlotRate(value, port.kind);
  const speedPct = nameplate > EPS ? (current / nameplate) * 100 : 0;

  const consumers = breakdown?.rows.filter((row) => !row.isStorage) ?? [];
  const consumerPhrase =
    consumers.length === 1
      ? `The ${consumers[0]!.name} after it`
      : `The ${consumers.length} machines after it`;
  const machineWant = breakdown?.wantedByMachinesPerSecond ?? 0;
  const storageTake = breakdown?.storageTakePerSecond ?? 0;

  const rows: PortStory["rows"] = [
    { k: "Makes now", v: `${fmt(current)} (${formatPct(speedPct)}%)` },
    { k: "Max, full speed", v: fmt(nameplate) },
  ];
  if (port.connected && machineWant > EPS) {
    rows.push({
      k: `Wanted by ${consumers.length} machine${consumers.length === 1 ? "" : "s"}`,
      v:
        nameplate > EPS && machineWant > nameplate * (1 + TOL)
          ? `${fmt(machineWant)} (${formatTimes(machineWant / nameplate)})`
          : fmt(machineWant),
    });
  }
  const lineRows =
    breakdown && breakdown.rows.length > 0
      ? {
          title: `Feeding ${breakdown.rows.length} line${breakdown.rows.length === 1 ? "" : "s"}`,
          rows: breakdown.rows.map((row) => ({
            name: row.name,
            rate: fmt(row.ratePerSecond),
          })),
        }
      : undefined;

  // Nothing wired: either dead quiet or a vanishing byproduct.
  if (!port.connected) {
    if (current <= EPS) {
      return {
        stateWord: "IDLE",
        tone: "dim",
        rows,
        lines: ["Nothing comes out yet — the machine isn't running."],
      };
    }
    return {
      stateWord: "LEFTOVER",
      tone: "dim",
      rows,
      lines: [
        `A leftover product: ${fmt(current)} comes out while the machine does its main job.`,
        "Nothing collects it, so it vanishes.",
      ],
      action: { text: "→ Connect a buffer if you want to keep it.", tone: "note" },
    };
  }

  // Per-port coupling: THIS port's own asked-vs-made decides its story —
  // never whether it happens to be the node's worst output.
  if (port.plug?.state === "hungry") {
    const ask = port.plug.askPerSecond;
    const times = nameplate > EPS ? formatTimes(ask / nameplate) : "×?";
    const machineCount = Math.max(
      1,
      project.nodes.find((entry) => entry.id === nodeId)?.machineCount ?? 1,
    );
    const perMachine = nameplate / machineCount;
    const missing = Math.max(0, ask - port.plug.getPerSecond);
    const toAdd =
      perMachine > EPS && missing > EPS
        ? Math.min(9999, Math.ceil(missing / perMachine - EPS))
        : undefined;
    return {
      stateWord: "CAN'T KEEP UP",
      tone: "amber",
      rows,
      lineRows,
      lines: [
        `This machine is already at full speed — ${fmt(current)} is everything it can make.`,
        `${consumerPhrase} want${consumers.length === 1 ? "s" : ""} ${fmt(ask)} — ${times} more.`,
      ],
      action: {
        text: toAdd
          ? `→ Add +${toAdd} of this machine, or use a higher tier.`
          : "→ Add more of this machine, or use a higher tier.",
        tone: "fix",
      },
    };
  }

  if (verdict.kind === "starved") {
    if (wanted > nameplate * (1 + TOL)) {
      return {
        stateWord: "SQUEEZED BOTH WAYS",
        tone: "red",
        rows,
        lineRows,
        lines: [
          `Runs at ${formatPct(verdict.pct)}% — it isn't getting enough ingredients.`,
          `And the machines after it want ${fmt(wanted)} — more than even its full speed (${fmt(nameplate)}).`,
        ],
        action: {
          text: "→ First fix its ingredients (the red input). It will still be short at full speed — add machines after that.",
          tone: "fix",
        },
      };
    }
    return {
      stateWord: "SLOWED",
      tone: "red",
      rows,
      lineRows,
      lines: [
        `Runs at ${formatPct(verdict.pct)}% because the machine is short on ingredients.`,
        verdict.binding
          ? `${verdict.binding.displayName} is the bottleneck — see the red input.`
          : "See the red input for the bottleneck.",
      ],
      action: { text: "→ Fix the red input; this output follows.", tone: "fix" },
    };
  }

  if (machineWant < current - Math.max(EPS, current * TOL)) {
    const spare = current - machineWant;
    const sink =
      storageTake >= spare - EPS
        ? "The extra goes into the buffer."
        : storageTake > EPS
          ? `${fmt(Math.max(0, spare - storageTake))} of the extra vanishes — the buffer takes the rest.`
          : "The extra vanishes — nothing collects it.";
    return {
      stateWord: "EXTRA",
      tone: "green",
      rows,
      lineRows,
      lines: [
        `Makes ${fmt(current)}; the machines after it only take ${fmt(machineWant)}.`,
        `${sink} (${fmt(spare)} spare.)`,
      ],
      action: {
        text: "Not a problem — the machine runs this fast for its other products.",
        tone: "fine",
      },
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "CALM",
      tone: "steel",
      rows,
      lineRows,
      lines: [
        `Runs at ${formatPct(verdict.pct)}% because that's all the machines after it need right now.`,
        `It could make ${fmt(Math.max(could, nameplate))} if they asked for more.`,
      ],
      action: { text: "This is fine — nothing to fix.", tone: "fine" },
    };
  }

  return {
    stateWord: "DONE",
    tone: "green",
    rows,
    lineRows,
    lines: [`Full speed, making ${fmt(current)}, and everything gets used.`],
    action: { text: "Nothing to do here.", tone: "fine" },
  };
}

function explainInputPort(
  port: RailPort,
  verdict: NodeVerdict,
  breakdown: PortBreakdown | undefined,
): PortStory {
  const gets = port.currentPerSecond;
  const need = port.nameplatePerSecond;
  const could = port.couldPerSecond;
  const fmt = (value: number) => formatSlotRate(value, port.kind);
  const getsPct = need > EPS ? (gets / need) * 100 : 0;
  const couldPct = need > EPS ? (could / need) * 100 : 0;

  const rows: PortStory["rows"] = [
    { k: "Gets now", v: `${fmt(gets)} (${formatPct(getsPct)}%)` },
    { k: "Needs at max", v: fmt(need) },
  ];
  const lineRows =
    breakdown && breakdown.rows.length > 0
      ? {
          title: `Supplied by ${breakdown.rows.length} line${breakdown.rows.length === 1 ? "" : "s"}`,
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
      rows: [{ k: "Needs at max", v: fmt(need) }],
      lines: [
        "Nothing is connected here.",
        "The planner assumes you'll drop this ingredient in by hand, so it never slows the machine in the plan.",
      ],
      action: { text: "→ Connect a real source and the planner will start checking it.", tone: "note" },
    };
  }

  if (verdict.kind === "starved" && verdict.binding?.resourceKey === port.key) {
    const binding = verdict.binding;
    const missing = formatSlotRateOrNull(binding.shortfallPerSecond, port.kind);
    if (missing) {
      rows.push({ k: "Missing", v: missing });
    }
    const upstream = binding.upstream;
    const firstLine = `This ingredient is the bottleneck: ${fmt(binding.suppliedPerSecond)} of the needed ${fmt(binding.neededPerSecond)} arrives, so the machine runs at ${formatPct(verdict.pct)}%.`;

    if (upstream?.kind === "loop") {
      return {
        stateWord: "BOTTLENECK",
        tone: "red",
        rows,
        lineRows,
        lines: [firstLine, "It comes from this machine's own loop — it can't get ahead of itself."],
        action: { text: "→ Prime the loop from a buffer or a second source.", tone: "fix" },
      };
    }
    if (upstream?.kind === "buffer") {
      return {
        stateWord: "BOTTLENECK",
        tone: "red",
        rows,
        lineRows,
        lines: [firstLine, `${upstream.name} is running dry — it drains faster than it fills.`],
        action: { text: `→ Feed ${upstream.name} faster, or add another source.`, tone: "fix" },
      };
    }
    if (upstream && !upstream.atFullSpeed) {
      return {
        stateWord: "BOTTLENECK — DEEPER",
        tone: "red",
        rows,
        lineRows,
        lines: [
          firstLine,
          `But the ${upstream.name} making it runs at just ${formatPct(upstream.pct)}% — it's missing ingredients too, so adding more won't help.`,
        ],
        action: {
          text: "→ The real problem is one step further up. Follow this chain upstream.",
          tone: "fix",
        },
      };
    }
    return {
      stateWord: "BOTTLENECK",
      tone: "red",
      rows,
      lineRows,
      lines: [
        firstLine,
        upstream
          ? `The ${upstream.name} making it is already at full speed.`
          : "Its source has nothing left to give.",
      ],
      action: {
        text: upstream?.machinesToAdd
          ? `→ Add +${upstream.machinesToAdd} ${upstream.name}.`
          : upstream
            ? `→ Add more ${upstream.name}.`
            : "→ Add more of the machine making it.",
        tone: "fix",
      },
    };
  }

  if (verdict.kind === "starved") {
    const bindingName = verdict.binding?.displayName ?? "another ingredient";
    // A non-dry buffer feeds on demand: it is never a ceiling, so never
    // predict it as "the next bottleneck at 0%".
    const bufferFed = !Number.isFinite(couldPct);
    const lines = [
      `This ingredient is not the problem. It arrives slowly only because the whole machine runs at ${formatPct(verdict.pct)}% — ${bindingName} is the real bottleneck.`,
      bufferFed
        ? "A buffer feeds these lines — it delivers on demand, never the cap."
        : `These lines could deliver up to ${formatPct(couldPct)}% whenever the machine speeds up.`,
    ];
    return {
      stateWord: "NOT THE PROBLEM",
      tone: "steel",
      rows,
      lineRows,
      lines,
      action:
        !bufferFed && couldPct < 99.5
          ? {
              text: `→ Heads-up: after ${bindingName} is fixed, this becomes the next bottleneck, at ${formatPct(couldPct)}%.`,
              tone: "note",
            }
          : undefined,
    };
  }

  if (verdict.kind === "demand-set") {
    return {
      stateWord: "THROTTLED ON PURPOSE",
      tone: "steel",
      rows,
      lineRows,
      lines: [
        `The machine runs at ${formatPct(verdict.pct)}% because that's all the machines after it need — so it only takes ${formatPct(getsPct)}% here.`,
      ],
      action: { text: "Supply is fine. Nothing to fix.", tone: "fine" },
    };
  }

  const bufferFed = !Number.isFinite(couldPct);
  const lines = ["Fully supplied."];
  if (bufferFed) {
    lines.push("A buffer feeds this — it delivers on demand, plenty on tap.");
  } else if (couldPct > 105) {
    lines.push(`The lines could even bring ${formatTimes(could / Math.max(need, EPS))} what full speed needs.`);
  }
  return {
    stateWord: "COVERED",
    tone: "green",
    rows,
    lineRows,
    lines,
    action:
      bufferFed || couldPct > 105
        ? { text: "Safe to add more of this machine before this ingredient runs short.", tone: "fine" }
        : { text: "Nothing to fix.", tone: "fine" },
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

    const wanted = honestEdgeAskPerSecond(edgeResult);
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
