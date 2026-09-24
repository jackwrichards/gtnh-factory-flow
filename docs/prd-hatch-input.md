# PRD: Multiblock power input

> UI revision (2026-09-09, Jack): two controls on the main card: amount
> and voltage/unit. EU/t is one step below ULV; it turns the amount into
> an exact raw EU/t editor. Switching display modes preserves supply and
> assumes a suitable voltage while still enforcing the supplied EU/t budget. Tier mode colors both
> controls; raw mode is neutral. Left card actions collapse into a menu.
> Hover explains output and next gain/saving; these are information only.
> No calculator or Hatch options. Supersedes the original UI below.

Status: implemented (branch `codex/hatch-input`)
Date: 2026-09-09
Raised by: Raf, Elephant, Corbee (Discord, 2026-09-09), issue #55, and an
earlier report from elephant about hatch-by-tier

---

## 0. The razor pass

This design was rebuilt from the game's own code rather than extended from
the current planner, because the first draft inherited an assumption that
turns out to be wrong. What follows is what changed under scrutiny.

### Assumption 1: "EU/t is the truth, hatches are a view"

This is the doctrine the current model is built on, and it is backwards.

GregTech does not store a machine's power as one number. It reads the hatch
array three different ways, and the planner can only express one of them.

    getMaxInputVoltageMulti()      = SUM of the hatches' voltages
    getAverageInputVoltageMulti()  = AVERAGE of the hatches' voltages
    getMaxInputAmpsMulti()         = SUM of the hatches' amperage

    availableEUt = averageVoltage x totalAmps

The **sum** is what a machine's own formulas see: parallels that scale per
voltage tier, the blast furnaces' heat bonus. `getEffectiveVoltageOrdinal`
already models this correctly, lone hatch clamp included.

The **average** is what `MTEMultiBlockBase` hands to `ProcessingLogic`, and
it decides two things the planner has no way to ask about:

- **The tier skip gate.** A recipe above `averageVoltage x 4^maxTierSkips` is
  refused with insufficient voltage, whatever the total power is.
- **The overclock cap on amperage-off machines**, where overclocks are
  limited to `voltageTier(average) - voltageTier(recipe)`.

A total EU/t figure cannot produce an average. 2,048 EU/t is either one EV
hatch or four MV hatches, those two builds behave differently in game, and no
amount of work on the single stored number will tell them apart.

**So this is not a bug to fix. It is a variable that does not exist in the
model.** The planner models the sum, and correctly; it has no notion of the
average at all.

**Correction: the stored pair becomes (hatch voltage, amps). EU/t is
computed.** This is not a UI change wearing a correctness argument. The
planner is presently missing a variable the game uses.

### Assumption 2: "late game is EU/t, early game is hatches, so we need a mode"

The first draft added an "EU/t" entry to the tier dropdown as an escape hatch
for wireless and laser players. The Discord thread killed this: laser and
wireless hatches are themselves rated in amps of tier. Raf runs a UHV 65535A
target. There is no machine in the game powered by a bare EU/t figure.

What late game players actually want is to _read_ EU/t, because that is how
they think about their grid, and occasionally to type one.

**Correction: no mode. The EU/t figure is always displayed, and it is
editable in place.** Typing an EU/t value solves for amps at the current
tier. One control, no branches, and the tier skip gate stays checkable
because a voltage always exists.

### Assumption 3: "breakpoints need their own buttons"

Chevrons were reflex. The breakpoint is a fact worth stating in words, and a
fact stated in words can be the button.

**Correction: no chevrons. The menu prints the next and previous breakpoints
as sentences, and clicking a sentence goes there.** This also solves
discoverability, which the current scroll gesture does not have.

### Assumption 4: "the unit should be hatches"

Raf builds in hatches, Elephant says hatches are meaningless past EV, and
both are right about their own era. But a regular hatch is 2A, a lone hatch
is clamped to 1A, and exotic hatches are single units with large ratings, so
hatch count is a lossy unit and amps is not.

**Correction: amps is the field. The hatch equivalent is printed beside it**
("= 2 IV hatches") whenever it divides cleanly. Nobody has to convert
anything, and no mode is needed.

### What survived unchanged

- Per machine, not per plan. Confirmed independently by the thread, by issue
  #55, and by the tier skip gate needing a real hatch voltage per card.
- The breakpoint ladder is the best thing about the current control and stays.
- The hatch calculator stays, with a job upgrade (section 5).
- Default to full parallel utilisation with no overclock.

---

## 1. Problem

The power control on a multiblock card is a single EU/t number.

**It is arithmetic in a tool made of dropdowns.** Every other control on the
board is a drag, a click or a menu. This one asks the player to work out a
number and type it. Corbee: "you have to calculate the number and more
importantly type in the number, and when the main point of interaction with
the planner is dragging a bunch of machines around and connecting wires and
everything is dropdowns, that's a big point of friction."

**The tier is global.** A real plan mixes: most of a platline runs at HV or
EV and a handful of machines must be IV. One plan-wide tier cannot say that.
Reported by Raf, Elephant and issue #55 separately.

**It starts at one parallel.** Nobody builds a 20 parallel machine and feeds
it one recipe's worth of power, so the first dozen steps of the ladder are
dead. Elephant: "it is weird to scroll through all the 1,2,3,4... parallel
breakpoints for a 20 parallel machine that nobody is really going to use."

**And it is missing a variable**, per section 0, which makes two live
correctness bugs (section 7).

## 2. Goals

1. Set a multiblock's power without doing arithmetic.
2. Hatch voltage per machine.
3. Keep the breakpoint ladder, which players singled out as the best part of
   the current control.
4. Give the model the average hatch voltage, which it has never had, and
   close the tier skip gap that follows from it.

Non-goals: singleblocks, cable and P2P loss, hatch colours on cards, the
Industrial Farm seed control (all separate).

## 3. The control

On the card, a chip: `4A IV`. Clicking opens the power menu.

    +- POWER ------------------------------------+
    |                                            |
    |   [-]  4 A  [+]    of    [ IV v ]          |
    |   32,768 EU/t              = 2 IV hatches  |
    |                                            |

**Amps** is a stepper. Arrows move one amp, because that is half a hatch and
it should be predictable. The field accepts a typed decimal, which is how a
mixed tier build is expressed in one tier's terms.

**Tier** is a dropdown of voltage tiers, stored on the node.

**EU/t** is the derived total, displayed always, and editable in place.
Typing one solves for amps at the current tier and rounds to the nearest
buildable step, telling you which way it moved.

**The hatch equivalent** prints when amps divides by 2 into whole regular
hatches. At 1A it says "1 IV hatch (a lone hatch only counts as 1A)", which
is the game rule and a trap nobody knows.

## 4. What the menu says

The menu is three short sections and one button. No tabs.

    |  WHAT IT DOES                              |
    |  16 parallels, 2 perfect overclocks        |
    |  2.5s per run, 4,096 EU per run            |
    |  6.4 runs/s                                |
    |                                            |
    |  STEPS                                     |
    |  ^  8A doubles output      (+2 IV hatches) |
    |  v  3A loses nothing        (1A is spare)  |
    |                                            |
    |  [ Hatch options ]                         |

**What it does** is the existing `describePowerWorking` ladder: parallels,
overclocks named by kind in wiki words, time per run, EU per run, runs per
second. Never the literal product list.

**Steps** is the breakpoint ladder, reduced to the two that matter and
written as sentences. Both rows are clickable and set the value.

The down row is the fact nobody else's tool tells you. Everything between two
breakpoints is supply that buys nothing, so a build sitting above a
breakpoint can usually shed amps at no cost. `listPowerWins` already knows
this: it is the distance to `previousPowerWin`. Wording is "1A is spare", and
the row is hidden when the build sits exactly on a breakpoint.

The up row states the **gain**, not the mechanism. "Doubles output" beats "3
overclocks" for deciding whether the next step is worth building. The
parenthetical gives the price in hatches at the current tier.

**Warnings** appear under the sections, only when true:

- `extra amps buy parallels here, not overclocks` on any machine with
  amperage overclocking off (fusion, Nano Forge, Transcendent Plasma Mixer,
  the Godforge modules, the nanochip modules, the steam multis). On those,
  `overclocks = min(overclocks, voltageTier(machine) - voltageTier(recipe))`,
  so only going up a tier buys a speed step. Amps still feed parallels
  through `availableEUt / recipeEUt`, so the field stays live and is never
  disabled. Currently invisible, and it quietly changes what the breakpoint
  ladder means on those machines.
- The existing `over-tier` stall copy, unchanged: "Won't run at IV: this
  recipe needs at least LuV hatches (amps cannot skip more than one tier)."
  It already exists and already reads correctly. It will simply start firing
  on the builds that deserve it (section 7).
- `mixing hatch tiers lowers your ceiling`, shown in hatch options only,
  because voltage is the _average_ and a small hatch drags it down.

## 5. Hatch options

The existing calculator, with one new job: it marks what the game would
refuse.

    +- HATCH OPTIONS for 32,768 EU/t ------------+
    |  2 x IV        4A IV       ok              |
    |  1 x LuV       1A LuV      ok              |
    |  8 x EV       16A EV       refused, EV     |
    |                hatches cap at 8,192 EU/t   |
    |  16 x HV      32A HV       refused         |
    +--------------------------------------------+

Same total power, different verdicts. This is Raf's Precise Assembler case
exactly: a 4096A ZPM supply is refused where a 256A UHV supply runs, at
identical power. Today the planner calls both fine.

Picking a row sets amps and tier together.

## 6. Defaults

A newly placed multiblock defaults to **full parallel utilisation with no
overclock**: the smallest supply that runs every parallel the machine offers
at the recipe's own speed.

**The plan-wide tier setting is deleted.** Not demoted to a default, not kept
as a bulk action. Every card carries its own hatch voltage, and everything
above the card that used to speak in tiers now speaks in EU/t: plan totals,
the machine list, the power ledger.

A newly placed card needs some tier to start at, so it takes the recipe's own
minimum voltage tier and the amps that reach full parallels from there. That
is a property of the recipe, not a stored plan setting.

## 7. Correctness this closes

**The tier skip gate is fed the wrong voltage.** The gate itself already
exists and already works: `power-report.ts:181` implements
`getAllowedTierSkip`, honours `unlimitedTierSkip` per machine, returns
`over-tier`, and that is a hard stall which pins the card at 0% with a
written reason. None of that needs building.

What it is given is `getNodeRunTier`, the tier floored from the **total**
EU/t. So 64 MV hatches reads as IV and the gate permits recipes up to
32,768 EU/t, where the game reads the average as MV and permits 2,048.

**The planner is therefore too permissive today**, and Raf's Precise
Assembler case passes for exactly that reason: a 4096A ZPM supply totals
enormously, so the derived tier is high, so the gate waves it through. The
fix is to hand the gate the stored hatch tier instead of the derived one.

Two smaller gaps beside it:

- `maxTierSkips = 0` is not modelled. Only the default of 1 and
  `unlimitedTierSkip` exist, so the Precise Assembler, the Industrial Arc
  Furnace and the steam multis are given a tier of headroom they do not have.
- The gate reads the recipe's raw EU/t, where `ParallelHelper` compares
  `recipe.mEUt` before modifiers but after the machine's own EU discount is
  applied elsewhere. Worth a check when the tier goes in.

**Migration consequence.** Handing the gate a real hatch tier makes it
stricter, so a build that passes today can stall tomorrow. That is accepted:
3.0 already moves old plans, and the migration (section 8) is deliberately
rough rather than lossless.

**The average voltage does not exist in the model**, per section 0. The sum
is modelled and correct; the average is what the gate and the amperage-off
overclock cap read, and it cannot be recovered from a total. With uniform
hatches, which is what essentially everyone builds, the average simply is the
hatch tier, so storing the tier supplies it exactly.

**A lone hatch counts as 1A** (`MTEMultiBlockBase:1150`), which
`getHatchAmps` models correctly on the legacy hatch pair. The additive
calculator does not: pressing plus once adds a full 2A of the tier, and the
resulting budget reads back as a two amp build. The one hatch case is the
only place the two disagree, and the new control should read the clamp from
the same place the model does.

## 8. Model and migration

`FactoryNode` gains `hatchVoltageTier` and `hatchAmps`. `powerEuT` stays,
computed from the pair and persisted, so nothing downstream changes shape.

Old plans have `powerEuT` and no pair. The migration is deliberately rough:

    voltage = the recipe's own minimum voltage tier
    amps    = powerEuT / voltage

The total is preserved exactly, so speed, parallels and overclocks do not
move. The tier is a guess, but it is the plausible one, because hatches at
the recipe's own tier is what people build.

We are not trying to recover the author's real hatches, which the plan never
recorded. Some migrated cards will be wrong and some will go red, and that is
accepted for 3.0. A card is one dropdown away from correct.

## 9. Success

- Placing a multiblock and setting its power takes no typing and no mental
  arithmetic.
- Two machines on one plan can sit at different hatch voltages.
- A build the game would refuse is flagged before it is built.
- The breakpoint ladder is still reachable in one click, and the "you are
  over-supplied" case is now stated out loud.

## 10. Decided

- **No stored tier anywhere.** Not per plan, not per machine type, not a
  remembered last pick. A new card seeds from the lowest tier its own recipe
  needs, which is a property of the recipe and needs no storage. The same
  rule seeds migrated cards (section 8), so there is exactly one seeding rule
  in the whole feature.
- **The tier skip gate is already a hard stall and stays one.** It is built,
  it is correct, and it is only being handed a better voltage.
- **Migration is rough on purpose** (section 8). Old plans breaking is
  already the shape of the 3.0 update, so the seeded tier is a plausible
  guess rather than a lossless one.
- **The amps field is never disabled**, including on the amperage-off
  machines, because amps still buy parallels there. It carries a warning
  saying what they do and do not buy (section 4).

Nothing is open.

- **The plan-wide tier setting goes away entirely** (section 6). Everything
  above the card reads in EU/t.
- **The amps field is never disabled**, including on the amperage-off
  machines, because amps still buy parallels there. It carries a warning
  saying what they do and do not buy (section 4).

## Implementation notes (2026-09-09)

- `hatchVoltageTier` and `hatchAmps` are authoritative. `powerEuT` is derived
  and persisted; old plans keep their total and seed voltage from the selected
  recipe's minimum. Legacy nodes outside the load funnel still have the old
  interpretation for compatibility.
- Placement searches the summed-voltage intervals for the smallest supply
  that fills structural parallels, accounting for voltage-driven parallels
  and heat discounts. Existing configured cards keep their input on config,
  handler, shared-recipe, and refactor changes.
- The menu edits decimal amps directly. EU/t entry rounds to whole working
  amps and reports the direction. Hatch options show exact equivalents and
  the next whole build where an exact one does not exist, labelling added EU/t.
- Power-input rules are separate from coefficient coverage, so scraped
  machines also receive the zero-skip and amperage-off checks. The gate reads
  raw recipe EU/t, as `OverclockCalculator.getAllowedTierSkip` does; the
  parallel budget reads the modified draw. Runtime variants cannot override
  an explicit multiblock supply; fusion retains its dedicated exported ladder.
- Source audit: GT5-Unofficial `OverclockCalculator`, `MTEPreciseAssembler`,
  `MTEIndustrialArcFurnace`, `MTESteamMultiBlockBase`, `MTENanoForge`,
  `MTETranscendentPlasmaMixer`, and `MTENanochipAssemblyModuleBase`.
  Nano Forge and Transcendent Plasma Mixer use custom available-voltage
  setters in game. This feature follows the PRD's explicit hatch-voltage
  ceiling for amperage-off machines; their broader custom power mechanics
  are not newly transcribed coefficients.
- Verification: model/store regression tests plus desktop and phone browser
  checks of stepping, EU/t entry, Escape, hatch selection, and reload.

## Revision (2026-09-23): whole amps and switches keep the voltage

Community reports: an LCR seeded at 0.94A LV and moved to HV sat at 0.94A
HV, short of HV's own voltage, and ran like an MV reactor; an EV Forge
Hammer switched to the Industrial Sledgehammer came up 63A EV, because its
parallels grow with voltage and the full-parallel seed chased them to a ZPM
summed voltage.

- The full-parallel seed now lands on whole amps (at least 1A).
- A tier change lifts a supply under 1A to 1A; typed decimals of 1A or more
  are kept.
- Switching singleblock to multiblock (machine menu, refactor, twin swap)
  seeds one hatch, 1A, at the singleblock's run tier, floored at the
  recipe's draw tier. Multiblock to singleblock takes the hatch tier.
  Multiblock to multiblock keeps its hatches, as before.
- Fresh multiblock placement keeps the section 6 full-parallel default, so a
  voltage-scaled machine placed straight from search can still seed high.
