"use client";

import { useState } from "react";
import { getPowerSource } from "@/lib/power/registry";
import {
  selectValue,
  type PowerNumberSetting,
  type PowerSettingCondition,
  type PowerSourceDefinition,
} from "@/lib/power/types";
import { useFactoryStore } from "@/store/factory-store";
import { RecipeTooltip } from "./RecipeTooltip";
import { FactTile, SettingListMenu, SettingSelectTile, SettingTile, STEPPER_MAX_RUNGS } from "./SettingTile";

/**
 * The knobs on a power card: the source definition's settings on the same
 * tiles every machine's settings use (SettingTile), writing through
 * setPowerSetting so the card's owned recipe follows every change. A
 * select is a ladder, a number a count, a boolean a two-rung ladder. Below
 * the tiles: the model's stat lines (efficiency, optimal flow, lifespans)
 * and any warning the current settings earn.
 */
export function PowerConfigPanel({
  nodeId,
  sourceId,
  values,
  stats,
  warnings,
}: {
  nodeId: string;
  sourceId: string;
  values: Record<string, string> | undefined;
  stats: Array<{ label: string; value: string }>;
  warnings?: string[];
}) {
  const setPowerSetting = useFactoryStore((state) => state.setPowerSetting);
  const source = getPowerSource(sourceId);
  if (!source) {
    return null;
  }

  const isEnabled = (condition: PowerSettingCondition | undefined) =>
    condition === undefined || settingValue(source, values, condition.settingId) === condition.equals;

  return (
    <div className="min-w-0 py-1">
      <div className="grid min-w-0 grid-cols-2 gap-1">
        {source.settings.map((setting) => {
          // The tier ladder lives on the header chip, like every machine's. A
          // numeric "tier" (the heat exchangers' circuit) has no chip, so it
          // stays in the panel.
          if (setting.id === "tier" && setting.type === "select") {
            return null;
          }
          const enabled = isEnabled(setting.enabledWhen);
          if (setting.type === "select") {
            const value = selectValue(setting, values?.[setting.id] || undefined);
            return (
              <PowerSelectTile
                key={setting.id}
                caption={setting.label}
                options={setting.options}
                value={value}
                enabled={enabled}
                onPick={(key) => setPowerSetting(nodeId, setting.id, key)}
              />
            );
          }
          if (setting.type === "number") {
            return (
              <PowerNumberTile
                key={setting.id}
                setting={setting}
                value={values?.[setting.id]}
                enabled={enabled}
                onCommit={(next) => setPowerSetting(nodeId, setting.id, next)}
              />
            );
          }
          const on = values?.[setting.id] === undefined ? setting.defaultOn : values[setting.id] === "1";
          return (
            <SettingTile
              key={setting.id}
              caption={setting.label}
              value={on ? "On" : "Off"}
              canStepDown={on}
              canStepUp={!on}
              onStep={(direction) => setPowerSetting(nodeId, setting.id, direction > 0 ? "1" : "0")}
              disabled={!enabled}
              help={() => <RecipeTooltip view={{ title: setting.label, rows: [{ label: "State", value: on ? "On" : "Off" }] }} />}
            />
          );
        })}
        {/* The model's readings (efficiency, optimal flow, lifespans) as fact
            tiles after the settings, in the same grid. */}
        {stats.map((line) => (
          <FactTile key={line.label} caption={line.label} value={line.value} />
        ))}
      </div>
      {warnings?.map((warning) => (
        <p key={warning} className="mt-1 text-[11px] leading-tight text-amber-300">
          {warning}
        </p>
      ))}
    </div>
  );
}

/** A select as a ladder tile: minus and plus walk the options, right click lists them. */
function PowerSelectTile({
  caption,
  options,
  value,
  enabled,
  onPick,
}: {
  caption: string;
  options: Array<{ key: string; label: string }>;
  value: string;
  enabled: boolean;
  onPick: (key: string) => void;
}) {
  const [listAt, setListAt] = useState<DOMRect | undefined>();
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const current = options[index];
  if (options.length > STEPPER_MAX_RUNGS) {
    return (
      <SettingSelectTile
        caption={caption}
        rows={options}
        currentKey={value}
        onPick={onPick}
        disabled={!enabled}
        help={() => <RecipeTooltip view={{ title: caption, rows: [{ label: "Selected", value: current?.label ?? value }] }} />}
      />
    );
  }
  return (
    <>
      <SettingTile
        caption={caption}
        value={current?.label ?? value}
        canStepDown={index > 0}
        canStepUp={index < options.length - 1}
        onStep={(direction) => {
          const next = options[Math.max(0, Math.min(options.length - 1, index + direction))];
          if (next && next.key !== value) onPick(next.key);
        }}
        onList={options.length > 2 ? setListAt : undefined}
        disabled={!enabled || options.length <= 1}
        help={() => <RecipeTooltip view={{ title: caption, rows: [{ label: "Selected", value: current?.label ?? value }] }} />}
      />
      {listAt ? (
        <SettingListMenu
          anchor={listAt}
          rows={options}
          currentKey={value}
          onPick={(key) => {
            setListAt(undefined);
            onPick(key);
          }}
          onClose={() => setListAt(undefined)}
        />
      ) : null}
    </>
  );
}

/** A setting's live value with its default filled in, for enabledWhen checks. */
function settingValue(
  source: PowerSourceDefinition,
  values: Record<string, string> | undefined,
  settingId: string,
): string | undefined {
  const setting = source.settings.find((entry) => entry.id === settingId);
  if (!setting) {
    return undefined;
  }
  const raw = values?.[settingId];
  if (setting.type === "select") {
    return selectValue(setting, raw);
  }
  if (setting.type === "toggle") {
    return raw === undefined ? (setting.defaultOn ? "1" : "0") : raw;
  }
  return raw ?? String(setting.defaultValue);
}

/**
 * A number as a count tile: minus and plus step it, the wheel steps it, a
 * click on the well types it. Commits on blur or Enter; the draft is local
 * so typing never re-solves.
 */
function PowerNumberTile({
  setting,
  value,
  enabled,
  onCommit,
}: {
  setting: PowerNumberSetting;
  value: string | undefined;
  enabled: boolean;
  onCommit: (next: string) => void;
}) {
  const shown = Number.parseFloat(value ?? String(setting.defaultValue));
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const clamp = (n: number) => Math.min(setting.max, Math.max(setting.min, n));
  const commit = (text: string) => {
    setDraft(undefined);
    const parsed = Number.parseFloat(text.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) onCommit(String(clamp(parsed)));
  };
  if (draft !== undefined) {
    return (
      <div className="nodrag nowheel min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 pb-0.5 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
        <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
          {setting.label}
          {setting.unit ? ` (${setting.unit})` : ""}
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(draft);
            if (event.key === "Escape") setDraft(undefined);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          inputMode="decimal"
          aria-label={setting.label}
          className="h-5 w-full min-w-0 border border-[var(--mc-47)] bg-[var(--mc-93)] px-1 text-center text-[11px] leading-[18px] text-[var(--mc-ink)] outline-none"
        />
      </div>
    );
  }
  const unit = setting.unit ? ` ${setting.unit}` : "";
  return (
    <SettingTile
      caption={setting.label}
      value={`${shown.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit}`}
      canStepDown={shown > setting.min}
      canStepUp={shown < setting.max}
      onStep={(direction) => onCommit(String(clamp(shown + direction * setting.step)))}
      onType={() => setDraft(String(shown))}
      disabled={!enabled}
      help={() => (
        <RecipeTooltip
          view={{
            title: setting.label,
            rows: [
              { label: "Value", value: `${shown.toLocaleString("en-US")}${unit}` },
              { label: "Range", value: `${setting.min.toLocaleString("en-US")} to ${setting.max.toLocaleString("en-US")}${unit}` },
            ],
            actions: [{ gesture: "left", label: "Type a value" }, { gesture: "wheel", label: "Step" }],
          }}
        />
      )}
    />
  );
}
