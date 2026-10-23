# Up to: a machine count that is what you have

Written 2026-10-18. The website first, the mod (`gtnh-planner-mod`, `data/flowchart/balancer/`) right after, in
lockstep: every rule here has a Java twin and the two must give the same answer. The card's look is
`mockups/up-to-card/` (pass 3, `index.html`; its README has the owner's decisions).

## The rule

A card's machine count has one of three rules:

- **Any**: the plan picks how many (no `solvePin`), as a drawer with no rate. A new card and a cleared count are Any.
  A count typed in is Up to; Exactly is picked from the rule menu. A cleared count is Any again, and the next count is
  Up to.
- **Up to N** (the default for a set count): `solvePin = N`. The machines run as hard as the rest of the plan lets
  them, never above N. No forced flow (a gate: material brought in or sent out at a wired port with no drawer) makes
  up what they cannot do; they slow down instead, as in the game. It is old Build mode inside the one solver.
- **Exactly N**: `solvePin = N`, `solvePinExact: true`. Today's pin: N machines flat out, the rest solved around them,
  any gap shown as a forced flow.

A custom rate card's pin is always exact (its dial). A fluid tank has no pin. Every saved pin without the flag reads as
Up to, so every plan, old Build plans included (`plan/convert.ts` pins each card at its built count), becomes Up to with
no rewrite. There is no notice about it (the owner, 2026-10-17).

## How it reaches the engine

`adapter/model.ts`:

- A single card with an Up to pin is a one-machine pool: `{ machines: [card], capacity: N, exact: false, upTo: true }`,
  `countFixed: false`. An Exactly pin stays `countFixed` + `machineCount` as today.
- A shared card's pin is its group's pool: `exact: solvePinExact === true`, `upTo: !exact`.
- `PoolIn.upTo` is new and optional; a non-exact pool without it is a plain cap (the mod's older uncapped groups),
  unchanged.

## The engine (`src/lib/solver/plan/`)

### Anchoring

An Up to pool with `capacity > 0` anchors its part of the plan, as an exact pool does (`context.ts` `anchored`,
`unanchored.ts`, `adapter/unanchored.ts`). Its machines are never `unneeded` (an idle Up to card says UNUSED, not
"(set count)").

### The guard: no forced flow makes up an Up to card's gap

The guarded ports: every connected port whose wire network (`portComponent`) holds a port of an Up to pool's machine,
except ports a drawer is linked to (a drawer on a wired port is the player's own end: a byproduct drawer is permission
to run, a source drawer is supply).

Once per context, before the first pass, one LP (level -1): the base model with pins and pools but **without drawer
rows** and without the guard, minimising the guarded externals (each weighted by `externalWeight`). Then:

- infeasible: no guard (the pins conflict whatever happens; the chain fails and diagnoses as today);
- minimum at rounding (`heldAt`): every guarded external is closed in every model this context builds;
- otherwise (an Exactly pin needs some): the guarded externals together are held to that minimum (one row).

Leaving drawers out is the point: a drawer's rate never opens a forced flow on a guarded network. A rate the Up to
machines cannot reach stalls the chain, and the drawer relaxation (which builds its models with the guard) reports
the shortfall and names the Up to card that holds it back (`limitingNodes`, note `LIMIT_PIN` with `PIN_UP_TO`).
`diagnosePins` runs with the guard off, so a drawer shortfall is never mistaken for a pin conflict.

### The push: every Up to card as high as it goes, fairly

After the trades are settled and held (or, on the fast path, with every gate closed), before least flow:

- Let `u_i` = pool i's machine time over its capacity, in [0, 1].
- **Stage A, everything runs**: maximise the sum of `u_i`; call it S. (Old Build's first stage: a fed machine with
  somewhere to put its output never idles.)
- **Stage B, fairness**: progressive max-min over the `u_i` with the sum held at S (old Build's round-robin split).
  Each round maximises the least level z of the pools not yet frozen. A pool is frozen at z only when a probe proves it
  cannot go higher (maximise its own `u` with every unfrozen pool at least z); a pool the round's own point already
  shows above z is a certificate that it can, and is not probed. Repeat until every pool is frozen.
- **Hold**: each pool's machine time is held in a narrow band around its level through least flow, the canonical
  tie-break and every later model of that support (rows, not column bounds: TS columns start at 0).

The levels are a property of the plan, not of the solve path: the stage A optimum is unique, the max-min vector over a
convex set is unique, and every freeze is decided by a value (a probe's optimum), never by which vertex an engine
returns. So HiGHS and ojAlgo, and the reversed column order of the path test, give the same answer.

The push runs wherever a support is settled: the fast path, the chain's pass, and `evaluateSupport` (alternatives and
the stored choice). The levels ride on `Trades` (`floors`), so `tradeModel` applies them everywhere it is used. A pool
that cannot rise past rounding is held at exactly nothing (as `heldAt` closes a trade level), never in a sliver above it.

### Drawers and buffers: the player's own end

With Up to pools a drawer on a wired port is the player's own end, as in old Build: a source drawer is supply, a
product, byproduct or trash drawer a sink. Its ports are no trade level (`levels()`, which the alternatives also rank
by), so the trades settle and hold only forced flow, and the push uses the drawers freely. After the push, two held
stages pick among the pushed points (`settleDrawers`): the least drawn from source drawers (old Build's "recycle before
importing"), then the least put into sink drawers ("ship before banking"). The read-out probes the trades and bands
without these stages (`committedTrades`): they are tie-breaks, not limits. On the fast path only the forced crossings
are closed.

### Buffers

With Up to pools a BUFFER drawer with rule ANY is a bank, as old Build's overflow buffer was: each maker port linked to it
may put into it what its takers do not take (`SolveContext.bankPorts`). That crossing is the buffer's: never a forced
flow (`gatedSinks`), never a gate for the trades or the alternatives' swaps, outside the guard, and as little as it can
be in the sink stage, after the push has shipped all it can to the takers. `DrawerReadout.banked` gives each such
buffer's banked rate (absent without Up to pools or such buffers), and `DrawerReadout.spills` the same per maker port. A
buffer with a rule keeps today's meaning: its rule is a row over what passes through, and it banks nothing (a maker
whose takers are full slows down). Without Up to pools a buffer is wiring only, as before.

On the board the bank is the makers', never the drawer's: each maker port's spill (`PlanSolveExtras.spills`) is drawn
as that card's forced row, and the buffer totals them on a small Forced out tile left of its figure (its figure is still
what passes through), with a tip saying the makers force it out themselves; hovering any of those tiles lights them all. A website read-out only: the mod's
balancer computes the same bank and needs no change for it.

### The read-out (`SolutionView.upTo`)

At the committed point, under one counted budget per island (`readoutBudget`: 96 models, or 8 per Up to pool when that
is more; work never time). The reasons are old Build's (`node-verdict.ts`): what a card's inputs allow is weighed against
what its outputs allow, and a card at full speed is a bottleneck when someone downstream goes short of what it makes.
The pools below their capacity are read first, in pool order, then those at it.

- `reached` = machine time. A free end is a free column into a wired port's conservation row (supply at an input, a
  sink at an output), or an unwired port's capped source or product drawer with its cap lifted.
- Below its capacity, with every other pool held at least at its level (free to rise, never to give way: held from
  above too, a pool in a chain would be pinned from both sides) and this one free under its cap:
  - `capable` = the most it reaches with a free sink at every output (its inputs as they are); `disposal` = the most
    with every input fed freely (its outputs as they are).
  - `disposal < capable` (the outputs strictly tighter): **CLOGGED** (at zero: **UNUSED**). `port` is the first output
    whose free sink alone (every input fed) raises it, the others that do `tied`.
  - else, when `capable` is below its capacity and feeding its inputs (every output free) raises it: **STARVED**, the
    input story first as in old Build. `port` is the first input whose free supply alone (every output free) raises it,
    the others that do `tied`. When only several together do, `port` is the first of them in machine, then port order,
    and `tied` the rest (CLOGGED likewise). `upstream`: the Up to pools making that input that are FULL or BOTTLENECK.
  - else **LIMITED**.
- At its capacity (within 1e-6 of the level):
  - **wants**: drop the pool's cap and every push band, keep the trades; maximise the levels of the Up to pools it
    feeds (wire by wire, downstream) plus each unmet drawer's met fraction (total over its target, at most 1) among
    those it feeds. If that beats what they have now, minimise this pool's machine time at that optimum: more than its
    capacity is **BOTTLENECK** with that `wants`. Only what it feeds counts: a pool upstream that it holds back is
    that pool's CLOGGED.
  - else, when it makes what a STARVED pool's `port` or `tied` port takes (the inverse of `upstream`): **BOTTLENECK**,
    `wants` = its capacity plus what those pools would draw at their own capacity beyond what they draw now, over its
    per-machine rate (each maker is given the whole).
  - An Exactly card fed by a forced input on a network this pool makes also wants more: that input over this pool's
    per-machine rate is added to `wants` (a FULL pool so becomes a BOTTLENECK).
  - else **FULL**.
- Budget out: `reason: null` for that pool and every pool read after it.

Islands: each island's read-out is its own; `solvePlan` concatenates them, sorted by `node`.

### Loops (`SolutionView.upToLoops`)

Old Build's dead loop and clog lock (`death-spiral.ts`, `clog-lock.ts`), found once every pool's reason is known, a pure
graph over the read-out and the model's networks (no LP, no budget). A pool blames the Up to pools on the wire network of
its `port` and `tied` ports: a STARVED pool those that make what it is short of, a CLOGGED or UNUSED pool those that take
what it cannot get rid of. A ring is a strongly connected part of that relation (a pool blaming itself counts) whose
members all stand still (every machine within the solve's dust of zero, as UNUSED is judged):

- **DEAD_LOOP**: every member STARVED and standing still. A recycling loop nothing feeds; the fix is to feed it.
- **CLOG_LOCK**: every member UNUSED (CLOGGED standing still). Frozen by its own surplus; the fix is a drawer.

Standing still is the test, as in old Build: a ring that loses material every lap winds down to zero when nothing
feeds it, so a ring that runs at all is fed from outside and held back by that feed, which its members' STARVED already
says (the `fed ring` fixture: a ring fed a quarter of what it could take runs at half its counts and is no ring).

Each is `UpToLoop { kind, nodes, ports }`: `nodes` the members' `node` in pool order, `ports` the members' blaming ports
that lie on the ring's edges, member by member. Rings are sorted by their first member's `node` (`compareIds`), merged
across islands the same way, and absent when there are none. The board reads them as `PlanSolveExtras.loops`
(`PlanUpToLoop { kind, cards, portKeys, resourceKeys }`: card ids once each, the rows, their resources once each).

## What the board shows (`PlanSolveExtras.upTo`, `loops`, `shortfalls`)

The adapter maps each read-out to the card's id (`PlanUpTo`: rows as `PortKey`, the resource as `kind:id`, upstream as
card ids), each ring to `PlanUpToLoop`, and every shortfall to `PlanShortfall` with the limiting cards.
`NodeThroughputResult.utilization` is reached / capacity for an Up to card; `status` is `bottleneck` for BOTTLENECK,
`underutilized` below the count.

The card (pass 3): under the machine what runs, big and white ("×18.2"), and what you set, small, as the overview's
machine lines say it: the rule word, always, and the set box ("Up to [24]", "Exactly [24]", "Any [Set]" with no
count, the Set blinking while nothing sets that part of the plan). Click the box to type (a count typed on Any is Up
to, as in the overview), the wheel steps it, click the rule word for Any, Up to, Exactly. A cleared count (an empty
box, the middle button, the wheel below one) is Any. Along the foot one
bar for an Up to card: its fill is reached / capacity, then one word in the reason's colour, one plain line, and a
fraction on the right ("18.2 / 24"); a bottleneck's bar runs on, striped, to what the line wants ("24 / 31"). An
Exactly card with a forced input says FORCED IN with the resource and rate. No bar for Any, or Exactly with nothing
forced. Every port tile is one shape; free ends only change colour; power is a tile; the short port is not lit.

## The mod

The same rules in `data/flowchart/balancer/` (Java): `PoolIn` gains `upTo`, `ModelBuilder` pools, `SolveContext`
anchoring and the guard, the push as a stage between `TradeStage` and `FlowMinStage` and inside `FastPathStage`, the
floors on `Trades`, `Enumerator.evaluateSupport`, `DrawerRelaxation` naming the card, `SolutionView.upTo`. The pin:
`Node.machineCountFixed` stays "a count is set", a new `machineCountExact` says Exactly; `MachineGroup.pinned` likewise.
Plans carry `solvePinExact` both ways (`FfPlanParser`, `FfCards`, `PlanExport`, `cloud/map`). The parity scenarios and
the corpus are re-dumped once both sides agree; until then the website's parity scenarios pin Exactly.

## Checking it against old Build

Old Build plans (the v3 fixtures) are solved twice: by the old Build engine still in the tree (`equations-core.ts`,
`node-verdict.ts`) and by the plan solver after `openAsPlan`. Every card's utilisation and its reason should agree
(BOTTLENECK = bottleneck, STARVED = starved or blocked, CLOGGED = clogged or clog lock, UNUSED = unused, FULL =
full). Known differences come from what the two treat differently: an unwired port stops a machine in old Build and
is a free end here.
