# Singleblock tier audit — GTNH 2.9

Audited on 2026-09-12 against the existing `local-2.9.0-beta-2` oracle export.
The export's 171 GregTech recipe maps include 53 maps with electric processing
singleblocks: 53 families and 588 representative tier items. This includes
BartWorks and GT++ processing machines, not just base GregTech machines.
Generators and non-recipe-map automation have separate models and are outside
these processing-family counts. Steam machines and multiblocks remain separate
handlers.

The checked-in `singleblock-catalysts.json` fixture preserves the actual item
IDs, classes, names and tooltips for all 53 maps. The tests check every exported
voltage-input singleblock, accepting another face at the same tier only when it
has the same exported Java class and explicit Machine Type. Electric Oven is
such a cosmetic alternative to Electric Furnace; its tooltip says so.

The name change at high tiers must not split one runtime family. Examples are
Chemical Reactor → Chemical Performer, Centrifuge → Molecular Tornado, Fluid
Extractor → Liquefying Sucker, and Electric Furnace → Atom Stimulator. The
pipeline groups those by runtime class and Machine Type, retaining real item
names and art for each registered tier.

The maximum is not universal: 45 of these families end at UMV, four at UV,
three at ZPM and one at literal MAX. Cold Trap and Reactor Processing
Unit register only IV and ZPM; there is no LuV variant between them. Exported
`availableTiers` now carries the actual ladder into handlers, saved recipes,
the tier control, and both calculated and runtime-exported overclocks. Legacy
settings in a gap resolve to the lower real machine, or the first real machine
that can run the recipe when the lower one is underpowered.

The generic runtime overclock export contains voltage steps for machines that
do not exist. It supplies recipe math, not evidence of registered machines.
The Chemical Reactor registration in GT5U's
`gregtech/loaders/preload/LoaderMetaTileEntities.java` independently confirms
its LV–UMV range and Ultimate/Epic names.

Two downstream exceptions were also repaired. Vanilla smelting's Electric
Furnace handler now retains the exported ladder when applying its fixed
128-tick/4-EU recipe seed. The Ore Washing Plant controller receives a distinct
ID across all its maps, and the app no longer merges its name with the tiered
singleblock Ore Washer. Its multiblock identity and behavior remain intact.

GT++ omits Machine Type tooltips on its Dehydrators. The exported class plus
recipe-map membership identifies Basic and Chemical Dehydrator as one MV–ZPM
chain. The [game registration](https://github.com/GTNewHorizons/GT5-Unofficial/blob/master/src/main/java/gtPlusPlus/xmod/gregtech/registration/gregtech/GregtechDehydrator.java)
confirms identical recipe backend, item slots and fluid slots across all six.

## Registered families

The following table is derived from the audited export. Ranges are inclusive;
the two gapped ladders are written explicitly.

| Recipe map | Machine family | Registered tiers | Items | Highest item |
| --- | --- | --- | ---: | --- |
| Bio Lab | bio-lab | HV–UMV | 10 | Bio Lab |
| Crop Breeder | crop-breeder | LV–UMV | 12 | Epic Crop Breeder IV |
| Crop Gene Extractor | crop-gene-extractor | EV–UMV | 9 | Epic Crop Gene Extractor IV |
| Crop Synthesizer | crop-synthesizer | EV–UMV | 9 | Epic Crop Synthesizer IV |
| Seed Generator | seed-generator | LV–UMV | 12 | Epic Seed Replicator IV |
| Alloy Smelter | alloy-smelter | LV–UMV | 12 | Epic Alloy Integrator IV |
| Arc Furnace | arc-furnace | LV–UMV | 12 | Epic Short Circuit Heater IV |
| Assembler | assembling-machine | LV–UMV | 12 | Epic Assembly Constructor IV |
| Autoclave | autoclave | LV–UMV | 12 | Epic Pressure Cooker IV |
| Brewery | brewery | LV–UMV | 12 | Epic Brew Rusher IV |
| Canner | canning-machine | LV–UMV | 12 | Epic Can Operator IV |
| Centrifuge | centrifuge | LV–UMV | 12 | Epic Molecular Tornado IV |
| Chemical Bath | chemical-bath | LV–UMV | 12 | Epic Chemical Dunktron IV |
| Chemical Reactor | chemical-reactor | LV–UMV | 12 | Epic Chemical Performer IV |
| Circuit Assembler | circuit-assembler | LV–MAX | 14 | MAX Circuit Assembling Machine |
| Compressor | compressor | LV–UMV | 12 | Epic Matter Constrictor IV |
| Cutting Machine | cutting-machine | LV–UMV | 12 | Epic Object Divider IV |
| Distillery | distillery | LV–UMV | 12 | Epic Fraction Splitter IV |
| Electrolyzer | electrolyzer | LV–UMV | 12 | Epic Ionizer IV |
| Electromagnetic Separator | electromagnetic-separator | LV–UMV | 12 | Epic Magnetar Separator IV |
| Extractor | extractor | LV–UMV | 12 | Epic Extractinator IV |
| Extruder | extruder | LV–UMV | 12 | Epic Shape Driver IV |
| Fermenter | fermenter | LV–UMV | 12 | Epic Fermentation Hastener IV |
| Fluid Extractor | fluid-extractor | LV–UMV | 12 | Epic Liquefying Sucker IV |
| Fluid Heater | fluid-heater | LV–UMV | 12 | Epic Heat Infuser IV |
| Fluid Solidifier | fluid-solidifier | LV–UMV | 12 | Epic Fluid Petrificator IV |
| Furnace | electric-furnace | LV–UMV | 12 | Epic Atom Stimulator IV |
| Forge Hammer | forge-hammer | LV–UMV | 12 | Epic Impact Modulator IV |
| Laser Engraver | precision-laser-engraver | LV–UMV | 12 | Epic Exact Photon Cannon IV |
| Lathe | lathe | LV–UMV | 12 | Epic Turn-O-Matic IV |
| Macerator | macerator | LV–UMV | 12 | Epic Shape Eliminator IV |
| Mass Fabrication | mass-fabricator | LV–UMV | 12 | Epic Existence Initiator IV |
| Bending Machine | bending-machine | LV–UMV | 12 | Epic Bending Unit IV |
| Furnace | microwave | LV–UMV | 12 | Epic UFO Engine IV |
| Mixer | mixer | LV–UMV | 12 | Epic Matter Organizer IV |
| Ore Washer | ore-washing-plant | LV–UMV | 12 | Epic Ore Washing Machine IV |
| Packager | packager | LV–UV | 8 | Boxinator |
| Electromagnetic Polarizer | polarizer | LV–UMV | 12 | Epic Magnetism Inducer IV |
| Forming Press | forming-press | LV–UMV | 12 | Epic Surface Shifter IV |
| Printer | printer | LV–UV | 8 | Advanced Printer VII |
| Replicator | replicator | LV–UMV | 12 | Epic Elemental Composer IV |
| Rock Breaker | rock-breaker | LV–UMV | 12 | Cryogenic Magma Solidifier R-15200 |
| Scanner | scanner | LV–UMV | 12 | Epic Electron Microscope IV |
| Sifter | sifting-machine | LV–UMV | 12 | Epic Pulsation Filter IV |
| Thermal Centrifuge | thermal-centrifuge | LV–UMV | 12 | Epic Fire Cyclone IV |
| Unpackager | unpackager | LV–UV | 8 | Unboxinator |
| Matter Amplifier | amplifabricator | LV–UMV | 12 | Epic Amplicreator IV |
| Wiremill | wiremill | LV–UMV | 12 | Epic Wire Transfigurator IV |
| Dehydrator | dehydrator | MV–ZPM | 6 | Chemical Dehydrator IV |
| Cold Trap | cold-trap | IV, ZPM | 2 | Cold Trap II |
| Reactor Processing Unit | reactor-processing-unit | IV, ZPM | 2 | Reactor Processing Unit II |
| Simple Dust Washer | simple-washer | LV–UV | 8 | Simple Washer VIII |
| Recycler | recycler | LV–UMV | 12 | Epic Scrap-O-Matic IV |
