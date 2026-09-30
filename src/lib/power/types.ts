/**
 * The power sector's card model. A PowerSourceDefinition is one placeable
 * generator family: its settings (the knobs on the card) and a pure compute
 * from settings to flows and EU/t. Math and data are transcribed from the
 * community "GTNH Power Planner 2.9" spreadsheet (by Fox), decoded in
 * docs/power-planner-math.md - that workbook is the source of truth, with
 * the game source as arbiter (src/lib/power/CLAUDE.md).
 */

export type PowerGroupId =
  | "burners"
  | "engines"
  | "steam"
  | "turbines"
  | "reactors"
  | "passive"
  | "endgame";

export interface PowerSelectOption {
  key: string;
  label: string;
}

/**
 * A knob that only means something while another knob holds a given value -
 * a custom flow field with the flow mode on Optimal, say - renders grayed
 * out until then.
 */
export interface PowerSettingCondition {
  settingId: string;
  equals: string;
}

export interface PowerSelectSetting {
  type: "select";
  id: string;
  label: string;
  options: PowerSelectOption[];
  defaultKey: string;
  enabledWhen?: PowerSettingCondition;
  /** Retired option key -> the current key it reads as; shipped plans store old option keys. */
  legacyKeys?: Record<string, string>;
}

export interface PowerNumberSetting {
  type: "number";
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  enabledWhen?: PowerSettingCondition;
}

export interface PowerToggleSetting {
  type: "toggle";
  id: string;
  label: string;
  defaultOn: boolean;
  enabledWhen?: PowerSettingCondition;
}

export type PowerSetting = PowerSelectSetting | PowerNumberSetting | PowerToggleSetting;

/**
 * One resource stream at the chosen settings, for ONE machine. `name` is the
 * spreadsheet's display name; the recipe synthesis resolves it to a dataset
 * resource where the map knows it, and shows it as a stat line where not.
 */
export interface PowerFlowLine {
  name: string;
  perSecond: number;
  unit: "L" | "item";
}

export interface PowerStatLine {
  label: string;
  value: string;
}

export interface PowerModel {
  /** Net EU/t of one machine at these settings; negative for parasitic-only machines. */
  euPerTick: number;
  inputs: PowerFlowLine[];
  outputs: PowerFlowLine[];
  stats: PowerStatLine[];
  /** Plain sentences shown on the card when a setting combination cannot run. */
  warnings?: string[];
}

/** Settings come off the node as strings; the reader types and defaults them. */
export interface PowerSettingsReader {
  select(id: string): string;
  number(id: string): number;
  on(id: string): boolean;
}

export interface PowerSourceDefinition {
  /** Stable id, stored in plans - never rename one that has shipped. */
  id: string;
  name: string;
  group: PowerGroupId;
  /** Voltage tier chip in the picker; a plain label, not enforced anywhere. */
  unlock?: string;
  /** One plain sentence for the picker card. */
  blurb: string;
  settings: PowerSetting[];
  compute(read: PowerSettingsReader): PowerModel;
}

/** The option a select setting reads as: the stored key, its legacy mapping, or the default. */
export function selectValue(setting: PowerSelectSetting, raw: string | undefined): string {
  if (raw === undefined) {
    return setting.defaultKey;
  }
  if (setting.options.some((option) => option.key === raw)) {
    return raw;
  }
  const mapped = setting.legacyKeys?.[raw];
  return mapped !== undefined && setting.options.some((option) => option.key === mapped)
    ? mapped
    : setting.defaultKey;
}

export function buildPowerSettingsReader(
  definition: PowerSourceDefinition,
  values: Record<string, string> | undefined,
): PowerSettingsReader {
  const byId = new Map(definition.settings.map((setting) => [setting.id, setting]));
  return {
    select(id) {
      const setting = byId.get(id);
      if (setting?.type !== "select") {
        return "";
      }
      return selectValue(setting, values?.[id]);
    },
    number(id) {
      const setting = byId.get(id);
      if (setting?.type !== "number") {
        return 0;
      }
      const raw = Number(values?.[id]);
      if (!Number.isFinite(raw)) {
        return setting.defaultValue;
      }
      return Math.min(setting.max, Math.max(setting.min, raw));
    },
    on(id) {
      const setting = byId.get(id);
      if (setting?.type !== "toggle") {
        return false;
      }
      const raw = values?.[id];
      return raw === undefined ? setting.defaultOn : raw === "1" || raw === "true";
    },
  };
}
