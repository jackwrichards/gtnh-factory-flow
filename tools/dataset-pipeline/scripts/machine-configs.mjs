// Machine config controls and machine handler templates for the oracle
// normalizer. Everything here is pure data-in/data-out so it can be unit
// tested without running the full normalize script.
//
// The oracle exporter attaches a `catalysts` list to every GregTech recipe
// map: one entry per machine (MetaTileEntity) that can run the map, with the
// machine's display name, tooltip lines, and Java class. This module turns
// that list into:
//   - recipe-level machineConfigControls for the map's primary machine only
//     (previously every catalyst's tooltip was merged into every recipe,
//     which is how the Dangote Distillus forced 12 parallels onto the plain
//     Distillation Tower), and
//   - per-recipe machineHandlers so the UI can switch between the machines
//     that share a recipe map (singleblock families folded across tiers,
//     multiblocks kept distinct with their own speed/EU/parallel stats).

export const VOLTAGE_TIER_NAMES = [
  "ULV",
  "LV",
  "MV",
  "HV",
  "EV",
  "IV",
  "LuV",
  "ZPM",
  "UV",
  "UHV",
  "UEV",
  "UIV",
  "UXV",
  "OpV",
  "MAX",
];

export const heatingCoilTiers = [
  { heat: 1801, key: "cupronickel", label: "Cupronickel", blockId: "gregtech:gt.blockcasings5" },
  { heat: 2701, key: "kanthal", label: "Kanthal", blockId: "gregtech:gt.blockcasings5@1" },
  { heat: 3601, key: "nichrome", label: "Nichrome", blockId: "gregtech:gt.blockcasings5@2" },
  { heat: 4501, key: "tpv", label: "TPV-Alloy", blockId: "gregtech:gt.blockcasings5@3" },
  { heat: 5401, key: "hss_g", label: "HSS-G", blockId: "gregtech:gt.blockcasings5@4" },
  { heat: 6301, key: "hss_s", label: "HSS-S", blockId: "gregtech:gt.blockcasings5@9" },
  { heat: 7201, key: "naquadah", label: "Naquadah", blockId: "gregtech:gt.blockcasings5@5" },
  {
    heat: 8101,
    key: "naquadah_alloy",
    label: "Naquadah Alloy",
    blockId: "gregtech:gt.blockcasings5@6",
  },
  { heat: 9001, key: "trinium", label: "Trinium", blockId: "gregtech:gt.blockcasings5@10" },
  {
    heat: 9901,
    key: "electrum_flux",
    label: "Electrum Flux",
    blockId: "gregtech:gt.blockcasings5@7",
  },
  {
    heat: 10801,
    key: "awakened_draconium",
    label: "Awakened Draconium",
    blockId: "gregtech:gt.blockcasings5@8",
  },
  { heat: 11701, key: "infinity", label: "Infinity", blockId: "gregtech:gt.blockcasings5@11" },
  { heat: 12601, key: "hypogen", label: "Hypogen", blockId: "gregtech:gt.blockcasings5@12" },
  { heat: 13501, key: "eternal", label: "Eternal", blockId: "gregtech:gt.blockcasings5@13" },
];

const pipeCasingTiers = [
  { key: "bronze", label: "Bronze", blockId: "gregtech:gt.blockcasings2@12" },
  { key: "steel", label: "Steel", blockId: "gregtech:gt.blockcasings2@13" },
  { key: "titanium", label: "Titanium", blockId: "gregtech:gt.blockcasings2@14" },
  { key: "tungstensteel", label: "Tungstensteel", blockId: "gregtech:gt.blockcasings2@15" },
  { key: "ptfe", label: "PTFE", blockId: "gregtech:gt.blockcasings8@1" },
  { key: "pbi", label: "PBI", blockId: "gregtech:gt.blockcasings9" },
];

const solenoidTiers = [
  { key: "mv", label: "MV", blockId: "gregtech:gt.blockcasings.cyclotron_coils", voltageTier: 2 },
  { key: "hv", label: "HV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@1", voltageTier: 3 },
  { key: "ev", label: "EV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@2", voltageTier: 4 },
  { key: "iv", label: "IV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@3", voltageTier: 5 },
  {
    key: "luv",
    label: "LuV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@4",
    voltageTier: 6,
  },
  {
    key: "zpm",
    label: "ZPM",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@5",
    voltageTier: 7,
  },
  { key: "uv", label: "UV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@6", voltageTier: 8 },
  {
    key: "uhv",
    label: "UHV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@7",
    voltageTier: 9,
  },
  {
    key: "uev",
    label: "UEV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@8",
    voltageTier: 10,
  },
  {
    key: "uiv",
    label: "UIV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@9",
    voltageTier: 11,
  },
  {
    key: "umv",
    label: "UMV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@10",
    voltageTier: 12,
  },
];

// ---------------------------------------------------------------------------
// Recipe-level machine config controls
// ---------------------------------------------------------------------------

export function machineConfigControlsForOracleRecipe(machineType, specialValue, extraControls = []) {
  const controls = [...(extraControls ?? [])];
  const normalized = normalizeLabel(machineType);

  if (isBlastFurnaceRecipeMap(normalized)) {
    const minimum =
      Number.isFinite(Number(specialValue)) && Number(specialValue) > 0
        ? coilTierForHeat(Number(specialValue))
        : heatingCoilTiers[0];
    controls.push(
      heatingCoilControl({
        minimumKey: minimum.key,
        defaultKey: minimum.key,
        tooltip: (tier) => [`Heat capacity: ${tier.heat} K`],
      }),
    );
  }

  if (normalized === "pyrolyse oven") {
    controls.push(
      heatingCoilControl({
        tooltip: (tier, index) => [
          `Duration multiplier: ${formatTooltipMultiplier(2 / (1 + index))}x`,
          "EU/t is not affected by coil tier",
        ],
        effect: (_tier, index) => ({ durationMultiplier: 2 / (1 + index) }),
      }),
    );
  }

  if (normalized === "oil cracker") {
    controls.push(
      heatingCoilControl({
        tooltip: (_tier, index) => [
          `EU usage: ${formatTooltipPercent(1 - Math.min(0.1 * (index + 1), 0.5))}`,
        ],
        effect: (_tier, index) => ({ eutMultiplier: 1 - Math.min(0.1 * (index + 1), 0.5) }),
      }),
    );
  }

  if (normalized === "large chemical reactor") {
    controls.push(
      heatingCoilControl({
        tooltip: () => ["Required structure coil", "No runtime speed or EU/t effect"],
      }),
    );
  }

  if (normalized === "coke oven" || normalized === "industrial coke oven") {
    controls.push(
      heatingCoilControl({
        tooltip: (_tier, index) => [`EU usage: ${formatTooltipPercent(Math.pow(0.98, index + 1))}`],
        effect: (_tier, index) => ({ eutMultiplier: Math.pow(0.98, index + 1) }),
      }),
    );
    controls.push({
      id: "cokeOvenCasing",
      label: "Coke Oven Casing",
      minimumKey: "heat_resistant",
      defaultKey: "heat_resistant",
      tiers: [
        {
          key: "heat_resistant",
          label: "Heat Resistant",
          parallelMultiplier: 16,
          resource: machineConfigResource(
            "factoryflow:machine_config/heat_resistant_coke_oven_casing",
            "Heat Resistant Coke Oven Casing",
            ["Coke Oven casing tier", "Parallels: 16"],
          ),
        },
        {
          key: "heat_proof",
          label: "Heat Proof",
          parallelMultiplier: 32,
          resource: machineConfigResource(
            "factoryflow:machine_config/heat_proof_coke_oven_casing",
            "Heat Proof Coke Oven Casing",
            ["Coke Oven casing tier", "Parallels: 32"],
          ),
        },
      ],
    });
    // Slices: "16 base and +8 Parallels per extra slice with Heat Resistant
    // Casing" (32/+16 for Heat Proof), max 15 extra slices. Expressed as a
    // multiplier on the casing parallels: (slices + 1) / 2, so Heat
    // Resistant 16 x mult and Heat Proof 32 x mult give the in-game counts.
    controls.push({
      id: "cokeOvenSlices",
      label: "Slices",
      minimumKey: "slice-1",
      defaultKey: "slice-1",
      tiers: Array.from({ length: 16 }, (_, index) => {
        const slices = index + 1;
        return {
          key: `slice-${slices}`,
          label: `${slices} Slice${slices === 1 ? "" : "s"}`,
          parallelMultiplier: (slices + 1) / 2,
          resource: machineConfigResource(
            `factoryflow:machine_config/coke_oven_slice_${slices}`,
            `${slices} Slice${slices === 1 ? "" : "s"}`,
            [
              "Industrial Coke Oven width",
              `Parallels: ${8 * (slices + 1)} with Heat Resistant, ${16 * (slices + 1)} with Heat Proof`,
            ],
          ),
        };
      }),
    });
  }

  return mergeMachineConfigControls(controls);
}

// ---------------------------------------------------------------------------
// Machine handler templates from recipe map catalysts
// ---------------------------------------------------------------------------

const TIER_SUFFIX_PATTERN = /\s*\((ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\)\s*$/i;
const ROMAN_SUFFIX_PATTERN = /\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/;
const GRADE_PREFIX_PATTERN =
  /^(?:Basic|Advanced|Elite|Ultimate|Epic|MAX|Turbo|Quick|Instant|Universal)\s+/i;
const PER_TIER_LINE_PATTERN = /\bper\s+.+?\s+tier\b/i;

export function buildMachineHandlerTemplates(machineType, catalysts) {
  const families = new Map();

  for (const catalyst of catalysts ?? []) {
    const rawLabel = cleanTooltipText(catalyst?.resource?.displayName);
    if (!rawLabel) {
      continue;
    }
    const tooltip = (catalyst?.resource?.tooltip ?? [])
      .map((line) => cleanTooltipText(line))
      .filter(Boolean);
    // Deprecated controllers are still registered in the game but slated for
    // removal; they must not appear as choices.
    if (tooltip.some((line) => /\bdeprecated\b/i.test(line))) {
      continue;
    }
    const multiblock = isMultiblockCatalyst(catalyst, tooltip);

    const tierSuffix = TIER_SUFFIX_PATTERN.exec(rawLabel)?.[1];
    let label = rawLabel.replace(TIER_SUFFIX_PATTERN, "").trim();
    if (!multiblock) {
      // Fold tiered singleblock variants (Basic/Advanced/roman numerals)
      // into one machine family, mirroring the app's family folding.
      label = label.replace(ROMAN_SUFFIX_PATTERN, "").replace(GRADE_PREFIX_PATTERN, "").trim();
    }
    const familyKey = normalizeLabel(label);
    if (!familyKey) {
      continue;
    }

    const minimumTier =
      normalizeVoltageTierName(tierSuffix) ?? voltageTierFromTooltip(tooltip) ?? undefined;

    const existing = families.get(familyKey);
    if (existing) {
      if (
        minimumTier !== undefined &&
        (existing.minimumTier === undefined ||
          voltageTierIndex(minimumTier) < voltageTierIndex(existing.minimumTier))
      ) {
        existing.minimumTier = minimumTier;
      }
      continue;
    }

    const stats = multiblock ? parseMultiblockCatalystStats(tooltip, machineType) : {};
    families.set(familyKey, {
      id: slug(label),
      label,
      kind: multiblock ? "multiblock" : "single",
      minimumTier,
      ...stats,
    });
  }

  const templates = [...families.values()];
  if (templates.length === 0) {
    return [];
  }

  const primaryKey = normalizeLabel(machineType);
  const primary =
    templates.find((template) => normalizeLabel(template.label) === primaryKey) ?? templates[0];
  primary.isPrimary = true;

  templates.sort((left, right) => {
    if (Boolean(left.isPrimary) !== Boolean(right.isPrimary)) {
      return left.isPrimary ? -1 : 1;
    }
    if (left.kind !== right.kind) {
      return left.kind === "single" ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });

  return templates;
}

function isMultiblockCatalyst(catalyst, tooltip) {
  const sourceClass = String(catalyst?.sourceClass ?? "");
  if (/\.multi(?:block)?s?\./i.test(sourceClass) || /multiblock/i.test(sourceClass)) {
    return true;
  }
  return tooltip.some((line) => /controller block|multiblock/i.test(line));
}

const MODE_HEADER_PATTERN = /^(.{2,48}?)\s+Mode$/i;
const SECTION_DIVIDER_PATTERN = /^-{4,}$/;

/**
 * Split a tooltip into its base lines and named mode sections. Multi-mode
 * machines (Dangote Distillus, the newer Mega Distillation Tower) describe
 * one section per mode; a divider line returns subsequent lines to the base.
 */
function splitTooltipModes(tooltip) {
  const baseLines = [];
  const modes = [];
  let currentMode;
  for (const line of tooltip) {
    if (SECTION_DIVIDER_PATTERN.test(line)) {
      currentMode = undefined;
      continue;
    }
    const header = MODE_HEADER_PATTERN.exec(line);
    if (header) {
      currentMode = { name: header[1].trim(), lines: [] };
      modes.push(currentMode);
      continue;
    }
    (currentMode ? currentMode.lines : baseLines).push(line);
  }
  return { baseLines, modes };
}

function selectModeForMachineType(modes, machineType) {
  const mapKey = normalizeLabel(machineType);
  if (!mapKey) {
    return undefined;
  }
  return modes.find((mode) => {
    const modeKey = normalizeLabel(mode.name);
    return modeKey === mapKey || modeKey.includes(mapKey) || mapKey.includes(modeKey);
  });
}

function parseMultiblockCatalystStats(tooltip, machineType) {
  const { baseLines, modes } = splitTooltipModes(tooltip);
  const base = parseStatLines(baseLines, { allLines: tooltip });
  // A machine with modes uses the stats of the mode matching this recipe
  // map; if none matches, only the base (mode-independent) stats apply.
  const mode = modes.length > 0 ? selectModeForMachineType(modes, machineType) : undefined;
  const modeStats = mode ? parseStatLines(mode.lines, { allLines: tooltip }) : undefined;

  const durationMultiplier = modeStats?.durationMultiplier ?? base.durationMultiplier;
  const eutMultiplier = modeStats?.eutMultiplier ?? base.eutMultiplier;
  const perfectOverclock = base.perfectOverclock || modeStats?.perfectOverclock || undefined;
  const maxParallel = modeStats?.maxParallel ?? base.maxParallel;
  const minimumTier = modeStats?.minimumTier ?? base.minimumTier;

  const controls = [...base.controls, ...(modeStats?.controls ?? [])];
  if (maxParallel !== undefined) {
    controls.push(fixedParallelControl(maxParallel));
  }

  const merged = mergeMachineConfigControls(controls);
  const stats = {};
  if (durationMultiplier !== undefined) stats.durationMultiplier = durationMultiplier;
  if (eutMultiplier !== undefined) stats.eutMultiplier = eutMultiplier;
  if (perfectOverclock) stats.perfectOverclock = true;
  if (minimumTier !== undefined) stats.minimumTier = minimumTier;
  if (merged) stats.machineConfigControls = merged;
  return stats;
}

function parseStatLines(lines, { allLines }) {
  const controls = [];
  let durationMultiplier;
  let eutMultiplier;
  let maxParallel;
  let minimumTier;
  let perfectOverclock;
  let voltageParallelBase;
  const voltageParallelUpgrades = [];

  for (const line of lines) {
    const tierControl = machineConfigControlFromTooltipLine(line);
    if (tierControl) {
      controls.push(tierControl);
      continue;
    }

    // Perfect overclock statements come in a few phrasings.
    if (
      /performs?\s+4\/4\s+overclocks?/i.test(line) ||
      /does not lose efficiency when overclocked/i.test(line) ||
      /performs? perfect overclocks? on lower-tier recipes/i.test(line) ||
      /reduce recipe time by a factor 4 instead of 2/i.test(line)
    ) {
      perfectOverclock = true;
      continue;
    }

    // "N Parallels per Voltage Tier" and ranged "4 - 8 Parallels per Voltage
    // Tier" (momentum machines; the planner assumes sustained running, so
    // the steady-state maximum applies).
    const perVoltage =
      /^(?:Gains\s+)?(\d+)\s+Parallels?\s+per\s+Voltage\s+Tier$/i.exec(line) ??
      /^(\d+)\s*-\s*(\d+)\s+Parallels?\s+per\s+Voltage\s+Tier$/i.exec(line);
    if (perVoltage) {
      const count = Number.parseInt(perVoltage[2] ?? perVoltage[1], 10);
      if (count > 0 && count <= 1024) {
        controls.push(voltageParallelControl(count, []));
      }
      continue;
    }

    // Ranged speed totals ("200% - 300% Speed"): steady-state maximum.
    const speedRange = /^(\d+(?:[.,]\d+)?)\s*%\s*-\s*(\d+(?:[.,]\d+)?)\s*%\s+Speed$/i.exec(line);
    if (speedRange) {
      const factor = parseTooltipNumber(speedRange[2]) / 100;
      if (factor > 0.01 && factor <= 100 && factor !== 1) {
        durationMultiplier = 1 / factor;
      }
      continue;
    }

    // "Runs at UHV with up to 4 parallels" / "Runs at UIV at 150% speed
    // with up to 16 parallels" (Space Elevator modules).
    const runsAt =
      /^Runs at ([A-Za-z]{2,4})(?: at (\d+(?:[.,]\d+)?)% speed)? with up to (\d+) parallels?$/i.exec(
        line,
      );
    if (runsAt) {
      minimumTier = runsAt[1];
      if (runsAt[2]) {
        const factor = parseTooltipNumber(runsAt[2]) / 100;
        if (factor > 0 && factor !== 1) {
          durationMultiplier = 1 / factor;
        }
      }
      const count = Number.parseInt(runsAt[3], 10);
      if (count > 1) {
        maxParallel = count;
      }
      continue;
    }

    // Steam multiblocks: high-pressure builds double speed (and steam use,
    // which the EU-based power model does not track).
    if (/^High-Pressure Doubles Speed and Steam Usage$/i.test(line)) {
      controls.push({
        id: "steamPressure",
        label: "Pressure",
        minimumKey: "normal",
        defaultKey: "normal",
        tiers: [
          {
            key: "normal",
            label: "Normal Pressure",
            resource: machineConfigResource(
              "factoryflow:machine_config/steam_pressure_normal",
              "Normal Pressure",
              ["Steam machine build", line],
            ),
          },
          {
            key: "high",
            label: "High Pressure",
            durationMultiplier: 0.5,
            resource: machineConfigResource(
              "factoryflow:machine_config/steam_pressure_high",
              "High Pressure",
              ["Steam machine build", "Doubles speed and steam usage", line],
            ),
          },
        ],
      });
      continue;
    }

    // Enumerated parallel tables. Two phrasings exist:
    //   "Mk-I/MK-II/MK-III/MK-IV->8/16/32/64 Parallels" after a line like
    //   "Precise Casing Tier determines Parallels" (Solar Factory), and
    //   "Neutronium : 1 Parallel" rows after "Parallels are determined by
    //   Containment Block Tier" (Electric Implosion Compressor).
    const determinedBy = /^Parallels are determined by (.{3,40})$/i.exec(
      line,
    ) ?? /^(.{3,40}?) determines Parallels$/i.exec(line);
    if (determinedBy) {
      const label = determinedBy[1].trim();
      const rows = [];
      for (const other of allLines) {
        const arrowTable = /^(.+?)->((?:\d+\/)+\d+)\s+Parallels?$/i.exec(other);
        if (arrowTable) {
          const names = arrowTable[1].split("/").map((name) => name.trim());
          const counts = arrowTable[2].split("/").map((value) => Number.parseInt(value, 10));
          if (names.length === counts.length) {
            for (let index = 0; index < names.length; index += 1) {
              rows.push({ name: names[index], count: counts[index] });
            }
          }
        }
        const colonRow = /^([A-Za-z][A-Za-z0-9 .'-]{1,32}?)\s*:\s*(\d+)\s+Parallels?$/.exec(other);
        if (colonRow && !/L\/s|EU|%/.test(other)) {
          rows.push({ name: colonRow[1].trim(), count: Number.parseInt(colonRow[2], 10) });
        }
      }
      if (rows.length >= 2) {
        controls.push(enumeratedParallelControl(label, rows));
      }
      continue;
    }

    // "Speed is 50% times Heating Coil Tier": coil tier T runs at (T * x)%
    // speed. The exported recipe duration is the 100%-speed baseline, so the
    // default coil is the tier whose multiplier is exactly 1.
    const coilSpeedTimes = /^Speed is (\d+(?:[.,]\d+)?)\s*%\s+times\s+(?:Heating\s+)?Coil Tier$/i.exec(
      line,
    );
    if (coilSpeedTimes) {
      const step = parseTooltipNumber(coilSpeedTimes[1]) / 100;
      if (step > 0) {
        controls.push(
          coilFormulaControl({
            line,
            effect: (index) => ({ durationMultiplier: 1 / (step * (index + 1)) }),
            neutral: (index) => Math.abs(step * (index + 1) - 1) < 1e-9,
          }),
        );
      }
      continue;
    }

    // "Every coil tier gives a +10% speed bonus and a 10% EU/t discount
    // (multiplicative)": compounding per coil tier.
    const coilCompound =
      /every coil tier gives a \+(\d+(?:[.,]\d+)?)\s*%\s+speed bonus and a (\d+(?:[.,]\d+)?)\s*%\s+EU\/?t discount \(multiplicative\)/i.exec(
        line,
      );
    if (coilCompound) {
      const speedStep = 1 + parseTooltipNumber(coilCompound[1]) / 100;
      const euStep = 1 - parseTooltipNumber(coilCompound[2]) / 100;
      controls.push(
        coilFormulaControl({
          line,
          effect: (index) => ({
            durationMultiplier: 1 / Math.pow(speedStep, index + 1),
            eutMultiplier: Math.pow(euStep, index + 1),
          }),
        }),
      );
      continue;
    }

    // "Processes Voltage Tier * Coil Tier items": parallels scale with both
    // the coil choice and the machine's voltage tier.
    if (/^Processes Voltage Tier\s*[*x]\s*Coil Tier items$/i.test(line)) {
      controls.push(
        coilFormulaControl({
          line,
          effect: (index) => ({ parallelPerVoltageTier: index + 1 }),
        }),
      );
      continue;
    }

    // "Voltage Tier * n Parallels" with "n=2 initially. n=8 after inserting
    // <upgrade>": a selectable control whose parallels scale with voltage.
    if (/^Voltage Tier\s*[*x]\s*n\s+Parallels$/i.test(line)) {
      voltageParallelBase = null; // marks the pattern as seen
      const tierSpeeds = [];
      for (const other of allLines) {
        const initial = /n\s*=\s*(\d+)\s+initially/i.exec(other);
        if (initial) {
          voltageParallelBase = Number.parseInt(initial[1], 10);
        }
        const upgraded = /n\s*=\s*(\d+)\s+after\s+(?:inserting\s+)?(.{3,60}?)(?:\.|$)/i.exec(other);
        if (upgraded) {
          voltageParallelUpgrades.push({
            count: Number.parseInt(upgraded[1], 10),
            label: upgraded[2].trim(),
          });
        }
        // "Tier 1: 160% speed" / "Tier 2: 640% speed" pair with the
        // initial/upgraded options in order (Industrial Maceration Stack).
        const tierSpeed = /^Tier (\d+):\s*(\d+(?:[.,]\d+)?)\s*%\s+speed$/i.exec(other);
        if (tierSpeed) {
          tierSpeeds[Number.parseInt(tierSpeed[1], 10) - 1] =
            parseTooltipNumber(tierSpeed[2]) / 100;
        }
      }
      if (tierSpeeds.length > 0) {
        voltageParallelUpgrades.speeds = tierSpeeds;
      }
      continue;
    }

    // "256 x (1 + Tower Height/2) Parallels" plus a base line like "Has up
    // to 5 middle slices": a fixed base multiplied by a structure dimension.
    const heightFormula =
      /^(\d+)\s*[*x]\s*\(\s*1\s*\+\s*([A-Za-z][A-Za-z ]{2,24}?)\s*\/\s*(\d+)\s*\)\s*Parallels$/i.exec(
        line,
      );
    if (heightFormula) {
      const baseCount = Number.parseInt(heightFormula[1], 10);
      const dimension = heightFormula[2].trim();
      const divisor = Number.parseInt(heightFormula[3], 10);
      const capMatch = allLines
        .map((other) => /up to (\d+) (?:middle )?slices/i.exec(other))
        .find(Boolean);
      const cap = capMatch ? Number.parseInt(capMatch[1], 10) : undefined;
      if (baseCount > 1 && divisor > 0 && cap && cap >= 1 && cap <= 32) {
        maxParallel = baseCount;
        controls.push(structureDimensionControl(dimension, divisor, cap, line));
      }
      continue;
    }

    if (PER_TIER_LINE_PATTERN.test(line)) {
      // Tier-scaled bonuses for subjects we cannot model are skipped rather
      // than misread as static bonuses.
      continue;
    }

    // GT++ machines state totals ("220% Speed", "90% EU Usage"); a few
    // others state bonuses ("Speed: +120%", "50% faster"). An explicit 100%
    // resets the stat, which matters for multi-mode tooltips.
    const speedTotal = /^(\d+(?:[.,]\d+)?)\s*%\s+Speed$/i.exec(line);
    if (speedTotal) {
      const factor = parseTooltipNumber(speedTotal[1]) / 100;
      if (factor === 1) {
        durationMultiplier = undefined;
      } else if (factor > 0.01 && factor <= 100) {
        durationMultiplier = 1 / factor;
      }
      continue;
    }

    const speed =
      /^Speed:\s*\+\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(line) ??
      /\+\s*(\d+(?:[.,]\d+)?)\s*%\s+faster/i.exec(line) ??
      /(\d+(?:[.,]\d+)?)\s*%\s+faster/i.exec(line);
    if (speed) {
      const bonus = parseTooltipNumber(speed[1]) / 100;
      if (bonus > 0 && bonus <= 50) {
        durationMultiplier = 1 / (1 + bonus);
      }
      continue;
    }

    const euUsage =
      /^(\d+(?:[.,]\d+)?)\s*%\s+EU\s*Usage$/i.exec(line) ??
      /^EU\s*Usage:\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(line) ??
      /^Power Usage:\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(line) ??
      /uses?\s+(\d+(?:[.,]\d+)?)\s*%\s+(?:of\s+the\s+)?(?:EU|power|energy)/i.exec(line);
    if (euUsage) {
      const factor = parseTooltipNumber(euUsage[1]) / 100;
      if (factor === 1) {
        eutMultiplier = undefined;
      } else if (factor > 0 && factor <= 5) {
        eutMultiplier = factor;
      }
      continue;
    }

    const euDiscount = /(\d+(?:[.,]\d+)?)\s*%\s+(?:less|reduced)\s+(?:EU|power|energy)/i.exec(line);
    if (euDiscount) {
      const discount = parseTooltipNumber(euDiscount[1]) / 100;
      if (discount > 0 && discount < 1) {
        eutMultiplier = 1 - discount;
      }
      continue;
    }

    const parallels =
      /^(?:Max\.?\s+)?Parallels?:\s*(\d+)\b/i.exec(line) ??
      /^Has (\d+) parallels? by default$/i.exec(line) ??
      /(?:^|\b)(\d+)\s+Parallels?\s*$/i.exec(line);
    if (parallels) {
      const count = Number.parseInt(parallels[1], 10);
      if (count > 1 && count <= 4096) {
        maxParallel = count;
      }
    }
  }

  if (voltageParallelBase !== null && voltageParallelBase !== undefined) {
    controls.push(voltageParallelControl(voltageParallelBase, voltageParallelUpgrades));
  }

  return {
    durationMultiplier,
    eutMultiplier,
    maxParallel,
    minimumTier: normalizeStatVoltageTier(minimumTier),
    perfectOverclock,
    controls: controls.filter(Boolean),
  };
}

function normalizeStatVoltageTier(value) {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  return VOLTAGE_TIER_NAMES.find((tier) => tier.toLowerCase() === normalized);
}

function enumeratedParallelControl(label, rows) {
  const id = `parallel-${slug(label)}`;
  return {
    id,
    label,
    minimumKey: slug(rows[0].name),
    defaultKey: slug(rows[0].name),
    tiers: rows
      .filter((row) => Number.isFinite(row.count) && row.count >= 1 && row.count <= 4096)
      .map((row) => ({
        key: slug(row.name),
        label: `${row.name} (${row.count} Parallels)`,
        parallelMultiplier: row.count,
        resource: machineConfigResource(
          `factoryflow:machine_config/${slug(label)}_${slug(row.name)}`,
          row.name,
          [label, `Parallels: ${row.count}`],
        ),
      })),
  };
}

function coilFormulaControl({ line, effect, neutral }) {
  let defaultKey;
  const tiers = heatingCoilTiers.map((tier, index) => {
    if (neutral?.(index) && defaultKey === undefined) {
      defaultKey = tier.key;
    }
    return {
      key: tier.key,
      label: tier.label,
      heat: tier.heat,
      ...effect(index),
      resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
        "Heating coil tier",
        line,
      ]),
    };
  });
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: heatingCoilTiers[0].key,
    defaultKey: defaultKey ?? heatingCoilTiers[0].key,
    tiers,
  };
}

function structureDimensionControl(dimension, divisor, cap, line) {
  const id = `structure-${slug(dimension)}`;
  return {
    id,
    label: dimension,
    minimumKey: `${slug(dimension)}-1`,
    defaultKey: `${slug(dimension)}-1`,
    tiers: Array.from({ length: cap }, (_, index) => {
      const level = index + 1;
      return {
        key: `${slug(dimension)}-${level}`,
        label: `${dimension} ${level}`,
        parallelMultiplier: 1 + level / divisor,
        resource: machineConfigResource(
          `factoryflow:machine_config/${slug(dimension)}_${level}`,
          `${dimension} ${level}`,
          ["Imported from machine catalyst tooltip", line],
        ),
      };
    }),
  };
}

function voltageParallelControl(baseCount, upgrades) {
  const speeds = upgrades.speeds ?? [];
  const speedEffect = (index) => {
    const factor = speeds[index];
    return Number.isFinite(factor) && factor > 0 && factor !== 1
      ? { durationMultiplier: 1 / factor }
      : {};
  };
  const tiers = [];
  if (Number.isFinite(baseCount) && baseCount > 0) {
    tiers.push({
      key: `per-tier-${baseCount}`,
      label: `${baseCount} per Voltage Tier`,
      parallelPerVoltageTier: baseCount,
      ...speedEffect(0),
      resource: machineConfigResource(
        `factoryflow:machine_config/per_tier_${baseCount}`,
        `${baseCount} Parallels per Voltage Tier`,
        ["Imported from machine catalyst tooltip"],
      ),
    });
  }
  for (const [upgradeIndex, upgrade] of upgrades.entries()) {
    if (!Number.isFinite(upgrade.count) || upgrade.count <= 0) {
      continue;
    }
    tiers.push({
      key: `per-tier-${upgrade.count}`,
      label: `${upgrade.count} per Voltage Tier (${upgrade.label})`,
      parallelPerVoltageTier: upgrade.count,
      ...speedEffect(upgradeIndex + (Number.isFinite(baseCount) && baseCount > 0 ? 1 : 0)),
      resource: machineConfigResource(
        `factoryflow:machine_config/per_tier_${upgrade.count}`,
        `${upgrade.count} Parallels per Voltage Tier`,
        ["Imported from machine catalyst tooltip", upgrade.label],
      ),
    });
  }
  if (tiers.length === 0) {
    return undefined;
  }
  return {
    id: "voltageParallel",
    label: "Parallels per Tier",
    minimumKey: tiers[0].key,
    defaultKey: tiers[0].key,
    tiers,
  };
}

function machineConfigControlFromTooltipLine(rawLine) {
  const line = String(rawLine ?? "").replace(/\s+/g, " ").trim();
  if (!line) {
    return undefined;
  }

  const multiplicativePerTier =
    /(?:^|\b)(\d+(?:[.,]\d+)?)x\s+Parallels?\s+per\s+(.+?)\s+Tier\b/i.exec(line);
  if (multiplicativePerTier) {
    const factor = parseTooltipNumber(multiplicativePerTier[1]);
    return tieredEffectControlFromSubject(multiplicativePerTier[2], line, {
      effectLabel: "Parallels",
      effect: (tier, index) => ({
        parallelMultiplier: Math.pow(factor, tierOrdinal(tier, index)),
      }),
      keep: (effect) => effect.parallelMultiplier > 1,
    });
  }

  const perTier = /(?:^|\b)(\d+)\s+Parallels?\s+per\s+(.+?)\s+Tier\b/i.exec(line);
  if (perTier) {
    const factor = Number.parseInt(perTier[1], 10);
    return tieredEffectControlFromSubject(perTier[2], line, {
      effectLabel: "Parallels",
      effect: (tier, index) => ({ parallelMultiplier: factor * tierOrdinal(tier, index) }),
      keep: (effect) => effect.parallelMultiplier > 1,
    });
  }

  const speedPerTier = /(?:^|\b)\+?(\d+(?:[.,]\d+)?%)\s+Speed\s+per\s+(.+?)\s+Tier\b/i.exec(line);
  if (speedPerTier) {
    const factor = parseTooltipFactor(speedPerTier[1]);
    return tieredEffectControlFromSubject(speedPerTier[2], line, {
      effectLabel: "Speed",
      effect: (tier, index) => ({
        durationMultiplier: reciprocal(1 + factor * tierOrdinal(tier, index)),
      }),
      keep: (effect) => effect.durationMultiplier > 0 && effect.durationMultiplier < 1,
    });
  }

  const euUsagePerTier =
    /(?:^|\b)([+-]?\d+(?:[.,]\d+)?%)\s+EU\s+Usage\s+per\s+(.+?)\s+Tier\b/i.exec(line);
  if (euUsagePerTier) {
    const factor = parseTooltipFactor(euUsagePerTier[1]);
    return tieredEffectControlFromSubject(euUsagePerTier[2], line, {
      effectLabel: "EU usage",
      effect: (tier, index) => ({
        eutMultiplier: Math.max(0.01, 1 + factor * tierOrdinal(tier, index)),
      }),
      keep: (effect) => effect.eutMultiplier > 0 && effect.eutMultiplier !== 1,
    });
  }

  return undefined;
}

function fixedParallelControl(parallels, note = `Parallels: ${parallels}`) {
  return {
    id: "machineParallel",
    label: "Parallel",
    minimumKey: `fixed-${parallels}`,
    defaultKey: `fixed-${parallels}`,
    tiers: [
      {
        key: `fixed-${parallels}`,
        label: `${parallels} Parallels`,
        parallelMultiplier: parallels,
        resource: machineConfigResource(
          `factoryflow:machine_config/fixed-${parallels}`,
          `${parallels} Parallels`,
          ["Imported from machine catalyst tooltip", note],
        ),
      },
    ],
  };
}

export function instantiateRecipeMachineHandlers(templates, recipe) {
  if (!Array.isArray(templates) || templates.length < 2) {
    return undefined;
  }

  const recipeTierIndex = voltageTierIndex(recipe.minimumTier);
  return templates.map((template) => {
    const templateTierIndex = voltageTierIndex(template.minimumTier);
    const tierIndex = Math.max(
      Number.isFinite(templateTierIndex) ? templateTierIndex : -1,
      Number.isFinite(recipeTierIndex) ? recipeTierIndex : -1,
    );
    const handler = {
      id: template.id,
      label: template.label,
      kind: template.kind,
      machineType: template.label,
      minimumTier: VOLTAGE_TIER_NAMES[tierIndex] ?? recipe.minimumTier,
    };

    if (Number.isFinite(template.durationMultiplier) && template.durationMultiplier !== 1) {
      handler.durationTicks = Math.max(
        1,
        Math.round(recipe.durationTicks * template.durationMultiplier),
      );
    }
    if (Number.isFinite(template.eutMultiplier) && template.eutMultiplier !== 1) {
      handler.eut = Math.max(0, Math.round(recipe.eut * template.eutMultiplier * 100) / 100);
    }
    if (template.perfectOverclock) {
      handler.perfectOverclock = true;
    }

    // Handlers that add their own controls also inherit the recipe-level
    // controls (for example the Volcanus keeps the EBF coil control next to
    // its fixed 8 parallels), but a handler's own control always replaces a
    // recipe-level control with the same id (the Space Assembler MK-II's 16
    // parallels must not merge with the MK-I's 4). Handlers without their
    // own controls fall back to the recipe-level controls in the app.
    const ownControls = template.machineConfigControls ?? [];
    if (!template.isPrimary && ownControls.length > 0) {
      const ownIds = new Set(ownControls.map((control) => control.id));
      handler.machineConfigControls = [
        ...ownControls,
        ...(recipe.machineConfigControls ?? []).filter((control) => !ownIds.has(control.id)),
      ];
    }

    return handler;
  });
}

export function primaryMachineHandlerControls(templates) {
  return (templates ?? []).find((template) => template.isPrimary)?.machineConfigControls ?? [];
}

// ---------------------------------------------------------------------------
// Shared control helpers
// ---------------------------------------------------------------------------

export function heatingCoilControl({
  minimumKey = "cupronickel",
  defaultKey = minimumKey,
  tooltip = () => [],
  effect = () => ({}),
} = {}) {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey,
    defaultKey,
    tiers: heatingCoilTiers.map((tier, index) => ({
      key: tier.key,
      label: tier.label,
      heat: tier.heat,
      ...effect(tier, index),
      resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
        "Heating coil tier",
        ...tooltip(tier, index),
      ]),
    })),
  };
}

function tieredEffectControlFromSubject(subject, line, { effectLabel, effect, keep }) {
  const definition = machineConfigTierDefinitionForSubject(subject);
  if (!definition) {
    return undefined;
  }

  const options = definition.tiers
    .map((tier, index) => {
      const effectFields = effect(tier, index);
      if (!isValidMachineConfigEffect(effectFields) || (keep && !keep(effectFields))) {
        return undefined;
      }
      return {
        key: tier.key,
        label: tier.label,
        ...effectFields,
        resource: {
          ...tier.resource,
          tooltip: uniqueStrings([
            definition.tooltipPrefix,
            line,
            ...effectTooltipLines(effectLabel, effectFields),
            ...(tier.resource.tooltip ?? []),
          ]),
        },
      };
    })
    .filter(Boolean);

  if (options.length === 0) {
    return undefined;
  }

  return {
    id: definition.id,
    label: definition.label,
    minimumKey: options[0].key,
    defaultKey: options[0].key,
    tiers: options,
  };
}

function machineConfigTierDefinitionForSubject(subject) {
  const normalized = normalizeLabel(subject);
  if (normalized.includes("coil")) {
    return {
      id: "heatingCoil",
      label: "Heating Coil",
      tiers: heatingCoilTiers.map((tier) => ({
        key: tier.key,
        label: tier.label,
        resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
          "Heating coil tier",
          `Heat capacity: ${tier.heat} K`,
        ]),
      })),
      tooltipPrefix: "Heating coil tier",
    };
  }
  if (normalized.includes("pipe casing")) {
    return {
      id: "pipeCasing",
      label: "Pipe Casing",
      tiers: pipeCasingTiers.map((tier) => ({
        key: tier.key,
        label: tier.label,
        resource: machineConfigResource(tier.blockId, `${tier.label} Pipe Casing`, [
          "Pipe casing tier",
        ]),
      })),
      tooltipPrefix: "Pipe casing tier",
    };
  }
  if (normalized.includes("solenoid")) {
    return {
      id: "solenoidCoil",
      label: "Solenoid",
      tiers: solenoidTiers.map((tier) => ({
        key: tier.key,
        label: tier.label,
        voltageTier: tier.voltageTier,
        resource: machineConfigResource(
          tier.blockId,
          `${tier.label} Solenoid Superconductor Coil`,
          ["Solenoid tier"],
        ),
      })),
      tooltipPrefix: "Solenoid tier",
    };
  }
  return undefined;
}

function isValidMachineConfigEffect(effect) {
  return (
    Number.isFinite(effect?.parallelMultiplier) ||
    Number.isFinite(effect?.durationMultiplier) ||
    Number.isFinite(effect?.eutMultiplier) ||
    Number.isFinite(effect?.outputMultiplier) ||
    Number.isFinite(effect?.heat)
  );
}

function effectTooltipLines(effectLabel, effect) {
  const lines = [];
  if (Number.isFinite(effect.parallelMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipMultiplier(effect.parallelMultiplier)}x`);
  }
  if (Number.isFinite(effect.durationMultiplier)) {
    lines.push(
      `${effectLabel}: ${formatTooltipMultiplier(reciprocal(effect.durationMultiplier))}x`,
    );
  }
  if (Number.isFinite(effect.eutMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipPercent(effect.eutMultiplier)}`);
  }
  if (Number.isFinite(effect.outputMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipMultiplier(effect.outputMultiplier)}x`);
  }
  return lines;
}

function machineConfigResource(id, displayName, tooltip = []) {
  return {
    kind: "item",
    id,
    amount: 1,
    displayName,
    tooltip,
    consumed: false,
  };
}

function coilTierForHeat(heat) {
  return heatingCoilTiers.find((tier) => tier.heat >= heat) ?? heatingCoilTiers.at(-1);
}

function isBlastFurnaceRecipeMap(normalizedMachineType) {
  return (
    normalizedMachineType === "blast furnace" || normalizedMachineType === "electric blast furnace"
  );
}

export function mergeMachineConfigControls(controls) {
  const byId = new Map();
  for (const control of (controls ?? []).filter(Boolean)) {
    const existing = byId.get(control.id);
    if (!existing) {
      byId.set(control.id, control);
      continue;
    }
    const tiersByKey = new Map((existing.tiers ?? []).map((tier) => [tier.key, tier]));
    for (const tier of control.tiers ?? []) {
      const current = tiersByKey.get(tier.key);
      tiersByKey.set(tier.key, current ? mergeMachineConfigTierOption(current, tier) : tier);
    }
    byId.set(control.id, {
      ...existing,
      minimumKey: existing.minimumKey ?? control.minimumKey,
      defaultKey: existing.defaultKey ?? control.defaultKey,
      tiers: [...tiersByKey.values()],
    });
  }
  const merged = [...byId.values()];
  return merged.length > 0 ? merged : undefined;
}

function mergeMachineConfigTierOption(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    label: existing.label ?? incoming.label,
    resource: mergeMachineConfigTierResource(existing.resource, incoming.resource),
  };
}

function mergeMachineConfigTierResource(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    ...existing,
    ...incoming,
    id: existing.id ?? incoming.id,
    displayName: existing.displayName ?? incoming.displayName,
    tooltip: uniqueStrings([...(existing.tooltip ?? []), ...(incoming.tooltip ?? [])]),
  };
}

export function machineConfigResources(controls) {
  return (controls ?? []).flatMap((control) =>
    (control.tiers ?? []).map((tier) => tier.resource).filter(Boolean),
  );
}

export function machineHandlerConfigResources(handlers) {
  return (handlers ?? []).flatMap((handler) =>
    machineConfigResources(handler.machineConfigControls),
  );
}

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

function cleanTooltipText(value) {
  return String(value ?? "")
    .replace(/§./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVoltageTierName(value) {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  return VOLTAGE_TIER_NAMES.find((tier) => tier.toLowerCase() === normalized);
}

function voltageTierFromTooltip(tooltip) {
  for (const line of tooltip) {
    if (!/voltage/i.test(line)) {
      continue;
    }
    const match =
      /\b(ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\b/i.exec(
        line.replace(/voltage/i, ""),
      );
    if (match) {
      return normalizeVoltageTierName(match[1]);
    }
  }
  return undefined;
}

function voltageTierIndex(tier) {
  if (!tier) {
    return Number.NaN;
  }
  const normalized = String(tier).trim().toLowerCase();
  const index = VOLTAGE_TIER_NAMES.findIndex((name) => name.toLowerCase() === normalized);
  return index >= 0 ? index : Number.NaN;
}

function parseTooltipFactor(value) {
  const number = parseTooltipNumber(value);
  return String(value).trim().endsWith("%") ? number / 100 : number;
}

function parseTooltipNumber(value) {
  return Number.parseFloat(String(value).replace(",", ".").replace("%", ""));
}

function reciprocal(value) {
  return Number.isFinite(value) && value !== 0 ? 1 / value : Number.NaN;
}

function tierOrdinal(tier, index) {
  return Number.isFinite(tier.voltageTier) ? tier.voltageTier : index + 1;
}

function formatTooltipMultiplier(value) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTooltipPercent(value) {
  return `${formatTooltipMultiplier(value * 100)}%`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(recipes?|recipe map|map)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
