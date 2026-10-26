/**
 * The AUTO solver for one island (spec-solver 3.4, 3.5.1, 3.9): the chain (fast path, else trades then least flow with
 * the canonical point; with Up to pools the guard and the push, docs/up-to.md), the pin diagnosis, and the read-out
 * (`SolutionView`, its Up to part from `readout.ts`). Alternatives, spares, the stored choice, the drawer relaxation
 * and the island split belong to WP1c; they plug in through `CoreExtensions`.
 */
import { note, SolveContext, PIN_STRENGTH, type StageOutcome } from "./context";
import { runFastPath } from "./fast-path";
import { runFlowMin } from "./flow-min";
import { prepareGuard } from "./guard";
import { TICKS_PER_SECOND, portKey } from "./model";
import { externalsLp } from "./probes";
import { pushUpTo } from "./push";
import { readUpTo } from "./readout";
import { loosened, settleDrawers, settleTrades } from "./trade";
import type {
  Alternatives,
  Answer,
  DrawerReadout,
  External,
  Leftover,
  Note,
  PortRef,
  SolutionView,
  SolveInput,
  UpToLoop,
  UpToReadout,
} from "./types";
import { dustScales, NUMERICS, type DustScales } from "./validate";

/** What a pass of the chain came to. */
export type Settlement = { kind: "solved" } | { kind: "stalled"; reason: Note };

/**
 * Extension points for WP1c. Each is optional; absent, the core answers without alternatives (an empty, complete
 * list), spares or drawer relaxation.
 */
export interface CoreExtensions {
  /**
   * A pass stalled and the context has drawer bounds: return a function that applies the relaxation to a FRESH
   * context (copies loosened bounds, unmet drawers, shortfalls and notes), or null when drawers are not the problem.
   * The core then runs the chain exactly once more on that context.
   */
  relax?: (ctx: SolveContext) => ((fresh: SolveContext) => void) | null;
  /**
   * Called once the point is committed and validated: honour the stored choice (commit a different point), search the
   * alternatives and place the spares. May commit a mixed point; the view is read after it returns.
   */
  finish?: (ctx: SolveContext) => { alternatives: Alternatives; spares: Leftover[] };
}

export interface Piece {
  ctx: SolveContext;
  answer: Answer;
}

/** `DrawerReadout.NONE` / `unsolved`: nothing solved, only what the context already knew was unmet. */
export function unsolvedReadout(ctx: SolveContext): DrawerReadout {
  return { rates: {}, unmet: [...ctx.unmetDrawers], shortfalls: [...ctx.shortfalls], ports: {} };
}

/** The read-out at a committed point: every drawer's total, checked against its bounds. */
export function drawerReadout(ctx: SolveContext, point: StageOutcome): DrawerReadout {
  const rates: Record<string, number> = {};
  const unmet = [...ctx.unmetDrawers];
  const ports: Record<string, External[]> = {};
  ctx.model.drawers.forEach((drawer, d) => {
    const total = ctx.drawerTotal(d, point.extents, point.flows, point.externals);
    rates[drawer.id] = total;
    if (!ctx.drawerHolds(d, total) && !unmet.includes(drawer.id)) unmet.push(drawer.id);
    if (drawer.kind === "BUFFER") {
      // Each port of the buffer and the flow on its edges there: what each of its wires carries.
      ports[drawer.id] = drawer.links.map((ref) => {
        let rate = 0;
        for (const e of drawer.flowEdges) {
          const edge = ctx.model.edges[e]!;
          const at = ctx.refOf(ref.input ? edge.dstPort : edge.srcPort);
          if (at.node === ref.node && at.port === ref.port && at.input === ref.input)
            rate += point.flows[e]!;
        }
        return { port: ref, ratePerSecond: rate };
      });
    }
  });
  if (ctx.bankPorts.size === 0) return { rates, unmet, shortfalls: [...ctx.shortfalls], ports };
  // With Up to pools a buffer of rule ANY banks what its takers do not take (docs/up-to.md, "Buffers").
  const banked: Record<string, number> = {};
  const spills: Record<string, External[]> = {};
  for (const [p, d] of ctx.bankPorts) {
    const id = ctx.model.drawers[d]!.id;
    const rate = point.externals[p]!;
    banked[id] = (banked[id] ?? 0) + rate;
    (spills[id] ??= []).push({ port: ctx.refOf(p), ratePerSecond: rate });
  }
  return { rates, unmet, shortfalls: [...ctx.shortfalls], ports, banked, spills };
}

/**
 * Which pins the plan cannot satisfy at once, or null when pins are not the problem. Frees them weakest first (a fixed
 * count, then a target, then an explicit extent) until the permissive LP closes, and names the ones that had to go.
 */
export function diagnosePins(ctx: SolveContext): Note | null {
  const pinned: number[] = [];
  for (let m = 0; m < ctx.model.machines.length; m++)
    if (!Number.isNaN(ctx.pinnedExtent[m]!)) pinned.push(m);
  if (pinned.length < 2) return null;
  pinned.sort(
    (a, b) => PIN_STRENGTH.indexOf(ctx.pinKind[a]!) - PIN_STRENGTH.indexOf(ctx.pinKind[b]!),
  );
  const saved = new Map<number, number>();
  const dropped: Note[] = [];
  // Without the guard (docs/up-to.md): a rate the Up to machines cannot reach is the drawer relaxation's to report.
  ctx.guardOff = true;
  try {
    for (const m of pinned) {
      if (externalsLp(ctx, null).ok) break;
      if (saved.size === pinned.length - 1) return null; // one pin left: not a conflict
      saved.set(m, ctx.pinnedExtent[m]!);
      ctx.pinnedExtent[m] = Number.NaN;
      dropped.push(
        note(
          "PIN_DROPPED",
          ctx.model.machines[m]!.spec.name,
          note(ctx.pinKind[m]!),
          ctx.model.machines[m]!.spec.id,
        ),
      );
    }
  } finally {
    ctx.guardOff = false;
    for (const [m, value] of saved) ctx.pinnedExtent[m] = value;
  }
  return dropped.length === 0 ? null : note("PIN_CONFLICT", dropped);
}

/**
 * One pass of the chain: the guard (once per context), then the fast path, else trades, the Up to push, the drawer
 * stages, and least flow with the canonical point.
 */
function pass(ctx: SolveContext): Settlement {
  ctx.stageNotes = [];
  ctx.shortCircuit = false;
  prepareGuard(ctx);
  runFastPath(ctx);
  if (ctx.shortCircuit) return { kind: "solved" };
  const trades = settleTrades(ctx);
  if (!trades.ok)
    return { kind: "stalled", reason: note("STAGE_FAILED", "trades", trades.rejection) };
  let pushed = pushUpTo(ctx, trades.held);
  const settled = settleDrawers(ctx, pushed);
  let flow = runFlowMin(ctx, settled);
  if (!flow.ok) {
    // Holds read off points solved only to the engine's tolerance can leave least flow nothing; once more with room.
    flow = runFlowMin(ctx, loosened(settled));
    pushed = loosened(pushed);
  }
  if (!flow.ok)
    return { kind: "stalled", reason: note("STAGE_FAILED", "internal flow", flow.rejection) };
  ctx.committedTrades = pushed;
  return ctx.point === null
    ? { kind: "stalled", reason: note("BALANCE_FAILED", ctx.rejection) }
    : { kind: "solved" };
}

/** `Chain.run`: a pass, and on a stall the pin diagnosis. */
export function runChain(ctx: SolveContext): Settlement {
  const first = pass(ctx);
  if (first.kind === "solved") return first;
  const conflict = diagnosePins(ctx);
  return {
    kind: "stalled",
    reason:
      conflict === null
        ? note("BALANCE_FAILED", first.reason)
        : note("BALANCE_FAILED", note("STAGE_FAILED", first.reason, conflict)),
  };
}

/** `Balancer.settle`: the chain, and once more under a relaxation when drawers stalled it. */
export function settle(
  input: SolveInput,
  ctx: SolveContext,
  ext: CoreExtensions,
): { ctx: SolveContext; settlement: Settlement } {
  const first = runChain(ctx);
  if (first.kind === "solved" || !ctx.hasDrawerBounds() || !ext.relax)
    return { ctx, settlement: first };
  const apply = ext.relax(ctx);
  if (apply === null) return { ctx, settlement: first };
  const retry = new SolveContext(input);
  apply(retry);
  return { ctx: retry, settlement: runChain(retry) };
}

// ---------------------------------------------------------------------------
// The read-out
// ---------------------------------------------------------------------------

const noteKey = (n: Note): string => JSON.stringify(n);

/** Flags externals that look like missing edges rather than intent (spec 3.9.4). */
function wiringDiagnostics(ctx: SolveContext, scales: DustScales, terminalIn: External[]): Note[] {
  const model = ctx.model;
  const point = ctx.point!;
  const refKey = (r: PortRef) => `${r.node}|${r.input ? 1 : 0}|${r.port}`;
  const supplied = new Set<string>();
  for (const row of model.drawers)
    if (row.kind === "SOURCE") for (const l of row.links) supplied.add(refKey(l));

  const connected = new Map<number, number[]>();
  const loose = new Map<number, number>();
  model.connectedPorts.forEach((port, p) => {
    if (port.input) return;
    const resource = model.machines[port.machine]!.spec.outputs[port.portIndex]!.resource;
    const list = connected.get(resource);
    if (list) list.push(p);
    else connected.set(resource, [p]);
  });
  model.machines.forEach((md, m) => {
    md.outQty.forEach((qty, i) => {
      if (!(qty > 0)) return;
      if (model.portLookup.has(portKey(m, i, false))) return;
      const resource = md.spec.outputs[i]!.resource;
      if (!loose.has(resource)) loose.set(resource, m);
    });
  });
  const find = (resource: number, excludeComponent: number): number | null => {
    for (const p of connected.get(resource) ?? []) {
      if (model.portComponent[p] === excludeComponent) continue;
      return model.connectedPorts[p]!.machine;
    }
    return loose.get(resource) ?? null;
  };

  const result = new Map<string, Note>();
  const add = (n: Note) => {
    const k = noteKey(n);
    if (!result.has(k)) result.set(k, n);
  };
  const machineOf = (r: PortRef) => model.machines[model.machineIndex.get(r.node)!]!;
  for (const ext of terminalIn) {
    if (supplied.has(refKey(ext.port))) continue;
    const md = machineOf(ext.port);
    const ingredient = md.spec.inputs[ext.port.port]!;
    if (ingredient.free) continue;
    const match = find(ingredient.resource, -1);
    if (match !== null) {
      const producer = model.machines[match]!.spec;
      add(
        note(
          "WIRING_IMPORT",
          md.spec.name,
          ingredient.name,
          producer.name,
          ext.port.node,
          producer.id,
        ),
      );
    }
  }
  model.connectedPorts.forEach((port, p) => {
    if (!port.input || !(point.externals[p]! > NUMERICS.dust * scales.ports[p]!)) return;
    const ref = ctx.refOf(p);
    if (supplied.has(refKey(ref))) return;
    const md = model.machines[port.machine]!;
    const ingredient = md.spec.inputs[port.portIndex]!;
    if (ingredient.free) return;
    const match = find(ingredient.resource, model.portComponent[p]!);
    if (match !== null) {
      const producer = model.machines[match]!.spec;
      add(
        note(
          "WIRING_UNLINKED",
          md.spec.name,
          ingredient.name,
          producer.name,
          ref.node,
          producer.id,
        ),
      );
    }
  });
  return [...result.values()];
}

/**
 * The view over the committed point (`SolutionView.of`). `upTo` is the Up to read-out (`readout.ts`, or the islands'
 * read-outs merged), absent when the plan has no Up to pool; `upToLoops` its rings, absent when there are none.
 */
export function buildSolutionView(
  ctx: SolveContext,
  spares: Leftover[] = [],
  upTo?: UpToReadout[],
  upToLoops?: UpToLoop[],
): SolutionView {
  const model = ctx.model;
  const point = ctx.point!;
  const scales = dustScales(model, point.extents, point.flows, point.externals);
  const extentsPerSecond: Record<string, number> = {};
  const machineCounts: Record<string, number> = {};
  const edgeFlowsPerSecond: Record<string, number> = {};
  const unneeded: string[] = [];
  // An idle Up to machine is UNUSED in its read-out, never "(set count)" (docs/up-to.md, "Anchoring").
  const upToMachine = new Set<number>();
  for (const p of ctx.upToPools) for (const m of model.pools[p]!.machines) upToMachine.add(m);
  model.machines.forEach((md, m) => {
    extentsPerSecond[md.spec.id] = point.extents[m]!;
    machineCounts[md.spec.id] = (point.extents[m]! * md.durTicks) / TICKS_PER_SECOND;
    if (
      Number.isNaN(ctx.pinnedExtent[m]!) &&
      !upToMachine.has(m) &&
      point.extents[m]! <= NUMERICS.dust * scales.machines[m]!
    )
      unneeded.push(md.spec.id);
  });
  // The plan's own wires only: a buffer's edges are the solver's, read out per port on the drawer.
  for (let e = 0; e < model.drawnEdges; e++)
    edgeFlowsPerSecond[model.edges[e]!.id] = point.flows[e]!;
  const gatedSources: External[] = [];
  const gatedSinks: External[] = [];
  let externalQuantity = 0;
  model.connectedPorts.forEach((port, p) => {
    const ext = point.externals[p]!;
    // What a buffer banks is the buffer's (`DrawerReadout.banked`), not a forced flow.
    if (!(ext > NUMERICS.dust * scales.ports[p]!) || ctx.bankPorts.has(p)) return;
    (port.input ? gatedSources : gatedSinks).push({ port: ctx.refOf(p), ratePerSecond: ext });
    externalQuantity += ext;
  });
  const terminalInputs: External[] = [];
  const terminalOutputs: External[] = [];
  model.machines.forEach((md, m) => {
    for (const input of [true, false]) {
      const qtys = input ? md.inQty : md.outQty;
      qtys.forEach((qty, i) => {
        if (!(qty > 0) || model.portLookup.has(portKey(m, i, input))) return;
        const rate = point.extents[m]! * qty;
        if (!(rate > NUMERICS.dust * scales.machines[m]!)) return;
        (input ? terminalInputs : terminalOutputs).push({
          port: { node: md.spec.id, port: i, input },
          ratePerSecond: rate,
        });
      });
    }
  });
  let totalInternalFlow = 0;
  for (const f of point.flows) totalInternalFlow += f;
  return {
    ...(upTo !== undefined ? { upTo } : {}),
    ...(upToLoops !== undefined && upToLoops.length > 0 ? { upToLoops } : {}),
    extentsPerSecond,
    machineCounts,
    edgeFlowsPerSecond,
    gatedSources,
    gatedSinks,
    terminalInputs,
    terminalOutputs,
    unneeded,
    openGates: point.support.size,
    externalQuantity,
    totalInternalFlow,
    notes: [...ctx.notes, ...ctx.stageNotes, ...wiringDiagnostics(ctx, scales, terminalInputs)],
    key: ctx.keyOf(point.support),
    drawers: drawerReadout(ctx, point),
    spares,
  };
}

/** One island solved, with the context that solved it. */
export function solvePiece(input: SolveInput, ext: CoreExtensions = {}): Piece {
  const first = new SolveContext(input);
  const failed = (
    ctx: SolveContext,
    failure: Note,
    notes: Note[],
    drawers: DrawerReadout,
  ): Piece => ({
    ctx,
    answer: { kind: "failed", failure, notes: [...notes], drawers },
  });
  if (first.model.machines.length === 0) {
    return failed(first, note("EMPTY_GRAPH"), [], {
      rates: {},
      unmet: [],
      shortfalls: [],
      ports: {},
    });
  }
  if (!first.anchored) {
    // Idle, not broken: wiring, nothing sets the plan's size.
    const notes = [...first.notes];
    if (first.hasDrawerBounds()) notes.push(note("DRAWER_ONLY_UPPER_BOUNDS"));
    return failed(first, note("NO_PIN"), notes, unsolvedReadout(first));
  }
  const settled = settle(input, first, ext);
  const ctx = settled.ctx;
  if (settled.settlement.kind === "stalled") {
    return failed(ctx, settled.settlement.reason, ctx.notes, unsolvedReadout(ctx));
  }
  if (ctx.point === null) {
    return failed(ctx, note("BALANCE_FAILED", ctx.rejection), ctx.notes, unsolvedReadout(ctx));
  }
  const finished = ext.finish?.(ctx);
  const residual = ctx.validate(ctx.point.extents, ctx.point.flows, ctx.point.externals);
  if (residual !== null)
    return failed(ctx, note("VALIDATION_FAILED", residual), ctx.notes, unsolvedReadout(ctx));
  const alternatives: Alternatives = finished?.alternatives ?? {
    chosen: ctx.keyOf(ctx.point.support),
    options: [],
    complete: true,
    notes: [],
  };
  const read = readUpTo(ctx);
  const solution = buildSolutionView(ctx, finished?.spares ?? [], read?.readouts, read?.loops);
  return { ctx, answer: { kind: "solved", solution, alternatives } };
}

/** The answer for a plan solved as ONE model (no island split: that is WP1c's `islands.ts`). */
export function solveCore(input: SolveInput, ext: CoreExtensions = {}): Answer {
  return solvePiece(input, ext).answer;
}
