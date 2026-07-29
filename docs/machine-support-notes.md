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

## WIKI (numbers exist but not in the tooltip - send wiki pages or wait for structured exporter)

- Draconic Evolution Fusion Crafter - 1 perfect OC per casing tier
  above recipe; needs casing tier list.
- Naquadah Fuel Refinery - coil tier gates fuel types + perfect OCs;
  counts unstated.
- Hyper-Intensity Laser Engraver - parallels = cube root of laser
  source amperage; needs a laser-hatch selector concept.
- Industrial Cutting Factory - sawblade bonuses live in sawblade item
  tooltips; exporter could capture the sawblade items.
- Industrial Arc Furnace - electrode-driven speed/parallel/OC; electrode
  stats live on electrode items.
- Magnetic Flux Exhibitor - electromagnet bonuses live on magnet items.
- Exo-Foundry - module system (2-4 slots, 7 options each); module stats
  shown in NEI/controller, not the controller tooltip.
- Spinmatron-2737 - turbine-slot parallels ("4 per sum of turbine
  tier") depend on inserted turbines; kerosene upkeep unmodeled.
- PCB Factory - nanite-count parallels (n^0.75, max 256) and cooling
  upgrades (liquid = normal OC, thermosink = perfect OC); needs a
  nanite-count input and upgrade selector.
- Precise Auto-Assembler MT-3662 - casing tier limits recipe tier; fine
  as-is for math (no rate effect stated).
- Component Assembly Line - "halves recipe time per casing tier above
  recipe" needs the casing-tier control concept (like EBF coils but for
  CoAL casings).
- Nanochip Assembly Complex + modules (Assembly Matrix, Etching Array,
  Optical Organizer, Immersion Device, Encasement Wrapper) - grade/
  calibration bonuses partially quantified; system is deeply stateful.
- Zhuhai Fishing Port - "(Tier + 1) * 2 recipes" affine parallels.
- Hot Isostatic Pressurization Unit - dual-state 250%/75%/4-per-tier
  normal stats vs overheated; normal-state numbers are parseable in
  principle but the slash phrasing is ambiguous; also DYNAMIC heat.
- Fusion Control Computers / Compact Fusion - EU/t caps per hatch and
  startup energy are informational for tier gating; startup cost not
  modeled.

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
