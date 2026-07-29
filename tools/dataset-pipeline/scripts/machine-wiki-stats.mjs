// Wiki-sourced machine stats for values the in-game tooltips do not state.
//
// Source: wiki.gtnewhorizons.com, fetched 2026-07-29. Full provenance and
// per-machine tables live in docs/machine-support-notes.md. This file exists
// at the user's explicit request as a stopgap until the structured exporter
// can pull these values from the machine classes directly; tooltip-parsed
// stats always take precedence over entries here.
//
// Shape per entry:
//   durationMultiplier / eutMultiplier - filled only if the tooltip gave none
//   selector - one control whose tiers are the insertable items or casing
//     choices (speed = total speed factor, eu = EU/t factor, parallels =
//     fixed count, perVoltageTier / voltageBase = scaled parallels)
//   note - shown in the control tier tooltips

function selectorControl(id, label, options, note) {
  return {
    id,
    label,
    minimumKey: options[0].key,
    defaultKey: options[0].key,
    tiers: options.map((option) => {
      const tier = {
        key: option.key,
        label: option.label,
        resource: {
          kind: "item",
          id: `factoryflow:machine_config/${id}_${option.key}`,
          amount: 1,
          displayName: option.label,
          tooltip: [note, ...(option.tooltip ?? [])].filter(Boolean),
          consumed: false,
        },
      };
      if (option.speed !== undefined && option.speed !== 1) {
        tier.durationMultiplier = 1 / option.speed;
      }
      if (option.eu !== undefined && option.eu !== 1) {
        tier.eutMultiplier = option.eu;
      }
      if (option.parallels !== undefined && option.parallels > 1) {
        tier.parallelMultiplier = option.parallels;
      }
      if (option.perVoltageTier !== undefined) {
        tier.parallelPerVoltageTier = option.perVoltageTier;
        if (option.voltageBase !== undefined) {
          tier.parallelVoltageBase = option.voltageBase;
        }
      }
      return tier;
    }),
  };
}

const WIKI_NOTE = "Stats from the GTNH wiki (not stated in the machine tooltip)";

const ENTRIES = new Map([
  [
    "industrial arc furnace",
    {
      selector: selectorControl(
        "arcElectrode",
        "Electrode",
        [
          { key: "graphite", label: "Graphite", speed: 1, parallels: 4, eu: 1 },
          { key: "tantalum", label: "Tantalum", speed: 1.2, parallels: 2, eu: 1.2 },
          { key: "molybdenum", label: "Molybdenum", speed: 0.9, parallels: 16, eu: 0.8 },
          { key: "tungsten", label: "Tungsten", speed: 1, parallels: 128, eu: 1.1 },
          { key: "tungstensteel", label: "Tungstensteel", speed: 0.8, parallels: 256, eu: 1.2 },
          { key: "graphene", label: "Graphene", speed: 2.5, parallels: 16, eu: 1 },
          { key: "ybco", label: "YBCO", speed: 1.2, parallels: 8, eu: 0.8 },
          { key: "netherite", label: "Netherite", speed: 2.2, parallels: 64, eu: 1.3 },
          { key: "tritanium", label: "Tritanium", speed: 3, parallels: 48, eu: 1.7 },
          { key: "hypogen", label: "Hypogen", speed: 6.5, parallels: 256, eu: 1.5 },
          {
            key: "neutronium_nanite",
            label: "Neutronium Nanite",
            speed: 5,
            parallels: 64,
            eu: 2,
          },
          {
            key: "transcendent_nanite",
            label: "Transcendent Nanite",
            speed: 7.5,
            parallels: 512,
            eu: 2,
          },
          {
            key: "universium_nanite",
            label: "Universium Nanite",
            speed: 10,
            parallels: 1024,
            eu: 2,
          },
        ],
        WIKI_NOTE,
      ),
      note: "Electrode overclock ratios and durability wear are not modeled.",
    },
  ],
  [
    "industrial cutting factory",
    {
      selector: selectorControl(
        "cuttingSawblade",
        "Sawblade",
        [
          {
            key: "tungsten_titanium_carbide",
            label: "Tungsten Titanium Carbide",
            speed: 2.5,
            eu: 0.9,
            perVoltageTier: 2,
          },
          {
            key: "mysterious_crystal",
            label: "Mysterious Crystal",
            speed: 3,
            eu: 0.8,
            perVoltageTier: 3,
          },
          { key: "neutronium", label: "Neutronium", speed: 3.5, eu: 0.7, perVoltageTier: 4 },
          {
            key: "transcendent_metal",
            label: "Transcendent Metal",
            speed: 4.5,
            eu: 0.6,
            perVoltageTier: 6,
          },
        ],
        WIKI_NOTE,
      ),
    },
  ],
  [
    "magnetic flux exhibitor",
    {
      selector: selectorControl(
        "fluxElectromagnet",
        "Electromagnet",
        [
          { key: "iron", label: "Iron", speed: 1.1, eu: 0.8, parallels: 8 },
          { key: "steel", label: "Steel", speed: 1.25, eu: 0.75, parallels: 24 },
          { key: "neodymium", label: "Neodymium", speed: 1.5, eu: 0.7, parallels: 48 },
          { key: "samarium", label: "Samarium", speed: 2, eu: 0.6, parallels: 96 },
          { key: "tengam", label: "Tengam", speed: 2.5, eu: 0.5, parallels: 256 },
        ],
        WIKI_NOTE,
      ),
    },
  ],
  [
    "precise auto assembler mt 3662",
    {
      durationMultiplier: 0.5,
      selector: selectorControl(
        "preciseCasing",
        "Precise Casing",
        [
          { key: "mk0", label: "Mk-0", parallels: 16 },
          { key: "mk1", label: "Mk-I", parallels: 32 },
          { key: "mk2", label: "Mk-II", parallels: 64 },
          { key: "mk3", label: "Mk-III", parallels: 128 },
          { key: "mk4", label: "Mk-IV", parallels: 256 },
        ],
        WIKI_NOTE,
      ),
      note: "Normal assembler mode; precise mode has no bonuses.",
    },
  ],
  [
    "hyper intensity laser engraver",
    {
      selector: selectorControl(
        "laserSource",
        "Laser Source",
        [
          { key: "a256", label: "256A Laser", parallels: 6 },
          { key: "a1024", label: "1,024A Laser", parallels: 10 },
          { key: "a4096", label: "4,096A Laser", parallels: 16 },
          { key: "a16384", label: "16,384A Laser", parallels: 25 },
          { key: "a65536", label: "65,536A Laser", parallels: 40 },
          { key: "a262144", label: "262,144A Laser", parallels: 64 },
          { key: "a1048576", label: "1,048,576A Laser", parallels: 101 },
          { key: "a4194304", label: "4,194,304A Laser", parallels: 161 },
          { key: "a16777216", label: "16,777,216A Laser", parallels: 256 },
        ],
        "Parallels are the cube root of the laser source amperage (GTNH wiki)",
      ),
    },
  ],
  [
    "pcb factory",
    {
      selector: selectorControl(
        "pcbNanites",
        "Nanites",
        [
          { key: "n16", label: "16 Nanites", parallels: 8 },
          { key: "n64", label: "64 Nanites", parallels: 23 },
          { key: "n256", label: "256 Nanites", parallels: 64 },
          { key: "n512", label: "512 Nanites", parallels: 108 },
          { key: "n1024", label: "1,024 Nanites", parallels: 181 },
          { key: "n1618", label: "1,618+ Nanites", parallels: 256 },
        ],
        "Parallels = ceil(nanites^0.75), capped at 256 (GTNH wiki)",
      ),
      note: "Cooling towers and trace size are not modeled yet.",
    },
  ],
  [
    "zhuhai fishing port",
    {
      selector: selectorControl(
        "voltageParallel",
        "Parallels per Tier",
        [
          {
            key: "affine-2-2",
            label: "2 x (Voltage Tier + 1)",
            perVoltageTier: 2,
            voltageBase: 2,
          },
        ],
        "Parallels = 2 x (voltage tier + 1) (GTNH wiki)",
      ),
    },
  ],
  [
    "density 2",
    {
      selector: selectorControl(
        "voltageParallel",
        "Parallels per Tier",
        [
          {
            key: "affine-1-05",
            label: "1 + Voltage Tier / 2",
            perVoltageTier: 0.5,
            voltageBase: 1,
          },
        ],
        "Parallels = 1 + floor(voltage tier / 2) (GTNH wiki)",
      ),
    },
  ],
  [
    "dangote distillus@@distillery",
    {
      selector: selectorControl(
        "voltageParallel",
        "Parallels per Tier",
        [{ key: "per-tier-8", label: "8 per Voltage Tier", perVoltageTier: 8 }],
        "Distillery mode requires the full 12-layer tower: 8 parallels per voltage tier (GTNH wiki)",
      ),
    },
  ],
]);

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wiki-sourced augmentation for a machine, optionally specific to the recipe
 * map it appears on. Tooltip-parsed stats take precedence; callers should
 * only fill gaps and append the selector control.
 */
export function wikiStatsForMachine(label, machineType) {
  return (
    ENTRIES.get(`${normalizeKey(label)}@@${normalizeKey(machineType)}`) ??
    ENTRIES.get(normalizeKey(label))
  );
}
