# The Power Planner's Math (decoded)

The community "GTNH Power Planner" spreadsheet - title cell reads
"GregTech New Horizons - Power Planner, Version(s) 2.9, Made by Fox" - is the
source of truth for the planner's power sector (see `power-sector.md`). This
file is the workbook reverse-engineered: every sheet's model reconstructed
from its formulas, 2026-08-30, from Jack's copy at
`C:\Users\jack\Downloads\Copy of GTNH Power Planner 2.9.xlsx`.

How it was read: the xlsx was unzipped and each worksheet XML dumped to
"ref: value {=formula}" text. Most row LABELS in the workbook are in-cell
images (it is a Google Sheets export), so meanings below are inferred from
formulas plus GTNH mechanics; formulas are quoted verbatim where they carry
the model. Caveats for the build phase:

- An early dump pass mis-attributed some plain values (not formulas) to
  neighbouring cells; the dumper was fixed (self-closing `<c/>` cells) and
  dumps regenerated, but any VALUE cited here should be re-read from a fresh
  extraction before it becomes shipped data. Formulas are trustworthy.
- Extract data tables PROGRAMMATICALLY from the xlsx (rotor catalog, fuel
  tables, the workbook's own computed sample cells as golden test values).
  No hand transcription.
- Where the sheet simplifies the game, the game wins: cross-check formulas
  against GT5U/GT++ source (`C:\Users\jack\gtnh-sources`) when transcribing.

Sheet inventory: Large Turbines, Large Engines, Singleblocks, Rotor Data,
Fuel Data, then numbered machine sheets 1-13: Large Boiler, SOFC, Fluid
Reactor, DEHP, Solar Tower, THTR, HTGR, LFTR, Fusion Reactor, Compact Fusion
Reactor, LNR, Antimatter, EOH.

Conventions: 20 ticks/s appears as x20 or /20 everywhere; reactor-side fluid
rates are L/s while turbine flows are L/t; "amps" rows are
`EU/t / voltage(tier)` via the shared voltage ladder
(`'Large Turbines'!L56:N68`: LV 32 ... UXV 536,870,912). Costs are negative.

## Shared machinery

### The rotor catalog (`Rotor Data`, rows 6-171: 166 materials)

Per material: `C` tier, `D` unlock ("00-Steam" ... "13-UXV"), `F` base
durability, `G` overflow tier (1-3), `H/I/J` steam/gas/plasma material
multipliers (almost always 1). Then 4-wide `[Small, Normal, Large, Huge]`
column groups, Tight and Loose variants each, for the three turbine classes:

- Steam: efficiency `Z:AC` / `AT:AW` (loose), optimal flow L/t `AE:AH` /
  `AY:BB`.
- Gas: efficiency `BN:BQ` / `CH:CK`, optimal ENERGY flow EU/t `BS:BV` /
  `CM:CP` (divide by fuel EU/L for L/t).
- Plasma: efficiency `DB:DE` / `DV:DY`, optimal energy flow `DG:DJ` /
  `EA:ED`, plus `DL:DO` = EU/t at optimal (used by the XL plasma derate).

Size table (rows 174-177): durability x1/x2/x3/x4 for Small/Normal/Large/
Huge, efficiency delta -50/-25/0/+25 (already baked into the size columns).
`totalDurability = F x sizeMult`.

### The turbine formula (one formula, per-class constants)

```
EUout = MAX(1, ROUNDDOWN(eff * fuelEU * flow *
          (1 - |flow - optFlow| / (optFlow * penaltyDiv))))
flow  = MIN(suppliedFlow, maxFlow)
```

Under-feeding is always the plain linear loss (penaltyDiv 1); over-feeding is
softened per class. OT = the rotor's overflow tier:

| Class | maxFlow | over-optimal penaltyDiv |
| --- | --- | --- |
| Large Steam | opt x (0.5 OT + 1) | OT + 1 |
| Large SH Steam | opt x (0.5 OT + 1.5) | OT + 2 |
| Large SC Steam | opt x 1.25 | 1 (none) |
| Large Gas | opt x (1.5 OT) | 3 OT - 1 |
| Large Plasma | opt x (1.5 OT + 1) | 3 OT + 1 |
| every XL variant | opt x 1.25 | 1 (none) |

XL turbines are the same lookups x16. Plasma flows are per second (the sheet
carries x20 conversions). XL Turbo Plasma derates weak plasmas:
`effXL = eff * MIN(1, (fuelEU * 0.005)^2 / RD.DL:DO[size])`.

Rotor lifespan (seconds): regular steam/SH/gas
`2 * ROUNDUP(totalDur / MIN(EU/5, EU^0.6) * 50)`; plasma the same without
the leading 2x; XL variants
`ROUNDUP(totalDur / MIN(EU/25, (EU/5)^0.6) * 50)` x1.25 loose. Loose fitting
multiplies lifespan x1.25 generally; SC steam is the quirk: x0.5 tight, x2
loose.

Steam EU/L (`'Fuel Data'!B6:C11`): Steam 0.5, SH Steam 1.0, SC Steam 1.0,
Dense Steam 500, Dense SH 1000, Dense SC 1000 (dense = 1000x, XL turbines
only; the SC turbine's optimal flow is the rotor figure x16).

### The turbine cascade

SC turbine exhausts SH steam 1:1; SH turbine exhausts Steam 1:1; plain steam
turbine ends the chain. Every reactor sheet ends in up to three banks wired
this way. In the planner this is just three wired cards - the exhaust is a
real output.

### The heat exchanger table (`'Fuel Data'!CF6:DE9`)

Rows: Thermal Boiler, Large Heat Exchanger, (unused fourth), Extreme Heat
Exchanger. Column groups per hot fluid (Lava, Pahoehoe, Hot Coolant, Hot
Solar Salt), fields `Threshold, Max, Throttle, Under Ratio, Over Ratio`:

| Fluid | HX | Threshold L/s | Max | Throttle | Under -> grade | Over -> grade |
| --- | --- | --- | --- | --- | --- | --- |
| Hot Coolant | LHE | 800 | 1600 | -30 | 400 -> Steam | 200 -> SH |
| Hot Coolant | EHE | 8000 | 128000 | -150 | 200 -> SH | 200 -> SC |
| Hot Solar Salt | LHE | 160 | 320 | -6 | 2000 -> Steam | 1000 -> SH |
| Hot Solar Salt | EHE | 1600 | 3200 | -150 | 1000 -> SH | 1000 -> SC |

Chain: effective threshold = base + (tier-1) x Throttle; LHE caps at 2x its
effective threshold, TB/EHE at Max; steam L/t = MIN(input L/s, cap) x Ratio
/ 20; efficiency = 1 - 0.015 x (tier-1) (Thermal Boiler exempt); grade flips
from Under to Over at the threshold (EHE: SH below, SC above - the
supercritical gate). Cold fluid returns 1:1 (closed loop).

## Singleblock generators (`Singleblocks`)

Nine panels (steam turbine, gas turbine, combustion, semifluid, thermal,
plasma, naquadah reactor, two magic absorber/converter variants). Model:

```
burn L/s = (V + ampLoss) / (fuelValue_EU_per_L * efficiency) * 20
EUout    = V EU/t (1 amp of the machine's tier)
```

`V`/`ampLoss` from the ladder (loss 1/2/4/8... EU per packet - the sheet DOES
charge GT's output loss). Efficiency is a per-family, per-tier table
(`AE6:BC17`), e.g. steam turbine 0.85/0.75/0.66/0.60/0.50 LV->IV, gas
turbine 0.95/0.90/0.85..., naquadah reactors RISING with tier
(0.5/0.6/1.0/1.5/2.0/2.5). Solid/one-shot fuels (naquadah rods, magic items)
use EU-per-item lists and a x3600 hour basis instead of L/s.

## Large Engines (`Large Engines`)

- Large Combustion Engine: 2048 EU/t, boosted x3 = 6144. Boost consumes
  40 L/s oxygen and raises fuel EFFICIENCY x1.5 (3x power for 2x fuel).
  Lubricant 1000 L/hr. Fuels over 2048 EU/L refuse to run unboosted
  (`IF(AND(fuelEU>2048, NOT(boost)), 0, ...)`).
- Extreme Combustion Engine: 10900 EU/t, boosted 32700; liquid oxygen 40;
  lubricant 8000 L/hr; own 3-fuel list (HOG family).
- A third 2048/6144 block over the semifluid fuel list.
- GT++ Rocket Engines: throttle setting; output
  `1.6384 * P * cbrtCap30k * cbrtCap80k` where `P = 0.05 * throttle *
  fuelEU`, with cube-root falloff past 30k and 80k EU; CO2 out 1000/hr, air
  intake `0.01 * EU`, liquid hydrogen `0.003 * EU` when boosted (x3 caps).
  A second variant uses efficiency `1.5 * EXP(-fuelCoeff / 0.2)` (per-fuel
  coefficient column in Fuel Data).
- One more tiered block (T1-T3, capacity 375000/1e6/2.5e6, decay 200/400/
  700, `SQRT(MIN(16, x)) * 1.2^tier` and a `(...)^12.5` durability law) -
  NOT yet identified; resolve against GT++ source at build time.

## Large Boilers (`1. Large Boiler`)

Four blocks: Bronze 1200 L/t steam, Steel 3000, Titanium 4000 SH,
Tungstensteel 16000 SH (per boiler). Rules:

- Dual-fuel: burning a liquid AND a solid at once = 100% output; either
  alone = 80% (960/2400/3200/12800), and dual-fuel halves each fuel's burn
  rate (the x2 on the divisor).
- Consumption: liquid L/s = 1000 / divisor, solid items/s = 1 / divisor;
  per-tier fuel tables in Fuel Data (higher tiers burn faster - smaller
  divisors). Water in = steam / 160.
- Titanium/Tungstensteel chain SH turbines into steam turbines (cascade).

## SOFC I / II (`2. SOFC`)

Fuel burners with a steam byproduct worth roughly as much as the direct EU:

- Mk I: 2048 EU/t, eff 1.0, fuel L/s = ROUNDDOWN(20 x 2048 / fuelEU),
  oxygen 100 L/s, byproduct 20,000 L/s plain Steam.
- Mk II: 24576 EU/t, eff = MAX(1, fuelEU/1000) (only fuels > 1000 EU/L
  benefit), oxygen 2000 L/s, byproduct 96,000 L/s SH Steam.

## IC2 Fluid Reactor (`3. Fluid Reactor`)

Reactor interiors are NOT modeled - four preset designs mapping to hot
coolant L/s per reactor (1150 / 1380 / 1340 / custom). Rod consumption is
absent from the sheet entirely. Hot coolant -> LHE or EHE -> cascade.
Banner: "Try Vacuum Reactors Instead".

## Vacuum Reactor (`4. Vac Nuke`)

An EU-mode IC2 reactor on ONE fixed layout - 40 rods and 14 coolant cells
in the 6x9 chamber - whose cells are pulled and recooled in a freezer.
Rods are grouped by rod neighbours: 4 with one, 14 with two, 22 with three.
Per rod: pulses `p = 1 + cells/2` (single 1, dual 2, quad 3, The Core 17),
`cells x (p + n)` pulses a second with `n` neighbours, each pulse
`sEnergy x 25` EU (IC2's x5 times the pack's `nuclear = 5.0`); heat
`(p+n)(p+n+1) x sHeat x cells / 2` a second, shed into the cells beside it.
Coolant heat map: hottest cell `4 x heat(3)`, coolest
`0.5 x heat(1) + heat(2)`, average `total / 14`; lifespans are durability
over those. Rod stats come from GT5U `LoaderGTBlockFluid`, where the sheet
matches the source everywhere but MOX: it flattens the bonus to x2.475 for
every MOX-type rod, the game does `1 + heatBonus x heat%` per rod (MOX 1.5,
HD Plutonium 6, Excited Plutonium 2, Naquadria 1.5) - the app follows the
source, with core temp as a knob.

The sheet's right-hand block sizes a freezer (Vacuum Freezer / Cryogenic
Freezer / Endothermic Fridge, hatch and amps) for the cells to recool a
minute, `14 / (durability / avgHeat) x 60`. The app does NOT put that on
the reactor card: the reactor's cells are real ports (hot cells out, cold
cells in, at that rate, one item id for both), and the freezer is the
dataset's own Vacuum Freezer recipe (120 EU/t, ticks = capacity / 1000)
placed and wired back into the reactor, so the board counts the freezers
and their EU like any other machine. A cell too small for the hottest
position (`4 x heat(3)` above its capacity) is warned about, as the sheet
does.

## DEHP (`4. DEHP`)

Parasitic -480 EU/t per pump; two modes: Direct Steam 25,600 L/t SH-grade
steam per pump (water in = steam/160), or Coolant Heating 192 L/t hot
coolant. Geothermal: nothing burned.

## Solar Tower (`5. Solar Tower`)

Rings 1-5 -> heliostats `(28 + 8r) x r` (340 at 5 rings) -> hot solar salt
out at exactly 1/10 the circulated cold salt (preset table: 38.6 / 104.6 /
217.4 / 431 / 883 L/s). Salt loop closed through the HX (solar salt ratios
1000-2000 L steam per L salt). NO day/night factor anywhere in the sheet -
it prices the daytime rate as constant. Power from nothing.

## THTR (`6. THTR`)

Pebble fill F (up to 675,000): efficiency
`MIN(1, 0.01 + ((F - 100000)/57500)^2 / 100)` (parabola - partial fills are
brutal), pebble cost `0.005 x F x eff`, parasitic `-3840 / eff` EU/t, hot
coolant `4800 x eff` L/t -> EHE -> SC cascade.

The planner follows MTEThoriumHighTempReactor past the sheet: one 648,000-tick
operation burns the pebble cost in TRISO pebbles and returns them as
Burned Out TRISO pebble balls (one per 64) plus loose burned pebbles; the
730,000 L helium charge is primed once and kept, so it is not a flow.

## HTGR (`7. HTGR`)

Fill x (of 10,000), 9 fuel pebble types each defined by `Base/Mult/Exp`
triples: output multiplier `(Base x) * (1 + (Mult-1)x)^(1 + (Exp-1)x)`,
efficiency `MIN(1, 0.1 + 0.9(1 - (1-x)^3))`, pebble cost
`fill x (PI() - 3) x 0.01 x eff` (yes, pi minus 3). TWO output streams: hot
coolant `0.5 x fill x mult` L/s AND direct plain steam `0.1 x fill x mult`
(x160 L/t). Parasitic -1536 EU/t.

The planner follows MTEHighTempGasCooledReactor past the sheet: the fuel base
is an average, so the multiplier is `Base * (1 + (Mult-1)x)^(1 + (Exp-1)x)`
(no second x - the ball count already multiplies the coolant line), sized
on the balls left after the burn and truncated per tick. One operation is
`(int)((2000 + 18000 eff) / exponent^2)` ticks of progress, and each supplied
tick adds `(int)(M x 0.0035)` + `(int)(M x 0.0015)` more, so a full glowstone
reactor cycles every 202 ticks. Per cycle it burns the pebble cost in TRISO
Fuel (returned as Burned Out TRISO Fuel) and loses 0.05% of its 512,000 L
helium (256 L), which the hatch tops back up.

## LFTR (`8. LFTR`)

Direct EU, no turbines: 16 amps of the fuel's base tier (Fuel 1 EV 32,768;
Fuel 2 IV 131,072; Fuel 3 LuV 524,288 EU/t) burning 1 L/s of fuel. Sparged
byproducts per second: U-Salt, T-Salt, TB-Salt, UF6, and 0.33 L/s
Uranium-233 always (the sheet's 0.33; MTENuclearReactor is a 1-in-300 chance a tick of
1-10 L, 0.3667 L/s, which the planner uses). The LFTB breeder makes the fuel: base 1920-7680 EU/t
over 1800-3000 s per 1000 L, overclockable at x4 power / x2 speed per tier
(deliberately lossy).

## Fusion + Compact Fusion (`9.` / `10.`)

Fuel Data holds the 66-recipe fusion table: product plasma, min mark, EU/L,
startup EU, two inputs with L-per-L ratios, EHE max L/s, decay gas. Output
L/s and reactor drain EU/t per mark are precomputed columns (Helium: 156 L/s
and -1920 EU/t at Mk-I; Compact: 10,000 L/s and -122,880 at MK-I - same
shape, ~64x). Three conversion routes are modeled, all reusing shared
machinery: Large Plasma Generator, XL Turbo Plasma Turbine, and plasma ->
EHE -> dense/SC steam -> turbine banks. The sheet's own numbers show the EHE
route beating direct turbining ~1.5-1.8x. Decay gas returns 1:1 for loop
closure (D-T -> Helium).

## LNR (`11. LNR`)

```
EU/t = baseEUt(fuel) x coolantEff x boosterMult x count
```

Fuels MK1-MK6 (975,000 EU/t up to 2.08e9); coolants None/IC2 1.05/Super
1.5/Cryotheum 2.75/Tachyon 5.0 (1000 L/s, Tachyon 20); boosters x2/x3/x4/
x16/x64 multiply output AND fuel burn (180 or 20 L/s of booster fluid);
liquid air flat 2400 L/s. The sheet also models the whole excited-fuel
PRODUCTION chain (9 recipe dusts x T1-T4 machines with EU costs) and nets it
against the reactor - its own sample config is net NEGATIVE, which is the
cautionary tale the planner will surface naturally once the chain is wired.

## EOH (`12. EOH`)

Modeled as a materials machine with an EU bill (net-negative power at low
tiers): 43 star blocks with per-star duration/success/EU-in/EU-out tables, a
success-pity expectation model, x4 EU per overclock, hydrogen/helium
overflow multipliers, star matter yields. Port the success/pity expectation
(`success = clamp(base - 0.0925(t2-1) + 0.05(t3-1))`, expected tries from
the pity ladder) rather than the raw columns.

## Antimatter (`13. Antimatter`)

The one superlinear source. Per 20 s cycle with AM = antimatter quantity and
catalyst-fluid exponent constants K:

```
gain  =  AM^(0.5 + K_spacetime) x (0.2 + K_depleted)
cost  = -(1e7 + (AM x 1000)^(1.5 - K_tengam)) - (AM x 10^4)^(1.5 - K_shirabon)/20
```

plus a burn stage capped at int64 EU per burn. Gain exponent ~0.5+, cost
exponent ~1.5-: the optimum is interior, and the sheet finds it with a
3235-row sweep. Reimplement as a small numeric search, not a table. Catalyst
fluids (Tengam, Spacetime, Shirabon, Depleted Mk-V) are consumed at
`AM^0.5 / AM^(2/7) / AM^(1/3)` rates; depleted fuel byproduct feeds LNRs.

## Fuel Data table map (for the extractor)

- B6:C11 steam grades EU/L. B15:C41 gas fuels EU/L (Benzene 360,
  Nitrobenzene 1600); B45:C70 XL gas list. E6:G115 plasmas: EU/L + EHE max
  intake band (500/2500/10000/25000).
- I..S fusion recipes (66); U:Y + AA:AE fusion output/cost by mark;
  AF:AK + AM:AQ compact fusion.
- AR..BC large-boiler fuel tables (name, burn value, rate divisor; per
  boiler tier). BD:BG a fuel list with per-fuel coefficient (rocket
  engines). BH:BJ EU-per-item solids (~90). BL6:BO14 LNR fuels;
  BL17:BN21 coolants; BL24:BN29 boosters. BM32:BQ37 LFTB recipes;
  BM40:BS43 LFTR fuels + byproducts. BR6:CD14 excited-fuel production;
  BR17:BS27 tiberium solids. CF6:DE9 heat exchangers. CB17:CC34
  antimatter containment tiers. BM46:BO62 hot-fluid soft caps and HTGR
  pebble Base/Mult/Exp triples.
