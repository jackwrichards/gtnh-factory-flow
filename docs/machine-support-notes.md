# Machine support notes

Triage of every machine from `machine-tooltip-survey-2.9.md` whose tooltip
contains stat-looking lines. Status meanings:

- **FULL** - all quantified stats parse from the tooltip; math is modeled.
- **PARTIAL** - headline stats modeled; listed leftovers are not.
- **WIKI** - modelable, but the numbers are not printed in the tooltip.
  Needs wiki/source values, or the structured exporter.
- **DYNAMIC** - runtime-state mechanic (ramp-up, durability, stability,
  randomness) that a static planner cannot represent; deliberate skip.
- **OUT OF SCOPE** - not a recipe-throughput machine (generators, boilers,
  turbines, purification chance games) or informational-only lines.

The parser is grammar-based; nothing below is hardcoded per machine.

## FULL (all quantified stats captured)

- Volcanus, Exothermic Hearth, Utupu-Tanuri - stats + EBF heat lines
  (heat overclocks/discounts already computed by the solver's coil+heat
  math). ExH ramping parallels (up to 2x over 30 min) is DYNAMIC extra.
- Dangote Distillus - per-mode stats per map. Distillery-mode parallels
  formula depends on tower height with no stated cap: WIKI leftover.
- Mega Distillation Tower (new controller) - both modes incl. Tower
  Height control from its stated 5-slice cap.
- Elemental Duplicator, L.A.T.E.X., Thermic Heating Device, Mass
  Solidifier, Nuclear Salt Processing Plant, Large Thermal Refinery,
  Pseudostable Black Hole Containment Field (steady state) - flat
  "N Parallels per Voltage Tier" + speed/EU totals.
- Industrial Centrifuge - momentum ranges taken at steady-state maximum
  (planner assumes sustained running).
- Large Fluid Extractor - solenoid parallels + compounding coil formula.
- Zyngen - Voltage x Coil parallels + per-tier speed; heat perfect-OC
  upgrade line is the EBF mechanic (solver handles via coil heat).
- Industrial Maceration Stack - 2/8 per voltage tier upgrade choice
  with the paired 160%/640% speed per chip tier.
- ExxonMobil Chemical Plant - pipe casing parallels + coil speed
  formula. Catalyst damage chance lines are informational (no throughput
  effect beyond catalyst consumption, which is not modeled).
- Industrial Coke Oven - casing + slices + coil EU discount.
- FusionTech MK IV/V - perfect overclocks flagged.
- Circuit Assembly Line, IsaMill, Flotation Cell Regulator, Large
  Chemical Reactor, Matter Fabrication CPU - perfect-overclock flag.
- Steam multiblocks (Blender, Fuser, Grinder, Hearth, Presser,
  Purifier, Separator, Squasher) - parallels, speed, high-pressure
  choice. Steam cost itself (62.5% usage) is not modeled because the
  power model is EU-based; see OUT OF SCOPE note.
- Space Assembler Modules MK-I/II/III - Runs-at lines (tier, speed,
  parallels).
- Solar Factory - Precise Casing parallel table (8/16/32/64). Wafer-tier
  output bonus is PARTIAL leftover (output multiplier by input choice).
- Nano Forge - perfect overclocks on lower-tier recipes flagged.
- Density^2 - speed/EU totals. Affine "1 + (Tier/2) Parallels" not
  modeled (needs an affine voltage-parallel primitive): WIKI leftover.

## WIKI (numbers now sourced from wiki.gtnewhorizons.com, 2026-07-29 - ready to implement)

Each entry lists the exact values a control needs. Implementation shape in
brackets: [item selector] = a control whose tiers are the insertable items,
[casing control] = a tiered structure control, [formula] = new primitive.

### Industrial Arc Furnace (LuV) [item selector: electrode]
Per-electrode stats. OC column is speed-x/power-x per overclock step
(2.0/4 = imperfect, 4.0/4 = perfect). Surge affects startup power only.

| Electrode | Speed | Parallels | OC | EU amps/parallel |
|---|---|---|---|---|
| Graphite | 100% | 4 | 2.0/4 | 1.0 |
| Tantalum | 120% | 2 | 4.0/4 | 1.2 |
| Molybdenum | 90% | 16 | 3.0/4 | 0.8 |
| Tungsten | 100% | 128 | 1.0/4 | 1.1 |
| Tungstensteel | 80% | 256 | 1.0/4 | 1.2 |
| Graphene | 250% | 16 | 2.0/4 | 1.0 |
| YBCO | 120% | 8 | 6.0/4 | 0.8 |
| Netherite | 220% | 64 | 1.5/4 | 1.3 |
| Tritanium | 300% | 48 | 2.0/4 | 1.7 |
| Infinity | 420% | 1 (doubles per recipe) | 1.0/4 | 1.0 |
| Hypogen | 650% | 256 | 1.0/4 | 1.5 |
| Neutronium Nanite | 500% | 64 | 2.0/4 | 2.0 |
| Transcendent Nanite | 750% | 512 | 4.0/4 | 2.0 |
| Universium Nanite | 1000% | 1024 | 8.0/4 | 2.0 |

Blast mode runs EBF recipes at 16x power. Warm-up/cool-down (6s each)
and durability wear are DYNAMIC extras. Fractional OC ratios (1.0/4,
3.0/4, 6.0/4...) need a generalized overclock-factor primitive beyond
the current perfect/imperfect pair.

### Industrial Cutting Factory (IV) [item selector: sawblade]
| Sawblade | Speed | EU/t | Parallels per voltage tier |
|---|---|---|---|
| Tungsten Titanium Carbide | 250% | 90% | 2 |
| Mysterious Crystal | 300% | 80% | 3 |
| Neutronium | 350% | 70% | 4 |
| Transcendent Metal | 450% | 60% | 6 |

Directly expressible with existing primitives (durationMultiplier,
eutMultiplier, parallelPerVoltageTier per selector tier).

### Magnetic Flux Exhibitor (IV) [item selector: electromagnet]
| Magnet | Speed | EU/t | Parallels |
|---|---|---|---|
| Iron | 110% | 80% | 8 |
| Steel | 125% | 75% | 24 |
| Neodymium | 150% | 70% | 48 |
| Samarium | 200% | 60% | 96 |
| Tengam | 250% | 50% | 256 |

Directly expressible with existing primitives.

### Spinmatron-2737 (ZPM) [item selector: turbines, simplified]
Standard mode: 300% speed, 70% EU/t, parallels = 4 x sum of turbine
tiers (huge 100%, large 75%, normal 50%, small 25% of tier value; tier
values range Alduorite 1 to Universium 30; slots = 2 per structure tier
T1-T4). Light mode: +100% speed, recipe tier capped at VT-3. Heavy
mode: parallels / 32. Biocatalyzed propulsion fluid: parallels x1.25.
Full modeling needs turbine-loadout input; a simplified selector with
a few representative loadouts would cover planning.

### Exo-Foundry (UEV) [module selector, simplified]
Base: 150% speed, 16 parallels/VT, tiers T1/T2/T3 = 2/3/4 module slots.
Modules: SCB +12 parallels/VT each; PVS EU x0.8 and -10% per unit;
SC +150% speed additive each; HR (2+: +75% speed, -10% EU each; 3+: +6
parallels/VT each); Hypercooler +1..3 OC via coolant; Sentient
Overclocker +0.35 OC factor; Universal Collapser 2x speed 4x EU.
Pairings add more. Full modeling needs a module-loadout builder; a
simplified "common loadouts" selector is the pragmatic version.

### PCB Factory (UV) [formula + upgrade selector]
Parallels = ceil(nanites^0.75), cap 256 (needs a nanite-count input).
Cooling: none = no OCs; T1 liquid cooling (10 L/s distilled water) =
imperfect OCs; T2 thermosink (10 L/s super coolant) = perfect OCs.
Upgrade power penalty: EU x sqrt(upgrade count). Trace size 50-200um:
output x(100/T), duration x(100/T)^2.

### Hyper-Intensity Laser Engraver (IV) [formula: laser hatch]
350% speed, 80% EU/t (already parsed from tooltip). Parallels =
cbrt(laser source amperage): 256A=6, 4096A=16, 16.7M A=256. Needs a
laser-source-hatch selector (amperage list is the standard hatch
ladder). Max recipe tier = laser tier + 1.

### Draconic Evolution Fusion Crafter (UHV) [casing control]
Casings: T1 Bloody Ichorium, T2 Draconium, T3 Wyvern, T4 Awakened
Draconium, T5 Chaotic. Each casing tier above the recipe's minimum =
1 perfect overclock; further voltage OCs are imperfect. No parallels.
Same shape as the EBF coil mechanic (casing control + per-recipe
minimum tier).

### Naquadah Fuel Refinery (UHV) [casing control]
Coils T1-T4 (Field Restriction / Advanced / Ultimate / Temporal).
Parallels = 4 x coil tier. Each coil tier above the recipe's minimum =
+1 perfect overclock. Not voltage-overclockable. Recipe coil minimums
are per-recipe (like EBF heat).

### Component Assembly Line (UV) [casing control]
All recipes: inputs and duration x0.75 (already baked into recipes?
verify against dataset). Casing tier must be >= component tier; each
casing tier above the minimum halves recipe time. Casing per voltage
tier ZPM..UXV. Same shape as EBF coils.

### Precise Auto-Assembler MT-3662 (IV) [casing control]
Normal (assembler) mode: 200% speed, parallels by Precise Casing:
Mk-0=16, Mk-I=32, Mk-II=64, Mk-III=128, Mk-IV=256. Precise mode: no
bonuses. Directly expressible as an enumerated parallel table control
plus the 2x speed.

### Hot Isostatic Pressurization Unit (ZPM) [dual-state, use normal]
Normal state: 350% speed, 75% EU/t, 4 parallels per voltage tier.
Overheated: 40% speed, 110% EU/t, 1 parallel/VT. Heat +5% x 0.9^(coil
tier - 1) per second running; planner should model the normal state
(sustained operation requires duty-cycling; steady-state throughput
depends on run/cool cycle, which is DYNAMIC).

### Zhuhai Fishing Port (IV) [affine formula]
Parallels = 2 x (voltage tier + 1): LV 4 ... UV 18 ... MAX+ 32.
Needs the affine voltage-parallel primitive (base + n x tier).

### Density^2 (IV) [affine formula]
200% speed (parsed already). Parallels = 1 + floor(tier / 2): LV 1,
MV/HV 2, EV/IV 3 ... MAX 8. Needs affine primitive with floor.

### Dangote Distillus distillery mode - RESOLVED
Max tower height is 12 and distillery mode REQUIRES full height, so
(2 x floor(12/3)) x VT = flat 8 parallels per voltage tier. Directly
expressible with parallelPerVoltageTier=8 today; worth adding as a
special-cased consequence of the "requires max height tower" line plus
wiki-confirmed height, or waiting for the structured exporter.

### Nanochip Assembly Complex (UEV) [defer]
Static-plannable best case exists (perfect OCs 2/2 to a 5s floor,
unlimited parallels, fixed water-grade table) but calibration state and
impurity make honest modeling misleading. Defer until the machine
leaves "Not Yet Implemented" status in the pack.

### Fusion Control Computers / Compact Fusion - informational only
EU/t caps and startup energy gate which recipes fit; no rate effect
beyond tiering. No action needed for throughput math.

## DYNAMIC (deliberately not modeled)

- Exothermic Hearth / Endothermic Fridge ramping bonuses (30/5-minute
  warm-up, coolant boosts, subspace-cooling perfect OCs by coolant).
- DTPF fuel-discount ramp (8h) and convergence perfect OCs (catalyst
  cost); tier-free running.
- Eye of Harmony - success chances, circuit OCs, astral array
  parallels, wireless EU; entire machine is its own simulator.
- Bacterial Vat output-hatch efficiency, HIP overheating cycle, black
  hole stability windows (2x/4x below 50/20), Decay Warehouse
  half-life speeds, Large Neutralization Engine residue system, LHC
  beam energy cycles, Solar Tower heat curve, Forge of the Gods /
  Godforge module upgrade trees, BEC condensate network, Observation
  Array nanite speed scaling, Transcendent Plasma Mixer manual
  parallels, Research Station/Quantum Computer computation.

## OUT OF SCOPE (not recipe-throughput machines)

- All generators: engines (Large/Extreme Combustion, Rocketdyne, UCFE),
  turbines (XL Gas/Plasma), Naquadah reactors, Acid Generators, Magic
  Energy machines, LFTR, Thermal Boiler, Large Boilers (also
  deprecated). The planner does not yet model power generation economy.
- Purification Units (all 8 water tiers) - chance/minigame recipes for
  the Purification Plant system.
- Space Mining/Research/Project modules - plasma/computation gated
  asteroid lottery.
- Tree Growth Simulator - already fully modeled separately (tools +
  tier output multipliers).
- Singleblock "Voltage IN/OUT/Capacity/Amperage" lines - tier metadata
  already captured from names/tiers; generator fuel efficiency is the
  generator economy question again.

## Systemic gaps worth building next (in order of value)

1. Structured exporter pass: ask each MetaTileEntity for machine stats
   (parallels, speed, OC behavior, tier tables) instead of parsing
   prose. Kills the entire WIKI section at once and makes per-machine
   overclock tables exact.
2. Affine voltage parallels primitive (base + n per tier) for
   Density^2, Zhuhai, HIP.
3. Item-driven bonuses (electrodes, sawblades, magnets, turbines,
   nanites) - needs exporter to dump those item stats, then a selector
   control per machine.
4. Generator/power economy modeling (fuel value in, EU out).
