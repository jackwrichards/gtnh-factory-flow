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

  // GT++ ExxonMobil Chemical Plant: heating coils set the machine speed at
  // 50% per coil tier (Cupronickel 50%, Kanthal 100%, Nichrome 150%, ...).
  // EU/t is unchanged, so higher coils are an implicit total-EU discount.
  // The exported recipe duration corresponds to the 100% speed baseline, so
  // Kanthal is the default selection.
  if (normalized === "chemical plant" || normalized === "exxonmobil chemical plant") {
    controls.push(
      heatingCoilControl({
        minimumKey: "cupronickel",
        defaultKey: "kanthal",
        tooltip: (_tier, index) => [
          `Speed: ${50 * (index + 1)}%`,
          `Duration multiplier: ${formatTooltipMultiplier(2 / (1 + index))}x`,
          "EU/t is not affected by coil tier",
        ],
        effect: (_tier, index) => ({ durationMultiplier: 2 / (1 + index) }),
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

    const stats = multiblock ? parseMultiblockCatalystStats(tooltip) : {};
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

function parseMultiblockCatalystStats(tooltip) {
  const controls = [];
  let durationMultiplier;
  let eutMultiplier;
  let maxParallel;

  for (const line of tooltip) {
    const tierControl = machineConfigControlFromTooltipLine(line);
    if (tierControl) {
      controls.push(tierControl);
      continue;
    }
    if (PER_TIER_LINE_PATTERN.test(line)) {
      // Tier-scaled bonuses for subjects we cannot model (for example
      // parallels per voltage tier) are skipped rather than misread as
      // static bonuses.
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
      /^EU\s*Usage:\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(line) ??
      /uses?\s+(\d+(?:[.,]\d+)?)\s*%\s+(?:of\s+the\s+)?(?:EU|power|energy)/i.exec(line);
    if (euUsage) {
      const factor = parseTooltipNumber(euUsage[1]) / 100;
      if (factor > 0 && factor !== 1 && factor <= 5) {
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
      /(?:^|\b)(\d+)\s+Parallels?\s*$/i.exec(line);
    if (parallels) {
      const count = Number.parseInt(parallels[1], 10);
      if (count > 1 && count <= 4096) {
        maxParallel = count;
      }
    }
  }

  if (maxParallel !== undefined) {
    controls.push(fixedParallelControl(maxParallel));
  }

  const merged = mergeMachineConfigControls(controls);
  const stats = {};
  if (durationMultiplier !== undefined) stats.durationMultiplier = durationMultiplier;
  if (eutMultiplier !== undefined) stats.eutMultiplier = eutMultiplier;
  if (merged) stats.machineConfigControls = merged;
  return stats;
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

    // Handlers that add their own controls also inherit the recipe-level
    // controls (for example the Volcanus keeps the EBF coil control next to
    // its fixed 8 parallels). Handlers without their own controls fall back
    // to the recipe-level controls in the app, so they carry nothing here.
    const ownControls = template.machineConfigControls ?? [];
    if (!template.isPrimary && ownControls.length > 0) {
      handler.machineConfigControls = mergeMachineConfigControls([
        ...(recipe.machineConfigControls ?? []),
        ...ownControls,
      ]);
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
